/** 漫剧顾问模型，使用固定版本；不受平台知识卡模型环境配置影响。 */
export const OPENROUTER_DEEPSEEK_V41_FLASH_MODEL = "deepseek/deepseek-v4.1-flash";
export const MANHUA_ADVISOR_REASONING_EFFORT = "low" as const;
/** 推理与正文共用预算；保留足够空间输出完整轨迹 JSON。 */
export const MANHUA_ADVISOR_MAX_OUTPUT_TOKENS = 32_768;

export function isOpenRouterDeepSeekV41FlashModel(model: string): boolean {
  return model.trim().toLowerCase() === OPENROUTER_DEEPSEEK_V41_FLASH_MODEL;
}

/** 0929 用户指定 GLM 优先、DeepSeek 备选；OpenRouter GLM 在传输层锁 Z.AI。一次咨询最多四跳，不另开额度或扣费。 */
export const MANHUA_ADVISOR_HOPS = [
  { modelName: "z-ai/glm-5.3-flashx", gateway: "auto", label: "GLM 5.3 FlashX · OpenRouter" },
  { modelName: "glm-5.3-flashx", gateway: "evolink_flash_only", label: "GLM 5.3 FlashX · EvoLink" },
  { modelName: OPENROUTER_DEEPSEEK_V41_FLASH_MODEL, gateway: "auto", label: "DeepSeek V4.1 Flash · OpenRouter" },
  { modelName: "deepseek-v4.1-flash", gateway: "evolink_flash_only", label: "DeepSeek V4.1 Flash · EvoLink" },
] as const;

/** 顾问需尽快给出可验候选；DeepSeek 关闭思考，强制思考的 GLM 用低档。 */
export function manhuaAdvisorReasoningEffort(modelName: string): "none" | "low" {
  return modelName === OPENROUTER_DEEPSEEK_V41_FLASH_MODEL || modelName === "deepseek-v4.1-flash"
    ? "none" : MANHUA_ADVISOR_REASONING_EFFORT;
}
