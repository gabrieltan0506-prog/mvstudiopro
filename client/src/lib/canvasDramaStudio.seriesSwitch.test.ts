import { describe, expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { stripManhuaSeriesAssetsForNewProject } from "./canvasDramaStudio";

describe("stripManhuaSeriesAssetsForNewProject", () => {
  it("removes charsheet/sceneplate/propsheet but keeps free nodes", () => {
    const sheet = defaultCanvasBlock("image", 0, 0);
    sheet.id = "charsheet-a";
    sheet.outputUrl = "https://example.com/a.jpg";
    const free = defaultCanvasBlock("image", 100, 0);
    free.id = "free-note";
    const { blocks, removedCount } = stripManhuaSeriesAssetsForNewProject(
      [sheet, free],
      [{ fromId: "charsheet-a", toId: "free-note" }],
    );
    expect(removedCount).toBe(1);
    expect(blocks.map((b) => b.id)).toEqual(["free-note"]);
  });
});
