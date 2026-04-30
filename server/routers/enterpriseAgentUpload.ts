/**
 * 企业专属智能体（AaaS）— 知识库文档上传 Express 路由
 *
 * 为什么走 Express 而不是 tRPC：
 *   - tRPC 输入是 JSON，不能直接接 multipart/form-data
 *   - 仓库已有 multer 用法（server/routers/speechApi.ts），跟随同模式保持一致
 *   - agent-dev.md 第 6 行硬约束："复用 server/services/gcs.ts 上传管线"
 *
 * 端点：
 *   POST /api/enterprise-agent/:agentId/kb-upload
 *   Content-Type: multipart/form-data
 *   field: "file" — 单文件，TXT / PDF / DOCX，≤ 5 MB
 *
 * 鉴权：
 *   - cookie session（sdk.authenticateRequest）
 *   - agent.userId === currentUser.id（owner only — admin 不代客上传）
 *   - agent.status === 'active'（expired / deleted 的 agent 拒绝上传）
 *
 * 业务流程（按顺序，任何一步失败都要 abort 整个上传）：
 *   1. 鉴权 + 拿 agent
 *   2. assertMaintenanceOff（部署窗口禁新上传）
 *   3. multer 解析单文件 buffer
 *   4. parseKnowledgeFile 抽文本 + 校验大小 / mimeType / 文本最少 50 字
 *   5. 校验单 agent 总和配额（已用 MB + 新文件 MB ≤ 50 MB trial）
 *   6. uploadBufferToGcs（按 userId / agentId 隔离前缀）
 *   7. db.insert(enterprise_agent_kb)（contentTextHash UNIQUE 自动去重）
 *   8. db.update(enterprise_agents.knowledgeBaseUsedMb += 新文件 MB)
 *
 * 失败回滚策略：
 *   - 步骤 7 数据库 UNIQUE 冲突 → GCS 对象已上传成 orphan
 *     → catch 时调 deleteGcsObject 兜底清理（best-effort，失败仅 warn）
 *   - 步骤 8 失败概率极小（同一事务内只 update 1 列），不做特殊兜底
 */

import type { Express, Request, Response } from "express";
import multer from "multer";
import { customAlphabet } from "nanoid";
import { TRPCError } from "@trpc/server";
import { eq, sql } from "drizzle-orm";
import { sdk } from "../_core/sdk";
import { getDb } from "../db";
import {
  enterpriseAgents,
  enterpriseAgentKnowledgeBase,
} from "../../drizzle/schema";
import { assertMaintenanceOff } from "../services/maintenanceMode";
import {
  parseKnowledgeFile,
  KB_FILE_MAX_MB,
  KB_FILE_MAX_BYTES,
  KnowledgeBaseParserError,
  bytesToMbCeil,
} from "../services/knowledgeBaseParser";
import { uploadBufferToGcs, deleteGcsObject } from "../services/gcs";

// ─── multer 配置 ──────────────────────────────────────────────────────────

/** 内存存储（小文件 ≤ 5MB，不必 disk） + 单字段 + multer 自身大小硬上限 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: KB_FILE_MAX_BYTES,
    files: 1,
    fields: 4,
  },
});

// ─── GCS bucket / object 命名 ─────────────────────────────────────────────

/** GCS bucket 优先级：env 显式覆盖 > 已有 user upload 桶 > 已有 vertex 桶 */
export function getEnterpriseKbBucket(): string {
  return String(
    process.env.ENTERPRISE_KB_BUCKET ||
      process.env.GCS_USER_UPLOAD_BUCKET ||
      process.env.GCS_PDF_EXPORT_BUCKET ||
      process.env.VERTEX_GCS_BUCKET ||
      "mv-studio-pro-vertex-video-temp",
  ).trim();
}

/** 短随机 id 加在 GCS objectName 里，避免同名覆盖 + 提供 audit-friendly 显式 ID */
const nanoid8 = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 8);

