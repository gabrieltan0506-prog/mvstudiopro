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
/** 分鏡表 / 小紅書雙卡：單圖內多格，需保留足夠劇本以統計鏡數與細節 */
export const PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS = 3500;

/**
 * gpt-image-2 官方尺寸約束：最長邊 ≤3840、兩邊皆 16 倍數、長寬比 ≤3:1、總像素 ∈ [655360, 8294400]。
 * 下列為豎版（與本檔 9:16 prompt 一致）；由前到後嘗試，代理拒絕某一組時自動換下一組，無需產品側指定比例。
 */
const GPT_IMAGE2_PORTRAIT_SIZES = ["1024x1792", "1024x1536", "1536x2304"] as const;

function shouldAbortGptImage2SizeRetries(status: number): boolean {
  return status === 401 || status === 403 || status === 429;
}

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
 * 根據劇本上下文粗估分鏡條數，寫入 prompt 讓生圖與文字敘述對齊（不強行 8 鏡）。
 */
function buildStoryboardShotCountGuidance(scriptContext: string): string {
  const s = scriptContext.slice(0, 12000);
  let best = 0;
  const reLine = /(?:^|\n)\s*(\d{1,2})[\.、:：]\s+\S/gm;
  let m: RegExpExecArray | null;
  while ((m = reLine.exec(s)) !== null) {
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= 24) best = Math.max(best, v);
  }
  const reJing = /第\s*(\d{1,2})\s*镜/g;
  while ((m = reJing.exec(s)) !== null) {
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= 24) best = Math.max(best, v);
  }
  const lineStarts = (s.match(/(?:^|\n)\s*\d{1,2}[\.、]\s+/gm) ?? []).length;
  if (lineStarts > best) best = lineStarts;
  best = Math.min(best, 14);
  if (lineStarts > best) best = lineStarts;
  best = Math.min(best, 14);

  if (best >= 3) {
    const hi = String(best).padStart(2, "0");
    return `SHOT COUNT (hint from CONTEXT numbering/lists): ${best} distinct beats — render EXACTLY ${best} panels, 镜号 01 … ${hi} in story order. Do NOT pad to 8; do NOT add blank panels.`;
  }
  if (best === 1 || best === 2) {
    return `SHOT COUNT: CONTEXT implies ${best} key beat(s) — render exactly ${best} panel(s) only (e.g. vertical stack). Forbidden: duplicating art to fill a grid; forbidden: padding to eight.`;
  }
  return `SHOT COUNT: Derive from CONTEXT — one panel per clearly described shot (practical range about 2–12 on one 9:16 sheet). There is NO required count of 8. If the prose only supports 4 shots, draw 4. Never clone the same frame to fill space.`;
}

/** 豎版專業執行分鏡表：單張 9:16、鏡數隨文字敘述；每格下方七欄位表 */
export function buildStoryboardSheetPortraitPrompt(options: {
  title: string;
  scriptContext: string;
  isTrial?: boolean;
}): string {
  const displayHeading = sliceHeading(options.title);
  const raw = String(options.scriptContext || "").trim();
  const visualContext =
    raw.length > PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS
      ? raw.slice(0, PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS)
      : raw;
  const shotGuidance = buildStoryboardShotCountGuidance(raw);
  const watermarkInstruction = options.isTrial ? TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION : "";
  return `
Model: GPT-Image-2
Task: Render ONE printable vertical Chinese cinematography EXECUTION STORYBOARD SHEET (镜头执行分镜表)— premium streaming / feature-film prep document, NOT a social collage.

${shotGuidance}

DOCUMENT LAYOUT (non-negotiable):
1) TOP HEADER STRIP
   - Main line (large): natively render EXACT headline: "${displayHeading}"
   - Sub-header lines (smaller Chinese, 2–4 short lines): infer from CONTEXT — 场次, 视觉风格, 视频约束 (e.g. 单镜时长 ≤ 5 秒). If a field is missing, invent concise on-tone text; never leave blank.

2) BODY — variable grid of shot panels (NOT fixed 2×4 unless CONTEXT happens to need 8 shots).
   - Choose a readable layout for the shot count above: e.g. 2 columns × k rows, or 1 column × n rows if few shots, so everything fits one 9:16 page with legible tables.
   - Reading order: top-to-bottom within a column, then next column (or pure top-to-bottom if single column). 镜号 must be consecutive from 01 upward for however many panels you draw.
   - EACH panel:
     (A) UPPER: one cinematic keyframe (must match CONTEXT world / era / wardrobe).
     (B) LOWER: compact LEGIBLE Chinese mini-table with row labels exactly:
         镜号 | 景别 | 画面内容 | 情绪 | 运镜 | 台词/声音 | 时长
       Fill every field for that shot; no empty shells, no replacing the table with a prose blob.

ANTI-LAZY / ANTI-DRIFT:
- NO modern office / business look UNLESS CONTEXT says contemporary workplace.
- Every pair of adjacent panels MUST differ clearly in at least two of: 景别, 人物站位/动作, 构图, 运镜 — unless CONTEXT explicitly calls for an intentional match cut.
- FORBIDDEN: copy-pasting the same artwork across multiple panels; FORBIDDEN: filler duplicate frames.
- FORBIDDEN: microscopic unreadable glyphs.

STORY: Sequence and beats come strictly from CONTEXT; panel count follows CONTEXT, not a default number.

CONTEXT (do NOT paste as one wall of tiny text on the sheet):
${visualContext}

STYLE: Match CONTEXT genre lighting (e.g. snow / palace lantern contrast for period drama); crisp grid; parchment optional; no phone or browser UI.
${watermarkInstruction}
Aspect ratio 9:16 portrait; table typography must stay human-readable.
`.trim();
}

