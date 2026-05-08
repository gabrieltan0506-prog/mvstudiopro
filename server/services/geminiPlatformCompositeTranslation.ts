import { GoogleGenAI } from "@google/genai";
import { extractJsonString, invokeLLM } from "../_core/llm.js";

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
 * 平台英文化 · Flash Live Preview：**強制 us-central1**（preview 模型勿用 global；見 product 說明）。
 * 可用 `VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION` 覆寫，預設 `us-central1`。
 */
function resolveVertexFlashTranslationLocation(): string {
  const loc = String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION || "us-central1").trim();
  return loc || "us-central1";
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

/** 平台单帧 / 批量封面 / 宽幅合成：**英文化**引擎（GPT 5.4 默认；`vertex_*` 为 Vertex Flash Live · us-central1）。 */
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
2. LAYOUT: wide ~16:9 landscape master, **exactly 8 equal panels**, **2 rows × 4 columns**, rigid cross gutters, read order row1 L→R then row2 L→R, obvious storyboard / contact-sheet, masterpiece, 8k, intricate cinematic film stills per cell upper area.
3. **MANDATORY 简体中文字幕表（讯息分格）inside every panel**: reserve the **bottom ~25–30%** of **each** cell for a **compact Simplified Chinese caption table** (shot breakdown strip): **2–4 short labeled rows** (e.g. 镜头 / 景别, 情绪 / 氛围, 口播要点 or 画面说明)—styled like professional storyboard 「分格说明」or the reference phrase **"Chinese text tables below each image"**; thin grid lines or rules allowed; text must be **legible 简体中文 only** in these tables (no English in the table body). **Do not** leave panels wholly wordless.
4. Upper ~70–75% of each cell: pure cinematic imagery only (no floating subtitles outside the reserved table band).
5. Avoid layouts that break the grid: one full-bleed hero for the whole canvas, magazine left-text strip + one photo only, 50/50 two-panel only, or any **four-quadrant-only** note layout — this task is **eight** panels, not four.
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

const EMERGENCY_EN_STORYBOARD_2X4 =
  "Wide landscape 16:9 cinematic 2x4 storyboard master, EXACTLY 8 equal panels 2 rows x 4 columns, rigid cross gutters, distinct dramatic film still in upper 70% of each cell, bottom 25-30% each cell compact legible Simplified Chinese caption table (讯息分格) 2-4 short rows, masterpiece, 8k";

const EMERGENCY_EN_XHS_2X4 =
  "Xiaohongshu premium graphic note, wide landscape 16:9, EXACTLY 8 equal panels 2 rows x 4 columns, rigid gutters, row-major carousel order, each cell Simplified Chinese primary copy headlines lists icons pill tags infographic beats optional small English auxiliary keywords only masterpiece 8k";

/** 仅当任务**明确**要小红书多格笔记且未否定小红书时，才走紧急预案（避免 COVER 模板里 “not Xiaohongshu note” 误触发食谱卡）。版式與分鏡一致為 **2×4 八格**。 */
export function buildEmergencyEnglishPrompt(task: string): string {
  const t = String(task || "");
  const lower = t.toLowerCase();
  const forbidsXhsNote = /\bnot\s+xiaohongshu\b/i.test(t) || /\bno\s+xiaohongshu\b/i.test(t);

  /**
   * 分镜主表 footer 含「禁止仅四格」等措辞时可能出现 **2×2** 字样；TAG 与 2×4 / eight panels 必须先于 2×2 探针判定。
   */
  if (/TAG:STORYBOARD_2X4_SHEET/i.test(t)) {
    return EMERGENCY_EN_STORYBOARD_2X4;
  }
  if (/TAG:XHS_GRAPHIC_NOTE_2X4_SHEET/i.test(t)) {
    return EMERGENCY_EN_XHS_2X4;
  }
  /** 勿用裸关键词 storyboard：图文单帧任务里会出现「not multi-panel storyboard」仅此就会误触 2×4。 */
  const wantsLandscape2x4 =
    lower.includes("2x4") ||
    lower.includes("2×4") ||
    /\b8[\s-]*panels?\b/i.test(lower) ||
    /\bcinematic\s+2[\sx×]*4\b/i.test(lower) ||
    /\b2\s+rows\s*[×x]\s*4\s+columns\b/i.test(lower);
  if (wantsLandscape2x4) {
    const xhsHint =
      /little red book|xiaohongshu_dual_note|xiaohongshu|小红书|TAG:XHS_GRAPHIC_NOTE/i.test(t);
    return xhsHint ? EMERGENCY_EN_XHS_2X4 : EMERGENCY_EN_STORYBOARD_2X4;
  }

  const explicitDualNote =
    lower.includes("dual-note") ||
    lower.includes("dual_note") ||
    lower.includes("xiaohongshu_dual_note") ||
    /双卡|雙卡/.test(t) ||
    /四宫格|四宮格/.test(t) ||
    /\b2\s*[×x]\s*2\b/i.test(t) ||
    /\b2x2\b/i.test(lower);
  if (explicitDualNote && !forbidsXhsNote) {
    return EMERGENCY_EN_XHS_2X4;
  }
  const wantsPlatformVerticalCover =
    /COVER DESIGN ONLY/i.test(t) ||
    /graphic single-frame only/i.test(t) ||
    (/vertical\s*9\s*:\s*16/i.test(t) && /single-image cover/i.test(lower));
  if (wantsPlatformVerticalCover) {
    return "Premium vertical 9:16 portrait cover, single full-bleed hero scene, editorial high contrast, legible Simplified Chinese headline, masterpiece, 8k, strictly taller-than-wide frame not landscape";
  }
  return "Editorial cover, premium focal subject, high contrast lighting, luxury palette, legible Simplified Chinese headline, warm title color, masterpiece, 8k";
}

