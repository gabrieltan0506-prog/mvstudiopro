import { describe, expect, it } from "vitest";
import {
  buildManhuaAssemblePlan,
  buildManhuaSunoPrompt,
  summarizeManhuaPathTrackStatus,
} from "./manhuaFinalAssemble";

describe("manhuaFinalAssemble", () => {
  it("orders clips by episode and skips missing clip", () => {
    const plan = buildManhuaAssemblePlan([
      { episodeIndex: 3, clipUrl: "https://x/e3.mp4", episodeTitle: "三" },
      { episodeIndex: 1, keyartUrl: "https://x/k1.jpg", episodeTitle: "一" },
      { episodeIndex: 2, clipUrl: "https://x/e2.mp4", keyartUrl: "https://x/k2.jpg" },
      { episodeIndex: 1, clipUrl: "https://x/e1.mp4" },
    ]);
    expect(plan.episodeIndexes).toEqual([1, 2, 3]);
    expect(plan.sceneVideos.map((s) => s.url)).toEqual([
      "https://x/e1.mp4",
      "https://x/e2.mp4",
      "https://x/e3.mp4",
    ]);
    expect(plan.sceneVideos[0].stillImageUrl).toBe("https://x/k1.jpg");
    expect(plan.sceneVideos[1].stillImageUrl).toBe("https://x/k2.jpg");
    expect(plan.skippedEpisodes).toEqual([]);
  });

  it("filters by episodeIndexes and records skip when clip missing", () => {
    const plan = buildManhuaAssemblePlan(
      [
        { episodeIndex: 1, clipUrl: "https://x/e1.mp4" },
        { episodeIndex: 2, episodeTitle: "待跑" },
        { episodeIndex: 3, clipUrl: "https://x/e3.mp4" },
      ],
      { episodeIndexes: [2, 3] },
    );
    expect(plan.episodeIndexes).toEqual([3]);
    expect(plan.skippedEpisodes).toEqual([{ episodeIndex: 2, title: "待跑", reason: "缺成片" }]);
  });

  it("builds instrumental suno prompt from jianghu+court topic", () => {
    const p = buildManhuaSunoPrompt({
      topic: "江湖刀光打斗朝堂权谋的短剧",
      seriesTitle: "刀下认妻",
      logline: "父辈成仇儿女相守",
    });
    expect(p.toLowerCase()).toMatch(/instrumental|no vocals/);
    expect(p.length).toBeGreaterThan(40);
    expect(p.length).toBeLessThanOrEqual(480);
  });

  it("summarizes blue/red path tracks", () => {
    const s = summarizeManhuaPathTrackStatus({
      version: 1,
      anchors: [
        { index: 1, x: 0.2, y: 0.3, focusZh: "人", cameraEn: "", subjectActionEn: "", durationHintSec: 2, trackRole: "subject" },
        { index: 2, x: 0.5, y: 0.4, focusZh: "镜", cameraEn: "", subjectActionEn: "", durationHintSec: 2, trackRole: "camera" },
      ],
      strokes: [{ trackRole: "camera", points: [{ x: 0.1, y: 0.1 }] }],
    });
    expect(s.hasBlueCamera).toBe(true);
    expect(s.hasRedSubject).toBe(true);
    expect(s.labelZh).toContain("蓝轨✓");
    expect(s.labelZh).toContain("红轨✓");
  });
});
