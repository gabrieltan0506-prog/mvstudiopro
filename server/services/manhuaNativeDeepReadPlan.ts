/**
 * 原生精读**发车计划预览**：抖音链接 → 这次要跑几集、几次模型请求、多少分钟。
 *
 * 🔴 **跑在服务端（Fly），密钥一步都不离开 Fly env。**
 * 解析要 `DOUYIN_COOKIE`，所以这件事天生属于服务端；做成本机脚本就等于
 * 要求把凭证下放到开发机，那是不可接受的外泄面。
 *
 * 全程**零模型调用**：合集展开走抖音 web api，时长走 ffprobe 读远端头部
 * （不下片、不转码），成本为零。确认预算使用 `totalModelCalls`；换代后
 * 每集视觉调用数=分片数、独立音频调用恒为 0，聚合照旧一次。
 *
 * 本文件不新写任何解析逻辑，只把素材接入层现成的能力串起来。
 */
import { isNativeDeepReadClaimReclaimable } from "./manhuaNativeDeepReadClaim.js";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { normalizeDouyinVideoUrl } from "../../shared/manhuaLearnYtdlp.js";
import {
  extractDouyinVideoIdFromUrl,
  isDouyinShortLinkUrl,
  extractDouyinMixIdFromUrl,
  type DouyinAwemeDetailParse,
  type DouyinListedEpisode,
} from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  NATIVE_DEEP_READ_MAX_EPISODE_SEC,
  NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
  NATIVE_DEEP_READ_BATCH_HARD_CEILING,
  validateNativeDeepReadBatchPlan,
} from "./manhuaNativeDeepReadExecution.js";
import { MANHUA_LEARN_MAX_DURATION_SEC } from "../../shared/manhuaTemplateLearnSeries.js";
import type { ManhuaTemplateLearnLlmProvider } from "../../shared/manhuaTemplateLearnFrameVision.js";
import {
  NATIVE_DEEP_READ_JOB_MAX_CALLS,
  NATIVE_DEEP_READ_DEFAULT_SEGMENT_SECONDS,
  parseNativeDeepReadSegmentSeconds,
  parseNativeDeepReadVideoFps,
} from "../../shared/manhuaNativeDeepReadJob.js";
import { isManhua0996SourceUrl } from "../../shared/manhuaLearn0996Source.js";
import {
  placeSingleSourceInExistingSeries,
  sameManhuaLearnEpisodeSource,
} from "../../shared/manhuaLearnSeriesIdentity.js";
import {
  NATIVE_DEEP_READ_MODEL,
  NATIVE_DEEP_READ_ROUTE_EVOLINK,
  NATIVE_DEEP_READ_ROUTE_VERTEX,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
  resolveNativeDeepReadRequestFps,
} from "./manhuaNativeDeepReadRunner.js";
import {
  MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
  MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
  MANHUA_NATIVE_SERIES_AGGREGATION_SCHEMA_VERSION,
} from "./manhuaNativeSeriesAggregation.js";

const execFileAsync = promisify(execFile);

type NativeDeepReadProbeExecutor = (
  command: string,
  args: string[],
  options: {
    maxBuffer: number;
    timeout: number;
    signal?: AbortSignal;
  },
) => Promise<{ stdout: string | Buffer }>;

/** CDN 要求带 Referer，素材接入层一路带着它；漏掉会被拒。 */
const DOUYIN_REFERER = "https://www.douyin.com/";

export type NativeDeepReadPlanSegment = { startSec: number; endSec: number };

export type NativeDeepReadPlanEpisode = {
  episodeIndex: number;
  sourceUrl: string;
  durationSec: number;
  /** 与本次任务确认值一致；尾片可短，其他分片必须严格按它计算。 */
  segmentSeconds?: number;
  videoFps?: number;
  segments: NativeDeepReadPlanSegment[];
  /** 该集是自动让位的失败重跑（执行时原子接管旧占位；段缓存让已成段零费） */
  reclaimFailedClaim?: boolean;
  /** 单集入口锚定的真实集；允许核对并复制旧版误写到其他集号的同源段缓存。 */
  recoverMisplacedSourceCache?: boolean;
  /** 同源 partial 续学：执行层必须采用本 episode 已恢复的原边界/fps，不按当前 UI 重切。 */
  resumeStoredSegmentPlan?: boolean;
};

export type NativeDeepReadPlanPreview = {
  planHash: string;
  /** 当前计划使用的分片长度；旧计划缺省时按 300 秒恢复。 */
  segmentSeconds?: number;
  videoFps?: number;
  seriesKey: string;
  dramaNameZh?: string;
  episodes: NativeDeepReadPlanEpisode[];
  totalSegments: number;
  /** Gemini 视觉调用数 = 分片数（每段一次调用，不再多段合包）。 */
  totalVisualCalls: number;
  /** 0826 换代后音轨由视觉调用直出：独立音频调用恒为 0。 */
  totalAudioChunks: number;
  totalModelCalls: number;
  totalDurationSec: number;
  /** 合集免费段总集数（不受 limit 影响，用来告诉用户「还能学多少」） */
  freeEpisodeCount: number;
  /** 从第几集起是付费集；没有付费边界时为空 */
  paywallStartEpisodeIndex?: number;
  /** 接口没给逐集付费信号的集号 —— unknown 不等于「已确认免费」 */
  unknownAccessEpisodeIndexes: number[];
  /** 已入库的集（不该重复付费） */
  alreadyIngestedEpisodeIndexes: number[];
  /** 仍隔离的占位集（无失败病历、疑似在跑）；不会自动重跑 */
  pendingClaimEpisodeIndexes: number[];
  /** 有失败病历的占位自动让位、纳入本轮重跑的集号 */
  reclaimEpisodeIndexes: number[];
  /** 扣掉已入库后真正会发出模型请求的集数 */
  executableEpisodeCount: number;
  /** 原生精读能力开关是否已开启；预览可在关闭时运行，执行不可以。 */
  executionEnabled: boolean;
};

