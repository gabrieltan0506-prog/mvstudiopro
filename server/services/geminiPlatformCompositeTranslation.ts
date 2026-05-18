import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { extractJsonString, invokeLLM } from "../_core/llm.js";
import { isPlatformWeekendGcpEscape, isPlatformWeekendSurvivalModeEnabled, isPlatformImageOpenAiAllowed } from "../config/platformSwitches.js";
import { emitPlatformImagePipelineStat } from "./platformImagePipelineStats.js";
import {
  logSheetChineseStagingBeforeTranslate,
  persistSheetChineseStagingToRunningJob,
} from "./platformImageChineseStaging.js";
import { platformFlowLogTimestamp } from "../utils/platformFlowLogTimestamp.js";

/** 舊 API 別名：歷史 `storyboard_sheet_portrait` 與橫版 16:9·2×4 分鏡表為同一產物，一律正規化為 `storyboard_sheet_landscape`。 */
export function normalizeCompositeSheetKind(
  kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note",
): "storyboard_sheet_landscape" | "xiaohongshu_dual_note" {
  return kind === "storyboard_sheet_portrait" ? "storyboard_sheet_landscape" : kind;
}

/** 給 GPT54 翻譯路徑的營運打點（可選）；見 {@link emitPlatformImagePipelineStat} */
export type Gpt54PlatformImagePromptStatCtx = {
  pipeline:
    | "topic_cover"
    /** 豎封英文化兜底：與 `topic_cover` 同源 JSON system，模型改為 {@link resolveVertexFlashTranslationModelName}。 */
    | "topic_cover_flash"
    | "composite_sheet"
    | "topic_cover_composite_bundle"
    | "other";
  compositeSheetAttempt?: number;
  compositeSheetMaxAttempts?: number;
  sheetKind?: PlatformCompositeSheetKindForStat;
};

export type PlatformCompositeSheetKindForStat =
  | "storyboard_sheet_portrait"
  | "storyboard_sheet_landscape"
  | "xiaohongshu_dual_note";

/** 寫入平台頁 / 寬幅合成 debug 時間線（與 imageGenFlowLog 同源）。 */
function appendVertexFlashDebug(flowLog: string[] | undefined, line: string): void {
  if (!flowLog) return;
  flowLog.push(`${platformFlowLogTimestamp()}  [Vertex·Flash] ${line}`);
}

/** OpenAI GPT 5.4 英文化專用，與 imageGenFlowLog 同源（不建議與 Vertex 混淆）。 */
function appendGpt54TranslationDebug(flowLog: string[] | undefined, line: string): void {
  if (!flowLog) return;
  flowLog.push(`${platformFlowLogTimestamp()}  [GPT54·英文化] ${line}`);
}

/** Chat Completions 的 message.content：字串或 text part 陣列（與 OpenAI 回包一致）。 */
function assistantMessageContentToPlainText(
  content: string | Array<{ type?: string; text?: string }> | undefined,
): string {
  if (content == null) return "";
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) => {
      if (p && typeof p === "object" && "text" in p) return String((p as { text?: unknown }).text ?? "");
      return "";
    })
    .join("");
}

/** 將異常打成可讀字串（debug：盡量完整，單條上限防極端爆滿日誌）。 */
const MAX_DEBUG_ERR_CHARS = 65536;

