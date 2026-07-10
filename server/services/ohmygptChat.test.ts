import { describe, expect, it, afterEach } from "vitest";
import {
  getOhMyGptChatCompletionsUrl,
  getOhMyGptGpt56SolModel,
  getOhMyGptGpt56TerraModel,
  isOhMyGptGpt56FamilyModel,
  isOhMyGptGpt56TerraFallbackEnabled,
  normalizeOhMyGptGpt56Model,
  OHMYGPT_CHAT_MODEL_GPT56_SOL,
  OHMYGPT_CHAT_MODEL_GPT56_TERRA,
} from "./ohmygptChat";

describe("ohmygptChat GPT-5.6", () => {
  afterEach(() => {
    delete process.env.OHMYGPT_API_KEY;
    delete process.env.PROXY_OPENAI_API_KEY;
    delete process.env.OHMYGPT_API_BASE;
    delete process.env.OHMYGPT_GPT56_SOL_MODEL;
    delete process.env.OHMYGPT_GPT56_TERRA_MODEL;
    delete process.env.OHMYGPT_GPT56_TERRA_FALLBACK;
    delete process.env.PLATFORM_STAGE2_OPENAI_MODEL;
  });

  it("uses OpenAI-compatible chat completions URL", () => {
    expect(getOhMyGptChatCompletionsUrl()).toBe("https://api.ohmygpt.com/v1/chat/completions");
    process.env.OHMYGPT_API_BASE = "https://apic.ohmygpt.com/v1/";
    expect(getOhMyGptChatCompletionsUrl()).toBe("https://apic.ohmygpt.com/v1/chat/completions");
  });

  it("defaults primary to gpt-5.6-sol and fallback to gpt-5.6-terra", () => {
    expect(getOhMyGptGpt56SolModel()).toBe(OHMYGPT_CHAT_MODEL_GPT56_SOL);
    expect(getOhMyGptGpt56TerraModel()).toBe(OHMYGPT_CHAT_MODEL_GPT56_TERRA);
    expect(normalizeOhMyGptGpt56Model("gpt-5.6")).toBe(OHMYGPT_CHAT_MODEL_GPT56_SOL);
  });

  it("detects GPT-5.6 family model ids", () => {
    expect(isOhMyGptGpt56FamilyModel("gpt-5.6-sol")).toBe(true);
    expect(isOhMyGptGpt56FamilyModel("gpt-5.6-terra")).toBe(true);
    expect(isOhMyGptGpt56FamilyModel("gpt-5.5")).toBe(false);
  });

  it("enables terra fallback when PROXY_OPENAI_API_KEY is set", () => {
    expect(isOhMyGptGpt56TerraFallbackEnabled()).toBe(false);
    process.env.PROXY_OPENAI_API_KEY = "sk-test";
    expect(isOhMyGptGpt56TerraFallbackEnabled()).toBe(true);
    process.env.OHMYGPT_GPT56_TERRA_FALLBACK = "0";
    expect(isOhMyGptGpt56TerraFallbackEnabled()).toBe(false);
  });
});
