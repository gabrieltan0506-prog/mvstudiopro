import { describe, expect, it } from "vitest";
import {
  isManhuaAssetCardExpanded,
  shouldShowManhuaAssetFoldToggle,
  shouldShowManhuaAssetRoleChip,
} from "./manhuaAssetCardFold";

const base = { compactUi: true, expandedIds: new Set<string>(), id: "a" };

describe("资产卡折叠判据", () => {
  it("简洁模式下默认折叠 —— 一屏控件降下来靠的就是这条", () => {
    expect(isManhuaAssetCardExpanded(base)).toBe(false);
  });

  it("点开哪张展开哪张，不影响别的卡", () => {
    const expandedIds = new Set(["a"]);
    expect(isManhuaAssetCardExpanded({ ...base, expandedIds })).toBe(true);
    expect(isManhuaAssetCardExpanded({ ...base, expandedIds, id: "b" })).toBe(false);
  });

  it("关掉简洁模式＝用户要看全部，一律展开", () => {
    expect(isManhuaAssetCardExpanded({ ...base, compactUi: false })).toBe(true);
  });

  it("待人工确认强制展开 —— 收起来等于把问题藏了", () => {
    expect(isManhuaAssetCardExpanded({ ...base, needsReview: true })).toBe(true);
    // 即使用户没点开、简洁模式也开着
    expect(
      isManhuaAssetCardExpanded({ ...base, needsReview: true, expandedIds: new Set() }),
    ).toBe(true);
  });

  it("折叠时显示分类小标，展开时交给分类按钮组，不重复", () => {
    expect(shouldShowManhuaAssetRoleChip(false)).toBe(true);
    expect(shouldShowManhuaAssetRoleChip(true)).toBe(false);
  });
});

describe("非简洁模式的退路（0830 修正）", () => {
  const S = (...ids: string[]) => new Set(ids);

  it("非简洁模式默认展开", () => {
    expect(
      isManhuaAssetCardExpanded({ compactUi: false, expandedIds: S(), id: "a" }),
    ).toBe(true);
  });

  it("非简洁模式下用户收起的卡真的收起（旧口径是强制展开，收不回去）", () => {
    expect(
      isManhuaAssetCardExpanded({
        compactUi: false,
        expandedIds: S(),
        collapsedIds: S("a"),
        id: "a",
      }),
    ).toBe(false);
  });

  it("收起只作用于被点的那张，不影响别的卡", () => {
    expect(
      isManhuaAssetCardExpanded({
        compactUi: false,
        expandedIds: S(),
        collapsedIds: S("a"),
        id: "b",
      }),
    ).toBe(true);
  });

  it("待确认的卡在任何模式下都强制展开，且不给收起按钮", () => {
    expect(
      isManhuaAssetCardExpanded({
        compactUi: false,
        expandedIds: S(),
        collapsedIds: S("a"),
        id: "a",
        needsReview: true,
      }),
    ).toBe(true);
    expect(shouldShowManhuaAssetFoldToggle({ needsReview: true })).toBe(false);
  });

  it("非待确认的卡任何模式都要有折叠按钮——用户永远要有退路", () => {
    expect(shouldShowManhuaAssetFoldToggle({})).toBe(true);
    expect(shouldShowManhuaAssetFoldToggle({ needsReview: false })).toBe(true);
  });
});
