import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import {
  MANHUA_NATIVE_AUDIO_MODEL,
  MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS,
  mergeManhuaNativeAudioChunks,
  noAudioManhuaNativeAnalysis,
  normalizeManhuaNativeAudioChunkAnalysis,
  splitManhuaNativeAudioChunks,
  type ManhuaNativeAudioAnalysis,
  type ManhuaNativeAudioChunk,
  type ManhuaNativeAudioChunkAnalysis,
  type ManhuaNativeAudioEvidence,
  type ManhuaNativeAudioEvidenceChunk,
  type ManhuaNativeAudioSourceVariant,
  type ManhuaNativeAudioUsage,
} from "../../shared/manhuaNativeAudioAnalysis.js";
import type { NativeDeepReadMediaNode } from "./manhuaNativeDeepReadRunner.js";
import { deleteGcsObject, uploadBufferToGcs } from "./gcs.js";
import { baseUrlForVertex, getVertexAuthHeaders, getVertexProjectId } from "./vertexMedia.js";

const AUDIO_GCS_MAX_BYTES = 30 * 1024 * 1024;
const AUDIO_RESPONSE_MAX_CHARS = 4 * 1024 * 1024;
const GEMINI_AUDIO_INPUT_USD_PER_M = 0.75;
const GEMINI_AUDIO_OUTPUT_USD_PER_M = 3.75;
const USD_TO_CNY = 7;
const AUDIO_TEMP_PREFIX = "manhua-template-learn/tmp/native-audio";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36";

function abortReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new Error("用户已停止学习");
}

function runMediaCommand(input: {
  command: "ffprobe" | "ffmpeg";
  args: string[];
  timeoutMs: number;
  abortSignal?: AbortSignal;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      input.command,
      input.args,
      { maxBuffer: 16 * 1024 * 1024, timeout: input.timeoutMs, signal: input.abortSignal },
      (error, stdout) => {
        if (!error) return resolve(String(stdout || ""));
        if (input.abortSignal?.aborted) return reject(abortReason(input.abortSignal));
        // stderr 可能含完整 CDN 签名链，禁止进入日志和 owner 面板。
        reject(new Error(`${input.command} 音频处理未完成`));
      },
    );
  });
}

function mediaHeaders(node: NativeDeepReadMediaNode): string[] {
  const referer = String(node.referer || "").trim();
  return [
    "-user_agent", USER_AGENT,
    ...(referer ? ["-headers", `Referer: ${referer}\r\n`] : []),
  ];
}

/** 两路唯一差异是采样率、声道和码率；时钟滤镜与切段边界完全相同。 */
export function buildManhuaNativeAudioExtractArgs(input: {
  node: NativeDeepReadMediaNode;
  chunk: ManhuaNativeAudioChunk;
  variant: ManhuaNativeAudioSourceVariant;
  outputPath: string;
}): string[] {
  const lenSec = input.chunk.endSec - input.chunk.startSec;
  const stereo = input.variant === "stereo_32k";
  const sampleRate = stereo ? 32_000 : 16_000;
  return [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    ...mediaHeaders(input.node),
    "-ss", String(input.chunk.startSec), "-i", input.node.url,
    "-t", String(lenSec), "-map", "0:a:0", "-vn",
    "-af", `aresample=${sampleRate}:async=1:first_pts=0,apad=whole_dur=${lenSec},atrim=duration=${lenSec},asetpts=N/SR/TB`,
    "-ar", String(sampleRate), "-ac", stereo ? "2" : "1",
    "-c:a", "libmp3lame", "-b:a", stereo ? "64k" : "32k",
    input.outputPath,
  ];
}

async function sourceHasAudio(node: NativeDeepReadMediaNode, abortSignal?: AbortSignal): Promise<boolean> {
  const text = await runMediaCommand({
    command: "ffprobe",
    args: [
      "-v", "error", ...mediaHeaders(node), "-rw_timeout", "20000000",
      "-select_streams", "a:0", "-show_entries", "stream=index", "-of", "json", "-i", node.url,
    ],
    timeoutMs: 30_000,
    abortSignal,
  });
  const parsed = JSON.parse(text || "{}") as { streams?: unknown[] };
  return Array.isArray(parsed.streams) && parsed.streams.length > 0;
}

