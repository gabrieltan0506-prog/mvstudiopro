/**
 * 抖音单集 0–300 / 300–600 秒真实精读探针（与 manhua-native-two-segment-evidence-probe.mts
 * 同 schema、同门禁、同保存策略；唯一差异是片源解析层走抖音 yt-dlp）。
 *
 * 只允许在 Fly 内执行：凭证从服务端环境读取。视频 MP4 仅供本轮模型调用，
 * 任务结束立即删除并复查无残留；上游完整响应、解析后段证据与本次核对摘要永久保存在 GCS。
 * 分段按真实时长收口：不足 300 秒只跑一段，不足 600 秒第二段到真实终点为止。
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { promisify } from "node:util";
import {
  runManhuaNativeDeepRead,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const run = promisify(execFile);
const SOURCE = String(
  process.argv.find((arg) => arg.startsWith("--url="))?.slice("--url=".length) || "",
).trim();
const VIDEO_ID = SOURCE.match(/(?:modal_id=|\/video\/)(\d{10,24})/)?.[1] || "";
const PAGE_URL = VIDEO_ID ? `https://www.douyin.com/video/${VIDEO_ID}` : "";
if (!PAGE_URL) throw new Error("缺少 --url=（抖音 /video/<id> 或带 modal_id 的链接）");
if (process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("本探针只允许在 Fly 容器内运行");

const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const seriesKey = `probe_douyin_${runStamp}`;
const sourceDigest = createHash("sha256")
  .update(JSON.stringify({ sourceVideoId: VIDEO_ID, range: [0, 600], version: 1 }))
  .digest("hex");
const bucket = getGcsBucketName();
const rawPrefix = `manhua-template-learn/segment-evidence-raw/tpl_native_${seriesKey}_ep001/`;
const parsedPrefix = `manhua-template-learn/segment-evidence/tpl_native_${seriesKey}_ep001/`;

/** 失败必带根因：沿 cause 链逐层保留 name/code/message，URL 一律遮蔽。 */
function describeErrorChain(error: unknown): Array<Record<string, string>> {
  const chain: Array<Record<string, string>> = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current; depth += 1) {
    if (typeof current !== "object" && typeof current !== "string") break;
    const row: Record<string, string> = {};
    const source = typeof current === "string" ? { message: current } : current as {
      name?: unknown; code?: unknown; message?: unknown; cause?: unknown;
    };
    for (const key of ["name", "code", "message"] as const) {
      const value = (source as Record<string, unknown>)[key];
      if (typeof value !== "string" && typeof value !== "number") continue;
      const text = String(value).replace(/[\r\n\t]+/g, " ").replace(/https?:\/\/\S+/g, "<URL>").trim().slice(0, 200);
      if (text) row[key] = text;
    }
    if (Object.keys(row).length > 0) chain.push(row);
    current = (source as { cause?: unknown }).cause;
  }
  return chain;
}

