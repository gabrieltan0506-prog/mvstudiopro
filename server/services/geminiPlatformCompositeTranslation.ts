import { GoogleGenAI } from "@google/genai";
import { extractJsonString, invokeLLM } from "../_core/llm.js";
import { isPlatformWeekendGcpEscape, PLATFORM_WEEKEND_SURVIVAL_MODE } from "../config/platformSwitches.js";
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
 * 平台英文化 · Flash Live：**預設 `global`**（與 Live 預覽路由一致）。
 * **僅** TestLab 閘道 `api/google?op=vertexTranslate` 內建寫死 `us-central1`；本函數不改成預設 us-central1。
 * 可 `VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION` 覆寫為其他區域。
 */
export function resolveVertexFlashTranslationLocation(): string {
  const loc = String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION || "global").trim();
  return loc || "global";
}

/** Vertex Flash 英文化默认模型（高开通率；可 `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` 覆寫）。 */
export const DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL = "gemini-3-flash-preview";

export function resolveVertexFlashTranslationModelName(): string {
  return String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_MODEL || DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL).trim();
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

/** 平台单帧 / 批量封面 / 宽幅合成：**英文化**引擎（GPT 5.4 默认；`vertex_*` 为 Vertex Flash Live · global）。 */
export type PlatformImagePromptTranslator = "gpt54" | "vertex_gemini_31_pro_preview";

/**
 * **双语编导（Gemini）**：读中文剧本 / 封面文案，产出纯英文视觉 prompt。
 * **GPT-IMAGE-2** 只接收该英文串并生图，不做翻译、不读中文——汉语内容必须由 Gemini 先在 prompt 里用英文规划好（含「画面上简中字」等死命令）。
 */

const SCRIPT_SLICE = 3500;
/** 中文视觉骨架：允许充分保留剧本信息，不再做 220 字硬砍（下游 GPT 5.4 可自主取舍）。 */
const CHINESE_VISUAL_BRIEF_MAX_CHARS = SCRIPT_SLICE;

/** GPT 5.4 翻译大脑：用户定稿的莎士比亚式英文身份（system 首句，与中文规则并用） */
export const GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN =
  "You excel at distilling visual briefs into effective English for GPT Image models: prefer comma-separated tags and noun phrases when it helps; use longer phrasing whenever the brief needs more specificity—do not sacrifice fidelity to hit an arbitrary length.";

/** 小红书 **多页** 图文笔记：**2×4 八格**；產品上≠視頻分鏡——**不要**用製片/DPP 式「情緒·燈光·景別·機位」欄位來組稿。 */
export const XHS_IMAGE_TEXT_NOTE_DIRECTOR_EN = `You compress Xiaohongshu (Little Red Book) **2×4 eight-panel GRAPHIC NOTES** (图文笔记拼圖 / viral note sheet) into **one** English block for GPT Image. Prefer **comma-separated tags and short noun phrases**; **do not** trim the English prompt too aggressively—when the translator goes longer, eight cells breathe and feel **less crowded**; prefer fidelity and clear per-cell beats over brevity.

LAYOUT: strict **2 rows × 4 columns**, **eight** equal cells, row-major (top L→R, then bottom L→R). **Not** a lone hero, **not** 2×2-only.

CONTENT STYLE (**not** a film storyboard): each cell should feel like a **Little Red Book carousel card** — hook lines, bullet takeaways, before/after, step lists, mini diagrams, hashtags, persona tips.

TYPOGRAPHY POLICY: **Simplified Chinese is the primary on-image explanation** (headlines, main bullets, body). **English is allowed as auxiliary**—small keywords,micro-subtags, short secondary hints, stylized accent lines—must stay **secondary** in visual weight vs 中文主解说; do not replace Chinese body copy with English.

**FORBIDDEN for this task:** restructuring the user's copy into **video-production callout tables** (e.g. dedicated rows/columns titled 情绪 / 灯光 / 拍摄环境 / 景别 / 机位 / 分镜表头-style grids). Those belong **only** to the separate **cinematic storyboard** pipeline — do not import that idiom here. Overall palette/vibe may appear as **brief** English tags, not a DP checklist.`;

