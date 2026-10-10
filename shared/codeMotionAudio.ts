import { z } from "zod";
import { CODE_MOTION_AUDIO_SOURCE_LIMIT } from "./codeMotionMedia";

export const CODE_MOTION_AUDIO_MAX_BYTES = 64 * 1024 * 1024;
export const CODE_MOTION_AUDIO_MAX_SECONDS = 180;
export const CODE_MOTION_AUDIO_SOURCE_MAX_SECONDS = 360;
export const codeMotionAudioMimeSchema = z.enum([
  "audio/mpeg",
  "audio/wav",
  "audio/mp4",
  "audio/webm",
]);

/** 原声身份由服务端解码和不可覆盖归档产生，不信任文件后缀或浏览器时长。 */
export const codeMotionAudioSourceSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(160),
    gcsUri: z
      .string()
      .regex(/^gs:\/\/[^/]+\/.+$/)
      .max(2048),
    duration: z
      .number()
      .finite()
      .positive()
      .max(CODE_MOTION_AUDIO_SOURCE_MAX_SECONDS),
    generated: z
      .object({
        requestId: z.string().uuid(),
        kind: z.enum(["speech", "bgm"]),
        sceneIndex: z.number().int().min(0).max(11).optional(),
        text: z.string().max(180).optional(),
        voice: z.enum(["female", "male"]).optional(),
      })
      .strict()
      .optional(),
    mimeType: codeMotionAudioMimeSchema,
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive().max(CODE_MOTION_AUDIO_MAX_BYTES),
  })
  .strict();

const codeMotionAudioClipObject = z
  .object({
    sourceId: z.string().uuid(),
    role: z.enum(["dialogue", "narration", "bgm", "sfx"]),
    at: z.number().finite().min(0).max(CODE_MOTION_AUDIO_MAX_SECONDS),
    trimStart: z
      .number()
      .finite()
      .min(0)
      .max(CODE_MOTION_AUDIO_SOURCE_MAX_SECONDS)
      .default(0),
    duration: z.number().finite().positive().max(CODE_MOTION_AUDIO_MAX_SECONDS),
    volume: z.number().finite().min(0).max(2).default(1),
    fadeIn: z
      .number()
      .finite()
      .min(0)
      .max(CODE_MOTION_AUDIO_MAX_SECONDS)
      .default(0),
    fadeOut: z
      .number()
      .finite()
      .min(0)
      .max(CODE_MOTION_AUDIO_MAX_SECONDS)
      .default(0),
  })
  .strict();
export const codeMotionAudioClipSchema = codeMotionAudioClipObject.superRefine(
  (clip, ctx) => {
    if (clip.fadeIn + clip.fadeOut > clip.duration + 1e-6)
      ctx.addIssue({
        code: "custom",
        message: "淡入和淡出合计不能超过片段时长",
      });
  }
);

export const codeMotionAudioClipDraftSchema = codeMotionAudioClipObject.extend({
  duration: z.number().finite().min(0).max(CODE_MOTION_AUDIO_MAX_SECONDS),
});

const audioShape = z
  .object({
    sources: z
      .array(codeMotionAudioSourceSchema)
      .min(1)
      .max(CODE_MOTION_AUDIO_SOURCE_LIMIT),
    audioTimeline: z.array(codeMotionAudioClipSchema).min(1).max(24),
  })
  .strict();
export type CodeMotionAudioSource = z.infer<typeof codeMotionAudioSourceSchema>;
export type CodeMotionAudioClip = z.infer<typeof codeMotionAudioClipSchema>;
export type CodeMotionAudio = z.infer<typeof audioShape>;

/** 返回全部问题，供方案及最终渲染契约共同校验，避免静默丢弃片段。 */
export function validateCodeMotionAudio(
  audio: CodeMotionAudio,
  duration: number
): string[] {
  const errors: string[] = [];
  if (
    !Number.isFinite(duration) ||
    duration <= 0 ||
    duration > CODE_MOTION_AUDIO_MAX_SECONDS
  )
    errors.push("音轨总时长必须在 180 秒内");
  const sources = new Map(audio.sources.map(source => [source.id, source]));
  if (sources.size !== audio.sources.length) errors.push("音源编号不能重复");
  if (
    new Set(audio.sources.map(source => source.gcsUri)).size !==
    audio.sources.length
  )
    errors.push("同一音源不能重复登记");
  const used = new Set<string>();
  audio.audioTimeline.forEach((clip, index) => {
    const source = sources.get(clip.sourceId);
    if (!source) errors.push(`第 ${index + 1} 条音轨找不到原声`);
    else {
      used.add(source.id);
      if (clip.trimStart + clip.duration > source.duration + 1e-6)
        errors.push(`第 ${index + 1} 条音轨超出原声时长`);
    }
    if (clip.at + clip.duration > duration + 1e-6)
      errors.push(`第 ${index + 1} 条音轨超出视频时长`);
  });
  if (audio.sources.some(source => !used.has(source.id)))
    errors.push("存在未使用音源，请安排片段或移除该音源");
  if (!audio.audioTimeline.some(clip => clip.volume > 0))
    errors.push("音轨音量不能全部为零");
  return errors;
}

export const codeMotionAudioSchema = audioShape.superRefine((audio, ctx) => {
  for (const message of validateCodeMotionAudio(
    audio,
    CODE_MOTION_AUDIO_MAX_SECONDS
  ))
    ctx.addIssue({ code: "custom", message });
});
