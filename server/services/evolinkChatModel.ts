/** EvoLink 文本模型 ID 白名单（https://docs.evolink.ai/en/api-manual/language-series/） */
export const EVOLINK_CHAT_MODEL_GPT55 = "gpt-5.5" as const;
export const EVOLINK_CHAT_MODEL_GPT54 = "gpt-5.4" as const;

const EVOLINK_CHAT_MODEL_ALIASES: Record<string, string> = {
  "gpt-5.5": EVOLINK_CHAT_MODEL_GPT55,
  gpt55: EVOLINK_CHAT_MODEL_GPT55,
  "gpt-5-5": EVOLINK_CHAT_MODEL_GPT55,
  "gpt-5.4": EVOLINK_CHAT_MODEL_GPT54,
  gpt54: EVOLINK_CHAT_MODEL_GPT54,
  "gpt-5-4": EVOLINK_CHAT_MODEL_GPT54,
};

/**
 * 将 env / 调用方传入的模型名规范为 EvoLink 支持的 chat model。
 * 未知值回退 `gpt-5.5`，避免 Azure deployment 404。
 */
export function normalizeEvolinkChatModel(raw?: string, fallback = EVOLINK_CHAT_MODEL_GPT55): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return fallback;
  const key = trimmed.toLowerCase();
  const mapped = EVOLINK_CHAT_MODEL_ALIASES[key];
  if (mapped) return mapped;
  if (key === EVOLINK_CHAT_MODEL_GPT55 || key === EVOLINK_CHAT_MODEL_GPT54) return key;
  console.warn(`[evolinkChatModel] unknown model "${trimmed}", fallback to ${fallback}`);
  return fallback;
}

export function isEvolinkChatModelNotFoundError(status: number, errorText: string): boolean {
  if (status === 404) return true;
  return /deployment to match the model|model not found|not_found_error/i.test(errorText);
}

export function isEvolinkInsufficientQuotaError(status: number, errorText: string): boolean {
  if (status === 402) return true;
  return /insufficient.?quota|insufficient_quota/i.test(errorText);
}

/** 服务端日志保留细节；面向用户请用 {@link toEvolinkChatUserMessage}。 */
export function formatEvolinkChatApiError(status: number, statusText: string, errorText: string): string {
  return `Evolink API error ${status}: ${statusText} – ${errorText.slice(0, 400)}`;
}

/** 自定义选题 / 文案链路：区分积分不足 vs 模型配置问题。 */
export function toEvolinkChatUserMessage(status: number, errorText: string): string {
  if (isEvolinkInsufficientQuotaError(status, errorText)) {
    return "EvoLink 账户积分不足，请前往控制台充值后再试（https://evolink.ai/dashboard/billing）";
  }
  if (isEvolinkChatModelNotFoundError(status, errorText)) {
    return "文案模型暂不可用（非积分问题），请稍后重试；若持续失败请联系管理员检查 EvoLink 模型配置";
  }
  if (status === 401 || /invalid or expired token|authentication_error/i.test(errorText)) {
    return "模型服务鉴权失败，请联系管理员检查 EvoLink API Key";
  }
  if (status === 429 || /rate.?limit/i.test(errorText)) {
    return "模型服务繁忙，请稍后再试";
  }
  return "文案生成暂时不可用，请稍后重试";
}
