import { migrateRetiredTextModel, PLATFORM_TEXT_MODEL } from "../../shared/textModelPolicy";

export { PLATFORM_TEXT_MODEL };
export const PLATFORM_TEXT_REASONING_EFFORT = "low" as const;
export const PLATFORM_TEXT_DEFAULT_MAX_COMPLETION_TOKENS = 32_768;
export const PLATFORM_TEXT_HARD_MAX_COMPLETION_TOKENS = 131_072;

/** 旧配置中的下架模型迁到现用模型；不读取或回传凭证。 */
export function getPlatformTextModel(): string {
  return migrateRetiredTextModel(process.env.PLATFORM_OPENROUTER_MODEL || process.env.VISUAL_REPORT_OPENROUTER_MODEL || process.env.VISUAL_REPORT_OPENAI_MODEL || PLATFORM_TEXT_MODEL);
}
export function resolvePlatformTextMaxCompletionTokens(envName = "PLATFORM_TEXT_MAX_COMPLETION_TOKENS"): number {
  const n = Number(process.env[envName]);
  return Number.isFinite(n) && n >= 4096 ? Math.min(PLATFORM_TEXT_HARD_MAX_COMPLETION_TOKENS, Math.floor(n)) : PLATFORM_TEXT_DEFAULT_MAX_COMPLETION_TOKENS;
}
