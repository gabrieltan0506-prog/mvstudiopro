import { describe, expect, it } from "vitest";
import {
  computeDirectorBoardMainBox,
  computePropSheetGridBoxes,
} from "./manhuaPropSheetGrid.js";

describe("computePropSheetGridBoxes", () => {
  it("returns 8 boxes in left-to-right, top-to-bottom order for a 4x2 grid", () => {
    // 校准自真实拼板：雁门照山河 道具设定01/02，1672×941，4列×2行。
    const boxes = computePropSheetGridBoxes({
      imageWidth: 1672,
      imageHeight: 941,
      cols: 4,
      rows: 2,
    });
    expect(boxes).toHaveLength(8);
    expect(boxes.map((b) => `${b.row},${b.col}`)).toEqual([
      "0,0",
      "0,1",
      "0,2",
      "0,3",
      "1,0",
      "1,1",
      "1,2",
      "1,3",
    ]);
    // 顶部标题带（约 9.5%）被排除在网格外
    const topOffset = Math.round(941 * 0.095);
    expect(boxes[0]!.top).toBe(topOffset);
    // 4 列均分 1672，正好整除
    expect(boxes[0]!.width).toBe(418);
    expect(boxes[3]!.width).toBe(418);
    // 第二行紧接第一行的裁前高度（cellHeight），不是裁后高度
    const gridHeight = 941 - topOffset;
    const cellHeight = Math.floor(gridHeight / 2);
    expect(boxes[4]!.top).toBe(topOffset + cellHeight);
  });

  it("trims ~20% off the bottom of every cell to exclude the per-cell title band", () => {
    const withTrim = computePropSheetGridBoxes({
      imageWidth: 1672,
      imageHeight: 941,
      cols: 4,
      rows: 2,
      bottomTrimRatio: 0.2,
    });
    const noTrim = computePropSheetGridBoxes({
      imageWidth: 1672,
      imageHeight: 941,
      cols: 4,
      rows: 2,
      bottomTrimRatio: 0,
    });
    for (let i = 0; i < 8; i += 1) {
      expect(withTrim[i]!.height).toBeLessThan(noTrim[i]!.height);
      expect(withTrim[i]!.height).toBeCloseTo(noTrim[i]!.height * 0.8, 0);
      // 裁切只改高度，不改起点/宽度——顶部对齐不能变，否则会把格子往下推进标题区
      expect(withTrim[i]!.top).toBe(noTrim[i]!.top);
      expect(withTrim[i]!.left).toBe(noTrim[i]!.left);
      expect(withTrim[i]!.width).toBe(noTrim[i]!.width);
    }
  });

  it("boundary: bottomTrimRatio=0 keeps the full cell height (no crop)", () => {
    const boxes = computePropSheetGridBoxes({
      imageWidth: 800,
      imageHeight: 400,
      cols: 2,
      rows: 1,
      topBandRatio: 0,
      bottomTrimRatio: 0,
    });
    expect(boxes[0]).toMatchObject({ left: 0, top: 0, width: 400, height: 400 });
    expect(boxes[1]).toMatchObject({ left: 400, top: 0, width: 400, height: 400 });
  });

  it("boundary: bottomTrimRatio close to 1 still leaves at least 1px (never a zero-height box)", () => {
    const boxes = computePropSheetGridBoxes({
      imageWidth: 800,
      imageHeight: 400,
      cols: 2,
      rows: 1,
      topBandRatio: 0,
      bottomTrimRatio: 0.99,
    });
    expect(boxes[0]!.height).toBeGreaterThanOrEqual(1);
  });

  it("last column/row absorb the integer-division remainder so no pixel strip is left uncropped", () => {
    const boxes = computePropSheetGridBoxes({
      imageWidth: 101,
      imageHeight: 203,
      cols: 3,
      rows: 2,
      topBandRatio: 0,
      bottomTrimRatio: 0,
    });
    const totalWidthLastRow = boxes
      .filter((b) => b.row === 0)
      .reduce((sum, b) => sum + b.width, 0);
    expect(totalWidthLastRow).toBe(101);
    const lastRowBoxes = boxes.filter((b) => b.row === 1);
    for (const b of lastRowBoxes) {
      expect(b.top + b.height).toBe(203);
    }
  });

  it("clamps invalid/degenerate inputs instead of throwing", () => {
    const boxes = computePropSheetGridBoxes({
      imageWidth: 0,
      imageHeight: 0,
      cols: 0,
      rows: 0,
      topBandRatio: -5,
      bottomTrimRatio: 5,
    });
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.height).toBeGreaterThanOrEqual(1);
    expect(boxes[0]!.width).toBeGreaterThanOrEqual(1);
  });
});

describe("computeDirectorBoardMainBox", () => {
  it("crops the real board size (1672x941) down to 1291x670", () => {
    const box = computeDirectorBoardMainBox(1672, 941);
    expect(box).toEqual({ left: 0, top: 0, width: 1291, height: 670 });
  });

  it("scales proportionally for other sizes at the same source aspect ratio", () => {
    // 3344×1882 = 2× 原图；比例应与 1291×670 保持一致
    const box = computeDirectorBoardMainBox(3344, 1882);
    expect(box.left).toBe(0);
    expect(box.top).toBe(0);
    expect(box.width).toBe(Math.round(3344 * 0.772));
    expect(box.height).toBe(Math.round(1882 * 0.712));
    expect(box.width / box.height).toBeCloseTo(1291 / 670, 1);
  });

  it("applies the fixed crop ratios regardless of source aspect ratio", () => {
    const box = computeDirectorBoardMainBox(2000, 1000);
    expect(box.width).toBe(Math.round(2000 * 0.772));
    expect(box.height).toBe(Math.round(1000 * 0.712));
  });

  it("clamps degenerate inputs instead of throwing", () => {
    const box = computeDirectorBoardMainBox(0, 0);
    expect(box.width).toBeGreaterThanOrEqual(1);
    expect(box.height).toBeGreaterThanOrEqual(1);
  });
});
