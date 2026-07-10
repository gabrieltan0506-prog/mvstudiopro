import { describe, expect, it } from "vitest";
import {
  isEvolinkChatModelNotFoundError,
  isEvolinkInsufficientQuotaError,
  normalizeEvolinkChatModel,
  toEvolinkChatUserMessage,
} from "./evolinkChatModel";

describe("normalizeEvolinkChatModel", () => {
  it("keeps official gpt-5.5 / gpt-5.4 ids", () => {
    expect(normalizeEvolinkChatModel("gpt-5.5")).toBe("gpt-5.5");
    expect(normalizeEvolinkChatModel("gpt-5.4")).toBe("gpt-5.4");
  });

  it("maps common aliases", () => {
    expect(normalizeEvolinkChatModel("gpt55")).toBe("gpt-5.5");
    expect(normalizeEvolinkChatModel("GPT-5-5")).toBe("gpt-5.5");
    expect(normalizeEvolinkChatModel("gpt54")).toBe("gpt-5.4");
  });

  it("falls back for unknown model names", () => {
    expect(normalizeEvolinkChatModel("gpt-5.5-preview")).toBe("gpt-5.5");
    expect(normalizeEvolinkChatModel("")).toBe("gpt-5.5");
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
});