/**
 * GCS objectName 命名（按 userId / agentId 隔离）。
 * 例：enterprise-agent/123/agents/45/a8f3k2b9-客户战败手册.pdf
 *
 * 防越权读取：bucket 内即使开放公共读，userId 和 agentId 也是路径硬隔离 —
 * 跨用户拿别人 KB 文件需要同时知道 userId + agentId + nanoid，安全冗余足够。
 */
export function buildKbObjectName(input: {
  userId: number;
  agentId: number;
  fileName: string;
}): string {
  // 文件名规范化：去掉路径片段、控制字符 / 空白；保留中英文 + 数字 + 横线下划线点
  const safeFilename = String(input.fileName || "kb")
    .replace(/^.*[\\/]/, "") // 去 path 段
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*\r\n\t]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 200) || "kb";
  return `enterprise-agent/${input.userId}/agents/${input.agentId}/${nanoid8()}-${safeFilename}`;
}

// ─── 主路由 ───────────────────────────────────────────────────────────────

export function registerEnterpriseAgentUploadRoutes(app: Express) {
  app.post(
    "/api/enterprise-agent/:agentId/kb-upload",
    upload.single("file"),
    async (req: Request, res: Response) => {
      // ── 1. 鉴权 + 拿 agent ─────────────────────────────────────────
      let user;
      try {
        user = await sdk.authenticateRequest(req as any);
      } catch {
        return res.status(401).json({ error: "未登录或 session 已失效" });
      }

      const agentId = Number(req.params.agentId);
      if (!Number.isInteger(agentId) || agentId <= 0) {
        return res.status(400).json({ error: "无效的 agentId" });
      }

      const db = await getDb();
      if (!db) {
        return res.status(503).json({ error: "数据库不可用" });
      }

      const agentRows = await db
        .select()
        .from(enterpriseAgents)
        .where(eq(enterpriseAgents.id, agentId))
        .limit(1);
      const agent = agentRows[0];

      if (!agent) {
        return res.status(404).json({ error: `agent ${agentId} 不存在` });
      }
      if (agent.userId !== user.id) {
        // owner only — admin 也不代客上传，避免误操作
        return res.status(403).json({ error: "无权操作该 agent" });
      }
      if (agent.status !== "active") {
        return res.status(409).json({
          error: `agent 当前状态为 ${agent.status}，无法上传知识库`,
        });
      }

      // ── 2. 维护模式闸门 ──────────────────────────────────────────
      try {
        await assertMaintenanceOff("企业Agent知识库上传");
      } catch (err) {
        if (err instanceof TRPCError && err.code === "SERVICE_UNAVAILABLE") {
          return res.status(503).json({ error: err.message });
        }
        throw err;
      }

      // ── 3. multer 已解析的 buffer ────────────────────────────────
      if (!req.file) {
        return res
          .status(400)
          .json({ error: "未收到文件（field 名应为 'file'）" });
      }
      const { buffer, originalname, mimetype } = req.file;

      // ── 4. 解析文本 + 校验 ───────────────────────────────────────
      let parsed: Awaited<ReturnType<typeof parseKnowledgeFile>>;
      try {
        parsed = await parseKnowledgeFile({
          buffer,
          mimeType: mimetype,
          fileName: originalname,
        });
      } catch (err) {
        if (err instanceof KnowledgeBaseParserError) {
          return res
            .status(err.code === "FILE_TOO_LARGE" ? 413 : 400)
            .json({ error: err.message, code: err.code, meta: err.meta });
        }
        console.error("[kb-upload] parseKnowledgeFile 异常:", err);
        return res.status(500).json({ error: "文件解析失败" });
      }

      // ── 5. 配额校验（单 agent 总和） ────────────────────────────
      const newFileMb = bytesToMbCeil(parsed.byteCount);
      const projectedUsedMb = agent.knowledgeBaseUsedMb + newFileMb;
      if (projectedUsedMb > agent.knowledgeBaseQuotaMb) {
        return res.status(409).json({
          error:
            `知识库容量超限（当前 ${agent.knowledgeBaseUsedMb} MB + 本次 ${newFileMb} MB = ` +
            `${projectedUsedMb} MB，超过配额 ${agent.knowledgeBaseQuotaMb} MB），` +
            `请先删除部分已上传文件再上传`,
          code: "KB_QUOTA_EXCEEDED",
        });
      }

      // ── 6. 上传到 GCS（先上传，DB 失败时兜底删除） ───────────────
      const bucket = getEnterpriseKbBucket();
      const objectName = buildKbObjectName({
        userId: user.id,
        agentId,
        fileName: originalname,
      });

      let gcsUri: string;
      try {
        const r = await uploadBufferToGcs({
          bucket,
          objectName,
          buffer,
          contentType: mimetype || "application/octet-stream",
        });
        gcsUri = r.gcsUri;
      } catch (err) {
        console.error("[kb-upload] GCS upload 失败:", err);
        return res
          .status(502)
          .json({ error: "对象存储不可用，请稍后重试" });
      }

      // ── 7. 写 DB（contentTextHash UNIQUE 自动去重） ──────────────
      let kbId: number;
      try {
        const [row] = await db
          .insert(enterpriseAgentKnowledgeBase)
          .values({
            agentId,
            filename: originalname.slice(0, 300),
            gcsKey: `${bucket}/${objectName}`.slice(0, 500),
            fileSizeBytes: parsed.byteCount,
            contentTextHash: parsed.sha256,
            extractedTextPreview: parsed.preview,
            extractedTextFull: parsed.text,
          })
          .returning({ id: enterpriseAgentKnowledgeBase.id });
        kbId = row?.id ?? 0;
      } catch (err) {
        // UNIQUE (agentId, contentTextHash) 冲突 = 用户上传过同样内容
        const errMsg = (err as Error)?.message ?? String(err);
        const isDuplicate =
          /unique|duplicate/i.test(errMsg) &&
          /contentTextHash|enterprise_agent_kb_agent_hash_uniq/i.test(errMsg);

        // 不管哪种 DB 错误都要清掉 GCS 对象，避免孤儿
        deleteGcsObject({ bucket, objectName }).catch((e) =>
          console.warn(
            `[kb-upload] orphan GCS object cleanup failed (objectName=${objectName}): ${(e as Error)?.message}`,
          ),
        );

        if (isDuplicate) {
          return res.status(409).json({
            error: "该 agent 已上传过相同内容的文档（按文本 hash 去重）",
            code: "KB_DUPLICATE_CONTENT",
          });
        }
        console.error("[kb-upload] DB insert 失败:", err);
        return res.status(500).json({ error: "知识库登记失败" });
      }

      // ── 8. 累加 agent.knowledgeBaseUsedMb（已上 GCS + DB，不可回滚） ──
      await db
        .update(enterpriseAgents)
        .set({
          knowledgeBaseUsedMb: sql`${enterpriseAgents.knowledgeBaseUsedMb} + ${newFileMb}`,
          updatedAt: new Date(),
        })
        .where(eq(enterpriseAgents.id, agentId));

      console.log(
        `[kb-upload] ✅ userId=${user.id} agentId=${agentId} kbId=${kbId} ` +
          `${originalname} ${parsed.byteCount}B → ${gcsUri} (${parsed.charCount} chars, ${parsed.method})`,
      );

      return res.status(200).json({
        kbId,
        gcsUri,
        bucket,
        objectName,
        filename: originalname,
        sizeBytes: parsed.byteCount,
        sizeMb: newFileMb,
        charCount: parsed.charCount,
        method: parsed.method,
        sha256: parsed.sha256,
        preview: parsed.preview,
        agentKbUsedMb: projectedUsedMb,
        agentKbQuotaMb: agent.knowledgeBaseQuotaMb,
      });
    },
  );
}
