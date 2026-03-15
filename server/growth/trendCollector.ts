import vm from "node:vm";
import {
  growthPlatformValues,
  type GrowthPlatform,
} from "@shared/growth";
import { classifyTrendItem, countLabels } from "./trendTaxonomy";

export type TrendSource = "live" | "seed";

export type TrendItem = {
  id: string;
  title: string;
  bucket?: string;
  author?: string;
  url?: string;
  publishedAt?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  views?: number;
  hotValue?: number;
  contentType?: "video" | "note" | "topic";
  tags?: string[];
  industryLabels?: string[];
  ageLabels?: string[];
  contentLabels?: string[];
};

export type TrendCollectionStats = {
  platform: GrowthPlatform;
  itemCount: number;
  uniqueAuthorCount: number;
  bucketCounts: Record<string, number>;
  requestCount: number;
  pageDepth: number;
  targetPerRun: number;
  referenceMinItems: number;
  referenceMaxItems: number;
  collectorMode: "authenticated_feed" | "public_feed" | "hot_topics" | "hybrid" | "seed";
  industryCounts: Record<string, number>;
  ageCounts: Record<string, number>;
  contentCounts: Record<string, number>;
};

export type PlatformTrendCollection = {
  platform: GrowthPlatform;
  source: TrendSource;
  collectedAt: string;
  windowDays: number;
  items: TrendItem[];
  notes: string[];
  stats: TrendCollectionStats;
};

const PLATFORM_BUCKET_DEFAULTS: Partial<Record<GrowthPlatform, string>> = {
  douyin: "douyin_feed",
  kuaishou: "kuaishou_feed",
  bilibili: "bilibili_feed",
  xiaohongshu: "xiaohongshu_feed",
  weixin_channels: "weixin_channels_feed",
  toutiao: "toutiao_feed",
};

const PLATFORM_REFERENCE_RANGES: Partial<Record<GrowthPlatform, { min: number; max: number }>> = {
  douyin: { min: 12, max: 30 },
  kuaishou: { min: 12, max: 36 },
  bilibili: { min: 40, max: 80 },
  xiaohongshu: { min: 20, max: 60 },
};

const DEFAULT_WINDOW_DAYS = 30;
const WINDOW_FALLBACKS = [60, 90, 120, 180];
const MIN_PLATFORM_ITEM_TARGET = 10_000;

function parseNumberEnv(name: string, fallback: number) {
  const value = Number(process.env[name] || fallback);
  return Number.isFinite(value) ? value : fallback;
}

function getTargetWindowDays() {
  return Math.max(7, parseNumberEnv("GROWTH_TARGET_WINDOW_DAYS", DEFAULT_WINDOW_DAYS));
}

function getFallbackWindowDays() {
  const configured = parseCsvEnv("GROWTH_WINDOW_FALLBACK_DAYS")
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item) && item > getTargetWindowDays() && item <= 180)
    .sort((left, right) => left - right);
  return configured.length ? configured : WINDOW_FALLBACKS;
}

function getWindowCandidates() {
  return [getTargetWindowDays(), ...getFallbackWindowDays()];
}

function getMaxWindowDays() {
  return getWindowCandidates().slice(-1)[0] || DEFAULT_WINDOW_DAYS;
}

function getPlatformTargetItemCount(platform: GrowthPlatform) {
  return Math.max(
    MIN_PLATFORM_ITEM_TARGET,
    parseNumberEnv(`${platform.toUpperCase()}_TREND_MIN_ITEMS`, MIN_PLATFORM_ITEM_TARGET),
  );
}

function parseChineseCount(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const normalized = raw.replace(/,/g, "");
  const wan = normalized.match(/^([\d.]+)\s*万$/);
  if (wan) return Math.round(Number(wan[1]) * 10_000);
  const yi = normalized.match(/^([\d.]+)\s*亿$/);
  if (yi) return Math.round(Number(yi[1]) * 100_000_000);
  const num = Number(normalized.replace(/[^\d.]/g, ""));
  return Number.isFinite(num) ? num : undefined;
}

function safeDateFromUnix(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp * 1000).toISOString();
}

function safeDateFromTimestamp(timestamp?: number) {
  if (!timestamp || !Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp > 1_000_000_000_000 ? timestamp : timestamp * 1000).toISOString();
}

