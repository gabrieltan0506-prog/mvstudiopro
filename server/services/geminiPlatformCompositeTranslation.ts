import { extractJsonString, invokeLLM } from "../_core/llm.js";

/**
 * **双语编导（Gemini）**：读中文剧本 / 封面文案，产出纯英文视觉 prompt。
 * **GPT-IMAGE-2** 只接收该英文串并生图，不做翻译、不读中文——汉语内容必须由 Gemini 先在 prompt 里用英文规划好（含「画面上简中字」等死命令）。
 */

const SCRIPT_SLICE = 3500;
const CHINESE_VISUAL_BRIEF_MAX_CHARS = 220;

/** GPT 5.4 翻译大脑：用户定稿的莎士比亚式英文身份（system 首句，与中文规则并用） */
export const GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN =
  "You are excellent at distilling complex visual ideas into refined Shakespearean prompt lines of 90-120 characters, with strong imagery, emotional tension, and high aesthetic impact.";

/** 小红书图文笔记翻译任务：定稿英文人设（buildXhsNoteGeminiPrompt 正文首段） */
export const XHS_IMAGE_TEXT_NOTE_DIRECTOR_EN = `You are a bilingual visual editor who specializes in premium image-text notes with refined aesthetics and strong title design.
Use Simplified Chinese as the main title language, with English allowed as secondary supporting text.`;


/**
 * 强制 Gemini 产出短英文视觉 Tag（非长段落），避免数千字 prompt 撑爆 GPT-IMAGE-2 / Vertex。
 * jobs118/jobs120：已 export；格式與批量/單幀 Prompt 構造器末尾拼接保持一致。
 */
/** 封面 / 分镜 / 笔记公用：短英文 tags 上限（人设定稿：用户指定的「最高视觉指令约束」） */
export const MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT = `
【最高视觉指令约束 / MAXIMUM PROMPT LIMIT】（像诗一样短，不必写成律诗——够用即可）:
1. 只输出英文视觉 tags 或短短语块。
2. 你有两个可选输出档位，请自行选择更适合画面的一档：
   - 精炼档：80-120 个英文字符
   - 展开档：不超过 200 个英文字符
3. 必须保留最关键的画面信息：情绪、灯光、场景、主体/服装、标题语言要求。
4. 必须写清楚标题颜色和背景颜色的对比关系，标题要有温度、有冲击力、可读。
5. 必须带上 masterpiece 与 8k 这两个质量 tags。
`.trim();

