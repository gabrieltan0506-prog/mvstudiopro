import { emitPlatformImagePipelineStat } from "./platformImagePipelineStats.js";
import { enforceSimplifiedChineseImagePrompt } from "./simplifiedChinese.js";
import {
  isPlatformVertexNanoBanana2FallbackEnabled,
  isPlatformWeekendGcpEscape,
  isPlatformWeekendSurvivalModeEnabled,
  resolvePlatformCompositeSheetImageEngine,
  resolvePlatformImageStorageDriver,
  type PlatformCompositeSheetImageEngine,
  type PlatformTopicCoverPixelEngineChoice,
} from "../config/platformSwitches.js";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs";
import {
  resolveVertexFlashTranslationLocation,
  resolveVertexFlashTranslationModelName,
  type PlatformImagePromptTranslator,
} from "./geminiPlatformCompositeTranslation.js";
import { appendVertexProPhotographyPromptModifiers } from "./imageGenerationService.js";
import {
  buildGptImage2AlignedPlatformTopicCoverPrompt,
  PLATFORM_TOPIC_COVER_GPT2_ASPECT_LOCK_PROMPT_SUFFIX,
} from "./platformTopicCoverPrompt.js";
import { platformFlowLogTimestamp } from "../utils/platformFlowLogTimestamp.js";
import { normalizeCompositeSheetKind } from "./geminiPlatformCompositeTranslation.js";
import { appendFashionEditorialCharacterGuidance, PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH } from "../../shared/platformFashionEditorialCharacter.js";
import { isGraphicNoteMetaCreatorGuidance } from "../../shared/graphicNoteReaderFacing.js";
import { STORYBOARD_ON_IMAGE_TEXT_ZH } from "../../shared/storyboardTextClarity.js";
import { STORYBOARD_LIGHTING_EMOTION_GUIDANCE_ZH } from "../../shared/storyboardLightingEmotion.js";
import {
  isEvolinkGptImage2Configured,
  isEvolinkModerationFailure,
  postEvolinkGptImage2AndUpload,
} from "./evolinkGptImage2.js";

const OHMYGPT_BASE = String(process.env.OHMYGPT_API_BASE || "https://api.ohmygpt.com/v1").replace(/\/$/, "");

/**
 * 平台選題生圖：預設 **GCS** + 簽名 URL；設 `PLATFORM_IMAGE_STORAGE=fly` 則 Fly 卷 + flyVolumeMedia。
 * 兼容 `PLATFORM_TOPIC_IMAGE_USE_FLY_VOLUME=1` 強制走 Fly。
 */
function isFlyPlatformTopicImageStorage(): boolean {
  return resolvePlatformImageStorageDriver() === "fly";
}

/** 平台頁 Debug：可選逐步驟時間線（僅在調用方傳入陣列時寫入）。jobs120：嚴格陣列校驗，避免非陣列誤傳導致運行時寫入失敗。 */
export function appendImageFlowLog(log: string[] | undefined, message: string): void {
  if (!log || !Array.isArray(log)) return;
  log.push(`${platformFlowLogTimestamp()}  ${message}`);
}

export type ProxyImageTypographyMode = "STRATEGIC" | "STORYBOARD" | "GRAPHIC";
export type ImagePromptStats = {
  translatedPromptChars: number;
  translatedPromptWords: number;
};

function countPromptWords(text: string): number {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

export function buildImagePromptStats(englishPrompt: string): ImagePromptStats {
  const p = String(englishPrompt || "").trim();
  return {
    translatedPromptChars: p.length,
    translatedPromptWords: countPromptWords(p),
  };
}

/**
 * 視覺防禦常數 — **畫內零文字**：標題與文案由前端 / HTML 疊加，gpt-image-2 只出純畫面。
 */
export const PROXY_IMAGE_HEADING_MAX_CHARS = 35;
export const PROXY_IMAGE_CONTEXT_MAX_CHARS = 500;
/** 分鏡表 / 小紅書 2×4 八格：單圖內多格，需保留足夠劇本細節 */
export const PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS = 3500;

/**
 * gpt-image-2 经 OhMyGPT / fal 转发时，`size` 或 `image_size` 须落在 **OpenAI GPT Image 模型白名单**内，否则会 HTTP 400。
 * **平台主路径固定兩檔**：豎版 **1024×1536**、橫版 **1536×1024**（皆為 16 的倍數）；不再传 `auto`、`1024×1024` 等後備。
 */
/** gpt-image-2 請求體：`output_format: png` 避免 JPEG 重壓縮；落盤後仍寫 GCS/Fly。 */
/** gpt-image-2 quality：默认 **high**（对标可发笔记清晰度）；`GPT_IMAGE2_QUALITY` / 分项 env 可降为 medium|low 控成本。 */
type GptImage2ApiQuality = "low" | "medium" | "high";
function resolveGptImage2ApiQuality(envKeys: string[], fallback: GptImage2ApiQuality = "high"): GptImage2ApiQuality {
  for (const key of envKeys) {
    const raw = String(process.env[key] || "")
      .trim()
      .toLowerCase();
    if (raw === "low" || raw === "medium" || raw === "high") return raw;
  }
  return fallback;
}
/** 豎版封面 GPT-IMAGE-2 quality（OhMyGPT / fal / EvoLink 共用） */
const GPT_IMAGE2_PORTRAIT_API_QUALITY: GptImage2ApiQuality = resolveGptImage2ApiQuality(
  ["GPT_IMAGE2_PORTRAIT_QUALITY", "GPT_IMAGE2_QUALITY"],
  "high",
);
/** 2×4 宽幅分镜 / 八格 GPT-IMAGE-2 quality — 默认 high，与封面一致 */
const GPT_IMAGE2_COMPOSITE_2X4_API_QUALITY: GptImage2ApiQuality = resolveGptImage2ApiQuality(
  ["GPT_IMAGE2_COMPOSITE_QUALITY", "GPT_IMAGE2_QUALITY"],
  "high",
);
const GPT_IMAGE2_OUTPUT_FORMAT = "png" as const;
/** 豎版：僅 **1024×1536**（與 OpenAI 白名單一致，2:3） */
const GPT_IMAGE2_PORTRAIT_SIZES = ["1024x1536"] as const;

/** 橫幅 / 2×4 主表：僅 **1536×1024**（與 OpenAI 白名單一致，3:2） */
const GPT_IMAGE2_LANDSCAPE_SIZES = ["1536x1024"] as const;

/**
 * 白名單中第一個非 `auto` 的 `WxH`（現行白名單已無 `auto`，預期直接取唯一檔；fal 需明確寬高）。
 */
function firstConcreteOpenAiGptImage2Size(sizes: readonly string[]): string {
  for (const s of sizes) {
    const t = String(s || "").trim().toLowerCase();
    if (t && t !== "auto") return String(s).trim();
  }
  throw new Error("gpt-image-2: 尺寸白名單為空（須為 1024x1536 或 1536x1024）");
}

/** `1024x1536` → fal `image_size`；不可為 `auto`。 */
function gptImage2OpenAiSizeToFalImageSize(openAiSize: string): { width: number; height: number } {
  const s = String(openAiSize || "").trim().toLowerCase();
  if (s === "auto") throw new Error("gpt-image-2 fal: size 不可為 auto，請先 firstConcreteOpenAiGptImage2Size");
  const m = /^(\d+)x(\d+)$/.exec(s);
  if (!m) throw new Error(`gpt-image-2 fal: 無法解析 size: ${openAiSize}`);
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1) {
    throw new Error(`gpt-image-2 fal: 無效尺寸: ${openAiSize}`);
  }
  return { width, height };
}

/** 與 {@link postGptImage2AndUpload} → OhMyGPT `images/generations` 欄位語義一致（單一真相來源：quality / output_format / model / n）。 */
function buildOhMyGptGptImage2RequestBody(
  promptForApi: string,
  size: string,
  quality: GptImage2ApiQuality = GPT_IMAGE2_PORTRAIT_API_QUALITY,
) {
  return {
    model: "gpt-image-2",
    prompt: promptForApi,
    n: 1,
    size,
    quality,
    output_format: GPT_IMAGE2_OUTPUT_FORMAT,
    response_format: "b64_json",
  };
}

/**
 * fal `openai/gpt-image-2`：鍵名依 fal schema，**值**與 OhMyGPT 共用 quality / {@link GPT_IMAGE2_OUTPUT_FORMAT}、
 * 與同一組尺寸白名單推導出的 `openAiSize`（再轉 `image_size`）。
 */
function buildFalGptImage2RequestBody(
  prompt: string,
  openAiSize: string,
  quality: GptImage2ApiQuality = GPT_IMAGE2_PORTRAIT_API_QUALITY,
) {
  return {
    prompt,
    image_size: gptImage2OpenAiSizeToFalImageSize(openAiSize),
    quality,
    num_images: 1 as const,
    output_format: GPT_IMAGE2_OUTPUT_FORMAT,
  };
}

/** 拼在寬幅 2×4 合成英文 prompt 末尾：頂部簡中主標 + 幾何鎖定 + **每格底部簡中訊息分格表**（與 {@link STORYBOARD_2X4_SHEET_TRANSLATION_FOOTER} 一致）。 */
const GPT_IMAGE2_STORYBOARD_2X4_PIXEL_LOCK =
  "CRITICAL COMPOSITION LOCK: single wide landscape ~16:9 master. TOP ~8–12% HEIGHT ONLY: full-width band = **内容总结** as the sheet-level theme (whole-script / episode summary); may include 「· 分镜脚本」suffix—**no per-shot titles in this band**. Below: EXACTLY eight equal panels, 2 rows × 4 columns, straight gutters. PER PANEL top-to-bottom: (1) **分镜主题描述** one bold legible **Simplified Chinese** line for that shot only (≤12 chars preferred); (2) cinematic still; (3) bottom ~30–35% = **Simplified Chinese** table with **six labeled fields** — **景别**, **运镜**, **灯光安排**, **情绪表达**, **画面内容**, **台词与音效** — all six filled with **short** cells (≤12–14 chars each); thin grid OK; table body must be 简体中文. TEXT CLARITY: large crisp glyphs; light paper-tint table band. Include lighting + emotion cells. Soft preference: avoid harsh black bar + tiny white type. NOT RECOMMENDED: missing top **内容总结** strip; first row of panels flush to canvas top; placing per-shot **分镜主题描述** in the global top band instead of inside each cell; fewer than eight cells; English-only tables; wholly empty panels; dense micro-text that becomes illegible.";

/** 小紅書八格：幾何與分鏡同為 2×4；畫風偏資訊圖 / 筆記感，每格強簡中（與 {@link XHS_GRAPHIC_NOTE_2X4_FOOTER} 一致）。 */
const GPT_IMAGE2_XHS_2X4_PIXEL_LOCK =
  "CRITICAL COMPOSITION LOCK: Xiaohongshu premium graphic note, single wide landscape ~16:9 master; EXACTLY eight equal panels in 2 rows × 4 columns with straight full-span gutters; row-major read (top L→R, then bottom L→R). EACH CELL: high-density editorial beat — legible Simplified Chinese titles, bullets, icons, pill tags, small diagrams, or numbered badges 01–08 as fits; cohesive luxury palette. TEXT CLARITY: crisp print-clear Simplified Chinese, adequate font size, no blurry glyphs. NOT RECOMMENDED: 2×2 four-cell layout only; single full-bleed hero; 50/50 split only; one horizontal strip of eight thin bands; left text column + right single photo; wholly English-only cells. SOFT PREFERENCE: let Hook/context drive light and color—daylight, soft pastel, or warm editorial tones are welcome when they fit; not recommended to default every sheet to heavy dark-gold / low-key gloom without narrative reason.";

/**
 * 3×4 十二格「分段」专用：**单段只画一整横排 4 格（1 row × 4 columns）**，供 3 段纵向拼成 3 行 × 4 列 = 12 格长图。
 * 关键是覆盖 2×4 锁里的「EXACTLY eight panels / 2 rows」，否则每段会各自又画成 2×4，拼出来像 2×4 而非真正的 3×4。
 */
const GPT_IMAGE2_STORYBOARD_ROWBAND_PIXEL_LOCK =
  "CRITICAL COMPOSITION LOCK (single row band): render EXACTLY FOUR equal panels in ONE single horizontal row — **1 row × 4 columns** — that fill the entire canvas width edge-to-edge with straight vertical gutters. **Do NOT draw a second row. Do NOT make a 2×4 eight-panel grid.** PER PANEL top-to-bottom: (1) one bold legible **Simplified Chinese** **分镜主题描述** line for that shot only (≤12 chars preferred); (2) cinematic still; (3) bottom ~30–35% = **Simplified Chinese** table with six labeled fields **景别 / 运镜 / 灯光安排 / 情绪表达 / 画面内容 / 台词与音效**, all six filled with short cells (≤12–14 chars); thin grid OK; table body must be 简体中文. TEXT CLARITY: large crisp glyphs; light paper-tint table band; include lighting + emotion. NOT RECOMMENDED: two stacked rows; eight panels; fewer than four panels; English-only tables; wholly empty panels; micro-text.";

/** 小红书 3×4 分段：单段一整横排 4 格资讯图 beat。 */
const GPT_IMAGE2_XHS_ROWBAND_PIXEL_LOCK =
  "CRITICAL COMPOSITION LOCK (single row band): Xiaohongshu premium graphic note — render EXACTLY FOUR equal panels in ONE single horizontal row — **1 row × 4 columns** — filling the whole canvas width with straight vertical gutters. **Do NOT draw a second row. Do NOT make a 2×4 eight-panel grid.** EACH CELL: high-density editorial beat — legible Simplified Chinese titles, bullets, icons, pill tags, small diagrams or numbered badges as fits (use the badge range given in the Chinese brief for this row; full sheet is 01–12 across three rows); cohesive luxury palette. If a modern narrator/host appears in any cell, FACE-LOCK to the attached reference photo; wardrobe may soft-adapt to the cell scene. NOT RECOMMENDED: two stacked rows; eight cells; single full-bleed hero; left text column + right single photo; wholly English-only cells.";

