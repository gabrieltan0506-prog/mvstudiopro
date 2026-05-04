import { analyzeStoryboardPanelStats } from "../../shared/storyboardPanelCount.js";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs";

const OHMYGPT_BASE = String(process.env.OHMYGPT_API_BASE || "https://api.ohmygpt.com/v1").replace(/\/$/, "");

/** 平台頁 Debug：可選逐步驟時間線（僅在調用方傳入陣列時寫入） */
export function appendImageFlowLog(log: string[] | undefined, message: string): void {
  if (!log) return;
  log.push(`${new Date().toISOString()}  ${message}`);
}

export type ProxyImageTypographyMode = "STRATEGIC" | "STORYBOARD" | "GRAPHIC";

/**
 * 視覺防禦常數 — **畫內零文字**：標題與文案由前端 / HTML 疊加，gpt-image-2 只出純畫面。
 */
export const PROXY_IMAGE_HEADING_MAX_CHARS = 35;
export const PROXY_IMAGE_CONTEXT_MAX_CHARS = 500;
/** 分鏡表 / 小紅書雙卡：單圖內多格，需保留足夠劇本以統計鏡數與細節 */
export const PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS = 3500;

/**
 * gpt-image-2 官方尺寸約束：最長邊 ≤3840、兩邊皆 16 倍數、長寬比 ≤3:1、總像素 ∈ [655360, 8294400]。
 * 下列為豎版（與本檔多數 9:16 prompt 一致）；橫版 16:9 分鏡合成表見 GPT_IMAGE2_LANDSCAPE_SIZES。由前到後嘗試，代理拒絕某一組時自動換下一組。
 */
const GPT_IMAGE2_PORTRAIT_SIZES = ["1024x1792", "1024x1536", "1536x2304"] as const;
/** 16:9 橫版分鏡合成表 — 與 `buildStoryboardSheetLandscapePrompt` 一致 */
const GPT_IMAGE2_LANDSCAPE_SIZES = ["1792x1024", "1536x864", "1344x768"] as const;

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

/** 與 gpt-image-2 / Imagen 兜底：僅控制畫風，不得要求模型在像素上畫字 */
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

/**
 * 🛑 視圖解耦最高防禦指令 (Cam4-1)
 * 嚴禁模型在畫面上生成任何文字、數字或浮水印；試讀水印由前端 DOM / CSS 疊加，不得寫入 prompt。
 */
export const NO_TEXT_ON_IMAGE_BLOCK = `
🛑 FATAL ERROR PREVENTION (STRICTLY NO TEXT/TYPOGRAPHY):
DO NOT render ANY text, letters, numbers, watermarks, spreadsheets, or characters on the image. DO NOT simulate text or documents. The output MUST be a completely clean visual canvas containing ONLY pixels. All readable text will be added later by our system UI.
`.trim();

/** 與 OhMyGPT gpt-image-2 與 Imagen 兜底：畫內零文字；字由 UI / 報告 HTML 疊加 */
export function buildTypographyImagePrompt(options: {
  title: string;
  copywriting: string;
  mode: ProxyImageTypographyMode;
  isTrial?: boolean;
  /** 兜底模型用稍短前綴即可，語義與 gpt-image-2 一致 */
  forImagenFallback?: boolean;
}): string {
  const { title, copywriting, mode, forImagenFallback } = options;
  const displayHeading = sliceHeading(title);
  const visualContext = sliceVisualContext(copywriting);
  const stylePrompt = styleForMode(mode);

  if (forImagenFallback) {
    return [
      "Professional 9:16 editorial vertical scene — pure visuals only, absolutely no typography on the image.",
      `VISUAL BRIEF (translate into imagery only; do NOT paint as readable text): ${visualContext}`,
      `SUBJECT / MOOD ANCHOR (for composition only; do NOT spell as text): ${displayHeading}`,
      `STYLE: ${stylePrompt}`,
      NO_TEXT_ON_IMAGE_BLOCK,
      "Aspect ratio 9:16 vertical. 8k resolution, masterpiece, no browser or phone UI mockups.",
    ].join("\n");
  }

  return `
Model: GPT-Image-2
Task: Create a professional 9:16 vertical image — **pure cinematic/editorial visuals only; zero readable characters on the canvas**.
VISUAL BRIEF (inspiration for pixels only — do NOT render this block as typography): ${visualContext}
MOOD ANCHOR (for setting & subject only — do NOT write as text): ${displayHeading}
STYLE: ${stylePrompt}
${NO_TEXT_ON_IMAGE_BLOCK}
Aspect Ratio: 9:16. 8k resolution, masterpiece.
`.trim();
}

