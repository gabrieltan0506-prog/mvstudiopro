/**
 * 漫剧节奏模板 · 单集或合集学习。
 * 每轮按剧集顺序采（短合集有几集采几集；长合集约 8–10）→ 远程语音+高密度抽帧+读帧；
 * 学 1 集即可出草版提案并入库（2026-08-11 拍板；约 16 集更准）。
 */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  buildAdaptiveFramePlan,
  speechRegionsFromSilenceDetectLog,
} from "../../shared/manhuaTemplateLearnFramePlan.js";
import {
  applyFrameVisionToProposal,
  resolveManhuaTemplateLearnLlmProvider,
  selectFramesForVisionAnalysis,
  type ManhuaTemplateLearnLlmProvider,
} from "../../shared/manhuaTemplateLearnFrameVision.js";
import {
  MANHUA_LEARN_ANALYSIS_DRAFT_MIN,
  MANHUA_LEARN_ANALYSIS_MIN,
  MANHUA_LEARN_ANALYSIS_TARGET,
  MANHUA_LEARN_BATCH_DEFAULT,
  MANHUA_LEARN_CHECKPOINT_SEC,
  MANHUA_LEARN_EPISODE_RETRY_MAX,
  MANHUA_LEARN_MAX_DURATION_SEC,
  canEmitManhuaLearnAnalysis,
  clampManhuaLearnBatchSize,
  isManhuaLearnListComplete,
  classifyManhuaLearnTitle,
  isManhuaLearnEpisodeComplete,
  mergeEpisodeDigestsIntoProposal,
  mergeManhuaLearnChunkIntoDigest,
  pickNextEpisodeIndexes,
  pickManhuaLearnEpisodeGapMs,
  pickRetrySkippedEpisodeIndexes,
  type ManhuaLearnEpisodeChunk,
  type ManhuaLearnEpisodeDigest,
  type ManhuaLearnSeriesProgress,
} from "../../shared/manhuaTemplateLearnSeries.js";
import {
  isManhuaCompilationDuration,
  normalizeManhuaSeriesTitle,
  placeSingleSourceInExistingSeries,
  type ManhuaLearnListedSource,
} from "../../shared/manhuaLearnSeriesIdentity.js";
import {
  MANHUA_LEARN_STAGE,
  formatManhuaLearnEpisodeDetail,
  manhuaLearnStageLabelZh,
} from "../../shared/manhuaTemplateLearnPipeline.js";
import {
  nextManhuaLearnVideoSegment,
} from "../../shared/manhuaLearnVideoSegments.js";
import {
  parseManhuaViralTemplateCard,
  type ManhuaViralTemplateCard,
  type ManhuaViralTemplateLane,
} from "../../shared/manhuaViralTemplateBank.js";
import {
  analyzeManhuaDramaAudioWithGemini,
  isGeminiAudioAvailable,
  type ManhuaDramaAudioScanResult,
} from "../gemini-audio.js";
import { analyzeManhuaTemplateFramesWithTerra } from "../manhuaTemplateFrameVision.js";
import { assertManhuaPreviewFramesHaveMotion } from "./manhuaFramePreviewGuard.js";
import {
  extractRemoteManhuaAudio,
  extractRemoteManhuaDenseFrames,
  type ManhuaRemoteMediaSource,
} from "./manhuaRemoteMediaSampler.js";
import {
  downloadGcsObject,
  listGcsObjectNamesByPrefix,
  uploadBufferToGcs,
  signGsUriV4ReadUrl,
} from "./gcs.js";
import {
  buildDouyinMixCandidateUrls,
  isDouyinHostUrl,
  isDouyinSingleVideoUrl,
  normalizeDouyinVideoUrl,
  listedSingleEpisodeFromUrl,
  mapManhuaLearnFetchError,
  MANHUA_LEARN_FETCH_ERR,
} from "../../shared/manhuaLearnYtdlp.js";
import {
  extractDouyinMixIdFromUrl,
  extractDouyinVideoIdFromUrl,
} from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  fetchDouyinAwemeDetailViaWebApi,
  listDouyinAwemePlaybackUrlsViaWebApi,
  listDouyinMixEpisodesViaWebApi,
} from "./manhuaLearnDouyinWebApi.js";
import {
  assertYtdlpCookieReadyForUrl,
  execYtdlpJson,
  openYtdlpCookieSession,
  ytdlpCookieCandidateCount,
} from "./manhuaLearnYtdlpRuntime.js";

const execFileAsync = promisify(execFile);

export type ManhuaTemplateLearnInput = {
  url?: string;
  /** Platform 素材分析手动导入的本人 GCS 对象；入口和 worker 均校验归属。 */
  gcsUri?: string;
  fileName?: string;
  title?: string;
  mixId?: string;
  rank?: number;
  /** 本轮采几集：8–10 */
  batchSize?: number;
  /** 只从远程媒体流重抽代表静帧；不重跑语音、视觉模型或系列分析。 */
  refreshPreviewFrames?: boolean;
  /** 只重试此前因来源受限暂跳的集（列表已重新拉取，播放地址随之刷新）。 */
  retrySkippedEpisodes?: boolean;
  learnLlm?: ManhuaTemplateLearnLlmProvider;
  onProgress?: (phase: string, detailZh: string) => void | Promise<void>;
  /** 每个分片落盘后把该集摘要同步进 Job output，供网页即时甄别。 */
  onEpisodeCheckpoint?: (preview: ManhuaLearnDigestPreview) => void | Promise<void>;
  /** 服务端持久控制：停止整部剧或跳过当前集。 */
  checkControl?: () => Promise<"continue" | "cancel" | "skip">;
  abortSignal?: AbortSignal;
};

export type ManhuaLearnDigestPreview = {
  episodeIndex: number;
  title: string;
  hookNoteZh: string;
  transcriptPreview: string;
  durationSec: number;
  learnedThroughSec?: number;
  complete?: boolean;
  previewFrameUrls?: string[];
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
};

export type ManhuaTemplateLearnResult = {
  seriesKey: string;
  analysisReady: boolean;
  learnedCount: number;
  analysisMin: number;
  analysisTarget: number;
  batchLearned: number;
  batchIndexes: number[];
  listedEpisodeCount: number;
  /** 因来源受限暂跳的集号（不计入已学；可用「重试暂跳集」在地址刷新后重试） */
  skippedEpisodeIndexes?: number[];
  /** 网页即时展示：已学分集摘要（不落视频，只留结构化结果和代表帧） */
  digestsPreview: ManhuaLearnDigestPreview[];
  /** 与飙升榜同源：类别 / 题材标签（前台中文） */
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
  /** 仅 analysisReady 时有值 */
  proposal: ManhuaViralTemplateCard | null;
  proposalGcsUri: string | null;
  proposalReadUrl?: string;
  visionFilled: boolean;
  messageZh: string;
  workId: string;
};

/** 读帧 provenance 跨集聚合（attempted/success 按块累计；model 取最近一集） */
function aggregateDigestFrameVision(
  digests: ManhuaLearnEpisodeDigest[],
): NonNullable<ManhuaViralTemplateCard["provenance"]>["frameVision"] {
  const rows = digests
    .map((d) => d.frameVision)
    .filter(Boolean) as NonNullable<ManhuaLearnEpisodeDigest["frameVision"]>[];
  if (!rows.length) return undefined;
  const last = rows[rows.length - 1];
  return {
    provider: last.provider,
    model: last.model,
    attemptedChunks: rows.reduce((a, r) => a + r.attemptedChunks, 0),
    successChunks: rows.reduce((a, r) => a + r.successChunks, 0),
  };
}

function toDigestPreview(d: ManhuaLearnEpisodeDigest): ManhuaLearnDigestPreview {
  const previewFrameUrls = (d.previewFrameGcsUris || []).flatMap((uri) => {
    try {
      return [signGsUriV4ReadUrl(uri, 7 * 24 * 3600)];
    } catch {
      return [];
    }
  }).slice(0, 3);
  return {
    episodeIndex: d.episodeIndex,
    title: d.title,
    hookNoteZh: d.hookNoteZh,
    transcriptPreview: d.transcriptPreview.slice(0, 800),
    durationSec: d.durationSec,
    learnedThroughSec: d.learnedThroughSec,
    complete: isManhuaLearnEpisodeComplete(d),
    previewFrameUrls: previewFrameUrls.length ? previewFrameUrls : undefined,
    categoryLabelZh: d.categoryLabelZh,
    tagLabelsZh: d.tagLabelsZh,
  };
}

/** 供网页查询合集学习进度与分集摘要 */
export async function getManhuaSeriesLearnSnapshot(seriesKey: string): Promise<{
  progress: ManhuaLearnSeriesProgress | null;
  digestsPreview: ManhuaLearnDigestPreview[];
  /** 已整集学完的数量（digestsPreview 含未学完的检查点，勿拿其长度当完成数） */
  completedCount: number;
  analysisReady: boolean;
  proposal: ManhuaViralTemplateCard | null;
}> {
  const key = String(seriesKey || "").trim();
  if (!key) {
    return { progress: null, digestsPreview: [], completedCount: 0, analysisReady: false, proposal: null };
  }
  const progress = await loadSeriesProgress(key);
  if (progress) {
    // 存量被占位词写脏的 titleHint，读路径也洗（不等下次学习才修复面板显示）
    progress.titleHint = cleanManhuaLearnTitle(progress.titleHint) || "未命名合集";
  }
  const digestsAll = await loadAllDigests(key);
  const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
  const digestsPreview = digestsAll.map(toDigestPreview);
  const completeIndexes = digests.map((d) => d.episodeIndex);
  // 集合包含判定（审查必须修11）：只认可靠索引集合。存量 progress 无
  // listedEpisodeIndexes 时不做总数比较——历史接口抖动曾把 count 缩成 1，
  // 「learned>=count」会把伪单集判成合集学完；旧数据只走 4/16 集门槛。
  const allListedComplete = progress
    ? isManhuaLearnListComplete(progress.listedEpisodeIndexes, completeIndexes)
    : false;
  const analysisReady = canEmitManhuaLearnAnalysis(digests.length, { allListedComplete });
  let proposal: ManhuaViralTemplateCard | null = null;
  if (analysisReady && progress) {
    // 审查收紧：快照只回真实落盘的 proposed 提案（seriesKey 已带 provider 命名空间）。
    // 不再返回内存重建的启发式卡——批准端也只认落盘，杜绝「凭 env 伪造版本」整条链。
    const fromGcs = await readJsonGcs<ManhuaViralTemplateCard>(
      `manhua-template-learn/proposals/tpl_series_${key}.json`,
    );
    if (fromGcs && fromGcs.status === "proposed") {
      proposal = parseManhuaViralTemplateCard(fromGcs);
    }
    // status=approved：已入库，不再给可批准的提案（防重复批准循环）
  }
  return { progress, digestsPreview, completedCount: digests.length, analysisReady, proposal };
}

