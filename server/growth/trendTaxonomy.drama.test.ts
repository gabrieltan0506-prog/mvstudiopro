import { describe, expect, it } from "vitest";
import { classifyTrendItem } from "./trendTaxonomy";
import { inferTrendTrackBucketForVisualReport, selectByGrowthPotential } from "./trendGrowthScoring";
import type { TrendItem } from "./trendCollector";

describe("classifyTrendItem drama fields", () => {
  it("labels AI manhua from structured dramaKind", () => {
    const labels = classifyTrendItem({
      id: "1",
      title: "第1集开局",
      isDrama: true,
      dramaKind: "ai_manhua",
      dramaInfo: { mixId: "m1", mixName: "咱家剑宗团宠小师妹", mixPlayCount: 1_000_000 },
    });
    expect(labels.contentLabels).toContain("AI漫剧");
    expect(labels.industryLabels).toContain("文娱剧情");
  });

  it("labels short drama collections", () => {
    const labels = classifyTrendItem({
      id: "2",
      title: "连载中",
      isDrama: true,
      dramaKind: "short_drama",
      dramaInfo: { mixId: "m2", mixName: "红果短剧示例", mixPlayCount: 500_000 },
    });
    expect(labels.contentLabels).toContain("短剧合集");
  });
});

describe("growth scoring drama boost", () => {
  it("categorizes AI manhua via inferTrendTrackBucketForVisualReport", () => {
    expect(
      inferTrendTrackBucketForVisualReport({
        id: "1",
        title: "x",
        dramaKind: "ai_manhua",
        isDrama: true,
      }),
    ).toBe("AI漫剧 · 动态漫");
  });

  it("boosts growthScore when mixPlayCount is present", () => {
    const publishedAt = new Date().toISOString();
    const base: TrendItem = {
      id: "a",
      title: "口播样本",
      author: "创作者甲",
      publishedAt,
      likes: 10,
      comments: 2,
      shares: 1,
      views: 1000,
    };
    const drama: TrendItem = {
      id: "b",
      title: "AI漫剧第1集",
      author: "创作者乙",
      publishedAt,
      likes: 10,
      comments: 2,
      shares: 1,
      views: 1000,
      isDrama: true,
      dramaKind: "ai_manhua",
      dramaInfo: { mixId: "m1", mixName: "漫剧甲", mixPlayCount: 5_000_000 },
    };
    const { selected } = selectByGrowthPotential([base, drama], { topN: 2, windowDays: 18 });
    expect(selected[0].item.id).toBe("b");
    expect(selected[0].category).toBe("AI漫剧 · 动态漫");
  });
});