/**
 * @description 橫版 16:9 分鏡合成 — **畫內零文字**；畫格數與 {@link analyzeStoryboardPanelStats} 對齊（含單行超過 30 字元 +1 格）。
 */
export function buildStoryboardSheetLandscapePrompt(options: {
  title: string;
  scriptContext: string;
  /** 保留相容：浮水印不進 prompt */
  isTrial?: boolean;
  /** 燈光與情緒（平台頁彙總後下發） */
  executionDetails?: string;
}): string {
  void options.title;
  void options.isTrial;
  const raw = String(options.scriptContext || "").trim();
  const { overlayPanelCount } = analyzeStoryboardPanelStats(raw);
  const n = Math.min(Math.max(overlayPanelCount, 1), 16);
  const scriptSlice =
    raw.length > PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS
      ? raw.slice(0, PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS)
      : raw;
  const staging = String(options.executionDetails || "").trim()
    || "High-end intellectual authority, Rembrandt lighting, cinematic softbox";

  return `
Model: GPT-Image-2
TASK: Create a high-end 16:9 Landscape Storyboard Grid (Professional Masterpiece).

🛑 DYNAMIC GRID EXACT MAPPING:
1. You MUST generate EXACTLY ${n} image panels in a neat, balanced grid.
2. DO NOT hallucinate extra scenes or duplicate panels to fill space.
3. Panel count follows the same rules as our pipeline: each shot line may expand to an extra panel when that line is longer than 30 characters (already baked into ${n} when derived from CONTEXT).

Additionally: do NOT draw shot tables, 「分镜参考图」legends, film-strip perforations, or sprocket holes — any lower band is wordless imagery only.

${NO_TEXT_ON_IMAGE_BLOCK}

🛑 STAGING RULES (NO TYPOGRAPHY):
1. Render a CLEAN grid of images only.
2. DO NOT render ANY text, script, tables, numbers, or watermarks on the image. System overlays labels via DOM / print CSS.

🧠 VISUAL CONTEXT:
[EMOTION & LIGHTING]: ${staging}.
[SCENES]: Visualize: ${scriptSlice}.

STYLE: Dark gold renaissance medical aesthetic, Vogue magazine elegance, 8k.
Aspect Ratio: 16:9.
`.trim();
}

/** @deprecated 平台分鏡表已改橫版 16:9，請使用 {@link buildStoryboardSheetLandscapePrompt} */
export function buildStoryboardSheetPortraitPrompt(options: {
  title: string;
  scriptContext: string;
  isTrial?: boolean;
  executionDetails?: string;
}): string {
  return buildStoryboardSheetLandscapePrompt(options);
}
/** 小紅書雙卡：16:9 **幾何鎖定**（左右 50/50 垂直卡）+ **畫內零文字**（X10 / Geometric Straightjacket） */
export function buildXiaohongshuDualNotePrompt(options: {
  title: string;
  scriptContext: string;
  /** 保留相容：浮水印不進 prompt */
  isTrial?: boolean;
  executionDetails?: string;
}): string {
  void options.title;
  void options.isTrial;
  const raw = String(options.scriptContext || "").trim();
  const content = raw.length > 3000 ? raw.slice(0, 3000) : raw;
  const executionDetails = String(options.executionDetails || "").trim()
    || "High-net-worth IP style, minimalist luxury, cinematic lighting.";

  return `
Model: GPT-Image-2
TASK: Create a strict geometric layout for Xiaohongshu (Little Red Book) inside a 16:9 canvas.

🛑 GEOMETRIC LAYOUT RULES (FATAL IF IGNORED):
1. You MUST divide the 16:9 canvas into EXACTLY TWO distinct vertical panels of equal width (50% left, 50% right), placed side-by-side. Each half is one tall vertical "note card" (approximate 3:4 portrait feel within that column) — two clean cards, not a random collage.
2. The Left panel is the "Cover Card" (visual hook, hero scene). The Right panel is the "Value Card" (inner content visualization — supporting detail, atmosphere, or secondary focal scene).
3. DO NOT draw messy collages, overlapping polaroids on a table, scattered stickers, or scrapbook chaos. Keep the vertical split between cards sharp and straight with a clean gutter.

${NO_TEXT_ON_IMAGE_BLOCK}

🛑 STAGING RULES (NO TYPOGRAPHY):
1. DO NOT render ANY text, titles, watermarks, logos, UI, or readable characters on the image. The output MUST be a clean visual canvas. The system UI will overlay typography via DOM.

🧠 VISUAL CONTEXT:
[AESTHETIC & LIGHTING — translate to pixels only; never spell as text]: ${executionDetails.slice(0, 2000)}
[CONTENT — visualize this logic as imagery only; do NOT paste as typography]: ${content}

STYLE: Editorial magazine photography, Vogue aesthetic, 8k resolution, masterpiece.
Aspect Ratio: 16:9.
`.trim();
}

