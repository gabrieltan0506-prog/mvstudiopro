import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("collectPlatformTrends douyin", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...envBackup };
    process.env.DOUYIN_COOKIE = "sessionid=primary";
    process.env.DOUYIN_CREATOR_CENTER_COOKIE = "sessionid=creator";
    process.env.DOUYIN_CREATOR_INDEX_COOKIE = "sessionid=index";
    process.env.DOUYIN_CREATOR_INDEX_CSRF_TOKEN = "csrf-token";
    process.env.DOUYIN_CREATOR_INDEX_KEYWORDS = "卖健身器材";
    process.env.DOUYIN_CREATOR_INDEX_TOPIC_IDS = "1569262495473665";
    process.env.DOUYIN_CREATOR_INDEX_BRANDS = "耐克:16";
    process.env.DOUYIN_TREND_PAGES = "1";
    process.env.DOUYIN_TREND_PAGE_SIZE = "8";
    process.env.DOUYIN_CREATOR_CENTER_BILLBOARD_TYPES = "1,3";
    process.env.GROWTH_TARGET_WINDOW_DAYS = "30";
    process.env.GROWTH_WINDOW_FALLBACK_DAYS = "60,90";
  });

  afterEach(() => {
    process.env = envBackup;
    vi.unstubAllGlobals();
  });

  it("merges creator center items into douyin collector output", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);

      if (url.includes("hotsearch/billboard")) {
        return {
          ok: true,
          json: async () => ({ word_list: [] }),
        } as Response;
      }

      if (url.includes("/aweme/v1/web/tab/feed/")) {
        return {
          ok: true,
          json: async () => ({
            aweme_list: [
              {
                aweme_id: "feed-1",
                desc: "feed item",
                create_time: Math.floor(Date.now() / 1000),
                author: { nickname: "feed-user" },
                statistics: { digg_count: 10, comment_count: 2, share_count: 1, play_count: 100 },
              },
            ],
            has_more: 0,
            max_cursor: 0,
          }),
        } as Response;
      }

      if (url.includes("/web/api/creator/material/center/billboard/")) {
        return {
          ok: true,
          json: async () => ({
            status_code: 0,
            item_list: [
              {
                item_id: "creator-1",
                title: "creator item",
                author_name: "creator-user",
                play_count: 88,
                like_count: 8,
                comment_count: 1,
                hot_score: 99,
                aweme_list: [
                  {
                    aweme_id: "creator-1",
                    desc: "creator item",
                    create_time: Math.floor(Date.now() / 1000),
                    author: { nickname: "creator-user" },
                    statistics: { digg_count: 8, comment_count: 1, share_count: 0, play_count: 88 },
                  },
                ],
              },
            ],
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/itemBase")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              itemId: "feed-1",
              title: "indexed feed item",
              url: "https://www.douyin.com/video/feed-1",
              nickname: "indexed-user",
              categoryName: "健身",
              authorIdString: "author-1",
              likes: "88",
              createTime: "2026-03-17 10:00:00",
            },
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/itemIndex")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              trend: [{ datetime: "20260317", value: "188" }],
              avg: "188",
            },
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/daren/get_author_info")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              user_id: "author-1",
              user_name: "author-one",
              user_aweme_url: "https://www.douyin.com/user/author-1",
              fans_count: "999",
              like_count: "555",
              first_tag_name: "运动",
              second_tag_name: "健身",
            },
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/get_keyword_valid_date")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-valid-date",
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/get_multi_keyword_hot_trend")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-keyword-trend",
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/get_multi_keyword_interpretation")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-keyword-interpretation",
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/get_hot_trend_word")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-hot-word-pool",
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/get_multi_topic_list")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-topic-list",
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/get_multi_brand_index")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-brand-index",
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/getBrandLines")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-brand-lines",
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/getBrandRadarChart")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-brand-radar",
            status: 0,
          }),
        } as Response;
      }

      if (url.includes("/api/v2/index/getBrandCycles")) {
        return {
          ok: true,
          json: async () => ({
            data: "encrypted-brand-cycles",
            status: 0,
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const mod = await import("./trendCollector");
    const result = await mod.collectPlatformTrends("douyin");

    expect(result.items.some((item) => item.bucket === "douyin_creator_center_hot_video")).toBe(true);
    expect(result.items.some((item) => item.id === "creator-1")).toBe(true);
    expect(result.items.some((item) => item.bucket === "douyin_creator_index_video")).toBe(true);
    expect(result.items.some((item) => item.bucket === "douyin_creator_index_author")).toBe(true);
    expect(result.notes.some((note) => note.includes("Douyin creator center"))).toBe(true);
    expect(result.notes.some((note) => note.includes("creator index"))).toBe(true);
    expect(result.notes.some((note) => note.includes("keyword trend 卖健身器材 returned encrypted payload"))).toBe(true);
    expect(result.notes.some((note) => note.includes("topics (1) returned encrypted payload"))).toBe(true);
    expect(result.notes.some((note) => note.includes("brand radar returned encrypted payload"))).toBe(true);
  });
});
