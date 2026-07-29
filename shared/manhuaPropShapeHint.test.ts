import { describe, expect, it } from "vitest";
import {
  formatManhuaPropShapeHintLineZh,
  MANHUA_PROP_SHAPE_HINT_MAX,
  normalizeManhuaPropShapeHintZh,
} from "./manhuaPropShapeHint";

describe("manhuaPropShapeHint", () => {
  it("留下可核对的外形句，去掉编号与引号", () => {
    expect(
      normalizeManhuaPropShapeHintZh("1. 「细长微弯的窄板，上端略宽、下端稍收，两面打磨光润」"),
    ).toBe("细长微弯的窄板，上端略宽、下端稍收，两面打磨光润。");
  });

  it("查不到（UNKNOWN）就不给形制", () => {
    expect(normalizeManhuaPropShapeHintZh("UNKNOWN")).toBe("");
    expect(normalizeManhuaPropShapeHintZh("unknown · 无法确认此物")).toBe("");
    expect(normalizeManhuaPropShapeHintZh("")).toBe("");
  });

  it("模型自己没把握的（可能/推测/据说）一律丢弃", () => {
    expect(normalizeManhuaPropShapeHintZh("可能是一块细长的玉板，长度大概一尺")).toBe("");
    expect(normalizeManhuaPropShapeHintZh("据说形似狭长的手板，未证实")).toBe("");
  });

  it("混进叙事或元指令的整句丢弃（那是烧字与跑偏的来源）", () => {
    expect(normalizeManhuaPropShapeHintZh("表面留白，不要写字")).toBe("");
    expect(normalizeManhuaPropShapeHintZh("象征父辈仇恨的剧作功能道具")).toBe("");
    expect(normalizeManhuaPropShapeHintZh("笏板上题名清晰可辨")).toBe("");
  });

  it("超长截到句末，且始终以句号收尾", () => {
    const long = `${"细长微弯的象牙板，表面可见细密直纹，边缘打磨圆润，".repeat(8)}末尾`;
    const out = normalizeManhuaPropShapeHintZh(long);
    expect(out.length).toBeLessThanOrEqual(MANHUA_PROP_SHAPE_HINT_MAX + 1);
    expect(out.endsWith("。")).toBe(true);
  });

  it("成行时带上「按实物来画」；没形制就不出这一行", () => {
    expect(formatManhuaPropShapeHintLineZh("细长微弯的窄板，两面素净")).toBe(
      "实物形制（按实物来画，不要凭想象改形状）：细长微弯的窄板，两面素净。",
    );
    expect(formatManhuaPropShapeHintLineZh("UNKNOWN")).toBe("");
  });
});
