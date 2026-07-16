/**
 * GPT-5.6 平台文案网关：OpenAI 官方优先，Evolink fallback。
 */

import {
  EVOLINK_CHAT_MODEL_GPT56_SOL,
  getEvolinkGpt56SolModel,
  normalizeEvolinkChatModel,
} from "./evolinkChatModel.js";

export const OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL = "https://api.openai.com/v1/chat/completions";
export const EVOLINK_CHAT_COMPLETIONS_URL = "https://direct.evolink.ai/v1/chat/completions";

export type Gpt56CopywritingGateway = "openai_official" | "evolink";

export type Gpt56CopywritingTarget = {
  gateway: Gpt56CopywritingGateway;
  apiUrl: string;
  apiKey: string;
  modelName: string;
};

export function getOfficialOpenAiApiKey(): string {
  return String(process.env.OPENAI_API_KEY || process.env.OPENAI_CHAT_API_KEY || "").trim();
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

/** 解析 GPT-5.6 文案应打的网关（不发请求）。 */
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
    "OPENAI_API_KEY（或 OPENAI_CHAT_API_KEY）与 EVOLINK_API_KEY 均未配置（GPT-5.6 文案：官方 OpenAI 优先，Evolink fallback）",
  );
}
