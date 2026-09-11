/**
 * 知识卡三条链路（主提炼 / 挑参考页 / 派生精华版）共用的**唯一**网关顺序定义。
 * 纯数据、无凭证、无副作用：消费方各自按已配置的钥匙过滤跳、套自己的
 * Vision/Text 模型与供应商参数适配。0911 终审第五条：三条链不允许各写各的顺序。
 *
 * 同一家网关会在一条链里出现多次（DeepSeek 跳 / GLM 跳 / Qwen 跳）是刻意的，
 * 消费方不得按供应商名去重。0911 用户令：读档二选一（DeepSeek V4.1 Flash / GLM 5.3 Flash），
 * 选中的那档两家供应商都打不通才换另一档，两档都失败最后才走 Qwen3.8 Max。
 */
export type KnowledgeCardGatewayName = "evolink" | "dashscope_sg" | "openrouter";
/**
 * 0911 用户令：降档兜底先走 GLM 5.3 Flash，Qwen 3.8 退到最后一手。
 * GLM 5.3 Flash 同样两家供应商（EvoLink `glm-5.3-flash` → OpenRouter `z-ai/glm-5.3-flash`），
 * 原生视觉、100 万上下文；EvoLink 侧恒开思考、reasoning_effort 只有 low/high/max 真正生效。
 */
export type KnowledgeCardTier = "deepseek" | "glm" | "qwen";
export type KnowledgeCardGatewayStep = { gateway: KnowledgeCardGatewayName; tier: KnowledgeCardTier };

/**
 * 选 DeepSeek V4.1 Flash：DeepSeek 两家 → GLM 两家 → Qwen 两家。
 * 0911 用户令：同一个模型**先走 OpenRouter 路由，失败才落 EvoLink**；
 * Qwen 那两跳例外——新加坡是已付费且不用即归零的套餐额度，仍排在 OpenRouter 前面。
 */
export const KNOWLEDGE_CARD_DEEPSEEK_FIRST_ORDER: readonly KnowledgeCardGatewayStep[] = [
  { gateway: "openrouter", tier: "deepseek" },
  { gateway: "evolink", tier: "deepseek" },
  { gateway: "openrouter", tier: "glm" },
  { gateway: "evolink", tier: "glm" },
  { gateway: "dashscope_sg", tier: "qwen" },
  { gateway: "openrouter", tier: "qwen" },
];

/** 选 GLM 5.3 Flash：GLM 两家 → DeepSeek 两家 → Qwen 两家（同上：OpenRouter 先、EvoLink 兜底） */
export const KNOWLEDGE_CARD_GLM_FIRST_ORDER: readonly KnowledgeCardGatewayStep[] = [
  { gateway: "openrouter", tier: "glm" },
  { gateway: "evolink", tier: "glm" },
  { gateway: "openrouter", tier: "deepseek" },
  { gateway: "evolink", tier: "deepseek" },
  { gateway: "dashscope_sg", tier: "qwen" },
  { gateway: "openrouter", tier: "qwen" },
];

/**
 * 选 DeepSeek 时的降档尾段（挑页 fallback 用：不重复 DeepSeek 两跳，也不自造新跳）。
 * 顺序即 GLM 两跳 → 新加坡 Qwen → OpenRouter Qwen。
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

/** 按已配置的钥匙过滤；顺序与重复跳一律保留 */
export function filterConfiguredSteps(
  order: readonly KnowledgeCardGatewayStep[],
  configured: { evolink: boolean; dashscope_sg: boolean; openrouter: boolean },
): KnowledgeCardGatewayStep[] {
  return order.filter((s) => configured[s.gateway]);
}
