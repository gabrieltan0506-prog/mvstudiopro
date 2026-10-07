import { describe, expect, it } from "vitest";
import { compileManhuaGenerativeEffectInstruction, MANHUA_GENERATIVE_EFFECT_PRESETS } from "./manhuaGenerativeEffects";

describe("既有视频编辑的生成式特效指令", () => {
  it("预设只编译选定目标与编辑要求，不虚构素材引用或遮罩参数", () => {
    for (const preset of MANHUA_GENERATIVE_EFFECT_PRESETS.filter(item => item.id !== "custom")) {
      const instruction = compileManhuaGenerativeEffectInstruction({ presetId: preset.id, target: "左侧持剑人物", instruction: preset.instruction });
      expect(instruction).toContain("修改对象：左侧持剑人物。");
      expect(instruction.length).toBeLessThanOrEqual(240);
      expect(instruction).not.toMatch(/https?:|mask_url|@image|@audio|@video/i);
      expect(() => compileManhuaGenerativeEffectInstruction({ presetId: preset.id, target: "", instruction: preset.instruction })).toThrow("对象");
    }
  });
  it("自定义修改仍可直接用原指令，指定时窗只接受已读原片范围", () => {
    const draft = { presetId: "custom" as const, target: "", instruction: "把灯笼\n  改为蓝色" };
    expect(compileManhuaGenerativeEffectInstruction(draft)).toBe("把灯笼 改为蓝色");
    expect(compileManhuaGenerativeEffectInstruction({ ...draft, range: { startSec: 1, endSec: 2 } }, 5)).toBe("时段：原片1—2秒。把灯笼 改为蓝色");
    expect(() => compileManhuaGenerativeEffectInstruction({ ...draft, range: { startSec: 2, endSec: 1 } }, 5)).toThrow("秒位");
    expect(() => compileManhuaGenerativeEffectInstruction({ ...draft, range: { startSec: 1, endSec: 6 } }, 5)).toThrow("超过");
    expect(() => compileManhuaGenerativeEffectInstruction({ ...draft, range: { startSec: 1, endSec: 2 } })).toThrow("读取时长");
  });
  it("最终完整指令超240字即拒绝，不让下游静默截掉对象或时段", () => {
    expect(() => compileManhuaGenerativeEffectInstruction({ presetId: "custom", target: "主角", instruction: "光".repeat(240) })).toThrow("不会自动截断");
  });
});
