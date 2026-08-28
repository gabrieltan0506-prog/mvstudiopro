/**
 * 抖音媒体地址进程内解析（PR1325 第一节）：服务端进程内 fetch 抖音视频页，
 * DOUYIN_COOKIE 只从 process.env 读并只进入本次 fetch 请求头，绝不进 argv、
 * 子进程、日志或错误链。解析页面内嵌 RENDER_DATA / _ROUTER_DATA JSON，
 * 取 video play_addr/playApi 的 https url_list 首个；解析不到抛脱敏错误
 * （错误里绝不含 cookie 与 URL 查询串）。子进程（ffmpeg/yt-dlp 兜底）
 * 只拿这里解析出的无凭证媒体地址。
 */
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

type MediaHit = { mediaUrl: string; durationSec?: number };

function readUrlList(node: Record<string, unknown>): string | null {
  const list = node.url_list ?? node.urlList;
  if (!Array.isArray(list)) return null;
  for (const item of list) {
    const url = toHttps(String(item || "").trim());
    if (/^https:\/\//.test(url)) return url;
  }
  return null;
}

function readDurationSec(container: Record<string, unknown>): number | undefined {
  const raw = Number(container.duration);
  if (!Number.isFinite(raw) || raw <= 0) return undefined;
  // 抖音 video.duration 以毫秒计；秒级小值兜底直接采用。
  return raw > 1000 ? raw / 1000 : raw;
}

/** 深搜 JSON：找 video 对象的 play_addr/playAddr.url_list 首个 https，或 playApi 串。 */
function findMediaInJson(node: unknown, depth = 0): MediaHit | null {
  if (!node || typeof node !== "object" || depth > 24) return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const hit = findMediaInJson(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  const record = node as Record<string, unknown>;
  const playAddr = record.play_addr ?? record.playAddr;
  if (playAddr && typeof playAddr === "object" && !Array.isArray(playAddr)) {
    const mediaUrl = readUrlList(playAddr as Record<string, unknown>);
    if (mediaUrl) return { mediaUrl, durationSec: readDurationSec(record) };
  }
  const playApi = record.playApi ?? record.play_api;
  if (typeof playApi === "string" && playApi.trim()) {
    const mediaUrl = toHttps(playApi.trim());
    if (/^https:\/\//.test(mediaUrl)) return { mediaUrl, durationSec: readDurationSec(record) };
  }
  for (const value of Object.values(record)) {
    const hit = findMediaInJson(value, depth + 1);
    if (hit) return hit;
  }
  return null;
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
  for (const block of blocks) {
    const hit = findMediaInJson(block);
    if (hit) return { videoId, mediaUrl: hit.mediaUrl, durationSec: hit.durationSec };
  }
  throw new Error(
    sanitizeSensitiveText(`抖音视频页未解析到媒体地址（video=${videoId}，内嵌 JSON 块 ${blocks.length} 个）`),
  );
}
