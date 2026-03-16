import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("collectPlatformTrends douyin", () => {
  const envBackup = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...envBackup };
    process.env.DOUYIN_COOKIE = "sessionid=primary";
    process.env.DOUYIN_CREATOR_CENTER_COOKIE = "sessionid=creator";
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

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const mod = await import("./trendCollector");
    const result = await mod.collectPlatformTrends("douyin");

    expect(result.items.some((item) => item.bucket === "douyin_creator_center_hot_video")).toBe(true);
    expect(result.items.some((item) => item.id === "creator-1")).toBe(true);
    expect(result.notes.some((note) => note.includes("Douyin creator center"))).toBe(true);
  });
});
