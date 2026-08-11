import { describe, expect, it } from "vitest";
import {
  buildStoryboardCellsFromStepScript,
  formatPlatformStoryboardCellsMarkdown,
  formatPlatformStoryboardCellsSixColumnText,
  normalizePlatformStoryboardCells,
} from "./platformStoryboardCells";

describe("platformStoryboardCells", () => {
  it("归一：坏行丢弃、镜号重排、别名字段兼容", () => {
    const cells = normalizePlatformStoryboardCells([
      { cellIndex: 5, dialogue: "你梳头掉的不是头发", scene: "浴室镜前", framing: "特写", cameraMovement: "缓推" },
      { cellIndex: "bad" },
      null,
      { dialogueZh: "", actionZh: "", sceneZh: "", shotSize: "" },
      { cellIndex: 2, actionZh: "摊开手掌比数字", shotSize: "中景" },
    ]);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({
      cellIndex: 1,
      dialogueZh: "你梳头掉的不是头发",
      sceneZh: "浴室镜前",
      shotSize: "特写",
      cameraMoveZh: "缓推",
    });
    expect(cells[1]!.cellIndex).toBe(2);
  });

  it("stepByStepScript 降级拆镜：抽出景别/运镜/台词", () => {
    const cells = buildStoryboardCellsFromStepScript([
      "【0-3秒】钩子｜特写｜缓推：你梳头掉的不是头发，是胶原蛋白",
      "【3-8秒】数据浮层｜中景｜固定：每天 50-100 根都在正常区间",
      "",
    ]);
    expect(cells).toHaveLength(2);
    expect(cells[0]).toMatchObject({
      cellIndex: 1,
      shotSize: "特写",
      cameraMoveZh: "缓推",
      dialogueZh: "你梳头掉的不是头发，是胶原蛋白",
      editNoteZh: "0-3秒",
    });
    expect(cells[1]!.shotSize).toBe("中景");
  });

  it("Markdown 与六栏文本：空表出空串，竖线转义", () => {
    expect(formatPlatformStoryboardCellsMarkdown([])).toBe("");
    expect(formatPlatformStoryboardCellsSixColumnText([])).toBe("");
    const cells = normalizePlatformStoryboardCells([
      { cellIndex: 1, dialogueZh: "A|B", shotSize: "近景", actionZh: "举三根手指" },
    ]);
    const md = formatPlatformStoryboardCellsMarkdown(cells);
    expect(md).toContain("| 1 | A／B |");
    expect(md.split("\n")).toHaveLength(3);
    const six = formatPlatformStoryboardCellsSixColumnText(cells);
    expect(six).toContain("【逐镜拆片表·按此分格，不得自行改镜】");
    expect(six).toContain("第1格｜景别：近景");
  });
});
