import { describe, expect, it } from "vitest";
import { digitalHumanOverlayIssues, type DigitalHumanOverlayDraft } from "@shared/digitalHumanOverlay";
import {
  digitalHumanOverlayFromPick,
  digitalHumanOverlayGaps,
  digitalHumanOverlayTargetSec,
  digitalHumanSegmentAt,
  digitalHumanSpeechSegments,
} from "./digitalHumanOverlayTimeline";

const A = `sf_${"a".repeat(48)}`, B = `sf_${"b".repeat(48)}`;
const source = {
  provider: "pexels" as const, providerAssetId: "1", pageUrl: "https://www.pexels.com/video/1/",
  author: { name: "Probe", url: "https://www.pexels.com/@probe" }, license: { name: "Pexels License", url: "https://www.pexels.com/license/" },
  downloadedFrom: "https://videos.pexels.com/1.mp4", providerFileId: "1", retrievedAt: "2026-11-08T00:00:00Z",
};
const video = (assetId = A, durationSec = 12) => ({ assetId, kind: "video" as const, purpose: "digital_human" as const, usage: "insert" as const, durationSec, width: 1080, height: 1920, source });
const photo = (assetId = B) => ({ assetId, kind: "photo" as const, purpose: "digital_human" as const, usage: "insert" as const, width: 1080, height: 1920, source });
const row = (assetId: string, startSec: number, durationSec: number, sourceInSec = 0): DigitalHumanOverlayDraft => ({
  assetId, startSec, durationSec, sourceInSec, mode: "overlay", kind: "video", sourceDurationSec: 12, width: 1080, height: 1920, attribution: "Probe / Pexels",
});

describe("口播段切分", () => {
  it("正向：无分段清单时按句读、按字数分摊时长，首尾相接覆盖全长", () => {
    const segs = digitalHumanSpeechSegments("今天聊城市夜景。雨天拍摄要注意什么？最后讲器材", 10);
    expect(segs.map(s => s.text)).toEqual(["今天聊城市夜景。", "雨天拍摄要注意什么？", "最后讲器材"]);
    expect(segs[0].startSec).toBe(0);
    expect(segs[2].endSec).toBe(10);
    segs.slice(1).forEach((s, i) => expect(s.startSec).toBe(segs[i].endSec));
  });
  it("正向：有分段清单时按清单时间切，文字按比例截取", () => {
    const segs = digitalHumanSpeechSegments("一二三四五六七八九十", 10, [{ index: 0, startSec: 0, endSec: 5 }, { index: 1, startSec: 5, endSec: 10 }]);
    expect(segs).toEqual([{ index: 0, startSec: 0, endSec: 5, text: "一二三四五" }, { index: 1, startSec: 5, endSec: 10, text: "六七八九十" }]);
    expect(digitalHumanSegmentAt(segs, 5)?.index).toBe(1);
    expect(digitalHumanSegmentAt(segs, 10)?.index).toBe(1);
  });
  it("反向：没有批准时长时不给口播段", () => {
    expect(digitalHumanSpeechSegments("一句话", 0)).toEqual([]);
    expect(digitalHumanSpeechSegments("一句话", Number.NaN)).toEqual([]);
  });
});

describe("覆盖轨空档", () => {
  const segs = digitalHumanSpeechSegments("一二三四五六七八九十", 10, [{ index: 0, startSec: 0, endSec: 5 }, { index: 1, startSec: 5, endSec: 10 }]);
  it("正向：空闲区间按口播段切开，并给出段号", () => {
    expect(digitalHumanOverlayGaps([row(A, 2, 2)], segs, 10)).toEqual([
      { startSec: 0, endSec: 2, segmentIndex: 0 }, { startSec: 4, endSec: 5, segmentIndex: 0 }, { startSec: 5, endSec: 10, segmentIndex: 1 },
    ]);
    expect(digitalHumanOverlayTargetSec({ startSec: 4, endSec: 5 })).toBe(1);
    expect(digitalHumanOverlayTargetSec()).toBe(4);
  });
  it("反向：短于最短覆盖时长的缝隙不给入口；占满时没有空档", () => {
    expect(digitalHumanOverlayGaps([row(A, 0.3, 9.7)], segs, 10)).toEqual([]);
    expect(digitalHumanOverlayGaps([row(A, 0, 5), row(A, 5, 5)], segs, 10)).toEqual([]);
  });
});

describe("抽屉采用写入覆盖条目", () => {
  it("正向：视频裁点写入 sourceInSec 与 durationSec，从所选空档起放", () => {
    const r = digitalHumanOverlayFromPick([row(A, 0, 2)], { asset: video(B), inSec: 3.5, outSec: 6.5 }, 10, 4);
    expect(r).toMatchObject({ assetId: B, startSec: 4, durationSec: 3, sourceInSec: 3.5, mode: "overlay", kind: "video", sourceDurationSec: 12 });
    expect(digitalHumanOverlayIssues([row(A, 0, 2), r], 10, () => ({ kind: "video" as const, durationSec: 12 }))).toEqual([]);
  });
  it("正向：空档不够时收缩覆盖时长、入点不动；首选位置被占时顺延到下一个空档", () => {
    const r = digitalHumanOverlayFromPick([row(A, 0, 2), row(A, 4, 6)], { asset: video(B), inSec: 1, outSec: 6 }, 10, 0.5);
    expect(r).toMatchObject({ startSec: 2, durationSec: 2, sourceInSec: 1 });
  });
  it("正向：照片保持原规则（固定展示时长、入点 0），忽略抽屉给的出点", () => {
    const r = digitalHumanOverlayFromPick([], { asset: photo(), inSec: 0, outSec: 7 }, 10, 1);
    expect(r).toMatchObject({ kind: "photo", startSec: 1, durationSec: 3, sourceInSec: 0 });
    expect(r.sourceDurationSec).toBeUndefined();
  });
  it("反向：用途不符、参考图用法、未批准配音、片段过短、出点越过素材、没有空档", () => {
    expect(() => digitalHumanOverlayFromPick([], { asset: { ...video(), purpose: "mv" }, inSec: 0, outSec: 3 }, 10)).toThrow("数字人补充画面");
    expect(() => digitalHumanOverlayFromPick([], { asset: { ...video(), usage: "reference" }, inSec: 0, outSec: 3 }, 10)).toThrow("可入片");
    expect(() => digitalHumanOverlayFromPick([], { asset: video(), inSec: 0, outSec: 3 }, 0)).toThrow("批准");
    expect(() => digitalHumanOverlayFromPick([], { asset: video(), inSec: 2, outSec: 2.2 }, 10)).toThrow("短于");
    // 出点越过素材长度时夹到素材末尾，选段不超素材
    const clipped = digitalHumanOverlayFromPick([], { asset: video(A, 5), inSec: 3, outSec: 9 }, 10);
    expect(clipped.sourceInSec + clipped.durationSec).toBeLessThanOrEqual(5);
    expect(() => digitalHumanOverlayFromPick([row(A, 0, 10)], { asset: video(B), inSec: 0, outSec: 3 }, 10)).toThrow("没有足够空档");
  });
});
