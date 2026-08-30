/**
 * 原生读片验收探针：默认仅核对本地参数；--execute 才允许在 Fly 内执行。
 *
 * 只允许在 Fly 内执行：凭证从服务端环境读取。视频 MP4 仅供本轮模型调用，
 * --gcs-manifest=<文件> 复用已有分片，不解析片源、不切片、不删除输入对象。
 * --segment-seconds=<整数> 与生产共用分片长度，省略默认300秒；清单模式省略则保留原边界。
 * --fps=<数值> 独立配置视频采样率，省略默认10；不会根据分片长度自动降采样。
 * 上游完整响应、解析后段证据、实际请求审计与核对摘要永久保存在 GCS。
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rm, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  NATIVE_DEEP_READ_GENERATION_CONFIG,
  NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC,
  NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  buildGeminiNativeDeepReadSegmentRequest,
  createNativeDeepReadRunnerDeps,
  evaluateNativeDeepReadSegmentAcceptance,
  measureNativeDeepReadSegmentCoverage,
  resolveNativeDeepReadRequestFps,
  resolveNativeDeepReadSegmentFloors,
  runManhuaNativeDeepRead,
} from "../server/services/manhuaNativeDeepReadRunner.js";
import {
  validateNativeProbeGenerationConfig,
  summarizeNativeProbeChecks,
} from "../server/services/manhuaNativeDeepReadProbeChecks.js";
import { parseNativeProbeManifest } from "../server/services/manhuaNativeDeepReadProbeManifest.js";
import {
  extractNativeProbeModelJson as extractModelJsonFromRawEvidence,
  reconcileNativeProbeSegment,
  reconcileNativeProbeParsedAttempt,
  nativeProbeHasThoughtLeak,
  measureNativeProbeConcurrency,
} from "../server/services/manhuaNativeDeepReadProbeEvidence.js";
import {
  createNativeProbeAuditedPost,
  assertNativeProbeImage,
  verifyNativeProbeManifestMedia,
  verifyNativeProbeSourceAttestation,
} from "../server/services/manhuaNativeDeepReadProbeRuntime.js";
import {
  probeNativeDeepReadDurationSec,
  splitNativeDeepReadSegments,
} from "../server/services/manhuaNativeDeepReadPlan.js";
import {
  parseNativeDeepReadSegmentSeconds,
  parseNativeDeepReadVideoFps,
} from "../shared/manhuaNativeDeepReadJob.js";
import { fetchDouyinAwemeDetailViaWebApi } from "../server/services/manhuaLearnDouyinWebApi.js";
import { fetchManhua0996EpisodePlayback } from "../server/services/manhuaLearn0996Source.js";
import {
  describeErrorChain,
  sanitizeSensitiveText,
} from "../server/services/manhuaMediaSanitize.js";
import {
  downloadGcsObjectVersioned,
  getGcsBucketName,
  listGcsObjectNamesByPrefix,
  signGsUriV4ReadUrl,
  statGcsObjectVersion,
  uploadBufferToGcsIfAbsent,
} from "../server/services/gcs.js";

const run = promisify(execFile);
const stringArg = (name: string) => process.argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || "";
const execute = process.argv.includes("--execute");
const manifestPath = stringArg("gcs-manifest");
// 显式非法输入不能被空值兜底吞掉；只有完全省略参数才使用生产默认。
const segmentSecondsArgs = process.argv.filter((arg) => arg === "--segment-seconds" || arg.startsWith("--segment-seconds="));
if (segmentSecondsArgs.length > 1 || segmentSecondsArgs[0] === "--segment-seconds") {
  throw new Error("--segment-seconds 必须且只能使用一次 --segment-seconds=<整数秒> 形式");
}
const segmentSeconds = (() => {
  try {
    return parseNativeDeepReadSegmentSeconds(segmentSecondsArgs[0]?.slice("--segment-seconds=".length));
  } catch (error) {
    throw new Error(`--segment-seconds 无效：${error instanceof Error ? error.message : "分片长度必须是整数秒"}`);
  }
})();
const requestedSegmentSeconds = segmentSecondsArgs.length ? segmentSeconds : null;
const fpsArgs = process.argv.filter((arg) => arg === "--fps" || arg.startsWith("--fps="));
if (fpsArgs.length > 1 || fpsArgs[0] === "--fps") {
  throw new Error("--fps 必须且只能使用一次 --fps=<数值> 形式");
}
const requestedVideoFps = (() => {
  try {
    return parseNativeDeepReadVideoFps(fpsArgs[0]?.slice("--fps=".length));
  } catch (error) {
    throw new Error(`--fps 无效：${error instanceof Error ? error.message : "视频采样率不合法"}`);
  }
})();
const SOURCE = String(
  process.argv.find((arg) => arg.startsWith("--url="))?.slice("--url=".length) || "",
).trim();
/**
 * 片源两类，**只有解析这一层不同**，下游切片/上传/模型/门禁/验收完全共用——
 * 所以不另起一支探针，按域名选解析器（0830 用户点破「真人剧还分呀」）。
 *   · 抖音（漫剧）→ web api
 *   · 第三方站（真人剧/电影）→ 0996 解析链（站点白名单与出网校验在其内部）
 */
const SOURCE_HOST = (() => { try { return new URL(SOURCE).hostname; } catch { return ""; } })();
const IS_DOUYIN = /(?:^|\.)douyin\.com$/i.test(SOURCE_HOST) || /modal_id=/.test(SOURCE);
const VIDEO_ID = SOURCE.match(/(?:modal_id=|\/video\/)(\d{10,24})/)?.[1] || "";
const PAGE_URL = IS_DOUYIN
  ? (VIDEO_ID ? `https://www.douyin.com/video/${VIDEO_ID}` : "")
  : SOURCE;
if (execute && !PAGE_URL && !manifestPath) throw new Error("执行模式需要 --gcs-manifest= 或 --url=");
if (PAGE_URL && manifestPath) throw new Error("已有 GCS 分片模式不得同时传入 --url=，避免意外重拉片源");
if (execute && process.env.FLY_APP_NAME !== "mvstudiopro") throw new Error("付费探针只允许在 Fly 容器内运行");

