import { describe, expect, it } from "vitest";
import { inspectManhuaAssembleCompleteness } from "./manhuaAssembleCompleteness";

describe("inspectManhuaAssembleCompleteness", () => {
  it("rejects a 10-second pilot or partial episode as final output", () => {
    const result = inspectManhuaAssembleCompleteness({
      planned: [
        { episodeIndex: 1, segmentIndex: 1 },
        { episodeIndex: 1, segmentIndex: 2 },
        { episodeIndex: 1, segmentIndex: 3 },
      ],
      selected: [{ episodeIndex: 1, segmentIndex: 1 }],
    });
    expect(result.complete).toBe(false);
    expect(result.missing).toEqual([
      { episodeIndex: 1, segmentIndex: 2 },
      { episodeIndex: 1, segmentIndex: 3 },
    ]);
    expect(result.hintZh).toContain("不可导出半集");
  });

  it("accepts all planned segments independent of input order", () => {
    expect(
      inspectManhuaAssembleCompleteness({
        planned: [
          { episodeIndex: 2, segmentIndex: 2 },
          { episodeIndex: 2, segmentIndex: 1 },
        ],
        selected: [
          { episodeIndex: 2, segmentIndex: 1 },
          { episodeIndex: 2, segmentIndex: 2 },
        ],
      }).complete,
    ).toBe(true);
  });
});
