/** 战略地图手动点选扩写的选题入参（结构实例或 IP 推荐方向） */
export type DecisionIntelTopicPick = {
  title: string;
  structure: string;
  predictedCtr?: number;
  predictedConversion?: number;
  brandMatchFit?: number;
  source?: "structure" | "personalization";
};

export function normalizeDecisionIntelTopicTitleKey(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}
