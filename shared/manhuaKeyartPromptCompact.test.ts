import { describe, expect, it } from "vitest";
import {
  OPENAI_IMAGE_PROMPT_HARD_MAX,
  assertOpenAiImagePromptWithinLimit,
} from "./manhuaKeyartPromptCompact";

describe("manhuaKeyartPromptCompact (assert only)", () => {
  it("allows at hard max", () => {
    expect(() =>
      assertOpenAiImagePromptWithinLimit("a".repeat(OPENAI_IMAGE_PROMPT_HARD_MAX)),
    ).not.toThrow();
  });

  it("throws above hard max without truncate wording as a fix", () => {
    expect(() =>
      assertOpenAiImagePromptWithinLimit("a".repeat(OPENAI_IMAGE_PROMPT_HARD_MAX + 1)),
    ).toThrow(/不会截断|不会再额外调用/);
  });
});
