/**
 * Canvas / 平台 GPT Image 2 入队 payload（www→Fly jobs worker）
 * 前台 createJobSameOrigin({ type: "image", input }) + 轮询；
 * worker 内再等上游，避免 Vercel / 浏览器长 HTTP。
 */

export type CanvasGptImage2ProviderOverride = "openai" | "openrouter" | "auto";

export type CanvasGptImage2JobParams = {
  prompt: string;
  aspectRatio: "9:16" | "16:9";
  referenceImageUrls?: string[];
  maskUrl?: string;
  generalImageEdit?: boolean;
  providerOverride?: CanvasGptImage2ProviderOverride;
  gcsSubdir?: string;
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

  return {
    action: "canvas_gpt_image2",
    params: {
      prompt,
      aspectRatio,
      ...(referenceImageUrls.length ? { referenceImageUrls } : {}),
      ...(maskUrl ? { maskUrl } : {}),
      ...(generalImageEdit ? { generalImageEdit: true } : {}),
      ...(providerOverride ? { providerOverride } : {}),
      gcsSubdir: String(params.gcsSubdir || "").trim() || "canvas-gpt-image2",
    },
  };
}
