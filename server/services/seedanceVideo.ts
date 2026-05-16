import { fal } from "@fal-ai/client";

export type SeedanceDurationInput = number | "auto";

function normalizeDurationParam(d: SeedanceDurationInput): "auto" | `${number}` {
  if (d === "auto") return "auto";
  const n = Math.floor(Number(d));
  const clamped = Math.min(15, Math.max(4, Number.isFinite(n) ? n : 8));
  return String(clamped) as `${number}`;
}

/**
 * ByteDance Seedance 2.0 image-to-video（fal）。
 */
export async function runSeedanceImageToVideo(input: {
  prompt: string;
  imageUrl: string;
  resolution: "720p" | "1080p";
  duration: SeedanceDurationInput;
  aspectRatio: string;
  generateAudio?: boolean;
  endImageUrl?: string;
}): Promise<{ videoUrl: string; seed: number }> {
  const key = String(process.env.FAL_KEY || "").trim();
  if (!key) {
    throw new Error("FAL_KEY is required for Seedance image-to-video");
  }
  fal.config({ credentials: key });

  const aspect =
    String(input.aspectRatio || "auto").trim() || "auto";

  const result = await fal.subscribe("bytedance/seedance-2.0/image-to-video", {
    input: {
      prompt: input.prompt,
      image_url: input.imageUrl,
      ...(input.endImageUrl ? { end_image_url: input.endImageUrl } : {}),
      resolution: input.resolution,
      duration: normalizeDurationParam(input.duration),
      aspect_ratio: aspect,
      generate_audio: input.generateAudio !== false,
    },
    logs: false,
  });

  const data: any = result.data;
  const videoUrl = String(data?.video?.url || "").trim();
  const seed = Number(data?.seed ?? 0);
  if (!videoUrl) {
    throw new Error("seedance_missing_video_url");
  }
  return { videoUrl, seed };
}
