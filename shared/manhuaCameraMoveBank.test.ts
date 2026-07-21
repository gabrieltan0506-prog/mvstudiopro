import { describe, expect, it } from "vitest";
import {
  MANHUA_CAMERA_MOVE_BANK,
  MANHUA_CAMERA_MOVE_ORDER,
  buildManhuaCameraMoveInjectBlock,
  recommendManhuaCameraMoveFromText,
} from "./manhuaCameraMoveBank";

describe("manhuaCameraMoveBank", () => {
  it("has 18 camera moves in fixed order", () => {
    expect(MANHUA_CAMERA_MOVE_ORDER).toHaveLength(18);
    expect(MANHUA_CAMERA_MOVE_BANK).toHaveLength(18);
    expect(MANHUA_CAMERA_MOVE_BANK.map((e) => e.id)).toEqual([...MANHUA_CAMERA_MOVE_ORDER]);
  });

  it("recommends OTS for dialogue and detail for props", () => {
    expect(recommendManhuaCameraMoveFromText("过肩对白审讯谈判").id).toBe("cam_09_ots");
    expect(recommendManhuaCameraMoveFromText("合同红章特写证据").nameZh).toMatch(/细节|特写/);
  });

  it("builds inject without leaking external site names", () => {
    const block = buildManhuaCameraMoveInjectBlock(["cam_09_ots", "cam_13_closeup"]);
    expect(block).toContain("【运镜词库】");
    expect(block).toContain("过肩");
    expect(block).not.toMatch(/东山|公众号|RunningHub|rhTV/i);
  });
});
