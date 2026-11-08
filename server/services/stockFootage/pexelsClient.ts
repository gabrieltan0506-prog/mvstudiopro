/**
 * Pexels 服务端客户端。凭证只从 Fly secrets（PEXELS_API_KEY）读取，绝不下发前端、
 * 不写进任务 payload / 日志。只负责：搜索、按 id 取规范元数据、挑选下载文件。
 */
import {
  matchesOrientation,
  type StockFootageCandidate,
  type StockFootageKind,
  type StockFootageOrientation,
  type StockFootageSearchParams,
  type StockFootageSearchResult,
} from "../../../shared/stockFootage";

const PEXELS_API = "https://api.pexels.com";

export class StockFootageError extends Error {
  constructor(
    public kind: "not_configured" | "rate_limited" | "not_found" | "upstream" | "invalid" | "conflict" | "too_large",
    message: string
  ) {
    super(message);
  }
}

export type PexelsUser = { id?: number; name?: string; url?: string };
export type PexelsVideoFile = {
  id: number;
  quality?: string | null;
  file_type?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  link: string;
};
export type PexelsVideo = {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  duration: number;
  user?: PexelsUser;
  video_files?: PexelsVideoFile[];
};
export type PexelsPhoto = {
  id: number;
  width: number;
  height: number;
  url: string;
  alt?: string;
  photographer?: string;
  photographer_url?: string;
  src: Record<string, string>;
};

export type PexelsFetch = (url: string, init: RequestInit) => Promise<Response>;

export function getPexelsApiKey(env: NodeJS.ProcessEnv = process.env): string {
  const key = (env.PEXELS_API_KEY || "").trim();
  if (!key) throw new StockFootageError("not_configured", "素材检索暂未开放，请稍后再试");
  return key;
}

