import { afterEach, describe, expect, it } from "vitest";
import {
  OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL,
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveGpt56CopywritingTarget,
  toOpenRouterGpt56Model,
} from "./gpt56CopywritingGateway.js";

const ENV_KEYS = [
  "OPENAI_API_KEY",
  "OPENAI_CHAT_API_KEY",
  "OPENROUTER_API_KEY",
  "EVOLINK_API_KEY",
  "PLATFORM_STAGE2_OPENAI_MODEL",
] as const;

describe("resolveGpt56CopywritingTarget", () => {
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
      delete saved[k];
    }
  });

  function setEnv(key: (typeof ENV_KEYS)[number], value: string | undefined) {
    if (!(key in saved)) saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  it("prefers official OpenAI when OPENAI_API_KEY is set", () => {
    setEnv("OPENAI_API_KEY", "sk-official");
    setEnv("OPENROUTER_API_KEY", "sk-or-fallback");
    const t = resolveGpt56CopywritingTarget("gpt-5.6-sol");
    expect(t.gateway).toBe("openai_official");
    expect(t.apiUrl).toBe(OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL);
    expect(t.apiKey).toBe("sk-official");
    expect(t.modelName).toBe("gpt-5.6-sol");
  });

  it("falls back to OpenRouter when official key missing", () => {
    setEnv("OPENAI_API_KEY", undefined);
    setEnv("OPENAI_CHAT_API_KEY", undefined);
    setEnv("OPENROUTER_API_KEY", "sk-or-only");
    const t = resolveGpt56CopywritingTarget();
    expect(t.gateway).toBe("openrouter");
    expect(t.apiUrl).toBe(OPENROUTER_CHAT_COMPLETIONS_URL);
    expect(t.apiKey).toBe("sk-or-only");
    expect(t.modelName).toBe("openai/gpt-5.6-sol");
  });

  it("throws when neither OpenAI nor OpenRouter key is configured", () => {
    setEnv("OPENAI_API_KEY", undefined);
    setEnv("OPENAI_CHAT_API_KEY", undefined);
    setEnv("OPENROUTER_API_KEY", undefined);
    expect(() => resolveGpt56CopywritingTarget()).toThrow(/OPENROUTER_API_KEY/);
  });

  it("maps OpenRouter model slug", () => {
    expect(toOpenRouterGpt56Model("gpt-5.6-sol")).toBe("openai/gpt-5.6-sol");
    expect(toOpenRouterGpt56Model("openai/gpt-5.6-terra")).toBe("openai/gpt-5.6-terra");
  });
});
