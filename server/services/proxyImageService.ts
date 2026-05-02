import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs";
import { generateImagenVertexPredict } from "./imageGenerationService";
import { TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION } from "../../shared/const.js";

const OHMYGPT_BASE = String(process.env.OHMYGPT_API_BASE || "https://api.ohmygpt.com/v1").replace(/\/$/, "");

export type ProxyImageTypographyMode = "STRATEGIC" | "STORYBOARD" | "GRAPHIC";

/**
 * 視覺排版防禦常數（與 `buildTypographyImagePrompt` / gpt-image-2+Imagen 雙路一致）
 * - 主標題：畫內唯一大字，超長必截斷，避免 DALL·E 系排版崩壞
 * - 上下文：僅作靈感，禁止整段貼成螞蟻字
 */
export const PROXY_IMAGE_HEADING_MAX_CHARS = 35;
export const PROXY_IMAGE_CONTEXT_MAX_CHARS = 500;

/** ⚠️ 核心防禦：畫內可讀大字與長文案分離，避免整段貼成螞蟻字或亂碼排版 */
function sliceHeading(title: string): string {
  const t = String(title || "").trim();
  return t.length > PROXY_IMAGE_HEADING_MAX_CHARS
    ? `${t.slice(0, PROXY_IMAGE_HEADING_MAX_CHARS)}...`
    : t;
}

function sliceVisualContext(copywriting: string): string {
  const c = String(copywriting || "").trim();
  return c.length > PROXY_IMAGE_CONTEXT_MAX_CHARS ? c.slice(0, PROXY_IMAGE_CONTEXT_MAX_CHARS) : c;
}

function styleForMode(mode: ProxyImageTypographyMode): string {
  switch (mode) {
    case "STRATEGIC":
      return "Luxury brand book divider, dark gold, renaissance medical aesthetic, Vogue magazine style.";
    case "STORYBOARD":
      return "Cinematic storyboard frame, high-end movie poster style, dramatic lighting.";
    case "GRAPHIC":
    default:
      return "Editorial magazine layout, vibrant and modern luxury social media aesthetic.";
  }
}

/** 與 OhMyGPT gpt-image-2 與 Imagen 兜底共用同一套截斷與版式指令，避免兩路畫風不一致 */
export function buildTypographyImagePrompt(options: {
  title: string;
  copywriting: string;
  mode: ProxyImageTypographyMode;
  isTrial?: boolean;
  /** 兜底模型用稍短前綴即可，語義與 gpt-image-2 一致 */
  forImagenFallback?: boolean;
}): string {
  const { title, copywriting, mode, isTrial, forImagenFallback } = options;
  const displayHeading = sliceHeading(title);
  const visualContext = sliceVisualContext(copywriting);
  const stylePrompt = styleForMode(mode);

  const watermarkInstruction = isTrial ? TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION : "";

  if (forImagenFallback) {
    return [
      "Professional 9:16 editorial image with native typography (fallback render).",
      `VISUAL CONTEXT INSPIRATION (Do NOT render this block as tiny paragraph text on the image): ${visualContext}`,
      `TYPOGRAPHY INSTRUCTION: Natively render EXACTLY this text directly into the image as the primary headline: "${displayHeading}".`,
      `STYLE: ${stylePrompt}`,
      watermarkInstruction,
      "Aspect ratio 9:16 vertical. 8k resolution, masterpiece, no browser or phone UI mockups.",
    ]
      .filter(Boolean)
      .join("\n");
  }

  return `
Model: GPT-Image-2
Task: Create a professional image with typography.
VISUAL CONTEXT INSPIRATION (Do NOT render this text): ${visualContext}

TYPOGRAPHY INSTRUCTION: You MUST natively render EXACTLY this text directly into the image: "${displayHeading}".
STYLE: ${stylePrompt}
${watermarkInstruction}
Aspect Ratio: 9:16. 8k resolution, masterpiece.
`.trim();
}

/**
 * OhMyGPT `gpt-image-2` 主路径；需配置 `PROXY_OPENAI_API_KEY`（Bearer）。
 * 失败返回 null，由调用方走 Imagen Ultra 等 fallback。
 */
