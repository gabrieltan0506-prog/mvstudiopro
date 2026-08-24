/**
 * 变体 structure 往返回归。
 *
 * 上一版把 structure 读没了，卡点表因此零调用、贴装退回单一音量——
 * 而且不报错。这条测试就是钉住「六字段不能丢」。
 */
import { describe, expect, it } from "vitest";
import { readManhuaBgmVariants } from "./manhuaBgmCardState";

const structure = {
  strongestAtSec: 8,
  strongestPeakDb: -0.4,
  valleyAtSec: 14,
  valleyMeanDb: -28,
  decayStartSec: 26,
  totalSec: 30,
};

describe("readManhuaBgmVariants · structure 六字段", () => {
  it("往返后六个字段全部保留", () => {
    const out = readManhuaBgmVariants({
      variants: [{ index: 0, gcsUri: "gs://b/a.mp3", previewUrl: "https://x", bytes: 10, structure }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.structure).toEqual(structure);
  });

  it("缺一个字段就整份判 null，不硬凑（凑出来的卡点表会全盘错位）", () => {
    const { totalSec: _drop, ...missing } = structure;
    const out = readManhuaBgmVariants({
      variants: [{ index: 0, gcsUri: "gs://b/a.mp3", bytes: 1, structure: missing }],
    });
    expect(out[0]!.structure).toBeNull();
  });

  it("没量到结构时是 null，不是 undefined，调用方一律显式判", () => {
    const out = readManhuaBgmVariants({
      variants: [{ index: 0, gcsUri: "gs://b/a.mp3", bytes: 1 }],
    });
    expect(out[0]!.structure).toBeNull();
  });
});
