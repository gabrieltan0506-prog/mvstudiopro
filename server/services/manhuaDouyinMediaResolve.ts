/**
 * 抖音媒体地址进程内解析（PR1325 第一节）：服务端进程内 fetch 抖音视频页，
 * DOUYIN_COOKIE 只从 process.env 读并只进入本次 fetch 请求头，绝不进 argv、
 * 子进程、日志或错误链。解析页面内嵌 RENDER_DATA / _ROUTER_DATA JSON，
 * 取 video play_addr/playApi 的 https url_list 首个；解析不到抛脱敏错误
 * （错误里绝不含 cookie 与 URL 查询串）。子进程（ffmpeg/yt-dlp 兜底）
 * 只拿这里解析出的无凭证媒体地址。
 */
import { isTrustedDouyinPlaybackUrl } from "../../shared/manhuaLearnDouyinWebApi";
import { sanitizeSensitiveText } from "./manhuaMediaSanitize";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export type DouyinFetchResponse = {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
};

export type DouyinFetchImpl = (
  url: string,
  init: { headers: Record<string, string>; redirect?: "follow" },
) => Promise<DouyinFetchResponse>;

export type ResolvedDouyinMedia = {
  videoId: string;
  mediaUrl: string;
  durationSec?: number;
};

export function extractDouyinVideoId(pageUrl: string): string {
  return String(pageUrl || "").match(/(?:modal_id=|\/video\/)(\d{10,24})/)?.[1] || "";
}

function toHttps(url: string): string {
  if (url.startsWith("//")) return `https:${url}`;
  return url.replace(/^http:\/\//, "https://");
}

type MediaHit = { mediaUrl: string; durationSec?: number; matchedTarget: boolean };

function readUrlList(node: Record<string, unknown>): string | null {
  const list = node.url_list ?? node.urlList;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const url = toHttps(String(item || "").trim());
    // 白名单外的 https 一律不采纳：这个地址会直接交给下载器出网。
    if (isTrustedDouyinPlaybackUrl(url)) return url;
  }
  return null;
}

/** 页面节点自身声明的 aweme/video id（只认纯数字 10–24 位）。 */
const NODE_ID_KEYS = ["aweme_id", "awemeId", "item_id", "itemId", "video_id", "videoId"] as const;

function readNodeVideoId(record: Record<string, unknown>): string {
  for (const key of NODE_ID_KEYS) {
    const value = String(record[key] ?? "").trim();
    if (/^\d{10,24}$/.test(value)) return value;
  }
  return "";
}

function readDurationSec(container: Record<string, unknown>): number | undefined {
  const raw = Number(container.duration);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  // 抖音 video.duration 以毫秒计；秒级小值兜底直接采用。
  return raw > 1000 ? raw / 1000 : raw;
}

/**
 * 深搜 JSON：找 video 对象的 play_addr/playAddr.url_list 首个可信 https，或 playApi 串。
 *
 * 绑定 videoId：抖音页面常内嵌推荐位/合集里的**其他**视频，深搜「第一个 play_addr」
 * 会把别人的媒体地址当成本集。因此：
 * - 节点自身声明的 id（aweme_id/item_id/video_id…）沿子树继承；
 * - 明确属于其他 videoId 的子树整棵丢弃；
 * - 命中目标 videoId 的候选优先返回，未绑定候选只作兜底（页面完全没有身份字段时才用得上）。
 */
function findMediaInJson(
  node: unknown,
  targetVideoId: string,
  inheritedVideoId = "",
  depth = 0,
): MediaHit | null {
  if (!node || typeof node !== "object" || depth > 24) return null;
  if (Array.isArray(node)) {
    let fallback: MediaHit | null = null;
    for (const item of node) {
      const hit = findMediaInJson(item, targetVideoId, inheritedVideoId, depth + 1);
      if (!hit) continue;
      if (hit.matchedTarget) return hit;
      fallback ??= hit;
    }
    return fallback;
  }
  const record = node as Record<string, unknown>;
  const ownVideoId = readNodeVideoId(record);
  const currentVideoId = ownVideoId || inheritedVideoId;
  // 明确属于别的视频：整棵子树不采纳。
  if (currentVideoId && targetVideoId && currentVideoId !== targetVideoId) return null;
  const matchedTarget = Boolean(currentVideoId) && currentVideoId === targetVideoId;

  const playAddr = record.play_addr ?? record.playAddr;
  if (playAddr && typeof playAddr === "object" && !Array.isArray(playAddr)) {
    const mediaUrl = readUrlList(playAddr as Record<string, unknown>);
    if (mediaUrl) return { mediaUrl, durationSec: readDurationSec(record), matchedTarget };
  }
  const playApi = record.playApi ?? record.play_api;
  if (typeof playApi === "string" && playApi.trim()) {
    const mediaUrl = toHttps(playApi.trim());
    if (isTrustedDouyinPlaybackUrl(mediaUrl)) {
      return { mediaUrl, durationSec: readDurationSec(record), matchedTarget };
    }
  }
  let fallback: MediaHit | null = null;
  for (const value of Object.values(record)) {
    const hit = findMediaInJson(value, targetVideoId, currentVideoId, depth + 1);
    if (!hit) continue;
    if (hit.matchedTarget) return hit;
    fallback ??= hit;
  }
  return fallback;
}

function parseEmbeddedJsonBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  // RENDER_DATA：<script id="RENDER_DATA" type="application/json">%7B...%7D</script>
  const renderPattern = /<script[^>]*id=["']RENDER_DATA["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (let match = renderPattern.exec(html); match; match = renderPattern.exec(html)) {
    const body = String(match[1] || "").trim();
    if (!body) continue;
    try {
      blocks.push(JSON.parse(body.startsWith("{") || body.startsWith("[") ? body : decodeURIComponent(body)));
    } catch {
      // 单块坏 JSON 不阻断其余块。
    }
  }
  // _ROUTER_DATA：window._ROUTER_DATA = {...}（同一 <script> 内以 </script> 收尾）。
  const routerPattern = /_ROUTER_DATA\s*=\s*([\s\S]*?)<\/script>/gi;
  for (let match = routerPattern.exec(html); match; match = routerPattern.exec(html)) {
    const body = String(match[1] || "").trim().replace(/;\s*$/, "");
    if (!body.startsWith("{") && !body.startsWith("[")) continue;
    try {
      blocks.push(JSON.parse(body));
    } catch {
      // 忽略坏块。
    }
  }
  return blocks;
}

/**
 * 进程内解析抖音视频页得到无凭证媒体地址。
 * cookie 只进本次 fetch 请求头；任何失败路径抛出的错误都经 sanitizeSensitiveText。
 */
export async function resolveDouyinMediaUrl(
  pageUrl: string,
  options?: { fetchImpl?: DouyinFetchImpl },
): Promise<ResolvedDouyinMedia> {
  const videoId = extractDouyinVideoId(pageUrl);
  if (!videoId) {
    throw new Error("抖音链接无效：需要 /video/<id> 或带 modal_id 的链接");
  }
  const canonicalUrl = `https://www.douyin.com/video/${videoId}`;
  const headers: Record<string, string> = {
    "User-Agent": DESKTOP_UA,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: "https://www.douyin.com/",
  };
  const cookie = String(process.env.DOUYIN_COOKIE || "").trim();
  if (cookie) headers.Cookie = cookie;

  const fetchImpl: DouyinFetchImpl = options?.fetchImpl
    ?? (fetch as unknown as DouyinFetchImpl);

  let html: string;
  try {
    const response = await fetchImpl(canonicalUrl, { headers, redirect: "follow" });
    if (!response.ok) {
      throw new Error(`抖音视频页请求失败：status=${response.status} video=${videoId}`);
    }
    html = await response.text();
  } catch (error) {
    // 不透传原始 cause（可能携带请求头/URL 查询串），只保留脱敏后的描述。
    throw new Error(`抖音视频页请求失败（video=${videoId}）：${sanitizeSensitiveText(error)}`);
  }

  const blocks = parseEmbeddedJsonBlocks(html);
  let fallbackHit: MediaHit | null = null;
  for (const block of blocks) {
    const hit = findMediaInJson(block, videoId);
    if (!hit) continue;
    if (hit.matchedTarget) return { videoId, mediaUrl: hit.mediaUrl, durationSec: hit.durationSec };
    fallbackHit ??= hit;
  }
  if (fallbackHit) {
    return { videoId, mediaUrl: fallbackHit.mediaUrl, durationSec: fallbackHit.durationSec };
  }
  throw new Error(
    sanitizeSensitiveText(`抖音视频页未解析到媒体地址（video=${videoId}，内嵌 JSON 块 ${blocks.length} 个）`),
  );
}
