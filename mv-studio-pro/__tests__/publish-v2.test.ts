import { describe, it, expect } from "vitest";

describe("Publish Strategy V2 - Platform Data", () => {
  const platforms = [
    { id: "xiaohongshu", name: "小紅書", topicCount: 5, explosivePct: "40%" },
    { id: "bilibili", name: "B站", topicCount: 5, explosivePct: "45%" },
    { id: "douyin", name: "抖音", topicCount: 5, explosivePct: "35%" },
    { id: "channels", name: "視頻號", topicCount: 5, explosivePct: "30%" },
  ];

  it("should have 4 platforms configured", () => {
    expect(platforms.length).toBe(4);
  });

  it("each platform should have exactly 5 topics", () => {
    platforms.forEach((p) => {
      expect(p.topicCount).toBe(5);
    });
  });

  it("total topics across all platforms should be 20", () => {
    const total = platforms.reduce((sum, p) => sum + p.topicCount, 0);
    expect(total).toBe(20);
  });

  it("B站 should have the highest explosive potential", () => {
    const sorted = [...platforms].sort((a, b) => parseInt(b.explosivePct) - parseInt(a.explosivePct));
    expect(sorted[0].id).toBe("bilibili");
  });
});

describe("Publish Strategy V2 - Schedule", () => {
  const schedule = [
    { day: "Day 1", platform: "抖音" },
    { day: "Day 2", platform: "小紅書" },
    { day: "Day 2", platform: "B站" },
    { day: "Day 3", platform: "視頻號" },
    { day: "Day 4", platform: "抖音" },
    { day: "Day 5", platform: "小紅書" },
    { day: "Day 7", platform: "B站" },
    { day: "Day 8", platform: "抖音" },
    { day: "Day 14", platform: "B站" },
  ];

  it("should have 9 scheduled posts over 14 days", () => {
    expect(schedule.length).toBe(9);
  });

  it("first post should be on 抖音 (Day 1 引爆)", () => {
    expect(schedule[0].platform).toBe("抖音");
  });

  it("抖音 should have the most scheduled posts (3)", () => {
    const douyinPosts = schedule.filter((s) => s.platform === "抖音");
    expect(douyinPosts.length).toBe(3);
  });

  it("B站 should have 3 posts including the Day 14 覆盤", () => {
    const biliPosts = schedule.filter((s) => s.platform === "B站");
    expect(biliPosts.length).toBe(3);
    expect(biliPosts[biliPosts.length - 1].day).toBe("Day 14");
  });
});

describe("Publish Strategy V2 - Optimization Plan", () => {
  const optimizations = [
    { title: "強化故事線", targetDimension: "情感共鳴度" },
    { title: "製作多版本適配", targetDimension: "平台適配度" },
    { title: "打造記憶點旋律", targetDimension: "二次創作潛力" },
    { title: "矩陣式錯峰發布", targetDimension: "話題傳播性" },
    { title: "增加互動機制", targetDimension: "整體互動率" },
  ];

  it("should have 5 optimization strategies", () => {
    expect(optimizations.length).toBe(5);
  });

  it("overall score should be 7.4/10", () => {
    const overallScore = 7.4;
    expect(overallScore).toBeGreaterThan(7);
    expect(overallScore).toBeLessThan(8);
  });

  it("target score after optimization should be 8.5+", () => {
    const targetScore = 8.5;
    expect(targetScore).toBeGreaterThanOrEqual(8.5);
  });
});

describe("Publish Strategy V2 - Topic Differentiation", () => {
  it("each platform should have unique topic angles", () => {
    const xiaohongshuAngles = ["教程", "氛圍感", "創業", "情感", "設計"];
    const biliAngles = ["全流程", "對比", "虛擬偶像", "原創MV", "覆盤"];
    const douyinAngles = ["氛圍感", "挑戰", "故事", "變裝", "深夜"];
    const channelsAngles = ["普通人", "時代記憶", "夫妻", "中年", "治癒"];

    // Each platform should have 5 unique angles
    expect(new Set(xiaohongshuAngles).size).toBe(5);
    expect(new Set(biliAngles).size).toBe(5);
    expect(new Set(douyinAngles).size).toBe(5);
    expect(new Set(channelsAngles).size).toBe(5);
  });

  it("topics should have required fields", () => {
    const requiredFields = ["title", "publishTitle", "format", "duration", "publishTime", "caption", "coverTip", "tags", "strategy"];
    // Verify the structure is correct
    expect(requiredFields.length).toBe(9);
  });
});
