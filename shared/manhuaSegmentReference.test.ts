import { describe, expect, it } from "vitest";
import {
  formatManhuaSegmentReferenceGuideZh,
  normalizeManhuaSegmentReferences,
  setManhuaSegmentReference,
} from "./manhuaSegmentReference";

describe("manhuaSegmentReference · 段级白模/母轨/登记成片", () => {
  it("normalize 只留 https 或可重签的 gs:// 项，全空回 undefined", () => {
    expect(normalizeManhuaSegmentReferences(null)).toBeUndefined();
    expect(normalizeManhuaSegmentReferences({ previs: { url: "blob:abc" } })).toBeUndefined();
    const out = normalizeManhuaSegmentReferences({
      previs: { url: "https://x.test/previs.mp4?sig=1", gcsUri: "gs://b/uploads/u1/previs.mp4", fileName: "白模.mp4", updatedAt: "2026-09-09T00:00:00Z" },
      master: { url: "expired", gcsUri: "gs://b/uploads/u1/master.wav" },
      registered: { url: "http://insecure", gcsUri: "not-a-gcs" },
      junk: { url: "https://x.test/junk.mp4" },
    });
    expect(out?.previs).toMatchObject({ url: "https://x.test/previs.mp4?sig=1", gcsUri: "gs://b/uploads/u1/previs.mp4", fileName: "白模.mp4" });
    // 签名链过期也不能丢：有 gcsUri 就能出片前现签
    expect(out?.master).toMatchObject({ url: "", gcsUri: "gs://b/uploads/u1/master.wav" });
    expect(out?.registered).toMatchObject({ url: "http://insecure", gcsUri: undefined });
    expect(out && "junk" in out).toBe(false);
  });
  it("set/clear 不动其他槽位，清空到无槽位时字段消失", () => {
    const entry = { url: "https://x.test/a.wav", updatedAt: "2026-09-09T00:00:00Z" };
    const withMaster = setManhuaSegmentReference({ id: "clip-e01-g01" } as { id: string; manhuaSegmentRefs?: undefined }, "master", entry);
    expect(withMaster.manhuaSegmentRefs).toEqual({ master: entry });
    const withBoth = setManhuaSegmentReference(withMaster, "previs", { ...entry, url: "https://x.test/p.mp4" });
    expect(Object.keys(withBoth.manhuaSegmentRefs || {}).sort()).toEqual(["master", "previs"]);
    const cleared = setManhuaSegmentReference(setManhuaSegmentReference(withBoth, "previs", null), "master", null);
    expect(cleared.manhuaSegmentRefs).toBeUndefined();
  });
  it("引导句按实际数组序号写 @视频N/@音频N，没有就不写", () => {
    expect(formatManhuaSegmentReferenceGuideZh({})).toBe("");
    const guide = formatManhuaSegmentReferenceGuideZh({ previsVideoIndex: 1, masterAudioIndex: 2 });
    expect(guide).toContain("@视频1是本段站位白模");
    expect(guide).toContain("@音频2就是本片最终音轨");
    expect(guide).toContain("灰色人偶");
    expect(formatManhuaSegmentReferenceGuideZh({ previsVideoIndex: 0, masterAudioIndex: 1 })).not.toContain("@视频");
  });
});
