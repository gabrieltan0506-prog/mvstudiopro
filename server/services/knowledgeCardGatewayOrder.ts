/**
 * 知识卡三条链路（主提炼 / 挑参考页 / 派生精华版）共用的**唯一**网关顺序定义。
 * 纯数据、无凭证、无副作用：消费方各自按已配置的钥匙过滤跳、套自己的
 * Vision/Text 模型与供应商参数适配。0911 终审第五条：三条链不允许各写各的顺序。
 *
 * 同一家网关会在一条链里出现多次（DeepSeek 跳 / GLM 跳）是刻意的，
 * 消费方不得按供应商名去重。0911 用户令：读档二选一（DeepSeek V4.1 Flash / GLM 5.3 Flash），
 * 选中的那档两家供应商都打不通才换另一档，两档都失败即明确报错，不再调用 Qwen。
 */
export type KnowledgeCardGatewayName = "evolink" | "dashscope_sg" | "openrouter";
/** 执行链仅包含 GLM FlashX 和 DeepSeek V4.1；旧类型保留以兼容历史参数。 */
export type KnowledgeCardTier = "deepseek" | "glm" | "qwen";
export type KnowledgeCardGatewayStep = { gateway: KnowledgeCardGatewayName; tier: KnowledgeCardTier };

/**
 * 选 DeepSeek V4.1 Flash：DeepSeek 两家 → GLM 两家 。
 * 0911 用户令：同一个模型**先走 OpenRouter 路由，失败才落 EvoLink**；
 */
export const KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER: readonly KnowledgeCardGatewayStep[] = [
  { gateway: "openrouter", tier: "deepseek" },
  { gateway: "evolink", tier: "deepseek" },
  { gateway: "openrouter", tier: "glm" },
  { gateway: "evolink", tier: "glm" },
];

/** 选 GLM 5.3 FlashX：GLM 两家 → DeepSeek 两家 （同上：OpenRouter 先、EvoLink 兜底） */
export const KNOWLEDGE_CARD_GLM_FIRST_ORDER: readonly KnowledgeCardGatewayStep[] = [
  { gateway: "openrouter", tier: "glm" },
  { gateway: "evolink", tier: "glm" },
  { gateway: "openrouter", tier: "deepseek" },
  { gateway: "evolink", tier: "deepseek" },
];

/**
 * 选 DeepSeek 时的降档尾段（挑页 fallback 用：不重复 DeepSeek 两跳，也不自造新跳）。
 * 顺序即 GLM 两跳，不再追加其他模型。
 */
export const KNOWLEDGE_CARD_PREMIUM_FALLBACK_TAIL: readonly KnowledgeCardGatewayStep[] =
  KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER.filter((s) => s.tier !== "deepseek");

/**
 * OpenRouter 的自营锁在 glmModels.ts 定义（全站唯一一份，知识卡与增长链共用）：
 * 同一 slug 会路由到多家转售方，参数支持与产出质量不一致；allow_fallbacks:false
 * ——宁可这跳 404/429 直接换下一跳，也不要静默落到别家。
 */
import {
  OPENROUTER_DEEPSEEK_PROVIDER_LOCK as DEEPSEEK_LOCK,
  OPENROUTER_GLM_PROVIDER_LOCK as GLM_LOCK,
} from "./glmModels.js";
export { OPENROUTER_DEEPSEEK_PROVIDER_LOCK, OPENROUTER_GLM_PROVIDER_LOCK } from "./glmModels.js";

/** 该跳该不该带 provider 锁：OpenRouter 的 DeepSeek / GLM 跳各锁各的自营 */
export function openRouterProviderLockForTier(tier: KnowledgeCardTier): Record<string, unknown> | null {
  if (tier === "deepseek") return { ...DEEPSEEK_LOCK };
  if (tier === "glm") return { ...GLM_LOCK };
  return null;
}

/** 两路读取不同文件；失败先换同模型网关，再换下一模型。 */
export function knowledgeCardChainForPrimary(
  order: readonly KnowledgeCardGatewayStep[],
  primary: "openrouter" | "evolink",
): KnowledgeCardGatewayStep[] {
  const tiers = Array.from(new Set(order.map(step => step.tier)));
  return tiers.flatMap(tier => {
    const steps = order.filter(step => step.tier === tier);
    return [...steps.filter(step => step.gateway === primary), ...steps.filter(step => step.gateway !== primary)];
  });
}

/** 按已配置的钥匙过滤；顺序与重复跳一律保留 */
export function filterConfiguredSteps(
  order: readonly KnowledgeCardGatewayStep[],
  configured: { evolink: boolean; dashscope_sg: boolean; openrouter: boolean },
): KnowledgeCardGatewayStep[] {
  return order.filter((s) => configured[s.gateway]);
}
