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
  extractDouyinMixIdFromUrl,
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
import { NATIVE_DEEP_READ_JOB_MAX_CALLS } from "../../shared/manhuaNativeDeepReadJob.js";
import {
  NATIVE_DEEP_READ_MODEL,
  NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES,
  NATIVE_DEEP_READ_ROUTE_EVOLINK,
  NATIVE_DEEP_READ_ROUTE_VERTEX,
  NATIVE_DEEP_READ_VISUAL_PLAN_VERSION,
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
  segments: NativeDeepReadPlanSegment[];
  /** 该集是自动让位的失败重跑（执行时原子接管旧占位；段缓存让已成段零费） */
  reclaimFailedClaim?: boolean;
};

export type NativeDeepReadPlanPreview = {
  planHash: string;
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
  /** 失败/超时占位自动让位、纳入本轮重跑的集号 */
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
};

/** worker 的最终确认门：必须在 claim 与任何模型调用之前执行。 */
export function assertNativeDeepReadPlanConfirmation(
  confirmed: NativeDeepReadPlanConfirmation,
  current: NativeDeepReadPlanPreview,
): void {
  if (!current.executionEnabled) throw new Error("原生精读能力未开启，未发出模型请求");
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
 * 每个视觉输入片目标不超过 6 分钟：90 秒短集保持整集，18 分钟长集拆 3 片。
 * runner 按两档 fps 取样：段长 ≤180s→10fps，否则 5fps（360s×5=1800 帧贴满预算）。
 * 换代后**每段一次 Gemini 调用**，不再多段合包（分段调用停在低价档）。
 */
export const NATIVE_DEEP_READ_VISUAL_SEGMENT_SEC = 6 * 60;
export function normalizeNativeDeepReadDurationSec(durationSec: number): number {
  return Math.max(1, Math.round(Number(durationSec) || 0));
}

export function splitNativeDeepReadSegments(durationSec: number): NativeDeepReadPlanSegment[] {
  // ffprobe 常返回小数秒；统一四舍五入后再切段，避免计划片长与末段终点相差近 1 秒。
  const total = normalizeNativeDeepReadDurationSec(durationSec);
  if (total > NATIVE_DEEP_READ_MAX_EPISODE_SEC) {
    throw new Error(`素材超过 ${Math.round(NATIVE_DEEP_READ_MAX_EPISODE_SEC / 60)} 分钟学习上限`);
  }
  const segments: NativeDeepReadPlanSegment[] = [];
  for (let startSec = 0; startSec < total; startSec += NATIVE_DEEP_READ_VISUAL_SEGMENT_SEC) {
    segments.push({
      startSec,
      endSec: Math.min(total, startSec + NATIVE_DEEP_READ_VISUAL_SEGMENT_SEC),
    });
  }
  return segments;
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
      fpsTiers: { shortMaxSec: 180, shortFps: 10, longFps: 5 },
      maxSegmentSec: NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
      mediaBudgetBytes: NATIVE_DEEP_READ_REQUEST_MEDIA_BUDGET_BYTES,
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
        "-headers", `Referer: ${DOUYIN_REFERER}\r\n`,
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
  deps: Pick<NativeDeepReadPlanDeps, "probeDurationSec" | "refreshPlaybackUrls">,
  abortSignal?: AbortSignal,
): Promise<number> {
  const tried = new Set<string>();
  const probeCandidates = async (candidates: readonly string[]): Promise<number | null> => {
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
        return await deps.probeDurationSec(candidate, abortSignal);
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
  if (awemeId) {
    try {
      refreshed = await deps.refreshPlaybackUrls(awemeId);
    } catch {
      console.warn(
        "[manhuaNativeDeepReadPlan] playback refresh failed:",
        `episode=${episode.index}`,
      );
    }
  }
  const refreshedDuration = await probeCandidates(refreshed);
  if (refreshedDuration != null) return refreshedDuration;

  throw new Error(
    `第${episode.index}集所有媒体节点暂不可读，已停止；未发出模型请求，请稍后重试`,
  );
}

export type NativeDeepReadPlanDeps = {
  fetchAwemeDetail: (awemeId: string) => Promise<{ mixId?: string; mixNameZh?: string } | null>;
  listMixEpisodes: (mixId: string) => Promise<{
    episodes: DouyinListedEpisode[];
    mixNameZh?: string;
    complete: boolean;
  } | null>;
  refreshPlaybackUrls: (awemeId: string) => Promise<string[]>;
  probeDurationSec: (playbackUrl: string, abortSignal?: AbortSignal) => Promise<number>;
  listIngestedEpisodes: (seriesKey: string) => Promise<Set<number>>;
  listClaimStates: (seriesKey: string) => Promise<
    Map<number, { createdAtIso: string | null; lastFailedAtIso: string | null }>
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
    allowPartial?: boolean;
    learnLlm?: ManhuaTemplateLearnLlmProvider;
    abortSignal?: AbortSignal;
  },
  deps: NativeDeepReadPlanDeps,
): Promise<NativeDeepReadPlanPreview> {
  /**
   * 0826 回归修复：面板会放行带 modal_id 的搜索页，但原始长 URL 一路透传给下游
   * （sourceIdentity/各消费方），形态不认就死。入口先规范化成 /video/<id> 标准形态
   * （modal_id 弹层链 → 单集页；其余原样返回），下游只见规范 URL。
   */
  const url = normalizeDouyinVideoUrl(String(input.url || "").trim());
  const limit = Math.max(1, Math.min(NATIVE_DEEP_READ_BATCH_HARD_CEILING, Math.floor(input.limit)));

  // ── 1. 链接 → 合集 id（搜索页的 modal_id 由 extractDouyinVideoIdFromUrl 处理）
  let mixId = extractDouyinMixIdFromUrl(url) || "";
  let dramaNameZh = "";
  if (!mixId) {
    const awemeId = extractDouyinVideoIdFromUrl(url);
    if (!awemeId) throw new Error("这个链接里没有 modal_id / 视频 id / 合集 id，认不出是哪一部");
    const detail = await deps.fetchAwemeDetail(awemeId);
    if (!detail?.mixId) throw new Error("这条视频不属于任何合集，无法按集发车");
    mixId = detail.mixId;
    dramaNameZh = detail.mixNameZh || "";
  }

  // ── 2. 合集展开
  const listed = await deps.listMixEpisodes(mixId);
  if (!listed?.episodes?.length) throw new Error("合集展开失败或没有分集，请稍后重试");
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

  // ── 3. 读到付费集就停
  const { free, paywallStartEpisodeIndex, unknownAccessEpisodeIndexes } =
    selectFreeEpisodesUpToPaywall(listed.episodes);
  if (!free.length) {
    if (unknownAccessEpisodeIndexes.length) {
      throw new Error("第1集缺少明确免费信号，已停止；unknown 不能作为免费集执行");
    }
    throw new Error("这部剧第一集就是付费集，没有可学的免费集");
  }

  const seriesKey = await deps.resolveSeriesKey({
    sourceIdentity: url,
    mixId,
    title: dramaNameZh || undefined,
    learnLlm: input.learnLlm || "gpt",
  });
  const [ingested, claimStates] = await Promise.all([
    deps.listIngestedEpisodes(seriesKey),
    deps.listClaimStates(seriesKey),
  ]);

  // ── 4. 逐集探时长（零模型调用）
  // “学 N 集”指接下来新增 N 集，不是永远只看合集前 N 集。
  // 残留 claim 必须继续隔离，但不能占掉用户要求的名额：先排除已入库与 claim，再取 N 集。
  // 每个真正执行的集仍会在模型调用前原子抢 claim；这里没有放松并发保护。
  const notIngested = free.filter((e) => !ingested.has(e.index));
  /**
   * 0826 用户拍板「失败占位不许永远挡路」：带失败病历或超时的占位自动让位、
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
  const executable = notIngested
    .filter((e) => !blockedSet.has(e.index))
    .slice(0, limit);
  const episodes: NativeDeepReadPlanEpisode[] = [];
  for (const e of executable) {
    throwIfNativePlanAborted(input.abortSignal);
    const probedDurationSec = await probeEpisodeDurationWithCandidateFailover(
      e,
      deps,
      input.abortSignal,
    );
    const durationSec = normalizeNativeDeepReadDurationSec(probedDurationSec);
    if (durationSec > MANHUA_LEARN_MAX_DURATION_SEC) {
      throw new Error(
        `第${e.index}集超过 ${Math.round(MANHUA_LEARN_MAX_DURATION_SEC / 60)} 分钟，超出学习策略上限`,
      );
    }
    episodes.push({
      episodeIndex: e.index,
      sourceUrl: e.url,
      durationSec,
      segments: splitNativeDeepReadSegments(durationSec),
      ...(reclaimSet.has(e.index) ? { reclaimFailedClaim: true } : {}),
    });
  }

  // ── 5. 用发车脚本同一个校验器验一遍
  const plan = episodes.length
    ? validateNativeDeepReadBatchPlan(
        episodes.map((e) => ({ ...e, resolveNodes: async () => [] })),
        { maxEpisodes: limit, seriesKey },
      )
    : null;

  return {
    planHash: plan?.planHash || computeNativeDeepReadPlanHash(seriesKey, episodes),
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