function pickMedia(info: Record<string, unknown>): string {
  const formats = Array.isArray(info.formats) ? info.formats as Array<Record<string, unknown>> : [];
  const candidates = formats
    .filter((row) => String(row.url || "") && String(row.vcodec || "none") !== "none" && String(row.acodec || "none") !== "none")
    .sort((a, b) => Number(a.filesize || a.filesize_approx || 9e15) - Number(b.filesize || b.filesize_approx || 9e15));
  const url = String(candidates[0]?.url || info.url || "");
  if (!/^https:\/\//.test(url)) throw new Error("未解析到带音画的抖音媒体流");
  return url;
}

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
  console.info(`[probe] 阶段：抖音片源解析（yt-dlp）视频 ${VIDEO_ID}`);
  const { stdout } = await run("yt-dlp", [
    "-J", "--no-warnings", "--add-header", `Cookie:${String(process.env.DOUYIN_COOKIE || "")}`, PAGE_URL,
  ], { timeout: 150_000, maxBuffer: 64 * 1024 * 1024 });
  const info = JSON.parse(stdout) as Record<string, unknown>;
  const durationSec = Math.max(1, Math.floor(Number(info.duration) || 0));
  const mediaUrl = pickMedia(info);
  console.info(`[probe] 阶段：抖音片源解析成功，真实时长 ${durationSec} 秒`);

  const segments = [{ startSec: 0, endSec: Math.min(300, durationSec) }];
  if (durationSec > 300) segments.push({ startSec: 300, endSec: Math.min(600, durationSec) });
  const coveredEnd = segments[segments.length - 1]!.endSec;
  console.info(`[probe] 建单：series=${seriesKey} · 分段 ${segments.map((s) => `${s.startSec}–${s.endSec}`).join(" / ")} · 原始 JSON 永久保留`);

  const videoPrefix = "manhua-template-learn/tmp/native-deep-read/";
  const videosBefore = new Set(await listGcsObjectNamesByPrefix({
    prefix: videoPrefix, literalPrefix: true, maxResults: 1_000,
  }));

  let runError: unknown;
  let result: Awaited<ReturnType<typeof runManhuaNativeDeepRead>> | undefined;
  try {
    result = await runManhuaNativeDeepRead({
      seriesKey,
      episodeIndex: 1,
      sourceDigest,
      resolveNodes: async () => [{ url: mediaUrl, referer: "https://www.douyin.com/" }],
      segments,
      sourceDurationSec: coveredEnd,
      hintZh: "抖音漫剧完整视听证据探针；按真实镜头、表演、光影、声音和叙事变化记录",
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
    // 坏 JSON 的失败尝试同样是合法证据（重试梯度的存在理由），不得让它阻断摘要落盘。
    try {
      rawBySegment.set(segmentIndex, countsOf(extractModelJsonFromRawEvidence(fact.payload)));
    } catch {
      console.error(`[probe] 原始证据不可解析（不阻断摘要）：${fact.objectName}`);
    }
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

  const reconciliations = segments.map((_, segmentIndex) => {
    const rawCounts = rawBySegment.get(segmentIndex);
    const parsedCounts = parsedBySegment.get(segmentIndex);
    const countsEqual = Boolean(rawCounts && parsedCounts
      && JSON.stringify(rawCounts) === JSON.stringify(parsedCounts));
    return { segmentIndex, rawCounts, parsedCounts, countsEqual };
  });
  // 关键帧抽取（¥0，模型无关）：每个 story 镜头中点一帧，画面证据永久保留，
  // 供面板与审片报告展示引用；广告镜头不抽。单帧失败只记错，不阻断摘要。
  const frameEvidence: Array<{
    segmentIndex: number; shotIndex: number; atSec: number; objectName: string; bytes: number;
  }> = [];
  const frameErrors: string[] = [];
  for (const fact of parsedFacts) {
    const segmentIndex = segmentIndexFromName(fact.objectName);
    const entry = fact.payload as { raw?: { shots?: Array<Record<string, unknown>> } };
    const shots = Array.isArray(entry.raw?.shots) ? entry.raw.shots : [];
    for (let shotIndex = 0; shotIndex < shots.length && frameEvidence.length < 240; shotIndex += 1) {
      const shot = shots[shotIndex]!;
      if (shot.evidenceRole === "non_story_ad") continue;
      const startSec = Number(shot.startSec) || 0;
      const endSec = Math.max(startSec, Number(shot.endSec) || startSec);
      const atSec = Math.round(((startSec + endSec) / 2) * 10) / 10;
      const local = `/tmp/probe-frame-${segmentIndex}-${shotIndex}.jpg`;
      try {
        await run("ffmpeg", [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
          "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          "-headers", "Referer: https://www.douyin.com/\r\n",
          "-ss", String(atSec), "-i", mediaUrl, "-frames:v", "1", "-q:v", "4", local,
        ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
        const buffer = await readFile(local);
        const objectName = `manhua-template-learn/probes/${seriesKey}/frames/seg${segmentIndex}/shot${String(shotIndex).padStart(3, "0")}-${Math.round(atSec * 10)}ds.jpg`;
        await uploadBufferToGcsIfAbsent({ bucket, objectName, contentType: "image/jpeg", buffer });
        frameEvidence.push({ segmentIndex, shotIndex, atSec, objectName, bytes: buffer.byteLength });
        await rm(local, { force: true });
        if (frameEvidence.length % 20 === 0) console.info(`[probe] 阶段：关键帧已抽 ${frameEvidence.length} 帧`);
      } catch (error) {
        frameErrors.push(`seg${segmentIndex}#${shotIndex}@${atSec}s ${error instanceof Error ? error.message : String(error)}`.slice(0, 120));
        await rm(local, { force: true }).catch(() => {});
      }
    }
  }
  console.info(`[probe] 阶段：关键帧抽取完成 ${frameEvidence.length} 帧，失败 ${frameErrors.length}`);

  const summary = {
    schemaVersion: 1,
    runId: seriesKey,
    sourceDigest,
    sourceVideoId: VIDEO_ID,
    sourceDurationSec: durationSec,
    ranges: segments.map((s) => [s.startSec, s.endSec]),
    status: runError ? "failed" : "completed",
    error: runError instanceof Error ? runError.message : runError ? String(runError) : undefined,
    errorCauseChain: runError ? describeErrorChain(runError) : undefined,
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
    frameEvidence,
    frameErrors: frameErrors.length ? frameErrors : undefined,
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
  if (rawFacts.length < segments.length || parsedFacts.length !== segments.length) {
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
  console.error(`[probe] 根因链：${JSON.stringify(describeErrorChain(error))}`);
  process.exitCode = 1;
});
