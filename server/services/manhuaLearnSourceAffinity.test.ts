import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ split: false, dispatch: vi.fn() }));
vi.mock("../jobs/heavyMediaContext.js", () => ({ shouldDispatchHeavyMedia: () => state.split }));
vi.mock("./heavyLearnMedia.js", () => ({ dispatchLearnSourcePlayback: state.dispatch }));
vi.mock("node:dns/promises", () => ({ lookup: vi.fn(async () => [{ address: "203.0.113.8", family: 4 }]) }));
import { fetchManhua0996EpisodePlayback, fetchManhua0996EpisodePlaybackLocally } from "./manhuaLearn0996Source";
const sourceUrl = "https://0996zp.com/vod/play/146259/sid/1313645";
afterEach(() => { state.split = false; vi.clearAllMocks(); vi.unstubAllEnvs(); });

it("网站机只派发可信来源，不在自己出口获取媒体签名", async () => {
  state.split = true;
  const playback = { playbackUrl: "https://ppvod01.kqgfbs.com/test.m3u8", playbackUrls: [], referer: "https://0996zp.com/", markers: [] };
  state.dispatch.mockResolvedValue(playback);
  const localFetch = vi.fn(); const signal = new AbortController().signal;
  await expect(fetchManhua0996EpisodePlayback(sourceUrl, signal, localFetch)).resolves.toBe(playback);
  expect(state.dispatch).toHaveBeenCalledWith(sourceUrl, signal);
  expect(localFetch).not.toHaveBeenCalled();
  await expect(fetchManhua0996EpisodePlayback("https://attacker.invalid/vod/play/1/sid/2", signal, localFetch)).rejects.toThrow("不在可信站点");
  expect(state.dispatch).toHaveBeenCalledOnce();
});

it("工作机本地解析每跳带双鉴权，绝不递归入队", async () => {
  state.split = true; // 本地执行器即使调用上下文错误也不重新派发。
  vi.stubEnv("MANHUA_MIRROR_SOURCE_COOKIE", "session=test-cookie");
  vi.stubEnv("MANHUA_MIRROR_SOURCE_AUTHORIZATION", "Bearer test-token");
  const fetcher = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
    const h = new Headers(init?.headers);
    expect(h.get("cookie")).toBe("session=test-cookie");
    expect(h.get("authorization")).toBe("Bearer test-token");
    if (fetcher.mock.calls.length === 1) return new Response(null, { status: 307, headers: { location: "https://0996zp.com/GE/CC/VALIDATOR" } });
    return new Response(JSON.stringify({ code: 200, data: { list: [{ flag: true, needLogin: false, resolution: 720, url: "https://ppvod01.kqgfbs.com/test.m3u8?whip=worker&sign=test" }] } }), { status: 200 });
  });
  await expect(fetchManhua0996EpisodePlaybackLocally(sourceUrl, undefined, fetcher)).resolves.toMatchObject({ playbackUrl: "https://ppvod01.kqgfbs.com/test.m3u8?whip=worker&sign=test" });
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(state.dispatch).not.toHaveBeenCalled();
});

it("已取消的解析不入队也不请求源站", async () => {
  state.split = true;
  const c = new AbortController(); c.abort(new Error("已停止"));
  const fetcher = vi.fn();
  await expect(fetchManhua0996EpisodePlayback(sourceUrl, c.signal, fetcher)).rejects.toThrow("已停止");
  expect(state.dispatch).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
});
