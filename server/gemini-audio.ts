/**
 * Gemini Audio Analysis Service
 * Uses Google GenAI SDK to analyze music/audio files
 * Extracts: BPM, mood, rhythm changes, song structure, instrumentation, lyrics
 *
 * 漫剧学习抽帧：优先 `gemini-3.5-flash`（见 resolveGemini35FlashModelName / GEMINI_35_FLASH_MODEL）。
 */
import { GoogleGenAI } from "@google/genai";
import { resolveGemini35FlashModelName } from "./services/gemini35FlashRuntime.js";

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

/** 方案 A：Fly 按 HTTPS/签名 URL 拉取后 inline 给 Gemini（不把大 base64 从本机塞进请求体） */
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
  return analyzeManhuaDramaAudioWithGemini({
    audioBase64: buf.toString("base64"),
    mimeType,
  });
}

export async function analyzeManhuaDramaAudioWithGemini(input: {
  audioBase64: string;
  mimeType?: string;
}): Promise<ManhuaDramaAudioScanResult> {
  const ai = getClient();
  const model = resolveGeminiAudioModelName();
  const mimeType = String(input.mimeType || "audio/mpeg").trim() || "audio/mpeg";
  const systemPrompt = `你是竖屏短剧/漫剧听写与节奏分析助手。只根据音频输出 JSON，不要解释。
任务：
1. 尽量转写对白/旁白（可压缩，保留冲突与情绪词）。
2. 按时间拆成 4～12 段，timeRange 用 m:ss-m:ss 或 秒-秒（如 0:00-0:15 或 58-72）。
3. energy 用：低 / 中 / 高 / 极高。高潮、打脸、反转、对决、爆发段标「高」或「极高」，name 可用「开场钩子/对峙/反转/高潮/片尾钩」等中性名。
4. 不要输出外部平台剧名、商标。`;

  const response = await ai.models.generateContent({
    model,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { data: input.audioBase64, mimeType } },
          { text: systemPrompt },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object" as any,
        properties: {
          language: { type: "string" as any },
          transcriptSummary: { type: "string" as any },
          sections: {
            type: "array" as any,
            items: {
              type: "object" as any,
              properties: {
                name: { type: "string" as any },
                timeRange: { type: "string" as any },
                mood: { type: "string" as any },
                energy: { type: "string" as any },
                lyrics: { type: "string" as any },
              },
              required: ["name", "timeRange", "mood", "energy"],
            },
          },
        },
        required: ["language", "transcriptSummary", "sections"],
      },
    },
  });

  const text = response.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error("Gemini 未返回漫剧音频分析");
  const parsed = JSON.parse(text) as Omit<ManhuaDramaAudioScanResult, "model">;
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

/**
 * Check if Gemini Audio Analysis is available
 */
export function isGeminiAudioAvailable(): boolean {
  return !!GEMINI_API_KEY;
}
