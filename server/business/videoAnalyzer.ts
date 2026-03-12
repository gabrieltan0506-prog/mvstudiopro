export interface VideoAnalysis {
  strengths: string[];
  weakness: string[];
  optimization: string[];
  commercialDirection: string[];
}

export async function analyzeVideo(_meta: unknown): Promise<VideoAnalysis> {
  return {
    strengths: [
      "真实感强",
      "人物表现自然",
    ],
    weakness: [
      "前10秒缺少Hook",
      "节奏偏慢",
    ],
    optimization: [
      "3秒内加入冲突",
      "减少空镜",
    ],
    commercialDirection: [
      "带货",
      "广告",
    ],
  };
}
