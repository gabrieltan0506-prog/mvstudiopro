/**
 * Fly 内四调用闭环探针：双路 Gemini → 新加坡 Qwen 视频裁决 → GCS JSON
 * → Fly 原子快照 → OpenRouter GLM-5.3 系列聚合。不得在本机执行。
 */
import crypto from "node:crypto";
import https from "node:https";
import { execFile } from "node:child_process";
import { open, readFile, rename, rm, stat, unlink } from "node:fs/promises";
import { promisify } from "node:util";
import {
  deleteGcsObject,
  downloadGcsObjectVersioned,
  uploadBufferToGcs,
} from "/app/server/services/gcs.ts";
import {
  baseUrlForVertex,
  getVertexAuthHeaders,
  getVertexProjectId,
} from "/app/server/services/vertexMedia.ts";
import { resolveNativeDeepReadInputFps } from "/app/server/services/manhuaNativeDeepReadRunner.ts";
import { invokeNativeSeriesAggregationModel } from "/app/server/services/manhuaNativeSeriesAggregation.ts";
import { MANHUA_NATIVE_AUDIO_CUE_KINDS } from "/app/shared/manhuaNativeAudioAnalysis.ts";

const run = promisify(execFile);
const SOURCE = String(process.argv[2] || "").trim();
const VIDEO_ID = SOURCE.match(/(?:modal_id=|\/video\/)(\d{10,24})/)?.[1] || "";
const PAGE_URL = VIDEO_ID ? `https://www.douyin.com/video/${VIDEO_ID}` : "";
const SG_ENDPOINT = "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1/chat/completions";
const MODEL = "qwen3.8-max";
const GEMINI_MODEL = "gemini-3.6-flash";
const TMP_PREFIX = "manhua-template-learn/tmp/native-four-call-probe";

if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("本探针只允许在 Fly 容器内运行");
if (!PAGE_URL) throw new Error("未识别到抖音单集 ID");

let currentStage = "bootstrap";
const cleanError = (error: unknown) => {
  const text = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error
    ? (error as Error & { cause?: { code?: unknown; message?: unknown } }).cause
    : undefined;
  const causeCode = String(cause?.code || "").trim();
  const causeMessage = String(cause?.message || "").trim();
  return [text, causeCode, causeMessage]
    .filter(Boolean)
    .join(" · ")
    .replace(/https?:\/\/\S+/g, "<URL>")
    .slice(0, 300);
};
const hash = (value: Buffer | string) => crypto.createHash("sha256").update(value).digest("hex");

