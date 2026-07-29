import { describe, expect, it } from "vitest";
import {
  MANHUA_ASSET_REGEN_NOTE_MAX,
  appendManhuaAssetRegenNoteZh,
  manhuaAssetRegenPriceLabelZh,
  normalizeManhuaAssetRegenNoteZh,
  quoteManhuaAssetRegenCredits,
} from "./manhuaAssetRegenRequest";

describe("设定图重出请求", () => {
  it("改进描述规范化：去回车、压空格、限长", () => {
    expect(normalizeManhuaAssetRegenNoteZh("  账册封面\r\n有字，去掉  ")).toBe(
      "账册封面\n有字，去掉",
    );
    expect(normalizeManhuaAssetRegenNoteZh("字".repeat(600))).toHaveLength(
      MANHUA_ASSET_REGEN_NOTE_MAX,
    );
    expect(normalizeManhuaAssetRegenNoteZh(null)).toBe("");
  });

  it("修订段接在提示词尾部，并明说其余设定不变", () => {
    const out = appendManhuaAssetRegenNoteZh("原始提示词：一册旧账簿", "封面刻字全部去掉");
    // 尾部压前面：用户点名的毛病要能改掉
    expect(out.indexOf("封面刻字全部去掉")).toBeGreaterThan(out.indexOf("原始提示词"));
    expect(out).toContain("必须改掉");
    // 别顺手重画脸和服装——锁了半天的 ID 不能再漂
    expect(out).toContain("其余人物身份、五官、体型、服装配色、场景与画风一律保持不变");
  });

  it("没写描述就不动原提示词", () => {
    expect(appendManhuaAssetRegenNoteZh("原始提示词", "   ")).toBe("原始提示词");
  });

  it("重出按库内资产同档价：1 张 15、2 张 20、超出每张 +5", () => {
    expect(quoteManhuaAssetRegenCredits(1)).toBe(15);
    expect(quoteManhuaAssetRegenCredits(2)).toBe(20);
    expect(quoteManhuaAssetRegenCredits(3)).toBe(25);
    expect(quoteManhuaAssetRegenCredits(6)).toBe(40);
    // 不给 0 或负数留后门
    expect(quoteManhuaAssetRegenCredits(0)).toBe(15);
  });

  it("报价文案区分两条路", () => {
    expect(manhuaAssetRegenPriceLabelZh(2, "redraw")).toBe("20 积分（重出 · 2 张）");
    expect(manhuaAssetRegenPriceLabelZh(2, "library")).toBe("20 积分（用库内资产 · 2 张）");
  });
});
