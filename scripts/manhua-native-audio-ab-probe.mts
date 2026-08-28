/**
 * 只允许在 Fly 容器内运行的 Gemini 音质 A/B 探针。
 * 不读取本机密钥；同一源只改变采样率/声道，模型与结构契约保持一致。
 */
import { execFile } from "node:child_process";
import { readFile, stat, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import crypto from "node:crypto";
import {
  deleteGcsObject,
  uploadBufferToGcs,
} from "../server/services/gcs.js";
import {
  baseUrlForVertex,
  getVertexAuthHeaders,
  getVertexProjectId,
} from "../server/services/vertexMedia.js";
import { MANHUA_NATIVE_AUDIO_CUE_KINDS } from "../shared/manhuaNativeAudioAnalysis.js";

const run = promisify(execFile);
const MODEL = "gemini-3.6-flash";
const SOURCE = String(process.argv[2] || "").trim();
const TMP_PREFIX = "manhua-template-learn/tmp/native-audio-probe";

if (process.env.FLY_APP_NAME !== "mvstudiopro") {
  throw new Error("本探针只允许在 mvstudiopro Fly 容器运行");
}
if (!/^https:\/\/www\.douyin\.com\/video\/\d+/.test(SOURCE)) {
  throw new Error("请传入标准抖音单集页 URL");
}

const schema = {
  type: "OBJECT",
  properties: {
    audioTrack: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          fromSec: { type: "INTEGER" },
          toSec: { type: "INTEGER" },
          emotionArcZh: { type: "STRING" },
          toneZh: { type: "STRING" },
          sfxZh: { type: "STRING" },
          bgmZh: { type: "STRING" },
          atmosphereZh: { type: "STRING" },
          silenceZh: { type: "STRING" },
          cues: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                atSec: { type: "INTEGER" },
                kind: {
                  type: "STRING",
                  enum: MANHUA_NATIVE_AUDIO_CUE_KINDS,
                },
                detailZh: { type: "STRING" },
              },
              required: ["atSec", "kind", "detailZh"],
            },
          },
        },
        required: [
          "fromSec", "toSec", "emotionArcZh", "toneZh", "sfxZh", "bgmZh",
          "atmosphereZh", "silenceZh", "cues",
        ],
      },
    },
    audioBeatStructureZh: { type: "STRING" },
    mixNotesZh: { type: "STRING" },
    reusableAudioZh: { type: "STRING" },
    genAudioHintZh: { type: "STRING" },
  },
  required: [
    "audioTrack", "audioBeatStructureZh", "mixNotesZh", "reusableAudioZh", "genAudioHintZh",
  ],
} as const;

function prompt(lenSec: number): string {
  return `你是漫剧成片的「声音设计」分析师。这是一个 ${lenSec} 秒的片段。

只分析声音，不要转写对白文字。你要回答的是「这段声音怎么把观众情绪推上去的」。
只返回符合给定 schema 的 JSON。

硬约束：
1. audioTrack 连续覆盖 0 到 ${lenSec} 秒，允许分段粗于镜头。
2. fromSec/toSec/cues[].atSec 是唯一时间真源；其他文本字段禁止出现 MM:SS 或另一份秒位。
3. 只写真听到的声音；没有证据就写空串，禁止套通用描述。
4. toneZh 只写谁在说、什么状态、怎么说，不写说了什么。
5. 精确音效、配乐变化与静默进出点写入 cues；每个 cue 必须落在所属 fromSec..toSec 内。
6. silenceZh 只描述留白作用，不重复时间；没有则写空串。
7. reusableAudioZh 脱离本剧剧情；不写平台、剧名、商标或原台词。`;
}

function validateResult(result: { audioTrack?: Array<Record<string, unknown>> }, durationSec: number) {
  const tracks = Array.isArray(result.audioTrack) ? result.audioTrack : [];
  if (!tracks.length) throw new Error("audioTrack 为空");
  let cursor = 0;
  for (const [index, track] of tracks.entries()) {
    const fromSec = Number(track.fromSec);
    const toSec = Number(track.toSec);
    if (!Number.isInteger(fromSec) || !Number.isInteger(toSec) || toSec <= fromSec) {
      throw new Error(`第${index + 1}段秒位无效`);
    }
    if (fromSec > cursor) throw new Error(`第${index + 1}段前存在空洞`);
    if (toSec > durationSec) throw new Error(`第${index + 1}段越过素材终点`);
    cursor = Math.max(cursor, toSec);
    const freeText = [
      track.emotionArcZh, track.toneZh, track.sfxZh, track.bgmZh,
      track.atmosphereZh, track.silenceZh,
    ].map((v) => String(v || "")).join("\n");
    if (/(?<!\d)(?:(?:\d{1,2}):)?(?:[0-5]?\d):(?:[0-5]\d)(?!\d)/.test(freeText)) {
      throw new Error(`第${index + 1}段文本重复写入时间`);
    }
    const cues = Array.isArray(track.cues) ? track.cues as Array<Record<string, unknown>> : [];
    if (cues.some((cue) => Number(cue.atSec) < fromSec || Number(cue.atSec) > toSec)) {
      throw new Error(`第${index + 1}段 cue 越界`);
    }
  }
  if (cursor < durationSec) throw new Error("audioTrack 未覆盖素材结尾");
}

