import { describe, expect, it } from "vitest";
import { resolveSceneClipDurationSec } from "./renderUtils";

describe("合成镜长绑真实裁切（0910）", () => {
  it("无裁切窗：探到真实时长就用真实值，探不到退回声明值", () => {
    expect(resolveSceneClipDurationSec({ trimInSec: undefined, trimOutSec: undefined, declaredDurationSec: 30, probedDurationSec: 29.72 })).toEqual({ clipDur: 29.72, hasTrim: false, trimIn: 0 });
    expect(resolveSceneClipDurationSec({ trimInSec: null, trimOutSec: null, declaredDurationSec: 30, probedDurationSec: null })).toEqual({ clipDur: 30, hasTrim: false, trimIn: 0 });
  });
  it("有裁切窗：窗口长度，但裁到片尾以外的部分按真实长度封顶", () => {
    expect(resolveSceneClipDurationSec({ trimInSec: 2, trimOutSec: 12, declaredDurationSec: 30, probedDurationSec: 29.5 })).toEqual({ clipDur: 10, hasTrim: true, trimIn: 2 });
    expect(resolveSceneClipDurationSec({ trimInSec: 25, trimOutSec: 32, declaredDurationSec: 30, probedDurationSec: 29.5 })).toEqual({ clipDur: 4.5, hasTrim: true, trimIn: 25 });
    // 窗口不足 0.5 s 视为无裁切
    expect(resolveSceneClipDurationSec({ trimInSec: 3, trimOutSec: 3.2, declaredDurationSec: 8, probedDurationSec: 7.9 }).hasTrim).toBe(false);
  });
});
