/**
 * 原生精读**发车计划预览**：抖音链接 → 这次要跑几集、几次模型请求、多少分钟。
 *
 * 🔴 **跑在服务端（Fly），密钥一步都不离开 Fly env。**
 * 解析要 `DOUYIN_COOKIE`，所以这件事天生属于服务端；做成本机脚本就等于
 * 要求把凭证下放到开发机，那是不可接受的外泄面。
 *
 * 全程**零模型调用**：合集展开走抖音 web api，时长走 ffprobe 读远端头部
 * （不下片、不转码），成本为零。真正的计价单位是返回里的 `totalSegments`。
 *
 * 本文件不新写任何解析逻辑，只把素材接入层现成的能力串起来。
 */
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  extractDouyinVideoIdFromUrl,
  extractDouyinMixIdFromUrl,
  type DouyinListedEpisode,
} from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  NATIVE_DEEP_READ_MAX_SEGMENT_SEC,
  NATIVE_DEEP_READ_BATCH_HARD_CEILING,
  validateNativeDeepReadBatchPlan,
} from "./manhuaNativeDeepReadExecution.js";

const execFileAsync = promisify(execFile);

/** CDN 要求带 Referer，素材接入层一路带着它；漏掉会被拒。 */
const DOUYIN_REFERER = "https://www.douyin.com/";

export type NativeDeepReadPlanSegment = { startSec: number; endSec: number };

export type NativeDeepReadPlanEpisode = {
  episodeIndex: number;
  sourceUrl: string;
  durationSec: number;
  segments: NativeDeepReadPlanSegment[];
};

export type NativeDeepReadPlanPreview = {
  planHash: string;
  seriesKey: string;
  dramaNameZh?: string;
  episodes: NativeDeepReadPlanEpisode[];
  totalSegments: number;
  totalDurationSec: number;
  /** 合集免费段总集数（不受 limit 影响，用来告诉用户「还能学多少」） */
  freeEpisodeCount: number;
  /** 从第几集起是付费集；没有付费边界时为空 */
  paywallStartEpisodeIndex?: number;
  /** 接口没给逐集付费信号的集号 —— unknown 不等于「已确认免费」 */
  unknownAccessEpisodeIndexes: number[];
  /** 已入库的集（不该重复付费） */
  alreadyIngestedEpisodeIndexes: number[];
  /** 有人正在跑的集 */
  pendingClaimEpisodeIndexes: number[];
  /** 扣掉已入库后真正会发出模型请求的集数 */
  executableEpisodeCount: number;
};

/**
 * 按模型单段上限均分。
 *
 * 单段超过 `NATIVE_DEEP_READ_MAX_SEGMENT_SEC`（fps=2 × 2000 帧 = 1000s）
 * 模型就看不完整，校验器会直接拒。均分而不是「切满再留一小截」，
 * 是为了避免最后一段短到只有几秒、白花一次请求。
 */
export function splitNativeDeepReadSegments(durationSec: number): NativeDeepReadPlanSegment[] {
  const total = Math.max(1, Math.round(Number(durationSec) || 0));
  const parts = Math.max(1, Math.ceil(total / NATIVE_DEEP_READ_MAX_SEGMENT_SEC));
  const per = Math.ceil(total / parts);
  const out: NativeDeepReadPlanSegment[] = [];
  for (let i = 0; i < parts; i += 1) {
    const startSec = i * per;
    const endSec = Math.min(total, startSec + per);
    if (endSec > startSec) out.push({ startSec, endSec });
  }
  return out;
}

/**
 * 计划确认码：worker 侧要用同样的输入重算并比对。
 *
 * 只覆盖**会影响花多少钱**的字段（合集、集号、时长、分段），
 * 不含标题等展示字段 —— 否则剧名改一个字就让用户重新确认。
 */