export async function extractChineseVisualBrief(rawContext: string): Promise<string> {
  const slice = String(rawContext || "").trim().slice(0, SCRIPT_SLICE);
  if (!slice) return "";

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
  return brief.slice(0, CHINESE_VISUAL_BRIEF_MAX_CHARS);
}

/** 横版 2×4 电影级分镜主表：定稿人设见下行英文块（translatePlatformCompositeToEnglishPrompt · storyboard sheet） */
export function buildVideoStoryboardGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return (
    `
You turn the Chinese script into **one English image prompt** for GPT Image. Prefer comma-separated tags / short fragments so the frame reads as **8 panels in 2 rows × 4 columns** with clear gutters—not a single full-bleed poster. Longer English is fine if it helps lock all eight beats.

**Non-negotiable:** every panel must include a **lower caption zone** with **legible Simplified Chinese** in a **small table / labeled rows** (讯息分格表、分镜说明), same idea as: "Chinese text tables below each image" in cinematic 2×4 reference boards—not optional, not English-only UI.

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
 * **區域鎖定 us-central1**（見 {@link resolveVertexFlashTranslationLocation}），不可用 global，以免 preview 路由到無配額節點。
 * 模型預設 `gemini-3.1-flash-live-preview`，可用 `VERTEX_GEMINI_FLASH_TRANSLATION_MODEL` 覆寫。
 * 失敗時回落至 {@link buildEmergencyEnglishPrompt}。
 */
export async function callVertexGeminiFlashTranslation(translationTask: string): Promise<string> {
  const task = String(translationTask || "").trim();
  if (!task) {
    return buildEmergencyEnglishPrompt("");
  }

  const project = resolveVertexProjectIdForGenAi();
  const location = resolveVertexFlashTranslationLocation();
  const model = String(
    process.env.VERTEX_GEMINI_FLASH_TRANSLATION_MODEL || "gemini-3.1-flash-live-preview",
  ).trim();
  const authOpts = buildGoogleGenAiAuthOptionsFromEnv();

  const systemInstruction = [
    GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
    "你是頂級中英雙語編導，也是頂級視覺提示詞導演。",
    "把上游任務落成 **JSON 里的英文 prompt**，供 GPT-IMAGE-2 使用；**优先** tags / 短語，**篇幅不限**，以版式與主體一次說清、利於生圖成功為準。",
    "必須返回合法 JSON：{\"prompt\":\"...\"}；prompt 內只含英文生圖指令，不要 markdown、不要解釋。",
    "須含 masterpiece、8k；寫清情緒、燈光、場景、主體；網格類任務（2×2 / 2×4）須保留格線硬信息。單張 9:16 封面時避免寫成多格分鏡，除非任務明確要求。",
    "若上游封面/科普正文未出現食物，不必畫食譜、廚房、食材表。",
  ].join("\n");

  try {
    const ai = new GoogleGenAI({
      vertexai: true,
      project,
      location,
      ...(authOpts ? { googleAuthOptions: authOpts } : {}),
    });

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

    const raw = String(response.text ?? "").trim();
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = JSON.parse(extractJsonString(raw)) as Record<string, unknown>;
    } catch {
      parsed = null;
    }
    const fromPrompt = String(parsed?.prompt ?? "").trim();
    if (fromPrompt) {
      return fromPrompt;
    }
    const stripped = stripGeminiModelOutput(raw);
    if (stripped && !stripped.startsWith("{")) {
      return stripped;
    }
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[Vertex GenAI gemini-3.1-flash-live-preview 翻译异常 · us-central1]:", msg);
  }

  return buildEmergencyEnglishPrompt(task);
}

/**
 * 舊名保留：平台「探索」英文化現已改走 {@link callVertexGeminiFlashTranslation}（Flash Live Preview · us-central1），不再使用 global 3.1 Pro。
 */
export async function callVertexGemini31ProForImagePrompt(translationTask: string): Promise<string> {
  return callVertexGeminiFlashTranslation(translationTask);
}

/** 與 {@link callVertexGemini31ProForImagePrompt} 相同，便於對照文檔命名。 */
export async function callVertexGemini31ProTranslation(prompt: string): Promise<string> {
  return callVertexGemini31ProForImagePrompt(prompt);
}

/**
 * 兼容旧调用名：
 * 原本此函数走 Gemini 3.1 Pro / AI Studio 作为平台生图翻译大脑。
 * 现已切换为 OpenAI GPT 5.4，但保留函数名与文件名，避免改动调用方。
 */
export async function callGemini3_1_Pro_AiStudio(prompt: string): Promise<string> {
  const primaryResponse = await invokeLLM({
    provider: "openai",
    model: "gpt54",
    modelName: process.env.OPENAI_GPT54_MODEL?.trim() || "gpt-5.4",
    response_format: { type: "json_object" },
    // 與 fallback 同級額度：標籤式仍可能很長（八格分鏡），過低會截斷 JSON/prompt，間接傷害生圖效果
    max_tokens: 4096,
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

  const raw = String(primaryResponse.choices[0]?.message?.content || "").trim();
  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = JSON.parse(extractJsonString(raw));
  } catch {
    parsed = null;
  }

  const output = String(parsed?.prompt || raw).trim();
  if (output) {
    return output;
  }

  const fallbackMessages = [
    {
      role: "system" as const,
      content: [
        GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
        "你是一位莎士比亚式的双语舞台导演：精通诗性与节奏，把庞杂内容落成英文生图指令。",
        "篇幅不设上限，以保证画面与任务一致为第一优先级；须含 masterpiece 与 8k。",
        "若上游含平台選題單幀封面 / COVER DESIGN / graphic single-frame，须锁定 **9:16 竖版**，不得写成 16:9 或 1:1。",
        "必须返回合法 JSON：{\"prompt\":\"...\"}。",
        "若正文未写食物/菜谱，就不要画食谱厨房；其余从简。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `请返回 JSON：{"prompt":"..."}。\n将下面内容翻译成完整、可用的英文生图指令（需要多长写多长）：\n${prompt}`,
    },
  ];

  const fallbackResponse = await invokeLLM({
    provider: "openai",
    model: "gpt54",
    modelName: process.env.OPENAI_GPT54_MODEL?.trim() || "gpt-5.4",
    response_format: { type: "json_object" },
    max_tokens: 4096,
    messages: fallbackMessages,
  });

  const fallbackRaw = String(fallbackResponse.choices[0]?.message?.content || "").trim();
  let fallbackParsed: Record<string, unknown> | null = null;
  try {
    fallbackParsed = JSON.parse(extractJsonString(fallbackRaw));
  } catch {
    fallbackParsed = null;
  }

  const fallbackOutput = String(
    fallbackParsed?.prompt || fallbackParsed?.output || fallbackParsed?.text || fallbackRaw,
  ).trim();
  if (fallbackOutput) {
    return fallbackOutput;
  }

  return buildEmergencyEnglishPrompt(prompt);
}

/**
 * 平台 2×4 / 小紅書合成與選題單幀：預設 **GPT 5.4**；選 **Vertex 探索** 時走 **Flash Live Preview（us-central1）**。
 * 戰略封面 / 章節扉頁文案仍走 `runGemini31ProPreviewText` → Vertex（見 `buildStrategicCoverGeminiTask`）。
 */
export async function callGemini31ProForImagePrompt(
  translationTask: string,
  options?: { translator?: PlatformImagePromptTranslator },
): Promise<string> {
  const translator: PlatformImagePromptTranslator = options?.translator ?? "gpt54";
  const label =
    translator === "vertex_gemini_31_pro_preview"
      ? "Vertex @google/genai · gemini-3.1-flash-live-preview · us-central1（JSON）"
      : "GPT 5.4（OpenAI）";
  try {
    const raw =
      translator === "vertex_gemini_31_pro_preview"
        ? await callVertexGemini31ProForImagePrompt(translationTask)
        : await callGemini3_1_Pro_AiStudio(translationTask);
    const out = stripGeminiModelOutput(raw);
    if (!out) {
      throw new Error("翻译服务返回空 prompt");
    }
    return out;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[${label} 翻译崩溃]: ${message}`);
  }
}

