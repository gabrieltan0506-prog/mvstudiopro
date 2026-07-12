import { describe, expect, it } from "vitest";
import {
  enforceSimplifiedChineseImagePrompt,
  toSimplifiedChinese,
} from "./simplifiedChinese.js";

describe("simplifiedChinese", () => {
  it("converts Traditional Chinese to Simplified", () => {
    expect(toSimplifiedChinese("頭髮學習身體優化導演")).toBe("头发学习身体优化导演");
  });

  it("appends language lock to image prompts", () => {
    const out = enforceSimplifiedChineseImagePrompt("封面主标：學習身體");
    expect(out).toContain("学习身体");
    expect(out).toContain("Simplified Chinese");
    expect(out).toContain("简体中文");
    expect(out).toContain("LANGUAGE LOCK (CRITICAL — ON-IMAGE TEXT)");
  });

  it("is idempotent when lock already present", () => {
    const once = enforceSimplifiedChineseImagePrompt("分镜：學習");
    const twice = enforceSimplifiedChineseImagePrompt(once);
    expect(twice).toBe(once);
  });
});
