import { afterEach, describe, expect, it, vi } from "vitest";
import { listDouyinAwemePlaybackUrlsViaWebApi } from "./manhuaLearnDouyinWebApi";

const OLD_COOKIE = process.env.DOUYIN_COOKIE;
const OLD_BACKUP = process.env.DOUYIN_COOKIE_BACKUP;
const OLD_POOL = process.env.DOUYIN_COOKIE_POOL;

afterEach(() => {
  vi.unstubAllGlobals();
  if (OLD_COOKIE == null) delete process.env.DOUYIN_COOKIE;
  else process.env.DOUYIN_COOKIE = OLD_COOKIE;
  if (OLD_BACKUP == null) delete process.env.DOUYIN_COOKIE_BACKUP;
  else process.env.DOUYIN_COOKIE_BACKUP = OLD_BACKUP;
  if (OLD_POOL == null) delete process.env.DOUYIN_COOKIE_POOL;
  else process.env.DOUYIN_COOKIE_POOL = OLD_POOL;
});

describe("listDouyinAwemePlaybackUrlsViaWebApi", () => {
  it("旧地址失败后从备用账号开始刷新，并去重播放地址", async () => {
    process.env.DOUYIN_COOKIE = "account-a=1";
    process.env.DOUYIN_COOKIE_BACKUP = "account-b=1";
    process.env.DOUYIN_COOKIE_POOL = "account-c=1";
    const seenCookies: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const cookie = String((init?.headers as Record<string, string> | undefined)?.cookie || "");
        seenCookies.push(cookie);
        const playbackUrl =
          cookie === "account-c=1"
            ? "https://v5-dy-o.zjcdn.com/fresh-c.mp4"
            : "https://v3-dy-o.zjcdn.com/fresh-shared.mp4";
        return {
          ok: true,
          json: async () => ({
            status_code: 0,
            aweme_detail: { video: { play_addr: { url_list: [playbackUrl] } } },
          }),
        };
      }),
    );

    await expect(listDouyinAwemePlaybackUrlsViaWebApi("7621410031216495935", 1)).resolves.toEqual([
      "https://v3-dy-o.zjcdn.com/fresh-shared.mp4",
      "https://v5-dy-o.zjcdn.com/fresh-c.mp4",
    ]);
    expect(seenCookies).toEqual(["account-b=1", "account-c=1", "account-a=1"]);
  });

  it("全部候选返回空详情时保持空数组，让调用方走原页面 fallback", async () => {
    process.env.DOUYIN_COOKIE = "account-a=1";
    process.env.DOUYIN_COOKIE_BACKUP = "account-b=1";
    delete process.env.DOUYIN_COOKIE_POOL;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ status_code: 0 }) })),
    );
    await expect(listDouyinAwemePlaybackUrlsViaWebApi("7621410031216495935")).resolves.toEqual([]);
  });
});
