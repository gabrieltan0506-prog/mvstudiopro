/**
 * OhMyGPT chat（OpenAI 兼容）· 平台全案文案 GPT-5.6
 * Docs: https://docs.ohmygpt.com/docs/api
 * Models:
 *   https://www.ohmygpt.com/models/gpt-5.6-sol
 *   https://developers.openai.com/api/docs/models/gpt-5.6-sol
 *   https://developers.openai.com/api/docs/guides/latest-model
 *
 * 与 EvoLink 调用方式相同：`POST {base}/chat/completions` + Bearer + JSON body
 * （model / messages / reasoning_effort / max_completion_tokens / response_format）。
 * 图片生成仍走 EvoLink gpt-image-2，不经本模块。
 */

export const OHMYGPT_CHAT_MODEL_GPT56_SOL = "gpt-5.6-sol" as const;
export const OHMYGPT_CHAT_MODEL_GPT56_TERRA = "gpt-5.6-terra" as const;
/** OpenAI 官方 alias：路由到 Sol */
export const OHMYGPT_CHAT_MODEL_GPT56_ALIAS = "gpt-5.6" as const;

const DEFAULT_OHMYGPT_API_BASE = "https://api.ohmygpt.com/v1";

const GPT56_ALIASES: Record<string, string> = {
  "gpt-5.6": OHMYGPT_CHAT_MODEL_GPT56_SOL,
  "gpt-5.6-sol": OHMYGPT_CHAT_MODEL_GPT56_SOL,
  gpt56sol: OHMYGPT_CHAT_MODEL_GPT56_SOL,
  "gpt-5.6-terra": OHMYGPT_CHAT_MODEL_GPT56_TERRA,
  gpt56terra: OHMYGPT_CHAT_MODEL_GPT56_TERRA,
  "gpt-5.6-luna": "gpt-5.6-luna",
};

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

export function isOhMyGptChatConfigured(): boolean {
  return Boolean(getOhMyGptApiKey());
}

/** 是否为 OhMyGPT / 其 CDN 网关（用于 fallback 与错误文案分流）。 */
export function isOhMyGptChatEndpoint(apiUrl?: string): boolean {
  const u = String(apiUrl || "").toLowerCase();
  return (
    u.includes("ohmygpt.com") ||
    u.includes("ohmycdn.com") ||
    u.includes("hash070.com") ||
    u.includes("opapi.win")
  );
}

export function isOhMyGptGpt56FamilyModel(raw?: string): boolean {
  const key = String(raw || "")
    .trim()
    .toLowerCase();
  if (!key) return false;
  return Boolean(GPT56_ALIASES[key]) || /^gpt-5\.6(-sol|-terra|-luna)?$/i.test(key);
}

/** 规范为 OhMyGPT / OpenAI 官方 GPT-5.6 系列 model id。 */
export function normalizeOhMyGptGpt56Model(
  raw?: string,
  fallback: string = OHMYGPT_CHAT_MODEL_GPT56_SOL,
): string {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return fallback;
  const key = trimmed.toLowerCase();
  const mapped = GPT56_ALIASES[key];
  if (mapped) return mapped;
  if (/^gpt-5\.6(-sol|-terra|-luna)?$/i.test(key)) return key;
  console.warn(`[ohmygptChat] unknown GPT-5.6 model "${trimmed}", fallback to ${fallback}`);
  return fallback;
}

/** 平台全案 / Stage2 文案主模型：固定 gpt-5.6-sol（可用 OHMYGPT_GPT56_SOL_MODEL 覆盖）。 */
export function getOhMyGptGpt56SolModel(): string {
  return normalizeOhMyGptGpt56Model(
    process.env.OHMYGPT_GPT56_SOL_MODEL ||
      process.env.PLATFORM_STAGE2_OPENAI_MODEL ||
      OHMYGPT_CHAT_MODEL_GPT56_SOL,
    OHMYGPT_CHAT_MODEL_GPT56_SOL,
  );
}

/** Sol 失败后的同网关退路：gpt-5.6-terra。 */
export function getOhMyGptGpt56TerraModel(): string {
  return normalizeOhMyGptGpt56Model(
    process.env.OHMYGPT_GPT56_TERRA_MODEL || OHMYGPT_CHAT_MODEL_GPT56_TERRA,
    OHMYGPT_CHAT_MODEL_GPT56_TERRA,
  );
}

/** Sol 主路径失败后是否允许改走 Terra。默认开启（需已配置 OhMyGPT key）。 */
export function isOhMyGptGpt56TerraFallbackEnabled(): boolean {
  const v = String(process.env.OHMYGPT_GPT56_TERRA_FALLBACK || "1").trim().toLowerCase();
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  return isOhMyGptChatConfigured();
}

/** @deprecated 使用 {@link isOhMyGptGpt56TerraFallbackEnabled}；保留旧名以免外部引用断裂。 */
export function isOhMyGptGpt56SolFallbackEnabled(): boolean {
  return isOhMyGptGpt56TerraFallbackEnabled();
}
