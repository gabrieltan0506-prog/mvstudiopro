import { describe, expect, it } from "vitest";
import {
  defaultWorkbenchShots,
  formatWorkbenchShotInjectBlock,
  parseWorkbenchShotsFromText,
  resolveKeyartShotIndex,
  workbenchShotTotalSec,
} from "./manhuaScriptWorkbench";

describe("manhuaScriptWorkbench", () => {
  it("parses numbered beat lines into shots", () => {
    const shots = parseWorkbenchShotsFromText(
      ["1. 女主推门进厅", "2. 对视沉默三秒", "3. 男主递玉佩", "4. 特写玉佩裂纹"].join("\n"),
    );
    expect(shots).toHaveLength(4);
    expect(shots[0]?.actionZh).toContain("推门");
    expect(workbenchShotTotalSec(shots)).toBeCloseTo(10, 0);
  });

  it("falls back to default skeleton when text is unstructured", () => {
    const shots = parseWorkbenchShotsFromText("只有一段散文没有编号");
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(defaultWorkbenchShots().length).toBe(4);
  });

  it("formats shot inject and resolves keyart shot index", () => {
    const block = formatWorkbenchShotInjectBlock({
      index: 2,
      durationSec: 3.5,
      cameraZh: "中近景",
      actionZh: "递玉佩",
    });
    expect(block).toContain("【分镜 2·静帧】");
    expect(block).toContain("递玉佩");
    expect(block).toContain("中近景；主体以胸部以上为主");
    expect(block).toContain("禁止套用统一的暖背景加轮廓光模板");
    expect(resolveKeyartShotIndex("keyart-e01-s03-abc", "")).toBe(3);
    expect(resolveKeyartShotIndex("keyart-e01-xyz", block)).toBe(2);
  });
});
