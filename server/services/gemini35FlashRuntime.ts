/**
 * Gemini 3.5 Flash · 统一走 **Gemini API**（`GEMINI_API_KEY` + `@google/genai`），**不走 Vertex IAM**。
 * - 文案：googleSearch + HIGH thinking（0.8 / 0.9）
 * - 生图英文化：无工具 + HIGH thinking（0.7 / 0.9）
 */
import { GoogleGenAI } from "@google/genai";

/** 平台默认：Gemini 3.5 Flash（可用 GEMINI_35_FLASH_MODEL 覆写）。 */
export const DEFAULT_GEMINI_35_FLASH_MODEL = "gemini-3.5-flash";

/** 文案生成默认输出上限（64K）。可用 `GEMINI_35_FLASH_COPYWRITING_MAX_OUTPUT_TOKENS` 覆写（4096～65536）。 */
export const GEMINI_35_FLASH_COPYWRITING_MAX_OUTPUT_TOKENS = 65536;

/** 生图英文化默认输出上限（32K）。可用 `GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS` 覆写（4096～65536）。 */
export const GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS = 32768;

function clampMaxOutputTokens(n: number, fallback: number): number {
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(65536, Math.max(4096, Math.floor(n)));
}

export function resolveGemini35FlashCopywritingMaxOutputTokens(override?: number): number {
  if (override != null && Number.isFinite(override) && override > 0) {
    return clampMaxOutputTokens(override, GEMINI_35_FLASH_COPYWRITING_MAX_OUTPUT_TOKENS);
  }
  const raw = process.env.GEMINI_35_FLASH_COPYWRITING_MAX_OUTPUT_TOKENS;
  if (raw != null && String(raw).trim() !== "") {
    return clampMaxOutputTokens(Number(raw), GEMINI_35_FLASH_COPYWRITING_MAX_OUTPUT_TOKENS);
  }
  return GEMINI_35_FLASH_COPYWRITING_MAX_OUTPUT_TOKENS;
}

export function resolveGemini35FlashImageTranslationMaxOutputTokens(override?: number): number {
  if (override != null && Number.isFinite(override) && override > 0) {
    return clampMaxOutputTokens(override, GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS);
  }
  const raw = process.env.GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS;
  if (raw != null && String(raw).trim() !== "") {
    return clampMaxOutputTokens(Number(raw), GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS);
  }
  return GEMINI_35_FLASH_IMAGE_TRANSLATION_MAX_OUTPUT_TOKENS;
}

export function resolveGemini35FlashModelName(): string {
  const fromEnv =
    String(process.env.GEMINI_35_FLASH_MODEL || "").trim() ||
    String(process.env.GROWTH_CAMP_EXTRACTOR_MODEL || "").trim() ||
    String(process.env.GEMINI_FLASH_TRANSLATION_MODEL || "").trim() ||
    String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_MODEL || "").trim() ||
    String(process.env.VERTEX_GEMINI_COVER_TRANSLATION_MODEL || "").trim();
  return fromEnv || DEFAULT_GEMINI_35_FLASH_MODEL;
}

/** Stage2 专属文案（`buildPlatformContent`）；可 `PLATFORM_STAGE2_GEMINI_MODEL` 覆写。 */
export function resolvePlatformStage2GeminiModel(): string {
  return String(process.env.PLATFORM_STAGE2_GEMINI_MODEL || "").trim() || resolveGemini35FlashModelName();
}

export function requireGeminiApiKey(): string {
  const apiKey = String(process.env.GEMINI_API_KEY || "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return apiKey;
}

export function buildGeminiApiClient(): GoogleGenAI {
  return new GoogleGenAI({ apiKey: requireGeminiApiKey() });
}

/** 爆款文案：知识 + 情绪；配合 googleSearch 保事实准确。 */
export const GEMINI_35_FLASH_COPYWRITING_SYSTEM = `你是一位顶尖的专栏作家与新媒体内容总监。
你的任务是写出优美、生动且浅显易懂的文案。
核心写作心法：
1. 采用「知识 + 情绪」的结构：用通俗易懂的故事或生活场景带出专业知识，结尾必须能触动人心、引发共鸣。
2. 拒绝生硬说教：文字要有呼吸感，多用比喻，排版清晰（适当使用段落与引号）。
3. 如果涉及历史、医学或旅游等信息，请先确保事实正确，再注入人文关怀。`;

/** 生图提示词英文化：艺术向、电影感；仅输出英文 prompt（由下游 JSON 契约包装）。 */
export const GEMINI_35_FLASH_IMAGE_PROMPT_TRANSLATOR_EN = `You are an elite prompt engineer and a poetic visual artist.
Your ONLY task is to translate and elevate the following Chinese visual brief into a breathtaking, highly descriptive English image generation prompt.
STRICT REQUIREMENTS:
1. Tone & Style: Use elegant, cinematic, and evocative vocabulary.
2. Elements: Explicitly describe lighting (e.g., chiaroscuro, volumetric), mood (e.g., ethereal, melancholic), textures, and camera angles (e.g., extreme wide shot, hyper-realistic).
3. Do not explain your response. Output ONLY the English image prompt. Make it rich, comma-separated or beautifully structured for an image generator (like Imagen 4 Ultra or Midjourney).`;

function readCopywritingTemperature(): number {
  const raw = process.env.GEMINI_35_FLASH_COPYWRITING_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.8;
}

function readCopywritingTopP(): number {
  const raw = process.env.GEMINI_35_FLASH_COPYWRITING_TOP_P;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }
  return 0.9;
}

