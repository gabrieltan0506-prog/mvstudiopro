/**
 * 学节奏 · 抖音 web API 纯解析层（不发网络请求，可单测）。
 * 背景：抖音 collection/mix 页改版后 yt-dlp flat-playlist 解析已死（生产日志实锤），
 * 合集分集改走趋势采集器同款 web API（凭证同源 DOUYIN_COOKIE）。
 * 请求层见 server/services/manhuaLearnDouyinWebApi.ts。
 */

import { extractDouyinModalVideoId } from "./manhuaLearnYtdlp.js";

export type DouyinListedEpisode = {
  index: number;
  url: string;
  title: string;
  /**
   * 官方接口随分集返回的播放地址（video.play_addr.url_list 里首个可信 HTTPS 条目）。
   * 短时效签名 URL：只在本轮学习内存中使用，不落任何进度 JSON；
   * 下载失败或过期一律回退 url（/video/ 页面）走 yt-dlp 老路。
   */
  playbackUrl?: string;
  /** 同一条视频的全部可信候选；播放地址过期、无音轨或 CDN 拒绝时逐个切换。 */
  playbackUrls?: string[];
};

export type DouyinMixAwemePageParse = {
  /** 本页解析出的分集（index 优先取 mix_info.statis.current_episode） */
  episodes: DouyinListedEpisode[];
  /** 剧名（mix_info.mix_name，首个带名条目为准） */
  mixNameZh?: string;
  hasMore: boolean;
  nextCursor: number;
  /** 抖音业务码；0/200 都算成功（同 trendCollector 生产口径），其余视为本页失败 */
  statusCode: number;
};

/** 抖音 web API 业务码成功判定（趋势采集器生产口径：0 或 200） */
export function isDouyinWebApiStatusOk(statusCode: number): boolean {
  return statusCode === 0 || statusCode === 200;
}

export type DouyinAwemeDetailParse = {
  /** 视频标题（desc） */
  titleZh?: string;
  /** 所属合集 id（有值说明这条单集属于某部短剧合集） */
  mixId?: string;
  /** 所属合集剧名 */
  mixNameZh?: string;
  /** 本条是第几集（current_episode） */
  episodeIndex?: number;
  /** 官方播放地址（同 DouyinListedEpisode.playbackUrl 口径，短时效不持久化） */
  playbackUrl?: string;
  playbackUrls?: string[];
};

const DOUYIN_WEB_API_COMMON_PARAMS: ReadonlyArray<[string, string]> = [
  ["device_platform", "webapp"],
  ["aid", "6383"],
  ["channel", "channel_pc_web"],
  ["cookie_enabled", "true"],
  ["browser_language", "zh-CN"],
  ["browser_platform", "MacIntel"],
  ["browser_name", "Chrome"],
  ["browser_version", "120.0.0.0"],
];

function withCommonParams(url: URL): URL {
  for (const [k, v] of DOUYIN_WEB_API_COMMON_PARAMS) url.searchParams.set(k, v);
  return url;
}

/** 合集分集列表接口（趋势采集器同款域与参数形态） */
export function buildDouyinMixAwemeApiUrl(mixId: string, cursor: number, count: number): string {
  const url = new URL("https://www.douyin.com/aweme/v1/web/mix/aweme/");
  url.searchParams.set("mix_id", String(mixId).trim());
  url.searchParams.set("cursor", String(Math.max(0, Math.floor(cursor))));
  url.searchParams.set("count", String(Math.max(1, Math.min(30, Math.floor(count)))));
  return withCommonParams(url).toString();
}

/** 单条视频详情接口（回填剧名 / 识别所属合集） */
export function buildDouyinAwemeDetailApiUrl(awemeId: string): string {
  const url = new URL("https://www.douyin.com/aweme/v1/web/aweme/detail/");
  url.searchParams.set("aweme_id", String(awemeId).trim());
  return withCommonParams(url).toString();
}

/** /video/、/note/（含 iesdouyin /share/ 前缀）或 modal_id 弹层形态里的视频 id */
export function extractDouyinVideoIdFromUrl(url: string): string | null {
  const u = String(url || "").trim();
  if (!u) return null;
  const modalId = extractDouyinModalVideoId(u);
  if (modalId) return modalId;
  const m = /(?:^|douyin\.com)\/(?:share\/)?(?:video|note)\/(\d{5,})/i.exec(u);
  return m ? m[1] : null;
}