function pickMedia(info: Record<string, unknown>): string {
  const formats = Array.isArray(info.formats) ? info.formats as Array<Record<string, unknown>> : [];
  const candidates = formats
    .filter((row) => String(row.url || "") && String(row.vcodec || "none") !== "none" && String(row.acodec || "none") !== "none")
    .sort((a, b) => Number(a.filesize || a.filesize_approx || 9e15) - Number(b.filesize || b.filesize_approx || 9e15));
  const url = String(candidates[0]?.url || info.url || "");
  if (!/^https:\/\//.test(url)) throw new Error("未解析到带音画的媒体流");
  return url;
}

async function extractAudio(input: {
  mediaUrl: string;
  output: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  bitrate: string;
}) {
  try {
    await run("ffmpeg", [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
      "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "-headers", "Referer: https://www.douyin.com/\r\n",
      "-i", input.mediaUrl, "-t", String(input.durationSec), "-map", "0:a:0", "-vn",
      "-af", `aresample=${input.sampleRate}:async=1:first_pts=0,apad=whole_dur=${input.durationSec},atrim=duration=${input.durationSec},asetpts=N/SR/TB`,
      "-ar", String(input.sampleRate), "-ac", String(input.channels),
      "-c:a", "libmp3lame", "-b:a", input.bitrate, input.output,
    ], { timeout: 6 * 60_000, maxBuffer: 2 * 1024 * 1024 });
  } catch {
    throw new Error("ffmpeg 音频转存失败");
  }
}

const AUDIO_SCHEMA = {
  type: "OBJECT",
  properties: {
    audioTrack: { type: "ARRAY", items: { type: "OBJECT", properties: {
      fromSec: { type: "INTEGER" }, toSec: { type: "INTEGER" }, emotionArcZh: { type: "STRING" },
      toneZh: { type: "STRING" }, sfxZh: { type: "STRING" }, bgmZh: { type: "STRING" },
      atmosphereZh: { type: "STRING" }, silenceZh: { type: "STRING" },
      cues: { type: "ARRAY", items: { type: "OBJECT", properties: {
        atSec: { type: "INTEGER" }, kind: { type: "STRING", enum: MANHUA_NATIVE_AUDIO_CUE_KINDS }, detailZh: { type: "STRING" },
      }, required: ["atSec", "kind", "detailZh"] } },
    }, required: ["fromSec", "toSec", "emotionArcZh", "toneZh", "sfxZh", "bgmZh", "atmosphereZh", "silenceZh", "cues"] } },
    audioBeatStructureZh: { type: "STRING" }, mixNotesZh: { type: "STRING" },
    reusableAudioZh: { type: "STRING" }, genAudioHintZh: { type: "STRING" },
  },
  required: ["audioTrack", "audioBeatStructureZh", "mixNotesZh", "reusableAudioZh", "genAudioHintZh"],
} as const;

function validateAudio(raw: unknown, durationSec: number): Record<string, unknown> {
  const data = raw as Record<string, unknown>;
  const rows = Array.isArray(data.audioTrack) ? data.audioTrack as Array<Record<string, unknown>> : [];
  if (!rows.length) throw new Error("声音结构为空");
  let cursor = 0;
  for (const row of rows) {
    const from = Number(row.fromSec);
    const to = Number(row.toSec);
    if (!Number.isInteger(from) || !Number.isInteger(to) || from > cursor || to <= from || to > durationSec) {
      throw new Error("声音结构秒位未闭合");
    }
    cursor = to;
    const text = [row.emotionArcZh, row.toneZh, row.sfxZh, row.bgmZh, row.atmosphereZh, row.silenceZh].join("\n");
    if (/(?<!\d)(?:(?:\d{1,2}):)?(?:[0-5]?\d):(?:[0-5]\d)(?!\d)/.test(text)) throw new Error("声音描述重复写入时间文本");
    for (const cue of Array.isArray(row.cues) ? row.cues as Array<Record<string, unknown>> : []) {
      if (Number(cue.atSec) < from || Number(cue.atSec) > to) throw new Error("声音 cue 越界");
    }
  }
  if (cursor < durationSec) throw new Error("声音结构未覆盖结尾");
  return data;
}

async function analyzeAudio(gcsUri: string, durationSec: number) {
  const prompt = `你是声音设计分析师。只分析声音，不转写台词，不猜画面。只输出 JSON。audioTrack 连续无重叠覆盖0..${durationSec}秒；fromSec/toSec/cues[].atSec是唯一时间真源，其他文本不得写MM:SS；toneZh只写怎么说；只写真听到的音效、配乐、环境和静默；证据不足写空串。`;
  const endpoint = `${baseUrlForVertex("global")}/v1/projects/${encodeURIComponent(getVertexProjectId())}/locations/global/publishers/google/models/${GEMINI_MODEL}:generateContent`;
  const startedAt = Date.now();
  const response = await fetch(endpoint, {
    method: "POST",
    headers: await getVertexAuthHeaders(),
    signal: AbortSignal.timeout(12 * 60_000),
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ fileData: { fileUri: gcsUri, mimeType: "audio/mpeg" } }, { text: prompt }] }],
      generationConfig: { audioTimestamp: true, responseMimeType: "application/json", responseSchema: AUDIO_SCHEMA, maxOutputTokens: 32_768 },
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Gemini 请求失败（${response.status}）`);
  const envelope = JSON.parse(text) as {
    candidates?: Array<{ finishReason?: string; content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; promptTokensDetails?: Array<{ modality?: string; tokenCount?: number }> };
  };
  const candidate = envelope.candidates?.[0];
  if (candidate?.finishReason !== "STOP") throw new Error(`Gemini 未正常结束（${candidate?.finishReason || "unknown"}）`);
  const raw = JSON.parse((candidate.content?.parts || []).map((part) => part.text || "").join(""));
  const audioTokens = (envelope.usageMetadata?.promptTokensDetails || [])
    .filter((row) => String(row.modality || "").toUpperCase() === "AUDIO")
    .reduce((sum, row) => sum + (Number(row.tokenCount) || 0), 0);
  if (audioTokens <= 0) throw new Error("Gemini 回执缺少 AUDIO token");
  return {
    result: validateAudio(raw, durationSec),
    elapsedMs: Date.now() - startedAt,
    inputTokens: Number(envelope.usageMetadata?.promptTokenCount) || 0,
    audioTokens,
    outputTokens: (Number(envelope.usageMetadata?.candidatesTokenCount) || 0) + (Number(envelope.usageMetadata?.thoughtsTokenCount) || 0),
  };
}

async function qwenJson(input: {
  endpoint: string;
  apiKey: string;
  messages: unknown[];
  timeoutMs: number;
}) {
  const startedAt = Date.now();
  const payload = Buffer.from(JSON.stringify({
    model: MODEL,
    messages: input.messages,
    enable_thinking: true,
    response_format: { type: "json_object" },
    max_tokens: 65_536,
  }));
  const bodyText = await new Promise<string>((resolve, reject) => {
    const endpoint = new URL(input.endpoint);
    let settled = false;
    const timer = setTimeout(() => request.destroy(new Error("Qwen 请求超过总时限")), input.timeoutMs);
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn();
    };
    const request = https.request({
      hostname: endpoint.hostname,
      path: `${endpoint.pathname}${endpoint.search}`,
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.apiKey}`,
        "Content-Type": "application/json",
        "Content-Length": payload.length,
      },
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { text += chunk; });
      response.on("end", () => finish(() => {
        if ((response.statusCode || 0) >= 300) reject(new Error(`Qwen 请求失败（${response.statusCode || 0}）`));
        else resolve(text);
      }));
    });
    request.setTimeout(10 * 60_000, () => request.destroy(new Error("Qwen 连接长时间无数据")));
    request.on("error", (error) => finish(() => reject(error)));
    request.write(payload);
    request.end();
  });
  const envelope = JSON.parse(bodyText) as {
    choices?: Array<{ finish_reason?: string; message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  const choice = envelope.choices?.[0];
  if (choice?.finish_reason === "length") throw new Error("Qwen 输出被截断");
  if (choice?.finish_reason !== "stop") throw new Error(`Qwen 未正常结束（${choice?.finish_reason || "unknown"}）`);
  return {
    result: JSON.parse(String(choice.message?.content || "")),
    elapsedMs: Date.now() - startedAt,
    inputTokens: Number(envelope.usage?.prompt_tokens) || 0,
    outputTokens: Number(envelope.usage?.completion_tokens) || 0,
  };
}

const runId = crypto.randomUUID();
const localPaths = [`/tmp/native-four-${runId}-mono.mp3`, `/tmp/native-four-${runId}-stereo.mp3`];
const snapshotPath = `/tmp/native-four-${runId}-episode.json`;
const remote: Array<{ bucket: string; objectName: string }> = [];
const report: Record<string, unknown> = { runId, sourceVideoId: VIDEO_ID, startedAt: new Date().toISOString() };
const checkpoint = (stage: string, payload: Record<string, unknown>) => {
  process.stdout.write(`${JSON.stringify({ type: "probe_checkpoint", runId, stage, ...payload })}\n`);
};

try {
  currentStage = "douyin_resolve";
  const { stdout } = await run("yt-dlp", [
    "-J", "--no-warnings", PAGE_URL,
  ], { timeout: 150_000, maxBuffer: 64 * 1024 * 1024 });
  const info = JSON.parse(stdout) as Record<string, unknown>;
  const durationSec = Math.max(1, Math.floor(Number(info.duration) || 0));
  const mediaUrl = pickMedia(info);
  report.durationSec = durationSec;
  checkpoint("douyin_resolve", { status: "passed", durationSec });

  const variants = [
    { id: "mono_16k", output: localPaths[0]!, sampleRate: 16_000, channels: 1, bitrate: "32k" },
    { id: "stereo_32k", output: localPaths[1]!, sampleRate: 32_000, channels: 2, bitrate: "64k" },
  ];
  const uploaded = [] as Array<{ id: string; gcsUri: string; bytes: number }>;
  for (const variant of variants) {
    currentStage = `audio_extract_${variant.id}`;
    await extractAudio({ ...variant, mediaUrl, durationSec });
    const bytes = await readFile(variant.output);
    const fileStat = await stat(variant.output);
    currentStage = `audio_upload_${variant.id}`;
    const saved = await uploadBufferToGcs({
      objectName: `${TMP_PREFIX}/${runId}-${variant.id}.mp3`, buffer: bytes, contentType: "audio/mpeg",
    });
    remote.push(saved);
    uploaded.push({ id: variant.id, gcsUri: saved.gcsUri, bytes: fileStat.size });
    checkpoint(`audio_upload_${variant.id}`, { status: "passed", bytes: fileStat.size });
  }
  currentStage = "gemini_dual_audio";
  const analyzed = await Promise.all(uploaded.map(async (row) => {
    const result = await analyzeAudio(row.gcsUri, durationSec);
    checkpoint(`gemini_${row.id}`, {
      status: "passed",
      elapsedMs: result.elapsedMs,
      inputTokens: result.inputTokens,
      audioTokens: result.audioTokens,
      outputTokens: result.outputTokens,
    });
    return result;
  }));
  const [mono, stereo] = analyzed;

  const visualPrompt = `你正在看完整视频。下面是同一音轨的单声道与立体声分析。两路一致就保留；冲突时对照画面字幕、口型、动作和可见声源自动裁决。纯声音冲突：语气清晰度优先单声道，空间和配乐层次优先立体声；仍无证据就只留共同项。禁止人工审核。只输出 JSON：
{"shots":[{"startSec":0,"endSec":1,"shotSizeZh":"","angleZh":"","cameraMoveZh":"","lightingZh":"","actionZh":"","transitionInZh":""}],"subtitles":[{"atSec":0,"textZh":""}],"classification":{"emotionTagsZh":[],"narrativeFeatureTagsZh":[],"performanceTagsZh":[],"audiovisualTagsZh":[],"audienceExperienceTagsZh":[]},"audioResolution":{"audioTrack":[],"audioBeatStructureZh":"","mixNotesZh":"","reusableAudioZh":"","genAudioHintZh":""},"beatStructureZh":"","moodArcZh":"","reusableZh":"","genPromptHintZh":""}
shots覆盖0..${durationSec}秒；classification每类至少1个真证据标签；audioResolution连续覆盖0..${durationSec}秒；不复制外部剧名。
单声道：${JSON.stringify(mono.result)}
立体声：${JSON.stringify(stereo.result)}`;
  currentStage = "qwen_singapore_visual_audio_resolution";
  const singapore = await qwenJson({
    endpoint: SG_ENDPOINT,
    apiKey: String(process.env.DASHSCOPE_SG_PLAN_KEY || ""),
    timeoutMs: 30 * 60_000,
    messages: [{ role: "user", content: [
      {
        type: "video_url",
        video_url: { url: mediaUrl },
        fps: resolveNativeDeepReadInputFps(durationSec),
        min_pixels: 65_536,
        max_pixels: 655_360,
      },
      { type: "text", text: visualPrompt },
    ] }],
  });
  checkpoint("qwen_singapore_visual_audio_resolution", {
    status: "passed",
    elapsedMs: singapore.elapsedMs,
    inputTokens: singapore.inputTokens,
    outputTokens: singapore.outputTokens,
  });
  const episodeCard = {
    schemaVersion: "native-episode-probe-v1",
    episodeIndex: 1,
    durationSec,
    ...singapore.result as Record<string, unknown>,
  };
  const episodeBytes = Buffer.from(`${JSON.stringify(episodeCard)}\n`, "utf8");
  currentStage = "episode_json_upload";
  const episodeSaved = await uploadBufferToGcs({
    objectName: `${TMP_PREFIX}/${runId}-episode.json`, buffer: episodeBytes, contentType: "application/json",
  });
  remote.push(episodeSaved);

  // GCS → Fly：按 generation 下载，JSON 校验后写 part，fsync，再原子改名并回读校验。
  currentStage = "episode_json_download_to_fly";
  const versioned = await downloadGcsObjectVersioned({ gcsUri: episodeSaved.gcsUri });
  const parsedFromGcs = JSON.parse(versioned.buffer.toString("utf8"));
  if (!parsedFromGcs || versioned.buffer.length !== episodeBytes.length) throw new Error("GCS JSON 下载不完整");
  const part = `${snapshotPath}.part`;
  const handle = await open(part, "wx", 0o600);
  await handle.writeFile(versioned.buffer);
  await handle.sync();
  await handle.close();
  await rename(part, snapshotPath);
  const snapshotBytes = await readFile(snapshotPath);
  if (hash(snapshotBytes) !== hash(versioned.buffer)) throw new Error("Fly 快照哈希不一致");
  const snapshotJson = JSON.parse(snapshotBytes.toString("utf8"));
  checkpoint("episode_json_download_to_fly", {
    status: "passed",
    bytes: snapshotBytes.length,
    generationPresent: Boolean(versioned.generation),
    sha256: hash(snapshotBytes),
  });

  currentStage = "glm_openrouter_series_aggregation";
  const glm = await invokeNativeSeriesAggregationModel(JSON.stringify({
    schemaVersion: "native-series-probe-v2",
    episodeCount: 1,
    episodes: [snapshotJson],
  }));
  checkpoint("glm_openrouter_series_aggregation", {
    status: "passed",
    inputTokens: glm.inputTokens,
    outputTokens: glm.outputTokens,
    reasoningTokens: glm.reasoningTokens,
    costUsd: glm.costUsd,
  });

  const series = glm.raw as Record<string, unknown>;
  if (!series.storyStructure || !series.classification || !Array.isArray(series.beatGrid) || series.beatGrid.length < 6) {
    throw new Error("GLM-5.3 系列聚合结构不完整");
  }
  const geminiInput = mono.inputTokens + stereo.inputTokens;
  const geminiOutput = mono.outputTokens + stereo.outputTokens;
  report.status = "passed";
  report.calls = 4;
  report.audio = {
    mono: { bytes: uploaded[0]!.bytes, tracks: (mono.result.audioTrack as unknown[]).length, elapsedMs: mono.elapsedMs, inputTokens: mono.inputTokens, audioTokens: mono.audioTokens, outputTokens: mono.outputTokens },
    stereo: { bytes: uploaded[1]!.bytes, tracks: (stereo.result.audioTrack as unknown[]).length, elapsedMs: stereo.elapsedMs, inputTokens: stereo.inputTokens, audioTokens: stereo.audioTokens, outputTokens: stereo.outputTokens },
  };
  report.singapore = { elapsedMs: singapore.elapsedMs, inputTokens: singapore.inputTokens, outputTokens: singapore.outputTokens, shots: Array.isArray((singapore.result as Record<string, unknown>).shots) ? ((singapore.result as Record<string, unknown>).shots as unknown[]).length : 0 };
  report.transfer = { generationPresent: Boolean(versioned.generation), bytes: snapshotBytes.length, sha256: hash(snapshotBytes), jsonParsed: true, atomicRename: true };
  report.glm = { inputTokens: glm.inputTokens, outputTokens: glm.outputTokens, reasoningTokens: glm.reasoningTokens, costUsd: glm.costUsd, storyStructurePresent: true, classificationGroups: Object.keys(series.classification as object).length, beatCount: (series.beatGrid as unknown[]).length };
  report.cost = {
    geminiEstimatedCny: (geminiInput * 0.75 + geminiOutput * 3.75) * 7 / 1_000_000,
    singaporePlanEquivalentCny: (singapore.inputTokens * 14.988 + singapore.outputTokens * 44.965) / 1_000_000,
    glmOpenRouterUsd: glm.costUsd,
  };
  report.seriesPreview = {
    nameZh: series.nameZh,
    summaryZh: series.summaryZh,
    classification: series.classification,
    storyStructure: series.storyStructure,
  };
} catch (error) {
  report.status = "failed";
  report.failedStage = currentStage;
  report.errorZh = cleanError(error);
  checkpoint(currentStage, { status: "failed", errorZh: cleanError(error) });
  throw Object.assign(new Error(cleanError(error)), { report });
} finally {
  await Promise.allSettled(remote.map((row) => deleteGcsObject(row)));
  await Promise.allSettled(localPaths.map((file) => unlink(file)));
  await rm(snapshotPath, { force: true });
  process.stdout.write(`${JSON.stringify({ ...report, finishedAt: new Date().toISOString(), cleanupAttempted: true }, null, 2)}\n`);
}
