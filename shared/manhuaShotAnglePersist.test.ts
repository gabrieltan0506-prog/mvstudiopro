import { describe, expect, it } from "vitest";
import {
  applyShotAnglesFromText,
  parseShotAngleTable,
  upsertShotAngleSection,
} from "./manhuaShotAnglePersist";

describe("manhuaShotAnglePersist", () => {
  it("upserts and parses angle table", () => {
    const text = upsertShotAngleSection("前文", { 1: "ang_04_ots", 2: "ang_02_low" });
    expect(text).toContain("## 机位选定");
    const map = parseShotAngleTable(text);
    expect(map[1]).toBe("ang_04_ots");
    expect(map[2]).toBe("ang_02_low");
    const shots = applyShotAnglesFromText(
      [
        { index: 1, durationSec: 5, cameraZh: "中景", actionZh: "对视" },
        { index: 2, durationSec: 5, cameraZh: "全景", actionZh: "亮相" },
      ],
      text,
    );
    expect(shots[0]?.cameraAngleId).toBe("ang_04_ots");
  });
});