export type NativeDeepReadPlanConfirmation = {
  planHash?: string;
  maxCalls: number;
  seriesKey?: string;
  segmentSeconds?: number;
  videoFps?: number;
};

/** worker 的最终确认门：必须在 claim 与任何模型调用之前执行。 */
export function assertNativeDeepReadPlanConfirmation(
  confirmed: NativeDeepReadPlanConfirmation,
  current: NativeDeepReadPlanPreview,
): void {
  if (!current.executionEnabled) throw new Error("原生精读能力未开启，未发出模型请求");
  if (parseNativeDeepReadVideoFps(confirmed.videoFps)
    !== parseNativeDeepReadVideoFps(current.videoFps)) {
    throw new Error("原生精读采样 fps 与任务参数不一致，未发出模型请求");
  }
  if (parseNativeDeepReadSegmentSeconds(confirmed.segmentSeconds)
    !== parseNativeDeepReadSegmentSeconds(current.segmentSeconds)) {
    throw new Error("原生精读分片时长与任务参数不一致，未发出模型请求");
  }
  if (current.episodes.length) {
    validateNativeDeepReadBatchPlan(
      current.episodes.map((episode) => ({ ...episode, resolveNodes: async () => [] })),
      {
        maxEpisodes: NATIVE_DEEP_READ_BATCH_HARD_CEILING,
        seriesKey: current.seriesKey,
        segmentSeconds: current.segmentSeconds,
      },
    );
  }
  const pendingClaims = new Set(current.pendingClaimEpisodeIndexes);
  const overlappingClaims = current.episodes
    .map((episode) => episode.episodeIndex)
    .filter((episodeIndex) => pendingClaims.has(episodeIndex));
  if (overlappingClaims.length) {
    throw new Error(
      `执行清单与第${overlappingClaims.join("、")}集待核对占位重叠，禁止自动重跑`,
    );
  }
  if (!current.episodes.length || current.totalModelCalls < 1) {
    // 0902 用户实测：重复学已入库视频时报「没有可执行的新集」是废话——
    // 用户干等以为链路卡死。已入库导致的空计划必须直说原因和下一步。
    if (!current.episodes.length && current.alreadyIngestedEpisodeIndexes.length) {
      throw new Error(
        `第${current.alreadyIngestedEpisodeIndexes.join("、")}集已学完入库（同一视频不重复学习、不重复付费）；` +
          "学习卡可在模板库查看，想学新内容请换未学过的视频链接",
      );
    }
    throw new Error("当前没有可执行的新集，未发出模型请求");
  }
  if (current.totalModelCalls > NATIVE_DEEP_READ_JOB_MAX_CALLS) {
    throw new Error(
      `本次 ${current.totalModelCalls} 次模型请求超过单任务上限 ${NATIVE_DEEP_READ_JOB_MAX_CALLS}，请拆批`,
    );
  }
  if (confirmed.planHash || confirmed.seriesKey) {
    if (
      current.planHash !== confirmed.planHash
      || current.totalModelCalls !== confirmed.maxCalls
      || current.seriesKey !== confirmed.seriesKey
    ) {
      throw new Error(
        `原生精读计划已变化（当前 ${current.planHash}/${current.totalModelCalls} 次），请重新建立任务`,
      );
    }
    return;
  }
  if (current.totalModelCalls > confirmed.maxCalls) {
    throw new Error(
      `本次 ${current.totalModelCalls} 次模型请求超过任务预算 ${confirmed.maxCalls}，请调小单次学习集数`,
    );
  }
}

/**
 * 按用户设置的整数秒切片，默认 300 秒；尾片完整保留，短集保持整集。
 * 每段一次 Gemini 调用，文件体积不改变分片边界。
 */
export const NATIVE_DEEP_READ_VISUAL_SEGMENT_SEC = NATIVE_DEEP_READ_DEFAULT_SEGMENT_SECONDS;
export function normalizeNativeDeepReadDurationSec(durationSec: number): number {
  return Math.max(1, Math.round(Number(durationSec) || 0));
}

/**
 * 0902 用户拍板「分片自动配平」：留空秒数时按集计算，让每片密度尽量一致、
 * 尾片不再吃零头（旧默认 300 固定切，1154 秒会切成 300×3+254 的瘸尾；
 * 配平后 段数=round(时长/300)、片长=ceil(时长/段数)＝289×4，与用户手算一致）。
 * 片长超过 360 秒（默认+20%）时加一段重配，避免短片整支单片超出读片甜区。
 */
export function balancedNativeDeepReadSegmentSeconds(durationSec: number): number {
  const total = normalizeNativeDeepReadDurationSec(durationSec);
  let n = Math.max(1, Math.round(total / NATIVE_DEEP_READ_DEFAULT_SEGMENT_SECONDS));
  let length = Math.ceil(total / n);
  if (length > NATIVE_DEEP_READ_DEFAULT_SEGMENT_SECONDS * 1.2) {
    n += 1;
    length = Math.ceil(total / n);
  }
  return length;
}