/** 单次 GPT-IMAGE-2（fal / OhMyGPT）fetch 超时；封面/分镜/图文笔记共用。默认 6 分钟；`GPT_IMAGE_FETCH_TIMEOUT_MS` 可缩短，上限 6 分钟。 */
const GPT_IMAGE2_REQUEST_TIMEOUT_MS = Math.min(
  6 * 60_000,
  Math.max(60_000, Number(process.env.GPT_IMAGE_FETCH_TIMEOUT_MS) || 6 * 60_000),
);

/**
 * **fal** `openai/gpt-image-2` 與 **OhMyGPT** 同段生圖：單段最多嘗試次數（含首次）。預設 **3**，滿次仍失敗則交下一段（fal / Vertex）。
 * 可用 `GPT_IMAGE2_MAX_ATTEMPTS` 或歷史名 `GPT_IMAGE2_PER_SIZE_MAX_ATTEMPTS` 覆寫，範圍 1～8。
 */
const GPT_IMAGE2_MAX_ATTEMPTS = Math.min(
  8,
  Math.max(
    1,
    Number(process.env.GPT_IMAGE2_MAX_ATTEMPTS) ||
      Number(process.env.GPT_IMAGE2_PER_SIZE_MAX_ATTEMPTS) ||
      2,
  ),
);

/**
 * **OhMyGPT 主路徑**跨尺寸累計失敗熔斷：達此值後 `return null` 交 fal / Vertex 等（產品順序：**OhMyGPT → fal → Vertex**）。
 * 預設為 `GPT_IMAGE2_MAX_ATTEMPTS * 3`；現行尺寸白名單僅各一檔（**1024×1536** / **1536×1024**），可 `GPT_IMAGE2_PRIMARY_FAILS_BEFORE_FAL` 覆寫；上限 48。
 */
const GPT_IMAGE2_OHMYGPT_ABORT_AFTER_FAILS = Math.min(
  48,
  Math.max(
    GPT_IMAGE2_MAX_ATTEMPTS,
    Number(process.env.GPT_IMAGE2_PRIMARY_FAILS_BEFORE_FAL) || GPT_IMAGE2_MAX_ATTEMPTS * 3,
  ),
);

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 僅認證/權限類錯誤立即放棄；429/5xx 由 {@link postGptImage2AndUpload} 內重試同尺寸。 */
function shouldAbortGptImage2SizeRetries(status: number): boolean {
  return status === 401 || status === 403;
}

/**
 * Midjourney / Discord 風格參數（如 `--ar 3:2 --v 6`）對 GPT-IMAGE-2 無實際作用，易干擾語義；自第一個此類 flag 起截斷至文末。
 */
function stripMidjourneyStyleSuffixFromGptImagePrompt(prompt: string): { cleaned: string; stripped: boolean } {
  const s = String(prompt || "").trim();
  if (!s) return { cleaned: s, stripped: false };
  const mj =
    /\s--(?:ar|aspect|v|version|chaos|stylize|style|seed|no|iw|quality|q|tile|video|cref|cw|sref|sw|niji|fast|relax|turbo)\b/i;
  const m = mj.exec(s);
  if (m?.index == null) return { cleaned: s, stripped: false };
  return { cleaned: s.slice(0, m.index).trimEnd(), stripped: true };
}

/** 從 OpenAI 風格 JSON 響應摘錯誤，供 debug 面板辨識 429/400/5xx 具體原因 */
function summarizeGptImage2HttpErrorBody(json: unknown): string {
  if (json == null) return "(empty body)";
  if (typeof json !== "object") return String(json).slice(0, 240);
  const j = json as Record<string, unknown>;
  const err = j.error;
  if (err && typeof err === "object") {
    const o = err as Record<string, unknown>;
    const parts: string[] = [];
    for (const k of ["code", "type", "param", "message"] as const) {
      const v = o[k];
      if (typeof v === "string" && v.trim()) parts.push(`${k}=${v.trim().replace(/\s+/g, " ")}`);
    }
    if (parts.length) return parts.join(" · ").slice(0, 300);
  }
  return JSON.stringify(json).slice(0, 220);
}

/** fetch 異常分類：`AbortSignal.timeout` 在 Node 常表現為 TimeoutError / aborted due to timeout，並非上游 JSON error */
function classifyGptImage2FetchException(e: unknown): { code: string; detail: string } {
  const msg = e instanceof Error ? e.message : String(e);
  const name =
    typeof (e as { name?: string })?.name === "string" ? String((e as { name: string }).name) : "";

  if (name === "TimeoutError" || /aborted due to timeout|The operation was aborted/i.test(msg)) {
    return {
      code: "CLIENT_FETCH_ABORT_TIMEOUT",
      detail: `本地 fetch 在 ${GPT_IMAGE2_REQUEST_TIMEOUT_MS}ms 内未收齐响应（AbortSignal.timeout）。常见：上游仍在生图、代理排队、网关慢。并非响应体里的 OpenAI error JSON；重试会再发一整条 HTTP 请求，可能多计费。`,
    };
  }
  if (name === "AbortError" || /\babort\b/i.test(msg)) {
    return {
      code: "CLIENT_FETCH_ABORT",
      detail: `${name}: ${msg.slice(0, 180)}`.trim(),
    };
  }
  if (/ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|socket|network|fetch failed/i.test(msg)) {
    return { code: "NETWORK", detail: msg.slice(0, 240) };
  }
  return { code: "CLIENT_EXCEPTION", detail: `${name ? `${name}: ` : ""}${msg}`.slice(0, 240) };
}

function gptImage2HttpRetryHint(status: number): string {
  if (status === 429) return "限流/配额紧张（退避后重试）";
  if (status === 408) return "HTTP 408（可重试）";
  if (status >= 500 && status <= 599) return "服务端 5xx（可重试）";
  if (status === 400) return "请求体/参数/内容被拒（请看 API 体；盲目重试可能白烧钱）";
  return `HTTP ${status}`;
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
 * 舊版兜底鏈採用零文字策略；現已放寬給 GRAPHIC / STORYBOARD 生成簡體中文主標。
 */
export const NO_TEXT_ON_IMAGE_BLOCK = `
🛑 FATAL ERROR PREVENTION (STRICTLY NO TEXT/TYPOGRAPHY):
DO NOT render ANY text, letters, numbers, watermarks, spreadsheets, or characters on the image. DO NOT simulate text or documents. The output MUST be a completely clean visual canvas containing ONLY pixels.
`.trim();

/** 與 OhMyGPT gpt-image-2 與 Imagen 兜底：GRAPHIC / STORYBOARD 允許簡體中文主標；STRATEGIC 保持無字 */
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
  const allowChineseTypography = mode === "GRAPHIC" || mode === "STORYBOARD";
  const typographyBlock = allowChineseTypography
    ? [
        "MANDATORY ON-IMAGE TEXT:",
        `Render a large, legible Simplified Chinese headline based on: 「${displayHeading}」.`,
        "Use Simplified Chinese only, high contrast, clean hierarchy, premium editorial composition.",
        "If any secondary copy is needed, keep it minimal and also in Simplified Chinese.",
      ].join("\n")
    : NO_TEXT_ON_IMAGE_BLOCK;

  if (forImagenFallback) {
    return [
      allowChineseTypography
        ? "Professional 1024×1536 portrait editorial vertical scene with premium Simplified Chinese title integration."
        : "Professional 1024×1536 portrait editorial vertical scene — pure visuals only, absolutely no typography on the image.",
      allowChineseTypography
        ? `VISUAL BRIEF: ${visualContext}`
        : `VISUAL BRIEF (translate into imagery only; do NOT paint as readable text): ${visualContext}`,
      allowChineseTypography
        ? `SUBJECT / MOOD ANCHOR: ${displayHeading}`
        : `SUBJECT / MOOD ANCHOR (for composition only; do NOT spell as text): ${displayHeading}`,
      `STYLE: ${stylePrompt}`,
      typographyBlock,
      "Output framing: tall portrait matching OpenAI gpt-image-2 **1024×1536**. 8k aesthetic, masterpiece, no browser or phone UI mockups.",
    ].join("\n");
  }

  return `
Model: GPT-Image-2
Task: Create a professional 1024×1536 portrait vertical image (OpenAI tall preset).
VISUAL BRIEF: ${visualContext}
MOOD ANCHOR: ${displayHeading}
STYLE: ${stylePrompt}
${typographyBlock}
Output size: 1024×1536 portrait. 8k aesthetic, masterpiece.
`.trim();
}

/**
 * @description 橫版 ~16:9 分鏡合成（平台 2×4 兜底）：**八格 2×4**；每格下方 **簡中訊息分格表**（與主路徑 {@link GPT_IMAGE2_STORYBOARD_2X4_PIXEL_LOCK} 一致）。
 */
export function buildStoryboardSheetLandscapePrompt(options: {
  title: string;
  scriptContext: string;
  /** 保留相容：浮水印不進 prompt */
  isTrial?: boolean;
  /** 燈光與情緒（平台頁彙總後下發） */
  executionDetails?: string;
}): string {
  void options.isTrial;
  const displayTitle = sliceHeading(String(options.title || "").trim() || "分镜主题");
  const raw = String(options.scriptContext || "").trim();
  const scriptSlice =
    raw.length > PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS
      ? raw.slice(0, PROXY_IMAGE_SHEET_CONTEXT_MAX_CHARS)
      : raw;
  const staging = String(options.executionDetails || "").trim()
    || "High-end intellectual authority, Rembrandt lighting, cinematic softbox";

  return `
Model: GPT-Image-2 / Gemini Image
TASK: Cinematic 2×4 grid storyboard contact sheet — one single wide landscape master frame (~16:9), eight dramatic film stills, 8k, intricate details.

COMPOSITION (NON-NEGOTIABLE):
- TOP BAND FIRST (~8–12% height): **内容总结** — full-width **Simplified Chinese** strip for the **whole-sheet thematic summary** (episode / arc synopsis), **not** per-shot titles. You may append 「· 分镜脚本」or use this anchor line if it fits the summary: **${displayTitle}**. Clear divider before the grid. **Do not** put individual 分镜主题描述 in this band.
- BELOW: EXACTLY eight equal panels, 2 rows × 4 columns, straight gutters. Each panel **top → bottom**: (1) one bold **分镜主题描述** line in 简体中文 for that shot only; (2) cinematic still; (3) lower ~25–30% = **Simplified Chinese** table with **four fields**: **景别**、**运镜**、**画面内容**、**台词与音效** — all four with content; thin grid OK. Table body must be 简体中文.
- NOT RECOMMENDED: missing top summary strip; eight panels flush to top edge; English-only tables; empty panels; fewer than eight cells.

MOOD / TITLE ANCHOR (content summary may echo): ${displayTitle}

VISUAL CONTEXT — SCENES (render as the film stills): ${scriptSlice}

CINEMA STAGING & LIGHTING: ${staging}

STYLE: Cinematic storyboard contact sheet, premium editorial, dramatic film stills, 8k.
Use a wide landscape master; GPT IMAGE 主路径多为 ~1536×1024 级宽幅；Vertex / Nano 16:9 兜底時構圖語義一致即可。
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
/** 小紅書 **2×2 四宫格**：16:9 **幾何鎖定**（四等分十字分割）+ **畫內零文字**（X10 / Geometric Straightjacket） */
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
TASK: Create a strict **2×2 four-quadrant** layout for Xiaohongshu (Little Red Book) inside a wide landscape canvas (GPT IMAGE 主路径多为 1536×1024 级宽幅).

🛑 GEOMETRIC LAYOUT RULES (FATAL IF IGNORED):
1. You MUST partition the canvas into EXACTLY **four equal rectangles** in a **2 rows × 2 columns** grid: **top-left**, **top-right**, **bottom-left**, **bottom-right**. One continuous **horizontal midline** and one continuous **vertical midline** must span the full width and full height, forming a clean **cross gutter** (four cells of equal area, ~25% each).
2. Visual reading order like a carousel: **TL → TR → BL → BR**. Each quadrant is a distinct "note page" beat (new focal, prop, or lighting) while staying cohesive with the content — not four duplicate stock shots.
3. NOT RECOMMENDED — avoid: a **50/50 left-right two-panel** split only; **left third solid text band + right two thirds single hero photo** (magazine cover split — NOT a 2×2 grid); a **single horizontal row of four** thin strips; one dominant full-bleed panel with tiny side tiles; messy scrapbook collage without a clear 2×2 structure.

${NO_TEXT_ON_IMAGE_BLOCK}

🛑 STAGING RULES (NO TYPOGRAPHY):
1. DO NOT render ANY text, titles, watermarks, logos, UI, or readable characters on the image. The output MUST be a clean visual canvas. The system UI will overlay typography via DOM.

🧠 VISUAL CONTEXT:
[AESTHETIC & LIGHTING — translate to pixels only; never spell as text]: ${executionDetails.slice(0, 2000)}
[CONTENT — visualize this logic as imagery only; do NOT paste as typography]: ${content}

STYLE: Editorial magazine photography, Vogue aesthetic, 8k resolution, masterpiece.
Wide landscape master frame; GPT IMAGE 主路径约为 1536×1024 级宽幅，几何上为 **2×2 四宫格**（四等分 + 十字对齐 gutter）。
`.trim();
}

