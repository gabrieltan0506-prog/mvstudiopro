import { describe, expect, it } from "vitest";
import { STOCK_TRIM_MIN_SEC, clampStockTrim, stockTrimToFrames } from "./stockFootageTrim";

describe("clampStockTrim", () => {
  // 正向
  it("窗口默认等于镜头时长，入点默认 0", () => {
    expect(clampStockTrim({ sourceSec: 12, targetSec: 4 })).toEqual({ inSec: 0, outSec: 4, shortBySec: 0 });
  });
  it("指定入点时保持窗口长度", () => {
    expect(clampStockTrim({ sourceSec: 12, targetSec: 4, inSec: 3.25 })).toEqual({ inSec: 3.25, outSec: 7.25, shortBySec: 0 });
  });
  it("未给目标时长时窗口为整段素材", () => {
    expect(clampStockTrim({ sourceSec: 9.5 })).toEqual({ inSec: 0, outSec: 9.5, shortBySec: 0 });
  });

  // 边界
  it("入点恰好在最后一个可用位置", () => {
    expect(clampStockTrim({ sourceSec: 10, targetSec: 4, inSec: 6 })).toEqual({ inSec: 6, outSec: 10, shortBySec: 0 });
  });
  it("素材时长恰好等于目标", () => {
    expect(clampStockTrim({ sourceSec: 5, targetSec: 5, inSec: 1 })).toEqual({ inSec: 0, outSec: 5, shortBySec: 0 });
  });
  it("目标短于最短窗口时按最短窗口", () => {
    expect(clampStockTrim({ sourceSec: 10, targetSec: 0.1 })).toEqual({ inSec: 0, outSec: STOCK_TRIM_MIN_SEC, shortBySec: 0 });
    expect(clampStockTrim({ sourceSec: 10, targetSec: 1, minSec: 2 })).toEqual({ inSec: 0, outSec: 2, shortBySec: 0 });
  });
  it("最短窗口不会超过素材本身", () => {
    expect(clampStockTrim({ sourceSec: 0.3, targetSec: 0.1, minSec: 1 })).toEqual({ inSec: 0, outSec: 0.3, shortBySec: 0 });
  });
  it("浮点时长不会把出点推到素材末尾之外", () => {
    const r = clampStockTrim({ sourceSec: 4.999, targetSec: 4.999, inSec: 0.7 });
    expect(r.outSec).toBeLessThanOrEqual(4.999);
    expect(r.inSec).toBe(0);
  });

  // 反向
  it("素材短于目标：窗口为整段素材并报告短了多少秒", () => {
    expect(clampStockTrim({ sourceSec: 3.5, targetSec: 5, inSec: 1 })).toEqual({ inSec: 0, outSec: 3.5, shortBySec: 1.5 });
  });
  it("入点越界（超过末尾/负数/非数字）夹回合法范围", () => {
    expect(clampStockTrim({ sourceSec: 10, targetSec: 4, inSec: 99 })).toEqual({ inSec: 6, outSec: 10, shortBySec: 0 });
    expect(clampStockTrim({ sourceSec: 10, targetSec: 4, inSec: -3 })).toEqual({ inSec: 0, outSec: 4, shortBySec: 0 });
    expect(clampStockTrim({ sourceSec: 10, targetSec: 4, inSec: Number.NaN })).toEqual({ inSec: 0, outSec: 4, shortBySec: 0 });
  });
  it("照片/无时长素材：没有可裁时间轴，只报告短缺", () => {
    expect(clampStockTrim({ sourceSec: 0, targetSec: 3 })).toEqual({ inSec: 0, outSec: 0, shortBySec: 3 });
    expect(clampStockTrim({ sourceSec: Number.NaN, targetSec: 3, inSec: 2 })).toEqual({ inSec: 0, outSec: 0, shortBySec: 3 });
    expect(clampStockTrim({ sourceSec: -1 })).toEqual({ inSec: 0, outSec: 0, shortBySec: 0 });
  });
  it("非法目标时长被忽略，窗口退回整段素材", () => {
    expect(clampStockTrim({ sourceSec: 6, targetSec: -2 })).toEqual({ inSec: 0, outSec: 6, shortBySec: 0 });
    expect(clampStockTrim({ sourceSec: 6, targetSec: Number.POSITIVE_INFINITY })).toEqual({ inSec: 0, outSec: 6, shortBySec: 0 });
  });
});

describe("stockTrimToFrames", () => {
  // 正向
  it("默认 30fps 换算", () => {
    expect(stockTrimToFrames({ inSec: 2, outSec: 6 })).toEqual({ sourceInFrame: 60, durationFrames: 120 });
  });
  it("自定义 fps", () => {
    expect(stockTrimToFrames({ inSec: 1, outSec: 3 }, 24)).toEqual({ sourceInFrame: 24, durationFrames: 48 });
  });
  it("三分之一秒等浮点值不会少算一帧", () => {
    expect(stockTrimToFrames({ inSec: 1 / 3, outSec: 1 / 3 + 2 })).toEqual({ sourceInFrame: 10, durationFrames: 60 });
  });

  // 边界：向下取整不越界
  it("非整帧入点/出点向下取整，结束帧不超过 floor(出点×fps)", () => {
    const trim = { inSec: 0.02, outSec: 4.999 };
    const f = stockTrimToFrames(trim);
    expect(f.sourceInFrame).toBe(0);
    expect(f.sourceInFrame + f.durationFrames).toBe(Math.floor(4.999 * 30));
    expect((f.sourceInFrame + f.durationFrames) / 30).toBeLessThanOrEqual(trim.outSec);
  });
  it("与 clampStockTrim 串联时整段素材结尾帧不越界", () => {
    for (const sourceSec of [3.3333, 4.999, 7.01, 12.345, 29.97]) {
      const trim = clampStockTrim({ sourceSec, targetSec: 5, inSec: 100 });
      const f = stockTrimToFrames(trim, 30);
      expect((f.sourceInFrame + f.durationFrames) / 30).toBeLessThanOrEqual(sourceSec);
      expect(f.durationFrames).toBeGreaterThan(0);
    }
  });

  // 反向
  it("出点早于入点、负数、非数字一律得 0 帧而不是负数", () => {
    expect(stockTrimToFrames({ inSec: 5, outSec: 2 })).toEqual({ sourceInFrame: 150, durationFrames: 0 });
    expect(stockTrimToFrames({ inSec: -1, outSec: 1 })).toEqual({ sourceInFrame: 0, durationFrames: 30 });
    expect(stockTrimToFrames({ inSec: Number.NaN, outSec: Number.NaN })).toEqual({ sourceInFrame: 0, durationFrames: 0 });
  });
  it("非法 fps 退回 30", () => {
    expect(stockTrimToFrames({ inSec: 1, outSec: 2 }, 0)).toEqual({ sourceInFrame: 30, durationFrames: 30 });
    expect(stockTrimToFrames({ inSec: 1, outSec: 2 }, Number.NaN)).toEqual({ sourceInFrame: 30, durationFrames: 30 });
  });
});
