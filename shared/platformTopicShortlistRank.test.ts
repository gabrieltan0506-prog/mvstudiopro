import { describe, expect, it } from "vitest";
import {
  PLATFORM_TOPIC_TOP_PICK_COUNT,
  rankTopicShortlistByViralScore,
} from "./platformTopicShortlist";

describe("rankTopicShortlistByViralScore", () => {
  it("sorts by viral score desc and marks the first five as top picks", () => {
    const ranked = rankTopicShortlistByViralScore(
      [
        { id: "a", viralScore: 40 },
        { id: "b", viralScore: 92 },
        { id: "c", viralScore: 71 },
        { id: "d", viralScore: 88 },
        { id: "e", viralScore: 60 },
        { id: "f", viralScore: 95 },
        { id: "g", viralScore: 12 },
      ] as Array<{ id: string; viralScore?: number; isTopPick?: boolean }>,
    );
    expect(ranked.map((r) => r.id)).toEqual(["f", "b", "d", "c", "e", "a", "g"]);
    expect(ranked.filter((r) => r.isTopPick).length).toBe(PLATFORM_TOPIC_TOP_PICK_COUNT);
    expect(ranked.slice(0, 5).every((r) => r.isTopPick)).toBe(true);
    expect(ranked[5]?.isTopPick).toBe(false);
  });

  it("treats missing scores as 50 and keeps their original order", () => {
    const ranked = rankTopicShortlistByViralScore([
      { id: "no-score-1" },
      { id: "high", viralScore: 90 },
      { id: "no-score-2" },
      { id: "low", viralScore: 10 },
    ] as Array<{ id: string; viralScore?: number; isTopPick?: boolean }>);
    expect(ranked.map((r) => r.id)).toEqual(["high", "no-score-1", "no-score-2", "low"]);
  });

  it("lets comment heat break a tie between equally viral topics", () => {
    const ranked = rankTopicShortlistByViralScore([
      { id: "quiet", viralScore: 80, commentHeat: 20 },
      { id: "chatty", viralScore: 80, commentHeat: 95 },
    ] as Array<{ id: string; viralScore?: number; commentHeat?: number; isTopPick?: boolean }>);
    expect(ranked.map((r) => r.id)).toEqual(["chatty", "quiet"]);
  });

  it("keeps viral score dominant over comment heat", () => {
    const ranked = rankTopicShortlistByViralScore([
      { id: "hot-comments", viralScore: 50, commentHeat: 100 },
      { id: "big-viral", viralScore: 95, commentHeat: 0 },
    ] as Array<{ id: string; viralScore?: number; commentHeat?: number; isTopPick?: boolean }>);
    expect(ranked.map((r) => r.id)).toEqual(["big-viral", "hot-comments"]);
  });
});