async function probeLocalAudioDuration(audioPath: string, abortSignal?: AbortSignal): Promise<number> {
  const text = await runMediaCommand({
    command: "ffprobe",
    args: ["-v", "error", "-show_entries", "format=duration", "-of", "json", "-i", audioPath],
    timeoutMs: 30_000,
    abortSignal,
  });
  const parsed = JSON.parse(text || "{}") as { format?: { duration?: unknown } };
  return Number(parsed.format?.duration) || 0;
}

export function buildManhuaNativeAudioPrompt(chunk: ManhuaNativeAudioChunk): string {
  const lenSec = chunk.endSec - chunk.startSec;
  return `你是漫剧成片的声音设计分析师。这是 ${lenSec} 秒音频，局部0秒对应全片${chunk.startSec}秒。
只分析声音，不转写对白，不猜画面剧情。只返回 JSON。
硬约束：
1. audioTrack 连续、无重叠地覆盖局部0..${lenSec}秒。
2. fromSec/toSec/cues[].atSec 是唯一时间真源；其他文本禁止写 MM:SS。
3. toneZh 只写角色功能、语气、语速、音量、停顿、气息和重音，不写台词内容。
4. 只写真听到的音效、配乐、环境与静默；没有就写空串。
5. 精确变化写 cues，且 cue 必须在所属区间内。
6. reusableAudioZh 脱离来源剧情；不写平台、剧名、商标或原台词。`;
}

const AUDIO_RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    audioTrack: { type: "ARRAY", items: { type: "OBJECT", properties: {
      fromSec: { type: "INTEGER" }, toSec: { type: "INTEGER" },
      emotionArcZh: { type: "STRING" }, toneZh: { type: "STRING" },
      sfxZh: { type: "STRING" }, bgmZh: { type: "STRING" },
      atmosphereZh: { type: "STRING" }, silenceZh: { type: "STRING" },
      cues: { type: "ARRAY", items: { type: "OBJECT", properties: {
        atSec: { type: "INTEGER" },
        kind: { type: "STRING", enum: ["sfx", "bgm_in", "bgm_change", "bgm_out", "silence_in", "silence_out"] },
        detailZh: { type: "STRING" },
      }, required: ["atSec", "kind", "detailZh"] } },
    }, required: ["fromSec", "toSec", "emotionArcZh", "toneZh", "sfxZh", "bgmZh", "atmosphereZh", "silenceZh", "cues"] } },
    audioBeatStructureZh: { type: "STRING" }, mixNotesZh: { type: "STRING" },
    reusableAudioZh: { type: "STRING" }, genAudioHintZh: { type: "STRING" },
  },
  required: ["audioTrack", "audioBeatStructureZh", "mixNotesZh", "reusableAudioZh", "genAudioHintZh"],
} as const;

function makeAbortSignal(parent: AbortSignal | undefined, timeoutMs: number, message: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(message)), timeoutMs);
  const onAbort = () => controller.abort(abortReason(parent));
  if (parent?.aborted) onAbort();
  else parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    dispose: () => { clearTimeout(timer); parent?.removeEventListener("abort", onAbort); },
  };
}

function resolveAudioVertexLocation(): "global" | "us" | "eu" {
  const location = String(process.env.MANHUA_NATIVE_AUDIO_VERTEX_LOCATION || "global").trim();
  if (location === "global" || location === "us" || location === "eu") return location;
  throw new Error("Gemini 3.6 Flash 音频区域只允许 global/us/eu");
}

function audioTokensFromUsage(details: unknown): number {
  if (!Array.isArray(details)) return 0;
  return details
    .filter((row) => String((row as { modality?: unknown }).modality || "").toUpperCase() === "AUDIO")
    .reduce((sum, row) => sum + (Number((row as { tokenCount?: unknown }).tokenCount) || 0), 0);
}

