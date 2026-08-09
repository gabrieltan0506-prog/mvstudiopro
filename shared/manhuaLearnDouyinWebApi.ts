/**
 * 学节奏 · 抖音 web API 纯解析层（不发网络请求，可单测）。
 * 背景：抖音 collection/mix 页改版后 yt-dlp flat-playlist 解析已死（生产日志实锤），
 * 合集分集改走趋势采集器同款 web API（凭证同源 DOUYIN_COOKIE）。
 * 请求层见 server/services/manhuaLearnDouyinWebApi.ts。
 */

import { extractDouyinModalVideoId } from "./manhuaLearnYtdlp.js";

export type DouyinListedEpisode = { index: number; url: string; title: string };

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
    episodes.push({
      index,
      url: `https://www.douyin.com/video/${awemeId}`,
      title,
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
  if (!titleZh && !mixId && !mixNameZh) return null;
  return { titleZh, mixId, mixNameZh, episodeIndex };
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
