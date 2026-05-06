/**
 * **双语编导（Gemini）**：读中文剧本 / 封面文案，产出**一条**纯英文视觉 prompt。
 * **GPT-IMAGE-2** 只接收该英文串并生图，不做翻译、不读中文——汉语内容必须由 Gemini 先在 prompt 里用英文规划好（含「画面上简中字」等死命令）。
 */

const SCRIPT_SLICE = 3500;

/**
 * 强制 Gemini 产出短英文视觉 Tag（非长段落），避免数千字 prompt 撑爆 GPT-IMAGE-2 / Vertex。
 * jobs118：锁死 100 词「抄作业」约束（范例缩短、收尾句为「仅输出 100 词内…」）。
 */
export const MAXIMUM_IMAGE_PROMPT_TAG_CONSTRAINT = `
【最高视觉指令约束 / MAXIMUM PROMPT LIMIT】:
1. 绝对禁止输出完整的英文句子、语法或描述性段落。
2. 必须且只能输出核心视觉关键词（Tags），用英文逗号分隔。
3. 总字数严格限制在 100 个英文单词以内！超过将导致系统崩溃！

【抄作业范例 / EXAMPLE FORMAT】:
Cinematic 2x4 grid storyboard, ancient Chinese palace, heavy snowy night. Realistic wuxia style, cold blue and warm orange lighting. Panels feature: grand gates, male warrior in black armor, woman in red dress with black cloak. 8k, intricate details, dramatic film stills. --ar 3:2 --v 6.0

请完全模仿上述范例的极简结构，仅输出 100 词内的英文视觉 Tag。
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

CRITICAL PIPELINE (DO NOT SKIP):
You are the **translation / directing** stage only. The **next model is GPT-IMAGE-2**: it **only** renders from an **English** visual prompt and **cannot** translate Chinese, read the script, or infer missing semantics. You MUST convert the Chinese script below into **one** self-contained, vivid **English** prompt that fully encodes lighting, camera angles, wardrobe, character actions, and the mandatory on-canvas Simplified-Chinese typography rules (written as explicit English instructions to the image model).

Your task is to analyze the provided Chinese script, synthesize lighting, camera, wardrobe, and character beats, and compress them into comma-separated English **tags** only (never prose paragraphs).

MANDATORY TAG FRAGMENTS (comma-separated, not full sentences):
1. START the tag line with exactly: Cinematic 2x4 grid storyboard, 1k resolution, high quality, intricate details, dramatic film stills,
2. Continue with vivid English **keywords** for visuals, lighting, wardrobe, actions (no narrative sentences).
3. Include explicit tag fragments for Simplified-Chinese on-canvas text, e.g.: main title in Simplified Chinese, each panel Simplified Chinese labels, text grid below panels with Simplified Chinese.
4. Include the Typography Color & Emotion fragment verbatim as short tags: blood red text (or another named contrasting color token), not vague "emotional colors".
5. Choose cohesive background palette tags matching the script mood (slate / ink-wash / clinical / warm paper) as comma-separated phrases only.
6. OUTPUT: Output ONLY the final comma-separated English tag line. No explanations, no markdown, no Chinese copied verbatim except inside quoted hook instructions if needed.

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

CRITICAL PIPELINE (DO NOT SKIP):
Downstream **GPT-IMAGE-2** **only** consumes an **English** visual prompt—it **does not** translate Chinese. You MUST absorb the Chinese script and emit **one** self-contained **English** prompt that encodes all visuals, luxury aesthetic, dynamic background, and the mandatory Simplified-Chinese-on-image rules (as English directives to the image model).

Your task is to analyze the Chinese script and extract visuals into comma-separated English **tags** only (never prose paragraphs).

MANDATORY TAG FRAGMENTS (comma-separated, not full sentences):
1. START the tag line with exactly: Cinematic 2x4 grid Xiaohongshu visual note layout, 16:9 canvas, 2k high resolution, magazine editorial style, masterpiece, two vertical cards side-by-side, 2x4 cinematic matrix,
2. Continue with luxury visuals as **keywords** only.
3. Include tag fragments: Simplified Chinese main title, Simplified Chinese below each image, final panels bullet summaries in Simplified Chinese.
4. Include Typography Color & Emotion as named color token tags (e.g. neon cyan typography), never vague emotional wording.
5. Add high-end background palette tags (obsidian black, cream gradient, etc.) as short phrases.
6. OUTPUT: Output ONLY the final comma-separated English tag line. No explanations, no markdown.

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

CRITICAL PIPELINE (DO NOT SKIP):
**GPT-IMAGE-2** consumes **only English**—it cannot translate Chinese. You MUST output **one** line of comma-separated English **visual tags** for a ${input.variant === "video" ? "short-video multi-panel storyboard reference" : "graphic note / cover-style single hero reference"}, with mandatory on-image **Simplified-Chinese** typography encoded as short English tag fragments (not prose).

VARIANT + TYPOGRAPHY (tags only, comma-separated):
- ${variantTags}
- Main on-image hook or title: Simplified Chinese legible, based on 「${hook}」
- Include Typography Color & Emotion as named English color token tags (e.g. golden yellow font), never vague wording
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
 * AI Studio REST：`GEMINI_API_KEY` + 可選 `GEMINI_PRO_MODEL_ID`（預設 gemini-3.1-pro-preview）。
 */
export async function callGemini3_1_Pro_AiStudio(prompt: string): Promise<string> {
  /** jobs118：默认锁死 preview；仅允许用 GEMINI_PRO_MODEL_ID 指向同族 preview 变体（勿改回无 -preview 的已废弃节点）。 */
  const model = process.env.GEMINI_PRO_MODEL_ID?.trim() || "gemini-3.1-pro-preview";
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
      }),
    },
  );

  const data = (await response.json()) as {
    error?: { message?: string };
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };

  if (!response.ok || data.error) {
    throw new Error(data.error?.message || "AI Studio Error");
  }

  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
