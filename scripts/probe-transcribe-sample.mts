/**
 * 语音转写真实音频小样实测探针（只允许在 mvstudiopro Fly 容器内运行；不读本机密钥）。
 *
 * 目的：校准 1110 转写规格 —— temperature 0、maxOutputTokens（短语音 20480 / 服务端转写 65536）是否够用、
 * 每字实际 token 数与思考用量、Vertex → EvoLink 两跳哪一跳出结果。直接调用生产函数，不另写请求体：
 *   short    → transcribeVoiceInputTwoHop（api/google.ts op=transcribeAudio 同一函数，只要全文）
 *   timeline → listenStagedAudioJson + voiceTranscriptionListenSpec（server transcribeAudio 同一规格，带逐句时间轴）
 *
 * 用法（在 Fly 容器内）：
 *   npx tsx scripts/probe-transcribe-sample.mts <容器内音频路径 | gs://桶/对象> [short|timeline|both] [语言码]
 *
 * 费用：每个模式各发 1 次两跳调用（第一跳成功即止，不重试）；both = 2 次。请用 ≤ 2 分钟的小样。
 * 证据：原始 / 解析 JSON 永久落 GCS（short → voice-transcribe-probe/<sha256>/attempts/<uuid>/，
 *       timeline → voice-transcription-probe/<sha256>/attempts/<uuid>/），本脚本不删除任何对象。
 */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { listenStagedAudioJson, transcriptionMaxOutputTokens } from "../server/gemini-audio.js";
import {
  VOICE_INPUT_TRANSCRIPT_MAX_CHARS,
  transcribeVoiceInputTwoHop,
  voiceTranscriptionListenSpec,
} from "../server/_core/voiceTranscription.js";
import {
  downloadGcsObject,
  getGcsBucketName,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

if (process.env.FLY_APP_NAME !== "mvstudiopro") {
  throw new Error("本探针只允许在 mvstudiopro Fly 容器运行（凭证只留服务端）");
}

const SOURCE = String(process.argv[2] || "").trim();
const MODE = String(process.argv[3] || "short").trim();
const LANGUAGE = String(process.argv[4] || "").trim() || undefined;
const MAX_BYTES = 16 * 1024 * 1024;
const MIME_BY_EXT: Record<string, string> = {
  ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".wav": "audio/wav",
  ".webm": "audio/webm", ".ogg": "audio/ogg", ".flac": "audio/flac", ".aac": "audio/aac",
};

if (!SOURCE) throw new Error("请传入容器内音频路径或 gs:// 对象");
if (!["short", "timeline", "both"].includes(MODE)) throw new Error(`模式只能是 short / timeline / both：${MODE}`);
const ext = extname(SOURCE.split("?")[0]!).toLowerCase();
const mimeType = MIME_BY_EXT[ext];
if (!mimeType) throw new Error(`不支持的音频后缀：${ext || "（无）"}，支持 ${Object.keys(MIME_BY_EXT).join(" ")}`);

type Usage = { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; totalTokenCount?: number };

function report(label: string, payload: unknown, text: string, maxOutputTokens: number) {
  const candidate = (payload as { candidates?: Array<{ finishReason?: unknown }> } | null)?.candidates?.[0];
  const usage = ((payload as { usageMetadata?: Usage } | null)?.usageMetadata || {}) as Usage;
  const out = Number(usage.candidatesTokenCount || 0);
  const thoughts = Number(usage.thoughtsTokenCount || 0);
  const chars = text.length;
  console.log(JSON.stringify({
    probe: label,
    finishReason: candidate?.finishReason ?? null,
    textChars: chars,
    promptTokens: usage.promptTokenCount ?? null,
    outputTokens: out || null,
    thoughtsTokens: thoughts || null,
    totalTokens: usage.totalTokenCount ?? null,
    outputTokensPerChar: chars && out ? Number((out / chars).toFixed(3)) : null,
    maxOutputTokens,
    // 思考是否计入上限各通道口径不一，这里按最保守（输出 + 思考）算占用
    budgetUsedRatio: Number(((out + thoughts) / maxOutputTokens).toFixed(3)),
  }));
}

const audio = SOURCE.startsWith("gs://") ? (await downloadGcsObject({ gcsUri: SOURCE })).buffer : await readFile(SOURCE);
if (!audio.length || audio.length > MAX_BYTES) throw new Error(`音频大小须在 1 字节–16MB：${audio.length}`);
const sha256 = createHash("sha256").update(audio).digest("hex");
console.log(JSON.stringify({ probe: "input", mode: MODE, mimeType, audioBytes: audio.length, audioSha256: sha256, language: LANGUAGE ?? null }));

let failed = false;

if (MODE === "short" || MODE === "both") {
  const bucket = getGcsBucketName();
  const base = `voice-transcribe-probe/${sha256}`;
  const objectName = `${base}/audio${ext}`;
  await uploadBufferToGcsIfAbsent({ bucket, objectName, buffer: audio, contentType: mimeType });
  const audioGsUri = `gs://${bucket}/${objectName}`;
  const prefix = `${base}/attempts/${randomUUID()}`;
  const save = async (name: string, value: unknown) => {
    await uploadBufferToGcsIfAbsent({ bucket, objectName: `${prefix}/${name}.json`, buffer: Buffer.from(JSON.stringify(value)), contentType: "application/json" });
  };
  await save("request", { probe: "probe-transcribe-sample", mode: "short", mimeType, audioGsUri, audioBytes: audio.length, audioSha256: sha256 });
  const started = Date.now();
  const out = await transcribeVoiceInputTwoHop({ audioGsUri, mimeType, save });
  const elapsedMs = Date.now() - started;
  const evidencePrefix = `gs://${bucket}/${prefix}`;
  if (out.ok) {
    await save("transcript", { channel: out.channel, model: out.model, failuresZh: out.failuresZh, text: out.text });
    console.log(JSON.stringify({ probe: "short", ok: true, channel: out.channel, model: out.model, failuresZh: out.failuresZh, elapsedMs, evidencePrefix }));
    // 与生产入口同一算式取值（12000 字合同 → 20480）
    report("short-usage", out.payload, out.text, transcriptionMaxOutputTokens(VOICE_INPUT_TRANSCRIPT_MAX_CHARS));
    console.log(`--- short 全文 ---\n${out.text}`);
  } else {
    failed = true;
    console.log(JSON.stringify({ probe: "short", ok: false, reason: out.reason, detailZh: out.detailZh, elapsedMs, evidencePrefix }));
  }
}

if (MODE === "timeline" || MODE === "both") {
  const spec = voiceTranscriptionListenSpec({ language: LANGUAGE });
  const started = Date.now();
  try {
    const out = await listenStagedAudioJson({ area: "voice-transcription-probe", audio, mimeType, ...spec });
    const segments = out.value.segments || [];
    console.log(JSON.stringify({
      probe: "timeline", ok: true, channel: out.channel, model: out.model, failuresZh: out.failuresZh,
      elapsedMs: Date.now() - started, evidencePrefix: out.evidencePrefix,
      language: out.value.language, durationSec: out.value.duration, segments: segments.length,
      lastSegmentEndSec: segments.length ? segments[segments.length - 1]!.end : null,
    }));
    report("timeline-usage", out.payload, out.value.text, spec.maxOutputTokens);
    console.log(`--- timeline 前 5 句 ---\n${segments.slice(0, 5).map(s => `[${s.start}–${s.end}] ${s.text}`).join("\n")}`);
  } catch (error) {
    failed = true;
    console.log(JSON.stringify({ probe: "timeline", ok: false, detailZh: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started }));
  }
}

if (failed) process.exitCode = 1;
