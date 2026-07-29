import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  resolveOpenAiImageKey,
  resolveOpenAiImageKeyChain,
  shouldRetryOpenAiImageWithOtherKey,
} from "./openaiImageKeyPool.js";

const KEYS = [
  "OPENAI_IMAGE_API_KEY_ASSET",
  "OPENAI_IMAGE_API_KEY_KEYART",
  "OPENAI_IMAGE_API_KEY",
  "OPENAI_API_KEY",
] as const;

describe("openaiImageKeyPool", () => {
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

  it("两把分道钥：各走自己那把，另一把排在末位当兜底", () => {
    process.env.OPENAI_IMAGE_API_KEY_ASSET = "sk-asset";
    process.env.OPENAI_IMAGE_API_KEY_KEYART = "sk-keyart";
    expect(resolveOpenAiImageKeyChain("asset").map((s) => s.key)).toEqual(["sk-asset", "sk-keyart"]);
    expect(resolveOpenAiImageKeyChain("keyart").map((s) => s.key)).toEqual(["sk-keyart", "sk-asset"]);
    expect(resolveOpenAiImageKey("asset")).toBe("sk-asset");
  });

  it("只配设定图专钥：静帧仍走共用钥，设定图不占用它", () => {
    process.env.OPENAI_IMAGE_API_KEY_ASSET = "sk-asset";
    process.env.OPENAI_IMAGE_API_KEY = "sk-shared";
    expect(resolveOpenAiImageKeyChain("asset").map((s) => s.key)).toEqual(["sk-asset", "sk-shared"]);
    expect(resolveOpenAiImageKeyChain("keyart").map((s) => s.key)).toEqual(["sk-shared", "sk-asset"]);
  });

  it("只有一把共用钥时链长为 1（不白跑第二遍）", () => {
    process.env.OPENAI_IMAGE_API_KEY = "sk-only";
    process.env.OPENAI_API_KEY = "sk-only";
    expect(resolveOpenAiImageKeyChain("asset")).toHaveLength(1);
    expect(resolveOpenAiImageKeyChain(null).map((s) => s.slot)).toEqual(["OPENAI_IMAGE_API_KEY"]);
  });

  it("占位伪值不进链", () => {
    process.env.OPENAI_IMAGE_API_KEY_ASSET = "[placeholder]";
    process.env.OPENAI_API_KEY = "sk-proj-real";
    expect(resolveOpenAiImageKeyChain("asset").map((s) => s.key)).toEqual(["sk-proj-real"]);
    process.env.OPENAI_API_KEY = "中的openai";
    expect(resolveOpenAiImageKeyChain("asset")).toHaveLength(0);
    expect(resolveOpenAiImageKey("asset")).toBe("");
  });

  it("限流 / 鉴权 / 5xx 换钥重试；审核与提示词过长不换", () => {
    expect(shouldRetryOpenAiImageWithOtherKey("OpenAI generations HTTP 429: rate limit")).toBe(true);
    expect(shouldRetryOpenAiImageWithOtherKey("OpenAI edits HTTP 401: invalid api key")).toBe(true);
    expect(shouldRetryOpenAiImageWithOtherKey("OpenAI generations HTTP 500: server error")).toBe(true);
    expect(shouldRetryOpenAiImageWithOtherKey("aborted due to timeout")).toBe(true);
    expect(
      shouldRetryOpenAiImageWithOtherKey("HTTP 400: Your request was rejected by our safety system"),
    ).toBe(false);
    expect(shouldRetryOpenAiImageWithOtherKey("moderation_blocked")).toBe(false);
    expect(shouldRetryOpenAiImageWithOtherKey("")).toBe(false);
  });
});
