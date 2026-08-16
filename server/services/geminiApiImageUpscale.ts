import { randomUUID } from "node:crypto";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import {
  generateGeminiImage,
  isGeminiImageAvailable,
  persistPlatformGeneratedImagePublicUrl,
  VERTEX_NANO_BANANA_2_MODEL,
  VERTEX_NANO_BANANA_PRO_MODEL,
} from "../gemini-image.js";
import {
  isOpenRouterGptImage2Configured,
  postOpenRouterGptImage2AndUpload,
} from "./openrouterGptImage2.js";
import {
  EVOLINK_NANO_BANANA_PRO_MODEL,
  isEvolinkGptImage2Configured,
  postEvolinkGptImage2AndUpload,
} from "./evolinkGptImage2.js";
import {
  fetchSafeRemoteImage,
  isPrivateOrReservedAddress,
  isTrustedBlobBearerHost,
} from "./remoteImageFetch.js";
import {
  isWavespeedGeminiImageUpscaleConfigured,
  runWavespeedGeminiImageUpscale,
  WAVESPEED_GEMINI_PRO_IMAGE_EDIT_MODEL,
} from "./wavespeedGeminiImageUpscale.js";

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
  /** Nano Banana 2（2×）/ Nano Banana Pro（4×）对应 Gemini API 模型 ID */
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
  provider?: ImageUpscaleProvider;
  model?: string;
  attempts?: ImageUpscaleAttempt[];
  error?: string;
};

export type ImageUpscaleProvider =
  | "vertex"
  | "wavespeed"
  | "openrouter"
  | "evolink"
  | "gemini_api";

export type ImageUpscaleAttempt = {
  provider: ImageUpscaleProvider;
  model: string;
  ok: boolean;
  error?: string;
};

