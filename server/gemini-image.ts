/**
 * Vertex AI image generation service.
 * - Nano Banana 2 equivalent route: imagen-4.0-generate-001
 * - Nano Banana Pro equivalent route: gemini-3-pro-image-preview
 * Fixed region: us-central1
 */
import { storagePut } from "./storage";
import {
  baseUrlForVertex,
  extractGeneratedImage,
  fetchRemoteAssetAsBase64,
  fetchVertexJson,
  getVertexAuthHeaders,
  getVertexMediaLocation,
  getVertexProjectId,
} from "./services/vertexMedia";

export type ImageQuality = "1k" | "2k" | "4k";

export interface GeminiImageOptions {
  prompt: string;
  quality: ImageQuality;
  referenceImageUrl?: string;
}

export interface GeminiImageResult {
  imageUrl: string;
  quality: ImageQuality;
}

function pickImageModels(quality: ImageQuality) {
  const flashModel = String(process.env.VERTEX_IMAGE_MODEL_FLASH || "imagen-4.0-generate-001").trim();
  const proModel = String(process.env.VERTEX_IMAGE_MODEL_PRO || "gemini-3-pro-image-preview").trim();
  return quality === "1k" ? [flashModel, proModel] : [proModel, flashModel];
}

export async function generateGeminiImage(opts: GeminiImageOptions): Promise<GeminiImageResult> {
  const projectId = getVertexProjectId();
  const location = getVertexMediaLocation();
  const headers = await getVertexAuthHeaders();
  const baseUrl = baseUrlForVertex(location);

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
  let generated: { data: string; mimeType: string } | null = null;
  let lastError = "";

  for (const model of models) {
    const url = `${baseUrl}/v1beta1/projects/${projectId}/locations/${location}/publishers/google/models/${model}:generateContent`;
    const response = await fetchVertexJson(url, {
      method: "POST",
      headers,
      body: JSON.stringify({
        contents,
        generationConfig: {
          responseModalities: ["IMAGE"],
          imageConfig: {
            aspectRatio: "16:9",
            ...(opts.quality !== "1k" ? { imageSize: opts.quality.toUpperCase() } : {}),
          },
        },
      }),
    });

    if (!response.ok) {
      lastError = `model=${model} status=${response.status} raw=${response.rawText.slice(0, 300)}`;
      continue;
    }

    generated = extractGeneratedImage(response.json);
    if (generated) break;
    lastError = `model=${model} returned no image`;
  }

  if (!generated) {
    throw new Error(`vertex_image_failed: ${lastError}`);
  }

  const buffer = Buffer.from(generated.data, "base64");
  const mimeType = generated.mimeType || "image/png";
  const ext = mimeType.includes("jpeg") ? "jpg" : "png";
  const fileKey = `vertex-images/${opts.quality}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { url } = await storagePut(fileKey, buffer, mimeType);

  return { imageUrl: url, quality: opts.quality };
}

export function isGeminiImageAvailable() {
  return Boolean(
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim() &&
      String(process.env.VERTEX_PROJECT_ID || "").trim(),
  );
}
