import { describe, expect, it } from "vitest";
import { focusCoverChineseContextForDirectSend } from "./platformImageChineseStaging";

describe("focusCoverChineseContextForDirectSend", () => {
  it("keeps short text unchanged", () => {
    expect(focusCoverChineseContextForDirectSend("短语境", 1800)).toBe("短语境");
  });

  it("prefers prop/persona lines and caps length", () => {
    const longEssay = "甲".repeat(900);
    const raw = [
      "【身份锚点】哈佛医博，白西装",
      "道具：史记、节拍器、耳机",
      "场景：日光书房窗边",
      longEssay,
      "另一段很长的论述文字继续堆叠商业价值与方法论说明",
    ].join("\n");
    const out = focusCoverChineseContextForDirectSend(raw, 200);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out).toMatch(/史记|节拍器|耳机|身份|场景/);
    expect(out.includes(longEssay)).toBe(false);
  });
});
