/**
 * Gemini 3.5 Flash · 文案生成（googleSearch + HIGH thinking）与生图提示词英文化（无工具 + HIGH thinking）。
 * 统一 Vertex `@google/genai` 客户端与模型 ID 解析。
 */
import { GoogleGenAI } from "@google/genai";

/** 平台默认：Gemini 3.5 Flash（可用 GEMINI_35_FLASH_MODEL 覆写）。 */
export const DEFAULT_GEMINI_35_FLASH_MODEL = "gemini-3.5-flash";

export function resolveGemini35FlashModelName(): string {
  const fromEnv =
    String(process.env.GEMINI_35_FLASH_MODEL || "").trim() ||
    String(process.env.GROWTH_CAMP_EXTRACTOR_MODEL || "").trim() ||
    String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_MODEL || "").trim() ||
    String(process.env.VERTEX_GEMINI_COVER_TRANSLATION_MODEL || "").trim();
  return fromEnv || DEFAULT_GEMINI_35_FLASH_MODEL;
}

/** Stage2 专属文案（`buildPlatformContent`）；可 `PLATFORM_STAGE2_GEMINI_MODEL` 覆写。 */
export function resolvePlatformStage2GeminiModel(): string {
  return String(process.env.PLATFORM_STAGE2_GEMINI_MODEL || "").trim() || resolveGemini35FlashModelName();
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

function resolveVertexProjectIdForGenAi(): string {
  const p = String(
    process.env.GCP_PROJECT_ID ||
      process.env.VERTEX_PROJECT_ID ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      "",
  ).trim();
  if (!p) throw new Error("missing GCP project for Vertex GenAI");
  return p;
}

function resolveVertexFlashTranslationLocation(): string {
  const loc = String(process.env.VERTEX_GEMINI_FLASH_TRANSLATION_LOCATION || "global").trim();
  return loc || "global";
}

function buildGoogleGenAiAuthOptionsFromEnv():
  | { credentials: { client_email: string; private_key: string } }
  | undefined {
  const raw = String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim();
  if (!raw || raw === "{}") return undefined;
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
    console.warn("[gemini35Flash] 解析 GOOGLE_APPLICATION_CREDENTIALS_JSON 失败:", e);
  }
  return undefined;
}

function buildVertexGenAiClient(): GoogleGenAI {
  const project = resolveVertexProjectIdForGenAi();
  const location = resolveVertexFlashTranslationLocation();
  const authOpts = buildGoogleGenAiAuthOptionsFromEnv();
  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
    ...(authOpts ? { googleAuthOptions: authOpts } : {}),
  });
}

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

function readImageTranslationTemperature(): number {
  const raw = process.env.GEMINI_35_FLASH_IMAGE_TRANSLATION_TEMPERATURE;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 2) return n;
  }
  return 0.7;
}

function readImageTranslationTopP(): number {
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

/**
 * 文案生成：temperature 0.8 · topP 0.9 · thinking HIGH · googleSearch。
 */
export async function callGemini35FlashCopywriting(params: {
  taskSystemInstruction: string;
  userText: string;
  responseMimeType?: "application/json" | "text/plain";
  maxOutputTokens?: number;
  temperature?: number;
  topP?: number;
  /** 覆写模型 ID；Stage 2 传 {@link resolvePlatformStage2GeminiModel}。 */
  modelName?: string;
  abortSignal?: AbortSignal;
}): Promise<string> {
  const ai = buildVertexGenAiClient();
  const model = String(params.modelName || "").trim() || resolveGemini35FlashModelName();
  const systemInstruction = `${GEMINI_35_FLASH_COPYWRITING_SYSTEM}\n\n${params.taskSystemInstruction}`.trim();
  const config = {
    systemInstruction,
    temperature: params.temperature ?? readCopywritingTemperature(),
    topP: params.topP ?? readCopywritingTopP(),
    thinkingConfig: { thinkingLevel: readThinkingLevel(), includeThoughts: false },
    tools: [{ googleSearch: {} }],
    ...(params.responseMimeType ? { responseMimeType: params.responseMimeType } : {}),
    ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : { maxOutputTokens: 8192 }),
  };

  let response;
  try {
    response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: params.userText }] }],
      config: config as any,
    });
  } catch (e) {
    console.warn("[gemini35Flash] copywriting googleSearch 降级:", (e as Error)?.message?.slice(0, 200));
    const { tools: _tools, ...configNoSearch } = config;
    response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: params.userText }] }],
      config: configNoSearch as any,
    });
  }

  const text = String((response as { text?: string })?.text ?? "").trim();
  if (!text) {
    throw new Error(`gemini-3.5-flash 文案生成无文本产出（model=${model}）`);
  }
  return text;
}
