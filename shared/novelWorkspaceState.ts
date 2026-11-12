import { z } from "zod";
import {
  novelTestInputSchema,
  novelModelSchema,
  novelTemplateChoiceSchema,
  novelGenerationSettingsSchema,
  novelStageSchema,
  novelReviewLaneSchema,
  NOVEL_IMITATION_SYNOPSIS_MAX,
} from "./novelWorkspace";
import {
  NOVEL_IMITATION_LIBRARY_PICK_MAX,
  novelImitationLibraryOutcomeSchema,
  novelImitationSkeletonSchema,
} from "./novelImitation";
import { NOVEL_CREATIVE_PREMISE_MAX, novelCreativePremiseSchema } from "./novelCreativePremise";
const runSchema = z.object({
  input: novelTestInputSchema,
  result: z.object({
    model: z.string().optional(),
    settings: novelGenerationSettingsSchema.optional(),
    requestId: z.string(),
    stage: novelStageSchema,
    text: z.string(),
    templateIds: z.array(z.string()),
    inputSha256: z.string(),
    resultSha256: z.string(),
  }),
});
export const novelWorkspaceStateSchema = z.object({
  /** 小说作品身份跨季保留；roundId 继续标识本季制作与模型回执。 */
  projectId: z.string().uuid().optional(),
  scriptEdits: z
    .record(z.string(), z.record(z.string(), z.string().max(3500)))
    .optional(),
  roundId: z.string().uuid(),
  topic: z.string(),
  direction: z.string(),
  advisorDraft: z.string().max(2000).optional(),
  modelPreference: novelModelSchema.optional(),
  /**
   * 审稿线路（站长 2026-11-11：审稿、改稿拆成两个下拉）。字段名沿用旧的 reviseModelPreference，
   * 旧草稿里的值即作为审稿线路读取；未设时沿用写作线路。
   */
  reviseModelPreference: novelModelSchema.optional(),
  /** 改稿线路（1111 新增）；未设时沿用写作线路。 */
  rewriteModelPreference: novelModelSchema.optional(),
  /** 创作顾问档位（站长 2026-11-12：顾问线路自己选）；缺省沿用 modelPreference。 */
  advisorModelPreference: novelModelSchema.optional(),
  advisorAnchor: z.string().optional(),
  /** 创意环节（1112，可选；旧草稿没有）：最近一批核心创意候选。 */
  creativePremises: z
    .object({
      requestId: z.string(),
      savedAt: z.string(),
      premises: z.array(novelCreativePremiseSchema),
    })
    .optional(),
  /** 本作核心创意（1112，可选）：用户采用后可手改，也可完全自己写；非空时带进顾问讨论、大纲、正文与审稿改稿。 */
  creativePremise: z.string().max(NOVEL_CREATIVE_PREMISE_MAX).optional(),
  storyVersions: z
    .array(
      z.object({
        label: z.string(),
        episodeCount: z.number().int().min(1).max(20).optional(),
        episodeStart: z.number().int().positive().optional(),
        advisorAnchor: z.string().optional(),
        outline: z.string(),
        chapters: z.array(z.string()),
        templates: z.array(novelTemplateChoiceSchema),
      })
    )
    .optional(),
  season: z.number().int().positive().optional(),
  seasons: z
    .array(z.object({ season: z.number(), workspace: z.string() }))
    .optional(),
  /** imitation：爆款仿写（1112 追加枚举值，旧草稿 source / original 照常读取）。 */
  mode: z.enum(["source", "original", "imitation"]),
  /** 爆款仿写的题材与纲要（方向沿用 direction）；其他模式不使用。 */
  imitationGenre: z.string().max(200).optional(),
  imitationSynopsis: z.string().max(NOVEL_IMITATION_SYNOPSIS_MAX).optional(),
  /** 底稿结构拆解结果：baseSha256 对应拆解时的底稿全文，底稿更换后需重新拆解。 */
  imitationSkeleton: z
    .object({
      baseSha256: z.string(),
      savedAt: z.string(),
      skeleton: novelImitationSkeletonSchema,
      /** 本次拆解后的收录结果（1112b，可选；旧草稿没有）。 */
      library: novelImitationLibraryOutcomeSchema.optional(),
    })
    .optional(),
  /** 拆书参考模板：勾选的公共参考模板 id，最多 3 条（1112b，可选；旧草稿没有，所有模式可用）。 */
  libraryTemplatePicks: z.array(z.string()).max(NOVEL_IMITATION_LIBRARY_PICK_MAX).optional(),
  source: z.unknown(),
  templates: z.array(
    z.object({
      publicId: z.string(),
      role: z.string(),
      weight: z.number().int().min(0).max(100).optional(),
    })
  ),
  episodeCount: z.number().int().min(1).max(20),
  episodeStart: z.number().int().positive().optional(),
  targetEpisodeCount: z.number().int().positive().optional(),
  continuity: z.string().max(8000).optional(),
  continuityThrough: z.number().int().nonnegative().optional(),
  continuityBase: z.string().optional(),
  pendingContextBase: z.string().optional(),
  reviewedBatches: z
    .array(
      z.object({
        start: z.number(),
        count: z.number(),
        outline: z.string(),
        chapters: z.array(z.string()),
        templates: z.array(novelTemplateChoiceSchema),
      })
    )
    .optional(),
  generationQueue: z
    .object({
      configuration: z.string().optional(),
      stage: z.enum(["chapter", "script"]),
      next: z.number().int(),
      end: z.number().int(),
      single: z.string().optional(),
      scriptBatch: z
        .object({
          id: z.string().uuid(),
          start: z.number(),
          count: z.number(),
          baseline: z.string(),
        })
        .optional(),
    })
    .optional(),
  outline: z.string(),
  outlineApproved: z.string(),
  chapters: z.array(z.string()),
  novelApproved: z.string(),
  runs: z.array(runSchema),
  pending: novelTestInputSchema.optional(),
  failedRequest: novelTestInputSchema.optional(),
  pendingChapterBase: z.string().optional(),
  chapterWarnings: z.record(z.string(), z.string()).optional(),
  /** 1111 审稿改稿：每次结果（含仅有审稿、改稿失败的记录），未修改版与修改版都保留。 */
  chapterRevisions: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        requestId: z.string(),
        savedAt: z.string(),
        /** 序列化的审稿改稿结果；改稿失败时 revised 缺省。 */
        outcome: z.string(),
        failure: z.string().optional(),
        adoptedAt: z.string().optional(),
        /** 提交时的本集大纲条目；当前大纲条目与之不同即视为已核对并更新大纲，不再提醒。 */
        outlineItem: z.string().optional(),
        /** 站长点了「大纲已核对」的时间：点过即不再提醒（大纲无需改动时用）。 */
        outlineCheckedAt: z.string().optional(),
      })
    )
    .optional(),
  /**
   * 多线路审稿对比（1112，可选；旧草稿没有）：每集只保存最近一次对比。
   * 每条线路独立 requestId；pending 的按现有回执续查，succeeded 的 outcome 为只审稿结果（序列化）。
   */
  reviewCompares: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        compareId: z.string(),
        createdAt: z.string(),
        /** 对比时的本集正文（意见定位与按所选意见改稿都以它为准）。 */
        original: z.string(),
        lanes: z.array(
          z.object({
            lane: novelReviewLaneSchema,
            requestId: z.string(),
            status: z.enum(["pending", "succeeded", "failed"]),
            submittedAt: z.string(),
            /** 序列化的只审稿结果（含 review 与实际所用模型标识）。 */
            outcome: z.string().optional(),
            failure: z.string().optional(),
          })
        ),
      })
    )
    .optional(),
  chapterVersions: z
    .array(
      z.object({
        index: z.number().int(),
        text: z.string(),
        savedAt: z.string(),
      })
    )
    .optional(),
});