async function pexelsGet<T>(path: string, params: Record<string, string | number | undefined>, deps: { fetch?: PexelsFetch; apiKey?: string } = {}) {
  const apiKey = deps.apiKey ?? getPexelsApiKey();
  const url = new URL(path, PEXELS_API);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const response = await (deps.fetch ?? fetch)(url.toString(), {
    headers: { Authorization: apiKey, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  const remaining = Number(response.headers.get("x-ratelimit-remaining"));
  if (response.status === 429) throw new StockFootageError("rate_limited", "素材检索额度已用完，请稍后再试");
  if (response.status === 404) throw new StockFootageError("not_found", "素材不存在或已下架");
  if (response.status === 401 || response.status === 403)
    throw new StockFootageError("not_configured", "素材检索暂未开放，请稍后再试");
  if (!response.ok) throw new StockFootageError("upstream", `素材服务暂不可用（${response.status}）`);
  const json = (await response.json()) as T;
  return { json, rateLimitRemaining: Number.isFinite(remaining) ? remaining : undefined };
}

function author(user?: PexelsUser): StockFootageCandidate["author"] {
  return { name: (user?.name || "Pexels").slice(0, 300), ...(user?.url ? { url: user.url } : {}) };
}

/** 低清预览：优先 sd/最小宽度 mp4，避免预览就拉 4K。 */
export function pickPreviewVideoFile(files: PexelsVideoFile[] = []): PexelsVideoFile | undefined {
  return files
    .filter(f => f.file_type === "video/mp4" && f.link && (f.width ?? 0) > 0)
    .sort((a, b) => (a.width ?? 0) - (b.width ?? 0))
    .find(f => Math.min(f.width ?? 0, f.height ?? 0) >= 360);
}

/**
 * 入片文件：mp4，短边不超过 maxShortSide（默认 1080），在其中取最大；
 * 若指定画幅，优先与画幅一致的文件。不选 hls / 未知类型。
 */
export function pickBestVideoFile(
  files: PexelsVideoFile[] = [],
  orientation?: StockFootageOrientation,
  maxShortSide = 1080
): PexelsVideoFile | undefined {
  const mp4 = files.filter(f => f.file_type === "video/mp4" && f.link && (f.width ?? 0) > 0 && (f.height ?? 0) > 0);
  const shortSide = (f: PexelsVideoFile) => Math.min(f.width ?? 0, f.height ?? 0);
  const ranked = (list: PexelsVideoFile[]) => {
    const within = list.filter(f => shortSide(f) <= maxShortSide).sort((a, b) => shortSide(b) - shortSide(a));
    if (within.length) return within[0];
    return [...list].sort((a, b) => shortSide(a) - shortSide(b))[0];
  };
  const oriented = mp4.filter(f => matchesOrientation(f.width ?? 0, f.height ?? 0, orientation));
  return ranked(oriented.length ? oriented : mp4);
}

/** 照片入库：large2x（约 1880 宽）足够成片/参考；无则 original。 */
export function pickPhotoSource(photo: PexelsPhoto): { key: string; url: string } | undefined {
  for (const key of ["large2x", "original", "large"]) if (photo.src?.[key]) return { key, url: photo.src[key] };
  return undefined;
}

export function videoToCandidate(v: PexelsVideo): StockFootageCandidate {
  return {
    provider: "pexels",
    providerAssetId: String(v.id),
    kind: "video",
    pageUrl: v.url,
    previewImageUrl: v.image,
    previewVideoUrl: pickPreviewVideoFile(v.video_files)?.link,
    width: v.width,
    height: v.height,
    durationSec: v.duration,
    author: author(v.user),
  };
}

export function photoToCandidate(p: PexelsPhoto): StockFootageCandidate {
  return {
    provider: "pexels",
    providerAssetId: String(p.id),
    kind: "photo",
    pageUrl: p.url,
    previewImageUrl: p.src?.medium || p.src?.large || p.src?.original || "",
    width: p.width,
    height: p.height,
    author: { name: (p.photographer || "Pexels").slice(0, 300), ...(p.photographer_url ? { url: p.photographer_url } : {}) },
    ...(p.alt ? { alt: p.alt.slice(0, 500) } : {}),
  };
}

type CacheEntry = { at: number; value: StockFootageSearchResult };
const SEARCH_TTL_MS = 10 * 60_000;
const SEARCH_CACHE_MAX = 300;
const searchCache = new Map<string, CacheEntry>();

export function clearStockSearchCache() {
  searchCache.clear();
}

export async function searchPexels(
  params: StockFootageSearchParams,
  deps: { fetch?: PexelsFetch; apiKey?: string; now?: () => number } = {}
): Promise<StockFootageSearchResult> {
  const now = deps.now ?? Date.now;
  const cacheKey = JSON.stringify([params.kind, params.query.toLowerCase(), params.orientation, params.minDurationSec, params.maxDurationSec, params.page, params.perPage, params.locale]);
  const hit = searchCache.get(cacheKey);
  if (hit && now() - hit.at < SEARCH_TTL_MS) return { ...hit.value, cached: true };

  let result: StockFootageSearchResult;
  if (params.kind === "video") {
    const { json, rateLimitRemaining } = await pexelsGet<{ page: number; per_page: number; total_results: number; next_page?: string; videos: PexelsVideo[] }>(
      "/videos/search",
      {
        query: params.query,
        orientation: params.orientation,
        min_duration: params.minDurationSec,
        max_duration: params.maxDurationSec,
        page: params.page,
        per_page: params.perPage,
        locale: params.locale,
      },
      deps
    );
    const candidates = (json.videos || [])
      .filter(v => (!params.minDurationSec || v.duration >= params.minDurationSec) && (!params.maxDurationSec || v.duration <= params.maxDurationSec))
      .filter(v => pickBestVideoFile(v.video_files, params.orientation))
      .map(videoToCandidate);
    result = { provider: "pexels", page: json.page ?? params.page, perPage: json.per_page ?? params.perPage, totalResults: json.total_results ?? candidates.length, hasMore: Boolean(json.next_page), candidates, rateLimitRemaining, cached: false };
  } else {
    const { json, rateLimitRemaining } = await pexelsGet<{ page: number; per_page: number; total_results: number; next_page?: string; photos: PexelsPhoto[] }>(
      "/v1/search",
      { query: params.query, orientation: params.orientation, page: params.page, per_page: params.perPage, locale: params.locale },
      deps
    );
    const candidates = (json.photos || []).filter(p => pickPhotoSource(p)).map(photoToCandidate);
    result = { provider: "pexels", page: json.page ?? params.page, perPage: json.per_page ?? params.perPage, totalResults: json.total_results ?? candidates.length, hasMore: Boolean(json.next_page), candidates, rateLimitRemaining, cached: false };
  }
  if (searchCache.size >= SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value as string);
  searchCache.set(cacheKey, { at: now(), value: result });
  return result;
}

export async function getPexelsAsset(
  kind: StockFootageKind,
  id: string,
  deps: { fetch?: PexelsFetch; apiKey?: string } = {}
): Promise<{ kind: "video"; video: PexelsVideo } | { kind: "photo"; photo: PexelsPhoto }> {
  if (!/^\d{1,20}$/.test(id)) throw new StockFootageError("invalid", "素材编号无效");
  if (kind === "video") {
    const { json } = await pexelsGet<PexelsVideo>(`/videos/videos/${id}`, {}, deps);
    if (String(json.id) !== id) throw new StockFootageError("upstream", "素材元数据与编号不一致");
    return { kind, video: json };
  }
  const { json } = await pexelsGet<PexelsPhoto>(`/v1/photos/${id}`, {}, deps);
  if (String(json.id) !== id) throw new StockFootageError("upstream", "素材元数据与编号不一致");
  return { kind, photo: json };
}
