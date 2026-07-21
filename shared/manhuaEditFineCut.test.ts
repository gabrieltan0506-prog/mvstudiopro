import { describe, expect, it } from "vitest";
import {
  clampFineCut,
  defaultFineCut,
  fineCutEffectiveSec,
  parseFineCutByShot,
} from "./manhuaEditFineCut";

describe("manhuaEditFineCut", () => {
  it("defaults full clip", () => {
    expect(defaultFineCut(5)).toEqual({ inSec: 0, outSec: 5 });
  });

  it("clamps and snaps to 0.5s with min length", () => {
    expect(clampFineCut(5, { inSec: 0.3, outSec: 4.7 })).toEqual({
      inSec: 0.5,
      outSec: 4.5,
    });
    expect(fineCutEffectiveSec(5, { inSec: 1, outSec: 1.2 })).toBe(0.5);
  });

  it("parses persist map", () => {
    const m = parseFineCutByShot({
      "1": { inSec: 1, outSec: 4 },
      bad: { inSec: 0, outSec: 2 },
    });
    expect(m[1]).toEqual({ inSec: 1, outSec: 4 });
    expect(m[NaN as unknown as number]).toBeUndefined();
  });
});
