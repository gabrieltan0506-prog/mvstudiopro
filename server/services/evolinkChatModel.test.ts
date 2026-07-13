import { describe, expect, it } from "vitest";
import {
  isEvolinkChatModelNotFoundError,
  isEvolinkInsufficientQuotaError,
  normalizeEvolinkChatModel,
  shouldSkipOhMyGptSameAccountFallback,
  toEvolinkChatUserMessage,
  toOpenAiCompatibleChatUserMessage,
} from "./evolinkChatModel";

describe("normalizeEvolinkChatModel", () => {
  it("keeps official gpt-5.6-sol / gpt-5.5 / gpt-5.4 ids", () => {
    expect(normalizeEvolinkChatModel("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(normalizeEvolinkChatModel("gpt-5.5")).toBe("gpt-5.5");
    expect(normalizeEvolinkChatModel("gpt-5.4")).toBe("gpt-5.4");
  });

  it("maps common aliases", () => {
    expect(normalizeEvolinkChatModel("gpt-5.6")).toBe("gpt-5.6-sol");
    expect(normalizeEvolinkChatModel("gpt56sol")).toBe("gpt-5.6-sol");
    expect(normalizeEvolinkChatModel("gpt55")).toBe("gpt-5.5");
    expect(normalizeEvolinkChatModel("GPT-5-5")).toBe("gpt-5.5");
    expect(normalizeEvolinkChatModel("gpt54")).toBe("gpt-5.4");
  });

  it("falls back for unknown model names to gpt-5.6-sol", () => {
    expect(normalizeEvolinkChatModel("gpt-5.5-preview")).toBe("gpt-5.6-sol");
    expect(normalizeEvolinkChatModel("")).toBe("gpt-5.6-sol");
  });

  it("accepts gpt-5.4 as explicit fallback (Fly tsc regression)", () => {
    expect(normalizeEvolinkChatModel("", "gpt-5.4")).toBe("gpt-5.4");
    expect(normalizeEvolinkChatModel("unknown-model", "gpt-5.4")).toBe("gpt-5.4");
  });
});

describe("evolink error classification", () => {
  it("detects Azure-style deployment 404 as model-not-found, not quota", () => {
    const body =
      '{"error":{"message":"Could not find an existing deployment to match the model in the request.","type":"invalid_request_error"}}';
    expect(isEvolinkChatModelNotFoundError(404, body)).toBe(true);
    expect(isEvolinkInsufficientQuotaError(404, body)).toBe(false);
    expect(toEvolinkChatUserMessage(404, body)).toMatch(/非积分问题/);
  });

  it("detects 402 insufficient quota", () => {
    expect(isEvolinkInsufficientQuotaError(402, "Insufficient quota")).toBe(true);
    expect(toEvolinkChatUserMessage(402, "Insufficient quota")).toMatch(/积分不足/);
  });

  it("auth errors name the correct provider", () => {
    expect(toOpenAiCompatibleChatUserMessage(401, "authentication_error", "OhMyGPT")).toMatch(/OhMyGPT/);
    expect(toOpenAiCompatibleChatUserMessage(401, "invalid or expired token", "Evolink")).toMatch(/EvoLink/);
    expect(toEvolinkChatUserMessage(401, "authentication_error")).toMatch(/EvoLink/);
  });

  it("treats OhMyGPT balance exhaustion as quota and skips same-account fallback", () => {
    expect(isEvolinkInsufficientQuotaError(403, "余额不足")).toBe(true);
    expect(isEvolinkInsufficientQuotaError(429, "quota exceeded")).toBe(true);
    expect(shouldSkipOhMyGptSameAccountFallback(402, "Insufficient quota")).toBe(true);
    expect(shouldSkipOhMyGptSameAccountFallback(401, "authentication_error")).toBe(true);
    expect(shouldSkipOhMyGptSameAccountFallback(500, "internal")).toBe(false);
  });
});
