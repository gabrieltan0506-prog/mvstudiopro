import { describe, expect, it } from "vitest";
import { buildManhuaEditMultitrack } from "./manhuaEditMultitrack";
import { buildRoughCutClipsFromShots } from "./manhuaEditWorkflowBank";

describe("manhuaEditMultitrack", () => {
  it("builds four tracks from rough order", () => {
    const shots = [
      { index: 1, durationSec: 5, cameraZh: "近景", actionZh: "推门", dialogueZh: "你回来了" },
      { index: 2, durationSec: 5, cameraZh: "中景", actionZh: "对视" },
    ];
    const rough = buildRoughCutClipsFromShots(shots, {
      stillIndexes: new Set([1]),
      clipIndexes: new Set([1]),
      order: [2, 1],
    });
    const { totalSec, tracks } = buildManhuaEditMultitrack({
      roughClips: rough,
      shots,
      stillIndexes: new Set([1]),
      clipIndexes: new Set([1]),
    });
    expect(totalSec).toBe(10);
    expect(tracks).toHaveLength(4);
    expect(tracks.map((t) => t.kind)).toEqual([
      "v1_still",
      "v2_clip",
      "a1_dialogue",
      "srt_subtitle",
    ]);
    expect(tracks[0]?.segments[0]?.shotIndex).toBe(2);
    expect(tracks[2]?.segments[1]?.dialogueZh).toContain("回来");
  });
});