async function postGptImage2AndUpload(
  prompt: string,
  gcsSubdir: string,
  opts: {
    maxAttempts?: number;
    sizes?: readonly string[];
    flowLog?: string[];
    quality?: GptImage2ApiQuality;
  } = {},
): Promise<string | null> {
  const L = opts.flowLog;
  const quality = opts.quality ?? GPT_IMAGE2_PORTRAIT_API_QUALITY;
  const apiKey = String(process.env.PROXY_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    appendImageFlowLog(L, "[GPT-IMAGE-2·OhMyGPT] PROXY_OPENAI_API_KEY 缺失，跳过 OhMyGPT");
    console.warn("[proxyImageService] PROXY_OPENAI_API_KEY missing, OhMyGPT gpt-image-2 skipped");
    return null;
  }

  const sizeList = opts.sizes ?? GPT_IMAGE2_PORTRAIT_SIZES;
  const maxAttempts = Math.min(
    Math.max(1, opts.maxAttempts ?? sizeList.length),
    sizeList.length,
  );
  const sizes = sizeList.slice(0, maxAttempts);

  // 分镜/图文/封面：送 GPT-Image-2 前强制简体（OpenCC + 屏内字锁）
  const promptSimplified = enforceSimplifiedChineseImagePrompt(prompt);
  const { cleaned: promptForApi, stripped: strippedMjSuffix } =
    stripMidjourneyStyleSuffixFromGptImagePrompt(promptSimplified);
  if (strippedMjSuffix) {
    appendImageFlowLog(L, "[GPT-IMAGE-2] 已去除 Midjourney 風格後綴（如 --ar / --v），比例以 API size 為準");
  }

  let primaryFailCount = 0;
  const notePrimaryFailure = (): boolean => {
    primaryFailCount += 1;
    if (primaryFailCount >= GPT_IMAGE2_OHMYGPT_ABORT_AFTER_FAILS) {
      appendImageFlowLog(
        L,
        `[GPT-IMAGE-2·OhMyGPT] 累计失败 ${primaryFailCount} 次（已达 ${GPT_IMAGE2_OHMYGPT_ABORT_AFTER_FAILS}，停止 OhMyGPT）→ 上层改走 fal / Vertex 等`,
      );
      return true;
    }
    return false;
  };

  for (const size of sizes) {
    let attempt = 0;
    const perSizeAttemptCap = GPT_IMAGE2_MAX_ATTEMPTS;
    while (attempt < perSizeAttemptCap) {
      attempt += 1;
      try {
        appendImageFlowLog(L, `[GPT-IMAGE-2] 尝试尺寸 ${size}（第 ${attempt}/${perSizeAttemptCap} 次）…`);
        const r = await fetch(`${OHMYGPT_BASE}/images/generations`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(buildOhMyGptGptImage2RequestBody(promptForApi, size, quality)),
          signal: AbortSignal.timeout(GPT_IMAGE2_REQUEST_TIMEOUT_MS),
        });
        const json: unknown = await r.json().catch(() => ({}));
        const anyJson = json as { data?: Array<{ b64_json?: string }> };
        if (!r.ok) {
          const apiErr = summarizeGptImage2HttpErrorBody(json);
          const hint = gptImage2HttpRetryHint(r.status);
          appendImageFlowLog(
            L,
            `[GPT-IMAGE-2] 尺寸 ${size} 失败 · 原因=HTTP_${r.status}（${hint}）· API 体: ${apiErr}`,
          );
          console.warn(
            "[proxyImageService] gpt-image-2 HTTP error:",
            r.status,
            `size=${size}`,
            JSON.stringify(json).slice(0, 400),
          );
          if (shouldAbortGptImage2SizeRetries(r.status)) return null;
          const retryableHttp =
            r.status === 429 ||
            r.status === 408 ||
            (r.status >= 500 && r.status <= 599);
          if (retryableHttp && attempt < perSizeAttemptCap) {
            if (notePrimaryFailure()) return null;
            const wait = r.status === 429 ? 4500 : 2000;
            appendImageFlowLog(
              L,
              `[GPT-IMAGE-2] 将同尺寸重试（第 ${attempt + 1}/${perSizeAttemptCap} 次调用）· 等待 ${wait}ms · 计费：每次 HTTP 均可能计入 OhMyGPT/OpenAI 账单`,
            );
            await sleepMs(wait);
            continue;
          }
          if (notePrimaryFailure()) return null;
          break;
        }
        const b64 = anyJson?.data?.[0]?.b64_json;
        if (!b64 || typeof b64 !== "string") {
          appendImageFlowLog(
            L,
            `[GPT-IMAGE-2] 尺寸 ${size} 失败 · 原因=EMPTY_B64_JSON（HTTP 200 但无 data[0].b64_json；可能被代理改写或字段名变更）`,
          );
          console.warn("[proxyImageService] gpt-image-2 missing b64_json, size=", size);
          if (attempt < perSizeAttemptCap) {
            if (notePrimaryFailure()) return null;
            appendImageFlowLog(
              L,
              `[GPT-IMAGE-2] 将同尺寸重试 · 等待 2000ms · 计费：本次响应已可能发生计费，视供应商规则`,
            );
            await sleepMs(2000);
            continue;
          }
          if (notePrimaryFailure()) return null;
          break;
        }

        const buffer = Buffer.from(b64, "base64");
        const ohMyFormat = sniffBinaryImageMime(buffer);
        const ohMyExt = ohMyFormat === "image/jpeg" ? "jpg" : "png";
        if (isFlyPlatformTopicImageStorage()) {
          const { writeFlyPlatformImageBuffer, buildFlyPlatformImagePublicUrl } = await import(
            "./flyVolumeGeneratedImages.js",
          );
          const flyCt: "image/jpeg" | "image/png" =
            ohMyFormat === "image/jpeg" ? "image/jpeg" : "image/png";
          const { relPath } = await writeFlyPlatformImageBuffer({
            subdir: gcsSubdir,
            buffer,
            contentType: flyCt,
          });
          const flyUrl = buildFlyPlatformImagePublicUrl(relPath);
          appendImageFlowLog(L, `[GPT-IMAGE-2] 尺寸 ${size} 成功，已写入 Fly 卷 · relPath=${relPath}`);
          appendImageFlowLog(L, `[GPT-IMAGE-2] 公開 URL 预览：${String(flyUrl).slice(0, 180)}…`);
          return flyUrl;
        }
        const path = `generated/${gcsSubdir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ohMyExt}`;
        const { gcsUri } = await uploadBufferToGcs({
          objectName: path,
          buffer,
          contentType: ohMyFormat,
        });
        const signedUrl = await signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
        appendImageFlowLog(L, `[GPT-IMAGE-2] 尺寸 ${size} 成功，已上传 GCS · gcsUri=${gcsUri}`);
        appendImageFlowLog(
          L,
          `[GPT-IMAGE-2] 尺寸 ${size} 签名 URL 预览：${String(signedUrl).slice(0, 180)}…`,
        );
        return signedUrl;
      } catch (e: unknown) {
        const { code, detail } = classifyGptImage2FetchException(e);
        appendImageFlowLog(
          L,
          `[GPT-IMAGE-2] 尺寸 ${size} 失败 · 原因=${code} · ${detail}`,
        );
        console.warn(
          "[proxyImageService] gpt-image-2 exception:",
          e instanceof Error ? e.message : e,
          "size=",
          size,
        );
        if (attempt < perSizeAttemptCap) {
          if (notePrimaryFailure()) return null;
          appendImageFlowLog(
            L,
            `[GPT-IMAGE-2] 将同尺寸重试（第 ${attempt + 1}/${perSizeAttemptCap} 次调用）· 等待 2500ms · 计费：每次请求均可能单独计费`,
          );
          await sleepMs(2500);
          continue;
        }
        if (notePrimaryFailure()) return null;
        break;
      }
    }
  }
  return null;
}

/**
 * 瀏覽器 <img> 可穩定載入的 GCS V4 簽名直鏈（與 {@link postGptImage2AndUpload} 一致）。
 * Vertex → {@link storagePut} 常回 Blob / R2 / 超大 data:，對外公開讀常 403 或超長失敗。
 */
function isPublicGcsSignedReadUrl(u: string): boolean {
  const s = u.toLowerCase();
  if (!s.includes("storage.googleapis.com")) return false;
  return s.includes("x-goog-signature") || s.includes("x-goog-algorithm");
}

function normalizeImageUploadContentType(mime: string): string {
  const m = String(mime || "").toLowerCase();
  if (m.includes("jpeg") || m.includes("jpg")) return "image/jpeg";
  if (m.includes("webp")) return "image/webp";
  return "image/png";
}

/** OhMyGPT `b64_json` 解碼後：依魔數辨識（主路徑 `output_format: png` 時多為 PNG）。 */
function sniffBinaryImageMime(buffer: Buffer): "image/png" | "image/jpeg" {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }
  return "image/png";
}

