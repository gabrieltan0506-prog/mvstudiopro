/**
 * Gemini Audio Analysis Service
 * Uses Google GenAI SDK to analyze music/audio files
 * Extracts: BPM, mood, rhythm changes, song structure, instrumentation, lyrics
 *
 * 漫剧学习语音：OpenRouter `google/gemini-3.6-flash` 为主，原生 Vertex
 * `gemini-3.6-flash` 为故障回退；通用音乐分析仍保留 Gemini API。
 */
import { GoogleGenAI } from "@google/genai";
import { resolveGemini35FlashModelName } from "./services/gemini35FlashRuntime.js";
import {
  buildOpenRouterAuthHeaders,
  getOpenRouterApiKey,
} from "./services/openrouterAuth.js";
import {
  baseUrlForVertex,
  getVertexAuthHeaders,
  getVertexProjectId,
} from "./services/vertexMedia.js";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function getClient() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
}

/** 音频分析默认：gemini-3.5-flash（与 Platform 趋势同款）；可用 GEMINI_AUDIO_MODEL 覆写 */
export function resolveGeminiAudioModelName(): string {
  const fromEnv = String(process.env.GEMINI_AUDIO_MODEL || "").trim();
  if (fromEnv) return fromEnv;
  const flash = resolveGemini35FlashModelName();
  // 仅当环境已显式指定 3.5 flash 时沿用；否则音频链路默认 3.5（勿落到 3-flash-preview）
  if (/gemini-3\.5-flash/i.test(flash)) return flash;
  const growth = String(process.env.GROWTH_CAMP_EXTRACTOR_MODEL || "").trim();
  if (/gemini-3\.5-flash/i.test(growth)) return growth;
  return "gemini-3.5-flash";
}

export interface AudioAnalysisResult {
  /** Estimated BPM */
  bpm: number;
  /** BPM range string like "85-95" */
  bpmRange: string;
  /** Overall mood/emotion */
  overallMood: string;
  /** Detected language */
  language: string;
  /** Transcribed lyrics (if vocal) */
  lyrics: string;
  /** Song structure sections */
  sections: Array<{
    name: string;        // e.g. "前奏", "主歌A", "副歌", "桥段", "尾奏"
    timeRange: string;   // e.g. "0:00-0:15"
    mood: string;
    energy: string;      // "低", "中", "高", "极高"
    instruments: string; // e.g. "钢琴、弦乐"
    rhythmPattern: string;
    lyrics?: string;
  }>;
  /** Overall instrumentation */
  instrumentation: string;
  /** Suggested color palette for MV */
  suggestedColorPalette: string;
  /** Suggested visual style */
  suggestedVisualStyle: string;
  /** Genre */
  genre: string;
  /** Key/Scale */
  musicalKey: string;
  /** Dynamic range description */
  dynamicRange: string;
}

/**
 * Analyze an audio file using Gemini multimodal
 */
export async function analyzeAudioWithGemini(audioUrl: string): Promise<AudioAnalysisResult> {
  const ai = getClient();

  // Download audio file
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
  const audioBuffer = await audioRes.arrayBuffer();
  const base64Audio = Buffer.from(audioBuffer).toString("base64");
  const mimeType = audioRes.headers.get("content-type") || "audio/mpeg";

  const systemPrompt = `你是一位世界级的音乐制作人、MV导演和音频分析专家。请仔细聆听这段音频，进行全方位的专业分析。

【分析维度】
1. BPM（节拍速度）：精确估算每分钟节拍数
2. 整体情绪：描述音乐传达的核心情感
3. 语言：检测歌曲使用的语言
4. 歌词：如果有人声，尽可能转录完整歌词
5. 歌曲结构：将歌曲拆分为段落（前奏/主歌/副歌/桥段/尾奏等），标注每段的时间范围、情绪、能量等级、主要乐器、节奏特征
6. 乐器编排：列出使用的主要乐器和音色
7. 建议色彩方案：根据音乐情绪建议 MV 的色彩方案
8. 建议视觉风格：根据音乐风格建议 MV 的视觉风格
9. 音乐风格/流派
10. 调性/音阶
11. 动态范围：描述音量变化特征

请以 JSON 格式返回分析结果。`;

  const response = await ai.models.generateContent({
    model: resolveGeminiAudioModelName(),
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: base64Audio, mimeType } },
          { text: systemPrompt },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object" as any,
        properties: {
          bpm: { type: "number" as any, description: "估算的BPM" },
          bpmRange: { type: "string" as any, description: "BPM范围如 85-95" },
          overallMood: { type: "string" as any, description: "整体情绪" },
          language: { type: "string" as any, description: "歌曲语言" },
          lyrics: { type: "string" as any, description: "转录的歌词，无歌词则为空" },
          sections: {
            type: "array" as any,
            items: {
              type: "object" as any,
              properties: {
                name: { type: "string" as any },
                timeRange: { type: "string" as any },
                mood: { type: "string" as any },
                energy: { type: "string" as any },
                instruments: { type: "string" as any },
                rhythmPattern: { type: "string" as any },
                lyrics: { type: "string" as any },
              },
              required: ["name", "timeRange", "mood", "energy", "instruments", "rhythmPattern"],
            },
          },
          instrumentation: { type: "string" as any, description: "乐器编排" },
          suggestedColorPalette: { type: "string" as any, description: "建议色彩方案" },
          suggestedVisualStyle: { type: "string" as any, description: "建议视觉风格" },
          genre: { type: "string" as any, description: "音乐风格" },
          musicalKey: { type: "string" as any, description: "调性" },
          dynamicRange: { type: "string" as any, description: "动态范围描述" },
        },
        required: [
          "bpm", "bpmRange", "overallMood", "language", "lyrics",
          "sections", "instrumentation", "suggestedColorPalette",
          "suggestedVisualStyle", "genre", "musicalKey", "dynamicRange",
        ],
      },
    },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 未返回分析结果");

  return JSON.parse(text) as AudioAnalysisResult;
}