export function splitNativeDeepReadSegments(
  durationSec: number,
  segmentSeconds?: number,
): NativeDeepReadPlanSegment[] {
  const length = parseNativeDeepReadSegmentSeconds(segmentSeconds);
  // ffprobe 常返回小数秒；统一四舍五入后再切段，避免计划片长与末段终点相差近 1 秒。
  const total = normalizeNativeDeepReadDurationSec(durationSec);
  if (total > NATIVE_DEEP_READ_MAX_EPISODE_SEC) {
    throw new Error(`素材超过 ${Math.round(NATIVE_DEEP_READ_MAX_EPISODE_SEC / 60)} 分钟学习上限`);
  }
  if (Math.ceil(total / length) > 32) {
    throw new Error(`当前分片时长将产生 ${Math.ceil(total / length)} 片，超过单集 32 片上限，请增加分片秒数`);
  }
  const segments: NativeDeepReadPlanSegment[] = [];
  for (let startSec = 0; startSec < total; startSec += length) {
    segments.push({
      startSec,
      endSec: Math.min(total, startSec + length),
    });
  }
  return segments;
}

type NativeDeepReadIngestedPlanRecord = {
  episodeIndex: number;
  sourceUrl: string;
  complete: boolean;
  attemptedSegments?: number;
  completedSegmentIndexes?: number[];
  segmentSpans?: NativeDeepReadPlanSegment[];
  durationSec?: number;
  videoFps?: number;
};

function restoreNativeDeepReadPartialPlan(input: {
  episodeIndex: number;
  probedDurationSec: number;
  record: NativeDeepReadIngestedPlanRecord;
}): { durationSec: number; segments: NativeDeepReadPlanSegment[]; videoFps: number } {
  const durationSec = Number(input.record.durationSec);
  const attemptedSegments = Number(input.record.attemptedSegments);
  const segments = Array.isArray(input.record.segmentSpans)
    ? input.record.segmentSpans.map((span) => ({
        startSec: Number(span.startSec),
        endSec: Number(span.endSec),
      }))
    : [];
  const storedFps = input.record.videoFps;
  if (
    !Number.isFinite(durationSec)
    || durationSec <= 0
    || !Number.isInteger(attemptedSegments)
    || attemptedSegments < 1
    || segments.length !== attemptedSegments
    || storedFps == null
    || segments.some((span) =>
      !Number.isFinite(span.startSec)
      || !Number.isFinite(span.endSec)
      || span.startSec < 0
      || span.endSec <= span.startSec)
    || Math.abs(segments[0]?.startSec || 0) > 0.01
    || segments.some((span, index) =>
      index > 0 && Math.abs(span.startSec - segments[index - 1]!.endSec) > 0.01)
    || Math.abs((segments.at(-1)?.endSec || 0) - durationSec) > 0.01
  ) {
    throw new Error(`第${input.episodeIndex}集部分卡缺少完整原分片计划，已停止以避免重复付费`);
  }
  const videoFps = parseNativeDeepReadVideoFps(storedFps);
  const currentDurationSec = Number(input.probedDurationSec);
  // 历史普通计划把 ffprobe 小数秒四舍五入后保存；等分/精确计划则保存原始末端。
  // 两者最多相差 0.5 秒。超过该范围视为来源内容实际变化，不能复用旧 GCS 分片。
  if (!Number.isFinite(currentDurationSec) || Math.abs(currentDurationSec - durationSec) > 0.5) {
    throw new Error(
      `第${input.episodeIndex}集当前片长 ${currentDurationSec}s 与已学分片计划 ${durationSec}s 不一致，`
      + "疑似来源内容变化，已停止且未发出模型请求",
    );
  }
  return { durationSec, segments, videoFps };
}

/**
 * 计划确认码：worker 侧要用同样的输入重算并比对。
 *
 * 覆盖实际要处理的来源、集号、取整时长与分段。来源换了即使请求数相同，
 * 内容也已经不是用户确认的那一集，必须让确认码失效；标题等展示字段不参与。
 */
