/**
 * Gemini Audio Analysis Service
 * Uses Google GenAI SDK to analyze music/audio files
 * Extracts: BPM, mood, rhythm changes, song structure, instrumentation, lyrics
 */
import { GoogleGenAI } from "@google/genai";

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function getClient() {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured");
  }
  return new GoogleGenAI({ apiKey: GEMINI_API_KEY });
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
    model: "gemini-2.0-flash",
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

/**
 * Check if Gemini Audio Analysis is available
 */
export function isGeminiAudioAvailable(): boolean {
  return !!GEMINI_API_KEY;
}
