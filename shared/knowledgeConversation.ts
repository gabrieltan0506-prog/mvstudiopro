import { z } from "zod";
import { knowledgeBookLayoutPlanSchema } from "./knowledgeBookLayout";
import { knowledgeCitationSchema } from "./knowledgeResearch";

export const KNOWLEDGE_SUPPLEMENT_MAX_PAGES = 8;
export const knowledgeConversationRequestSchema = z.object({
  id: z.string().uuid(), retryOf: z.string().uuid().optional(), question: z.string().trim().min(2).max(8000),
  action: z.literal("layout").optional(),
  layoutSourceDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  imagePageIds: z.array(z.string().uuid()).max(4), manuscript: z.string(),
}).strict();
export const knowledgeConversationAnswerSchema = z.object({
  kind: z.literal("knowledge_conversation_v1"), requestId: z.string().uuid(),
  answer: z.string().trim().min(1).max(24000),
  sources: z.array(knowledgeCitationSchema).max(20),
  layoutPlan: knowledgeBookLayoutPlanSchema.optional(),
  supplementalImages: z.array(z.object({
    sourcePageIds: z.array(z.string().uuid()).min(1),
    title: z.string().trim().min(1).max(100),
    reason: z.string().trim().min(1).max(1000),
    content: z.string().trim().min(1).max(5000),
  }).strict()).max(KNOWLEDGE_SUPPLEMENT_MAX_PAGES),
}).strict();
export const knowledgeConversationTurnSchema = z.object({
  request: knowledgeConversationRequestSchema,
  response: knowledgeConversationAnswerSchema.optional(),
}).strict();
export type KnowledgeConversationAnswer = z.infer<typeof knowledgeConversationAnswerSchema>;
