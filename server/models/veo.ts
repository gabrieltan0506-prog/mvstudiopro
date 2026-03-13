import { put } from "@vercel/blob";

async function uploadVideoToMvspBlob(videoUrl: string) {
  const sourceUrl = String(videoUrl || "").trim();
  if (!sourceUrl) throw new Error("videoUrl is required");

  const token = String(process.env.MVSP_READ_WRITE_TOKEN || "").trim();
  if (!token) throw new Error("missing_env_MVSP_READ_WRITE_TOKEN");

  const resp = await fetch(sourceUrl);
  if (!resp.ok) throw new Error(`failed_to_fetch_generated_video_${resp.status}`);

  const buf = Buffer.from(await resp.arrayBuffer());
  if (!buf.length) throw new Error("generated_video_is_empty");

  const blob = await put(`scene-videos/${Date.now()}-scene-video.mp4`, buf, {
    access: "public",
    token,
    contentType: "video/mp4",
  });

  return String(blob.url || "").trim();
}

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
      videoUrl: "",
      provider: "fal",
      model: "fal-ai/veo3.1/reference-to-video",
      isFallback: true,
      errorMessage: "FAL_API_KEY/FAL_KEY is not configured",
    };
  }

  try {
    const { fal } = await import("@fal-ai/client");
    fal.config({ credentials: key });

    const images = Array.from(
      new Set([...(input.referenceImages || []), ...(input.imageUrls || [])].map((value) => String(value || "").trim()))
    ).filter(Boolean);

    if (!images.length) {
      return {
        videoUrl: "",
        provider: "fal",
        model: "fal-ai/veo3.1/reference-to-video",
        isFallback: true,
        errorMessage: "reference image is required",
      };
    }

    const result = (await fal.subscribe("fal-ai/veo3.1/reference-to-video", {
      input: {
        prompt: scenePrompt,
        image_urls: images,
        duration: "8s",
        resolution: "720p",
      } as any,
      logs: false,
    })) as any;

    const videoUrl =
      String(result?.data?.video?.url || "").trim() ||
      String(result?.video?.url || "").trim() ||
      String(result?.data?.url || "").trim() ||
      "";

    if (!videoUrl) {
      return {
        videoUrl: "",
        provider: "fal",
        model: "fal-ai/veo3.1/reference-to-video",
        isFallback: true,
        errorMessage: "veo returned no videoUrl",
      };
    }

    const persistedVideoUrl = await uploadVideoToMvspBlob(videoUrl);

    return {
      videoUrl: persistedVideoUrl,
      provider: "fal",
      model: "fal-ai/veo3.1/reference-to-video",
      isFallback: false,
      errorMessage: "",
    };
  } catch (error: any) {
    return {
      videoUrl: "",
      provider: "fal",
      model: "fal-ai/veo3.1/reference-to-video",
      isFallback: true,
      errorMessage: error?.message || String(error),
    };
  }
}
