import { fal } from "@fal-ai/client";

export async function generateStoryboardSceneImages(input: {
  scenePrompt: string;
  count?: number;
}) {
  const key = String(process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
  const scenePrompt = String(input.scenePrompt || "").trim();
  const count = Number(input.count || 2);

  if (!scenePrompt) {
    return {
      imageUrls: [] as string[],
      provider: "fal",
      model: "fal-ai/nano-banana-2",
      isFallback: true,
      errorMessage: "scenePrompt is required",
    };
  }

  if (!key) {
    return {
      imageUrls: [] as string[],
      provider: "fal",
      model: "fal-ai/nano-banana-2",
      isFallback: true,
      errorMessage: "FAL_API_KEY/FAL_KEY is not configured",
    };
  }

  fal.config({ credentials: key });
  try {
    const result = (await fal.subscribe("fal-ai/nano-banana-2", {
      input: {
        prompt: scenePrompt,
        num_images: count,
        aspect_ratio: "16:9",
      },
      logs: false,
    })) as any;

    const images = result?.data?.images || result?.images || [];
    const urls = Array.isArray(images)
      ? images
          .map((item: any) => String(item?.url || "").trim())
          .filter(Boolean)
          .slice(0, count)
      : [];

    return {
      imageUrls: urls,
      provider: "fal",
      model: "fal-ai/nano-banana-2",
      isFallback: urls.length < count,
      errorMessage: urls.length < count ? "banana returned insufficient images" : "",
    };
  } catch (error: any) {
    return {
      imageUrls: [] as string[],
      provider: "fal",
      model: "fal-ai/nano-banana-2",
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}