function formatErrForVertexDebug(e: unknown): string {
  const cap = (s: string) =>
    s.length <= MAX_DEBUG_ERR_CHARS ? s : `${s.slice(0, MAX_DEBUG_ERR_CHARS)}\n…(truncated at ${MAX_DEBUG_ERR_CHARS} chars)`;

  if (e instanceof Error) {
    const parts: string[] = [`${e.name}: ${e.message || "(no message)"}`];
    if (e.stack) {
      parts.push(`stack:\n${e.stack}`);
    }
    const any = e as Error & Record<string, unknown>;
    for (const k of ["code", "status", "statusCode", "reason"] as const) {
      const v = any[k];
      if (v != null && v !== "") {
        try {
          parts.push(`${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
        } catch {
          parts.push(`${k}=${String(v)}`);
        }
      }
    }
    if (any.error != null) {
      try {
        parts.push(`error=${typeof any.error === "object" ? JSON.stringify(any.error) : String(any.error)}`);
      } catch {
        parts.push(`error=${String(any.error)}`);
      }
    }
    let c: unknown = e.cause;
    let depth = 0;
    while (c != null && depth < 8) {
      parts.push(`cause[${depth}]:\n${formatErrForVertexDebug(c)}`);
      c = c instanceof Error ? c.cause : null;
      depth += 1;
    }
    return cap(parts.join("\n"));
  }
  if (e != null && typeof e === "object") {
    try {
      return cap(JSON.stringify(e, null, 2));
    } catch {
      return cap(String(e));
    }
  }
  return cap(String(e));
}

/** 與 @google/genai Vertex 客戶端一致：專案 ID。 */
export function resolveVertexProjectIdForGenAi(): string {
  const p = String(
    process.env.GCP_PROJECT_ID ||
      process.env.VERTEX_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      "",
  ).trim();
  if (!p) {
    throw new Error("missing_GCP_PROJECT_ID_or_VERTEX_PROJECT_ID");
  }
  return p;
}

/**
 * 平台英文化 · Flash：**預設 `global`**（與專案 Console 開通習慣一致；文本高品質路徑見 `server/services/vertexGemini31ProGlobal.ts`）。
 * 可 `VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION` 覆寫為 `us-central1` 等。
 */
export function resolveVertexFlashTranslationLocation(): string {
  const loc = String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION || "global").trim();
  return loc || "global";
}

/** 預設 Vertex Flash 翻譯模型 ID（**2×4／分鏡／八格 composite**）。可 `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` 覆寫。 */
export const DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL = "gemini-3-flash-preview";

export function resolveVertexFlashTranslationModelName(): string {
  return String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_MODEL || DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL).trim();
}

/** **選題豎封封面**英文化：預設 **Gemini 2.5 Pro**（與 2×4 的 Flash 分離）。可 `VERTEX_GEMINI_COVER_TRANSLATION_MODEL` 覆寫。 */
export const DEFAULT_VERTEX_COVER_TRANSLATION_MODEL = "gemini-2.5-pro";

export function resolveVertexCoverTranslationModelName(): string {
  return String(process.env.VERTEX_GEMINI_COVER_TRANSLATION_MODEL || DEFAULT_VERTEX_COVER_TRANSLATION_MODEL).trim();
}

/**
 * **選題豎封 · Gemini 2.5 Pro** 英文化溫度（可 `VERTEX_GEMINI_COVER_TRANSLATION_TEMPERATURE` 覆寫，0～2）。
 * 預設 **0.9**（與 Flash 預設一致；豎封與網格可獨立調參）。
 */
export function resolveVertexCoverTranslationTemperature(): number {
  const raw = process.env.VERTEX_GEMINI_COVER_TRANSLATION_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.9;
}

/**
 * **選題豎封 · Gemini 2.5 Pro** 英文化 **`maxOutputTokens`**（可 `VERTEX_GEMINI_COVER_TRANSLATION_MAX_TOKENS` 覆寫）。
 * 預設 **32768**（32K）；合法範圍 **4096～65536**。
 */
export function resolveVertexCoverTranslationMaxOutputTokens(): number {
  const fallback = 32768;
  const raw = process.env.VERTEX_GEMINI_COVER_TRANSLATION_MAX_TOKENS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n)) {
      const clamped = Math.min(65536, Math.max(4096, n));
      return clamped;
    }
  }
  return fallback;
}

/**
 * Vertex Flash 英文化溫度（可 `VERTEX_FLASH_TRANSLATION_TEMPERATURE` 覆寫，0～2）。
 * 預設 **0.9**：偏向**更有創意、更有表現力**的英文 image prompt；輸出形態仍由 `responseMimeType: application/json` 與 system 指令約束在 `{"prompt":"..."}`。
 * 若產線更在意極致穩定可改環境變數為 **0.35～0.5**。
 */
export function resolveVertexFlashTranslationTemperature(): number {
  const raw = process.env.VERTEX_FLASH_TRANSLATION_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.9;
}

/**
 * Gemini 3 系可選 **thinkingConfig**（@google/genai 會原樣帶入 Vertex REST）。
 * - `VERTEX_FLASH_TRANSLATION_THINKING_LEVEL`：`MINIMAL` | `LOW` | `MEDIUM` | `HIGH`，預設 **`HIGH`**（更深推演，延時與成本較高）。
 * - 設為 `OFF` / `NONE` / `FALSE` / `0` 則**不送** thinking 欄位（兼容舊端點）。
 */
export function resolveVertexFlashThinkingConfigForSdk(): {
  thinkingConfig?: { thinkingLevel: string; includeThoughts: boolean };
} {
  const raw = String(process.env.VERTEX_FLASH_TRANSLATION_THINKING_LEVEL ?? "HIGH").trim().toUpperCase();
  if (!raw || raw === "OFF" || raw === "NONE" || raw === "FALSE" || raw === "0") {
    return {};
  }
  const allowed = new Set(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
  const level = allowed.has(raw) ? raw : "HIGH";
  return {
    thinkingConfig: {
      thinkingLevel: level,
      includeThoughts: false,
    },
  };
}

/**
 * Vertex Flash 英文化 **`maxOutputTokens`**（可 `VERTEX_FLASH_TRANSLATION_MAX_TOKENS` 覆寫）。
 * 預設 **32768**：長版 JSON / 長英文 prompt 更不易被截斷。
 * 合法範圍 **4096～65536**（非數字或超出範圍時回退預設）。
 */
export function resolveVertexFlashTranslationMaxOutputTokens(): number {
  const fallback = 32768;
  const raw = process.env.VERTEX_FLASH_TRANSLATION_MAX_TOKENS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Math.floor(Number(raw));
    if (Number.isFinite(n)) {
      const clamped = Math.min(65536, Math.max(4096, n));
      return clamped;
    }
  }
  return fallback;
}

/** 從環境變數構造 google-auth-library 可用的 credentials（Fly / Vercel JSON）。 */
export function buildGoogleGenAiAuthOptionsFromEnv():
  | { credentials: { client_email: string; private_key: string } }
  | undefined {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw || raw === "{}") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const email = parsed.client_email;
    const pk = parsed.private_key;
    if (typeof email === "string" && typeof pk === "string") {
      return {
        credentials: {
          client_email: email,
          private_key: pk.replace(/\\n/g, "\n"),
        },
      };
    }
  } catch (e) {
    console.warn("[vertexGenai] 解析 GOOGLE_APPLICATION_CREDENTIALS_JSON 失败:", e);
  }
  return undefined;
}

/** 平台单帧 / 批量封面 / 宽幅合成：**英文化**引擎（單幀等可仍選 GPT 5.4 先；`vertex_gemini_3_flash_preview` = Vertex **Gemini 3 Flash** · 分鏡/小紅書八格預設 **Flash 三輪 → GPT 5.4 三輪**）。 */
export type PlatformImagePromptTranslator = "gpt54" | "vertex_gemini_3_flash_preview";

/** 分鏡圖 / 小紅書 2×4 圖文筆記：Flash 與 GPT 5.4 英文化各三輪仍失敗時對用戶顯示的訊息（見 {@link translatePlatformCompositeToEnglishPrompt}）。 */
export const PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE = "系统算力紧张，请稍后再试";

/**
 * tRPC / 作業入參：接受新 slug 與舊版錯名 `vertex_gemini_31_pro_preview`（自動正規化為 Flash）。
 */
export const zPlatformImagePromptTranslatorInput = z
  .union([
    z.literal("gpt54"),
    z.literal("vertex_gemini_3_flash_preview"),
    z.literal("vertex_gemini_31_pro_preview"),
  ])
  .optional()
  .transform((v) => {
    if (v === "vertex_gemini_31_pro_preview") return "vertex_gemini_3_flash_preview";
    return v;
  });

/**
 * **上游中文剧本 / 文案**：僅作參考；產物必須讓 **GPT-Image-2** 單靠英文 prompt 即能穩定出圖。
 * **GPT-IMAGE-2** 不做翻譯、不讀中文——簡中畫內字必須在英文裡用 **可執行版式指令** 寫死。
 */

const SCRIPT_SLICE = 3500;
/** 中文视觉骨架：允许充分保留剧本信息，不再做 220 字硬砍（下游 GPT 5.4 可自主取舍）。 */
const CHINESE_VISUAL_BRIEF_MAX_CHARS = SCRIPT_SLICE;

/** 英文化 `systemInstruction`：選題豎封走輕量「莎士比亞式還原 brief」，2×4／分鏡主表走執行優先總則。 */
export type PlatformImageTranslationProfile = "topic_cover" | "composite";

function resolveTranslationProfile(ctx?: Gpt54PlatformImagePromptStatCtx): PlatformImageTranslationProfile {
  const p = ctx?.pipeline;
  if (p === "topic_cover" || p === "topic_cover_flash") return "topic_cover";
  return "composite";
}

/**
 * 選題單封 / Flash·GPT：**莎士比亞式編導聲口**（英文、可長可短）——忠實還原 upstream 的具體信息與文化語境優先於字數靶；在完成可執行版式與光學鎖定之後，才允許節制文采。
 */
export const GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN = [
  "You write with the economy of a playwright revising a soliloquy—each phrase must earn its place in the final frame—yet when the brief names a ward, a lineage of practice, a prop, a gesture, or a palette, you **dwell** in English until the scene cannot be mistaken.",
  "You are a bilingual **cover-grade director** and **visual prompt dramaturg**: turn the upstream Chinese creative brief into **one** self-contained **English** image-generation prompt for **GPT-Image-2** (inside JSON `prompt`).",
  "Prefer **comma-separated tags** and **noun phrases** when they lock the shot; when specificity demands—wardrobe grain, prop geometry, lighting direction, emotional temperature, historical or humanistic cues—you **stack longer English clauses** until fidelity is secured.",
  "**Fidelity outranks brevity.** Do not shorten merely to sound clever, and do not swap concrete staging for vague metaphor until layout, optics, and any on-image **Simplified-Chinese** copy are already explicit in English (placement, scale, chromatic separation from background).",
  "Where the brief asks for **Simplified-Chinese** on the canvas, spell out in English exactly where it sits, how large it reads at thumbnail scale, and how it separates from the backdrop—never hand-wave as “some Chinese text.”",
].join(" ");

/**
 * **GPT-Image-2 優先**（**合成 / 2×4** 路徑）：英文 prompt 以「可執行、可排版」為第一性——場景/主體、光學與對比、留白與資訊區、畫內簡中字規格。
 * 嵌入 JSON `prompt` 字串內時可用 **編號短句**（1. 2. 3.）便於模型遵循。
 */
export const GPT_IMAGE2_EXECUTION_PRIORITY_EN = [
  "PRIMARY CONSUMER: **GPT-Image-2** paints **only** from your English. Chinese upstream is **reference**, not text to mirror literally.",
  "Structure the final English (inside JSON `prompt`) so execution is obvious—prefer this order when relevant:",
  "(1) **Subject / scene** — what appears, what to remove or simplify; single hero vs grid;",
  "(2) **Light & optics** — key vs fill, rim / edge light, palette, contrast, depth of field;",
  "(3) **Layout & negative space** — e.g. top **safe band** for hero type, side info panel, gutters for 2×4;",
  "(4) **On-image typography** — **Simplified-Chinese** headline/body: placement, scale, stroke weight, color vs background;",
  "(5) **Finish** — masterpiece, 8k, explicit aspect hint (9:16 vertical cover vs ~16:9 wide master sheet).",
  "Lyrical / literary phrasing is **optional garnish only** after (1)–(5) are locked; never replace concrete layout with metaphor.",
].join(" ");

/** 寫實落地與可選文采：**緊接** {@link GPT_IMAGE2_EXECUTION_PRIORITY_EN}，供 GPT‑5.4 與 **Gemini 3 Flash** 英文化共用。 */
export const GPT54_IMAGE_PROMPT_REALISM_AND_GARNISH_EN =
  "Ground pixels in **contemporary editorial or cinematic photorealism**: motivated light, believable materials, readable hero **Simplified-Chinese** type (weight, tracking, chromatic separation from background). **Identity / persona** cues → **art-directed** presence on set, not résumé bullets. Optional: spare **Shakespearean compression** in phrasing **after** layout is explicit—never at the cost of (1)–(5) above.";

/**
 * **平台生圖英文化共用英文總則**（**2×4／分鏡主表／八格筆記**）：消費方僅 **GPT-Image-2**。
 * **選題單封**見 {@link GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN} + {@link platformImageTranslationVertexJsonSystemInstruction}`topic_cover`。
 */
export const PLATFORM_IMAGE_TRANSLATOR_BASE_EN = `${GPT_IMAGE2_EXECUTION_PRIORITY_EN} ${GPT54_IMAGE_PROMPT_REALISM_AND_GARNISH_EN}`;

/**
 * 選題豎封：**強烈建議**依題材生成**多變、生動**且可執行的場景（寫入送往 GPT-IMAGE-2 的英文 prompt）。
 * 與 {@link PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN}、{@link buildPlatformTopicReferenceGeminiTask} 同步引用，避免各題同套一個書房模板。
 */
export const PLATFORM_COVER_SCENE_VERSATILITY_EN = `It is **highly and strongly recommended** to generate **versatile, vivid, topic-faithful** scenes for **cover-art / feed-cover** design: **concretely** stage each prompt with distinct environments across topics—rotate indoor vs outdoor, urban vs nature, clinical/lab vs marketplace vs transit, studio color-fields vs real locations—so **different Hooks feel like different worlds**; still keep premium editorial lighting and one clear hero focal beat unless the brief locks a specific set.`;


/**
 * 選題 **信息流單張 9:16 封面**：歷史上曾嵌入總 system；現僅用於 **composite** 全量規則。單封改走 {@link GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN} + 輕量 JSON 語句。
 */
export const PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN = [
  "**選題信息流單張豎封（9:16·單主視覺／信息流縮略圖）—三軌身份一致：** 你是中英雙語 **封面級編導**；輸出的 JSON **`prompt`** 僅為 **GPT-IMAGE-2** 可執行的 **英文**；**格數、橫豎、單封 vs 網格以任務原文為準，不建議擅自改軌。**",
  "**豎封軟邊界（圖標層仍為必達；其餘以軟約束為主，可為題材讓歩）：** **【第一優先·軟性目標】premium cover design：** 整體**優先**收斂為 **premium editorial／高端信息流封面** 質感—可信光影層次（可寫 key / fill / rim）、乾淨主從與留白、低飽和主色配**極少**亮色點綴；小圖標**強烈建議（highly recommended）**自然融入背景，與主場景光色和諧，**建議（suggested）**可用不同配色展示，且**強烈建議**不要有邊框。**建議**避免為圖標習慣性加實色圓形、大方塊、藥丸形底板，或整塊不透明白卡／高飽和霓虹襯底（若正文**明確**要走 App／促銷貼紙風，再從寬）。**（1）** **質感**：傾向 **photoreal editorial / 廣告静拍** 向，光型盡量可信（可寫 key / fill / rim），**宜避免**習慣性平光貼字、糊成一片的泛光；**（2）** **場景（多元化·與文案一致·跨主題宜多變生動）**：**建議**封面場景與正文語境**同步多元化**；**室內與戶外**遇題材均可作**參考場景**，**不建議**長期默認、過度單一集中在書房、書桌、滿牆書架、閱讀角、**或**咖啡廳**固定為伏案讀書**的單一套路，或**典型客廳、沙發電視牆等「居家日記」式內景**。可優先採用與 Hook 相稱的場域（**戶外／半戶外**：**旅遊景點**、街景、交通、自然、天臺、體育場、市集、活動外場等；**室內／生活與公共空間**：**商場**、**超市**、**咖啡廳**（日常消費／社交場景，**非**僅限讀書佈景）、**博物館**、展覽館、醫院診間、實驗室、展廳、工地／廠房、健身房、演播／舞台後台、公共大廳、棚拍色片／抽象置景、微縮置景等—**僅為示例，包括但不限於**，**並非只有書房或客廳**）。**跨主題、批次選題時，強烈建議**英文 `prompt` 寫明**多變、生動、題材忠實**的具體場景，使不同題目讀起來像不同世界—語義對齊（英文須體現）「" +
    PLATFORM_COVER_SCENE_VERSATILITY_EN +
    "」。前景／中景／後景可分层，用具象道具、手勢、環境**呼應** Hook；**僅當**正文**明確**以讀書、書房、圖書或**明確**以特定居家客廳叙事為核心時再主導該類場景；**（3）** **圖標編輯層（必達·豎封須保留）**：畫內**必須**有 **2～4 個** 與 Hook、主題與正文關鍵訊息**強語義對齊**的**極簡線稿小圖標**（可有表現力與動勢，**生動**呼應內容，忌千篇一律的通用符號堆砌）；各配 **短簡中輔標**（約 4–8 字），可橫向輕帶、左下／中下浮動簇或與中景主體形成**視覺呼應**；**從屬**主標，**不建議**遮擋主標與安全宣讀區，**不建議**做成密集成步驟教程或整版資訊圖；**（4）** **版式與衝擊力**：整體**排版美觀**（主從、留白、層級、對齊），主標與背板 **對比強**，光影／色面在縮略圖尺度須具 **高吸引力與視覺衝擊力**（以可執行光色構圖達成，非標題詐騙）；（5）**敘事鉤**：縮略圖尺度**宜**能看出視覺或敘事鉤子；（6）**版式習慣**：**宜避免**過度模板化 bland stock 臉譜占滿、豎畫布硬塞多分鏡縱條、或把豎封寫成 **2×4 寬幅主表**—**除非**任務明確要網格或筆記版。",
  "**三軌一致性：** **Vertex Gemini 3 Flash**、**OpenAI**（`modelName` 常見 **gpt‑5.4**、可 **gpt‑5.5**）、**Gemini 3 Flash Preview 兜底** 共用上列**意圖**；輸出措辭可不同，但**不建議**擅自把明確的單封任務收成多分鏡整表、或把明確的網格任務收成單張滿幅（以任務標籤為准）。",
].join("\n");

/**
 * `@google/genai` **Gemini 3 Flash** 與 **GPT 盡後 Gemini 3 Flash Preview 兜底**：`systemInstruction`。
 * - **`topic_cover`**：與 2026-05-11 晚輕量規則一致（莎士比亞短身分 + JSON 契約）。
 * - **`composite`**：執行優先 + {@link PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN}（供網格與「全量」場景）。
 */
export function platformImageTranslationVertexJsonSystemInstruction(
  profile: PlatformImageTranslationProfile = "composite",
): string {
  if (profile === "topic_cover") {
    return [
      GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
      "你是頂級中英雙語編導，也是頂級視覺提示詞導演；英文聲口須與上段莎士比亞式編導身份一致（可長可短，以忠實還原為準）。",
      "把上游任務落成 **JSON 里的英文 prompt**，供 GPT-IMAGE-2 使用；**优先** tags / 短語，**篇幅不限**，以版式與主體一次說清、利於生圖成功為準。",
      "必須返回合法 JSON：{\"prompt\":\"...\"}；prompt 內只含英文生圖指令，不建議使用 markdown、不建議附加解釋。",
      "須含 masterpiece、8k；寫清情緒、燈光、場景、主體；網格類任務（2×2 / 2×4）須保留格線硬信息。單張 9:16 封面**宜**偏單一主視覺，避免**無意**寫成多分鏡，除非任務明確要求。**【第一優先·軟性】premium cover design：** 英文 `prompt` **優先**寫出 **premium editorial feed cover** 氣質—受控留白、可信光型、低飽和主色 + 極少亮色點綴；圖標**優先**融入同一光照、**彷彿浮在**實景上，**建議圖標自然融入背景，無可見硬邊框**，**不建議**默認為每枚圖標加實色圓／方塊／藥丸襯底（除非任務明確要 UI／貼紙促銷感）。**選題豎封（圖標層仍必達）**：英文 `prompt` **必須**寫明 GPT-IMAGE-2 繪製 **2～4 個極簡線稿小圖標**（形體·位置·與 Hook／正文語義的對應），各附 **短簡中輔標**；圖標須**生動扣題**；並寫清 **美觀排版**（主從·留白·對齊）與 **強縮略圖衝擊力**（對比·光型·色面）；圖標層從屬主標，**不建議**整張僅大字而**略去**圖標層。",
      "若上游封面/科普正文未出現食物，**可不必**以廚房、食譜表、食材格為主場景。",
      "**場景多元化：** 英文 prompt 須與文案場景**同步多元化**；**室內、戶外**皆可作參考，**不建議**無正文依據時過度集中在書房、書桌、書架牆、閱讀角、咖啡廳**僅讀書套路**或**典型客廳、沙發電視牆**；優先寫出與 Hook／題材匹配的**具體場所**（**例如包括但不限於**：旅遊景點、商場、超市、咖啡廳、博物館，及街景自然、公共／工業／醫療室內、棚拍抽象景等）。",
      PLATFORM_COVER_SCENE_VERSATILITY_EN,
    ].join("\n");
  }
  return [
    PLATFORM_IMAGE_TRANSLATOR_BASE_EN,
    "你是頂級中英雙語編導：**產出 JSON 內英文 prompt，唯一消費方是 GPT-IMAGE-2**；Vertex / Gemini 路徑僅為「參照翻譯與壓縮」，不建議壓過可執行版式。",
    "把上游任務落成 **JSON 里的英文 prompt**；**优先** tags / 短語，必要時用 **編號短句** 锁主体、光、留白、簡中字。**篇幅不限**，以一次生圖成功為準。",
    "在滿足上游**版式軌道**（單封 / 多分鏡條 / 2×4 網格等）的前提下發揮光影；避免只有文采而沒有布局。",
    PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN,
    "必須返回合法 JSON：{\"prompt\":\"...\"}；prompt 內只含英文生圖指令，不建議使用 markdown、不建議附加解釋。",
    "須含 masterpiece、8k；寫清情緒、燈光、場景、主體；網格類任務（2×2 / 2×4）須保留格數、閱讀順序與格線硬信息。**電影 2×4 分鏡主表**頂欄僅 **內容總結**，每格內 **分鏡主題描述** 與表 **景別/運鏡/畫面內容/台詞與音效**；單張 9:16 封面**宜**偏單一主視覺，避免**無意**寫成多格分鏡，除非任務明確要求。",
    "若上游封面/科普正文未出現食物，**可不必**以廚房、食譜表、食材格為主場景。",
  ].join("\n");
}

/**
 * GPT 5.4 三轮耗尽后：**Vertex** 再試三輪（**豎封**預設 **Gemini 2.5 Pro**，**2×4/composite** 預設 **Gemini 3 Flash Preview**；同源 JSON **`prompt`** 契約）。
 */
async function callVertexGeminiFlashTranslationAfterGptTripleFail(
  translationTask: string,
  flowLog: string[] | undefined,
  translationProfile: PlatformImageTranslationProfile,
): Promise<string> {
  const task = String(translationTask || "").trim();
  if (!task) {
    appendGpt54TranslationDebug(flowLog, `[Vertex·Flash·GPT後兜底] 上游 task 为空`);
    throw new Error("Vertex 英文化兜底：上游 task 为空");
  }
  const statCtx: Gpt54PlatformImagePromptStatCtx =
    translationProfile === "topic_cover"
      ? { pipeline: "topic_cover" }
      : { pipeline: "composite_sheet" };
  const modelNameForLog =
    translationProfile === "topic_cover"
      ? resolveVertexCoverTranslationModelName()
      : resolveVertexFlashTranslationModelName();
  appendGpt54TranslationDebug(
    flowLog,
    `→ Vertex 英文化兜底（${modelNameForLog} · ${resolveVertexFlashTranslationLocation()}）（GPT 三轮后，最多再 3 轮）`,
  );
  return callVertexGeminiFlashTranslation(task, flowLog, {
    pipelineStatCtx: statCtx,
    afterFlashFailure: "throw",
  });
}

/** 小红书 **多页** 图文笔记：**2×4 八格**；產品上≠視頻分鏡——**不建議**用製片/DPP 式「情緒·燈光·景別·機位」欄位來組稿。 */
export const XHS_IMAGE_TEXT_NOTE_DIRECTOR_EN = `You compress Xiaohongshu (Little Red Book) **2×4 eight-panel GRAPHIC NOTES** (图文笔记拼圖 / viral note sheet) into **one** English block optimized for **GPT-Image-2** (execution-first layout: grid, gutters, per-cell hierarchy). Chinese script is **reference**—do not sacrifice grid legibility for literary paraphrase. Prefer **comma-separated tags and short noun phrases**; **do not** trim the English prompt too aggressively—when the translator goes longer, eight cells breathe and feel **less crowded**; prefer fidelity and clear per-cell beats over brevity.

LAYOUT: strict **2 rows × 4 columns**, **eight** equal cells, row-major (top L→R, then bottom L→R). **Not** a lone hero, **not** 2×2-only.

CONTENT STYLE (**not** a film storyboard): each cell should feel like a **Little Red Book carousel card** — hook lines, bullet takeaways, before/after, step lists, mini diagrams, hashtags, persona tips.

TYPOGRAPHY POLICY: **Simplified Chinese is the primary on-image explanation** (headlines, main bullets, body). **English is allowed as auxiliary**—small keywords,micro-subtags, short secondary hints, stylized accent lines—must stay **secondary** in visual weight vs 中文主解说; do not replace Chinese body copy with English.

**Soft boundary:** avoid restructuring the user's copy into **video-production callout tables** (e.g. dedicated rows/columns titled 情绪 / 灯光 / 拍摄环境 / 景别 / 机位 / 分镜表头-style grids). Those fit the separate **cinematic storyboard** pipeline better. Palette/vibe may appear as **brief** English tags, not a long DP checklist.`;

/** 小红书 2×4 八格：版式约束；输出体例见 {@link MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT}。 */
export const XHS_GRAPHIC_NOTE_2X4_FOOTER = `
TAG:XHS_GRAPHIC_NOTE_2X4_SHEET

【英文生图输出 / OUTPUT — Xiaohongshu **2×4 八格筆記**（单张宽幅 landscape，GPT-Image-2 優先）】
1. Output **one** English string **optimized for GPT-Image-2**; preferred style: **comma-separated tags / 2–5 word phrases**，並用短句**锁死** 2×4、順序、gutter。 **No fixed character limit**—longer English is OK: richer staging makes **eight cells** feel **less cramped** and balances information across the grid。
2. LAYOUT (keep explicit): wide ~16:9 landscape master (1536×1024 class), **exactly 8 equal panels**, **2 rows × 4 columns**, rigid cross gutters, read order row1 L→R then row2 L→R, masterpiece, 8k, premium Little Red Book / lifestyle-editorial note aesthetic.
3. **TYPOGRAPHY:** **Primary** on-image copy = **legible 简体中文** in every cell (titles, main lists, hooks). **Optional English** as **secondary** accent only—keywords, micro-subtitles, short tags—smaller weight than Chinese; **do not** make English the main explanation body.
4. **MANDATORY** in **each** cell: note-style density — bullets, icons, badges 01–08, pill tags, mini infographics as fits.**建议避免**整页做成電影**分鏡網格註解**（如每格固定「镜头/景别/情绪/灯光/机位」製片表）；那是 **TAG:STORYBOARD_2X4_SHEET** 專用。
5. **版式软边界：** 尽量不采用「整 canvas 单图满铺」「只有 2×2 四格」「整排八条过细横条」等会丢八格阅读性的布局；其余细节可由你根据脚本取舍。
6. Per cell: distinct carousel beat; cohesive palette across the sheet.
`.trim();

/** @deprecated 已升級為八格 2×4；請使用 {@link XHS_GRAPHIC_NOTE_2X4_FOOTER} */
export const XHS_GRAPHIC_NOTE_MIN_4_PAGES_FOOTER = XHS_GRAPHIC_NOTE_2X4_FOOTER;

/** 竖版多分镜条（若有）：英文以 tags 为主，**不設字數上限**。 */
export const MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT = `
【最高视觉指令约束 / OUTPUT】（GPT-IMAGE-2）
1. 输出 **一段完整英文** 生图指令；**优先** comma-separated tags / 短語，必要時可用稍長句式把版式說清。**不限制字符數**，以模型能穩定執行為準。
2. 保留：情绪、灯光、场景、主体/服装、标题语言（简中等）、版式提示。
3. 标题与背景对比要说清；须含 masterpiece、8k。
`.trim();

/**
 * 橫版 **2×4 分鏡主表**：八格版式要说清；**不限制英文長度**，以一次出可用網格為優先。
 */
export const STORYBOARD_2X4_SHEET_TRANSLATION_FOOTER = `
TAG:STORYBOARD_2X4_SHEET

【英文生图输出 / OUTPUT — cinematic 2×4 storyboard master（单张宽幅 landscape · GPT-Image-2 優先）】
1. Output **one** English block **for GPT-Image-2 execution**；**prefer** comma-separated tags / short fragments so the 2×4 grid stays obvious；必要時用編號句寫清頂欄比例、格線、gutter。**No character limit**—use enough English to lock all eight beats and the table schema。中文劇本僅作參考。
2. **全表顶栏（仅此一处「上方主题」）：** 画布最上 **~8–12%** 为**通栏横条**，主信息为 **内容总结**（全片/全案梗概或本段剧情提要）；可并排或次行出现「· 分镜脚本」等定式后缀。**不建議**将各格的分镜标题写进顶栏。**Do not** place the first row of panels flush against the top edge.
3. **栅格：** 顶栏之下 **整整 8 格**，**2 行 × 4 列**，刚性格线与格间直 gutter、顺扫 row1 左→右再 row2；masterpiece、8k，每格主画面为写实电影感分镜静帧。
4. **每一格自上而下：** (A) **格内顶：** **分镜主题描述**（仅本格一句醒目简中主题）；(B) **格内中：** 该分镜主画面（上区约 **70–75%**，除表格外纯影像）；(C) **格内底 ~25–30%：** 简中**四栏参考表**，表头固定为 **景别**、**运镜**、**画面内容**、**台词与音效**，四柱均有正文；可细网格；表内须为**简体中文**。**Do not** leave panels wholly wordless in the table band.
5. **版式约束：** 不建議整画布单张满幅顶掉八格、无顶栏、或仅四宫格笔记版——本任务为 **八格主表**；若丢失「顶栏内容总结」、或八格被收成单张满幅/少格，亦偏离产品主表意图；其余景别与光影可充分发挥。
6. **审美偏好（软提示，非强制）：** 整表**可倾向**统一的高级 editorial / 片场物料气质；底部说明区（**景别／运镜／画面内容／台词与音效** 等）**宜**与主静帧色调相衔接——例如浅衬、纸感、半透明分隔、柔和反差——**尽量避免习惯性做成**整段刺眼的「纯黑底 + 高亮白字」字幕条来堆技术说明（**除非**题材刻意要走极简信息图）。若与构图或可读冲突，以可读与整体协调为先。
`.trim();

/** 平台選題 **單幀封面**（圖文 / 短影音）：簡潔輸出體例；可含主題小圖示與簡中輔標（次於主標）。 */
const PLATFORM_TOPIC_GRAPHIC_PROMPT_FOOTER = `
【英文生图输出 / OUTPUT — platform topic **single-frame 9:16 feed cover**】
1. Output **one** English block for GPT-IMAGE-2.**Prefer** comma-separated tags / short phrases; longer text is OK if it locks the cover.**No fixed character limit.**
2. LAYOUT: **prefer 9:16 portrait**, single full-bleed hero, one dominant subject—**lean away from** accidental 16:9 or multi-panel reads **unless** the task explicitly asks.
3. **Composition habit:** a **single** strong cover beat usually fits this product better than storyboard grids, 2×4 strips, or numbered panels—**unless** the brief specifies panels.
4. SUBJECT & SET: align Hook + Context (**cover staging should diversify with the copy**); **reduce** unrelated generic stock tropes. **Staging diversity:** **indoor and outdoor** are both acceptable references—avoid **over-focusing** on study / office-library clichés **or** repetitive **living-room / sofa–TV** interiors unless the Context demands them; prioritize **specific** environments that **sell the hook** (urban exterior, transit, landscape, clinic/lab/industrial interior, arena, market, studio color-field set, diorama, etc.).
4.45 **Versatile, vivid scenes (highly + strongly recommended):** ${PLATFORM_COVER_SCENE_VERSATILITY_EN}
4.5 **First priority (soft) — premium cover design:** **Prefer** a **premium editorial / luxury-feed** read: cohesive motivated lighting, disciplined hierarchy and negative space, a **restrained** palette with **one** crisp accent; micro-icons should feel **lit by the same scene** as the hero—not pasted stickers. **Not recommended:** defaulting to heavy solid circular/square/pill **badges** behind every glyph, opaque white “card” slabs, or loud neon fill blocks—**unless** the brief explicitly asks for UI / promo-sticker grammar.
5. **Editorial icon layer (required on feed covers):** **Strongly prioritize** **2–4** refined **line-art micro-icons** (thin yet **expressive**) that **specifically echo** the hook, theme, and concrete beats from the Context—not generic clip-art. Each icon pairs with a **short Simplified-Chinese** 辅标 (~4–8 chars). Arrange as **compact horizontal band** or **floating cluster** (lower-third or mid-left), **subordinate** yet **clearly legible** at thumbnail scale. **Highly recommended:** integrate icons naturally into the background lighting and color scheme, **suggested without rigid visible borders or hard boxes**, so they feel seamlessly blended into the scene. **Not recommended:** omitting this layer; **not recommended:** letting icons collide with or **visually overpower** the hero headline; **not recommended:** turning the canvas into a dense step-by-step tutorial sheet.
6. **Layout & impact:** specify **polished composition** (hierarchy, breathing room, alignment) plus **bold feed-stopping contrast** (motivated light, dominant hue + razor accent, depth) for **high visual attraction and punch**— honest staging, not clickbait typography tricks.
7. Include masterpiece, 8k; state Simplified-Chinese headline / on-image copy needs when the brief requires 简中.
`.trim();

export function stripGeminiModelOutput(raw: string): string {
  let t = String(raw || "").trim();
  const fence = /^```(?:[a-zA-Z0-9+-]*)?\s*([\s\S]*?)```$/;
  const m = t.match(fence);
  if (m?.[1]) t = m[1].trim();
  return t.replace(/^["']|["']$/g, "").trim();
}

export async function extractChineseVisualBrief(rawContext: string, flowLog?: string[]): Promise<string> {
  const slice = String(rawContext || "").trim().slice(0, SCRIPT_SLICE);
  if (!slice) {
    appendVertexFlashDebug(flowLog, `[骨架·中文视觉] 輸入為空，跳過 extractChineseVisualBrief`);
    return "";
  }

  appendVertexFlashDebug(
    flowLog,
    `[骨架·中文视觉] extractChineseVisualBrief 開始 · 輸入約 ${slice.length} 字（上限切片 ${SCRIPT_SLICE}）`,
  );

  if (!isPlatformImageOpenAiAllowed()) {
    appendVertexFlashDebug(
      flowLog,
      `[骨架·中文视觉] OpenAI 未啟用（未設 PLATFORM_IMAGE_ALLOW_OPENAI=1）· 跳過 GPT 骨架 · 回傳原文切片`,
    );
    return slice.slice(0, CHINESE_VISUAL_BRIEF_MAX_CHARS);
  }

  appendVertexFlashDebug(flowLog, `[骨架·中文视觉] GPT 5.4 → JSON brief …`);

  try {
  const response = await invokeLLM({
    provider: "openai",
    model: "gpt54",
    modelName: process.env.OPENAI_GPT54_MODEL?.trim() || "gpt-5.4",
    response_format: { type: "json_object" },
    max_tokens: 8192,
    messages: [
      {
        role: "system",
        content: [
          "你是一位像莎士比亚剧场里锤炼台词那样锤炼画面的双语视觉编导：精通语言的节奏与意象，读中文时像读诗一样抓住「最省字、最有画面」的那几笔。",
          "只做一步：从输入里抽出中文「视觉骨架」，不做英文翻译。",
          "在不过度淹没细节的前提下提炼：可保留足够长的关键词与时间线提示；去掉纯解释性废话与空洞修辞；需要完整保留 Hook、身份、核心道具与视觉动作。",
          "若输入宽幅 2×4 **电影分镜主表**剧本：骨架里区分——**全文内容总结**（适合放在整表顶栏的一句汇总）与各格 **分镜主题**（每格一句）及可填入 **景别/运镜/画面内容/台词与音效** 的要点，不建議把各格主题误并入「顶栏总结」混写。",
          "若偏封面用途：尽量留下 **标题可视化的设色/字级/对比意图**、**能引起好奇的视觉钩子詞**（动作瞬间、對撞关系、未完叙事）以及 **内文关键场景**（可转译为画面的空间、道具、光线），并**务必**留下 **2～4 个可入画的具象图标题材**（与 Hook、正文关键词**一一对应**，供下游**必出**线稿小图标+简中辅标，忌泛泛符号）。",
          "保留：情绪、灯光、场景、服装、关键道具、镜头气质、版式提示；若文中有身份锚点或 IP 基因，须留下可拍出来的身份词（职业符号、场景档次），不建議删光。",
          "若正文主題明顯與餐食、烹飪無關，不必主動引入廚房、食譜表等構圖；若brief里有食物叙事再保留即可。",
          "場景提煉：**建議**封面與文案場景多元化；**室內、戶外**皆可入骨架。**不建議**無依據時把畫面過窄在書房、書桌、滿架書本或**反覆客廳、沙發區**；可保留與題材吻合的**具體場所詞**（**例如包括但不限於**旅遊景點、商場、超市、咖啡廳、博物館，及街景自然、工業／醫療／公共室內等）。**多選題／跨題材時**宜在骨架中留出**可區分、多變、生動**的場景錨點，避免每題都落成同一書房或客廳詞條。",
          "请返回 JSON 对象，仅含一个键 brief，例如：{\"brief\":\"...\"}；brief 不建議留空。",
        ].join("\n"),
      },
      {
        role: "user",
        content: `请先提取中文视觉骨架，再供后续翻译使用。输入内容：\n${slice}`,
      },
    ],
  });

  const raw = String(response.choices[0]?.message?.content || "").trim();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(extractJsonString(raw));
  } catch {
    parsed = null;
  }

  const brief = String(parsed?.brief || "").trim();
  const out = brief.slice(0, CHINESE_VISUAL_BRIEF_MAX_CHARS);
  appendVertexFlashDebug(
    flowLog,
    `[骨架·中文视觉] 完成 · brief 約 ${out.length} 字 · JSON 解析=${parsed ? "ok" : "失敗(用原始片段推理)"}`,
  );
  return out;
  } catch (e: unknown) {
    appendVertexFlashDebug(flowLog, `[骨架·中文视觉] 异常: ${formatErrForVertexDebug(e)}`);
    throw e;
  }
}

/** 横版 2×4 电影级分镜主表：定稿人设见下行英文块（translatePlatformCompositeToEnglishPrompt · storyboard sheet） */
export function buildVideoStoryboardGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return (
    `
You turn the Chinese script into **one English image prompt** for **GPT-Image-2** (execution-first). Prefer comma-separated tags / short fragments so the frame reads as **8 panels in 2 rows × 4 columns** with clear gutters—not a single full-bleed poster. Chinese is **reference**—do not bury grid or table schema under literary paraphrase. Longer English is fine if it helps lock all eight beats.

**Non-negotiable — top title strip (全表唯一「上方主题」):** the **top ~8–12%** is **only** for **内容总结**—the overall thematic headline for the entire sheet (whole-script / episode summary). You may show 「{成片或系列名} · 分镜脚本」next to or above that summary line, but **never** put per-shot titles here—those live **only inside each panel**. **All eight cells sit entirely below this strip**—never align the first row of panels flush to the canvas top.

**Non-negotiable — inside every panel (01→08):** each cell stacks vertically:
1) **格内上方栏：** **分镜主题描述**（本分镜的主题概述）—one bold, legible **简体中文** line for **this shot only** (e.g. 宫门夜雪 / 对峙之刻).
2) **格内中间：** the **cinematic storyboard still** for that beat (high detail).
3) **格内下方栏：** a **compact Simplified Chinese table** with **exactly these four fields**, matching the reference layout: **景别**、**运镜**、**画面内容**、**台词与音效**—all four filled from the script per panel; table body **简体中文** (not English-only).

**Soft aesthetic preference (optional guidance):** treat the whole sheet as one cohesive premium storyboard—the lower table bands may **lean toward** paper tint, soft frosted bands, or gentle separation that **harmonize** with each still’s palette, rather than **defaulting to** stark full-black strips with pure-white type for lighting / camera callouts (unless the script clearly wants that look). This is **not** a hard rule when readability or story clarity disagrees.

[cinematic continuity]: dramatic film stills, 8k, intricate lighting, cohesive luxury palette (you may cite cold/warm contrast, wuxia, medical authority, etc. when the script fits).

[Chinese Script]:
${slice}
`.trim() +
    "\n\n" +
    STORYBOARD_2X4_SHEET_TRANSLATION_FOOTER
  );
}

/** 小红书图文笔记：**2×4 八格**宽幅合成（與分鏡主表同網格）；人设见 {@link XHS_IMAGE_TEXT_NOTE_DIRECTOR_EN} */
export function buildXhsNoteGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return (
    `
${XHS_IMAGE_TEXT_NOTE_DIRECTOR_EN}

[Chinese Script]:
${slice}
`.trim() +
    "\n\n" +
    XHS_GRAPHIC_NOTE_2X4_FOOTER
  );
}

/** 战略智库杂志封面：双语编导（Vertex Global · gemini-3.1-pro-preview）把中文题与出版语境压成英文视觉 prompt → GPT-IMAGE-2 */
export function buildStrategicCoverGeminiTask(input: {
  chineseTitle: string;
  englishMonthYear: string;
  chinesePublicationDate: string;
}): string {
  const title = String(input.chineseTitle || "").trim().slice(0, 80);
  return `
You are a bilingual (English and Simplified Chinese) elite magazine art director and prompt engineer.

CRITICAL PIPELINE (DO NOT SKIP):
**GPT-IMAGE-2** only receives **your English output** and paints pixels—it **cannot** translate or interpret the Chinese title by itself. You MUST read the Chinese title and publication hints below and output **ONLY ONE** final **English** prompt string that already encodes all layout, materials, and **Simplified-Chinese** hero typography requirements (stated in English for the image model).
**Execution-first:** prioritize **numbered, concrete directives** (scene / light / typography zone / Chinese glyph specs) so GPT-Image-2 can render without guessing; Chinese is reference for in-image text content only.

Read the Chinese report title and publication hints, then output ONLY ONE final English prompt string for GPT-IMAGE-2.

MANDATORY RULES FOR YOUR OUTPUT PROMPT:
1. START EXACTLY WITH: "Luxury dark-gold Harvard Business Review style magazine cover, 9:16 vertical portrait, cinematic editorial photography, dramatic lighting, premium dark gold palette, masterpiece print quality."
2. SCENE: Describe layout, lighting, textures, and luxury materials in vivid English only for non-text regions.
3. CRITICAL TYPOGRAPHY (SIMPLIFIED CHINESE ONLY): You MUST include this exact requirement: "All masthead lines, hero headline, and every readable word on the cover MUST be in Simplified Chinese only (no Traditional Chinese). Bake the following Chinese string as the main cover headline, large and legible: 「${title}」. Optional tiny corner line in English may show only the masthead date token: ${input.englishMonthYear}. If any secondary Chinese tagline is needed, use Simplified Chinese (e.g. 战略情报)."
4. Add publication context in English for the model only: "Chinese publication calendar note: ${input.chinesePublicationDate}."
5. OUTPUT: Output ONLY the English prompt string. No explanations.

[Chinese title]: ${title}
`.trim();
}

/** GodView 章节扉页：双语编导读中文 → 一条英文视觉 prompt；GPT-IMAGE-2 无翻译能力 */
export function buildChapterPosterGeminiTask(chineseTitle: string, chineseContext: string): string {
  const t = String(chineseTitle || "").trim().slice(0, 120);
  const c = String(chineseContext || "").trim().slice(0, 2000);
  return `
You are a bilingual (English and Simplified Chinese) art director and strategic visual translator.

CRITICAL PIPELINE (DO NOT SKIP):
**GPT-IMAGE-2** sees **only** your **English** prompt—**not** the Chinese passage. You MUST distill the Chinese title and passage into **one** self-contained **English** visual prompt, with hero **Simplified-Chinese** lines specified via explicit English instructions to the image model.
**Execution-first:** lock **layout, lighting, and on-image Chinese type specs** in plain English **before** any lyrical phrasing.

Output ONLY ONE English prompt for GPT-IMAGE-2.

MANDATORY RULES:
1. START EXACTLY WITH: "Luxury strategic intelligence chapter poster, 9:16 vertical, cinematic editorial, dark gold and ink palette, museum-grade lighting."
2. Describe visual scene in English; all prominent typography on the poster MUST be Simplified Chinese only. Hero title must include exactly: 「${t}」.
3. Summarize supporting context from the Chinese passage into English visual staging cues only (do not paste the Chinese paragraph as unreadable microtext). Chinese passage for your analysis:\n${c}
4. OUTPUT: English prompt only, no chitchat.
`.trim();
}

/**
 * 同一批次多條選題各自出豎封時：**不同選題，建議採用不同場景**；例如 batch 為四時即**四個選題、四個不同場景**。
 * 見 {@link buildPlatformTopicBatchSceneSoftHintBlock}、{@link buildPlatformTopicReferenceGeminiTask}`batchSceneDiversity`。
 */
export type PlatformTopicBatchSceneDiversity = {
  /** 批次內 0-based 序號（第 1 條 → 0） */
  slotIndex: number;
  /** 批次總條數；&lt; 2 時不注入軟提示 */
  slotTotal: number;
};

const BATCH_SCENE_AXIS_HINTS_ZH: readonly string[] = [
  "旅遊景點、戶外自然、城市街景與交通節點（**戶外／半戶外**軸）",
  "商場、超市、市集與零售空間（**消費／市集**軸）",
  "博物館、展覽館、文化展廳與展陳空間（**文博**軸）",
  "咖啡廳、輕餐社交、交通樞紐大廳、車站／機場公共區、酒店大堂等（**公共社交／交通**軸）",
];

/**
 * 插入 Gemini 參考任務：**不同選題，建議採用不同場景**；批次內第 k 條附一條**示例軸**供落地（第五條起對四取模）。
 * `slotTotal &lt; 2` 時回傳空字串。
 */
export function buildPlatformTopicBatchSceneSoftHintBlock(h: PlatformTopicBatchSceneDiversity): string {
  const total = Math.floor(Number(h.slotTotal));
  const idx = Math.floor(Number(h.slotIndex));
  if (!Number.isFinite(total) || total < 2) return "";
  const safeIdx = Number.isFinite(idx) && idx >= 0 ? idx : 0;
  const axis = BATCH_SCENE_AXIS_HINTS_ZH[safeIdx % BATCH_SCENE_AXIS_HINTS_ZH.length];
  const k = safeIdx + 1;
  const fourTopicsLine =
    total === 4
      ? "**目前為四個選題，即四個不同場景（四張封面各一景）；勿四張同源套路。**"
      : `**本批共 ${total} 條選題，建議 ${total} 張封面各採可區分的場景，勿多張雷同佈景。**`;
  return (
    `【同一批次·場景軟性建議與要求】**原則**：**不同選題，建議採用不同場景**，與正文語境對齊並**互相錯開**書房／書桌／反覆客廳等單調套路。${fourTopicsLine}` +
    `本條為批次中 **第 ${k} / ${total} 條**。**建議**主場景可優先參考「${axis}」作為與他條區隔的起手方向；生活場所舉例**包括但不限於**旅遊景點、商場、超市、咖啡廳、博物館等，實際仍須服務本條 Hook／正文。**硬性讓位**：若正文**明確**指定場所，**以正文為準**。`
  );
}

/** 平台選題單幀：`graphic`＝图文竖封；`video`＝短影音 **單張** 9:16 封面（非横版 2×4）。宽幅 2×4 见 {@link buildVideoStoryboardGeminiPrompt} / {@link buildXhsNoteGeminiPrompt}。 */
export function buildPlatformTopicReferenceGeminiTask(input: {
  topicHook: string;
  context: string;
  variant: "video" | "graphic";
  coverPersonaContext?: string;
  /** 批量多選題：傳入則注入「不同選題，建議採用不同場景」軟提示（如四個選題→四個不同場景） */
  batchSceneDiversity?: PlatformTopicBatchSceneDiversity;
}): string {
  const hook = String(input.topicHook || "").trim().slice(0, 500);
  const ctx = String(input.context || "").trim().slice(0, SCRIPT_SLICE);
  const personaRaw = String(input.coverPersonaContext || "").trim().slice(0, 2000);
  const personaBlock =
    personaRaw.length > 0
      ? `
【单帧出镜 · 身份锚定】（英文 tags 须体现可视觉化身份与场景档次；**場景可多元**，**室內與戶外**皆可，不默認書房書桌或反覆客廳；须服务 **情绪、文化语境与人文关怀**，可用隐喻与具象符号，但避免空泛堆砌；封面单帧适用）
${personaRaw}

`.trim() + "\n\n"
      : "";
  const batchSceneBlock = input.batchSceneDiversity
    ? buildPlatformTopicBatchSceneSoftHintBlock(input.batchSceneDiversity)
    : "";
  const isVideo = input.variant === "video";
  const coverDesignOnly = `
COVER DESIGN — **soft boundaries first** (if the brief explicitly specifies aspect, panels, or tropes, **follow the brief**). **Deliverable:** the **icon editorial band** below is still **required** on feed covers.
- **1st priority (soft) — premium cover design:** **Prefer** **premium editorial feed-cover** quality: motivated light, calm hierarchy, restrained palette + a single sharp accent; icons should read as **integrated into the same lighting** as the hero. **Not recommended:** chunky solid icon badges, opaque sticker-backs, or neon slabs behind every glyph unless the brief clearly wants promo / UI styling.
- **Aspect & frame:** **prefer** **9:16 portrait**, one tall hero; **lean away from** slipping into 16:9 or 1:1 **unless** the task asks.
- **Hero:** one dominant subject and a clear focal story usually read better on feeds than a busy sheet.
- **Set diversity (anti-cliché):** **Cover and copy** in Context should **stay in sync**—stage **diversified** environments. **Not recommended:** over-using study / home office / library wall / reading nook / café study OR **defaulting to** living-room / sofa–TV wall when the Context does not require it. **Indoor and outdoor** are both valid references—**rotate** between them as fits the hook (streets, transit, nature, rooftops, clinics, labs, factories, venues, gyms, public halls, bold studio sets, etc.)—only lean book- or living-room–heavy when the brief clearly says so.
- **Versatile, vivid scenes (highly + strongly recommended):** ${PLATFORM_COVER_SCENE_VERSATILITY_EN}
- **Layout habits:** multi-panel storyboard, dual-card note, or Xiaohongshu **image–text note** grammar is easy to over-default—**use only if** the brief asks. Avoid letting the **dominant** read be a dense step checklist or app **comment wall**; keep the hero title primary.
- **Icon editorial band (required):** Always direct **2–4** refined **line-art** icons + **short Simplified-Chinese** 辅标. Each icon must **vividly match** concrete ideas, metaphors, or props from the hook 「${hook}」**and** the Context—not decorative clutter. Cluster as a **compact band** or **floating group** (e.g. lower-third / mid-left), **subordinate** to the hero headline but **readable at thumbnail scale**. **Highly recommended:** the icon layer should naturally blend into the main background, **suggested without visible box borders or harsh outlines**, adopting the ambient palette. **Not recommended:** omitting this layer; **not recommended:** letting icons overpower the headline.
- **Visual impact:** Push for **beautiful layout** (balance, alignment, negative space) and **high feed-stopping contrast**—motivated light, bold hue vs accent, cinematic depth—so the cover feels **premium and magnetic** without misleading clickbait.
- **Chrome:** account UI and comment bars often distract—**prefer** a clean editorial frame **unless** the concept needs them.
- **Thumbnail legibility:** the **upper ~35–45%** is often a good band for **large, legible Simplified-Chinese** hook type with comfortable contrast; all-caption-minimal layouts can disappear small—**prefer** more air when unsure.
- **Trend defaults:** storyboard grids, 2×4, eight-up montage, numbered strips, comic gutters, film contact-sheet motifs, or generic **救赎/逆袭** business arcs—**prefer to avoid** them **unless** the hook or brief genuinely calls for them.
- **Grounding:** stay close to the hook 「${hook}」, Context, and any identity anchor—wardrobe, props, and environment in the same tier. If food/cooking is **not** named in hook or Context, **prefer not** to **lead** with kitchens, recipe charts, ingredient grids, cooking steps, noodle bowls, restaurant plating, or lesson-style recipe columns—**unless** you have a clear narrative reason.
- Main title based on 「${hook}」
`.trim();
  return (
    `
${personaBlock}${batchSceneBlock ? `${batchSceneBlock}\n\n` : ""}${
  isVideo
    ? "You are a bilingual cover design director for **vertical 9:16 single-frame** short-video **feed covers**—one tall hero with emotional, humanistic staging; **prefer** not mixing in landscape **2×4 master-sheet** grammar **unless** the task asks."
    : "You are a bilingual cover design director for **single-image vertical covers** with editorial clarity (this task is **cover-first**; **prefer** not defaulting to Xiaohongshu **dual-card note** grammar **unless** the brief asks)."
}

${isVideo
  ? "Use Simplified Chinese as the main title language."
  : "Use Simplified Chinese as the main title language, with English allowed as secondary supporting text."}

${coverDesignOnly}

Context:
${ctx}
`.trim() +
    "\n\n" +
    PLATFORM_TOPIC_GRAPHIC_PROMPT_FOOTER
  );
}

/**
 * 战略封面 / 章节扉页：**Vertex Global · gemini-3.1-pro-preview** 双语编导 → 一条英文视觉 prompt。
 */
export async function runGemini31ProPreviewText(userTask: string): Promise<string> {
  const { callGemini3_1_Pro } = await import("./vertexGemini31ProGlobal.js");
  const raw = await callGemini3_1_Pro(userTask);
  const out = stripGeminiModelOutput(raw);
  if (!out) {
    throw new Error("封面指令返回空内容");
  }
  return out;
}

/**
 * Vertex AI 英文化：`responseMimeType: application/json`。
 * - **豎封封面**（`pipeline: topic_cover`）：預設 **Gemini 2.5 Pro**（{@link resolveVertexCoverTranslationModelName}）。
 * - **2×4／分鏡／八格**（composite）：預設 **Gemini 3 Flash Preview**（{@link resolveVertexFlashTranslationModelName}）。
 * **豎封** `temperature` / `maxOutputTokens` 見 {@link resolveVertexCoverTranslationTemperature}、{@link resolveVertexCoverTranslationMaxOutputTokens}（預設 0.9 · 32K）；**composite** 見 {@link resolveVertexFlashTranslationTemperature}、{@link resolveVertexFlashTranslationMaxOutputTokens}，並併用 {@link resolveVertexFlashThinkingConfigForSdk}（Gemini 3）；**豎封**不送 thinking 欄位，避免與 2.5 Pro 不相容。
 * **最多 3 次**：第 1 次立即；若異常或無有效 prompt → 等 **3s** 再第 2 次；仍失敗 → 等 **6s** 再第 3 次。
 * **三次仍失敗** → 若 {@link isPlatformImageOpenAiAllowed} 為真則 **fallback {@link callGemini3_1_Pro_AiStudio}（OpenAI）**；否則直接拋錯（省 OpenAI 額度）。
 */
export async function callVertexGeminiFlashTranslation(
  translationTask: string,
  flowLog?: string[],
  opts?: {
    compositeTranslationStrict?: boolean;
    pipelineStatCtx?: Gpt54PlatformImagePromptStatCtx;
    /** `throw`：Vertex 輪次耗盡後直接拋錯，不呼叫 OpenAI。 */
    afterFlashFailure?: "gpt" | "throw";
    /** 同一模型 Vertex 調用上限（預設 3；豎封 Pro 首段可設 1 以便交給 Flash 兜底）。 */
    maxVertexAttempts?: number;
  },
): Promise<string> {
  const task = String(translationTask || "").trim();
  if (!task) {
    appendVertexFlashDebug(flowLog, `輸入 task 為空 → 中止`);
    throw new Error("Vertex 英文化：上游 task 为空");
  }

  let project: string;
  try {
    project = resolveVertexProjectIdForGenAi();
  } catch (e) {
    appendVertexFlashDebug(flowLog, `resolveVertexProjectId 失敗: ${formatErrForVertexDebug(e)}`);
    throw e instanceof Error ? e : new Error(String(e));
  }

  const ctxPipe = opts?.pipelineStatCtx?.pipeline;
  const useGemini25ProModel = ctxPipe === "topic_cover";

  const profile = resolveTranslationProfile(opts?.pipelineStatCtx);
  const model = useGemini25ProModel
    ? resolveVertexCoverTranslationModelName()
    : resolveVertexFlashTranslationModelName();
  const location = resolveVertexFlashTranslationLocation();
  const authOpts = buildGoogleGenAiAuthOptionsFromEnv();
  const authMode = authOpts ? "GOOGLE_APPLICATION_CREDENTIALS_JSON(service_account)" : "ADC/運行環境默認憑證";

  appendVertexFlashDebug(
    flowLog,
    `── Vertex 英文化開始 ── project=${project} · location=${location} · model=${model} · ctxPipeline=${ctxPipe ?? "n/a"} · profile=${profile} · auth=${authMode}`,
  );
  const flashTemp = useGemini25ProModel
    ? resolveVertexCoverTranslationTemperature()
    : resolveVertexFlashTranslationTemperature();
  const vertexThinking = useGemini25ProModel ? {} : resolveVertexFlashThinkingConfigForSdk();
  const flashMaxOut = useGemini25ProModel
    ? resolveVertexCoverTranslationMaxOutputTokens()
    : resolveVertexFlashTranslationMaxOutputTokens();
  appendVertexFlashDebug(
    flowLog,
    `請求參數 · responseMimeType=application/json · maxOutputTokens=${flashMaxOut} · temperature=${flashTemp} · thinkingConfig=${
      (vertexThinking as { thinkingConfig?: unknown }).thinkingConfig
        ? JSON.stringify((vertexThinking as { thinkingConfig?: unknown }).thinkingConfig)
        : "(未設定)"
    } · task 約 ${task.length} 字`,
  );

  /** `topic_cover` 與 5/11 晚輕量 system 一致；`composite` 為網格執行優先。 */
  const systemInstruction = platformImageTranslationVertexJsonSystemInstruction(profile);

  appendVertexFlashDebug(flowLog, `new GoogleGenAI({ vertexai: true }) …`);
  const ai = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    ...(authOpts ? { googleAuthOptions: authOpts } : {}),
  });

  const runFlashAttempt = async (): Promise<string> => {
    appendVertexFlashDebug(flowLog, `調用 ai.models.generateContent({ model }) …`);
    const genConfig = {
      systemInstruction,
      responseMimeType: "application/json" as const,
      temperature: flashTemp,
      topP: 0.95,
      maxOutputTokens: flashMaxOut,
      ...vertexThinking,
    };
    const response = await ai.models.generateContent({
      model,
      contents: `请返回 JSON：{"prompt":"..."}。\n${task}`,
      config: genConfig as any,
    });

    type GenContentDebug = {
      text?: string;
      candidates?: Array<{ finishReason?: string; safetyRatings?: unknown }>;
      usageMetadata?: unknown;
    };
    const respAny = response as unknown as GenContentDebug;
    const finishReason = respAny?.candidates?.[0]?.finishReason ?? null;
    const safety = respAny?.candidates?.[0]?.safetyRatings;
    const usage = respAny.usageMetadata;
    appendVertexFlashDebug(
      flowLog,
      `generateContent 已返回 · finishReason=${finishReason ?? "n/a"} · usageMetadata=${usage != null ? JSON.stringify(usage).slice(0, 220) : "n/a"}`,
    );
    if (safety != null) {
      appendVertexFlashDebug(flowLog, `safetyRatings(摘要)=${JSON.stringify(safety).slice(0, 280)}`);
    }

    const raw = String(response.text ?? "").trim();
    appendVertexFlashDebug(
      flowLog,
      `response.text 長度=${raw.length}${raw ? ` · 頭 120 字: ${raw.replace(/\s+/g, " ").slice(0, 120)}` : ""}`,
    );

    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(extractJsonString(raw)) as Record<string, unknown>;
      appendVertexFlashDebug(flowLog, `JSON.parse(extractJsonString) → ok · 頂層鍵=${parsed ? Object.keys(parsed).join(",") : ""}`);
    } catch (parseErr) {
      appendVertexFlashDebug(flowLog, `JSON 解析失敗: ${formatErrForVertexDebug(parseErr)}`);
      parsed = null;
    }

    const fromPrompt = String(parsed?.prompt ?? "").trim();
    if (fromPrompt) {
      appendVertexFlashDebug(flowLog, `輸出分支=prompt 欄位 · 英文長度=${fromPrompt.length} → 採用`);
      return fromPrompt;
    }

    const stripped = stripGeminiModelOutput(raw);
    if (stripped && !stripped.startsWith("{")) {
      appendVertexFlashDebug(flowLog, `輸出分支=stripGeminiModelOutput（非 JSON 裸字串）· 長度=${stripped.length} → 採用`);
      return stripped;
    }

    appendVertexFlashDebug(flowLog, `prompt 空且裸字串不可用 → 本次失敗`);
    throw new Error("Vertex 英文化：模型未返回有效 prompt（JSON prompt 字段为空且无法从响应文本恢复）");
  };

  let lastFailure: unknown = null;
  const configuredAttempts = opts?.maxVertexAttempts;
  const maxAttempts =
    typeof configuredAttempts === "number" && Number.isFinite(configuredAttempts)
      ? Math.min(8, Math.max(1, Math.floor(configuredAttempts)))
      : 3;
  for (let i = 0; i < maxAttempts; i++) {
    if (i === 1) {
      appendVertexFlashDebug(flowLog, "[Flash·翻译] 第 1 次無效，等待 3000ms 後第 2 次…");
      await new Promise((r) => setTimeout(r, 3000));
    } else if (i === 2) {
      appendVertexFlashDebug(flowLog, "[Flash·翻译] 第 2 次仍無效，等待 6000ms 後第 3 次…");
      await new Promise((r) => setTimeout(r, 6000));
    }
    try {
      const out = await runFlashAttempt();
      if (i > 0) {
        appendVertexFlashDebug(flowLog, `[Flash·翻译] 第 ${i + 1} 次重试成功 · 約 ${out.length} 字符`);
      }
      return out;
    } catch (e: unknown) {
      lastFailure = e;
      appendVertexFlashDebug(flowLog, `[Flash·翻译] 第 ${i + 1}/${maxAttempts} 次失败 · ${formatErrForVertexDebug(e)}`);
    }
  }

  appendVertexFlashDebug(
    flowLog,
    `[Flash·翻译] 已 ${maxAttempts} 次仍失败 · ${formatErrForVertexDebug(lastFailure)}`,
  );
  if (opts?.afterFlashFailure === "throw" || !isPlatformImageOpenAiAllowed()) {
    appendVertexFlashDebug(
      flowLog,
      !isPlatformImageOpenAiAllowed()
        ? `[Flash·翻译] OpenAI 未啟用（未設 PLATFORM_IMAGE_ALLOW_OPENAI=1）· 不再回退 · ${PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}`
        : `[Flash·翻译] afterFlashFailure=throw · 不再回退 OpenAI · ${PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}`,
    );
    throw new Error(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
  }
  appendVertexFlashDebug(
    flowLog,
    "[Flash·翻译] → fallback OpenAI GPT 5.4（callGemini3_1_Pro_AiStudio · skipVertexFallback · 最多 3 轮）",
  );
  console.warn(
    `[Vertex GenAI ${resolveVertexFlashTranslationModelName()} 三輪失敗 · ${resolveVertexFlashTranslationLocation()}] 改走 GPT 5.4:`,
    lastFailure instanceof Error ? lastFailure.message : lastFailure,
  );
  return await callGemini3_1_Pro_AiStudio(task, flowLog, opts?.pipelineStatCtx, {
    skipVertexFallback: true,
    compositeTranslationStrict: Boolean(opts?.compositeTranslationStrict),
  });
}

/**
 * 選題 **豎封**英文化：**先** {@link resolveVertexCoverTranslationModelName}（預設 **gemini-2.5-pro**）**單次**；
 * 失敗則 **Gemini 3 Flash Preview**（`topic_cover_flash`，同源豎封 JSON 契約）最多 **3** 次間隔重試；
 * **不**回退 OpenAI（`afterFlashFailure=throw`；且預設 {@link isPlatformImageOpenAiAllowed} 為關）。
 */
export async function translatePlatformTopicCoverToEnglishVertexOnly(
  translationTask: string,
  flowLog?: string[],
): Promise<string> {
  const task = String(translationTask || "").trim();
  if (!task) {
    appendVertexFlashDebug(flowLog, `輸入 task 為空 → 中止`);
    throw new Error("Vertex 英文化：上游 task 为空");
  }
  try {
    return await callVertexGeminiFlashTranslation(task, flowLog, {
      pipelineStatCtx: { pipeline: "topic_cover" },
      afterFlashFailure: "throw",
      maxVertexAttempts: 1,
    });
  } catch (e) {
    appendVertexFlashDebug(
      flowLog,
      `[豎封·兜底] ${resolveVertexCoverTranslationModelName()} 單次未成功 → ${resolveVertexFlashTranslationModelName()} · ${formatErrForVertexDebug(e)}`,
    );
  }
  return callVertexGeminiFlashTranslation(task, flowLog, {
    pipelineStatCtx: { pipeline: "topic_cover_flash" },
    afterFlashFailure: "throw",
  });
}

/**
 * 舊名保留：平台「探索」英文化走 {@link callVertexGeminiFlashTranslation}（Flash Live Preview · 失敗 3 次後 GPT 5.4）。
 */
export async function callVertexGemini31ProForImagePrompt(
  translationTask: string,
  flowLog?: string[],
  opts?: { compositeTranslationStrict?: boolean; pipelineStatCtx?: Gpt54PlatformImagePromptStatCtx },
): Promise<string> {
  return callVertexGeminiFlashTranslation(translationTask, flowLog, opts);
}

/** 與 {@link callVertexGemini31ProForImagePrompt} 相同，便於對照文檔命名。 */
export async function callVertexGemini31ProTranslation(prompt: string): Promise<string> {
  return callVertexGemini31ProForImagePrompt(prompt);
}

/**
 * 平台生图英文化：**OpenAI**（預設 gpt‑5.4…）最多 3 次。**選題單封**（`pipeline: topic_cover`）與 **Gemini 3 Flash** 使用輕量 {@link platformImageTranslationVertexJsonSystemInstruction}`topic_cover`；**2×4／分鏡** 使用 `composite` 與 {@link PLATFORM_IMAGE_TRANSLATOR_BASE_EN}。
 * 三次仍無有效英文 → 非避險且未設 `skipVertexFallback` 時改走 **Vertex Gemini 3 Flash Preview** 再試三輪（{@link callVertexGeminiFlashTranslation}，`systemInstruction` 與主 Flash 同源）；**不再**偽裝可用 prompt：GCP 避險、`skipVertexFallback`、Vertex 兜底失敗等一律 **拋錯**（用戶向 {@link PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}）。
 * `skipVertexFallback`：由 {@link callVertexGeminiFlashTranslation} 在 Flash 三輪後呼叫，避免再次打 Vertex。
 * `compositeTranslationStrict`：分鏡/八格英文化；GPT 三輪盡力後不發 Vertex，直接拋 {@link PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}。
 */
export async function callGemini3_1_Pro_AiStudio(
  prompt: string,
  flowLog?: string[],
  statCtx?: Gpt54PlatformImagePromptStatCtx,
  opts?: { skipVertexFallback?: boolean; compositeTranslationStrict?: boolean },
): Promise<string> {
  if (!isPlatformImageOpenAiAllowed()) {
    appendGpt54TranslationDebug(flowLog, "[英文化] OpenAI 未啟用 · 改走 Vertex（設 PLATFORM_IMAGE_ALLOW_OPENAI=1 可恢復 GPT）");
    return callVertexGeminiFlashTranslation(prompt, flowLog, {
      pipelineStatCtx: statCtx,
      afterFlashFailure: "throw",
    });
  }

  const skipVertexFallback = Boolean(opts?.skipVertexFallback);
  const compositeTranslationStrict = Boolean(opts?.compositeTranslationStrict);
  const translationProfile = resolveTranslationProfile(statCtx);
  /** 模型名環境決定：**gpt‑5.4、gpt‑5.5** 等皆走此路—選題信息流單封身份與 **{@link PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN}** 及 Gemini 3 Flash **一致**。Stage 2 見 {@link getPlatformStage2OpenAiModel} */
  const modelName =
    process.env.OPENAI_GPT54_MODEL?.trim() || process.env.OPENAI_PLATFORM_IMAGE_TRANSLATION_MODEL?.trim() || "gpt-5.4";
  const gpt54MaxOut = Math.min(
    65_536,
    Math.max(4096, Number(process.env.GPT54_PLATFORM_IMAGE_TRANSLATION_MAX_TOKENS) || 16_384),
  );
  const taskChars = String(prompt || "").length;

  const gpt54SystemContent =
    translationProfile === "topic_cover"
      ? [
          GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
          "你是一位双语视觉编导：把上游任务收成 **一条** 可直接给 GPT-IMAGE-2 的 **英文** 生图指令（JSON 的 prompt 字段）。",
          "**优先** comma-separated tags / 短語；需要时用更长英文把版式、主体、简中标题要求说清楚。**不设字符上限**，以一次生图能忠实执行任务为第一优先级。",
          "版式信息（2×2、2×4、9:16 单封面等）必须与上游一致，不建議擅自改格数或把单封面写成多格，除非任务明确要求。",
          "须含 masterpiece 与 8k；情绪、灯光、场景、主体与服饰、标题语言（简中大字等）按需写入。",
          "**選題豎封必達：** 英文 prompt **必須**寫明畫內 **2～4 個** 線稿小圖標 + 各 **短簡中輔標**，圖標須**生動對齊** Hook 與正文要點；並寫清 **美觀排版**（主從·留白·對齊）與 **強縮略圖衝擊力**（對比·光型·色面）；**不建議**僅有大字或略去圖標層。",
          "**場景：** **建議**封面與文案場景多元化；**室內、戶外**皆可作參考。**不建議**無正文依據時過度集中在書房、書桌、書架牆或**典型客廳、沙發電視牆**；英文須寫出與 Hook 匹配的**具體場所或置景**（街景自然、公共／醫療／工業室內、棚拍色片等）。",
          PLATFORM_COVER_SCENE_VERSATILITY_EN,
          "请返回合法 JSON：{\"prompt\":\"...\"}；不建議附加解釋、不建議使用 markdown。",
          "若上游是封面/科普而正文未出现食物，**可不必**以廚房、食譜表、食材格為主場景。",
        ].join("\n")
      : [
          PLATFORM_IMAGE_TRANSLATOR_BASE_EN,
          "你是一位双语视觉编导：**上游中文僅作參照**；把任务收成 **一条** 可直接给 GPT-IMAGE-2 的 **英文** 生图指令（JSON 的 prompt 字段）。",
          "**优先** comma-separated tags / 短語；需要时用 **编号短句** 把版式、主体、光型、留白、简中标题规格写清。**不设字符上限**，以一次生图能忠实执行 GPT-Image-2 为第一优先级。",
          "OpenAI **`model`** 對應名稱或为 **gpt‑5.4、gpt‑5.5** 等—只影響 API 調用標識與環境設定；**宽幅網格／分鏡**之身分與版式規格必須與 Vertex（Gemini **3 Flash**）及 GPT 盡後 **Gemini 3 Flash Preview 兜底** **完全一致**，見常量 **PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN**。",
          PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN,
          "**2×4 分镜主表**（若上游为分镜表）：英文 **prompt** 须明确版式 — **全表最上一行通栏**仅 **全文内容总结**（整片梗概作主主题，可带「· 分镜脚本」等后缀）；**不建議**把各镜的「分镜主题」写进该顶栏。**每格**自上而下：**分镜主题描述**（该格简中一句）→ 主画面静帧 → 底部简中四列表格，列标题固定为 **景别**、**运镜**、**画面内容**、**台词与音效**。其余画面与光影用英文写清即可。",
          "**分镜主表审美（软提示，非硬性）：** 可在英文中**顺带**写清整表气质统一；底部四栏说明区**宜**与画面融合（浅衬、纸感、柔和分隔等），**减少**习惯性「纯黑底 + 刺目白字」的技术说明条的观感——**若**与可读或剧情冲突则不必坚持。",
          "版式轨道（2×2、2×4、9:16 单封面等）须与上游一致，不建議擅自改格数或把单封面写成多格，除非任务明确要求；若有更生动的等价表达且不改变格数/竖横意图，可自行发挥。",
          "须含 masterpiece 与 8k；情绪、灯光、场景、主体与服饰、标题语言（简中大字等）按需写入。",
          "**莎剧式文采**仅在版面与光学已写死后可少量点缀。",
          "请返回合法 JSON：{\"prompt\":\"...\"}；不建議附加解釋、不建議使用 markdown。",
        ].join("\n");

  const runGpt54 = async (
    attempt: number,
  ): Promise<{ out: string; emptyReasonLine: string | null }> => {
    const a = `第${attempt}/3轮`;
    appendGpt54TranslationDebug(
      flowLog,
      `${a} · 请求前 · invokeLLM(openai/gpt54) · modelName=${modelName} · max_tokens=${gpt54MaxOut} · response_format=json_object · 上游 task 约 ${taskChars} 字`,
    );
    const primaryResponse = await invokeLLM({
      provider: "openai",
      model: "gpt54",
      modelName,
      response_format: { type: "json_object" },
      max_tokens: gpt54MaxOut,
      messages: [
        {
          role: "system",
          content: gpt54SystemContent,
        },
        {
          role: "user",
          content: `请返回 JSON：{"prompt":"..."}。\n${prompt}`,
        },
      ],
    });

    const choicesLen = primaryResponse.choices?.length ?? 0;
    const choice0 = primaryResponse.choices?.[0];
    const finishReason = choice0?.finish_reason ?? null;
    const usage = primaryResponse.usage;
    const usageLine = usage
      ? `prompt_tokens=${usage.prompt_tokens} · completion_tokens=${usage.completion_tokens} · total_tokens=${usage.total_tokens}`
      : "无 usage";

    appendGpt54TranslationDebug(
      flowLog,
      `${a} · 响应元数据 · choices.length=${choicesLen} · response.id=${String(primaryResponse.id || "").slice(0, 36)} · response.model=${primaryResponse.model ?? "n/a"} · finish_reason=${finishReason ?? "n/a"} · ${usageLine}`,
    );

    const contentRaw = choice0?.message?.content;
    const contentKind = contentRaw == null ? "missing" : typeof contentRaw === "string" ? "string" : Array.isArray(contentRaw) ? `array(${contentRaw.length})` : typeof contentRaw;
    const rawBody = assistantMessageContentToPlainText(
      contentRaw as string | Array<{ type?: string; text?: string }> | undefined,
    );
    const raw = rawBody.trim();
    const preview = raw
      ? raw.replace(/\s+/g, " ").slice(0, 320)
      : "";
    appendGpt54TranslationDebug(
      flowLog,
      `${a} · message.content · kind=${contentKind} · trim 后长度=${raw.length}${preview ? ` · 头 320 字: ${preview}${raw.length > 320 ? "…" : ""}` : " · (无正文，故无法解析 prompt)"}`,
    );

    let parsed: Record<string, unknown> | null = null;
    let extractedForParse = "";
    if (raw) {
      try {
        extractedForParse = extractJsonString(raw);
        appendGpt54TranslationDebug(
          flowLog,
          `${a} · extractJsonString · 长度=${extractedForParse.length} · 头 200 字: ${extractedForParse.replace(/\s+/g, " ").slice(0, 200)}${extractedForParse.length > 200 ? "…" : ""}`,
        );
        parsed = JSON.parse(extractedForParse) as Record<string, unknown>;
        appendGpt54TranslationDebug(
          flowLog,
          `${a} · JSON.parse → 成功 · 顶层键=${parsed ? Object.keys(parsed).join(", ") : ""}`,
        );
      } catch (parseErr: unknown) {
        appendGpt54TranslationDebug(flowLog, `${a} · JSON.parse → 失败 · ${formatErrForVertexDebug(parseErr)}`);
        parsed = null;
      }
    } else {
      appendGpt54TranslationDebug(flowLog, `${a} · 跳过 JSON：正文为空`);
    }

    const fromPrompt = String(parsed?.prompt ?? "").trim();
    const out = String(parsed?.prompt || raw).trim();

    appendGpt54TranslationDebug(
      flowLog,
      `${a} · 汇总 · prompt 字段 trim 长度=${fromPrompt.length} · String(parsed?.prompt||raw).trim 长度=${out.length} · 判定: ${out ? "本轮有非空输出（可进入 stripGeminiModelOutput）" : "本轮无有效输出 → 将计为无效并重试或走 fallback"}`,
    );

    const completionTok = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null;
    const promptTok = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null;
    emitPlatformImagePipelineStat({
      event: "gpt54_platform_image_translate",
      pipeline: statCtx?.pipeline ?? "other",
      sheetKind: statCtx?.sheetKind ?? null,
      compositeSheetAttempt: statCtx?.compositeSheetAttempt ?? null,
      compositeSheetMaxAttempts: statCtx?.compositeSheetMaxAttempts ?? null,
      gpt54RoundOf3: attempt,
      modelName,
      finishReason: finishReason ?? null,
      maxTokensConfigured: gpt54MaxOut,
      promptCharsUpstream: taskChars,
      promptTokens: promptTok,
      completionTokens: completionTok,
      tokenPressureApprox:
        completionTok != null && gpt54MaxOut > 0 ? Math.round((completionTok / gpt54MaxOut) * 1000) / 1000 : null,
      hasValidEnglishPrompt: out.length > 0,
      rawContentChars: raw.length,
    });

    if (!out) {
      const fr = finishReason ?? "n/a";
      let why: string;
      if (choicesLen === 0) why = `choices 为空 · finish_reason=${fr}`;
      else if (raw.length === 0)
        why = `message.content 为空 · content.kind=${contentKind} · finish_reason=${fr}`;
      else if (!parsed) why = `JSON 解析失败或非对象 · 正文长度=${raw.length} · finish_reason=${fr}`;
      else if (fromPrompt.length === 0) why = `JSON 内 prompt 为空或仅空白 · finish_reason=${fr}`;
      else why = `合并后仍为空 · finish_reason=${fr}`;
      const oneLine = `[GPT54·崩溃原因] ${a} · ${why}`;
      appendGpt54TranslationDebug(flowLog, oneLine);
      return { out: "", emptyReasonLine: `${a} · ${why}` };
    }

    return { out, emptyReasonLine: null };
  };

  let lastFailure: unknown = null;
  let lastGptCrashReason = "";

  for (let i = 0; i < 3; i++) {
    if (i === 1) {
      appendGpt54TranslationDebug(flowLog, "[GPT54·翻译] 第 1 次无效，等待 3000ms 后第 2 次…");
      await new Promise((r) => setTimeout(r, 3000));
    } else if (i === 2) {
      appendGpt54TranslationDebug(flowLog, "[GPT54·翻译] 第 2 次仍无效，等待 6000ms 后第 3 次…");
      await new Promise((r) => setTimeout(r, 6000));
    }

    try {
      const { out, emptyReasonLine } = await runGpt54(i + 1);
      if (out) {
        if (i > 0) {
          appendGpt54TranslationDebug(flowLog, `[GPT54·翻译] 第 ${i + 1} 次重试成功 · 约 ${out.length} 字符`);
        }
        return out;
      }
      lastFailure = new Error(emptyReasonLine || "GPT54 无输出");
      if (emptyReasonLine) lastGptCrashReason = emptyReasonLine;
      appendGpt54TranslationDebug(flowLog, `[GPT54·翻译] 第 ${i + 1}/3 次无效`);
    } catch (e: unknown) {
      lastFailure = e;
      const em = e instanceof Error ? e.message : String(e);
      lastGptCrashReason = `第${i + 1}/3轮 · 请求异常 · ${em}`;
      appendGpt54TranslationDebug(flowLog, `[GPT54·崩溃原因] ${lastGptCrashReason}`);
      appendGpt54TranslationDebug(flowLog, `[GPT54·翻译] 第 ${i + 1}/3 次异常 · ${formatErrForVertexDebug(e)}`);
    }
  }

  const summary =
    lastGptCrashReason.trim() || formatErrForVertexDebug(lastFailure);
  appendGpt54TranslationDebug(flowLog, `[GPT54·崩溃原因·汇总] 三轮均无可用英文 · ${summary}`);

  appendGpt54TranslationDebug(
    flowLog,
    skipVertexFallback
      ? `[GPT54·翻译] 已 3 次仍失败或为空 · skipVertex 模式 · 不发 Vertex`
      : `[GPT54·翻译] 已 3 次仍失败或为空 → fallback Vertex Gemini 3 Flash Preview（${resolveVertexFlashTranslationModelName()} · ${resolveVertexFlashTranslationLocation()}）· 最后 GPT: ${formatErrForVertexDebug(lastFailure)}`,
  );
  if (isPlatformWeekendGcpEscape()) {
    appendGpt54TranslationDebug(
      flowLog,
      `[GCP避險] GPT 三輪無可用英文 · 跳過 Vertex · 終止（見 PLATFORM_WEEKEND_GCP_ESCAPE）· ${summary.slice(0, 400)}`,
    );
    throw new Error(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
  }
  if (compositeTranslationStrict && !skipVertexFallback) {
    appendGpt54TranslationDebug(
      flowLog,
      `[GPT54·翻译] compositeTranslationStrict · GPT 三輪無效 · 不發 Vertex · ${PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}`,
    );
    throw new Error(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
  }
  if (skipVertexFallback) {
    appendGpt54TranslationDebug(
      flowLog,
      `[GPT54·翻译] Flash→GPT 兜底仍無可用英文 · ${summary.slice(0, 400)} · ${PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}`,
    );
    console.error("[平台英文化] Vertex Flash 三輪後 GPT 5.4 仍三輪无效 ·", summary.slice(0, 500));
    throw new Error(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
  }
  try {
    return await callVertexGeminiFlashTranslationAfterGptTripleFail(prompt, flowLog, translationProfile);
  } catch (vertexErr: unknown) {
    const vDetail = formatErrForVertexDebug(vertexErr);
    const vr = `${resolveVertexFlashTranslationModelName()} · ${resolveVertexFlashTranslationLocation()}`;
    appendGpt54TranslationDebug(flowLog, `[Vertex·Flash·GPT後兜底] 調用失敗 · ${vr} · ${vDetail}`);
    console.error(
      "[平台英文化] OpenAI 三輪後 Vertex Gemini 3 Flash Preview 兜底失敗:",
      vertexErr instanceof Error ? vertexErr.message : vertexErr,
    );
    appendGpt54TranslationDebug(
      flowLog,
      `[Vertex·Flash·GPT後兜底失敗]（${vr}）· GPT 摘要: ${summary.slice(0, 400)} · ${PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}`,
    );
    throw new Error(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
  }
}

/**
 * **套裝 job**：同一選題下 **一次** OpenAI JSON 產出 **豎版封面** + **2×4 橫幅** 兩條英文生圖 prompt。
 * 語義是「一組圖、兩張輸出」，**不建議**把兩則無關選題合併；與已移除的「雙條 DR-Pro」不同。
 * 僅走 GPT 5.4（與封面單幀路徑一致）；失敗由調用方改 **串行**兩次英文化。
 */
export async function translateBundleCoverAndCompositeEnglishPair(options: {
  coverTranslationTask: string;
  compositeTranslationTask: string;
  flowLog?: string[];
}): Promise<{ coverEn: string; compositeEn: string }> {
  if (!isPlatformImageOpenAiAllowed()) {
    throw new Error(
      "套裝併翻目前僅實作 OpenAI 單次 JSON；已關閉（設 PLATFORM_IMAGE_ALLOW_OPENAI=1）。请改用串行 cover 与 2×4 英文化。",
    );
  }
  const flowLog = options.flowLog;
  const coverChars = String(options.coverTranslationTask || "").length;
  const compChars = String(options.compositeTranslationTask || "").length;
  appendGpt54TranslationDebug(
    flowLog,
    `[套裝·併翻] 單次 GPT 5.4 · PART_A 封面≈${coverChars} 字 · PART_B 2×4≈${compChars} 字 · JSON {cover_prompt, composite_prompt}`,
  );

  const modelName =
    process.env.OPENAI_GPT54_MODEL?.trim() || process.env.OPENAI_PLATFORM_IMAGE_TRANSLATION_MODEL?.trim() || "gpt-5.4";
  const gpt54MaxOut = Math.min(
    65_536,
    Math.max(4096, Number(process.env.GPT54_PLATFORM_IMAGE_TRANSLATION_MAX_TOKENS) || 16_384),
  );

  const userBody = `同一選題、兩個生圖交付物（不建議當成兩則無關選題）。

=== PART_A — 9:16 豎版封面（GPT-IMAGE-2 單主視覺）===
${options.coverTranslationTask}

=== PART_B — 16:9 橫幅 2×4 格主表或八格筆記（GPT-IMAGE-2）===
${options.compositeTranslationTask}

请只返回合法 JSON 对象，且必须同时包含非空字符串：
{"cover_prompt":"…","composite_prompt":"…"}`;

  const statCtx: Gpt54PlatformImagePromptStatCtx = { pipeline: "topic_cover_composite_bundle" };

  const runAttempt = async (
    attempt: number,
  ): Promise<{ coverEn: string; compositeEn: string } | null> => {
    const a = `第${attempt}/3轮·套裝併翻`;
    appendGpt54TranslationDebug(
      flowLog,
      `${a} · invokeLLM · modelName=${modelName} · max_tokens=${gpt54MaxOut} · json cover_prompt+composite_prompt`,
    );
    const primaryResponse = await invokeLLM({
      provider: "openai",
      model: "gpt54",
      modelName,
      response_format: { type: "json_object" },
      max_tokens: gpt54MaxOut,
      messages: [
        {
          role: "system",
          content: [
            PLATFORM_IMAGE_TRANSLATOR_BASE_EN,
            GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
            "你是双语视觉编导：上游 **PART_A + PART_B** 描述 **同一套** 內容企劃的兩個像素交付物（豎封面 + 橫幅整表），**不是**兩個獨立選題。",
            "把 PART_A 收成 **cover_prompt**：只服務 **9:16** 單幀封面；口吻與 **選題單封** 一致——優先忠實還原 brief、tags／名詞組、篇幅不限，可融入情緒與文化／人文語境；**不建議**把 PART_B 的 **2×4 網格硬性 checklist** 或分鏡表條款硬套進單封。",
            "把 PART_B 收成 **composite_prompt**：只服務 **16:9** **2×4** 整表；格線/頂欄/分鏡表格欄位等規格與既有 **分鏡主表 / 小紅書八格** 英文化一致（可執行、英文為主、簡中字由英文指令約束）。",
            "**儘量避免**把兩個不同話題硬湊成一組；若上游混了兩題，仍以 PART 標籤為準各自忠实執行，但正常輸入應為同一選題。",
            "须含 masterpiece 与 8k（按需写入两条之一或两条）。",
            "**仅**返回 JSON：{\"cover_prompt\":\"...\",\"composite_prompt\":\"...\"}；不建議使用 markdown、不建議附加解釋。",
            PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN,
            "**PART_B · 2×4 分镜主表**（若 B 為分镜表）：composite_prompt 须明确版式 — **全表最上一行通栏**仅 **全文内容总结**；**每格**：分镜主题 → 静帧 → 底部简中四列表（景别、运镜、画面内容、台词与音效）。",
            "**PART_B · 小红书八格**：composite_prompt 须保持 **2 行×4 列** 八格可读节奏，逗號短語優先。",
          ].join("\n"),
        },
        { role: "user", content: userBody },
      ],
    });

    const choice0 = primaryResponse.choices?.[0];
    const finishReason = choice0?.finish_reason ?? null;
    const usage = primaryResponse.usage;
    const contentRaw = choice0?.message?.content;
    const rawBody = assistantMessageContentToPlainText(
      contentRaw as string | Array<{ type?: string; text?: string }> | undefined,
    );
    const raw = rawBody.trim();

    appendGpt54TranslationDebug(
      flowLog,
      `${a} · finish_reason=${finishReason ?? "n/a"} · content.len=${raw.length}`,
    );

    let parsed: Record<string, unknown> | null = null;
    if (raw) {
      try {
        parsed = JSON.parse(extractJsonString(raw)) as Record<string, unknown>;
      } catch (e) {
        appendGpt54TranslationDebug(flowLog, `${a} · JSON.parse 失败 · ${formatErrForVertexDebug(e)}`);
        parsed = null;
      }
    }

    const coverEn = String(parsed?.cover_prompt ?? "").trim();
    const compositeEn = String(parsed?.composite_prompt ?? "").trim();

    const completionTok = typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null;
    const promptTok = typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null;
    emitPlatformImagePipelineStat({
      event: "gpt54_platform_image_translate",
      pipeline: statCtx.pipeline,
      sheetKind: null,
      compositeSheetAttempt: null,
      compositeSheetMaxAttempts: null,
      gpt54RoundOf3: attempt,
      modelName,
      finishReason: finishReason ?? null,
      maxTokensConfigured: gpt54MaxOut,
      promptCharsUpstream: coverChars + compChars,
      promptTokens: promptTok,
      completionTokens: completionTok,
      tokenPressureApprox:
        completionTok != null && gpt54MaxOut > 0 ? Math.round((completionTok / gpt54MaxOut) * 1000) / 1000 : null,
      hasValidEnglishPrompt: coverEn.length > 0 && compositeEn.length > 0,
      rawContentChars: raw.length,
    });

    if (!coverEn || !compositeEn) {
      appendGpt54TranslationDebug(
        flowLog,
        `${a} · 无效：cover_prompt=${coverEn.length} · composite_prompt=${compositeEn.length}`,
      );
      return null;
    }
    appendGpt54TranslationDebug(
      flowLog,
      `${a} · 成功 · cover≈${coverEn.length} · composite≈${compositeEn.length}`,
    );
    return { coverEn, compositeEn };
  };

  for (let i = 0; i < 3; i++) {
    if (i === 1) {
      appendGpt54TranslationDebug(flowLog, "[套裝·併翻] 第 1 次无效，等待 3000ms…");
      await new Promise((r) => setTimeout(r, 3000));
    } else if (i === 2) {
      appendGpt54TranslationDebug(flowLog, "[套裝·併翻] 第 2 次仍无效，等待 6000ms…");
      await new Promise((r) => setTimeout(r, 6000));
    }
    const pair = await runAttempt(i + 1);
    if (pair) return pair;
  }

  appendGpt54TranslationDebug(flowLog, "[套裝·併翻] 已 3 次仍無雙欄有效英文 · 請改串行");
  throw new Error("套裝併翻失败：GPT 5.4 未同时返回有效 cover_prompt 与 composite_prompt");
}

/**
 * 平台 **選題單幀**：預設 **GPT 5.4**（`OPENAI_PLATFORM_IMAGE_TRANSLATION_MODEL` 可為 **gpt‑5.5**）；選 **Vertex 探索** 時先 **Flash**（{@link callVertexGeminiFlashTranslation}，三輪後同上 OpenAI 鏈）；**OpenAI 三輪殆盡後**改 **Vertex Gemini 3 Flash Preview** 再試三輪（同源 JSON **`prompt`**，不再呼叫 3.1 Pro）。
 * **選題信息流單封**之 **編導身分與規格** 見 {@link PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN}，**Flash / GPT‑5.4／5.5 / Flash 兜底 三軌同源**。
 * **分鏡主表 / 小紅書八格** 英文化見 {@link translatePlatformCompositeToEnglishPrompt}（預設 Flash→GPT，雙軌失敗拋 {@link PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}）。
 * 戰略封面 / 章節扉頁仍走 `runGemini31ProPreviewText` → Vertex（見 `buildStrategicCoverGeminiTask`）。
 */
export async function callGemini31ProForImagePrompt(
  translationTask: string,
  options?: {
    translator?: PlatformImagePromptTranslator;
    flowLog?: string[];
    pipelineStatCtx?: Gpt54PlatformImagePromptStatCtx;
  },
): Promise<string> {
  const requested: PlatformImagePromptTranslator = options?.translator ?? "gpt54";
  const billingEscape = isPlatformWeekendGcpEscape();
  const translator: PlatformImagePromptTranslator = billingEscape ? "gpt54" : requested;
  const flowLog = options?.flowLog;
  if (billingEscape && requested === "vertex_gemini_3_flash_preview") {
    appendGpt54TranslationDebug(
      flowLog,
      "[GCP避險] 英文化已從 Vertex 探索強制改為 GPT 5.4 路徑（避免調用 Vertex Flash）",
    );
  }
  const vertexModel = resolveVertexFlashTranslationModelName();
  const vertexLoc = resolveVertexFlashTranslationLocation();
  const label =
    translator === "vertex_gemini_3_flash_preview"
      ? `Vertex @google/genai · ${vertexModel} · ${vertexLoc}（JSON）`
      : "GPT 5.4（OpenAI）";
  try {
    const statCtx = options?.pipelineStatCtx;
    const raw =
      translator === "vertex_gemini_3_flash_preview"
        ? await callVertexGemini31ProForImagePrompt(translationTask, flowLog, { pipelineStatCtx: statCtx })
        : await callGemini3_1_Pro_AiStudio(translationTask, flowLog, statCtx);
    const out = stripGeminiModelOutput(raw);
    if (!out) {
      appendGpt54TranslationDebug(flowLog, `[GPT54·崩溃原因] stripGeminiModelOutput 后为空 · label=${label}`);
      throw new Error("[GPT54·崩溃原因] strip 后为空");
    }
    return out;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const logLine = `callGemini31ProForImagePrompt 抛出 · ${label} · ${formatErrForVertexDebug(error)}`;
    if (translator === "gpt54") appendGpt54TranslationDebug(flowLog, logLine);
    else appendVertexFlashDebug(flowLog, logLine);
    // 複合錯誤（GPT 三輪無效 + Vertex 404 等）已在 callGemini3_1_Pro_AiStudio 排好順序，不建議再冠以「Vertex 翻译崩溃」誤導前綴
    if (message.startsWith("【GPT54 已三輪無效】")) {
      throw new Error(`[平台英文化链失败]\n${message}`);
    }
    const vertexFallback =
      message.includes("[Vertex Flash 英文化·GPT 已盡力]") ||
      message.includes("── Vertex API 詳情 ──") ||
      message.includes("[Vertex 英文化失败]") ||
      message.includes("[GPT54·崩溃原因·汇总]") ||
      message.includes("Gemini 3 Flash Preview 兜底") ||
      message.includes("[Vertex·Flash·GPT後兜底") ||
      message.includes("[Vertex 翻译失败]");
    const looksLikeVertexApi =
      /publishers\/google\/models|NOT_FOUND|PERMISSION_DENIED|ResourceExhausted|GoogleGenerativeAIError|Vertex AI|vertexai/i.test(
        message,
      );
    const flashRoute = `${resolveVertexFlashTranslationModelName()} · ${resolveVertexFlashTranslationLocation()}`;
    const displayLabel =
      vertexFallback || (looksLikeVertexApi && translator === "gpt54")
        ? `Vertex Gemini 3 Flash Preview（${flashRoute}）`
        : label;
    throw new Error(`[${displayLabel} 翻译崩溃]: ${message}`);
  }
}

export async function translatePlatformCompositeToEnglishPrompt(options: {
  kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note";
  scriptContext: string;
  /** 保留相容；分鏡/八格 **預設** 已改為 Vertex **Gemini 3 Flash** 三輪 → **GPT 5.4** 三輪；僅 `engine=gpt54` 時強制先 GPT */
  translator?: PlatformImagePromptTranslator;
  /** A/B：`gemini31flash` 強制走 Flash Live（預設 global，見 `resolveVertexFlashTranslationLocation`）；`gpt54` 強制 GPT 5.4 */
  engine?: "gpt54" | "gemini31flash";
  /** 寬幅合成 / debug：寫入 imageGenFlowLog */
  flowLog?: string[];
  /** 供 {@link emitPlatformImagePipelineStat}：整鏈第幾次、上限（對應 2×4 日誌「第 k/N 次尝试」） */
  compositeSheetAttempt?: number;
  compositeSheetMaxAttempts?: number;
  /**
   * 異步 platform job id：英文化前把中文編導 task 暫存進 Neon `jobs.output.chineseStaging`（結案時會剝除）。
   */
  neonProgressJobId?: string | null;
}): Promise<string> {
  const flowLog = options.flowLog;
  const kind = normalizeCompositeSheetKind(options.kind);
  const compositeStatCtx: Gpt54PlatformImagePromptStatCtx | undefined =
    typeof options.compositeSheetAttempt === "number" &&
    typeof options.compositeSheetMaxAttempts === "number" &&
    Number.isFinite(options.compositeSheetAttempt) &&
    Number.isFinite(options.compositeSheetMaxAttempts) &&
    options.compositeSheetAttempt >= 1
      ? {
          pipeline: "composite_sheet",
          sheetKind: kind,
          compositeSheetAttempt: Math.floor(options.compositeSheetAttempt),
          compositeSheetMaxAttempts: Math.floor(options.compositeSheetMaxAttempts),
        }
      : undefined;
  const gptImgBridgeOpts = (translator: PlatformImagePromptTranslator): {
    translator: PlatformImagePromptTranslator;
    flowLog?: string[];
    pipelineStatCtx?: Gpt54PlatformImagePromptStatCtx;
  } => ({
    translator,
    flowLog,
    pipelineStatCtx: compositeStatCtx,
  });
  const compositeFlashOpts = {
    compositeTranslationStrict: true as const,
    pipelineStatCtx: compositeStatCtx,
  };
  const isStoryboard = kind === "storyboard_sheet_landscape";
  appendVertexFlashDebug(
    flowLog,
    `translatePlatformComposite · kind=${options.kind}${options.kind !== kind ? `→${kind}` : ""} · translator=${options.translator ?? "(未指定)"} · engine=${options.engine ?? "n/a"}`,
  );
  const chineseBrief = await extractChineseVisualBrief(options.scriptContext, flowLog);
  const task = isStoryboard
    ? buildVideoStoryboardGeminiPrompt(chineseBrief || options.scriptContext)
    : buildXhsNoteGeminiPrompt(chineseBrief || options.scriptContext);
  appendVertexFlashDebug(flowLog, `已組裝 ${isStoryboard ? "buildVideoStoryboard" : "buildXhsNote"} task · 約 ${task.length} 字`);

  logSheetChineseStagingBeforeTranslate(
    flowLog,
    kind,
    String(options.scriptContext || "").length,
    task.length,
  );
  await persistSheetChineseStagingToRunningJob(options.neonProgressJobId ?? null, {
    compositeKind: kind,
    compositeTaskZh: task,
    scriptContextChars: String(options.scriptContext || "").length,
  });

  if (isPlatformWeekendSurvivalModeEnabled()) {
    if (!isPlatformImageOpenAiAllowed()) {
      appendVertexFlashDebug(
        flowLog,
        "[生存模式] OpenAI 未啟用 · 改 Vertex Flash ×3 · compositeTranslationStrict",
      );
      return callVertexGeminiFlashTranslation(task, flowLog, {
        ...compositeFlashOpts,
        afterFlashFailure: "throw",
      });
    }
    appendVertexFlashDebug(
      flowLog,
      "[生存模式] 強制 OpenAI 英文化鏈（忽略 engine / translator 選項）· compositeTranslationStrict",
    );
    try {
      const raw = await callGemini3_1_Pro_AiStudio(task, flowLog, compositeStatCtx, {
        compositeTranslationStrict: true,
      });
      const out = stripGeminiModelOutput(raw);
      if (!out) {
        appendGpt54TranslationDebug(
          flowLog,
          "[GPT54·崩溃原因] stripGeminiModelOutput 后为空 · survival+composite strict",
        );
        throw new Error(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
      }
      return out;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      if (message === PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE) throw error;
      appendVertexFlashDebug(flowLog, `translatePlatformComposite survival 抛出 · ${formatErrForVertexDebug(error)}`);
      throw new Error(`[GPT 5.4（OpenAI） 翻译崩溃]: ${message}`);
    }
  }

  if (options.engine === "gemini31flash") {
    if (isPlatformWeekendGcpEscape()) {
      if (!isPlatformImageOpenAiAllowed()) {
        appendVertexFlashDebug(
          flowLog,
          "[GCP避險] OpenAI 未啟用 · engine=gemini31flash 仍走 Vertex Flash",
        );
        return callVertexGeminiFlashTranslation(task, flowLog, {
          ...compositeFlashOpts,
          afterFlashFailure: "throw",
        });
      }
      appendVertexFlashDebug(
        flowLog,
        "[GCP避險] engine=gemini31flash 已改走 GPT 5.4（跳过 Vertex Flash）",
      );
      return callGemini31ProForImagePrompt(task, gptImgBridgeOpts("gpt54"));
    }
    console.log(
      `[platformComposite] engine=gemini31flash → Vertex ${resolveVertexFlashTranslationModelName()} · ${resolveVertexFlashTranslationLocation()}`,
    );
    return callVertexGeminiFlashTranslation(task, flowLog, compositeFlashOpts);
  }
  if (options.engine === "gpt54") {
    console.log("[platformComposite] engine=gpt54 → GPT 5.4");
    return callGemini31ProForImagePrompt(task, gptImgBridgeOpts("gpt54"));
  }

  if (options.translator === "gpt54") {
    appendVertexFlashDebug(flowLog, "[相容] translator=gpt54 → 先 GPT 5.4 英文化（非預設路徑）");
    return callGemini31ProForImagePrompt(task, gptImgBridgeOpts("gpt54"));
  }

  appendVertexFlashDebug(flowLog, "[預設] Vertex Gemini 3 Flash ×3 → GPT 5.4 ×3 · compositeTranslationStrict");
  return callVertexGeminiFlashTranslation(task, flowLog, compositeFlashOpts);
}