/** 小紅書風：單張 9:16 內上下兩條筆記卡片（圖+標題短文案），一次生圖 */
export function buildXiaohongshuDualNotePrompt(options: {
  title: string;
  scriptContext: string;
  isTrial?: boolean;
}): string {
  const displayHeading = sliceHeading(options.title);
  const raw = String(options.scriptContext || "").trim();
  const visualContext =
    raw.length > PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS
      ? raw.slice(0, PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS)
      : raw;
  const watermarkInstruction = options.isTrial ? TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION : "";
  return `
Model: GPT-Image-2
Task: Create ONE vertical 9:16 image with TWO stacked Xiaohongshu-style note cards (小红书图文笔记), lifestyle editorial, soft shadows, rounded cards.

STRUCTURE:
- Card A (upper): hero lifestyle/cover-style photo + natively render a punchy short Chinese title (max 18 chars) distilled from: "${displayHeading}"
- Card B (lower): complementary scene or detail + a second short catchy Chinese caption (max 22 chars) from the theme
- Use CONTEXT for visual and copy ideas (do NOT paste full CONTEXT as tiny text):
${visualContext}

STYLE: authentic 小红书 aesthetic, bright premium mobile feed, emoji sparingly OK, no app UI frame.
${watermarkInstruction}
Aspect Ratio: 9:16 portrait. 8k, masterpiece.
`.trim();
}

async function postGptImage2AndUpload(
  prompt: string,
  gcsSubdir: string,
  opts: { maxAttempts?: number } = {},
): Promise<string | null> {
  const apiKey = String(process.env.PROXY_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    console.warn("[proxyImageService] PROXY_OPENAI_API_KEY missing, skip gpt-image-2");
    return null;
  }

  const maxAttempts = Math.min(
    Math.max(1, opts.maxAttempts ?? GPT_IMAGE2_PORTRAIT_SIZES.length),
    GPT_IMAGE2_PORTRAIT_SIZES.length,
  );
  const sizes = GPT_IMAGE2_PORTRAIT_SIZES.slice(0, maxAttempts);

  for (const size of sizes) {
    try {
      const r = await fetch(`${OHMYGPT_BASE}/images/generations`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-image-2",
          prompt,
          n: 1,
          size,
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
          `size=${size}`,
          JSON.stringify(json).slice(0, 400),
        );
        if (shouldAbortGptImage2SizeRetries(r.status)) return null;
        continue;
      }
      const b64 = anyJson?.data?.[0]?.b64_json;
      if (!b64 || typeof b64 !== "string") {
        console.warn("[proxyImageService] gpt-image-2 missing b64_json, size=", size);
        continue;
      }

      const buffer = Buffer.from(b64, "base64");
      const path = `generated/${gcsSubdir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
      const { gcsUri } = await uploadBufferToGcs({
        objectName: path,
        buffer,
        contentType: "image/jpeg",
      });
      return signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
    } catch (e: unknown) {
      console.warn(
        "[proxyImageService] gpt-image-2 exception:",
        e instanceof Error ? e.message : e,
        "size=",
        size,
      );
    }
  }
  return null;
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
  const finalPrompt = buildTypographyImagePrompt({
    title: options.title,
    copywriting: options.copywriting,
    mode: options.mode,
    isTrial: options.isTrial,
    forImagenFallback: false,
  });
  return postGptImage2AndUpload(finalPrompt, options.mode.toLowerCase(), {});
}

export type PlatformCompositeSheetKind = "storyboard_sheet_portrait" | "xiaohongshu_dual_note";

/**
 * 平台頁：單次 gpt-image-2（9:16）產「豎版分鏡表」或「小紅書雙筆記卡」+ Imagen 兜底。
 */
export async function generatePlatformCompositeSheetImage(options: {
  kind: PlatformCompositeSheetKind;
  title: string;
  scriptContext: string;
  isTrial?: boolean;
}): Promise<string | null> {
  const prompt =
    options.kind === "storyboard_sheet_portrait"
      ? buildStoryboardSheetPortraitPrompt({
          title: options.title,
          scriptContext: options.scriptContext,
          isTrial: options.isTrial,
        })
      : buildXiaohongshuDualNotePrompt({
          title: options.title,
          scriptContext: options.scriptContext,
          isTrial: options.isTrial,
        });

  const subdir =
    options.kind === "storyboard_sheet_portrait" ? "platform_storyboard_sheet" : "platform_xhs_dual";
  // 平台合成單張：只打一次 gpt-image-2（首個尺寸），避免「尺寸降級重試」連出兩張、雙倍計費與雙倍延遲。
  // 若失敗再交給 Imagen 兜底一次。
  const primary = await postGptImage2AndUpload(prompt, subdir, { maxAttempts: 1 });
  if (primary) return primary;

  const imagenPrompt = prompt.replace(/\s+/g, " ").slice(0, 2400);
  const model =
    String(process.env.VERTEX_STRATEGIC_SCENE_IMAGEN_MODEL || "imagen-4.0-ultra-generate-001").trim() ||
    "imagen-4.0-ultra-generate-001";

  const r = await generateImagenVertexPredict({
    prompt: imagenPrompt,
    model,
    aspectRatio: "9:16",
    imageSize: "2K",
    numberOfImages: 1,
    personGeneration: "ALLOW_ADULT",
    guidanceScale: 4.0,
  });
  if (!r.ok || !r.imageUrl) {
    console.warn("[proxyImageService] platform composite sheet imagen fallback failed:", r.error);
    return null;
  }
  return uploadImagenDataUrlToSignedUrl(r.imageUrl);
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
