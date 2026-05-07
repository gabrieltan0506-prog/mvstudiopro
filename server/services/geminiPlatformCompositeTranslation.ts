import { extractJsonString, invokeLLM } from "../_core/llm.js";

/**
 * **双语编导（Gemini）**：读中文剧本 / 封面文案，产出纯英文视觉 prompt。
 * **GPT-IMAGE-2** 只接收该英文串并生图，不做翻译、不读中文——汉语内容必须由 Gemini 先在 prompt 里用英文规划好（含「画面上简中字」等死命令）。
 */

const SCRIPT_SLICE = 3500;
const CHINESE_VISUAL_BRIEF_MAX_CHARS = 220;

/**
 * 强制 Gemini 产出短英文视觉 Tag（非长段落），避免数千字 prompt 撑爆 GPT-IMAGE-2 / Vertex。
 * jobs118/jobs120：已 export；格式與批量/單幀 Prompt 構造器末尾拼接保持一致。
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

function buildEmergencyEnglishPrompt(task: string): string {
  const lower = String(task || "").toLowerCase();
  if (lower.includes("xiaohongshu") || lower.includes("dual-note")) {
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
    response_format: {
      type: "json_schema",
      json_schema: {
        name: "chinese_visual_brief",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            brief: {
              type: "string",
              minLength: 12,
              maxLength: CHINESE_VISUAL_BRIEF_MAX_CHARS,
              description:
                "只保留中文视觉骨架关键词，220字内。只保留情绪、灯光、场景、服装、关键道具、镜头感、版式。不要长句。",
            },
          },
          required: ["brief"],
        },
      },
    },
    max_tokens: 180,
    messages: [
      {
        role: "system",
        content: [
          "你是顶级导演分镜提炼器。",
          "先做中文视觉骨架提取，不做英文翻译。",
          "你必须把输入内容狠心压缩到 220 个中文字符以内。",
          "只保留：情绪、灯光、场景、服装、关键道具、镜头感、版式。",
          "删除：解释、分析、故事摘要、长动作、修辞句。",
          "输出必须是短中文关键词或短短语块，可用逗号分隔或分行，不要长句。",
          "严格返回 JSON：{\"brief\":\"...\"}。",
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

/** 视频分镜 2×4：Gemini 双语编导翻译 → 英文指令；出图端为 GPT-IMAGE-2 横版尺寸序列 */
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

/** 小红书图文 2×4：Gemini 双语编导 → 英文；GPT-IMAGE-2 只按英文出图 */
export function buildXhsNoteGeminiPrompt(scriptContext: string): string {
  const slice = String(scriptContext || "").slice(0, SCRIPT_SLICE);
  return (
    `
You are a bilingual visual editor who specializes in premium image-text notes with refined aesthetics and strong title design.
Use Simplified Chinese as the main title language, with English allowed as secondary supporting text.

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
  const isVideo = input.variant === "video";
  return (
    `
You are a bilingual visual prompt director.
${isVideo
  ? "You specialize in short-video storyboard reference frames with strong rhythm and visual clarity."
  : "You specialize in premium single-image media covers with strong click appeal and high-end visual impact."}

${isVideo
  ? "Use Simplified Chinese as the main title language."
  : "Use Simplified Chinese as the main title language, with English allowed as secondary supporting text."}

${isVideo ? `
VIDEO STORYBOARD REFERENCE:
- Required tags must include: vertical 9:16, multi-panel storyboard strip, at least 3 separated frames, gutters between panels, short-form video beats, not single full-bleed poster.
- Use storyboard rhythm, sequence, and shot progression language.
- Main on-image hook or title: Simplified Chinese legible, based on 「${hook}」.
` : `
COVER DESIGN ONLY:
- Required tags must include: vertical 9:16, single-image cover, single dominant hero subject, premium editorial portrait or scene, strong focal point, not multi-panel storyboard, not dual-card layout, not Xiaohongshu note, not checklist, not bullet list, not account UI, not comment bar.
- The image must behave like a high-click cover, not an image-text note.
- Main on-image hook or title: Simplified Chinese legible, based on 「${hook}」.
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
/**
 * 平台 2×4 / 小紅書合成與選題單幀：**AI Studio**（\`GEMINI_API_KEY\` + \`gemini-3.1-pro-preview\`）產出純英文生圖指令，避免 \`gemini-3.1-pro\` 節點 404。
 * 戰略封面 / 章節扉頁文案仍走 \`runGemini31ProPreviewText\` → Vertex（見 \`buildStrategicCoverGeminiTask\`）。
 */
export async function callGemini3_1_Pro_AiStudio(prompt: string): Promise<string> {
  const model = process.env.GEMINI_PRO_MODEL_ID || "gemini-3.1-pro-preview"; // 🔴 鎖定 preview
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("Missing GEMINI_API_KEY");

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.7 }
    })
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(data.error?.message || "AI Studio Error");
  return data.candidates?.[0]?.content?.parts?.[0]?.text || "";
}

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
