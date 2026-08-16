/**
 * 旧 `/api/google?op=upscaleImage` 的兼容外壳。
 *
 * 实际高清放大统一走 `runImageUpscaleWithFallback`：
 * - 2×：Vertex Flash → OpenRouter Flash → Gemini API Flash
 * - 4×：Vertex Pro → WaveSpeed Pro Edit → EvoLink Pro
 *
 * 本文件不再调用 Imagen，也不再支持会被静默改成 2× 的 x3。
 */
import {
  runImageUpscaleWithFallback,
  type GeminiApiUpscaleFactor,
} from "./geminiApiImageUpscale.js";

export type VertexUpscaleResult = {
  ok: boolean;
  status?: number;
  url?: string;
  raw?: unknown;
  imageUrl?: string;
  imageUrls?: string[];
  imageCount?: number;
  upscaleFactor?: GeminiApiUpscaleFactor;
  provider?: string;
  model?: string;
  inputWidth?: number;
  inputHeight?: number;
  outputWidth?: number;
  outputHeight?: number;
  error?: string;
};

export async function runVertexUpscaleImage(args: {
  imageUrl: string;
  upscaleFactor: GeminiApiUpscaleFactor;
}): Promise<VertexUpscaleResult> {
  const factor = args.upscaleFactor;
  const result = await runImageUpscaleWithFallback({
    imageUrl: args.imageUrl,
    upscaleFactor: factor,
  });
  const imageUrl = String(result.imageUrl || "").trim();
  return {
    ok: result.ok && Boolean(imageUrl),
    status: result.ok ? 200 : 502,
    imageUrl,
    imageUrls: imageUrl ? [imageUrl] : [],
    imageCount: imageUrl ? 1 : 0,
    upscaleFactor: factor,
    provider: result.provider,
    model: result.model,
    inputWidth: result.inputWidth,
    inputHeight: result.inputHeight,
    outputWidth: result.outputWidth,
    outputHeight: result.outputHeight,
    error: result.error,
    raw: { attempts: result.attempts },
  };
}
