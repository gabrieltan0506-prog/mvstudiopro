import {
  GLM_53_FLASHX_OPENROUTER_MODEL,
  GLM_53_FLASHX_EVOLINK_MODEL,
  OPENROUTER_DEEPSEEK_PROVIDER_LOCK,
  OPENROUTER_GLM_PROVIDER_LOCK,
} from "./glmModels";

export const KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL = "deepseek/deepseek-v4.1-flash-1017";
export const KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL = "deepseek-v4.1-flash-1017";
// 不设应用层输出额度；实际发送前按模型容量和剩余上下文收敛。
export const KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST = Number.MAX_SAFE_INTEGER;
export type KnowledgeModelChannel = "openrouter" | "evolink";

/** 每模型首次加最多三次重试；保留旧回执键，跨通道仍计入同一模型次数。 */
export const KNOWLEDGE_PUBLICATION_ROUTE_ORDER = [
  { id: "openrouter", channel: "openrouter", model: KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL },
  { id: "evolink", channel: "evolink", model: KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL },
  { id: "openrouter-retry-2", channel: "openrouter", model: KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL },
  { id: "evolink-retry-3", channel: "evolink", model: KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL },
  { id: "glm-openrouter", channel: "openrouter", model: GLM_53_FLASHX_OPENROUTER_MODEL },
  { id: "glm-evolink", channel: "evolink", model: GLM_53_FLASHX_EVOLINK_MODEL },
  { id: "glm-openrouter-retry-2", channel: "openrouter", model: GLM_53_FLASHX_OPENROUTER_MODEL },
  { id: "glm-evolink-retry-3", channel: "evolink", model: GLM_53_FLASHX_EVOLINK_MODEL },
] as const;

/** 新并发批次固定通道，避免两条消费者抢同一条供应商通道；每模型仍最多四次。 */
export function knowledgePublicationRoutesForChannel(channel: KnowledgeModelChannel) {
  return [
    ...Array.from({ length: 4 }, (_, attempt) => ({
      id: attempt === 0 ? channel : `${channel}-retry-${attempt}`,
      channel,
      model: channel === "openrouter" ? KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL : KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL,
    })),
    ...Array.from({ length: 4 }, (_, attempt) => ({
      id: attempt === 0 ? `glm-${channel}` : `glm-${channel}-retry-${attempt}`,
      channel,
      model: channel === "openrouter" ? GLM_53_FLASHX_OPENROUTER_MODEL : GLM_53_FLASHX_EVOLINK_MODEL,
    })),
  ];
}
export const KNOWLEDGE_PUBLICATION_ALL_ROUTES = Array.from(new Map([
  ...KNOWLEDGE_PUBLICATION_ROUTE_ORDER,
  ...knowledgePublicationRoutesForChannel("openrouter"),
  ...knowledgePublicationRoutesForChannel("evolink"),
].map(route => [route.id, route])).values());
export const KNOWLEDGE_PUBLICATION_RECEIPT_ROUTES = [
  ...KNOWLEDGE_PUBLICATION_ALL_ROUTES.map(route => route.id),
  "vertex", // 只读历史未知回执，不再调用。
] as const;

/** 2026-11-06 核对官方文档及自营端点；EvoLink 的 DeepSeek 按十进制 384000 限制。 */
export function knowledgeModelCapabilities(model: string, channel: KnowledgeModelChannel) {
  if (["deepseek-v4.1-flash", KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL, KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL].includes(model)) {
    return {
      model: channel === "openrouter" ? KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL : KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL,
      contextTokens: channel === "openrouter" ? 1_048_576 : 1_000_000,
      outputTokens: channel === "openrouter" ? 393_216 : 384_000,
      provider: OPENROUTER_DEEPSEEK_PROVIDER_LOCK,
    };
  }
  if (["glm-5.3-flash", GLM_53_FLASHX_EVOLINK_MODEL, GLM_53_FLASHX_OPENROUTER_MODEL].includes(model)) {
    return {
      model: channel === "openrouter" ? GLM_53_FLASHX_OPENROUTER_MODEL : GLM_53_FLASHX_EVOLINK_MODEL,
      contextTokens: channel === "openrouter" ? 1_048_576 : 1_000_000,
      outputTokens: 131_072,
      provider: OPENROUTER_GLM_PROVIDER_LOCK,
    };
  }
  throw new Error("图文整理仅支持 DeepSeek V4.1 Flash 1017 和 GLM 5.3 FlashX");
}

export function knowledgeOutputBudget(model: string, channel: KnowledgeModelChannel, requested: number, inputTokens = 0) {
  if (!Number.isFinite(requested) || requested < 1 || !Number.isFinite(inputTokens) || inputTokens < 0)
    throw new Error("图文整理容量参数无效，未提交请求");
  const limits = knowledgeModelCapabilities(model, channel);
  const available = limits.contextTokens - Math.ceil(inputTokens);
  if (available < 1) throw new Error("本批原稿超过模型上下文容量，请拆分后再整理；未截断原文");
  return Math.min(Math.floor(requested), limits.outputTokens, available);
}
