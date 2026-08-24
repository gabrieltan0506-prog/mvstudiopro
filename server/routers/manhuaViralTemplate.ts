/**
 * 漫剧节奏模板：动态提案 / 批准进库 / 合并列表（GCS ∪ 种子库）。
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import {
  resolvePlatformSupervisorOpsAllowed,
  resolveSiteOwnerOnlyAllowed,
} from "../services/access-policy";
import { describeManhuaTemplateLearnSourceZh } from "../../shared/manhuaViralTemplateBank";

function assertSupervisorOps(
  user: { id?: number | null; role?: string | null },
  supervisorSession?: { userId: number; expiresAt: number } | null,
) {
  if (!resolvePlatformSupervisorOpsAllowed(user, supervisorSession)) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "需要监管权限",
    });
  }
}

function assertSiteOwner(user: { openId?: string | null }) {
  if (!resolveSiteOwnerOnlyAllowed(user)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅站点拥有者可操作模板优化" });
  }
}

export const manhuaViralTemplateRouter = router({
  /** 仅返回能力布尔值；不向非 owner 暴露模型清单或任何模板正文。 */
  getOwnerOptimizeCapabilities: protectedProcedure.query(async ({ ctx }) => {
    const allowed = resolveSiteOwnerOnlyAllowed(ctx.user);
    if (!allowed) return { allowed: false as const, models: [] };
    const { MANHUA_VIRAL_TEMPLATE_OPTIMIZE_MODELS } = await import(
      "../services/manhuaViralTemplateOptimize"
    );
    return {
      allowed: true as const,
      models: MANHUA_VIRAL_TEMPLATE_OPTIMIZE_MODELS.map((model) => ({
        id: model.id,
        labelZh: model.labelZh,
        reasoningEffort: model.reasoningEffort,
      })),
    };
  }),

  /**
   * 编剧室 / 已登录（公开面）：只下发匿名功能卡（fail-closed 白名单 DTO，见
   * toPublicManhuaViralTemplateCard）。商业机密边界（2026-08-15 用户拍板）：内部 id/真名/
   * 来源/学习出处/节拍与场景自由文本一概不出服务端；存量公开码优先，无码卡仅在配置
   * HMAC 专用密钥后生成不可反查的稳定句柄，否则隐藏并告警。
   */
  listApprovedPublic: protectedProcedure.query(async () => {
    try {
      const [
        { listMergedApprovedManhuaViralTemplatesGrouped },
        { MANHUA_VIRAL_TEMPLATE_COPY },
        { resolveStableManhuaTemplatePublicCode },
        bank,
      ] =
        await Promise.all([
          import("../services/manhuaViralTemplateStore"),
          import("../services/manhuaViralTemplateCopy"),
          import("../services/manhuaTemplatePublicId"),
          import("../../shared/manhuaViralTemplateBank"),
        ]);
      const groups = await listMergedApprovedManhuaViralTemplatesGrouped();
      return {
        groups: groups
          .map((g) => ({
            laneZh: g.laneZh,
            items: g.items
              .map((c) => {
                const publicCode = resolveStableManhuaTemplatePublicCode(c);
                const pub = publicCode
                  ? bank.toPublicManhuaViralTemplateCard(
                      { ...c, publicCode },
                      MANHUA_VIRAL_TEMPLATE_COPY[c.id],
                    )
                  : null;
                if (!pub) {
                  console.warn("[listApprovedPublic] card missing publicCode, hidden:", c.id);
                }
                return pub;
              })
              .filter((x): x is NonNullable<typeof x> => Boolean(x)),
          }))
          .filter((g) => g.items.length > 0),
      };
    } catch (e) {
      console.warn(
        "[manhuaViralTemplate.listApprovedPublic] gcs failed, return empty:",
        e instanceof Error ? e.message : e,
      );
      return { groups: [] };
    }
  }),

  /** owner 全量（真名/来源/出处可见；其他监管角色也不可读取） */
  listApprovedPrivate: protectedProcedure
    .query(async ({ ctx }) => {
      assertSiteOwner(ctx.user);
      try {
        const { listMergedApprovedManhuaViralTemplatesGrouped } = await import(
          "../services/manhuaViralTemplateStore"
        );
        return { groups: await listMergedApprovedManhuaViralTemplatesGrouped() };
      } catch (e) {
        console.warn(
          "[manhuaViralTemplate.listApprovedPrivate] gcs failed, return empty:",
          e instanceof Error ? e.message : e,
        );
        return { groups: [] };
      }
    }),

  /** owner 查看单张正式模板；从 GCS approved/ 即时读取，不信任客户端列表缓存。 */
  getApprovedOwnerDetail: protectedProcedure
    .input(z.object({ id: z.string().regex(/^tpl_[a-z0-9_-]{1,60}$/i) }))
    .query(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const { getGcsManhuaViralApproved } = await import("../services/manhuaViralTemplateStore");
      const card = await getGcsManhuaViralApproved(input.id);
      if (!card || card.status !== "approved") {
        throw new TRPCError({ code: "NOT_FOUND", message: "正式模板不存在" });
      }
      return { card };
    }),

  /** owner 明确点击后调用一次模型；成功结果只落 proposals/，不覆盖正式模板。 */
  optimizeApproved: protectedProcedure
    .input(z.object({
      id: z.string().regex(/^tpl_[a-z0-9_-]{1,60}$/i),
      model: z.enum([
        "terra_high",
        "kimi_k3_max",
        "claude_opus_5_high",
        "deepseek_v4_0813_high",
      ]),
      promptZh: z.string().trim().min(2).max(2_000),
      requestId: z.string().regex(/^[a-zA-Z0-9_-]{8,80}$/),
      confirmPaidCall: z.literal(true),
    }))
    .mutation(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      try {
        const [store, optimizer] = await Promise.all([
          import("../services/manhuaViralTemplateStore"),
          import("../services/manhuaViralTemplateOptimize"),
        ]);
        const original = await store.getGcsManhuaViralApproved(input.id);
        if (!original || original.status !== "approved") {
          throw new TRPCError({ code: "NOT_FOUND", message: "正式模板不存在" });
        }
        const optimized = await optimizer.optimizeApprovedManhuaViralTemplate({
          card: original,
          model: input.model,
          promptZh: input.promptZh,
          requestId: input.requestId,
          userId: ctx.user.id,
          abortSignal: ctx.clientDisconnected,
        });
        const proposal = await store.saveManhuaViralTemplateRevisionProposal(optimized.proposal);
        return {
          ok: true as const,
          original: optimized.original,
          proposal,
          changedFields: optimized.changedFields,
          reasons: optimized.reasons,
        };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        const message = e instanceof Error ? e.message : String(e);
        console.warn("[manhuaViralTemplate.optimizeApproved] failed:", message.slice(0, 500));
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: message.slice(0, 200) || "模板优化失败，未生成待审修订",
        });
      }
    }),

  /** 监管：待审提案（GCS proposals，含已批准副本） */
  listProposals: protectedProcedure
    .query(async ({ ctx }) => {
      const ownerAllowed = resolveSiteOwnerOnlyAllowed(ctx.user);
      if (!ownerAllowed) assertSupervisorOps(ctx.user, ctx.supervisorSession);
      const { listGcsManhuaViralProposals } = await import("../services/manhuaViralTemplateStore");
      const items = (await listGcsManhuaViralProposals()).filter(
        (card) => !card.revision || ownerAllowed,
      );
      return {
        items: items.map((c) => ({
          id: c.id,
          nameZh: c.nameZh,
          laneZh: c.laneZh,
          summaryZh: c.summaryZh,
          hook3sZh: c.hook3sZh,
          status: c.status,
          updatedAt: c.updatedAt,
          revisionOf: c.revision?.parentTemplateId,
          changedFields: c.revision?.changedFields,
          reasons: c.revision?.reasons,
          // 审批可见性：批准前必须看得见学到了什么，不能盲批。
          // 这几项一直落盘，此前被这个白名单 map 过滤掉，前端连数据都收不到。
          beatGrid: c.beatGrid,
          // 原生视频精读独有的两栏：审批前必须看得见，否则最有门槛的产出被白名单挡在外面
          reusableZh: c.reusableZh,
          genPromptHintZh: c.genPromptHintZh,
          scenePoolHints: c.scenePoolHints,
          castShape: c.castShape,
          densityHints: c.densityHints,
          // 列表只展示来源数量，不下发来源 URL：listProposals 对 admin/supervisor
          // 也开放，下发完整 sourceRefs 会扩大来源地址的暴露面。
          sourceRefCount: c.sourceRefs.length,
          // 学习来源摘要：卡落库了却不下发，审批人分辨不出精读卡与抽帧卡，
          // 也看不见静默丢镜/触顶抽稀 —— 等于没落库。只给摘要，不给成本与地址。
          learnSourceZh: describeManhuaTemplateLearnSourceZh(c.provenance),
        })),
      };
    }),

  /**
   * 列出某张模板的历史归档版本。
   *
   * 归档一直在写却没有读取入口 —— 下架之后就再也看不到、回不去了。
   * 学习方式升级后这条尤其要紧：新方法重学一版替掉旧的，
   * 万一新版不如旧版，得能翻回去比。
   */
  listArchivedVersions: protectedProcedure
    .input(z.object({ id: z.string().regex(/^tpl_[a-z0-9_-]{1,60}$/i) }))
    .query(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const { listArchivedManhuaViralTemplateVersions } = await import(
        "../services/manhuaViralTemplateStore"
      );
      const rows = await listArchivedManhuaViralTemplateVersions(input.id);
      return {
        items: rows.map((r) => ({
          generation: r.generation,
          nameZh: r.card.nameZh,
          laneZh: r.card.laneZh,
          summaryZh: r.card.summaryZh,
          beatCount: r.card.beatGrid.length,
          updatedAt: r.card.updatedAt,
          learnSourceZh: describeManhuaTemplateLearnSourceZh(r.card.provenance),
        })),
      };
    }),

  /** owner：把某个归档版本恢复成正式模板（同 id 已有现役版本时拒绝，不覆盖） */
  restoreArchived: protectedProcedure
    .input(
      z.object({
        id: z.string().regex(/^tpl_[a-z0-9_-]{1,60}$/i),
        generation: z.string().min(1).max(40),
        confirmRestore: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const { restoreArchivedManhuaViralTemplate } = await import(
        "../services/manhuaViralTemplateStore"
      );
      const card = await restoreArchivedManhuaViralTemplate({
        id: input.id,
        generation: input.generation,
      });
      return { ok: true as const, id: card.id, nameZh: card.nameZh };
    }),

  /**
   * 换代体检：库里哪些还是旧一代学法学的、有没有新卡可以顶上。
   * **只给建议不自动执行** —— 淘汰是不可逆的业务判断，不替 owner 拍板。
   */
  reviewTemplateGenerations: protectedProcedure.query(async ({ ctx }) => {
    assertSiteOwner(ctx.user);
    const { listGcsManhuaViralApproved, listGcsManhuaViralProposals } = await import(
      "../services/manhuaViralTemplateStore"
    );
    const { adviseTemplateRetirement } = await import("../../shared/manhuaTemplateLifecycle");
    const approved = await listGcsManhuaViralApproved();
    // 候选包含待审：新学的精读卡通常还在 proposals/ 里等批
    const candidates = [...approved, ...(await listGcsManhuaViralProposals())];
    const laneCount = new Map<string, number>();
    for (const c of approved) laneCount.set(c.laneZh, (laneCount.get(c.laneZh) || 0) + 1);
    return {
      items: approved.map((card) => ({
        id: card.id,
        nameZh: card.nameZh,
        laneZh: card.laneZh,
        beatCount: card.beatGrid.length,
        sameLaneApprovedCount: laneCount.get(card.laneZh) || 0,
        ...adviseTemplateRetirement(card, candidates),
      })),
    };
  }),

  /**
   * owner：下架正式模板（归档，非物理删除）。
   * 用于「新精读模板淘汰旧抽帧模板」——淘汰不等于销毁，归档件仍可查可恢复。
   */
  archiveApproved: protectedProcedure
    .input(
      z.object({
        id: z.string().regex(/^tpl_[a-z0-9_-]{1,60}$/i),
        /** 须为 true，表示用户明文确认下架 */
        confirmArchive: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const { archiveApprovedManhuaViralTemplate, listGcsManhuaViralApproved } = await import(
        "../services/manhuaViralTemplateStore"
      );
      const { canRetireTemplate } = await import("../../shared/manhuaTemplateLifecycle");
      // 同赛道最后一张不许下架：下完这条赛道编剧室就选不出模板了
      const approved = await listGcsManhuaViralApproved();
      const target = approved.find((c) => c.id === input.id);
      if (target) {
        const gate = canRetireTemplate({
          card: target,
          sameLaneApprovedCount: approved.filter((c) => c.laneZh === target.laneZh).length,
        });
        if (!gate.ok) throw new TRPCError({ code: "BAD_REQUEST", message: gate.reasonZh });
      }
      const archived = await archiveApprovedManhuaViralTemplate(input.id);
      return { ok: true as const, id: archived.id, nameZh: archived.nameZh };
    }),

  /** 监管：明文批准进库 → GCS approved（不改 TypeScript 种子数组） */
  approve: protectedProcedure
    .input(
      z.object({
        id: z.string().max(64).optional(),
        card: z.record(z.string(), z.any()).optional(),
        /** 须为 true，表示用户明文确认批准 */
        confirmApprove: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const ownerAllowed = resolveSiteOwnerOnlyAllowed(ctx.user);
      if (!ownerAllowed) assertSupervisorOps(ctx.user, ctx.supervisorSession);
      if (!input.id && !input.card) {
        throw new TRPCError({ code: "BAD_REQUEST", message: "请提供提案 id 或完整卡片" });
      }
      try {
        const { approveManhuaViralTemplate, getGcsManhuaViralProposal } = await import(
          "../services/manhuaViralTemplateStore"
        );
        // 兼容旧 card 入口，但鉴权与存储都只归一到落盘提案 id；不能让旧按钮绕过修订 owner 门。
        const requestedId = String(input.id || input.card?.id || "").trim();
        // 优化器生成的修订 id 固定以 tpl_revision_ 开头。先按 id fail-closed，避免首次 GCS
        // 读取瞬时失败、随后存储层重读成功时，非 owner 越过修订替换权限。
        if (/^tpl_revision_/i.test(requestedId)) assertSiteOwner(ctx.user);
        const proposal = requestedId ? await getGcsManhuaViralProposal(requestedId) : null;
        if (proposal?.revision) assertSiteOwner(ctx.user);
        const card = await approveManhuaViralTemplate({
          id: input.id,
          card: input.card,
        });
        return { ok: true as const, card };
      } catch (e) {
        if (e instanceof TRPCError) throw e;
        const msg = e instanceof Error ? e.message : String(e);
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: msg.slice(0, 200) || "批准失败",
        });
      }
    }),

  /** 调试用：仅站点 owner 可读 GCS approved 原始列表 */
  listApprovedGcsOnly: protectedProcedure.query(async ({ ctx }) => {
    assertSiteOwner(ctx.user);
    const { listGcsManhuaViralApproved } = await import("../services/manhuaViralTemplateStore");
    return { items: await listGcsManhuaViralApproved() };
  }),

  /** 监管：查看合集学习进度与分集摘要（网页即时展示） */
  getSeriesLearnSnapshot: protectedProcedure
    .input(
      z.object({
        seriesKey: z.string().min(4).max(64),
      }),
    )
    .query(async ({ ctx, input }) => {
      assertSupervisorOps(ctx.user, ctx.supervisorSession);
      const { getManhuaSeriesLearnSnapshot } = await import(
        "../services/manhuaTemplateLearnService"
      );
      return getManhuaSeriesLearnSnapshot(input.seriesKey);
    }),
});