/** 小红书 2×4 八格：版式约束；输出体例见 {@link MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT}。 */
export const XHS_GRAPHIC_NOTE_2X4_FOOTER = `
TAG:XHS_GRAPHIC_NOTE_2X4_SHEET

【英文生图输出 / OUTPUT — Xiaohongshu **2×4 八格筆記**（单张宽幅 landscape，與分鏡主表同維度）】
1. Output **one** English string; preferred style: **comma-separated tags / 2–5 word phrases**. **No fixed character limit**—longer English is OK: richer staging makes **eight cells** feel **less cramped** and balances information across the grid.
2. LAYOUT (keep explicit): wide ~16:9 landscape master (1536×1024 class), **exactly 8 equal panels**, **2 rows × 4 columns**, rigid cross gutters, read order row1 L→R then row2 L→R, masterpiece, 8k, premium Little Red Book / lifestyle-editorial note aesthetic.
3. **TYPOGRAPHY:** **Primary** on-image copy = **legible 简体中文** in every cell (titles, main lists, hooks). **Optional English** as **secondary** accent only—keywords, micro-subtitles, short tags—smaller weight than Chinese; **do not** make English the main explanation body.
4. **MANDATORY** in **each** cell: note-style density — bullets, icons, badges 01–08, pill tags, mini infographics as fits.**禁止**整页做成電影**分鏡網格註解**（如每格固定「镜头/景别/情绪/灯光/机位」製片表）；那是 **TAG:STORYBOARD_2X4_SHEET** 專用。
5. Avoid (layout): single full-bleed hero for whole canvas; **four-quadrant 2×2 only** (wrong panel count); 50/50 two-panel only; one skinny horizontal row of eight strips; left type band + right single hero (magazine split); 2×3 / 3×2 unless script explicitly needs six cells.
6. Per cell: distinct carousel beat; cohesive palette across the sheet.
`.trim();

/** @deprecated 已升級為八格 2×4；請使用 {@link XHS_GRAPHIC_NOTE_2X4_FOOTER} */
export const XHS_GRAPHIC_NOTE_MIN_4_PAGES_FOOTER = XHS_GRAPHIC_NOTE_2X4_FOOTER;

/** 封面 / 分镜条等：英文以 tags 为主，**不設字數上限**，以利一次生圖成功。 */
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

