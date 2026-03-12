export interface BusinessReport {
  summary: string;
  score: number;
  advice: string;
}

export async function buildReport(_video: unknown): Promise<BusinessReport> {
  return {
    summary: "视频结构完整但缺少前3秒钩子",
    score: 72,
    advice: "增加冲突场景",
  };
}
