import { emitPlatformImagePipelineStat } from "./platformImagePipelineStats.js";
import {
  isPlatformVertexNanoBanana2FallbackEnabled,
  isPlatformWeekendGcpEscape,
  isPlatformWeekendSurvivalModeEnabled,
  resolvePlatformImageStorageDriver,
} from "../config/platformSwitches.js";
import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs";
import {
  callGemini31ProForImagePrompt,
  resolveVertexFlashTranslationLocation,
  resolveVertexFlashTranslationModelName,
  type PlatformImagePromptTranslator,
} from "./geminiPlatformCompositeTranslation.js";
import { appendVertexProPhotographyPromptModifiers } from "./imageGenerationService.js";
import {
  buildGptImage2AlignedPlatformTopicCoverPrompt,
  PLATFORM_TOPIC_COVER_GPT2_ASPECT_LOCK_PROMPT_SUFFIX,
} from "./platformTopicCoverPrompt.js";

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
  log.push(`${new Date().toISOString()}  ${message}`);
}

export type ProxyImageTypographyMode = "STRATEGIC" | "STORYBOARD" | "GRAPHIC";
export type ImagePromptStats = {
  translatedPromptChars: number;
  translatedPromptWords: number;
  condensedPromptChars: number;
  condensedPromptWords: number;
  condenseTriggered: boolean;
};

/** 智能提炼阈值：**大幅提高**，避免对正常长度英文 prompt 二次压短（平台单帧以画面一致性优先）。 */
const PROMPT_CONDENSE_LENGTH_THRESHOLD = 24_000;
const PROMPT_CONDENSE_HARD_CHAR_LIMIT = 24_000;
const PROMPT_FINAL_HARD_CHAR_CAP = 24_000;

