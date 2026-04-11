/**
 * Vertex AI image generation service.
 * - Nano Banana route: gemini-3.1-flash-image-preview @ global
 * - Nano Banana Pro route: gemini-3-pro-image-preview @ global
 */
import { storagePut } from "./storage";
import {
  baseUrlForVertex,
  extractGeneratedImage,
  fetchRemoteAssetAsBase64,
  fetchVertexJson,
  getVertexAuthHeaders,
  getVertexImageFlashLocation,
  getVertexImageProLocation,
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

function pickImageModels(quality: ImageQuality) {
  const flashModel = String(process.env.VERTEX_IMAGE_MODEL_FLASH || "gemini-3.1-flash-image-preview").trim();
  const proModel = String(process.env.VERTEX_IMAGE_MODEL_PRO || "gemini-3-pro-image-preview").trim();
  return quality === "1k" ? [flashModel, proModel] : [proModel, flashModel];
}

function shouldRetryVertexImage(status: number, json: any, rawText: string) {
  const message = String(json?.error?.status || json?.error?.message || rawText || "").toUpperCase();
  return status === 429 || message.includes("RESOURCE_EXHAUSTED");
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

  const models = pickImageModels(opts.quality);
  const proModel = String(process.env.VERTEX_IMAGE_MODEL_PRO || "gemini-3-pro-image-preview").trim();
  let generated: { data: string; mimeType: string }[] | null = null;
  let selectedModel = "";
  let selectedLocation = "";
  let lastError = "";

  for (const model of models) {
    const location = model === proModel
      ? getVertexImageProLocation()
      : getVertexImageFlashLocation();
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
    const ext = mimeType.includes("jpeg") ? "jpg" : "png";
    const fileKey = `vertex-images/${opts.quality}/${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { url } = await storagePut(fileKey, buffer, mimeType);
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