function parseCsvEnv(name: string) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeTrendBucket(platform: GrowthPlatform, bucket?: string, contentType?: TrendItem["contentType"]) {
  const raw = String(bucket || "").trim();
  if (raw) return raw;
  if (platform === "douyin" && contentType === "topic") return "douyin_topics";
  return PLATFORM_BUCKET_DEFAULTS[platform] || `${platform}_${contentType || "feed"}`;
}

function getBucketCounts(items: TrendItem[]) {
  return items.reduce<Record<string, number>>((acc, item) => {
    const bucket = String(item.bucket || item.contentType || "default").trim() || "default";
    acc[bucket] = (acc[bucket] || 0) + 1;
    return acc;
  }, {});
}

function getAgeDays(iso?: string) {
  if (!iso) return undefined;
  const timestamp = new Date(iso).getTime();
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000)));
}

function getItemsWithinDays(items: TrendItem[], days: number) {
  return items.filter((item) => {
    const ageDays = getAgeDays(item.publishedAt);
    return ageDays === undefined || ageDays <= days;
  });
}

function resolveCollectionWindow(items: TrendItem[], referenceMinItems: number, platform: GrowthPlatform) {
  const windows = getWindowCandidates().map((days) => ({
    days,
    count: getItemsWithinDays(items, days).length,
  }));
  const threshold = Math.max(referenceMinItems, Math.min(500, getPlatformTargetItemCount(platform)));
  const preferred = windows.find((window) => window.count >= threshold) || windows[windows.length - 1];
  return {
    windowDays: preferred?.days || getTargetWindowDays(),
    selectedCount: preferred?.count || items.length,
    windows,
  };
}

function finalizeCollection(
  platform: GrowthPlatform,
  source: TrendSource,
  items: TrendItem[],
  notes: string[],
  statsInput: Omit<TrendCollectionStats, "platform" | "itemCount" | "uniqueAuthorCount" | "bucketCounts" | "industryCounts" | "ageCounts" | "contentCounts">,
): PlatformTrendCollection {
  const normalizedItems = items.map((item) => ({
    ...item,
    bucket: normalizeTrendBucket(platform, item.bucket, item.contentType),
    ...classifyTrendItem(item),
  }));
  const resolvedWindow = resolveCollectionWindow(
    normalizedItems,
    statsInput.referenceMinItems,
    platform,
  );
  const windowFilteredItems = getItemsWithinDays(normalizedItems, resolvedWindow.windowDays);
  const uniqueAuthorCount = new Set(
    windowFilteredItems.map((item) => String(item.author || "").trim()).filter(Boolean),
  ).size;
  const enrichedNotes = [
    ...notes,
    `Target lookback: ${getTargetWindowDays()} days; fallback windows: ${getFallbackWindowDays().join(", ")} days.`,
    `Selected ${resolvedWindow.windowDays}-day window for ${platform}; sample counts by window: ${resolvedWindow.windows.map((item) => `${item.days}d=${item.count}`).join(", ")}.`,
    `Target item floor for ${platform}: ${getPlatformTargetItemCount(platform)}.`,
  ];
  return {
    platform,
    source,
    collectedAt: new Date().toISOString(),
    windowDays: resolvedWindow.windowDays,
    items: windowFilteredItems,
    notes: enrichedNotes,
    stats: {
      platform,
      itemCount: windowFilteredItems.length,
      uniqueAuthorCount,
      bucketCounts: getBucketCounts(windowFilteredItems),
      industryCounts: countLabels(windowFilteredItems, "industryLabels"),
      ageCounts: countLabels(windowFilteredItems, "ageLabels"),
      contentCounts: countLabels(windowFilteredItems, "contentLabels"),
      ...statsInput,
    },
  };
}

