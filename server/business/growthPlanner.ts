export interface GrowthPlan {
  days: string[];
}

export async function buildGrowthPlan(_topic: string): Promise<GrowthPlan> {
  return {
    days: [
      "Day1: Hook视频",
      "Day2: 情绪冲突",
      "Day3: 反转内容",
      "Day4: 用户互动",
      "Day5: 产品植入",
      "Day6: 情绪共鸣",
      "Day7: 总结+CTA",
    ],
  };
}
