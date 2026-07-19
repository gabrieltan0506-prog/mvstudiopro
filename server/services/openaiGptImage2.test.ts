import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  getOpenAiImageApiKey,
  isOpenAiGptImage2Configured,
  OPENAI_GPT_IMAGE2_SNAPSHOT_DEFAULT,
  resolveOpenAiGptImage2Model,
} from "./openaiGptImage2.js";

const KEYS = ["OPENAI_IMAGE_API_KEY", "OPENAI_API_KEY", "OPENAI_GPT_IMAGE2_MODEL"] as const;

describe("openaiGptImage2 config", () => {
  const prev: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) {
      prev[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  });

  it("defaults generations/edits model to gpt-image-2-2026-04-21 snapshot", () => {
    expect(resolveOpenAiGptImage2Model()).toBe(OPENAI_GPT_IMAGE2_SNAPSHOT_DEFAULT);
    expect(resolveOpenAiGptImage2Model()).toBe("gpt-image-2-2026-04-21");
  });

  it("OPENAI_GPT_IMAGE2_MODEL can pin alias or snapshot", () => {
    process.env.OPENAI_GPT_IMAGE2_MODEL = "gpt-image-2";
    expect(resolveOpenAiGptImage2Model()).toBe("gpt-image-2");
    process.env.OPENAI_GPT_IMAGE2_MODEL = "gpt-image-2-2026-04-21";
    expect(resolveOpenAiGptImage2Model()).toBe("gpt-image-2-2026-04-21");
  });

  it("ignores invalid OPENAI_GPT_IMAGE2_MODEL and falls back to snapshot", () => {
    process.env.OPENAI_GPT_IMAGE2_MODEL = "not-a-real-model";
    expect(resolveOpenAiGptImage2Model()).toBe("gpt-image-2-2026-04-21");
  });

  it("reads OPENAI_IMAGE_API_KEY first", () => {
    process.env.OPENAI_IMAGE_API_KEY = "sk-image";
    process.env.OPENAI_API_KEY = "sk-generic";
    expect(getOpenAiImageApiKey()).toBe("sk-image");
    expect(isOpenAiGptImage2Configured()).toBe(true);
  });

  it("falls back to OPENAI_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-generic";
    expect(getOpenAiImageApiKey()).toBe("sk-generic");
  });

  it("false when unset", () => {
    expect(isOpenAiGptImage2Configured()).toBe(false);
  });

  it("ignores non-sk placeholder values", () => {
    process.env.OPENAI_API_KEY = "中的openai";
    expect(getOpenAiImageApiKey()).toBe("");
    expect(isOpenAiGptImage2Configured()).toBe(false);
  });

  it("skips invalid IMAGE key and uses OPENAI_API_KEY", () => {
    process.env.OPENAI_IMAGE_API_KEY = "[placeholder]";
    process.env.OPENAI_API_KEY = "sk-proj-realkey";
    expect(getOpenAiImageApiKey()).toBe("sk-proj-realkey");
  });
});
