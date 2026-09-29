/** 漫剧顾问模型，使用固定版本；不受平台知识卡模型环境配置影响。 */
export const OPENROUTER_DEEPSEEK_V41_FLASH_MODEL = "deepseek/deepseek-v4.1-flash";
export const MANHUA_ADVISOR_REASONING_EFFORT = "high" as const;
/** 推理与正文共用预算；保留足够空间输出完整轨迹 JSON。 */
export const MANHUA_ADVISOR_MAX_OUTPUT_TOKENS = 32_768;

export function isOpenRouterDeepSeekV41FlashModel(model: string): boolean {
  return model.trim().toLowerCase() === OPENROUTER_DEEPSEEK_V41_FLASH_MODEL;
}
