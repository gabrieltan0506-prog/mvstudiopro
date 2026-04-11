import { describe, expect, it } from "vitest";
import type { GrowthAnalysisScores, GrowthPlatform } from "@shared/growth";
import { buildGrowthSnapshotFromCollections, PLATFORM_LABELS } from "./growthSchema";
import type { PlatformTrendCollection } from "./trendCollector";

function createCollection(platform: GrowthPlatform, items: number, authors: number, notes: string[] = []): PlatformTrendCollection {
  return {
    platform,
    source: "live",
    collectedAt: new Date().toISOString(),
    windowDays: 30,
    notes,
    items: Array.from({ length: items }, (_, index) => ({
      id: `${platform}-${index}`,
      title: `${PLATFORM_LABELS[platform]} 内容 ${index}`,
      bucket: platform === "douyin" ? "douyin_feed" : "kuaishou_feed",
      author: `author-${index % authors}`,
      likes: 1000 - index,
      comments: 80,
      shares: 40,
      views: 20000,
      contentType: "video",
    })),
    stats: {
      platform,
      itemCount: items,
      uniqueAuthorCount: authors,
      bucketCounts: { [platform === "douyin" ? "douyin_feed" : "kuaishou_feed"]: items },
      requestCount: Math.max(1, Math.ceil(items / 10)),
      pageDepth: 2,
      targetPerRun: 100,
      referenceMinItems: 12,
      referenceMaxItems: 36,
      collectorMode: "warehouse",
      industryCounts: {},
      ageCounts: {},
      contentCounts: {},
    },
  };
}

describe("buildGrowthSnapshotFromCollections", () => {
  it("keeps growth handoff platform aligned with sorted platform recommendations", () => {
    const analysis: GrowthAnalysisScores = {
      composition: 82,
      color: 78,
      lighting: 74,
      impact: 88,
      viralPotential: 86,
      strengths: ["结果表达清楚", "节奏有推进感"],
      improvements: ["还需要更聚焦一个主问题"],
      platforms: ["快手", "抖音"],
      summary: "适合先跑强钩子版本，再延展方法拆解。",
    };

    const snapshot = buildGrowthSnapshotFromCollections({
      analysis,
      context: "我想先验证短视频首发平台，再决定后续商业承接。",
      requestedPlatforms: ["kuaishou", "douyin"],
      collections: {
        kuaishou: createCollection("kuaishou", 12, 3, ["Kuaishou profile/feed 3x3t4yubwineeyc page 1 blocked with result=109."]),
        douyin: createCollection("douyin", 36, 8),
      },
      errors: {},
    });

    const topRecommendation = snapshot.platformRecommendations[0];
    const topPlatform = Object.entries(PLATFORM_LABELS).find(([, label]) => label === topRecommendation.name)?.[0];

    expect(topPlatform).toBeTruthy();
    expect(snapshot.growthHandoff.recommendedPlatforms[0]).toBe(topPlatform);
    expect(snapshot.dashboardConsole.personalizedRecommendations[0]?.evidence).toContain("上传内容依据");
    expect(snapshot.dataAnalystSummary.platformRows.length).toBe(2);
    expect(snapshot.analysisTracks.mode).toBe("双主链");
    expect(snapshot.dataAnalystSummary.recommendationReason.length).toBeGreaterThan(0);
  });
});
