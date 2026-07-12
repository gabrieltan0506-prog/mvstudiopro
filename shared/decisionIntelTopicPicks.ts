/** 战略地图手动点选扩写的选题入参（结构实例或 IP 推荐方向） */
export type DecisionIntelTopicPick = {
  title: string;
  structure: string;
  predictedCtr?: number;
  predictedConversion?: number;
  brandMatchFit?: number;
  /** mab = 战略升级「探索」赛马卡 */
  source?: "structure" | "personalization" | "mab";
};

export function normalizeDecisionIntelTopicTitleKey(title: string): string {
  return title.replace(/\s+/g, " ").trim().toLowerCase();
}

/** 服务端 creditTransactions.description 中标记选题，用于统计重生成次数 */
export function decisionIntelTopicRegenDescriptionMarker(titleKey: string): string {
  return `titleKey=${titleKey}`;
}
