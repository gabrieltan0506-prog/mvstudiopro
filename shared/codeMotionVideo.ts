import { z } from "zod";

export const codeMotionVideoAssetSchema = z
  .object({
    id: z.string().min(1).max(100),
    videoUri: z
      .string()
      .regex(/^gs:\/\/[^/\s?#]+\/[^\s?#]+$/)
      .max(2048),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    durationSec: z.number().finite().min(4).max(5),
  })
  .strict();
export const codeMotionVideoSchema = z
  .object({
    version: z.literal(1),
    assets: z.array(codeMotionVideoAssetSchema).min(1).max(6),
    clips: z
      .array(
        z
          .object({
            assetId: z.string().min(1).max(100),
            at: z.number().finite().min(0).max(180),
            duration: z.number().finite().positive().max(5),
            sourceStartSec: z.number().finite().min(0).max(5).default(0),
            fit: z.enum(["cover", "contain"]).default("cover"),
          })
          .strict()
      )
      .min(1)
      .max(6),
  })
  .strict();
export type CodeMotionVideo = z.infer<typeof codeMotionVideoSchema>;
export function validateCodeMotionVideo(
  video: CodeMotionVideo,
  duration: number,
  fps: number
): string[] {
  const errors: string[] = [],
    assets = new Map(video.assets.map(a => [a.id, a]));
  if (assets.size !== video.assets.length) errors.push("视频素材身份重复");
  const clips = [...video.clips].sort((a, b) => a.at - b.at);
  for (let index = 0; index < clips.length; index++) {
    const clip = clips[index];
    const asset = assets.get(clip.assetId);
    if (
      !asset ||
      clip.sourceStartSec + clip.duration > asset.durationSec + 1e-6
    )
      errors.push("视频片段超出已保存素材");
    if (
      clip.at + clip.duration > duration + 1e-6 ||
      (index > 0 &&
        clips[index - 1].at + clips[index - 1].duration > clip.at + 1e-6)
    )
      errors.push("视频片段重叠或超出成片");
    if (
      [clip.at, clip.duration].some(
        t => Math.abs(t * fps - Math.round(t * fps)) > 1e-5
      )
    )
      errors.push("视频片段必须对齐画面帧");
  }
  return errors;
}
export function codeMotionVideoClipAt(
  video: CodeMotionVideo | undefined,
  time: number
) {
  return video?.clips.find(
    clip => time >= clip.at && time < clip.at + clip.duration
  );
}
