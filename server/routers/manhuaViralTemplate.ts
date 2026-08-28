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

type NativeTemplateProgressSource = {
  attemptedSegments?: unknown;
  successSegments?: unknown;
  completedSegmentIndexes?: unknown;
  assemblyComplete?: unknown;
};

/**
 * 待审列表只需要显示“学到第几段”。原始 provenance 还含成本、来源指纹与
 * 快照摘要；这些都不该因为加一条进度文案而扩大到审批列表 DTO。
 */
function toSafeNativeTemplateProgress(
  source: NativeTemplateProgressSource | null | undefined,
) {
  if (!source) return undefined;
  const attemptedSegments = Math.max(0, Math.floor(Number(source.attemptedSegments) || 0));
  const reportedSuccess = Math.max(0, Math.floor(Number(source.successSegments) || 0));
  const completedSegmentIndexes = Array.isArray(source.completedSegmentIndexes)
    ? Array.from(new Set(source.completedSegmentIndexes
        .map((value) => Math.floor(Number(value)))
        .filter((value) => Number.isInteger(value) && value >= 0 && value < attemptedSegments)))
        .sort((a, b) => a - b)
    : [];
  const successSegments = Math.min(
    attemptedSegments,
    completedSegmentIndexes.length || reportedSuccess,
  );
  if (attemptedSegments <= 0 || successSegments <= 0) return undefined;
  const completed = new Set(
    completedSegmentIndexes.length
      ? completedSegmentIndexes
      : Array.from({ length: successSegments }, (_, index) => index),
  );
  const nextMissingZeroBased = Array.from(
    { length: attemptedSegments },
    (_, index) => index,
  ).find((index) => !completed.has(index));
  const assemblyComplete = source.assemblyComplete === true
    || successSegments >= attemptedSegments;
  return {
    successSegments,
    attemptedSegments,
    assemblyComplete,
    nextSegmentIndex: assemblyComplete || nextMissingZeroBased === undefined
      ? undefined
      : nextMissingZeroBased + 1,
  };
}

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
  getOwnerOptimizeCapabilities: protectedProcedure
    // cacheScope 只用于让客户端查询键随登录身份变化；授权仍且只信 ctx.user。
    .input(z.object({ cacheScope: z.string().min(1).max(128) }).optional())
    .query(async ({ ctx }) => {
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

  /**
   * owner 一键出模型产出报告 HTML（¥0 零模型调用）：证据 JSON 确定性渲染，回签名 URL。
   * 数据来源是 canonical 寻址：nativeDeepReadProposalId → proposals/（无则 approved/）卡
   * → provenance.nativeVideoDeepRead.segmentEvidenceObjectNames 精确对象名；
   * 卡不存在或没证据名一律 fail closed，绝不列目录猜证据。
   * seriesKey 契约与 nativeDeepReadProposalId 完全一致（1–40 位 [0-9A-Za-z_-]）。
   */
  renderEpisodeReport: protectedProcedure
    .input(z.object({
      seriesKey: z.string().regex(/^[0-9A-Za-z_-]{1,40}$/),
      episodeIndex: z.number().int().min(1).max(999),
    }))
    .mutation(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const [{ renderNativeEvidenceReportFromObjectNames }, { nativeDeepReadProposalId }, store] =
        await Promise.all([
          import("../services/manhuaNativeReportRender"),
          import("../services/manhuaNativeDeepReadIngest"),
          import("../services/manhuaViralTemplateStore"),
        ]);
      const cardKey = nativeDeepReadProposalId(input.seriesKey, input.episodeIndex);
      const card = (await store.getGcsManhuaViralProposal(cardKey))
        ?? (await store.getGcsManhuaViralApproved(cardKey));
      if (!card) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `该集精读卡不存在（${cardKey}），无法出报告`,
        });
      }
      const native = card.provenance?.nativeVideoDeepRead;
      const evidenceObjectNames = Array.isArray(native?.segmentEvidenceObjectNames)
        ? native.segmentEvidenceObjectNames
        : [];
      if (evidenceObjectNames.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "该集精读卡 provenance 没有段证据对象名（旧链路学习产物），需重学后再出报告",
        });
      }
      try {
        return await renderNativeEvidenceReportFromObjectNames({
          labelZh: `${input.seriesKey} 第 ${input.episodeIndex} 集`,
          evidenceObjectNames,
          expectEpisodeIndex: input.episodeIndex,
          framesV2SummaryObjectName: `manhua-template-learn/probes/${cardKey}/frames-v2-summary.json`,
          framesPrefix: `manhua-template-learn/probes/${cardKey}/frames/`,
          reportObjectName: `manhua-template-learn/reports/${cardKey}.html`,
        });
      } catch (e) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: e instanceof Error ? e.message : "报告渲染失败",
        });
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
          classification: c.classification,
          storyStructure: c.storyStructure,
          subtitleTrack: c.subtitleTrack,
          // 原生视频精读独有的两栏：审批前必须看得见，否则最有门槛的产出被白名单挡在外面
          reusableZh: c.reusableZh,
          genPromptHintZh: c.genPromptHintZh,
          // 只给 owner/监管审批区：普通用户公开 DTO 不含这份逐秒声音结构。
          audioStory: c.audioStory,
          scenePoolHints: c.scenePoolHints,
          castShape: c.castShape,
          densityHints: c.densityHints,
          // 列表只展示来源数量，不下发来源 URL：listProposals 对 admin/supervisor
          // 也开放，下发完整 sourceRefs 会扩大来源地址的暴露面。
          sourceRefCount: c.sourceRefs.length,
          // 学习来源摘要：卡落库了却不下发，审批人分辨不出精读卡与抽帧卡，
          // 也看不见静默丢镜/触顶抽稀 —— 等于没落库。只给摘要，不给成本与地址。
          learnSourceZh: describeManhuaTemplateLearnSourceZh(c.provenance),
          nativeProgress: toSafeNativeTemplateProgress(
            c.provenance?.nativeVideoDeepRead as NativeTemplateProgressSource | undefined,
          ),
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
        // 归档版本号是递增数字串；收口成纯数字，别让任意字符串拼进对象路径
        generation: z.string().regex(/^\d{1,30}$/),
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
    const {
      listGcsManhuaViralApprovedStrict,
      listGcsManhuaViralProposalsStrict,
      listArchivedManhuaViralTemplateIndex,
    } = await import("../services/manhuaViralTemplateStore");
    const { adviseTemplateRetirement } = await import("../../shared/manhuaTemplateLifecycle");
    // 生命周期判断用严格全量：宽松版只读 80 张且失败返回 []，会把「最后一张」看成「还有好几张」
    const approved = await listGcsManhuaViralApprovedStrict();
    /**
     * 候选包含待审：新学的精读卡通常还在 proposals/ 里等批。
     * 但 **proposals/ 里还躺着 approve 时留下的 status="approved" 审计副本** ——
     * 模板下架只删 approved/，那份副本还在，直接拼进来会把**已经下架的卡**
     * 推荐成正式替代品。正式候选只能来自 approved/。
     */
    // 严格读：列举或单卡读失败一律抛。返回空候选会把
    // **「暂时读不到已付费的精读卡」误报成「建议重新学习」**——那是让用户再花一次钱
    const proposals = await listGcsManhuaViralProposalsStrict();
    const candidates = [...approved, ...proposals];
    const laneCount = new Map<string, number>();
    for (const c of approved) laneCount.set(c.laneZh, (laneCount.get(c.laneZh) || 0) + 1);
    /**
     * 归档索引**独立返回**：恢复入口原本嵌在 approved 行里，
     * 模板一下架就从 approved 消失，恢复入口跟着消失 —— 下架即不可逆。
     */
    const archivedIndex = await listArchivedManhuaViralTemplateIndex();
    /**
     * 归档历史可以留，但同 id 一旦已经回到 approved/，
     * 就不能同时显示成「已下架，可恢复」—— 用户会对着一张现役卡点恢复。
     */
    const approvedIds = new Set(approved.map((card) => card.id));
    const archivedItems = archivedIndex.filter((row) => !approvedIds.has(row.id));
    return {
      archivedItems,
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
      /**
       * 路由只管 owner 权限与输入校验。
       *
       * 原来这里先用宽松列表（最多 80 张）判一次「同赛道最后一张」——
       * 即便 store 已有严格全量门禁，这一层仍可能**提前误拒合法下架**：
       * 目标在前 80、同赛道替代卡排在第 81 张时，宽松列表看不到那张替代卡。
       * 生命周期判断只能有一处，就在 store 的锁内。
       */
      const { archiveApprovedManhuaViralTemplate } = await import(
        "../services/manhuaViralTemplateStore"
      );
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

  /**
   * owner：列出一部剧仍存在的精读占位（native-claims），供面板人工裁决。
   * 金额与卡点从本人学习任务的模型回执聚合；对不上号时如实返回「未知」，不编数。
   */
  listNativeDeepReadClaims: protectedProcedure
    .input(z.object({ seriesKey: z.string().regex(/^[0-9A-Za-z_-]{4,64}$/) }))
    .query(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const [{ listNativeDeepReadClaimAdminRows }, { listManhuaTemplateLearnJobsForUser }] =
        await Promise.all([
          import("../services/manhuaNativeDeepReadClaimAdmin"),
          import("../jobs/repository"),
        ]);
      const rows = await listNativeDeepReadClaimAdminRows(input.seriesKey);
      const spentByEpisode = new Map<number, number>();
      const stuckByEpisode = new Map<number, { atIso: string; textZh: string }>();
      try {
        const jobs = await listManhuaTemplateLearnJobsForUser(String(ctx.user.id), 50);
        for (const job of jobs) {
          const output =
            job.output && typeof job.output === "object" && !Array.isArray(job.output)
              ? (job.output as Record<string, unknown>)
              : {};
          // 历史行的 input 可能是 JSON 字符串；解析失败按「没有 params」处理
          let inputObject: Record<string, unknown> | undefined;
          if (job.input && typeof job.input === "object" && !Array.isArray(job.input)) {
            inputObject = job.input as Record<string, unknown>;
          } else if (typeof job.input === "string") {
            try {
              const parsed = JSON.parse(job.input) as unknown;
              if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
                inputObject = parsed as Record<string, unknown>;
              }
            } catch {
              /* 保持 undefined */
            }
          }
          const params =
            inputObject?.params && typeof inputObject.params === "object"
              ? (inputObject.params as Record<string, unknown>)
              : undefined;
          const jobSeriesKey = String(
            output.seriesKey || output.nativeSeriesKey || params?.nativePlanSeriesKey || "",
          ).trim();
          // 系列对不上号的任务一律跳过：错配的金额比「未知」更糟
          if (jobSeriesKey !== input.seriesKey) continue;
          const receipts = Array.isArray(output.nativeModelReceipts)
            ? (output.nativeModelReceipts as Array<Record<string, unknown>>)
            : [];
          for (const receipt of receipts) {
            const episodes = Array.isArray(receipt.episodeIndexes)
              ? (receipt.episodeIndexes as unknown[])
                  .map((value) => Math.floor(Number(value)))
                  .filter((value) => Number.isInteger(value) && value >= 1)
              : [];
            if (!episodes.length) continue;
            const cny = Number(receipt.priceEquivalentCny);
            const usd = Number(receipt.costUsd);
            const spent = Number.isFinite(cny) && cny > 0
              ? cny
              : Number.isFinite(usd) && usd > 0
                ? usd * 7
                : 0;
            if (spent > 0) {
              // 跨集回执均摊，防止同一笔钱被记到每一集头上
              const share = spent / episodes.length;
              for (const episodeIndex of episodes) {
                spentByEpisode.set(episodeIndex, (spentByEpisode.get(episodeIndex) || 0) + share);
              }
            }
            const errorZh = String(receipt.errorZh || "").trim();
            if (receipt.status === "failed" && errorZh) {
              const atIso = String(receipt.atIso || receipt.finishedAtIso || "");
              for (const episodeIndex of episodes) {
                const prev = stuckByEpisode.get(episodeIndex);
                if (!prev || prev.atIso <= atIso) {
                  stuckByEpisode.set(episodeIndex, { atIso, textZh: errorZh.slice(0, 200) });
                }
              }
            }
          }
          const progressLog = Array.isArray(output.learnProgressLog)
            ? (output.learnProgressLog as Array<Record<string, unknown>>)
            : [];
          for (const line of progressLog) {
            const detailZh = String(line.detailZh || "");
            const atIso = String(line.atIso || "");
            const match = detailZh.match(/第 ?(\d{1,3}) 集/);
            const episodeIndex = Number(match?.[1]);
            if (!Number.isInteger(episodeIndex)) continue;
            if (!/未入库|未通过|未完成|失败/.test(detailZh)) continue;
            const prev = stuckByEpisode.get(episodeIndex);
            if (!prev || prev.atIso <= atIso) {
              stuckByEpisode.set(episodeIndex, { atIso, textZh: detailZh.slice(0, 200) });
            }
          }
        }
      } catch (e) {
        // 金额/卡点是增强信息；聚合失败不拦「有哪些占位」这个主答案
        console.warn(
          "[manhuaViralTemplate.listNativeDeepReadClaims] enrich failed:",
          e instanceof Error ? e.message : e,
        );
      }
      return {
        items: rows.map((row) => {
          const spent = spentByEpisode.get(row.episodeIndex);
          return {
            episodeIndex: row.episodeIndex,
            claimGeneration: row.claimGeneration,
            createdAtIso: row.createdAtIso,
            /** null = 回执里找不到这一集的钱，如实展示「金额未知」 */
            spentCny: typeof spent === "number" ? Math.round(spent * 100) / 100 : null,
            // 占位文件自带的最终拒因最权威（0826 起失败即补写）；旧占位回落任务回执推断
            stuckZh: row.lastErrorZh || stuckByEpisode.get(row.episodeIndex)?.textZh || null,
            reclaimable: row.reclaimable,
          };
        }),
      };
    }),

  /** owner：人工弃置一条精读占位；条件删除，执行链刚重建的占位删不掉（宁停勿删）。 */
  discardNativeDeepReadClaim: protectedProcedure
    .input(
      z.object({
        seriesKey: z.string().regex(/^[0-9A-Za-z_-]{4,64}$/),
        episodeIndex: z.number().int().min(1).max(999),
        claimGeneration: z.string().regex(/^\d+$/),
        confirmDiscard: z.literal(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      assertSiteOwner(ctx.user);
      const { discardNativeDeepReadClaimForEpisode } = await import(
        "../services/manhuaNativeDeepReadClaimAdmin"
      );
      try {
        await discardNativeDeepReadClaimForEpisode(
          input.seriesKey,
          input.episodeIndex,
          input.claimGeneration,
        );
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        throw new TRPCError({ code: "BAD_REQUEST", message: message.slice(0, 200) || "弃置失败" });
      }
      return { ok: true as const, episodeIndex: input.episodeIndex };
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
