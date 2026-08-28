/**
 * 真人剧 0–300 / 300–600 秒真实精读探针。
 *
 * 只允许在 Fly 内执行：凭证从服务端环境读取。视频 MP4 仅供本轮模型调用，
 * 任务结束立即删除并复查无残留（保留时间小于 24 小时）；上游完整响应、
 * 解析后段证据与本次核对摘要永久保存在 GCS。
 */
import { createHash } from "node:crypto";
import {
  fetchManhua0996EpisodePlayback,
} from "../server/services/manhuaLearn0996Source.js";
import {
  runManhuaNativeDeepRead,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const SOURCE_URL = String(
  process.argv.find((arg) => arg.startsWith("--url="))?.slice("--url=".length) || "",
).trim();
if (!SOURCE_URL) throw new Error("缺少 --url=https://... 真人剧单集页");

const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const seriesKey = `probe_full_${runStamp}`;
const sourceDigest = createHash("sha256")
  .update(JSON.stringify({ sourceUrl: SOURCE_URL, range: [0, 600], version: 1 }))
  .digest("hex");
const bucket = getGcsBucketName();
const rawPrefix = `manhua-template-learn/segment-evidence-raw/tpl_native_${seriesKey}_ep001/`;
const parsedPrefix = `manhua-template-learn/segment-evidence/tpl_native_${seriesKey}_ep001/`;

type EvidenceCounts = {
  shots: number;
  subtitles: number;
  audioResolution: number;
  audioTracks: number;
  audioCues: number;
};

function countsOf(raw: Record<string, unknown>): EvidenceCounts {
  const audioResolution = Array.isArray(raw.audioResolution) ? raw.audioResolution : [];
  const analyses = audioResolution
    .map((row) => (row && typeof row === "object" ? (row as { analysis?: unknown }).analysis : null))
    .filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object"));
  const tracks = analyses.flatMap((analysis) => (
    Array.isArray(analysis.audioTrack) ? analysis.audioTrack : []
  ));
  return {
    shots: Array.isArray(raw.shots) ? raw.shots.length : 0,
    subtitles: Array.isArray(raw.subtitles) ? raw.subtitles.length : 0,
    audioResolution: audioResolution.length,
    audioTracks: tracks.length,
    audioCues: tracks.reduce((sum, row) => (
      sum + (row && typeof row === "object" && Array.isArray((row as { cues?: unknown }).cues)
        ? (row as { cues: unknown[] }).cues.length
        : 0)
    ), 0),
  };
}

function extractModelJsonFromRawEvidence(payload: unknown): Record<string, unknown> {
  const stored = payload && typeof payload === "object" ? payload as { responseText?: unknown } : null;
  const envelope = JSON.parse(String(stored?.responseText || "")) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  };
  const text = (envelope.candidates?.[0]?.content?.parts || [])
    .filter((part) => !part.thought)
    .map((part) => String(part.text || ""))
    .join("");
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("原始响应候选正文不是 JSON 对象");
  }
  return parsed as Record<string, unknown>;
}

function segmentIndexFromName(name: string): number {
  const match = /\/seg(\d+)(?:\/|-)/.exec(name);
  return Number(match?.[1] ?? -1);
}

async function objectFact(objectName: string) {
  const downloaded = await downloadGcsObjectVersioned({ gcsUri: `gs://${bucket}/${objectName}` });
  return {
    objectName,
    bytes: downloaded.buffer.byteLength,
    sha256: createHash("sha256").update(downloaded.buffer).digest("hex"),
    payload: JSON.parse(downloaded.buffer.toString("utf8")) as unknown,
  };
}

