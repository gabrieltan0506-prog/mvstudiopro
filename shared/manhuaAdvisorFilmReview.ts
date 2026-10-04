import { z } from "zod";
export const advisorFilmReviewTargetSchema = z.object({
  videoUri: z.string().min(1).max(8192), blockId: z.string().min(1).max(200), revision: z.string().min(1).max(20000), label: z.string().max(300),
});
export type AdvisorFilmReviewTarget = z.infer<typeof advisorFilmReviewTargetSchema>;
export const advisorFilmReviewSchema = z.object({
  kind: z.literal("film_review_v1"), summary: z.string().min(1).max(2000),
  findings: z.array(z.object({ atSec: z.number().finite().min(0), endSec: z.number().finite().min(0),
    category: z.enum(["表演", "构图", "场景", "灯光", "声音", "连续性", "字幕", "节奏"]),
    observation: z.string().min(1).max(700), suggestion: z.string().min(1).max(700),
    confidence: z.enum(["明确", "需人工核对"]),
  }).refine(v => v.endSec >= v.atSec, "结束时间不能早于开始时间")).max(30),
  limitations: z.string().min(1).max(1500),
});
export type AdvisorFilmReview = z.infer<typeof advisorFilmReviewSchema>;
