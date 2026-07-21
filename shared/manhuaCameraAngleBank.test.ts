import { describe, expect, it } from "vitest";
import {
  MANHUA_CAMERA_ANGLE_BANK,
  MANHUA_CAMERA_ANGLE_ORDER,
  recommendManhuaCameraAngleFromText,
} from "./manhuaCameraAngleBank";

describe("manhuaCameraAngleBank", () => {
  it("has 10 ordered angles", () => {
    expect(MANHUA_CAMERA_ANGLE_ORDER).toHaveLength(10);
    expect(MANHUA_CAMERA_ANGLE_BANK).toHaveLength(10);
    expect(MANHUA_CAMERA_ANGLE_BANK.map((e) => e.id)).toEqual([...MANHUA_CAMERA_ANGLE_ORDER]);
  });

  it("recommends ots for dialogue", () => {
    expect(recommendManhuaCameraAngleFromText("谈判对白过肩").id).toBe("ang_04_ots");
  });
});