async function analyzeAudioChunkWithGemini(input: {
  gcsUri: string;
  chunk: ManhuaNativeAudioChunk;
  abortSignal?: AbortSignal;
}): Promise<{ analysis: ManhuaNativeAudioChunkAnalysis; inputTokens: number; audioInputTokens: number; outputTokens: number }> {
  const managed = makeAbortSignal(input.abortSignal, 12 * 60_000, "声音理解请求超过12分钟");
  try {
    const location = resolveAudioVertexLocation();
    const endpoint = `${baseUrlForVertex(location)}/v1/projects/${encodeURIComponent(getVertexProjectId())}`
      + `/locations/${encodeURIComponent(location)}/publishers/google/models/`
      + `${encodeURIComponent(MANHUA_NATIVE_AUDIO_MODEL)}:generateContent`;
    const response = await fetch(endpoint, {
      method: "POST",
      headers: await getVertexAuthHeaders(),
      signal: managed.signal,
      body: JSON.stringify({
        contents: [{ role: "user", parts: [
          { fileData: { fileUri: input.gcsUri, mimeType: "audio/mpeg" } },
          { text: buildManhuaNativeAudioPrompt(input.chunk) },
        ] }],
        generationConfig: {
          audioTimestamp: true,
          responseMimeType: "application/json",
          responseSchema: AUDIO_RESPONSE_SCHEMA,
          maxOutputTokens: 32_768,
        },
      }),
    });
    const text = await response.text();
    if (text.length > AUDIO_RESPONSE_MAX_CHARS) throw new Error("声音理解响应超过处理上限");
    if (!response.ok) throw new Error(`声音理解服务请求失败（${response.status}）`);
    const payload = JSON.parse(text) as {
      candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; promptTokensDetails?: unknown };
    };
    const candidate = payload.candidates?.[0];
    if (candidate?.finishReason === "MAX_TOKENS") throw new Error("声音理解结果被截断");
    if (candidate?.finishReason && candidate.finishReason !== "STOP") {
      throw new Error(`声音理解未正常结束（${candidate.finishReason}）`);
    }
    const audioInputTokens = audioTokensFromUsage(payload.usageMetadata?.promptTokensDetails);
    if (audioInputTokens <= 0) throw new Error("声音理解回执没有 AUDIO token，拒绝入库");
    const jsonText = (candidate?.content?.parts || []).map((part) => part.text || "").join("");
    if (!jsonText) throw new Error("声音理解没有返回结构化内容");
    const localChunk = { index: input.chunk.index, startSec: 0, endSec: input.chunk.endSec - input.chunk.startSec };
    return {
      analysis: normalizeManhuaNativeAudioChunkAnalysis({ raw: JSON.parse(jsonText), chunk: localChunk }),
      inputTokens: Math.max(0, Number(payload.usageMetadata?.promptTokenCount) || 0),
      audioInputTokens,
      outputTokens: Math.max(0, Number(payload.usageMetadata?.candidatesTokenCount) || 0)
        + Math.max(0, Number(payload.usageMetadata?.thoughtsTokenCount) || 0),
    };
  } finally {
    managed.dispose();
  }
}

export type ManhuaNativeAudioEvidenceDeps = {
  hasAudio: typeof sourceHasAudio;
  extract: (input: { node: NativeDeepReadMediaNode; chunk: ManhuaNativeAudioChunk; variant: ManhuaNativeAudioSourceVariant; outputPath: string; abortSignal?: AbortSignal }) => Promise<void>;
  probeLocalDuration: typeof probeLocalAudioDuration;
  upload: typeof uploadBufferToGcs;
  remove: typeof deleteGcsObject;
  analyzeChunk: typeof analyzeAudioChunkWithGemini;
};

const defaultEvidenceDeps: ManhuaNativeAudioEvidenceDeps = {
  hasAudio: sourceHasAudio,
  extract: async (input) => runMediaCommand({ command: "ffmpeg", args: buildManhuaNativeAudioExtractArgs(input), timeoutMs: 20 * 60_000, abortSignal: input.abortSignal }).then(() => undefined),
  probeLocalDuration: probeLocalAudioDuration,
  upload: uploadBufferToGcs,
  remove: deleteGcsObject,
  analyzeChunk: analyzeAudioChunkWithGemini,
};

export type ManhuaNativeAudioDeepReadError = Error & { nativeAudioUsage?: Partial<ManhuaNativeAudioUsage> };

export type ManhuaNativeAudioModelReceipt = {
  stage: "audio_model";
  status: "started" | "completed" | "failed";
  chunkIndex: number;
  variant: ManhuaNativeAudioSourceVariant;
  elapsedMs?: number;
  inputTokens?: number;
  audioInputTokens?: number;
  outputTokens?: number;
  errorZh?: string;
};

