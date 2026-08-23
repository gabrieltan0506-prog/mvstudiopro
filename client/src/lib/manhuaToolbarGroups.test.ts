import { describe, expect, it } from "vitest";
import {
  MANHUA_TOOLBAR_SPEND_ACTIONS,
  manhuaToolbarActionCost,
} from "./manhuaToolbarGroups";

describe("花钱动作分组", () => {
  it("五个生成类动作一律判为花钱 —— 它们不该和排版按钮混在一起", () => {
    for (const a of MANHUA_TOOLBAR_SPEND_ACTIONS) {
      expect(manhuaToolbarActionCost(a)).toBe("spend");
    }
  });

  it("排版、导演板、开关类不花钱", () => {
    for (const a of [
      "layout-readable-chain",
      "copy-director-board-prompt",
      "clear-director-board",
      "shot-continuity",
      "resume-from-failure",
    ]) {
      expect(manhuaToolbarActionCost(a)).toBe("free");
    }
  });

  it("未知动作按不花钱处理 —— 但新增花钱动作必须显式登记进名单", () => {
    expect(manhuaToolbarActionCost("brand-new-thing")).toBe("free");
  });

  it("名单不为空且不含重复 —— 漏登记一个就等于把花钱按钮混进无害那堆", () => {
    expect(MANHUA_TOOLBAR_SPEND_ACTIONS.length).toBeGreaterThan(0);
    expect(new Set(MANHUA_TOOLBAR_SPEND_ACTIONS).size).toBe(
      MANHUA_TOOLBAR_SPEND_ACTIONS.length,
    );
  });
});
