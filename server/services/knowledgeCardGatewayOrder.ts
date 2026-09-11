/**
 * 知识卡三条链路（主提炼 / 挑参考页 / 派生精华版）共用的**唯一**网关顺序定义。
 * 纯数据、无凭证、无副作用：消费方各自按已配置的钥匙过滤跳、套自己的
 * Vision/Text 模型与供应商参数适配。0911 终审第五条：三条链不允许各写各的顺序。
 *
 * OpenRouter 出现两次（DeepSeek 跳 / Qwen 跳）是刻意的，消费方不得按供应商名去重。
 */
export type KnowledgeCardGatewayName = "evolink" | "dashscope_sg" | "openrouter";
export type KnowledgeCardTier = "deepseek" | "qwen";
export type KnowledgeCardGatewayStep = { gateway: KnowledgeCardGatewayName; tier: KnowledgeCardTier };

/** 精细档（DeepSeek）：同模型先换供应商，换不动才降档 */
export const KNOWLEDGE_CARD_PREMIUM_ORDER: readonly KnowledgeCardGatewayStep[] = [
  { gateway: "evolink", tier: "deepseek" },
  { gateway: "openrouter", tier: "deepseek" },
  { gateway: "dashscope_sg", tier: "qwen" },
  { gateway: "openrouter", tier: "qwen" },
];

/** 轻量档（Qwen）：全程同模型换供应商 */
export const KNOWLEDGE_CARD_LIGHT_ORDER: readonly KnowledgeCardGatewayStep[] = [
  { gateway: "dashscope_sg", tier: "qwen" },
  { gateway: "openrouter", tier: "qwen" },
  { gateway: "evolink", tier: "qwen" },
];

/** 精细档降档后的 Qwen 尾段（挑页 fallback 用：不重复前两跳，也不多出第 5 跳） */
export const KNOWLEDGE_CARD_PREMIUM_QWEN_TAIL: readonly KnowledgeCardGatewayStep[] =
  KNOWLEDGE_CARD_PREMIUM_ORDER.filter((s) => s.tier === "qwen");

/** 按已配置的钥匙过滤；顺序与重复跳一律保留 */
export function filterConfiguredSteps(
  order: readonly KnowledgeCardGatewayStep[],
  configured: { evolink: boolean; dashscope_sg: boolean; openrouter: boolean },
): KnowledgeCardGatewayStep[] {
  return order.filter((s) => configured[s.gateway]);
}