async function emitAudioModelReceipt(
  receipt: ManhuaNativeAudioModelReceipt,
  callback?: (receipt: ManhuaNativeAudioModelReceipt) => void | Promise<void>,
): Promise<void> {
  // 内部日志只写阶段与用量，不写媒体地址、签名或凭证。
  console.info(`[nativeDeepReadModel] ${JSON.stringify(receipt)}`);
  try {
    await callback?.(receipt);
  } catch (error) {
    console.warn(
      "[nativeDeepReadModel] 声音阶段回执写入未完成：",
      error instanceof Error ? error.message : error,
    );
  }
}

/** 先生成双路声音证据；本函数不做冲突裁决。 */
export async function collectManhuaNativeAudioEvidence(input: {
  durationSec: number;
  resolveNodes: () => Promise<NativeDeepReadMediaNode[]>;
  abortSignal?: AbortSignal;
  onModelReceipt?: (receipt: ManhuaNativeAudioModelReceipt) => void | Promise<void>;
}, deps: ManhuaNativeAudioEvidenceDeps = defaultEvidenceDeps): Promise<ManhuaNativeAudioEvidence> {
  const initialNode = (await input.resolveNodes())[0];
  if (!initialNode) throw new Error("未解析到可用音频媒体节点");
  if (!(await deps.hasAudio(initialNode, input.abortSignal))) {
    return { hasAudio: false, durationSec: input.durationSec, chunks: [], usage: noAudioManhuaNativeAnalysis(input.durationSec).usage };
  }
  const chunks: ManhuaNativeAudioEvidenceChunk[] = [];
  let inputTokens = 0;
  let audioInputTokens = 0;
  let outputTokens = 0;
  let geminiCalls = 0;
  try {
    for (const chunk of splitManhuaNativeAudioChunks(input.durationSec)) {
      const uploaded: Array<{ variant: ManhuaNativeAudioSourceVariant; localPath: string; bucket: string; objectName: string; gcsUri: string }> = [];
      const localPaths: string[] = [];
      try {
        for (const variant of MANHUA_NATIVE_AUDIO_SOURCE_VARIANTS) {
          const node = (await input.resolveNodes())[0];
          if (!node) throw new Error(`第${chunk.index + 1}段未解析到可用音频媒体节点`);
          const runId = crypto.randomUUID();
          const localPath = `/tmp/manhua-native-audio-${variant}-${runId}.mp3`;
          localPaths.push(localPath);
          await deps.extract({ node, chunk, variant, outputPath: localPath, abortSignal: input.abortSignal });
          const [file, fileStat, actualDuration] = await Promise.all([
            readFile(localPath), stat(localPath), deps.probeLocalDuration(localPath, input.abortSignal),
          ]);
          const expectedDuration = chunk.endSec - chunk.startSec;
          if (fileStat.size <= 0 || fileStat.size > AUDIO_GCS_MAX_BYTES) throw new Error("音频临时片大小超出处理范围");
          if (Math.abs(actualDuration - expectedDuration) > 0.35) throw new Error("音频标尺未对齐");
          const remote = await deps.upload({
            objectName: `${AUDIO_TEMP_PREFIX}/${variant}-${runId}.mp3`,
            buffer: file,
            contentType: "audio/mpeg",
            signal: input.abortSignal,
          });
          uploaded.push({ variant, localPath, ...remote });
        }
        const analyzed = await Promise.allSettled(uploaded.map(async (item) => {
          const startedAt = Date.now();
          await emitAudioModelReceipt({
            stage: "audio_model",
            status: "started",
            chunkIndex: chunk.index,
            variant: item.variant,
          }, input.onModelReceipt);
          try {
            const result = await deps.analyzeChunk({
              gcsUri: item.gcsUri,
              chunk,
              abortSignal: input.abortSignal,
            });
            await emitAudioModelReceipt({
              stage: "audio_model",
              status: "completed",
              chunkIndex: chunk.index,
              variant: item.variant,
              elapsedMs: Date.now() - startedAt,
              inputTokens: result.inputTokens,
              audioInputTokens: result.audioInputTokens,
              outputTokens: result.outputTokens,
            }, input.onModelReceipt);
            return result;
          } catch (error) {
            await emitAudioModelReceipt({
              stage: "audio_model",
              status: "failed",
              chunkIndex: chunk.index,
              variant: item.variant,
              elapsedMs: Date.now() - startedAt,
              errorZh: (error instanceof Error ? error.message : String(error)).slice(0, 160),
            }, input.onModelReceipt);
            throw error;
          }
        }));
        for (const row of analyzed) {
          if (row.status !== "fulfilled") continue;
          inputTokens += row.value.inputTokens;
          audioInputTokens += row.value.audioInputTokens;
          outputTokens += row.value.outputTokens;
          geminiCalls += 1;
        }
        const firstFailure = analyzed.find((row): row is PromiseRejectedResult => row.status === "rejected");
        if (firstFailure) throw firstFailure.reason;
        const [mono, stereo] = analyzed.map((row) => (row as PromiseFulfilledResult<
          Awaited<ReturnType<typeof deps.analyzeChunk>>
        >).value);
        chunks.push({ chunk, mono16k: mono.analysis, stereo32k: stereo.analysis });
      } finally {
        const remoteCleanup = await Promise.allSettled(uploaded.map((item) =>
          deps.remove({ bucket: item.bucket, objectName: item.objectName }),
        ));
        await Promise.all(localPaths.map((localPath) => unlink(localPath).catch(() => undefined)));
        const cleanupFailed = remoteCleanup.filter((row) => row.status === "rejected").length;
        if (cleanupFailed > 0) {
          // 清理失败不能推翻已付费模型结果；只记录数量交给对象生命周期清扫任务处理。
          console.warn(`[nativeDeepRead] 声音临时对象有 ${cleanupFailed} 个待清理`);
        }
      }
    }
  } catch (error) {
    const geminiCostCny = ((inputTokens * GEMINI_AUDIO_INPUT_USD_PER_M) + (outputTokens * GEMINI_AUDIO_OUTPUT_USD_PER_M)) * USD_TO_CNY / 1_000_000;
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), {
      nativeAudioUsage: { inputTokens, audioInputTokens, outputTokens, costCny: geminiCostCny, geminiInputTokens: inputTokens, geminiAudioInputTokens: audioInputTokens, geminiOutputTokens: outputTokens, geminiCostCny, geminiCalls, receiptComplete: false },
    }) as ManhuaNativeAudioDeepReadError;
  }
  const geminiCostCny = ((inputTokens * GEMINI_AUDIO_INPUT_USD_PER_M) + (outputTokens * GEMINI_AUDIO_OUTPUT_USD_PER_M)) * USD_TO_CNY / 1_000_000;
  return {
    hasAudio: true,
    durationSec: input.durationSec,
    chunks,
    usage: {
      inputTokens, audioInputTokens, outputTokens, costCny: geminiCostCny,
      receiptComplete: true, geminiInputTokens: inputTokens,
      geminiAudioInputTokens: audioInputTokens, geminiOutputTokens: outputTokens,
      geminiCostCny, geminiCalls,
    },
  };
}

