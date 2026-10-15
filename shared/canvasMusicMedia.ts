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
    gcsUri: z
      .string()
      .regex(/^gs:\/\/[^/]+\/.+/)
      .optional(),
  })
  .strict();
export type CanvasMusicCandidate = z.infer<typeof canvasMusicCandidateSchema>;
