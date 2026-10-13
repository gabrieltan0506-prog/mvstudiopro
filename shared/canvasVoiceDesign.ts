import { z } from "zod";

export const DESIGNED_VOICE_PREFIX = "wsqwen_";
export const voiceDesignDefinitionSchema = z.object({
  labelZh: z.string().trim().min(1).max(80),
  description: z.string().trim().min(10).max(1000),
}).strict();
export const canvasVoiceDesignInputSchema = voiceDesignDefinitionSchema.extend({
  requestId: z.string().uuid(),
  text: z.string().trim().min(10).max(120),
  consent: z.literal(true),
}).strict();
export type CanvasVoiceDesignInput = z.output<typeof canvasVoiceDesignInputSchema>;
export type CanvasDesignedVoice = {
  requestId: string; status: string; labelZh: string; voiceId?: string;
  canResume: boolean; audioUrl?: string; message?: string; creditsCost: number;
  request: CanvasVoiceDesignInput;
};

/** 当前供应商只声明纯文本，不能把其他引擎的表演标签送去朗读。 */
export function assertDesignedVoiceText(text: string): void {
  if (/[\[\]]/.test(text)) throw new Error("固定声线当前只支持纯台词，请清除语气/拟声标签后再生成；不会擅自删改台词");
}
