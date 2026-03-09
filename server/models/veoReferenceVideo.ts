import { fal } from "@fal-ai/client";

export async function veoReferenceVideo(input: {
  prompt: string;
  reference_images: string[];
  duration?: number;
  resolution?: "720p" | "1080p";
}): Promise<{ videoUrl: string }> {
  const prompt = String(input.prompt || "").trim();
  const referenceImages = Array.isArray(input.reference_images)
    ? input.reference_images.map((v) => String(v || "").trim()).filter(Boolean)
    : [];

  if (!prompt) throw new Error("prompt is required");
  if (!referenceImages.length) throw new Error("reference_images is required");

  const key = String(process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
  if (!key) {
    throw new Error("FAL_API_KEY/FAL_KEY is not configured");
  }

  fal.config({ credentials: key });
  const result = (await fal.subscribe("fal-ai/veo3.1/reference-to-video", {
    input: {
      prompt,
      reference_images: referenceImages,
      duration: Number(input.duration || 0) || 5,
      resolution: input.resolution || "720p",
    },
    logs: false,
  })) as any;

  const videoUrl =
    String(result?.data?.video?.url || "").trim() ||
    String(result?.video?.url || "").trim() ||
    String(result?.data?.url || "").trim();

  if (!videoUrl) throw new Error("veo reference-to-video returned empty video url");
  return { videoUrl };
}