function gcsBucketHint(): string {
  return String(
    process.env.GCS_BUCKET_NAME
      || process.env.GROWTH_CAMP_GCS_BUCKET
      || process.env.VERTEX_GCS_BUCKET
      || process.env.GOOGLE_CLOUD_STORAGE_BUCKET
      || "mv-studio-pro-vertex-video-temp",
  ).trim();
}

/**
 * 前端占位词不算剧名：旧版贴链接路径把「贴链接学习」当 title 传上来，
 * 会把详情接口回填的真剧名压住，且已写进存量 progress——这里统一洗掉。
 */
const MANHUA_LEARN_TITLE_PLACEHOLDERS = new Set(["未命名合集", "贴链接学习"]);

function cleanManhuaLearnTitle(raw?: string | null): string {
  const t = String(raw || "").trim();
  return MANHUA_LEARN_TITLE_PLACEHOLDERS.has(t) ? "" : t;
}

/**
 * 剥外层书名号（mix_name 常自带《》，进度行再包一层会变《《》》）。
 * 只在整体被一对《》包裹且内部不再含书名号时才剥——单侧剥会把
 * 「XXX《动态漫画》」「《XX》第二季」这类高频命名剥坏并写脏进度。
 */
function stripBookTitleMarks(raw?: string | null): string {
  const t = String(raw || "").trim();
  const m = /^《(.*)》$/.exec(t);
  return m && !m[1].includes("《") && !m[1].includes("》") ? m[1].trim() : t;
}

/**
 * A/B 隔离（审查必须修）：provider 进 seriesKey 命名空间。
 * GPT 档 key 与存量完全兼容；Claude 档独立 key = 独立 digest/progress/提案存储，
 * 两档互不复用互不覆盖（Claude 轮从头下片读帧，实验组干净），
 * 也不再需要 _claude 后缀 hack（快照/批准按 key 天然取对版本）。
 */
function seriesKeyFrom(input: {
  url: string;
  mixId?: string;
  title?: string;
  learnLlm?: "gpt" | "claude";
}): string {
  const ns = input.learnLlm === "claude" ? ":claude" : "";
  const mix = String(input.mixId || "").trim();
  if (mix) return createHash("sha1").update(`mix:${mix}${ns}`).digest("hex").slice(0, 12);
  return createHash("sha1")
    .update(`${String(input.url || input.title || "series")}${ns}`)
    .digest("hex")
    .slice(0, 12);
}

function seriesKeyFromProgressObjectName(name: string): string {
  const match = /^manhua-template-learn\/series\/([^/]+)\/progress\.json$/.exec(name);
  return String(match?.[1] || "").trim();
}

/**
 * 大合集和分集可能是不同 URL / mixId；先按真实剧名复用已有系列。
 * 列表或 progress 读取异常时 fail-closed，避免因一次 GCS 抖动建出重复剧。
 */
async function resolveManhuaSeriesKey(input: {
  sourceIdentity: string;
  mixId?: string;
  title?: string;
  learnLlm: ManhuaTemplateLearnLlmProvider;
}): Promise<string> {
  const normalizedTitle = normalizeManhuaSeriesTitle(input.title);
  if (normalizedTitle) {
    const names = await listGcsObjectNamesByPrefix({
      prefix: "manhua-template-learn/series/",
      maxResults: 500,
    });
    for (const name of names) {
      const existingKey = seriesKeyFromProgressObjectName(name);
      if (!existingKey) continue;
      const read = await readJsonGcsDetailed<ManhuaLearnSeriesProgress>(name);
      if (read.status === "error") {
        throw new Error("无法核对已有同名剧进度，未创建重复剧，请稍后重试");
      }
      if (read.status !== "found") continue;
      const existingProvider = read.value.learnLlm || "gpt";
      if (existingProvider !== input.learnLlm) continue;
      if (normalizeManhuaSeriesTitle(read.value.titleHint) === normalizedTitle) {
        return read.value.seriesKey || existingKey;
      }
    }
    // 旧数据未匹配时，新剧改用「剧名+模型档」的确定 key：
    // 同名大合集/分集即使 URL、mixId 不同，并发首次学习也落在同一系列。
    const ns = input.learnLlm === "claude" ? ":claude" : "";
    return createHash("sha1")
      .update(`title:${normalizedTitle}${ns}`)
      .digest("hex")
      .slice(0, 12);
  }
  return seriesKeyFrom({
    url: input.sourceIdentity,
    mixId: input.mixId,
    title: input.title,
    learnLlm: input.learnLlm,
  });
}

function guessLane(text: string): ManhuaViralTemplateLane {
  const t = text;
  if (/种田|边关|古言|开荒/.test(t)) return "古言种田";
  if (/系统|吞噬|进化|觉醒/.test(t)) return "系统觉醒";
  if (/电竞|游戏|操作|竞技/.test(t)) return "游戏竞技";
  if (/甜宠|恋爱|霸总/.test(t)) return "甜宠";
  if (/悬疑|权谋|宫斗/.test(t)) return "悬疑权谋";
  if (/沙雕|搞笑/.test(t)) return "搞笑沙雕";
  return "爽文逆袭";
}

function episodeObjectName(seriesKey: string, episodeIndex: number): string {
  return `manhua-template-learn/series/${seriesKey}/episodes/ep_${String(episodeIndex).padStart(4, "0")}.json`;
}

async function silenceDetectLog(audioPath: string): Promise<string> {
  try {
    const { stderr } = await execFileAsync("ffmpeg", [
      "-i",
      audioPath,
      "-af",
      "silencedetect=noise=-32dB:d=0.45",
      "-f",
      "null",
      "-",
    ]);
    return String(stderr || "");
  } catch (e: unknown) {
    const err = e as { stderr?: string };
    return String(err.stderr || "");
  }
}

async function withYtdlpCookieCandidates<T>(
  url: string,
  run: (cookieArgs: string[], candidateIndex: number) => Promise<T>,
): Promise<T> {
  const attemptCount = isDouyinHostUrl(url) ? ytdlpCookieCandidateCount() : 1;
  let lastError: unknown = new Error(MANHUA_LEARN_FETCH_ERR.downloadFailed);
  for (let candidateIndex = 0; candidateIndex < attemptCount; candidateIndex++) {
    const cookies = await openYtdlpCookieSession(candidateIndex);
    try {
      return await run(cookies.args, candidateIndex);
    } catch (error) {
      lastError = error;
      if (candidateIndex + 1 < attemptCount) {
        console.warn(
          "[manhuaTemplateLearn] yt-dlp cookie candidate failed, trying next:",
          `candidate=${candidateIndex + 1}/${attemptCount}`,
          mapManhuaLearnFetchError(error),
        );
      }
    } finally {
      await cookies.cleanup();
    }
  }
  throw lastError;
}

type ListedEpisode = ManhuaLearnListedSource;

/**
 * 分集远程媒体源状态：只消费官方播放地址或本人 GCS 签名地址；
 * Douyin 页面 URL 不当作视频流，避免抽到「请前往 App 观看」限制页。
 */
type EpisodeSourceState = {
  playbackUrl?: string;
  playbackDead?: boolean;
  playbackRefreshAttempted?: boolean;
  playbackRefreshUrls?: string[];
  resolvedStreamUrl?: string;
  triedStreamUrls?: string[];
};

function episodeDownloadSource(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): { url: string; viaPlayback: boolean } {
  const playbackUrl = state.playbackUrl || ep.playbackUrl;
  if (!state.playbackDead && playbackUrl) {
    return { url: playbackUrl, viaPlayback: true };
  }
  return { url: ep.url, viaPlayback: false };
}

const DOUYIN_PLAYBACK_REFERER = "https://www.douyin.com/";

/** 官方播放地址 / 本人 GCS 签名地址直连探测时长。 */
async function ffprobeRemoteDuration(url: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "ffprobe",
      [
      "-v",
      "error",
      "-user_agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "-headers",
      `Referer: ${DOUYIN_PLAYBACK_REFERER}\r\n`,
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        url,
      ],
      // 挂死一个坏 CDN 节点不能拖死整集：20s 拿不到就回退页面探测
      { timeout: 20_000 },
    ));
  } catch {
    // 审查必须修：execFile 失败的 Error.message 含完整命令行（即含签名播放地址），
    // 原样抛出会被上层 warn 打进 Fly 持久日志——收敛成固定文案，地址只留内存
    throw new Error("播放地址探测失败（超时或节点拒绝）");
  }
  const n = Number(String(stdout).trim());
  if (!Number.isFinite(n) || n <= 0) throw new Error("播放地址无法读取时长");
  return n;
}

/** 时长可读不代表含音轨；学习前必须同时确认音频与视频流存在。 */
async function ffprobeRemoteMedia(url: string): Promise<number> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-user_agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "-headers",
        `Referer: ${DOUYIN_PLAYBACK_REFERER}\r\n`,
        "-show_entries",
        "format=duration:stream=codec_type",
        "-of",
        "json",
        url,
      ],
      { timeout: 20_000 },
    ));
  } catch {
    throw new Error("播放地址探测失败（超时或节点拒绝）");
  }
  let parsed: { format?: { duration?: string }; streams?: Array<{ codec_type?: string }> };
  try {
    parsed = JSON.parse(String(stdout || "{}"));
  } catch {
    throw new Error("播放地址返回了无效媒体信息");
  }
  const durationSec = Number(parsed.format?.duration);
  const streamTypes = new Set((parsed.streams || []).map((stream) => stream.codec_type));
  if (!Number.isFinite(durationSec) || durationSec <= 0) throw new Error("播放地址无法读取时长");
  if (!streamTypes.has("audio")) throw new Error("播放地址不含音轨");
  if (!streamTypes.has("video")) throw new Error("播放地址不含画面");
  return durationSec;
}

async function refreshEpisodePlaybackUrls(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): Promise<string[]> {
  if (state.playbackRefreshAttempted) return state.playbackRefreshUrls || [];
  state.playbackRefreshAttempted = true;
  const awemeId = extractDouyinVideoIdFromUrl(ep.url);
  if (!awemeId) return [];
  // 合集列表通常从主 Cookie 开始；故障刷新从备用候选开始，再回到主候选。
  const fresh = await listDouyinAwemePlaybackUrlsViaWebApi(awemeId, 1).catch(() => []);
  state.playbackRefreshUrls = Array.from(new Set([
    ...(ep.playbackUrls || []),
    ...fresh,
  ]));
  return state.playbackRefreshUrls;
}

