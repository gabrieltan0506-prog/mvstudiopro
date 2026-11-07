import { describe, expect, it } from "vitest";
import type { StockFootageAssetView } from "./stockFootage";
import {
  buildManhuaSceneReferenceFromStock,
  buildManhuaStockEmptyShotRegistration,
  collectManhuaStockCredits,
  isManhuaStockEmptyShotClip,
  manhuaStockMarkFromAsset,
  normalizeManhuaStockFootageMark,
  validateManhuaStockEmptyShot,
  withManhuaStockEmptyShotAssemble,
} from "./manhuaStockFootage";
import { normalizeManhuaCustomAssetRefs } from "./manhuaCustomAssetRefs";
import { normalizeManhuaSegmentReferences } from "./manhuaSegmentReference";
import { resolvePreviousSegmentClipUrl } from "./manhuaClipContinuity";

const ID = `sf_${"a".repeat(48)}`;
const GCS = `gs://bucket/stock-footage/7/${ID}.mp4`;
const SIGNED = `https://storage.googleapis.com/bucket/stock-footage/7/${ID}.mp4?X-Goog-Signature=x`;

function asset(over: Partial<StockFootageAssetView> = {}): StockFootageAssetView {
  return {
    assetId: ID,
    requestId: "11111111-1111-4111-8111-111111111111",
    kind: "video",
    purpose: "manhua",
    usage: "empty_shot",
    gcsUri: GCS,
    mimeType: "video/mp4",
    bytes: 100,
    sha256: "0".repeat(64),
    width: 1080,
    height: 1920,
    durationSec: 12,
    source: {
      provider: "pexels",
      providerAssetId: "123",
      pageUrl: "https://www.pexels.com/video/123/",
      author: { name: "Ann" },
      license: { name: "Pexels License", url: "https://www.pexels.com/license/" },
      downloadedFrom: "https://videos.pexels.com/x.mp4",
      providerFileId: "9",
      retrievedAt: "2026-11-08T00:00:00Z",
    },
    context: {},
    adoptedAt: "2026-11-08T00:00:00Z",
    url: SIGNED,
    ...over,
  };
}

const photo = () =>
  asset({
    kind: "photo",
    usage: "reference",
    durationSec: undefined,
    gcsUri: `gs://bucket/stock-footage/7/${ID}.jpg`,
    url: `https://storage.googleapis.com/bucket/stock-footage/7/${ID}.jpg?sig=1`,
  });

describe("漫剧图库 · 场景参考图（reference）", () => {
  it("正向：照片采用 → 我的场景，恒为 scene/space，带署名标记，经草稿规范化保留", () => {
    const ref = buildManhuaSceneReferenceFromStock(photo(), "ref1");
    expect(ref.role).toBe("scene");
    expect(ref.refDuty).toBe("space");
    expect(ref.stockFootage.attributionZh).toContain("Ann");
    const [norm] = normalizeManhuaCustomAssetRefs([ref]);
    expect(norm.stockFootage?.assetId).toBe(ID);
    expect(norm.gcsUri).toBe(ref.gcsUri);
  });

  it("反向：草稿被改成人物/锁脸也被拉回场景，不进角色资产", () => {
    const ref = buildManhuaSceneReferenceFromStock(photo(), "ref1");
    const [norm] = normalizeManhuaCustomAssetRefs([{ ...ref, role: "character", refDuty: "identity" }]);
    expect(norm.role).toBe("scene");
    expect(norm.refDuty).toBe("space");
  });

  it("反向：空镜用法/视频/非漫剧用途不能当场景参考", () => {
    expect(() => buildManhuaSceneReferenceFromStock(asset(), "r")).toThrow();
    expect(() => buildManhuaSceneReferenceFromStock({ ...photo(), usage: "empty_shot" }, "r")).toThrow();
    expect(() => buildManhuaSceneReferenceFromStock({ ...photo(), purpose: "mv", usage: "insert" }, "r")).toThrow();
  });

  it("反向：读链与 gcsUri 不是同一对象拒绝", () => {
    expect(() =>
      buildManhuaSceneReferenceFromStock({ ...photo(), url: "https://storage.googleapis.com/bucket/other.jpg" }, "r"),
    ).toThrow();
  });
});