export function computeNativeDeepReadPlanHash(
  seriesKey: string,
  episodes: readonly NativeDeepReadPlanEpisode[],
): string {
  const canonical = JSON.stringify({
    seriesKey,
    episodes: [...episodes]
      .sort((a, b) => a.episodeIndex - b.episodeIndex)
      .map((e) => ({
        i: e.episodeIndex,
        d: Math.round(e.durationSec),
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
  const free = paidAt >= 0 ? sorted.slice(0, paidAt) : sorted;
  return {
    free,
    paywallStartEpisodeIndex: paidAt >= 0 ? sorted[paidAt]!.index : undefined,
    unknownAccessEpisodeIndexes: free.filter((e) => e.access !== "free").map((e) => e.index),
  };
}

/**
 * 读远端时长：ffprobe 直接读 CDN 直链的头部，**不下片**。
 *
 * 用直链而不是 `/video/` 页面地址 —— 页面是 HTML，ffprobe 读不了；
 * 旧链路那条 yt-dlp 元数据路同样要 cookie，服务端这边没必要再绕一次。
 */
export async function probeNativeDeepReadDurationSec(playbackUrl: string): Promise<number> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v", "error",
      "-user_agent",
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36",
      "-headers", `Referer: ${DOUYIN_REFERER}\r\n`,
      "-show_entries", "format=duration",
      "-print_format", "json",
      "-i", playbackUrl,
    ],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  const sec = Number(JSON.parse(stdout)?.format?.duration);
  if (!Number.isFinite(sec) || sec <= 0) throw new Error("读不到成片时长");
  return sec;
}

export type NativeDeepReadPlanDeps = {
  fetchAwemeDetail: (awemeId: string) => Promise<{ mixId?: string; mixNameZh?: string } | null>;
  listMixEpisodes: (mixId: string) => Promise<{
    episodes: DouyinListedEpisode[];
    mixNameZh?: string;
    complete: boolean;
  } | null>;
  refreshPlaybackUrls: (awemeId: string) => Promise<string[]>;
  probeDurationSec: (playbackUrl: string) => Promise<number>;
  listIngestedEpisodes: (seriesKey: string) => Promise<Set<number>>;
  listClaimedEpisodes: (seriesKey: string) => Promise<Set<number>>;
};

export async function buildNativeDeepReadPlanPreview(
  input: { url: string; limit: number; allowPartial?: boolean },
  deps: NativeDeepReadPlanDeps,
): Promise<NativeDeepReadPlanPreview> {
  const url = String(input.url || "").trim();
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
  if (!free.length) throw new Error("这部剧第一集就是付费集，没有可学的免费集");

  const seriesKey = `douyin${mixId}`;
  const [ingested, claimed] = await Promise.all([
    deps.listIngestedEpisodes(seriesKey),
    deps.listClaimedEpisodes(seriesKey),
  ]);

  // ── 4. 逐集探时长（零模型调用）
  const wanted = free.slice(0, limit);
  const episodes: NativeDeepReadPlanEpisode[] = [];
  for (const e of wanted) {
    let playback = e.playbackUrl || e.playbackUrls?.[0] || "";
    if (!playback) {
      const awemeId = extractDouyinVideoIdFromUrl(e.url);
      playback = awemeId ? (await deps.refreshPlaybackUrls(awemeId))[0] || "" : "";
    }
    if (!playback) throw new Error(`第${e.index}集拿不到可用播放地址，已停止（换 cookie 后重试）`);
    const durationSec = await deps.probeDurationSec(playback);
    episodes.push({
      episodeIndex: e.index,
      sourceUrl: e.url,
      durationSec,
      segments: splitNativeDeepReadSegments(durationSec),
    });
  }

  // ── 5. 用发车脚本同一个校验器验一遍
  const plan = validateNativeDeepReadBatchPlan(
    episodes.map((e) => ({ ...e, resolveNodes: async () => [] })),
    { maxEpisodes: limit, seriesKey },
  );

  return {
    planHash: computeNativeDeepReadPlanHash(seriesKey, episodes),
    seriesKey,
    dramaNameZh: dramaNameZh || undefined,
    episodes,
    totalSegments: plan.totalSegments,
    totalDurationSec: Math.round(episodes.reduce((s, e) => s + e.durationSec, 0)),
    freeEpisodeCount: free.length,
    paywallStartEpisodeIndex,
    unknownAccessEpisodeIndexes,
    alreadyIngestedEpisodeIndexes: episodes
      .map((e) => e.episodeIndex)
      .filter((i) => ingested.has(i)),
    pendingClaimEpisodeIndexes: episodes
      .map((e) => e.episodeIndex)
      .filter((i) => claimed.has(i)),
    executableEpisodeCount: episodes.filter((e) => !ingested.has(e.episodeIndex)).length,
  };
}