async function probeEpisodeDurationWithSourceFailover(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): Promise<number> {
  const source = episodeDownloadSource(ep, state);
  if (!source.viaPlayback) {
    if (!isDouyinHostUrl(ep.url)) {
      const durationSec = await ffprobeRemoteMedia(ep.url);
      state.resolvedStreamUrl = ep.url;
      state.triedStreamUrls = [ep.url];
      return durationSec;
    }
    // Douyin 页面 URL 不是媒体流；不用 ffprobe 白等超时，直接刷新官方播放地址。
  } else {
    try {
      const durationSec = await ffprobeRemoteMedia(source.url);
      state.resolvedStreamUrl = source.url;
      state.triedStreamUrls = [source.url];
      return durationSec;
    } catch (error) {
      console.warn(
        "[manhuaTemplateLearn] playback probe failed, refreshing detail:",
        ep.index,
        error instanceof Error ? error.message : error,
      );
    }
  }
  const refreshedUrls = await refreshEpisodePlaybackUrls(ep, state);
  for (let index = 0; index < refreshedUrls.length; index++) {
    try {
      state.playbackUrl = refreshedUrls[index];
      const durationSec = await ffprobeRemoteMedia(refreshedUrls[index]!);
      state.resolvedStreamUrl = refreshedUrls[index];
      state.triedStreamUrls = Array.from(new Set([
        ...(state.triedStreamUrls || []),
        refreshedUrls[index]!,
      ]));
      return durationSec;
    } catch {
      console.warn(
        "[manhuaTemplateLearn] refreshed playback probe failed, trying next:",
        ep.index,
        `candidate=${index + 1}/${refreshedUrls.length}`,
      );
    }
  }
  state.playbackDead = true;
  throw new Error("官方媒体流不可用，未启动语音与高密度抽帧；已暂跳该集");
}

function currentEpisodeMediaSource(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): ManhuaRemoteMediaSource {
  const url = String(state.resolvedStreamUrl || "").trim();
  if (!url) throw new Error("尚未取得可读取的媒体流，不能开始学习");
  return {
    url,
    referer: isDouyinHostUrl(ep.url) ? DOUYIN_PLAYBACK_REFERER : undefined,
  };
}

async function advanceEpisodeMediaSource(
  ep: ListedEpisode,
  state: EpisodeSourceState,
): Promise<boolean> {
  if (!isDouyinHostUrl(ep.url)) return false;
  const urls = await refreshEpisodePlaybackUrls(ep, state);
  const tried = new Set<string>(
    [...(state.triedStreamUrls || []), state.resolvedStreamUrl]
      .filter((url): url is string => Boolean(url)),
  );
  const next = urls.find((url) => !tried.has(url));
  if (!next) return false;
  state.resolvedStreamUrl = next;
  tried.add(next);
  state.triedStreamUrls = Array.from(tried);
  return true;
}

function parseFlatPlaylistEntries(
  data: {
    title?: string;
    entries?: Array<{
      playlist_index?: number;
      title?: string;
      url?: string;
      webpage_url?: string;
      id?: string;
    } | null>;
  },
  fallbackUrl: string,
  titleHint?: string,
): ListedEpisode[] {
  const entries = Array.isArray(data.entries) ? data.entries.filter(Boolean) : [];
  if (entries.length > 0) {
    const out: ListedEpisode[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]!;
      const index = Math.max(1, Math.floor(Number(e.playlist_index) || i + 1));
      let epUrl = String(e.webpage_url || e.url || "").trim();
      if (!epUrl && e.id) {
        const id = String(e.id).trim();
        epUrl = /^https?:\/\//i.test(id)
          ? id
          : /^\d+$/.test(id)
            ? `https://www.douyin.com/video/${id}`
            : String(e.url || "").trim();
      }
      if (!epUrl || !/^https?:\/\//i.test(epUrl)) continue;
      out.push({
        index,
        url: epUrl,
        title: String(e.title || `第${index}集`).trim() || `第${index}集`,
      });
    }
    out.sort((a, b) => a.index - b.index);
    const seen = new Set<number>();
    return out.filter((e) => {
      if (seen.has(e.index)) return false;
      seen.add(e.index);
      return true;
    });
  }
  return listedSingleEpisodeFromUrl(
    fallbackUrl,
    String(data.title || titleHint || "第1集").trim() || "第1集",
  );
}

async function listPlaylistViaYtdlp(
  playlistUrl: string,
  titleHint?: string,
): Promise<{ listed: ListedEpisode[]; fromEntries: boolean }> {
  assertYtdlpCookieReadyForUrl(playlistUrl);
  return withYtdlpCookieCandidates(playlistUrl, async (cookieArgs) => {
    const data = (await execYtdlpJson([
      ...cookieArgs,
      "--flat-playlist",
      "-J",
      "--no-warnings",
      playlistUrl,
    ])) as {
      title?: string;
      entries?: Array<{
        playlist_index?: number;
        title?: string;
        url?: string;
        webpage_url?: string;
        id?: string;
      } | null>;
    };
    const fromEntries = Array.isArray(data.entries) && data.entries.filter(Boolean).length > 0;
    return { listed: parseFlatPlaylistEntries(data, playlistUrl, titleHint), fromEntries };
  });
}

type ListedEpisodesResult = {
  listed: ListedEpisode[];
  mixNameZh?: string;
  /**
   * 列表是否可靠：合集成功展开=可靠；**有 mixId 却展开失败回退单集=不可靠**
   * （接口抖动降级，不许参与「合集全学完」判定，也不许并进 progress 的可靠集合）
   */
  reliable: boolean;
};

/**
 * 有数字 mixId 时优先展开合集多集；失败再回退成片/单集 URL。
 * 展开首选趋势采集器同款抖音 web API——collection/mix 页改版后
 * yt-dlp flat-playlist 解析已死（生产日志实锤），老路只留作兜底。
 */
async function listOrderedEpisodes(
  sourceUrl: string,
  titleHint?: string,
  mixId?: string,
  single?: { titleZh?: string; episodeIndex?: number; playbackUrl?: string; playbackUrls?: string[] },
): Promise<ListedEpisodesResult> {
  const id = String(mixId || "").trim();
  if (/^\d{6,}$/.test(id)) {
    try {
      const viaApi = await listDouyinMixEpisodesViaWebApi(id);
      if (viaApi && viaApi.episodes.length > 0) {
        console.info(
          `[manhuaTemplateLearn] mix expand via web api: entries=${viaApi.episodes.length} mixId=${id} complete=${viaApi.complete}`,
        );
        // 残缺列表只用于本批学习，不算可靠全集（第五轮复审 P1·11）：
        // 否则前几十集会被当全集、提前判「合集学完」出草案
        return { listed: viaApi.episodes, mixNameZh: viaApi.mixNameZh, reliable: viaApi.complete };
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] mix web api expand failed:",
        id,
        e instanceof Error ? e.message : e,
      );
    }
  }
  const mixCandidates = buildDouyinMixCandidateUrls(id);
  for (const mixUrl of mixCandidates) {
    try {
      const { listed } = await listPlaylistViaYtdlp(mixUrl, titleHint);
      if (listed.length > 1) {
        console.info(
          `[manhuaTemplateLearn] mix expand ok: mixId entries=${listed.length} via ${mixUrl.slice(0, 60)}`,
        );
        return { listed, reliable: true };
      }
    } catch (e) {
      console.warn(
        "[manhuaTemplateLearn] mix expand failed:",
        mixUrl.slice(0, 80),
        e instanceof Error ? e.message : e,
      );
    }
  }

  // 单集成片页：不必 --flat-playlist（抖音常因此先撞登录态）。
  // modal_id 弹层链接归一化成 /video/ 标准形态——yt-dlp 只稳定认后者。
  // 详情接口给过真实集号/标题时带上，避免同剧多条单集链接都占第 1 集互相覆盖
  if (isDouyinSingleVideoUrl(sourceUrl)) {
    return {
      listed: listedSingleEpisodeFromUrl(
        normalizeDouyinVideoUrl(sourceUrl),
        single?.titleZh || titleHint,
        single?.episodeIndex,
      ).map((e) => ({
        ...e,
        playbackUrl: single?.playbackUrl,
        playbackUrls: single?.playbackUrls,
      })),
      // 有 mixId 却走到单集回退 = 合集展开失败的降级列表，不可靠
      reliable: !/^\d{6,}$/.test(id),
    };
  }

  try {
    const { listed, fromEntries } = await listPlaylistViaYtdlp(sourceUrl, titleHint);
    // 审查必须修11：collection/mix 页没解出 entries 时 parse 会伪造「第1集」——
    // 那是降级列表，不许标可靠（否则学完 1 集就被判「合集全学完」提早出草案）
    return { listed, reliable: fromEntries };
  } catch (e) {
    throw new Error(mapManhuaLearnFetchError(e));
  }
}

async function readJsonGcs<T>(objectName: string): Promise<T | null> {
  const res = await readJsonGcsDetailed<T>(objectName);
  return res.status === "found" ? res.value : null;
}

/**
 * 三态读取（审查必须修12）：把 404 与「GCS 抖动/鉴权失败/坏 JSON」分开——
 * 只有确认不存在才允许补写，瞬时读取失败不许当「文件不存在」去覆盖落盘提案。
 */
async function readJsonGcsDetailed<T>(
  objectName: string,
): Promise<
  | { status: "found"; value: T }
  | { status: "not_found" }
  | { status: "error"; errorNote: string }
> {
  let buffer: Buffer;
  try {
    ({ buffer } = await downloadGcsObject({
      gcsUri: `gs://${gcsBucketHint()}/${objectName}`,
    }));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as { code?: number | string })?.code;
    if (code === 404 || /No such object|does not exist|notFound|404/i.test(msg)) {
      return { status: "not_found" };
    }
    return { status: "error", errorNote: msg.slice(0, 200) };
  }
  try {
    return { status: "found", value: JSON.parse(buffer.toString("utf8")) as T };
  } catch (e) {
    // 坏 JSON = 存在但读不出：按 error 处理，不许覆盖
    return {
      status: "error",
      errorNote: `bad_json:${(e instanceof Error ? e.message : String(e)).slice(0, 160)}`,
    };
  }
}

async function writeJsonGcs(objectName: string, value: unknown): Promise<string> {
  const uploaded = await uploadBufferToGcs({
    objectName,
    buffer: Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"),
    contentType: "application/json",
  });
  return uploaded.gcsUri;
}

async function loadSeriesProgress(seriesKey: string): Promise<ManhuaLearnSeriesProgress | null> {
  return readJsonGcs<ManhuaLearnSeriesProgress>(
    `manhua-template-learn/series/${seriesKey}/progress.json`,
  );
}

async function loadAllDigests(seriesKey: string): Promise<ManhuaLearnEpisodeDigest[]> {
  const prefix = `manhua-template-learn/series/${seriesKey}/episodes/`;
  let names: string[] = [];
  try {
    names = await listGcsObjectNamesByPrefix({ prefix, maxResults: 80 });
  } catch {
    return [];
  }
  const digests: ManhuaLearnEpisodeDigest[] = [];
  for (const name of names) {
    if (!/\.json$/i.test(name)) continue;
    const d = await readJsonGcs<ManhuaLearnEpisodeDigest>(name);
    if (d && d.episodeIndex >= 1) digests.push(d);
  }
  return digests.sort((a, b) => a.episodeIndex - b.episodeIndex);
}

async function rmrf(dir: string) {
  await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
}

