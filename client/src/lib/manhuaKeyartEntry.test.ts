import { describe, expect, it } from "vitest";
import { manhuaKeyartEntryVisible, pickManhuaKeyartEntry } from "./manhuaKeyartEntry";

describe("「生成关键静帧」唯一入口", () => {
  it("阶段主操作就是它时，工具条与分镜面板都不再画第二个", () => {
    const state = { stageCtaIsKeyart: true, panelNeedsKeyart: true };
    expect(pickManhuaKeyartEntry(state)).toBe("stage");
    expect(manhuaKeyartEntryVisible("toolbar", state)).toBe(false);
    expect(manhuaKeyartEntryVisible("panel", state)).toBe(false);
    expect(manhuaKeyartEntryVisible("stage", state)).toBe(true);
  });

  it("阶段主操作不是它、分镜面板正缺图时，入口归面板（就地补图）", () => {
    const state = { stageCtaIsKeyart: false, panelNeedsKeyart: true };
    expect(pickManhuaKeyartEntry(state)).toBe("panel");
    expect(manhuaKeyartEntryVisible("toolbar", state)).toBe(false);
  });

  it("两处都不承担时工具条兜底：任何状态下入口恰好一个，不会藏死", () => {
    for (const stageCtaIsKeyart of [true, false]) {
      for (const panelNeedsKeyart of [true, false]) {
        const state = { stageCtaIsKeyart, panelNeedsKeyart };
        const visible = (["stage", "panel", "toolbar"] as const).filter((at) =>
          manhuaKeyartEntryVisible(at, state),
        );
        expect(visible).toHaveLength(1);
      }
    }
    expect(pickManhuaKeyartEntry({ stageCtaIsKeyart: false, panelNeedsKeyart: false })).toBe("toolbar");
  });
});
