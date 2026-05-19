import type { AdvancedAIReportTopicStructureExample } from "./advancedAIReport";

/** 战略地图加成选题：转化率 ≥ 8% 或契合度 ≥ 75 */
export function isDecisionIntelBonusTopicEligible(
  ex: Pick<AdvancedAIReportTopicStructureExample, "predictedConversion" | "brandMatchFit">,
): boolean {
  const conv = Number(ex.predictedConversion);
  const fit = Number(ex.brandMatchFit);
  return (Number.isFinite(conv) && conv >= 8) || (Number.isFinite(fit) && fit >= 75);
}

export function scoreDecisionIntelBonusTopic(
  ex: AdvancedAIReportTopicStructureExample,
): number {
  const conv = Number(ex.predictedConversion) || 0;
  const fit = Number(ex.brandMatchFit) || 0;
  const ctr = Number(ex.predictedCtr) || 0;
  return conv * 12 + fit * 0.85 + ctr * 2;
}

/**
 * 从选题结构实例中选出最多 2 条加成选题（优先满足筛选条件，再按综合分排序）。
 */
export function selectDecisionIntelBonusTopics(
  examples: AdvancedAIReportTopicStructureExample[] | undefined | null,
): AdvancedAIReportTopicStructureExample[] {
  const list = Array.isArray(examples) ? examples : [];
  if (list.length === 0) return [];

  const eligible = list.filter(isDecisionIntelBonusTopicEligible);
  const pool = eligible.length > 0 ? eligible : list;
  return [...pool].sort((a, b) => scoreDecisionIntelBonusTopic(b) - scoreDecisionIntelBonusTopic(a)).slice(0, 2);
}