/** 🔓 并发上限由命令行给，不写死（用户令「上限应该是我来定的」）。省略＝走生产默认。 */
const numArg = (name: string): number | undefined => {
  const hit = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const value = Math.floor(Number(hit.slice(name.length + 3)));
  return Number.isFinite(value) && value > 0 ? value : undefined;
};
const cutConcurrency = numArg("cut-concurrency");
const uploadConcurrency = numArg("upload-concurrency");
const modelConcurrency = numArg("model-concurrency");

const runStamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const seriesKey = `probe_douyin_${runStamp}_${randomUUID().slice(0, 8)}`;
/**
 * 身份串按**真实整集范围**算。旧版写死 `range:[0,600]`——那是两段探针时代的遗留，
 * 现在跑整集 4–8 片，写死 600 会让证据溯源上的「范围」与实际覆盖对不上。
 * 真实时长要 ffprobe 之后才知道，所以这里只给一个工厂，main 里拿到时长再算。
 */
const makeSourceDigest = (durationSec: number): string => createHash("sha256")
  .update(JSON.stringify({
    sourceVideoId: VIDEO_ID || PAGE_URL,
    range: [0, Math.round(durationSec)],
    version: 2,
  }))
  .digest("hex");
const bucket = getGcsBucketName();
const rawPrefix = `manhua-template-learn/segment-evidence-raw/tpl_native_${seriesKey}_ep001/`;
const parsedPrefix = `manhua-template-learn/segment-evidence/tpl_native_${seriesKey}_ep001/`;
const parsedAttemptPrefix = `manhua-template-learn/segment-evidence-parsed-attempt/tpl_native_${seriesKey}_ep001/`;

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

const objectRows = (value: unknown): Array<Record<string, unknown>> => Array.isArray(value)
  ? value.filter((row): row is Record<string, unknown> => Boolean(row && typeof row === "object" && !Array.isArray(row))) : [];

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

