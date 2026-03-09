export async function generateVideoWithVeo(input: {
  scenePrompt: string;
  referenceImages: string[];
  imageUrls: string[];
}) {
  const key = String(process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
  const scenePrompt = String(input.scenePrompt || "").trim();

  if (!scenePrompt) {
    return {
      videoUrl: "",
      provider: "fal",
      model: "fal-ai/veo3.1/reference-to-video",
      isFallback: true,
      errorMessage: "scenePrompt is required",
    };
  }

  if (!key) {
    return {
      videoUrl: `mock://fal-ai/veo3.1/reference-to-video?prompt=${encodeURIComponent(scenePrompt)}`,
      provider: "fal",
      model: "fal-ai/veo3.1/reference-to-video",
      isFallback: true,
      errorMessage: "FAL_API_KEY/FAL_KEY is not configured",
    };
  }

  try {
    const { fal } = await import("@fal-ai/client");
    fal.config({ credentials: key });

    const images = [...(input.referenceImages || []), ...(input.imageUrls || [])].filter(Boolean);

    const result = (await fal.subscribe("fal-ai/veo3.1/reference-to-video", {
      input: {
        prompt: scenePrompt,
        reference_images: images,
        image_urls: images,
      },
      logs: false,
    })) as any;

    const videoUrl =
      String(result?.data?.video?.url || "").trim() ||
      String(result?.video?.url || "").trim() ||
      String(result?.data?.url || "").trim() ||
      "";

    if (!videoUrl) {
      return {
        videoUrl: `mock://fal-ai/veo3.1/reference-to-video?prompt=${encodeURIComponent(scenePrompt)}`,
        provider: "fal",
        model: "fal-ai/veo3.1/reference-to-video",
        isFallback: true,
        errorMessage: "veo returned no videoUrl",
      };
    }

    return {
      videoUrl,
      provider: "fal",
      model: "fal-ai/veo3.1/reference-to-video",
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return {
      videoUrl: `mock://fal-ai/veo3.1/reference-to-video?prompt=${encodeURIComponent(scenePrompt)}`,
      provider: "fal",
      model: "fal-ai/veo3.1/reference-to-video",
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}
