/**
 * 学节奏 · 抖音 web API 请求层：合集分集展开 + 单集详情（剧名回填）。
 * 凭证与趋势采集同源（DOUYIN_COOKIE / _BACKUP / _POOL），逐个候选试到有响应。
 * 解析逻辑全在 shared/manhuaLearnDouyinWebApi.ts（可单测）。
 */

import {
  buildDouyinAwemeDetailApiUrl,
  buildDouyinMixAwemeApiUrl,
  mergeDouyinMixEpisodePages,
  parseDouyinAwemeDetailResponse,
  parseDouyinMixAwemeResponse,
  type DouyinAwemeDetailParse,
  type DouyinListedEpisode,
} from "../../shared/manhuaLearnDouyinWebApi.js";
import { listDouyinCookieCandidatesFromEnv } from "../../shared/manhuaLearnYtdlp.js";

const DOUYIN_WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 分页页大小 / 页数帽：8 页 × 30 = 240 集，短剧合集足够 */
const MIX_PAGE_COUNT = 30;
const MIX_MAX_PAGES = 8;

async function fetchDouyinJsonWithCookie(
  url: string,
  referer: string,
  cookie: string,
): Promise<unknown | null> {
  const response = await fetch(url, {
    headers: {
      accept: "application/json,text/plain,*/*",
      cookie,
      referer,
      "user-agent": DOUYIN_WEB_UA,
    },
    // 挂死一个页面请求不能拖死整条学习任务
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) return null;
  // 风控页偶发返回 200 + 空体/HTML，json() 抛错时按失败处理换下一候选
  try {
    return (await response.json()) as unknown;
  } catch {
    return null;
  }
}

/**
 * 合集 mixId → 全部分集（按集号排序去重）。
 * 全部凭证候选都拉不到时返回 null（调用方回退 yt-dlp 老路）。
 */
export async function listDouyinMixEpisodesViaWebApi(
  mixId: string,
): Promise<{ episodes: DouyinListedEpisode[]; mixNameZh?: string } | null> {
  const id = String(mixId || "").trim();
  if (!/^\d{6,}$/.test(id)) return null;
  const cookies = listDouyinCookieCandidatesFromEnv();
  if (!cookies.length) return null;
  const referer = `https://www.douyin.com/collection/${id}`;

  for (const cookie of cookies) {
    const pages: DouyinListedEpisode[][] = [];
    let mixNameZh: string | undefined;
    let cursor = 0;
    let gathered = 0;
    for (let page = 0; page < MIX_MAX_PAGES; page++) {
      const url = buildDouyinMixAwemeApiUrl(id, cursor, MIX_PAGE_COUNT);
      let payload: unknown | null = null;
      try {
        payload = await fetchDouyinJsonWithCookie(url, referer, cookie);
      } catch (e) {
        console.warn(
          "[manhuaLearnDouyinWebApi] mix page fetch failed:",
          id,
          `page=${page}`,
          e instanceof Error ? e.message : e,
        );
      }
      if (payload == null) break;
      const parsed = parseDouyinMixAwemeResponse(payload, gathered);
      if (parsed.statusCode !== 0) {
        console.warn(
          "[manhuaLearnDouyinWebApi] mix page status_code:",
          id,
          `page=${page}`,
          parsed.statusCode,
        );
        break;
      }
      if (!parsed.episodes.length) break;
      pages.push(parsed.episodes);
      gathered += parsed.episodes.length;
      if (!mixNameZh && parsed.mixNameZh) mixNameZh = parsed.mixNameZh;
      if (!parsed.hasMore) break;
      // cursor 语义：抖音返回下一页起点；个别版本不回 cursor 时按已收条数续
      cursor = parsed.nextCursor > cursor ? parsed.nextCursor : gathered;
    }
    const episodes = mergeDouyinMixEpisodePages(pages);
    if (episodes.length > 0) {
      return { episodes, mixNameZh };
    }
    // 本候选一无所获 → 换下一份凭证再试
  }
  return null;
}

/** 单条视频详情（剧名回填 / 识别所属合集）；拉不到返回 null，不阻断学习 */
export async function fetchDouyinAwemeDetailViaWebApi(
  awemeId: string,
): Promise<DouyinAwemeDetailParse | null> {
  const id = String(awemeId || "").trim();
  if (!/^\d{5,}$/.test(id)) return null;
  const cookies = listDouyinCookieCandidatesFromEnv();
  if (!cookies.length) return null;
  const url = buildDouyinAwemeDetailApiUrl(id);
  const referer = `https://www.douyin.com/video/${id}`;
  for (const cookie of cookies) {
    let payload: unknown | null = null;
    try {
      payload = await fetchDouyinJsonWithCookie(url, referer, cookie);
    } catch (e) {
      console.warn(
        "[manhuaLearnDouyinWebApi] detail fetch failed:",
        id,
        e instanceof Error ? e.message : e,
      );
    }
    if (payload == null) continue;
    const parsed = parseDouyinAwemeDetailResponse(payload);
    if (parsed) return parsed;
  }
  return null;
}
