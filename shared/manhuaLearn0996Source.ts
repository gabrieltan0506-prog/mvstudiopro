/**
 * 0996zp 金牌影院播放页的纯解析契约。
 *
 * 这里只识别固定站点与固定数字路由；网络层必须再次校验重定向和媒体域，
 * 页面/API 返回的任意字符串不得直接成为服务端出网目标。
 */
export const MANHUA_0996_SOURCE_HOSTS = [
  "0996zp.com",
  "www.0996zp.com",
  "gzcrkt8888.com",
  "www.gzcrkt8888.com",
] as const;

const MANHUA_0996_MEDIA_HOST_SUFFIXES = ["kqgfbs.com"] as const;

export type Manhua0996SourceRef = {
  host: string;
  vodId: string;
  nid: string;
  canonicalUrl: string;
};

export type Manhua0996SourceMarker = {
  kind: "opening" | "ending";
  startSec: number;
  endSec?: number;
  origin: "source_api";
};

export type Manhua0996Episode = {
  index: number;
  nid: string;
  url: string;
  title: string;
};

export type Manhua0996SeriesPage = {
  vodId: string;
  currentNid: string;
  currentEpisodeIndex: number;
  titleZh: string;
  episodes: Manhua0996Episode[];
};

/** 首选清晰度档（0830 用户拍板：从 720p 开始读）。 */
export const MANHUA_0996_PREFERRED_QUALITY = 720;

export type Manhua0996Playback = {
  playbackUrl: string;
  playbackUrls: string[];
  referer: string;
  markers: Manhua0996SourceMarker[];
};

function isAllowedSourceHost(hostname: string, additionalHosts: readonly string[] = []): boolean {
  const host = hostname.toLowerCase();
  return [...MANHUA_0996_SOURCE_HOSTS, ...additionalHosts]
    .some((allowed) => host === String(allowed).trim().toLowerCase());
}

export function parseManhua0996SourceUrl(
  raw: string,
  additionalHosts: readonly string[] = [],
): Manhua0996SourceRef | null {
  try {
    const text = String(raw || "").trim();
    // URL 会把显式默认端口 :443 归一为空；先在原文层拒绝所有显式端口。
    if (/^https:\/\/[^/]+:\d+(?:\/|$)/i.test(text)) return null;
    const url = new URL(text);
    if (
      url.protocol !== "https:"
      || url.username
      || url.password
      || url.port
      || !isAllowedSourceHost(url.hostname, additionalHosts)
    ) return null;
    const match = /^\/vod\/play\/(\d{1,12})\/(?:sid|\d{1,4})\/(\d{1,12})\/?$/.exec(url.pathname);
    if (!match) return null;
    const vodId = match[1]!;
    const nid = match[2]!;
    const host = url.hostname.toLowerCase();
    return {
      host,
      vodId,
      nid,
      canonicalUrl: `https://${host}/vod/play/${vodId}/sid/${nid}`,
    };
  } catch {
    return null;
  }
}

export function isManhua0996SourceUrl(raw: string, additionalHosts: readonly string[] = []): boolean {
  return parseManhua0996SourceUrl(raw, additionalHosts) !== null;
}

export function isTrustedManhua0996SiteUrl(
  raw: string,
  additionalHosts: readonly string[] = [],
): boolean {
  try {
    if (/^https:\/\/[^/]+:\d+(?:\/|$)/i.test(String(raw || "").trim())) return false;
    const url = new URL(raw);
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && isAllowedSourceHost(url.hostname, additionalHosts);
  } catch {
    return false;
  }
}

export function isTrustedManhua0996MediaUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
    const host = url.hostname.toLowerCase();
    return MANHUA_0996_MEDIA_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