export async function generateGptImage2(options: {
  title: string;
  copywriting: string;
  mode: ProxyImageTypographyMode;
  isTrial?: boolean;
}): Promise<string | null> {
  const apiKey = String(process.env.PROXY_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    console.warn("[proxyImageService] PROXY_OPENAI_API_KEY missing, skip gpt-image-2");
    return null;
  }

  const finalPrompt = buildTypographyImagePrompt({
    title: options.title,
    copywriting: options.copywriting,
    mode: options.mode,
    isTrial: options.isTrial,
    forImagenFallback: false,
  });

  try {
    const r = await fetch(`${OHMYGPT_BASE}/images/generations`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: finalPrompt,
        n: 1,
        size: "1024x1792",
        response_format: "b64_json",
      }),
      signal: AbortSignal.timeout(120_000),
    });
    const json: unknown = await r.json().catch(() => ({}));
    const anyJson = json as { data?: Array<{ b64_json?: string }> };
    if (!r.ok) {
      console.warn(
        "[proxyImageService] gpt-image-2 HTTP error:",
        r.status,
        JSON.stringify(json).slice(0, 400),
      );
      return null;
    }
    const b64 = anyJson?.data?.[0]?.b64_json;
    if (!b64 || typeof b64 !== "string") return null;

    const buffer = Buffer.from(b64, "base64");
    const path = `generated/${options.mode.toLowerCase()}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
    const { gcsUri } = await uploadBufferToGcs({
      objectName: path,
      buffer,
      contentType: "image/jpeg",
    });
    return signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
  } catch (e: unknown) {
    console.warn("[proxyImageService] gpt-image-2 exception:", e instanceof Error ? e.message : e);
    return null;
  }
}

async function uploadImagenDataUrlToSignedUrl(dataUrl: string): Promise<string | null> {
  const m = dataUrl.match(/^data:([^;,]+);base64,(.+)$/);
  if (!m?.[2]) return null;
  const buffer = Buffer.from(m[2], "base64");
  const mime = String(m[1] || "image/png");
  const contentType = /jpeg|jpg/i.test(mime) ? "image/jpeg" : "image/png";
  const ext = contentType === "image/jpeg" ? "jpg" : "png";
  const path = `generated/imagen-fallback/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { gcsUri } = await uploadBufferToGcs({
    objectName: path,
    buffer,
    contentType,
  });
  return signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
}

/**
 * 旗艦生圖引擎：OhMyGPT `gpt-image-2` 主路徑 → Vertex **Imagen** `:predict` 兜底，產出 GCS 簽名 URL。
 *
 * @description 截斷與水印只在 `buildTypographyImagePrompt` 內執行一次，禁止在本函數重複 `sliceHeading`，
 *   以免已帶省略號的標題被二次截斷。
 * @param options.title 畫面主標題來源（將強制截斷至 {@link PROXY_IMAGE_HEADING_MAX_CHARS} 字）
 * @param options.copywriting 畫面上下文 / 靈感（將強制截斷至 {@link PROXY_IMAGE_CONTEXT_MAX_CHARS} 字，不得整段渲染上圖）
 * @param options.mode STRATEGIC | STORYBOARD | GRAPHIC
 * @param options.isTrial 為 true 時附加 `TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION`（`MVSTUDIOPRO.COM · 试读` 對角試讀水印，與全站試讀樣本一致）
 */
export async function generateImageGpt2WithImagenFallback(options: {
  title: string;
  copywriting: string;
  mode: ProxyImageTypographyMode;
  isTrial?: boolean;
}): Promise<string | null> {
  const primary = await generateGptImage2(options);
  if (primary) return primary;

  const prompt = buildTypographyImagePrompt({
    title: options.title,
    copywriting: options.copywriting,
    mode: options.mode,
    isTrial: options.isTrial,
    forImagenFallback: true,
  });

  const model =
    String(process.env.VERTEX_STRATEGIC_SCENE_IMAGEN_MODEL || "imagen-4.0-ultra-generate-001").trim() ||
    "imagen-4.0-ultra-generate-001";

  const r = await generateImagenVertexPredict({
    prompt,
    model,
    aspectRatio: "9:16",
    imageSize: "2K",
    numberOfImages: 1,
    personGeneration: "ALLOW_ADULT",
    guidanceScale: 4.0,
  });
  if (!r.ok || !r.imageUrl) {
    console.warn("[proxyImageService] imagen fallback failed:", r.error);
    return null;
  }
  return uploadImagenDataUrlToSignedUrl(r.imageUrl);
}

/** 深研报告场景配图：主路径 gpt-image-2，STRATEGIC 画风 + 试用水印。 */
export async function generateDeepResearchSceneIllustration(options: {
  caption: string;
  imagePrompt: string;
  isTrial?: boolean;
}): Promise<string | null> {
  return generateImageGpt2WithImagenFallback({
    title: options.caption || "Strategic insight",
    copywriting: [options.imagePrompt, options.caption].filter(Boolean).join("\n"),
    mode: "STRATEGIC",
    isTrial: options.isTrial,
  });
}
