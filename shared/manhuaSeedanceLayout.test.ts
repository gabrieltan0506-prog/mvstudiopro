import { describe, expect, it } from "vitest";
import {
  hasManhuaSeedanceLayoutChoice,
  resolveManhuaSeedanceLayoutProfile,
} from "./manhuaSeedanceLayout.js";

describe("manhuaSeedanceLayout", () => {
  it("maps 2.0 / fast to 5–6×15 and 2.5 to 4×30", () => {
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.0-fast")).toMatchObject({
      segmentCount: 6,
      durationSecPerSegment: 15,
      targetSec: 90,
    });
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.0")).toMatchObject({
      segmentCount: 6,
      durationSecPerSegment: 15,
    });
    expect(resolveManhuaSeedanceLayoutProfile("seedance-2.5")).toMatchObject({
      segmentCount: 4,
      durationSecPerSegment: 30,
      targetSec: 120,
    });
  });

  it("requires explicit choice before expand", () => {
    expect(hasManhuaSeedanceLayoutChoice("")).toBe(false);
    expect(hasManhuaSeedanceLayoutChoice("seedance-2.5")).toBe(true);
  });
});
