import { describe, expect, it } from "vitest";
import {
  shouldShowToolbarAssetWallEntry,
  shouldShowToolbarCharacterLibraryEntry,
} from "./manhuaCharacterEntry";

describe("角色库入口去重", () => {
  it("资产阶段有就近入口，工具条那个让位 —— 同屏不出现两个同去处的按钮", () => {
    expect(
      shouldShowToolbarCharacterLibraryEntry({ activePhase: "assets", compactUi: false }),
    ).toBe(false);
  });

  it("分镜与剪辑阶段没有就近入口，工具条必须留着 —— 删了就没通路了", () => {
    for (const phase of ["storyboard", "edit", "final", "outline"]) {
      expect(shouldShowToolbarCharacterLibraryEntry({ activePhase: phase, compactUi: false })).toBe(
        true,
      );
    }
  });

  it("简洁模式下工具条本就收起低频控件，不受阶段影响", () => {
    for (const phase of ["assets", "storyboard", "edit"]) {
      expect(shouldShowToolbarCharacterLibraryEntry({ activePhase: phase, compactUi: true })).toBe(
        false,
      );
    }
  });
});

describe("资产墙入口去重", () => {
  it("与角色库共用同一条判据 —— 两处各写一份，下次改规则必漏一处", () => {
    expect(shouldShowToolbarAssetWallEntry).toBe(shouldShowToolbarCharacterLibraryEntry);
  });

  it("资产阶段让位（那里已有 5 个就近入口），其它阶段留着", () => {
    expect(shouldShowToolbarAssetWallEntry({ activePhase: "assets", compactUi: false })).toBe(false);
    expect(shouldShowToolbarAssetWallEntry({ activePhase: "edit", compactUi: false })).toBe(true);
  });
});