/** 漫剧/短剧音轨：分段 + 对白摘要 + 能量（供抽帧高潮加密） */
export type ManhuaDramaAudioScanResult = {
  model: string;
  language: string;
  transcriptSummary: string;
  sections: Array<{
    name: string;
    timeRange: string;
    mood: string;
    energy: string;
    lyrics?: string;
  }>;
};

export const DEFAULT_MANHUA_AUDIO_OPENROUTER_MODEL = "google/gemini-3.6-flash";
export const DEFAULT_MANHUA_AUDIO_VERTEX_MODEL = "gemini-3.6-flash";

export function resolveManhuaAudioOpenRouterModelName(): string {
  return (
    String(process.env.MANHUA_AUDIO_OPENROUTER_MODEL || "").trim()
    || DEFAULT_MANHUA_AUDIO_OPENROUTER_MODEL
  );
}

export function resolveManhuaAudioVertexModelName(): string {
  return (
    String(process.env.MANHUA_AUDIO_VERTEX_MODEL || "").trim()
    || DEFAULT_MANHUA_AUDIO_VERTEX_MODEL
  );
}

function resolveManhuaAudioVertexLocation(): string {
  return (
    String(process.env.MANHUA_AUDIO_VERTEX_LOCATION || process.env.VERTEX_GEMINI_LOCATION || "global").trim()
    || "global"
  );
}

function resolveManhuaAudioOpenRouterUrl(): string {
  const base = String(process.env.OPENROUTER_API_BASE || "https://openrouter.ai/api/v1")
    .trim()
    .replace(/\/+$/, "");
  return `${base || "https://openrouter.ai/api/v1"}/chat/completions`;
}

function openRouterAudioFormat(mimeType: string): string {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("flac")) return "flac";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("aac")) return "aac";
  if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a";
  return "mp3";
}

function readOpenRouterErrorMessage(payload: unknown): string {
  return String((payload as { error?: { message?: unknown } })?.error?.message || "").trim();
}

export function mapManhuaAudioProviderFailure(status: number, payload?: unknown): string {
  const providerMessage = readOpenRouterErrorMessage(payload);
  if (status === 404 && /No allowed providers are available/i.test(providerMessage)) {
    return "语音分析服务尚未放行 Google Provider";
  }
  if (status === 403 && /Terms Of Service|prohibited/i.test(providerMessage)) {
    return "语音分析服务被 Provider TOS 拒绝";
  }
  if (status === 401 || status === 403) return "语音分析服务鉴权失败";
  if (status === 402) return "语音分析服务余额不足";
  if (status === 404) return "语音分析模型暂不可用";
  if (status === 408 || status === 429) return "语音分析服务繁忙或限流";
  if (status >= 500) return "语音分析服务暂时不可用";
  return "语音分析请求失败";
}

export function isManhuaAudioFailureRetryable(message: string): boolean {
  const normalized = String(message || "");
  if (/服务(?:繁忙|暂时不可用|请求超时|网络异常)|限流/.test(normalized)) return true;
  return !/(?:Vertex )?语音分析服务(?:未配置|鉴权失败|余额不足|尚未放行 Google Provider|被 Provider TOS 拒绝)|(?:Vertex )?语音分析模型暂不可用/.test(
    normalized,
  );
}

function readOpenRouterMessageText(payload: unknown): string {
  const content = (payload as {
    choices?: Array<{ message?: { content?: unknown } }>;
  })?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      return String((part as { text?: unknown }).text || "");
    })
    .join("")
    .trim();
}

