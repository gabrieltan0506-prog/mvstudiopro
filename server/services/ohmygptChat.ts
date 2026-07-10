/**
 * OhMyGPT chat（OpenAI 兼容）· 文案退路 gpt-5.6-sol
 * Docs: https://docs.ohmygpt.com/docs/api
 * Model: https://www.ohmygpt.com/models/gpt-5.6-sol
 *
 * 与 EvoLink 调用方式相同：`POST {base}/chat/completions` + Bearer + JSON body
 * （model / messages / reasoning_effort / max_completion_tokens / response_format）。
 */

export const OHMYGPT_CHAT_MODEL_GPT56_SOL = "gpt-5.6-sol" as const;

const DEFAULT_OHMYGPT_API_BASE = "https://api.ohmygpt.com/v1";

/** 与生图路径共用：优先 OHMYGPT_API_KEY，其次 PROXY_OPENAI_API_KEY（Fly 已配置）。 */
export function getOhMyGptApiKey(): string {
  return String(
    process.env.OHMYGPT_API_KEY ||
      process.env.PROXY_OPENAI_API_KEY ||
      process.env.OHMYGPT_KEY ||
      "",
  ).trim();
}

export function getOhMyGptChatCompletionsUrl(): string {
  const base = String(process.env.OHMYGPT_API_BASE || DEFAULT_OHMYGPT_API_BASE)
    .trim()
    .replace(/\/$/, "");
  return `${base || DEFAULT_OHMYGPT_API_BASE}/chat/completions`;
}

export function getOhMyGptGpt56SolModel(): string {
  const raw = String(process.env.OHMYGPT_GPT56_SOL_MODEL || OHMYGPT_CHAT_MODEL_GPT56_SOL).trim();
  return raw || OHMYGPT_CHAT_MODEL_GPT56_SOL;
}

export function isOhMyGptChatConfigured(): boolean {
  return Boolean(getOhMyGptApiKey());
}

/** EvoLink gpt-5.5 主路径失败后，是否允许改走 OhMyGPT gpt-5.6-sol。默认开启。 */
export function isOhMyGptGpt56SolFallbackEnabled(): boolean {
  const v = String(process.env.OHMYGPT_GPT56_SOL_FALLBACK || "1").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return isOhMyGptChatConfigured();
}
