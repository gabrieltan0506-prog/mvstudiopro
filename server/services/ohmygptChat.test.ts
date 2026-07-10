import { describe, expect, it, afterEach } from "vitest";
import {
  getOhMyGptChatCompletionsUrl,
  getOhMyGptGpt56SolModel,
  isOhMyGptGpt56SolFallbackEnabled,
  OHMYGPT_CHAT_MODEL_GPT56_SOL,
} from "./ohmygptChat";

describe("ohmygptChat", () => {
  afterEach(() => {
    delete process.env.OHMYGPT_API_KEY;
    delete process.env.PROXY_OPENAI_API_KEY;
    delete process.env.OHMYGPT_API_BASE;
    delete process.env.OHMYGPT_GPT56_SOL_MODEL;
    delete process.env.OHMYGPT_GPT56_SOL_FALLBACK;
  });

  it("uses OpenAI-compatible chat completions URL", () => {
    expect(getOhMyGptChatCompletionsUrl()).toBe("https://api.ohmygpt.com/v1/chat/completions");
    process.env.OHMYGPT_API_BASE = "https://apic.ohmygpt.com/v1/";
    expect(getOhMyGptChatCompletionsUrl()).toBe("https://apic.ohmygpt.com/v1/chat/completions");
  });

  it("defaults model to gpt-5.6-sol", () => {
    expect(getOhMyGptGpt56SolModel()).toBe(OHMYGPT_CHAT_MODEL_GPT56_SOL);
  });

  it("enables fallback when PROXY_OPENAI_API_KEY is set", () => {
    expect(isOhMyGptGpt56SolFallbackEnabled()).toBe(false);
    process.env.PROXY_OPENAI_API_KEY = "sk-test";
    expect(isOhMyGptGpt56SolFallbackEnabled()).toBe(true);
    process.env.OHMYGPT_GPT56_SOL_FALLBACK = "0";
    expect(isOhMyGptGpt56SolFallbackEnabled()).toBe(false);
  });
});