async function collectBilibili(): Promise<PlatformTrendCollection> {
  const items: TrendItem[] = [];
  const notes: string[] = [];
  const cookie = String(process.env.BILIBILI_COOKIE || "").trim();
  const popularPages = Math.max(1, Math.min(200, Number(process.env.BILIBILI_TREND_PAGES || 20) || 20));
  const popularPageSize = Math.max(10, Math.min(50, Number(process.env.BILIBILI_TREND_PAGE_SIZE || 50) || 50));
  const authPageSize = Math.max(6, Math.min(50, Number(process.env.BILIBILI_AUTH_TREND_PAGE_SIZE || 30) || 30));

  const pushBilibiliItem = (item: Record<string, any>) => {
    const title = String(item.title ?? "").trim();
    if (!title) return;
    items.push({
      id: String(item.aid ?? item.id ?? item.bvid ?? `bili-${items.length}`),
      title,
      bucket: "bilibili_feed",
      author: String(item.owner?.name ?? "").trim() || undefined,
      url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : undefined,
      publishedAt: safeDateFromUnix(Number(item.pubdate)),
      likes: Number(item.stat?.like ?? 0) || undefined,
      comments: Number(item.stat?.reply ?? 0) || undefined,
      shares: Number(item.stat?.share ?? 0) || undefined,
      views: Number(item.stat?.view ?? 0) || undefined,
      hotValue: Number(item.stat?.like ?? 0) + Number(item.stat?.reply ?? 0),
      contentType: "video",
      tags: [String(item.tname ?? "").trim()].filter(Boolean),
    });
  };

  if (cookie) {
    const response = await fetch(`https://api.bilibili.com/x/web-interface/index/top/feed/rcmd?ps=${authPageSize}&fresh_type=4&fresh_idx=1&fresh_idx_1h=1`, {
      headers: {
        accept: "application/json,text/plain,*/*",
        cookie,
        referer: "https://www.bilibili.com/",
        "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`Bilibili recommend API responded with ${response.status}`);
    }
    const payload = await response.json() as {
      data?: { item?: Array<Record<string, any>> };
    };
    const list = payload.data?.item ?? [];
    list.forEach(pushBilibiliItem);
    notes.push(`Fetched ${list.length} authenticated Bilibili recommended videos.`);
  }

  for (const page of Array.from({ length: popularPages }, (_, index) => index + 1)) {
    const response = await fetch(`https://api.bilibili.com/x/web-interface/popular?pn=${page}&ps=${popularPageSize}`, {
      headers: { "user-agent": "mvstudiopro-growth-collector/1.0" },
    });
    if (!response.ok) {
      throw new Error(`Bilibili API responded with ${response.status}`);
    }
    const payload = await response.json() as {
      data?: { list?: Array<Record<string, any>> };
    };
    const list = payload.data?.list ?? [];
    list.forEach(pushBilibiliItem);
  }

  notes.push(`Fetched ${items.length} total Bilibili videos after merging popular and authenticated feed.`);
  return finalizeCollection("bilibili", "live", items, notes, {
    collectorMode: cookie ? "hybrid" : "public_feed",
    requestCount: popularPages + (cookie ? 1 : 0),
    pageDepth: popularPages,
    targetPerRun: Math.max(popularPages * popularPageSize + (cookie ? authPageSize : 0), getPlatformTargetItemCount("bilibili")),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.bilibili?.min || 40,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.bilibili?.max || 80,
  });
}

async function collectDouyin(): Promise<PlatformTrendCollection> {
  const cookie = String(process.env.DOUYIN_COOKIE || "").trim();
  if (cookie) {
    const pageLimit = Math.max(1, Math.min(200, Number(process.env.DOUYIN_TREND_PAGES || 60) || 60));
    const pageSize = Math.max(8, Math.min(20, Number(process.env.DOUYIN_TREND_PAGE_SIZE || 12) || 12));
    const items: TrendItem[] = [];
    const notes: string[] = [];
    let maxCursor = "0";
    let hasMore = 0;
    let requestCount = 0;

    for (let page = 0; page < pageLimit; page += 1) {
      const response = await fetch(
        `https://www.douyin.com/aweme/v1/web/tab/feed/?publish_video_strategy_type=2&aid=6383&channel=channel_pc_web&cookie_enabled=true&count=${pageSize}&max_cursor=${maxCursor}&screen_width=1280&screen_height=800&browser_online=true&cpu_core_num=8&device_memory=8&downlink=10&effective_type=4g&round_trip_time=200`,
        {
          headers: {
            accept: "application/json,text/plain,*/*",
            cookie,
            referer: "https://www.douyin.com/",
            "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
          },
        },
      );

      if (!response.ok) {
        throw new Error(`Douyin feed responded with ${response.status}`);
      }

      const payload = await response.json() as {
        aweme_list?: Array<Record<string, any>>;
        has_more?: number;
        max_cursor?: number | string;
      };

      const pageItems = (payload.aweme_list ?? [])
        .map((item) => {
          const title = String(item.desc ?? item.caption ?? "").trim();
          if (!title) return null;
          const stats = item.statistics ?? {};
          const author = item.author ?? {};
          const tags = Array.isArray(item.text_extra)
            ? item.text_extra
              .map((entry) => String(entry?.hashtag_name ?? "").trim())
              .filter(Boolean)
            : [];
          return {
            id: String(item.aweme_id ?? item.group_id ?? ""),
            title,
            bucket: "douyin_feed",
            author: String(author.nickname ?? author.uid ?? "").trim() || undefined,
            url: item.aweme_id ? `https://www.douyin.com/video/${item.aweme_id}` : undefined,
            publishedAt: safeDateFromUnix(Number(item.create_time)),
            likes: Number(stats.digg_count ?? 0) || undefined,
            comments: Number(stats.comment_count ?? 0) || undefined,
            shares: Number(stats.share_count ?? 0) || undefined,
            views: Number(stats.play_count ?? 0) || undefined,
            hotValue: Number(stats.digg_count ?? 0) + Number(stats.comment_count ?? 0),
            contentType: "video" as const,
            tags,
          } satisfies TrendItem;
        })
        .filter(Boolean) as TrendItem[];

      items.push(...pageItems);
      requestCount += 1;
      hasMore = Number(payload.has_more ?? 0);
      maxCursor = String(payload.max_cursor ?? maxCursor);
      notes.push(`Fetched ${pageItems.length} Douyin authenticated feed videos on page ${page + 1}.`);
      if (!hasMore || !pageItems.length) break;
    }

    if (items.length) {
      notes.push(`Douyin has_more: ${hasMore}`);
      return finalizeCollection("douyin", "live", items, notes, {
        collectorMode: "authenticated_feed",
        requestCount,
        pageDepth: requestCount,
    targetPerRun: Math.max(pageLimit * pageSize, getPlatformTargetItemCount("douyin")),
        referenceMinItems: PLATFORM_REFERENCE_RANGES.douyin?.min || 12,
        referenceMaxItems: PLATFORM_REFERENCE_RANGES.douyin?.max || 30,
      });
    }
  }

  const response = await fetch("https://www.iesdouyin.com/web/api/v2/hotsearch/billboard/word/", {
    headers: { "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0" },
  });
  if (!response.ok) {
    throw new Error(`Douyin API responded with ${response.status}`);
  }
  const payload = await response.json() as {
    active_time?: string;
    word_list?: Array<Record<string, any>>;
  };
  const items = (payload.word_list ?? []).map((item, index) => ({
    id: String(item.sentence_id ?? item.word ?? index),
    title: String(item.word ?? "").trim(),
    bucket: "douyin_topics",
    hotValue: Number(item.hot_value ?? 0) || undefined,
    url: item.word ? `https://www.douyin.com/hot/${encodeURIComponent(String(item.word))}` : undefined,
    publishedAt: payload.active_time ? new Date(String(payload.active_time).replace(" ", "T") + "+08:00").toISOString() : undefined,
    contentType: "topic" as const,
    tags: [String(item.word_type ?? "").trim()].filter(Boolean),
  }));

  return finalizeCollection("douyin", "live", items, [`Fetched ${items.length} Douyin hot search topics.`], {
    collectorMode: "hot_topics",
    requestCount: 1,
    pageDepth: 1,
    targetPerRun: Math.max(20, getPlatformTargetItemCount("douyin")),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.douyin?.min || 12,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.douyin?.max || 30,
  });
}

async function collectXiaohongshu(): Promise<PlatformTrendCollection> {
  const cookie = String(process.env.XHS_COOKIE || "").trim();
  const paths = parseCsvEnv("XHS_EXPLORE_PATHS");
  const explorePaths = paths.length
    ? paths
    : [
      "https://www.xiaohongshu.com/explore",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend",
      "https://www.xiaohongshu.com/explore?channel_id=homefeed.fashion_v3",
    ];
  const pageLimit = Math.max(1, Math.min(20, Number(process.env.XHS_TREND_PAGES || explorePaths.length) || explorePaths.length));
  const items: TrendItem[] = [];
  const notes: string[] = [];

  for (const pageUrl of explorePaths.slice(0, pageLimit)) {
    const response = await fetch(pageUrl, {
      headers: {
        "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
        ...(cookie ? { cookie } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`Xiaohongshu page responded with ${response.status}`);
    }
    const html = await response.text();
    const match = html.match(/window\.__INITIAL_STATE__=(\{[\s\S]*?\})<\/script>/);
    if (!match) {
      throw new Error("Xiaohongshu initial state not found");
    }

    const state = vm.runInNewContext(`(${match[1]})`, {}) as {
      feed?: { feeds?: Array<Record<string, any>> };
    };
    const feeds = state.feed?.feeds ?? [];
    const pageItems = feeds
      .map((feed, index) => {
        const noteCard = feed.noteCard;
        if (!noteCard) return null;
        const title = String(noteCard.displayTitle ?? "").trim();
        if (!title) return null;
        return {
          id: String(feed.id ?? `${pageUrl}-${index}`),
          title,
          bucket: "xiaohongshu_feed",
          author: String(noteCard.user?.nickname ?? noteCard.user?.nickName ?? "").trim() || undefined,
          url: feed.id ? `https://www.xiaohongshu.com/explore/${feed.id}` : undefined,
          likes: parseChineseCount(noteCard.interactInfo?.likedCount),
          comments: parseChineseCount(noteCard.interactInfo?.commentCount),
          shares: parseChineseCount(noteCard.interactInfo?.shareCount),
          contentType: noteCard.video ? "video" : "note",
        } satisfies TrendItem;
      })
      .filter(Boolean) as TrendItem[];
    items.push(...pageItems);
    notes.push(`Fetched ${pageItems.length} Xiaohongshu items from ${pageUrl}.`);
  }

  return finalizeCollection("xiaohongshu", "live", items, notes, {
    collectorMode: cookie ? "authenticated_feed" : "public_feed",
    requestCount: Math.min(pageLimit, explorePaths.length),
    pageDepth: Math.min(pageLimit, explorePaths.length),
    targetPerRun: Math.max(items.length, 20 * Math.min(pageLimit, explorePaths.length), getPlatformTargetItemCount("xiaohongshu")),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.xiaohongshu?.min || 20,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.xiaohongshu?.max || 60,
  });
}

async function collectKuaishou(): Promise<PlatformTrendCollection> {
  const cookie = String(process.env.KUAISHOU_COOKIE || "").trim();
  const principals = parseCsvEnv("KUAISHOU_TREND_PRINCIPALS").slice(0, 5);
  const endpoint = String(process.env.KUAISHOU_GRAPHQL_URL || "https://live.kuaishou.com/m_graphql").trim();
  const count = Math.max(6, Math.min(24, Number(process.env.KUAISHOU_TREND_COUNT || 24) || 24));
  const publicPages = Math.max(1, Math.min(100, Number(process.env.KUAISHOU_TREND_PAGES || 30) || 30));
  const items: TrendItem[] = [];
  const notes: string[] = [];

  const pushKuaishouItem = (item: Record<string, any>, sourceLabel: string) => {
    const photo = item.photo ?? item;
    const author = item.author ?? item.user ?? {};
    const caption = String(photo.caption ?? item.caption ?? "").trim();
    const tags = Array.isArray(item.tags)
      ? item.tags
        .map((tag) => String(tag?.name ?? tag ?? "").trim())
        .filter(Boolean)
      : [String(photo.expTag ?? item.expTag ?? "").trim()].filter(Boolean);
    const title = caption || tags[0];
    if (!title) return;

    const id = String(photo.id ?? item.id ?? `${sourceLabel}-${items.length}`);
    const authorId = String(author.id ?? item.author_id ?? "").trim();
    const authorName = String(author.name ?? item.author_name ?? authorId).trim();
    const likes = parseChineseCount(photo.likeCount ?? item.likeCount);
    const comments = parseChineseCount(photo.commentCount ?? item.commentCount ?? item.comment?.us_c);
    const views = parseChineseCount(photo.viewCount ?? item.viewCount);
    items.push({
      id,
      title,
      bucket: "kuaishou_feed",
      author: authorName || authorId || undefined,
      url: id ? `https://www.kuaishou.com/short-video/${id}` : undefined,
      publishedAt: safeDateFromTimestamp(Number(photo.timestamp ?? item.timestamp)),
      likes,
      comments,
      views,
      hotValue: (likes || 0) + (comments || 0),
      contentType: "video",
      tags,
    });
  };

  if (cookie) {
    const response = await fetch("https://www.kuaishou.com/rest/v/profile/private/list", {
      headers: {
        accept: "application/json,text/plain,*/*",
        cookie,
        referer: "https://www.kuaishou.com/new-reco",
        "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
      },
    });
    if (!response.ok) {
      throw new Error(`Kuaishou private list responded with ${response.status}`);
    }
    const payload = await response.json() as {
      feeds?: Array<Record<string, any>>;
      pcursor?: string;
    };
    const list = payload.feeds ?? [];
    list.forEach((item) => pushKuaishouItem(item, "private-list"));
    notes.push(`Fetched ${list.length} Kuaishou authenticated feed items from private/list.`);
    if (payload.pcursor) {
      notes.push(`Kuaishou next cursor: ${payload.pcursor}`);
    }
  }

  if (principals.length) {
    const query = `
      query publicFeeds($principalId: String!, $pcursor: String, $count: Int) {
        publicFeeds(principalId: $principalId, pcursor: $pcursor, count: $count) {
          pcursor
          list {
            id
            caption
            poster
            timestamp
            expTag
            user {
              id
              name
            }
            counts {
              displayView
              displayLike
              displayComment
            }
          }
        }
      }
    `;

    for (const principalId of principals) {
      let pcursor = "";
      for (let page = 0; page < publicPages; page += 1) {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0",
            ...(cookie ? { cookie } : {}),
          },
          body: JSON.stringify({
            operationName: "publicFeeds",
            query,
            variables: {
              principalId,
              pcursor,
              count,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`Kuaishou GraphQL responded with ${response.status}`);
        }

        const payload = await response.json() as {
          data?: {
            publicFeeds?: {
              list?: Array<Record<string, any>>;
              pcursor?: string;
            };
          };
          errors?: Array<{ message?: string }>;
        };

        if (payload.errors?.length) {
          throw new Error(payload.errors.map((item) => item.message || "unknown error").join("; "));
        }

        const list = payload.data?.publicFeeds?.list ?? [];
        list.forEach((item) => pushKuaishouItem(item, principalId));
        notes.push(`Fetched ${list.length} Kuaishou public feed items from ${principalId} page ${page + 1}.`);
        pcursor = String(payload.data?.publicFeeds?.pcursor || "").trim();
        if (!pcursor || !list.length) break;
      }
    }
  }

  const publicRequestCount = principals.length * publicPages;
  const publicTargetCount = principals.length * publicPages * count;

  if (!items.length) {
    throw new Error("Kuaishou collector returned 0 items. 请配置 KUAISHOU_COOKIE 或 KUAISHOU_TREND_PRINCIPALS。");
  }

  return finalizeCollection("kuaishou", "live", items, notes, {
    collectorMode: cookie && principals.length ? "hybrid" : cookie ? "authenticated_feed" : "public_feed",
    requestCount: (cookie ? 1 : 0) + publicRequestCount,
    pageDepth: Math.max(cookie ? 1 : 0, publicPages),
    targetPerRun: Math.max(publicTargetCount + (cookie ? count : 0), getPlatformTargetItemCount("kuaishou")),
    referenceMinItems: PLATFORM_REFERENCE_RANGES.kuaishou?.min || 12,
    referenceMaxItems: PLATFORM_REFERENCE_RANGES.kuaishou?.max || 36,
  });
}

export async function collectPlatformTrends(platform: GrowthPlatform): Promise<PlatformTrendCollection> {
  switch (platform) {
    case "bilibili":
      return collectBilibili();
    case "douyin":
      return collectDouyin();
    case "kuaishou":
      return collectKuaishou();
    case "xiaohongshu":
      return collectXiaohongshu();
    default:
      return finalizeCollection(platform, "seed", [], [`No live collector configured for ${platform}.`], {
        collectorMode: "seed",
        requestCount: 0,
        pageDepth: 0,
        targetPerRun: 0,
        referenceMinItems: 0,
        referenceMaxItems: 0,
      });
  }
}

export async function collectTrendPlatforms(platforms: GrowthPlatform[]) {
  const normalized = Array.from(
    new Set(platforms.filter((platform): platform is GrowthPlatform => growthPlatformValues.includes(platform))),
  );
  const results = await Promise.allSettled(normalized.map((platform) => collectPlatformTrends(platform)));
  const collections: Partial<Record<GrowthPlatform, PlatformTrendCollection>> = {};
  const errors: Partial<Record<GrowthPlatform, string>> = {};

  results.forEach((result, index) => {
    const platform = normalized[index];
    if (result.status === "fulfilled") {
      collections[platform] = result.value;
    } else {
      errors[platform] = result.reason instanceof Error ? result.reason.message : String(result.reason);
    }
  });

  return { collections, errors };
}
