import { describe, expect, it } from "vitest";
import {
  MANHUA_EDIT_STAGE_BANK,
  MANHUA_EDIT_STAGE_ORDER,
  buildRoughCutClipsFromShots,
  listRoughTimelineStages,
  roughCutTotalSec,
} from "./manhuaEditWorkflowBank";

describe("manhuaEditWorkflowBank", () => {
  it("orders edit stages", () => {
    expect(MANHUA_EDIT_STAGE_ORDER).toHaveLength(MANHUA_EDIT_STAGE_BANK.length);
    expect(listRoughTimelineStages().every((s) => s.showOnRoughTimeline)).toBe(true);
  });

  it("builds rough cut clips", () => {
    const clips = buildRoughCutClipsFromShots(
      [
        { index: 1, durationSec: 5, actionZh: "推门" },
        { index: 2, durationSec: 8, actionZh: "对视" },
      ],
      { stillIndexes: new Set([1]), clipIndexes: new Set([1]) },
    );
    expect(clips).toHaveLength(2);
    expect(clips[0]?.hasStill).toBe(true);
    expect(roughCutTotalSec(clips)).toBe(13);
  });
});
