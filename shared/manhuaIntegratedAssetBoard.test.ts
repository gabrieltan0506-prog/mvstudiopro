import { describe, expect, it } from "vitest";
import { buildManhuaIntegratedAssetBoard } from "./manhuaIntegratedAssetBoard";

describe("manhuaIntegratedAssetBoard", () => {
  it("builds board from character + scene", () => {
    const board = buildManhuaIntegratedAssetBoard({
      characterIds: ["char_f_01"],
      sceneId: "scene_01",
      seriesTitle: "测试剧",
    });
    expect(board.titleZh).toContain("一体参考板");
    expect(board.characters.length).toBeGreaterThan(0);
    expect(board.scene?.id).toBe("scene_01");
    expect(board.injectSummaryZh).toContain("角色");
    expect(board.slots.some((s) => s.role === "hero")).toBe(true);
  });
});
