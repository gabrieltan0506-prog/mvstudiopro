import { describe, expect, expectTypeOf, it } from "vitest";
import {
  MANHUA_TOOLBAR_ACTION_COST,
  MANHUA_TOOLBAR_SPEND_ACTIONS,
  manhuaToolbarActionCost,
  type ManhuaToolbarAction,
} from "./manhuaToolbarGroups";

describe("工具条动作成本分组", () => {
  it("登记当前七个真实调用动作，并准确区分生成与无消耗操作", () => {
    expect(MANHUA_TOOLBAR_ACTION_COST).toEqual({
      "generate-all-keyarts": "spend",
      "review-clip-prompts": "free",
      "generate-fragment": "spend",
      "layout-readable-chain": "free",
      "generate-selected-fragments": "spend",
      "generate-missing-fragments": "spend",
      "rerun-keyarts": "spend",
    });
  });

  it("所选成片与重出全部分镜必须判为生成动作 —— 上一版漏了这两个", () => {
    // generate-selected-fragments 调 onGenerateMissingFragments(...)
    // rerun-keyarts 调 onRerunKeyartsFromReverse()
    expect(manhuaToolbarActionCost("generate-selected-fragments")).toBe("spend");
    expect(manhuaToolbarActionCost("rerun-keyarts")).toBe("spend");
  });

  it("排版与审阅类不花钱", () => {
    expect(manhuaToolbarActionCost("layout-readable-chain")).toBe("free");
    expect(manhuaToolbarActionCost("review-clip-prompts")).toBe("free");
  });

  it("派生列表只含 spend 且无重复，不再手写第二份名单", () => {
    const expected = Object.entries(MANHUA_TOOLBAR_ACTION_COST)
      .filter(([, cost]) => cost === "spend")
      .map(([action]) => action);
    expect(MANHUA_TOOLBAR_SPEND_ACTIONS).toEqual(expected);
    expect(new Set(MANHUA_TOOLBAR_SPEND_ACTIONS).size).toBe(
      MANHUA_TOOLBAR_SPEND_ACTIONS.length,
    );
  });

  it("入参受封闭联合类型约束 —— 新增按钮不登记就编译不过，堵死静默漏标", () => {
    expectTypeOf<Parameters<typeof manhuaToolbarActionCost>[0]>().toEqualTypeOf<ManhuaToolbarAction>();
  });
});