async function postGptImage2AndUpload(
  prompt: string,
  gcsSubdir: string,
  opts: { maxAttempts?: number; sizes?: readonly string[] } = {},
): Promise<string | null> {
  const apiKey = String(process.env.PROXY_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    console.warn("[proxyImageService] PROXY_OPENAI_API_KEY missing, skip gpt-image-2");
    return null;
  }

  const sizeList = opts.sizes ?? GPT_IMAGE2_PORTRAIT_SIZES;
  const maxAttempts = Math.min(
    Math.max(1, opts.maxAttempts ?? sizeList.length),
    sizeList.length,
  );
  const sizes = sizeList.slice(0, maxAttempts);

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

/** GPT-IMAGE-2 失敗後：Vertex **Nano Banana 2**（`gemini-3.1-flash-image-preview`）· 2K。 */
async function fallbackNanoBanana2FromPrompt(
  prompt: string,
  aspectRatio: "9:16" | "16:9",
  flowLog?: string[],
): Promise<string | null> {
  const L = flowLog;
  try {
    const { generateGeminiImage, isGeminiImageAvailable } = await import("../gemini-image.js");
    if (!isGeminiImageAvailable()) {
      appendImageFlowLog(
        L,
        "[单帧兜底] Vertex 不可用（需 GOOGLE_APPLICATION_CREDENTIALS_JSON + VERTEX_PROJECT_ID），跳过 Nano Banana 2",
      );
      return null;
    }
    const vertexResult = await generateGeminiImage({
      prompt: String(prompt || "").trim(),
      quality: "2k",
      aspectRatio,
      personGeneration: "ALLOW_ADULT",
    });
    const url = String(vertexResult?.imageUrl || "").trim();
    if (!url) {
      appendImageFlowLog(L, "[单帧兜底] Nano Banana 2 返回空 URL");
      return null;
    }
    appendImageFlowLog(
      L,
      `[单帧兜底] Nano Banana 2 成功 · model=${vertexResult.model ?? "?"} · location=${vertexResult.location ?? "?"}`,
    );
    return url;
  } catch (e: unknown) {
    appendImageFlowLog(L, `[单帧兜底] Nano Banana 2 失败: ${e instanceof Error ? e.message : String(e)}`);
    console.warn("[proxyImageService] nano banana 2 fallback failed:", e);
    return null;
  }
}

/**
 * 已由 Gemini **双语编导**写好的 **完整英文 raw prompt** → **GPT-IMAGE-2**（9:16 或 16:9）→ **Nano Banana 2** 兜底。图像 API **不**执行翻译。
 */
export async function generateGptImage2FromRawEnglishPrompt(options: {
  englishPrompt: string;
  aspectRatio: "9:16" | "16:9";
  gcsSubdir: string;
  /** 试读等：追加到 prompt 末尾（仅像素出图） */
  trialWatermarkPromptSuffix?: string;
  /** 可選：逐步寫入供平台 Debug 面板展示 */
  flowLog?: string[];
}): Promise<string | null> {
  const L = options.flowLog;
  const raw = String(options.englishPrompt || "").trim();
  if (!raw) {
    appendImageFlowLog(L, "[单帧·英文 prompt] 为空，跳过生图");
    return null;
  }
  const suffix = String(options.trialWatermarkPromptSuffix || "").trim();
  const prompt = suffix ? `${raw}\n\n${suffix}` : raw;
  const sizes = options.aspectRatio === "16:9" ? GPT_IMAGE2_LANDSCAPE_SIZES : GPT_IMAGE2_PORTRAIT_SIZES;
  appendImageFlowLog(
    L,
    `[单帧主路径] GPT-IMAGE-2（OhMyGPT）· ${options.aspectRatio} · 试尺寸序列: ${sizes.join(" → ")} · 英文 prompt 约 ${prompt.length} 字`,
  );
  const primary = await postGptImage2AndUpload(prompt, options.gcsSubdir, { sizes });
  if (primary) {
    appendImageFlowLog(L, "[单帧主路径] GPT-IMAGE-2 成功，已上传 GCS");
    return primary;
  }

  appendImageFlowLog(L, `[单帧兜底] GPT-IMAGE-2 无图 → Vertex Nano Banana 2 · ${options.aspectRatio} · 2K`);
  return fallbackNanoBanana2FromPrompt(prompt, options.aspectRatio, L);
}

/**
 * OhMyGPT `gpt-image-2` 主路径；需配置 `PROXY_OPENAI_API_KEY`（Bearer）。
 * 失败返回 null，由调用方走 Nano Banana 2 等 fallback。
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

export type PlatformCompositeSheetKind =
  | "storyboard_sheet_portrait"
  | "storyboard_sheet_landscape"
  | "xiaohongshu_dual_note";

/**
 * 平台页 2×4：Gemini 双语编导 → 英文 prompt → **主路径 GPT-IMAGE-2** 横版 16:9；失败则 **Vertex Nano Banana 2**（`gemini-3.1-flash-image-preview`）同 prompt 16:9 兜底。**不使用** Imagen `:predict` 兜底。
 */
export async function generatePlatformCompositeSheetImage(options: {
  kind: PlatformCompositeSheetKind;
  title: string;
  scriptContext: string;
  isTrial?: boolean;
  executionDetails?: string;
  /** 可選：2×4 生圖逐步驟時間線 */
  flowLog?: string[];
}): Promise<string | null> {
  const L = options.flowLog;
  const k = options.kind;
  const isStoryboard = k === "storyboard_sheet_portrait" || k === "storyboard_sheet_landscape";
  const isXhs = k === "xiaohongshu_dual_note";
  if (!isStoryboard && !isXhs) {
    throw new Error(`Unsupported sheet kind: ${String(k)}`);
  }

  appendImageFlowLog(
    L,
    `[2×4 合成] kind=${k} · ${isStoryboard ? "分镜图文参考（buildVideoStoryboardGeminiPrompt）" : "小红书双笔记（buildXhsNoteGeminiPrompt）"} · 标题: ${String(options.title || "").slice(0, 60)}`,
  );
  appendImageFlowLog(L, `[2×4·步骤1] Gemini translatePlatformCompositeToEnglishPrompt（中文剧本→一条英文视觉指令）…`);

  let prompt: string;
  try {
    const { translatePlatformCompositeToEnglishPrompt } = await import(
      "./geminiPlatformCompositeTranslation.js"
    );
    prompt = await translatePlatformCompositeToEnglishPrompt({
      kind: k,
      scriptContext: options.scriptContext,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendImageFlowLog(L, `[2×4·步骤1] Gemini 失败: ${msg}`);
    console.warn(
      "[proxyImageService] platform composite prompt translation failed:",
      e instanceof Error ? e.message : e,
    );
    return null;
  }

  appendImageFlowLog(L, `[2×4·步骤1] 完成 · 英文 prompt 约 ${prompt.length} 字符（预览）: ${prompt.replace(/\s+/g, " ").slice(0, 180)}…`);

  const subdir = isStoryboard ? "platform_storyboard_sheet" : "platform_xhs_dual";
  appendImageFlowLog(
    L,
    `[2×4·步骤2] GPT-IMAGE-2 横版 16:9 · gcsSubdir=${subdir} · 尺寸: ${GPT_IMAGE2_LANDSCAPE_SIZES.join(" → ")}`,
  );
  const primary = await postGptImage2AndUpload(prompt, subdir, {
    maxAttempts: 1,
    sizes: GPT_IMAGE2_LANDSCAPE_SIZES,
  });
  if (primary) {
    appendImageFlowLog(L, "[2×4·步骤2] GPT-IMAGE-2 成功");
    return primary;
  }

  appendImageFlowLog(
    L,
    "[2×4·步骤2] GPT-IMAGE-2 未返回图像 → 启动 Vertex Nano Banana 2（Gemini 3 Flash Image / gemini-3.1-flash-image-preview）16:9 兜底…",
  );

  try {
    const { generateGeminiImage, isGeminiImageAvailable } = await import("../gemini-image.js");
    if (!isGeminiImageAvailable()) {
      appendImageFlowLog(
        L,
        "[2×4·步骤3] Vertex 图像不可用（需 GOOGLE_APPLICATION_CREDENTIALS_JSON + VERTEX_PROJECT_ID），无法兜底",
      );
      throw new Error(
        "GPT-IMAGE-2 未出图且 Vertex Nano Banana 2 未配置，请稍后重试或联系管理员检查 Vertex 凭据。",
      );
    }
    const vertexResult = await generateGeminiImage({
      prompt: String(prompt).trim(),
      quality: "1k",
      aspectRatio: "16:9",
      personGeneration: "ALLOW_ADULT",
    });
    const fallbackUrl = String(vertexResult?.imageUrl || "").trim();
    if (!fallbackUrl) {
      appendImageFlowLog(L, "[2×4·步骤3] Nano Banana 2 返回空 URL");
      throw new Error("Vertex Nano Banana 2 未返回图像。");
    }
    appendImageFlowLog(
      L,
      `[2×4·步骤3] Nano Banana 2 兜底成功 · model=${vertexResult.model ?? "?"} · location=${vertexResult.location ?? "?"}`,
    );
    return fallbackUrl;
  } catch (fallbackError: any) {
    const flowLog = L ?? [];
    const realError = fallbackError?.message || String(fallbackError);
    flowLog.push(`[5] 双核引擎皆渲染失败，底层报错: ${realError}`);

    throw new Error(`[双核渲染崩溃]\n详细原因: ${realError}\n执行日志:\n${flowLog.join("\n")}`);
  }
}

/**
 * 旗艦生圖引擎：OhMyGPT `gpt-image-2` 主路徑 → Vertex **Nano Banana 2** 兜底。
 *
 * @description 截斷與水印只在 `buildTypographyImagePrompt` 內執行一次，禁止在本函數重複 `sliceHeading`，
 *   以免已帶省略號的標題被二次截斷。
 * @param options.title 畫面主標題來源（將強制截斷至 {@link PROXY_IMAGE_HEADING_MAX_CHARS} 字）
 * @param options.copywriting 畫面上下文 / 靈感（將強制截斷至 {@link PROXY_IMAGE_CONTEXT_MAX_CHARS} 字，不得整段渲染上圖）
 * @param options.mode STRATEGIC | STORYBOARD | GRAPHIC
 * @param options.isTrial 保留相容；文字/試讀水印由前端 DOM 疊加，不再寫入像素圖 prompt
 */
export async function generateImageGpt2WithImagenFallback(options: {
  title: string;
  copywriting: string;
  mode: ProxyImageTypographyMode;
  isTrial?: boolean;
  flowLog?: string[];
}): Promise<string | null> {
  const L = options.flowLog;
  appendImageFlowLog(
    L,
    `[版式兜底] buildTypographyImagePrompt + GPT-IMAGE-2 · mode=${options.mode} · 9:16（画内零字策略）`,
  );
  const primary = await generateGptImage2(options);
  if (primary) {
    appendImageFlowLog(L, "[版式兜底] GPT-IMAGE-2 成功");
    return primary;
  }

  appendImageFlowLog(L, "[版式兜底] GPT-IMAGE-2 无图 → Vertex Nano Banana 2 · 9:16 · 2K");
  const nbPrompt = buildTypographyImagePrompt({
    title: options.title,
    copywriting: options.copywriting,
    mode: options.mode,
    isTrial: options.isTrial,
    forImagenFallback: true,
  });
  return fallbackNanoBanana2FromPrompt(nbPrompt, "9:16", L);
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

/** Vertex Gemini 3.1 Pro（global）：Vercel 憑證見 `vertexGemini31ProGlobal.ts`（`GOOGLE_APPLICATION_CREDENTIALS_JSON` + `private_key` 換行修復）。 */
export { callGemini3_1_Pro } from "./vertexGemini31ProGlobal.js";
