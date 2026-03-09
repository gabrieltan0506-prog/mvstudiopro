export type GrowthSignal = {
  platform: "douyin" | "xiaohongshu" | "bilibili" | "toutiao" | "kuaishou"
  title?: string
  engagementScore?: number
  commentSentiment?: number
}

export const sampleGrowthSignals: GrowthSignal[] = [
  {
    platform: "douyin",
    title: "城市夜景航拍",
    engagementScore: 0.82,
    commentSentiment: 0.7
  }
]
