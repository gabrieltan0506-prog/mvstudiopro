import { extractJsonString, invokeLLM } from "../_core/llm.js";

/**
 * **双语编导（Gemini）**：读中文剧本 / 封面文案，产出**一条**纯英文视觉 prompt。
 * **GPT-IMAGE-2** 只接收该英文串并生图，不做翻译、不读中文——汉语内容必须由 Gemini 先在 prompt 里用英文规划好（含「画面上简中字」等死命令）。
 */

const SCRIPT_SLICE = 3500;

/**
 * 强制 Gemini 产出短英文视觉 Tag（非长段落），避免数千字 prompt 撑爆 GPT-IMAGE-2 / Vertex。
 * jobs118/jobs120：已 export；格式與批量/單幀 Prompt 構造器末尾拼接保持一致。
 */
export const MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT = `
【最高视觉指令约束 / MAXIMUM PROMPT LIMIT】:
1. 绝对禁止输出完整的英文句子、语法或描述性段落。
2. 必须且只能输出核心视觉关键词（Tags），用英文逗号分隔。
3. 总字数严格限制在 150 个英文单词以内，且尽量控制在 650 个英文字符以内！超过将导致系统崩溃！
4. 必须显式写出有情绪温度的标题视觉策略：高对比、强聚焦、可读的 Simplified Chinese headline。
5. 必须显式写出背景与标题的配色对撞关系，使用具名英文颜色词，不要只写“warm / cool”.

【抄作业范例 / EXAMPLE FORMAT】:
Cinematic 2x4 grid storyboard, ancient Chinese palace, heavy snowy night, realistic wuxia style, cold blue lighting, warm orange rim light, black armor warrior, red dress woman, black cloak, bloody wooden box, hand holding bloody seal cloth, Simplified Chinese text grid below each panel, dramatic film stills, high detail, 3:2 composition

6. 绝对不要写成完整英文句子，只能写简短、精要、逗号分隔的英文视觉 tags。

请完全模仿上述范例的极简结构，仅输出 150 词内、650 字符内的英文视觉 Tag，不要生成句子。
`.trim();

