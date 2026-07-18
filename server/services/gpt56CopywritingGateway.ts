/**
 * GPT-5.6 平台文案网关：OpenAI 官方优先，OpenRouter fallback。
 */

import {
  EVOLINK_CHAT_MODEL_GPT56_SOL,
  getEvolinkGpt56SolModel,
  normalizeEvolinkChatModel,
} from "./evolinkChatModel.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";

export const OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
/** @deprecated 文案主路径已改 OpenRouter；保留常量供旧测/非 5.6 路径引用 */
export const EVOLINK_CHAT_COMPLETIONS_URL = "https://direct.evolink.ai/v1/chat/completions";
export const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export type Gpt56CopywritingGateway = "openai_official" | "openrouter";

export type Gpt56CopywritingTarget = {
  gateway: Gpt56CopywritingGateway;
  apiUrl: string;
  apiKey: string;
  modelName: string;
};

export function getOfficialOpenAiApiKey(): string {
  const raw = String(process.env.OPENAI_API_KEY || process.env.OPENAI_CHAT_API_KEY || "").trim();
  if (!raw || !/^sk-[A-Za-z0-9]/.test(raw)) return "";
  return raw;
}

/** @deprecated 文案 fallback 已改 OpenRouter；非 5.6 路径仍可能读 EVOLINK */
export function getEvolinkApiKey(): string {
  return String(process.env.EVOLINK_API_KEY || "").trim();
}

export function isOfficialOpenAiChatEndpoint(apiUrl?: string): boolean {
  return String(apiUrl || "").toLowerCase().includes("api.openai.com");
}

export function isEvolinkChatEndpoint(apiUrl?: string): boolean {
  return String(apiUrl || "").toLowerCase().includes("evolink.ai");
}

export function isOpenRouterChatEndpoint(apiUrl?: string): boolean {
  return String(apiUrl || "").toLowerCase().includes("openrouter.ai");
}

/** OpenRouter 侧模型 slug：`gpt-5.6-sol` → `openai/gpt-5.6-sol` */
export function toOpenRouterGpt56Model(modelName: string): string {
  const raw = String(modelName || "").trim();
  if (!raw) return "openai/gpt-5.6-sol";
  if (raw.includes("/")) return raw;
  return `openai/${raw}`;
}

export function getOpenRouterChatHeaders(): Record<string, string> {
  const referer = String(
    process.env.OPENROUTER_HTTP_REFERER || process.env.APP_URL || "https://www.mvstudiopro.com",
  )
    .trim()
    .replace(/\/+$/, "");
  const title = String(process.env.OPENROUTER_APP_TITLE || "MV Studio Pro").trim() || "MV Studio Pro";
  return {
    "HTTP-Referer": referer || "https://www.mvstudiopro.com",
    "X-Title": title,
  };
}

/** 解析 GPT-5.6 文案应打的网关（不发请求）：官方 OpenAI → OpenRouter。 */
export function resolveGpt56CopywritingTarget(modelNameHint?: string): Gpt56CopywritingTarget {
  const modelName = normalizeEvolinkChatModel(
    modelNameHint || getEvolinkGpt56SolModel(),
    EVOLINK_CHAT_MODEL_GPT56_SOL,
  );
  const officialKey = getOfficialOpenAiApiKey();
  if (officialKey) {
    return {
      gateway: "openai_official",
      apiUrl: OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL,
      apiKey: officialKey,
      modelName,
    };
  }
  const openrouterKey = getOpenRouterApiKey();
  if (openrouterKey) {
    return {
      gateway: "openrouter",
      apiUrl: OPENROUTER_CHAT_COMPLETIONS_URL,
      apiKey: openrouterKey,
      modelName: toOpenRouterGpt56Model(modelName),
    };
  }
  throw new Error(
    "OPENAI_API_KEY（或 OPENAI_CHAT_API_KEY）与 OPENROUTER_API_KEY 均未配置（GPT-5.6 文案：官方 OpenAI 优先，OpenRouter fallback）",
  );
}
