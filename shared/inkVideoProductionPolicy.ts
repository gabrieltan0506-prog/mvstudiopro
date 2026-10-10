/** 映客后台的产品边界；与通用画布能力分开，不能由客户端扩成更长或更多参考。 */
export type InkProductionTier = "free" | "paid";
export const INK_VIDEO_PRODUCTION = {
  free: {
    model: "seedance-2.0-mini",
    version: "2.0-mini",
    resolution: "480p",
    maxDuration: 5,
    minDuration: 4,
    maxReferences: 9,
    imageLimit: 9,
    videoLimit: 3,
    audioLimit: 3,
  },
  paid: {
    model: "seedance-2.5",
    version: "2.5",
    resolution: "720p",
    maxDuration: 30,
    minDuration: 4,
    maxReferences: 50,
    imageLimit: 30,
    videoLimit: 10,
    audioLimit: 10,
  },
} as const;
export function planInkGeneratedShot(input: {
  tier: InkProductionTier;
  duration: number;
  imageCount: number;
  videoCount: number;
  audioCount: number;
}) {
  const policy = INK_VIDEO_PRODUCTION[input.tier];
  if (!policy) throw new Error("无法确认作品档位");
  if (
    !Number.isInteger(input.duration) ||
    input.duration < policy.minDuration ||
    input.duration > policy.maxDuration
  )
    throw new Error(
      `本次模型镜头必须为${policy.minDuration}–${policy.maxDuration}秒；更短的画面用代码编排`
    );
  const counts = [input.imageCount, input.videoCount, input.audioCount];
  if (counts.some(n => !Number.isSafeInteger(n) || n < 0))
    throw new Error("参考素材数量无效");
  const total = counts.reduce((n, count) => n + count, 0);
  if (!total || total > policy.maxReferences)
    throw new Error(
      `本次参考素材合计必须为1–${policy.maxReferences}个，包含图片、视频与音讯`
    );
  if (
    input.imageCount > policy.imageLimit ||
    input.videoCount > policy.videoLimit ||
    input.audioCount > policy.audioLimit
  )
    throw new Error("参考素材超过当前通道单类上限，请重新分配镜头素材");
  if (!input.imageCount && !input.videoCount)
    throw new Error("须有画面参考，不能仅凭音讯生成本镜");
  return {
    model: policy.model,
    version: policy.version,
    resolution: policy.resolution,
    duration: input.duration,
    mode:
      input.audioCount || input.videoCount || input.imageCount > 2
        ? ("reference_to_video" as const)
        : ("image_to_video" as const),
  };
}
