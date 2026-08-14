import type { GrowthPlatform } from "@shared/growth";
import type { TrendItem } from "./trendCollector";
import type { PlatformTrendCollection } from "./trendCollector";

/** 每个被选平台各自送 Terra 20 张真实封面，禁止跨平台互相挤占名额。 */
export const TREND_COVER_CANDIDATE_LIMIT = 20;
/** 每个平台前十名展示封面与高点击原因；11–20 名只展示标题和作者。 */
export const TREND_COVER_DISPLAY_LIMIT = 10;
export const TREND_COVER_BACKFILL_WINDOW_DAYS = 15;
export const TREND_COVER_BACKFILL_LIMIT_PER_PLATFORM = 30;
export const TREND_COVER_COLLECTION_DEFAULT_START_AT = "2026-08-14T04:54:14+08:00";

export type TrendCoverReference = {
  sourceId: string;
  platform: GrowthPlatform;
  title: string;
  author?: string;
  sourceUrl?: string;
  coverUrl?: string;
  coverCapturedAt?: string;
  visualAssetKind?: "platform_cover" | "representative_frame";
  visualFrameProgress?: number;
  score: number;
};

const PLATFORM_COVER_HOST_SUFFIXES: Partial<Record<GrowthPlatform, string[]>> = {
  douyin: ["douyin.com", "douyinpic.com", "byteimg.com", "snssdk.com", "pstatp.com", "bytedance.com"],
  xiaohongshu: ["xiaohongshu.com", "xhscdn.com"],
  bilibili: ["bilibili.com", "hdslb.com"],
  weixin_channels: ["mvstudiopro.com", "mvstudiopro.fly.dev", "storage.googleapis.com", "googleapis.com"],
};