async function mirrorImageUrlToGcsSignedUrl(
  rawUrl: string,
  gcsSubdir: string,
  flowLog?: string[],
): Promise<string> {
  const u = String(rawUrl || "").trim();
  if (!u) return u;
  if (isPublicGcsSignedReadUrl(u)) return u;

  let buffer: Buffer;
  let headerMime: string;

  if (u.startsWith("data:")) {
    const comma = u.indexOf(",");
    if (comma <= 0) throw new Error("invalid_data_url");
    const meta = u.slice(5, comma);
    const b64 = u.slice(comma + 1);
    const mimeMatch = /^([^;]+)/.exec(meta);
    headerMime = mimeMatch?.[1]?.trim() || "image/png";
    buffer = Buffer.from(b64, "base64");
  } else if (u.startsWith("http://") || u.startsWith("https://")) {
    const r = await fetch(u, {
      redirect: "follow",
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) {
      throw new Error(`mirror_fetch_http_${r.status}`);
    }
    const ct = r.headers.get("content-type") || "image/png";
    headerMime = ct.split(";")[0].trim() || "image/png";
    buffer = Buffer.from(await r.arrayBuffer());
  } else {
    return u;
  }

  const contentType = normalizeImageUploadContentType(headerMime);
  const ext = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";

  if (isFlyPlatformTopicImageStorage()) {
    const { writeFlyPlatformImageBuffer, buildFlyPlatformImagePublicUrl } = await import(
      "./flyVolumeGeneratedImages.js",
    );
    const flyCt: "image/jpeg" | "image/png" | "image/webp" =
      contentType === "image/webp" ? "image/webp" : contentType === "image/png" ? "image/png" : "image/jpeg";
    const { relPath } = await writeFlyPlatformImageBuffer({
      subdir: gcsSubdir,
      buffer,
      contentType: flyCt,
    });
    const publicUrl = buildFlyPlatformImagePublicUrl(relPath);
    appendImageFlowLog(
      flowLog,
      `[存图] 已写入 Fly 持久卷（经 /api/jobs?op=flyVolumeMedia 公开读取）· relPath=${relPath}`,
    );
    return publicUrl;
  }

  const path = `generated/${gcsSubdir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { gcsUri } = await uploadBufferToGcs({
    objectName: path,
    buffer,
    contentType,
  });
  const signed = await signGsUriV4ReadUrl(gcsUri, 7 * 24 * 3600);
  appendImageFlowLog(
    flowLog,
    `[Vertex 出图] 已镜像到 GCS 签名 URL（与 GPT-IMAGE-2 主路径一致，避免 Blob/R2/data 外链浏览器失败）· gcsUri=${gcsUri}`,
  );
  return signed;
}

function getFalApiKeyForGptImage2(): string {
  return String(process.env.FAL_API_KEY || process.env.FAL_KEY || "").trim();
}

function isFalGptImage2FallbackEnabled(): boolean {
  const disableLegacy = String(process.env.DISABLE_FAL_GPT_IMAGE2_FALLBACK || "").trim().toLowerCase();
  if (disableLegacy === "1" || disableLegacy === "true" || disableLegacy === "yes" || disableLegacy === "on") {
    return false;
  }
  const enable = String(process.env.ENABLE_FAL_GPT_IMAGE2_FALLBACK || "").trim().toLowerCase();
  return enable === "1" || enable === "true" || enable === "yes" || enable === "on";
}

/**
 * **fal.ai** `openai/gpt-image-2`：**退路**（`fal.run` REST）；需 `FAL_API_KEY` / `FAL_KEY`。
 * `ENABLE_FAL_GPT_IMAGE2_FALLBACK=1` 時才會走 fal；默認關閉（僅 OhMyGPT + Vertex 等）。舊變量 `DISABLE_FAL_GPT_IMAGE2_FALLBACK=1` 仍強制關閉 fal。
 * @see https://fal.ai/models/openai/gpt-image-2/api
 */
async function postGptImage2ViaFalAndUpload(
  prompt: string,
  gcsSubdir: string,
  aspectRatio: "9:16" | "16:9",
  flowLog?: string[],
  quality: GptImage2ApiQuality = GPT_IMAGE2_PORTRAIT_API_QUALITY,
): Promise<string | null> {
  const L = flowLog;
  prompt = enforceSimplifiedChineseImagePrompt(prompt);
  if (!isFalGptImage2FallbackEnabled()) {
    appendImageFlowLog(
      L,
      "[FAL·GPT-IMAGE-2] 未啟用（默認僅 OhMyGPT；若需 fal 退路請設 ENABLE_FAL_GPT_IMAGE2_FALLBACK=1）→ 跳过 fal",
    );
    return null;
  }
  const key = getFalApiKeyForGptImage2();
  if (!key) {
    appendImageFlowLog(L, "[FAL·GPT-IMAGE-2] 无 FAL_API_KEY/FAL_KEY，跳过 fal 退路");
    return null;
  }
  const openAiSize = firstConcreteOpenAiGptImage2Size(
    aspectRatio === "9:16" ? GPT_IMAGE2_PORTRAIT_SIZES : GPT_IMAGE2_LANDSCAPE_SIZES,
  );
  const image_size = gptImage2OpenAiSizeToFalImageSize(openAiSize);

  appendImageFlowLog(
    L,
    `[FAL·GPT-IMAGE-2] POST https://fal.run/openai/gpt-image-2 · ${aspectRatio} · openAiSize=${openAiSize} · fal image_size=${image_size.width}×${image_size.height} · quality=${quality} · ${GPT_IMAGE2_OUTPUT_FORMAT}`,
  );
  try {
    const timeoutMs = GPT_IMAGE2_REQUEST_TIMEOUT_MS;
    const r = await fetch("https://fal.run/openai/gpt-image-2", {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildFalGptImage2RequestBody(prompt, openAiSize, quality)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const json: unknown = await r.json().catch(() => ({}));
    if (!r.ok) {
      appendImageFlowLog(
        L,
        `[FAL·GPT-IMAGE-2] HTTP ${r.status} · ${JSON.stringify(json).slice(0, 500)}`,
      );
      return null;
    }
    const j = json as {
      images?: Array<{ url?: string }>;
      data?: { images?: Array<{ url?: string }> };
    };
    const rawUrl = String(j.images?.[0]?.url || j.data?.images?.[0]?.url || "").trim();
    if (!rawUrl) {
      appendImageFlowLog(L, `[FAL·GPT-IMAGE-2] 响应无 images[0].url · body≈${JSON.stringify(json).slice(0, 280)}`);
      return null;
    }
    appendImageFlowLog(L, "[FAL·GPT-IMAGE-2] 已得 fal 临时 URL，落库到对外存储…");
    return await mirrorImageUrlToGcsSignedUrl(rawUrl, gcsSubdir, L);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendImageFlowLog(L, `[FAL·GPT-IMAGE-2] 异常: ${msg.slice(0, 400)}`);
    console.warn("[proxyImageService] fal openai/gpt-image-2:", msg);
    return null;
  }
}

/** 2×4 合成 / 翻译兜底：Nano 返回的外链镜像到 GCS 签名 URL，与主路径 GPT-IMAGE-2 一致。 */
async function mirrorNanoSheetUrlToGcs(
  rawUrl: string,
  gcsSubdir: string,
  flowLog?: string[],
): Promise<string> {
  const url = String(rawUrl || "").trim();
  if (!url) return url;
  if (isPublicGcsSignedReadUrl(url)) return url;
  try {
    return await mirrorImageUrlToGcsSignedUrl(url, gcsSubdir, flowLog);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    appendImageFlowLog(
      flowLog,
      `[2×4·Vertex] Nano → GCS 镜像失败: ${msg}`,
    );
    throw new Error(
      `Nano 兜底已生成图片，但镜像到 GCS 失败（浏览器通常无法直接使用 Vertex 返回的临时 URL）。请检查服务端存图配置或重试。底层: ${msg}`,
    );
  }
}

/**
 * Vertex 生圖（Nano / Pro 圖像模型，見 server/gemini-image.ts 內選型）。
 * - `optional_fallback_after_openai`：**GPT-IMAGE-2 主路徑失敗後**才走的兜底，受 `PLATFORM_VERTEX_NANO_BANANA2` / {@link PLATFORM_VERTEX_NANO_BANANA2_ENABLED} 約束。
 * - `platform_vertex_cover_primary`：用戶已選「監管 Vertex 封面」，**主路徑即 Vertex**，不得被上述兜底開關誤殺（仍遵 {@link isPlatformWeekendGcpEscape}）。
 */
type NanoBanana2FromPromptRole =
  | "optional_fallback_after_openai"
  | "platform_vertex_cover_primary";

/** GPT-IMAGE-2 失敗後：Vertex **Nano Banana 2**（`gemini-3.1-flash-image-preview`）· **2K**。模型不變，僅分辨率。 */
async function fallbackNanoBanana2FromPrompt(
  prompt: string,
  aspectRatio: "9:16" | "16:9",
  flowLog?: string[],
  role: NanoBanana2FromPromptRole = "optional_fallback_after_openai",
  /** 用户上传人像：送 Vertex 做脸锁，禁止无参考乱生成 */
  referenceImageUrl?: string,
): Promise<string | null> {
  const L = flowLog;
  const logTag = role === "platform_vertex_cover_primary" ? "[NB2·封面]" : "[单帧兜底]";
  const refUrl = String(referenceImageUrl || "").trim();

  if (role === "optional_fallback_after_openai") {
    if (!isPlatformVertexNanoBanana2FallbackEnabled()) {
      appendImageFlowLog(
        L,
        "[生圖兜底] Vertex Nano Banana 2 已關閉（僅 GPT-IMAGE-2）。開啟：PLATFORM_VERTEX_NANO_BANANA2=1 或 platformSwitches 中 PLATFORM_VERTEX_NANO_BANANA2_ENABLED",
      );
      return null;
    }
  } else if (isPlatformWeekendGcpEscape()) {
    appendImageFlowLog(
      L,
      `${logTag} 平台 GCP 避险中，监管 Vertex 封面暂停（与周末生存模式 / PLATFORM_WEEKEND_ESCAPE 等一致）`,
    );
    return null;
  }

  try {
    const { generateGeminiImage, isGeminiImageAvailable } = await import("../gemini-image.js");
    if (!isGeminiImageAvailable()) {
      appendImageFlowLog(
        L,
        `${logTag} Vertex 不可用（需 GOOGLE_APPLICATION_CREDENTIALS_JSON + VERTEX_PROJECT_ID），跳过 Nano Banana 2`,
      );
      return null;
    }
    if (refUrl) {
      appendImageFlowLog(L, `${logTag} 携带参考人像做脸锁 · ref=${refUrl.slice(0, 96)}`);
    }
    const vertexResult = await generateGeminiImage({
      prompt: String(prompt || "").trim(),
      quality: "2k",
      aspectRatio,
      personGeneration: "ALLOW_ADULT",
      imagePersistFlowLog: L,
      ...(refUrl ? { referenceImageUrl: refUrl } : {}),
    });
    let url = String(vertexResult?.imageUrl || "").trim();
    if (!url) {
      appendImageFlowLog(L, `${logTag} Nano Banana 2 返回空 URL`);
      return null;
    }
    try {
      url = await mirrorImageUrlToGcsSignedUrl(url, "platform_topic_reference", L);
    } catch (e: unknown) {
      appendImageFlowLog(
        L,
        `${logTag} Nano → GCS 镜像失败（仍返回 Vertex/storage 原始 URL，浏览器可能无法加载）: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    appendImageFlowLog(
      L,
      `${logTag} Nano Banana 2 成功 · 2K · model=${vertexResult.model ?? "?"} · location=${vertexResult.location ?? "?"}${
        refUrl ? " · 已锁参考人像" : ""
      }`,
    );
    return url;
  } catch (e: unknown) {
    appendImageFlowLog(L, `${logTag} Nano Banana 2 失败: ${e instanceof Error ? e.message : String(e)}`);
    console.warn("[proxyImageService] nano banana 2 fallback failed:", e);
    return null;
  }
}

/**
 * 單幀封面像素：**預設** 走 **GPT‑Image‑2**（`gpt_image2_only`）：**OhMyGPT → EvoLink → fal → NB2**；否則 Vertex Nano Banana 2。
 * 設 `PLATFORM_TOPIC_COVER_PIXEL_ENGINE=gpt_image2` 或請求 `coverPixelEngine=gpt_image2` 強制該鏈。
 * **Nano Banana Pro**：`PLATFORM_TOPIC_COVER_PIXEL_ENGINE=nbp_only` 或請求 `nano_banana_pro`。
 */
export async function generatePlatformTopicCoverNanoBanana2FromEnglishPrompt(options: {
  englishPrompt: string;
  flowLog?: string[];
  coverPixelEngine?: PlatformTopicCoverPixelEngineChoice;
  /** EvoLink edit 模式参考图（用户上传的人像 URL）；非空则换封面主角。 */
  referenceImageUrls?: string[];
  /** 出参：换脸被内容审核拦截时回填 `moderationBlocked`，供上层给用户明确提示。 */
  captureError?: { message?: string; moderationBlocked?: boolean };
}): Promise<string | null> {
  const raw = String(options.englishPrompt || "").trim();
  if (!raw) {
    appendImageFlowLog(options.flowLog, "[封面·像素] 英文 prompt 为空，跳过");
    return null;
  }
  const L = options.flowLog;
  const refImageUrls = (options.referenceImageUrls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, 16);

  // 封面统一走 GPT-Image-2 像素链：OhMyGPT（主力）→ EvoLink → …；有参考人像时 EvoLink edit → NB2（带脸锁），禁止无参考降级。
  appendImageFlowLog(
    L,
    `${platformFlowLogTimestamp()}  [封面·像素] GPT-IMAGE-2（9:16）· ${refImageUrls.length ? `edit模式·参考人像=${refImageUrls.length}张 · EvoLink → NB2（带脸锁）` : "顺序 OhMyGPT → EvoLink → fal → NB2"}…`,
  );
  return generateGptImage2FromRawEnglishPrompt({
    englishPrompt: raw,
    aspectRatio: "9:16",
    gcsSubdir: "platform_topic_reference",
    flowLog: L,
    referenceImageUrls: refImageUrls.length ? refImageUrls : undefined,
    captureError: options.captureError,
  });
}

/**
 * 版式兜底：**僅 Vertex Nano Banana 2**（零字版式 prompt），不經 GPT-IMAGE-2。
 * 供监管 Pro 模式在最終階段使用（與 {@link generateImageGpt2WithImagenFallback} 的 NB2 段對齊，但跳過 OhMyGPT）。
 */
export async function generatePlatformTopicTypographyNanoBanana2Only(options: {
  title: string;
  copywriting: string;
  mode: ProxyImageTypographyMode;
  isTrial?: boolean;
  flowLog?: string[];
}): Promise<string | null> {
  const L = options.flowLog;
  appendImageFlowLog(
    L,
    `${new Date().toISOString()}  [版式兜底·仅Vertex] buildTypographyImagePrompt → Nano Banana 2 · mode=${options.mode} · 9:16 · GPT-IMAGE-2 同款比例锁 + Pro 光影（與 NB-Pro 一致）`,
  );
  const nbPrompt = buildTypographyImagePrompt({
    title: options.title,
    copywriting: options.copywriting,
    mode: options.mode,
    isTrial: options.isTrial,
    forImagenFallback: true,
  });
  const withLock = [nbPrompt, PLATFORM_TOPIC_COVER_GPT2_ASPECT_LOCK_PROMPT_SUFFIX].join("\n\n");
  const withProVisual = appendVertexProPhotographyPromptModifiers(
    withLock,
    "platform_vertical_cover_after_gpt2_aspect_lock",
  );
  return fallbackNanoBanana2FromPrompt(withProVisual, "9:16", L, "platform_vertex_cover_primary");
}

/**
 * 用户上传人像参考图时追加的「换人/换脸」编辑指令（GPT-Image-2 edit 模式 image_urls）。
 * 保留封面设计/排版/简中文字/9:16 构图，仅把主角替换为参考图中的真人并保住其相貌辨识度。
 */
const COVER_REFERENCE_PERSON_EDIT_DIRECTIVE_EN = [
  "",
  "REFERENCE PERSON (CRITICAL IMAGE EDIT): One reference photo of a real person is attached as input.",
  "FACE LOCK (HARD): Replace the main human character on this cover with THIS exact person. Preserve their facial identity,",
  "face shape, skin tone, hairstyle and overall likeness so they are immediately recognizable.",
  "WARDROBE LOCK (HARD): Restyle lighting, pose and background to fit the cover design, BUT clothing MUST match the",
  "depicted action/scene (tennis → athletic tennis kit; swim → swimwear; hike → outdoor technical wear).",
  "NEVER keep a heavy coat / formal overcoat / suit jacket while the person is mid tennis serve or other sport action.",
  "Render only ONE person, with a natural, flattering, magazine-grade portrait integration",
  "(no distortion, no extra faces, no duplicated heads).",
  "Keep ALL designed Simplified Chinese (简体中文 / zh-Hans) text, layout, color palette and the 9:16 vertical framing unchanged.",
  "On-image glyphs must stay Mainland Simplified Chinese — never Traditional Chinese, never English body copy replacing the Chinese headline.",
].join("\n");

/**
 * 仅在 EvoLink 对一张「良性人像」误判为违规时，第二次重试才追加的**澄清语境**。
 * 它只是把上下文讲清楚（成年、著装得体、本人/已授权、用于杂志风封面编辑），
 * 用于降低对正常照片的「误杀」，**不**用于绕过对真正违规内容的安全审核。
 */
const COVER_REFERENCE_BENIGN_CLARIFIER_EN = [
  "",
  "CONTEXT (SAFE EDITORIAL USE): The attached reference is an ordinary, fully-clothed adult portrait,",
  "provided with consent by the rightful owner for a tasteful, professional magazine-style cover edit.",
  "There is no nudity, no sexual content and no minors. Produce a respectful, family-friendly,",
  "editorial-grade portrait integration suitable for publication.",
].join("\n");

/** 2×4/3×4 分镜与图文：参考人像时锁脸；衣着可随场景微调 */
const STORYBOARD_REFERENCE_PROTAGONIST_DIRECTIVE_EN = [
  "",
  "REFERENCE PROTAGONIST (CRITICAL IMAGE EDIT): A reference photo of the real presenter/host is attached.",
  "FACE LOCK (HARD): In every panel/cell where the modern-day presenter, host, or narrator appears",
  "(including Xiaohongshu graphic-note explanation panels with a person), use THIS exact person's face,",
  "bone structure, eyes, nose, mouth, age, skin tone and hairstyle — same identity across the whole sheet.",
  "WARDROBE (HARD MATCH TO SCENE): Clothing, layering and accessories MUST adapt to each scene's action and setting",
  "(sport action → athletic kit; indoor talk → editorial formal OK). Keep the same fashion tier and body type;",
  "do not invent a different person via outfit alone; never absurd mismatches like overcoat-on-tennis-court.",
  "Only depict a different unfamiliar person when the script explicitly calls for ancient/historical figures,",
  "named third-party characters, or clearly distinct roles; never replace the main host with a random stranger.",
  "All on-image Chinese text stays Mainland Simplified Chinese (简体中文).",
].join("\n");

/** 参考图为已生成的竖版封面时：强制与封面同脸（解决抠像→封面 OK、分镜/图文换脸） */
const STORYBOARD_COVER_FACE_LOCK_DIRECTIVE_EN = [
  "",
  "APPROVED COVER FACE LOCK (HIGHEST PRIORITY): The attached reference is the finalized vertical cover art.",
  "The presenter/host face in EVERY modern-day panel or graphic-note cell with a person MUST match this cover",
  "exactly — same facial bone structure, eyes, nose, mouth, age, hairstyle and skin tone.",
  "Wardrobe soft-adapts ONLY within the same scene family; face identity must not drift. Do NOT invent a new face per panel.",
  "If a panel shows sport action, wardrobe must be athletic for that action — never formal overcoat mid-serve.",
  "On-image text remains Mainland Simplified Chinese.",
].join("\n");

/** 3×4 续接段：以上一段横排成品为视觉真源，锁人物/场景/色调 */
const STORYBOARD_PREVIOUS_ROW_CONTINUITY_DIRECTIVE_EN = [
  "",
  "PREVIOUS ROW BAND CONTINUITY (CRITICAL IMAGE EDIT): One or more attached references include the already-rendered",
  "previous horizontal row of this same 3×4 long storyboard. Match the modern host face, hair, wardrobe tier,",
  "skin tone, and overall fashion-editorial look to those panels. Keep the SAME color grade, lighting direction,",
  "background material language, outer border and decorative frame so vertical stitching looks seamless.",
  "Continue the story with FOUR NEW panels only — do not redraw or duplicate the previous row's shots.",
  "Scene may progress, but stay in the same visual world (location family / set design language); avoid sudden",
  "wardrobe or location jumps that break continuity with the previous row.",
].join("\n");

function appendStoryboardProtagonistAnchorToScript(scriptContext: string, coverPersonaContext?: string): string {
  const persona = appendFashionEditorialCharacterGuidance(
    String(coverPersonaContext || "").trim(),
    { maxChars: 2800, lang: "zh" },
  );
  const anchor = [
    "【视觉锚点·主人公·锁脸】",
    "分镜表与图文笔记中，凡出现现代主讲/主人公/解说人物的格子，须与上传参考人像为同一人：五官、发型、肤色、年龄跨格一致，禁止换成陌生面孔。",
    "【场景服饰·防穿帮】衣着必须跟本格场景动作走：打网球穿网球运动装，游泳穿泳装，爬山穿户外功能装；禁止高定外套/大衣边发球边挥拍等穿帮。",
    "可微调色系与配饰，但身材与时装阶层不变；勿靠换装暗示换人。",
    "屏内字一律中国大陆简体中文。",
    "仅当脚本明确描写古人、历史人物、古代场景、顾客/路人等独立角色时，才使用不同人物造型。",
    persona,
  ]
    .filter(Boolean)
    .join("\n");
  return `${String(scriptContext || "").trim()}\n\n${anchor}`;
}

/**
 * 已由 Gemini **双语编导**写好的 **完整英文 raw prompt** → GPT-Image-2 像素链。
 * **供应商顺序：OhMyGPT（主力）→ EvoLink → fal → NB2**（无参考时）。
 * 传 `referenceImageUrls`（换人/换脸）时：**EvoLink edit → NB2（携带参考图脸锁）**；
 * **禁止**再降级到无参考 OhMyGPT/fal/NB2，避免出「无脸错图」浪费算力。
 */
export async function generateGptImage2FromRawEnglishPrompt(options: {
  englishPrompt: string;
  aspectRatio: "9:16" | "16:9";
  gcsSubdir: string;
  /** 试读等：追加到 prompt 末尾（仅像素出图） */
  trialWatermarkPromptSuffix?: string;
  /** 可選：逐步寫入供平台 Debug 面板展示 */
  flowLog?: string[];
  /** EvoLink edit 模式参考图（如用户上传的人像 URL）；非空则注入换人指令 + image_urls。 */
  referenceImageUrls?: string[];
  /**
   * 出参：失败时回填供上层做「快速失败 / 用户提示」。
   * `moderationBlocked` 为 true 表示内容审核拦截（换脸时即「参考人像被拦截」），属用户可纠正错误，**不应**继续重试。
   */
  captureError?: { message?: string; moderationBlocked?: boolean };
}): Promise<string | null> {
  const L = options.flowLog;
  const raw = String(options.englishPrompt || "").trim();
  if (!raw) {
    appendImageFlowLog(L, "[单帧·英文 prompt] 为空，跳过生图");
    return null;
  }
  const refImageUrls = (options.referenceImageUrls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .slice(0, 16);
  const hasRef = refImageUrls.length > 0;
  const suffix = String(options.trialWatermarkPromptSuffix || "").trim();
  const base =
    options.aspectRatio === "9:16"
      ? buildGptImage2AlignedPlatformTopicCoverPrompt(raw, suffix)
      : [raw, suffix].filter(Boolean).join("\n\n");
  const photoIntent =
    options.aspectRatio === "9:16" ? "platform_vertical_cover_after_gpt2_aspect_lock" : "platform_landscape_sheet";
  const withProVisual = appendVertexProPhotographyPromptModifiers(base, photoIntent);
  const prompt = hasRef ? `${withProVisual}\n${COVER_REFERENCE_PERSON_EDIT_DIRECTIVE_EN}` : withProVisual;
  const sizes = options.aspectRatio === "16:9" ? GPT_IMAGE2_LANDSCAPE_SIZES : GPT_IMAGE2_PORTRAIT_SIZES;

  if (!isEvolinkGptImage2Configured()) {
    appendImageFlowLog(L, "[单帧] EVOLINK_API_KEY 未配置 · 平台生图仅走 EvoLink GPT-IMAGE-2（已取消 OhMyGPT/fal/NB2）");
    if (options.captureError) {
      options.captureError.message = "EVOLINK_API_KEY is not configured";
    }
    return null;
  }

  const evoPrompt = hasRef ? prompt : withProVisual;
  appendImageFlowLog(
    L,
    `[单帧·唯一路径] EvoLink GPT-IMAGE-2${hasRef ? " edit" : ""} · ${options.aspectRatio} · size=${sizes[0]} · quality=${GPT_IMAGE2_PORTRAIT_API_QUALITY}${hasRef ? ` · 参考=${refImageUrls.length}张` : ""} · prompt≈${evoPrompt.length}字`,
  );
  const evoErr: { message?: string } = {};
  const fromEvolink = await postEvolinkGptImage2AndUpload(evoPrompt, options.gcsSubdir, {
    aspectRatio: options.aspectRatio,
    size: sizes[0],
    flowLog: L,
    quality: GPT_IMAGE2_PORTRAIT_API_QUALITY,
    imageUrls: hasRef ? refImageUrls : undefined,
    captureError: evoErr,
  });
  if (fromEvolink) {
    appendImageFlowLog(L, "[单帧·唯一路径] EvoLink GPT-IMAGE-2 成功，已落库");
    return fromEvolink;
  }

  if (hasRef && isEvolinkModerationFailure(evoErr.message)) {
    appendImageFlowLog(
      L,
      `[单帧·换脸] EvoLink 内容审核拦截（${String(evoErr.message).slice(0, 80)}）→ 附澄清语境重试一次`,
    );
    const retryErr: { message?: string } = {};
    const retryEvolink = await postEvolinkGptImage2AndUpload(
      `${evoPrompt}\n${COVER_REFERENCE_BENIGN_CLARIFIER_EN}`,
      options.gcsSubdir,
      {
        aspectRatio: options.aspectRatio,
        size: sizes[0],
        flowLog: L,
        quality: GPT_IMAGE2_PORTRAIT_API_QUALITY,
        imageUrls: refImageUrls,
        captureError: retryErr,
      },
    );
    if (retryEvolink) {
      appendImageFlowLog(L, "[单帧·换脸] 澄清语境重试成功，已落库");
      return retryEvolink;
    }
    if (isEvolinkModerationFailure(retryErr.message || evoErr.message)) {
      if (options.captureError) {
        options.captureError.moderationBlocked = true;
        options.captureError.message = retryErr.message || evoErr.message;
      }
      appendImageFlowLog(L, "[单帧·换脸] 澄清重试后仍被内容审核拦截 → 快速失败（已取消 NB2 降级）");
      return null;
    }
  }

  if (options.captureError && evoErr.message) {
    options.captureError.message = evoErr.message;
  }
  appendImageFlowLog(L, "[单帧] EvoLink GPT-IMAGE-2 无图 · 本条失败（可免费补发；已取消 OhMyGPT/fal/Nano Banana 2）");
  return null;
}

/**
 * 版式出图：仅 EvoLink `gpt-image-2`（已取消 OhMyGPT / fal）。
 */
export async function generateGptImage2(options: {
  title: string;
  copywriting: string;
  mode: ProxyImageTypographyMode;
  isTrial?: boolean;
  /** 可选：逐步日志 */
  flowLog?: string[];
}): Promise<string | null> {
  const L = options.flowLog;
  const core = buildTypographyImagePrompt({
    title: options.title,
    copywriting: options.copywriting,
    mode: options.mode,
    isTrial: options.isTrial,
    forImagenFallback: false,
  });
  const withAspect = [core, PLATFORM_TOPIC_COVER_GPT2_ASPECT_LOCK_PROMPT_SUFFIX].join("\n\n");
  const finalPrompt = appendVertexProPhotographyPromptModifiers(
    withAspect,
    "platform_vertical_cover_after_gpt2_aspect_lock",
  );
  if (!isEvolinkGptImage2Configured()) {
    appendImageFlowLog(L, "[版式] EVOLINK_API_KEY 未配置 · 仅走 EvoLink GPT-IMAGE-2");
    return null;
  }
  appendImageFlowLog(L, "[版式·唯一路径] EvoLink gpt-image-2 · 9:16");
  return postEvolinkGptImage2AndUpload(finalPrompt, options.mode.toLowerCase(), {
    aspectRatio: "9:16",
    size: GPT_IMAGE2_PORTRAIT_SIZES[0],
    flowLog: L,
    quality: GPT_IMAGE2_PORTRAIT_API_QUALITY,
  });
}

export type PlatformCompositeSheetKind =
  | "storyboard_sheet_portrait"
  | "storyboard_sheet_landscape"
  | "xiaohongshu_dual_note"
  | "single_page_knowledge_card";

/** 2×4 整链墙钟硬上限（默认 10min，与 platform_topic_image 一致）；`PLATFORM_COMPOSITE_SHEET_JOB_TIMEOUT_MS` 可覆寫，至少 60000ms */
function resolvePlatformCompositeSheetTotalTimeoutMs(): number {
  const raw = Number(process.env.PLATFORM_COMPOSITE_SHEET_JOB_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw >= 60_000) return raw;
  return 10 * 60_000;
}

/**
 * 2×4 合成：**主路徑**為 Vertex Nano Banana 2（16:9·2K），略過 OhMyGPT / fal 的 GPT‑Image‑2。
 */
async function generatePlatformCompositeSheetViaNanoBanana2Primary(options: {
  promptForImage: string;
  subdir: string;
  flowLog?: string[];
  attempt: number;
  compositeMaxAttempts: number;
  sheetKind: string;
  /** 用户上传人像 / 封面脸锁：送 Vertex 锁定主人公 */
  referenceImageUrl?: string;
}): Promise<string> {
  const L = options.flowLog;
  if (isPlatformWeekendGcpEscape()) {
    appendImageFlowLog(L, "[2×4·NB2主路径] 平台 GCP 避险中，暂停 Vertex Nano Banana 2");
    throw new Error("2×4 Nano Banana 2：平台 GCP 避险中，Vertex 暂停。");
  }
  const { generateGeminiImage, isGeminiImageAvailable } = await import("../gemini-image.js");
  if (!isGeminiImageAvailable()) {
    appendImageFlowLog(
      L,
      "[2×4·NB2主路径] Vertex 图像不可用（需 GOOGLE_APPLICATION_CREDENTIALS_JSON + VERTEX_PROJECT_ID）",
    );
    throw new Error("2×4 Vertex Nano Banana 2 主路径：Vertex 未配置。");
  }
  const refUrl = String(options.referenceImageUrl || "").trim();
  appendImageFlowLog(
    L,
    `[2×4·NB2主路径] Vertex Nano Banana 2 · 2K · 16:9 · prompt≈${options.promptForImage.length} chars${
      refUrl ? " · 携带参考人像脸锁" : ""
    }（已跳过 OhMyGPT / fal；切回 GPT 链：请求 compositeImageEngine=gpt_image2 或 PLATFORM_COMPOSITE_SHEET_ENGINE=gpt_image2）`,
  );
  const vertexResult = await generateGeminiImage({
    prompt: options.promptForImage,
    quality: "2k",
    aspectRatio: "16:9",
    personGeneration: "ALLOW_ADULT",
    imagePersistFlowLog: L,
    ...(refUrl ? { referenceImageUrl: refUrl } : {}),
  });
  const rawUrl = String(vertexResult?.imageUrl || "").trim();
  if (!rawUrl) {
    appendImageFlowLog(L, "[2×4·NB2主路径] Nano Banana 2 返回空 URL");
    throw new Error("Vertex Nano Banana 2 未返回图像。");
  }
  appendImageFlowLog(
    L,
    `[2×4·NB2主路径] Nano Banana 2 成功 · model=${vertexResult.model ?? "?"} · location=${vertexResult.location ?? "?"}`,
  );
  const mirrored = await mirrorNanoSheetUrlToGcs(rawUrl, options.subdir, L);
  appendImageFlowLog(
    L,
    `[2×4·NB2主路径] 整链第 ${options.attempt}/${options.compositeMaxAttempts} 次 · 成功`,
  );
  emitPlatformImagePipelineStat({
    event: "composite_sheet_nano_primary_success",
    sheetKind: options.sheetKind,
    compositeSheetAttempt: options.attempt,
    compositeSheetMaxAttempts: options.compositeMaxAttempts,
  });
  return mirrored;
}

/**
 * 平台页宽幅合成：**同一條** 英文生图 prompt（双语编导 → 可选提炼 → 像素锁）送生图；
 * - **`gpt_image2`（環境與相容預設）**：**OhMyGPT** → **fal** → 可選 **Nano Banana 2** 兜底（受 `PLATFORM_VERTEX_NANO_BANANA2` 約束）。
 * - **`nano_banana_2`**：**僅** Vertex **Nano Banana 2**（16:9·2K），略過 GPT‑Image‑2。
 */
export async function generatePlatformCompositeSheetImage(options: {
  kind: PlatformCompositeSheetKind;
  title: string;
  scriptContext: string;
  isTrial?: boolean;
  executionDetails?: string;
  /** 上传素材拍摄手法摘要（景别/布光/走位等），并入中文脚本约束 */
  shootingTechniqueBrief?: string;
  /** @deprecated 保留欄位僅兼容舊 job 入參，已忽略（2×4 固定中文直送）。 */
  imagePromptTranslator?: import("./geminiPlatformCompositeTranslation.js").PlatformImagePromptTranslator;
  /** 可選：2×4 生圖逐步驟時間線 */
  flowLog?: string[];
  /** 管理員：與選題封面同源，在中文骨架 / 中文直送前插入 Deep Research Pro（Interactions） */
  enableCompositeDeepResearchPro?: boolean;
  /** 套裝路徑：強制關閉 2×4 側 DR-Pro（與封面鏈併發時避免同題重複貴價 Interactions） */
  forceSkipCompositeDeepResearchPro?: boolean;
  /** IP / 身份錨點，供 DR Pro tenant 與選題錨定 */
  coverPersonaContext?: string;
  /** 用户上传主人公参考人像 → EvoLink edit，分镜各格保持同一人（古人/历史角色等脚本明示时除外） */
  referencePhotoUrl?: string;
  /**
   * 3×4 续接段等：额外参考图（如上一段横排成品 URL），与 referencePhotoUrl 一并送 EvoLink edit，
   * 用于锁跨段人物脸型、服装阶层、色调与场景材质语言。
   */
  continuityReferenceImageUrls?: string[];
  /** 参考图为已生成竖版封面（非原始抠像）→ 加强跨格同脸指令 */
  referencePhotoFromApprovedCover?: boolean;
  /**
   * 異步 platform job：寫入 Neon `jobs.output.chineseStaging`（2×4 編導中文 task），結案時剝除。
   */
  progressJobId?: string | null;
  /** 覆寫 2×4 出圖引擎；未傳則見 {@link resolvePlatformCompositeSheetImageEngine}（環境變數預設 gpt_image2 鏈）。 */
  compositeImageEngine?: PlatformCompositeSheetImageEngine;
  /** 仅 single_page_knowledge_card：上篇 / 下篇分页（标题自动加「（上篇）/（下篇）」，仅取对应半篇内容）。 */
  notePart?: import("./geminiPlatformCompositeTranslation.js").KnowledgeCardNotePart;
  /**
   * 仅 3×4 分段拼接：本次生成是「长图」的第 index/total 段（storyboard/xhs）。
   * 注入连贯/同风格指令，确保各段拼接后接缝处风格一致；第 2 段起不再重复顶部总标题栏。
   */
  gridSection?: { index: number; total: number };
}): Promise<string | null> {
  const totalMs = resolvePlatformCompositeSheetTotalTimeoutMs();
  appendImageFlowLog(
    options.flowLog,
    `[2×4·时限] 整链硬上限 ${Math.round(totalMs / 60000)} 分钟（PLATFORM_COMPOSITE_SHEET_JOB_TIMEOUT_MS 可覆寫，≥60000ms）`,
  );
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(
        new Error(`2×4 分镜/八格合成超时（${Math.round(totalMs / 60000)} 分钟硬上限，已终止）`),
      );
    }, totalMs);
  });

  const execute = async (): Promise<string | null> => {
  const L = options.flowLog;
  const k = normalizeCompositeSheetKind(options.kind);
  const isStoryboard = k === "storyboard_sheet_landscape";
  const isXhs = k === "xiaohongshu_dual_note";
  const isKnowledgeCard = k === "single_page_knowledge_card";
  if (!isStoryboard && !isXhs && !isKnowledgeCard) {
    throw new Error(`Unsupported sheet kind: ${String(k)}`);
  }
  const subdir = isStoryboard ? "platform_storyboard_sheet" : "platform_xhs_dual";
  const referencePhotoUrlEarly = String(options.referencePhotoUrl || "").trim() || undefined;
  const continuityRefsEarly = (options.continuityReferenceImageUrls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean);
  const compositeImageEngine =
    referencePhotoUrlEarly || continuityRefsEarly.length > 0
      ? "gpt_image2"
      : resolvePlatformCompositeSheetImageEngine(options.compositeImageEngine ?? null);

  const survival = isPlatformWeekendSurvivalModeEnabled();
  appendImageFlowLog(
    L,
    `[2×4·中文直送] 封面/分镜/八格均跳过英文化 · 中文主体 + 英文像素锁送 GPT-IMAGE-2${
      survival ? " · 生存模式已开启" : ""
    }`,
  );
  appendImageFlowLog(
    L,
    `[2×4·中文骨架] 封面链可选 extractChineseVisualBrief（GPT 5.4 JSON）；2×4 主体由 buildCompositeSheetDirectChineseBody 直送`,
  );
  appendImageFlowLog(
    L,
    `[宽幅合成] kind=${k} · ${isStoryboard ? "视频向 2×4 编导分镜主表（中文直送）" : isKnowledgeCard ? "单页连贯图文知识卡片（中文直送·buildSinglePageKnowledgeCardImagePrompt）" : "小红书 2×4 八格图文笔记（中文直送）"} · 标题: ${String(options.title || "").slice(0, 60)}`,
  );
  appendImageFlowLog(
    L,
    `[2×4·流程总览] 分镜图/八格全链路（出图=${
      compositeImageEngine === "nano_banana_2"
        ? "**Nano Banana 2 主路径**（略过 GPT‑Image‑2；请求 `compositeImageEngine=gpt_image2` 或部署 `PLATFORM_COMPOSITE_SHEET_ENGINE=gpt_image2` 可恢复）"
        : "**OhMyGPT→fal GPT‑Image‑2** → 可选 NB2 兜底"
    }）：① 中文主体（buildCompositeSheetDirectChineseBody）→ ② 英文像素锁 → ③ 送生图`,
  );
  const compositeMaxAttempts = Math.min(
    8,
    Math.max(1, Number(process.env.PLATFORM_COMPOSITE_SHEET_MAX_ATTEMPTS) || 2),
  );
  appendImageFlowLog(
    L,
    `[2×4·整链] 同一请求最多 ${compositeMaxAttempts} 次完整尝试（首次 + ${compositeMaxAttempts - 1} 次重试）；storyboard_sheet_* 与 xiaohongshu_dual_note 共用。每次尝试内含 **中文直送主体** 与 **生图主链/兜底**。可用 PLATFORM_COMPOSITE_SHEET_MAX_ATTEMPTS 覆寫（1～8）。`,
  );

  const formatForDr: "短视频" | "图文" = isXhs ? "图文" : "短视频";
  let scriptContextForPipeline = options.scriptContext;
  // 图文笔记禁止注入拍摄手法（否则会画成「导演手法卡」）；仅短视频分镜需要光影/机位。
  const stagingBits = isXhs
    ? []
    : [
        String(options.executionDetails || "").trim(),
        String(options.shootingTechniqueBrief || "").trim(),
      ].filter(Boolean);
  if (stagingBits.length > 0) {
    scriptContextForPipeline = `${String(scriptContextForPipeline || "").trim()}\n\n【光影与机位约束·拍摄手法】\n${stagingBits.join("\n\n")}`;
    appendImageFlowLog(L, `[2×4·拍摄手法] 已注入 executionDetails/shootingTechniqueBrief（${stagingBits.join(" · ").length} chars）`);
  } else if (isXhs && (options.executionDetails || options.shootingTechniqueBrief)) {
    appendImageFlowLog(L, `[2×4·图文] 已跳过 executionDetails/shootingTechniqueBrief（避免手法卡）`);
  }
  // 全案 / 自定义分镜：无论是否有参考人像，均注入国际时尚大片人物造型约束
  scriptContextForPipeline = appendFashionEditorialCharacterGuidance(scriptContextForPipeline, {
    maxChars: 14000,
    lang: "zh",
  });
  const referencePhotoUrl = String(options.referencePhotoUrl || "").trim() || undefined;
  const continuityRefs = (options.continuityReferenceImageUrls || [])
    .map((u) => String(u || "").trim())
    .filter(Boolean)
    .filter((u) => u !== referencePhotoUrl)
    .slice(0, 3);
  const hasAnyImageRef = Boolean(referencePhotoUrl) || continuityRefs.length > 0;
  void hasAnyImageRef;
  if (referencePhotoUrl || continuityRefs.length > 0) {
    scriptContextForPipeline = appendStoryboardProtagonistAnchorToScript(
      scriptContextForPipeline,
      options.coverPersonaContext,
    );
    if (continuityRefs.length > 0) {
      scriptContextForPipeline = `${String(scriptContextForPipeline).trim()}\n\n【3×4 跨段视觉真源】须对齐已生成的上一段横排：同一现代主人公脸型与时装阶层、同一色调布光与场景材质语言；本段只画新的一横排四格，禁止重画上一段镜头。`;
    }
    appendImageFlowLog(
      L,
      `[2×4·主人公参考] 已注入视觉锚点 · 参考=${referencePhotoUrl ? "人像/封面" : "无"}${continuityRefs.length ? ` + 连贯图${continuityRefs.length}张` : ""}（强制 GPT-IMAGE-2 edit 模式）`,
    );
  }
  const drFromAdmin = Boolean(options.enableCompositeDeepResearchPro);
  const { isCompositeSheetDeepResearchProEnabled, runCoverDeepResearchInteractionsBrief } = await import(
    "./coverDeepResearchProBrief.js",
  );
  const { buildCoverTaskInputFromPipeline } = await import("./agenticCoverWorkflow.js");
  const drFromEnv = isCompositeSheetDeepResearchProEnabled();
  const runCompositeDrPro =
    !options.forceSkipCompositeDeepResearchPro && (drFromAdmin || drFromEnv);

  if (runCompositeDrPro) {
    appendImageFlowLog(
      L,
      `[步骤0.5·DR-Pro·2×4] 管理员入参=${drFromAdmin ? "开启" : "关闭"} · 环境=${drFromEnv ? "开启" : "关闭"} → Interactions Deep Research Pro（注入分镜/八格中文语境；失败则忽略）`,
    );
    try {
      const drTask = buildCoverTaskInputFromPipeline({
        topicHook: options.title,
        format: formatForDr,
        context: options.scriptContext,
        coverPersonaContext: options.coverPersonaContext ?? "",
      });
      const drBrief = await runCoverDeepResearchInteractionsBrief(drTask, L ?? [], {
        logPrefix: "步骤0.5·DR-Pro·2×4",
        drBriefProduct: isStoryboard ? "composite_storyboard" : "composite_xhs_note",
      });
      if (drBrief?.trim()) {
        const tag = "【DeepResearch Pro·2×4 编导增强（简体）】";
        scriptContextForPipeline = `${String(scriptContextForPipeline).trim()}\n\n${tag}\n${drBrief.trim()}`;
      }
    } catch (e: unknown) {
      appendImageFlowLog(
        L,
        `[步骤0.5·DR-Pro·2×4] 异常（忽略）: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }
  if (runCompositeDrPro) {
    appendImageFlowLog(
      L,
      `[管线·阶段顺序·2×4] A/Deep Research Pro 段已结束 → B/中文直送主体组装`,
    );
  } else {
    appendImageFlowLog(
      L,
      `[管线·阶段顺序·2×4] 未启用 A/Deep Research Pro → 直接 B/中文直送主体组装`,
    );
  }

  let lastFailure: unknown = null;
  // 内容审核拦截属「用户可纠正错误」（OpenAI 文档：moderation_blocked / image_generation_user_error 不应自动重试）。
  // 命中后立即停手，不再空跑后续整链重试（重新组装主体 + 再次送审都会再次被同样内容拦截）。
  let moderationBlocked = false;

  for (let attempt = 1; attempt <= compositeMaxAttempts; attempt++) {
    appendImageFlowLog(
      L,
      `[2×4·整链] ═══ 第 ${attempt}/${compositeMaxAttempts} 次尝试开始 ═══`,
    );
    appendImageFlowLog(
      L,
      `[2×4·步骤1] 中文直送主体（buildCompositeSheetDirectChineseBody）…`,
    );

    try {
      let promptForImage: string;

      if (isKnowledgeCard) {
        const { buildSinglePageKnowledgeCardImagePrompt } = await import("./geminiPlatformCompositeTranslation.js");
        promptForImage = buildSinglePageKnowledgeCardImagePrompt(scriptContextForPipeline, options.notePart);
        appendImageFlowLog(
          L,
          `[单页知识卡片·步骤1] 中文 directive + Markdown 送 GPT-IMAGE-2 · 分页=${options.notePart ?? "整篇"} · 约 ${promptForImage.length} 字符`,
        );
        appendImageFlowLog(
          L,
          `[单页知识卡片·预览] ${promptForImage.replace(/\s+/g, " ").slice(0, 180)}…`,
        );
      } else {
        const { buildCompositeSheetDirectChineseBody } = await import("./geminiPlatformCompositeTranslation.js");

        const chineseCore = buildCompositeSheetDirectChineseBody(
          k as "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note",
          scriptContextForPipeline,
          {
            rowBand: Boolean(options.gridSection),
            sectionIndex: options.gridSection?.index,
            sectionTotal: options.gridSection?.total,
          },
        ).trim();
        if (!chineseCore) {
          appendImageFlowLog(L, "[2×4·步骤1] 中文主体为空");
          throw new Error("宽幅合成中文主体为空");
        }
        appendImageFlowLog(
          L,
          `[2×4·步骤1·中文直送] 中文主体 + 英文像素锁送 GPT-IMAGE-2（${
            options.gridSection
              ? isStoryboard
                ? "3×4 横排四格编导分镜"
                : "3×4 横排四格图文"
              : isStoryboard
                ? "电影 2×4 编导分镜"
                : "小红书 2×4 八格"
          }）· 约 ${chineseCore.length} 字符`,
        );

        appendImageFlowLog(L, "[2×4·步骤1·完成] 主体就绪，直接进入像素锁与送生图");
        appendImageFlowLog(
          L,
          `[2×4·步骤1] 主体约 ${chineseCore.length} 字符（预览）: ${chineseCore.replace(/\s+/g, " ").slice(0, 180)}…`,
        );

        const trimmedEnglishCore = chineseCore;
        // 3×4 分段（gridSection）时改用「单横排 4 格」锁，避免每段又被画成完整 2×4 → 拼出来仍像 2×4。
        const useRowBandLock = Boolean(options.gridSection);
        const pixelLock = useRowBandLock
          ? (isStoryboard ? GPT_IMAGE2_STORYBOARD_ROWBAND_PIXEL_LOCK : GPT_IMAGE2_XHS_ROWBAND_PIXEL_LOCK)
          : (isStoryboard ? GPT_IMAGE2_STORYBOARD_2X4_PIXEL_LOCK : GPT_IMAGE2_XHS_2X4_PIXEL_LOCK);
        const topicTitleZh = String(options.title || "").trim().slice(0, 80);
        // 3×4 分段时，仅第一段保留顶部「内容总结」主标，续接段不重复顶栏。
        const titleStripAllowed = !options.gridSection || (options.gridSection.index ?? 0) <= 0;
        const storyboardTitleInject =
          isStoryboard && topicTitleZh && titleStripAllowed
            ? `\n\n【顶栏·内容总结】在格子上方用简体中文写一条总述（整张弧线/Synopsis），不要写成每格分镜标题。可锚定或改写：「${topicTitleZh}」`
            : "";
        if (isStoryboard && topicTitleZh) {
          appendImageFlowLog(
            L,
            `[2×4·顶栏] 已并入 prompt · 内容总结锚点（简中）· len=${topicTitleZh.length} · 「${topicTitleZh.replace(/\s+/g, " ").slice(0, 72)}${topicTitleZh.length > 72 ? "…" : ""}」`,
          );
        }
        const promptForImageBase = isStoryboard
          ? `${trimmedEnglishCore}\n\n${STORYBOARD_ON_IMAGE_TEXT_ZH}\n\n${STORYBOARD_LIGHTING_EMOTION_GUIDANCE_ZH}\n\n${pixelLock}${storyboardTitleInject}`
          : `${trimmedEnglishCore}\n\n${pixelLock}${storyboardTitleInject}`;
        promptForImage = appendVertexProPhotographyPromptModifiers(promptForImageBase, "platform_landscape_sheet");

        appendImageFlowLog(
          L,
          `[2×4·步骤2·前] 已拼像素锁（${isStoryboard ? "电影 2×4 编导分镜" : "小红书 2×4 八格"}）+ 与 Vertex 共用鏡頭/光影語彙 · 送生图总长约 ${promptForImage.length} 字符`,
        );
      }

      if (options.gridSection && (isStoryboard || isXhs)) {
        const { index, total } = options.gridSection;
        const isFirst = index <= 0;
        promptForImage = `${promptForImage}

MULTI-PART LONG SHEET (CRITICAL): This image is **part ${index + 1} of ${total}** that will be **stacked vertically into ONE final long sheet of 3 rows × 4 columns = 12 panels**. Render **ONLY this part's single horizontal row of 4 NEW panels** (continue the storyline/notes; do NOT repeat panels from other parts). Keep the **SAME background color, palette, lighting, outer border and decorative style** as the sibling parts so the stitched seams blend invisibly; fill the whole canvas, no empty area. ${
          isFirst
            ? "This is the FIRST part: include a slim top 内容总结 title band, then this part's single row of 4 panels below it."
            : "This is a CONTINUATION part: do NOT repeat the global top title band — start directly with this part's single row of 4 panels at the very top edge."
        } CHARACTER & SHOOTING CONTINUITY (same as 2×4 rules): modern host/protagonist must stay **the same person** across all parts with **VOGUE / ELLE / Harper's Bazaar / Hollywood fashion-editorial** wardrobe matched to each scene (navy/black/cream/grey couture textures; optional understated luxury accessories, never forced clutter). Shot size / camera move / lighting / blocking must follow any 【光影与机位约束·拍摄手法】 or 【上传素材拍摄技法】 in the script (teaching demos: prefer fixed mid-long shot, phone/prop foreground, screen background). When a previous row-band image is attached as reference, treat it as the visual source of truth for face, wardrobe tier, color grade, lighting and set materials. All on-image text stays **Simplified Chinese**, print-clear, no garble.`;
        appendImageFlowLog(
          L,
          `[3×4·分段] 第 ${index + 1}/${total} 段 · 已注入连贯/同风格/时装大片/拍摄手法指令（${isFirst ? "含顶栏" : "无顶栏·续接"}）· prompt≈${promptForImage.length} 字符`,
        );
      }

      // GPT-Image-2 像素链：OhMyGPT → EvoLink → fal → Nano Banana 2；有参考人像时仍优先 EvoLink edit
      const refImageUrls = [
        ...(referencePhotoUrl ? [referencePhotoUrl] : []),
        ...continuityRefs,
      ].filter((u, idx, arr) => arr.indexOf(u) === idx).slice(0, 4);
      const hasSheetRefs = refImageUrls.length > 0;
      appendImageFlowLog(
        L,
        `[2×4·步骤2] GPT-IMAGE-2 · 宽幅 16:9 · quality=${GPT_IMAGE2_COMPOSITE_2X4_API_QUALITY} · gcsSubdir=${subdir} · size=${GPT_IMAGE2_LANDSCAPE_SIZES[0]} · ${
          hasSheetRefs ? "换脸·EvoLink edit → NB2" : "顺序 OhMyGPT → EvoLink → fal → NB2"
        }`,
      );

      if (hasSheetRefs && isEvolinkGptImage2Configured()) {
        const refDirectives = [
          referencePhotoUrl || continuityRefs.length ? STORYBOARD_REFERENCE_PROTAGONIST_DIRECTIVE_EN : "",
          referencePhotoUrl && options.referencePhotoFromApprovedCover
            ? STORYBOARD_COVER_FACE_LOCK_DIRECTIVE_EN
            : "",
          continuityRefs.length ? STORYBOARD_PREVIOUS_ROW_CONTINUITY_DIRECTIVE_EN : "",
        ]
          .filter(Boolean)
          .join("\n");
        const promptForEvo = `${promptForImage}${refDirectives}`;
        appendImageFlowLog(
          L,
          `[2×4·步骤2a·换脸主力] EvoLink GPT-IMAGE-2 edit · 16:9 · size=${GPT_IMAGE2_LANDSCAPE_SIZES[0]} · 参考=${refImageUrls.length}张${options.referencePhotoFromApprovedCover ? "(含封面脸锁)" : ""}${continuityRefs.length ? "+上段连贯" : ""}`,
        );
        const evoErr: { message?: string } = {};
        let fromEvolink = await postEvolinkGptImage2AndUpload(promptForEvo, subdir, {
          aspectRatio: "16:9",
          size: GPT_IMAGE2_LANDSCAPE_SIZES[0],
          flowLog: L,
          quality: GPT_IMAGE2_COMPOSITE_2X4_API_QUALITY,
          imageUrls: refImageUrls,
          captureError: evoErr,
        });
        if (!fromEvolink && isEvolinkModerationFailure(evoErr.message)) {
          appendImageFlowLog(L, "[2×4·主人公参考] EvoLink 审核拦截 → 附澄清语境重试一次");
          const retryErr: { message?: string } = {};
          fromEvolink = await postEvolinkGptImage2AndUpload(
            `${promptForEvo}\n${COVER_REFERENCE_BENIGN_CLARIFIER_EN}`,
            subdir,
            {
              aspectRatio: "16:9",
              size: GPT_IMAGE2_LANDSCAPE_SIZES[0],
              flowLog: L,
              quality: GPT_IMAGE2_COMPOSITE_2X4_API_QUALITY,
              imageUrls: refImageUrls,
              captureError: retryErr,
            },
          );
        }
        if (fromEvolink) {
          appendImageFlowLog(L, `[2×4·步骤2a·换脸主力] EvoLink 成功 · 整链第 ${attempt}/${compositeMaxAttempts} 次`);
          emitPlatformImagePipelineStat({
            event: "composite_sheet_gpt_image2_success",
            sheetKind: k,
            compositeSheetAttempt: attempt,
            compositeSheetMaxAttempts: compositeMaxAttempts,
          });
          return fromEvolink;
        }
        if (isEvolinkModerationFailure(evoErr.message)) {
          moderationBlocked = true;
          lastFailure = new Error(`内容审核拦截（${String(evoErr.message).slice(0, 120)}）`);
          appendImageFlowLog(
            L,
            `[2×4·步骤2a·换脸主力] EvoLink 内容审核拦截 → 标记快速失败（不再整链重试；OhMyGPT/fal/NB2 跳过）`,
          );
          throw lastFailure;
        }
        throw new Error("EvoLink GPT-IMAGE-2（带参考脸锁）未返回图像；已取消 Nano Banana 2 降级");
      }

      if (!isEvolinkGptImage2Configured()) {
        throw new Error("EVOLINK_API_KEY 未配置（2×4 仅走 EvoLink GPT-IMAGE-2）");
      }
      appendImageFlowLog(
        L,
        `[2×4·唯一路径] EvoLink GPT-IMAGE-2 · 宽幅 16:9 · quality=${GPT_IMAGE2_COMPOSITE_2X4_API_QUALITY}`,
      );
      const fromEvolink = await postEvolinkGptImage2AndUpload(promptForImage, subdir, {
        aspectRatio: "16:9",
        size: GPT_IMAGE2_LANDSCAPE_SIZES[0],
        flowLog: L,
        quality: GPT_IMAGE2_COMPOSITE_2X4_API_QUALITY,
      });
      if (fromEvolink) {
        appendImageFlowLog(L, `[2×4·唯一路径] EvoLink 成功 · 整链第 ${attempt}/${compositeMaxAttempts} 次`);
        emitPlatformImagePipelineStat({
          event: "composite_sheet_gpt_image2_success",
          sheetKind: k,
          compositeSheetAttempt: attempt,
          compositeSheetMaxAttempts: compositeMaxAttempts,
        });
        return fromEvolink;
      }
      throw new Error("EvoLink GPT-IMAGE-2 未返回图像（已取消 OhMyGPT / fal / Nano Banana 2）");
    } catch (e: unknown) {
      lastFailure = e;
      const msg = e instanceof Error ? e.message : String(e);
      appendImageFlowLog(
        L,
        `[2×4·整链] 第 ${attempt}/${compositeMaxAttempts} 次失败 · ${msg.replace(/\s+/g, " ").slice(0, 480)}`,
      );
      // 快速失败：内容审核拦截属用户可纠正错误，重试只会被同样内容再次拦截，立即停手省时省钱。
      if (moderationBlocked || isEvolinkModerationFailure(msg)) {
        moderationBlocked = true;
        appendImageFlowLog(
          L,
          `[2×4·整链] 命中内容审核拦截 → 快速失败，跳过剩余 ${compositeMaxAttempts - attempt} 次重试`,
        );
        break;
      }
      if (attempt >= compositeMaxAttempts) {
        break;
      }
      const backoff = attempt === 1 ? 4000 : attempt === 2 ? 8000 : 12_000;
      appendImageFlowLog(L, `[2×4·整链] ${backoff}ms 后整链重试（重新组装主体+生图）…`);
      await sleepMs(backoff);
    }
  }

  const flowLog = L ?? [];
  const finalMsg =
    lastFailure instanceof Error ? lastFailure.message : lastFailure != null ? String(lastFailure) : "unknown";
  if (moderationBlocked) {
    flowLog.push(`[2×4·整链] 内容审核拦截·已快速失败（未空跑重试）· ${finalMsg.slice(0, 200)}`);
    throw new Error(
      `[2×4 宽幅合成·内容审核拦截]\n该选题文案/画面触发了内容审核，已立即停止（未重复重试）。请调整文案后再试。\n最后原因: ${finalMsg}\n执行日志:\n${flowLog.join("\n")}`,
    );
  }
  flowLog.push(`[2×4·整链] 已达 ${compositeMaxAttempts} 次仍失败 · ${finalMsg.slice(0, 400)}`);
  throw new Error(`[2×4 宽幅合成·${compositeMaxAttempts} 次尝试均失败]\n最后原因: ${finalMsg}\n执行日志:\n${flowLog.join("\n")}`);
  };

  try {
    return await Promise.race([execute(), timeoutPromise]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

/**
 * 把一份文案/脚本按行/长度**对半（或三等分）**切成连续 N 段，供 3×4 分段生成用。
 * 优先按空行分段聚合；聚合不出来时按字符长度等分。
 */
export function splitScriptIntoSections(scriptContext: string, sections: number): string[] {
  const n = Math.max(2, Math.min(3, Math.floor(sections) || 2));
  const full = String(scriptContext || "").trim();
  if (!full) {
    return Array.from({ length: n }, (_, i) =>
      `【3×4 扩写·第 ${i + 1}/${n} 横排】请围绕同一主题新写 4 个不重复要点（本横排序号 ${(i * 4 + 1).toString().padStart(2, "0")}–${((i + 1) * 4).toString().padStart(2, "0")}），勿与其他横排重复。`,
    );
  }

  let out: string[] = [];
  // 先尝试按「空行分隔的段落块」聚合，保证不切断句子
  const blocks = full.split(/\n\s*\n+/).map((s) => s.trim()).filter(Boolean);
  if (blocks.length >= n) {
    const per = Math.ceil(blocks.length / n);
    for (let i = 0; i < n; i++) {
      out.push(blocks.slice(i * per, (i + 1) * per).join("\n\n").trim());
    }
    out = out.filter(Boolean);
  } else {
    // 按字符长度等分
    const per = Math.ceil(full.length / n);
    for (let i = 0; i < n; i++) {
      const chunk = full.slice(i * per, (i + 1) * per).trim();
      if (chunk) out.push(chunk);
    }
  }

  // 3×4 必须凑满 n 段；内容不足时用扩写指令补段，避免退化成单张 2×4 八格
  const seed = full.slice(0, 2400);
  while (out.length < n) {
    const i = out.length;
    out.push(
      `【3×4 扩写·第 ${i + 1}/${n} 横排】在同一主题下新写 4 个不重复的图文/分镜要点（序号 ${(i * 4 + 1)
        .toString()
        .padStart(2, "0")}–${((i + 1) * 4).toString().padStart(2, "0")}），承接上文、勿重复上一段。\n\n${seed}`,
    );
  }
  return out.slice(0, n);
}

/**
 * 从文案抽出约 12 个图文节拍标题（供 3×4 分段专用），避免每段都塞全文导致序号从 01 重开、内容重复。
 * 优先读 `[封面]`/`[图N]` 大纲；跳过拍摄执行脚本与创作者技术指导页，避免抽成「手法卡/怎么拍怎么发」节拍。
 */
export function extractGraphicNoteBeatsFor3x4(scriptContext: string, totalBeats = 12): string[] {
  const full = String(scriptContext || "").trim();
  const beats: string[] = [];
  const isBadBeatLine = (line: string) =>
    isGraphicNoteMetaCreatorGuidance(line) ||
    /(灯光|机位|运镜|口播|景别|拍摄手法|分镜表|\[\d+\s*[-–~]\s*\d+\s*秒\])/.test(line);

  // 优先：详细脚本里的 [封面] / [图N] 知识页（跳过创作 SOP 页）
  const pageBlocks = full.match(/\[(?:封面|图\d+)\][^\n\[]*/g);
  if (pageBlocks?.length) {
    for (const block of pageBlocks) {
      const cleaned = block.replace(/^\[(?:封面|图\d+)\]\s*/, "").trim().slice(0, 80);
      if (cleaned.length >= 4 && !isBadBeatLine(cleaned)) beats.push(cleaned);
      if (beats.length >= totalBeats) break;
    }
  }

  const stepBlocks = full.match(/(?:^|\n)\s*(?:\d+[\.\)、]|【\d+】|第\d+[步格段])/gm);
  // 次选：内容要点行（跳过拍摄教学 / 技术指导）
  const lines = full
    .split(/\n+/)
    .map((s) => s.replace(/^\s*[-*•]\s*/, "").trim())
    .filter((s) => s.length >= 6 && s.length <= 120);
  for (const line of lines) {
    if (beats.length >= totalBeats) break;
    if (/^(【选题】|【钩子】|【文案|【制作】|【环境|【灯光|【情绪|【版式|【发布|【视觉|【3×4|【本段|【体裁|【图文大纲|【读者向)/.test(line)) {
      continue;
    }
    if (isBadBeatLine(line)) continue;
    if (/^\d+[\.\)、]/.test(line) || /^【?\d+】?/.test(line) || line.includes("：") || line.includes(":")) {
      beats.push(line.replace(/^\d+[\.\)、]\s*/, "").slice(0, 80));
    }
  }
  // 再次：按句号切短句（仍跳过拍摄教学 / 技术指导）
  if (beats.length < totalBeats) {
    const sentences = full
      .replace(/\s+/g, " ")
      .split(/[。！？；\n]+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8 && s.length <= 60);
    for (const s of sentences) {
      if (isBadBeatLine(s)) continue;
      if (beats.some((b) => b.includes(s.slice(0, 12)) || s.includes(b.slice(0, 12)))) continue;
      beats.push(s.slice(0, 80));
      if (beats.length >= totalBeats) break;
    }
  }
  // 不足则用**读者向**主题扩写占位，保证 12 格（禁止「本周可拍/拆八页」类创作 SOP 填充）
  const theme = (full.match(/【选题】([^\n]+)/)?.[1] || full.slice(0, 40) || "本主题").trim();
  const fillers = [
    "封面钩子：一句话点出痛点",
    "你可能是这三类人",
    "常见误区：越做越累",
    "先看场景：怎么选地方",
    "再看关系：怎么开口邀请",
    "再看节律：可重复的小顺序",
    "大家真正想搜的三个问题",
    "可立刻试的一个动作",
    "误区澄清：别只说你要动",
    "生活印证：晚饭后十分钟",
    "收藏清单：评论区领取",
    "收束 CTA：收藏再出发",
  ];
  let i = 0;
  while (beats.length < totalBeats) {
    beats.push(`${fillers[i % fillers.length]}（${theme.slice(0, 16)}）`);
    i += 1;
  }
  void stepBlocks;
  return beats.slice(0, totalBeats);
}

/**
 * **3×4 十二格分镜 / 图文：分段生成 → sharp 直向拼成一张完整长图。**
 *
 * 把内容拆成 2–3 段，每段各自走 {@link generatePlatformCompositeSheetImage}（注入 `gridSection` 连贯指令、
 * 每段字密度更低 → 降低糊字），再纵向拼成单张长图上传，返回单一 URL。仅支持 storyboard / xhs；
 * 任一段失败即抛错（调用方据此报错或退款）。
 *
 * **人物造型 + 拍摄手法**：与 2×4 共用同一套规则；切段前先抽出共享约束，再**逐段前置**，避免切段后后段丢失时装大片 / 机位约束。
 * **图文 3×4**：每段只注入本横排 4 个节拍 + 强制序号区间，禁止各段都从 01 重画导致乱版。
 */
export async function generatePlatformGridStitchedSheetImage(
  options: Parameters<typeof generatePlatformCompositeSheetImage>[0] & { sections?: number },
): Promise<string | null> {
  const L = options.flowLog;
  const k = normalizeCompositeSheetKind(options.kind);
  const isStoryboard = k === "storyboard_sheet_landscape";
  const isXhs = k === "xiaohongshu_dual_note";
  if (!isStoryboard && !isXhs) {
    throw new Error(`[3×4] 仅支持 storyboard_sheet_landscape / xiaohongshu_dual_note，收到 ${String(k)}`);
  }
  // 3×4 十二格 = 3 行 × 4 列；分成 3 段，每段一整横排 4 格 → 纵向拼成 12 格长图。
  const total = Math.max(2, Math.min(3, options.sections ?? 3));

  const sharedRules = [
    PLATFORM_FASHION_EDITORIAL_CHARACTER_ZH,
    // 图文笔记：禁止注入拍摄手法，否则横排会被画成「导演手法卡」
    !isXhs && String(options.executionDetails || "").trim()
      ? `【光影与机位约束·拍摄手法】\n${String(options.executionDetails).trim()}`
      : "",
    !isXhs && String(options.shootingTechniqueBrief || "").trim()
      ? `【上传素材拍摄技法】\n${String(options.shootingTechniqueBrief).trim()}`
      : "",
    isXhs
      ? "【3×4 十二格·跨段连贯·图文笔记】本图为**读者可直接发布**的攻略/避坑知识信息图（扁平插画），不是分镜手法卡，也不是创作者技术指导。各段现代主人公须同一人、同一阶层气质；跨段色调、边框、插画语言一致以便无缝拼接。禁止六栏分镜表、灯光机位教学、口播时间轴；禁止「拍封面/拆八页/录60秒/发布SOP」格。"
      : "【3×4 十二格·跨段连贯】本图为 3 行×4 列长图的分段横排生成；各段现代主人公须同一人、同一国际时尚大片阶层气质；景别/运镜/布光对齐拍摄手法约束；跨段色调、布光、边框、场景材质语言一致以便无缝拼接。场景可推进但须留在同一视觉世界，禁止突然换脸、换装阶层或跳戏到无关布景。",
  ]
    .filter(Boolean)
    .join("\n\n");

  const narrative = String(options.scriptContext || "").trim();
  const parts = isXhs
    ? Array.from({ length: total }, (_, i) => {
        const beats = extractGraphicNoteBeatsFor3x4(narrative, 12);
        const slice = beats.slice(i * 4, i * 4 + 4);
        const badgeStart = i * 4 + 1;
        const badgeEnd = badgeStart + 3;
        const badgeRange = `${String(badgeStart).padStart(2, "0")}–${String(badgeEnd).padStart(2, "0")}`;
        return [
          `【本横排专属节拍·严禁复用其他横排】序号徽章必须且只能是 ${badgeRange}（整表 01–12 的第 ${i + 1}/${total} 行）。`,
          `禁止出现 ${badgeRange === "01–04" ? "05–12" : "01–04 或其他横排序号"}；禁止重画上一段已出现的标题、画面与文案。`,
          `本横排四格主题（左→右，互不重复，全部画完）：`,
          ...slice.map((b, j) => `${String(badgeStart + j).padStart(2, "0")}. ${b}`),
          `主题锚点（勿整段复述）：${narrative.slice(0, 500)}`,
        ].join("\n");
      })
    : splitScriptIntoSections(narrative, total);
  const realTotal = parts.length;
  appendImageFlowLog(
    L,
    `[3×4·总控] kind=${k} · 拆成 ${realTotal} 段${isXhs ? "（图文：每段仅 4 个专属节拍+强制序号）" : ""} · 第2段起以上一段横排图作 EvoLink 连贯参考（锁人物/场景/色调）→ sharp 直向拼成长图`,
  );

  if (!isEvolinkGptImage2Configured() && realTotal > 1) {
    appendImageFlowLog(
      L,
      "[3×4·总控] 警告：未配置 EvoLink，续接段无法用上一段图做 edit 连贯锁，跨段一致性可能下降",
    );
  }

  const urls: string[] = [];
  const baseRef = String(options.referencePhotoUrl || "").trim() || undefined;
  for (let i = 0; i < parts.length; i++) {
    appendImageFlowLog(L, `[3×4·总控] ▶ 生成第 ${i + 1}/${realTotal} 段 …`);
    const sectionLabel = isXhs ? "本段图文内容" : "本段分镜内容";
    const sectionScript = `${sharedRules}\n\n【${sectionLabel} · 第 ${i + 1}/${realTotal} 横排】\n${parts[i]}`.slice(
      0,
      12000,
    );
    // 续接段：封面/人像 + 上一段横排（及首段）作视觉真源，强制 GPT-IMAGE-2 edit
    const continuityReferenceImageUrls =
      i > 0
        ? [urls[i - 1]!, urls[0]!].filter((u, idx, arr) => Boolean(u) && arr.indexOf(u) === idx)
        : undefined;
    const sectionRefPhoto = baseRef || (i > 0 ? urls[0] : undefined);
    const url = await generatePlatformCompositeSheetImage({
      ...options,
      scriptContext: sectionScript,
      gridSection: { index: i, total: realTotal },
      referencePhotoUrl: sectionRefPhoto,
      referencePhotoFromApprovedCover:
        Boolean(options.referencePhotoFromApprovedCover) || (i > 0 && !baseRef && Boolean(urls[0])),
      continuityReferenceImageUrls,
      // 有连贯参考时必须走 GPT-IMAGE-2 edit（EvoLink）
      compositeImageEngine:
        sectionRefPhoto || (continuityReferenceImageUrls?.length ?? 0) > 0
          ? "gpt_image2"
          : options.compositeImageEngine,
    });
    if (!String(url || "").trim()) {
      throw new Error(`[3×4] 第 ${i + 1}/${realTotal} 段未返回图像`);
    }
    urls.push(String(url));
    appendImageFlowLog(
      L,
      `[3×4·总控] ✓ 第 ${i + 1}/${realTotal} 段完成${continuityReferenceImageUrls?.length ? ` · 已用上段连贯参考×${continuityReferenceImageUrls.length}` : ""}`,
    );
  }

  const subdir = isStoryboard ? "platform_storyboard_sheet_3x4" : "platform_xhs_dual_3x4";
  const { stitchSheetsVerticalAndUpload } = await import("./platformGridStitch.js");
  const stitched = await stitchSheetsVerticalAndUpload({ imageUrls: urls, subdir, flowLog: L });
  appendImageFlowLog(L, `[3×4·总控] 全部完成 · 已拼成一张完整长图返回`);
  return stitched;
}

/**
 * 旗艦生圖引擎：**OhMyGPT** `gpt-image-2` → fal `openai/gpt-image-2` → Vertex **Nano Banana 2** 兜底。
 *
 * @description 截斷與水印只在 `buildTypographyImagePrompt` 內執行一次，不建議在本函數重複 `sliceHeading`，
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
    `[版式兜底] buildTypographyImagePrompt · mode=${options.mode} · 9:16（画内零字）· 顺序 OhMyGPT → fal → NB2`,
  );
  const primary = await generateGptImage2({ ...options, flowLog: L });
  if (primary) {
    appendImageFlowLog(L, `[版式兜底] OhMyGPT / fal 已成功其一`);
    return primary;
  }

  appendImageFlowLog(
    L,
    "[版式兜底] OhMyGPT / fal 均无图 → Vertex Nano Banana 2 · 9:16 · 2K · GPT-IMAGE-2 同款比例锁 + Pro 光影",
  );
  const nbPrompt = buildTypographyImagePrompt({
    title: options.title,
    copywriting: options.copywriting,
    mode: options.mode,
    isTrial: options.isTrial,
    forImagenFallback: true,
  });
  const withLock = [nbPrompt, PLATFORM_TOPIC_COVER_GPT2_ASPECT_LOCK_PROMPT_SUFFIX].join("\n\n");
  const withProVisual = appendVertexProPhotographyPromptModifiers(
    withLock,
    "platform_vertical_cover_after_gpt2_aspect_lock",
  );
  return fallbackNanoBanana2FromPrompt(withProVisual, "9:16", L);
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

/** 雙軌 · 生圖翻譯：AI Studio `gemini-3.1-pro`（`GEMINI_API_KEY`），與 Vertex `vertexGemini31ProGlobal` 並存。 */
export type CallGemini31ProAiStudioOptions = {
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
};

export async function callGemini3_1_Pro(
  prompt: string,
  opts?: CallGemini31ProAiStudioOptions,
): Promise<string> {
  const model = "gemini-3.1-pro";
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey?.trim()) {
    throw new Error("[系統錯誤] 缺少 GEMINI_API_KEY 環境變數，請確認配置。");
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens: opts?.maxOutputTokens ?? 8192,
          temperature: opts?.temperature ?? 0.4,
          topP: opts?.topP ?? 0.8,
        },
      }),
    });
    const data = await response.json();
    if ((data as { error?: { message?: string } }).error) {
      const msg = String((data as { error?: { message?: string } }).error?.message || "unknown");
      throw new Error(`[Gemini API Error] ${msg}`);
    }
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return text.replace(/```[a-z]*\n?/g, "").replace(/```/g, "").trim();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[AI Studio 翻譯失敗]: ${message}`);
  }
}
