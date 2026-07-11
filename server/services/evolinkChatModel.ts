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

export type EvolinkChatModelId = typeof EVOLINK_CHAT_MODEL_GPT55 | typeof EVOLINK_CHAT_MODEL_GPT54;

/**
 * 将 env / 调用方传入的模型名规范为 EvoLink 支持的 chat model。
 * 未知值回退 `gpt-5.5`，避免 Azure deployment 404。
 * `fallback` 显式放宽为 `string`，避免默认字面量 `"gpt-5.5"` 导致传入 `"gpt-5.4"` 时 TS2345。
 */
export function normalizeEvolinkChatModel(
  raw?: string,
  fallback: string = EVOLINK_CHAT_MODEL_GPT55,
): string {
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
  // OhMyGPT / 各代理常把余额耗尽写成 403/429 或中文「余额/额度」
  return /insufficient.?quota|insufficient_quota|quota.?exceeded|out of credits|no (?:remaining )?credits|balance.?insufficient|余额不足|额度不足|积分不足|账户余额|billing|payment.?required/i.test(
    errorText,
  );
}

/** OhMyGPT 侧已确定不可用（额度/鉴权）时，不必再打同账号 Terra。 */
export function shouldSkipOhMyGptSameAccountFallback(status: number, errorText: string): boolean {
  if (isEvolinkInsufficientQuotaError(status, errorText)) return true;
  if (status === 401 || /invalid or expired token|authentication_error/i.test(errorText)) return true;
  return false;
}

/** 服务端日志保留细节；面向用户请用 {@link toEvolinkChatUserMessage}。 */
export function formatEvolinkChatApiError(status: number, statusText: string, errorText: string): string {
  return `Evolink API error ${status}: ${statusText} – ${errorText.slice(0, 400)}`;
}

export type OpenAiCompatibleChatProviderLabel = "Evolink" | "OhMyGPT" | "OpenAI";

/**
 * 自定义选题 / 文案链路：区分积分不足 vs 模型配置问题。
 * `providerLabel` 决定鉴权失败时提示哪家密钥（OhMyGPT 401 不应再写 EvoLink）。
 */
export function toOpenAiCompatibleChatUserMessage(
  status: number,
  errorText: string,
  providerLabel: OpenAiCompatibleChatProviderLabel = "Evolink",
): string {
  if (isEvolinkInsufficientQuotaError(status, errorText)) {
    if (providerLabel === "OhMyGPT") {
      return "OhMyGPT 账户额度不足，请前往控制台充值后再试";
    }
    return "EvoLink 账户积分不足，请前往控制台充值后再试（https://evolink.ai/dashboard/billing）";
  }
  if (isEvolinkChatModelNotFoundError(status, errorText)) {
    return "文案模型暂不可用（非积分问题），请稍后重试";
  }
  if (status === 401 || /invalid or expired token|authentication_error/i.test(errorText)) {
    if (providerLabel === "OhMyGPT") {
      return "模型服务鉴权失败，请联系管理员检查 OhMyGPT / PROXY_OPENAI API Key";
    }
    return "模型服务鉴权失败，请联系管理员检查 EvoLink API Key";
  }
  if (status === 429 || /rate.?limit/i.test(errorText)) {
    return "模型服务繁忙，请稍后再试";
  }
  return "文案生成暂时不可用，请稍后重试";
}

/** @deprecated 请优先用 {@link toOpenAiCompatibleChatUserMessage}；保留旧名以免外部引用断裂。 */
export function toEvolinkChatUserMessage(status: number, errorText: string): string {
  return toOpenAiCompatibleChatUserMessage(status, errorText, "Evolink");
}
