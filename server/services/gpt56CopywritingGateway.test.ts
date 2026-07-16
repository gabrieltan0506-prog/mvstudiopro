import { afterEach, describe, expect, it } from "vitest";
import {
  EVOLINK_CHAT_COMPLETIONS_URL,
  OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL,
  resolveGpt56CopywritingTarget,
} from "./gpt56CopywritingGateway.js";

const ENV_KEYS = ["OPENAI_API_KEY", "OPENAI_CHAT_API_KEY", "EVOLINK_API_KEY", "PLATFORM_STAGE2_OPENAI_MODEL"] as const;

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
    setEnv("EVOLINK_API_KEY", "ev-fallback");
    const t = resolveGpt56CopywritingTarget("gpt-5.6-sol");
    expect(t.gateway).toBe("openai_official");
    expect(t.apiUrl).toBe(OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL);
    expect(t.apiKey).toBe("sk-official");
    expect(t.modelName).toBe("gpt-5.6-sol");
  });

  it("falls back to Evolink when official key missing", () => {
    setEnv("OPENAI_API_KEY", undefined);
    setEnv("OPENAI_CHAT_API_KEY", undefined);
    setEnv("EVOLINK_API_KEY", "ev-only");
    const t = resolveGpt56CopywritingTarget();
    expect(t.gateway).toBe("evolink");
    expect(t.apiUrl).toBe(EVOLINK_CHAT_COMPLETIONS_URL);
    expect(t.apiKey).toBe("ev-only");
  });

  it("throws when neither key is configured", () => {
    setEnv("OPENAI_API_KEY", undefined);
    setEnv("OPENAI_CHAT_API_KEY", undefined);
    setEnv("EVOLINK_API_KEY", undefined);
    expect(() => resolveGpt56CopywritingTarget()).toThrow(/OPENAI_API_KEY/);
  });
});