export function stripGeminiModelOutput(raw: string): string {
  let t = String(raw || "").trim();
  const fence = /^```(?:[a-zA-Z0-9+-]*)?\s*([\s\S]*?)```$/;
  const m = t.match(fence);
  if (m?.[1]) t = m[1].trim();
  return t.replace(/^["']|["']$/g, "").trim();
}

/** 仅当任务**明确**要双卡/笔记版式且未否定小红书时，才走紧急「双栏笔记」预案（避免 COVER 模板里 “not Xiaohongshu note” 误触发食谱卡）。 */
export function buildEmergencyEnglishPrompt(task: string): string {
  const t = String(task || "");
  const lower = t.toLowerCase();
  const forbidsXhsNote = /\bnot\s+xiaohongshu\b/i.test(t) || /\bno\s+xiaohongshu\b/i.test(t);
  const explicitDualNote =
    lower.includes("dual-note") ||
    lower.includes("dual_note") ||
    lower.includes("xiaohongshu_dual_note") ||
    /双卡|雙卡/.test(t);
  if (explicitDualNote && !forbidsXhsNote) {
    return "Xiaohongshu dual-note layout, premium editorial style, warm palette contrast, clean margins, Simplified Chinese title, short bullets, masterpiece, 8k";
  }
  if (lower.includes("2x4") || lower.includes("storyboard")) {
    return "Cinematic 2x4 grid storyboard, dramatic film stills, premium lighting, distinct panels, luxury palette, Simplified Chinese title, panel labels, masterpiece, 8k";
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
    max_tokens: 256,
    messages: [
      {
        role: "system",
        content: [
          "你是一位像莎士比亚剧场里锤炼台词那样锤炼画面的双语视觉编导：精通语言的节奏与意象，读中文时像读诗一样抓住「最省字、最有画面」的那几笔。",
          "只做一步：从输入里抽出中文「视觉骨架」，不做英文翻译。",
          "像写短诗一样凝练：目标约 12～220 个中文字符内的关键词或短短语，可逗号分隔或分行；去掉解释、剧情复述、长句修辞。",
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
You are a bilingual film director who specializes in premium storyboard sheets with strong cinematic structure and high-end visual aesthetics.
Cinematic 2x4 grid storyboard. Simplified Chinese text tables below each image. 8k, intricate details, dramatic film stills. --ar 3:2 --v 6.0

[Chinese Script]:
${slice}
`.trim() +
    "\n\n" +
    MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT
  );
}

/** 小红书图文笔记 2×4：人设见 {@link XHS_IMAGE_TEXT_NOTE_DIRECTOR_EN} */
export function buildXhsNoteGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return (
    `
${XHS_IMAGE_TEXT_NOTE_DIRECTOR_EN}

[Chinese Script]:
${slice}
`.trim() +
    "\n\n" +
    MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT
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

/** 平台選題單幀：`graphic`＝单张竖版**封面**（非小红书双卡图文笔记）；`video`＝竖版 9:16 多分镜**条**（非横版 2×4，2×4 见 {@link buildVideoStoryboardGeminiPrompt}）。 */
export function buildPlatformTopicReferenceGeminiTask(input: {
  topicHook: string;
  context: string;
  /** `video`：短影音竖版多分镜参考条；`graphic`：仅竖版单张封面 */
  variant: "video" | "graphic";
  /** 出镜身份 / IP 基因（中文）；供 GPT 5.4 锁定人設与场景符号，避免仅由单条文案猜测导致漂移 */
  coverPersonaContext?: string;
}): string {
  const hook = String(input.topicHook || "").trim().slice(0, 500);
  const ctx = String(input.context || "").trim().slice(0, 1500);
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
- ANTI-HALLUCINATION: The scene MUST match the themes of the hook 「${hook}」and Context (e.g. medicine, doctor persona, study, books, journal props, landscape art, wellness). If an identity anchor block appears above, the on-camera subject, wardrobe, props, and environment tier MUST align with it. Unless the hook or Context clearly names food, cooking, recipes, ingredients, or specific dishes, DO NOT show: kitchens, recipe infographics, ingredient grids, cooking steps, noodle bowls, restaurant plating, or dual-column recipe lesson layouts.
- main title based on 「${hook}」
`}

Context:
${ctx}
`.trim() +
    "\n\n" +
    MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT
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
    max_tokens: 2048,
    messages: [
      {
        role: "system",
        content: [
          GPT54_SHAKESPEAREAN_PROMPT_DIRECTOR_EN,
          "你是一位莎士比亚式的双语舞台导演：精通诗性与节奏，把庞杂中文当作台词来打磨——删繁就简，只留能「被镜头看见」的东西。",
          "把上游任务压缩成一串可执行的英文视觉 tags 或短短语块，供下游生图模型直接作画；像十四行诗里选最锋利的意象，而不是写说明书。",
          "篇幅：习惯上 90～120 个英文字符最漂亮；若题材需要，也可以放宽到不超过约 200 个英文字符，仍要句句有画面。",
          "请返回合法 JSON：{\"prompt\":\"...\"}；prompt 里只要英文 tags，不要解释、不要 markdown。",
          "保留：情绪、灯光、场景、主体与服饰、标题语言（简中大字等）；须带 masterpiece 与 8k；标题色与背景色对比要说清。",
          "若上游是封面/科普而正文未出现食物，就不必画食谱、厨房、食材表；其余不必叠床架屋地列禁令。",
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
        "你是一位莎士比亚式的双语舞台导演：精通诗性与节奏，把庞杂内容磨成短而准的英文视觉 tags。",
        "篇幅：90～120 个英文字符最佳；需要时可到约 200 内。",
        "必须返回合法 JSON：{\"prompt\":\"...\"}；须含 masterpiece 与 8k。",
        "若正文未写食物/菜谱，就不要画食谱厨房；其余从简。",
      ].join("\n"),
    },
    {
      role: "user" as const,
      content: `请返回 JSON：{"prompt":"..."}。\n将下面内容压缩并翻译成英文短视觉 tags 或短短语块。你可以自行选择：精炼档 80-120 字符，或展开档不超过 200 字符：\n${prompt}`,
    },
  ];

  const fallbackResponse = await invokeLLM({
    provider: "openai",
    model: "gpt54",
    modelName: process.env.OPENAI_GPT54_MODEL?.trim() || "gpt-5.4",
    response_format: { type: "json_object" },
    max_tokens: 2048,
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
 * 平台 2×4 / 小紅書合成與選題單幀：**AI Studio**（`GEMINI_API_KEY` + `gemini-3.1-pro-preview`）產出純英文生圖指令，避免 `gemini-3.1-pro` 節點 404。
 * 戰略封面 / 章節扉頁文案仍走 `runGemini31ProPreviewText` → Vertex（見 `buildStrategicCoverGeminiTask`）。
 */
export async function callGemini31ProForImagePrompt(translationTask: string): Promise<string> {
  try {
    const raw = await callGemini3_1_Pro_AiStudio(translationTask);
    const out = stripGeminiModelOutput(raw);
    if (!out) {
      throw new Error("翻译服务返回空 prompt");
    }
    return out;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[AI Studio 翻译大脑崩溃]: ${message}`);
  }
}

export async function translatePlatformCompositeToEnglishPrompt(options: {
  kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note";
  scriptContext: string;
}): Promise<string> {
  const isStoryboard =
    options.kind === "storyboard_sheet_portrait" || options.kind === "storyboard_sheet_landscape";
  const chineseBrief = await extractChineseVisualBrief(options.scriptContext);
  const task = isStoryboard
    ? buildVideoStoryboardGeminiPrompt(chineseBrief || options.scriptContext)
    : buildXhsNoteGeminiPrompt(chineseBrief || options.scriptContext);
  return callGemini31ProForImagePrompt(task);
}
