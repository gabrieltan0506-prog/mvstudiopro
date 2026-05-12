import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { extractJsonString, invokeLLM } from "../_core/llm.js";
import { isPlatformWeekendGcpEscape, isPlatformWeekendSurvivalModeEnabled } from "../config/platformSwitches.js";
import { emitPlatformImagePipelineStat } from "./platformImagePipelineStats.js";

/** 給 GPT54 翻譯路徑的營運打點（可選）；見 {@link emitPlatformImagePipelineStat} */
export type Gpt54PlatformImagePromptStatCtx = {
  pipeline: "topic_cover" | "composite_sheet" | "prompt_condense" | "other";
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
  flowLog.push(`${new Date().toISOString()}  [Vertex·Flash] ${line}`);
}

/** OpenAI GPT 5.4 英文化專用，與 imageGenFlowLog 同源（勿與 Vertex 混淆）。 */
function appendGpt54TranslationDebug(flowLog: string[] | undefined, line: string): void {
  if (!flowLog) return;
  flowLog.push(`${new Date().toISOString()}  [GPT54·英文化] ${line}`);
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
function resolveVertexProjectIdForGenAi(): string {
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

/** 預設 Vertex Flash 翻譯模型 ID。可 `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` 覆寫。 */
export const DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL = "gemini-3-flash-preview";

export function resolveVertexFlashTranslationModelName(): string {
  return String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_MODEL || DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL).trim();
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
function buildGoogleGenAiAuthOptionsFromEnv(): { credentials: { client_email: string; private_key: string } } | undefined {
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

/**
 * **GPT-Image-2 優先**：英文 prompt 以「可執行、可排版」為第一性——場景/主體、光學與對比、留白與資訊區、畫內簡中字規格。
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
 * **平台生圖英文化共用英文總則**（封面 / 分鏡條 / 2×4）：消費方僅 **GPT-Image-2**。
 * - {@link callVertexGeminiFlashTranslation} 的 `systemInstruction` **首段**須與此同文。
 * - {@link callGemini3_1_Pro_AiStudio} 的 system 訊息 **首段**須與此同文。
 */
export const PLATFORM_IMAGE_TRANSLATOR_BASE_EN = `${GPT_IMAGE2_EXECUTION_PRIORITY_EN} ${GPT54_IMAGE_PROMPT_REALISM_AND_GARNISH_EN}`;

/** @deprecated 與 {@link PLATFORM_IMAGE_TRANSLATOR_BASE_EN} 同文，保留舊名避免外部引用斷裂。 */
export const GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN = PLATFORM_IMAGE_TRANSLATOR_BASE_EN;

/** 小红书 **多页** 图文笔记：**2×4 八格**；產品上≠視頻分鏡——**不要**用製片/DPP 式「情緒·燈光·景別·機位」欄位來組稿。 */
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

/** 封面 / 竖版多分镜条：英文以 GPT-Image-2 可执行为主；**不設字數上限**。 */
export const MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT = `
【输出偏好 / OUTPUT】（GPT-IMAGE-2 · 生成優先）
1. 输出 **一段完整英文** 生图指令，**以 GPT-Image-2 直接執行為準**：可用 **編號短句** 依序写清 **主體場景 → 光學與對比 → 留白與主標區 → 簡中畫內字規格**；**优先** comma-separated tags / 短語補齊細節。**不限制字符數**。
2. 上游中文僅作參考；必含：情绪、灯光、场景、主体/服装、简中标题**字色与层次**；不得因文学化改写而模糊主標區或分格。
3. **莎剧式语感**僅在 (1)(2) 已锁死后可點綴；须含 masterpiece、8k。
`.trim();

/**
 * 橫版 **2×4 分鏡主表**：八格版式要说清；**不限制英文長度**，以一次出可用網格為優先。
 */
export const STORYBOARD_2X4_SHEET_TRANSLATION_FOOTER = `
TAG:STORYBOARD_2X4_SHEET

【英文生图输出 / OUTPUT — cinematic 2×4 storyboard master（单张宽幅 landscape · GPT-Image-2 優先）】
1. Output **one** English block **for GPT-Image-2 execution**；**prefer** comma-separated tags / short fragments so the 2×4 grid stays obvious；必要時用編號句寫清頂欄比例、格線、gutter。**No character limit**—use enough English to lock all eight beats and the table schema。中文劇本僅作參考。
2. **全表顶栏（仅此一处「上方主题」）：** 画布最上 **~8–12%** 为**通栏横条**，主信息为 **内容总结**（全片/全案梗概或本段剧情提要）；可并排或次行出现「· 分镜脚本」等定式后缀。**勿**将各格的分镜标题写进顶栏。**Do not** place the first row of panels flush against the top edge.
3. **栅格：** 顶栏之下 **整整 8 格**，**2 行 × 4 列**，刚性格线与格间直 gutter、顺扫 row1 左→右再 row2；masterpiece、8k，每格主画面为写实电影感分镜静帧。
4. **每一格自上而下：** (A) **格内顶：** **分镜主题描述**（仅本格一句醒目简中主题）；(B) **格内中：** 该分镜主画面（上区约 **70–75%**，除表格外纯影像）；(C) **格内底 ~25–30%：** 简中**四栏参考表**，表头固定为 **景别**、**运镜**、**画面内容**、**台词与音效**，四柱均有正文；可细网格；表内须为**简体中文**。**Do not** leave panels wholly wordless in the table band.
5. **版式约束：** 禁止整画布单张满幅顶掉八格、无顶栏、或仅四宫格笔记版——本任务为 **八格主表**；若丢失「顶栏内容总结」、或八格被收成单张满幅/少格，亦偏离产品主表意图；其余景别与光影可充分发挥。
`.trim();

/** 平台選題 **單幀封面**（圖文 / 短影音 **video**）：9:16 單張信息流；宽幅 2×4 多分镜主表不在此任務。 */
const PLATFORM_TOPIC_GRAPHIC_PROMPT_FOOTER = `
【英文生图输出 / OUTPUT — platform topic **single-frame 9:16 feed cover**（GPT-IMAGE-2 優先）】
1. Output **one** English block for GPT-IMAGE-2：**先**用編號或短段写清 **主體場景 / 布光與反差 / 主標區 / 簡中大字規格 / 輔標與圖示層**，再補 tags。**Prefer** comma-separated tags / short phrases; longer text is OK if it locks the cover.**No fixed character limit.**
2. **版式：** vertical 9:16、**單張**、**單一主視覺**；讀作抖音/小紅書式 **封面缩略图**；**不要**寫成横版 2×4 八格主表、**不要**單圖內多分鏡縱條（那些為下游專用任務）。
3. **攝影寫實 · 大師級布光（英文須可執行）：** 以 **高端廣告/雜誌編輯靜態** 為標杆—**photoreal editorial still**；寫清 **motivated lighting**（可信主光來向：窗光、柔光箱、輪廓 **rim**、**key–fill** 層次、受控陰影形狀），可提 subtle vignette / gobo 質感，**禁止**一片平光貼字或廉價泛光糊成一片。
4. **場景佈置與道具：** **rich set dressing**—前景/中景/後景分層；與 Hook+Context 呼應的 **道具、手勢、環境線索** 要具體可拍；避免空背景只堆字。
5. **高級審美與質感：** **premium editorial** CMF—金屬/玻璃/織物/漆面等材質對比 **believable**；整體節制、像高價位品牌片場靜帧，**禁止**低幼剪貼畫感（除非題材明確要求卡通）。
6. **主題圖示 + 簡中輔標：** 在主標周邊（下沿、側欄、角標帶）可安排 **與主題語義一致的象形圖示 / badge / pill / 簡潔符號**（適度、不塞滿）+ **可讀简体中文微文案**（短副標、括注、2–8 字級提示均可）。**層級：** 主標 **支配畫面**；圖示與小字 **點題、增資訊密度**，不得壓過主標可讀性。
7. **視覺衝擊配色：** 明確 **dominant** 色調 + **razor accent**（色楔、色帶、霓虹漸變邊等）制造 **scroll-stop**；主標與背板 **對比足**；避免臟灰混色導致缩略圖糊掉。
8. **生動創意 × 勾起好奇：** 整體 **conceptually lively**：構圖／道具／隱喻可 **大膽但可信**，一眼能感知 **钩子张力／戏剧性一瞬间／非常規對撞**，讓用戶在滑動信息流時 **想看第二眼、想知道「怎麼了／然後呢」**。英文務必写明 **visual hook + curiosity gap**（≠ 標題欺詐）；**杜绝**泛泛安全牌的「無信息量素材臉」——題材許可時要敢想一步。
9. **高細節字體：** **Simplified-Chinese hero type**—字重、字距、與背景的 **color separation** 寫死；辅层简中字字號小一級但仍清晰。
10. **莎劇 × 寫實：** **Optional** English flourish **after** (1–9) locked; image yield stays **contemporary editorial photorealism**.
11. **题材软边界：** 贴合 Hook + Context + 身份（若有）；離題資訊圖無需硬塞。
12. Include masterpiece、8k；画内简中主標與辅标用英文写清位置及对比規格。
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
    `[骨架·中文视觉] extractChineseVisualBrief 開始（GPT 5.4 → JSON brief）· 輸入約 ${slice.length} 字（上限切片 ${SCRIPT_SLICE}）`,
  );

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
          "若输入宽幅 2×4 **电影分镜主表**剧本：骨架里区分——**全文内容总结**（适合放在整表顶栏的一句汇总）与各格 **分镜主题**（每格一句）及可填入 **景别/运镜/画面内容/台词与音效** 的要点，勿把各格主题误并入「顶栏总结」混写。",
          "若偏封面用途：尽量留下 **标题可视化的设色/字级/对比意图**、**能引起好奇的视觉钩子詞**（动作瞬间、對撞关系、未完叙事）以及 **内文关键场景**（可转译为画面的空间、道具、光线），并可留下 **適合做小圖示/角標/badge 的具象關鍵詞**（与主题强相关）；供下游写出高细节封面而不会只剩抽象形容词。",
          "保留：情绪、灯光、场景、服装、关键道具、镜头气质、版式提示；若文中有身份锚点或 IP 基因，须留下可拍出来的身份词（职业符号、场景档次），勿砍光。",
          "若正文主題明顯與餐食、烹飪無關，不必主動引入廚房、食譜表等構圖；若brief里有食物叙事再保留即可。",
          "请返回 JSON 对象，仅含一个键 brief，例如：{\"brief\":\"...\"}；brief 勿为空。",
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

/** 平台選題單幀：`graphic` / `video` 皆為 **單張竖版 9:16 信息流封面**，須 **生動創意** 並快速勾起 **好奇心**；並含頂級攝影布光、豐富布景道具、主題圖示與簡中輔標、撞色。宽幅 2×4 見 {@link buildVideoStoryboardGeminiPrompt}，八格見 {@link buildXhsNoteGeminiPrompt}。 */
export function buildPlatformTopicReferenceGeminiTask(input: {
  topicHook: string;
  context: string;
  /** `video`：短视频选题 — 仍走單封語義（非多分鏡縱條）；`graphic`：圖文选题單封 */
  variant: "video" | "graphic";
  /** 出镜身份 / IP 基因（中文）；供 GPT 5.4 锁定人設与场景符号，避免仅由单条文案猜测导致漂移 */
  coverPersonaContext?: string;
  /** 信息流超高点击向强化：英文化时额外强调划停、悬念与主标冲击 */
  highFeedCtrBoost?: boolean;
}): string {
  const hook = String(input.topicHook || "").trim().slice(0, 500);
  const ctx = String(input.context || "").trim().slice(0, SCRIPT_SLICE);
  const personaRaw = String(input.coverPersonaContext || "").trim().slice(0, 2000);
  const ctrBoost = Boolean(input.highFeedCtrBoost);
  const personaBlock =
    personaRaw.length > 0
      ? `
【单帧出镜 · 身份参考】（中文僅供參考；英文须写成 **GPT-Image-2 可執行** 的場景與人設符號——光型、服化檔次、道具；不必逐字复译，也無需堆砌莎劇意象）
${personaRaw}

`.trim() + "\n\n"
      : "";
  const isVideo = input.variant === "video";
  const ctrBoostBlock =
    !ctrBoost
      ? ""
      : isVideo
        ? `

SHORT-VIDEO ULTRA-CTR BOOST（本任务专用）:
- The **single hero frame** must read as an aggressive feed **scroll-stop** thumbnail for 「${hook}」—**one** photoreal editorial still: maximal tension/contrast plus **bold dominant+accent palette** (**razor-accent** wedges OK); **visually lively / creative hook** that sparks **curiosity in one glance**; **no** comic strip panels; icons/microcaptions OK if layered under the headline hierarchy.
`.trim()
        : `

ULTRA-HIGH CTR COVER BOOST（本任务专用 · 超高点击率向）:
- Treat this as a **maximum scroll-stop** cover: **vivid staging + creative novelty** landing a **curiosity tap** grounded in Context (no false clickbait); the hero title zone must punch with **bold contrast**.
- **Push** readability + punch further than a standard premium cover: stronger asymmetry, color wedge, or symbol prop when it serves the hook.
`.trim();
  return (
    `
${personaBlock}${
  isVideo
    ? "You are a bilingual cover design director for **short-video discovery thumbnails**—**one vertical 9:16** hero still in **premium advertising/editorial photography** quality: disciplined **motivated studio lighting**, rich **set dressing + props**, **high-impact palette**, readable **hook-sized Simplified-Chinese** hero type, optional **semantic micro-icons / badges / pills** + **supporting CN microcopy**. The frame must feel **conceptually vivid and creatively charged**—a **thumbnail-scale curiosity hook** users want to tap; avoid bland stock composites. **Forbidden:** multi-panel storyboard gutters in one canvas; **Forbidden:** landscape 2×4 sheet here."
    : "You are a bilingual cover design director for **premium vertical feed covers**—**one hero frame**, same photographic bar as short-video: master **motivated editorial lighting**, layered props/environment, **bold readable palette**, icons/ancillary CN lines as fits. Aim **lively staging + creative tension**—a clear **why should I tap** cue at thumbnail size—not a safe bland template. Prefer single-cover readability; don't default LR dual-note chrome unless demanded."
}

${isVideo
  ? "Use Simplified Chinese as the main title language."
  : "Use Simplified Chinese as the main title language, with English allowed as secondary supporting text."}

${isVideo ? `
SHORT-VIDEO SINGLE COVER（軟邊界 · 單張 9:16 封面 · 非分鏡條）
- **版式：** vertical 9:16、**单张**信息流 **预览图**；**唯一主視覺**。
- **攝影寫實 + 大师感布光：** 当代 **广告/杂志静拍**：写清 motivated light — **窗光／柔光箱／轮廓逆光 key–fill–rim**、受控阴影；**勿**贴纸平光糊弄。
- **布景道具：** 「${hook}」+ Context → **具象 set dressing**：前景手部/器物与后景環境都要有 **信息量**，别空布景贴字。
- **高级感：** 材质、服装、場景档次走 **premium editorial**；体面、耐看。
- **图标 + 小字：** **主题咬合**的简单 **象形符号／badge／pill** + **简体辅标副句**（字小一号但清晰）；**绝不能**压住大号主钩子。
- **撞色冲击：** dominant + razor accent／色楔；thumb 級 **scroll-stop**，但别太脏。
- **生動創意：** 避免「信息流安全牌臉」；畫面須有可讀 **好奇心鉤子**（瞬間對撞、未完動作、異常細節、隱喻），讓人用 **一眼**就想點進去看。
- **禁止：** ≥2 分格纵条／漫画格子／2×4 宽幅主表 / 单列里套多分镜连续剧。
- main title based on 「${hook}」
` : `
COVER DESIGN（軟邊界 · 单张竖版信息流封面）
- **版式：** vertical 9:16、单张 hero；別串成多分镜条也别画 2×4。
- **主标 + 场景：** 「${hook}」—**大号简体主标**，配 **大厂静拍級布光** 与 **丰富布景／道具**，像 **一帧可上封面的 editorial still**。
- **光：** motivated lighting 写死在英文 prompt；key/fill/rim 有据可依。
- **图标 + 小字：** Context 允许的 **象形 icon / badge** + **辅标简体**（少而准）；层次：**主标题 > 一切辅元素**。
- **配色：** 高冲击可读；大块面对比拉出主标题。
- **創意張力：** 構圖有 **新意**／小驚喜，能快速挑起 **好奇**（不是標題騙點）。
- **身份 / 离奇素材：** 身份自然对齐 Context；離題題材別硬拗。
- main title based on 「${hook}」
`}

Context:
${ctx}
${ctrBoostBlock ? `\n${ctrBoostBlock}\n` : ""}
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
 * 探索 / 極速：Vertex AI **Gemini 3 Flash Preview** + `responseMimeType: application/json`。
 * `temperature` 見 {@link resolveVertexFlashTranslationTemperature}（預設 0.9，偏創意）；`thinkingConfig` 見 {@link resolveVertexFlashThinkingConfigForSdk}（預設思考層級 **HIGH**）；`maxOutputTokens` 見 {@link resolveVertexFlashTranslationMaxOutputTokens}（預設 **32768**）。
 * 區域見 {@link resolveVertexFlashTranslationLocation}（預設 **global**；可用環境變數改）。
 * 模型預設 {@link DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL}，可用 `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` 覆寫。
 * **最多 3 次**：第 1 次立即；若異常或無有效 prompt → 等 **3s** 再第 2 次；仍失敗 → 等 **6s** 再第 3 次。
 * **三次仍失敗** → **fallback {@link callGemini3_1_Pro_AiStudio}（OpenAI GPT 5.4，同樣最多 3 輪，且不再回呼 Vertex）**。
 * @param opts.compositeTranslationStrict 分鏡/八格專用：GPT 三輪仍失敗時改 **拋出** {@link PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}。
 */
export async function callVertexGeminiFlashTranslation(
  translationTask: string,
  flowLog?: string[],
  opts?: { compositeTranslationStrict?: boolean; pipelineStatCtx?: Gpt54PlatformImagePromptStatCtx },
): Promise<string> {
  const task = String(translationTask || "").trim();
  if (!task) {
    appendVertexFlashDebug(flowLog, `輸入 task 為空 → 中止`);
    throw new Error("Vertex Flash 翻译：上游 task 为空");
  }

  let project: string;
  try {
    project = resolveVertexProjectIdForGenAi();
  } catch (e) {
    appendVertexFlashDebug(flowLog, `resolveVertexProjectId 失敗: ${formatErrForVertexDebug(e)}`);
    throw e instanceof Error ? e : new Error(String(e));
  }

  const location = resolveVertexFlashTranslationLocation();
  const model = resolveVertexFlashTranslationModelName();
  const authOpts = buildGoogleGenAiAuthOptionsFromEnv();
  const authMode = authOpts ? "GOOGLE_APPLICATION_CREDENTIALS_JSON(service_account)" : "ADC/運行環境默認憑證";

  appendVertexFlashDebug(
    flowLog,
    `── Flash Live 英文化開始 ── project=${project} · location=${location} · model=${model} · auth=${authMode}`,
  );
  const flashTemp = resolveVertexFlashTranslationTemperature();
  const flashThinking = resolveVertexFlashThinkingConfigForSdk();
  const flashMaxOut = resolveVertexFlashTranslationMaxOutputTokens();
  appendVertexFlashDebug(
    flowLog,
    `請求參數 · responseMimeType=application/json · maxOutputTokens=${flashMaxOut} · temperature=${flashTemp} · thinkingConfig=${
      flashThinking.thinkingConfig ? JSON.stringify(flashThinking.thinkingConfig) : "(未設定)"
    } · task 約 ${task.length} 字`,
  );

  /** Gemini 3 Flash：`systemInstruction` 首段與 {@link callGemini3_1_Pro_AiStudio} 共用 {@link PLATFORM_IMAGE_TRANSLATOR_BASE_EN}，邏輯與 GPT‑5.4 英文化一致。 */
  const systemInstruction = [
    PLATFORM_IMAGE_TRANSLATOR_BASE_EN,
    "你是頂級中英雙語編導：**產出 JSON 內英文 prompt，唯一消費方是 GPT-IMAGE-2**；Vertex / Gemini 路徑僅為「參照翻譯與壓縮」，不得壓過可執行版式。",
    "把上游任務落成 **JSON 里的英文 prompt**；**优先** tags / 短語，必要時用 **編號短句** 锁主体、光、留白、簡中字。**篇幅不限**，以一次生圖成功為準。",
    "在滿足上游**版式軌道**（單封 / 多分鏡條 / 2×4 網格等）的前提下發揮光影；避免只有文采而沒有布局。",
    "**單張豎封**：写清 **motivated editorial / premium ad-still lighting（key–fill–rim 有据）**、布景与道具层次；**畫內簡中大標** 与可选 **语义相关小图标 / badge / pill + 简体辅标微文案**（層級低于主標）；**撞色/對比**要强但耐看；**一眼好奇**——构图有创意张力或小悬念，让读者想进一步了解；Context 落成 **可拍场景**；身份块→ **戏剧化出场**，非履历条列。",
    "必須返回合法 JSON：{\"prompt\":\"...\"}；prompt 內只含英文生圖指令，不要 markdown、不要解釋。",
    "須含 masterpiece、8k；寫清情緒、燈光、場景、主體；網格類任務（2×2 / 2×4）須保留格數、閱讀順序與格線硬信息。**電影 2×4 分鏡主表**頂欄僅 **內容總結**，每格內 **分鏡主題描述** 與表 **景別/運鏡/畫面內容/台詞與音效**；單張 9:16 封面則偏單一主視覺，避免寫成多格分鏡，除非任務明確要求。",
    "若上游封面/科普正文未出現食物，不必畫食譜、廚房、食材表。",
  ].join("\n");

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
      ...flashThinking,
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
    throw new Error("Vertex Flash 翻译：模型未返回有效 prompt（JSON prompt 字段为空且无法从响应文本恢复）");
  };

  let lastFailure: unknown = null;
  for (let i = 0; i < 3; i++) {
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
      appendVertexFlashDebug(flowLog, `[Flash·翻译] 第 ${i + 1}/3 次失败 · ${formatErrForVertexDebug(e)}`);
    }
  }

  appendVertexFlashDebug(flowLog, `[Flash·翻译] 已 3 次仍失败 · ${formatErrForVertexDebug(lastFailure)}`);
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
 * 舊名保留：平台「探索」英文化走 {@link callVertexGeminiFlashTranslation}（Flash Live Preview · 失敗 3 次後 GPT 5.4）。
 */
export async function callVertexGemini31ProForImagePrompt(translationTask: string, flowLog?: string[]): Promise<string> {
  return callVertexGeminiFlashTranslation(translationTask, flowLog, undefined);
}

/** 與 {@link callVertexGemini31ProForImagePrompt} 相同，便於對照文檔命名。 */
export async function callVertexGemini31ProTranslation(prompt: string): Promise<string> {
  return callVertexGemini31ProForImagePrompt(prompt);
}

/**
 * 平台生图英文化：**OpenAI（預設 gpt-5.4，與 Stage 2 長文 gpt-5.5 分離）** 最多 3 次。
 * 三次仍無有效英文 → 非避險且未設 `skipVertexFallback` 時改走 Vertex Flash；**不再**偽裝可用 prompt：GCP 避險、`skipVertexFallback`、Vertex 兜底失敗等一律 **拋錯**（用戶向 {@link PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}）。
 * `skipVertexFallback`：由 {@link callVertexGeminiFlashTranslation} 在 Flash 三輪後呼叫，避免再次打 Vertex。
 * `compositeTranslationStrict`：分鏡/八格英文化；GPT 三輪盡力後不發 Vertex，直接拋 {@link PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}。
 */
export async function callGemini3_1_Pro_AiStudio(
  prompt: string,
  flowLog?: string[],
  statCtx?: Gpt54PlatformImagePromptStatCtx,
  opts?: { skipVertexFallback?: boolean; compositeTranslationStrict?: boolean },
): Promise<string> {
  const skipVertexFallback = Boolean(opts?.skipVertexFallback);
  const compositeTranslationStrict = Boolean(opts?.compositeTranslationStrict);
  /** 英文化走較廉價預設；勿改 gpt-5.5（多輪重試費用高）。Stage 2 見 {@link getPlatformStage2OpenAiModel} */
  const modelName =
    process.env.OPENAI_GPT54_MODEL?.trim() || process.env.OPENAI_PLATFORM_IMAGE_TRANSLATION_MODEL?.trim() || "gpt-5.4";
  const gpt54MaxOut = Math.min(
    65_536,
    Math.max(4096, Number(process.env.GPT54_PLATFORM_IMAGE_TRANSLATION_MAX_TOKENS) || 16_384),
  );
  const taskChars = String(prompt || "").length;

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
          content: [
            PLATFORM_IMAGE_TRANSLATOR_BASE_EN,
            "你是一位双语视觉编导：**上游中文僅作參照**；把任务收成 **一条** 可直接给 GPT-IMAGE-2 的 **英文** 生图指令（JSON 的 prompt 字段）。",
            "**优先** comma-separated tags / 短語；需要时用 **编号短句** 把版式、主体、光型、留白、简中标题规格写清。**不设字符上限**，以一次生图能忠实执行 GPT-Image-2 为第一优先级。",
            "**竖版单封**：**先**锁 **简中标题**（位置、字重、撞色/楔形点缀）及可选 **象形小图标 + 简体辅标**（次级）；写清 **广告静拍級 motivated lighting（key/fill/rim）**、布景道具密度；整体须 **conceptually vivid**、带 **thumbnail-level curiosity**，让用户想进一步了解；再把 Context **落成可拍写实场景**；人设 → **art-directed** 出场，非散文复述。",
            "**2×4 分镜主表**（若上游为分镜表）：英文 **prompt** 须明确版式 — **全表最上一行通栏**仅 **全文内容总结**（整片梗概作主主题，可带「· 分镜脚本」等后缀）；**不要**把各镜的「分镜主题」写进该顶栏。**每格**自上而下：**分镜主题描述**（该格简中一句）→ 主画面静帧 → 底部简中四列表格，列标题固定为 **景别**、**运镜**、**画面内容**、**台词与音效**。其余画面与光影用英文写清即可。",
            "版式轨道（2×2、2×4、9:16 单封面等）须与上游一致，不要擅自改格数或把单封面写成多格，除非任务明确要求；若有更生动的等价表达且不改变格数/竖横意图，可自行发挥。",
            "须含 masterpiece 与 8k；情绪、灯光、场景、主体与服饰、标题语言（简中大字等）按需写入。",
            "**莎剧式文采**仅在版面与光学已写死后可少量点缀。",
            "请返回合法 JSON：{\"prompt\":\"...\"}；不要解释、不要 markdown。",
          ].join("\n"),
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
      : `[GPT54·翻译] 已 3 次仍失败或为空 → fallback Vertex · 最后 GPT: ${formatErrForVertexDebug(lastFailure)}`,
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
    console.error("[平台英文化] Vertex Flash 三輪後 GPT 5.4 三輪仍失败 ·", summary.slice(0, 500));
    throw new Error(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
  }
  try {
    return await callVertexGeminiFlashTranslation(prompt, flowLog, undefined);
  } catch (vertexErr: unknown) {
    const vDetail = formatErrForVertexDebug(vertexErr);
    const vm = resolveVertexFlashTranslationModelName();
    const vl = resolveVertexFlashTranslationLocation();
    appendVertexFlashDebug(flowLog, `[Vertex·Flash·fallback] 失敗 · ${vDetail}`);
    console.error("[平台英文化] OpenAI 三輪後 Vertex 兜底失敗:", vertexErr instanceof Error ? vertexErr.message : vertexErr);
    appendGpt54TranslationDebug(
      flowLog,
      `[Vertex·Flash·兜底失敗]（${vm}·${vl}）· GPT 摘要: ${summary.slice(0, 400)} · ${PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}`,
    );
    throw new Error(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
  }
}

/**
 * 平台 **選題單幀**：預設 **GPT 5.4**；選 **Vertex 探索** 時先 **Flash**（見 {@link callVertexGeminiFlashTranslation}，三輪後 **GPT 5.4**）。
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
    const statCtx = translator === "vertex_gemini_3_flash_preview" ? undefined : options?.pipelineStatCtx;
    const raw =
      translator === "vertex_gemini_3_flash_preview"
        ? await callVertexGemini31ProForImagePrompt(translationTask, flowLog)
        : await callGemini3_1_Pro_AiStudio(translationTask, flowLog, statCtx);
    const out = stripGeminiModelOutput(raw);
    if (!out) {
      appendGpt54TranslationDebug(flowLog, `[GPT54·崩溃原因] stripGeminiModelOutput 后为空 · label=${label}`);
      throw new Error("[GPT54·崩溃原因] strip 后为空");
    }
    return out;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    appendVertexFlashDebug(flowLog, `callGemini31ProForImagePrompt 抛出 · ${label} · ${formatErrForVertexDebug(error)}`);
    // 複合錯誤（GPT 三輪無效 + Vertex 404 等）已在 callGemini3_1_Pro_AiStudio 排好順序，勿再冠以「Vertex 翻译崩溃」誤導前綴
    if (message.startsWith("【GPT54 已三輪無效】")) {
      throw new Error(`[平台英文化链失败]\n${message}`);
    }
    const vertexFallback =
      message.includes("[Vertex Flash 英文化·GPT 已盡力]") ||
      message.includes("── Vertex API 詳情 ──") ||
      message.includes("[Vertex 英文化失败]") ||
      message.includes("[GPT54·崩溃原因·汇总]");
    const looksLikeVertexApi =
      /publishers\/google\/models|NOT_FOUND|PERMISSION_DENIED|ResourceExhausted|GoogleGenerativeAIError|Vertex AI|vertexai/i.test(
        message,
      );
    const displayLabel =
      vertexFallback || (looksLikeVertexApi && translator === "gpt54")
        ? `Vertex（${vertexModel} · ${vertexLoc}）`
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
}): Promise<string> {
  const flowLog = options.flowLog;
  const compositeStatCtx: Gpt54PlatformImagePromptStatCtx | undefined =
    typeof options.compositeSheetAttempt === "number" &&
    typeof options.compositeSheetMaxAttempts === "number" &&
    Number.isFinite(options.compositeSheetAttempt) &&
    Number.isFinite(options.compositeSheetMaxAttempts) &&
    options.compositeSheetAttempt >= 1
      ? {
          pipeline: "composite_sheet",
          sheetKind: options.kind,
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
  const isStoryboard =
    options.kind === "storyboard_sheet_portrait" || options.kind === "storyboard_sheet_landscape";
  appendVertexFlashDebug(
    flowLog,
    `translatePlatformComposite · kind=${options.kind} · translator=${options.translator ?? "(未指定)"} · engine=${options.engine ?? "n/a"}`,
  );
  const chineseBrief = await extractChineseVisualBrief(options.scriptContext, flowLog);
  const task = isStoryboard
    ? buildVideoStoryboardGeminiPrompt(chineseBrief || options.scriptContext)
    : buildXhsNoteGeminiPrompt(chineseBrief || options.scriptContext);
  appendVertexFlashDebug(flowLog, `已組裝 ${isStoryboard ? "buildVideoStoryboard" : "buildXhsNote"} task · 約 ${task.length} 字`);

  if (isPlatformWeekendSurvivalModeEnabled()) {
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