export function readImageTranslationTemperature(): number {
  const raw = process.env.GEMINI_35_FLASH_IMAGE_TRANSLATION_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.7;
}

export function readImageTranslationTopP(): number {
  const raw = process.env.GEMINI_35_FLASH_IMAGE_TRANSLATION_TOP_P;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0 && n <= 1) return n;
  }
  return 0.9;
}

function readThinkingLevel(): string {
  const raw = String(process.env.GEMINI_35_FLASH_THINKING_LEVEL ?? "HIGH").trim().toUpperCase();
  const allowed = new Set(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
  return allowed.has(raw) ? raw : "HIGH";
}

function readThinkingConfigForSdk(): {
  thinkingConfig?: { thinkingLevel: string; includeThoughts: boolean };
} {
  const raw = String(process.env.GEMINI_35_FLASH_THINKING_LEVEL ?? "HIGH").trim().toUpperCase();
  if (!raw || raw === "OFF" || raw === "NONE" || raw === "FALSE" || raw === "0") {
    return {};
  }
  const allowed = new Set(["MINIMAL", "LOW", "MEDIUM", "HIGH"]);
  const level = allowed.has(raw) ? raw : "HIGH";
  return { thinkingConfig: { thinkingLevel: level, includeThoughts: false } };
}

async function generateGeminiApiContent(params: {
  model: string;
  userText: string;
  config: Record<string, unknown>;
}): Promise<string> {
  const ai = buildGeminiApiClient();
  const response = await ai.models.generateContent({
    model: params.model,
    contents: [{ role: "user", parts: [{ text: params.userText }] }],
    config: params.config as any,
  });
  const text = String((response as { text?: string })?.text ?? "").trim();
  if (!text) {
    throw new Error(`Gemini API 无文本产出（model=${params.model}）`);
  }
  return text;
}

/**
 * 文案生成（Gemini API）：temperature 0.8 · topP 0.9 · thinking HIGH · googleSearch。
 */
export async function callGemini35FlashCopywriting(params: {
  taskSystemInstruction: string;
  userText: string;
  responseMimeType?: "application/json" | "text/plain";
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  modelName?: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  void params.abortSignal;
  const model = String(params.modelName || "").trim() || resolveGemini35FlashModelName();
  const systemInstruction = `${GEMINI_35_FLASH_COPYWRITING_SYSTEM}\n\n${params.taskSystemInstruction}`.trim();
  const baseConfig = {
    systemInstruction,
    temperature: params.temperature ?? readCopywritingTemperature(),
    topP: params.topP ?? readCopywritingTopP(),
    ...readThinkingConfigForSdk(),
    ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
    maxOutputTokens: resolveGemini35FlashCopywritingMaxOutputTokens(params.maxOutputTokens),
  };

  try {
    return await generateGeminiApiContent({
      model,
      userText: params.userText,
      config: { ...baseConfig, tools: [{ googleSearch: {} }] },
    });
  } catch (e) {
    console.warn("[gemini35Flash] copywriting googleSearch 降级:", (e as Error)?.message?.slice(0, 200));
    return generateGeminiApiContent({
      model,
      userText: params.userText,
      config: baseConfig,
    });
  }
}

/**
 * 生图英文化（Gemini API）：temperature 0.7 · topP 0.9 · thinking HIGH · 无 googleSearch。
 */
export async function callGemini35FlashImageTranslation(params: {
  systemInstruction: string;
  userText: string;
  modelName?: string;
  temperature?: number;
  topP?: number;
  maxOutputTokens?: number;
}): Promise<string> {
  const model = String(params.modelName || "").trim() || resolveGemini35FlashModelName();
  return generateGeminiApiContent({
    model,
    userText: params.userText,
    config: {
      systemInstruction: params.systemInstruction,
      responseMimeType: "application/json",
      temperature: params.temperature ?? readImageTranslationTemperature(),
      topP: params.topP ?? readImageTranslationTopP(),
      maxOutputTokens: resolveGemini35FlashImageTranslationMaxOutputTokens(params.maxOutputTokens),
      tools: [],
      ...readThinkingConfigForSdk(),
    },
  });
}
