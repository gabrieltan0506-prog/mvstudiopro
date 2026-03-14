import vm from "node:vm";
import {
  growthPlatformValues,
  type GrowthPlatform,
} from "@shared/growth";

export type TrendSource = "live" | "seed";

export type TrendItem = {
  id: string;
  title: string;
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
};

export type PlatformTrendCollection = {
  platform: GrowthPlatform;
  source: TrendSource;
  collectedAt: string;
  windowDays: number;
  items: TrendItem[];
  notes: string[];
};

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

async function collectBilibili(): Promise<PlatformTrendCollection> {
  const items: TrendItem[] = [];
  const notes: string[] = [];

  for (const page of [1, 2, 3]) {
    const response = await fetch(`https://api.bilibili.com/x/web-interface/popular?pn=${page}&ps=20`, {
      headers: { "user-agent": "mvstudiopro-growth-collector/1.0" },
    });
    if (!response.ok) {
      throw new Error(`Bilibili API responded with ${response.status}`);
    }
    const payload = await response.json() as {
      data?: { list?: Array<Record<string, any>> };
    };
    const list = payload.data?.list ?? [];
    for (const item of list) {
      items.push({
        id: String(item.aid ?? item.bvid ?? `${page}-${items.length}`),
        title: String(item.title ?? "").trim(),
        author: String(item.owner?.name ?? "").trim() || undefined,
        url: item.bvid ? `https://www.bilibili.com/video/${item.bvid}` : undefined,
        publishedAt: safeDateFromUnix(Number(item.pubdate)),
        likes: Number(item.stat?.like ?? 0) || undefined,
        comments: Number(item.stat?.reply ?? 0) || undefined,
        shares: Number(item.stat?.share ?? 0) || undefined,
        views: Number(item.stat?.view ?? 0) || undefined,
        hotValue: Number(item.stat?.like ?? 0) + Number(item.stat?.share ?? 0),
        contentType: "video",
        tags: [String(item.tname ?? "").trim()].filter(Boolean),
      });
    }
  }

  notes.push(`Fetched ${items.length} popular Bilibili videos.`);
  return {
    platform: "bilibili",
    source: "live",
    collectedAt: new Date().toISOString(),
    windowDays: 30,
    items,
    notes,
  };
}

async function collectDouyin(): Promise<PlatformTrendCollection> {
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
    hotValue: Number(item.hot_value ?? 0) || undefined,
    url: item.word ? `https://www.douyin.com/hot/${encodeURIComponent(String(item.word))}` : undefined,
    publishedAt: payload.active_time ? new Date(String(payload.active_time).replace(" ", "T") + "+08:00").toISOString() : undefined,
    contentType: "topic" as const,
    tags: [String(item.word_type ?? "").trim()].filter(Boolean),
  }));

  return {
    platform: "douyin",
    source: "live",
    collectedAt: new Date().toISOString(),
    windowDays: 30,
    items,
    notes: [`Fetched ${items.length} Douyin hot search topics.`],
  };
}

async function collectXiaohongshu(): Promise<PlatformTrendCollection> {
  const response = await fetch("https://www.xiaohongshu.com/explore", {
    headers: { "user-agent": "Mozilla/5.0 mvstudiopro-growth-collector/1.0" },
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
  const items: TrendItem[] = feeds
    .map((feed, index) => {
      const noteCard = feed.noteCard;
      if (!noteCard) return null;
      const title = String(noteCard.displayTitle ?? "").trim();
      if (!title) return null;
      return {
        id: String(feed.id ?? index),
        title,
        author: String(noteCard.user?.nickname ?? noteCard.user?.nickName ?? "").trim() || undefined,
        url: feed.id ? `https://www.xiaohongshu.com/explore/${feed.id}` : undefined,
        likes: parseChineseCount(noteCard.interactInfo?.likedCount),
        comments: parseChineseCount(noteCard.interactInfo?.commentCount),
        shares: parseChineseCount(noteCard.interactInfo?.shareCount),
        contentType: noteCard.video ? "video" : "note",
      } satisfies TrendItem;
    })
    .filter(Boolean) as TrendItem[];

  return {
    platform: "xiaohongshu",
    source: "live",
    collectedAt: new Date().toISOString(),
    windowDays: 30,
    items,
    notes: [`Fetched ${items.length} Xiaohongshu explore notes.`],
  };
}

export async function collectPlatformTrends(platform: GrowthPlatform): Promise<PlatformTrendCollection> {
  switch (platform) {
    case "bilibili":
      return collectBilibili();
    case "douyin":
      return collectDouyin();
    case "xiaohongshu":
      return collectXiaohongshu();
    default:
      return {
        platform,
        source: "seed",
        collectedAt: new Date().toISOString(),
        windowDays: 30,
        items: [],
        notes: [`No live collector configured for ${platform}.`],
      };
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
