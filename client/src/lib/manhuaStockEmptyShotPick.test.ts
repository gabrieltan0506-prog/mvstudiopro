import { describe, expect, it } from "vitest";
import { validateManhuaStockEmptyShot } from "@shared/manhuaStockFootage";
import { manhuaEmptyShotTrimFromPick } from "./manhuaStockEmptyShotPick";

const asset = (over: Record<string, unknown> = {}) => ({ purpose: "manhua" as const, usage: "empty_shot" as const, kind: "video" as const, durationSec: 12, ...over });

describe("漫剧空镜 · 抽屉裁点", () => {
  it("正向：抽屉裁点原样带入，裁后时长与段长一致时不提示", () => {
    const t = manhuaEmptyShotTrimFromPick({ asset: asset(), inSec: 2.5, outSec: 6.5 }, 4);
    expect(t).toEqual({ inSec: 2.5, outSec: 6.5, spanSec: 4, sourceDurationSec: 12, offPlan: false });
  });
  it("正向：带入的裁点能通过服务端同口径的登记校验", () => {
    const full = { ...asset(), assetId: `sf_${"a".repeat(48)}`, gcsUri: "gs://b/stock-footage/1/a.mp4", source: {} as never };
    const t = manhuaEmptyShotTrimFromPick({ asset: full, inSec: 1, outSec: 5 }, 4);
    expect(validateManhuaStockEmptyShot({ asset: full, inSec: t.inSec, outSec: t.outSec, plannedDurationSec: 4, noPersonConfirmed: true })).toMatchObject({ inSec: 1, outSec: 5 });
  });
  it("反向：出点越过素材时夹回；裁后与段长差超过容差时标出", () => {
    const t = manhuaEmptyShotTrimFromPick({ asset: asset({ durationSec: 5 }), inSec: 3, outSec: 9 }, 6);
    expect(t.outSec).toBe(5);
    expect(t.offPlan).toBe(true);
  });
  it("反向：用途/用法不符、照片、无时长都不进入确认", () => {
    expect(() => manhuaEmptyShotTrimFromPick({ asset: asset({ usage: "reference" }), inSec: 0, outSec: 3 }, 3)).toThrow("漫剧空镜");
    expect(() => manhuaEmptyShotTrimFromPick({ asset: asset({ purpose: "mv", usage: "insert" }), inSec: 0, outSec: 3 }, 3)).toThrow("漫剧空镜");
    expect(() => manhuaEmptyShotTrimFromPick({ asset: asset({ kind: "photo" }), inSec: 0, outSec: 3 }, 3)).toThrow("视频");
    expect(() => manhuaEmptyShotTrimFromPick({ asset: asset({ durationSec: undefined }), inSec: 0, outSec: 3 }, 3)).toThrow("时长");
  });
});
