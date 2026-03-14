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
  const cookie = String(process.env.DOUYIN_COOKIE || "").trim();
  if (cookie) {
    const response = await fetch(
      "https://www.douyin.com/aweme/v1/web/tab/feed/?publish_video_strategy_type=2&aid=6383&channel=channel_pc_web&cookie_enabled=true&screen_width=1280&screen_height=800&browser_online=true&cpu_core_num=8&device_memory=8&downlink=10&effective_type=4g&round_trip_time=200",
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
    };

    const items = (payload.aweme_list ?? [])
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

    if (items.length) {
      return {
        platform: "douyin",
        source: "live",
        collectedAt: new Date().toISOString(),
        windowDays: 30,
        items,
        notes: [
          `Fetched ${items.length} Douyin authenticated feed videos.`,
          `Douyin has_more: ${payload.has_more ?? 0}`,
        ],
      };
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
  const cookie = String(process.env.XHS_COOKIE || "").trim();
  const response = await fetch("https://www.xiaohongshu.com/explore", {
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
    notes: [
      `Fetched ${items.length} Xiaohongshu explore notes${cookie ? " with authenticated cookie" : ""}.`,
    ],
  };
}

async function collectKuaishou(): Promise<PlatformTrendCollection> {
  const cookie = String(process.env.KUAISHOU_COOKIE || "").trim();
  const principals = parseCsvEnv("KUAISHOU_TREND_PRINCIPALS").slice(0, 5);
  const endpoint = String(process.env.KUAISHOU_GRAPHQL_URL || "https://live.kuaishou.com/m_graphql").trim();
  const count = Math.max(6, Math.min(24, Number(process.env.KUAISHOU_TREND_COUNT || 12) || 12));
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
            pcursor: "",
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
          };
        };
        errors?: Array<{ message?: string }>;
      };

      if (payload.errors?.length) {
        throw new Error(payload.errors.map((item) => item.message || "unknown error").join("; "));
      }

      const list = payload.data?.publicFeeds?.list ?? [];
      list.forEach((item) => pushKuaishouItem(item, principalId));
      notes.push(`Fetched ${list.length} Kuaishou public feed items from ${principalId}.`);
    }
  }

  if (!items.length) {
    throw new Error("Kuaishou collector returned 0 items. 请配置 KUAISHOU_COOKIE 或 KUAISHOU_TREND_PRINCIPALS。");
  }

  return {
    platform: "kuaishou",
    source: "live",
    collectedAt: new Date().toISOString(),
    windowDays: 30,
    items,
    notes,
  };
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
