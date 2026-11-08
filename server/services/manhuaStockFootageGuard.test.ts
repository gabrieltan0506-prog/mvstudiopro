import { describe, expect, it, vi } from "vitest";
import type { StockFootageAsset } from "../../shared/stockFootage";
import {
  assertManhuaStockReferenceObject,
  resolveManhuaAssembleStockClips,
  type ManhuaStockGuardDeps,
} from "./manhuaStockFootageGuard";

const ID = `sf_${"b".repeat(48)}`;
const VIDEO_PATH = `stock-footage/7/${ID}.mp4`;
const PHOTO_PATH = `stock-footage/7/${ID}.jpg`;

function asset(over: Partial<StockFootageAsset>): StockFootageAsset {
  return {
    assetId: ID,
    requestId: "11111111-1111-4111-8111-111111111111",
    kind: "video",
    purpose: "manhua",
    usage: "empty_shot",
    gcsUri: `gs://bucket/${VIDEO_PATH}`,
    mimeType: "video/mp4",
    bytes: 1,
    sha256: "0".repeat(64),
    width: 1,
    height: 1,
    durationSec: 10,
    source: {
      provider: "pexels",
      providerAssetId: "1",
      pageUrl: "https://www.pexels.com/video/1/",
      author: { name: "A" },
      license: { name: "Pexels License", url: "https://www.pexels.com/license/" },
      downloadedFrom: "https://videos.pexels.com/1.mp4",
      providerFileId: "1",
      retrievedAt: "x",
    },
    context: {},
    adoptedAt: "x",
    ...over,
  };
}

/** 模拟 loadOwnedStockAsset 的 expect 过滤：用途/用法/类型不符即抛错 */
function deps(stored: StockFootageAsset | null): ManhuaStockGuardDeps & { load: ReturnType<typeof vi.fn> } {
  const load = vi.fn(async (_uid: number, assetId: string, expect: { purpose?: string; usages?: readonly string[]; kind?: string }) => {
    if (!stored || stored.assetId !== assetId) throw new Error("not_found");
    if (expect.purpose && stored.purpose !== expect.purpose) throw new Error("purpose");
    if (expect.usages && !expect.usages.includes(stored.usage)) throw new Error("usage");
    if (expect.kind && stored.kind !== expect.kind) throw new Error("kind");
    return stored;
  });
  return { load, bucket: () => "bucket", sign: (gcsUri) => `https://signed.example/${encodeURIComponent(gcsUri)}` };
}

describe("生成参考：图库对象只放行本人漫剧场景参考图", () => {
  it("正向：本人 reference 照片放行，按 usages:[reference] 核对", async () => {
    const d = deps(asset({ kind: "photo", usage: "reference", gcsUri: `gs://bucket/${PHOTO_PATH}` }));
    await expect(assertManhuaStockReferenceObject(7, PHOTO_PATH, d)).resolves.toBe(true);
    expect(d.load).toHaveBeenCalledWith(7, ID, { purpose: "manhua", usages: ["reference"], kind: "photo" });
  });
  it("正向：非图库对象不归它管（返回 false 交给既有登记校验）", async () => {
    await expect(assertManhuaStockReferenceObject(7, "user-uploads/7/a.png", deps(null))).resolves.toBe(false);
  });
  it("反向：空镜视频、他人对象拒绝", async () => {
    await expect(assertManhuaStockReferenceObject(7, VIDEO_PATH, deps(asset({})))).rejects.toThrow();
    await expect(assertManhuaStockReferenceObject(8, PHOTO_PATH, deps(asset({ kind: "photo", usage: "reference" })))).rejects.toThrow(/不属于/);
  });
});

describe("最终合成：图库空镜按 assetId 核对并现签", () => {
  it("正向：空镜段换成服务端现签读链，按 usages:[empty_shot]/video 核对", async () => {
    const d = deps(asset({}));
    const [clip] = await resolveManhuaAssembleStockClips(
      [{ clipUrl: `https://storage.googleapis.com/bucket/${VIDEO_PATH}?sig=old`, stockAssetId: ID, trimInSec: 1, trimOutSec: 6 }],
      7,
      d,
    );
    expect(clip.clipUrl).toBe(`https://signed.example/${encodeURIComponent(`gs://bucket/${VIDEO_PATH}`)}`);
    expect("stockAssetId" in clip).toBe(false);
    expect(d.load).toHaveBeenCalledWith(7, ID, { purpose: "manhua", usages: ["empty_shot"], kind: "video" });
  });
  it("正向：普通段原样通过（剥掉空的 stockAssetId 字段）", async () => {
    const out = await resolveManhuaAssembleStockClips([{ clipUrl: "https://storage.googleapis.com/bucket/generated/a.mp4" }], 7, deps(null));
    expect(out[0].clipUrl).toContain("generated/a.mp4");
  });
  it("反向：未声明 stockAssetId 却指向图库对象（参考图偷渡入片）拒绝", async () => {
    await expect(
      resolveManhuaAssembleStockClips([{ clipUrl: `https://storage.googleapis.com/bucket/${PHOTO_PATH}` }], 7, deps(null)),
    ).rejects.toThrow(/空镜/);
  });
  it("反向：参考图用法的资产、裁点越过时长、缺裁点、对象不一致都拒绝", async () => {
    const ref = deps(asset({ usage: "reference" }));
    await expect(resolveManhuaAssembleStockClips([{ clipUrl: "x", stockAssetId: ID, trimInSec: 0, trimOutSec: 3 }], 7, ref)).rejects.toThrow();
    await expect(resolveManhuaAssembleStockClips([{ clipUrl: "x", stockAssetId: ID, trimInSec: 0, trimOutSec: 11 }], 7, deps(asset({})))).rejects.toThrow(/越过/);
    await expect(resolveManhuaAssembleStockClips([{ clipUrl: "x", stockAssetId: ID }], 7, deps(asset({})))).rejects.toThrow(/裁点/);
    await expect(
      resolveManhuaAssembleStockClips(
        [{ clipUrl: "https://storage.googleapis.com/bucket/generated/other.mp4", stockAssetId: ID, trimInSec: 0, trimOutSec: 3 }],
        7,
        deps(asset({})),
      ),
    ).rejects.toThrow(/同一素材/);
    await expect(resolveManhuaAssembleStockClips([{ clipUrl: "x", stockAssetId: ID, trimInSec: 0, trimOutSec: 3 }], undefined, deps(asset({})))).rejects.toThrow();
  });
});
