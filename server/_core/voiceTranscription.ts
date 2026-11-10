/**
 * Voice transcription helper
 *
 * 1110 通道合规：音频先存 GCS，再走 gemini-audio.ts 两跳（Gemini@Vertex 读 gs:// → Gemini@EvoLink 读 V4 签名 https，
 * 模型 gemini-3.8-flash）；不内联 base64、不直连其他转写服务。每跳原始与解析 JSON 永久落 GCS（voice-transcription/），
 * 证据只记 gs://。返回结构保持 Whisper verbose_json 形状不变。
 *
 * Example usage:
 * ```tsx
 * // Frontend component
 * const transcribeMutation = trpc.voice.transcribe.useMutation({
 *   onSuccess: (data) => {
 *     console.log(data.text); // Full transcription
 *     console.log(data.language); // Detected language
 *     console.log(data.segments); // Timestamped segments
 *   }
 * });
 *
 * // After uploading audio to storage
 * transcribeMutation.mutate({
 *   audioUrl: uploadedAudioUrl,
 *   language: 'en', // optional
 *   prompt: 'Transcribe the meeting' // optional
 * });
 * ```
 */
import {
  GEMINI_TRANSCRIPTION_TEMPERATURE,
  gcsAudioTwoHopMedia,
  geminiAudioJsonWithFallback,
  isGeminiAudioAvailable,
  listenStagedAudioJson,
  resolveGeminiAudioTwoHopModel,
  transcriptionMaxOutputTokens,
  type GeminiAudioJsonChannel,
} from "../gemini-audio";

export type TranscribeOptions = {
  audioUrl?: string; // URL to the audio file (e.g., S3 URL)
  /** 服务端已有的音频字节（如成长营抽出的音轨）；优先于 audioBase64 / audioUrl。 */
  audioBuffer?: Buffer;
  audioBase64?: string;
  mimeType?: string;
  language?: string; // Optional: specify language code (e.g., "en", "es", "zh")
  prompt?: string; // Optional: custom prompt for the transcription
};

// Native Whisper API segment format
export type WhisperSegment = {
  id: number;
  seek: number;
  start: number;
  end: number;
  text: string;
  tokens: number[];
  temperature: number;
  avg_logprob: number;
  compression_ratio: number;
  no_speech_prob: number;
};

// Native Whisper API response format
export type WhisperResponse = {
  task: "transcribe";
  language: string;
  duration: number;
  text: string;
  segments: WhisperSegment[];
};

export type TranscriptionResponse = WhisperResponse; // 结构保持 Whisper verbose_json 不变

export type TranscriptionError = {
  error: string;
  code: "FILE_TOO_LARGE" | "INVALID_FORMAT" | "TRANSCRIPTION_FAILED" | "UPLOAD_FAILED" | "SERVICE_ERROR";
  details?: string;
};

const TRANSCRIPTION_NATIVE_SCHEMA = {
  type: "OBJECT",
  properties: {
    language: { type: "STRING" },
    durationSec: { type: "NUMBER" },
    text: { type: "STRING" },
    segments: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: { startSec: { type: "NUMBER" }, endSec: { type: "NUMBER" }, text: { type: "STRING" } },
        required: ["startSec", "endSec", "text"],
      },
    },
  },
  required: ["language", "durationSec", "text", "segments"],
};

function buildTranscriptionPrompt(options: Pick<TranscribeOptions, "language" | "prompt">): string {
  return [
    "你是逐字听写员。逐字转写所附音频里实际说出或唱出的内容：不总结、不翻译、不补写，听不清的字用「□」占位。",
    "按自然句切分 segments，每段给音频内起止秒（startSec / endSec，保留两位小数，按时间先后且不重叠）；text 为全文。",
    "language 填检测到的语言代码（如 zh、en）；durationSec 填音频总时长（秒）；没有人声时 text 为空字符串、segments 为空数组。",
    options.language ? `用户的工作语言：${getLanguageName(options.language)}（${options.language}）。` : "",
    options.prompt ? `补充要求：${options.prompt}` : "",
    "只返回 JSON：{\"language\":\"zh\",\"durationSec\":0,\"text\":\"全文\",\"segments\":[{\"startSec\":0,\"endSec\":0,\"text\":\"该句文字\"}]}",
  ].filter(Boolean).join("\n");
}

