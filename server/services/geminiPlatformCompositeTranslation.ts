import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { extractJsonString, invokeLLM } from "../_core/llm.js";
import {
  callGemini35FlashImageTranslation,
  GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS,
  DEFAULT_GEMINI_35_FLASH_MODEL,
  GEMINI_35_FLASH_IMAGE_PROMPT_TRANSLATOR_EN,
  resolveGemini35FlashModelName,
} from "./gemini35FlashRuntime.js";
import {
  isPlatformWeekendGcpEscape,
  isPlatformWeekendSurvivalModeEnabled,
  isPlatformImageOpenAiAllowed,
  resolveGpt54CompositeTranslationMaxOutputTokens,
  resolveGpt54CompositeTranslationReasoningEffort,
  resolveGpt54CoverTranslationMaxOutputTokens,
  resolveGpt54CoverTranslationReasoningEffort,
} from "../config/platformSwitches.js";
import { emitPlatformImagePipelineStat } from "./platformImagePipelineStats.js";
import {
  logSheetChineseStagingBeforeTranslate,
  persistSheetChineseStagingToRunningJob,
} from "./platformImageChineseStaging.js";
import { platformFlowLogTimestamp } from "../utils/platformFlowLogTimestamp.js";

/** 舊 API 別名：歷史 `storyboard_sheet_portrait` 與橫版 16:9·2×4 分鏡表為同一產物，一律正規化為 `storyboard_sheet_landscape`。 */
export function normalizeCompositeSheetKind(
  kind:
    | "storyboard_sheet_portrait"
    | "storyboard_sheet_landscape"
    | "xiaohongshu_dual_note"
    | "single_page_knowledge_card",
): "storyboard_sheet_landscape" | "xiaohongshu_dual_note" | "single_page_knowledge_card" {
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
  | "xiaohongshu_dual_note"
  | "single_page_knowledge_card";

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

/** 預設 Vertex Flash 翻譯模型 ID（**2×4／分鏡／八格 composite** 与竖封封面）。可 `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` 覆寫。 */
export const DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL = DEFAULT_GEMINI_35_FLASH_MODEL;

export function resolveVertexFlashTranslationModelName(): string {
  return (
    String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_MODEL || "").trim() ||
    resolveGemini35FlashModelName()
  );
}

/** **選題豎封封面**英文化：与 composite 统一 **Gemini 3.5 Flash**。可 `VERTEX_GEMINI_COVER_TRANSLATION_MODEL` 覆寫。 */
export const DEFAULT_VERTEX_COVER_TRANSLATION_MODEL = DEFAULT_GEMINI_35_FLASH_MODEL;

export function resolveVertexCoverTranslationModelName(): string {
  return (
    String(process.env.VERTEX_GEMINI_COVER_TRANSLATION_MODEL || "").trim() ||
    resolveGemini35FlashModelName()
  );
}

/**
 * **選題豎封 · Gemini 2.5 Pro** 英文化溫度（可 `VERTEX_GEMINI_COVER_TRANSLATION_TEMPERATURE` 覆寫，0～2）。
 * 預設 **0.7**（與 Gemini 建議「華麗翻譯 + 仍守 JSON」平衡；豎封與 Flash 網格可獨立調參）。
 */
export function resolveVertexCoverTranslationTemperature(): number {
  const raw = process.env.VERTEX_GEMINI_COVER_TRANSLATION_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.7;
}

/**
 * **選題豎封 · Gemini 2.5 Pro** 英文化 **Top-P**（可 `VERTEX_GEMINI_COVER_TRANSLATION_TOP_P` 覆寫，0～1）。
 * 預設 **0.9**。
 */