function manhuaLearnControlError(kind: "cancel" | "skip"): Error {
  const error = new Error(kind === "cancel" ? "用户已停止学习" : "用户已跳过当前集");
  error.name = kind === "cancel" ? "ManhuaLearnCancelledError" : "ManhuaLearnSkipEpisodeError";
  return error;
}

async function assertManhuaLearnControl(
  input: Pick<ManhuaTemplateLearnInput, "checkControl" | "abortSignal">,
): Promise<void> {
  if (input.abortSignal?.aborted) throw manhuaLearnControlError("cancel");
  const state = await input.checkControl?.();
  if (state === "cancel" || state === "skip") throw manhuaLearnControlError(state);
}

async function persistEpisodePreviewFrames(input: {
  seriesKey: string;
  episodeIndex: number;
  framePaths: string[];
}): Promise<string[]> {
  if (!input.seriesKey || !input.framePaths.length) return [];
  const indexes = Array.from(new Set([
    0,
    Math.floor((input.framePaths.length - 1) / 2),
    input.framePaths.length - 1,
  ])).filter((i) => i >= 0 && i < input.framePaths.length).slice(0, 3);
  const uris: string[] = [];
  for (let slot = 0; slot < indexes.length; slot++) {
    const framePath = input.framePaths[indexes[slot]!]!;
    const uploaded = await uploadBufferToGcs({
      objectName: `manhua-template-learn/series/${input.seriesKey}/episodes/${input.episodeIndex}/preview-${slot + 1}.jpg`,
      buffer: await fs.readFile(framePath),
      contentType: "image/jpeg",
    });
    uris.push(uploaded.gcsUri);
  }
  return uris;
}

async function learnOneEpisodeChunk(input: {
  seriesKey: string;
  ep: ListedEpisode;
  titleHint: string;
  learnLlm: ManhuaTemplateLearnLlmProvider;
  mediaSource: ManhuaRemoteMediaSource;
  startSec: number;
  endSec: number;
  chunkDir: string;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
  checkControl?: ManhuaTemplateLearnInput["checkControl"];
  abortSignal?: AbortSignal;
  capturePreviewFrames?: boolean;
}): Promise<ManhuaLearnEpisodeChunk> {
  const chunkLen = Math.max(1, input.endSec - input.startSec);
  const rangeZh = `${Math.floor(input.startSec / 60)}–${Math.ceil(input.endSec / 60)} 分`;

  await assertManhuaLearnControl(input);
  await input.onProgress?.(
    MANHUA_LEARN_STAGE.audio,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.audio,
      input.ep.index,
      rangeZh,
    ),
  );
  const audioPath = path.join(input.chunkDir, "audio.mp3");
  await extractRemoteManhuaAudio({
    source: input.mediaSource,
    startSec: input.startSec,
    durationSec: chunkLen,
    outputPath: audioPath,
  });

  if (!isGeminiAudioAvailable()) throw new Error("语音分析模型不可用，本分片未计入已学");
  const audioBuf = await fs.readFile(audioPath);
  if (audioBuf.length > 18 * 1024 * 1024) {
    throw new Error("语音分片超过分析上限，本分片未计入已学");
  }
  await assertManhuaLearnControl(input);
  let geminiScan: ManhuaDramaAudioScanResult;
  try {
    geminiScan = await analyzeManhuaDramaAudioWithGemini({
      audioBase64: audioBuf.toString("base64"),
      mimeType: "audio/mpeg",
    });
  } catch {
    throw new Error("语音分析失败，本分片未计入已学");
  }
  if (!String(geminiScan.transcriptSummary || "").trim() && !geminiScan.sections?.length) {
    throw new Error("语音分析没有产出可用内容，本分片未计入已学");
  }
  const audioAnalysis: NonNullable<ManhuaLearnEpisodeChunk["audioAnalysis"]> = {
    model: String(geminiScan.model || ""),
    attempted: true,
    success: true,
  };

  const silenceLog = await silenceDetectLog(audioPath);
  const speechRegions = speechRegionsFromSilenceDetectLog(silenceLog, chunkLen);
  const plan = buildAdaptiveFramePlan({
    durationSec: chunkLen,
    geminiSections: geminiScan?.sections,
    speechRegions,
  });
  await assertManhuaLearnControl(input);
  await input.onProgress?.(
    MANHUA_LEARN_STAGE.frames,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.frames,
      input.ep.index,
      `${rangeZh} · 基线每 3 秒，高能段每 0.5 秒`,
    ),
  );
  const framesDir = path.join(input.chunkDir, "frames");
  const denseSample = await extractRemoteManhuaDenseFrames({
    source: input.mediaSource,
    segmentStartSec: input.startSec,
    durationSec: chunkLen,
    framesDir,
    baseTimestamps: plan.baseTimestamps,
    climaxWindows: plan.climaxWindows,
  });
  if (!denseSample.success) {
    throw new Error(
      `高密度抽帧不足（计划 ${denseSample.requestedCount} 张，实际 ${denseSample.extractedCount} 张），本分片未计入已学`,
    );
  }
  const framePaths = denseSample.frames.map((frame) => frame.path);
  const timestamps = denseSample.frames.map((frame) => frame.atSec);
  await assertManhuaLearnControl(input);
  // 所有来源都验帧：限制页、黑屏、静止页不能靠换域名绕过。
  await assertManhuaPreviewFramesHaveMotion(framePaths);
  const denseFrames: NonNullable<ManhuaLearnEpisodeChunk["denseFrames"]> = {
    requestedCount: denseSample.requestedCount,
    extractedCount: denseSample.extractedCount,
    validMotion: true,
    success: true,
  };
  const previewFrameGcsUris = input.capturePreviewFrames
    ? await persistEpisodePreviewFrames({
        seriesKey: input.seriesKey,
        episodeIndex: input.ep.index,
        framePaths,
      })
    : [];

  const transcriptPreview = String(geminiScan?.transcriptSummary || "")
    .replace(/\s+/g, " ")
    .slice(0, 400);

  let hookNoteZh = "待补钩子";
  let beatHints = timestamps.slice(0, 8).map((t) => ({
    atSec: Math.round(t),
    conflictZh: "待视觉读帧补全",
    visualZh: `关键帧 @${t.toFixed(1)}s`,
  }));
  const sceneHints: string[] = [];

  await input.onProgress?.(
    MANHUA_LEARN_STAGE.vision,
    formatManhuaLearnEpisodeDetail(
      MANHUA_LEARN_STAGE.vision,
      input.ep.index,
      rangeZh,
    ),
  );
  // 读帧 provenance（审查必须修13）：真实尝试/成功分别记账，异常不再被吞成「像成功」
  const { MANHUA_TEMPLATE_FRAME_VISION_MODEL, MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL } = await import(
    "../../shared/manhuaTemplateLearnFrameVision.js"
  );
  const visionProvider = input.learnLlm === "claude" ? "anthropic" : "openai";
  const visionProvenance: NonNullable<ManhuaLearnEpisodeChunk["vision"]> = {
    provider: visionProvider,
    model:
      visionProvider === "anthropic"
        ? MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL
        : MANHUA_TEMPLATE_FRAME_VISION_MODEL,
    attempted: false,
    success: false,
  };
  try {
    const paired = framePaths.map((p, i) => ({
      path: p,
      atSec: Number(timestamps[i]) || 0,
    }));
    const selected = selectFramesForVisionAnalysis(paired, 16);
    const frames = [];
    for (const item of selected) {
      const buf = await fs.readFile(item.path);
      frames.push({
        atSec: item.atSec,
        dataUrl: `data:image/jpeg;base64,${buf.toString("base64")}`,
        mimeType: "image/jpeg",
      });
    }
    if (frames.length) {
      const draft = {
        id: `ep_tmp_${input.ep.index}_${Math.floor(input.startSec)}`,
        nameZh: "分集草案",
        laneZh: guessLane(`${input.titleHint} ${transcriptPreview}`) as ManhuaViralTemplateLane,
        summaryZh: "分集",
        hook3sZh: "待补",
        beatGrid: beatHints,
        scenePoolHints: [] as string[],
        castShape: { leadDesireZh: "待补", pressureZh: "待补" },
        densityHints: {
          minBodyChars: 280,
          minDialogueLines: 8,
          minLocationHits: 2,
        },
        sourceRefs: [{ url: input.ep.url, fetchedAt: new Date().toISOString().slice(0, 10) }],
        status: "proposed" as const,
      };
      visionProvenance.attempted = true;
      await assertManhuaLearnControl(input);
      const vision = await analyzeManhuaTemplateFramesWithTerra({
        frames,
        titleHint: `${input.titleHint} · ${input.ep.title} · ${rangeZh}`,
        durationSec: chunkLen,
        transcriptPreview,
        climaxNotes: plan.climaxWindows.map((w) => w.reasonZh),
        fallbackLane: draft.laneZh,
        learnProvider: input.learnLlm,
        abortSignal: input.abortSignal,
      });
      await assertManhuaLearnControl(input);
      visionProvenance.success = true;
      visionProvenance.model = String(vision.model || visionProvenance.model);
      const filled = applyFrameVisionToProposal(draft, vision);
      if (filled) {
        hookNoteZh = filled.hook3sZh;
        beatHints = filled.beatGrid.map((b) => ({
          ...b,
          // 读帧若返回相对秒，叠回绝对时间；已是绝对则保持
          atSec:
            Number(b.atSec) <= chunkLen + 1
              ? Math.round(Number(b.atSec) + input.startSec)
              : Math.round(Number(b.atSec) || 0),
        }));
        sceneHints.push(...(filled.scenePoolHints || []));
      }
    } else {
      throw new Error("高密度抽帧没有可供视觉分析的画面");
    }
  } catch (e) {
    await assertManhuaLearnControl(input);
    if (e instanceof Error && /ManhuaLearn(Cancelled|SkipEpisode)Error/.test(e.name)) throw e;
    visionProvenance.errorNote = (e instanceof Error ? e.message : String(e)).slice(0, 160);
    console.warn(
      "[manhuaTemplateLearn] chunk vision failed:",
      input.ep.index,
      rangeZh,
      e instanceof Error ? e.message : e,
    );
    throw new Error("高密度画面分析失败，本分片未计入已学");
  }

  return {
    startSec: input.startSec,
    endSec: input.endSec,
    transcriptPreview,
    hookNoteZh,
    beatHints,
    climaxNotes: plan.climaxWindows.map((w) => w.reasonZh).slice(0, 6),
    sceneHints: sceneHints.slice(0, 8),
    learnedAt: new Date().toISOString(),
    previewFrameGcsUris: previewFrameGcsUris.length ? previewFrameGcsUris : undefined,
    audioAnalysis,
    denseFrames,
    vision: visionProvenance,
  };
}