function pickAudioSource(info: Record<string, unknown>): string {
  const formats = Array.isArray(info.formats) ? info.formats as Array<Record<string, unknown>> : [];
  const candidates = formats
    .filter((f) => String(f.acodec || "none") !== "none" && String(f.url || ""))
    .sort((a, b) => Number(a.filesize || a.filesize_approx || 9e15) - Number(b.filesize || b.filesize_approx || 9e15));
  const url = String(candidates[0]?.url || info.url || "").trim();
  if (!/^https:\/\//.test(url)) throw new Error("未解析到可用音轨");
  return url;
}

async function extract(input: {
  sourceUrl: string;
  outputPath: string;
  sampleRate: number;
  channels: number;
  bitrate: string;
  durationSec: number;
}): Promise<void> {
  const referer = "https://www.douyin.com/";
  await run("ffmpeg", [
    "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
    "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
    "-headers", `Referer: ${referer}\r\n`,
    "-i", input.sourceUrl,
    "-t", String(input.durationSec),
    "-map", "0:a:0", "-vn",
    "-af", `aresample=${input.sampleRate}:async=1:first_pts=0,apad=whole_dur=${input.durationSec},atrim=duration=${input.durationSec},asetpts=N/SR/TB`,
    "-ar", String(input.sampleRate), "-ac", String(input.channels),
    "-c:a", "libmp3lame", "-b:a", input.bitrate,
    input.outputPath,
  ], { timeout: 5 * 60_000, maxBuffer: 2 * 1024 * 1024 });
}

async function analyze(gcsUri: string, durationSec: number): Promise<Record<string, unknown>> {
  const location = "global";
  const projectId = getVertexProjectId();
  const endpoint = `${baseUrlForVertex(location)}/v1/projects/${encodeURIComponent(projectId)}`
    + `/locations/${location}/publishers/google/models/${MODEL}:generateContent`;
  const headers = await getVertexAuthHeaders();
  const started = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(12 * 60_000),
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { fileData: { fileUri: gcsUri, mimeType: "audio/mpeg" } },
          { text: prompt(durationSec) },
        ],
      }],
      generationConfig: {
        audioTimestamp: true,
        responseMimeType: "application/json",
        responseSchema: schema,
        maxOutputTokens: 16_384,
      },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Gemini A/B 请求失败（${response.status}）`);
  const body = JSON.parse(text) as {
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      thoughtsTokenCount?: number;
      promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }>;
    };
  };
  const outputText = (body.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("");
  const result = JSON.parse(outputText) as { audioTrack?: Array<Record<string, unknown>> };
  validateResult(result, durationSec);
  const details = body.usageMetadata?.promptTokensDetails || [];
  return {
    elapsedMs: Date.now() - started,
    finishReason: body.candidates?.[0]?.finishReason || "",
    promptTokens: Number(body.usageMetadata?.promptTokenCount) || 0,
    audioTokens: details
      .filter((d) => String(d.modality || "").toUpperCase() === "AUDIO")
      .reduce((sum, d) => sum + (Number(d.tokenCount) || 0), 0),
    outputTokens: Number(body.usageMetadata?.candidatesTokenCount) || 0,
    thoughtsTokens: Number(body.usageMetadata?.thoughtsTokenCount) || 0,
    result,
  };
}

const { stdout } = await run("yt-dlp", [
  "-J", "--no-warnings",
  ...(process.env.DOUYIN_COOKIE ? ["--add-header", `Cookie:${process.env.DOUYIN_COOKIE}`] : []),
  SOURCE,
], { timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
const info = JSON.parse(stdout) as Record<string, unknown>;
const durationSec = Math.max(1, Math.floor(Number(info.duration) || 0));
const sourceUrl = pickAudioSource(info);
const variants = [
  { id: "A_16k_mono", sampleRate: 16_000, channels: 1, bitrate: "32k" },
  { id: "B_32k_stereo", sampleRate: 32_000, channels: 2, bitrate: "64k" },
];
const outputs: Array<Record<string, unknown>> = [];

for (const variant of variants) {
  const runId = crypto.randomUUID();
  const localPath = `/tmp/native-audio-ab-${runId}.mp3`;
  let uploaded: { bucket: string; objectName: string; gcsUri: string } | undefined;
  try {
    await extract({ ...variant, sourceUrl, outputPath: localPath, durationSec });
    const [buffer, fileStat] = await Promise.all([readFile(localPath), stat(localPath)]);
    uploaded = await uploadBufferToGcs({
      objectName: `${TMP_PREFIX}/${runId}.mp3`,
      buffer,
      contentType: "audio/mpeg",
    });
    const analysis = await analyze(uploaded.gcsUri, durationSec);
    outputs.push({
      variant: variant.id,
      sampleRate: variant.sampleRate,
      channels: variant.channels,
      bitrate: variant.bitrate,
      bytes: fileStat.size,
      durationSec,
      ...analysis,
    });
  } finally {
    if (uploaded) {
      await deleteGcsObject({ bucket: uploaded.bucket, objectName: uploaded.objectName });
    }
    await unlink(localPath).catch(() => undefined);
  }
}

process.stdout.write(`${JSON.stringify({ model: MODEL, outputs }, null, 2)}\n`);
