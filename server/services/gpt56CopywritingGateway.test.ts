import { afterEach, describe, expect, it } from "vitest";
import { getVisualReportOpenAiModel } from "../config/platformSwitches.js";
import {
  EVOLINK_CHAT_COMPLETIONS_URL,
  isDirectOpenRouterModelSlug,
  OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL,
  OPENROUTER_CHAT_COMPLETIONS_URL,
  resolveGpt56CopywritingTarget,
  resolveGpt56EvolinkFallbackTarget,
  resolveGpt56OfficialOnlyTarget,
  resolveOpenRouterChatTarget,
  toOpenRouterGpt56Model,
} from "./gpt56CopywritingGateway.js";
import { OPENROUTER_KIMI_K3_MODEL } from "./openrouterKimiK3.js";
import { normalizeEvolinkChatModel } from "./evolinkChatModel.js";

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
    setEnv("EVOLINK_API_KEY", "evo-fallback");
    const t = resolveGpt56CopywritingTarget("gpt-5.6-sol");
    expect(t.gateway).toBe("openai_official");
    expect(t.apiUrl).toBe(OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL);
    expect(t.apiKey).toBe("sk-official");
    expect(t.modelName).toBe("gpt-5.6-sol");
  });

  it("falls back to EvoLink when official key missing", () => {
    setEnv("OPENAI_API_KEY", undefined);
    setEnv("OPENAI_CHAT_API_KEY", undefined);
    setEnv("EVOLINK_API_KEY", "evo-only");
    const t = resolveGpt56CopywritingTarget("gpt-5.6-terra");
    expect(t.gateway).toBe("evolink");
    expect(t.apiUrl).toBe(EVOLINK_CHAT_COMPLETIONS_URL);
    expect(t.apiKey).toBe("evo-only");
    expect(t.modelName).toBe("gpt-5.6-terra");
  });

  it("throws when neither OpenAI nor EvoLink key is configured", () => {
    setEnv("OPENAI_API_KEY", undefined);
    setEnv("OPENAI_CHAT_API_KEY", undefined);
    setEnv("EVOLINK_API_KEY", undefined);
    expect(() => resolveGpt56CopywritingTarget()).toThrow(/EVOLINK_API_KEY/);
  });

  it("normalizes sol/terra/luna", () => {
    expect(normalizeEvolinkChatModel("gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(normalizeEvolinkChatModel("gpt56luna")).toBe("gpt-5.6-luna");
    expect(toOpenRouterGpt56Model("gpt-5.6-luna")).toBe("openai/gpt-5.6-luna");
  });

  it("EvoLink fallback target keeps model id", () => {
    setEnv("EVOLINK_API_KEY", "evo-fb");
    const t = resolveGpt56EvolinkFallbackTarget("gpt-5.6-luna");
    expect(t.gateway).toBe("evolink");
    expect(t.modelName).toBe("gpt-5.6-luna");
  });

  it("detects direct OpenRouter vendor/model slugs (Kimi K3)", () => {
    expect(isDirectOpenRouterModelSlug("moonshotai/kimi-k3")).toBe(true);
    expect(isDirectOpenRouterModelSlug("openai/gpt-5.6-terra")).toBe(false);
    expect(isDirectOpenRouterModelSlug("gpt-5.6-terra")).toBe(false);
    setEnv("OPENROUTER_API_KEY", "sk-or-test-key");
    const t = resolveOpenRouterChatTarget("moonshotai/kimi-k3");
    expect(t.gateway).toBe("openrouter");
    expect(t.apiUrl).toBe(OPENROUTER_CHAT_COMPLETIONS_URL);
    expect(t.modelName).toBe("moonshotai/kimi-k3");
  });

  it("visual report defaults to OpenRouter Kimi K3", () => {
    delete process.env.PLATFORM_OPENROUTER_MODEL;
    delete process.env.VISUAL_REPORT_OPENROUTER_MODEL;
    delete process.env.VISUAL_REPORT_OPENAI_MODEL;
    expect(getVisualReportOpenAiModel()).toBe(OPENROUTER_KIMI_K3_MODEL);
  });

  it("official_only prefers api.openai.com when key present", () => {
    setEnv("OPENAI_API_KEY", "sk-terra-official");
    setEnv("EVOLINK_API_KEY", "evo-ignored-for-primary");
    const t = resolveGpt56OfficialOnlyTarget("gpt-5.6-terra");
    expect(t.gateway).toBe("openai_official");
    expect(t.apiUrl).toBe(OPENAI_OFFICIAL_CHAT_COMPLETIONS_URL);
    expect(t.modelName).toBe("gpt-5.6-terra");
  });

  it("official_only falls to EvoLink when OPENAI key missing", () => {
    setEnv("OPENAI_API_KEY", undefined);
    setEnv("OPENAI_CHAT_API_KEY", undefined);
    setEnv("EVOLINK_API_KEY", "evo-only");
    const t = resolveGpt56OfficialOnlyTarget("gpt-5.6-terra");
    expect(t.gateway).toBe("evolink");
    expect(t.modelName).toBe("gpt-5.6-terra");
  });
});
