import { describe, expect, it } from "vitest";
import { isManhuaDenseFrameSampleSuccessful } from "./manhuaRemoteMediaSampler";

describe("manhua remote dense frame sample", () => {
  it("requires at least 65 percent of the planned dense frames", () => {
    expect(isManhuaDenseFrameSampleSuccessful(200, 130)).toBe(true);
    expect(isManhuaDenseFrameSampleSuccessful(200, 129)).toBe(false);
    expect(isManhuaDenseFrameSampleSuccessful(1, 1)).toBe(false);
    expect(isManhuaDenseFrameSampleSuccessful(1, 2)).toBe(true);
  });
});