/** 写坏（缺 text / segments、时间非数字或倒序）即抛，交下一跳；映射为 Whisper verbose_json 形状。 */
function parseTranscription(decoded: unknown, fallbackLanguage?: string): WhisperResponse {
  const v = decoded as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error("转写结果不是 JSON 对象");
  if (typeof v.text !== "string") throw new Error("转写结果缺少 text");
  if (!Array.isArray(v.segments)) throw new Error("转写结果缺少 segments");
  const segments: WhisperSegment[] = v.segments.map((raw, i) => {
    const s = (raw || {}) as Record<string, unknown>;
    const start = Number(s.startSec);
    const end = Number(s.endSec);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) {
      throw new Error(`第${i + 1}段时间无效：${String(s.startSec)}–${String(s.endSec)}`);
    }
    // Gemini 不提供 Whisper 的 token / 置信度字段：按结构置 0 / 空数组，保持返回形状不变。
    return {
      id: i, seek: 0, start, end, text: String(s.text ?? "").trim(), tokens: [],
      temperature: 0, avg_logprob: 0, compression_ratio: 0, no_speech_prob: 0,
    };
  });
  const durationSec = Number(v.durationSec);
  const lastEnd = segments.length ? segments[segments.length - 1]!.end : 0;
  return {
    task: "transcribe",
    language: String(v.language || fallbackLanguage || "").trim(),
    duration: Number.isFinite(durationSec) && durationSec > 0 ? Math.max(durationSec, lastEnd) : lastEnd,
    text: v.text.trim(),
    segments,
  };
}

/**
 * 服务端转写两跳规格（transcribeAudio 与 scripts/probe-transcribe-sample.mts 共用一处真源）：
 * 逐字听写 temperature 0；带逐句时间轴、无全文字数上限 → maxOutputTokens 取单次上限（依据见 transcriptionMaxOutputTokens）。
 */
export function voiceTranscriptionListenSpec(options: Pick<TranscribeOptions, "language" | "prompt">) {
  return {
    prompt: buildTranscriptionPrompt(options),
    nativeSchema: TRANSCRIPTION_NATIVE_SCHEMA,
    schemaName: "voice_transcription_v1",
    validate: (decoded: unknown) => parseTranscription(decoded, options.language),
    temperature: GEMINI_TRANSCRIPTION_TEMPERATURE,
    maxOutputTokens: transcriptionMaxOutputTokens(),
    timeoutMs: 240_000,
    context: { language: options.language || null, userPrompt: options.prompt || null },
  };
}

/** 短语音识别（api/google.ts op=transcribeAudio）全文上限：超出判「不可用」（原合同），也是该入口 maxOutputTokens 的估算依据。 */
export const VOICE_INPUT_TRANSCRIPT_MAX_CHARS = 12_000;
const VOICE_INPUT_TRANSCRIBE_PROMPT = "请将音频内容完整转录为文字，写入 JSON 的 text 字段。只输出转录文字本身，不要任何解释、标注或时间码。";
const VOICE_INPUT_TRANSCRIBE_SCHEMA = { type: "OBJECT", properties: { text: { type: "STRING" } }, required: ["text"] };

export type VoiceInputTranscribeOutcome =
  | { ok: true; text: string; channel: GeminiAudioJsonChannel; model: string; failuresZh: string[]; payload: unknown }
  /** detailZh 含各跳拒因，只进日志 / 探针，不回给前台。 */
  | { ok: false; reason: "incomplete" | "unusable" | "upstream"; detailZh: string };

