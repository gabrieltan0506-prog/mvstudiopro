import { z } from "zod";

/** 读档预整理绑定原任务，不把未统稿的分段冒充最终完整稿。 */
export const knowledgeReadingPreparationSchema = z.object({
  jobId: z.string().regex(/^kc_[a-zA-Z0-9_-]+$/),
  documentId: z.string().uuid(),
  batches: z.number().int().min(1),
}).strict();
export type KnowledgeReadingPreparation = z.infer<typeof knowledgeReadingPreparationSchema>;
export type KnowledgeReadingProgress = KnowledgeReadingPreparation & { ready: number[] };
export type KnowledgeReadingChunk = { index: number; total: number; markdown: string; error?: string };
