/**
 * 企业专属智能体（AaaS）— tRPC router
 *
 * 范围：UI / 客户端调用入口。把 PR-2 service 层的 4 个公共函数 + KB 查询暴露成
 * tRPC procedures，附加 owner / admin 鉴权，并在 mutation 入口接维护模式闸门。
 *
 * KB 文件**上传**走 Express 路由（multer），见 server/routers/enterpriseAgentUpload.ts。
 * 本文件只处理 KB 的 list / delete（JSON 请求即可，不需要 multipart）。
 *
 * 鉴权矩阵：
 *   - list / get / createAgent / executeQuery：protectedProcedure（owner only）
 *   - expireAgent / softDeleteAgent：owner 或 admin
 *   - admin.* 子 router：仅 admin 可见的全局列表（PR-4 准备 admin 后台用）
 *
 * 红线（agent-dev.md L292-296）：
 *   - 不直接 import paidJobLedger（service 层负责）
 *   - executeQuery 必须接 maintenanceMode + recordCreation
 *   - 注释 / 错误文案不承诺"绝对零保留"
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { protectedProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  enterpriseAgents,
  enterpriseAgentKnowledgeBase,
  enterpriseAgentSessions,
  users,
} from "../../drizzle/schema";
import { assertMaintenanceOff } from "../services/maintenanceMode";
import { recordCreation } from "./creations";
import {
  createAgent as svcCreateAgent,
  executeAgentQuery as svcExecuteAgentQuery,
  expireAgent as svcExpireAgent,
  softDeleteAgent as svcSoftDeleteAgent,
  EnterpriseAgentError,
  TRIAL_PRICE_CNY,
  ENTERPRISE_AGENT_GEMINI_MODEL,
} from "../services/enterpriseAgentService";
import { deleteGcsObject } from "../services/gcs";

// ─── 错误映射：service / parser 错误 → TRPCError ───────────────────────────

export function mapEnterpriseAgentError(err: unknown): never {
  if (err instanceof EnterpriseAgentError) {
    const codeMap: Record<EnterpriseAgentError["code"], TRPCError["code"]> = {
      AGENT_NOT_FOUND: "NOT_FOUND",
      AGENT_NOT_ACTIVE: "CONFLICT",
      TRIAL_EXPIRED: "FORBIDDEN",
      QUOTA_EXHAUSTED: "TOO_MANY_REQUESTS",
      DATABASE_UNAVAILABLE: "INTERNAL_SERVER_ERROR",
      MISSING_GEMINI_API_KEY: "INTERNAL_SERVER_ERROR",
      GEMINI_API_ERROR: "BAD_GATEWAY",
      GEMINI_EMPTY_RESPONSE: "BAD_GATEWAY",
    };
    throw new TRPCError({
      code: codeMap[err.code],
      message: err.message,
      cause: err,
    });
  }
  if (err instanceof TRPCError) throw err;
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: err instanceof Error ? err.message : String(err),
    cause: err,
  });
}

// ─── 帮助函数 ─────────────────────────────────────────────────────────────

async function db() {
  const d = await getDb();
  if (!d) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "数据库不可用",
    });
  }
  return d;
}

/** 拿 agent 并校验 owner（admin 可绕过）；agent 不存在抛 NOT_FOUND */
async function loadAgentEnsureOwnerOrAdmin(input: {
  agentId: number;
  userId: number;
  isAdmin: boolean;
}) {
  const d = await db();
  const rows = await d
    .select()
    .from(enterpriseAgents)
    .where(eq(enterpriseAgents.id, input.agentId))
    .limit(1);
  const agent = rows[0];
  if (!agent) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `agent ${input.agentId} 不存在`,
    });
  }
  if (agent.userId !== input.userId && !input.isAdmin) {
    throw new TRPCError({ code: "FORBIDDEN", message: "无权操作该 agent" });
  }
  return agent;
}

export function isAdminUser(role: string | null | undefined): boolean {
  return role === "admin" || role === "supervisor";
}

// ─── Router ───────────────────────────────────────────────────────────────

