import { describe, expect, it } from "vitest";
import {
  isManhuaLearnEpisodeComplete,
  mergeManhuaLearnChunkIntoDigest,
  type ManhuaLearnEpisodeDigest,
} from "./manhuaTemplateLearnSeries";

describe("manhua learn checkpoint merge", () => {
  it("merges chunks and marks complete at full duration", () => {
    const c1 = {
      startSec: 0,
      endSec: 600,
      transcriptPreview: "开场钩子",
      hookNoteZh: "前3秒冲突",
      beatHints: [{ atSec: 12, conflictZh: "对峙", visualZh: "近景" }],
      climaxNotes: ["反转"],
      sceneHints: ["废土"],
      learnedAt: "2026-07-23T00:00:00.000Z",
    };
    const d1 = mergeManhuaLearnChunkIntoDigest({
      prev: null,
      chunk: c1,
      episodeIndex: 1,
      url: "https://example.com/v/1",
      title: "第1集",
      durationSec: 1200,
      categoryLabelZh: "爽文逆袭",
    });
    expect(d1.complete).toBe(false);
    expect(d1.learnedThroughSec).toBe(600);
    expect(isManhuaLearnEpisodeComplete(d1)).toBe(false);

    const c2 = {
      startSec: 600,
      endSec: 1200,
      transcriptPreview: "后段升级",
      hookNoteZh: "待补钩子",
      beatHints: [{ atSec: 620, conflictZh: "翻盘", visualZh: "全景" }],
      climaxNotes: ["高潮"],
      sceneHints: ["营地"],
      learnedAt: "2026-07-23T00:10:00.000Z",
    };
    const d2 = mergeManhuaLearnChunkIntoDigest({
      prev: d1,
      chunk: c2,
      episodeIndex: 1,
      url: "https://example.com/v/1",
      title: "第1集",
      durationSec: 1200,
    });
    expect(d2.complete).toBe(true);
    expect(d2.chunks?.length).toBe(2);
    expect(d2.transcriptPreview).toMatch(/开场钩子/);
    expect(d2.transcriptPreview).toMatch(/后段升级/);
    expect(d2.hookNoteZh).toBe("前3秒冲突");
    expect(isManhuaLearnEpisodeComplete(d2)).toBe(true);
  });

  it("treats legacy digests without chunks as complete", () => {
    const legacy: ManhuaLearnEpisodeDigest = {
      episodeIndex: 2,
      url: "u",
      title: "t",
      durationSec: 300,
      transcriptPreview: "x",
      hookNoteZh: "h",
      beatHints: [],
      climaxNotes: [],
      sceneHints: [],
      learnedAt: "2026-07-23T00:00:00.000Z",
    };
    expect(isManhuaLearnEpisodeComplete(legacy)).toBe(true);
  });
});
