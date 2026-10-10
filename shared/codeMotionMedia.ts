import { z } from "zod";
import { compileCanvasDialogueInput } from "./canvasDialogueControls";

/** Shares the drama voice library's supported controls; never a new provider parameter. */
export const codeMotionEmotionSchema = z.string().trim().max(100).superRefine((value, ctx) => {
  try { compileCanvasDialogueInput("旁白", value); }
  catch { ctx.addIssue({ code: "custom", message: "请选择漫剧音色库支持的情绪标签" }); }
});

export const codeMotionSpeechRequestSchema = z
  .object({
    kind: z.literal("speech"),
    requestId: z.string().uuid(),
    sceneIndex: z.number().int().min(0).max(11),
    text: z.string().trim().min(1).max(180),
    voice: z.enum(["female", "male"]),
    // Omitted in historical requests: retain their serialized identity as narration.
    role: z.enum(["narration", "dialogue"]).optional(),
    emotion: codeMotionEmotionSchema.optional(),
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