/**
 * 短语音识别两跳（api/google.ts op=transcribeAudio 与 scripts/probe-transcribe-sample.mts 共用的生产函数）：
 * 音频须已存 GCS（Vertex 读 gs://，EvoLink 读 V4 签名 https）；只要全文 {text}，temperature 0，
 * maxOutputTokens 按 12000 字合同估算。finishReason 不是 STOP（截断 / 被拦）判不完整，空文或超 12000 字判不可用，均换下一跳；
 * 两跳都失败回拒因类别（不完整优先，其次不可用，否则上游失败），入口照原合同回 422 / 422 / 502。
 */
export async function transcribeVoiceInputTwoHop(input: {
  audioGsUri: string;
  mimeType: string;
  save: (name: string, value: unknown) => Promise<unknown>;
}): Promise<VoiceInputTranscribeOutcome> {
  let incomplete = false;
  let unusable = false;
  let detailZh = "";
  const result = await geminiAudioJsonWithFallback<{ text: string }>({
    media: gcsAudioTwoHopMedia(input.audioGsUri),
    model: resolveGeminiAudioTwoHopModel(),
    mimeType: input.mimeType,
    prompt: VOICE_INPUT_TRANSCRIBE_PROMPT,
    nativeSchema: VOICE_INPUT_TRANSCRIBE_SCHEMA,
    schemaName: "voice_transcription",
    temperature: GEMINI_TRANSCRIPTION_TEMPERATURE,
    maxOutputTokens: transcriptionMaxOutputTokens(VOICE_INPUT_TRANSCRIPT_MAX_CHARS),
    checkPayload: payload => {
      const finish = (payload as { candidates?: Array<{ finishReason?: unknown }> })?.candidates?.[0]?.finishReason;
      if (finish === "STOP") return undefined;
      incomplete = true;
      return `识别不完整：finishReason=${String(finish)}`;
    },
    validate: decoded => {
      const raw = (decoded as { text?: unknown } | null)?.text;
      const text = typeof raw === "string" ? raw.trim() : "";
      if (!text || text.length > VOICE_INPUT_TRANSCRIPT_MAX_CHARS) {
        unusable = true;
        throw new Error(text ? `转写超过 ${VOICE_INPUT_TRANSCRIPT_MAX_CHARS} 字` : "转写为空");
      }
      return { text };
    },
    save: input.save,
  }).catch((error: unknown) => {
    detailZh = error instanceof Error ? error.message : String(error);
    return null;
  });
  if (!result) return { ok: false, reason: incomplete ? "incomplete" : unusable ? "unusable" : "upstream", detailZh };
  return { ok: true, text: result.value.text, channel: result.channel, model: result.model, failuresZh: result.failuresZh, payload: result.payload };
}

/**
 * Transcribe audio to text（音频先存 GCS → Vertex → EvoLink 两跳）
 *
 * @param options - Audio data and metadata
 * @returns Transcription result or error
 */
