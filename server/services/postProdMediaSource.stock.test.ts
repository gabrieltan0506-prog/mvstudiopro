/**
 * 后期素材登记 · 图库资产（共用素材检索）：
 * 正向：本人已采用的营销 insert 视频，以 stock:assetId 进入拼接/配乐贴装；入队保留引用，worker 才换成 gcsUri。
 * 反向：缺核对依赖、他人/未采用资产、参考图用途、照片、跨桶、伪造形状、音频位置夹带引用一律拒绝。
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ getDb: async () => null }));

import { resolvePostProdInputSources, stockPostProdSource, type PostProdMediaDeps } from "./postProdMediaSource";
import type { StockFootageAsset } from "../../shared/stockFootage";

const BUCKET = "bucket-a";
const ASSET_ID = `sf_${"a".repeat(48)}`;
const OTHER_ID = `sf_${"b".repeat(48)}`;

function asset(overrides: Partial<StockFootageAsset> = {}): StockFootageAsset {
  return {
    assetId: ASSET_ID, requestId: "11111111-1111-4111-8111-111111111111", kind: "video", purpose: "marketing", usage: "insert",
    gcsUri: `gs://${BUCKET}/stock-footage/7/${ASSET_ID}.mp4`, mimeType: "video/mp4", bytes: 1000, sha256: "c".repeat(64),
    width: 1080, height: 1920, durationSec: 12,
    source: { provider: "pexels", providerAssetId: "123", pageUrl: "https://www.pexels.com/video/123/", author: { name: "A" },
      license: { name: "Pexels License", url: "https://www.pexels.com/license/" }, downloadedFrom: "https://videos.pexels.com/x.mp4",
      providerFileId: "9", retrievedAt: "2026-11-08T00:00:00Z" },
    context: {}, adoptedAt: "2026-11-08T00:00:00Z", ...overrides,
  };
}

function deps(load?: PostProdMediaDeps["loadOwnedStockAsset"]): PostProdMediaDeps {
  return {
    getBucket: () => BUCKET,
    verifyOwnership: vi.fn(async () => false),
    loadSucceededJobOutputObjects: vi.fn(async () => new Set<string>()),
    loadOwnedStockAsset: load,
  };
}

const owned = (value: StockFootageAsset = asset()) => vi.fn(async (uid: number, id: string) => {
  if (uid !== 7 || id !== value.assetId) throw new Error("图库素材不存在或无权使用");
  return value;
});

const concat = (clips: string[]) => ({ action: "concat" as const, params: { clips, trims: clips.map(() => ({ startSec: 0, endSec: 3 })) } });

describe("正向：本人已采用的营销视频可登记为后期素材", () => {
  it("入队保留 stock:引用（不落地址），并按 assetId 核对本人", async () => {
    const load = owned();
    const out = await resolvePostProdInputSources({ userId: "7", input: concat([stockPostProdSource(ASSET_ID), "gs://bucket-a/uploads/u7/product.mp4"]) }, deps(load));
    expect(out.params).toMatchObject({ clips: [`stock:${ASSET_ID}`, "gs://bucket-a/uploads/u7/product.mp4"] });
    expect(load).toHaveBeenCalledWith(7, ASSET_ID, { purpose: "marketing", usages: ["insert"], kind: "video" });
  });
  it("worker 执行前才换成资产 gcsUri", async () => {
    const out = await resolvePostProdInputSources({ userId: "7", input: concat([stockPostProdSource(ASSET_ID)]) }, deps(owned()), { materializeStock: true });
    expect(out.params).toMatchObject({ clips: [asset().gcsUri] });
  });
  it("配乐贴装的视频位置接受图库视频，配音仍走原登记规则", async () => {
    const out = await resolvePostProdInputSources({ userId: "7", input: { action: "bgm_mount", params: {
      videoUri: stockPostProdSource(ASSET_ID), bgmUri: "gs://bucket-a/post-prod/7/dialogue/dlg_1.wav", bgmVolume: 1,
    } } }, deps(owned()), { materializeStock: true });
    expect(out.params).toMatchObject({ videoUri: asset().gcsUri, bgmUri: "gs://bucket-a/post-prod/7/dialogue/dlg_1.wav" });
  });
});

describe("反向：图库引用不能绕过归属与用途", () => {
  it("未注入核对依赖时拒绝", async () => {
    await expect(resolvePostProdInputSources({ userId: "7", input: concat([stockPostProdSource(ASSET_ID)]) }, deps())).rejects.toThrow("图库素材暂时无法核对");
  });
  it("他人或未采用成功的资产被拒，不创建任务", async () => {
    await expect(resolvePostProdInputSources({ userId: "8", input: concat([stockPostProdSource(ASSET_ID)]) }, deps(owned()))).rejects.toThrow("无权使用");
    await expect(resolvePostProdInputSources({ userId: "7", input: concat([stockPostProdSource(OTHER_ID)]) }, deps(owned()))).rejects.toThrow("无权使用");
  });
  it("返回资产身份与引用不一致时拒绝", async () => {
    const load = vi.fn(async () => asset({ assetId: OTHER_ID }));
    await expect(resolvePostProdInputSources({ userId: "7", input: concat([stockPostProdSource(ASSET_ID)]) }, deps(load))).rejects.toThrow("身份不一致");
  });
  it("参考图用途、照片不能直接入片", async () => {
    await expect(resolvePostProdInputSources({ userId: "7", input: concat([stockPostProdSource(ASSET_ID)]) }, deps(owned(asset({ purpose: "manhua", usage: "reference" }))))).rejects.toThrow("参考图");
    await expect(resolvePostProdInputSources({ userId: "7", input: concat([stockPostProdSource(ASSET_ID)]) }, deps(owned(asset({ kind: "photo" }))))).rejects.toThrow("照片");
  });
  it("资产不在系统桶时拒绝", async () => {
    await expect(resolvePostProdInputSources({ userId: "7", input: concat([stockPostProdSource(ASSET_ID)]) }, deps(owned(asset({ gcsUri: "gs://other/x.mp4" }))))).rejects.toThrow("存储范围");
  });
  it("伪造形状的引用按未登记拒绝", async () => {
    await expect(resolvePostProdInputSources({ userId: "7", input: concat(["stock:sf_123"]) }, deps(owned()))).rejects.toThrow("素材尚未登记");
    await expect(resolvePostProdInputSources({ userId: "7", input: concat([`stock:${ASSET_ID}?u=https://evil`]) }, deps(owned()))).rejects.toThrow("素材尚未登记");
  });
  it("音频位置夹带图库引用按未登记拒绝", async () => {
    await expect(resolvePostProdInputSources({ userId: "7", input: { action: "bgm_mount", params: {
      videoUri: "gs://bucket-a/uploads/u7/a.mp4", bgmUri: stockPostProdSource(ASSET_ID),
    } } }, deps(owned()))).rejects.toThrow("素材尚未登记");
  });
});
