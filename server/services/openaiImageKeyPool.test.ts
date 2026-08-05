import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveOpenAiImageKeyChain } from "./openaiImageKeyPool";

const ENV_KEYS = [
  "OPENAI_IMAGE_API_KEY_ASSET",
  "OPENAI_IMAGE_API_KEY_KEYART",
  "OPENAI_IMAGE_API_KEY",
  "OPENAI_API_KEY",
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("resolveOpenAiImageKeyChain", () => {
  /**
   * 2026-08-05 线上：出图专钥瞬时 fetch failed，钥池换到共用钥，
   * 而共用钥就是 GPT-5.6 在用的那把通用钥、余额早已耗尽，白等一轮 429。
   */
  it("配了专钥就不回落到共用钥", () => {
    process.env.OPENAI_IMAGE_API_KEY_ASSET = "sk-assetkey";
    process.env.OPENAI_IMAGE_API_KEY = "sk-sharedkey";
    process.env.OPENAI_API_KEY = "sk-sharedkey";

    const chain = resolveOpenAiImageKeyChain("asset");
    expect(chain.map((c) => c.slot)).toEqual(["OPENAI_IMAGE_API_KEY_ASSET"]);
    expect(chain.some((c) => c.key === "sk-sharedkey")).toBe(false);
  });

  it("两道专钥都配了就互相兜底，顺序是本道优先", () => {
    process.env.OPENAI_IMAGE_API_KEY_ASSET = "sk-assetkey";
    process.env.OPENAI_IMAGE_API_KEY_KEYART = "sk-keyartkey";
    process.env.OPENAI_IMAGE_API_KEY = "sk-sharedkey";

    expect(resolveOpenAiImageKeyChain("asset").map((c) => c.slot)).toEqual([
      "OPENAI_IMAGE_API_KEY_ASSET",
      "OPENAI_IMAGE_API_KEY_KEYART",
    ]);
    expect(resolveOpenAiImageKeyChain("keyart").map((c) => c.slot)).toEqual([
      "OPENAI_IMAGE_API_KEY_KEYART",
      "OPENAI_IMAGE_API_KEY_ASSET",
    ]);
  });

  it("一把专钥都没配才退回共用钥（保持旧行为）", () => {
    process.env.OPENAI_IMAGE_API_KEY = "sk-sharedkey";
    expect(resolveOpenAiImageKeyChain("asset").map((c) => c.slot)).toEqual([
      "OPENAI_IMAGE_API_KEY",
    ]);
  });

  it("同一把钥配在多个变量上只出现一次", () => {
    process.env.OPENAI_IMAGE_API_KEY = "sk-samekey";
    process.env.OPENAI_API_KEY = "sk-samekey";
    expect(resolveOpenAiImageKeyChain("keyart")).toHaveLength(1);
  });

  it("占位伪值不算可用钥", () => {
    process.env.OPENAI_IMAGE_API_KEY_ASSET = "[set]";
    process.env.OPENAI_IMAGE_API_KEY = "sk-sharedkey";
    // 专钥是伪值 → 视为没配专钥，仍可退回共用钥
    expect(resolveOpenAiImageKeyChain("asset").map((c) => c.slot)).toEqual([
      "OPENAI_IMAGE_API_KEY",
    ]);
  });
});
