import { describe, expect, it } from "vitest";
import { formatManhuaTemplateNativeBeatZh } from "./manhuaTemplateNativeBeat";

const base = { atSec: 0, conflictZh: "c", visualZh: "v" };

describe("formatManhuaTemplateNativeBeatZh", () => {
  it("六栏齐全时按固定顺序拼", () => {
    expect(
      formatManhuaTemplateNativeBeatZh({
        ...base,
        endSec: 3,
        shotSizeZh: "特写",
        angleZh: "平视",
        cameraMoveZh: "固定机位",
        lightingZh: "冷光",
        transitionInZh: "硬切",
      }),
    ).toBe("结束 3s · 景别 特写 · 机位 平视 · 运镜 固定机位 · 光影 冷光 · 转场 硬切");
  });

  it("部分为空时不留多余分隔符，也不出现 undefined", () => {
    const out = formatManhuaTemplateNativeBeatZh({
      ...base,
      shotSizeZh: "全景",
      transitionInZh: "闪白",
    });
    expect(out).toBe("景别 全景 · 转场 闪白");
    expect(out).not.toContain("undefined");
    expect(out).not.toContain(" ·  · ");
  });

  it("endSec=0 要显示（0 是合法秒位，不能被 falsy 吞掉）", () => {
    expect(formatManhuaTemplateNativeBeatZh({ ...base, endSec: 0 })).toBe("结束 0s");
  });

  it("抽帧旧卡（无任何六栏）返回空串", () => {
    expect(formatManhuaTemplateNativeBeatZh(base)).toBe("");
  });
});
