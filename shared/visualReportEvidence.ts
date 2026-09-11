/** 采集库内带逐条时间的分类样本计数；不是全平台播放量、流量或市场份额。 */
export type TrackGrowthEvidence = {
  metric: "sample_count";
  currentCount: number;
  priorCount: number;
  sampleScope: "collected_items";
  platforms: string[];
  windowDays: number;
  currentStart: string;
  currentEndExclusive: string;
  priorStart: string;
  priorEndExclusive: string;
};
