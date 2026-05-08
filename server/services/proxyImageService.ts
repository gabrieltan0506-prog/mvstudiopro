import { uploadBufferToGcs, signGsUriV4ReadUrl } from "./gcs";
import { callGemini3_1_Pro_AiStudio } from "./geminiPlatformCompositeTranslation.js";

const OHMYGPT_BASE = String(process.env.OHMYGPT_API_BASE || "https://api.ohmygpt.com/v1").replace(/\/$/, "");

/** Fly 持久卷部署：設為 `fly` 時平台生圖主路徑與 Vertex 鏡像改寫入 `/data`，經 `/api/jobs?op=flyVolumeMedia` 公開讀；未設則維持 GCS 簽名 URL。 */
function isFlyPlatformTopicImageStorage(): boolean {
  return String(process.env.PLATFORM_TOPIC_IMAGE_STORAGE || "").trim().toLowerCase() === "fly";
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

/**
 * 超長 prompt 時啟動 AI Studio 最多 3 次濃縮；**不對生圖串做 slice 物理截斷**（閾值僅決定是否觸發提煉）。
 * `log` 與 `appendImageFlowLog` 約定一致；批量任務傳 `flowLog`，單幀可傳空陣列 `[]` 以鎖定相同寫入路徑。
 */
export async function condenseImagePromptIfNeeded(rawPrompt: string, log?: string[]): Promise<string> {
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
    `硬性要求：`,
    `1. 输出只能是一条英文 prompt 或英文 tags，不要解释，不要 markdown。`,
    `2. 在保留构图、主体、灯光、版式类型（单封面 vs 宽幅 2×4 分镜 / 小红书 2×4 八格）与简中标题指令的前提下缩短；**无固定字符上限**，以「仍能指导生图模型」为准。`,
    `3. 绝对不能丢失以下关键信息：构图、主体、灯光、镜头气质、以及原文锁定的版式类型。`,
    `4. 如果原文要求画面中出现简体中文标题、简体中文标签、简体中文文案，必须保留这条硬指令。`,
    `5. 版式守恒（极其重要）：先读原文再压缩。若原文是多格分镜、横向合成表、电影感分镜格、或明确 **2×2 四宫格** / 旧式双栏分屏等结构，提炼后必须继续满足该结构，不得擅自改成单张海报。`,
    `6. 相反，若原文写明 single-image cover、单一主视觉、vertical 9:16 单封面，或明令禁止 dual-card / 小红书多格笔记 / 食谱信息图 / checklist，则提炼后仍必须是单张竖版封面，禁止擅自改成小红书 2×2 四宫格、食谱步骤、食材清单或任意多格版式。`,
    `7. 若原文主题为医学、知识、Doctor IP、养生等而未出现食物/菜谱/料理名词，禁止在提炼结果中加入面条、汤碗、厨房、配料表等与主题无关的食物场景。`,
    ``,
    rawPrompt,
  ].join("\n");

  let bestAttempt = rawPrompt.trim();
  let bestAttemptChars = bestAttempt.length || Number.MAX_SAFE_INTEGER;

  // 2. 嚴格 3 次重試
  for (let i = 1; i <= 3; i++) {
    try {
      const condensed = await callGemini3_1_Pro_AiStudio(condenseTask);
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
    "硬性要求：",
    "1. 只输出一条英文生图指令，不要解释、不要 markdown。",
    `2. 无固定字符上限；以不丢单封面/分镜结构区分为先。`,
    "3. 必须保留：主体、灯光、场景、版式类型（单封面 vs 宽幅 2×4——与原文一致）、简体中文标题要求。",
    "4. 若原文是单张 9:16 封面且禁止多格笔记/食谱信息图，禁止压成 2×4 sheet、dual-note、recipe、ingredient list 版式。",
    "",
    bestAttempt,
  ].join("\n");

  try {
    const forced = (await callGemini3_1_Pro_AiStudio(finalForceTask)).trim();
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
 * gpt-image / gpt-image-2 经 OhMyGPT 转发时，`size` 须落在 **OpenAI GPT Image 模型白名单**内，否则会 HTTP 400（Args validation failed）。
 * 官方枚举：`1024x1024`、`1536x1024`（横版和宽幅默认）、`1024x1536`（竖版）、`auto`。
 * （文档另述「自定义分辨率」约束；代理若未开通宽表，勿传 1792×1024、1536×864 等非枚举值。）
 */
/** 9:16 竖版：白名单 + auto 兜底 */
const GPT_IMAGE2_PORTRAIT_SIZES = ["1024x1536", "auto", "1024x1024"] as const;

/** 豎版主路徑：拼在英文 prompt 末尾，鎖定 9:16（與 API `1024x1536` 預設一致）。 */
const GPT_IMAGE2_9_16_ASPECT_LOCK_PROMPT_SUFFIX =
  "CRITICAL OUTPUT ASPECT: final image must be exactly 9:16 portrait (taller than wide), full-bleed vertical cover — not 16:9 landscape, not 1:1 square hero, not letterboxed cinematic wide frame.";
/**
 * 宽幅分镜 / 小红书八格：优先 `1536x1024`（官方 landscape 预设，≈3:2），再 `auto`、`1024x1024`。
 * 勿使用 1792x1024 / 1536x864 等——多数网关按 OpenAI 枚举校验会直接 400。
 */
const GPT_IMAGE2_LANDSCAPE_SIZES = ["1536x1024", "auto", "1024x1024"] as const;

/** 拼在寬幅 2×4 合成英文 prompt 末尾：幾何鎖定 + **每格底部簡中訊息分格表**（與編導 {@link STORYBOARD_2X4_SHEET_TRANSLATION_FOOTER} 一致）。 */
const GPT_IMAGE2_STORYBOARD_2X4_PIXEL_LOCK =
  "CRITICAL COMPOSITION LOCK: single wide landscape ~16:9 master frame; EXACTLY eight equal panels in 2 rows × 4 columns with straight horizontal and vertical gutters; eight distinct cinematic stills. PER PANEL: upper ~70–75% = film still only; lower ~25–30% = compact legible Simplified Chinese caption table (讯息分格表 / shot breakdown): 2–4 short labeled rows (e.g. 镜头 / 景别, 情绪 / 氛围, 要点 / 口播), thin grid or ruled lines allowed; all text in these bands MUST be Simplified Chinese. FORBIDDEN: whole-canvas single hero only, magazine left-text strip + right one photo, 50/50 two-panel only, wholly wordless panels, English-only caption tables.";

/** 小紅書八格：幾何與分鏡同為 2×4；畫風偏資訊圖 / 筆記感，每格強簡中（與 {@link XHS_GRAPHIC_NOTE_2X4_FOOTER} 一致）。 */
const GPT_IMAGE2_XHS_2X4_PIXEL_LOCK =
  "CRITICAL COMPOSITION LOCK: Xiaohongshu premium graphic note, single wide landscape ~16:9 master; EXACTLY eight equal panels in 2 rows × 4 columns with straight full-span gutters; row-major read (top L→R, then bottom L→R). EACH CELL: high-density editorial beat — legible Simplified Chinese titles, bullets, icons, pill tags, small diagrams, or numbered badges 01–08 as fits; cohesive luxury palette. FORBIDDEN: 2×2 four-cell layout only; single full-bleed hero; 50/50 split only; one horizontal strip of eight thin bands; left text column + right single photo; wholly English-only cells.";

const GPT_IMAGE2_REQUEST_TIMEOUT_MS = Math.min(
  300_000,
  Math.max(60_000, Number(process.env.GPT_IMAGE_FETCH_TIMEOUT_MS) || 180_000),
);

/**
 * 同一 `size`：429/408/5xx、fetch 逾時/網絡、HTTP 200 缺 b64_json 等**可恢復**情況下的最大嘗試次數（含首次）。
 * 產品取向：**優先成功率與用戶體感**（排隊/GPU 慢/網關抖動常見）；預設 5，上限 8。
 * 僅在確有成本壓力時再用環境變數 `GPT_IMAGE2_PER_SIZE_MAX_ATTEMPTS` 下調（有效範圍 2～8）。
 */
const GPT_IMAGE2_PER_SIZE_MAX_ATTEMPTS = Math.min(
  8,
  Math.max(2, Number(process.env.GPT_IMAGE2_PER_SIZE_MAX_ATTEMPTS) || 5),
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
        ? "Professional 9:16 editorial vertical scene with premium Simplified Chinese title integration."
        : "Professional 9:16 editorial vertical scene — pure visuals only, absolutely no typography on the image.",
      allowChineseTypography
        ? `VISUAL BRIEF: ${visualContext}`
        : `VISUAL BRIEF (translate into imagery only; do NOT paint as readable text): ${visualContext}`,
      allowChineseTypography
        ? `SUBJECT / MOOD ANCHOR: ${displayHeading}`
        : `SUBJECT / MOOD ANCHOR (for composition only; do NOT spell as text): ${displayHeading}`,
      `STYLE: ${stylePrompt}`,
      typographyBlock,
      "Aspect ratio 9:16 vertical. 8k resolution, masterpiece, no browser or phone UI mockups.",
    ].join("\n");
  }

  return `
Model: GPT-Image-2
Task: Create a professional 9:16 vertical image.
VISUAL BRIEF: ${visualContext}
MOOD ANCHOR: ${displayHeading}
STYLE: ${stylePrompt}
${typographyBlock}
Aspect Ratio: 9:16. 8k resolution, masterpiece.
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
- EXACTLY eight equal panels in 2 rows × 4 columns with straight horizontal and vertical gutters spanning the full canvas. Eight distinct cinematic stills — no duplicate panels, no single full-bleed hero, no magazine left-text strip + right one photo, no 50/50 two-panel only.
- PER PANEL: upper ~70–75% = film still only; lower ~25–30% = compact legible Simplified Chinese caption table (讯息分格表 / shot breakdown): 2–4 short labeled rows (e.g. 镜头 / 景别, 情绪 / 氛围, 要点 / 口播), thin grid or ruled lines allowed. All text in these lower bands MUST be Simplified Chinese. Same layout idiom as "Chinese text tables below each image" on a storyboard sheet.
- FORBIDDEN: wholly wordless panels; English-only caption tables; fake watermarks beyond intentional table labels.

MOOD / TITLE ANCHOR: ${displayTitle}

VISUAL CONTEXT — SCENES (render as the film stills in the upper bands): ${scriptSlice}

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

  for (const size of sizes) {
    let attempt = 0;
    const perSizeAttemptCap = GPT_IMAGE2_PER_SIZE_MAX_ATTEMPTS;
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
          body: JSON.stringify({
            model: "gpt-image-2",
            prompt: promptForApi,
            n: 1,
            size,
            response_format: "b64_json",
          }),
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
            const wait = r.status === 429 ? 4500 : 2000;
            appendImageFlowLog(
              L,
              `[GPT-IMAGE-2] 将同尺寸重试（第 ${attempt + 1}/${perSizeAttemptCap} 次调用）· 等待 ${wait}ms · 计费：每次 HTTP 均可能计入 OhMyGPT/OpenAI 账单`,
            );
            await sleepMs(wait);
            continue;
          }
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
            appendImageFlowLog(
              L,
              `[GPT-IMAGE-2] 将同尺寸重试 · 等待 2000ms · 计费：本次响应已可能发生计费，视供应商规则`,
            );
            await sleepMs(2000);
            continue;
          }
          break;
        }

        const buffer = Buffer.from(b64, "base64");
        if (isFlyPlatformTopicImageStorage()) {
          const { writeFlyPlatformImageBuffer, buildFlyPlatformImagePublicUrl } = await import(
            "./flyVolumeGeneratedImages.js",
          );
          const { relPath } = await writeFlyPlatformImageBuffer({
            subdir: gcsSubdir,
            buffer,
            contentType: "image/jpeg",
          });
          const flyUrl = buildFlyPlatformImagePublicUrl(relPath);
          appendImageFlowLog(L, `[GPT-IMAGE-2] 尺寸 ${size} 成功，已写入 Fly 卷 · relPath=${relPath}`);
          appendImageFlowLog(L, `[GPT-IMAGE-2] 公開 URL 预览：${String(flyUrl).slice(0, 180)}…`);
          return flyUrl;
        }
        const path = `generated/${gcsSubdir}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
        const { gcsUri } = await uploadBufferToGcs({
          objectName: path,
          buffer,
          contentType: "image/jpeg",
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
          appendImageFlowLog(
            L,
            `[GPT-IMAGE-2] 将同尺寸重试（第 ${attempt + 1}/${perSizeAttemptCap} 次调用）· 等待 2500ms · 计费：每次请求均可能单独计费`,
          );
          await sleepMs(2500);
          continue;
        }
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
    let url = String(vertexResult?.imageUrl || "").trim();
    if (!url) {
      appendImageFlowLog(L, "[单帧兜底] Nano Banana 2 返回空 URL");
      return null;
    }
    try {
      url = await mirrorImageUrlToGcsSignedUrl(url, "platform_topic_reference", L);
    } catch (e: unknown) {
      appendImageFlowLog(
        L,
        `[单帧兜底] Nano → GCS 镜像失败（仍返回 Vertex/storage 原始 URL，浏览器可能无法加载）: ${e instanceof Error ? e.message : String(e)}`,
      );
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
  const aspectLock =
    options.aspectRatio === "9:16" ? GPT_IMAGE2_9_16_ASPECT_LOCK_PROMPT_SUFFIX : "";
  const prompt = [raw, aspectLock, suffix].filter(Boolean).join("\n\n");
  const sizes = options.aspectRatio === "16:9" ? GPT_IMAGE2_LANDSCAPE_SIZES : GPT_IMAGE2_PORTRAIT_SIZES;
  appendImageFlowLog(
    L,
    `[单帧主路径] GPT-IMAGE-2（OhMyGPT）· ${options.aspectRatio} · 试尺寸序列: ${sizes.join(" → ")} · 英文 prompt 约 ${prompt.length} 字`,
  );
  const primary = await postGptImage2AndUpload(prompt, options.gcsSubdir, { sizes, flowLog: L });
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
 * 平台页宽幅合成：**同一條** 英文生图 prompt（双语编导 → 可选提炼 → 像素锁）先走 **GPT-IMAGE-2**（OhMyGPT 等主路径）；
 * 失败则走 **Vertex 企业级** 图像 API（`generateGeminiImage` / Nano Banana 2），传入 **完全相同** 的 prompt——不设「兜底专用缩短版」。
 * 与 **AI Studio 消费者** 架構無關；企業級模型可承載與主路徑同級的長指令，僅作畫引擎不同；質量檔位見下方 `quality`。
 */
export async function generatePlatformCompositeSheetImage(options: {
  kind: PlatformCompositeSheetKind;
  title: string;
  scriptContext: string;
  isTrial?: boolean;
  executionDetails?: string;
  /** 與單幀一致：預設 gpt54；探索為 Vertex Flash Live us-central1 */
  imagePromptTranslator?: import("./geminiPlatformCompositeTranslation.js").PlatformImagePromptTranslator;
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
  const subdir = isStoryboard ? "platform_storyboard_sheet" : "platform_xhs_dual";

  appendImageFlowLog(
    L,
    `[宽幅合成] kind=${k} · ${isStoryboard ? "视频向 2×4 分镜主表（buildVideoStoryboardGeminiPrompt）" : "小红书 2×4 八格图文笔记（buildXhsNoteGeminiPrompt）"} · 标题: ${String(options.title || "").slice(0, 60)}`,
  );
  appendImageFlowLog(
    L,
    `[2×4·步骤1] 英文生图 prompt（translatePlatformCompositeToEnglishPrompt；預設 GPT 5.4，鏈路內失敗或空則改走 Vertex gemini-3.1-flash-live-preview）· ${options.imagePromptTranslator === "vertex_gemini_31_pro_preview" ? "Vertex Flash · us-central1" : "GPT 5.4"} …`,
  );

  const { translatePlatformCompositeToEnglishPrompt } = await import("./geminiPlatformCompositeTranslation.js");

  const englishCore = await translatePlatformCompositeToEnglishPrompt({
    kind: k,
    scriptContext: options.scriptContext,
    translator: options.imagePromptTranslator,
    flowLog: L,
  });

  if (!String(englishCore || "").trim()) {
    appendImageFlowLog(L, "[2×4·步骤1] 翻译结果为空（不注入模版英文）");
    throw new Error("宽幅合成翻译结果为空");
  }

  appendImageFlowLog(
    L,
    `[2×4·步骤1] 英文主体约 ${englishCore.length} 字符（预览）: ${englishCore.replace(/\s+/g, " ").slice(0, 180)}…`,
  );

  const condensedCore = await condenseImagePromptIfNeeded(englishCore, L);
  const pixelLock = isStoryboard ? GPT_IMAGE2_STORYBOARD_2X4_PIXEL_LOCK : GPT_IMAGE2_XHS_2X4_PIXEL_LOCK;
  const promptForImage = `${String(condensedCore).trim()}\n\n${pixelLock}`;

  appendImageFlowLog(L, `[2×4·步骤1] 最终送生图 · 含像素锁 · 总长约 ${promptForImage.length} 字符`);

  appendImageFlowLog(
    L,
    `[2×4·步骤2] GPT-IMAGE-2 宽幅横版 · gcsSubdir=${subdir} · 尺寸序列（OpenAI gpt-image 白名单）: ${GPT_IMAGE2_LANDSCAPE_SIZES.join(" → ")}`,
  );
  const primary = await postGptImage2AndUpload(promptForImage, subdir, {
    sizes: GPT_IMAGE2_LANDSCAPE_SIZES,
    flowLog: L,
  });
  if (primary) {
    appendImageFlowLog(L, "[2×4·步骤2] GPT-IMAGE-2 成功");
    return primary;
  }

  appendImageFlowLog(
    L,
    "[2×4·步骤2] GPT-IMAGE-2 未返回图像 → Vertex 企业级 Nano Banana 2 · **同一完整 prompt** · 16:9 兜底…",
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
      prompt: promptForImage,
      quality: isXhs ? "2k" : "1k",
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
    return await mirrorNanoSheetUrlToGcs(fallbackUrl, subdir, L);
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
