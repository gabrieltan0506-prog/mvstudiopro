import { afterEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../jobs/heavyMediaQueue", () => ({ dispatchHeavyMedia: state.dispatch }));
import { dispatchLearnSourcePlayback } from "./heavyLearnMedia";
const sourceUrl = "https://0996zp.com/vod/play/146259/sid/1313645";
const playback = { playbackUrl: "https://ppvod01.kqgfbs.com/test.m3u8", playbackUrls: ["https://ppvod01.kqgfbs.com/test.m3u8"], referer: "https://0996zp.com/", markers: [] };
afterEach(() => vi.clearAllMocks());

it("首次解析只入一次已有持久队列，刷新使用新身份且不传凭证", async () => {
  state.dispatch.mockResolvedValue({ stdout: JSON.stringify(playback), stderr: "" });
  const signal = new AbortController().signal;
  await expect(dispatchLearnSourcePlayback(sourceUrl, signal)).resolves.toEqual(playback);
  expect(state.dispatch).toHaveBeenCalledOnce();
  expect(state.dispatch).toHaveBeenLastCalledWith({ kind: "learn_source", sourceUrl, refreshId: expect.any(String) }, { signal });
  const first = state.dispatch.mock.calls[0][0].refreshId;
  await dispatchLearnSourcePlayback(sourceUrl, signal);
  expect(state.dispatch.mock.calls[1][0].refreshId).not.toBe(first);
});

it("损坏或空来源回执明确失败，不把原始签名带入JSON错误", async () => {
  state.dispatch.mockResolvedValueOnce({ stdout: 'https://fixture.invalid/?sign=test-private', stderr: "" });
  await expect(dispatchLearnSourcePlayback(sourceUrl)).rejects.toThrow("工作机返回的媒体来源回执不是有效 JSON");
  state.dispatch.mockResolvedValueOnce({ stdout: JSON.stringify({ ...playback, playbackUrls: [] }), stderr: "" });
  await expect(dispatchLearnSourcePlayback(sourceUrl)).rejects.toThrow("回执不完整");
});