/** 新加坡 Qwen 已看过真实视频并完成裁决；这里仅做代码侧校验与绝对秒换算。 */
export async function finalizeManhuaNativeAudioAnalysis(input: {
  evidence: ManhuaNativeAudioEvidence;
  singaporeResolvedChunks: ReadonlyArray<{
    chunkIndex: number;
    analysis: ManhuaNativeAudioChunkAnalysis;
  }>;
}): Promise<ManhuaNativeAudioAnalysis> {
  if (!input.evidence.hasAudio) return noAudioManhuaNativeAnalysis(input.evidence.durationSec);
  const expectedIndexes = input.evidence.chunks.map((row) => row.chunk.index).sort((a, b) => a - b);
  const resolvedByIndex = new Map<number, ManhuaNativeAudioChunkAnalysis>();
  for (const row of input.singaporeResolvedChunks) {
    if (resolvedByIndex.has(row.chunkIndex)) {
      throw new Error(`新加坡 Qwen 重复返回第${row.chunkIndex + 1}段声音裁决，拒绝入库`);
    }
    resolvedByIndex.set(row.chunkIndex, row.analysis);
  }
  const actualIndexes = Array.from(resolvedByIndex.keys()).sort((a, b) => a - b);
  if (JSON.stringify(actualIndexes) !== JSON.stringify(expectedIndexes)) {
    throw new Error("新加坡 Qwen 未返回完整的双路声音裁决，拒绝入库");
  }
  const chunks = input.evidence.chunks.map((evidence) =>
    normalizeManhuaNativeAudioChunkAnalysis({
      raw: resolvedByIndex.get(evidence.chunk.index),
      chunk: evidence.chunk,
    }),
  );
  return mergeManhuaNativeAudioChunks({
    durationSec: input.evidence.durationSec,
    chunks,
    usage: input.evidence.usage,
  });
}