export async function translatePlatformCompositeToEnglishPrompt(options: {
  kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note";
  scriptContext: string;
  /** A/B：預設 GPT 5.4；與 {@link engine} 併用時以 engine 為準 */
  translator?: PlatformImagePromptTranslator;
  /** A/B：`gemini31flash` 強制走 Flash Live（us-central1）；`gpt54` 強制 GPT 5.4 */
  engine?: "gpt54" | "gemini31flash";
}): Promise<string> {
  const isStoryboard =
    options.kind === "storyboard_sheet_portrait" || options.kind === "storyboard_sheet_landscape";
  const chineseBrief = await extractChineseVisualBrief(options.scriptContext);
  const task = isStoryboard
    ? buildVideoStoryboardGeminiPrompt(chineseBrief || options.scriptContext)
    : buildXhsNoteGeminiPrompt(chineseBrief || options.scriptContext);

  if (options.engine === "gemini31flash") {
    console.log("[platformComposite] engine=gemini31flash → Vertex gemini-3.1-flash-live-preview · us-central1");
    return callVertexGeminiFlashTranslation(task);
  }
  if (options.engine === "gpt54") {
    console.log("[platformComposite] engine=gpt54 → GPT 5.4");
    return callGemini31ProForImagePrompt(task, { translator: "gpt54" });
  }

  return callGemini31ProForImagePrompt(task, { translator: options.translator });
}
