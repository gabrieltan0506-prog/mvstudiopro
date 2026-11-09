import { describe, expect, it, vi } from "vitest";
vi.mock("../db", () => ({ getDb: vi.fn() }));
import { assertStockPhotoPersonEditJob, resolveStockPhotoPersonEdit, stockPhotoPersonEditJob } from "./stockPhotoPersonEdit";

const input = {
  requestId: "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659",
  baseAssetId: `sf_${"b".repeat(48)}`,
  cast: "lead" as const,
  people: [{ slot: "lead" as const, source: "https://example.com/api/canvas-media/uploads/u7/face.jpg", identityPhoto: true }],
  actionText: "他撑透明伞站在橱窗前开口演唱",
  aspectRatio: "9:16" as const,
};
const resolved = { baseGcsUri: "gs://bucket/stock-footage/7/sf_b.jpg", providerAssetId: "15518745", peopleSources: ["gs://bucket/uploads/u7/face.jpg"] };

describe("实拍照放入人物重绘：归属、幂等与参数门禁", () => {
  it("底图按本人采用回执取 gcsUri，人物图按本人素材核对后规范化", async () => {
    const deps = { loadBase: vi.fn(async () => ({ gcsUri: resolved.baseGcsUri, providerAssetId: "15518745" })), resolvePerson: vi.fn(async () => resolved.peopleSources[0]!) };
    await expect(resolveStockPhotoPersonEdit(7, input, deps)).resolves.toEqual(resolved);
    expect(deps.loadBase).toHaveBeenCalledWith(7, input.baseAssetId);
    expect(deps.resolvePerson).toHaveBeenCalledWith(7, input.people[0]!.source);
    const denied = { ...deps, resolvePerson: vi.fn(async () => { throw new Error("素材不属于当前账号"); }) };
    await expect(resolveStockPhotoPersonEdit(7, input, denied)).rejects.toThrow("素材不属于当前账号");
  });
  it("任务载荷：底图在前、edit 模式、Sunburst 官方资产线；同账号同请求同单，跨账号隔离", () => {
    const t = stockPhotoPersonEditJob(7, input, resolved);
    expect(t.input.action).toBe("canvas_gpt_image2");
    expect(t.input.params.referenceImageUrls).toEqual([resolved.baseGcsUri, resolved.peopleSources[0]]);
    expect(t.input.params).toMatchObject({ generalImageEdit: true, openaiImageVariant: "sunburst", requireImageVariant: true, providerOverride: "openai", imageLane: "asset" });
    expect(t.input.params.prompt).toMatch(/THE LEAD = the real person in image 2/);
    expect(stockPhotoPersonEditJob(7, input, resolved).id).toBe(t.id);
    expect(stockPhotoPersonEditJob(8, input, resolved).id).not.toBe(t.id);
    expect(stockPhotoPersonEditJob(7, { ...input, actionText: "她转身离开" }, resolved).digest).not.toBe(t.digest);
  });
  it("runner 复核：JSON 重排仍通过并固定 2.6 Sunburst high；改提示词/换底图/换任务号在扣费前拒绝", () => {
    const t = stockPhotoPersonEditJob(7, input, resolved);
    const serialized = JSON.parse(JSON.stringify(t.input));
    serialized.params = Object.fromEntries(Object.entries(serialized.params).reverse());
    expect(assertStockPhotoPersonEditJob(7, t.id, serialized)).toEqual({ imageModelVersion: "2.6", openaiImageVariant: "sunburst", requireImageVariant: true, qualityOverride: "high" });
    expect(() => assertStockPhotoPersonEditJob(7, t.id, { ...t.input, params: { ...t.input.params, prompt: "anything" } })).toThrow("不一致");
    expect(() => assertStockPhotoPersonEditJob(7, t.id, { ...t.input, params: { ...t.input.params, referenceImageUrls: ["gs://bucket/other.jpg", resolved.peopleSources[0]] } })).toThrow("不一致");
    expect(() => assertStockPhotoPersonEditJob(7, "spedit_forged", t.input)).toThrow("不一致");
    expect(() => assertStockPhotoPersonEditJob(8, t.id, t.input)).toThrow("不一致");
  });
});

describe("场景连续性锁：母版底图与一致性预检（替身，不读真图、不调模型）", () => {
  it("生成图母版走 baseSource：按本人素材核对，不查图库采用回执", async () => {
    const { baseAssetId: _omit, ...rest } = input;
    const deps = { loadBase: vi.fn(), resolvePerson: vi.fn(async (_u: number, s: string) => (s === "gs://bucket/gen/k1.png" ? "gs://bucket/gen/k1.png" : resolved.peopleSources[0]!)) };
    await expect(resolveStockPhotoPersonEdit(7, { ...rest, baseSource: "gs://bucket/gen/k1.png", sceneLockLocationZh: "商店门口" }, deps)).resolves.toEqual({ baseGcsUri: "gs://bucket/gen/k1.png", peopleSources: resolved.peopleSources });
    expect(deps.loadBase).not.toHaveBeenCalled();
  });
  it("预检：同图满分、不同图软提示；读图失败记为未检查不拦", async () => {
    const { checkMvSceneLockConsistency } = await import("./stockPhotoPersonEdit");
    const { mvSceneSignatureFromGray } = await import("../../shared/canvasMusicMvSceneLock");
    const flat = (f: (i: number) => number) => mvSceneSignatureFromGray(Array.from({ length: 1024 }, (_, i) => f(i)), 32, 32);
    const sigs: Record<string, ReturnType<typeof flat>> = { "gs://m": flat(i => (i % 32 < 16 ? 40 : 200)), "gs://same": flat(i => (i % 32 < 16 ? 30 : 150)), "gs://diff": flat(i => (Math.floor(i / 32) < 16 ? 220 : 20)) };
    const deps = {
      resolveImage: vi.fn(async (_u: number, s: string) => s),
      download: vi.fn(async (g: string) => { if (g === "gs://broken") throw new Error("404"); return Buffer.from(g); }),
      signature: vi.fn(async (b: Buffer) => sigs[b.toString()]!),
    };
    const out = await checkMvSceneLockConsistency(7, [{ locationZh: "商店门口", masterGcsUri: "gs://m", items: [
      { shotId: "K4", shotLabel: "镜头 4", gcsUri: "gs://same" },
      { shotId: "K5", shotLabel: "镜头 5", gcsUri: "gs://diff" },
      { shotId: "K6", shotLabel: "镜头 6", gcsUri: "gs://broken" },
    ] }], deps);
    expect(out.reports[0]!.items.map(i => [i.shotId, i.ok])).toEqual([["K4", true], ["K5", false]]);
    expect(out.warningsZh).toEqual(["镜头 5 的场景图与「商店门口」母版差异明显，可能不是同一地点"]);
    expect(out.uncheckedZh).toEqual(["镜头 6 的场景图读取失败，未检查"]);
    expect(deps.resolveImage).toHaveBeenCalledWith(7, "gs://m");
  });
});
