import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const { store } = vi.hoisted(() => ({ store: vi.fn() }));
vi.mock("./openaiImageKeyPool.js", () => ({
  resolveOpenAiImageKeyChain: () => [{ key: "test-a", slot: "a" }, { key: "test-b", slot: "b" }],
  shouldRetryOpenAiImageWithOtherKey: () => true,
}));
vi.mock("./evolinkGptImage2.js", () => ({ uploadBufferToPlatformStorage: store }));
import { postOpenAiGptImage2AndUpload } from "./openaiGptImage2";
const cancelled = Object.assign(new Error("页面已刷新"), { kind: "cancelled" });
beforeEach(() => { store.mockReset(); store.mockResolvedValue("https://test.invalid/done.png"); });
afterEach(() => { vi.unstubAllGlobals(); });
describe("OpenAI每一次真正付费请求前检查取消", () => {
  it("已刷新不发第一笔", async () => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    await expect(postOpenAiGptImage2AndUpload("知识卡", "test", { beforeImageSubmit: async () => { throw cancelled; } })).rejects.toBe(cancelled);
    expect(fetcher).not.toHaveBeenCalled(); expect(store).not.toHaveBeenCalled();
  });
  it("第一把钥失败后刷新，不再换钥买第二笔", async () => {
    let stopped = false;
    const fetcher = vi.fn(async () => { stopped = true; return Response.json({ error: { message: "busy" } }, { status: 429 }); });
    vi.stubGlobal("fetch", fetcher);
    await expect(postOpenAiGptImage2AndUpload("知识卡", "test", { beforeImageSubmit: async () => { if (stopped) throw cancelled; } })).rejects.toBe(cancelled);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(store).not.toHaveBeenCalled();
  });
  it("下载参考图时刷新，下载结束也不POST edits", async () => {
    let stopped = false;
    const png = await sharp({ create: { width: 8, height: 8, channels: 4, background: "red" } }).png().toBuffer();
    const fetcher = vi.fn(async (url: string) => { expect(url).toBe("https://test.invalid/ref"); stopped = true; return new Response(new Uint8Array(png)); });
    vi.stubGlobal("fetch", fetcher);
    await expect(postOpenAiGptImage2AndUpload("知识卡", "test", { imageUrls: ["https://test.invalid/ref"], size: "1024x1024", beforeImageSubmit: async () => { if (stopped) throw cancelled; } })).rejects.toBe(cancelled);
    expect(fetcher).toHaveBeenCalledTimes(1); expect(store).not.toHaveBeenCalled();
  });
  it("图片已经提交后刷新，收到图片仍上传保留", async () => {
    let stopped = false;
    const fetcher = vi.fn(async () => { stopped = true; return Response.json({ data: [{ b64_json: Buffer.from("image").toString("base64") }] }); });
    vi.stubGlobal("fetch", fetcher);
    expect(await postOpenAiGptImage2AndUpload("知识卡", "test", { beforeImageSubmit: async () => { if (stopped) throw cancelled; } })).toBe("https://test.invalid/done.png");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(store).toHaveBeenCalledTimes(1);
  });
});
