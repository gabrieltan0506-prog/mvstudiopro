/**
 * Canvas / 平台 GPT Image 2 入队 payload（www→Fly jobs worker）
 * 前台 createJobSameOrigin({ type: "image", input }) + 轮询；
 * worker 内再等上游，避免 Vercel / 浏览器长 HTTP。
 */

import { normalizeOpenAiImageLane, type OpenAiImageLane } from "./openaiImageLane.js";
import type { ManhuaAssetStandardizeQuality } from "./manhuaAssetStandardize.js";

export type CanvasGptImage2ProviderOverride = "openai" | "openrouter" | "auto";

export type CanvasGptImage2JobParams = {
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  referenceImageUrls?: string[];
  maskUrl?: string;
  generalImageEdit?: boolean;
  providerOverride?: CanvasGptImage2ProviderOverride;
  gcsSubdir?: string;
  /** 设定图 / 静帧分走两把官方密钥 */
  imageLane?: OpenAiImageLane;
  /**
   * @deprecated 六审第3条:收费一律由 worker 服务端按 job 幂等键决定,
   * 本字段完全被忽略,仅为旧客户端载荷兼容保留。
   */
  chargeOnServer?: boolean;
  /** 批量出图里的第几张（0-based）：第 2 张起走批量价 */
  batchIndex?: number;
  /** 用户明确点选的漫剧导入资产标准化；服务端固定 GPT-image-2 edit 并按 3/5 积分结算。 */
  assetStandardizeQuality?: ManhuaAssetStandardizeQuality;
  assetRefId?: string;
};

export function buildCanvasGptImage2JobInput(params: {
  prompt: string;
  aspectRatio?: "9:16" | "16:9" | string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  maskUrl?: string;
  generalImageEdit?: boolean;
  providerOverride?: CanvasGptImage2ProviderOverride | string;
  gcsSubdir?: string;
  imageLane?: OpenAiImageLane | string;
  chargeOnServer?: boolean;
  batchIndex?: number;
  assetStandardizeQuality?: ManhuaAssetStandardizeQuality;
  assetRefId?: string;
}): {
  action: "canvas_gpt_image2";
  params: CanvasGptImage2JobParams;
} {
  const prompt = String(params.prompt || "").trim();
  const aspectRatio = String(params.aspectRatio || "9:16") === "16:9" ? "16:9" : "9:16";
  const primaryRef = String(params.referenceImageUrl || "").trim();
  const extraRefs = (params.referenceImageUrls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  const referenceImageUrls = Array.from(new Set([primaryRef, ...extraRefs].filter(Boolean))).slice(
    0,
    16,
  );
  const maskUrl = String(params.maskUrl || "").trim();
  const providerRaw = String(params.providerOverride || "")
    .trim()
    .toLowerCase();
  const providerOverride: CanvasGptImage2ProviderOverride | undefined =
    providerRaw === "openai" || providerRaw === "openrouter" || providerRaw === "auto"
      ? providerRaw
      : undefined;
  const generalImageEdit =
    Boolean(params.generalImageEdit) || referenceImageUrls.length > 0;
  const imageLane = normalizeOpenAiImageLane(params.imageLane);
  const assetStandardizeQuality =
    params.assetStandardizeQuality === "high" || params.assetStandardizeQuality === "medium"
      ? params.assetStandardizeQuality
      : undefined;

  return {
    action: "canvas_gpt_image2",
    params: {
      prompt,
      aspectRatio,
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
      ...(maskUrl ? { maskUrl } : {}),
      ...(generalImageEdit ? { generalImageEdit: true } : {}),
      ...(providerOverride ? { providerOverride } : {}),
      ...(imageLane ? { imageLane } : {}),
      ...(params.chargeOnServer ? { chargeOnServer: true } : {}),
      ...(Number(params.batchIndex) > 0 ? { batchIndex: Math.floor(Number(params.batchIndex)) } : {}),
      ...(assetStandardizeQuality ? { assetStandardizeQuality } : {}),
      ...(assetStandardizeQuality && String(params.assetRefId || "").trim()
        ? { assetRefId: String(params.assetRefId).trim().slice(0, 100) }
        : {}),
      gcsSubdir: String(params.gcsSubdir || "").trim() || "canvas-gpt-image2",
    },
  };
}
