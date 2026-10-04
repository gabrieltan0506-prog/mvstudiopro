import { z } from "zod";
import {
  novelTestInputSchema,
  novelModelSchema,
  novelTemplateChoiceSchema,
  novelGenerationSettingsSchema,
} from "./novelWorkspace";
const runSchema = z.object({
  input: novelTestInputSchema,
  result: z.object({
    model: z.string().optional(),
    settings: novelGenerationSettingsSchema.optional(),
    requestId: z.string(),
    stage: z.enum(["advice", "outline", "chapter", "script"]),
    text: z.string(),
    templateIds: z.array(z.string()),
    inputSha256: z.string(),
    resultSha256: z.string(),
  }),
});
export const novelWorkspaceStateSchema = z.object({
  roundId: z.string().uuid(),
  topic: z.string(),
  direction: z.string(),
  advisorDraft: z.string().max(2000).optional(),
  modelPreference: novelModelSchema.optional(),
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