/** collection/mix 合集页 URL 里的 mixId（榜单行有时只给合集链接不带 mixId） */
export function extractDouyinMixIdFromUrl(url: string): string | null {
  const u = String(url || "").trim();
  if (!u) return null;
  const m = /(?:^|douyin\.com)\/(?:share\/)?(?:collection|mix)\/(\d{6,})/i.exec(u);
  return m ? m[1] : null;
}

type AnyRecord = Record<string, unknown>;

function asRecord(v: unknown): AnyRecord | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as AnyRecord) : null;
}

function readMixInfo(item: AnyRecord): AnyRecord | null {
  return (
    asRecord(item.mix_info)
    ?? asRecord(item.mixInfo)
    ?? asRecord(asRecord(item.aweme_info)?.mix_info)
    ?? null
  );
}

function readMixName(mix: AnyRecord | null): string {
  if (!mix) return "";
  return String(mix.mix_name ?? mix.mixName ?? mix.title ?? "").trim();
}

function readMixId(mix: AnyRecord | null): string {
  if (!mix) return "";
  return String(mix.mix_id ?? mix.mixId ?? mix.mix_id_str ?? "").trim();
}

/**
 * 播放地址可信域白名单（后缀匹配）：抖音站内与其官方视频 CDN。
 * 只接受 HTTPS；白名单外域名一律丢弃——播放地址会直接交给下载器，
 * 不能让接口响应里的任意字符串变成我们的出网目标（SSRF/投毒面）。
 */
const DOUYIN_PLAYBACK_HOST_SUFFIXES: readonly string[] = [
  "douyin.com",
  "iesdouyin.com",
  "douyinvod.com",
  "douyinstatic.com",
  "amemv.com",
  "snssdk.com",
  "zjcdn.com",
];

export function isTrustedDouyinPlaybackUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:") return false;
    const host = u.hostname.toLowerCase();
    return DOUYIN_PLAYBACK_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

/** 收齐官方返回的可信媒体候选：主播放、下载地址与各码率播放地址。 */
export function readDouyinPlaybackUrls(item: unknown): string[] {
  const root = asRecord(item);
  if (!root) return [];
  const video = asRecord(root.video) ?? asRecord(asRecord(root.aweme_info)?.video);
  if (!video) return [];
  const addressGroups: AnyRecord[] = [];
  const appendAddress = (value: unknown) => {
    const address = asRecord(value);
    if (address) addressGroups.push(address);
  };
  appendAddress(video.play_addr ?? video.playAddr);
  appendAddress(video.download_addr ?? video.downloadAddr);
  const bitRates = Array.isArray(video.bit_rate)
    ? video.bit_rate
    : Array.isArray(video.bitRate)
      ? video.bitRate
      : [];
  for (const bitRate of bitRates) {
    const row = asRecord(bitRate);
    appendAddress(row?.play_addr ?? row?.playAddr);
  }
  const candidateGroups = addressGroups.map((address) => {
    const list = address.url_list ?? address.urlList;
    return Array.isArray(list) ? list : [];
  });
  const urls: string[] = [];
  // 同一 address 的 url_list 通常只是同类 CDN 镜像。按镜像序号交错主播放、
  // 下载地址和各码率，让有限重试优先覆盖不同媒体形态，而不是连续撞三个同类节点。
  const mirrorCount = Math.max(0, ...candidateGroups.map((list) => list.length));
  for (let mirrorIndex = 0; mirrorIndex < mirrorCount; mirrorIndex++) {
    for (const list of candidateGroups) {
      const candidate = list[mirrorIndex];
      if (typeof candidate !== "string") continue;
      const url = candidate.trim();
      if (url && isTrustedDouyinPlaybackUrl(url) && !urls.includes(url)) urls.push(url);
    }
  }
  return urls;
}

/** 兼容旧调用：首选候选仍放在 playbackUrl。 */
export function readDouyinPlaybackUrl(item: unknown): string | undefined {
  return readDouyinPlaybackUrls(item)[0];
}

