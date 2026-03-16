import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("collectPlatformTrends toutiao", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...envBackup };
    process.env.TOUTIAO_COOKIE = "csrftoken=csrf-token; tt_anti_token=anti-token; sessionid=tt-session";
    process.env.TOUTIAO_USER_TOKEN = "user-token";
    process.env.TOUTIAO_MEDIA_ID = "media-id";
  });

  afterEach(() => {
    process.env = envBackup;
    vi.unstubAllGlobals();
  });

  it("collects toutiao profile feed, ugc, video, and media hot items", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("acrawler.js")) {
        return {
          ok: true,
          text: async () => `
            window.byted_acrawler = {
              init() {},
              sign(payload) { return "sig-" + String(payload.url || "").length; }
            };
          `,
        } as Response;
      }

      if (url.includes("/api/pc/user/tabs_info")) {
        expect(init?.method).toBe("POST");
        return {
          ok: true,
          json: async () => ({
            message: "success",
            data: [
              { category: "profile_all" },
              { category: "pc_profile_video" },
              { category: "pc_profile_ugc" },
              { category: "pc_profile_short_video" },
            ],
          }),
        } as Response;
      }

      if (url.includes("/api/pc/feed/") && url.includes("category=profile_all")) {
        return {
          ok: true,
          json: async () => ({
            message: "success",
            data: [
              {
                stream_cell: {
                  id: "feed-1",
                  raw_data: JSON.stringify({
                    itemCell: {
                      title: "toutiao feed item",
                      publish_time: Math.floor(Date.now() / 1000),
                      digg_count: 12,
                      comment_count: 4,
                      read_count: 88,
                      share_url: "https://www.toutiao.com/w/feed-1/",
                      user: { screen_name: "feed-user" },
                    },
                  }),
                },
              },
            ],
          }),
        } as Response;
      }

      if (url.includes("/api/pc/feed/") && url.includes("category=pc_profile_ugc")) {
        return {
          ok: true,
          json: async () => ({
            message: "success",
            data: [
              {
                stream_cell: {
                  id: "ugc-1",
                  raw_data: JSON.stringify({
                    itemCell: {
                      content: "toutiao ugc item",
                      publish_time: Math.floor(Date.now() / 1000),
                      digg_count: 8,
                      comment_count: 1,
                      read_count: 20,
                      share_url: "https://www.toutiao.com/w/ugc-1/",
                      user: { screen_name: "ugc-user" },
                    },
                  }),
                },
              },
            ],
          }),
        } as Response;
      }

      if (url.includes("/api/pc/feed/") && url.includes("category=pc_profile_video")) {
        return {
          ok: true,
          json: async () => ({
            message: "success",
            data: [
              {
                group_id: "video-1",
                title: "toutiao video item",
                source: "video-user",
                display_url: "https://www.toutiao.com/video/video-1/",
                comments_count: "3",
                go_detail_count: "66",
                article_genre: "video",
              },
            ],
          }),
        } as Response;
      }

      if (url.includes("/api/pc/media_hot/")) {
        return {
          ok: true,
          json: async () => ({
            message: "success",
            data: [
              {
                group_id: "hot-1",
                title: "toutiao media hot item",
                source: "hot-user",
                display_url: "https://www.toutiao.com/article/hot-1/",
                read_count: 100,
                digg_count: 10,
                comment_count: 2,
                article_genre: "article",
              },
            ],
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const mod = await import("./trendCollector");
    const result = await mod.collectPlatformTrends("toutiao");

    expect(result.items.some((item) => item.id === "feed-1")).toBe(true);
    expect(result.items.some((item) => item.id === "ugc-1")).toBe(true);
    expect(result.items.some((item) => item.id === "video-1")).toBe(true);
    expect(result.items.some((item) => item.id === "hot-1")).toBe(true);
    expect(result.stats.bucketCounts.toutiao_feed).toBeGreaterThanOrEqual(1);
    expect(result.notes.some((note) => note.includes("Fetched 3 Toutiao profile tabs"))).toBe(true);
  });
});
