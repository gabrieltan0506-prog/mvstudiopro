/**
 * 学节奏 · 抖音 web API 请求层：合集分集展开 + 单集详情（剧名回填）。
 * 凭证与趋势采集同源（DOUYIN_COOKIE / _BACKUP / _POOL），逐个候选试到有响应。
 * 解析逻辑全在 shared/manhuaLearnDouyinWebApi.ts（可单测）。
 */

import {
  buildDouyinAwemeDetailApiUrl,
  buildDouyinMixAwemeApiUrl,
  isDouyinWebApiStatusOk,
  mergeDouyinMixEpisodePages,
  parseDouyinAwemeDetailResponse,
  parseDouyinMixAwemeResponse,
  type DouyinAwemeDetailParse,
  type DouyinListedEpisode,
} from "../../shared/manhuaLearnDouyinWebApi.js";
import {
  listDouyinCookieCandidatesFromEnv,
  rotateDouyinCookieCandidates,
} from "../../shared/manhuaLearnYtdlp.js";

const DOUYIN_WEB_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** 分页页大小 / 页数帽：8 页 × 30 = 240 集，短剧合集足够 */
const MIX_PAGE_COUNT = 30;
const MIX_MAX_PAGES = 8;

async function fetchDouyinJsonWithCookie(
  url: string,
  referer: string,
  cookie: string,
  onBlocked?: (status: number, bodyHead: string) => void,
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
  if (!response.ok) {
    // 0901 实锤：Argus 风控对 mix 列表端点回 403「Uifid Not Found」，
    // 老代码静默当失败，面板只看到「合集展开失败」——把拦截情报带出去说人话。
    if (response.status === 403 && onBlocked) {
      const head = await response.text().catch(() => "");
      onBlocked(response.status, head.slice(0, 80));
    }
    return null;
  }
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
): Promise<{
  episodes: DouyinListedEpisode[];
  mixNameZh?: string;
  complete: boolean;
  /** 全部凭证都被风控拦下时的人话说明（403 Argus/Uifid） */
  riskControlBlockedZh?: string;
} | null> {
  const id = String(mixId || "").trim();
  if (!/^\d{6,}$/.test(id)) return null;
  const cookies = listDouyinCookieCandidatesFromEnv();
  if (!cookies.length) return null;
  const referer = `https://www.douyin.com/collection/${id}`;

  // 某候选中途被风控只拉到前几页时，留作备胎继续试下一份凭证补全；
  // 全部候选都残缺则返回最全的那份（残缺也比全无强，listedEpisodeCount 会随之波动）
  let best: { episodes: DouyinListedEpisode[]; mixNameZh?: string; complete: boolean } | null =
    null;
  let riskControlBlockedZh: string | undefined;
  for (const cookie of cookies) {
    const pages: DouyinListedEpisode[][] = [];
    let mixNameZh: string | undefined;
    let cursor = 0;
    let gathered = 0;
    let truncated = false;
    let lastHasMore = false;
    for (let page = 0; page < MIX_MAX_PAGES; page++) {
      const url = buildDouyinMixAwemeApiUrl(id, cursor, MIX_PAGE_COUNT);
      let payload: unknown | null = null;
      try {
        payload = await fetchDouyinJsonWithCookie(url, referer, cookie, (status, head) => {
          // 细节只进日志；riskControlBlockedZh 是给面板的，短句即可
          console.warn(`[manhuaLearnDouyinWebApi] mix 403: ${head || "Argus"}`);
          riskControlBlockedZh = "抖音风控拦截（403）";
        });
      } catch (e) {
        console.warn(
          "[manhuaLearnDouyinWebApi] mix page fetch failed:",
          id,
          `page=${page}`,
          e instanceof Error ? e.message : e,
        );
      }
      if (payload == null) {
        truncated = pages.length > 0;
        break;
      }
      const parsed = parseDouyinMixAwemeResponse(payload, gathered);
      if (!isDouyinWebApiStatusOk(parsed.statusCode)) {
        console.warn(
          "[manhuaLearnDouyinWebApi] mix page status_code:",
          id,
          `page=${page}`,
          parsed.statusCode,
        );
        truncated = pages.length > 0;
        break;
      }
      if (!parsed.episodes.length) {
        // 服务端还说 hasMore 却回空页 → 视为残缺
        truncated = pages.length > 0;
        break;
      }
      pages.push(parsed.episodes);
      gathered += parsed.episodes.length;
      if (!mixNameZh && parsed.mixNameZh) mixNameZh = parsed.mixNameZh;
      lastHasMore = parsed.hasMore;
      if (!parsed.hasMore) break;
      // cursor 语义：抖音返回下一页起点；个别版本不回 cursor 时按已收条数续
      cursor = parsed.nextCursor > cursor ? parsed.nextCursor : gathered;
    }
    // 第五轮复审 P1·11：页数打满仍 hasMore = 列表没拉完，同样算残缺
    if (lastHasMore) truncated = true;
    const episodes = mergeDouyinMixEpisodePages(pages);
    if (episodes.length > 0 && !truncated) {
      return { episodes, mixNameZh, complete: true };
    }
    if (episodes.length > (best?.episodes.length || 0)) {
      best = { episodes, mixNameZh, complete: false };
    }
    // 一无所获或残缺 → 换下一份凭证再试
  }
  if (best) {
    console.warn(
      `[manhuaLearnDouyinWebApi] mix expand truncated: mixId=${id} entries=${best.episodes.length}（全部凭证候选均未拉全，先用最全一份）`,
    );
  }
  if (!best && riskControlBlockedZh) {
    console.warn("[manhuaLearnDouyinWebApi] mix listing blocked by risk control:", riskControlBlockedZh);
    return { episodes: [], complete: false, riskControlBlockedZh };
  }
  return best;
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
  // 0905 用户令：详情接口抽风一次就把整集判「没有免费信号」太脆——全部 cookie 都失手后隔 5 秒再来，共 3 轮
  for (let round = 0; round < DOUYIN_DETAIL_FETCH_ROUNDS; round += 1) {
    if (round > 0) await new Promise((resolve) => setTimeout(resolve, DOUYIN_DETAIL_FETCH_RETRY_DELAY_MS));
    for (const cookie of cookies) {
      let payload: unknown | null = null;
      try {
        payload = await fetchDouyinJsonWithCookie(url, referer, cookie);
      } catch (e) {
        console.warn(
          `[manhuaLearnDouyinWebApi] detail fetch failed (round ${round + 1}/${DOUYIN_DETAIL_FETCH_ROUNDS}):`,
          id,
          e instanceof Error ? e.message : e,
        );
      }
      if (payload == null) continue;
      const parsed = parseDouyinAwemeDetailResponse(payload);
      if (parsed) return parsed;
    }
  }
  return null;
}

