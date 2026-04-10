/**
 * Veo 3.1 Video Generation Service
 * Vertex AI only, fixed to us-central1.
 */
import { nanoid } from "nanoid";
import { storagePut } from "./storage";
import {
  baseUrlForVertex,
  extractVideoOperationName,
  extractVideoUrl,
  fetchRemoteAssetAsBase64,
  fetchVertexJson,
  getVertexAuthHeaders,
  getVertexMediaLocation,
  getVertexProjectId,
  normalizePredictOperationName,
} from "./services/vertexMedia";

export interface VeoGenerateOptions {
  prompt: string;
  imageUrl?: string;
  quality?: "fast" | "standard";
  aspectRatio?: "16:9" | "9:16";
  resolution?: "720p" | "1080p";
  negativePrompt?: string;
}

export interface VeoResult {
  videoUrl: string;
  mimeType: string;
}

function pickVeoModel(quality: VeoGenerateOptions["quality"]) {
  if (quality === "fast") {
    return String(process.env.VERTEX_VEO_MODEL_FAST || "veo-3.1-fast-generate-001").trim();
  }
  return String(process.env.VERTEX_VEO_MODEL_STANDARD || "veo-3.1-generate-001").trim();
}

export async function generateVideo(opts: VeoGenerateOptions): Promise<VeoResult> {
  const projectId = getVertexProjectId();
  const location = getVertexMediaLocation();
  const model = pickVeoModel(opts.quality);
  const baseUrl = baseUrlForVertex(location);
  const headers = await getVertexAuthHeaders();

  const image = opts.imageUrl ? await fetchRemoteAssetAsBase64(opts.imageUrl) : null;
  const url = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:predictLongRunning`;

  const createResp = await fetchVertexJson(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      instances: [
        {
          prompt: opts.prompt,
          ...(image
            ? { image: { bytesBase64Encoded: image.base64, mimeType: image.mimeType } }
            : {}),
        },
      ],
      parameters: {
        aspectRatio: opts.aspectRatio || "16:9",
        resolution: opts.resolution || "720p",
        durationSeconds: 8,
        generateAudio: false,
        upscale: false,
        ...(opts.negativePrompt ? { negativePrompt: opts.negativePrompt } : {}),
      },
    }),
  });

  if (!createResp.ok) {
    throw new Error(`vertex_veo_create_failed_${createResp.status}: ${createResp.rawText.slice(0, 500)}`);
  }

  const operationName = extractVideoOperationName(createResp.json);
  if (!operationName) {
    throw new Error("vertex_veo_missing_operation_name");
  }

  const pollUrl = `${baseUrl}/v1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:fetchPredictOperation`;
  const startedAt = Date.now();
  let videoUrl = "";
  let raw: any = null;

  while (Date.now() - startedAt < 300_000) {
    await new Promise((resolve) => setTimeout(resolve, 10_000));

    const pollResp = await fetchVertexJson(pollUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        operationName: normalizePredictOperationName(operationName, projectId, model),
      }),
    });

    if (!pollResp.ok) {
      throw new Error(`vertex_veo_poll_failed_${pollResp.status}: ${pollResp.rawText.slice(0, 500)}`);
    }

    raw = pollResp.json;
    videoUrl = extractVideoUrl(raw);
    if (raw?.done && raw?.error) {
      throw new Error(`vertex_veo_failed: ${JSON.stringify(raw.error)}`);
    }
    if (videoUrl) break;
  }

  if (!videoUrl) {
    throw new Error(`vertex_veo_timeout: ${JSON.stringify(raw || {})}`.slice(0, 800));
  }

  const downloadResp = await fetch(videoUrl);
  if (!downloadResp.ok) {
    throw new Error(`vertex_veo_download_failed_${downloadResp.status}`);
  }

  const buffer = Buffer.from(await downloadResp.arrayBuffer());
  if (!buffer.length) {
    throw new Error("vertex_veo_empty_video");
  }

  const fileKey = `veo-videos/${nanoid(12)}.mp4`;
  const { url: persistedUrl } = await storagePut(fileKey, buffer, "video/mp4");

  return { videoUrl: persistedUrl, mimeType: "video/mp4" };
}

export function isVeoAvailable() {
  return Boolean(
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() &&
      String(process.env.VERTEX_PROJECT_ID || "").trim(),
  );
}
