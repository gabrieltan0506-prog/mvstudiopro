import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type FetchCall = {
  url: string;
  init?: RequestInit;
};

describe("collectPlatformTrends kuaishou", () => {
  const envBackup = { ...process.env };
  const fetchCalls: FetchCall[] = [];

  beforeEach(() => {
    vi.resetModules();
    fetchCalls.length = 0;
    process.env = { ...envBackup };
    process.env.KUAISHOU_COOKIE = "userId=4602228431; token=primary";
    process.env.KUAISHOU_COOKIE_BACKUP = "userId=4602228431; token=backup";
    process.env.KUAISHOU_TREND_KEYWORD_LIMIT = "3";
    process.env.KUAISHOU_SEARCH_PAGES = "2";
    process.env.KUAISHOU_PRIVATE_PAGES = "1";
    process.env.KUAISHOU_TREND_PAGES = "1";
    process.env.KUAISHOU_TREND_PRINCIPALS = "";
    process.env.GROWTH_TARGET_WINDOW_DAYS = "30";
    process.env.GROWTH_WINDOW_FALLBACK_DAYS = "60,90";
    process.env.KUAISHOU_TREND_MIN_ITEMS = "10";

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });

      if (url.includes("/rest/v/profile/private/list")) {
        return {
          ok: true,
          json: async () => ({
            feeds: [
              {
                id: `private-${fetchCalls.length}`,
                caption: "private item",
                timestamp: Date.now(),
                likeCount: "10",
                commentCount: "2",
              },
            ],
            pcursor: "",
          }),
        } as Response;
      }

      if (url.includes("/rest/v/search/feed")) {
        const body = JSON.parse(String(init?.body || "{}")) as { keyword?: string; page?: number };
        return {
          ok: true,
          json: async () => ({
            data: {
              list: [
                {
                  id: `${body.keyword}-${body.page}`,
                  caption: `${body.keyword} item ${body.page}`,
                  timestamp: Date.now(),
                  likeCount: "5",
                  commentCount: "1",
                },
              ],
              pcursor: "",
            },
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));
  });

  afterEach(() => {
    process.env = envBackup;
    vi.unstubAllGlobals();
  });

  it("uses all selected keywords and dedupes kuaishou cookies by userId", async () => {
    const mod = await import("./trendCollector");
    const result = await mod.collectPlatformTrends("kuaishou");

    const searchCalls = fetchCalls.filter((call) => call.url.includes("/rest/v/search/feed"));
    const privateCalls = fetchCalls.filter((call) => call.url.includes("/rest/v/profile/private/list"));

    expect(searchCalls).toHaveLength(8);
    expect(privateCalls).toHaveLength(1);
    expect(result.items.length).toBeGreaterThanOrEqual(9);
    expect(result.stats.requestCount).toBe(9);

    const requestCookies = new Set(
      [...searchCalls, ...privateCalls]
        .map((call) => String(call.init?.headers && "cookie" in (call.init.headers as Record<string, string>)
          ? (call.init.headers as Record<string, string>).cookie
          : ""))
        .filter(Boolean),
    );
    expect(requestCookies.size).toBe(1);
  });

  it("skips search when private feed already yields enough items", async () => {
    vi.resetModules();
    fetchCalls.length = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });

      if (url.includes("/rest/v/profile/private/list")) {
        return {
          ok: true,
          json: async () => ({
            feeds: Array.from({ length: 12 }, (_, index) => ({
              id: `private-sufficient-${index}`,
              caption: `private item ${index}`,
              timestamp: Date.now(),
              likeCount: "10",
              commentCount: "2",
            })),
            pcursor: "",
          }),
        } as Response;
      }

      if (url.includes("/rest/v/search/feed")) {
        throw new Error("search/feed should not run when private feed is sufficient");
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const mod = await import("./trendCollector");
    const result = await mod.collectPlatformTrends("kuaishou");

    const searchCalls = fetchCalls.filter((call) => call.url.includes("/rest/v/search/feed"));
    const privateCalls = fetchCalls.filter((call) => call.url.includes("/rest/v/profile/private/list"));

    expect(privateCalls).toHaveLength(1);
    expect(searchCalls).toHaveLength(0);
    expect(result.items.length).toBeGreaterThanOrEqual(12);
    expect(result.notes.some((note) => note.includes("Skipped Kuaishou search/feed"))).toBe(true);
  });

  it("keeps older kuaishou items when 365-day fallback is needed", async () => {
    vi.resetModules();
    fetchCalls.length = 0;
    const now = Date.now();
    const oldTimestamp = Math.floor((now - 220 * 24 * 60 * 60 * 1000) / 1000);

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });

      if (url.includes("/rest/v/profile/private/list")) {
        return {
          ok: true,
          json: async () => ({
            feeds: Array.from({ length: 12 }, (_, index) => ({
              id: `private-old-${index}`,
              caption: `private old item ${index}`,
              timestamp: oldTimestamp,
              likeCount: "10",
              commentCount: "2",
            })),
            pcursor: "",
          }),
        } as Response;
      }

      if (url.includes("/rest/v/search/feed")) {
        throw new Error("search/feed should not run when private feed is sufficient");
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const mod = await import("./trendCollector");
    const result = await mod.collectPlatformTrends("kuaishou");

    expect(result.items).toHaveLength(12);
    expect(result.windowDays).toBe(365);
    expect(result.notes.some((note) => note.includes("365d=12"))).toBe(true);
  });

  it("captures searchable creators through search/user discovery", async () => {
    vi.resetModules();
    fetchCalls.length = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });

      if (url.includes("/rest/v/profile/private/list")) {
        return {
          ok: true,
          json: async () => ({
            feeds: Array.from({ length: 12 }, (_, index) => ({
              id: `private-discovery-${index}`,
              caption: `private item ${index}`,
              timestamp: Date.now(),
              likeCount: "10",
              commentCount: "2",
            })),
            pcursor: "",
          }),
        } as Response;
      }

      if (url.includes("/rest/v/search/user")) {
        return {
          ok: true,
          json: async () => ({
            users: [
              { user_id: "3xuser1", user_name: "creator one" },
              { user_id: "3xuser2", user_name: "creator two" },
            ],
            pcursor: "",
          }),
        } as Response;
      }

      if (url.includes("/rest/v/search/feed")) {
        throw new Error("search/feed should not run when private feed is sufficient");
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const mod = await import("./trendCollector");
    const result = await mod.collectPlatformTrends("kuaishou");

    expect(fetchCalls.some((call) => call.url.includes("/rest/v/search/user"))).toBe(true);
    expect(result.notes.some((note) => note.includes("Kuaishou discovery found") && note.includes("creator one"))).toBe(true);
  });

  it("uses profile/user -> profile/feed fallback for discovered creators", async () => {
    vi.resetModules();
    fetchCalls.length = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      fetchCalls.push({ url, init });

      if (url.includes("/rest/v/profile/private/list")) {
        return {
          ok: true,
          json: async () => ({
            feeds: [],
            pcursor: "",
          }),
        } as Response;
      }

      if (url.includes("/rest/v/search/feed")) {
        return {
          ok: true,
          json: async () => ({
            data: {
              list: [],
              pcursor: "",
            },
          }),
        } as Response;
      }

      if (url.includes("/rest/v/search/user")) {
        return {
          ok: true,
          json: async () => ({
            users: [{ user_id: "3xuser1", user_name: "creator one" }],
            pcursor: "",
          }),
        } as Response;
      }

      if (url.includes("/rest/v/profile/user")) {
        return {
          ok: true,
          json: async () => ({
            result: 1,
            userProfile: {
              profile: { user_id: "3xuser1", user_name: "creator one" },
              ownerCount: { photo_public: 32 },
              userDefineId: "creator-one-id",
            },
          }),
        } as Response;
      }

      if (url.includes("/rest/v/profile/feed")) {
        return {
          ok: true,
          json: async () => ({
            result: 1,
            feeds: [
              {
                id: "profile-feed-1",
                caption: "creator fallback item",
                timestamp: Date.now(),
                likeCount: "9",
                commentCount: "3",
                author: { id: "3xuser1", name: "creator one" },
              },
            ],
            pcursor: "",
          }),
        } as Response;
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }));

    const mod = await import("./trendCollector");
    const result = await mod.collectPlatformTrends("kuaishou");

    expect(fetchCalls.some((call) => call.url.includes("/rest/v/profile/user"))).toBe(true);
    expect(fetchCalls.some((call) => call.url.includes("/rest/v/profile/feed"))).toBe(true);
    expect(result.items.some((item) => item.id === "profile-feed-1")).toBe(true);
    expect(result.notes.some((note) => note.includes("Kuaishou profile/user 3xuser1 => creator one public=32"))).toBe(true);
  });
});
