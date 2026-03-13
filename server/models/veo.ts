import { put } from "@vercel/blob";

const FAL_CREATE_URL = "https://queue.fal.run/fal-ai/veo3.1/reference-to-video";
const FAL_REQUESTS_BASE_URL = "https://queue.fal.run/fal-ai/veo3.1/requests";

function falAuthHeaders(key: string) {
  return {
    Authorization: `Key ${key}`,
    "Content-Type": "application/json",
  };
}

async function parseJsonSafe(resp: Response) {
  const text = await resp.text();
  try {
    return { text, json: JSON.parse(text) as any };
  } catch {
    return { text, json: null as any };
  }
}

async function waitForFalVideoResult(requestId: string, key: string) {
  const safeRequestId = encodeURIComponent(String(requestId || "").trim());
  if (!safeRequestId) throw new Error("missing_fal_request_id");

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const statusResp = await fetch(`${FAL_REQUESTS_BASE_URL}/${safeRequestId}/status`, {
      method: "GET",
      headers: falAuthHeaders(key),
    });
    const statusBody = await parseJsonSafe(statusResp);
    if (!statusResp.ok) {
      throw new Error(
        String(statusBody?.json?.detail || statusBody?.json?.error || statusBody?.text || `fal_status_${statusResp.status}`).trim()
      );
    }

    const status = String(
      statusBody?.json?.status ||
      statusBody?.json?.state ||
      statusBody?.json?.request_status ||
      ""
    ).trim().toUpperCase();

    if (status === "COMPLETED") {
      const resultResp = await fetch(`${FAL_REQUESTS_BASE_URL}/${safeRequestId}`, {
        method: "GET",
        headers: falAuthHeaders(key),
      });
      const resultBody = await parseJsonSafe(resultResp);
      if (!resultResp.ok) {
        throw new Error(
          String(resultBody?.json?.detail || resultBody?.json?.error || resultBody?.text || `fal_result_${resultResp.status}`).trim()
        );
      }
      return resultBody.json;
    }

    if (status === "FAILED" || status === "ERROR" || status === "CANCELLED") {
      throw new Error(
        String(
          statusBody?.json?.error ||
          statusBody?.json?.detail ||
          statusBody?.json?.message ||
          status ||
          "fal_request_failed"
        ).trim()
      );
    }

    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  throw new Error("fal_request_timeout");
}

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

    const createResp = await fetch(FAL_CREATE_URL, {
      method: "POST",
      headers: falAuthHeaders(key),
      body: JSON.stringify({
        prompt: scenePrompt,
        image_urls: images,
        duration: "8s",
        resolution: "720p",
      }),
    });
    const createBody = await parseJsonSafe(createResp);
    if (!createResp.ok) {
      return {
        videoUrl: "",
        provider: "fal",
        model: "fal-ai/veo3.1/reference-to-video",
        isFallback: true,
        errorMessage: String(
          createBody?.json?.detail ||
          createBody?.json?.error ||
          createBody?.json?.message ||
          createBody?.text ||
          `fal_create_${createResp.status}`
        ).trim(),
      };
    }

    const requestId = String(
      createBody?.json?.request_id ||
      createBody?.json?.requestId ||
      createBody?.json?.id ||
      ""
    ).trim();
    if (!requestId) {
      return {
        videoUrl: "",
        provider: "fal",
        model: "fal-ai/veo3.1/reference-to-video",
        isFallback: true,
        errorMessage: "fal request_id missing",
      };
    }

    const result = await waitForFalVideoResult(requestId, key);

    const videoUrl =
      String(result?.data?.video?.url || "").trim() ||
      String(result?.video?.url || "").trim() ||
      String(result?.output?.video?.url || "").trim() ||
      String(result?.output?.url || "").trim() ||
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
