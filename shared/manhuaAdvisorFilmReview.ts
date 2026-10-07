import { z } from "zod";
export const advisorFilmReviewTargetSchema = z.object({
  videoUri: z.string().min(1).max(8192), blockId: z.string().min(1).max(200), revision: z.string().min(1).max(20000), label: z.string().max(300),
});
export type AdvisorFilmReviewTarget = z.infer<typeof advisorFilmReviewTargetSchema>;
export const advisorFilmReviewSchema = z.object({
  kind: z.literal("film_review_v1"), summary: z.string().min(1).max(2000),
  findings: z.array(z.object({ kind: z.enum(["亮点", "不足"]).optional(), atSec: z.number().finite().min(0), endSec: z.number().finite().min(0),
    category: z.enum(["表演", "构图", "场景", "灯光", "声音", "连续性", "字幕", "节奏"]),
    observation: z.string().min(1).max(700), suggestion: z.string().min(1).max(700),
    confidence: z.enum(["明确", "需人工核对"]),
  }).refine(v => v.endSec >= v.atSec, "结束时间不能早于开始时间")).max(30),
  nativeEvidence: z.object({ analysis: z.record(z.string(), z.unknown()), sourceGeneration: z.string(), audioTokens: z.number().nullable() }).optional(),
  observerEvidence: z.object({
    analysis: z.object({summaryZh:z.string(),shots:z.array(z.object({startSec:z.number(),endSec:z.number(),descriptionZh:z.string()})),audioSegments:z.array(z.object({startSec:z.number(),endSec:z.number(),descriptionZh:z.string()})),subtitles:z.array(z.object({atSec:z.number(),textZh:z.string()})),findings:z.array(z.object({atSec:z.number(),modality:z.string(),status:z.string(),issueZh:z.string(),evidenceZh:z.string(),suggestionZh:z.string()}))}),
    validation:z.object({audioIntervalCoverage:z.object({ratio:z.number()}),visualIntervalCoverage:z.object({ratio:z.number()}),warnings:z.array(z.string())}),sourceGeneration:z.string(),audioTokens:z.number().nullable(),
  }).optional(),
  // Provider keeps its original 1500-character limit; reserve space for the server audit scope.
  limitations: z.string().min(1).max(1800),
});
export type AdvisorFilmReview = z.infer<typeof advisorFilmReviewSchema>;
