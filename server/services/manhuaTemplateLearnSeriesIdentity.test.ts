import { describe, expect, it } from "vitest";
import {
  isManhuaCompilationDuration,
  normalizeManhuaSeriesTitle,
  placeSingleSourceInExistingSeries,
} from "../../shared/manhuaLearnSeriesIdentity";
import type { ManhuaLearnEpisodeDigest } from "../../shared/manhuaTemplateLearnSeries";

function digest(index: number, url: string): ManhuaLearnEpisodeDigest {
  return {
    episodeIndex: index,
    url,
    title: `第${index}集`,
    durationSec: 180,
    transcriptPreview: "x",
    hookNoteZh: "h",
    beatHints: [],
    climaxNotes: [],
    sceneHints: [],
    learnedAt: "2026-08-12T00:00:00.000Z",
  };
}

describe("manhua series identity", () => {
  it("treats one to two hour direct videos as compilation sources", () => {
    expect(isManhuaCompilationDuration(3599)).toBe(false);
    expect(isManhuaCompilationDuration(3600)).toBe(true);
    expect(isManhuaCompilationDuration(7200)).toBe(true);
  });

  it("normalizes layout but keeps season semantics", () => {
    expect(normalizeManhuaSeriesTitle("《聚 宝 仙 盆》")).toBe("聚宝仙盆");
    expect(normalizeManhuaSeriesTitle("聚宝仙盆 第二季")).not.toBe("聚宝仙盆");
  });

  it("resumes the same compilation source instead of creating another episode", () => {
    const existing = [digest(7, "https://www.douyin.com/video/1234567890123456789")];
    const placed = placeSingleSourceInExistingSeries([
      {
        index: 1,
        url: "https://www.douyin.com/video/999/search/x?modal_id=1234567890123456789",
        title: "大合集",
      },
    ], existing);
    expect(placed[0]?.index).toBe(7);
  });

  it("appends a different long compilation to the same series without overwriting episode one", () => {
    const existing = [digest(1, "https://example.com/ep1"), digest(9, "https://example.com/ep9")];
    const placed = placeSingleSourceInExistingSeries([
      { index: 1, url: "https://example.com/two-hour-compilation", title: "大合集" },
    ], existing);
    expect(placed[0]?.index).toBe(10);
  });
});
