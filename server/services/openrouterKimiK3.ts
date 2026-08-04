/**
 * 平台文案 / 趋势报表：OpenRouter Kimi K3（直连，不走 GPT-5.6）。
 * 参数对齐官方 / Evolink 文档对照：reasoning_effort=max，max_completion_tokens 默认 131072。
 * Refs:
 *   https://openrouter.ai/moonshotai/kimi-k3
 *   https://platform.kimi.ai/docs/guide/kimi-k3-quickstart
 *   https://evolink.ai/docs/en/api-manual/language-series/kimi-k3/kimi-k3-chat（仅参数对照）
 */

export const OPENROUTER_KIMI_K3_MODEL = "moonshotai/kimi-k3" as const;

/** Kimi K3：OpenRouter / 官方文档默认与最大档均为 max */
export const OPENROUTER_KIMI_K3_REASONING_EFFORT = "max" as const;

/** 文档默认 131072；推理 token 计入此上限 */
export const OPENROUTER_KIMI_K3_DEFAULT_MAX_COMPLETION_TOKENS = 131_072;

/** 文档上限 1048576（慎用：贵且慢） */
export const OPENROUTER_KIMI_K3_HARD_MAX_COMPLETION_TOKENS = 1_048_576;

export function isOpenRouterKimiK3Model(raw?: string | null): boolean {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  if (!key) return false;
  if (key === OPENROUTER_KIMI_K3_MODEL) return true;
  if (key === "kimi-k3" || key === "moonshotai/kimi-k3") return true;
  if (key.endsWith("/kimi-k3")) return true;
  return false;
}

/** 解析平台 Kimi 输出上限：默认 131072，可用 env 覆盖，封顶文档硬上限。 */
export function resolveOpenRouterKimiK3MaxCompletionTokens(envName?: string): number {
  const fromEnv = Number(process.env[envName || "PLATFORM_KIMI_K3_MAX_COMPLETION_TOKENS"] || "");
  if (Number.isFinite(fromEnv) && fromEnv >= 4096) {
    return Math.min(OPENROUTER_KIMI_K3_HARD_MAX_COMPLETION_TOKENS, Math.floor(fromEnv));
  }
  return OPENROUTER_KIMI_K3_DEFAULT_MAX_COMPLETION_TOKENS;
}

/** 平台默认模型：OpenRouter Kimi K3（可用 PLATFORM_OPENROUTER_MODEL / VISUAL_REPORT_OPENROUTER_MODEL 覆盖）。 */
export function getOpenRouterKimiK3Model(): string {
  const raw = String(
    process.env.PLATFORM_OPENROUTER_MODEL ||
      process.env.VISUAL_REPORT_OPENROUTER_MODEL ||
      process.env.VISUAL_REPORT_OPENAI_MODEL ||
      OPENROUTER_KIMI_K3_MODEL,
  ).trim();
  return raw || OPENROUTER_KIMI_K3_MODEL;
}
