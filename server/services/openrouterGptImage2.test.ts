import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { getOpenRouterApiKey, isOpenRouterGptImage2Configured } from "./openrouterGptImage2.js";

const KEY = "OPENROUTER_API_KEY";

describe("openrouterGptImage2 config", () => {
  let prev: string | undefined;

  beforeEach(() => {
    prev = process.env[KEY];
    delete process.env[KEY];
  });

  afterEach(() => {
    if (prev === undefined) delete process.env[KEY];
    else process.env[KEY] = prev;
  });

  it("accepts sk-or keys", () => {
    process.env[KEY] = "sk-or-v1-abcdef0123456789";
    expect(getOpenRouterApiKey()).toBe("sk-or-v1-abcdef0123456789");
    expect(isOpenRouterGptImage2Configured()).toBe(true);
  });

  it("false when unset or placeholder", () => {
    expect(isOpenRouterGptImage2Configured()).toBe(false);
    process.env[KEY] = "[placeholder]";
    expect(getOpenRouterApiKey()).toBe("");
  });
});
