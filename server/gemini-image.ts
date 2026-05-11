/**
 * Vertex AI image generation（平台政策：**僅 Nano Banana 2**，`gemini-3.1-flash-image-preview`）。
 * 與 **`VERTEX_IMAGE_MODEL_FLASH`** 對應區域：`getVertexImageFlashLocation`。
 * 像素主路徑另可走 OhMyGPT **GPT-IMAGE-2**（見 proxyImageService）；本模組不調用 `gemini-3-pro-image-preview`。
 */
import { storagePut } from "./storage";
import {
  baseUrlForVertex,
  extractGeneratedImage,
  fetchRemoteAssetAsBase64,
  fetchVertexJson,
  getVertexAuthHeaders,
  getVertexImageFlashLocation,
  getVertexProjectId,
} from "./services/vertexMedia";

export type ImageQuality = "1k" | "2k" | "4k";

export interface GeminiImageOptions {
  prompt: string;
  quality: ImageQuality;
  referenceImageUrl?: string;
  negativePrompt?: string;
  aspectRatio?: "1:1" | "16:9" | "9:16" | "4:3" | "3:4";
  numberOfImages?: number;
  guidanceScale?: number;
  seed?: number;
  personGeneration?: "DONT_ALLOW" | "ALLOW_ADULT" | "ALLOW_ALL";
}

export interface GeminiImageResult {
  imageUrl: string;
  imageUrls?: string[];
  quality: ImageQuality;
  model?: string;
  location?: string;
}

/** 僅 Nano Banana 2（Flash）；不串 Pro。`quality` 仍影響 Vertex `imageSize`（建議平台路徑傳 `2k`）。 */
function resolveVertexNanoImageModelAndIds(): string[] {
  const flashModel = String(process.env.VERTEX_IMAGE_MODEL_FLASH || "gemini-3.1-flash-image-preview").trim();
  return flashModel ? [flashModel] : ["gemini-3.1-flash-image-preview"];
}

function shouldRetryVertexImage(status: number, json: any, rawText: string) {
  const message = String(json?.error?.status || json?.error?.message || rawText || "").toUpperCase();
  return status === 429 || message.includes("RESOURCE_EXHAUSTED");
}

function extFromVertexMime(mimeType: string): "jpg" | "png" | "webp" {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("webp")) return "webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  return "png";
}

function normalizeVertexPersistContentType(mimeType: string): string {
  const m = String(mimeType || "").toLowerCase();
  if (m.includes("webp")) return "image/webp";
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  return "image/png";
}

/**
 * Vertex inlineData → 瀏覽器可讀 URL（與平台 GPT-IMAGE-2 存圖一致：Fly 公開或 GCS V4 簽名）。
 * 若先走 {@link storagePut} 到私密 R2，後續 {@link mirrorImageUrlToGcsSignedUrl} 匿名 fetch 會 403，前端也無法載入。
 */
