import { z } from "zod";

/** 只传有界的选题参考摘要；原始Growth库仍为事实源，用户回传字段不是平台认证。 */
export const xhsGrowthEvidenceSchema = z.object({
  platform: z.enum(["xiaohongshu", "douyin"]).optional(),
  version: z.string().max(40),
  capturedAt: z.string().max(40),
  windowStart: z.string().max(40),
  windowEnd: z.string().max(40),
  sourceCount: z.number().int().nonnegative(),
  eligibleCount: z.number().int().nonnegative(),
  excludedUnknownDate: z.number().int().nonnegative(),
  excludedOutsideWindow: z.number().int().nonnegative(),
  duplicateCount: z.number().int().nonnegative(),
  selectedCount: z.number().int().min(0).max(12),
  samples: z.array(z.object({
    id: z.string().max(2000), title: z.string().max(2000),
    url: z.string().url().regex(/^https?:\/\//i).max(2000).optional(),
    date: z.string().max(40),
    dateKind: z.enum(["publishedAt", "observedAt", "collectedAt", "createdAt"]),
    likes: z.number().nonnegative().optional(), comments: z.number().nonnegative().optional(),
    tags: z.array(z.string().max(200)).max(100),
    relevance: z.object({ matchedTerms: z.array(z.string().max(200)).max(2000), score: z.number().int().nonnegative() }).optional(),
  })).max(12),
  note: z.string().max(1000),
});
