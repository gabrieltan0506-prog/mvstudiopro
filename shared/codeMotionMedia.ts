import { z } from "zod";

export const codeMotionSpeechRequestSchema = z
  .object({
    kind: z.literal("speech"),
    requestId: z.string().uuid(),
    sceneIndex: z.number().int().min(0).max(11),
    text: z.string().trim().min(1).max(180),
    voice: z.enum(["female", "male"]),
  })
  .strict();
export const codeMotionBgmRequestSchema = z
  .object({
    kind: z.literal("bgm"),
    requestId: z.string().uuid(),
    direction: z.string().trim().min(2).max(1000),
  })
  .strict();
export const codeMotionSoundRequestSchema = z.discriminatedUnion("kind", [
  codeMotionSpeechRequestSchema,
  codeMotionBgmRequestSchema,
]);
export type CodeMotionSoundRequest = z.infer<
  typeof codeMotionSoundRequestSchema
>;
export const CODE_MOTION_VOICES = {
  female: "longanlingxin",
  male: "longanlufeng",
} as const;
export const CODE_MOTION_TTS_MODEL = "qwen-audio-3.0-tts-plus" as const;
export const CODE_MOTION_AUDIO_SOURCE_LIMIT = 14;