async function persistVertexInlineImagePublicUrl(buffer: Buffer, mimeType: string): Promise<string> {
  const ct = normalizeVertexPersistContentType(mimeType);
  const ext = extFromVertexMime(mimeType);
  const subdir = "vertex_nano";

  try {
    const { resolvePlatformImageStorageDriver } = await import("./config/platformSwitches.js");
    if (resolvePlatformImageStorageDriver() === "fly") {
      const { writeFlyPlatformImageBuffer, buildFlyPlatformImagePublicUrl } = await import(
        "./services/flyVolumeGeneratedImages.js",
      );
      const flyCt: "image/jpeg" | "image/png" | "image/webp" =
        ct === "image/webp" ? "image/webp" : ct === "image/png" ? "image/png" : "image/jpeg";
      const { relPath } = await writeFlyPlatformImageBuffer({
        subdir,
        buffer,
        contentType: flyCt,
      });
      return buildFlyPlatformImagePublicUrl(relPath);
    }
  } catch (e: unknown) {
    console.warn("[gemini-image] Fly persist failed, trying GCS", e instanceof Error ? e.message : e);
  }

  try {
    const { uploadBufferToGcs, signGsUriV4ReadUrl } = await import("./services/gcs.js");
    const objectName = `generated/${subdir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { gcsUri } = await uploadBufferToGcs({
      objectName,
      buffer,
      contentType: ct,
    });
    return await signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
  } catch (e: unknown) {
    console.warn("[gemini-image] GCS persist failed, falling back to storagePut", e instanceof Error ? e.message : e);
  }

  const fileKey = `vertex-images/inline/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { url } = await storagePut(fileKey, buffer, ct);
  return url;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateGeminiImage(opts: GeminiImageOptions): Promise<GeminiImageResult> {
  const projectId = getVertexProjectId();
  const headers = await getVertexAuthHeaders();

  const reference = opts.referenceImageUrl
    ? await fetchRemoteAssetAsBase64(opts.referenceImageUrl)
    : null;

  const contents = [
    {
      role: "user",
      parts: [
        ...(reference
          ? [{ inlineData: { data: reference.base64, mimeType: reference.mimeType } }]
          : []),
        { text: opts.prompt },
      ],
    },
  ];

  const modelIds = resolveVertexNanoImageModelAndIds();
  let generated: { data: string; mimeType: string }[] | null = null;
  let selectedModel = "";
  let selectedLocation = "";
  let lastError = "";

  const location = getVertexImageFlashLocation();

  for (const model of modelIds) {
    const baseUrl = baseUrlForVertex(location);
    const url = `${baseUrl}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    let response = await fetchVertexJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents,
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: opts.aspectRatio || "16:9",
            ...(typeof opts.numberOfImages === "number" ? { numberOfImages: Math.max(1, Math.min(4, Math.floor(opts.numberOfImages))) } : {}),
            ...(typeof opts.seed === "number" ? { seed: Math.floor(opts.seed) } : {}),
            ...(opts.personGeneration ? { personGeneration: opts.personGeneration } : {}),
            ...(opts.quality !== "1k" ? { imageSize: opts.quality.toUpperCase() } : {}),
          },
        },
      }),
    });

    for (let attempt = 0; attempt < 4 && shouldRetryVertexImage(response.status, response.json, response.rawText); attempt += 1) {
      await sleep((2 ** attempt) * 1000 + Math.floor(Math.random() * 300));
      response = await fetchVertexJson(url, {
        method: "POST",
        headers,
        body: JSON.stringify({
          contents,
          generationConfig: {
            responseModalities: ["IMAGE"],
            imageConfig: {
              aspectRatio: opts.aspectRatio || "16:9",
              ...(typeof opts.numberOfImages === "number" ? { numberOfImages: Math.max(1, Math.min(4, Math.floor(opts.numberOfImages))) } : {}),
              ...(typeof opts.seed === "number" ? { seed: Math.floor(opts.seed) } : {}),
              ...(opts.personGeneration ? { personGeneration: opts.personGeneration } : {}),
              ...(opts.quality !== "1k" ? { imageSize: opts.quality.toUpperCase() } : {}),
            },
          },
        }),
      });
    }

    if (!response.ok) {
      lastError = `model=${model} status=${response.status} raw=${response.rawText.slice(0, 300)}`;
      continue;
    }

    const parts = response.json?.candidates?.[0]?.content?.parts;
    const images = Array.isArray(parts)
      ? parts
          .filter((part: any) => part?.inlineData?.data)
          .map((part: any) => ({
            data: String(part.inlineData.data),
            mimeType: String(part.inlineData.mimeType || "image/png"),
          }))
      : [];
    if (images.length) {
      generated = images;
      selectedModel = model;
      selectedLocation = location;
      break;
    }
    lastError = `model=${model} returned no image`;
  }

  if (!generated) {
    throw new Error(`vertex_image_failed: ${lastError}`);
  }

  const imageUrls: string[] = [];
  for (let index = 0; index < generated.length; index += 1) {
    const image = generated[index];
    const buffer = Buffer.from(image.data, "base64");
    const mimeType = image.mimeType || "image/png";
    const url = await persistVertexInlineImagePublicUrl(buffer, mimeType);
    imageUrls.push(url);
  }

  return {
    imageUrl: imageUrls[0] || "",
    imageUrls,
    quality: opts.quality,
    model: selectedModel,
    location: selectedLocation,
  };
}

export function isGeminiImageAvailable() {
  return Boolean(
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() &&
      String(process.env.VERTEX_PROJECT_ID || "").trim(),
  );
}