/** 已学分集的补救：从媒体流重抽首分钟代表帧，不落视频、不重复烧语音/视觉模型成本。 */
async function refreshEpisodePreviewFrames(input: {
  seriesKey: string;
  ep: ListedEpisode;
  digest: ManhuaLearnEpisodeDigest;
  rootTmp: string;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
  checkControl?: ManhuaTemplateLearnInput["checkControl"];
  abortSignal?: AbortSignal;
}): Promise<ManhuaLearnEpisodeDigest> {
  const workDir = path.join(input.rootTmp, `repair-preview-${input.ep.index}`);
  const durationSec = Math.max(1, Number(input.digest.durationSec) || 60);
  const endSec = Math.min(durationSec, 60);
  try {
    await assertManhuaLearnControl(input);
    await input.onProgress?.(
      MANHUA_LEARN_STAGE.download,
      `正在补抽第 ${input.ep.index} 集静帧 0–${Math.ceil(endSec / 60)} 分（不重跑模型）…`,
    );
    const sourceState: EpisodeSourceState = { playbackUrl: input.ep.playbackUrl };
    await probeEpisodeDurationWithSourceFailover(input.ep, sourceState);
    const plan = buildAdaptiveFramePlan({ durationSec: endSec });
    const sample = await extractRemoteManhuaDenseFrames({
      source: currentEpisodeMediaSource(input.ep, sourceState),
      segmentStartSec: 0,
      durationSec: endSec,
      framesDir: path.join(workDir, "frames"),
      baseTimestamps: plan.baseTimestamps,
      climaxWindows: [],
    });
    if (!sample.success) throw new Error("静帧补抽密度不足");
    const framePaths = sample.frames.map((frame) => frame.path);
    await assertManhuaPreviewFramesHaveMotion(framePaths);
    const previewFrameGcsUris = await persistEpisodePreviewFrames({
      seriesKey: input.seriesKey,
      episodeIndex: input.ep.index,
      framePaths,
    });
    if (!previewFrameGcsUris.length) throw new Error("静帧补抽未生成可展示图片");
    await input.onProgress?.(MANHUA_LEARN_STAGE.persist, `第 ${input.ep.index} 集静帧已补齐（未重跑模型）`);
    return { ...input.digest, previewFrameGcsUris };
  } finally {
    await rmrf(workDir);
  }
}

/**
 * 整集分段学：先探测总时长，再按约 10 分钟从远程媒体流提取语音与高密度静帧；
 * 不落 MP4。每段只有语音、密集帧和视觉理解三路同时成功才推进检查点。
 */
async function learnOneEpisode(input: {
  seriesKey: string;
  ep: ListedEpisode;
  titleHint: string;
  learnLlm: ManhuaTemplateLearnLlmProvider;
  rootTmp: string;
  existing?: ManhuaLearnEpisodeDigest | null;
  onProgress?: ManhuaTemplateLearnInput["onProgress"];
  onCheckpoint?: (digest: ManhuaLearnEpisodeDigest) => void | Promise<void>;
  checkControl?: ManhuaTemplateLearnInput["checkControl"];
  abortSignal?: AbortSignal;
}): Promise<ManhuaLearnEpisodeDigest> {
  const epDir = path.join(input.rootTmp, `ep_${input.ep.index}`);
  await fs.mkdir(epDir, { recursive: true });
  try {
    if (input.existing && isManhuaLearnEpisodeComplete(input.existing)) {
      return input.existing;
    }

    await assertManhuaLearnControl(input);
    await input.onProgress?.(MANHUA_LEARN_STAGE.download, `正在读取第 ${input.ep.index} 集时长…`);
    const srcState: EpisodeSourceState = { playbackUrl: input.ep.playbackUrl };
    const durationSec = await probeEpisodeDurationWithSourceFailover(input.ep, srcState);
    if (durationSec > MANHUA_LEARN_MAX_DURATION_SEC) {
      throw new Error(
        `第 ${input.ep.index} 集超过 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，已跳过策略外片`,
      );
    }

    const classify = classifyManhuaLearnTitle(input.titleHint, input.ep.title);
    // 旧版未完成分片没有语音/高密度画面成功凭证，不与新口径混用。
    // 已完成的旧 digest 在函数开头已直接返回，这里只对旧未完成数据从头重学。
    const resumableExisting = input.existing?.completionPolicy === "audio_dense_frames_v1"
      ? input.existing
      : null;
    let digest: ManhuaLearnEpisodeDigest | null = resumableExisting
      ? {
          ...resumableExisting,
          durationSec: Math.max(resumableExisting.durationSec || 0, durationSec),
          url: input.ep.url,
          title: input.ep.title || resumableExisting.title,
        }
      : null;

    let cursor = Math.max(0, Number(digest?.learnedThroughSec) || 0);
    // 若已有完整 chunks 覆盖，从末尾续
    if (Array.isArray(digest?.chunks) && digest!.chunks!.length) {
      cursor = Math.max(
        cursor,
        ...digest!.chunks!.map((c) => Number(c.endSec) || 0),
      );
    }

    const checkpoint = Math.max(60, MANHUA_LEARN_CHECKPOINT_SEC);
    const retryMax = Math.max(1, MANHUA_LEARN_EPISODE_RETRY_MAX);
    while (cursor < durationSec - 0.5) {
      await assertManhuaLearnControl(input);
      const segment = nextManhuaLearnVideoSegment({
        cursorSec: cursor,
        durationSec,
        segmentSec: checkpoint,
      });
      if (!segment) break;
      const { startSec, endSec } = segment;
      const chunkDir = path.join(
        epDir,
        `chunk_${String(Math.floor(startSec)).padStart(5, "0")}`,
      );
      let chunk: ManhuaLearnEpisodeChunk | null = null;
      let lastErrZh = "";
      for (let attempt = 1; attempt <= retryMax; attempt++) {
        await rmrf(chunkDir);
        await fs.mkdir(chunkDir, { recursive: true });
        try {
          await assertManhuaLearnControl(input);
          await input.onProgress?.(
            MANHUA_LEARN_STAGE.download,
            `正在流式读取第 ${input.ep.index} 集 ${Math.floor(startSec / 60)}–${Math.ceil(endSec / 60)} 分${attempt > 1 ? `（重试 ${attempt}/${retryMax}）` : ""}…`,
          );
          const mediaSource = currentEpisodeMediaSource(input.ep, srcState);
          chunk = await learnOneEpisodeChunk({
            seriesKey: input.seriesKey,
            ep: input.ep,
            titleHint: input.titleHint,
            learnLlm: input.learnLlm,
            mediaSource,
            startSec,
            endSec,
            chunkDir,
            onProgress: input.onProgress,
            checkControl: input.checkControl,
            abortSignal: input.abortSignal,
            capturePreviewFrames: !(digest?.previewFrameGcsUris?.length),
          });
          break;
        } catch (e) {
          if (e instanceof Error && /ManhuaLearn(Cancelled|SkipEpisode)Error/.test(e.name)) throw e;
          lastErrZh = mapManhuaLearnFetchError(e);
          if (
            /媒体流|语音流|抽帧|画面不可解码|节点拒绝/.test(lastErrZh)
            && attempt < retryMax
          ) {
            await advanceEpisodeMediaSource(input.ep, srcState).catch(() => false);
          }
          await input.onProgress?.(
            MANHUA_LEARN_STAGE.failed,
            `第 ${input.ep.index} 集分片失败（${attempt}/${retryMax}）：${lastErrZh}`,
          );
        }
      }
      if (!chunk) {
        // 已写入的检查点保留在 GCS；停止本轮避免空跑
        throw new Error(
          `第 ${input.ep.index} 集 ${Math.floor(startSec / 60)}–${Math.ceil(endSec / 60)} 分连续 ${retryMax} 次失败：${lastErrZh || "未知错误"}。已保留此前检查点，可稍后续学。`,
        );
      }

      digest = mergeManhuaLearnChunkIntoDigest({
        prev: digest,
        chunk,
        episodeIndex: input.ep.index,
        url: input.ep.url,
        title: input.ep.title,
        durationSec,
        dramaKind: classify.dramaKind,
        categoryLabelZh: classify.categoryLabelZh,
        tagLabelsZh: classify.tagLabelsZh,
      });

      await input.onCheckpoint?.(digest);
      await input.onProgress?.(
        MANHUA_LEARN_STAGE.persist,
        `第 ${input.ep.index} 集检查点 ${Math.round(endSec / 60)}/${Math.round(durationSec / 60)} 分已写入（语音+高密度画面均通过）`,
      );

      cursor = endSec;
      await rmrf(chunkDir);
    }

    if (!digest) {
      throw new Error(`第 ${input.ep.index} 集未能生成任何学习摘要`);
    }

    digest = {
      ...digest,
      complete: true,
      learnedThroughSec: Math.max(digest.learnedThroughSec || 0, durationSec),
      durationSec,
    };
    await input.onCheckpoint?.(digest);

    await input.onProgress?.(
      MANHUA_LEARN_STAGE.cleanup,
      `第 ${input.ep.index} 集全部片段已学完（未落本地视频）`,
    );
    return digest;
  } finally {
    await rmrf(epDir);
  }
}

/**
 * 停止时润色（2026-08-11 用户拍板）：无论学到几集、正常收尾、手动叫停还是失败停止，
 * 结束那一刻统一对已学摘要跑一次模型润色并落盘等批准；润色失败保留启发式稿（degraded）。
 * 历史「学了但没落盘提案」的系列也走这里补账。
 */