【英文生图输出 / OUTPUT — cinematic 2×4 storyboard master（单张宽幅 landscape）】
1. Output **one** English block；**prefer** comma-separated tags / short fragments so the 2×4 grid stays obvious.**No character limit**—use more English if eight beats need it.
2. **MANDATORY TOP TITLE STRIP (简体中文) ABOVE THE GRID**: reserve the **top ~8–12%** of the **entire** canvas as a **full-width horizontal title band** with **one prominent main title in legible Simplified Chinese** (系列标题 / 成片主题 / 视频标题—summarize from the script hook). Optional smaller 简体中文 subtitle or kicker under the main line; thin rule or soft divider between this band and the grid. **Do not** place the first row of panels flush against the top edge—**the title band must sit above all eight cells.**
3. LAYOUT below the title band: wide ~16:9 landscape master continues with **exactly 8 equal panels**, **2 rows × 4 columns**, rigid cross gutters, read order row1 L→R then row2 L→R, obvious storyboard / contact-sheet, masterpiece, 8k, intricate cinematic film stills per cell upper area (within each cell).
4. **MANDATORY 简体中文字幕表（讯息分格）inside every panel**: reserve the **bottom ~25–30%** of **each** cell for a **compact Simplified Chinese caption table** (shot breakdown strip): **2–4 short labeled rows** (e.g. 镜头 / 景别, 情绪 / 氛围, 口播要点 or 画面说明)—styled like professional storyboard 「分格说明」or the reference phrase **"Chinese text tables below each image"**; thin grid lines or rules allowed; text must be **legible 简体中文 only** in these tables (no English in the table body). **Do not** leave panels wholly wordless.
5. Upper ~70–75% of each cell (the film-still zone): pure cinematic imagery only (no floating subtitles outside the reserved table band inside that cell).
6. Avoid layouts that break the grid: one full-bleed hero for the whole canvas, **titleless** top (no strip), magazine left-text strip + one photo only, 50/50 two-panel only, or any **four-quadrant-only** note layout — this task is **eight** panels under a **简体中文** header, not four.
`.trim();

/** 平台選題 **圖文單幀封面**：9:16 单帧；**以生圖成功與主體忠實為先**，不設譯文字數上限。 */
const PLATFORM_TOPIC_GRAPHIC_PROMPT_FOOTER = `
【英文生图输出 / OUTPUT — graphic single-frame only】
1. Output **one** English block for GPT-IMAGE-2.**Prefer** comma-separated tags / short phrases; longer text is OK if it locks the cover.**No fixed character limit.**
2. LAYOUT: **9:16 portrait**, single full-bleed hero, one dominant subject—avoid looking like 16:9 landscape or a multi-panel sheet unless the task explicitly asks.
3. Prefer a **single** strong cover beat; avoid storyboard grids, 2×4 strips, numbered panels when this task is one cover image.
4. SUBJECT: align with Hook + Context; skip unrelated generic stock tropes.
5. Include masterpiece, 8k; state Simplified-Chinese headline / on-image copy needs when the brief requires 简中.
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
    appendVertexFlashDebug(flowLog, `[骨架·GPT54] 輸入為空，跳過 extractChineseVisualBrief`);
    return "";
  }

  appendVertexFlashDebug(
    flowLog,
    `[骨架·GPT54] extractChineseVisualBrief 開始 · 輸入約 ${slice.length} 字（上限切片 ${SCRIPT_SLICE}）`,
  );

  try {
  const response = await invokeLLM({
    provider: "openai",
    model: "gpt54",
    modelName: process.env.OPENAI_GPT54_MODEL?.trim() || "gpt-5.4",
    response_format: { type: "json_object" },
    max_tokens: 2048,
    messages: [
      {
        role: "system",
        content: [
          "你是一位像莎士比亚剧场里锤炼台词那样锤炼画面的双语视觉编导：精通语言的节奏与意象，读中文时像读诗一样抓住「最省字、最有画面」的那几笔。",
          "只做一步：从输入里抽出中文「视觉骨架」，不做英文翻译。",
          "在不过度淹没细节的前提下提炼：可保留足够长的关键词与时间线提示；去掉纯解释性废话与空洞修辞；需要完整保留 Hook、身份、核心道具与视觉动作。",
          "保留：情绪、灯光、场景、服装、关键道具、镜头气质、版式提示；若文中有身份锚点或 IP 基因，须留下可拍出来的身份词（职业符号、场景档次），勿砍光。",
          "若正文没有食物/菜谱含义，就不必写厨房、食材表、食谱版式。",
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
    `[骨架·GPT54] 完成 · brief 約 ${out.length} 字 · JSON 解析=${parsed ? "ok" : "失敗(用原始片段推理)"}`,
  );
  return out;
  } catch (e: unknown) {
    appendVertexFlashDebug(flowLog, `[骨架·GPT54] 异常: ${formatErrForVertexDebug(e)}`);
    throw e;
  }
}

/** 横版 2×4 电影级分镜主表：定稿人设见下行英文块（translatePlatformCompositeToEnglishPrompt · storyboard sheet） */
export function buildVideoStoryboardGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return (
    `
You turn the Chinese script into **one English image prompt** for GPT Image. Prefer comma-separated tags / short fragments so the frame reads as **8 panels in 2 rows × 4 columns** with clear gutters—not a single full-bleed poster. Longer English is fine if it helps lock all eight beats.

**Non-negotiable — top title:** the canvas must begin with a **full-width top band (~8–12% height)** containing **one main title in legible Simplified Chinese** (成片 / 系列主题，紧扣剧本钩子)。**All eight storyboard panels sit below this strip**—never flush to the top edge without a 简体中文 header.

**Non-negotiable — panels:** every panel must include a **lower caption zone** with **legible Simplified Chinese** in a **small table / labeled rows** (讯息分格表、分镜说明), same idea as: "Chinese text tables below each image" in cinematic 2×4 reference boards—not optional, not English-only UI.

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

Output ONLY ONE English prompt for GPT-IMAGE-2.

MANDATORY RULES:
1. START EXACTLY WITH: "Luxury strategic intelligence chapter poster, 9:16 vertical, cinematic editorial, dark gold and ink palette, museum-grade lighting."
2. Describe visual scene in English; all prominent typography on the poster MUST be Simplified Chinese only. Hero title must include exactly: 「${t}」.
3. Summarize supporting context from the Chinese passage into English visual staging cues only (do not paste the Chinese paragraph as unreadable microtext). Chinese passage for your analysis:\n${c}
4. OUTPUT: English prompt only, no chitchat.
`.trim();
}

/** 平台選題單幀：`graphic`＝单张竖版**封面**（非小红书 2×4 八格筆記）；`video`＝竖版 9:16 多分镜**条**（非横版 2×4 主表；宽幅 2×4 见 {@link buildVideoStoryboardGeminiPrompt} / {@link buildXhsNoteGeminiPrompt}）。 */
export function buildPlatformTopicReferenceGeminiTask(input: {
  topicHook: string;
  context: string;
  /** `video`：短影音竖版多分镜参考条；`graphic`：仅竖版单张封面 */
  variant: "video" | "graphic";
  /** 出镜身份 / IP 基因（中文）；供 GPT 5.4 锁定人設与场景符号，避免仅由单条文案猜测导致漂移 */
  coverPersonaContext?: string;
}): string {
  const hook = String(input.topicHook || "").trim().slice(0, 500);
  const ctx = String(input.context || "").trim().slice(0, SCRIPT_SLICE);
  const personaRaw = String(input.coverPersonaContext || "").trim().slice(0, 2000);
  const personaBlock =
    personaRaw.length > 0
      ? `
【单帧出镜 · 身份锚定】（英文 tags 须体现可视觉化身份与场景档次；封面单帧与竖版分镜条均适用）
${personaRaw}

`.trim() + "\n\n"
      : "";
  const isVideo = input.variant === "video";
  return (
    `
${personaBlock}${
  isVideo
    ? "You are a bilingual visual prompt director who specializes in vertical 9:16 multi-panel storyboard strips for short-form video—clear gutters between panels, shot progression and rhythm, not a landscape 2x4 master sheet."
    : "You are a bilingual cover design director who specializes in premium single-image vertical covers with strong click appeal and high-end visual impact (this task is cover-only, not Xiaohongshu dual-card image-text notes)."
}

${isVideo
  ? "Use Simplified Chinese as the main title language."
  : "Use Simplified Chinese as the main title language, with English allowed as secondary supporting text."}

${isVideo ? `
VERTICAL 9:16 STORYBOARD STRIP (not 2x4 landscape):
- vertical 9:16
- multi-panel storyboard strip
- at least 3 separated frames
- gutters between panels
- short-form video beats
- not single full-bleed poster
- main title based on 「${hook}」
` : `
COVER DESIGN ONLY:
- **9:16 portrait mandatory** — never 16:9 landscape, never square 1:1 as the outer frame; one tall vertical cover only.
- vertical 9:16
- single-image cover
- single dominant hero subject
- premium editorial portrait or scene
- strong focal point
- not multi-panel storyboard
- not dual-card layout
- not Xiaohongshu note
- not checklist
- not bullet list
- not account UI
- not comment bar
- The image must behave like a high-click cover, not an image-text note.
- FORBIDDEN LAYOUTS (even if trendy): storyboard grids, 2×4 panels, eight-panel montage, numbered scene strips, comic gutters, film contact-sheet layout, "救赎/逆袭" generic businessman arcs unrelated to the medical hook.
- ANTI-HALLUCINATION: The scene MUST match the themes of the hook 「${hook}」and Context (e.g. medicine, doctor persona, study, books, journal props, landscape art, wellness). If an identity anchor block appears above, the on-camera subject, wardrobe, props, and environment tier MUST align with it. Unless the hook or Context clearly names food, cooking, recipes, ingredients, or specific dishes, DO NOT show: kitchens, recipe infographics, ingredient grids, cooking steps, noodle bowls, restaurant plating, or dual-column recipe lesson layouts.
- main title based on 「${hook}」
`}

Context:
${ctx}
`.trim() +
    "\n\n" +
    (isVideo ? MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT : PLATFORM_TOPIC_GRAPHIC_PROMPT_FOOTER)
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
 * 探索 / 極速：Vertex AI **Gemini 3.1 Flash Live Preview** + `responseMimeType: application/json`。
 * 區域見 {@link resolveVertexFlashTranslationLocation}（預設 **global**；可用環境變數改）。
 * 模型預設 {@link DEFAULT_VERTEX_FLASH_TRANSLATION_MODEL}，可用 `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` 覆寫。
 * **最多 3 次**：第 1 次立即；若異常或無有效 prompt → 等 **3s** 再第 2 次；仍失敗 → 等 **6s** 再第 3 次。三次仍失敗則拋錯。
 */
export async function callVertexGeminiFlashTranslation(translationTask: string, flowLog?: string[]): Promise<string> {
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
  appendVertexFlashDebug(
    flowLog,
    `請求參數 · responseMimeType=application/json · maxOutputTokens=4096 · temperature=0.6 · task 約 ${task.length} 字`,
  );

  const systemInstruction = [
    GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
    "你是頂級中英雙語編導，也是頂級視覺提示詞導演。",
    "把上游任務落成 **JSON 里的英文 prompt**，供 GPT-IMAGE-2 使用；**优先** tags / 短語，**篇幅不限**，以版式與主體一次說清、利於生圖成功為準。",
    "必須返回合法 JSON：{\"prompt\":\"...\"}；prompt 內只含英文生圖指令，不要 markdown、不要解釋。",
    "須含 masterpiece、8k；寫清情緒、燈光、場景、主體；網格類任務（2×2 / 2×4）須保留格線硬信息。單張 9:16 封面時避免寫成多格分鏡，除非任務明確要求。",
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
    const response = await ai.models.generateContent({
      model,
      contents: `请返回 JSON：{"prompt":"..."}。\n${task}`,
      config: {
        systemInstruction,
        responseMimeType: "application/json",
        temperature: 0.6,
        topP: 0.95,
        maxOutputTokens: 4096,
      },
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
  console.error(`[Vertex GenAI ${resolveVertexFlashTranslationModelName()} 翻译异常 · ${resolveVertexFlashTranslationLocation()}]:`, lastFailure);
  throw lastFailure instanceof Error ? lastFailure : new Error(String(lastFailure));
}

/**
 * 舊名保留：平台「探索」英文化走 {@link callVertexGeminiFlashTranslation}（Flash Live Preview · 預設 global）。
 */
export async function callVertexGemini31ProForImagePrompt(translationTask: string, flowLog?: string[]): Promise<string> {
  return callVertexGeminiFlashTranslation(translationTask, flowLog);
}

/** 與 {@link callVertexGemini31ProForImagePrompt} 相同，便於對照文檔命名。 */
export async function callVertexGemini31ProTranslation(prompt: string): Promise<string> {
  return callVertexGemini31ProForImagePrompt(prompt);
}

/** GPT 三輪無效且 GCP 停權時：跳過 Vertex Flash，返回可送 strip 的英文應急指令（避免 403/帳單錯誤）。 */
function buildEmergencyEnglishPrompt(prompt: string, flowLog?: string[]): string {
  appendGpt54TranslationDebug(
    flowLog,
    "[GCP避險] GPT 三輪無可用輸出 · 跳過 Vertex Flash · 使用應急英文包裝（計費恢復後請關閉 PLATFORM_WEEKEND_GCP_ESCAPE）",
  );
  const t = String(prompt || "").trim();
  const body = t.length > 14_000 ? `${t.slice(0, 14_000)}\n…(emergency trim)` : t;
  return [
    "Single English image-generation instruction. Emergency mode: GCP Vertex skipped (billing suspended).",
    "masterpiece, 8k, editorial or cinematic luxury; translate the creative brief below into pixels (keep layout grid intent if the brief describes 2×4 / 2×2 / 9:16).",
    body,
  ].join("\n\n");
}

/**
 * 平台生图英文化：**OpenAI（預設 gpt-5.4，與 Stage 2 長文 gpt-5.5 分離）** 最多 3 次。
 * 三次仍無有效英文 → 非避險時改走 Vertex Flash；避險 / Vertex 失敗時改 **應急英文**。
 */
export async function callGemini3_1_Pro_AiStudio(
  prompt: string,
  flowLog?: string[],
  statCtx?: Gpt54PlatformImagePromptStatCtx,
): Promise<string> {
  /** 英文化走較廉價預設；勿改 gpt-5.5（多輪重試費用高）。Stage 2 見 {@link getPlatformStage2OpenAiModel} */
  const modelName =
    process.env.OPENAI_GPT54_MODEL?.trim() || process.env.OPENAI_PLATFORM_IMAGE_TRANSLATION_MODEL?.trim() || "gpt-5.4";
  const gpt54MaxOut = Math.min(
    16_384,
    Math.max(4096, Number(process.env.GPT54_PLATFORM_IMAGE_TRANSLATION_MAX_TOKENS) || 8192),
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
            GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
            "你是一位双语视觉编导：把上游任务收成 **一条** 可直接给 GPT-IMAGE-2 的 **英文** 生图指令（JSON 的 prompt 字段）。",
            "**优先** comma-separated tags / 短語；需要时用更长英文把版式、主体、简中标题要求说清楚。**不设字符上限**，以一次生图能忠实执行任务为第一优先级。",
            "版式信息（2×2、2×4、9:16 单封面等）必须与上游一致，不要擅自改格数或把单封面写成多格，除非任务明确要求。",
            "须含 masterpiece 与 8k；情绪、灯光、场景、主体与服饰、标题语言（简中大字等）按需写入。",
            "请返回合法 JSON：{\"prompt\":\"...\"}；不要解释、不要 markdown。",
            "若上游是封面/科普而正文未出现食物，就不必画食谱、厨房、食材表。",
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
    `[GPT54·翻译] 已 3 次仍失败或为空 → fallback Vertex · 最后 GPT: ${formatErrForVertexDebug(lastFailure)}`,
  );
  if (isPlatformWeekendGcpEscape()) {
    appendGpt54TranslationDebug(flowLog, "[GCP避險] 三周無可用英文 · 跳過 Vertex · 應急英文包裝");
    return buildEmergencyEnglishPrompt(prompt, flowLog);
  }
  try {
    return await callVertexGeminiFlashTranslation(prompt, flowLog);
  } catch (vertexErr: unknown) {
    const vDetail = formatErrForVertexDebug(vertexErr);
    const vm = resolveVertexFlashTranslationModelName();
    const vl = resolveVertexFlashTranslationLocation();
    appendVertexFlashDebug(flowLog, `[Vertex·Flash·fallback] 失敗 · ${vDetail}`);
    console.error("[平台英文化] OpenAI 三輪後 Vertex 兜底失敗:", vertexErr instanceof Error ? vertexErr.message : vertexErr);
    console.error("🚨 改走應急英文 prompt，避免整條生圖管線中斷（見 imageGenFlowLog）");
    appendGpt54TranslationDebug(
      flowLog,
      `[應急] Vertex 兜底失敗（${vm}·${vl}）· ${summary.slice(0, 400)} → buildEmergencyEnglishPrompt`,
    );
    return buildEmergencyEnglishPrompt(prompt, flowLog);
  }
}

/**
 * 平台 2×4 / 小紅書合成與選題單幀：預設 **GPT 5.4**；選 **Vertex 探索** 時走 **Flash Live Preview（預設 global）**。
 * 戰略封面 / 章節扉頁文案仍走 `runGemini31ProPreviewText` → Vertex（見 `buildStrategicCoverGeminiTask`）。
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
  if (billingEscape && requested === "vertex_gemini_31_pro_preview") {
    appendGpt54TranslationDebug(
      flowLog,
      "[GCP避險] 英文化已從 Vertex 探索強制改為 GPT 5.4 路徑（避免調用 Vertex Flash）",
    );
  }
  const vertexModel = resolveVertexFlashTranslationModelName();
  const vertexLoc = resolveVertexFlashTranslationLocation();
  const label =
    translator === "vertex_gemini_31_pro_preview"
      ? `Vertex @google/genai · ${vertexModel} · ${vertexLoc}（JSON）`
      : "GPT 5.4（OpenAI）";
  try {
    const statCtx = translator === "vertex_gemini_31_pro_preview" ? undefined : options?.pipelineStatCtx;
    const raw =
      translator === "vertex_gemini_31_pro_preview"
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
  /** A/B：預設 GPT 5.4；與 {@link engine} 併用時以 engine 為準 */
  translator?: PlatformImagePromptTranslator;
  /** A/B：`gemini31flash` 強制走 Flash Live（預設 global）；`gpt54` 強制 GPT 5.4 */
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
  const isStoryboard =
    options.kind === "storyboard_sheet_portrait" || options.kind === "storyboard_sheet_landscape";
  appendVertexFlashDebug(
    flowLog,
    `translatePlatformComposite · kind=${options.kind} · translator=${options.translator ?? "(默認 gpt54)"} · engine=${options.engine ?? "n/a"}`,
  );
  const chineseBrief = await extractChineseVisualBrief(options.scriptContext, flowLog);
  const task = isStoryboard
    ? buildVideoStoryboardGeminiPrompt(chineseBrief || options.scriptContext)
    : buildXhsNoteGeminiPrompt(chineseBrief || options.scriptContext);
  appendVertexFlashDebug(flowLog, `已組裝 ${isStoryboard ? "buildVideoStoryboard" : "buildXhsNote"} task · 約 ${task.length} 字`);

  if (PLATFORM_WEEKEND_SURVIVAL_MODE) {
    appendVertexFlashDebug(
      flowLog,
      "[生存模式] 強制 OpenAI 英文化鏈（忽略 engine / translator 選項）",
    );
    return callGemini31ProForImagePrompt(task, gptImgBridgeOpts("gpt54"));
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
    return callVertexGeminiFlashTranslation(task, flowLog);
  }
  if (options.engine === "gpt54") {
    console.log("[platformComposite] engine=gpt54 → GPT 5.4");
    return callGemini31ProForImagePrompt(task, gptImgBridgeOpts("gpt54"));
  }

  return callGemini31ProForImagePrompt(task, gptImgBridgeOpts(options.translator ?? "gpt54"));
}