export type ImageUpscaleRoute = {
  factor: GeminiApiUpscaleFactor;
  imageSize: GeminiApiImageSize;
  providerOrder: readonly ImageUpscaleProvider[];
  models: Record<ImageUpscaleProvider, string>;
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

function isImageUpscaleProviderConfigured(provider: ImageUpscaleProvider): boolean {
  if (provider === "vertex") return isGeminiImageAvailable();
  if (provider === "wavespeed") return isWavespeedGeminiImageUpscaleConfigured();
  if (provider === "openrouter") return isOpenRouterGptImage2Configured();
  if (provider === "evolink") return isEvolinkGptImage2Configured();
  return isGeminiApiImageUpscaleConfigured();
}

/** 只按该倍率的固定路由判断能否接单，避免先扣费、执行时才发现该档无供应商。 */
export function getConfiguredImageUpscaleProviders(
  factor: GeminiApiUpscaleFactor,
): ImageUpscaleProvider[] {
  return resolveImageUpscaleRoute(factor).providerOrder.filter(isImageUpscaleProviderConfigured);
}

export function isImageUpscaleConfigured(factor: GeminiApiUpscaleFactor): boolean {
  return getConfiguredImageUpscaleProviders(factor).length > 0;
}

export function resolveImageUpscaleRoute(
  factor: GeminiApiUpscaleFactor,
): ImageUpscaleRoute {
  if (factor === "x4") {
    return {
      factor,
      imageSize: "4K",
      // 4K 最终顺序：Vertex 稳定 Pro → WaveSpeed Pro Edit → EvoLink Pro。
      // OpenRouter 已真实 403 TOS，Gemini API 不属于这条 4K 链，均不得回落。
      providerOrder: ["vertex", "wavespeed", "evolink"],
      models: {
        wavespeed: WAVESPEED_GEMINI_PRO_IMAGE_EDIT_MODEL,
        openrouter: "google/gemini-3-pro-image",
        evolink: EVOLINK_NANO_BANANA_PRO_MODEL,
        vertex: VERTEX_NANO_BANANA_PRO_MODEL,
        gemini_api: "gemini-3-pro-image",
      },
    };
  }
  return {
    factor,
    imageSize: "2K",
    providerOrder: ["vertex", "openrouter", "gemini_api"],
    models: {
      vertex: VERTEX_NANO_BANANA_2_MODEL,
      wavespeed: WAVESPEED_GEMINI_PRO_IMAGE_EDIT_MODEL,
      openrouter: "google/gemini-3.1-flash-image",
      evolink: EVOLINK_NANO_BANANA_PRO_MODEL,
      gemini_api: "gemini-3.1-flash-image",
    },
  };
}

/**
 * 2× → Nano Banana 2（gemini-3.1-flash-image / 2K）
 * 4× → Nano Banana Pro（gemini-3-pro-image / 4K）
 * 走 Gemini API Key，不走 Vertex Imagen。
 */
export function resolveGeminiApiUpscaleSpec(
  factor: GeminiApiUpscaleFactor,
): GeminiApiUpscaleSpec {
  if (factor === "x4") {
    return {
      factor,
      model: "gemini-3-pro-image",
      imageSize: "4K",
      prompt:
        "Upscale this image to 4K resolution (4x). Preserve all original textures, lighting, and fine details. Enhance sharpness and output a commercial-grade image. Do not change identity, composition, text, or add/remove objects. Output the image only.",
    };
  }

  return {
    factor,
    model: "gemini-3.1-flash-image",
    imageSize: "2K",
    prompt:
      "Upscale this image to 2K resolution (2x). Enhance overall clarity and denoise while preserving the original visual style. Do not change identity, composition, text, or add/remove objects. Output the image only.",
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

/** imageConfig 强制 2K/4K；本地 demo 脚本常漏此项，线上必须保留。 */
export function buildGeminiApiUpscaleConfig(
  spec: GeminiApiUpscaleSpec,
  aspectRatio: SupportedAspectRatio,
  abortSignal?: AbortSignal,
) {
  return {
    httpOptions: {
      // 异步任务后台跑：2K 给 5 分钟、4K 给 8 分钟；同步 HTTP 路径不应再卡满等待。
      timeout: spec.imageSize === "4K" ? 480_000 : 300_000,
    },
    responseModalities: ["IMAGE"] as string[],
    ...(abortSignal ? { abortSignal } : {}),
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

async function fetchSourceImage(
  imageUrl: string,
  abortSignal?: AbortSignal,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const source = await fetchSafeRemoteImage({
    imageUrl,
    maxBytes: MAX_SOURCE_BYTES,
    userAgent: "mvstudiopro/1.0 (+gemini-image-upscale)",
    abortSignal,
  });
  return {
    buffer: source.buffer,
    mimeType: source.contentType,
  };
}

function expectedLongEdge(imageSize: GeminiApiImageSize): number {
  return imageSize === "4K" ? 3_800 : 1_900;
}

/** 输出必须达到目标 2K/4K 档，且任一边都不能比输入更小。 */
export function hasValidImageUpscaleDimensions(input: {
  imageSize: GeminiApiImageSize;
  inputWidth?: number;
  inputHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
}): boolean {
  const inputWidth = Number(input.inputWidth || 0);
  const inputHeight = Number(input.inputHeight || 0);
  const outputWidth = Number(input.outputWidth || 0);
  const outputHeight = Number(input.outputHeight || 0);
  if (
    !Number.isFinite(inputWidth) ||
    !Number.isFinite(inputHeight) ||
    !Number.isFinite(outputWidth) ||
    !Number.isFinite(outputHeight) ||
    inputWidth <= 0 ||
    inputHeight <= 0 ||
    outputWidth <= 0 ||
    outputHeight <= 0
  ) {
    return false;
  }
  return (
    Math.max(outputWidth, outputHeight) >= expectedLongEdge(input.imageSize) &&
    outputWidth >= inputWidth &&
    outputHeight >= inputHeight
  );
}

/** 请求结果不确定时不可继续创建下一家任务，否则同一张图可能在多家同时计费。 */
export function isAmbiguousImageUpscaleError(message: string | undefined): boolean {
  const text = String(message || "").trim();
  if (!text || text.startsWith("evolink_input_not_provider_readable:")) return false;
  return /ambiguous|timeout|timed out|abort(?:ed)?|ETIMEDOUT|ECONNRESET|socket hang up|request terminated/i.test(
    text,
  );
}

async function inspectRemoteImageDimensions(imageUrl: string, abortSignal?: AbortSignal) {
  const image = await fetchSafeRemoteImage({
    imageUrl,
    maxBytes: 80 * 1024 * 1024,
    userAgent: "mvstudiopro/1.0 (+image-upscale-output-check)",
    abortSignal,
  });
  const metadata = await sharp(image.buffer, { failOn: "none" }).metadata();
  return {
    width: Number(metadata.width || 0),
    height: Number(metadata.height || 0),
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
  abortSignal?: AbortSignal;
}): Promise<GeminiApiImageUpscaleResult> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) return { ok: false, error: "missing_GEMINI_API_KEY" };

  try {
    const source = await fetchSourceImage(input.imageUrl, input.abortSignal);
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
    console.info(
      `[geminiApi.upscale] start factor=${spec.factor} model=${spec.model} target=${spec.imageSize} aspect=${aspectRatio} input=${inputWidth}x${inputHeight}`,
    );

    // Gemini API Key（GoogleGenAI），与探针/用户脚本同一主链；非 Vertex Imagen。
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: spec.model,
      contents: [
        spec.prompt,
        {
          inlineData: {
            data: normalized.toString("base64"),
            mimeType,
          },
        },
      ],
      config: buildGeminiApiUpscaleConfig(spec, aspectRatio, input.abortSignal),
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

    console.info(
      `[geminiApi.upscale] ok factor=${spec.factor} model=${spec.model} output=${outputWidth}x${outputHeight}`,
    );

    return {
      ok: true,
      imageUrl: persistedUrl,
      inputWidth,
      inputHeight,
      outputWidth,
      outputHeight,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "gemini_upscale_failed";
    console.error(`[geminiApi.upscale] failed`, message);
    return {
      ok: false,
      error: message,
    };
  }
}

/**
 * 统一高清放大：每次只允许一个供应商在执行，失败后才进入下一条。
 * 4K 永远只使用 Pro Image；2K 才使用 Flash Image。
 */
export async function runImageUpscaleWithFallback(input: {
  imageUrl: string;
  upscaleFactor: GeminiApiUpscaleFactor;
  abortSignal?: AbortSignal;
}): Promise<GeminiApiImageUpscaleResult> {
  const route = resolveImageUpscaleRoute(input.upscaleFactor);
  const spec = resolveGeminiApiUpscaleSpec(input.upscaleFactor);
  const attempts: ImageUpscaleAttempt[] = [];

  let source: { buffer: Buffer; mimeType: string };
  let inputWidth = 0;
  let inputHeight = 0;
  try {
    source = await fetchSourceImage(input.imageUrl, input.abortSignal);
    const metadata = await sharp(source.buffer, { failOn: "none" }).metadata();
    inputWidth = Number(metadata.width || 0);
    inputHeight = Number(metadata.height || 0);
    if (!inputWidth || !inputHeight) throw new Error("invalid_input_dimensions");
  } catch (error) {
    return {
      ok: false,
      attempts,
      error: error instanceof Error ? error.message : "image_fetch_failed",
    };
  }

  const aspectRatio = nearestGeminiImageAspectRatio(inputWidth, inputHeight);
  const sourceDataUrl = `data:${normalizeMimeType(source.mimeType)};base64,${source.buffer.toString("base64")}`;

  for (const provider of route.providerOrder) {
    const model = route.models[provider];
    if (!isImageUpscaleProviderConfigured(provider)) continue;

    try {
      if (provider === "vertex") {
        const generated = await generateGeminiImage({
          prompt: spec.prompt,
          quality: route.imageSize === "4K" ? "4k" : "2k",
          referenceImageUrl: sourceDataUrl,
          aspectRatio,
          modelTier: route.imageSize === "4K" ? "pro" : "flash",
          maxRetries: 0,
          abortSignal: input.abortSignal,
          requestTimeoutMs: 180_000,
        });
        const imageUrl = String(generated.imageUrl || "").trim();
        if (!imageUrl) throw new Error("vertex_no_image");
        const dims = await inspectRemoteImageDimensions(imageUrl, input.abortSignal);
        if (!hasValidImageUpscaleDimensions({
          imageSize: route.imageSize,
          inputWidth,
          inputHeight,
          outputWidth: dims.width,
          outputHeight: dims.height,
        })) {
          throw new Error(`vertex_output_not_${route.imageSize.toLowerCase()}`);
        }
        attempts.push({ provider, model, ok: true });
        return {
          ok: true,
          imageUrl,
          inputWidth,
          inputHeight,
          outputWidth: dims.width,
          outputHeight: dims.height,
          provider,
          model,
          attempts,
        };
      }

      if (provider === "openrouter") {
        const captureError: { message?: string } = {};
        const imageUrl = await postOpenRouterGptImage2AndUpload(
          spec.prompt,
          `openrouter_upscale/${route.imageSize.toLowerCase()}-${randomUUID().slice(0, 8)}`,
          {
            aspectRatio,
            model,
            resolution: route.imageSize,
            imageUrls: [sourceDataUrl],
            abortSignal: input.abortSignal,
            captureError,
          },
        );
        if (!imageUrl) throw new Error(captureError.message || "openrouter_no_image");
        const dims = await inspectRemoteImageDimensions(imageUrl, input.abortSignal);
        if (!hasValidImageUpscaleDimensions({
          imageSize: route.imageSize,
          inputWidth,
          inputHeight,
          outputWidth: dims.width,
          outputHeight: dims.height,
        })) {
          throw new Error(`openrouter_output_not_${route.imageSize.toLowerCase()}`);
        }
        attempts.push({ provider, model, ok: true });
        return {
          ok: true,
          imageUrl,
          inputWidth,
          inputHeight,
          outputWidth: dims.width,
          outputHeight: dims.height,
          provider,
          model,
          attempts,
        };
      }

      if (provider === "wavespeed") {
        const generated = await runWavespeedGeminiImageUpscale({
          sourceBuffer: source.buffer,
          sourceMimeType: normalizeMimeType(source.mimeType),
          prompt: spec.prompt,
          aspectRatio,
          abortSignal: input.abortSignal,
        });
        const metadata = await sharp(generated.buffer, { failOn: "none" }).metadata();
        const outputWidth = Number(metadata.width || 0);
        const outputHeight = Number(metadata.height || 0);
        if (!hasValidImageUpscaleDimensions({
          imageSize: route.imageSize,
          inputWidth,
          inputHeight,
          outputWidth,
          outputHeight,
        })) {
          throw new Error(`wavespeed_output_not_${route.imageSize.toLowerCase()}`);
        }
        const imageUrl = await persistPlatformGeneratedImagePublicUrl(
          generated.buffer,
          generated.mimeType,
          undefined,
          `wavespeed_upscale/${route.imageSize.toLowerCase()}-${randomUUID().slice(0, 8)}`,
        );
        attempts.push({ provider, model, ok: true });
        return {
          ok: true,
          imageUrl,
          inputWidth,
          inputHeight,
          outputWidth,
          outputHeight,
          provider,
          model,
          attempts,
        };
      }

      if (provider === "evolink") {
        const captureError: { message?: string } = {};
        try {
          // EvoLink 只能抓公网 URL。这里必须禁用本仓 Blob 令牌重试：若匿名读不到，
          // 就跳过 EvoLink，绝不能把一条仅本服务可读的私链交给外部供应商反复失败。
          await fetchSafeRemoteImage({
            imageUrl: input.imageUrl,
            maxBytes: MAX_SOURCE_BYTES,
            userAgent: "mvstudiopro/1.0 (+evolink-upscale-readability-probe)",
            allowTrustedBlobBearer: false,
            abortSignal: input.abortSignal,
          });
        } catch (error) {
          throw new Error(
            `evolink_input_not_provider_readable:${
              error instanceof Error ? error.message : String(error)
            }`,
          );
        }
        const imageUrl = await postEvolinkGptImage2AndUpload(
          spec.prompt,
          `evolink_upscale/${route.imageSize.toLowerCase()}-${randomUUID().slice(0, 8)}`,
          {
            aspectRatio,
            model: EVOLINK_NANO_BANANA_PRO_MODEL,
            quality: route.imageSize,
            resolution: route.imageSize,
            imageUrls: [input.imageUrl],
            abortSignal: input.abortSignal,
            captureError,
          },
        );
        if (!imageUrl) throw new Error(captureError.message || "evolink_no_image");
        const dims = await inspectRemoteImageDimensions(imageUrl, input.abortSignal);
        if (!hasValidImageUpscaleDimensions({
          imageSize: route.imageSize,
          inputWidth,
          inputHeight,
          outputWidth: dims.width,
          outputHeight: dims.height,
        })) {
          throw new Error(`evolink_output_not_${route.imageSize.toLowerCase()}`);
        }
        attempts.push({ provider, model, ok: true });
        return {
          ok: true,
          imageUrl,
          inputWidth,
          inputHeight,
          outputWidth: dims.width,
          outputHeight: dims.height,
          provider,
          model,
          attempts,
        };
      }

      const result = await runGeminiApiImageUpscale(input);
      if (!result.ok || !result.imageUrl) {
        throw new Error(result.error || "gemini_api_no_image");
      }
      if (!hasValidImageUpscaleDimensions({
        imageSize: route.imageSize,
        inputWidth,
        inputHeight,
        outputWidth: result.outputWidth,
        outputHeight: result.outputHeight,
      })) {
        throw new Error(`gemini_api_output_not_${route.imageSize.toLowerCase()}`);
      }
      attempts.push({ provider, model, ok: true });
      return {
        ...result,
        provider,
        model,
        attempts,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `${provider}_failed`;
      attempts.push({ provider, model, ok: false, error: message.slice(0, 300) });
      console.warn(
        `[imageUpscale] provider failed factor=${route.factor} provider=${provider} model=${model}`,
        message,
      );
      if (isAmbiguousImageUpscaleError(message)) {
        return {
          ok: false,
          inputWidth,
          inputHeight,
          attempts,
          error: `ambiguous_provider_outcome:${provider}:${message}`,
        };
      }
    }
  }

  return {
    ok: false,
    inputWidth,
    inputHeight,
    attempts,
    error:
      attempts.length > 0
        ? attempts.map((item) => `${item.provider}:${item.error || "failed"}`).join(" | ")
        : "no_image_upscale_provider_configured",
  };
}
