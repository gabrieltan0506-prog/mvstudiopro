import { describe, expect, it } from "vitest";
import {
  OPENAI_IMAGE_PROMPT_MAX_CHARS,
  clampOpenAiImagePrompt,
} from "./openaiImagePromptClamp";

describe("clampOpenAiImagePrompt", () => {
  it("passes through short prompts", () => {
    expect(clampOpenAiImagePrompt("短提示")).toBe("短提示");
  });

  it("clamps to OpenAI 32000 and keeps head+tail", () => {
    const head = "HEAD-" + "甲".repeat(8_000);
    const mid = "MID-" + "乙".repeat(30_000);
    const tail = "【分镜 #01】本镜动作" + "丙".repeat(200) + "【画风硬锁】CG";
    const raw = `${head}\n${mid}\n${tail}`;
    expect(raw.length).toBeGreaterThan(OPENAI_IMAGE_PROMPT_MAX_CHARS);
    const out = clampOpenAiImagePrompt(raw);
    expect(out.length).toBeLessThanOrEqual(OPENAI_IMAGE_PROMPT_MAX_CHARS);
    expect(out).toContain("【提示过长已截断】");
    expect(out.startsWith("HEAD-")).toBe(true);
    expect(out).toContain("【分镜 #01】");
    expect(out).toContain("【画风硬锁】");
  });

  it("respects custom max", () => {
    const out = clampOpenAiImagePrompt("abcdef".repeat(100), 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toContain("【提示过长已截断】");
  });
});
