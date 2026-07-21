import { describe, expect, it } from "vitest";
import { buildRoughCutClipsFromShots } from "./manhuaEditWorkflowBank";
import { buildManhuaSubtitleCues, formatManhuaSubtitleSrt } from "./manhuaEditSubtitle";

describe("manhuaEditSubtitle", () => {
  const shots = [
    { index: 1, durationSec: 5, dialogueZh: "你回来了", actionZh: "推门" },
    { index: 2, durationSec: 5, actionZh: "对视" },
  ];

  it("builds cues only when enabled and dialogue present", () => {
    const rough = buildRoughCutClipsFromShots(shots, { order: [1, 2] });
    expect(
      buildManhuaSubtitleCues({ roughClips: rough, shots, enabled: false }),
    ).toHaveLength(0);
    const cues = buildManhuaSubtitleCues({
      roughClips: rough,
      shots,
      enabled: true,
      fineCutByShot: { 1: { inSec: 1, outSec: 4 } },
    });
    expect(cues).toHaveLength(1);
    expect(cues[0]?.textZh).toBe("你回来了");
    expect(cues[0]?.startSec).toBe(0);
    expect(cues[0]?.endSec).toBe(3);
  });

  it("formats srt", () => {
    const srt = formatManhuaSubtitleSrt([
      { shotIndex: 1, order: 1, startSec: 0, endSec: 3, textZh: "你好" },
    ]);
    expect(srt).toContain("00:00:00,000 --> 00:00:03,000");
    expect(srt).toContain("你好");
  });
});