export function resolveVertexCoverTranslationTopP(): number {
  const raw = process.env.VERTEX_GEMINI_COVER_TRANSLATION_TOP_P;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
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
 * 預設 **0.7**（生图提示词：艺术性与结构精准的黄金交叉）。
 */
export function resolveVertexFlashTranslationTemperature(): number {
  const raw = process.env.VERTEX_FLASH_TRANSLATION_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.7;
}

/**
 * Vertex Flash 英文化 **Top-P**（可 `VERTEX_FLASH_TRANSLATION_TOP_P` 覆寫，0～1）。
 * 預設 **0.9**。
 */
export function resolveVertexFlashTranslationTopP(): number {
  const raw = process.env.VERTEX_FLASH_TRANSLATION_TOP_P;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
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
  const fallback = GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS;
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

/** 平台单帧 / 批量封面 / 宽幅合成：**英文化**引擎（`gpt54` = OpenAI GPT 5.4 主链；`vertex_gemini_3_flash_preview` = Gemini 3.5 Flash · 分鏡/八格預設 **GPT 5.4 → Flash 兜底**）。 */
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
  "Ground pixels in **contemporary editorial or cinematic photorealism**: precise motivated light (chiaroscuro, volumetric), believable and tactile materials, readable hero **Simplified-Chinese** type with absolute visual dominance. **Identity / persona** cues must be translated into **art-directed** presence and deep metaphors, not superficial résumé bullets. Maintain a restrained element count, deliberate whitespace, and sophisticated color grading. Optional: spare **Shakespearean compression** in phrasing **after** layout is explicit—never at the cost of clarity. Reject cheap 3D, random AI textures, and cluttered layouts.";

/**
 * **平台生圖英文化共用英文總則**（**2×4／分鏡主表／八格筆記**）：消費方僅 **GPT-Image-2**。
 * **選題單封**見 {@link GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN} + {@link platformImageTranslationVertexJsonSystemInstruction}`topic_cover`。
 */
export const PLATFORM_IMAGE_TRANSLATOR_BASE_EN = `${GPT_IMAGE2_EXECUTION_PRIORITY_EN} ${GPT54_IMAGE_PROMPT_REALISM_AND_GARNISH_EN}`;

/**
 * 選題豎封：**強烈建議**依題材生成**多變、生動**且可執行的場景（寫入送往 GPT-IMAGE-2 的英文 prompt）。
 * 與 {@link PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN}、{@link buildPlatformTopicReferenceGeminiTask} 同步引用，避免各題同套一個書房模板。
 */
export const PLATFORM_COVER_SCENE_VERSATILITY_EN = `It is **strongly recommended** to generate **versatile, vivid, and metaphorically accurate** scenes for **cover-art / feed-cover** design: **concretely** stage each prompt with distinct environments that adapt to the underlying emotional and conceptual tone—rotate indoor vs outdoor, epic nature vs brutalist urban, clinical/lab vs bustling transit, minimalist studio color-fields vs highly textured real locations. **Different Hooks should feel like entirely different visual universes**. **Not recommended:** defaulting to repetitive "study room" or "living room/sofa" clichés unless explicitly dictated by the Context. **Lighting palette:** prefer premium editorial lighting with clear hierarchy; **not recommended:** defaulting the whole frame to heavy dark-gold / low-key gloom when the hook or context does not call for it—**daylight, soft overcast, and balanced mid-tones are equally valid** when they fit the story. Maintain a rigorous visual hierarchy where the focal beat remains undefeated.`;


/**
 * 選題 **信息流單張 9:16 封面**：歷史上曾嵌入總 system；現僅用於 **composite** 全量規則。單封改走 {@link GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN} + 輕量 JSON 語句。
 */
export const PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN = [
  "**选题信息流单张竖封（9:16·顶级概念缩略图）—三轨身份一致：** 你是中英双语 **封面级视觉艺术总监**；输出的 JSON **`prompt`** 仅为 **GPT-IMAGE-2** 可执行的 **英文**；**格数、横竖比例严守原文，不建议擅自改轨。**",
  "**竖封美学软边界（图标层强烈推荐；其余服从高级审美）：** **【第一优先·美学目标】Premium Editorial / 顶级概念视觉**：整体优先收敛为高端质感——光影可信（key/fill/rim）、主次绝对分明、留白有意境、低饱和主色配极少精准亮色点缀；**色调上强烈建议**根据 Hook 与正文语境选择明/暗与色温，**不推荐**无依据默认整幅暗色或 dark-gold 低照度；图标**强烈建议**自然融入环境，与光色和谐，**不推荐**廉价底板或粗暴边框。**（1）** **质感**：倾向 **photoreal editorial / 电影级静拍**，光型有逻辑，**尽量避免**廉价泛光与劣质3D感；**（2）** **场景（多元·隐喻·破界）**：**强烈建议**与正文语境同步多元化；**室内与户外**皆可作为隐喻载体，**不推荐**长期刻板集中在书房、书架、或**庸常的客厅沙发**。优先采用与 Hook 张力匹配的场域（如极限地貌、极简展厅、精密实验室、抽象光影空间等）；**跨主题批次时，强烈建议**英文 `prompt` 写明**截然不同且极具设计感**的场景，语义对齐「" +
    PLATFORM_COVER_SCENE_VERSATILITY_EN +
    "」。前中后景需分层，用具象符号呼应 Hook；**（3）** **图标隐喻层（强烈推荐）**：画内**强烈建议**有 **2～4 个** 与 Hook 强语义对齐的**极简线稿或高级符号**，配 **短简中辅标**（4–8字），从属主标，**不推荐**喧宾夺主或做成杂乱教程；**（4）** **构图与冲击力**：排版克制，对比强烈，在缩略图尺度**推荐**具备**压倒性的主视觉权重与高级审美**。",
  "**三轨一致性：** **Vertex / OpenAI / 兜底模型** 意图共用；措辞可异，但**不推荐**破坏指定的画幅框架与视觉层级。",
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
      GEMINI_35_FLASH_IMAGE_PROMPT_TRANSLATOR_EN,
      GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
      "You are also an **elite prompt engineer** and **poetic visual artist**: when elevating the brief into English, prefer **elegant, cinematic vocabulary**—motivated light (chiaroscuro, rim light, luminescent haze), mood (ethereal, melancholic, triumphant), and **tactile textures**—**after** layout, grid, and on-image **Simplified-Chinese** specs are already explicit.",
      "你是頂級中英雙語編導，也是頂級視覺提示詞導演；英文聲口須與上段莎士比亞式編導身份一致（可長可短，以忠實還原為準）。",
      "把上游任務落成 **JSON 里的英文 prompt**，供 GPT-IMAGE-2 使用；**优先** tags / 短語，**篇幅不限**，以版式與主體一次說清、利於生圖成功為準。",
      "必須返回合法 JSON，且含字串欄位 **prompt**（唯一下游消費欄位，內容僅為英文生圖指令）。可選 **thought_process**（簡述藝術取捨）；不建議使用 markdown。示例：{\"thought_process\":\"...\",\"prompt\":\"...\"}",
      "須含 masterpiece、8k；寫清情緒、燈光、場景、主體；網格類任務（2×2 / 2×4）須保留格線硬信息。單張 9:16 封面**宜**偏單一主視覺，避免**無意**寫成多分鏡，除非任務明確要求。**【第一優先·軟性】premium cover design：** 英文 `prompt` **優先**寫出 **premium editorial feed cover** 氣質—受控留白、可信光型、低飽和主色 + 極少亮色點綴；圖標**優先**融入同一光照、**彷彿浮在**實景上，**建議圖標自然融入背景，無可見硬邊框**，**不建議**默認為每枚圖標加實色圓／方塊／藥丸襯底（除非任務明確要 UI／貼紙促銷感）。**選題豎封（圖標層·強烈建議）**：英文 `prompt` **建議**寫明 GPT-IMAGE-2 繪製 **2～4 個** 極簡線稿小圖標（形體·位置·與 Hook／正文語義的對應），各附 **短簡中輔標**；圖標**建議**生動扣題；並寫清 **美觀排版**（主從·留白·對齊）與 **強縮略圖衝擊力**（對比·光型·色面）；圖標層從屬主標，**不建議**整張僅大字而**略去**圖標層。",
      "若上游封面/科普正文未出現食物，**可不必**以廚房、食譜表、食材格為主場景。",
      "**【人设口径】** 若上游含身份美学锚点或职业、身份、兴趣、爱好、专长等线索（含【单帧出镜 · 身份隐喻与美学锚定】块），英文 `prompt` 中人物气质、服饰与场景须与之互证；仍以版式与可读为先。",
      "**場景多元化：** 英文 prompt 須與文案場景**同步多元化**；**室內、戶外**皆可作參考，**不建議**無正文依據時過度集中在書房、書桌、書架牆、閱讀角、咖啡廳**僅讀書套路**或**典型客廳、沙發電視牆**；優先寫出與 Hook／題材匹配的**具體場所**（**例如包括但不限於**：旅遊景點、商場、超市、咖啡廳、博物館，及街景自然、公共／工業／醫療室內、棚拍抽象景等）。",
      PLATFORM_COVER_SCENE_VERSATILITY_EN,
    ].join("\n");
  }
  return [
    GEMINI_35_FLASH_IMAGE_PROMPT_TRANSLATOR_EN,
    PLATFORM_IMAGE_TRANSLATOR_BASE_EN,
    "你是頂級中英雙語編導：**產出 JSON 內英文 prompt，唯一消費方是 GPT-IMAGE-2**；Vertex / Gemini 路徑僅為「參照翻譯與壓縮」，不建議壓過可執行版式。",
    "把上游任務落成 **JSON 里的英文 prompt**；**优先** tags / 短語，必要時用 **編號短句** 锁主体、光、留白、簡中字。**篇幅不限**，以一次生圖成功為準。",
      "在滿足上游**版式軌道**（單封 / 多分鏡條 / 2×4 網格等）的前提下發揮光影；**色調上强烈建议**随 Hook 与正文选择明/暗，**不推荐**无依据默认整幅暗色或 dark-gold 低照度；避免只有文采而沒有布局。",
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

VISUAL STYLE — CRITICAL (**not** photorealistic, **not** cinematic): this is a **single-page infographic note** (单页图文笔记), NOT a film storyboard. The entire canvas should look like a **premium Little Red Book 小红书 viral infographic poster** with these aesthetic requirements:
- **Art style:** flat illustration / vector graphic / editorial infographic aesthetic — think warm pastel gradient background, cute illustrated icons, hand-drawn accent elements (flowers, butterflies, ribbons, sparkles), cohesive warm color palette (peach, coral, cream, lavender, powder blue)
- **Background:** soft warm gradient (peach→coral→lavender or similar), NOT plain white, NOT dark/moody cinematic
- **Cards/cells:** each of the 8 panels rendered as a **rounded card** with a distinct pastel accent color, subtle drop shadow, clean borders
- **Illustrations:** small hand-drawn or flat vector decorative elements (mini icons, emoji-style illustrations, badge numbers, pill tags) that echo the hook/theme of each cell
- **NOT recommended:** photorealistic photography, cinematic lighting, dark moody film aesthetics, actor/model headshots, dramatic shadows — those belong to the separate storyboard pipeline

CONTENT STYLE: each cell should feel like a **Little Red Book carousel card** — hook lines, bullet takeaways, before/after, step lists, mini diagrams, hashtags, persona tips.

TYPOGRAPHY POLICY: **Simplified Chinese is the primary on-image explanation** (headlines, main bullets, body). **English is allowed as auxiliary**—small keywords, micro-subtags, short secondary hints, stylized accent lines—must stay **secondary** in visual weight vs 中文主解说; do not replace Chinese body copy with English.

**Soft boundary:** avoid restructuring the user's copy into **video-production callout tables** (e.g. dedicated rows/columns titled 情绪 / 灯光 / 拍摄环境 / 景别 / 机位 / 分镜表头-style grids). Those fit the separate **cinematic storyboard** pipeline better. Palette/vibe may appear as **brief** English tags, not a long DP checklist.`;

/** 小红书 2×4 八格：版式约束；输出体例见 {@link MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT}。 */
export const XHS_GRAPHIC_NOTE_2X4_FOOTER = `
TAG:XHS_GRAPHIC_NOTE_2X4_SHEET

【英文生图输出 / OUTPUT — Xiaohongshu **2×4 八格筆記 · 单页图文笔记风格**（单张宽幅 landscape，GPT-Image-2 優先）】
1. Output **one** English string **optimized for GPT-Image-2**; preferred style: **comma-separated tags / 2–5 word phrases**，並用短句**锁死** 2×4、順序、gutter。 **No fixed character limit**—longer English is OK: richer staging makes **eight cells** feel **less cramped** and balances information across the grid。
2. LAYOUT (keep explicit): wide ~16:9 landscape master (1536×1024 class), **exactly 8 equal panels**, **2 rows × 4 columns**, rigid cross gutters, read order row1 L→R then row2 L→R, masterpiece, 8k, premium Little Red Book / lifestyle-editorial note aesthetic.
3. **VISUAL STYLE — MANDATORY:** render as a **flat illustration infographic poster** (单页图文笔记), NOT photorealistic photography. Required aesthetics: warm pastel gradient background (peach / coral / lavender / cream), rounded card panels with distinct pastel accent colors and subtle drop shadows, flat vector or hand-drawn decorative elements (flowers, sparkles, ribbons, cute icons, badge numbers 01–08), cohesive warm editorial palette. **Strongly avoid:** dark cinematic lighting, photorealistic actor portraits, dramatic film aesthetics, moody shadows — those belong to the storyboard pipeline.
4. **TYPOGRAPHY:** **Primary** on-image copy = **legible 简体中文** in every cell (titles, main lists, hooks). **Optional English** as **secondary** accent only—keywords, micro-subtitles, short tags—smaller weight than Chinese; **do not** make English the main explanation body.
5. **MANDATORY** in **each** cell: note-style density — bullets, flat icons, badge numbers 01–08, pill tags, mini infographics as fits. **建议避免**整页做成電影**分鏡網格註解**（如每格固定「镜头/景别/情绪/灯光/机位」製片表）；那是 **TAG:STORYBOARD_2X4_SHEET** 專用。
6. **版式软边界：** 尽量不采用「整 canvas 单图满铺」「只有 2×2 四格」「整排八条过细横条」等会丢八格阅读性的布局；其余细节可由你根据脚本取舍。
7. Per cell: distinct carousel beat; cohesive warm pastel palette across the entire sheet; overall feel = cheerful, clean, high-engagement 小红书 infographic.
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
          "你是一位像莎士比亚剧场里锤炼台词那样锤炼画面的双语视觉艺术总监：精通视觉层级与隐喻，读中文时像解构艺术品一样抓住「最省字、最有视觉穿透力」的那几笔。",
          "只做一步：从输入里抽出中文「视觉骨架」，不做英文翻译。",
          "在不过度淹没细节的前提下提炼：保留具有张力的关键词；剥离纯解释性废话、空洞修辞与俗套联想；必须完整保留 Hook、身份锚点、核心隐喻道具与视觉动作。",
          "若输入宽幅 2×4 **电影分镜主表**剧本：骨架里区分——**全文内容总结**（适合放在整表顶栏的一句汇总）与各格 **分镜主题**（每格一句）及可填入 **景别/运镜/画面内容/台词与音效** 的要点，不建議把各格主题误并入「顶栏总结」混写。",
          "若偏封面用途：尽量留下 **标题可视化的设色/字级/对比意图**、**能引起好奇的视觉钩子詞**（动作瞬间、對撞关系、未完叙事）以及 **内文关键场景**（可转译为画面的空间、道具、光线），并**务必**留下 **2～4 个可入画的具象图标题材**（与 Hook、正文关键词**一一对应**，供下游**必出**线稿小图标+简中辅标，忌泛泛符号）。",
          "保留：情绪底色、高级光影、场景倾向、镜头气质、排版张力；若文中有**职业、身份、专长**等人设线索，须提炼为**可被拍摄的高级视觉符号**，拒绝泛化。",
          "若正文主題明顯與餐食、烹飪無關，不必主動引入廚房、食譜表等構圖；若brief里有食物叙事再保留即可。",
          "场景提炼：**强烈建议**让场景服务于词义隐喻并极度多元化；**室内外无界**。**不推荐**无脑固化在书房、满架书本或**重复的客厅沙发区**；保留与题材精神高度吻合的**具体场所词**（例如：极简美术馆、废墟、自然旷野、精密空间等）。**多选题时****强烈建议**在骨架中植入**截然不同、具象且高级**的场景锚点。",
          "请返回 JSON 对象，仅含一个键 brief，例如：{\"brief\":\"...\"}；brief 不建议留空。",
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

/**
 * **单页连贯图文知识卡片**（kind=`single_page_knowledge_card`，自定义文案专用）的**中文**艺术指令。
 *
 * ⚠️ 与小红书八格不同：此路径**取消英文翻译**，直接把这段中文 directive + Markdown 原文送 GPT-Image-2，
 * 以保留书法标题 / 大师写实摄影 + 文艺复兴手绘 / 山茶花蝴蝶洋牡丹装饰 / 宣纸暖色底等细腻美学
 * （经英文化压缩会丢失这些质感、退化成扁平资讯图）。与 {@link buildXhsNoteGeminiPrompt}（2×4 八格）互不影响。
 */
export const SINGLE_PAGE_KNOWLEDGE_CARD_DIRECTIVE_ZH = `你是一位顶尖的归纳知识内容、规划整理的知识卡片设计师（Knowledge Card Visual Designer），精通解读 Markdown 文档，擅长把"文档内容"画成知识分解图。请把下方 Markdown 的详细内容做成**一整页连贯的单页图文知识卡片**（务必是"单页连贯"，而非 2×4 八格网格、也不是分镜表），用连贯的叙述把不同子标题的内容依序呈现。

【任务目标】
- 内容详尽充实、覆盖每个子标题的关键点、校对文稿保持正确；用简体中文解说，措辞通畅易懂、有趣可读。
- 标题：采用书法楷书字体、金橙色字体并以淡蓝紫色描边包裹每个标题字，字体用渐变色，呈现优雅飘逸的美感。
- 内文：务必印刷清晰、绝不可模糊；执行内文小字的清晰度优化，并把当前内文小字**放大一级**（字号比主题小一级），兼顾排版美观与可读性。

【信息密度·文字渲染（关键）】
- 信息密度优先：内容务必**详尽充实、宁详勿略**，信息量对标排版成熟、字数密集的高质量图文笔记（参考密度只能更高、不能更少）。把每个子标题下的内容展开成 **5-9 条要点**，每条写成信息完整的短句（约 12-30 字，含定义 / 数字 / 方法 / 示例），覆盖该子标题的全部关键知识点，**不要为了简洁而删减内容**。
- 在保证内容详尽的同时确保**字迹清晰**：每个文字块留足够留白、字号足够大，即使密集排布也要让每个汉字笔画清晰、不粘连、不变形、不重复、不缺笔。
- 关键数据 / 百分比 / 方法步骤 / 示例都要完整渲染出来；每个汉字必须是**真实存在、写法正确**的规范简体字，严禁生造字、错字、半个字或火星文。

【视觉规范】
- 主体构图：在中央或左上方放置文档的核心视觉意象；画面采用摄影大师写实风格 + 透视学审美 + 当代大师艺术手稿素描结合的精致画面。
- 四周环绕模块：以均匀布局围绕主体，层递排列文档中各类详尽知识点。
- 图标：每段详细内文配上立体透视的素描图标，加深各类知识的印象；图标要带有冲击力，多种色彩、强烈对比。
- 连接结构：用贝聿铭大师风格的素描线稿与写实美学线条，以及大师彩绘的各色山茶花、不同种蝴蝶、洋牡丹作为视觉链接；知识点用生动的符号或精致图形串接表达；**不要使用内部边框，法式大师设计风格的立体透视素描边框只出现在最外层**；严格避免箭头重叠、视觉不混乱。

【内容拆解】
- 把文档分成若干子标题，均匀分配在卡片上，用优雅、叙述通畅的文字与细致图标解释每个子标题；排版合理、说明详细、文字印刷清晰正确。
- 结尾需把关键重点详细凝练地收束（不要写出"总结"等小标题），直接呈现核心要点；**是否在结尾生成诗词 / 书法点睛金句，以下方【收尾】指令为准**。

【核心要求】
- 风格混合：文艺复兴时期大师手绘艺术插画（透视学素描）+ 贝聿铭大师级绝美写实摄影立体风格图标，二者组合；整体如同用彩色画笔在画布上绘制，所有元素细腻有质感、强烈视觉冲击。
- 构图布局：清晰完整、有逻辑，能自然引导读者视线；元素从左到右合理安排，填满画布以保证视觉均衡，不要过度居中。
- 颜色：暖色调为主、清爽合理；背景采用爱马仕橙色到浅紫的渐变（亦可用宣纸/绢本底色，春天淡紫加粉色渐变色谱），圆角、阴影、适当字体层次的现代设计；**图文笔记中不要有任何灰色的图像**，图标与符号都要彩色、有视觉冲击力；注释文字用橙色书法楷书、浅蓝描边。

【输出格式】完整描述、内容连贯、文字详尽、简体中文印刷清晰正确 / 高清 4K / 横向 16:9 构图。若文档有难以理解之处，先在内部翻译成英文校对原意，再生成简体中文叙述。`;

/**
 * 英文「渲染外壳」：内容用中文（保美学），但用一段简短英文**强约束模型如何渲染中文字**——
 * 模型对英文 meta 指令解析最稳，可显著降低密集简体中文的乱码/重复/缺笔概率。
 */
export const SINGLE_PAGE_KNOWLEDGE_CARD_TEXT_RENDER_WRAPPER_EN = `TEXT RENDERING (CRITICAL): All on-image text is **Simplified Chinese**. The card must be **content-rich and information-dense** — include detailed bullet points, key data/percentages, methods and concise explanatory lines for EVERY section; do NOT thin out or omit content for the sake of brevity. AT THE SAME TIME render every Chinese glyph **crisp, print-clear and correctly-formed** — no garbled, duplicated, missing/broken strokes, no invented or wrong characters — by spacing blocks well and keeping font size adequate even when dense. Wide 16:9 landscape, ultra high-resolution. Do NOT add any English sentences onto the card except tiny optional accent keywords.`;

/** 上篇 / 下篇：知识卡片分两页商业化用。`upper`=上篇（免费预览思路）、`lower`=下篇。 */
export type KnowledgeCardNotePart = "upper" | "lower";

/**
 * 把 Markdown 文稿按 `##` 子标题**对半切**成上篇 / 下篇（切不开则按长度对半）。
 * H1 文档大标题在两页都保留（作为各页标题来源）；上篇含 H1 + 前导段 + 前半子标题，下篇含 H1 + 后半子标题。
 */
export function splitKnowledgeCardMarkdown(scriptContext: string): { upper: string; lower: string } {
  const full = String(scriptContext || "").trim();
  if (!full) return { upper: "", lower: "" };

  const lines = full.split(/\r?\n/);
  // H1 文档大标题（首个 `# ` 行）
  const h1 = lines.find((l) => /^#\s+/.test(l.trim()))?.trim() ?? "";

  // 以 `## ` 子标题切块：preamble（首个 `## ` 之前的所有内容）+ 各子标题块
  const sectionStarts: number[] = [];
  lines.forEach((l, i) => {
    if (/^##\s+/.test(l.trim())) sectionStarts.push(i);
  });

  if (sectionStarts.length >= 2) {
    const preamble = lines.slice(0, sectionStarts[0]).join("\n").trim();
    const sections: string[] = sectionStarts.map((start, idx) => {
      const end = idx + 1 < sectionStarts.length ? sectionStarts[idx + 1] : lines.length;
      return lines.slice(start, end).join("\n").trim();
    });
    const half = Math.ceil(sections.length / 2);
    const upperSections = sections.slice(0, half);
    const lowerSections = sections.slice(half);
    const upper = [preamble, ...upperSections].filter(Boolean).join("\n\n").trim();
    // 下篇保留 H1 大标题作为上下文，再接后半子标题
    const lowerHead = h1 && !lowerSections[0]?.startsWith(h1) ? h1 : "";
    const lower = [lowerHead, ...lowerSections].filter(Boolean).join("\n\n").trim();
    return { upper, lower: lower || upper };
  }

  // 没有足够子标题：按字符长度对半切；下篇前补 H1
  const mid = Math.ceil(full.length / 2);
  const upper = full.slice(0, mid).trim();
  const lowerBody = full.slice(mid).trim();
  const lower = h1 ? `${h1}\n\n${lowerBody}`.trim() : lowerBody;
  return { upper, lower };
}

/**
 * **单页连贯图文知识卡片**（自定义文案专用）：组装**直接送 GPT-Image-2** 的 prompt。
 * 结构 = 中文艺术 directive（保美学）+ 上下篇分页指令（如有）+ Markdown 内容 + 英文渲染外壳（防乱码）。
 * 本路径**不经过英文翻译**，与小红书八格 {@link buildXhsNoteGeminiPrompt} 完全独立。
 *
 * @param notePart 传入 `upper`/`lower` 时，仅取对应半篇内容并在标题末尾标注「（上篇）」/「（下篇）」。不传则整篇。
 */
export function buildSinglePageKnowledgeCardImagePrompt(
  scriptContext: string,
  notePart?: KnowledgeCardNotePart,
): string {
  const source =
    notePart === "upper"
      ? splitKnowledgeCardMarkdown(scriptContext).upper
      : notePart === "lower"
        ? splitKnowledgeCardMarkdown(scriptContext).lower
        : String(scriptContext || "");
  const slice = source.slice(0, SCRIPT_SLICE);

  const partDirective =
    notePart === "upper"
      ? `\n【分页·上篇】本页是该主题图文笔记的【上篇】（共上下两篇）。请在文档大标题的末尾追加「（上篇）」字样；**只**呈现下方提供的这半部分内容，做成一份完整、连贯、精致且**信息详尽**的单页知识卡片（内容只多不少、宁详勿略，把每个子标题充分展开；不要画出下篇内容，也不要写"未完待续"之外的占位）。\n【收尾·上篇】上篇结尾**不要**生成任何诗词、金句或书法点睛横幅；把底部版面同样用于详尽的知识点内容。`
      : notePart === "lower"
        ? `\n【分页·下篇】本页是该主题图文笔记的【下篇】（承接上篇，共上下两篇）。请在文档大标题的末尾追加「（下篇）」字样；**只**呈现下方提供的这半部分内容，做成一份完整、连贯、精致且**信息详尽**的单页知识卡片（内容只多不少、宁详勿略，把每个子标题充分展开），整体风格须与上篇保持一致。\n【收尾·下篇】下篇结尾请生成 **1 首当代诗词**阐释全文核心知识点，并配 1 句楷书书法点睛语横幅 + 诗意插图与视觉链接（不要写出"金句"二字），四周放置图标与相关视觉链接。`
        : `\n【收尾】本页不生成诗词、金句或书法点睛横幅；版面全部用于详尽的知识点内容。`;

  return `${SINGLE_PAGE_KNOWLEDGE_CARD_DIRECTIVE_ZH}${partDirective}

【以下为 Markdown 文稿内容，请按上述要求生成单页连贯图文知识卡片（而非 2×4 八格）】：
${slice}

${SINGLE_PAGE_KNOWLEDGE_CARD_TEXT_RENDER_WRAPPER_EN}`.trim();
}

/**
 * 主线生图「中文直送」总开关（默认**开启**：封面 / 2×4 分镜 / 小红书八格 跳过 GPT 5.4 英文化，
 * 直接用中文主体 + 英文像素锁送 GPT-IMAGE-2）。设 `PLATFORM_IMAGE_CHINESE_DIRECT=0/false/off/no` 可即时回退翻译。
 * 直送失败时各调用点仍会自动 fallback 回原英文化路径，确保线上不硬断。
 */
export function isPlatformImageChineseDirectEnabled(): boolean {
  const v = String(process.env.PLATFORM_IMAGE_CHINESE_DIRECT ?? "").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "off" || v === "no") return false;
  return true;
}

/**
 * **2×4 分镜 / 小红书八格** 的「中文直送主体」（取代 GPT 5.4 英文化的英文主体）。
 * 仅产出**中文画面主体**；调用方仍会在其后拼接英文像素锁（`GPT_IMAGE2_*_2X4_PIXEL_LOCK`）+ 顶栏注入 + 镜头/光影 modifier，
 * 故 2×4 八格的格状纪律由像素锁继续锁死，本函数只负责把 GPT-5.5 中文文案（含分镜描述）原样带入。
 */
export function buildCompositeSheetDirectChineseBody(
  kind:
    | "storyboard_sheet_portrait"
    | "storyboard_sheet_landscape"
    | "xiaohongshu_dual_note",
  scriptContext: string,
): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  const isStoryboard = kind === "storyboard_sheet_landscape" || kind === "storyboard_sheet_portrait";
  if (isStoryboard) {
    return `请直接据下方中文脚本生成一张**电影级 2×4 八格分镜参考图**（横版约 16:9 单张主表，不是单张满版海报）：
- 顶部约 8–12% 为通栏【内容总结】标题栏（简体中文·全片梗概，不放各格分镜标题）。
- 其下严格排成 **2 行 × 4 列、共 8 格**，格线笔直、格间留白清晰，按 row1 左→右、row2 左→右顺扫。
- 每一格自上而下：① 本格分镜主题（一行加粗简体中文）；② 该镜头电影级写实剧照（高细节，约占 70–75%）；③ 格内底部约 25–30% 为简体中文四栏小表，表头固定【景别 / 运镜 / 画面内容 / 台词与音效】四栏都要填。
- 风格：电影感、8k、精致布光、统一高级色调；所有屏内文字一律**简体中文、印刷清晰、不可乱码/缺笔**。

【中文脚本】：
${slice}`;
  }
  return `请直接据下方中文文案生成一张**小红书风格 2×4 八格图文笔记参考图**（横版约 16:9 单张主表，不是单张满版海报）：
- 严格排成 **2 行 × 4 列、共 8 格**，格线笔直、格间留白清晰，按 row1 左→右、row2 左→右顺扫。
- 每格为一个知识/内容要点：醒目简体中文小标题 + 要点短句 + 扁平插画/图标/序号徽章 01–08；整体暖色粉彩、明快多彩、高级商务审美、印刷清晰。
- 画风为**扁平插画信息图（单页图文笔记风）**，不要电影写实摄影或暗调光影；屏内文字一律**简体中文、清晰不乱码**（英文仅作极少量点缀）。

【中文文案】：
${slice}`;
}

/**
 * **平台选题单帧封面** 的「中文直送 prompt」（取代 `translatePlatformTopicCoverToEnglishGpt54` 的英文产物）。
 * 直接把 GPT-5.5 选题 + 中文语境/身份锚点组装成一条中文封面指令，附英文版式 footer（结构指令模型可直接遵循），送封面像素链路。
 */
export function buildPlatformTopicCoverDirectChinesePrompt(input: {
  topicHook: string;
  context: string;
  variant: "video" | "graphic";
  coverPersonaContext?: string;
}): string {
  const hook = String(input.topicHook || "").trim().slice(0, 120);
  const ctx = String(input.context || "").slice(0, SCRIPT_SLICE);
  const persona = String(input.coverPersonaContext || "").trim();
  const personaBlock = persona
    ? `【身份锚点】（人物服装 / 道具 / 环境须与此一致）：\n${persona.slice(0, 1200)}\n\n`
    : "";
  return `${personaBlock}请直接据下方选题与语境生成**一张竖版 9:16 单帧信息流封面**（单一主体、满版主视觉，不要做成 2×4 网格或多格分镜）：
- 主标题用**简体中文**，大而清晰、印刷级，紧扣「${hook}」；可有次级简中辅标，英文仅作极少量点缀。
- 场景随文案多样化、贴合选题，避免千篇一律的书房 / 办公室 / 沙发电视等套路；高级 editorial / 杂志质感，统一受光、克制配色 + 一处鲜明强调色。
- 加 2–4 个与主题呼应的精致线描小图标，各配 4–8 字简体中文辅标，自然融入场景光影、不要硬框贴纸感，且不可压过主标题。
- masterpiece、8k、视觉冲击力强；所有屏内文字一律**简体中文、清晰不乱码**。

【选题】：「${hook}」
【语境】：
${ctx}

${PLATFORM_TOPIC_GRAPHIC_PROMPT_FOOTER}`.trim();
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
1. START WITH a **premium editorial magazine cover** opener tailored to the Chinese title mood—**9:16 vertical portrait**, cinematic editorial photography, masterpiece print quality. **Strongly recommended palette:** let the title/context drive light and color (daylight, soft overcast, warm interior, or restrained dark-gold **only when the brief supports it**). **Not recommended:** defaulting every cover to heavy dark-gold / low-key gloom without narrative reason.
2. SCENE: Describe layout, lighting, textures, and luxury materials in vivid English only for non-text regions.
3. CRITICAL TYPOGRAPHY (SIMPLIFIED CHINESE ONLY): **Strongly recommended** to include this requirement: "All masthead lines, hero headline, and every readable word on the cover should be in Simplified Chinese only (no Traditional Chinese). Bake the following Chinese string as the main cover headline, large and legible: 「${title}」. Optional tiny corner line in English may show only the masthead date token: ${input.englishMonthYear}. If any secondary Chinese tagline is needed, use Simplified Chinese (e.g. 战略情报)."
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
1. START WITH a **premium strategic intelligence chapter poster**, **9:16 vertical**, cinematic editorial, museum-grade lighting. **Palette:** follow the Chinese passage—**recommended** varied light (daylight / soft interior / selective dark accent) rather than default dark-gold and ink for every poster.
2. Describe visual scene in English; all prominent typography on the poster **should be** Simplified Chinese only. Hero title **strongly recommended** to include exactly: 「${t}」.
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
  "自然旷野、极限地貌、城市街头与流动交通（**延展/开放/户外**轴）",
  "高级零售、市集烟火、消费空间与极简商业体（**欲望/社交/消费**轴）",
  "博物馆、艺术展厅、历史古迹与沉浸式空间（**秩序/时间/文博**轴）",
  "轻餐社交、交通枢纽、剧院后台、实验室与抽象棚拍置景（**聚焦/张力/公共**轴）",
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
      ? "**目前为四个选题，即四种截然不同的空间隐喻（四张封面各一景）；勿四张同源套路。**"
      : `**本批共 ${total} 条选题，**强烈建议**生成 ${total} 种截然不同的空间隐喻。**`;
  return (
    `【同一批次·场景空间与隐喻调度】**核心原则：破除同质化，每题一景**。不同选题**强烈建议**根据其核心情绪，自动匹配**完全不同**的视觉气质与空间维度。**尽量避免**书房/书桌/客厅等千篇一律的廉价套路。${fourTopicsLine}` +
    `本条为批次中 **第 ${k} / ${total} 条**。**强烈建议**主场景优先以「${axis}」作为破题起点；空间举例**包括但不限于**：宏大自然、城市肌理、交通枢纽、艺术展馆、极简商业空间、废墟或抽象概念置景等。**推荐**远看有力量，近看有细节。**优先参考**：若正文**明确**指定场景，则以正文的深层隐喻为准。`
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
【单帧出镜 · 身份隐喻与美学锚定】（英文 tags 须将创作者的精神气质转化为极具张力的视觉符号；**不推荐画地为牢**，**室内外空间无界**，**尽量避免**刻板的书房、书桌或反覆出现的庸常客厅；场景、光影、材质**强烈建议**服务于 **情绪张力、文化语境与人文关怀**，优先寻找更深层、更有设计价值的隐喻，**不推荐**空泛元素的机械堆砌；**色调上不推荐**无依据默认整幅暗色；画面**推荐**具备顶级视觉冲击与专业艺术气质；单帧封面适用）
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
 * **Gemini API** 英文化（`GEMINI_API_KEY`）：`responseMimeType: application/json`。
 * - **豎封封面**（`pipeline: topic_cover`）：**Gemini 3.5 Flash**（{@link resolveVertexCoverTranslationModelName}）。
 * - **2×4／分鏡／八格**（composite）：**Gemini 3.5 Flash**（{@link resolveVertexFlashTranslationModelName}）。
 * **豎封** `temperature` / `topP` / `maxOutputTokens` 見 {@link resolveVertexCoverTranslationTemperature}、{@link resolveVertexCoverTranslationTopP}、{@link resolveVertexCoverTranslationMaxOutputTokens}（預設 **0.7** · **0.9** · **32K**）；**composite** 见 Flash 溫度／topP，并併用 {@link resolveVertexFlashThinkingConfigForSdk}（Gemini 3.5 · HIGH）。**不附 googleSearch**。
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
    throw new Error("Gemini API 英文化：上游 task 为空");
  }

  const ctxPipe = opts?.pipelineStatCtx?.pipeline;
  const isTopicCover = ctxPipe === "topic_cover";

  const profile = resolveTranslationProfile(opts?.pipelineStatCtx);
  const model = isTopicCover
    ? resolveVertexCoverTranslationModelName()
    : resolveVertexFlashTranslationModelName();

  appendVertexFlashDebug(
    flowLog,
    `── Gemini API 英文化開始 ── model=${model} · ctxPipeline=${ctxPipe ?? "n/a"} · profile=${profile} · auth=GEMINI_API_KEY`,
  );
  const flashTemp = isTopicCover
    ? resolveVertexCoverTranslationTemperature()
    : resolveVertexFlashTranslationTemperature();
  const flashTopP = isTopicCover ? resolveVertexCoverTranslationTopP() : resolveVertexFlashTranslationTopP();
  const flashMaxOut = isTopicCover
    ? resolveVertexCoverTranslationMaxOutputTokens()
    : resolveVertexFlashTranslationMaxOutputTokens();
  appendVertexFlashDebug(
    flowLog,
    `請求參數 · responseMimeType=application/json · maxOutputTokens=${flashMaxOut} · temperature=${flashTemp} · topP=${flashTopP} · thinking=HIGH · tools=[] · task 約 ${task.length} 字`,
  );

  /** `topic_cover` 與 5/11 晚輕量 system 一致；`composite` 為網格執行優先。 */
  const systemInstruction = platformImageTranslationVertexJsonSystemInstruction(profile);

  const runFlashAttempt = async (): Promise<string> => {
    appendVertexFlashDebug(flowLog, `調用 Gemini API generateContent({ model: ${model} }) …`);
    const raw = await callGemini35FlashImageTranslation({
      systemInstruction,
      userText: `请返回 JSON：{"prompt":"..."}。\n${task}`,
      modelName: model,
      temperature: flashTemp,
      topP: flashTopP,
      maxOutputTokens: flashMaxOut,
    });
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

/** 封面英文化：固定 **GPT 5.4**（忽略 UI 历史 Flash 选项）。 */
export function resolveCoverImagePromptTranslator(
  _raw?: PlatformImagePromptTranslator | null,
): PlatformImagePromptTranslator {
  return "gpt54";
}

/** 2×4 分镜 / 八格英文化：固定 **GPT 5.4**（strict · 无 Flash 兜底）。 */
export function resolveCompositeImagePromptTranslator(
  _raw?: PlatformImagePromptTranslator | null,
): PlatformImagePromptTranslator {
  return "gpt54";
}

/** Debug 流水：封面英文化实际引擎标签（无兜底）。 */
export function coverTranslationEngineDebugLabel(
  translator: PlatformImagePromptTranslator,
): string {
  if (translator === "vertex_gemini_3_flash_preview") {
    const model = resolveVertexCoverTranslationModelName();
    return `Gemini 3.5 Flash（${model} · 无 GPT 兜底）`;
  }
  const modelName =
    process.env.OPENAI_GPT54_MODEL?.trim() ||
    process.env.OPENAI_PLATFORM_IMAGE_TRANSLATION_MODEL?.trim() ||
    "gpt-5.4";
  return `GPT 5.4（OpenAI · ${modelName} · 无 Flash 兜底）`;
}

/**
 * 選題 **豎封**英文化：由 UI 指定 **GPT 5.4** 或 **Gemini 3.5 Flash**；**严格模式，失败即停，不交叉兜底**。
 */
export async function translatePlatformTopicCoverToEnglish(
  translationTask: string,
  flowLog: string[] | undefined,
  translatorInput?: PlatformImagePromptTranslator | null,
): Promise<string> {
  const translator = resolveCoverImagePromptTranslator(translatorInput);
  const task = String(translationTask || "").trim();
  const taskChars = task.length;
  appendGpt54TranslationDebug(
    flowLog,
    `[封面·英文化·配置] 引擎=${coverTranslationEngineDebugLabel(translator)} · 上游 task=${taskChars} 字 · reasoning=medium · max_tokens=65536 · strictNoFallback=是`,
  );
  return callGemini31ProForImagePrompt(task, {
    translator,
    flowLog,
    pipelineStatCtx: { pipeline: "topic_cover" },
    strictNoFallback: true,
  });
}

/**
 * 選題 **豎封**英文化：**GPT 5.4**（OpenAI，`callGemini31ProForImagePrompt` · `translator=gpt54`）。
 */
export async function translatePlatformTopicCoverToEnglishGpt54(
  translationTask: string,
  flowLog?: string[],
): Promise<string> {
  return callGemini31ProForImagePrompt(translationTask, {
    translator: "gpt54",
    flowLog,
    pipelineStatCtx: { pipeline: "topic_cover" },
  });
}

/**
 * @deprecated 選題豎封已改走 {@link translatePlatformTopicCoverToEnglishGpt54}；保留 Vertex 退路供监管 A/B。
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
  const isTopicCoverPipeline = statCtx?.pipeline === "topic_cover";
  const hasOpenAiKey = Boolean(String(process.env.EVOLINK_API_KEY || process.env.OPENAI_API_KEY || "").trim());
  const allowCoverOpenAi =
    isPlatformImageOpenAiAllowed() || (isTopicCoverPipeline && hasOpenAiKey);
  if (!allowCoverOpenAi) {
    if (isTopicCoverPipeline) {
      appendGpt54TranslationDebug(
        flowLog,
        "[封面·英文化] OpenAI 未启用 · 已选择 GPT 5.4 · 中止（无 Flash 兜底）",
      );
      throw new Error(
        "封面英文化：已选择 GPT 5.4，但服务端未启用 OpenAI（需 PLATFORM_IMAGE_ALLOW_OPENAI=1 或配置 EVOLINK_API_KEY / OPENAI_API_KEY）",
      );
    }
    appendGpt54TranslationDebug(flowLog, "[英文化] OpenAI 未啟用 · 改走 Vertex（設 PLATFORM_IMAGE_ALLOW_OPENAI=1 可恢復 GPT）");
    return callVertexGeminiFlashTranslation(prompt, flowLog, {
      pipelineStatCtx: statCtx,
      afterFlashFailure: "throw",
    });
  }

  const skipVertexFallback = Boolean(opts?.skipVertexFallback);
  const compositeTranslationStrict = Boolean(opts?.compositeTranslationStrict);
  const translationProfile = resolveTranslationProfile(statCtx);
  const isCoverProfile = translationProfile === "topic_cover";
  /** 模型名環境決定：**gpt‑5.4、gpt‑5.5** 等皆走此路—選題信息流單封身份與 **{@link PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN}** 及 Gemini 3 Flash **一致**。Stage 2 見 {@link getPlatformStage2OpenAiModel} */
  const modelName =
    process.env.OPENAI_GPT54_MODEL?.trim() || process.env.OPENAI_PLATFORM_IMAGE_TRANSLATION_MODEL?.trim() || "gpt-5.4";
  const gpt54MaxOut = isCoverProfile
    ? resolveGpt54CoverTranslationMaxOutputTokens()
    : resolveGpt54CompositeTranslationMaxOutputTokens();
  const gpt54ReasoningEffort = isCoverProfile
    ? resolveGpt54CoverTranslationReasoningEffort()
    : resolveGpt54CompositeTranslationReasoningEffort();
  const taskChars = String(prompt || "").length;

  const gpt54SystemContent =
    translationProfile === "topic_cover"
      ? [
          GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
          PLATFORM_TOPIC_FEED_COVER_TRANSLATOR_RULE_CN,
          "把上游任务收成 **一条** 可直接给 GPT-IMAGE-2 的 **英文** 生图指令（JSON 的 prompt 字段）。**优先** comma-separated tags / 短语；需要时用更长英文把版式、主体、简中标题、场景隐喻说清楚。**不设字符上限**，以一次生图能忠实执行任务为第一优先级。",
          "请返回合法 JSON：{\"prompt\":\"...\"}；不建议附加解释、不建议使用 markdown。",
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
    const t0 = Date.now();
    appendGpt54TranslationDebug(
      flowLog,
      `${a} · 请求前 · invokeLLM(openai/gpt54) · modelName=${modelName} · max_tokens=${gpt54MaxOut} · reasoning_effort=${gpt54ReasoningEffort} · profile=${translationProfile} · response_format=json_object · 上游 task 约 ${taskChars} 字`,
    );
    const primaryResponse = await invokeLLM({
      provider: "openai",
      model: "gpt54",
      modelName,
      response_format: { type: "json_object" },
      max_tokens: gpt54MaxOut,
      reasoningEffort: gpt54ReasoningEffort,
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

    const elapsedMs = Date.now() - t0;
    appendGpt54TranslationDebug(
      flowLog,
      `[英文化·完成] pipeline=${statCtx?.pipeline ?? translationProfile} · model=${modelName} · reasoning_effort=${gpt54ReasoningEffort} · 上游=${taskChars}字 · 英文=${out.length}字 · 耗时=${elapsedMs}ms · max_tokens=${gpt54MaxOut}`,
    );

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
  const gpt54MaxOut = resolveGpt54CoverTranslationMaxOutputTokens();
  const bundleReasoningEffort = resolveGpt54CoverTranslationReasoningEffort();

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
    const t0 = Date.now();
    appendGpt54TranslationDebug(
      flowLog,
      `${a} · invokeLLM · modelName=${modelName} · max_tokens=${gpt54MaxOut} · reasoning_effort=${bundleReasoningEffort} · json cover_prompt+composite_prompt`,
    );
    const primaryResponse = await invokeLLM({
      provider: "openai",
      model: "gpt54",
      modelName,
      response_format: { type: "json_object" },
      max_tokens: gpt54MaxOut,
      reasoningEffort: bundleReasoningEffort,
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
    const elapsedMs = Date.now() - t0;
    appendGpt54TranslationDebug(
      flowLog,
      `[英文化·完成] pipeline=topic_cover_composite_bundle · model=${modelName} · reasoning_effort=${bundleReasoningEffort} · 上游=${coverChars + compChars}字 · 英文=${coverEn.length + compositeEn.length}字 · cover=${coverEn.length}字 · composite=${compositeEn.length}字 · 耗时=${elapsedMs}ms · max_tokens=${gpt54MaxOut}`,
    );
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
 * **分鏡主表 / 小紅書八格** 英文化見 {@link translatePlatformCompositeToEnglishPrompt}（預設 GPT 5.4→Flash 兜底，雙軌失敗拋 {@link PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}）。
 * 戰略封面 / 章節扉頁仍走 `runGemini31ProPreviewText` → Vertex（見 `buildStrategicCoverGeminiTask`）。
 */
export async function callGemini31ProForImagePrompt(
  translationTask: string,
  options?: {
    translator?: PlatformImagePromptTranslator;
    flowLog?: string[];
    pipelineStatCtx?: Gpt54PlatformImagePromptStatCtx;
    /** 封面 / 2×4 英文化：GPT↔Flash 不交叉兜底 */
    strictNoFallback?: boolean;
  },
): Promise<string> {
  const requested: PlatformImagePromptTranslator = options?.translator ?? "gpt54";
  const statCtx = options?.pipelineStatCtx;
  const isTopicCover = statCtx?.pipeline === "topic_cover";
  const strictNoFallback = Boolean(options?.strictNoFallback) || isTopicCover;
  const billingEscape = isPlatformWeekendGcpEscape() && !strictNoFallback;
  const translator: PlatformImagePromptTranslator = billingEscape ? "gpt54" : requested;
  const flowLog = options?.flowLog;
  if (billingEscape && requested === "vertex_gemini_3_flash_preview") {
    appendGpt54TranslationDebug(
      flowLog,
      "[GCP避險] 英文化已從 Vertex 探索強制改為 GPT 5.4 路徑（避免調用 Vertex Flash）",
    );
  }
  const vertexModel = isTopicCover
    ? resolveVertexCoverTranslationModelName()
    : resolveVertexFlashTranslationModelName();
  const vertexLoc = resolveVertexFlashTranslationLocation();
  const openAiModelName =
    process.env.OPENAI_GPT54_MODEL?.trim() ||
    process.env.OPENAI_PLATFORM_IMAGE_TRANSLATION_MODEL?.trim() ||
    "gpt-5.4";
  const label =
    translator === "vertex_gemini_3_flash_preview"
      ? `Gemini 3.5 Flash · ${vertexModel} · ${vertexLoc}`
      : `GPT 5.4 · OpenAI · ${openAiModelName}`;
  try {
    const raw =
      translator === "vertex_gemini_3_flash_preview"
        ? await callVertexGeminiFlashTranslation(translationTask, flowLog, {
            pipelineStatCtx: statCtx,
            afterFlashFailure: strictNoFallback ? "throw" : undefined,
            compositeTranslationStrict: !isTopicCover,
          })
        : await callGemini3_1_Pro_AiStudio(translationTask, flowLog, statCtx, {
            skipVertexFallback: strictNoFallback,
            compositeTranslationStrict: statCtx?.pipeline === "composite_sheet" || strictNoFallback,
          });
    const out = stripGeminiModelOutput(raw);
    if (!out) {
      appendGpt54TranslationDebug(flowLog, `[GPT54·崩溃原因] stripGeminiModelOutput 后为空 · label=${label}`);
      throw new Error("[GPT54·崩溃原因] strip 后为空");
    }
    if (isTopicCover) {
      appendGpt54TranslationDebug(
        flowLog,
        `[封面·英文化·完成] 实际引擎=${label} · 英文 prompt=${out.length} 字符`,
      );
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
  kind:
    | "storyboard_sheet_portrait"
    | "storyboard_sheet_landscape"
    | "xiaohongshu_dual_note"
    | "single_page_knowledge_card";
  scriptContext: string;
  /** 保留相容；分鏡/八格 **預設** **GPT 5.4** 英文化三輪 → **Gemini 3.5 Flash** 三輪兜底；`engine=gemini31flash` 強制先 Flash */
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
  const isStoryboard = kind === "storyboard_sheet_landscape";
  appendVertexFlashDebug(
    flowLog,
    `translatePlatformComposite · kind=${options.kind}${options.kind !== kind ? `→${kind}` : ""} · translator=${options.translator ?? "(未指定)"} · engine=${options.engine ?? "n/a"}`,
  );
  // 注意：single_page_knowledge_card 不走本英文化函数（已在 proxyImageService 直接用中文 directive 送生图）。
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

  if (options.engine === "gemini31flash" || options.translator === "vertex_gemini_3_flash_preview") {
    appendGpt54TranslationDebug(
      flowLog,
      `[2×4·英文化·配置] 已忽略 engine/translator=${options.engine ?? options.translator ?? "n/a"} · 固定 GPT 5.4 · strictNoFallback=是`,
    );
  }

  if (isPlatformWeekendSurvivalModeEnabled()) {
    appendGpt54TranslationDebug(flowLog, "[生存模式] 2×4 英文化仍固定 GPT 5.4 · strict · 无 Flash 兜底");
  }

  appendGpt54TranslationDebug(
    flowLog,
    `[2×4·英文化·配置] 引擎=GPT 5.4（OpenAI · strict · reasoning=medium · max_tokens=32768）· task≈${task.length} 字`,
  );
  return callGemini31ProForImagePrompt(task, {
    ...gptImgBridgeOpts("gpt54"),
    strictNoFallback: true,
  });
}
