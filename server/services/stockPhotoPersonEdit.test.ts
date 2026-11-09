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
