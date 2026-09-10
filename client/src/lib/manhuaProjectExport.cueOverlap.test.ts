import { describe, expect, it } from "vitest";
import { clampManhuaSubtitleCueOverlap } from "./manhuaProjectExport";

describe("交付 SRT 去重叠", () => {
  it("淡变转场上段末 cue 压过下段首 cue 时，前者终点压到后者起点；零长 cue 丢弃", () => {
    const out = clampManhuaSubtitleCueOverlap([
      { startSec: 0, endSec: 3, textZh: "a" },
      { startSec: 12.2, endSec: 15, textZh: "c" },
      { startSec: 10, endSec: 15.5, textZh: "b" },
      { startSec: 14.6, endSec: 15, textZh: "d" },
    ]);
    expect(out.map((c) => [c.textZh, c.startSec, c.endSec])).toEqual([
      ["a", 0, 3],
      ["b", 10, 12.2],
      ["c", 12.2, 14.6],
      ["d", 14.6, 15],
    ]);
  });
  it("不重叠时原样返回", () => {
    const cues = [{ startSec: 0, endSec: 1 }, { startSec: 1, endSec: 2 }];
    expect(clampManhuaSubtitleCueOverlap(cues)).toEqual(cues);
  });
});
