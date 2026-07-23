import { describe, expect, it, vi } from "vitest";
import {
  MANHUA_KEYART_PROMPT_COMPACT_SOFT,
  OPENAI_IMAGE_PROMPT_HARD_MAX,
  assertOpenAiImagePromptWithinLimit,
  buildManhuaKeyartPromptCompactBrief,
  compactManhuaKeyartImagePrompt,
  needsManhuaKeyartPromptCompact,
} from "./manhuaKeyartPromptCompact";

describe("manhuaKeyartPromptCompact", () => {
  it("skips compact under soft threshold", () => {
    expect(needsManhuaKeyartPromptCompact("短")).toBe(false);
    expect(needsManhuaKeyartPromptCompact("x".repeat(MANHUA_KEYART_PROMPT_COMPACT_SOFT + 1))).toBe(
      true,
    );
  });

  it("brief asks for compact edit prompt without truncation wording", () => {
    const b = buildManhuaKeyartPromptCompactBrief({ mode: "full", targetMax: 12000 });
    expect(b).toMatch(/精简|改图/);
    expect(b).toMatch(/12000/);
    expect(b).not.toMatch(/截断/);
  });

  it("assert throws when over vendor hard max (no silent cut)", () => {
    expect(() => assertOpenAiImagePromptWithinLimit("a".repeat(OPENAI_IMAGE_PROMPT_HARD_MAX + 1))).toThrow(
      /不会截断/,
    );
  });

  it("single-pass compact when over soft but under chunk soft", async () => {
    const src = `【分镜 #01】动作\n${"甲".repeat(MANHUA_KEYART_PROMPT_COMPACT_SOFT + 50)}\n【画风硬锁】CG`;
    const optimize = vi.fn(async () => "【分镜 #01】动作精简\n【画风硬锁】CG\n禁字");
    const out = await compactManhuaKeyartImagePrompt(optimize, src);
    expect(optimize).toHaveBeenCalledTimes(1);
    expect(out).toContain("分镜 #01");
  });

  it("multi-pass extract+merge when very long", async () => {
    const src = `${"段A剧情。".repeat(3000)}\n\n${"段B分镜。".repeat(3000)}`;
    expect(src.length).toBeGreaterThan(16_000);
    const optimize = vi.fn(async ({ optimizationBrief }: { optimizationBrief?: string }) => {
      if (String(optimizationBrief || "").includes("分段提取")) return "要点：人物甲 场景乙";
      return "合并后的改图提示：人物甲在场景乙";
    });
    const out = await compactManhuaKeyartImagePrompt(optimize, src);
    expect(optimize.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(out).toMatch(/改图提示|人物甲/);
  });
});
