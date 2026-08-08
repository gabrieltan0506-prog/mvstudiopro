/**
 * GPT-5.6（sol / terra / luna）平台文案网关：
 * OpenAI 官方优先 → EvoLink fallback（含主路径超时切备胎）。
 */

import {
  EVOLINK_CHAT_MODEL_GPT56_SOL,
  getEvolinkGpt56SolModel,
  normalizeEvolinkChatModel,
} from "./evolinkChatModel.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";

export const OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const EVOLINK_CHAT_COMPLETIONS_URL = "https://direct.evolink.ai/v1/chat/completions";
export const OPENROUTER_CHAT_COMPLETIONS_URL = "https://openrouter.ai/api/v1/chat/completions";

export type Gpt56CopywritingGateway = "openai_official" | "evolink" | "openrouter";

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

/** OpenRouter 侧模型 slug：`gpt-5.6-sol` → `openai/gpt-5.6-sol`（非 5.6 主链；保留兼容） */
export function toOpenRouterGpt56Model(modelName: string): string {
  const raw = String(modelName || "").trim();
  if (!raw) return "openai/gpt-5.6-sol";
  if (raw.includes("/")) return raw;
  return `openai/${raw}`;
}

/**
 * 非 OpenAI GPT-5.6 的 OpenRouter `vendor/model` slug（如 `moonshotai/kimi-k3`）应直连 OpenRouter，
 * 勿再走官方 OpenAI / Evolink 归一。
 */
export function isDirectOpenRouterModelSlug(raw?: string): boolean {
  const s = String(raw || "").trim();
  if (!s || !s.includes("/")) return false;
  if (/^openai\/gpt-5\.6/i.test(s)) return false;
  return /^[a-z0-9._-]+\/[a-z0-9._:-]+$/i.test(s);
}

/** 强制 OpenRouter chat completions（需 OPENROUTER_API_KEY）。 */
export function resolveOpenRouterChatTarget(modelName: string): Gpt56CopywritingTarget {
  const openrouterKey = getOpenRouterApiKey();
  if (!openrouterKey) {
    throw new Error("OPENROUTER_API_KEY 未配置：无法调用 OpenRouter 模型");
  }
  const raw = String(modelName || "").trim();
  if (!raw) {
    throw new Error("OpenRouter modelName 为空");
  }
  return {
    gateway: "openrouter",
    apiUrl: OPENROUTER_CHAT_COMPLETIONS_URL,
    apiKey: openrouterKey,
    modelName: raw,
  };
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

/** EvoLink GPT-5.6 fallback 目标（与主路径同 model id：sol/terra/luna）。 */
export function resolveGpt56EvolinkFallbackTarget(modelNameHint?: string): Gpt56CopywritingTarget {
  const modelName = normalizeEvolinkChatModel(
    modelNameHint || getEvolinkGpt56SolModel(),
    EVOLINK_CHAT_MODEL_GPT56_SOL,
  );
  const evolinkKey = getEvolinkApiKey();
  if (!evolinkKey) {
    throw new Error("EVOLINK_API_KEY 未配置：无法回落 EvoLink GPT-5.6");
  }
  return {
    gateway: "evolink",
    apiUrl: EVOLINK_CHAT_COMPLETIONS_URL,
    apiKey: evolinkKey,
    modelName,
  };
}

/**
 * 解析 GPT-5.6 文案应打的网关（不发请求）：
 * OpenAI 官方 →（无官方钥则）EvoLink。
 */
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
  const evolinkKey = getEvolinkApiKey();
  if (evolinkKey) {
    return {
      gateway: "evolink",
      apiUrl: EVOLINK_CHAT_COMPLETIONS_URL,
      apiKey: evolinkKey,
      modelName,
    };
  }
  throw new Error(
    "OPENAI_API_KEY（或 OPENAI_CHAT_API_KEY）与 EVOLINK_API_KEY 均未配置（GPT-5.6：官方 OpenAI 优先，EvoLink fallback）",
  );
}

/**
 * 主解析仍钉官方 OpenAI（画布 Terra 等）。
 * 运行时失败/超时仍由 invokeLLM 回落 EvoLink（体验优先）。
 */
export function resolveGpt56OfficialOnlyTarget(modelNameHint?: string): Gpt56CopywritingTarget {
  const modelName = normalizeEvolinkChatModel(
    modelNameHint || getEvolinkGpt56SolModel(),
    EVOLINK_CHAT_MODEL_GPT56_SOL,
  );
  const officialKey = getOfficialOpenAiApiKey();
  if (!officialKey) {
    // 无官方钥时直接给 EvoLink，避免整条链路硬死
    return resolveGpt56EvolinkFallbackTarget(modelName);
  }
  return {
    gateway: "openai_official",
    apiUrl: OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL,
    apiKey: officialKey,
    modelName,
  };
}