function readCurrentEpisode(mix: AnyRecord | null): number {
  if (!mix) return 0;
  const statis = asRecord(mix.statis) ?? asRecord(mix.stats) ?? asRecord(mix.statistics);
  const n = Number(
    statis?.current_episode ?? statis?.currentEpisode ?? mix.current_episode ?? 0,
  );
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * 解析 mix/aweme 一页。fallbackOrderBase = 之前已收的条数（分集缺 current_episode
 * 时按到达顺序补号，跨页续接不重号）。
 */
export function parseDouyinMixAwemeResponse(
  payload: unknown,
  fallbackOrderBase = 0,
): DouyinMixAwemePageParse {
  const root = asRecord(payload);
  const statusCode = Number(root?.status_code ?? 0) || 0;
  const empty: DouyinMixAwemePageParse = {
    episodes: [],
    hasMore: false,
    nextCursor: 0,
    statusCode,
  };
  if (!root || !isDouyinWebApiStatusOk(statusCode)) return empty;

  const list = Array.isArray(root.aweme_list) ? root.aweme_list : [];
  const episodes: DouyinListedEpisode[] = [];
  let mixNameZh = "";
  for (let i = 0; i < list.length; i++) {
    const item = asRecord(list[i]);
    if (!item) continue;
    const awemeId = String(item.aweme_id ?? item.awemeId ?? item.aweme_id_str ?? "").trim();
    if (!/^\d{5,}$/.test(awemeId)) continue;
    const mix = readMixInfo(item);
    if (!mixNameZh) mixNameZh = readMixName(mix);
    const epNo = readCurrentEpisode(mix);
    const index = epNo > 0 ? epNo : fallbackOrderBase + episodes.length + 1;
    const title = String(item.desc ?? item.caption ?? "").trim().slice(0, 120) || `第${index}集`;
    const playbackUrls = readDouyinPlaybackUrls(item);
    episodes.push({
      index,
      url: `https://www.douyin.com/video/${awemeId}`,
      title,
      playbackUrl: playbackUrls[0],
      playbackUrls: playbackUrls.length ? playbackUrls : undefined,
    });
  }
  return {
    episodes,
    mixNameZh: mixNameZh || undefined,
    hasMore: Number(root.has_more ?? 0) === 1,
    nextCursor: Math.max(0, Math.floor(Number(root.cursor ?? 0) || 0)),
    statusCode,
  };
}

/** 解析 aweme/detail；解析不出核心字段返回 null */
export function parseDouyinAwemeDetailResponse(payload: unknown): DouyinAwemeDetailParse | null {
  const root = asRecord(payload);
  if (!root || !isDouyinWebApiStatusOk(Number(root.status_code ?? 0) || 0)) return null;
  const detail = asRecord(root.aweme_detail);
  if (!detail) return null;
  const mix = readMixInfo(detail);
  const titleZh = String(detail.desc ?? detail.caption ?? "").trim().slice(0, 120) || undefined;
  const mixId = readMixId(mix) || undefined;
  const mixNameZh = readMixName(mix) || undefined;
  const episodeIndex = readCurrentEpisode(mix) || undefined;
  const playbackUrls = readDouyinPlaybackUrls(detail);
  const playbackUrl = playbackUrls[0];
  if (!titleZh && !mixId && !mixNameZh && !playbackUrl) return null;
  return {
    titleZh,
    mixId,
    mixNameZh,
    episodeIndex,
    playbackUrl,
    playbackUrls: playbackUrls.length ? playbackUrls : undefined,
  };
}

/**
 * 合并多页分集：按集号排序、同号去重（保留先到者）。
 * 上限防御：单剧集数离谱（>400）时截断，避免撑爆后续 GCS 列表。
 */
export function mergeDouyinMixEpisodePages(
  pages: ReadonlyArray<readonly DouyinListedEpisode[]>,
): DouyinListedEpisode[] {
  const seen = new Set<number>();
  const out: DouyinListedEpisode[] = [];
  for (const page of pages) {
    for (const ep of page) {
      if (seen.has(ep.index)) continue;
      seen.add(ep.index);
      out.push(ep);
    }
  }
  out.sort((a, b) => a.index - b.index);
  return out.slice(0, 400);
}