describe("漫剧图库 · 无人物空镜（empty_shot）", () => {
  const reg = () =>
    buildManhuaStockEmptyShotRegistration({
      asset: asset(),
      inSec: 2,
      outSec: 7,
      plannedDurationSec: 5,
      noPersonConfirmed: true,
      nowIso: "2026-11-08T01:00:00.000Z",
    });

  it("正向：登记产出 registered 条目 + 裁点 + 无人物确认时间", () => {
    const r = reg();
    expect(r.entry.stockFootage?.usage).toBe("empty_shot");
    expect(r.entry.stockFootage?.noPersonConfirmedAt).toBe("2026-11-08T01:00:00.000Z");
    expect(r.editTrim).toMatchObject({ sourceDurationSec: 12, inSec: 2, outSec: 7 });
    const refs = normalizeManhuaSegmentReferences({ registered: r.entry });
    expect(refs?.registered?.stockFootage?.trimOutSec).toBe(7);
  });

  it("反向：未勾无人物、照片、参考图用法、裁点越界、与段长差太多都拒绝", () => {
    const base = { inSec: 0, outSec: 5, plannedDurationSec: 5, noPersonConfirmed: true };
    expect(() => validateManhuaStockEmptyShot({ ...base, asset: asset(), noPersonConfirmed: false })).toThrow(/没有人物/);
    expect(() => validateManhuaStockEmptyShot({ ...base, asset: asset({ kind: "photo" }) })).toThrow();
    expect(() => validateManhuaStockEmptyShot({ ...base, asset: asset({ usage: "reference" }) })).toThrow();
    expect(() => validateManhuaStockEmptyShot({ ...base, asset: asset(), outSec: 13 })).toThrow(/裁点/);
    expect(() => validateManhuaStockEmptyShot({ ...base, asset: asset(), outSec: 12 })).toThrow(/相差/);
  });

  it("反向：漫剧不收 insert 用法；没有确认时间的空镜标记在草稿里作废；标记不能挂在白模位", () => {
    expect(() => manhuaStockMarkFromAsset(asset({ usage: "insert" }), "empty_shot")).toThrow();
    const mark = { ...reg().entry.stockFootage, noPersonConfirmedAt: "" };
    expect(normalizeManhuaStockFootageMark(mark, "empty_shot")).toBeUndefined();
    const refs = normalizeManhuaSegmentReferences({ previs: reg().entry });
    expect(refs?.previs?.stockFootage).toBeUndefined();
  });

  it("正向：空镜段不作下一段人物连续性锚点；署名清单收空镜与场景参考", () => {
    const r = reg();
    const block = { id: "clip-e01-g01", outputUrl: SIGNED, status: "done", manhuaSegmentRefs: { registered: r.entry } };
    expect(isManhuaStockEmptyShotClip(block)).toBe(true);
    const generated = { id: "clip-e01-g01", outputUrl: "https://storage.googleapis.com/bucket/generated/a.mp4", status: "done" };
    expect(resolvePreviousSegmentClipUrl([generated], 1, 2, { segmentIndexIsLocal: true })).toBe(generated.outputUrl);
    expect(resolvePreviousSegmentClipUrl([block], 1, 2, { segmentIndexIsLocal: true })).toBeUndefined();
    const credits = collectManhuaStockCredits({
      clips: [block],
      sceneRefs: [{ id: "ref1", stockFootage: buildManhuaSceneReferenceFromStock(photo(), "ref1").stockFootage }],
    });
    expect(credits.map((c) => c.usage)).toEqual(["empty_shot", "reference"]);
  });

  it("正向：合成入参带 stockAssetId，裁点收进登记窗口；无细剪时用登记裁点", () => {
    const r = reg();
    const block = { outputUrl: SIGNED, manhuaSegmentRefs: { registered: r.entry } };
    const a = withManhuaStockEmptyShotAssemble({ clipUrl: SIGNED, trimInSec: 0, trimOutSec: 11 }, block);
    expect(a).toMatchObject({ stockAssetId: ID, trimInSec: 2, trimOutSec: 7 });
    const b = withManhuaStockEmptyShotAssemble({ clipUrl: SIGNED }, block);
    expect(b).toMatchObject({ stockAssetId: ID, trimInSec: 2, trimOutSec: 7 });
  });

  it("反向：非空镜段（或成片已换成别的版本）不带 stockAssetId，且剥掉客户端自带的 stockAssetId", () => {
    const r = reg();
    const replaced = { outputUrl: "https://storage.googleapis.com/bucket/generated/new.mp4", manhuaSegmentRefs: { registered: r.entry } };
    const out = withManhuaStockEmptyShotAssemble({ clipUrl: replaced.outputUrl, trimInSec: 0, trimOutSec: 5, stockAssetId: ID } as never, replaced);
    expect((out as { stockAssetId?: string }).stockAssetId).toBeUndefined();
    expect(withManhuaStockEmptyShotAssemble({ clipUrl: "x" }, undefined)).toEqual({ clipUrl: "x" });
  });
});