function decodeHtmlText(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** SSR 页面已包含完整分集锚点；不用执行站点脚本，也不需要 Cookie。 */
export function parseManhua0996SeriesPage(
  html: string,
  source: Manhua0996SourceRef,
): Manhua0996SeriesPage {
  const text = String(html || "");
  const titleMatch = /<h1\b[^>]*class=["'][^"']*\btitle_name\b[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i.exec(text);
  const titleZh = decodeHtmlText(titleMatch?.[1] || "");
  if (!titleZh) throw new Error("第三方播放页缺少可信剧名，已停止");

  const episodeMap = new Map<string, Manhua0996Episode>();
  const anchorPattern = /<a\b[^>]*href=["']\/vod\/play\/(\d{1,12})\/(?:sid|\d{1,4})\/(\d{1,12})\/?["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  let fallbackIndex = 0;
  while ((match = anchorPattern.exec(text)) !== null) {
    if (match[1] !== source.vodId || episodeMap.has(match[2]!)) continue;
    fallbackIndex += 1;
    const label = decodeHtmlText(match[3] || "");
    const parsedIndex = Number.parseInt(label.replace(/[^0-9]/g, ""), 10);
    const index = Number.isInteger(parsedIndex) && parsedIndex > 0 ? parsedIndex : fallbackIndex;
    episodeMap.set(match[2]!, {
      index,
      nid: match[2]!,
      url: `https://${source.host}/vod/play/${source.vodId}/sid/${match[2]!}`,
      title: `第${index}集`,
    });
  }
  const episodes = Array.from(episodeMap.values()).sort((left, right) => left.index - right.index);
  if (!episodes.length) throw new Error("第三方播放页没有解析到分集目录，已停止");
  const totalMatch = /第\s*\d+\s*集[^<]{0,32}共\s*(\d+)\s*集/i.exec(text);
  const declaredTotal = Number(totalMatch?.[1]);
  if (!Number.isInteger(declaredTotal) || declaredTotal < 1 || episodes.length !== declaredTotal) {
    throw new Error("第三方播放页分集目录未完整展开，已停止以免集号错位");
  }
  const current = episodes.find((episode) => episode.nid === source.nid);
  if (!current) throw new Error("当前播放集不在同剧分集目录中，已停止以免写错集号");
  const uniqueIndexes = new Set(episodes.map((episode) => episode.index));
  if (uniqueIndexes.size !== episodes.length) throw new Error("第三方分集目录存在重复集号，已停止");
  return {
    vodId: source.vodId,
    currentNid: source.nid,
    currentEpisodeIndex: current.index,
    titleZh,
    episodes,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function marker(input: {
  kind: Manhua0996SourceMarker["kind"];
  start: unknown;
  end?: unknown;
}): Manhua0996SourceMarker | null {
  const startSec = Number(input.start);
  const endSec = Number(input.end);
  if (!Number.isFinite(startSec) || startSec < 0) return null;
  return {
    kind: input.kind,
    startSec,
    ...(Number.isFinite(endSec) && endSec > startSec ? { endSec } : {}),
    origin: "source_api",
  };
}

/**
 * 只选无需登录且接口明确标记可用的媒体档；登录档和任意外域全部拒绝。
 * 来源秒位只是标识，绝不在本层或学习层自动剪除。
 */
export function parseManhua0996PlaybackResponse(
  payload: unknown,
  referer = "https://0996zp.com/",
  /**
   * 🔑 站点自有凭证已配置时，允许取 `needLogin: true` 的高清档（0830 用户令）。
   *
   * 实测（gzcrkt8888 某集，带 cookie+authorization 查接口）返回三档：
   *   1080p needLogin=true · 720p needLogin=true · 480p needLogin=false
   * 而 480p 那档的实际流是 **864×360**——低于知识库那条「清晰度地板 540p，
   * 360p 及以下已确认出现影像判断问题」，实弹表现就是模型看不清切点、
   * 300 秒只给 2 个镜头、门禁反复拦、钱全烧在重试上。
   *
   * 🔒 缺省仍为 false：**没有凭证时行为一字不变**，「不碰登录墙」的边界照旧。
   * 只有站点主人自己把凭证配进 Fly secrets，才等于授权用自己的账号取高清。
   */
  allowLoginRequired = false,
): Manhua0996Playback {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  if (Number(root?.code) !== 200 || !data) throw new Error("第三方媒体接口返回失败，已停止");
  const rows = Array.isArray(data.list) ? data.list : [];
  const candidates = rows.flatMap((raw, order) => {
    const row = asRecord(raw);
    const url = String(row?.url ?? row?.playUrl ?? "").trim();
    if (!row || !isTrustedManhua0996MediaUrl(url)) return [];
    // needLogin：无凭证时只收 false（原行为）；有凭证时两种都收。
    if (row.needLogin !== false && !allowLoginRequired) return [];
    // flag：仅在无凭证路径上沿用旧的严格判定，避免改动波及既有片源。
    if (!allowLoginRequired && row.flag !== true) return [];
    const quality = Number(row.resolution ?? row.height ?? row.quality ?? row.level) || 0;
    return [{ url, quality, order }];
  }).sort((left, right) => (
    // 🎯 从 720p 开始读（0830 用户拍板）：不是「取最高」。
    // 1080p 的输入 token 明显更贵而对切镜判定的边际收益有限；
    // 480p 那档实际流是 864×360，低于知识库「清晰度地板 540p」，
    // 实弹表现是看不清切点、300 秒只给 2 个镜头、门禁反复拦、钱烧在重试上。
    // 优先序：720p → 其余按清晰度降序（即 1080p → 480p）。
    (left.quality === MANHUA_0996_PREFERRED_QUALITY ? 0 : 1)
      - (right.quality === MANHUA_0996_PREFERRED_QUALITY ? 0 : 1)
    || right.quality - left.quality
    || left.order - right.order
  ));
  const playbackUrls = Array.from(new Set(candidates.map((candidate) => candidate.url)));
  if (!playbackUrls.length) {
    throw new Error(allowLoginRequired
      ? "第三方媒体接口没有可信媒体档，已停止"
      : "第三方媒体接口没有无需登录的可信媒体档，已停止");
  }
  const markers = [
    marker({ kind: "opening", start: data.headStart, end: data.headEnd }),
    marker({ kind: "ending", start: data.tailStart, end: data.tailEnd }),
  ].filter((row): row is Manhua0996SourceMarker => Boolean(row));
  return {
    playbackUrl: playbackUrls[0]!,
    playbackUrls,
    referer,
    markers,
  };
}
