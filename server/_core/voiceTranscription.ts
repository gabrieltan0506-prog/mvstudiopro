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
import { isGeminiAudioAvailable, listenStagedAudioJson } from "../gemini-audio";

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

function buildTranscriptionPrompt(options: TranscribeOptions): string {
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

    // Step 3: 存 GCS → 两跳（每跳原始 / 解析 JSON 永久落 voice-transcription/<sha256>/attempts/<uuid>/）
    let transcription: WhisperResponse;
    try {
      const out = await listenStagedAudioJson({
        area: "voice-transcription",
        audio: audioBuffer,
        mimeType,
        prompt: buildTranscriptionPrompt(options),
        nativeSchema: TRANSCRIPTION_NATIVE_SCHEMA,
        schemaName: "voice_transcription_v1",
        validate: (decoded) => parseTranscription(decoded, options.language),
        maxOutputTokens: 32768,
        timeoutMs: 240_000,
        context: { language: options.language || null, userPrompt: options.prompt || null },
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
