/**
 * **双语编导（Gemini）**：读中文剧本 / 封面文案，产出**一条**纯英文视觉 prompt。
 * **GPT-IMAGE-2** 只接收该英文串并生图，不做翻译、不读中文——汉语内容必须由 Gemini 先在 prompt 里用英文规划好（含「画面上简中字」等死命令）。
 */

const SCRIPT_SLICE = 3500;

/** 视频分镜 2×4：Gemini 双语编导翻译 → 英文指令；出图端为 GPT-IMAGE-2 横版尺寸序列 */
export function buildVideoStoryboardGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return `
You are a bilingual (English and Simplified Chinese) Master Film Director, Aesthetic Expert, and highly skilled Prompt Engineer.

CRITICAL PIPELINE (DO NOT SKIP):
You are the **translation / directing** stage only. The **next model is GPT-IMAGE-2**: it **only** renders from an **English** visual prompt and **cannot** translate Chinese, read the script, or infer missing semantics. You MUST convert the Chinese script below into **one** self-contained, vivid **English** prompt that fully encodes lighting, camera angles, wardrobe, character actions, and the mandatory on-canvas Simplified-Chinese typography rules (written as explicit English instructions to the image model).

Your task is to analyze the provided Chinese script, synthesize the lighting, camera angles, wardrobe, and character actions, and translate them into a HIGHLY PRECISE and VIVID English prompt for that image model.

MANDATORY RULES FOR YOUR OUTPUT PROMPT:
1. START EXACTLY WITH: "Cinematic 2x4 grid storyboard, 1k resolution, high quality, intricate details, dramatic film stills."
2. SCENE TRANSLATION: Describe the visuals, lighting, clothing, and actions vividly in English.
3. CRITICAL TYPOGRAPHY INSTRUCTION: You MUST add this exact sentence to force the AI to render Chinese text: "The image must include a main title in Simplified Chinese. Each image panel must contain Simplified Chinese text describing the content. Below each image panel, there must be a clean text grid containing precise Simplified Chinese descriptions of the lighting, camera angle, clothing, and actions."
4. DYNAMIC BACKGROUND: Based on the historical era, genre, and scene mood in the script, choose a **cohesive** storyboard-sheet background palette and material (color, texture, atmosphere) that **matches the visual aesthetic of the piece**—not a fixed template. Examples of the kind of variation allowed: rich cinematic dark slate behind bright panels; soft ink-wash and paper grain for literati mood; cool clinical white-gray for medical explainer; warm artisanal paper only when the script itself calls for that tone.
5. OUTPUT: Output ONLY the final English prompt string. Do not include conversational text.

[Chinese Script]:
${slice}
`.trim();
}

/** 小红书图文 2×4：Gemini 双语编导 → 英文；GPT-IMAGE-2 只按英文出图 */
export function buildXhsNoteGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return `
You are a bilingual (English and Simplified Chinese) Master Art Director and Social Media Visual Strategist.

CRITICAL PIPELINE (DO NOT SKIP):
Downstream **GPT-IMAGE-2** **only** consumes an **English** visual prompt—it **does not** translate Chinese. You MUST absorb the Chinese script and emit **one** self-contained **English** prompt that encodes all visuals, luxury aesthetic, dynamic background, and the mandatory Simplified-Chinese-on-image rules (as English directives to the image model).

Your task is to analyze the Chinese script and extract the core visuals, lighting, and aesthetic details into a HIGHLY PRECISE English prompt.

MANDATORY RULES FOR YOUR OUTPUT PROMPT:
1. START EXACTLY WITH: "Cinematic 2x4 grid Xiaohongshu visual note layout, 2k high resolution, magazine editorial style, masterpiece."
2. AESTHETICS: Describe the visuals vividly in English, maintaining a high-net-worth IP luxury style.
3. CRITICAL TYPOGRAPHY INSTRUCTION: You MUST add this exact sentence: "Include a main title in Simplified Chinese. Render Simplified Chinese text below each image explaining the visual. The final 2 or 3 panels MUST contain clear bullet-point summaries of the core value in Simplified Chinese." Let the model decide the key bullet points based on context.
4. DYNAMIC BACKGROUND: Assign a high-end, masterpiece-level background color for the layout that matches the mood (e.g., "Deep obsidian black background" or "Warm cream gradient background").
5. OUTPUT: Output ONLY the final English prompt string. Do not include conversational text.

[Chinese Script]:
${slice}
`.trim();
}

const DEFAULT_MODEL =
  String(process.env.GEMINI_PLATFORM_COMPOSITE_MODEL || "gemini-3-pro-preview").trim() || "gemini-3-pro-preview";

