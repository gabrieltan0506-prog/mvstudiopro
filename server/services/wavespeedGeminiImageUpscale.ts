import { randomUUID } from "node:crypto";
import { deleteGcsObject, signGsUriV4ReadUrl, uploadBufferToGcs } from "./gcs.js";
import { fetchSafeRemoteImage } from "./remoteImageFetch.js";

export const WAVESPEED_GEMINI_PRO_IMAGE_EDIT_MODEL = "google/gemini-3-pro-image/edit" as const;
const WAVESPEED_IMAGE_EDIT_PATH = `/${WAVESPEED_GEMINI_PRO_IMAGE_EDIT_MODEL}`;
const POLL_INTERVAL_MS = 2_000;
const MAX_POLL_MS = 600_000;

type PredictionPayload = {
  data?: PredictionPayload;
  id?: string;
  status?: string;
  outputs?: string[];
  error?: string;
  message?: string;
};

function apiKey(): string {
  return String(process.env.WAVESPEED_API_KEY || "").trim();
}

function apiBase(): string {
  return String(process.env.WAVESPEED_API_BASE || "https://api.wavespeed.ai/api/v3")
    .trim()
    .replace(/\/+$/, "");
}

export function isWavespeedGeminiImageUpscaleConfigured(): boolean {
  return Boolean(apiKey());
}

export function buildWavespeedGeminiProImageEditBody(input: {
  prompt: string;
  sourceUrl: string;
  aspectRatio: string;
}) {
  return {
    prompt: input.prompt,
    images: [input.sourceUrl],
    aspect_ratio: input.aspectRatio,
    resolution: "4k" as const,
    output_format: "png" as const,
  };
}

function prediction(payload: PredictionPayload) {
  const value = payload?.data ?? payload;
  return {
    id: String(value?.id || "").trim(),
    status: String(value?.status || "").trim().toLowerCase(),
    outputs: Array.isArray(value?.outputs)
      ? value.outputs.map((url) => String(url || "").trim()).filter(Boolean)
      : [],
    error: String(value?.error || value?.message || payload?.message || "").trim(),
  };
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason || new Error("wavespeed_aborted"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason || new Error("wavespeed_aborted"));
    }, { once: true });
  });
}

export async function runWavespeedGeminiImageUpscale(input: {
  sourceBuffer: Buffer;
  sourceMimeType: string;
  prompt: string;
  aspectRatio: string;
  abortSignal?: AbortSignal;
}): Promise<{ buffer: Buffer; mimeType: string; predictionId: string }> {
  const key = apiKey();
  if (!key) throw new Error("missing_WAVESPEED_API_KEY");
  if (!input.sourceBuffer.length) throw new Error("wavespeed_empty_source");

  const extension = input.sourceMimeType.includes("jpeg") ? "jpg"
    : input.sourceMimeType.includes("webp") ? "webp"
      : "png";
  const objectName = `temporary/image-upscale/wavespeed-${randomUUID()}.${extension}`;
  const uploaded = await uploadBufferToGcs({
    objectName,
    buffer: input.sourceBuffer,
    contentType: input.sourceMimeType,
  });
  const sourceUrl = signGsUriV4ReadUrl(uploaded.gcsUri, 3_600);
  let cleanupTemporarySource = true;

  try {
    let createResponse: Response;
    try {
      createResponse = await fetch(`${apiBase()}${WAVESPEED_IMAGE_EDIT_PATH}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(buildWavespeedGeminiProImageEditBody({
          prompt: input.prompt,
          sourceUrl,
          aspectRatio: input.aspectRatio,
        })),
        signal: requestSignal(input.abortSignal, 60_000),
      });
    } catch (error) {
      cleanupTemporarySource = false;
      throw new Error(`wavespeed_create_ambiguous:${error instanceof Error ? error.message : String(error)}`);
    }

    const createBody = (await createResponse.json().catch(() => ({}))) as PredictionPayload;
    const created = prediction(createBody);
    if (!createResponse.ok || !created.id) {
      if (createResponse.status >= 500 || createResponse.status === 408 || createResponse.status === 429) {
        cleanupTemporarySource = false;
        throw new Error(`wavespeed_create_ambiguous:http_${createResponse.status}`);
      }
      throw new Error(created.error || `wavespeed_create_failed:${createResponse.status}`);
    }

    const predictionId = created.id;
    const resultUrl = `${apiBase()}/predictions/${encodeURIComponent(predictionId)}/result`;
    const startedAt = Date.now();
    while (Date.now() - startedAt < MAX_POLL_MS) {
      await wait(POLL_INTERVAL_MS, input.abortSignal);
      let response: Response;
      try {
        response = await fetch(resultUrl, {
          headers: { Authorization: `Bearer ${key}` },
          signal: requestSignal(input.abortSignal, 60_000),
        });
      } catch (error) {
        cleanupTemporarySource = false;
        throw new Error(`wavespeed_poll_ambiguous:${predictionId}:${error instanceof Error ? error.message : String(error)}`);
      }
      if (!response.ok) {
        cleanupTemporarySource = false;
        throw new Error(`wavespeed_poll_ambiguous:${predictionId}:http_${response.status}`);
      }
      const snap = prediction((await response.json().catch(() => ({}))) as PredictionPayload);
      if (snap.status === "completed") {
        const outputUrl = snap.outputs[0];
        if (!outputUrl) throw new Error("wavespeed_completed_without_output");
        const output = await fetchSafeRemoteImage({
          imageUrl: outputUrl,
          maxBytes: 80 * 1024 * 1024,
          userAgent: "mvstudiopro/1.0 (+wavespeed-image-upscale-output)",
          abortSignal: input.abortSignal,
        });
        return {
          buffer: output.buffer,
          mimeType: output.contentType || "image/png",
          predictionId,
        };
      }
      if (["failed", "cancelled", "timeout"].includes(snap.status)) {
        throw new Error(snap.error || `wavespeed_task_${snap.status}`);
      }
      if (snap.status && !["created", "processing", "queued", "running"].includes(snap.status)) {
        cleanupTemporarySource = false;
        throw new Error(`wavespeed_poll_ambiguous:${predictionId}:status_${snap.status}`);
      }
    }

    cleanupTemporarySource = false;
    throw new Error(`wavespeed_poll_timeout_ambiguous:${predictionId}`);
  } finally {
    if (cleanupTemporarySource) {
      await deleteGcsObject({
        bucket: uploaded.bucket,
        objectName: uploaded.objectName,
      }).catch((error) => {
        console.warn("[wavespeedImageUpscale] temporary source cleanup failed", error instanceof Error ? error.message : error);
      });
    }
  }
}