export async function transcribeAudio(
  options: TranscribeOptions
): Promise<TranscriptionResponse | TranscriptionError> {
  try {
    // Step 1: Validate channel configuration（只有 Vertex / EvoLink 两跳）
    if (!isGeminiAudioAvailable()) {
      return {
        error: "Voice transcription service authentication is missing",
        code: "SERVICE_ERROR",
        details: "Vertex / EvoLink audio channels are not configured"
      };
    }

    // Step 2: Load audio from server bytes, inline payload or URL
    let audioBuffer: Buffer;
    let mimeType: string;
    try {
      if (options.audioBuffer) {
        audioBuffer = options.audioBuffer;
        mimeType = options.mimeType || "audio/mpeg";
      } else if (options.audioBase64) {
        audioBuffer = Buffer.from(options.audioBase64, "base64");
        mimeType = options.mimeType || "audio/mpeg";
      } else if (options.audioUrl) {
        const response = await fetch(options.audioUrl);
        if (!response.ok) {
          return {
            error: "Failed to download audio file",
            code: "INVALID_FORMAT",
            details: `HTTP ${response.status}: ${response.statusText}`
          };
        }

        audioBuffer = Buffer.from(await response.arrayBuffer());
        // 下载回包的 content-type 不是音视频（如 octet-stream）时沿用调用方给的类型
        const contentType = String(response.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
        mimeType = /^(audio|video)\//.test(contentType) ? contentType : options.mimeType || 'audio/mpeg';
      } else {
        return {
          error: "Audio source is missing",
          code: "INVALID_FORMAT",
          details: "audioUrl, audioBuffer or audioBase64 is required"
        };
      }

      // Check file size (16MB limit)
      const sizeMB = audioBuffer.length / (1024 * 1024);
      if (sizeMB > 16) {
        return {
          error: "Audio file exceeds maximum size limit",
          code: "FILE_TOO_LARGE",
          details: `File size is ${sizeMB.toFixed(2)}MB, maximum allowed is 16MB`
        };
      }
      if (!audioBuffer.length) {
        return { error: "Audio source is missing", code: "INVALID_FORMAT", details: "audio is empty" };
      }
    } catch (error) {
      return {
        error: "Failed to fetch audio file",
        code: "SERVICE_ERROR",
        details: error instanceof Error ? error.message : "Unknown error"
      };
    }

    // Step 3: 存 GCS → 两跳（每跳原始 / 解析 JSON 永久落 voice-transcription/<sha256>/attempts/<uuid>/）；
    // 1110 规格（temperature 0、maxOutputTokens 65536 等）与实测探针共用 voiceTranscriptionListenSpec
    let transcription: WhisperResponse;
    try {
      const out = await listenStagedAudioJson({
        area: "voice-transcription",
        audio: audioBuffer,
        mimeType,
        ...voiceTranscriptionListenSpec(options),
      });
      transcription = out.value;
    } catch (error) {
      return {
        error: "Transcription service request failed",
        code: "TRANSCRIPTION_FAILED",
        details: error instanceof Error ? error.message : String(error)
      };
    }

    // Step 4: Validate response structure（与旧口径一致：空文本按无效结果返回）
    if (!transcription.text) {
      return {
        error: "Invalid transcription response",
        code: "SERVICE_ERROR",
        details: "Transcription service returned an invalid response format"
      };
    }

    return transcription;

  } catch (error) {
    // Handle unexpected errors
    return {
      error: "Voice transcription failed",
      code: "SERVICE_ERROR",
      details: error instanceof Error ? error.message : "An unexpected error occurred"
    };
  }
}

/**
 * Helper function to get full language name from ISO code
 */
function getLanguageName(langCode: string): string {
  const langMap: Record<string, string> = {
    'en': 'English',
    'es': 'Spanish',
    'fr': 'French',
    'de': 'German',
    'it': 'Italian',
    'pt': 'Portuguese',
    'ru': 'Russian',
    'ja': 'Japanese',
    'ko': 'Korean',
    'zh': 'Chinese',
    'ar': 'Arabic',
    'hi': 'Hindi',
    'nl': 'Dutch',
    'pl': 'Polish',
    'tr': 'Turkish',
    'sv': 'Swedish',
    'da': 'Danish',
    'no': 'Norwegian',
    'fi': 'Finnish',
  };

  return langMap[langCode] || langCode;
}

/**
 * Example tRPC procedure implementation:
 *
 * ```ts
 * // In server/routers.ts
 * import { transcribeAudio } from "./_core/voiceTranscription";
 *
 * export const voiceRouter = router({
 *   transcribe: protectedProcedure
 *     .input(z.object({
 *       audioUrl: z.string(),
 *       language: z.string().optional(),
 *       prompt: z.string().optional(),
 *     }))
 *     .mutation(async ({ input, ctx }) => {
 *       const result = await transcribeAudio(input);
 *
 *       // Check if it's an error
 *       if ('error' in result) {
 *         throw new TRPCError({
 *           code: 'BAD_REQUEST',
 *           message: result.error,
 *           cause: result,
 *         });
 *       }
 *
 *       // Optionally save transcription to database
 *       await db.insert(transcriptions).values({
 *         userId: ctx.user.id,
 *         text: result.text,
 *         duration: result.duration,
 *         language: result.language,
 *         audioUrl: input.audioUrl,
 *         createdAt: new Date(),
 *       });
 *
 *       return result;
 *     }),
 * });
 * ```
 */
