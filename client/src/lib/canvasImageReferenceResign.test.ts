import { afterEach, describe, expect, it, vi } from "vitest";
import { resignCanvasImageEditReferences } from "./canvasAssetResign";
import { defaultCanvasBlock } from "./canvasTypes";
import { runCanvasBlock } from "./canvasRunBlock";
import { createJobSameOrigin, pollJobUntilTerminal } from "./jobs";

vi.mock("./jobs", () => ({ createJobSameOrigin: vi.fn(), pollJobUntilTerminal: vi.fn() }));
vi.mock("./longJobsFlyOrigin", () => ({ withLongJobsFlyDirect: (url: string) => url }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const old = (path: string) =>
  `https://storage.googleapis.com/test-bucket/${path}?X-Goog-Date=20260924T221929Z&X-Goog-Expires=3600&X-Goog-Signature=old`;
const fresh = (gcsUri: string) =>
  `https://storage.googleapis.com/${gcsUri.slice(5)}?X-Goog-Date=20260925T010000Z&X-Goog-Expires=3600&X-Goog-Signature=new`;

describe("生图前库图参考续签", () => {
  it("旧底图、融合图与遮罩逐项续签，重复对象只请求一次且顺序不变", async () => {
    const sign = vi.fn(async (gcsUri: string) => fresh(gcsUri));
    const result = await resignCanvasImageEditReferences({
      refImageUrl: old("roles/a.png"),
      referenceImageUrls: [old("roles/b.png"), old("scenes/market%20topLeft.png"), old("roles/a.png")],
      maskUrl: old("masks/first.png"),
    }, sign);
    expect(result).toEqual({
      refImageUrl: fresh("gs://test-bucket/roles/a.png"),
      referenceImageUrls: [
        fresh("gs://test-bucket/roles/b.png"),
        fresh("gs://test-bucket/scenes/market topLeft.png"),
        fresh("gs://test-bucket/roles/a.png"),
      ],
      maskUrl: fresh("gs://test-bucket/masks/first.png"),
    });
    expect(sign.mock.calls.map(([uri]) => uri)).toEqual([
      "gs://test-bucket/roles/a.png",
      "gs://test-bucket/roles/b.png",
      "gs://test-bucket/scenes/market topLeft.png",
      "gs://test-bucket/masks/first.png",
    ]);
  });

  it("外部 HTTPS 不改，续签失败或返回另一对象立即报错", async () => {
    const external = "https://cdn.example.com/reference.png";
    const publicGcs = "https://storage.googleapis.com/public-bucket/reference.png";
    const unchanged = await resignCanvasImageEditReferences({ refImageUrl: external, referenceImageUrls: [external, publicGcs] }, vi.fn());
    expect(unchanged).toEqual({ refImageUrl: external, referenceImageUrls: [external, publicGcs] });
    await expect(resignCanvasImageEditReferences({ refImageUrl: old("roles/a.png"), referenceImageUrls: [] }, async () => {
      throw new Error("gateway unavailable");
    })).rejects.toThrow("未提交生图任务");
    await expect(resignCanvasImageEditReferences({ refImageUrl: old("roles/a.png"), referenceImageUrls: [] }, async () => fresh("gs://test-bucket/roles/wrong.png"))).rejects.toThrow("未提交生图任务");
  });

  it("关键静帧真正建单只收到新签名；签名网关失败时不建单", async () => {
    const requests: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const match = /^\/api\/google\?op=materialReadUrl&gcsUri=(.+)$/.exec(String(url));
      if (!match) throw new Error("禁止真实网络");
      const uri = decodeURIComponent(match[1]!);
      requests.push(uri);
      return new Response(JSON.stringify({ ok: true, url: fresh(uri) }));
    }));
    vi.mocked(createJobSameOrigin).mockResolvedValue({ jobId: "offline-job" } as never);
    vi.mocked(pollJobUntilTerminal).mockResolvedValue({ status: "succeeded", output: { imageUrl: "https://test.invalid/new.png" } } as never);
    const block = {
      ...defaultCanvasBlock("image", 0, 0), id: "keyart-e01-test", imageMode: "edit" as const,
      prompt: "人物库垫图，阿菁背着娘穿过坊市，棕色眼罩马跟随。",
      refImageUrl: old("roles/a.png"), editFusionUrls: [old("roles/b.png"), old("scenes/market.png")],
    };
    await runCanvasBlock({ userRole: "admin", userId: "test-user", optimizeCopy: async () => "" }, block);
    expect(requests).toEqual(["gs://test-bucket/roles/a.png", "gs://test-bucket/roles/b.png", "gs://test-bucket/scenes/market.png"]);
    expect(createJobSameOrigin).toHaveBeenCalledTimes(1);
    const job = vi.mocked(createJobSameOrigin).mock.calls[0]![0] as unknown as { input: { params: { referenceImageUrls: string[] } } };
    expect(job.input.params.referenceImageUrls).toEqual([
      fresh("gs://test-bucket/roles/a.png"), fresh("gs://test-bucket/roles/b.png"), fresh("gs://test-bucket/scenes/market.png"),
    ]);
    vi.mocked(createJobSameOrigin).mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: false, error: "sign_failed" }), { status: 502 })));
    await expect(runCanvasBlock({ userRole: "admin", userId: "test-user", optimizeCopy: async () => "" }, block)).rejects.toThrow("未提交生图任务");
    expect(createJobSameOrigin).not.toHaveBeenCalled();
  });
});