export function stripGeminiModelOutput(raw: string): string {
  let t = String(raw || "").trim();
  const fence = /^```(?:[a-zA-Z0-9+-]*)?\s*([\s\S]*?)```$/;
  const m = t.match(fence);
  if (m?.[1]) t = m[1].trim();
  return t.replace(/^["']|["']$/g, "").trim();
}

/** 视频分镜 2×4：Gemini 双语编导翻译 → 英文指令；出图端为 GPT-IMAGE-2 横版尺寸序列 */
export function buildVideoStoryboardGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return (
    `
You are a bilingual (English and Simplified Chinese) Master Film Director, Aesthetic Expert, and highly skilled Prompt Engineer.
You are also a luxury visual designer responsible for headline emotional temperature, palette contrast, and instant thumbnail impact.

CRITICAL PIPELINE (DO NOT SKIP):
You are the **translation / directing** stage only. The **next model is GPT-IMAGE-2**: it **only** renders from an **English** visual prompt and **cannot** translate Chinese, read the script, or infer missing semantics. You MUST convert the Chinese script below into **one** self-contained, vivid **English** prompt that fully encodes lighting, camera angles, wardrobe, character actions, and the mandatory on-canvas Simplified-Chinese typography rules (written as explicit English instructions to the image model).

Your task is to analyze the provided Chinese script, synthesize lighting, camera, wardrobe, and character beats, and compress them into comma-separated English **tags** only (never prose paragraphs).

MANDATORY TAG FRAGMENTS (comma-separated, not full sentences):
1. START the tag line with exactly: Cinematic 2x4 grid storyboard, 1k resolution, high quality, intricate details, dramatic film stills,
2. Keep ONLY the highest-value visual elements: mood, lighting, scene, wardrobe, key props, camera feel, panel layout. Remove story summary, abstract analysis, and long action prose.
3. Include explicit tag fragments for Simplified-Chinese on-canvas text, e.g.: main title in Simplified Chinese, each panel Simplified Chinese labels, text grid below panels with Simplified Chinese.
4. Include the Typography Color & Emotion fragment verbatim as short tags: blood red text (or another named contrasting color token), not vague "emotional colors". The title must feel emotionally charged, cinematic, and instantly legible.
5. Choose cohesive background palette tags matching the script mood (slate / ink-wash / clinical / warm paper) as comma-separated phrases only, and make sure the title color has a deliberate contrast with the background palette.
6. The 2x4 grid must be materially encoded in tags: panel grid, distinct panel subjects, image grid below-title layout, simplified chinese text grid below panels.
7. OUTPUT: Output ONLY the final comma-separated English tag line. No explanations, no markdown, no Chinese copied verbatim except inside quoted hook instructions if needed.

[Chinese Script]:
${slice}
`.trim() +
    "\n\n" +
    MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT
  );
}

/** 小红书图文 2×4：Gemini 双语编导 → 英文；GPT-IMAGE-2 只按英文出图 */
export function buildXhsNoteGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return (
    `
You are a bilingual (English and Simplified Chinese) Master Art Director and Social Media Visual Strategist.
You are also a top-tier visual branding designer responsible for title emotion, palette hierarchy, and thumbnail click impact.

CRITICAL PIPELINE (DO NOT SKIP):
Downstream **GPT-IMAGE-2** **only** consumes an **English** visual prompt—it **does not** translate Chinese. You MUST absorb the Chinese script and emit **one** self-contained **English** prompt that encodes all visuals, luxury aesthetic, dynamic background, and the mandatory Simplified-Chinese-on-image rules (as English directives to the image model).

Your task is to analyze the Chinese script and extract visuals into comma-separated English **tags** only (never prose paragraphs).

MANDATORY TAG FRAGMENTS (comma-separated, not full sentences):
1. START the tag line with exactly: Xiaohongshu dual-note layout, 16:9 canvas, two vertical cards side-by-side, editorial premium style,
2. Keep ONLY the highest-value visual elements: title emotion, palette contrast, scene, wardrobe, hero prop, clean card layout. Remove story summary, explanation, and long action prose.
3. Text layout must stay minimal: one Simplified Chinese main title, two to four short Simplified Chinese bullet lines, no long paragraphs, no dense text block, no wall of copy.
4. Include Typography Color & Emotion as named color token tags (e.g. warm ivory title, vermilion accent), never vague emotional wording. The Simplified Chinese title must feel warm, emotionally charged, premium, and highly clickable.
5. Add high-end background palette tags (obsidian black, cream gradient, ink beige, dark walnut, muted jade) as short phrases, and ensure strong readable contrast between title color and background color.
6. The dual-note grid must be explicit in tags: left card hero, right card hero, clean margins, premium editorial spacing, structured note layout.
7. OUTPUT: Output ONLY the final comma-separated English tag line. No explanations, no markdown.

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

/** 平台選題單幀：中文 → 英文視覺 **Tag**（百词内）；video=多格分鏡條；graphic=圖文/封面式參考（非 2×4 合成表）。 */
export function buildPlatformTopicReferenceGeminiTask(input: {
  topicHook: string;
  context: string;
  /** `video`：短影音分鏡多格；`graphic`：圖文笔记/封面参考竖图 */
  variant: "video" | "graphic";
}): string {
  const hook = String(input.topicHook || "").trim().slice(0, 500);
  const ctx = String(input.context || "").trim().slice(0, 1500);
  const variantTags =
    input.variant === "video"
      ? "Required tags must include: vertical 9:16, multi-panel storyboard strip, at least 3 separated frames, gutters between panels, short-form video beats, not single full-bleed poster"
      : "Required tags must include: vertical 9:16, editorial cover-style hero still, luxury focal subject, Xiaohongshu graphic note feel, not multi-panel storyboard grid";
  return (
    `
You are a bilingual (English and Simplified Chinese) social media visual strategist and prompt director.
You are also a master thumbnail designer responsible for title emotion, palette contrast, and scroll-stopping visual impact.

CRITICAL PIPELINE (DO NOT SKIP):
**GPT-IMAGE-2** consumes **only English**—it cannot translate Chinese. You MUST output **one** line of comma-separated English **visual tags** for a ${input.variant === "video" ? "short-video multi-panel storyboard reference" : "graphic note / cover-style single hero reference"}, with mandatory on-image **Simplified-Chinese** typography encoded as short English tag fragments (not prose).

VARIANT + TYPOGRAPHY (tags only, comma-separated):
- ${variantTags}
- Main on-image hook or title: Simplified Chinese legible, based on 「${hook}」
- Include Typography Color & Emotion as named English color token tags (e.g. golden yellow font), never vague wording. The title must have emotional warmth, contrast, and instant readability.
- Explicitly define the contrast logic between background palette and title color using named English colors.
- Absorb composition from Chinese context below; do **not** paste raw Chinese into the output string:
${ctx}

OUTPUT: **Only** the final comma-separated English tag line. No explanations, no markdown.
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
  const response = await invokeLLM({
    provider: "openai",
    model: "gpt54",
    modelName: process.env.OPENAI_GPT54_MODEL?.trim() || "gpt-5.4",
    response_format: { type: "json_object" },
    temperature: 0.2,
    topP: 0.9,
    max_tokens: 4096,
    messages: [
      {
        role: "system",
        content: [
          "你是顶级双语编导、电影导演、顶级视觉设计大师。",
          "你的唯一任务，是把上游中文内容压缩成下游生图模型可直接使用的一条英文视觉 prompt 或英文 tags。",
          "你必须同时负责：标题的情绪温度、视觉冲击力、背景与标题的颜色搭配、以及画面整体的高级感。",
          "禁止输出解释、禁止聊天、禁止 markdown、禁止代码块。",
          "你必须严格返回 JSON：{\"prompt\":\"...\"}。",
          "prompt 字段内容必须是英文，且必须保留对画面中“简体中文标题/文案”的明确英文指令。",
          "如果任务要求 tags，就输出逗号分隔的英文 tags；如果任务要求完整 prompt，就输出完整英文 prompt。",
          "第一次翻译阶段就必须主动压短：输出尽量控制在 150 个英文单词以内，并尽量不超过 650 个英文字符。",
          "绝对不要生成完整英文句子，只能生成简短、精要、逗号分隔的英文视觉 tags。",
          "优先保留：情绪、灯光、场景、服装、关键道具、镜头感、网格版式。删除分析、解释、长动作描述和叙事句子。",
          "不要遗漏镜头、灯光、构图、气质、材质、版式、简体中文标题要求。",
          "必须显式给出具名英文颜色词，并写清楚标题颜色与背景颜色的对撞关系，不能只写泛泛的 warm / cool。",
          "必须让最终简体中文标题在视觉上有温度、有层次、有冲击力，同时保持高级、不俗气。",
        ].join("\n"),
      },
      {
        role: "user",
        content: prompt,
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

  const output = String(parsed?.prompt || raw).trim();
  if (!output) {
    throw new Error("GPT 5.4 翻译大脑返回空 prompt");
  }
  return output;
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
  const task = isStoryboard
    ? buildVideoStoryboardGeminiPrompt(options.scriptContext)
    : buildXhsNoteGeminiPrompt(options.scriptContext);
  return callGemini31ProForImagePrompt(task);
}