const DOUYIN_DETAIL_FETCH_ROUNDS = 3;
const DOUYIN_DETAIL_FETCH_RETRY_DELAY_MS = 5_000;

/**
 * 下载失败后的轻量刷新：从备用候选开始逐个取一遍详情，返回去重后的新鲜播放地址。
 * Cookie、签名地址都只留在本轮内存；调用方只在旧播放地址失败时触发。
 */
export async function listDouyinAwemePlaybackUrlsViaWebApi(
  awemeId: string,
  startCookieIndex = 1,
): Promise<string[]> {
  const id = String(awemeId || "").trim();
  if (!/^\d{5,}$/.test(id)) return [];
  const cookies = rotateDouyinCookieCandidates(
    listDouyinCookieCandidatesFromEnv(),
    startCookieIndex,
  );
  if (!cookies.length) return [];
  const url = buildDouyinAwemeDetailApiUrl(id);
  const referer = `https://www.douyin.com/video/${id}`;
  const playbackUrls: string[] = [];
  for (const cookie of cookies) {
    let payload: unknown | null = null;
    try {
      payload = await fetchDouyinJsonWithCookie(url, referer, cookie);
    } catch (e) {
      console.warn(
        "[manhuaLearnDouyinWebApi] playback refresh failed:",
        id,
        e instanceof Error ? e.message : e,
      );
    }
    if (payload == null) continue;
    const parsed = parseDouyinAwemeDetailResponse(payload);
    for (const playbackUrl of parsed?.playbackUrls || (parsed?.playbackUrl ? [parsed.playbackUrl] : [])) {
      if (!playbackUrls.includes(playbackUrl)) playbackUrls.push(playbackUrl);
    }
  }
  return playbackUrls;
}

/**
 * 展开抖音短链（v./vm.douyin.com）：只跟重定向头，不下载正文。
 * 最多 3 跳、单跳 10 秒；解不开返回 null，调用方保持原链走既有的明确报错。
 */
export async function resolveDouyinShortLinkViaRedirect(
  url: string,
): Promise<string | null> {
  let current = String(url || "").trim();
  if (!current) return null;
  for (let hop = 0; hop < 3; hop += 1) {
    let response: Response;
    try {
      response = await fetch(current, {
        method: "HEAD",
        redirect: "manual",
        headers: { "user-agent": DOUYIN_WEB_UA },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      return null;
    }
    const location = String(response.headers.get("location") || "").trim();
    if (!location) {
      return hop > 0 ? current : null;
    }
    current = new URL(location, current).toString();
    // 一旦落到带视频 id 的正式域名就收工，不再多跳
    if (/(?:^|\.)(?:ies)?douyin\.com$/i.test(new URL(current).hostname)
      && /\/(?:share\/)?(?:video|note)\/\d{5,}|modal_id=\d{5,}/i.test(current)) {
      return current;
    }
  }
  return null;
}
