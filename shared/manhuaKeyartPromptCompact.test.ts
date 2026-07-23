import { describe, expect, it, vi } from "vitest";
import {
  MANHUA_KEYART_PROMPT_COMPACT_MODEL,
  MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX,
  MANHUA_KEYART_PROMPT_COMPACT_PASS_MIN,
  OPENAI_IMAGE_PROMPT_HARD_MAX,
  assertOpenAiImagePromptWithinLimit,
  buildManhuaKeyartPromptCompactBrief,
  compactManhuaKeyartImagePrompt,
  needsManhuaKeyartPromptCompact,
} from "./manhuaKeyartPromptCompact";

describe("manhuaKeyartPromptCompact", () => {
  it("only triggers when over 32k", () => {
    expect(needsManhuaKeyartPromptCompact("短")).toBe(false);
    expect(needsManhuaKeyartPromptCompact("x".repeat(OPENAI_IMAGE_PROMPT_HARD_MAX))).toBe(false);
    expect(needsManhuaKeyartPromptCompact("x".repeat(OPENAI_IMAGE_PROMPT_HARD_MAX + 1))).toBe(true);
  });

  it("pins terra", () => {
    expect(MANHUA_KEYART_PROMPT_COMPACT_MODEL).toBe("gpt-5.6-terra");
  });

  it("merge brief asks for 24k–28k pass band", () => {
    const b = buildManhuaKeyartPromptCompactBrief({ mode: "merge" });
    expect(b).toContain(String(MANHUA_KEYART_PROMPT_COMPACT_PASS_MIN));
    expect(b).toContain(String(MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX));
    expect(b).not.toMatch(/截断/);
  });

  it("assert allows 28k and rejects above pass max", () => {
    expect(() =>
      assertOpenAiImagePromptWithinLimit("a".repeat(MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX)),
    ).not.toThrow();
    expect(() =>
      assertOpenAiImagePromptWithinLimit("a".repeat(MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX + 1)),
    ).toThrow(/放行上限|不会截断/);
  });

  it("passes through when ≤32k without calling optimize", async () => {
    const src = `【分镜 #01】\n${"甲".repeat(20_000)}\n【画风硬锁】CG`;
    expect(src.length).toBeLessThanOrEqual(OPENAI_IMAGE_PROMPT_HARD_MAX);
    const optimize = vi.fn(async () => "不应调用");
    const out = await compactManhuaKeyartImagePrompt(optimize, src);
    expect(optimize).not.toHaveBeenCalled();
    expect(out).toBe(src);
  });

  it("split-extract-merge when >32k; 26k result is released", async () => {
    const src = `${"段A剧情。".repeat(4000)}\n\n${"段B分镜。".repeat(4000)}`;
    expect(src.length).toBeGreaterThan(OPENAI_IMAGE_PROMPT_HARD_MAX);
    const optimize = vi.fn(async ({ optimizationBrief, modelName }) => {
      expect(modelName).toBe("gpt-5.6-terra");
      if (String(optimizationBrief || "").includes("分段提取")) return "要点：人物甲 场景乙";
      return `合并放行稿：${"丙".repeat(26_000)}`;
    });
    const out = await compactManhuaKeyartImagePrompt(optimize, src);
    expect(out.length).toBeGreaterThanOrEqual(MANHUA_KEYART_PROMPT_COMPACT_PASS_MIN);
    expect(out.length).toBeLessThanOrEqual(MANHUA_KEYART_PROMPT_COMPACT_PASS_MAX);
  });
});
