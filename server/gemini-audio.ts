/**
 * Gemini Audio Analysis Service
 * Extracts: BPM, mood, rhythm changes, song structure, instrumentation, lyrics
 *
 * 1110 通道合规：所有听音入口（音频实验室、漫剧学习听音扫描、语音转写）一律「音频先存 GCS → geminiAudioJsonWithFallback 两跳」：
 * Gemini@Vertex 读 gs:// → Gemini@EvoLink 读 V4 签名 https（3600 秒），模型 gemini-3.8-flash；
 * 不直连 Gemini API 密钥、不接第三方聚合通道、不内联 base64；每跳 request/raw/decoded/parsed/rejected 永久落 GCS，证据只记 gs://。
 */
import { createHash, randomUUID } from "node:crypto";
import { resolveGemini35FlashModelName } from "./services/gemini35FlashRuntime.js";
import {
  baseUrlForVertex,
  getVertexAuthHeaders,
  getVertexProjectId,
} from "./services/vertexMedia.js";
import { getGcsBucketName, signGsUriV4ReadUrl, uploadBufferToGcsIfAbsent } from "./services/gcs";

/** 1110 两跳统一模型（用户口径：Gemini 只走 Vertex → EvoLink，固定 gemini-3.8-flash）。 */
export const GEMINI_AUDIO_TWO_HOP_MODEL = "gemini-3.8-flash";

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

