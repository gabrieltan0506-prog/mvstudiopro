import { describe, expect, it } from "vitest";
import { normalizeOmniClipPrompt, OMNI_CLIP_DURATION_SECONDS } from "./canvasRunBlock";

describe("canvasRunBlock omni clip prompt", () => {
  it("locks a single generation to ten seconds", () => {
    const prompt = normalizeOmniClipPrompt("目标约 15 秒成片，缓慢推近");
    expect(OMNI_CLIP_DURATION_SECONDS).toBe(10);
    expect(prompt).toContain("严格为 10 秒");
    expect(prompt).not.toMatch(/15\s*(?:秒|s)/i);
  });

  it("keeps action intent while removing graphic wording", () => {
    const prompt = normalizeOmniClipPrompt("打斗短阶段，兵器交锋后给击打反馈，不出现流血伤口");
    expect(prompt).toContain("动作短阶段");
    expect(prompt).toContain("舞台化兵器走位");
    expect(prompt).toContain("动作反馈");
    expect(prompt).not.toMatch(/流血|伤口|击打反馈/);
  });
});