/** 匿名 yt-dlp（零 Cookie/凭证 argv）：页面法失败时的兜底与时长补齐。 */
async function fetchInfoAnonymously(): Promise<Record<string, unknown>> {
  const { stdout } = await run("yt-dlp", [
    "-J", "--no-warnings", PAGE_URL,
  ], { timeout: 150_000, maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(stdout) as Record<string, unknown>;
}

/**
 * 片源解析：**走抖音 web api**（与生产同一条路）。
 *
 * 视频页是客户端渲染的壳，HTML 里没有 play_addr——0829 实测 814KB 页面零个播放地址，
 * 且验证页特征全为 0（不是 Cookie 失效）。web api 一次拿到全部可信播放地址。
 * 时长该接口不回，走生产 ffprobe 读远端头部（不下片）。
 * 匿名 yt-dlp 只作最后兜底（它自身要求 fresh cookies，通常也过不去）。
 */
async function resolveSourceMedia(): Promise<{
  mediaUrl: string; durationSec: number; kindZh: string;
  /**
   * 🔴 referer 必须由解析器一路带到切片（0830 实弹）：媒体域与播放页域**不是同一个**
   * （如页面在 gzcrkt8888.com、媒体在 ppvod01.kqgfbs.com）。此前时长探测用解析器给的
   * referer 成功、切片却自己拼页面 origin，同一片源两处用了不同 referer →
   * CDN 直接 TLS「End of file」断流，整轮死在备料阶段。
   */
  referer: string;
}> {
  if (!IS_DOUYIN) {
    const playback = await fetchManhua0996EpisodePlayback(PAGE_URL);
    if (!playback.playbackUrl) throw new Error("第三方站未解析到播放地址");
    return {
      mediaUrl: playback.playbackUrl,
      durationSec: await probeNativeDeepReadDurationSec(
        playback.playbackUrl, undefined, undefined, playback.referer,
      ),
      kindZh: `第三方站 0996 解析（候选 ${playback.playbackUrls.length} 个）`,
      referer: playback.referer,
    };
  }
  const referer = "https://www.douyin.com/";
  try {
    const detail = await fetchDouyinAwemeDetailViaWebApi(VIDEO_ID);
    const mediaUrl = detail?.playbackUrl || "";
    if (!mediaUrl) throw new Error("web api 未返回可信播放地址");
    if (detail?.access === "paid_locked") throw new Error("该集为付费锁定内容，探针不越过付费边界");
    return {
      mediaUrl,
      durationSec: await probeNativeDeepReadDurationSec(mediaUrl, undefined, undefined, referer),
      kindZh: `抖音 web api（access=${detail?.access ?? "unknown"}）`,
      referer,
    };
  } catch (apiError) {
    console.error(`[probe] web api 解析失败，回退匿名 yt-dlp：${sanitizeSensitiveText(apiError)}`);
    const info = await fetchInfoAnonymously();
    const mediaUrl = pickMedia(info);
    const hinted = Math.floor(Number(info.duration) || 0);
    return {
      mediaUrl,
      durationSec: hinted > 0
        ? hinted
        : await probeNativeDeepReadDurationSec(mediaUrl, undefined, undefined, referer),
      kindZh: "抖音（yt-dlp 兜底）",
      referer,
    };
  }
}

/* ─────────── v11 验收：三态判定，「未观察到」不许冒充「通过」 ─────────── */

type CheckStatus = "pass" | "fail" | "not_observed";
type CheckId = "P1" | "P2" | "P3" | "P4" | "P5" | "P6" | "P7" | "P8" | "P9" | "P10";
type Check = { id: CheckId; nameZh: string; status: CheckStatus; actualZh: string };
const checks: Check[] = [];
const record = (id: CheckId, nameZh: string, status: CheckStatus, actualZh: string) => {
  checks.push({ id, nameZh, status, actualZh });
  const tag = status === "pass" ? "PASS" : status === "fail" ? "FAIL" : "未观察";
  console.info(`[probe] ${tag} ${id} ${nameZh} —— ${actualZh}`);
};

async function main() {
  const manifest = manifestPath
    ? parseNativeProbeManifest(JSON.parse(await readFile(manifestPath, "utf8"))) : undefined;
  if (manifest && requestedSegmentSeconds !== null) {
    const expected = splitNativeDeepReadSegments(manifest.sourceDurationSec, requestedSegmentSeconds);
    if (expected.length !== manifest.segments.length || expected.some((segment, index) => (
      Math.abs(segment.startSec - manifest.segments[index]!.startSec) > 1e-6
      || Math.abs(segment.endSec - manifest.segments[index]!.endSec) > 1e-6
    ))) {
      throw new Error(`清单边界与 --segment-seconds=${requestedSegmentSeconds} 不一致，禁止改写清单或重新切片`);
    }
  }
  const effectiveSegmentSeconds = manifest && requestedSegmentSeconds === null ? null : segmentSeconds;
  const describeSegments = (ranges: ReadonlyArray<{ startSec: number; endSec: number }>) => ranges.map(({ startSec, endSec }, segmentIndex) => ({
    segmentIndex, startSec, endSec, durationSec: endSec - startSec,
    fps: resolveNativeDeepReadRequestFps(endSec - startSec, requestedVideoFps),
  }));
  // 检查经过生产请求构造器及 JSON 序列化后的对象，不拿常量与自身比较。
  const preflightRequest = JSON.parse(JSON.stringify(buildGeminiNativeDeepReadSegmentRequest({
    fileUri: manifest?.segments[0]?.gsUri || "gs://probe-preflight/never-sent.mp4",
    fps: resolveNativeDeepReadRequestFps(manifest
      ? manifest.segments[0]!.endSec - manifest.segments[0]!.startSec : segmentSeconds, requestedVideoFps),
    prompt: "仅校验请求，不发送模型调用",
  })));
  const p1 = validateNativeProbeGenerationConfig(
    preflightRequest.generationConfig, NATIVE_DEEP_READ_GENERATION_CONFIG,
    NATIVE_DEEP_READ_RETRY_TEMPERATURES,
  );
  record("P1", p1.nameZh, p1.status, p1.actualZh);
  if (p1.status !== "pass") throw new Error(`P1 未通过，禁止发车：${p1.errorsZh.join("；")}`);
  if (!execute) {
    console.info(JSON.stringify({
      mode: "preflight_only", paidCalls: 0, acceptanceStatus: "not_run",
      planVersion: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
      schemaSha256: createHash("sha256").update(JSON.stringify(preflightRequest.generationConfig.responseSchema)).digest("hex"),
      segmentSeconds: effectiveSegmentSeconds, requestedSegmentSeconds,
      videoFps: requestedVideoFps,
      fps: preflightRequest.contents[0].parts[0].videoMetadata.fps,
      manifestValidated: Boolean(manifest), segmentCount: manifest?.segments.length ?? null,
      segmentPlans: manifest ? describeSegments(manifest.segments) : undefined,
      noteZh: "仅预检通过，不代表实弹验收通过；执行前须核对远端 PR HEAD、干净工作树和运行镜像并取得费用确认",
    }, null, 2));
    return;
  }
  const runtimeIdentity = assertNativeProbeImage(stringArg("expected-commit"), process.env.FLY_IMAGE_REF);
  const attestationPath = stringArg("source-attestation");
  if (!attestationPath) throw new Error("缺少已推 PR 的源码核对清单，禁止只凭镜像标签发车");
  const sourceAttestation = await verifyNativeProbeSourceAttestation(
    JSON.parse(await readFile(attestationPath, "utf8")), runtimeIdentity.commit,
    // 必须核验正在执行的脚本所属源码树，不能从另一份干净cwd取文件冒充。
    (relativePath) => readFile(new URL(`../${relativePath}`, import.meta.url)),
  );
  const source = manifest ? {
    mediaUrl: "", durationSec: manifest.sourceDurationSec,
    kindZh: "已有 GCS 分片（不拉源片、不切片）", referer: "",
  } : await resolveSourceMedia();
  const { mediaUrl, durationSec, kindZh, referer: mediaReferer } = source;
  console.info(`[probe] 阶段：${kindZh}，时长 ${durationSec} 秒`);
  const segments = manifest?.segments.map(({ startSec, endSec }) => ({ startSec, endSec }))
    ?? splitNativeDeepReadSegments(durationSec, segmentSeconds);
  const segmentPlans = describeSegments(segments);
  const coveredEnd = segments[segments.length - 1]!.endSec;
  const sourceDigest = manifest?.sourceDigest ?? makeSourceDigest(coveredEnd);
  console.info(`[probe] 建单：series=${seriesKey} · 分段 ${segmentPlans.map((s) => `${s.startSec}–${s.endSec}（${s.durationSec}秒/${s.fps}fps）`).join(" / ")} · 原始 JSON 永久保留`);

  const videoPrefix = "manhua-template-learn/tmp/native-deep-read/";
  const videosBefore = new Set(await listGcsObjectNamesByPrefix({
    prefix: videoPrefix, literalPrefix: true, maxResults: 1_000,
  }));

  const inputVideoVersions = manifest ? await verifyNativeProbeManifestMedia(manifest, {
    stat: (gsUri) => statGcsObjectVersion({ gcsUri: gsUri }),
    sign: (gsUri) => signGsUriV4ReadUrl(gsUri),
    probe: async (signedUrl) => {
      const { stdout } = await run("ffprobe", [
        "-v", "error", "-show_entries",
        "format=start_time,duration,size:stream=codec_type,start_time,duration,width,height,avg_frame_rate",
        "-of", "json", "-i", signedUrl,
      ], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 });
      return stdout;
    },
    persist: async ({ segmentIndex, kind, text }) => {
      const objectName = `manhua-template-learn/probes/${seriesKey}/media-metadata/seg${segmentIndex}/${kind}.json`;
      const buffer = Buffer.from(text, "utf8");
      const saved = await uploadBufferToGcsIfAbsent({ bucket, objectName, contentType: "application/json", buffer });
      if (!saved.created) throw new Error("媒体证据对象已存在，禁止覆盖");
      const generation = saved.generation ?? (await statGcsObjectVersion({ gcsUri: `gs://${bucket}/${objectName}` })).generation;
      const evidence = { objectName, generation, bytes: buffer.byteLength, sha256: createHash("sha256").update(buffer).digest("hex") };
      console.info(`[probe] 媒体${kind}证据 ${JSON.stringify(evidence)}`);
      return evidence;
    },
  }) : [];
  const requestAudits: Array<{ objectName: string; requestSha256: string | null; status: string }> = [];
  let requestNumber = 0;
  const persistRequestAudit = async (audit: Parameters<Parameters<typeof createNativeProbeAuditedPost>[1]>[0]) => {
    const objectName = `manhua-template-learn/probes/${seriesKey}/requests/request-${++requestNumber}.json`;
    const saved = await uploadBufferToGcsIfAbsent({
      bucket, objectName, contentType: "application/json",
      buffer: Buffer.from(JSON.stringify({ ...audit, runtimeIdentity, sourceAttestation, sourceDigest, planVersion: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
        segmentSeconds: effectiveSegmentSeconds, requestedSegmentSeconds, videoFps: requestedVideoFps, segmentPlans })),
    });
    if (!saved.created) throw new Error("请求审计对象已存在，拒绝覆盖及发车");
    requestAudits.push({ objectName, requestSha256: audit.requestSha256, status: audit.validation.status });
  };
  const deps = createNativeDeepReadRunnerDeps();
  const transportEvents: Array<Record<string, unknown>> = [];
  const recordTransport = (event: Record<string, unknown>) => { transportEvents.push(event); };
  deps.postVertex = createNativeProbeAuditedPost(deps.postVertex, persistRequestAudit, recordTransport);
  deps.postEvolink = createNativeProbeAuditedPost(deps.postEvolink, persistRequestAudit, recordTransport);
  if (manifest) {
    deps.prepareVideos = async (episode) => {
      if (episode.cacheSourceDigest !== sourceDigest
        || JSON.stringify(episode.segments.map(({ startSec, endSec }) => [startSec, endSec]))
          !== JSON.stringify(segments.map(({ startSec, endSec }) => [startSec, endSec]))) {
        throw new Error("复用分片与当前请求的身份或绝对时间映射不一致，禁止发车");
      }
      return manifest.segments.map((segment, index) => ({
        ...segment,
        bytes: inputVideoVersions[index]!.media.bytes,
        hasAudio: inputVideoVersions[index]!.media.hasAudio,
        temporaryGcs: { bucket: inputVideoVersions[index]!.bucket, objectName: inputVideoVersions[index]!.objectName },
      }));
    };
    deps.remove = async () => { throw new Error("已有 GCS 分片禁止删除"); };
  }

  let runError: unknown;
  let result: Awaited<ReturnType<typeof runManhuaNativeDeepRead>> | undefined;
  let episodeResultEvidence: { objectName: string; bytes: number; sha256: string; generation?: string } | undefined;
  const modelReceipts: Array<Record<string, unknown>> = [];
  try {
    result = await runManhuaNativeDeepRead({
      seriesKey,
      episodeIndex: 1,
      sourceDigest,
      // 用解析器给的 referer，不要自己拼页面 origin——媒体域与播放页域常常不是同一个。
      resolveNodes: async () => {
        if (manifest) throw new Error("已有 GCS 分片模式禁止重新解析或拉取片源");
        return [{ url: mediaUrl, referer: mediaReferer }];
      },
      preservePreparedVideos: Boolean(manifest),
      segments,
      videoFps: requestedVideoFps,
      sourceDurationSec: coveredEnd,
      hintZh: "抖音漫剧完整视听证据探针；按真实镜头、表演、光影、声音和叙事变化记录",
      // 🔓 并发上限：命令行给了就用命令行的，没给就走生产默认（切段 10 / 上传 4 / 扇出 10）。
      mediaCutConcurrency: cutConcurrency,
      mediaUploadConcurrency: uploadConcurrency,
      segmentModelConcurrency: modelConcurrency,
      onModelReceipt: (receipt) => {
        // 回执带时间戳才算得出「峰值同时在飞几发」——P10 的唯一依据。
        modelReceipts.push({
          ...(receipt as unknown as Record<string, unknown>),
          observedAtMs: Date.now(),
        });
      },
    }, deps);
    // 用户已授权完整整集结果与来源元数据永久保存在现有GCS桶，不公开、不含凭证。
    const objectName = `manhua-template-learn/probes/${seriesKey}/episode-result.json`;
    const buffer = Buffer.from(JSON.stringify({
      schemaVersion: 1, runId: seriesKey, sourceDigest, runtimeIdentity, sourceAttestation,
      segmentPlans, result,
    }));
    const saved = await uploadBufferToGcsIfAbsent({
      bucket, objectName, contentType: "application/json", buffer,
    });
    if (!saved.created) throw new Error("完整整集结果对象已存在，禁止覆盖");
    episodeResultEvidence = {
      objectName, bytes: buffer.byteLength,
      sha256: createHash("sha256").update(buffer).digest("hex"), generation: saved.generation,
    };
    console.info(`[probe] 完整整集结果已保存 ${JSON.stringify(episodeResultEvidence)}`);
  } catch (error) {
    runError = error;
  }

  // 已发生付费后，取证读取失败必须进入失败摘要，不能跳过回执与错误台账。
  const collectionErrors: string[] = [];
  const safeList = async (prefix: string, maxResults: number) => {
    try { return await listGcsObjectNamesByPrefix({ prefix, literalPrefix: true, maxResults }); }
    catch (error) { collectionErrors.push(`列取 ${prefix} 失败：${sanitizeSensitiveText(error)}`); return []; }
  };
  const [rawNames, parsedNames, parsedAttemptNames, videosAfter] = await Promise.all([
    safeList(rawPrefix, 100), safeList(parsedPrefix, 100), safeList(parsedAttemptPrefix, 100), safeList(videoPrefix, 1_000),
  ]);
  const temporaryVideoLeaks = manifest ? [] : videosAfter.filter((name) => !videosBefore.has(name));
  const inputVideoChanges: string[] = [];
  const safeFacts = async (names: string[]) => {
    const facts: Array<Awaited<ReturnType<typeof objectFact>>> = [];
    await Promise.all(names.map(async (name) => {
      try { facts.push(await objectFact(name)); }
      catch (error) { collectionErrors.push(`读取 ${name} 失败：${sanitizeSensitiveText(error)}`); }
    }));
    return facts.sort((a, b) => a.objectName.localeCompare(b.objectName));
  };
  const rawFacts = await safeFacts(rawNames);
  const parsedFacts = await safeFacts(parsedNames);
  const parsedAttemptFacts = await safeFacts(parsedAttemptNames);
  const parsedAttemptReconciliations = rawFacts.map((fact) => ({
    rawObjectName: fact.objectName,
    ...reconcileNativeProbeParsedAttempt(fact, parsedAttemptFacts),
  }));
  const rawBySegment = new Map<number, Array<ReturnType<typeof countsOf>>>();
  const parsedBySegment = new Map<number, ReturnType<typeof countsOf>>();

  for (const fact of rawFacts) {
    const segmentIndex = segmentIndexFromName(fact.objectName);
    /**
     * 同段重试会有**多份**原始响应，每份都留下。
     *
     * 🔴 0830 修：旧写法 `set(segmentIndex, ...)` 只留最后一份，等于断言
     * 「最后一发就是被接受的那一发」——而重试存在时这个断言本身不成立
     * （被接受的可能是第 1 发，第 2 发是门禁标记版）。实测 6 片里 3 片重试过，
     * 9 份 raw 对 6 份 parsed，直接误报 `原始响应与解析后证据条数不一致，已阻断`，
     * 把一轮跑对的探针拦在最后一步。
     *
     * 这道对账真正要验的是**消费层有没有偷偷改数据**：
     * 解析后的证据必须等于该段收到过的**某一份**原始响应，而不是特定某一份。
     *
     * 坏 JSON 的失败尝试同样是合法证据（重试梯度的存在理由），不得让它阻断摘要落盘。
     */
    try {
      const counts = countsOf(extractModelJsonFromRawEvidence(fact.payload));
      rawBySegment.set(segmentIndex, [...(rawBySegment.get(segmentIndex) || []), counts]);
    } catch {
      console.error(`[probe] 原始证据不可解析（不阻断摘要）：${fact.objectName}`);
    }
  }
  for (const fact of parsedFacts) {
    const entry = fact.payload && typeof fact.payload === "object"
      ? fact.payload as { raw?: unknown }
      : null;
    if (!entry?.raw || typeof entry.raw !== "object" || Array.isArray(entry.raw)) {
      runError ??= new Error(`解析后证据缺少 raw：${fact.objectName}`);
      continue;
    }
    parsedBySegment.set(segmentIndexFromName(fact.objectName), countsOf(entry.raw as Record<string, unknown>));
  }

  const reconciliations = segments.map((segment, segmentIndex) => {
    const rawAttempts = rawBySegment.get(segmentIndex) || [];
    const parsedCounts = parsedBySegment.get(segmentIndex);
    const parsedKey = parsedCounts ? JSON.stringify(parsedCounts) : null;
    // 命中哪一发也一并报出来：重试段落到第几发上，验收表里要看得见。
    const matchedAttempt = parsedKey === null
      ? -1
      : rawAttempts.findIndex((counts) => JSON.stringify(counts) === parsedKey);
    const matchingFacts = parsedFacts.filter((fact) => segmentIndexFromName(fact.objectName) === segmentIndex);
    const identity = matchingFacts.length === 1 ? reconcileNativeProbeSegment({
      entry: matchingFacts[0]!.payload, rawFacts, seriesKey, sourceDigest,
      segmentIndex, startSec: segment.startSec, endSec: segment.endSec,
    }) : { equal: false, reasonZh: "该分片的解析后证据缺失或不唯一" };
    return {
      segmentIndex,
      attemptCount: rawAttempts.length,
      rawCounts: rawAttempts,
      parsedCounts,
      matchedAttempt: matchedAttempt >= 0 ? matchedAttempt + 1 : null,
      countsEqual: rawAttempts.length > 0 && matchedAttempt >= 0,
      identityAndContentEqual: identity.equal,
      identityReasonZh: identity.reasonZh,
    };
  });
  /**
   * 关键帧抽取（¥0，模型无关）——**按 keyMoments 抽，不再按镜头中点抽**（0830 用户令）。
   *
   * 旧法是「每个 story 镜头取中点一帧」：524 镜就要 240 帧（上限截断），而中点常落在
   * 转场、运动模糊或空镜上——这正是抽帧长期「牛头不对马嘴」的根因。
   * keyMoments 是**看得见画面的模型自己点的秒位**（五类：切镜/情绪/灯光/剧情/音轨），
   * 密度跟着戏走：重镜多点、平淡镜不点、广告零点。帧数因此从 240 降到实际有戏的那些。
   */
  const frameEvidence: Array<{
    segmentIndex: number; atSec: number; kindZh: string; noteZh: string;
    objectName: string; bytes: number;
  }> = [];
  const frameErrors: string[] = [];
  let keyMomentTotal = 0;
  const frameDirectory = await mkdtemp(join(tmpdir(), "native-probe-frames-")).catch((error) => {
    frameErrors.push(`创建抓帧临时目录失败：${sanitizeSensitiveText(error)}`); return null;
  });
  if (frameDirectory) try {
  for (const fact of parsedFacts) {
    const segmentIndex = segmentIndexFromName(fact.objectName);
    if (!fact.payload || typeof fact.payload !== "object") continue;
    const entry = fact.payload as {
      raw?: { keyMoments?: Array<Record<string, unknown>>; shots?: Array<Record<string, unknown>> };
    };
    const moments = objectRows(entry.raw?.keyMoments)
      .filter((row) => Number.isFinite(Number(row.atSec)))
      .sort((a, b) => Number(a.atSec) - Number(b.atSec));
    keyMomentTotal += moments.length;
    for (let i = 0; i < moments.length; i += 1) {
      const moment = moments[i]!;
      const atSec = Math.round(Number(moment.atSec) * 10) / 10;
      const kindZh = String(moment.kindZh ?? "");
      const local = join(frameDirectory, `seg${segmentIndex}-km${i}.jpg`);
      try {
        const sourceSegment = manifest?.segments[segmentIndex];
        if (manifest && !sourceSegment) throw new Error("抓帧缺少对应分片身份");
        const frameUrl = sourceSegment ? await signGsUriV4ReadUrl(sourceSegment.gsUri) : mediaUrl;
        const seekSec = sourceSegment ? atSec - sourceSegment.startSec : atSec;
        if (seekSec < 0 || (sourceSegment && atSec >= sourceSegment.endSec)) {
          throw new Error("抓帧秒位超出对应分片，不改用另一来源猜测");
        }
        await run("ffmpeg", [
          "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
          "-user_agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
          // referer 用片源解析器给的那个，不再写死抖音（真人剧片源用抖音 referer 是错的）
          ...(mediaReferer ? ["-headers", `Referer: ${mediaReferer}\r\n`] : []),
          "-ss", String(seekSec), "-i", frameUrl, "-frames:v", "1", "-q:v", "4", local,
        ], { timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
        const buffer = await readFile(local);
        const objectName = `manhua-template-learn/probes/${seriesKey}/frames/seg${segmentIndex}/`
          + `km${String(i).padStart(3, "0")}-${Math.round(atSec * 10)}ds-${encodeURIComponent(kindZh)}.jpg`;
        await uploadBufferToGcsIfAbsent({ bucket, objectName, contentType: "image/jpeg", buffer });
        frameEvidence.push({
          segmentIndex, atSec, kindZh,
          noteZh: String(moment.noteZh ?? "").slice(0, 120),
          objectName, bytes: buffer.byteLength,
        });
        if (frameEvidence.length % 20 === 0) console.info(`[probe] 阶段：关键帧已抽 ${frameEvidence.length} 帧`);
      } catch (error) {
        frameErrors.push(`seg${segmentIndex}#km${i}@${atSec}s ${sanitizeSensitiveText(error)}`.slice(0, 120));
      } finally {
        await rm(local, { force: true }).catch((error) => {
          frameErrors.push(`清理临时帧失败：${sanitizeSensitiveText(error)}`);
        });
      }
    }
  }
  } finally {
    await rm(frameDirectory, { recursive: true, force: true }).catch((error) => {
      frameErrors.push(`清理抓帧临时目录失败：${sanitizeSensitiveText(error)}`);
    });
  }
  // 复核窗口必须包含模型读取和抓帧读取，不能在抓帧前就宣布源对象没有改变。
  for (const before of inputVideoVersions) {
    try {
      const after = await statGcsObjectVersion({ gcsUri: before.gsUri });
      if (after.generation !== before.generation) inputVideoChanges.push(`${before.gsUri} 版本改变`);
    } catch { inputVideoChanges.push(`${before.gsUri} 无法复核（可能丢失）`); }
  }
  console.info(`[probe] 阶段：重点时刻共 ${keyMomentTotal} 条，按此抽帧`);
  console.info(`[probe] 阶段：关键帧抽取完成 ${frameEvidence.length} 帧，失败 ${frameErrors.length}`);

  /* ─────────── 失败台账：每条失败给全文原因，不许只留「截断」「error」 ─────────── */
  const failures = modelReceipts
    .filter((row) => String(row.status || "") === "failed")
    .map((row) => {
      const providerError = (row.providerError ?? {}) as Record<string, unknown>;
      const chunkIndex = Number(row.chunkIndex);
      return {
        段: Number.isInteger(chunkIndex) ? `第${chunkIndex + 1}段` : "整集/装配层",
        stage: String(row.stage || ""),
        route: String(row.route || ""),
        第几次尝试: row.attemptNumber ?? null,
        温度: row.temperature ?? null,
        finishReason: row.finishReason ?? null,
        httpStatus: providerError.httpStatus ?? null,
        上游错误正文: providerError.responseBody ?? providerError.message ?? null,
        providerRequestId: row.providerRequestId ?? null,
        失败原因全文: sanitizeSensitiveText(String(row.errorZh || "")) || "（回执未带 errorZh，见上游错误正文）",
        用量: {
          inputTokens: row.inputTokens ?? null,
          outputTokens: row.outputTokens ?? null,
          reasoningTokens: row.reasoningTokens ?? null,
          audioInputTokens: row.audioInputTokens ?? null,
        },
        本次计费人民币: row.priceEquivalentCny ?? null,
      };
    });
  if (failures.length) {
    console.error(`[probe] 失败台账 ${failures.length} 条（逐条全文）：`);
    for (const row of failures) console.error(JSON.stringify(row, null, 2));
  }

  /* ─────────── P2–P9 验收：全部读已落盘的证据，不读 result 上的私有字段 ─────────── */
  const parsedCards = parsedFacts.flatMap((fact) => {
    const card = (fact.payload as { raw?: Record<string, unknown> } | null)?.raw;
    return card && typeof card === "object" && !Array.isArray(card)
      ? [{ segmentIndex: segmentIndexFromName(fact.objectName), card }] : [];
  }).sort((a, b) => a.segmentIndex - b.segmentIndex);

  let unreadableEnvelopes = 0;
  const thoughtLeaks = rawFacts.filter((fact) => {
    try { return nativeProbeHasThoughtLeak(fact.payload); }
    catch { unreadableEnvelopes += 1; return false; }
  }).length;
  record("P2", "思考未混进输出 JSON",
    rawFacts.length === 0 ? "not_observed" : thoughtLeaks || unreadableEnvelopes ? "fail" : "pass",
    rawFacts.length === 0 ? "没有可读的原始响应" : `${rawFacts.length} 份原始响应中残留 ${thoughtLeaks} 处，无法解析 ${unreadableEnvelopes} 份`);

  const advisoriesDetail: Array<{ 段: string; code: string; detailZh: string }> = [];
  const truncatedSegments: string[] = [];
  const overlong: string[] = [];
  const audioThin: string[] = [];
  const tailSegments: string[] = [];
  // 自定义短片不能全被叫作尾片；已有不规则清单只据实际最长片核对最后一片。
  const nominalSegmentSeconds = effectiveSegmentSeconds ?? Math.max(...segmentPlans.map((row) => row.durationSec));
  for (const { segmentIndex, card } of parsedCards) {
    for (const row of objectRows(card.advisories)) {
      advisoriesDetail.push({
        段: `第${segmentIndex + 1}段`,
        code: String(row.code ?? ""),
        detailZh: String(row.detailZh ?? ""),
      });
    }
    if (card.truncated === true) truncatedSegments.push(`第${segmentIndex + 1}段`);
    const shots = objectRows(card.shots);
    for (const shot of shots) {
      const len = Number(shot.endSec) - Number(shot.startSec);
      if (shot.evidenceRole !== "non_story_ad" && Number.isFinite(len) && len > NATIVE_DEEP_READ_SHOT_LONG_TAKE_REJECT_SEC) {
        overlong.push(`第${segmentIndex + 1}段 ${len.toFixed(1)}秒`);
      }
    }
    const span = segments[segmentIndex];
    const lenSec = span ? span.endSec - span.startSec : 0;
    const tracks = objectRows(card.audioResolution).flatMap((chunk) => {
      const analysis = (chunk as { analysis?: { audioTrack?: unknown[] } }).analysis;
      return Array.isArray(analysis?.audioTrack) ? analysis!.audioTrack! : [];
    });
    const audioFloor = resolveNativeDeepReadSegmentFloors(lenSec).minAudioTracks;
    if (lenSec > 0 && tracks.length < audioFloor) audioThin.push(`第${segmentIndex + 1}段 ${tracks.length}/${audioFloor} 段`);
    if (segmentIndex === segments.length - 1 && lenSec > 0 && lenSec < nominalSegmentSeconds - 1e-6) {
      tailSegments.push(`第${segmentIndex + 1}段 ${Math.round(lenSec)}秒 ${shots.length}镜`);
    }
  }

  record("P3", "advisory 通路可读", advisoriesDetail.length ? "pass" : "not_observed",
    advisoriesDetail.length ? `${advisoriesDetail.length} 条：${advisoriesDetail.map((r) => `${r.段}${r.code}`).join("、")}` : "本轮无任何段产生 advisory");
  record("P4", "截断段保留并标记", truncatedSegments.length ? "pass" : "not_observed",
    truncatedSegments.length ? `已入库并标记：${truncatedSegments.join("、")}` : "本轮未发生 MAX_TOKENS 截断");
  record("P5", "音轨低于地板不再拒收", audioThin.length ? "pass" : "not_observed",
    audioThin.length ? `低于地板但已入库：${audioThin.join("、")}` : "本轮无低于地板的段");
  record("P6", "30 秒证据上限（按生产 10% 容差验收）",
    parsedCards.length === 0 ? "not_observed" : overlong.length === 0 ? "pass" : "fail",
    parsedCards.length === 0 ? "没有可检段卡" : overlong.length === 0
      ? `${parsedCards.length} 段全部无超长证据段` : `超长 ${overlong.length} 条：${overlong.join("、")}`);
  record("P7", "尾片豁免", tailSegments.length ? "pass" : "not_observed",
    tailSegments.length ? `尾片已入库：${tailSegments.join("、")}` : "本轮分片被整除，无尾片");

  const attemptsBySegment = new Map<number, number>();
  for (const receipt of modelReceipts) {
    if (String(receipt.stage || "") !== "visual_model") continue;
    if (String(receipt.status || "") !== "started") continue;
    const chunkIndex = Number(receipt.chunkIndex);
    if (Number.isInteger(chunkIndex)) attemptsBySegment.set(chunkIndex, (attemptsBySegment.get(chunkIndex) || 0) + 1);
  }
  const retried = Array.from(attemptsBySegment.entries()).filter(([, n]) => n > 1);
  // 🔧 P8 口径已订正（v11）。旧版写的是「门禁类不再触发重试，>1 发即 FAIL」——
  // 那是 v10「门禁转 advisory」时代的口径。v11 用户拍板改成**门禁贴标记＋照常重试**
  // （「我就是要让所有的产出都进 GLM」），重试是**设计行为**，不是缺陷。
  // 拿旧口径跑这一轮，会把正常行为判成 FAIL——花一轮钱换一个错结论。
  // 新口径：重试本身只报不判；只有「三档温度用尽仍然没有落地的段」才是真失败。
  const landedSegments = new Set(parsedCards.map((row) => row.segmentIndex));
  const segmentDecisions = parsedCards.map(({ segmentIndex, card }) => {
    const span = segments[segmentIndex];
    if (!span) return { segmentIndex, accepted: false, reasonZh: "证据段号不在本轮清单中" };
    try {
      const entry = parsedFacts.find((fact) => segmentIndexFromName(fact.objectName) === segmentIndex)?.payload as { hasAudio?: boolean } | undefined;
      if (typeof entry?.hasAudio !== "boolean") throw new Error("已落盘证据缺少明确音轨标记");
      const decision = evaluateNativeDeepReadSegmentAcceptance({
        episodeIndex: 1, segmentIndex, ...span, hasAudio: entry.hasAudio,
        raw: card, truncated: card.truncated === true,
      });
      const shots = (Array.isArray(card.shots) ? card.shots : []) as Array<{ startSec: number; endSec: number }>;
      return {
        segmentIndex, accepted: !decision.retry,
        reasonZh: decision.advisories.map((row) => row.detailZh).join("；"),
        coverage: measureNativeDeepReadSegmentCoverage({ shots, ...span }),
      };
    } catch (error) {
      return { segmentIndex, accepted: false, reasonZh: sanitizeSensitiveText(error) };
    }
  });
  // 0830 审查修正：旧判据只看「发满三档还没落地」的段，会漏掉两类真失败——
  // ① 关闭式失败（schema 错误直接抛，不进重试，发数 <3）
  // ② 压根没发出 started 回执的段（切段/上传阶段就挂了，attemptsBySegment 里没有它）
  // 判据改成对**全量段**遍历「有没有落地」，attempts 只进说明文字。
  const exhausted = segments
    .map((_, index) => index)
    .filter((index) => !landedSegments.has(index))
    .map((index) => {
      const attempts = attemptsBySegment.get(index) || 0;
      return attempts === 0
        ? `第${index + 1}段未发出任何模型请求即失败（切段/上传阶段）`
        : `第${index + 1}段发了${attempts}发仍未落地`;
    });
  const rejectedLanded = segmentDecisions.filter((row) => !row.accepted);
  record("P8", "重试收敛：全部落地并通过当前生产判据",
    modelReceipts.length === 0 ? "not_observed" : exhausted.length === 0 && rejectedLanded.length === 0 ? "pass" : "fail",
    modelReceipts.length === 0 ? "没有收到任何模型回执（回执通路可疑）"
      : rejectedLanded.length > 0 ? rejectedLanded.map((row) => `第${row.segmentIndex + 1}段：${row.reasonZh}`).join("；")
      : exhausted.length > 0 ? exhausted.join("、")
        : retried.length === 0
          ? `${attemptsBySegment.size} 段全部一发过，零重试`
          : `${attemptsBySegment.size} 段全部落地；其中发生重试：`
            + `${retried.map(([i, n]) => `第${i + 1}段×${n}发`).join("、")}`
            + `（温度梯度 [${NATIVE_DEEP_READ_RETRY_TEMPERATURES.join(", ")}]）`);

  // P10仅统计真实HTTP调用区间；生产回执包括审计/取证等待，不能拿来冒充网络并发。
  const concurrency = measureNativeProbeConcurrency(transportEvents);
  const peakInFlight = concurrency.peak;
  // 0830 审查修正：期望值必须扣掉缓存命中的段。旧版拿 min(cap, 总片数) 当期望，
  // 缓存命中多时必判 FAIL，而它自己的说明文字却写着「属正常」——文案与判定打架，
  // 还会把整体 acceptanceStatus 拉成 failed。改成按**实际发出请求的段数**算期望。
  // 0830 二次修正：期望仍按**总片数**算，否则「运行器只派发了 2/8 片」这种真 bug
  // 会让期望自动降到 2 而判 PASS——扇出探针从此测不出「该发的没发」。
  // 派发不全时降级为 not_observed 并把两个数字都打出来，不冒充通过也不误报失败。
  const dispatchedSegments = attemptsBySegment.size;
  const expectedFanOut = Math.min(
    modelConcurrency || NATIVE_DEEP_READ_SEGMENT_MODEL_MAX_CONCURRENCY,
    segments.length,
  );
  const fanOutStatus: CheckStatus = concurrency.errorsZh.length > 0 ? "fail"
    : dispatchedSegments === 0 ? "not_observed"
    : dispatchedSegments < segments.length ? "not_observed"
      : peakInFlight === expectedFanOut ? "pass" : "fail";
  record("P10", "模型扇出真并发（不是 4 路批次串行）", fanOutStatus,
    `峰值同时在飞 ${peakInFlight} 发 · 期望 ${expectedFanOut} 发`
    + ` · 实际发出请求 ${dispatchedSegments} 段 / 本集 ${segments.length} 片`
    + ` · 回执错误 ${concurrency.errorsZh.join("；") || "无"}`
    + (dispatchedSegments === 0 ? "（未发出任何请求，无法判定）"
      : dispatchedSegments < segments.length ? "（派发不全，本项不下结论）" : ""));
  record("P9", manifest ? "已有分片保留且版本不变" : "临时视频零残留",
    temporaryVideoLeaks.length === 0 && inputVideoChanges.length === 0 ? "pass" : "fail",
    manifest ? `复核 ${inputVideoVersions.length} 个，异常 ${inputVideoChanges.length} 个`
      : `残留 ${temporaryVideoLeaks.length} 个`);

  if (requestAudits.some((audit) => audit.status === "fail")) {
    const parameterCheck = checks.find((check) => check.id === "P1")!;
    parameterCheck.status = "fail";
    parameterCheck.actualZh += "；实际发送前的请求审计发现参数漂移，已阻断对应调用";
  }
  const evidenceFailures: string[] = [];
  evidenceFailures.push(...collectionErrors);
  for (const row of parsedAttemptReconciliations) {
    if (row.status === "failed") evidenceFailures.push(`${row.rawObjectName}：${row.reasonZh}`);
  }
  if (rawFacts.length < segments.length || parsedFacts.length !== segments.length) evidenceFailures.push("原始或解析后证据数量不完整");
  if (reconciliations.some((row) => !row.identityAndContentEqual)) evidenceFailures.push("解析后证据无法按准确对象、身份及内容对应原始响应");
  if (frameErrors.length) evidenceFailures.push(`抓帧失败 ${frameErrors.length} 项`);
  if (result?.droppedCount) evidenceFailures.push(`消费层丢弃 ${result.droppedCount} 项证据`);
  const verdict = summarizeNativeProbeChecks(checks, { runFailed: Boolean(runError) || evidenceFailures.length > 0 });
  const { acceptanceStatus, idsComplete, failCount, notObservedCount } = verdict;
  console.info(`[probe] 验收结论 ${acceptanceStatus}：pass ${verdict.passCount} · fail ${failCount} · 未观察 ${notObservedCount}`);

  const summary = {
    schemaVersion: 3,
    acceptanceStatus,
    checks,
    idsComplete,
    failCount,
    notObservedCount,
    exitCode: verdict.exitCode,
    evidenceFailures,
    runtimeIdentity,
    sourceAttestation,
    requestAudits,
    episodeResultEvidence,
    transportEvents,
    failures,
    modelReceipts,
    collectionErrors,
    failureCount: failures.length,
    advisoriesDetail,
    episodeAdvisoriesDetail: ((result as { advisories?: Array<Record<string, unknown>> } | undefined)?.advisories ?? [])
      .map((row) => ({
        段: Number.isInteger(row.segmentIndex) ? `第${Number(row.segmentIndex) + 1}段` : "整集",
        code: String(row.code ?? ""),
        detailZh: String(row.detailZh ?? ""),
      })),
    planVersion: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
    runId: seriesKey,
    sourceDigest,
    sourceVideoId: manifest ? undefined : VIDEO_ID || PAGE_URL,
    sourceDurationSec: durationSec,
    segmentSeconds: effectiveSegmentSeconds,
    requestedSegmentSeconds,
    videoFps: requestedVideoFps,
    segmentPlans,
    ranges: segments.map((s) => [s.startSec, s.endSec]),
    status: runError ? "failed" : "completed",
    error: runError ? sanitizeSensitiveText(runError) : undefined,
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
    parsedAttemptEvidence: parsedAttemptFacts.map(({ objectName, bytes, sha256 }) => ({ objectName, bytes, sha256 })),
    frameEvidence,
    frameErrors: frameErrors.length ? frameErrors : undefined,
    videoRetention: {
      policy: manifest ? "preserve_existing" : "delete_on_settle",
      maximumHours: manifest ? undefined : 24,
      leakedObjectNames: temporaryVideoLeaks,
      inputVideoVersions,
      inputVideoChanges,
    },
    reconciliations,
    parsedAttemptReconciliations,
    segmentDecisions,
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
  const unreconciled = reconciliations.filter((row) => !row.identityAndContentEqual);
  if (unreconciled.length > 0) {
    // 写清是哪几段、各有几发、解析后是多少——旧版只丢一句话，现场无从判断。
    const detail = unreconciled
      .map((row) => `第${row.segmentIndex + 1}段(${row.attemptCount}发)：${row.identityReasonZh}`)
      .join("、");
    throw new Error(
      `解析后证据对不上该段任何一发原始响应，已阻断：${detail}`,
    );
  }
  // 完整摘要必须先落盘；失败或未观察齐全绝不能再以成功退出。
  process.exitCode = verdict.exitCode;
}

main().catch((error) => {
  console.error(`[probe] 失败：${sanitizeSensitiveText(error)}`);
  console.error(`[probe] 根因链：${JSON.stringify(describeErrorChain(error))}`);
  process.exitCode = 1;
});