export const enterpriseAgentsRouter = router({
  // ═════════════════════════════════════════════════════════════════════
  // 1. list — 列出当前用户的 agents（不含 deleted）
  // ═════════════════════════════════════════════════════════════════════
  list: protectedProcedure
    .input(
      z
        .object({
          includeDeleted: z.boolean().default(false),
        })
        .default({ includeDeleted: false }),
    )
    .query(async ({ ctx, input }) => {
      const d = await db();
      const rows = await d
        .select()
        .from(enterpriseAgents)
        .where(eq(enterpriseAgents.userId, ctx.user!.id))
        .orderBy(desc(enterpriseAgents.createdAt));

      const filtered = input.includeDeleted
        ? rows
        : rows.filter((a) => a.status !== "deleted");

      return {
        agents: filtered.map((a) => ({
          id: a.id,
          agentName: a.agentName,
          organizationName: a.organizationName,
          tier: a.tier,
          status: a.status,
          trialUntil: a.trialUntil?.toISOString() ?? null,
          knowledgeBaseUsedMb: a.knowledgeBaseUsedMb,
          knowledgeBaseQuotaMb: a.knowledgeBaseQuotaMb,
          callsThisPeriod: a.callsThisPeriod,
          callsQuotaPeriod: a.callsQuotaPeriod,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
        })),
      };
    }),

  // ═════════════════════════════════════════════════════════════════════
  // 2. get — 单个 agent 详情 + 最近 KB 列表 + 最近 10 次 sessions
  // ═════════════════════════════════════════════════════════════════════
  get: protectedProcedure
    .input(z.object({ agentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const agent = await loadAgentEnsureOwnerOrAdmin({
        agentId: input.agentId,
        userId: ctx.user!.id,
        isAdmin: isAdminUser(ctx.user!.role),
      });

      const d = await db();
      const [kbRows, sessionRows] = await Promise.all([
        d
          .select({
            id: enterpriseAgentKnowledgeBase.id,
            filename: enterpriseAgentKnowledgeBase.filename,
            gcsKey: enterpriseAgentKnowledgeBase.gcsKey,
            fileSizeBytes: enterpriseAgentKnowledgeBase.fileSizeBytes,
            contentTextHash: enterpriseAgentKnowledgeBase.contentTextHash,
            extractedTextPreview:
              enterpriseAgentKnowledgeBase.extractedTextPreview,
            uploadedAt: enterpriseAgentKnowledgeBase.uploadedAt,
          })
          .from(enterpriseAgentKnowledgeBase)
          .where(eq(enterpriseAgentKnowledgeBase.agentId, agent.id))
          .orderBy(desc(enterpriseAgentKnowledgeBase.uploadedAt)),
          d
          .select({
            id: enterpriseAgentSessions.id,
            userQuery: enterpriseAgentSessions.userQuery,
            responseMarkdown: enterpriseAgentSessions.responseMarkdown,
            durationMs: enterpriseAgentSessions.durationMs,
            promptTokens: enterpriseAgentSessions.promptTokens,
            outputTokens: enterpriseAgentSessions.outputTokens,
            modelUsed: enterpriseAgentSessions.modelUsed,
            createdAt: enterpriseAgentSessions.createdAt,
          })
          .from(enterpriseAgentSessions)
          .where(eq(enterpriseAgentSessions.agentId, agent.id))
          .orderBy(desc(enterpriseAgentSessions.createdAt))
          .limit(10),
      ]);

      return {
        agent: {
          ...agent,
          trialUntil: agent.trialUntil?.toISOString() ?? null,
          quotaPeriodStart: agent.quotaPeriodStart.toISOString(),
          createdAt: agent.createdAt.toISOString(),
          updatedAt: agent.updatedAt.toISOString(),
        },
        knowledge: kbRows.map((r) => ({
          ...r,
          uploadedAt: r.uploadedAt.toISOString(),
        })),
        recentSessions: sessionRows.map((r) => ({
          ...r,
          createdAt: r.createdAt.toISOString(),
        })),
      };
    }),

  // ═════════════════════════════════════════════════════════════════════
  // 3. createAgent — 部署一个新 agent（默认 trial）
  // ═════════════════════════════════════════════════════════════════════
  createAgent: protectedProcedure
    .input(
      z.object({
        agentName: z
          .string()
          .min(2, "agent 名称至少 2 字")
          .max(100, "agent 名称最多 100 字"),
        organizationName: z.string().max(200).optional(),
        systemCommand: z
          .string()
          .min(50, "灵魂指令至少 50 字（描述清楚 agent 的角色 / 任务 / 输出风格）")
          .max(20_000, "灵魂指令最多 20000 字"),
        tier: z.enum(["trial", "pro"]).default("trial"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 部署窗口禁新部署 — agent-dev.md L281 硬约束
      await assertMaintenanceOff("企业Agent部署");

      // Trial / Pro 权限判断
      if (!isAdminUser(ctx.user!.role)) {
        if (input.tier === "pro") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Pro 档需联系商务对接，无法在自助界面创建",
          });
        }
        
        // Trial 档位限制：必须在管理后台标记已支付
        const d = await db();
        const userRows = await d.select({ enterpriseTrialPaid: users.enterpriseTrialPaid }).from(users).where(eq(users.id, ctx.user!.id)).limit(1);
        if (!userRows[0]?.enterpriseTrialPaid) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "您还未开通企业智能体试用。请进行对公转账或联系客户经理后，由后台为您开通权限。",
          });
        }
      }

      try {
        const agent = await svcCreateAgent({
          userId: ctx.user!.id,
          agentName: input.agentName,
          organizationName: input.organizationName,
          systemCommand: input.systemCommand,
          tier: input.tier,
        });
        return {
          agent: {
            ...agent,
            trialUntil: agent.trialUntil?.toISOString() ?? null,
            quotaPeriodStart: agent.quotaPeriodStart.toISOString(),
            createdAt: agent.createdAt.toISOString(),
            updatedAt: agent.updatedAt.toISOString(),
          },
          notice:
            input.tier === "trial"
              ? `企业Agent试用已开通：30 天 / 100 次调用 / 50 MB 知识库（试用费 ¥${TRIAL_PRICE_CNY.toLocaleString()}）`
              : "企业Agent Pro 已开通",
        };
      } catch (err) {
        // duplicate agentName per user 走 UNIQUE 索引会抛 db error
        const msg = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate/i.test(msg) && /agent_name|user_name_uniq/i.test(msg)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: `已存在同名 agent "${input.agentName}"，请改名后再试`,
            cause: err,
          });
        }
        mapEnterpriseAgentError(err);
      }
    }),

  // ═════════════════════════════════════════════════════════════════════
  // 4. executeQuery — 客户端跑一次推演（核心调用入口）
  // ═════════════════════════════════════════════════════════════════════
  executeQuery: protectedProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        userQuery: z
          .string()
          .min(1, "请输入提问")
          .max(10_000, "单次提问最多 10000 字"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // 部署窗口禁新调用（防 SIGTERM 烧 token）
      await assertMaintenanceOff("企业Agent调用");

      // owner only — admin 也不能代客调用（避免 audit 混乱）
      const agent = await loadAgentEnsureOwnerOrAdmin({
        agentId: input.agentId,
        userId: ctx.user!.id,
        isAdmin: false, // 强制不让 admin 代客
      });

      let result: Awaited<ReturnType<typeof svcExecuteAgentQuery>>;
      try {
        result = await svcExecuteAgentQuery({
          agentId: agent.id,
          userQuery: input.userQuery,
        });
      } catch (err) {
        mapEnterpriseAgentError(err);
      }

      // 写 userCreations 让客户在「我的作品」里看到（agent-dev.md L282 硬约束）
      // 失败不影响主流程（best-effort，仅 warn）
      void recordCreation({
        userId: ctx.user!.id,
        // type 在 creations.ts 已加 enterprise_agent_session（PR-3 同步扩展）
        type: "enterprise_agent_session",
        title: input.userQuery.slice(0, 120),
        outputUrl: undefined,
        thumbnailUrl: undefined,
        metadata: {
          agentId: agent.id,
          agentName: agent.agentName,
          sessionId: result.sessionId,
          modelUsed: ENTERPRISE_AGENT_GEMINI_MODEL,
          promptTokens: result.promptTokens,
          outputTokens: result.outputTokens,
          durationMs: result.durationMs,
          markdown: result.markdown,
        },
        creditsUsed: 0,
        status: "completed",
      }).catch((err) =>
        console.warn(
          `[enterpriseAgents] recordCreation failed for sessionId=${result.sessionId}: ${(err as Error)?.message}`,
        ),
      );

      return {
        sessionId: result.sessionId,
        markdown: result.markdown,
        promptTokens: result.promptTokens,
        outputTokens: result.outputTokens,
        durationMs: result.durationMs,
        modelUsed: ENTERPRISE_AGENT_GEMINI_MODEL,
      };
    }),

  // ═════════════════════════════════════════════════════════════════════
  // 5. expireAgent — 主动停用（owner 或 admin）
  // ═════════════════════════════════════════════════════════════════════
  expireAgent: protectedProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        reason: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await loadAgentEnsureOwnerOrAdmin({
        agentId: input.agentId,
        userId: ctx.user!.id,
        isAdmin: isAdminUser(ctx.user!.role),
      });

      try {
        return await svcExpireAgent({
          agentId: input.agentId,
          reason: input.reason,
        });
      } catch (err) {
        mapEnterpriseAgentError(err);
      }
    }),

  // ═════════════════════════════════════════════════════════════════════
  // 6. softDeleteAgent — 用户主动删除（KB 文件 90 天后由 admin 清理）
  // ═════════════════════════════════════════════════════════════════════
  softDeleteAgent: protectedProcedure
    .input(z.object({ agentId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const isAdmin = isAdminUser(ctx.user!.role);
      await loadAgentEnsureOwnerOrAdmin({
        agentId: input.agentId,
        userId: ctx.user!.id,
        isAdmin,
      });

      try {
        return await svcSoftDeleteAgent({
          agentId: input.agentId,
          by: isAdmin ? "admin" : "user",
        });
      } catch (err) {
        mapEnterpriseAgentError(err);
      }
    }),

  // ═════════════════════════════════════════════════════════════════════
  // 7. listKnowledge — 列 agent 的知识库（含 preview，不含完整文本）
  // ═════════════════════════════════════════════════════════════════════
  listKnowledge: protectedProcedure
    .input(z.object({ agentId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const agent = await loadAgentEnsureOwnerOrAdmin({
        agentId: input.agentId,
        userId: ctx.user!.id,
        isAdmin: isAdminUser(ctx.user!.role),
      });

      const d = await db();
      const rows = await d
        .select({
          id: enterpriseAgentKnowledgeBase.id,
          filename: enterpriseAgentKnowledgeBase.filename,
          gcsKey: enterpriseAgentKnowledgeBase.gcsKey,
          fileSizeBytes: enterpriseAgentKnowledgeBase.fileSizeBytes,
          contentTextHash: enterpriseAgentKnowledgeBase.contentTextHash,
          extractedTextPreview:
            enterpriseAgentKnowledgeBase.extractedTextPreview,
          uploadedAt: enterpriseAgentKnowledgeBase.uploadedAt,
        })
        .from(enterpriseAgentKnowledgeBase)
        .where(eq(enterpriseAgentKnowledgeBase.agentId, agent.id))
        .orderBy(desc(enterpriseAgentKnowledgeBase.uploadedAt));

      return {
        knowledge: rows.map((r) => ({
          ...r,
          uploadedAt: r.uploadedAt.toISOString(),
        })),
        usedMb: agent.knowledgeBaseUsedMb,
        quotaMb: agent.knowledgeBaseQuotaMb,
      };
    }),

  // ═════════════════════════════════════════════════════════════════════
  // 8. deleteKnowledge — 删 agent 的某个 KB 文件（DB + GCS）
  // ═════════════════════════════════════════════════════════════════════
  deleteKnowledge: protectedProcedure
    .input(
      z.object({
        agentId: z.number().int().positive(),
        kbId: z.number().int().positive(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const agent = await loadAgentEnsureOwnerOrAdmin({
        agentId: input.agentId,
        userId: ctx.user!.id,
        isAdmin: isAdminUser(ctx.user!.role),
      });

      const d = await db();
      // 拿 gcsKey + fileSize，删表前先记下来用于配额回退 + GCS 清理
      const rows = await d
        .select({
          id: enterpriseAgentKnowledgeBase.id,
          gcsKey: enterpriseAgentKnowledgeBase.gcsKey,
          fileSizeBytes: enterpriseAgentKnowledgeBase.fileSizeBytes,
          filename: enterpriseAgentKnowledgeBase.filename,
        })
        .from(enterpriseAgentKnowledgeBase)
        .where(
          and(
            eq(enterpriseAgentKnowledgeBase.id, input.kbId),
            eq(enterpriseAgentKnowledgeBase.agentId, agent.id),
          ),
        )
        .limit(1);

      const kb = rows[0];
      if (!kb) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `知识库文件 ${input.kbId} 不存在或不属于该 agent`,
        });
      }

      // 删 DB 行
      await d
        .delete(enterpriseAgentKnowledgeBase)
        .where(eq(enterpriseAgentKnowledgeBase.id, kb.id));

      // 回退配额 — 注意 ceil 一致（避免上传 4.2MB 算 5MB / 删除时算回 4MB 漂移）
      const reclaimMb = Math.ceil(kb.fileSizeBytes / 1_048_576);
      await d
        .update(enterpriseAgents)
        .set({
          knowledgeBaseUsedMb: Math.max(0, agent.knowledgeBaseUsedMb - reclaimMb),
          updatedAt: new Date(),
        })
        .where(eq(enterpriseAgents.id, agent.id));

      // 清 GCS 对象（best-effort，失败仅 warn — DB 已落是真理）
      // gcsKey 格式 "${bucket}/${objectName}"，第一个 / 之前是 bucket
      const slashIdx = kb.gcsKey.indexOf("/");
      if (slashIdx > 0) {
        const bucket = kb.gcsKey.slice(0, slashIdx);
        const objectName = kb.gcsKey.slice(slashIdx + 1);
        deleteGcsObject({ bucket, objectName }).catch((err) =>
          console.warn(
            `[enterpriseAgents] deleteKnowledge: GCS object cleanup failed (gcsKey=${kb.gcsKey}): ${(err as Error)?.message}`,
          ),
        );
      }

      console.log(
        `[enterpriseAgents] 🗑 deleteKnowledge agentId=${agent.id} kbId=${kb.id} ` +
          `${kb.filename} (${kb.fileSizeBytes}B → ${reclaimMb}MB reclaimed)`,
      );

      return {
        ok: true,
        deletedKbId: kb.id,
        reclaimedMb: reclaimMb,
      };
    }),

  // ═════════════════════════════════════════════════════════════════════
  // 9. admin sub-router — admin 后台用（PR-4 准备）
  // ═════════════════════════════════════════════════════════════════════
  admin: router({
    /** 标记用户已线下支付 15k 试用费（方案一） */
    markTrialPaid: adminProcedure
      .input(z.object({ userId: z.number().int().positive() }))
      .mutation(async ({ input }) => {
        const d = await db();
        await d
          .update(users)
          .set({ enterpriseTrialPaid: true })
          .where(eq(users.id, input.userId));
        return { ok: true, message: `User ${input.userId} marked as enterprise_trial_paid` };
      }),

    /** 列出所有 agents（不论 owner / 状态），供 admin 监控 / 审计 */
    listAll: adminProcedure
      .input(
        z
          .object({
            includeDeleted: z.boolean().default(false),
            status: z.enum(["active", "expired", "deleted"]).optional(),
            limit: z.number().min(1).max(500).default(100),
          })
          .default({ includeDeleted: false, limit: 100 }),
      )
      .query(async ({ input }) => {
        const d = await db();
        const all = await d
          .select()
          .from(enterpriseAgents)
          .orderBy(desc(enterpriseAgents.createdAt))
          .limit(input.limit);

        const filtered = all.filter((a) => {
          if (input.status && a.status !== input.status) return false;
          if (!input.includeDeleted && a.status === "deleted") return false;
          return true;
        });

        return {
          agents: filtered.map((a) => ({
            ...a,
            trialUntil: a.trialUntil?.toISOString() ?? null,
            quotaPeriodStart: a.quotaPeriodStart.toISOString(),
            createdAt: a.createdAt.toISOString(),
            updatedAt: a.updatedAt.toISOString(),
          })),
          total: filtered.length,
        };
      }),
  }),
});
