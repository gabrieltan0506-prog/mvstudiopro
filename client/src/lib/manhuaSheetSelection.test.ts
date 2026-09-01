import { describe, expect, it } from "vitest";
import {
  countManhuaSheetSelectionByKind,
  isManhuaCustomSheetId,
  isManhuaSheetSectionAllSelected,
  manhuaCustomSheetRefId,
  pruneManhuaSheetSelection,
  resolveManhuaSheetBatchRegen,
  resolveManhuaSheetCustomRefIds,
  selectedManhuaSheetItems,
  setManhuaSheetSectionSelection,
  toggleManhuaSheetSelection,
  type ManhuaSheetSelectionItem,
} from "./manhuaSheetSelection";

const items: ManhuaSheetSelectionItem[] = [
  { id: "charsheet-hero", kind: "charsheet", anchorId: "hero" },
  { id: "charsheet-face-hero-2", kind: "charsheet", anchorId: "hero" },
  { id: "charsheet-villain", kind: "charsheet", anchorId: "villain" },
  { id: "sceneplate-alley", kind: "sceneplate", anchorId: "alley" },
  { id: "charsheet-custom-ref9", kind: "charsheet" },
];

describe("设定图多选集合", () => {
  it("单勾来回切", () => {
    const a = toggleManhuaSheetSelection(new Set(), "charsheet-hero");
    expect(Array.from(a)).toEqual(["charsheet-hero"]);
    expect(toggleManhuaSheetSelection(a, "charsheet-hero").size).toBe(0);
  });

  it("全选本区不碰别区的勾 —— 先选人物再去场景，不许把前面清了", () => {
    const start = new Set(["sceneplate-alley"]);
    const next = setManhuaSheetSectionSelection(start, ["charsheet-hero", "charsheet-villain"], true);
    expect(next.has("sceneplate-alley")).toBe(true);
    expect(next.size).toBe(3);
    const off = setManhuaSheetSectionSelection(next, ["charsheet-hero", "charsheet-villain"], false);
    expect(Array.from(off)).toEqual(["sceneplate-alley"]);
  });

  it("本区全选判定：空区不算全选", () => {
    const sel = new Set(["charsheet-hero", "charsheet-villain"]);
    expect(isManhuaSheetSectionAllSelected(sel, ["charsheet-hero", "charsheet-villain"])).toBe(true);
    expect(isManhuaSheetSectionAllSelected(sel, ["charsheet-hero", "charsheet-face-hero-2"])).toBe(false);
    expect(isManhuaSheetSectionAllSelected(sel, [])).toBe(false);
  });

  it("跨类计数按 kind 分开报", () => {
    const sel = new Set(["charsheet-hero", "charsheet-villain", "sceneplate-alley"]);
    expect(countManhuaSheetSelectionByKind(items, sel)).toEqual({ charsheet: 2, sceneplate: 1 });
  });

  it("图删掉后清幽灵勾 —— 否则「已选 3 项」实际只剩 1 张", () => {
    const sel = new Set(["charsheet-hero", "charsheet-gone", "sceneplate-alley"]);
    const pruned = pruneManhuaSheetSelection(sel, items);
    expect(pruned.size).toBe(2);
    expect(pruned.has("charsheet-gone")).toBe(false);
    expect(selectedManhuaSheetItems(items, pruned).map((x) => x.id)).toEqual([
      "charsheet-hero",
      "sceneplate-alley",
    ]);
  });

  it("认得出自传参考图的画廊 id 并还原 refId", () => {
    expect(isManhuaCustomSheetId("charsheet-custom-ref9")).toBe(true);
    expect(isManhuaCustomSheetId("charsheet-hero")).toBe(false);
    expect(manhuaCustomSheetRefId("sceneplate-custom-a-b-c")).toBe("a-b-c");
    expect(manhuaCustomSheetRefId("sceneplate-alley")).toBeNull();
  });
});

