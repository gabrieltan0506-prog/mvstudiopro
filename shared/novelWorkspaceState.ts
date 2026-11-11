import { z } from "zod";
import {
  novelTestInputSchema,
  novelModelSchema,
  novelTemplateChoiceSchema,
  novelGenerationSettingsSchema,
  novelStageSchema,
} from "./novelWorkspace";
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
  /** 审稿改稿单独选用的线路（站长 2026-11-11：审稿改稿可自选，不随写作线路锁定）；未设时沿用写作线路。 */
  reviseModelPreference: novelModelSchema.optional(),
  advisorAnchor: z.string().optional(),
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
  mode: z.enum(["source", "original"]),
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