async function polishAndPersistManhuaProposal(input: {
  seriesKey: string;
  prog: ManhuaLearnSeriesProgress;
  digests: ManhuaLearnEpisodeDigest[];
  learnLlm: ManhuaTemplateLearnLlmProvider;
  abortSignal?: AbortSignal;
}): Promise<{
  proposal: ManhuaViralTemplateCard;
  proposalGcsUri: string;
  polishOk: boolean;
  visionOk: boolean;
}> {
  const { seriesKey, prog, digests, learnLlm } = input;
  let proposal = mergeEpisodeDigestsIntoProposal({
    seriesKey,
    titleHint: prog.titleHint,
    sourceUrl: prog.sourceUrl,
    digests: digests.slice(0, MANHUA_LEARN_ANALYSIS_TARGET),
  });
  if (!proposal) throw new Error("合成提案失败");

  let polishOk = false;
  let polishModelUsed = "";
  try {
    const { invokeLLM, extractJsonString } = await import("../_core/llm.js");
    const {
      MANHUA_TEMPLATE_FRAME_VISION_MODEL,
      MANHUA_TEMPLATE_FRAME_VISION_REASONING,
      MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL,
    } = await import("../../shared/manhuaTemplateLearnFrameVision.js");
    const isClaude = learnLlm === "claude";
    // 调用前先记计划模型：失败时 provenance 也能说明「试过哪个模型」
    polishModelUsed = isClaude ? MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL : MANHUA_TEMPLATE_FRAME_VISION_MODEL;
    const resp = await invokeLLM({
      model: "pro",
      provider: isClaude ? "anthropic" : "openai",
      modelName: isClaude ? MANHUA_TEMPLATE_LEARN_CLAUDE_MODEL : MANHUA_TEMPLATE_FRAME_VISION_MODEL,
      reasoningEffort: MANHUA_TEMPLATE_FRAME_VISION_REASONING,
      max_tokens: 4096,
      abortSignal: input.abortSignal,
      // claude-opus-5 不收采样控件与 response_format，仅 GPT 路径带
      ...(isClaude ? {} : { temperature: 0.3, response_format: { type: "json_object" as const } }),
      messages: [
        {
          role: "system",
          content:
            "你根据多集漫剧学习摘要，输出一张中性节奏模板 JSON（nameZh,laneZh,summaryZh,hook3sZh,beatGrid,scenePoolHints,castShape）。禁止外部剧名/台词。只返回 JSON。",
        },
        {
          role: "user",
          content: JSON.stringify({
            titleHint: prog.titleHint,
            digests: digests.slice(0, MANHUA_LEARN_ANALYSIS_TARGET).map((d) => ({
              episodeIndex: d.episodeIndex,
              hookNoteZh: d.hookNoteZh,
              transcriptPreview: d.transcriptPreview.slice(0, 800),
              climaxNotes: d.climaxNotes,
              sceneHints: d.sceneHints,
              beatHints: d.beatHints.slice(0, 6),
            })),
            seed: {
              nameZh: proposal.nameZh,
              laneZh: proposal.laneZh,
              hook3sZh: proposal.hook3sZh,
            },
          }),
        },
      ],
    });
    if (String(resp.choices?.[0]?.finish_reason || "") === "max_tokens") {
      throw new Error("polish_truncated");
    }
    const raw = String(resp.choices?.[0]?.message?.content || "");
    const parsed = JSON.parse(extractJsonString(raw)) as Record<string, unknown>;
    const polished = parseManhuaViralTemplateCard({
      ...proposal,
      ...parsed,
      id: proposal.id,
      status: "proposed",
      sourceRefs: proposal.sourceRefs,
    });
    if (polished) {
      proposal = polished;
      polishOk = true;
    }
  } catch (e) {
    console.warn(
      "[manhuaTemplateLearn] polish failed, keep heuristic:",
      e instanceof Error ? e.message : e,
    );
  }

  // provenance 落盘（审查必须修13）：读帧与润色分开记，快照/no-batch/UI 同源消费
  const frameVisionAgg = aggregateDigestFrameVision(digests);
  proposal = {
    ...proposal,
    provenance: {
      frameVision: frameVisionAgg,
      proposalPolish: {
        provider: learnLlm === "claude" ? "anthropic" : "openai",
        model: polishModelUsed,
        attempted: true,
        success: polishOk,
        degraded: polishOk ? undefined : true,
      },
    },
  };
  const proposalGcsUri = await writeJsonGcs(
    `manhua-template-learn/proposals/${proposal.id}.json`,
    proposal,
  );
  return {
    proposal,
    proposalGcsUri,
    polishOk,
    visionOk: (frameVisionAgg?.successChunks ?? 0) > 0,
  };
}

