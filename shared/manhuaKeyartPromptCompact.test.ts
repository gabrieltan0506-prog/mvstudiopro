import { describe, expect, it, vi } from "vitest";
import {
  MANHUA_KEYART_PROMPT_COMPACT_MODEL,
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

  it("pins terra in constant", () => {
    expect(MANHUA_KEYART_PROMPT_COMPACT_MODEL).toBe("gpt-5.6-terra");
  });

  it("merge brief requires under target and no truncation wording", () => {
    const b = buildManhuaKeyartPromptCompactBrief({ mode: "merge", targetMax: 28000 });
    expect(b).toMatch(/28000/);
    expect(b).not.toMatch(/截断/);
  });

  it("assert throws when over hard max (no silent cut)", () => {
    expect(() =>
      assertOpenAiImagePromptWithinLimit("a".repeat(OPENAI_IMAGE_PROMPT_HARD_MAX + 1)),
    ).toThrow(/不会截断/);
  });

  it("passes through when ≤32k without calling optimize", async () => {
    const src = `【分镜 #01】\n${"甲".repeat(20_000)}\n【画风硬锁】CG`;
    expect(src.length).toBeLessThanOrEqual(OPENAI_IMAGE_PROMPT_HARD_MAX);
    const optimize = vi.fn(async () => "不应调用");
    const out = await compactManhuaKeyartImagePrompt(optimize, src);
    expect(optimize).not.toHaveBeenCalled();
    expect(out).toBe(src);
  });

  it("split-extract-merge when >32k and pins terra", async () => {
    const src = `${"段A剧情。".repeat(4000)}\n\n${"段B分镜。".repeat(4000)}`;
    expect(src.length).toBeGreaterThan(OPENAI_IMAGE_PROMPT_HARD_MAX);
    const optimize = vi.fn(async ({ optimizationBrief, modelName }) => {
      expect(modelName).toBe("gpt-5.6-terra");
      if (String(optimizationBrief || "").includes("分段提取")) return "要点：人物甲 场景乙";
      return "合并后的改图提示：人物甲在场景乙做动作";
    });
    const out = await compactManhuaKeyartImagePrompt(optimize, src);
    expect(optimize.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(out).toMatch(/改图提示|人物甲/);
  });
});
