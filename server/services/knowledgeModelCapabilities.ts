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

/** 同一模型、同一通道首次加最多三次重试，耗尽后才切另一通道。 */
export function knowledgePublicationRoutesForChannel(channel: KnowledgeModelChannel) {
  const alternate: KnowledgeModelChannel = channel === "openrouter" ? "evolink" : "openrouter";
  return (["deepseek", "glm"] as const).flatMap(family =>
    [channel, alternate].flatMap(provider => Array.from({ length: 4 }, (_, attempt) => ({
      id: `${family === "glm" ? "glm-" : ""}${provider}${attempt === 0 ? "" : `-retry-${attempt}`}`,
      channel: provider,
      model: family === "deepseek"
        ? (provider === "openrouter" ? KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL : KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL)
        : (provider === "openrouter" ? GLM_53_FLASHX_OPENROUTER_MODEL : GLM_53_FLASHX_EVOLINK_MODEL),
    }))),
  );
}

export const KNOWLEDGE_PUBLICATION_ROUTE_ORDER = knowledgePublicationRoutesForChannel("openrouter");
// 包含旧交替路由及旧锁定路由全部ID；恢复时先回放已有成功/未知回执。
export const KNOWLEDGE_PUBLICATION_ALL_ROUTES = KNOWLEDGE_PUBLICATION_ROUTE_ORDER;
export const KNOWLEDGE_PUBLICATION_RECEIPT_ROUTES = [
  ...KNOWLEDGE_PUBLICATION_ALL_ROUTES.map(route => route.id),
  "vertex", // 只读历史未知回执，不再调用。
] as const;

/**
 * 2026-11-06 核对官方文档及自营端点；EvoLink 的 DeepSeek 按十进制 384000 限制。
 * 2026-11-09 复核：OpenRouter DeepSeek 自营端点 max_completion_tokens=393216（与此处一致，非误配）。
 * vision：OpenRouter 模型表 DeepSeek V4.1 Flash 与 GLM 5.3 FlashX 均 text+image；EvoLink 文档两者均支持 image_url（公网 URL 须 60s 内拉完）。
 * 审校链模型/通道顺序由请求的 executionFamily/executionChannel 决定（见 knowledgePublicationAdvisor：GLM@EvoLink→GLM@OR→DeepSeek@EvoLink→DeepSeek@OR）。
 */
export function knowledgeModelCapabilities(model: string, channel: KnowledgeModelChannel) {
  if (["deepseek-v4.1-flash", KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL, KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL].includes(model)) {
    return {
      model: channel === "openrouter" ? KNOWLEDGE_DEEPSEEK_OPENROUTER_MODEL : KNOWLEDGE_DEEPSEEK_EVOLINK_MODEL,
      contextTokens: channel === "openrouter" ? 1_048_576 : 1_000_000,
      outputTokens: channel === "openrouter" ? 393_216 : 384_000,
      provider: OPENROUTER_DEEPSEEK_PROVIDER_LOCK,
      vision: true,
    };
  }
  if (["glm-5.3-flash", GLM_53_FLASHX_EVOLINK_MODEL, GLM_53_FLASHX_OPENROUTER_MODEL].includes(model)) {
    return {
      model: channel === "openrouter" ? GLM_53_FLASHX_OPENROUTER_MODEL : GLM_53_FLASHX_EVOLINK_MODEL,
      contextTokens: channel === "openrouter" ? 1_048_576 : 1_000_000,
      outputTokens: 131_072,
      provider: OPENROUTER_GLM_PROVIDER_LOCK,
      vision: true,
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
