import { z } from "zod";
const text = z.string().trim().min(1);
export const canvasMusicCandidateSchema = z
  .object({
    id: text.max(200),
    url: z
      .string()
      .url()
      .refine(value => value.startsWith("https://"), "音乐地址须为 HTTPS"),
    durationSec: z.number().finite().positive().max(3600),
    title: z.string().max(200).optional(),
    /** 来源仅用于展示与恢复；服务端操作必须按本人任务重新核验。 */
    musicJobId: text.max(200).optional(),
    sourceOperationId: z.string().uuid().optional(),
    sourceVariantIndex: z.number().int().nonnegative().optional(),
    variantIndex: z.number().int().nonnegative().optional(),
    musicId: text.max(200).optional(),
    providerTaskId: text.max(200).optional(),
    gcsUri: z
      .string()
      .regex(/^gs:\/\/[^/]+\/.+/)
      .optional(),
  })
  .strict();
export type CanvasMusicCandidate = z.infer<typeof canvasMusicCandidateSchema>;
