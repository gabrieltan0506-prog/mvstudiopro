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

  it("applies fine cut duration and subtitle labels", () => {
    const shots = [
      { index: 1, durationSec: 5, dialogueZh: "开场对白", actionZh: "推门" },
      { index: 2, durationSec: 5, actionZh: "对视" },
    ];
    const rough = buildRoughCutClipsFromShots(shots);
    const { totalSec, tracks } = buildManhuaEditMultitrack({
      roughClips: rough,
      shots,
      fineCutByShot: { 1: { inSec: 1, outSec: 3 } },
      subtitleEnabled: true,
    });
    expect(totalSec).toBe(7);
    const v2 = tracks.find((t) => t.kind === "v2_clip");
    expect(v2?.segments[0]?.durationSec).toBe(2);
    expect(v2?.segments[0]?.inSec).toBe(1);
    const srt = tracks.find((t) => t.kind === "srt_subtitle");
    expect(srt?.segments[0]?.labelZh).toContain("开场");
  });
});