function isAllowedPlatformRemoteUrl(platform: GrowthPlatform, rawUrl: string) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return (PLATFORM_COVER_HOST_SUFFIXES[platform] || []).some(
      (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}

export function getTrendCoverCollectionStartAt() {
  const configured = String(process.env.GROWTH_COVER_COLLECTION_START_AT || "").trim();
  return configured || TREND_COVER_COLLECTION_DEFAULT_START_AT;
}

export function isTrendCoverCollectionActive(at = new Date()) {
  const startMs = Date.parse(getTrendCoverCollectionStartAt());
  return Number.isFinite(startMs) && at.getTime() >= startMs;
}

function firstHttpUrl(values: unknown[]): string | undefined {
  const queue = [...values];
  while (queue.length) {
    const value = queue.shift();
    if (typeof value === "string") {
      const text = value.trim().replace(/^http:\/\//i, "https://");
      if (/^https:\/\//i.test(text)) return text;
      continue;
    }
    if (Array.isArray(value)) {
      queue.unshift(...value);
      continue;
    }
    if (value && typeof value === "object") {
      const row = value as Record<string, unknown>;
      queue.unshift(
        row.url_list,
        row.urlList,
        row.url_default,
        row.urlDefault,
        row.url_pre,
        row.urlPre,
        row.pic,
        row.url,
      );
    }
  }
  return undefined;
}

/** 只读取平台真实返回的封面字段；没有真实 URL 时保持空值。 */
export function extractPlatformCoverUrl(platform: GrowthPlatform, raw: Record<string, any>) {
  if (platform === "douyin") {
    return firstHttpUrl([
      raw.video?.cover,
      raw.video?.origin_cover,
      raw.video?.dynamic_cover,
      raw.cover,
      raw.images?.[0],
    ]);
  }
  if (platform === "xiaohongshu") {
    const note = raw.noteCard ?? raw.note_card ?? raw;
    return firstHttpUrl([
      note.cover,
      note.imageList?.[0],
      note.image_list?.[0],
      raw.cover,
    ]);
  }
  if (platform === "bilibili") {
    return firstHttpUrl([raw.pic, raw.cover, raw.first_frame, raw.firstFrame]);
  }
  return firstHttpUrl([raw.coverUrl]);
}

export function trendCoverScore(item: Pick<TrendItem, "views" | "likes" | "comments" | "shares" | "favorites" | "hotValue">) {
  const log = (value: unknown) => Math.log10(Math.max(0, Number(value) || 0) + 1);
  return Number((
    log(item.views) * 1.5
    + log(item.likes) * 2.2
    + log(item.comments) * 1.4
    + log(item.shares) * 1.8
    + log(item.favorites) * 1.8
    + log(item.hotValue) * 0.5
  ).toFixed(4));
}

function htmlImageMeta(html: string) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match?.[1]) return match[1].replace(/&amp;/g, "&").replace(/^http:\/\//i, "https://");
  }
  return undefined;
}

function coverBackfillCookie(platform: GrowthPlatform) {
  if (platform === "douyin") return String(process.env.DOUYIN_COOKIE || "").trim();
  if (platform === "xiaohongshu") return String(process.env.XIAOHONGSHU_COOKIE || process.env.XHS_COOKIE || "").trim();
  if (platform === "bilibili") return String(process.env.BILIBILI_COOKIE || "").trim();
  return "";
}

async function resolveCoverFromPublicPage(platform: GrowthPlatform, item: TrendItem) {
  if (!item.url || !isAllowedPlatformRemoteUrl(platform, item.url)) return undefined;
  const response = await fetch(item.url, {
    headers: {
      accept: "text/html,application/xhtml+xml",
      "user-agent": "Mozilla/5.0 mvstudiopro-growth-cover-backfill/1.0",
      ...(coverBackfillCookie(platform) ? { cookie: coverBackfillCookie(platform) } : {}),
    },
    redirect: "follow",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) return undefined;
  const coverUrl = htmlImageMeta(await response.text());
  return coverUrl && isAllowedPlatformRemoteUrl(platform, coverUrl) ? coverUrl : undefined;
}

/**
 * 每次平台采集成功后串行回补近 15 天最多 30 条旧记录。
 * 仅访问公开页面/已有登录 Cookie，不调用任何模型；失败条目保持无封面。
 */
export async function backfillRecentTrendCoverUrls(
  platform: GrowthPlatform,
  collection: PlatformTrendCollection,
  now = Date.now(),
) {
  if (!isTrendCoverCollectionActive(new Date(now))) return { collection, attempted: 0, resolved: 0 };
  const cutoff = now - TREND_COVER_BACKFILL_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const targets = collection.items
    .filter((item) => !item.coverUrl && item.url)
    .filter((item) => {
      const publishedMs = Date.parse(String(item.publishedAt || ""));
      return Number.isFinite(publishedMs) && publishedMs >= cutoff && publishedMs <= now;
    })
    .sort((a, b) => trendCoverScore(b) - trendCoverScore(a))
    .slice(0, TREND_COVER_BACKFILL_LIMIT_PER_PLATFORM);
  if (!targets.length) return { collection, attempted: 0, resolved: 0 };
  const coverById = new Map<string, { coverUrl: string; coverCapturedAt: string }>();
  for (const item of targets) {
    try {
      const coverUrl = await resolveCoverFromPublicPage(platform, item);
      if (coverUrl) coverById.set(item.id, { coverUrl, coverCapturedAt: new Date(now).toISOString() });
    } catch (error) {
      console.warn(`[growth-cover] backfill failed platform=${platform} id=${item.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return {
    collection: {
      ...collection,
      items: collection.items.map((item) => ({ ...item, ...(coverById.get(item.id) || {}) })),
      notes: [...collection.notes, `Cover backfill: ${coverById.size}/${targets.length} resolved without model calls.`],
    },
    attempted: targets.length,
    resolved: coverById.size,
  };
}

/** 同一平台内容只保留一条；允许类目重复，按真实互动信号各选 Top20。 */
export function selectTrendCoverCandidates(
  collections: Partial<Record<GrowthPlatform, { items?: TrendItem[] }>>,
  options?: { startAt?: string; contentStartAt?: number; endExclusive?: number },
): TrendCoverReference[] {
  const startMs = Date.parse(options?.startAt || getTrendCoverCollectionStartAt());
  const endExclusive = options?.endExclusive ?? Number.POSITIVE_INFINITY;
  const supported = new Set<GrowthPlatform>(["douyin", "xiaohongshu", "bilibili", "weixin_channels"]);
  const rows: TrendCoverReference[] = [];
  for (const [platform, collection] of Object.entries(collections) as Array<[GrowthPlatform, { items?: TrendItem[] }]>) {
    if (!supported.has(platform)) continue;
    for (const item of collection?.items || []) {
      const capturedMs = Date.parse(String(item.coverCapturedAt || ""));
      if (!item.coverUrl || !Number.isFinite(capturedMs) || capturedMs < startMs || capturedMs >= endExclusive) continue;
      if (!isAllowedPlatformRemoteUrl(platform, item.coverUrl)) continue;
      const contentMs = Date.parse(String(item.publishedAt || item.sourceEvidence?.observedAt || item.coverCapturedAt || ""));
      if (options?.contentStartAt !== undefined
        && (!Number.isFinite(contentMs) || contentMs < options.contentStartAt || contentMs >= endExclusive)) continue;
      rows.push({
        sourceId: `${platform}:${item.id}`,
        platform,
        title: item.title,
        author: item.author,
        sourceUrl: item.url,
        coverUrl: item.coverUrl,
        coverCapturedAt: item.coverCapturedAt,
        visualAssetKind: item.visualAssetKind || "platform_cover",
        visualFrameProgress: item.visualFrameProgress,
        score: trendCoverScore(item),
      });
    }
  }
  const platformOrder = Array.from(new Set(rows.map((row) => row.platform)));
  return platformOrder.flatMap((platform) => rows
    .filter((row) => row.platform === platform)
    .sort((a, b) => b.score - a.score || String(b.coverCapturedAt).localeCompare(String(a.coverCapturedAt)))
    .filter((row, index, all) => all.findIndex((other) => other.sourceId === row.sourceId) === index)
    .slice(0, TREND_COVER_CANDIDATE_LIMIT));
}

/**
 * Terra 可重排每个平台的候选；若漏 ID、伪造 ID 或少于 20 条，服务端按真实
 * 互动预排补齐。返回顺序固定为平台输入顺序、平台内 Terra 排名顺序。
 */
export function completeTrendCoverRanking(
  candidates: readonly TrendCoverReference[],
  selectedSourceIds: readonly string[],
) {
  const byId = new Map(candidates.map((row) => [row.sourceId, row]));
  const platformOrder = Array.from(new Set(candidates.map((row) => row.platform)));
  return platformOrder.flatMap((platform) => {
    const platformCandidates = candidates.filter((row) => row.platform === platform);
    const selected = selectedSourceIds
      .map((id) => byId.get(String(id)))
      .filter((row): row is TrendCoverReference => Boolean(row && row.platform === platform))
      .filter((row, index, all) => all.findIndex((other) => other.sourceId === row.sourceId) === index);
    const selectedIds = new Set(selected.map((row) => row.sourceId));
    return [...selected, ...platformCandidates.filter((row) => !selectedIds.has(row.sourceId))]
      .slice(0, TREND_COVER_CANDIDATE_LIMIT);
  });
}

/** Terra 只返回 sourceId；服务端据此镜像最终 Top10，避免模型伪造标题、作者或 URL。 */
export async function mirrorSelectedTrendCovers(
  candidates: TrendCoverReference[],
  selectedSourceIds: readonly string[],
) {
  const byId = new Map(candidates.map((row) => [row.sourceId, row]));
  const selected = selectedSourceIds
    .map((id) => byId.get(String(id)))
    .filter((row): row is TrendCoverReference => Boolean(row?.coverUrl))
    .filter((row, index, all) => all.findIndex((other) => other.sourceId === row.sourceId) === index)
    .filter((row, index, all) => all.slice(0, index).filter((other) => other.platform === row.platform).length < TREND_COVER_DISPLAY_LIMIT);
  const output: Array<TrendCoverReference & { rank: number; persisted: boolean }> = [];
  const rankByPlatform = new Map<GrowthPlatform, number>();
  for (let index = 0; index < selected.length; index += 1) {
    const row = selected[index]!;
    const rank = (rankByPlatform.get(row.platform) || 0) + 1;
    rankByPlatform.set(row.platform, rank);
    let coverUrl = row.coverUrl;
    let persisted = false;
    try {
      if (!row.coverUrl || !isAllowedPlatformRemoteUrl(row.platform, row.coverUrl)) throw new Error("cover_host_not_allowed");
      const response = await fetch(String(row.coverUrl), { signal: AbortSignal.timeout(20_000) });
      if (!response.ok) throw new Error(`cover_fetch_${response.status}`);
      const original = Buffer.from(await response.arrayBuffer());
      if (original.length < 64 || original.length > 12 * 1024 * 1024) throw new Error("cover_size_invalid");
      const { default: sharp } = await import("sharp");
      const normalized = await sharp(original, { failOn: "none" })
        .rotate()
        .resize({ width: 640, height: 960, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 78, mozjpeg: true })
        .toBuffer();
      const { uploadBufferToPlatformStorage } = await import("../services/evolinkGptImage2.js");
      coverUrl = await uploadBufferToPlatformStorage(normalized, `growth_cover_winners/${row.platform}`);
      persisted = true;
    } catch (error) {
      console.warn(`[growth-cover] mirror failed sourceId=${row.sourceId}: ${error instanceof Error ? error.message : String(error)}`);
    }
    output.push({ ...row, coverUrl, rank, persisted });
  }
  return output;
}