export function computeNativeDeepReadPlanHash(
  seriesKey: string,
  episodes: readonly NativeDeepReadPlanEpisode[],
): string {
  const canonical = JSON.stringify({
    seriesKey,
    visual: {
      version: NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
      model: NATIVE_DEEP_READ_MODEL,
      routes: [NATIVE_DEEP_READ_ROUTE_VERTEX, NATIVE_DEEP_READ_ROUTE_EVOLINK],
      defaultFps: resolveNativeDeepReadRequestFps(1),
      maxSegmentSec: NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
    },
    audio: { mode: "gemini_native_video_direct_v1" },
    seriesAggregation: {
      model: MANHUA_NATIVE_SERIES_AGGREGATION_MODEL,
      route: MANHUA_NATIVE_SERIES_AGGREGATION_ROUTE,
      schemaVersion: MANHUA_NATIVE_SERIES_AGGREGATION_SCHEMA_VERSION,
    },
    episodes: [...episodes]
      .sort((a, b) => a.episodeIndex - b.episodeIndex)
      .map((e) => ({
        i: e.episodeIndex,
        // 分享链的查询参数会变化；同一 aweme 用稳定视频 id，来源真的换集才让确认码失效。
        u: extractDouyinVideoIdFromUrl(e.sourceUrl) || e.sourceUrl,
        d: Math.floor(e.durationSec),
        l: parseNativeDeepReadSegmentSeconds(e.segmentSeconds),
        fps: parseNativeDeepReadVideoFps(e.videoFps),
        s: e.segments.map((g) => [Math.round(g.startSec), Math.round(g.endSec)]),
      })),
  });
  return createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

/**
 * 免费段截断：**只认逐集信号**。
 *
 * 合集层面的「含付费内容」总标记不能冒充逐集锁定 —— 一部剧前 20 集免费、
 * 后面付费，总标记会让整部剧看起来都不能学。
 * `unknown` 一律**不当作免费**，单独列出来让人看见。
 */
export function selectFreeEpisodesUpToPaywall(
  episodes: readonly DouyinListedEpisode[],
): {
  free: DouyinListedEpisode[];
  paywallStartEpisodeIndex?: number;
  unknownAccessEpisodeIndexes: number[];
} {
  const sorted = [...episodes].sort((a, b) => a.index - b.index);
  const paidAt = sorted.findIndex((e) => e.access === "paid_locked");
  // 只接受从第 1 条开始连续、明确标为 free 的前缀。unknown 不是免费，
  // 不能一边把它列为未知，一边仍写进付费执行计划。
  const firstUnconfirmedAt = sorted.findIndex((e) => e.access !== "free");
  const free = firstUnconfirmedAt >= 0 ? sorted.slice(0, firstUnconfirmedAt) : sorted;
  return {
    free,
    paywallStartEpisodeIndex: paidAt >= 0 ? sorted[paidAt]!.index : undefined,
    unknownAccessEpisodeIndexes: sorted
      .filter((e) => e.access !== "free" && e.access !== "paid_locked")
      .map((e) => e.index),
  };
}

/**
 * 读远端时长：ffprobe 直接读 CDN 直链的头部，**不下片**。
 *
 * 用直链而不是 `/video/` 页面地址 —— 页面是 HTML，ffprobe 读不了；
 * 旧链路那条 yt-dlp 元数据路同样要 cookie，服务端这边没必要再绕一次。
 */
export async function probeNativeDeepReadDurationSec(
  playbackUrl: string,
  abortSignal?: AbortSignal,
  execute: NativeDeepReadProbeExecutor = execFileAsync as NativeDeepReadProbeExecutor,
  referer = DOUYIN_REFERER,
): Promise<number> {
  if (abortSignal?.aborted) {
    throw abortSignal.reason instanceof Error
      ? abortSignal.reason
      : new Error("计划生成已停止");
  }
  let stdout: string | Buffer;
  try {
    ({ stdout } = await execute(
      "ffprobe",
      [
        "-v", "error",
        "-user_agent",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
        "-headers", `Referer: ${referer}\r\n`,
        // 单个坏节点不能把十集预演拖到请求超时；单位为微秒。
        "-rw_timeout", "15000000",
        "-show_entries", "format=duration",
        "-print_format", "json",
        "-i", playbackUrl,
      ],
      {
        maxBuffer: 8 * 1024 * 1024,
        timeout: 20_000,
        signal: abortSignal,
      },
    ));
  } catch {
    if (abortSignal?.aborted) {
      throw abortSignal.reason instanceof Error
        ? abortSignal.reason
        : new Error("计划生成已停止");
    }
    // execFile 的原始 message 含完整签名 URL，禁止进入日志或 owner 面板。
    throw new Error("播放节点探测失败（地址失效、节点拒绝或读取超时）");
  }
  let parsed: { format?: { duration?: string | number } };
  try {
    parsed = JSON.parse(String(stdout || "{}")) as { format?: { duration?: string | number } };
  } catch {
    throw new Error("播放节点返回了无效媒体信息");
  }
  const sec = Number(parsed.format?.duration);
  if (!Number.isFinite(sec) || sec <= 0) throw new Error("读不到成片时长");
  return sec;
}

function throwIfNativePlanAborted(abortSignal?: AbortSignal): void {
  if (!abortSignal?.aborted) return;
  throw abortSignal.reason instanceof Error
    ? abortSignal.reason
    : new Error("计划生成已停止");
}

/**
 * 每集按「列表候选 → 详情刷新候选」切换节点。
 *
 * 抖音同一视频会返回主播放、下载地址与多码率镜像；某一条失败不代表整集不可读。
 * 这里只探元数据，不猜时长，也不把失败候选继续交给付费链路。
 */
async function probeEpisodeDurationWithCandidateFailover(
  episode: DouyinListedEpisode,
  deps: Pick<
    NativeDeepReadPlanDeps,
    "probeDurationSec" | "refreshPlaybackUrls" | "refreshSourcePlayback"
  >,
  abortSignal?: AbortSignal,
): Promise<number> {
  const tried = new Set<string>();
  const probeCandidates = async (
    candidates: readonly string[],
    referer?: string,
  ): Promise<number | null> => {
    const unique: string[] = [];
    for (const raw of candidates) {
      const url = String(raw || "").trim();
      if (!url || tried.has(url) || unique.includes(url)) continue;
      unique.push(url);
    }
    for (let index = 0; index < unique.length; index += 1) {
      throwIfNativePlanAborted(abortSignal);
      const candidate = unique[index]!;
      tried.add(candidate);
      try {
        return await (referer
          ? deps.probeDurationSec(candidate, abortSignal, referer)
          : deps.probeDurationSec(candidate, abortSignal));
      } catch {
        throwIfNativePlanAborted(abortSignal);
        console.warn(
          "[manhuaNativeDeepReadPlan] playback candidate failed:",
          `episode=${episode.index}`,
          `candidate=${index + 1}/${unique.length}`,
        );
      }
    }
    return null;
  };

  const initial = [
    ...(episode.playbackUrls || []),
    ...(episode.playbackUrl ? [episode.playbackUrl] : []),
  ];
  const directDuration = await probeCandidates(initial);
  if (directDuration != null) return directDuration;

  throwIfNativePlanAborted(abortSignal);
  const awemeId = extractDouyinVideoIdFromUrl(episode.url);
  let refreshed: string[] = [];
  let refreshedReferer: string | undefined;
  if (awemeId) {
    try {
      refreshed = await deps.refreshPlaybackUrls(awemeId);
    } catch {
      console.warn(
        "[manhuaNativeDeepReadPlan] playback refresh failed:",
        `episode=${episode.index}`,
      );
    }
  } else if (deps.refreshSourcePlayback) {
    try {
      const source = await deps.refreshSourcePlayback(episode.url, abortSignal);
      refreshed = source.playbackUrls;
      refreshedReferer = source.referer;
    } catch {
      console.warn(
        "[manhuaNativeDeepReadPlan] external playback refresh failed:",
        `episode=${episode.index}`,
      );
    }
  }
  const refreshedDuration = await probeCandidates(refreshed, refreshedReferer);
  if (refreshedDuration != null) return refreshedDuration;

  throw new Error(
    `第${episode.index}集所有媒体节点暂不可读，已停止；未发出模型请求，请稍后重试`,
  );
}

export type NativeDeepReadPlanDeps = {
  /** 0902：v./vm.douyin.com 短链服务端自动展开；解不开返回 null 走既有报错 */
  resolveShortLink?: (url: string) => Promise<string | null>;
  fetchAwemeDetail: (awemeId: string) => Promise<DouyinAwemeDetailParse | null>;
  listMixEpisodes: (mixId: string) => Promise<{
    episodes: DouyinListedEpisode[];
    mixNameZh?: string;
    complete: boolean;
  } | null>;
  refreshPlaybackUrls: (awemeId: string) => Promise<string[]>;
  refreshSourcePlayback?: (
    sourceUrl: string,
    abortSignal?: AbortSignal,
  ) => Promise<{ playbackUrls: string[]; referer?: string }>;
  resolveExternalSeries?: (
    sourceUrl: string,
    abortSignal?: AbortSignal,
  ) => Promise<{
    sourceIdentity: string;
    seriesId: string;
    titleZh: string;
    currentEpisodeIndex: number;
    episodes: DouyinListedEpisode[];
  }>;
  isExternalSource?: (sourceUrl: string) => boolean;
  probeDurationSec: (
    playbackUrl: string,
    abortSignal?: AbortSignal,
    referer?: string,
  ) => Promise<number>;
  /**
   * 旧调用方只提供整集完成集合；生产运行时应提供下方完整记录，才能让同一单源
   * 在部分分片恢复时回到原集号，而不是先按 ep1 出计划、执行时才改成 epN。
   */
  listIngestedEpisodes?: (seriesKey: string) => Promise<Set<number>>;
  listIngestedEpisodeRecords?: (
    seriesKey: string,
  ) => Promise<NativeDeepReadIngestedPlanRecord[]>;
  listClaimStates: (seriesKey: string) => Promise<
    Map<number, {
      createdAtIso: string | null;
      lastErrorZh?: string | null;
      lastFailedAtIso: string | null;
    }>
  >;
  resolveSeriesKey: (input: {
    sourceIdentity: string;
    mixId: string;
    title?: string;
    learnLlm: ManhuaTemplateLearnLlmProvider;
  }) => Promise<string>;
  isExecutionEnabled: () => boolean;
};

export async function buildNativeDeepReadPlanPreview(
  input: {
    url: string;
    limit: number;
    segmentSeconds?: number;
    videoFps?: number;
    /**
     * 0901 用户令「整支即全集」：这条视频本身就是完整一季的长片。勾选后忽略
     * URL/详情里的 mixId、跳过合集展开（那个端点正被抖音 Argus 风控单独上锁），
     * 按独立长视频单集进入自定义分片链。身份仍只绑 awemeId，不与同名剧串库。
     */
    treatAsStandalone?: boolean;
    allowPartial?: boolean;
    learnLlm?: ManhuaTemplateLearnLlmProvider;
    abortSignal?: AbortSignal;
  },
  deps: NativeDeepReadPlanDeps,
): Promise<NativeDeepReadPlanPreview> {
  // 在解析远程来源之前拒绝非法设置，避免建单后才发现时长输入不可用。
  // 留空＝按集自动配平；填了数就全程尊重用户的值
  const autoBalanceSegments = input.segmentSeconds == null;
  const segmentSeconds = parseNativeDeepReadSegmentSeconds(input.segmentSeconds);
  const videoFps = parseNativeDeepReadVideoFps(input.videoFps);
  /**
   * 0826 回归修复：面板会放行带 modal_id 的搜索页，但原始长 URL 一路透传给下游
   * （sourceIdentity/各消费方），形态不认就死。入口先规范化成 /video/<id> 标准形态
   * （modal_id 弹层链 → 单集页；其余原样返回），下游只见规范 URL。
   */
  let rawUrl = String(input.url || "").trim();
  // 0902：App 分享短链先展开成 /share/video/<id> 形态，用户不用再开浏览器倒一手
  if (deps.resolveShortLink && isDouyinShortLinkUrl(rawUrl)) {
    const expandedUrl = await deps.resolveShortLink(rawUrl).catch(() => null);
    if (expandedUrl && expandedUrl.trim()) rawUrl = expandedUrl.trim();
  }
  const isExternal = deps.isExternalSource?.(rawUrl) === true
    || isManhua0996SourceUrl(rawUrl);
  const external = isExternal && deps.resolveExternalSeries
    ? await deps.resolveExternalSeries(rawUrl, input.abortSignal)
    : null;
  const url = external?.sourceIdentity || normalizeDouyinVideoUrl(rawUrl);
  const limit = Math.max(1, Math.min(NATIVE_DEEP_READ_BATCH_HARD_CEILING, Math.floor(input.limit)));

  // ── 1. 链接 → 合集 id（搜索页的 modal_id 由 extractDouyinVideoIdFromUrl 处理）
  const sourceAwemeId = external ? null : extractDouyinVideoIdFromUrl(url);
  const treatAsStandalone = input.treatAsStandalone === true && !external;
  if (treatAsStandalone && !sourceAwemeId) {
    throw new Error("勾选了「整支即全集」但链接里没有视频 id（modal_id）；请给出该视频本身的链接");
  }
  let mixId = treatAsStandalone
    ? ""
    : external?.seriesId || extractDouyinMixIdFromUrl(url) || "";
  let dramaNameZh = external?.titleZh || "";
  let detailEpisodeIndex: number | undefined = external?.currentEpisodeIndex;
  let standaloneSource = false;
  let listed: {
    episodes: DouyinListedEpisode[];
    mixNameZh?: string;
    complete: boolean;
  } | null = external
    ? { episodes: external.episodes, mixNameZh: external.titleZh, complete: true }
    : null;
  if (!external && !mixId) {
    if (!sourceAwemeId) throw new Error("这个链接里没有 modal_id / 视频 id / 合集 id，认不出是哪一部");
    const detail = await deps.fetchAwemeDetail(sourceAwemeId);
    if (!detail) throw new Error("这条视频的详情暂时无法读取，请稍后重试");
    if (detail.mixId && !treatAsStandalone) {
      mixId = detail.mixId;
      dramaNameZh = detail.mixNameZh || "";
      const parsedEpisodeIndex = Number(detail.episodeIndex);
      if (Number.isInteger(parsedEpisodeIndex) && parsedEpisodeIndex > 0) {
        detailEpisodeIndex = parsedEpisodeIndex;
      }
    } else {
      // 抖音近期大量“全集/完整版”长视频不再挂官方 mix_info，但详情仍返回
      // 免费媒体流。它不是坏搜索页，应作为一个独立长学习源进入同一条自定义时长
      // 分片链；身份只绑定 awemeId，绝不凭标题猜合集或与同名剧串库。
      const playbackUrls = Array.from(new Set([
        ...(detail.playbackUrls || []),
        ...(detail.playbackUrl ? [detail.playbackUrl] : []),
      ].map((item) => String(item || "").trim()).filter(Boolean)));
      if (!playbackUrls.length) {
        throw new Error("这条视频没有官方合集，也没有可读取的媒体流，请稍后重试");
      }
      standaloneSource = true;
      detailEpisodeIndex = 1;
      dramaNameZh = detail.titleZh || "";
      listed = {
        episodes: [{
          index: 1,
          url,
          title: detail.titleZh || "第1集",
          playbackUrl: playbackUrls[0],
          playbackUrls,
          // 媒体可读不等于已经取得免费授权；付费状态必须原样进入统一门禁。
          // 只有明确 free 才会执行，unknown / 缺失 / paid_locked 都关闭式停止。
          access: detail.access,
        }],
        mixNameZh: detail.titleZh || undefined,
        complete: true,
      };
    }
  }

  // ── 2. 合集展开
  if (!listed) listed = await deps.listMixEpisodes(mixId);
  if (!listed?.episodes?.length) {
    const blockedZh = (listed as { riskControlBlockedZh?: string } | null)?.riskControlBlockedZh;
    throw new Error(blockedZh
      ? `${blockedZh}：可勾选「整支即全集」，或更新 DOUYIN_COOKIE`
      : "合集展开失败或没有分集，请稍后重试");
  }
  dramaNameZh = listed.mixNameZh || dramaNameZh;

  /**
   * 🔴 没拉到底就不出计划。
   *
   * 分页没拉全时集号可能整体错位（看着是第 10 集，实际是第 12 集），
   * 而集号是入库去重的唯一凭证 —— 错位会让「已学过」判断整体失效，
   * 直接后果是重复付费。列不全＝无法证明完整。
   */
  if (!listed.complete && !input.allowPartial) {
    throw new Error(
      `合集只展开了 ${listed.episodes.length} 集且未拉到底，集号可能整体错位，已停止。请稍后重试`,
    );
  }

  /**
   * 单集详情页不是“从合集里随便挑下一集”的入口。它已经明确指向一条 aweme，
   * 必须由详情 current_episode / 合集里同 aweme 的位置锚定真实集号。历史失败次数、
   * claim 数量或前面有几条占位，都不得把第一集改写成第十集。
   */
  const listedSourceEpisode = external
    ? listed.episodes.find((episode) => episode.index === external.currentEpisodeIndex)
    : sourceAwemeId
    ? listed.episodes.find(
        (episode) => extractDouyinVideoIdFromUrl(episode.url) === sourceAwemeId,
      )
    : undefined;
  const isSingleEpisodeEntry = Boolean(sourceAwemeId || external);
  if (isSingleEpisodeEntry && !listedSourceEpisode) {
    throw new Error("单集视频不在解析出的合集列表中，已停止；不会只按详情序号执行另一条视频");
  }
  if (
    detailEpisodeIndex
    && listedSourceEpisode
    && detailEpisodeIndex !== listedSourceEpisode.index
  ) {
    throw new Error(
      `单集详情标为第${detailEpisodeIndex}集，但合集列表标为第${listedSourceEpisode.index}集，已停止以免写错集号`,
    );
  }
  let sourceEpisodeIndex = listedSourceEpisode?.index ?? detailEpisodeIndex;
  if (isSingleEpisodeEntry && !sourceEpisodeIndex) {
    throw new Error("单集详情与合集列表都没有可靠集号，已停止；不会按历史次数猜集号");
  }

  // ── 3. 读到付费集就停
  const freeSelection = selectFreeEpisodesUpToPaywall(listed.episodes);
  let free = freeSelection.free;
  const { paywallStartEpisodeIndex, unknownAccessEpisodeIndexes } = freeSelection;
  if (!free.length) {
    if (unknownAccessEpisodeIndexes.length) {
      throw new Error("第1集缺少明确免费信号，已停止；unknown 不能作为免费集执行");
    }
    throw new Error("这部剧第一集就是付费集，没有可学的免费集");
  }

  const seriesKey = await deps.resolveSeriesKey({
    sourceIdentity: url,
    mixId,
    // 无 mix_info 的独立视频必须按 awemeId 隔离；标题只是展示信息，不能参与
    // 同名剧归并，否则两条同名“完整版”会共享 claim/缓存并静默覆盖。
    title: standaloneSource ? undefined : dramaNameZh || undefined,
    learnLlm: input.learnLlm || "gpt",
  });
  if (!deps.listIngestedEpisodeRecords && !deps.listIngestedEpisodes) {
    throw new Error("原生精读计划缺少已入库记录读取器，未发出模型请求");
  }
  const [ingestedState, claimStates] = await Promise.all([
    deps.listIngestedEpisodeRecords
      ? deps.listIngestedEpisodeRecords(seriesKey).then((records) => ({
          records,
          complete: new Set(
            records.filter((record) => record.complete).map((record) => record.episodeIndex),
          ),
        }))
      : deps.listIngestedEpisodes!(seriesKey).then((complete) => ({
          records: [] as NativeDeepReadIngestedPlanRecord[],
          complete,
        })),
    deps.listClaimStates(seriesKey),
  ]);
  const ingested = ingestedState.complete;

  /**
   * 与真正执行入口共用同一套单源安放规则。
   *
   * 同名剧中的长合集可能早已被安放到 ep7；若上次只完成部分分片，complete 集合
   * 不含 ep7。旧计划因此仍按列表临时值 ep1 出确认码，真正执行入口随后依据卡片
   * sourceUrl 改回 ep7，最终复核必然失败，GCS 段缓存也永远没有机会命中。
   * 这里同时纳入 partial 与 complete 记录，只改集号，不把 partial 当整集完成。
   */
  if (isSingleEpisodeEntry && listed.episodes.length === 1 && ingestedState.records.length) {
    free = placeSingleSourceInExistingSeries(
      free,
      ingestedState.records.map((record) => ({
        episodeIndex: record.episodeIndex,
        url: record.sourceUrl,
      })),
      { sourceIdentity: url },
    );
    if (free.length === 1) sourceEpisodeIndex = free[0]!.index;
  }

  // ── 4. 逐集探时长（零模型调用）
  // “学 N 集”指接下来新增 N 集，不是永远只看合集前 N 集。
  // 残留 claim 必须继续隔离，但不能占掉用户要求的名额：先排除已入库与 claim，再取 N 集。
  // 每个真正执行的集仍会在模型调用前原子抢 claim；这里没有放松并发保护。
  const sourceScopedFree = sourceEpisodeIndex
    ? free.filter((episode) => episode.index >= sourceEpisodeIndex)
    : free;
  if (sourceEpisodeIndex && !sourceScopedFree.some((episode) => episode.index === sourceEpisodeIndex)) {
    throw new Error(`解析到第${sourceEpisodeIndex}集，但该集不在可学习免费段内，已停止`);
  }
  const notIngested = sourceScopedFree.filter((e) => !ingested.has(e.index));
  /**
   * 0826 用户拍板「失败占位不许永远挡路」：带失败病历的占位自动让位、
   * 本轮直接纳入重跑（执行时原子接管，段缓存让已成段零费）；
   * 新鲜无病历的占位可能仍在跑，继续隔离防并发双跑。
   */
  const reclaimSet = new Set<number>();
  const blockedSet = new Set<number>();
  for (const e of notIngested) {
    const state = claimStates.get(e.index);
    if (!state) continue;
    if (isNativeDeepReadClaimReclaimable(state)) reclaimSet.add(e.index);
    else blockedSet.add(e.index);
  }
  const pendingClaimEpisodeIndexes = notIngested
    .map((row) => row.index)
    .filter((i) => blockedSet.has(i));
  let executable: DouyinListedEpisode[];
  if (sourceEpisodeIndex) {
    // 单集入口按解析集号向后连续取 N 集；区间内若有健康占位就明确阻塞，
    // 不能静默跳过它再把后集冒充成本次目标。
    const intended = notIngested.slice(0, limit);
    const blockedIntended = intended.filter((episode) => blockedSet.has(episode.index));
    if (blockedIntended.length) {
      throw new Error(
        `第${blockedIntended.map((episode) => episode.index).join("、")}集已有精读任务占位且无失败病历，疑似仍在处理；已停止，不会跳号`,
      );
    }
    executable = intended;
  } else {
    // 合集入口仍保留“学习接下来 N 个未占用集”的既有语义。
    executable = notIngested
      .filter((e) => !blockedSet.has(e.index))
      .slice(0, limit);
  }
  const episodes: NativeDeepReadPlanEpisode[] = [];
  for (const e of executable) {
    throwIfNativePlanAborted(input.abortSignal);
    const probedDurationSec = await probeEpisodeDurationWithCandidateFailover(
      e,
      deps,
      input.abortSignal,
    );
    const sameEpisodeRecord = ingestedState.records.find((record) =>
      record.episodeIndex === e.index && !record.complete);
    if (
      sameEpisodeRecord
      && !sameManhuaLearnEpisodeSource(sameEpisodeRecord.sourceUrl, e.url)
    ) {
      throw new Error(`第${e.index}集已有另一来源的部分学习卡，已停止以避免覆盖或重复付费`);
    }
    const restored = sameEpisodeRecord
      ? restoreNativeDeepReadPartialPlan({
          episodeIndex: e.index,
          probedDurationSec,
          record: sameEpisodeRecord,
        })
      : undefined;
    const durationSec = restored?.durationSec
      ?? normalizeNativeDeepReadDurationSec(probedDurationSec);
    if (durationSec > MANHUA_LEARN_MAX_DURATION_SEC) {
      throw new Error(
        `第${e.index}集超过 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，超出学习策略上限`,
      );
    }
    const episodeSegmentSeconds = autoBalanceSegments
      ? balancedNativeDeepReadSegmentSeconds(durationSec)
      : segmentSeconds;
    episodes.push({
      episodeIndex: e.index,
      sourceUrl: e.url,
      durationSec,
      segmentSeconds: episodeSegmentSeconds,
      videoFps: restored?.videoFps ?? videoFps,
      segments: restored?.segments ?? splitNativeDeepReadSegments(durationSec, episodeSegmentSeconds),
      ...(reclaimSet.has(e.index) ? { reclaimFailedClaim: true } : {}),
      ...(sourceEpisodeIndex === e.index ? { recoverMisplacedSourceCache: true } : {}),
      ...(restored ? { resumeStoredSegmentPlan: true } : {}),
    });
  }

  // ── 5. 用发车脚本同一个校验器验一遍
  const plan = episodes.length
    ? validateNativeDeepReadBatchPlan(
        episodes.map((e) => ({ ...e, resolveNodes: async () => [] })),
        // 自动配平时不下发批级片长，让校验与执行按每集自己的 segmentSeconds 走
        { maxEpisodes: limit, seriesKey, ...(autoBalanceSegments ? {} : { segmentSeconds }) },
      )
    : null;

  return {
    planHash: plan?.planHash || computeNativeDeepReadPlanHash(seriesKey, episodes),
    // 自动配平时计划级不落统一片长（每集各带自己的值），执行/复核层据此走 per-episode
    ...(autoBalanceSegments ? {} : { segmentSeconds }),
    videoFps,
    seriesKey,
    dramaNameZh: dramaNameZh || undefined,
    episodes,
    totalSegments: plan?.totalSegments || 0,
    totalVisualCalls: plan?.totalVisualCalls || 0,
    totalAudioChunks: plan?.totalAudioChunks || 0,
    totalModelCalls: plan?.totalModelCalls || 0,
    totalDurationSec: Math.round(episodes.reduce((s, e) => s + e.durationSec, 0)),
    freeEpisodeCount: free.length,
    paywallStartEpisodeIndex,
    unknownAccessEpisodeIndexes,
    alreadyIngestedEpisodeIndexes: free
      .map((e) => e.index)
      .filter((i) => ingested.has(i)),
    pendingClaimEpisodeIndexes,
    reclaimEpisodeIndexes: episodes
      .filter((row) => row.reclaimFailedClaim)
      .map((row) => row.episodeIndex),
    executableEpisodeCount: episodes.length,
    executionEnabled: deps.isExecutionEnabled(),
  };
}

/** 面板计划摘要：把实际采用的自定义上限与尾片长度说清楚。 */
export function describeNativeDeepReadSegmentPlanZh(
  plan: Pick<NativeDeepReadPlanPreview, "segmentSeconds" | "episodes">,
): string {
  const fallbackSeconds = parseNativeDeepReadSegmentSeconds(plan.segmentSeconds);
  const episodesZh = plan.episodes.map((episode) => {
    const episodeSeconds = episode.segmentSeconds ?? fallbackSeconds;
    const count = episode.segments.length;
    const tail = episode.segments.at(-1);
    const tailSeconds = tail
      ? Math.round((tail.endSec - tail.startSec) * 100) / 100
      : 0;
    return count <= 1
      ? `第 ${episode.episodeIndex} 集 1 片（整片 ${tailSeconds} 秒）`
      : `第 ${episode.episodeIndex} 集 ${count} 片（前 ${count - 1} 片各 ${episodeSeconds} 秒，尾片 ${tailSeconds} 秒）`;
  });
  const perEpisode = new Set(plan.episodes.map((episode) => episode.segmentSeconds ?? fallbackSeconds));
  const headZh = perEpisode.size > 1
    ? "分片按集自动配平"
    : `分片上限 ${Array.from(perEpisode)[0] ?? fallbackSeconds} 秒`;
  return `${headZh}${episodesZh.length ? ` · ${episodesZh.join("；")}` : ""}`;
}