const AUDIO_LAB_PROMPT = `你是一位世界级的音乐制作人、MV导演和音频分析专家。请仔细聆听这段音频，进行全方位的专业分析。

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

const AUDIO_LAB_NATIVE_SCHEMA = {
  type: "OBJECT",
  properties: {
    bpm: { type: "NUMBER", description: "估算的BPM" },
    bpmRange: { type: "STRING", description: "BPM范围如 85-95" },
    overallMood: { type: "STRING", description: "整体情绪" },
    language: { type: "STRING", description: "歌曲语言" },
    lyrics: { type: "STRING", description: "转录的歌词，无歌词则为空" },
    sections: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING" },
          timeRange: { type: "STRING" },
          mood: { type: "STRING" },
          energy: { type: "STRING" },
          instruments: { type: "STRING" },
          rhythmPattern: { type: "STRING" },
          lyrics: { type: "STRING" },
        },
        required: ["name", "timeRange", "mood", "energy", "instruments", "rhythmPattern"],
      },
    },
    instrumentation: { type: "STRING", description: "乐器编排" },
    suggestedColorPalette: { type: "STRING", description: "建议色彩方案" },
    suggestedVisualStyle: { type: "STRING", description: "建议视觉风格" },
    genre: { type: "STRING", description: "音乐风格" },
    musicalKey: { type: "STRING", description: "调性" },
    dynamicRange: { type: "STRING", description: "动态范围描述" },
  },
  required: [
    "bpm", "bpmRange", "overallMood", "language", "lyrics",
    "sections", "instrumentation", "suggestedColorPalette",
    "suggestedVisualStyle", "genre", "musicalKey", "dynamicRange",
  ],
};

/** 写坏（非对象、BPM 无效、无段落）即抛，交下一跳。 */
function parseAudioLabAnalysis(decoded: unknown): AudioAnalysisResult {
  const v = decoded as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("分析结果不是 JSON 对象");
  const bpm = Number(v.bpm);
  if (!Number.isFinite(bpm) || bpm <= 0) throw new Error(`BPM 无效：${String(v.bpm)}`);
  if (!Array.isArray(v.sections) || !v.sections.length) throw new Error("缺少歌曲段落");
  const str = (x: unknown) => String(x ?? "").trim();
  return {
    bpm,
    bpmRange: str(v.bpmRange),
    overallMood: str(v.overallMood),
    language: str(v.language),
    lyrics: str(v.lyrics),
    sections: v.sections.map((raw) => {
      const s = (raw || {}) as Record<string, unknown>;
      const lyrics = str(s.lyrics);
      return {
        name: str(s.name),
        timeRange: str(s.timeRange),
        mood: str(s.mood),
        energy: str(s.energy),
        instruments: str(s.instruments),
        rhythmPattern: str(s.rhythmPattern),
        ...(lyrics ? { lyrics } : {}),
      };
    }),
    instrumentation: str(v.instrumentation),
    suggestedColorPalette: str(v.suggestedColorPalette),
    suggestedVisualStyle: str(v.suggestedVisualStyle),
    genre: str(v.genre),
    musicalKey: str(v.musicalKey),
    dynamicRange: str(v.dynamicRange),
  };
}

/** 下载回包的 content-type 不是音视频（如 octet-stream）时按 mp3 交模型。 */
function audioMimeFromResponse(res: Response, fallback = "audio/mpeg"): string {
  const ct = String(res.headers.get("content-type") || "").split(";")[0]!.trim().toLowerCase();
  return /^(audio|video)\//.test(ct) ? ct : fallback;
}

/**
 * Analyze an audio file（音频实验室）：下载 → 存 GCS → 两跳（Vertex gs:// → EvoLink 签名 https）。
 */
export async function analyzeAudioWithGemini(audioUrl: string): Promise<AudioAnalysisResult> {
  const audioRes = await fetch(audioUrl);
  if (!audioRes.ok) throw new Error(`Failed to download audio: ${audioRes.status}`);
  const audio = Buffer.from(await audioRes.arrayBuffer());
  const out = await listenStagedAudioJson({
    area: "audio-lab/analysis",
    audio,
    mimeType: audioMimeFromResponse(audioRes),
    prompt: AUDIO_LAB_PROMPT,
    nativeSchema: AUDIO_LAB_NATIVE_SCHEMA,
    schemaName: "audio_lab_analysis",
    validate: parseAudioLabAnalysis,
  });
  return out.value;
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

export const DEFAULT_MANHUA_AUDIO_VERTEX_MODEL = GEMINI_AUDIO_TWO_HOP_MODEL; // 1110：Gemini 一律 3.8 Flash
export const DEFAULT_MANHUA_AUDIO_EVOLINK_MODEL = GEMINI_AUDIO_TWO_HOP_MODEL; // 1110：Gemini 一律 3.8 Flash

export function resolveManhuaAudioVertexModelName(): string {
  return (
    String(process.env.MANHUA_AUDIO_VERTEX_MODEL || "").trim()
    || DEFAULT_MANHUA_AUDIO_VERTEX_MODEL
  );
}

export function resolveManhuaAudioEvolinkModelName(): string {
  return (
    String(process.env.MANHUA_AUDIO_EVOLINK_MODEL || "").trim()
    || DEFAULT_MANHUA_AUDIO_EVOLINK_MODEL
  );
}

function resolveManhuaAudioVertexLocation(): string {
  return (
    String(process.env.MANHUA_AUDIO_VERTEX_LOCATION || process.env.VERTEX_GEMINI_LOCATION || "global").trim()
    || "global"
  );
}

function resolveManhuaAudioEvolinkBaseUrl(): string {
  return String(
    process.env.MANHUA_AUDIO_EVOLINK_BASE_URL
    || process.env.EVOLINK_DIRECT_BASE_URL
    || "https://direct.evolink.ai",
  ).trim().replace(/\/+$/, "") || "https://direct.evolink.ai";
}

/** GCS 对象扩展名（仅用于对象命名；送模型的 mimeType 另传）。 */
function audioObjectExt(mimeType: string): string {
  const normalized = String(mimeType || "").toLowerCase();
  if (normalized.includes("wav")) return "wav";
  if (normalized.includes("flac")) return "flac";
  if (normalized.includes("ogg")) return "ogg";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("aac")) return "aac";
  if (normalized.includes("m4a") || normalized.includes("mp4")) return "m4a";
  return "mp3";
}

export function isManhuaDramaVertexAudioAvailable(): boolean {
  const hasCredentials = Boolean(
    String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim()
    || String(process.env.GOOGLE_APPLICATION_CREDENTIALS || "").trim(),
  );
  return hasCredentials && Boolean(String(process.env.VERTEX_PROJECT_ID || "").trim());
}

export function isManhuaDramaEvolinkAudioAvailable(): boolean {
  return Boolean(String(process.env.EVOLINK_API_KEY || "").trim());
}

/** 听音只有 Vertex 与 EvoLink 两跳；任一可用即可。 */
export function isManhuaDramaAudioAvailable(): boolean {
  return isManhuaDramaVertexAudioAvailable() || isManhuaDramaEvolinkAudioAvailable();
}

/** 漫剧学习听音扫描（api/google.ts manhuaAudioClimaxScan 经两跳调用）：提示词 / 原生 schema / 结果整形，一处真源。 */
export const MANHUA_AUDIO_SCAN_PROMPT = `你是竖屏短剧/漫剧听写与节奏分析助手。只根据音频输出 JSON，不要解释。
任务：
1. 尽量转写对白/旁白（可压缩，保留冲突与情绪词）。
2. 按时间拆成 4～12 段，timeRange 用 m:ss-m:ss 或 秒-秒（如 0:00-0:15 或 58-72）。
3. energy 用：低 / 中 / 高 / 极高。高潮、打脸、反转、对决、爆发段标「高」或「极高」，name 可用「开场钩子/对峙/反转/高潮/片尾钩」等中性名。
4. 不要输出外部平台剧名、商标。`;

export const MANHUA_AUDIO_SCAN_SCHEMA = {
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
};

/** 两跳 validate：写坏（非对象或无 sections 数组）即抛，交下一跳；其余字段按旧口径规整（model 由调用方按「通道/模型」补）。 */
export function normalizeManhuaAudioScan(decoded: unknown): Omit<ManhuaDramaAudioScanResult, "model"> {
  const parsed = decoded as Record<string, unknown> | null;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("语音分析结果不是 JSON 对象");
  if (!Array.isArray(parsed.sections)) throw new Error("语音分析结果缺少 sections");
  return {
    language: String(parsed.language || "").trim(),
    transcriptSummary: String(parsed.transcriptSummary || "").trim(),
    sections: parsed.sections.map((raw) => {
      const s = (raw || {}) as Record<string, unknown>;
      return {
        name: String(s.name || "").trim(),
        timeRange: String(s.timeRange || "").trim(),
        mood: String(s.mood || "").trim(),
        energy: String(s.energy || "").trim(),
        lyrics: String(s.lyrics || "").trim() || undefined,
      };
    }),
  };
}

function readNativeGeminiMessageText(payload: unknown): string {
  const parts = (payload as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: unknown }> } }>;
  })?.candidates?.[0]?.content?.parts;
  return Array.isArray(parts)
    ? parts.map((part) => String(part?.text || "")).join("").trim()
    : "";
}

/**
 * Check if Gemini Audio Analysis is available（Vertex 或 EvoLink 任一可用）
 */
export function isGeminiAudioAvailable(): boolean {
  return isManhuaDramaAudioAvailable();
}

export type GeminiAudioJsonChannel = "Vertex" | "EvoLink";

/**
 * 通用「听音 → JSON」两跳（1109 MV 歌词识别；用户口径：Gemini 只有 Vertex 与 EvoLink 两条可用通道，OpenRouter 不接）：
 * Gemini@Vertex → Gemini@EvoLink，复用上面同一套通道配置；
 * 每跳：调用 → JSON 解析 → validate；超时、断线、HTTP 错误、空回、写坏（解析/校验不过）都切下一跳。
 * 每路的请求摘要、原始回包、解析结果或拒收原因经 save 永久落证据；未配置的通道跳过并记录。
 */
export async function geminiAudioJsonWithFallback<T>(input: {
  mimeType: string;
  /**
   * 1110 只收 GCS 媒体（音频或含音轨的视频）：Vertex 用 gs:// 直读，EvoLink 用签名 https（读不了 gs://）。
   * 已删除内联音频入参，「不内联 base64」由类型保证；签名 URL 不落证据（只记 gs://）。
   */
  media: { vertexFileUri: string; evolinkFileUri: () => string };
  /** 两跳统一模型覆盖；缺省固定 gemini-3.8-flash（1110 隔离探针发现缺省沿用听音通道配置会落到 3.6-flash，违反「Gemini 一律 3.8 Flash」）。 */
  model?: string;
  /** 1109：系统指令（MV 独立听歌 / 剪辑方案分析）。 */
  systemInstruction?: string;
  /** 1109：音频时间戳；缺省不发（引用媒体的旧行为）。 */
  audioTimestamp?: boolean;
  /** 1109：原始回包级校验（如必须有 AUDIO token、finishReason=STOP）；返回拒因即按写坏换下一跳。 */
  checkPayload?: (payload: unknown) => string | undefined;
  prompt: string;
  /** Gemini 原生 responseSchema（大写类型）；不给则只要求 application/json。 */
  nativeSchema?: Record<string, unknown>;
  schemaName: string;
  validate: (value: unknown) => T;
  save: (name: string, value: unknown) => Promise<unknown>;
  maxOutputTokens?: number;
  timeoutMs?: number;
}): Promise<{ value: T; channel: GeminiAudioJsonChannel; model: string; failuresZh: string[]; payload: unknown }> {
  // 运行时同样拒收（JS 调用方绕过类型时）：没给 GCS 媒体就不发任何请求。
  if (!input.media?.vertexFileUri || typeof input.media.evolinkFileUri !== "function") {
    throw new Error("听音只收 GCS 媒体（Vertex 读 gs://、EvoLink 读签名 https），不收内联音频");
  }
  const media = input.media;
  const timeoutMs = input.timeoutMs ?? 180_000;
  const maxOutputTokens = input.maxOutputTokens ?? 8192;
  const nativeBody = (fileUri: string) => ({
    ...(input.systemInstruction ? { systemInstruction: { parts: [{ text: input.systemInstruction }] } } : {}),
    contents: [{ role: "user", parts: [{ fileData: { mimeType: input.mimeType, fileUri } }, { text: input.prompt }] }],
    generationConfig: { maxOutputTokens, responseMimeType: "application/json", ...(input.audioTimestamp ? { audioTimestamp: true } : {}), ...(input.nativeSchema ? { responseSchema: input.nativeSchema } : {}), temperature: 0.2 },
  });
  const native = async (url: string, headers: Record<string, string>, fileUri: string) => {
    const response = await fetch(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, signal: AbortSignal.timeout(timeoutMs), body: JSON.stringify(nativeBody(fileUri)) });
    const payload = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, payload, text: readNativeGeminiMessageText(payload) };
  };
  const channels: Array<{ name: GeminiAudioJsonChannel; available: () => boolean; model: () => string; run: () => Promise<{ status: number; ok: boolean; payload: unknown; text: string }> }> = [
    {
      name: "Vertex", available: isManhuaDramaVertexAudioAvailable, model: () => input.model || GEMINI_AUDIO_TWO_HOP_MODEL,
      run: async () => {
        const model = input.model || GEMINI_AUDIO_TWO_HOP_MODEL;
        const location = resolveManhuaAudioVertexLocation();
        const url = `${baseUrlForVertex(location)}/v1/projects/${encodeURIComponent(getVertexProjectId())}/locations/${encodeURIComponent(location)}/publishers/google/models/${encodeURIComponent(model)}:generateContent`;
        return native(url, (await getVertexAuthHeaders()) as Record<string, string>, media.vertexFileUri);
      },
    },
    {
      name: "EvoLink", available: isManhuaDramaEvolinkAudioAvailable, model: () => input.model || GEMINI_AUDIO_TWO_HOP_MODEL,
      run: async () => {
        // 1110：EvoLink 上的 Gemini 读不了 gs://，也不收内联 base64 —— 只认签名 https（同模板学习 manhuaNativeDeepReadRunner）
        const fileUri = media.evolinkFileUri();
        if (!fileUri || !/^https:\/\//.test(fileUri)) throw new Error("EvoLink 只收签名 https 媒体链接（不收 gs:// 或内联音频）");
        return native(`${resolveManhuaAudioEvolinkBaseUrl()}/v1beta/models/${encodeURIComponent(input.model || GEMINI_AUDIO_TWO_HOP_MODEL)}:generateContent`, { Authorization: `Bearer ${String(process.env.EVOLINK_API_KEY || "").trim()}` }, fileUri);
      },
    },
  ];
  const failures: string[] = [];
  for (let i = 0; i < channels.length; i += 1) {
    const ch = channels[i]!;
    const slug = `hop-${i + 1}-${ch.name.toLowerCase().replace(/\s+/g, "_")}`;
    if (!ch.available()) { failures.push(`${ch.name}（未配置，跳过）`); await input.save(`${slug}-skipped`, { channel: ch.name, reasonZh: "未配置" }); continue; }
    const model = ch.model();
    await input.save(`${slug}-request`, { channel: ch.name, model, schemaName: input.schemaName, prompt: input.prompt, mimeType: input.mimeType, mediaGsUri: media.vertexFileUri, ...(input.systemInstruction ? { systemInstruction: input.systemInstruction } : {}), maxOutputTokens, timeoutMs });
    let result: Awaited<ReturnType<typeof ch.run>>;
    try {
      result = await ch.run();
    } catch (error) {
      const reason = error instanceof Error && error.name === "TimeoutError" ? "请求超时" : `网络异常：${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
      failures.push(`${ch.name}（${reason}）`);
      await input.save(`${slug}-error`, { channel: ch.name, model, reasonZh: reason });
      continue;
    }
    await input.save(`${slug}-raw`, { channel: ch.name, model, status: result.status, payload: result.payload });
    if (!result.ok) { failures.push(`${ch.name}（HTTP ${result.status}）`); continue; }
    const payloadReject = input.checkPayload?.(result.payload);
    if (payloadReject) { failures.push(`${ch.name}（${payloadReject}）`); await input.save(`${slug}-rejected`, { channel: ch.name, model, reasonZh: payloadReject }); continue; }
    if (!String(result.text || "").trim()) { failures.push(`${ch.name}（空回）`); await input.save(`${slug}-rejected`, { channel: ch.name, model, reasonZh: "空回" }); continue; }
    try {
      const decoded = JSON.parse(String(result.text || "").replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim());
      await input.save(`${slug}-decoded`, decoded);
      const value = input.validate(decoded);
      await input.save(`${slug}-parsed`, value);
      await input.save("hop-used", { channel: ch.name, model, hop: i + 1, failuresZh: failures });
      return { value, channel: ch.name, model, failuresZh: failures, payload: result.payload };
    } catch (error) {
      const reason = `写坏：${error instanceof Error ? error.message.slice(0, 300) : String(error)}`;
      failures.push(`${ch.name}（${reason}）`);
      await input.save(`${slug}-rejected`, { channel: ch.name, model, reasonZh: reason, textHead: String(result.text || "").slice(0, 600) });
    }
  }
  await input.save("hop-exhausted", { failuresZh: failures });
  throw new Error(`听音识别全部通道失败：${failures.join("；")}`);
}

