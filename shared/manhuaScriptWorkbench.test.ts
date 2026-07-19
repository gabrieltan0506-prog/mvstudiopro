import { describe, expect, it } from "vitest";
import {
  defaultWorkbenchShots,
  parseWorkbenchShotsFromText,
  workbenchShotTotalSec,
} from "./manhuaScriptWorkbench";

describe("manhuaScriptWorkbench", () => {
  it("parses numbered beat lines into shots", () => {
    const shots = parseWorkbenchShotsFromText(
      ["1. 女主推门进厅", "2. 对视沉默三秒", "3. 男主递玉佩", "4. 特写玉佩裂纹"].join("\n"),
    );
    expect(shots).toHaveLength(4);
    expect(shots[0]?.actionZh).toContain("推门");
    expect(workbenchShotTotalSec(shots)).toBeCloseTo(15, 0);
  });

  it("falls back to default skeleton when text is unstructured", () => {
    const shots = parseWorkbenchShotsFromText("只有一段散文没有编号");
    expect(shots.length).toBeGreaterThanOrEqual(3);
    expect(defaultWorkbenchShots().length).toBe(4);
  });
});