describe("批量重出可行性", () => {
  it("同类多张：锚点去重后送出（同一人的两张定妆只重出一次）", () => {
    const plan = resolveManhuaSheetBatchRegen(
      items,
      new Set(["charsheet-hero", "charsheet-face-hero-2", "charsheet-villain"]),
    );
    expect(plan.blockedReasonZh).toBeNull();
    expect(plan.kind).toBe("charsheet");
    expect(plan.anchorIds).toEqual(["hero", "villain"]);
  });

  it("跨类混选拦下来说清楚，不许偷偷只重出一类", () => {
    const plan = resolveManhuaSheetBatchRegen(items, new Set(["charsheet-hero", "sceneplate-alley"]));
    expect(plan.anchorIds).toEqual([]);
    expect(plan.blockedReasonZh).toContain("同一类");
  });

  it("只选了自传参考图 —— 系统不覆盖用户素材", () => {
    const plan = resolveManhuaSheetBatchRegen(items, new Set(["charsheet-custom-ref9"]));
    expect(plan.anchorIds).toEqual([]);
    expect(plan.blockedReasonZh).toContain("自传");
  });

  it("自传图混进同类选择时整体拦下（0830 改口径：不再静默剔除后重出剩下的）", () => {
    // 旧行为是「剔掉自传图、剩下的照常重出」——用户以为 N 张都在重画，
    // 扣费与结果对不上（审查 P1）。现在与跨类混选同一口径：拦下并说清。
    const plan = resolveManhuaSheetBatchRegen(
      [
        { id: "charsheet-c1", kind: "charsheet", anchorId: "c1" },
        { id: "charsheet-custom-r1", kind: "charsheet", anchorId: undefined },
      ],
      new Set(["charsheet-c1", "charsheet-custom-r1"]),
    );
    expect(plan.anchorIds).toEqual([]);
    expect(plan.blockedReasonZh).toContain("自己上传");
  });

  it("没勾任何东西", () => {
    expect(resolveManhuaSheetBatchRegen(items, new Set()).blockedReasonZh).toBe("尚未勾选");
  });
});

describe("改分类 / 设垫图用途的可行边界", () => {
  it("全是自传图才给这两个动作", () => {
    const ok = resolveManhuaSheetCustomRefIds(items, new Set(["charsheet-custom-ref9"]));
    expect(ok.allCustom).toBe(true);
    expect(ok.refIds).toEqual(["ref9"]);
  });

  it("混选时不给 —— 点了只对一半生效比少一个按钮更糟", () => {
    const mixed = resolveManhuaSheetCustomRefIds(
      items,
      new Set(["charsheet-custom-ref9", "charsheet-hero"]),
    );
    expect(mixed.allCustom).toBe(false);
  });

  it("空选不给", () => {
    expect(resolveManhuaSheetCustomRefIds(items, new Set()).allCustom).toBe(false);
  });
});

describe("批量重出的混选拦截（审查 P1 修正）", () => {
  const items = [
    { id: "charsheet-c1", kind: "charsheet" as const, anchorId: "c1" },
    { id: "charsheet-c2", kind: "charsheet" as const, anchorId: "c2" },
    { id: "charsheet-custom-r9", kind: "charsheet" as const, anchorId: undefined },
  ];

  it("自传图与系统图混选时必须拦下并说清跳过几张，不许静默只重出系统那部分", () => {
    const plan = resolveManhuaSheetBatchRegen(
      items,
      new Set(["charsheet-c1", "charsheet-c2", "charsheet-custom-r9"]),
    );
    expect(plan.anchorIds).toEqual([]);
    expect(plan.blockedReasonZh).toContain("1 张");
    expect(plan.blockedReasonZh).toContain("自己上传");
  });

  it("全是系统图时照常放行", () => {
    const plan = resolveManhuaSheetBatchRegen(
      items,
      new Set(["charsheet-c1", "charsheet-c2"]),
    );
    expect(plan.anchorIds).toEqual(["c1", "c2"]);
    expect(plan.blockedReasonZh).toBeNull();
  });

  it("全是自传图时给的是「不覆盖自传素材」而不是混选文案", () => {
    const plan = resolveManhuaSheetBatchRegen(items, new Set(["charsheet-custom-r9"]));
    expect(plan.anchorIds).toEqual([]);
    expect(plan.blockedReasonZh).toContain("系统不覆盖自传素材");
  });
});

