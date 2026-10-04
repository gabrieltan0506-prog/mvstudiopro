import type { AdvisorMediaProposal } from "./manhuaAdvisorMediaEdit";
import { z } from "zod";
export const CREATIVE_VOICE_PURPOSES = {
  discussion: "口述构思与对话", script_review: "推敲剧情与时间线", template_compare: "比较创作方法",
  video_review: "一起看片", previs: "讨论白模与场景",
} as const;
export const creativeVoiceStartSchema = z.object({
  type: z.literal("start"), purpose: z.enum(["discussion", "script_review", "template_compare", "video_review", "previs"]),
  context: z.string().max(12000), projectKey: z.string().min(1).max(200), confirmedCost: z.literal(true),
});
export type CreativeVoiceStart = z.infer<typeof creativeVoiceStartSchema>;
const base64 = z.string().min(4).regex(/^[A-Za-z0-9+/]+={0,2}$/);
export const creativeVoiceInputSchema = z.discriminatedUnion("type", [creativeVoiceStartSchema,
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(4000) }),
  z.object({ type: z.literal("audio"), data: base64.max(24000) }),
  z.object({ type: z.literal("frame"), data: base64.max(200000), atSec: z.number().finite().min(0), source: z.string().min(1).max(160), still: z.boolean().optional() }),
  z.object({ type: z.literal("toolResult"), id: z.string().min(1).max(200), text: z.string().max(16000) }),
  z.object({ type: z.literal("audioEnd") }), z.object({ type: z.literal("stop") }),
]);
export function voiceNeedsExtended(purpose: CreativeVoiceStart["purpose"]): boolean {
  return purpose === "script_review" || purpose === "template_compare";
}
export function creativeVoiceTurnIdle(extended: boolean, message: {
  interactionStatus?: string; interaction_status?: string;
  serverContent?: { turnComplete?: boolean; interactionStatus?: string; interaction_status?: string };
}): boolean {
  return extended
    ? (message.interactionStatus ?? message.interaction_status ?? message.serverContent?.interactionStatus ?? message.serverContent?.interaction_status) === "IDLE"
    : Boolean(message.serverContent?.turnComplete);
}
export const creativeVoiceActionSchema = z.object({
  action: z.enum(["inspect", "navigate", "note", "seek"]),
  episode: z.number().int().positive().optional(), shot: z.number().int().positive().optional(),
  text: z.string().trim().min(1).max(2000).optional(), atSec: z.number().finite().min(0).optional(),
}).superRefine((value, ctx) => {
  if (value.action === "navigate" && !value.episode) ctx.addIssue({ code: "custom", message: "需要集数" });
  if (value.action === "note" && !value.text) ctx.addIssue({ code: "custom", message: "需要备注正文" });
  if (value.action === "seek" && value.atSec === undefined) ctx.addIssue({ code: "custom", message: "需要播放器时间" });
  if (value.shot && !value.episode) ctx.addIssue({ code: "custom", message: "镜头必须指定集数" });
});
export type CreativeVoiceAction = z.infer<typeof creativeVoiceActionSchema>;
export type CreativeVoiceTarget = { episode: number; shot?: number; label: string };
export type CreativeVoiceEvent =
  | { type: "filmReview"; id: string; blockId: string; question: string }
  | { type: "mediaEdit"; id: string; proposal: AdvisorMediaProposal }
  | { type: "workflow"; id: string; action: CreativeVoiceAction }
  | { type: "tool"; id: string; question: string }
  | { type: "route"; route: string; model: string; fallback: boolean }
  | { type: "status"; text: string; ready?: boolean }
  | { type: "text"; role: "user" | "advisor"; text: string }
  | { type: "audio"; data: string; mimeType: string }
  | { type: "interrupted" }
  | { type: "usage"; totalTokens: number }
  | { type: "error"; text: string };
