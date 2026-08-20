import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pollWavespeedWanOnce, submitWavespeedWanVideo } from "./wavespeedWanVideo";

const IMG = (n: number) => Array.from({ length: n }, (_, i) => `https://img.example/${i}.png`);

describe("wavespeedWanVideo · 提交体契约(审查 P1)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.WAVESPEED_API_KEY = "test-key";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WAVESPEED_API_KEY;
  });

  it("请求体带 aspect_ratio / thinking_mode(默认开)/ seed,并钳制参考上限", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "pred-1" } }),
    });
    await submitWavespeedWanVideo({
      prompt: "p",
      imageUrls: IMG(12),
      audioUrls: Array.from({ length: 7 }, (_, i) => `https://a.example/${i}.mp3`),
      duration: 30,
      resolution: "720p",
      aspectRatio: "9:16",
      seed: 12345,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.thinking_mode).toBe(true);
    expect(body.seed).toBe(12345);
    expect(body.reference_images).toHaveLength(10);
    expect(body.reference_audios).toHaveLength(5);
    expect(body.duration).toBe(30);
    expect(body.enable_audio).toBe(true);
  });

  it("时长按文档钳到 2..30;非法比例回默认 16:9;越界 seed 不发", async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { id: "pred-2" } }) });
    await submitWavespeedWanVideo({
      prompt: "p",
      imageUrls: IMG(1),
      duration: 1,
      aspectRatio: "21:9",
      seed: 99_9999_99999,
    });
    const body = JSON.parse(String(fetchMock.mock.calls[0][1].body));
    expect(body.duration).toBe(2);
    expect(body.aspect_ratio).toBe("16:9");
    expect(body.seed).toBeUndefined();
  });

  it("零参考图直接拒绝,不打上游", async () => {
    await expect(
      submitWavespeedWanVideo({ prompt: "p", imageUrls: [] }),
    ).rejects.toThrow(/参考图/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("wavespeedWanVideo · 轮询状态映射(审查 P2)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.WAVESPEED_API_KEY = "test-key";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.WAVESPEED_API_KEY;
  });

  const httpCase = async (status: number) => {
    fetchMock.mockResolvedValueOnce({ status, ok: false, json: async () => ({}) });
    return pollWavespeedWanOnce("pred-x");
  };

  it("401/403/400/422 = 不可重试终态", async () => {
    for (const code of [400, 401, 403, 422]) {
      const snap = await httpCase(code);
      expect(snap.state).toBe("failed");
    }
  });

  it("404 = 瞬态(由任务框架有限重试);5xx/429 = 瞬态", async () => {
    expect((await httpCase(404)).state).toBe("running");
    expect((await httpCase(500)).state).toBe("running");
    expect((await httpCase(429)).state).toBe("running");
  });

  it("cancelled / timeout 认作终态失败;completed 取 outputs[0]", async () => {
    fetchMock.mockResolvedValueOnce({
      status: 200, ok: true,
      json: async () => ({ data: { id: "p", status: "cancelled" } }),
    });
    expect((await pollWavespeedWanOnce("p")).state).toBe("failed");
    fetchMock.mockResolvedValueOnce({
      status: 200, ok: true,
      json: async () => ({ data: { id: "p", status: "completed", outputs: ["https://v.example/out.mp4"] } }),
    });
    const done = await pollWavespeedWanOnce("p");
    expect(done).toEqual({ state: "completed", sourceUrl: "https://v.example/out.mp4" });
  });
});