function parseManhuaAudioJson(text: string): Omit<ManhuaDramaAudioScanResult, "model"> {
  const normalized = String(text || "")
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!normalized) throw new Error("语音分析没有返回内容");
  try {
    return JSON.parse(normalized) as Omit<ManhuaDramaAudioScanResult, "model">;
  } catch {
    throw new Error("语音分析结果格式无效");
  }
}

export function isManhuaDramaVertexAudioAvailable(): boolean {
  const hasCredentials = Boolean(
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim()
    || String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim(),
  );
  return hasCredentials && Boolean(String(process.env.VERTEX_PROJECT_ID || "").trim());
}

export function isManhuaDramaAudioAvailable(): boolean {
  return Boolean(getOpenRouterApiKey()) || isManhuaDramaVertexAudioAvailable();
}

/** Fly 按 HTTPS/签名 URL 拉取后 inline 给 OpenRouter（不把大 base64 从本机塞进请求体）。 */
export async function analyzeManhuaDramaAudioFromUrl(input: {
  audioUrl: string;
  mimeType?: string;
  maxBytes?: number;
}): Promise<ManhuaDramaAudioScanResult> {
  const url = String(input.audioUrl || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    throw new Error("missing_or_invalid_audio_url");
  }
  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "mvstudiopro/1.0 (+manhua-audio-climax)" },
  });
  if (!res.ok) throw new Error(`audio_fetch_failed:${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const maxBytes = Math.max(1_000_000, Math.min(24 * 1024 * 1024, input.maxBytes ?? 18 * 1024 * 1024));
  if (!buf.length) throw new Error("empty_audio");
  if (buf.length > maxBytes) throw new Error(`audio_too_large:${buf.length}`);
  const mimeType =
    String(input.mimeType || "").trim() ||
    String(res.headers.get("content-type") || "audio/mpeg").split(";")[0] ||
    "audio/mpeg";
  return analyzeManhuaDramaAudioWithFallback({
    audioBase64: buf.toString("base64"),
    mimeType,
  });
}

const MANHUA_AUDIO_SYSTEM_PROMPT = `你是竖屏短剧/漫剧听写与节奏分析助手。只根据音频输出 JSON，不要解释。
任务：
1. 尽量转写对白/旁白（可压缩，保留冲突与情绪词）。
2. 按时间拆成 4～12 段，timeRange 用 m:ss-m:ss 或 秒-秒（如 0:00-0:15 或 58-72）。
3. energy 用：低 / 中 / 高 / 极高。高潮、打脸、反转、对决、爆发段标「高」或「极高」，name 可用「开场钩子/对峙/反转/高潮/片尾钩」等中性名。
4. 不要输出外部平台剧名、商标。`;

function normalizeManhuaAudioResult(
  model: string,
  parsed: Omit<ManhuaDramaAudioScanResult, "model">,
): ManhuaDramaAudioScanResult {
  return {
    model,
    language: String(parsed.language || "").trim(),
    transcriptSummary: String(parsed.transcriptSummary || "").trim(),
    sections: Array.isArray(parsed.sections)
      ? parsed.sections.map((s) => ({
          name: String(s.name || "").trim(),
          timeRange: String(s.timeRange || "").trim(),
          mood: String(s.mood || "").trim(),
          energy: String(s.energy || "").trim(),
          lyrics: String(s.lyrics || "").trim() || undefined,
        }))
      : [],
  };
}

export async function analyzeManhuaDramaAudioWithOpenRouter(input: {
  audioBase64: string;
  mimeType?: string;
}): Promise<ManhuaDramaAudioScanResult> {
  const apiKey = getOpenRouterApiKey();
  if (!apiKey) throw new Error("语音分析服务未配置");
  const model = resolveManhuaAudioOpenRouterModelName();
  const mimeType = String(input.mimeType || "audio/mpeg").trim() || "audio/mpeg";

  const response = await fetch(resolveManhuaAudioOpenRouterUrl(), {
    method: "POST",
    headers: buildOpenRouterAuthHeaders(apiKey),
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: MANHUA_AUDIO_SYSTEM_PROMPT },
            {
              type: "input_audio",
              input_audio: {
                data: input.audioBase64,
                format: openRouterAudioFormat(mimeType),
              },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 4096,
      provider: { require_parameters: true },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "manhua_drama_audio_scan",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              language: { type: "string" },
              transcriptSummary: { type: "string" },
              sections: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  properties: {
                    name: { type: "string" },
                    timeRange: { type: "string" },
                    mood: { type: "string" },
                    energy: { type: "string" },
                    lyrics: { type: "string" },
                  },
                  required: ["name", "timeRange", "mood", "energy", "lyrics"],
                },
              },
            },
            required: ["language", "transcriptSummary", "sections"],
          },
        },
      },
    }),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("语音分析服务请求超时");
    }
    throw new Error("语音分析服务网络异常");
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(mapManhuaAudioProviderFailure(response.status, payload));
  }
  const parsed = parseManhuaAudioJson(readOpenRouterMessageText(payload));
  return normalizeManhuaAudioResult(model, parsed);
}

function readVertexMessageText(payload: unknown): string {
  const parts = (payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  })?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts.map((part) => String(part?.text || "")).join("").trim()
    : "";
}

function mapManhuaVertexAudioFailure(status: number): string {
  if (status === 401 || status === 403) return "Vertex 语音分析服务鉴权失败";
  if (status === 404) return "Vertex 语音分析模型暂不可用";
  if (status === 408 || status === 429) return "Vertex 语音分析服务繁忙或限流";
  if (status >= 500) return "Vertex 语音分析服务暂时不可用";
  return "Vertex 语音分析请求失败";
}

export async function analyzeManhuaDramaAudioWithVertex(input: {
  audioBase64: string;
  mimeType?: string;
}): Promise<ManhuaDramaAudioScanResult> {
  if (!isManhuaDramaVertexAudioAvailable()) {
    throw new Error("Vertex 语音分析服务未配置");
  }
  const model = resolveManhuaAudioVertexModelName();
  const location = resolveManhuaAudioVertexLocation();
  const projectId = getVertexProjectId();
  const url = `${baseUrlForVertex(location)}/v1/projects/${encodeURIComponent(projectId)}`
    + `/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
  const mimeType = String(input.mimeType || "audio/mpeg").trim() || "audio/mpeg";
  const headers = await getVertexAuthHeaders().catch(() => {
    throw new Error("Vertex 语音分析服务鉴权失败");
  });
  const response = await fetch(url, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: MANHUA_AUDIO_SYSTEM_PROMPT },
          { inlineData: { data: input.audioBase64, mimeType } },
        ],
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        audioTimestamp: true,
        responseSchema: {
          type: "OBJECT",
          properties: {
            language: { type: "STRING" },
            transcriptSummary: { type: "STRING" },
            sections: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                properties: {
                  name: { type: "STRING" },
                  timeRange: { type: "STRING" },
                  mood: { type: "STRING" },
                  energy: { type: "STRING" },
                  lyrics: { type: "STRING" },
                },
                required: ["name", "timeRange", "mood", "energy", "lyrics"],
              },
            },
          },
          required: ["language", "transcriptSummary", "sections"],
        },
      },
    }),
  }).catch((error: unknown) => {
    if (error instanceof Error && error.name === "TimeoutError") {
      throw new Error("Vertex 语音分析服务请求超时");
    }
    if (error instanceof Error && /^Vertex 语音分析/.test(error.message)) throw error;
    throw new Error("Vertex 语音分析服务网络异常");
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(mapManhuaVertexAudioFailure(response.status));
  const parsed = parseManhuaAudioJson(readVertexMessageText(payload));
  return normalizeManhuaAudioResult(`vertex/${model}`, parsed);
}

function safeManhuaAudioError(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "语音分析请求失败";
}

/** OpenRouter 主链；任何主链失败只回退一次 Vertex，不重复提取或上传音频。 */
export async function analyzeManhuaDramaAudioWithFallback(input: {
  audioBase64: string;
  mimeType?: string;
}): Promise<ManhuaDramaAudioScanResult> {
  let openRouterFailure = "";
  if (getOpenRouterApiKey()) {
    try {
      return await analyzeManhuaDramaAudioWithOpenRouter(input);
    } catch (error) {
      openRouterFailure = safeManhuaAudioError(error);
    }
  }
  if (isManhuaDramaVertexAudioAvailable()) {
    try {
      return await analyzeManhuaDramaAudioWithVertex(input);
    } catch (error) {
      const vertexFailure = safeManhuaAudioError(error);
      if (openRouterFailure) {
        throw new Error(`语音分析双路失败：OpenRouter（${openRouterFailure}）；Vertex（${vertexFailure}）`);
      }
      throw error;
    }
  }
  if (openRouterFailure) throw new Error(openRouterFailure);
  throw new Error("语音分析服务未配置");
}

/** @deprecated 兼容旧调用名；生产实现为 OpenRouter 主链 + Vertex 原生回退。 */
export const analyzeManhuaDramaAudioWithGemini = analyzeManhuaDramaAudioWithFallback;

/**
 * Check if Gemini Audio Analysis is available
 */
export function isGeminiAudioAvailable(): boolean {
  return !!GEMINI_API_KEY;
}