function countPromptWords(text: string): number {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function forceTrimPromptToHardCap(text: string, hardCap = PROMPT_FINAL_HARD_CHAR_CAP): string {
  const raw = String(text || "").trim();
  if (!raw || raw.length <= hardCap) return raw;
  const sliced = raw.slice(0, hardCap);
  const lastComma = sliced.lastIndexOf(",");
  const trimmed = lastComma >= Math.floor(hardCap * 0.6) ? sliced.slice(0, lastComma) : sliced;
  return trimmed.replace(/[,\s]+$/g, "").trim();
}

export type CondenseImagePromptOptions = {
  maxLength?: number;
  translator?: PlatformImagePromptTranslator;
  flowLog?: string[];
};

/**
 * 超長 prompt 時啟動最多 3 次濃縮；**不對生圖串做 slice 物理截斷**（閾值僅決定是否觸發提煉）。
 * `flowLog` 與 `appendImageFlowLog` 約定一致；`translator` 與首階翻譯一致時整鏈路不走寫死 GPT。
 */
export async function condenseImagePromptIfNeeded(
  rawPrompt: string,
  options?: CondenseImagePromptOptions,
): Promise<string> {
  const log = options?.flowLog;
  const originalWords = countPromptWords(rawPrompt);
  if (!rawPrompt || rawPrompt.length <= PROMPT_CONDENSE_HARD_CHAR_LIMIT) {
    const direct = forceTrimPromptToHardCap(rawPrompt);
    if (direct.length !== String(rawPrompt || "").trim().length) {
      appendImageFlowLog(
        log,
        `[Prompt 提炼] 直通前触发最终硬裁剪，chars=${String(rawPrompt || "").trim().length} -> ${direct.length}`,
      );
    }
    return direct;
  }

  appendImageFlowLog(
    log,
    `[Prompt 提炼] 原始长度超标 (chars=${rawPrompt.length}, words=${originalWords})，启动 3 次智能重试机制...`,
  );
  const condenseTask = [
    `请将以下过长的生图 Prompt 重写为一条更短、更准的英文生图指令。`,
    `要求：`,
    `1. 输出只能是一条英文 prompt 或英文 tags，不要解释，不要 markdown。`,
    `2. 在保留构图、主体、灯光、版式类型（单封面 vs 宽幅 2×4 分镜 / 小红书 2×4 八格）与简中标题指令的前提下缩短；**无固定字符上限**，以「仍能指导生图模型」为准。`,
    `3. 尽量不要丢失：构图、主体、灯光、镜头气质、以及原文锁定的版式类型。`,
    `4. 若原文要求画面中出现简体中文标题或标签，请继续带上这条要求。`,
    `5. 版式守恒：若原文是多格分镜、横向合成表、**2×2 四宫格** 等结构，提炼后应仍像是同一类版面；若原文是 vertical 9:16 单封面或单一主视觉，提炼后也保持单封气质。`,
    `6. 其余细节可在不违背上述版式意图的前提下适当归纳合并，不必逐条复述原文的警示列表。`,
    ``,
    rawPrompt,
  ].join("\n");

  let bestAttempt = rawPrompt.trim();
  let bestAttemptChars = bestAttempt.length || Number.MAX_SAFE_INTEGER;

  // 2. 嚴格 3 次重試
  for (let i = 1; i <= 3; i++) {
    try {
      const condensed = await callGemini31ProForImagePrompt(condenseTask, {
        translator: options?.translator ?? "gpt54",
        flowLog: log,
        pipelineStatCtx: { pipeline: "prompt_condense" },
      });
      const out = condensed.trim();
      const outWords = countPromptWords(out);
      if (out && out.length < bestAttemptChars) {
        bestAttempt = out;
        bestAttemptChars = out.length;
      }
      if (out.length <= PROMPT_CONDENSE_HARD_CHAR_LIMIT) {
        appendImageFlowLog(log, `[Prompt 提炼] 第 ${i} 次尝试成功，chars=${out.length}, words=${outWords}`);
        return out.trim();
      }
      appendImageFlowLog(
        log,
        `[Prompt 提炼] 第 ${i} 次尝试结果未达标 (chars=${out.length}, words=${outWords})`,
      );
    } catch (e: unknown) {
      appendImageFlowLog(
        log,
        `[Prompt 提炼] 第 ${i} 次尝试请求失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  // 3. 不再中止：再做一次更强硬的最终压缩，避免整条主路径因提炼失败直接死亡
  appendImageFlowLog(log, "[Prompt 提炼] 前 3 次未达标，启动最终强制浓缩，不再直接报失败");
  const finalForceTask = [
    "将下面这条英文生图指令在不丢失版式与主体的前提下精炼（可仍为长句或 tags，以生图可用为准）。",
    "要求：",
    "1. 只输出一条英文生图指令，不要解释、不要 markdown。",
    `2. 无固定字符上限；以不丢单封面/分镜结构区分为先。`,
    "3. 尽量保留：主体、灯光、场景、版式类型（单封面 vs 宽幅 2×4——与原文一致）、简体中文标题要求。",
    "4. 若原文整体是单张竖封，请别把结果压缩成明显的宽幅多格主表；反之亦然。",
    "",
    bestAttempt,
  ].join("\n");

  try {
    const forced = (
      await callGemini31ProForImagePrompt(finalForceTask, {
        translator: options?.translator ?? "gpt54",
        flowLog: log,
        pipelineStatCtx: { pipeline: "prompt_condense" },
      })
    ).trim();
    const forcedWords = countPromptWords(forced);
    const forcedTrimmed = forceTrimPromptToHardCap(forced);
    appendImageFlowLog(
      log,
      `[Prompt 提炼] 最终强制浓缩完成，chars=${forced.length}, words=${forcedWords}${forcedTrimmed.length !== forced.length ? ` · 最终硬裁剪 -> ${forcedTrimmed.length}` : ""}`,
    );
    if (forcedTrimmed) {
      return forcedTrimmed;
    }
  } catch (e: unknown) {
    appendImageFlowLog(
      log,
      `[Prompt 提炼] 最终强制浓缩请求失败: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  appendImageFlowLog(
    log,
    `[Prompt 提炼] 使用当前最短候选继续主路径，chars=${bestAttempt.length}, words=${countPromptWords(bestAttempt)}${forceTrimPromptToHardCap(bestAttempt).length !== bestAttempt.length ? ` · 最终硬裁剪 -> ${forceTrimPromptToHardCap(bestAttempt).length}` : ""}`,
  );
  return forceTrimPromptToHardCap(bestAttempt);
}

export function buildImagePromptStats(translatedPrompt: string, finalPrompt: string): ImagePromptStats {
  const translated = String(translatedPrompt || "").trim();
  const condensed = String(finalPrompt || translatedPrompt || "").trim();
  return {
    translatedPromptChars: translated.length,
    translatedPromptWords: countPromptWords(translated),
    condensedPromptChars: condensed.length,
    condensedPromptWords: countPromptWords(condensed),
    condenseTriggered: translated !== condensed,
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
const GPT_IMAGE2_API_QUALITY = "high" as const;
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
function buildOhMyGptGptImage2RequestBody(promptForApi: string, size: string) {
  return {
    model: "gpt-image-2",
    prompt: promptForApi,
    n: 1,
    size,
    quality: GPT_IMAGE2_API_QUALITY,
    output_format: GPT_IMAGE2_OUTPUT_FORMAT,
    response_format: "b64_json",
  };
}

/**
 * fal `openai/gpt-image-2`：鍵名依 fal schema，**值**與 OhMyGPT 共用 {@link GPT_IMAGE2_API_QUALITY}、{@link GPT_IMAGE2_OUTPUT_FORMAT}、
 * 與同一組尺寸白名單推導出的 `openAiSize`（再轉 `image_size`）。
 */
function buildFalGptImage2RequestBody(prompt: string, openAiSize: string) {
  return {
    prompt,
    image_size: gptImage2OpenAiSizeToFalImageSize(openAiSize),
    quality: GPT_IMAGE2_API_QUALITY,
    num_images: 1 as const,
    output_format: GPT_IMAGE2_OUTPUT_FORMAT,
  };
}

/** 拼在寬幅 2×4 合成英文 prompt 末尾：頂部簡中主標 + 幾何鎖定 + **每格底部簡中訊息分格表**（與 {@link STORYBOARD_2X4_SHEET_TRANSLATION_FOOTER} 一致）。 */
const GPT_IMAGE2_STORYBOARD_2X4_PIXEL_LOCK =
  "CRITICAL COMPOSITION LOCK: single wide landscape ~16:9 master. TOP ~8–12% HEIGHT ONLY: full-width band = **内容总结** as the sheet-level theme (whole-script / episode summary); may include 「· 分镜脚本」suffix—**no per-shot titles in this band**. Below: EXACTLY eight equal panels, 2 rows × 4 columns, straight gutters. PER PANEL top-to-bottom: (1) **分镜主题描述** one bold legible **Simplified Chinese** line for that shot only; (2) cinematic still; (3) bottom ~25–30% = **Simplified Chinese** table with **four labeled fields** — **景别**, **运镜**, **画面内容**, **台词与音效** — all four filled; thin grid OK; table body must be 简体中文. FORBIDDEN: missing top **内容总结** strip; first row of panels flush to canvas top; placing per-shot **分镜主题描述** in the global top band instead of inside each cell; fewer than eight cells; English-only tables; wholly empty panels. SOFT PREFERENCE (when compatible with clarity): harmonize lower table bands with overall color/lighting—paper-tint, soft panel, low-contrast separation—rather than routinely using harsh full-black bars with pure-white copy for technical fields.";

/** 小紅書八格：幾何與分鏡同為 2×4；畫風偏資訊圖 / 筆記感，每格強簡中（與 {@link XHS_GRAPHIC_NOTE_2X4_FOOTER} 一致）。 */
const GPT_IMAGE2_XHS_2X4_PIXEL_LOCK =
  "CRITICAL COMPOSITION LOCK: Xiaohongshu premium graphic note, single wide landscape ~16:9 master; EXACTLY eight equal panels in 2 rows × 4 columns with straight full-span gutters; row-major read (top L→R, then bottom L→R). EACH CELL: high-density editorial beat — legible Simplified Chinese titles, bullets, icons, pill tags, small diagrams, or numbered badges 01–08 as fits; cohesive luxury palette. FORBIDDEN: 2×2 four-cell layout only; single full-bleed hero; 50/50 split only; one horizontal strip of eight thin bands; left text column + right single photo; wholly English-only cells.";

/** 单次 GPT-IMAGE-2（fal / OhMyGPT）fetch 超时；封面/分镜/图文笔记共用。默认 6 分钟；`GPT_IMAGE_FETCH_TIMEOUT_MS` 可缩短，上限 6 分钟。 */
const GPT_IMAGE2_REQUEST_TIMEOUT_MS = Math.min(
  6 * 60_000,
  Math.max(60_000, Number(process.env.GPT_IMAGE_FETCH_TIMEOUT_MS) || 6 * 60_000),
);

/**
 * **fal** `openai/gpt-image-2` 與 **OhMyGPT** 同段生圖：單段最多嘗試次數（含首次）。預設 **3**，滿次仍失敗則交下一段（OhMyGPT / Vertex）。
 * 可用 `GPT_IMAGE2_MAX_ATTEMPTS` 或歷史名 `GPT_IMAGE2_PER_SIZE_MAX_ATTEMPTS` 覆寫，範圍 1～8。
 */
const GPT_IMAGE2_MAX_ATTEMPTS = Math.min(
  8,
  Math.max(
    1,
    Number(process.env.GPT_IMAGE2_MAX_ATTEMPTS) ||
      Number(process.env.GPT_IMAGE2_PER_SIZE_MAX_ATTEMPTS) ||
      3,
  ),
);

/**
 * **OhMyGPT 段**跨尺寸累計失敗熔斷：達此值後 `return null` 交 Vertex 等（產品順序：**fal → OhMyGPT → Vertex**）。
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
- FORBIDDEN: missing top summary strip; eight panels flush to top edge; English-only tables; empty panels; fewer than eight cells.

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
3. HARD FORBIDDEN: a **50/50 left-right two-panel** split only; **left third solid text band + right two thirds single hero photo** (magazine cover split — NOT a 2×2 grid); a **single horizontal row of four** thin strips; one dominant full-bleed panel with tiny side tiles; messy scrapbook collage without a clear 2×2 structure.

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
  opts: { maxAttempts?: number; sizes?: readonly string[]; flowLog?: string[] } = {},
): Promise<string | null> {
  const L = opts.flowLog;
  const apiKey = String(process.env.PROXY_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    appendImageFlowLog(L, "[GPT-IMAGE-2] PROXY_OPENAI_API_KEY 缺失，跳过主路径");
    console.warn("[proxyImageService] PROXY_OPENAI_API_KEY missing, skip gpt-image-2");
    return null;
  }

  const sizeList = opts.sizes ?? GPT_IMAGE2_PORTRAIT_SIZES;
  const maxAttempts = Math.min(
    Math.max(1, opts.maxAttempts ?? sizeList.length),
    sizeList.length,
  );
  const sizes = sizeList.slice(0, maxAttempts);

  const { cleaned: promptForApi, stripped: strippedMjSuffix } =
    stripMidjourneyStyleSuffixFromGptImagePrompt(prompt);
  if (strippedMjSuffix) {
    appendImageFlowLog(L, "[GPT-IMAGE-2] 已去除 Midjourney 風格後綴（如 --ar / --v），比例以 API size 為準");
  }

  let primaryFailCount = 0;
  const notePrimaryFailure = (): boolean => {
    primaryFailCount += 1;
    if (primaryFailCount >= GPT_IMAGE2_OHMYGPT_ABORT_AFTER_FAILS) {
      appendImageFlowLog(
        L,
        `[GPT-IMAGE-2] OhMyGPT 退路累计失败 ${primaryFailCount} 次（已达 ${GPT_IMAGE2_OHMYGPT_ABORT_AFTER_FAILS}，停止 OhMyGPT）→ 上层改走 Vertex Nano 等`,
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
          body: JSON.stringify(buildOhMyGptGptImage2RequestBody(promptForApi, size)),
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
  const raw = String(process.env.DISABLE_FAL_GPT_IMAGE2_FALLBACK || "").trim().toLowerCase();
  return !(raw === "1" || raw === "true" || raw === "yes");
}

/**
 * **fal.ai** `openai/gpt-image-2`：**主路徑**（`fal.run` REST）；需 `FAL_API_KEY` / `FAL_KEY`。
 * `DISABLE_FAL_GPT_IMAGE2_FALLBACK=1` 時跳過 fal，由上層直接走 OhMyGPT。
 * 輸出臨時 URL 後經 {@link mirrorImageUrlToGcsSignedUrl} 落到 GCS/Fly。
 * @see https://fal.ai/models/openai/gpt-image-2/api
 */
async function postGptImage2ViaFalAndUpload(
  prompt: string,
  gcsSubdir: string,
  aspectRatio: "9:16" | "16:9",
  flowLog?: string[],
): Promise<string | null> {
  const L = flowLog;
  if (!isFalGptImage2FallbackEnabled()) {
    appendImageFlowLog(L, "[FAL·GPT-IMAGE-2] 已禁用（DISABLE_FAL_GPT_IMAGE2_FALLBACK=1）→ 跳过 fal 主路径");
    return null;
  }
  const key = getFalApiKeyForGptImage2();
  if (!key) {
    appendImageFlowLog(L, "[FAL·GPT-IMAGE-2] 无 FAL_API_KEY/FAL_KEY，跳过 fal 主路径");
    return null;
  }
  const openAiSize = firstConcreteOpenAiGptImage2Size(
    aspectRatio === "9:16" ? GPT_IMAGE2_PORTRAIT_SIZES : GPT_IMAGE2_LANDSCAPE_SIZES,
  );
  const image_size = gptImage2OpenAiSizeToFalImageSize(openAiSize);

  appendImageFlowLog(
    L,
    `[FAL·GPT-IMAGE-2] POST https://fal.run/openai/gpt-image-2 · ${aspectRatio} · openAiSize=${openAiSize} · fal image_size=${image_size.width}×${image_size.height} · quality=${GPT_IMAGE2_API_QUALITY} · ${GPT_IMAGE2_OUTPUT_FORMAT}`,
  );
  try {
    const timeoutMs = GPT_IMAGE2_REQUEST_TIMEOUT_MS;
    const r = await fetch("https://fal.run/openai/gpt-image-2", {
      method: "POST",
      headers: {
        Authorization: `Key ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildFalGptImage2RequestBody(prompt, openAiSize)),
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

/** GPT-IMAGE-2 失敗後：Vertex **Nano Banana 2**（`gemini-3.1-flash-image-preview`）· 2K。 */
async function fallbackNanoBanana2FromPrompt(
  prompt: string,
  aspectRatio: "9:16" | "16:9",
  flowLog?: string[],
  role: NanoBanana2FromPromptRole = "optional_fallback_after_openai",
): Promise<string | null> {
  const L = flowLog;
  const logTag = role === "platform_vertex_cover_primary" ? "[NB2·封面]" : "[单帧兜底]";

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
    const vertexResult = await generateGeminiImage({
      prompt: String(prompt || "").trim(),
      quality: "2k",
      aspectRatio,
      personGeneration: "ALLOW_ADULT",
      imagePersistFlowLog: L,
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
      `${logTag} Nano Banana 2 成功 · model=${vertexResult.model ?? "?"} · location=${vertexResult.location ?? "?"}`,
    );
    return url;
  } catch (e: unknown) {
    appendImageFlowLog(L, `${logTag} Nano Banana 2 失败: ${e instanceof Error ? e.message : String(e)}`);
    console.warn("[proxyImageService] nano banana 2 fallback failed:", e);
    return null;
  }
}

/**
 * 單幀封面：**僅 Vertex Nano Banana 2**（`generateGeminiImage`），不經 OhMyGPT GPT-IMAGE-2。
 * 供 **Nano Banana Pro** 监管模式在 Pro 失败时的第一档兜底。
 */
export async function generatePlatformTopicCoverNanoBanana2FromEnglishPrompt(options: {
  englishPrompt: string;
  flowLog?: string[];
}): Promise<string | null> {
  const raw = String(options.englishPrompt || "").trim();
  if (!raw) {
    appendImageFlowLog(options.flowLog, "[NB2·封面] 英文 prompt 为空，跳过");
    return null;
  }
  appendImageFlowLog(
    options.flowLog,
    `${new Date().toISOString()}  [NB2·封面] Vertex Nano Banana 2 · 9:16 · 2K · GPT-IMAGE-2 同款比例锁 + Pro 鏡頭/光影語彙（非 OhMyGPT）`,
  );
  const gpt2Aligned = buildGptImage2AlignedPlatformTopicCoverPrompt(raw);
  const withProVisual = appendVertexProPhotographyPromptModifiers(
    gpt2Aligned,
    "platform_vertical_cover_after_gpt2_aspect_lock",
  );
  return fallbackNanoBanana2FromPrompt(withProVisual, "9:16", options.flowLog, "platform_vertex_cover_primary");
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
 * 已由 Gemini **双语编导**写好的 **完整英文 raw prompt** → **fal `openai/gpt-image-2`** 主路径 → **OhMyGPT** 退路
 * → **Nano Banana 2** 兜底。图像 API **不**执行翻译。
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
  const base =
    options.aspectRatio === "9:16"
      ? buildGptImage2AlignedPlatformTopicCoverPrompt(raw, suffix)
      : [raw, suffix].filter(Boolean).join("\n\n");
  const photoIntent =
    options.aspectRatio === "9:16" ? "platform_vertical_cover_after_gpt2_aspect_lock" : "platform_landscape_sheet";
  const prompt = appendVertexProPhotographyPromptModifiers(base, photoIntent);
  const sizes = options.aspectRatio === "16:9" ? GPT_IMAGE2_LANDSCAPE_SIZES : GPT_IMAGE2_PORTRAIT_SIZES;
  const primaryOpenAiSize = firstConcreteOpenAiGptImage2Size(sizes);
  const primaryFal = gptImage2OpenAiSizeToFalImageSize(primaryOpenAiSize);

  appendImageFlowLog(
    L,
    `[单帧主路径] fal POST openai/gpt-image-2 · ${options.aspectRatio} · openAiSize=${primaryOpenAiSize} · fal=${primaryFal.width}×${primaryFal.height} · quality=${GPT_IMAGE2_API_QUALITY} · ${GPT_IMAGE2_OUTPUT_FORMAT} · 英文 prompt 约 ${prompt.length} 字`,
  );
  const falFirst = await postGptImage2ViaFalAndUpload(prompt, options.gcsSubdir, options.aspectRatio, L);
  if (falFirst) {
    appendImageFlowLog(L, "[单帧主路径] fal GPT-IMAGE-2 成功，已落库");
    return falFirst;
  }

  appendImageFlowLog(
    L,
    `[单帧·OhMyGPT 退路] fal 无图 → GPT-IMAGE-2（OhMyGPT）· ${options.aspectRatio} · 试尺寸序列: ${sizes.join(" → ")} · 与 Vertex 共用鏡頭/光影語彙`,
  );
  const fromProxy = await postGptImage2AndUpload(prompt, options.gcsSubdir, { sizes, flowLog: L });
  if (fromProxy) {
    appendImageFlowLog(L, "[单帧·OhMyGPT 退路] GPT-IMAGE-2 成功，已上传 GCS");
    return fromProxy;
  }

  appendImageFlowLog(
    L,
    `[单帧兜底] fal / OhMyGPT 均无图 → Vertex Nano Banana 2 · ${options.aspectRatio} · 2K · 沿用同一条 prompt（已含比例/宽幅约束与共用光影）`,
  );
  return fallbackNanoBanana2FromPrompt(prompt, options.aspectRatio, L);
}

/**
 * 版式出图：`fal openai/gpt-image-2` 主路径 → OhMyGPT `gpt-image-2` 退路（需 `PROXY_OPENAI_API_KEY`）。
 * fal 可由 `DISABLE_FAL_GPT_IMAGE2_FALLBACK=1` 整段跳过。
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
  appendImageFlowLog(L, "[版式·主路径] fal openai/gpt-image-2 · 9:16");
  const falUrl = await postGptImage2ViaFalAndUpload(finalPrompt, options.mode.toLowerCase(), "9:16", L);
  if (falUrl) return falUrl;
  appendImageFlowLog(L, "[版式·OhMyGPT 退路] fal 无图 → GPT-IMAGE-2（OhMyGPT）");
  return postGptImage2AndUpload(finalPrompt, options.mode.toLowerCase(), { flowLog: L });
}

export type PlatformCompositeSheetKind =
  | "storyboard_sheet_portrait"
  | "storyboard_sheet_landscape"
  | "xiaohongshu_dual_note";

/**
 * 平台页宽幅合成：**同一條** 英文生图 prompt（双语编导 → 可选提炼 → 像素锁）先走 **fal `openai/gpt-image-2`**（16:9）；
 * 失败则 **OhMyGPT** `gpt-image-2`（尺寸白名单序列）；再败走 **Vertex** Nano Banana 2，传入 **完全相同** 的 prompt。
 */
export async function generatePlatformCompositeSheetImage(options: {
  kind: PlatformCompositeSheetKind;
  title: string;
  scriptContext: string;
  isTrial?: boolean;
  executionDetails?: string;
  /** 與單幀一致：預設 Vertex Gemini 3 Flash（三輪後 GPT 5.4）；可傳 gpt54 強制先 GPT */
  imagePromptTranslator?: import("./geminiPlatformCompositeTranslation.js").PlatformImagePromptTranslator;
  /** 可選：2×4 生圖逐步驟時間線 */
  flowLog?: string[];
  /** 管理員：與選題封面同源，在中文骨架 / 英文化前插入 Deep Research Pro（Interactions） */
  enableCompositeDeepResearchPro?: boolean;
  /** IP / 身份錨點，供 DR Pro tenant 與選題錨定 */
  coverPersonaContext?: string;
}): Promise<string | null> {
  const L = options.flowLog;
  const k = options.kind;
  const isStoryboard = k === "storyboard_sheet_portrait" || k === "storyboard_sheet_landscape";
  const isXhs = k === "xiaohongshu_dual_note";
  if (!isStoryboard && !isXhs) {
    throw new Error(`Unsupported sheet kind: ${String(k)}`);
  }
  const subdir = isStoryboard ? "platform_storyboard_sheet" : "platform_xhs_dual";

  const survival = isPlatformWeekendSurvivalModeEnabled();
  appendImageFlowLog(
    L,
    survival
      ? `[2×4·英文化机制] **生存模式已开启**（環境變數 PLATFORM_WEEKEND_SURVIVAL_MODE）：英文化僅 **OpenAI GPT 5.4**（最多 3 轮、间隔 3s/6s），失败宣告 **系统算力紧张**。另有 **GCP 避险** 时亦可能压制 Vertex。`
      : `[2×4·英文化机制] **默认** **Vertex Gemini 3 Flash** 英文化最多 3 轮 → 失败则 **GPT 5.4** 最多 3 轮；双轨仍失败则 **系统算力紧张，请稍后再试**（不向用户伪造可用英文化结果）。显式 translator=gpt54：先 GPT 5.4 再 Vertex Flash（兼容旧序）。GCP 避险时强制仅 GPT 5.4，失败同样抛错。`,
  );
  appendImageFlowLog(
    L,
    `[2×4·中文骨架] extractChineseVisualBrief 始终用 **GPT 5.4 JSON** 从中文剧本抽「视觉骨架」（日志标签 [骨架·中文视觉]），与下行「英文化」不是同一步。`,
  );
  appendImageFlowLog(
    L,
    `[宽幅合成] kind=${k} · ${isStoryboard ? "视频向 2×4 分镜主表（buildVideoStoryboardGeminiPrompt）" : "小红书 2×4 八格图文笔记（buildXhsNoteGeminiPrompt）"} · 标题: ${String(options.title || "").slice(0, 60)}`,
  );
  const tr = options.imagePromptTranslator ?? "vertex_gemini_3_flash_preview";
  const vertexRef = `${resolveVertexFlashTranslationModelName()} · ${resolveVertexFlashTranslationLocation()}`;
  appendImageFlowLog(
    L,
    `[2×4·流程总览] 分镜图/八格全链路（面板 translator=${tr}${survival ? " · **生存模式：英文化实际锁定 GPT 5.4 · strict**" : " · 默认 Flash→GPT strict"}；Vertex 参考=${vertexRef}）：① extractChineseVisualBrief（中文骨架）→ ② ${isStoryboard ? "buildVideoStoryboardGeminiPrompt" : "buildXhsNoteGeminiPrompt"} → ③ translatePlatformCompositeToEnglishPrompt（英文化；见 [GPT54·英文化]/[Vertex·Flash]）→ ④ condenseImagePromptIfNeeded → ⑤ 像素锁 → ⑥ GPT-IMAGE-2 宽幅 → ⑦ 无图则 Nano Banana 2 兜底（2K）`,
  );
  const compositeMaxAttempts = Math.min(
    8,
    Math.max(1, Number(process.env.PLATFORM_COMPOSITE_SHEET_MAX_ATTEMPTS) || 3),
  );
  appendImageFlowLog(
    L,
    `[2×4·整链] 同一请求最多 ${compositeMaxAttempts} 次完整尝试（首次 + ${compositeMaxAttempts - 1} 次重试；環境變數未設時預設 3，與英文化/GPT-IMAGE-2 單段預設次數一致）；storyboard_sheet_* 与 xiaohongshu_dual_note 共用。每次尝试内含 **英文化子链**（生存模式下为 GPT 5.4；否则见步骤1）与 **生图主链/兜底**。可用 PLATFORM_COMPOSITE_SHEET_MAX_ATTEMPTS 覆寫（1～8）。`,
  );

  const formatForDr: "短视频" | "图文" = isXhs ? "图文" : "短视频";
  let scriptContextForPipeline = options.scriptContext;
  const drFromAdmin = Boolean(options.enableCompositeDeepResearchPro);
  const { isCompositeSheetDeepResearchProEnabled, runCoverDeepResearchInteractionsBrief } = await import(
    "./coverDeepResearchProBrief.js",
  );
  const { buildCoverTaskInputFromPipeline } = await import("./agenticCoverWorkflow.js");
  const drFromEnv = isCompositeSheetDeepResearchProEnabled();
  const runCompositeDrPro = drFromAdmin || drFromEnv;

  if (runCompositeDrPro) {
    appendImageFlowLog(
      L,
      `${new Date().toISOString()}  [步骤0.5·DR-Pro·2×4] 管理员入参=${drFromAdmin ? "开启" : "关闭"} · 环境=${drFromEnv ? "开启" : "关闭"} → Interactions Deep Research Pro（注入分镜/八格中文语境；失败则忽略）`,
    );
    try {
      const drTask = buildCoverTaskInputFromPipeline({
        topicHook: options.title,
        format: formatForDr,
        context: options.scriptContext,
        coverPersonaContext: options.coverPersonaContext ?? "",
      });
      const drBrief = await runCoverDeepResearchInteractionsBrief(drTask, L ?? [], { logPrefix: "步骤0.5·DR-Pro·2×4" });
      if (drBrief?.trim()) {
        const tag = "【DeepResearch Pro·2×4 编导增强（简体）】";
        scriptContextForPipeline = `${String(scriptContextForPipeline).trim()}\n\n${tag}\n${drBrief.trim()}`;
      }
    } catch (e: unknown) {
      appendImageFlowLog(
        L,
        `${new Date().toISOString()}  [步骤0.5·DR-Pro·2×4] 异常（忽略）: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
  const phaseOrderTs = new Date().toISOString();
  if (runCompositeDrPro) {
    appendImageFlowLog(
      L,
      `${phaseOrderTs}  [管线·阶段顺序·2×4] A/Deep Research Pro 段已结束 → B/中文骨架 extractChineseVisualBrief 与英文化`,
    );
  } else {
    appendImageFlowLog(
      L,
      `${phaseOrderTs}  [管线·阶段顺序·2×4] 未启用 A/Deep Research Pro → 直接 B/中文骨架与英文化`,
    );
  }

  let lastFailure: unknown = null;

  for (let attempt = 1; attempt <= compositeMaxAttempts; attempt++) {
    appendImageFlowLog(
      L,
      `[2×4·整链] ═══ 第 ${attempt}/${compositeMaxAttempts} 次尝试开始 ═══`,
    );
    appendImageFlowLog(
      L,
      `[2×4·步骤1] 英文生图 prompt（translatePlatformCompositeToEnglishPrompt）· ${
        survival
          ? "**生存模式 → 仅 GPT 5.4 英文化 · strict**"
          : tr === "gpt54"
            ? "**相容路径：先 GPT 5.4**，无效再 Vertex Flash"
            : "**默认：Vertex Gemini 3 Flash ×3 → GPT 5.4 ×3**（双轨失败则系统算力紧张）"
      } …`,
    );

    try {
      const { translatePlatformCompositeToEnglishPrompt } = await import("./geminiPlatformCompositeTranslation.js");

      const englishCore = await translatePlatformCompositeToEnglishPrompt({
        kind: k,
        scriptContext: scriptContextForPipeline,
        translator: options.imagePromptTranslator,
        flowLog: L,
        compositeSheetAttempt: attempt,
        compositeSheetMaxAttempts: compositeMaxAttempts,
      });

      if (!String(englishCore || "").trim()) {
        appendImageFlowLog(L, "[2×4·步骤1] 翻译结果为空（不注入模版英文）");
        throw new Error("宽幅合成翻译结果为空");
      }

      appendImageFlowLog(L, "[2×4·步骤1·完成] 英文化成功，进入提炼/Prompt 整形");
      appendImageFlowLog(
        L,
        `[2×4·步骤1] 英文主体约 ${englishCore.length} 字符（预览）: ${englishCore.replace(/\s+/g, " ").slice(0, 180)}…`,
      );

      appendImageFlowLog(
        L,
        `[2×4·步骤1b] Prompt 智能提炼（仅当超 PROMPT_CONDENSE 阈值触发；translator=${tr}）…`,
      );
      const condensedCore = await condenseImagePromptIfNeeded(englishCore, {
        translator: options.imagePromptTranslator,
        flowLog: L,
      });
      appendImageFlowLog(
        L,
        `[2×4·步骤1b·完成] chars ${englishCore.length} → ${condensedCore.length}${condensedCore.length < englishCore.length ? "（已缩短）" : "（未缩短或仅硬裁剪）"}`,
      );
      const pixelLock = isStoryboard ? GPT_IMAGE2_STORYBOARD_2X4_PIXEL_LOCK : GPT_IMAGE2_XHS_2X4_PIXEL_LOCK;
      const topicTitleZh = String(options.title || "").trim().slice(0, 80);
      const storyboardTitleInject =
        isStoryboard && topicTitleZh
          ? `\n\nTOP STRIP — **内容总结** (Simplified Chinese; overall arc / synopsis for the whole sheet — render in the top band above the 2×4 grid; **not** per-panel shot titles). Anchor text to include or paraphrase from: 「${topicTitleZh}」`
          : "";
      if (isStoryboard && topicTitleZh) {
        appendImageFlowLog(
          L,
          `[2×4·顶栏] 已并入 prompt · 内容总结锚点（简中）· len=${topicTitleZh.length} · 「${topicTitleZh.replace(/\s+/g, " ").slice(0, 72)}${topicTitleZh.length > 72 ? "…" : ""}」`,
        );
      }
      const promptForImageBase = `${String(condensedCore).trim()}\n\n${pixelLock}${storyboardTitleInject}`;
      const promptForImage = appendVertexProPhotographyPromptModifiers(
        promptForImageBase,
        "platform_landscape_sheet",
      );

      appendImageFlowLog(
        L,
        `[2×4·步骤2·前] 已拼像素锁（${isStoryboard ? "电影 2×4 分镜" : "小红书 2×4 八格"}）+ 与 Vertex 共用鏡頭/光影語彙 · 送生图总长约 ${promptForImage.length} 字符`,
      );

      appendImageFlowLog(
        L,
        `[2×4·步骤2] fal POST openai/gpt-image-2 · 宽幅 16:9 · gcsSubdir=${subdir}`,
      );
      const falWide = await postGptImage2ViaFalAndUpload(promptForImage, subdir, "16:9", L);
      if (falWide) {
        appendImageFlowLog(L, `[2×4·步骤2] fal GPT-IMAGE-2 成功 · 整链第 ${attempt}/${compositeMaxAttempts} 次`);
        emitPlatformImagePipelineStat({
          event: "composite_sheet_fal_gpt_image2_success",
          sheetKind: k,
          compositeSheetAttempt: attempt,
          compositeSheetMaxAttempts: compositeMaxAttempts,
        });
        return falWide;
      }

      appendImageFlowLog(
        L,
        `[2×4·步骤2b] fal 无图 → OhMyGPT GPT-IMAGE-2 · 尺寸序列: ${GPT_IMAGE2_LANDSCAPE_SIZES.join(" → ")}`,
      );
      const fromOhm = await postGptImage2AndUpload(promptForImage, subdir, {
        sizes: GPT_IMAGE2_LANDSCAPE_SIZES,
        flowLog: L,
      });
      if (fromOhm) {
        appendImageFlowLog(L, `[2×4·步骤2b] OhMyGPT GPT-IMAGE-2 成功 · 整链第 ${attempt}/${compositeMaxAttempts} 次`);
        emitPlatformImagePipelineStat({
          event: "composite_sheet_gpt_image2_success",
          sheetKind: k,
          compositeSheetAttempt: attempt,
          compositeSheetMaxAttempts: compositeMaxAttempts,
        });
        return fromOhm;
      }

      appendImageFlowLog(
        L,
        "[2×4·步骤2] fal / OhMyGPT 均未返回图像 → 若允许则走 Vertex Nano 兜底…",
      );

      if (!isPlatformVertexNanoBanana2FallbackEnabled()) {
        appendImageFlowLog(
          L,
          "[2×4·兜底] 已跳过 Vertex Nano（GCP 避险或 PLATFORM_VERTEX_NANO_BANANA2 未开启）",
        );
        throw new Error(
          "fal / OhMyGPT 均未出图；当前未启用 Vertex 图像兜底。请检查 FAL_API_KEY、OhMyGPT/PROXY_OPENAI_API_KEY；需兜底可设 PLATFORM_VERTEX_NANO_BANANA2=1 并确保未触发平台 GCP 避险。",
        );
      }

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
        appendImageFlowLog(
          L,
          `[2×4·步骤3] Nano Banana 2 兜底 · 2K · 沿用步骤2同一条 prompt（已含鏡頭/光影與 16:9 宽幅语彙）· 16:9 · prompt≈${promptForImage.length} chars`,
        );
        const vertexResult = await generateGeminiImage({
          prompt: promptForImage,
          quality: "2k",
          aspectRatio: "16:9",
          personGeneration: "ALLOW_ADULT",
          imagePersistFlowLog: L,
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
        const mirrored = await mirrorNanoSheetUrlToGcs(fallbackUrl, subdir, L);
        appendImageFlowLog(L, `[2×4·步骤3] 整链第 ${attempt}/${compositeMaxAttempts} 次 · Nano 兜底成功`);
        emitPlatformImagePipelineStat({
          event: "composite_sheet_nano_fallback_success",
          sheetKind: k,
          compositeSheetAttempt: attempt,
          compositeSheetMaxAttempts: compositeMaxAttempts,
        });
        return mirrored;
      } catch (fallbackError: unknown) {
        const realError = fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        appendImageFlowLog(L, `[2×4·步骤2/3] 生图链失败: ${realError.slice(0, 600)}`);
        throw fallbackError;
      }
    } catch (e: unknown) {
      lastFailure = e;
      const msg = e instanceof Error ? e.message : String(e);
      appendImageFlowLog(
        L,
        `[2×4·整链] 第 ${attempt}/${compositeMaxAttempts} 次失败 · ${msg.replace(/\s+/g, " ").slice(0, 480)}`,
      );
      if (attempt >= compositeMaxAttempts) {
        break;
      }
      const backoff = attempt === 1 ? 4000 : attempt === 2 ? 8000 : 12_000;
      appendImageFlowLog(L, `[2×4·整链] ${backoff}ms 后整链重试（重新英文化+生图）…`);
      await sleepMs(backoff);
    }
  }

  const flowLog = L ?? [];
  const finalMsg =
    lastFailure instanceof Error ? lastFailure.message : lastFailure != null ? String(lastFailure) : "unknown";
  flowLog.push(`[2×4·整链] 已达 ${compositeMaxAttempts} 次仍失败 · ${finalMsg.slice(0, 400)}`);
  throw new Error(`[2×4 宽幅合成·${compositeMaxAttempts} 次尝试均失败]\n最后原因: ${finalMsg}\n执行日志:\n${flowLog.join("\n")}`);
}

/**
 * 旗艦生圖引擎：**fal** `openai/gpt-image-2` → OhMyGPT `gpt-image-2` → Vertex **Nano Banana 2** 兜底。
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
    `[版式兜底] buildTypographyImagePrompt · mode=${options.mode} · 9:16（画内零字）· 顺序 fal → OhMyGPT → NB2`,
  );
  const primary = await generateGptImage2({ ...options, flowLog: L });
  if (primary) {
    appendImageFlowLog(L, `[版式兜底] fal / OhMyGPT 已成功其一`);
    return primary;
  }

  appendImageFlowLog(
    L,
    "[版式兜底] fal / OhMyGPT 均无图 → Vertex Nano Banana 2 · 9:16 · 2K · GPT-IMAGE-2 同款比例锁 + Pro 光影",
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
