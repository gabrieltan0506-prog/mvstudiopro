import { z } from "zod";
const episode = z.number().int().positive();
export const creativeVoiceNovelActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("read"), episode }).strict(),
  z.object({ action: z.literal("preview"), episode, revision: z.string().regex(/^[a-f0-9]{64}$/), edits: z.array(z.object({ before: z.string().min(1).max(6600), after: z.string().max(6600) }).strict()).min(1).max(12), summary: z.string().trim().min(1).max(800) }).strict(),
  z.object({ action: z.literal("apply"), candidateId: z.string().uuid() }).strict(),
]);
export type CreativeVoiceNovelAction = z.infer<typeof creativeVoiceNovelActionSchema>;
export const novelVoiceCandidateSchema = z.object({
  id: z.string().uuid(), roundId: z.string().min(1), episode,
  revision: z.string().regex(/^[a-f0-9]{64}$/), before: z.string().min(1).max(12000),
  text: z.string().trim().min(1).max(6600), summary: z.string().min(1).max(800),
  createdAt: z.string(), applied: z.boolean().optional(),
}).strict();
export type NovelVoiceCandidate = z.infer<typeof novelVoiceCandidateSchema>;