/**
 * 1110 旧听音入口统一做法（照抄 musicMvLyricTable 43f248f1）：音频先存 GCS，再走 geminiAudioJsonWithFallback 两跳——
 * Vertex 读 gs://；EvoLink 读不了 gs:// → V4 签名 https（signGsUriV4ReadUrl，3600 秒）；不内联 base64。
 * 音频按 SHA-256 存 <area>/<sha256>/audio.<ext>（已存在不覆盖）；本次 request 与每跳 raw/decoded/parsed/rejected
 * 永久落 <area>/<sha256>/attempts/<uuid>/（只增不覆盖）；证据只记 gs://，签名 URL 不入档。
 */
export async function listenStagedAudioJson<T>(input: {
  /** 证据目录（如 audio-lab/analysis）。 */
  area: string;
  audio: Buffer;
  mimeType: string;
  prompt: string;
  nativeSchema?: Record<string, unknown>;
  schemaName: string;
  validate: (value: unknown) => T;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** 写进 request 证据的业务上下文（不得含签名 URL 或密钥）。 */
  context?: Record<string, unknown>;
}): Promise<{ value: T; channel: GeminiAudioJsonChannel; model: string; failuresZh: string[]; payload: unknown; audioGsUri: string; evidencePrefix: string }> {
  if (!isManhuaDramaAudioAvailable()) throw new Error("听音服务未配置（Vertex 与 EvoLink 均不可用）");
  if (!input.audio.length) throw new Error("empty_audio");
  const mimeType = String(input.mimeType || "").split(";")[0]!.trim().toLowerCase() || "audio/mpeg";
  const bucket = getGcsBucketName();
  const audioSha256 = createHash("sha256").update(input.audio).digest("hex");
  const base = `${input.area}/${audioSha256}`;
  const audioObject = `${base}/audio.${audioObjectExt(mimeType)}`;
  await uploadBufferToGcsIfAbsent({ bucket, objectName: audioObject, buffer: input.audio, contentType: mimeType });
  const audioGsUri = `gs://${bucket}/${audioObject}`;
  const prefix = `${base}/attempts/${randomUUID()}`;
  const save = async (name: string, value: unknown) => {
    const saved = await uploadBufferToGcsIfAbsent({ bucket, objectName: `${prefix}/${name}.json`, buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
    if (!saved.created) throw new Error("听音证据已存在，未覆盖原记录");
    return saved;
  };
  await save("request", { ...input.context, area: input.area, audioGsUri, audioSha256, audioBytes: input.audio.length, mimeType, model: GEMINI_AUDIO_TWO_HOP_MODEL, schemaName: input.schemaName });
  const result = await geminiAudioJsonWithFallback({
    media: { vertexFileUri: audioGsUri, evolinkFileUri: () => signGsUriV4ReadUrl(audioGsUri, 3600) },
    audioTimestamp: true,
    model: GEMINI_AUDIO_TWO_HOP_MODEL,
    mimeType,
    prompt: input.prompt,
    nativeSchema: input.nativeSchema,
    schemaName: input.schemaName,
    validate: input.validate,
    save,
    maxOutputTokens: input.maxOutputTokens,
    timeoutMs: input.timeoutMs,
  });
  return { ...result, audioGsUri, evidencePrefix: `gs://${bucket}/${prefix}` };
}