export async function runManhuaTemplateLearn(
  input: ManhuaTemplateLearnInput,
): Promise<ManhuaTemplateLearnResult> {
  const title = stripBookTitleMarks(cleanManhuaLearnTitle(input.title));
  const sourceGcsUri = String(input.gcsUri || "").trim();
  const sourceUrl = String(input.url || "").trim();
  if (!sourceUrl && !sourceGcsUri) {
    throw new Error("缺少合集、成片链接或手动导入视频");
  }
  if (sourceGcsUri && !sourceGcsUri.startsWith("gs://")) {
    throw new Error("手动导入视频地址无效");
  }
  if (/douyin\.com\/search\//i.test(sourceUrl)) {
    throw new Error("当前是搜索页链接，请改用合集/成片页地址");
  }
  // yt-dlp/ffmpeg 只消费短时效 HTTPS；seriesKey 与 GCS 进度始终绑定稳定 gs://。
  const url = sourceGcsUri
    ? signGsUriV4ReadUrl(sourceGcsUri, 7 * 24 * 3600)
    : sourceUrl;
  const sourceIdentity = sourceGcsUri || sourceUrl;

  // —— 抖音上下文解析：合集页 URL 直接提 mixId（榜单行有时只给链接不带 mixId）；
  //    单集（含 modal_id 弹层）查详情回填剧名；发现所属合集则升级为合集学习
  //    （榜单单集链接一次学一批的入口）——
  let mixId = String(input.mixId || "").trim();
  let dramaNameZh = "";
  let single: {
    titleZh?: string;
    episodeIndex?: number;
    playbackUrl?: string;
    playbackUrls?: string[];
  } | undefined;
  if (!sourceGcsUri && isDouyinHostUrl(url)) {
    if (!/^\d{6,}$/.test(mixId)) {
      const fromUrl = extractDouyinMixIdFromUrl(url);
      if (fromUrl) mixId = fromUrl;
    }
    const videoId = extractDouyinVideoIdFromUrl(url);
    if (videoId) {
      const detail = await fetchDouyinAwemeDetailViaWebApi(videoId).catch(() => null);
      if (detail) {
        single = {
          titleZh: detail.titleZh,
          episodeIndex: detail.episodeIndex,
          playbackUrl: detail.playbackUrl,
          playbackUrls: detail.playbackUrls,
        };
        if (!/^\d{6,}$/.test(mixId) && detail.mixId && /^\d{6,}$/.test(detail.mixId)) {
          mixId = detail.mixId;
        }
        dramaNameZh = stripBookTitleMarks(detail.mixNameZh);
      }
    }
  }
  // 直接视频若本身已是≥60分钟的大合集，即使详情里携带 mixId，
  // 也保留为单个长学习源，之后按剧名并入已有剧。
  if (mixId && single?.playbackUrl) {
    const directDurationSec = await ffprobeRemoteDuration(single.playbackUrl).catch(() => 0);
    if (isManhuaCompilationDuration(directDurationSec)) {
      mixId = "";
      single = { ...single, episodeIndex: 1 };
    }
  }
  if (mixId && !String(input.mixId || "").trim()) {
    // 单集/裸链接升级为合集学习：留双 key 日志，排查「旧进度去哪了」用
    console.info(
      `[manhuaTemplateLearn] series upgraded to mix: mixKey=${seriesKeyFrom({ url: sourceIdentity, mixId, title, learnLlm: resolveManhuaTemplateLearnLlmProvider(process.env.MANHUA_TEMPLATE_LEARN_LLM_PROVIDER) })} urlKey=${seriesKeyFrom({ url: sourceIdentity, title })}`,
    );
  }

  const batchSize = clampManhuaLearnBatchSize(input.batchSize ?? MANHUA_LEARN_BATCH_DEFAULT);
  const learnLlm = input.learnLlm || resolveManhuaTemplateLearnLlmProvider(
    process.env.MANHUA_TEMPLATE_LEARN_LLM_PROVIDER,
  );
  // 列表接口可能才能回填真剧名；先用临时 key 建工作目录，
  // 取到 titleHint 后再按剧名核对已有系列。
  let seriesKey = seriesKeyFrom({ url: sourceIdentity, mixId, title, learnLlm });
  let workId = `tpl_series_${seriesKey}`;
  const rootTmp = await fs.mkdtemp(path.join(os.tmpdir(), `manhua-learn-pending-`));
  const progress = async (phase: string, detailZh: string) => {
    try {
      await input.onProgress?.(phase, detailZh);
    } catch {
      /* ignore */
    }
  };

  try {
    await progress(
      MANHUA_LEARN_STAGE.list,
      manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.list),
    );
    const listedRes: ListedEpisodesResult = sourceGcsUri
      ? {
          listed: listedSingleEpisodeFromUrl(
            url,
            title || String(input.fileName || "").replace(/\.[^.]+$/, "") || "手动导入视频",
            1,
          ),
          reliable: true,
        }
      : await listOrderedEpisodes(url, title || dramaNameZh, mixId, single);
    let listed = listedRes.listed;
    if (!listed.length) {
      throw new Error("无法解析任何可学剧集，请换合集页或成片链接重试");
    }
    if (!dramaNameZh && listedRes.mixNameZh) {
      dramaNameZh = stripBookTitleMarks(listedRes.mixNameZh);
    }
    // 剧名口径：用户手填 > 详情/合集接口回填的剧名（后者是单集路径「剧名恒空」的修复）
    const titleHint = title || dramaNameZh;
    seriesKey = await resolveManhuaSeriesKey({
      sourceIdentity,
      mixId,
      title: titleHint,
      learnLlm,
    });
    workId = `tpl_series_${seriesKey}`;

    // 同名剧已有分集时，单条大合集作为新的学习源追加；
    // 同一条源重跑则回到原集号，从断点续学。
    const existingDigests = await loadAllDigests(seriesKey);
    listed = placeSingleSourceInExistingSeries(listed, existingDigests);
    await progress(
      MANHUA_LEARN_STAGE.list,
      `已解析 ${listed.length} 个学习源${mixId && listed.length > 1 ? "（合集展开）" : ""}${dramaNameZh ? ` · 《${dramaNameZh}》` : ""}${existingDigests.length ? " · 已并入同名剧" : ""}`,
    );

    const seriesClassify = classifyManhuaLearnTitle(titleHint || "未命名合集");
    let prog =
      (await loadSeriesProgress(seriesKey)) ||
      ({
        seriesKey,
        sourceUrl: sourceIdentity,
        titleHint: titleHint || "未命名合集",
        learnLlm,
        mixId: mixId || undefined,
        listedEpisodeCount: listed.length,
        listedEpisodeIndexes: listedRes.reliable
          ? listed.map((e) => e.index).sort((a, b) => a - b)
          : undefined,
        learnedEpisodeIndexes: [],
        skippedEpisodeIndexes: [],
        updatedAt: new Date().toISOString(),
        dramaKind: seriesClassify.dramaKind,
        categoryLabelZh: seriesClassify.categoryLabelZh,
        tagLabelsZh: seriesClassify.tagLabelsZh,
      } satisfies ManhuaLearnSeriesProgress);

    // 与 GCS 已完成 digest 对齐，避免同链接重复下片撑爆容量/触发限流
    const completeIndexes = existingDigests
      .filter(isManhuaLearnEpisodeComplete)
      .map((d) => d.episodeIndex);
    prog = {
      ...prog,
      sourceUrl: sourceIdentity,
      // 旧进度若还挂着占位（未命名合集/贴链接学习），回填到手的真剧名
      titleHint: titleHint || cleanManhuaLearnTitle(prog.titleHint) || "未命名合集",
      // 只有可靠列表才并进可靠集合；降级列表不缩写也不污染历史
      listedEpisodeIndexes: listedRes.reliable
        ? Array.from(
            new Set([...(prog.listedEpisodeIndexes || []), ...listed.map((e) => e.index)]),
          ).sort((a, b) => a - b)
        : prog.listedEpisodeIndexes,
      listedEpisodeCount: listedRes.reliable
        ? Math.max(
            prog.listedEpisodeCount || 0,
            new Set([...(prog.listedEpisodeIndexes || []), ...listed.map((e) => e.index)]).size,
          )
        : prog.listedEpisodeCount || listed.length,
      mixId: mixId || prog.mixId || undefined,
      dramaKind: seriesClassify.dramaKind,
      categoryLabelZh: seriesClassify.categoryLabelZh,
      tagLabelsZh: seriesClassify.tagLabelsZh,
      learnedEpisodeIndexes: Array.from(
        new Set([...prog.learnedEpisodeIndexes, ...completeIndexes]),
      ).sort((a, b) => a - b),
      skippedEpisodeIndexes: (prog.skippedEpisodeIndexes || [])
        .filter((index) => !completeIndexes.includes(index)),
      updatedAt: new Date().toISOString(),
    };
    await writeJsonGcs(
      `manhua-template-learn/series/${seriesKey}/progress.json`,
      prog,
    );

    const listedIndexes = listed.map((e) => e.index);
    // 旗标优先级（固化语义）：refreshPreviewFrames > retrySkippedEpisodes > 常规续学；
    // 前端不会同传，两 true 时按补帧处理
    const batchIndexes = input.refreshPreviewFrames
      ? existingDigests
          .filter(isManhuaLearnEpisodeComplete)
          .map((digest) => digest.episodeIndex)
          .sort((a, b) => a - b)
          .slice(0, batchSize)
      : input.retrySkippedEpisodes
        ? pickRetrySkippedEpisodeIndexes({
            listedIndexes,
            skippedIndexes: prog.skippedEpisodeIndexes,
            learnedIndexes: prog.learnedEpisodeIndexes,
            batchSize,
          })
        : pickNextEpisodeIndexes({
            listedIndexes,
            learnedIndexes: prog.learnedEpisodeIndexes,
            skippedIndexes: prog.skippedEpisodeIndexes,
            batchSize,
          });
    if (input.retrySkippedEpisodes && !batchIndexes.length) {
      // 重试暂跳专属空批次：不落通用「已学完」文案（用户刚点了重试，得说清为什么没跑）
      return {
        seriesKey,
        analysisReady: false,
        learnedCount: prog.learnedEpisodeIndexes.length,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: 0,
        batchIndexes: [],
        listedEpisodeCount: prog.listedEpisodeCount || listed.length,
        skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length
          ? prog.skippedEpisodeIndexes
          : undefined,
        digestsPreview: existingDigests.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh: prog.skippedEpisodeIndexes?.length
          ? "暂跳集这次没有出现在合集列表里（或已学成），本轮未消耗任何模型成本；稍后再点「重试暂跳集」。"
          : "当前没有暂跳集需要重试。",
        workId,
      };
    }
    if (!batchIndexes.length) {
      const digestsAll = await loadAllDigests(seriesKey);
      const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
      if (
        canEmitManhuaLearnAnalysis(digests.length, {
          allListedComplete: isManhuaLearnListComplete(
            prog.listedEpisodeIndexes,
            digests.map((d) => d.episodeIndex),
          ),
        })
      ) {
        // 审查必须修12：三态读取——瞬时读取失败（GCS 抖动/鉴权/坏 JSON）不许当
        // 「文件不存在」去用启发式稿覆盖已批准/已润色的落盘提案；只有确认 404 才补写。
        const proposalObjectName = `manhua-template-learn/proposals/tpl_series_${seriesKey}.json`;
        const existingRead = await readJsonGcsDetailed<ManhuaViralTemplateCard>(proposalObjectName);
        if (existingRead.status === "error") {
          throw new Error(`提案读取暂时失败，请稍后重试（未覆盖已有提案）：${existingRead.errorNote}`);
        }
        if (existingRead.status === "found" && !parseManhuaViralTemplateCard(existingRead.value)) {
          // found-invalid（第五轮复审 P1·12）：落盘卡损坏不等于 404，
          // 用启发式稿覆盖会把已批准/已润色内容洗掉——报错等人工/下轮处理
          throw new Error("落盘提案存在但解析失败，已保留原文件未覆盖，请稍后重试或人工检查");
        }
        const existingParsed =
          existingRead.status === "found"
            ? parseManhuaViralTemplateCard(existingRead.value)
            : null;
        let proposal: ManhuaViralTemplateCard | null = null;
        let proposalGcsUri: string;
        let visionFilled = false;
        let noBatchMessage: string;
        if (existingParsed && existingParsed.status !== "proposed") {
          // 已批准/已拒绝：不再返回可批准的提案卡（客户端会显示死按钮、服务端必拒二次批准）
          proposalGcsUri = `gs://${gcsBucketHint()}/${proposalObjectName}`;
          proposal = null;
          visionFilled =
            existingParsed.provenance?.proposalPolish?.success === true &&
            (existingParsed.provenance?.frameVision?.successChunks ?? 0) > 0;
          noBatchMessage =
            existingParsed.status === "approved"
              ? `该系列模板已批准进库（累计 ${digests.length} 集），无需重复批准。`
              : `该系列提案此前已被拒绝（累计 ${digests.length} 集）；如需重出提案请继续学新集。`;
        } else if (existingParsed && existingParsed.provenance?.proposalPolish?.success === true) {
          proposal = existingParsed;
          proposalGcsUri = `gs://${gcsBucketHint()}/${proposalObjectName}`;
          // provenance 诚实化：落盘卡说了算；「模型已填」须润色成功且读帧真实成功过
          visionFilled =
            (existingParsed.provenance?.frameVision?.successChunks ?? 0) > 0;
          noBatchMessage = `已累计 ${digests.length} 集，分析提案已就绪（网页可预览后再决定是否进库）。`;
        } else {
          // 无卡或历史卡从未润色成功（老门槛年代欠的账 / 异常终止没走到收尾）：
          // 停止时润色拍板——这次统一补润色落盘，让用户能批准入库
          const polished = await polishAndPersistManhuaProposal({
            seriesKey,
            prog,
            digests,
            learnLlm,
            abortSignal: input.abortSignal,
          });
          proposal = polished.proposal;
          proposalGcsUri = polished.proposalGcsUri;
          visionFilled = polished.polishOk && polished.visionOk;
          noBatchMessage = polished.polishOk
            ? `已累计 ${digests.length} 集，总分析已补润色落盘，可预览后决定是否进库。`
            : `已累计 ${digests.length} 集，总分析已落盘（模型润色未成功，为启发式稿；重跑可再试）。`;
        }
        let proposalReadUrl: string | undefined;
        try {
          proposalReadUrl = signGsUriV4ReadUrl(proposalGcsUri, 7 * 24 * 3600);
        } catch {
          proposalReadUrl = undefined;
        }
        return {
          seriesKey,
          analysisReady: true,
          learnedCount: digests.length,
          analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
          analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
          batchLearned: 0,
          batchIndexes: [],
          listedEpisodeCount: listedRes.reliable ? Math.max(prog.listedEpisodeCount || 0, listed.length) : (prog.listedEpisodeCount || 0),
          skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length ? prog.skippedEpisodeIndexes : undefined,
          digestsPreview: digestsAll.map(toDigestPreview),
          categoryLabelZh: prog.categoryLabelZh,
          tagLabelsZh: prog.tagLabelsZh,
          proposal,
          proposalGcsUri,
          proposalReadUrl,
          visionFilled,
          messageZh: noBatchMessage,
          workId,
        };
      }
      // 单集/短合集：可学剧集已吃完仍不足总分析门槛 → 成功回显分集结果，不抛错
      return {
        seriesKey,
        analysisReady: false,
        learnedCount: digests.length,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: 0,
        batchIndexes: [],
        listedEpisodeCount: listedRes.reliable ? Math.max(prog.listedEpisodeCount || 0, listed.length) : (prog.listedEpisodeCount || 0),
        skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length ? prog.skippedEpisodeIndexes : undefined,
        digestsPreview: digestsAll.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          digests.length > 0
            ? `该链接可学剧集已学完（累计 ${digests.length} 集，列表共 ${listed.length} 集）。分集结果见下方。`
            : `该链接暂无可再学剧集（列表 ${listed.length} 集）。请换合集/成片链接重试。`,
        workId,
      };
    }

    const byIndex = new Map(listed.map((e) => [e.index, e]));
    const batchLearnedIndexes: number[] = [];
    const episodeFailNotes: string[] = [];
    // 手动叫停/abort：跳出学习循环但仍走收尾润色（停止时润色拍板）
    let cancelledMidRun = false;
    // 本轮真实开下的集数（用于集间礼貌间隔：第一集不等，跳过/已学过不计）
    let downloadedThisRun = 0;
    for (const idx of batchIndexes) {
      const ep = byIndex.get(idx);
      if (!ep) continue;
      const existing = await readJsonGcs<ManhuaLearnEpisodeDigest>(
        episodeObjectName(seriesKey, idx),
      );

      // 补帧是独立低成本路径：已学完成也要按用户请求补展示图；正常学习仍跳过。
      if (input.refreshPreviewFrames && existing && isManhuaLearnEpisodeComplete(existing)) {
        try {
          const repaired = await refreshEpisodePreviewFrames({
            seriesKey,
            ep,
            digest: existing,
            rootTmp,
            onProgress: input.onProgress,
            checkControl: input.checkControl,
            abortSignal: input.abortSignal,
          });
          await writeJsonGcs(episodeObjectName(seriesKey, idx), repaired);
          await input.onEpisodeCheckpoint?.(toDigestPreview(repaired));
          batchLearnedIndexes.push(idx);
          continue;
        } catch (e) {
          if (e instanceof Error && e.name === "ManhuaLearnCancelledError") {
            cancelledMidRun = true;
            break;
          }
          if (e instanceof Error && e.name === "ManhuaLearnSkipEpisodeError") throw e;
          const errZh = mapManhuaLearnFetchError(e);
          episodeFailNotes.push(`第 ${idx} 集静帧补抽失败：${errZh}`);
          await progress(MANHUA_LEARN_STAGE.failed, `第 ${idx} 集静帧补抽失败：${errZh}`);
          continue;
        }
      }
      // 已学完：跳过，不重下（防容量/限流）
      if (existing && isManhuaLearnEpisodeComplete(existing)) {
        if (!prog.learnedEpisodeIndexes.includes(idx)) {
          prog.learnedEpisodeIndexes = Array.from(
            new Set([...prog.learnedEpisodeIndexes, idx]),
          ).sort((a, b) => a - b);
          prog.updatedAt = new Date().toISOString();
          await writeJsonGcs(
            `manhua-template-learn/series/${seriesKey}/progress.json`,
            prog,
          );
        }
        await progress(
          MANHUA_LEARN_STAGE.persist,
          `第 ${idx} 集已学过，跳过重复学习`,
        );
        continue;
      }

      try {
        await assertManhuaLearnControl(input);
        // 集间礼貌间隔：只隔真实读取媒体流的相邻两集（跳过/已学过的不算）；
        // 期间每秒响应停止/跳过指令，不做任何伪装
        if (downloadedThisRun > 0) {
          const gapMs = pickManhuaLearnEpisodeGapMs(Math.random());
          await progress(
            MANHUA_LEARN_STAGE.download,
            `第 ${idx} 集将在 ${Math.round(gapMs / 1000)} 秒后开始（减轻来源压力）…`,
          );
          const gapEndAt = Date.now() + gapMs;
          while (Date.now() < gapEndAt) {
            await assertManhuaLearnControl(input);
            await new Promise((resolve) => setTimeout(resolve, Math.min(1000, gapEndAt - Date.now())));
          }
        }
        downloadedThisRun += 1;
        const digest = await learnOneEpisode({
          seriesKey,
          ep,
          titleHint: prog.titleHint,
          learnLlm,
          rootTmp,
          existing,
          onProgress: input.onProgress,
          checkControl: input.checkControl,
          abortSignal: input.abortSignal,
          onCheckpoint: async (partial) => {
            await writeJsonGcs(episodeObjectName(seriesKey, idx), partial);
            await input.onEpisodeCheckpoint?.(toDigestPreview(partial));
          },
        });
        await writeJsonGcs(episodeObjectName(seriesKey, idx), digest);
        if (!isManhuaLearnEpisodeComplete(digest)) {
          throw new Error(`第 ${idx} 集未学完（检查点已保留，可续学）`);
        }
        batchLearnedIndexes.push(idx);
        prog.learnedEpisodeIndexes = Array.from(
          new Set([...prog.learnedEpisodeIndexes, idx]),
        ).sort((a, b) => a - b);
        // 暂跳集重试成功 → 摘掉暂跳标记，别让它挂着「受限」误导续学口径
        prog.skippedEpisodeIndexes = (prog.skippedEpisodeIndexes || []).filter(
          (skipped) => skipped !== idx,
        );
        prog.updatedAt = new Date().toISOString();
        await writeJsonGcs(
          `manhua-template-learn/series/${seriesKey}/progress.json`,
          prog,
        );
        await progress(
          MANHUA_LEARN_STAGE.persist,
          `第 ${idx} 集整集学完（约 ${Math.round((digest.durationSec || 0) / 60)} 分钟 · 本轮新增 ${batchLearnedIndexes.length} · 累计 ${prog.learnedEpisodeIndexes.length} 集）`,
        );
      } catch (e) {
        if (e instanceof Error && e.name === "ManhuaLearnCancelledError") {
          // 停止≠报废（2026-08-11 拍板）：不再学新集，转入收尾润色让用户批准入库
          cancelledMidRun = true;
          await progress(
            MANHUA_LEARN_STAGE.persist,
            "已收到停止指令：不再学新集，正在对已学内容出总分析…",
          );
          break;
        }
        if (e instanceof Error && e.name === "ManhuaLearnSkipEpisodeError") {
          await progress(MANHUA_LEARN_STAGE.persist, `第 ${idx} 集已按要求跳过，继续下一集`);
          continue;
        }
        const errZh = mapManhuaLearnFetchError(e);
        const isPerm = errZh === MANHUA_LEARN_FETCH_ERR.permissionDenied
          || /权限不足/.test(errZh);
        const note = isPerm
          ? `第 ${idx} 集权限不足，已跳过`
          : `第 ${idx} 集失败已跳过：${errZh}`;
        episodeFailNotes.push(note);
        prog.skippedEpisodeIndexes = Array.from(
          new Set([...(prog.skippedEpisodeIndexes || []), idx]),
        ).sort((a, b) => a - b);
        prog.updatedAt = new Date().toISOString();
        await writeJsonGcs(
          `manhua-template-learn/series/${seriesKey}/progress.json`,
          prog,
        );
        console.warn(
          "[manhuaTemplateLearn] source unavailable → persist skip and continue:",
          idx,
          errZh,
        );
        await progress(MANHUA_LEARN_STAGE.failed, note);
      }
    }

    const skippedCount = prog.skippedEpisodeIndexes?.length || 0;
    const skippedHint = skippedCount > 0
      ? ` 当前有 ${skippedCount} 集因来源受限暂跳，不计入已学；续学将从后续集继续。`
      : "";
    const digestsAll = await loadAllDigests(seriesKey);
    const digests = digestsAll.filter(isManhuaLearnEpisodeComplete);
    const learnedCount = digests.length;
    const ready = canEmitManhuaLearnAnalysis(learnedCount, {
      allListedComplete: isManhuaLearnListComplete(
        prog.listedEpisodeIndexes,
        digests.map((d) => d.episodeIndex),
      ),
    });

    if (!ready) {
      const singleOrShort =
        listed.length < MANHUA_LEARN_ANALYSIS_MIN
          ? `当前链接共 ${listed.length} 集（单集也可学）。`
          : "";
      const failHint =
        episodeFailNotes.length > 0
          ? ` 另有 ${episodeFailNotes.length} 集未成功（见进度日志）。`
          : "";
      return {
        seriesKey,
        analysisReady: false,
        learnedCount,
        analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
        analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
        batchLearned: batchLearnedIndexes.length,
        batchIndexes: batchLearnedIndexes,
        listedEpisodeCount: listedRes.reliable ? Math.max(prog.listedEpisodeCount || 0, listed.length) : (prog.listedEpisodeCount || 0),
        skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length ? prog.skippedEpisodeIndexes : undefined,
        digestsPreview: digestsAll.map(toDigestPreview),
        categoryLabelZh: prog.categoryLabelZh,
        tagLabelsZh: prog.tagLabelsZh,
        proposal: null,
        proposalGcsUri: null,
        visionFilled: false,
        messageZh:
          `${cancelledMidRun ? "已按停止指令收尾：" : ""}本轮学了 ${batchLearnedIndexes.length} 集（未落视频文件），累计 ${learnedCount} 集。${singleOrShort}${failHint}${skippedHint}分集结果见下方；每学 1 集即可出草版总分析并入库（约 ${MANHUA_LEARN_ANALYSIS_MIN} 集更准），是否进库由你决定。`,
        workId,
      };
    }

    if (!cancelledMidRun) await assertManhuaLearnControl(input);
    await progress(
      MANHUA_LEARN_STAGE.analysis,
      manhuaLearnStageLabelZh(MANHUA_LEARN_STAGE.analysis),
    );
    // 修12 三态读取 + 停止时润色（2026-08-11 拍板）：已批准/已拒不覆盖不重润；
    // 已润色成功且本轮无新集 → 零模型成本沿用；其余（无卡/未润色/有新集）收尾润色一次
    const proposalObjectName = `manhua-template-learn/proposals/tpl_series_${seriesKey}.json`;
    const existingRead = await readJsonGcsDetailed<ManhuaViralTemplateCard>(proposalObjectName);
    if (existingRead.status === "error") {
      throw new Error(`提案读取暂时失败，请稍后重试（未覆盖已有提案）：${existingRead.errorNote}`);
    }
    if (existingRead.status === "found" && !parseManhuaViralTemplateCard(existingRead.value)) {
      throw new Error("落盘提案存在但解析失败，已保留原文件未覆盖，请稍后重试或人工检查");
    }
    const existingParsed =
      existingRead.status === "found" ? parseManhuaViralTemplateCard(existingRead.value) : null;
    const stoppedHint = cancelledMidRun ? "已按停止指令收尾：" : "";
    const baseResult = {
      seriesKey,
      analysisMin: MANHUA_LEARN_ANALYSIS_MIN,
      analysisTarget: MANHUA_LEARN_ANALYSIS_TARGET,
      learnedCount,
      batchLearned: batchLearnedIndexes.length,
      batchIndexes: batchLearnedIndexes,
      listedEpisodeCount: listedRes.reliable ? Math.max(prog.listedEpisodeCount || 0, listed.length) : (prog.listedEpisodeCount || 0),
      skippedEpisodeIndexes: prog.skippedEpisodeIndexes?.length ? prog.skippedEpisodeIndexes : undefined,
      digestsPreview: digestsAll.map(toDigestPreview),
      categoryLabelZh: prog.categoryLabelZh,
      tagLabelsZh: prog.tagLabelsZh,
      workId,
    };
    if (existingParsed && existingParsed.status !== "proposed") {
      // 已批准/已拒绝：不返回可批准卡（防死按钮/二次批准），也绝不覆盖
      return {
        ...baseResult,
        analysisReady: true,
        proposal: null,
        proposalGcsUri: `gs://${gcsBucketHint()}/${proposalObjectName}`,
        visionFilled:
          existingParsed.provenance?.proposalPolish?.success === true
          && (existingParsed.provenance?.frameVision?.successChunks ?? 0) > 0,
        messageZh: existingParsed.status === "approved"
          ? `${stoppedHint}本轮 +${batchLearnedIndexes.length} 集，该系列模板已批准进库，无需重复批准。${skippedHint}`
          : `${stoppedHint}本轮 +${batchLearnedIndexes.length} 集，该系列提案此前已被拒绝；如需重出请继续学新集。${skippedHint}`,
      };
    }
    let proposal: ManhuaViralTemplateCard;
    let proposalGcsUri: string;
    let polishOk: boolean;
    let visionOk: boolean;
    if (
      existingParsed
      && existingParsed.provenance?.proposalPolish?.success === true
      && batchLearnedIndexes.length === 0
    ) {
      // 无新集且已有润色成卡：沿用，零模型成本
      proposal = existingParsed;
      proposalGcsUri = `gs://${gcsBucketHint()}/${proposalObjectName}`;
      polishOk = true;
      visionOk = (existingParsed.provenance?.frameVision?.successChunks ?? 0) > 0;
    } else {
      const polished = await polishAndPersistManhuaProposal({
        seriesKey,
        prog,
        digests,
        learnLlm,
        // 停止收尾时 abortSignal 已被停止按钮触发，传入会让润色立刻中止
        abortSignal: cancelledMidRun ? undefined : input.abortSignal,
      });
      proposal = polished.proposal;
      proposalGcsUri = polished.proposalGcsUri;
      polishOk = polished.polishOk;
      visionOk = polished.visionOk;
    }
    let proposalReadUrl: string | undefined;
    try {
      proposalReadUrl = signGsUriV4ReadUrl(proposalGcsUri, 7 * 24 * 3600);
    } catch {
      proposalReadUrl = undefined;
    }

    return {
      ...baseResult,
      analysisReady: true,
      proposal,
      proposalGcsUri,
      proposalReadUrl,
      // provenance 诚实化（审查必须修13）：「模型已填」= 读帧真实成功过 且 润色成功
      visionFilled: polishOk && visionOk,
      messageZh: `${stoppedHint}本轮 +${batchLearnedIndexes.length} 集（未落视频文件），累计 ${learnedCount} 集，系列分析已可在网页预览${
        polishOk ? "" : "（本轮为启发式草稿，模型润色未成功）"
      }${visionOk ? "" : "（视觉读帧未成功，节奏点为启发式）"}${skippedHint}，是否进库由你决定。`,
    };
  } finally {
    await rmrf(rootTmp);
  }
}