const STRATEGIC_COVER_TEXT_MODEL =
  String(process.env.GEMINI_COVER_PROMPT_MODEL || "gemini-3.1-pro-preview").trim() || "gemini-3.1-pro-preview";

/** 战略智库杂志封面：双语编导（Gemini）把中文题与出版语境压成英文视觉 prompt → GPT-IMAGE-2 */
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

/** 平台選題單幀：中文 → 英文視覺 prompt。video=多格分鏡條；graphic=圖文/封面式參考（非 2×4 合成表）。 */
export function buildPlatformTopicReferenceGeminiTask(input: {
  topicHook: string;
  context: string;
  /** `video`：短影音分鏡多格；`graphic`：圖文笔记/封面参考竖图 */
  variant: "video" | "graphic";
}): string {
  const hook = String(input.topicHook || "").trim().slice(0, 500);
  const ctx = String(input.context || "").trim().slice(0, 1500);
  const openLine =
    input.variant === "video"
      ? 'START EXACTLY WITH: "Cinematic 9:16 vertical **multi-panel storyboard strip** for short-form video: **at least 3 clearly separated frames or panels** (stacked vertically or in a neat grid), each panel showing one sequential beat of the action; visible borders, gutters, or storyboard labels between panels; dramatic lighting—not a single full-bleed poster hero shot, not a magazine cover, not a title-splash-only card."'
      : 'START EXACTLY WITH: "High-end vertical 9:16 **editorial cover-style reference still** for social / Xiaohongshu graphic note—luxury commercial photography, clear focal subject, premium layout feel suitable as a **cover or hero card**—not a multi-panel storyboard grid, not a film strip."';
  const roleLabel = input.variant === "video" ? "short-video **multi-panel storyboard reference image**" : "**graphic note / cover-style** single hero reference (one main scene)";
  return `
You are a bilingual (English and Simplified Chinese) social media visual strategist and prompt director.

CRITICAL PIPELINE (DO NOT SKIP):
**GPT-IMAGE-2** consumes **only English**—it cannot translate Chinese. You MUST output **one** self-contained English prompt for a ${roleLabel}, with mandatory on-image **Simplified-Chinese** typography (hook, title, or panel labels as appropriate) described via **English** instructions to the image model.

MANDATORY RULES:
1. ${openLine}
2. Main on-image hook or title line MUST be Simplified Chinese only, legible, based on: 「${hook}」. Any supporting labels MUST be Simplified Chinese.
3. Use English only for non-text visual / camera / lighting / layout descriptions. Use the Chinese context below to infer composition (do not paste raw Chinese into the output string):\n${ctx}
4. OUTPUT: English prompt string only.
`.trim();
}

/**
 * 战略封面 / 章节扉页：**Gemini**（可通过 `GEMINI_COVER_PROMPT_MODEL` 覆盖）任**双语编导**阶段，产出**一条英文**视觉 prompt；
 * **GPT-IMAGE-2** 仅接收该英文串并生图，**不具备**读中文或翻译能力。
 */
export async function runGemini31ProPreviewText(userTask: string): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("missing_GEMINI_API_KEY");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(STRATEGIC_COVER_TEXT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: userTask }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const json: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } } =
    await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(json?.error?.message || `封面指令 API ${r.status}`);
  }
  const text = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  const out = stripModelOutput(text);
  if (!out) {
    throw new Error("封面指令返回空内容");
  }
  return out;
}

function stripModelOutput(raw: string): string {
  let t = String(raw || "").trim();
  const fence = /^```(?:[a-zA-Z0-9+-]*)?\s*([\s\S]*?)```$/;
  const m = t.match(fence);
  if (m?.[1]) t = m[1].trim();
  return t.replace(/^["']|["']$/g, "").trim();
}

/**
 * 呼叫已配置之翻譯推理服務，僅回傳純英文生圖指令字串（具體後端由環境變數決定，此處不寫死名稱）。
 */
export async function callGemini31ProForImagePrompt(translationTask: string): Promise<string> {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("missing_GEMINI_API_KEY");
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(DEFAULT_MODEL)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: translationTask }] }],
      generationConfig: { temperature: 0.45, maxOutputTokens: 8192 },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const json: { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } } =
    await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(json?.error?.message || `翻译服务 API ${r.status}`);
  }
  const text = String(json?.candidates?.[0]?.content?.parts?.[0]?.text || "").trim();
  const out = stripModelOutput(text);
  if (!out) {
    throw new Error("翻译服务返回空 prompt");
  }
  return out;
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