async function main() {
  console.info(`[probe] 建单：series=${seriesKey} · 范围 0–300 / 300–600 · 原始 JSON 永久保留`);
  const videoPrefix = "manhua-template-learn/tmp/native-deep-read/";
  const videosBefore = new Set(await listGcsObjectNamesByPrefix({
    prefix: videoPrefix, literalPrefix: true, maxResults: 1_000,
  }));
  const resolveNodes = async () => {
    const playback = await fetchManhua0996EpisodePlayback(SOURCE_URL);
    return playback.playbackUrls.map((url) => ({ url, referer: playback.referer }));
  };

  let runError: unknown;
  let result: Awaited<ReturnType<typeof runManhuaNativeDeepRead>> | undefined;
  try {
    result = await runManhuaNativeDeepRead({
      seriesKey,
      episodeIndex: 1,
      sourceDigest,
      resolveNodes,
      segments: [
        { startSec: 0, endSec: 300 },
        { startSec: 300, endSec: 600 },
      ],
      sourceDurationSec: 600,
      hintZh: "真人剧完整视听证据探针；按真实镜头、表演、光影、声音和叙事变化记录",
    });
  } catch (error) {
    runError = error;
  }

  const [rawNames, parsedNames, videosAfter] = await Promise.all([
    listGcsObjectNamesByPrefix({ prefix: rawPrefix, literalPrefix: true, maxResults: 100 }),
    listGcsObjectNamesByPrefix({ prefix: parsedPrefix, literalPrefix: true, maxResults: 100 }),
    listGcsObjectNamesByPrefix({ prefix: videoPrefix, literalPrefix: true, maxResults: 1_000 }),
  ]);
  const temporaryVideoLeaks = videosAfter.filter((name) => !videosBefore.has(name));
  const rawFacts = await Promise.all(rawNames.map(objectFact));
  const parsedFacts = await Promise.all(parsedNames.map(objectFact));
  const rawBySegment = new Map<number, ReturnType<typeof countsOf>>();
  const parsedBySegment = new Map<number, ReturnType<typeof countsOf>>();

  for (const fact of rawFacts) {
    const segmentIndex = segmentIndexFromName(fact.objectName);
    // 同段重试可能有多份原始响应；最后一份是最终接受/拒绝判断的输入。
    rawBySegment.set(segmentIndex, countsOf(extractModelJsonFromRawEvidence(fact.payload)));
  }
  for (const fact of parsedFacts) {
    const entry = fact.payload && typeof fact.payload === "object"
      ? fact.payload as { raw?: unknown }
      : null;
    if (!entry?.raw || typeof entry.raw !== "object" || Array.isArray(entry.raw)) {
      throw new Error(`解析后证据缺少 raw：${fact.objectName}`);
    }
    parsedBySegment.set(segmentIndexFromName(fact.objectName), countsOf(entry.raw as Record<string, unknown>));
  }

  const reconciliations = [0, 1].map((segmentIndex) => {
    const rawCounts = rawBySegment.get(segmentIndex);
    const parsedCounts = parsedBySegment.get(segmentIndex);
    const countsEqual = Boolean(rawCounts && parsedCounts
      && JSON.stringify(rawCounts) === JSON.stringify(parsedCounts));
    return { segmentIndex, rawCounts, parsedCounts, countsEqual };
  });
  const summary = {
    schemaVersion: 1,
    runId: seriesKey,
    sourceDigest,
    ranges: [[0, 300], [300, 600]],
    status: runError ? "failed" : "completed",
    error: runError instanceof Error ? runError.message : runError ? String(runError) : undefined,
    resultCounts: result ? {
      beatGrid: result.beatGrid.length,
      subtitles: result.subtitleTrack.length,
      resolvedAudioChunks: result.resolvedAudioChunks.length,
      segmentCount: result.segmentCount,
      shotCount: result.shotCount,
      droppedCount: result.droppedCount,
      truncated: result.truncated,
    } : undefined,
    rawEvidence: rawFacts.map(({ objectName, bytes, sha256 }) => ({ objectName, bytes, sha256 })),
    parsedEvidence: parsedFacts.map(({ objectName, bytes, sha256 }) => ({ objectName, bytes, sha256 })),
    videoRetention: {
      policy: "delete_on_settle",
      maximumHours: 24,
      leakedObjectNames: temporaryVideoLeaks,
    },
    reconciliations,
  };
  const summaryObjectName = `manhua-template-learn/probes/${seriesKey}/summary.json`;
  const summaryBuffer = Buffer.from(`${JSON.stringify(summary, null, 2)}\n`, "utf8");
  const saved = await uploadBufferToGcsIfAbsent({
    bucket,
    objectName: summaryObjectName,
    contentType: "application/json",
    buffer: summaryBuffer,
  });
  if (!saved.created) throw new Error("探针摘要对象已存在，拒绝覆盖");

  console.info(JSON.stringify({
    ...summary,
    summaryEvidence: {
      objectName: summaryObjectName,
      bytes: summaryBuffer.byteLength,
      sha256: createHash("sha256").update(summaryBuffer).digest("hex"),
    },
  }, null, 2));

  if (runError) throw runError;
  if (temporaryVideoLeaks.length > 0) {
    throw new Error(`测试视频清理不完整：leaked=${temporaryVideoLeaks.length}`);
  }
  if (rawFacts.length < 2 || parsedFacts.length !== 2) {
    throw new Error(`证据不完整：raw=${rawFacts.length} parsed=${parsedFacts.length}`);
  }
  if (reconciliations.some((row) => !row.countsEqual)) {
    throw new Error("原始响应与解析后证据条数不一致，已阻断");
  }
  if (result?.truncated || result?.droppedCount) {
    throw new Error(`消费层仍丢证据：truncated=${result?.truncated} dropped=${result?.droppedCount}`);
  }
}

main().catch((error) => {
  console.error(`[probe] 失败：${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
