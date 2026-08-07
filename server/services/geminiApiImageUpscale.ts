import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { persistPlatformGeneratedImagePublicUrl } from "../gemini-image.js";
import {
  fetchSafeRemoteImage,
  isPrivateOrReservedAddress,
  isTrustedBlobBearerHost,
} from "./remoteImageFetch.js";

export { isPrivateOrReservedAddress, isTrustedBlobBearerHost };

const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

export type GeminiApiUpscaleFactor = "x2" | "x4";
export type GeminiApiImageSize = "2K" | "4K";

type SupportedAspectRatio =
  | "1:1"
  | "2:3"
  | "3:2"
  | "3:4"
  | "4:3"
  | "4:5"
  | "5:4"
  | "9:16"
  | "16:9"
  | "21:9";

export type GeminiApiUpscaleSpec = {
  factor: GeminiApiUpscaleFactor;
  model: "gemini-3.1-flash-image" | "gemini-3-pro-image";
  imageSize: GeminiApiImageSize;
  prompt: string;
};

export type GeminiApiImageUpscaleResult = {
  ok: boolean;
  imageUrl?: string;
  inputWidth?: number;
  inputHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  error?: string;
};

const SUPPORTED_ASPECT_RATIOS: ReadonlyArray<{
  label: SupportedAspectRatio;
  value: number;
}> = [
  { label: "1:1", value: 1 },
  { label: "2:3", value: 2 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "3:4", value: 3 / 4 },
  { label: "4:3", value: 4 / 3 },
  { label: "4:5", value: 4 / 5 },
  { label: "5:4", value: 5 / 4 },
  { label: "9:16", value: 9 / 16 },
  { label: "16:9", value: 16 / 9 },
  { label: "21:9", value: 21 / 9 },
];

export function isGeminiApiImageUpscaleConfigured(): boolean {
  return Boolean(String(process.env.GEMINI_API_KEY || "").trim());
}

export function resolveGeminiApiUpscaleSpec(
  factor: GeminiApiUpscaleFactor,
): GeminiApiUpscaleSpec {
  if (factor === "x4") {
    return {
      factor,
      model: "gemini-3-pro-image",
      imageSize: "4K",
      prompt:
        "对输入图片进行忠实的 4K 高清增强。严格保留原始构图、人物身份、五官、表情、姿势、文字、物体、色彩、光线和纹理；不得添加、删除、移动、重绘或重新构图任何内容。仅修复压缩噪点、轻微模糊和锯齿，恢复可信的细节与清晰边缘。输出一张与原图内容一致的商业级高清图片，不要输出说明文字。",
    };
  }

  return {
    factor,
    model: "gemini-3.1-flash-image",
    imageSize: "2K",
    prompt:
      "对输入图片进行忠实的 2K 高清增强。严格保留原始构图、人物身份、五官、表情、姿势、文字、物体、色彩、光线和纹理；不得添加、删除、移动、重绘或重新构图任何内容。仅降低噪点、轻微模糊和锯齿，提升整体清晰度与边缘质量。输出一张与原图内容一致的高清图片，不要输出说明文字。",
  };
}

export function nearestGeminiImageAspectRatio(
  width: number,
  height: number,
): SupportedAspectRatio {
  const ratio = width / Math.max(1, height);
  return SUPPORTED_ASPECT_RATIOS.reduce((best, candidate) =>
    Math.abs(candidate.value - ratio) < Math.abs(best.value - ratio)
      ? candidate
      : best,
  ).label;
}

export function buildGeminiApiUpscaleConfig(
  spec: GeminiApiUpscaleSpec,
  aspectRatio: SupportedAspectRatio,
) {
  return {
    httpOptions: {
      timeout: spec.imageSize === "4K" ? 180_000 : 120_000,
    },
    responseModalities: ["IMAGE"] as string[],
    imageConfig: {
      imageSize: spec.imageSize,
      aspectRatio,
    },
  };
}

function normalizeMimeType(raw: string): "image/png" | "image/jpeg" | "image/webp" {
  const value = raw.toLowerCase();
  if (value.includes("webp")) return "image/webp";
  if (value.includes("jpeg") || value.includes("jpg")) return "image/jpeg";
  return "image/png";
}

async function fetchSourceImage(imageUrl: string): Promise<{ buffer: Buffer; mimeType: string }> {
  const source = await fetchSafeRemoteImage({
    imageUrl,
    maxBytes: MAX_SOURCE_BYTES,
    userAgent: "mvstudiopro/1.0 (+gemini-image-upscale)",
  });
  return {
    buffer: source.buffer,
    mimeType: source.contentType,
  };
}

function firstGeneratedImage(response: unknown): { buffer: Buffer; mimeType: string } | null {
  const parts = (response as any)?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    const data = String(part?.inlineData?.data || "").trim();
    if (!data) continue;
    return {
      buffer: Buffer.from(data, "base64"),
      mimeType: String(part?.inlineData?.mimeType || "image/png"),
    };
  }
  return null;
}

export async function runGeminiApiImageUpscale(input: {
  imageUrl: string;
  upscaleFactor: GeminiApiUpscaleFactor;
}): Promise<GeminiApiImageUpscaleResult> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return { ok: false, error: "missing_GEMINI_API_KEY" };

  try {
    const source = await fetchSourceImage(input.imageUrl);
    const originalMetadata = await sharp(source.buffer, { failOn: "none" }).metadata();
    const originalFormat = String(originalMetadata.format || "").toLowerCase();
    const normalized = ["png", "jpeg", "jpg", "webp"].includes(originalFormat)
      ? await sharp(source.buffer, { failOn: "none" }).rotate().toBuffer()
      : await sharp(source.buffer, { failOn: "none" }).rotate().png().toBuffer();
    const sourceMetadata = await sharp(normalized, { failOn: "none" }).metadata();
    const inputWidth = Number(sourceMetadata.width || 0);
    const inputHeight = Number(sourceMetadata.height || 0);
    if (!inputWidth || !inputHeight) throw new Error("invalid_input_dimensions");

    const spec = resolveGeminiApiUpscaleSpec(input.upscaleFactor);
    const aspectRatio = nearestGeminiImageAspectRatio(inputWidth, inputHeight);
    const mimeType = normalizeMimeType(sourceMetadata.format || source.mimeType);
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: spec.model,
      contents: [
        { text: spec.prompt },
        {
          inlineData: {
            data: normalized.toString("base64"),
            mimeType,
          },
        },
      ],
      config: buildGeminiApiUpscaleConfig(spec, aspectRatio),
    });

    const generated = firstGeneratedImage(response);
    if (!generated?.buffer.length) throw new Error("gemini_api_no_image");
    if (generated.buffer.length > 80 * 1024 * 1024) {
      throw new Error("generated_image_too_large");
    }

    const outputMetadata = await sharp(generated.buffer, { failOn: "none" }).metadata();
    const outputWidth = Number(outputMetadata.width || 0);
    const outputHeight = Number(outputMetadata.height || 0);
    if (!outputWidth || !outputHeight) throw new Error("invalid_output_dimensions");

    const persistedUrl = await persistPlatformGeneratedImagePublicUrl(
      generated.buffer,
      generated.mimeType,
      undefined,
      `gemini_api_upscale/${spec.imageSize.toLowerCase()}-${randomUUID().slice(0, 8)}`,
    );
    if (!String(persistedUrl || "").trim()) throw new Error("empty_persisted_url");

    return {
      ok: true,
      imageUrl: persistedUrl,
      inputWidth,
      inputHeight,
      outputWidth,
      outputHeight,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "gemini_upscale_failed",
    };
  }
}
