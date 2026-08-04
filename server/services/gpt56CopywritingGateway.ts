/**
 * GPT-5.6 平台文案网关：OpenAI 官方优先，OpenRouter fallback。
 *
 * 临时（2026-08）：当前 OpenRouter 账号对 openai/gpt-5.6-* 返回 ToS 403，
 * 且官方额度不足 → Sol 文案默认改走 OpenRouter Kimi K3。
 * 恢复后设 `GPT56_COPY_USE_KIMI=0`。
 */

import {
  EVOLINK_CHAT_MODEL_GPT56_SOL,
  getEvolinkGpt56SolModel,
  normalizeEvolinkChatModel,
} from "./evolinkChatModel.js";
import { getOpenRouterApiKey } from "./openrouterGptImage2.js";
import { getOpenRouterKimiK3Model } from "./openrouterKimiK3.js";

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

/**
 * 非 OpenAI GPT-5.6 的 OpenRouter `vendor/model` slug（如 `moonshotai/kimi-k3`）应直连 OpenRouter，
 * 勿再走官方 OpenAI / Evolink 归一。
 * `openai/gpt-5.6-*` 仍走「官方优先 → OpenRouter fallback」。
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

/**
 * Sol/GPT-5.6 文案是否改走 Kimi（默认开）。
 * `GPT56_COPY_USE_KIMI=0|false|off` 可恢复「官方 Sol → OpenRouter Sol」。
 */
export function shouldRouteGpt56CopywritingViaKimi(): boolean {
  const raw = String(process.env.GPT56_COPY_USE_KIMI ?? "1").trim().toLowerCase();
  return raw !== "0" && raw !== "false" && raw !== "off" && raw !== "no";
}

/** OpenRouter 侧 GPT-5.6 不可用时的文案 fallback 模型。 */
export function resolveGpt56OpenRouterFallbackModel(modelNameHint?: string): string {
  if (shouldRouteGpt56CopywritingViaKimi()) {
    return getOpenRouterKimiK3Model();
  }
  return toOpenRouterGpt56Model(modelNameHint || getEvolinkGpt56SolModel());
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
  /** 临时：Sol 官方额度空 + OpenRouter OpenAI ToS → 直连 Kimi */
  if (shouldRouteGpt56CopywritingViaKimi()) {
    return resolveOpenRouterChatTarget(getOpenRouterKimiK3Model());
  }
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

/**
 * 强制仅 OpenAI 官方（`api.openai.com`）：用于 gpt-5.6-terra / 趋势报表等。
 * **禁止** Evolink / OpenRouter。
 */
export function resolveGpt56OfficialOnlyTarget(modelNameHint?: string): Gpt56CopywritingTarget {
  const modelName = normalizeEvolinkChatModel(
    modelNameHint || getEvolinkGpt56SolModel(),
    EVOLINK_CHAT_MODEL_GPT56_SOL,
  );
  const officialKey = getOfficialOpenAiApiKey();
  if (!officialKey) {
    throw new Error(
      "OPENAI_API_KEY（或 OPENAI_CHAT_API_KEY）未配置：gpt-5.6-terra / 官方专线须走 api.openai.com，不走 Evolink/OpenRouter",
    );
  }
  return {
    gateway: "openai_official",
    apiUrl: OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL,
    apiKey: officialKey,
    modelName,
  };
}
