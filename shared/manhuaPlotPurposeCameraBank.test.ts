import { describe, expect, it } from "vitest";
import { enrichScriptContextWithBianDaoDirectorBoard } from "./bianDaoStoryboard.js";
import {
  getManhuaPlotPurposeById,
  getManhuaScenePacingById,
  MANHUA_PLOT_PURPOSE_BANK,
  MANHUA_SCENE_PACING_BANK,
} from "./manhuaPlotPurposeCameraBank.js";

describe("manhuaPlotPurposeCameraBank", () => {
  it("has 7 purposes and 8 pacing entries", () => {
    expect(MANHUA_PLOT_PURPOSE_BANK).toHaveLength(7);
    expect(MANHUA_SCENE_PACING_BANK).toHaveLength(8);
    expect(getManhuaPlotPurposeById("twist")?.nameZh).toBe("制造反转");
    expect(getManhuaScenePacingById("clue")?.timelineHintZh).toMatch(/3秒/);
  });

  it("enriches bianDao context idempotently", () => {
    const once = enrichScriptContextWithBianDaoDirectorBoard("分镜正文", {
      plotPurposeId: "suspense",
      scenePacingId: "mystery",
    });
    expect(once).toContain("【剧情目的·镜头】");
    expect(once).toContain("【戏种节奏】");
    expect(once).toContain("分镜正文");
    const twice = enrichScriptContextWithBianDaoDirectorBoard(once, {
      plotPurposeId: "suspense",
      scenePacingId: "mystery",
    });
    expect(twice.match(/【剧情目的·镜头】/g)?.length).toBe(1);
    expect(twice.match(/【戏种节奏】/g)?.length).toBe(1);
  });

  it("omits brand watermark wording", () => {
    for (const e of MANHUA_PLOT_PURPOSE_BANK) {
      expect(JSON.stringify(e)).not.toMatch(/元点/);
    }
  });
});
