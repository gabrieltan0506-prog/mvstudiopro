export interface TrendCollection {
  platform: string;
  topics: string[];
}

export async function getTrends(): Promise<TrendCollection> {
  return {
    platform: "xiaohongshu",
    topics: [
      "家庭旅行",
      "城市vlog",
      "高铁体验",
    ],
  };
}
