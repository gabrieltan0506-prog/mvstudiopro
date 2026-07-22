import { describe, expect, it } from "vitest";
import {
  buildManhuaScenePlateGenPrompt,
  compileManhuaScriptVisualBrief,
  looksLikeRawScriptDump,
  summarizeManhuaVisualBriefForUi,
} from "./manhuaScriptVisualBrief";

describe("manhuaScriptVisualBrief", () => {
  it("compiles writer pack into visual brief instead of raw dump", () => {
    const pack = [
      "【已确认编剧包·强制遵守】",
      "系列：雨夜客栈",
      "梗概：江湖恩怨",
      "",
      "## 人物表",
      "主角欲望：称霸武林",
      "核心冲突：夺刀",
      "世界观一句：刀光剑影",
      "",
      "## 本集优先：第1集《拔刀》",
      "1. 雨夜客栈全景，火把摇晃",
      "2. 中近景对峙，拔刀交锋与闪避",
      "3. 切到庙外，追逐冲刺",
      "片尾钩子：下一集揭晓身份",
    ].join("\n");

    const brief = compileManhuaScriptVisualBrief(pack, {
      topic: "江湖刀光打斗",
      forStage: "key_art",
    });
    expect(brief).toContain("【视觉提示词简报·禁止灌剧本】");
    expect(brief).toMatch(/运镜|动作轨迹|场景/);
    expect(brief).not.toContain("## 人物表");
    expect(brief).not.toContain("主角欲望：称霸武林");
    expect(looksLikeRawScriptDump(brief)).toBe(false);
  });

  it("keeps short visual summary seed", () => {
    const brief = compileManhuaScriptVisualBrief(
      "【编剧视觉摘要】女帝青衣佩剑，雨夜秘境石阶，冷青雾气。",
      { forStage: "key_art" },
    );
    expect(brief).toContain("女帝青衣佩剑");
    expect(brief).toContain("【视觉提示词简报");
  });

  it("summarizes brief for workbench gate UI", () => {
    const ui = summarizeManhuaVisualBriefForUi(
      "雨夜客栈全景对峙，中近景拔刀交锋，切到庙外追逐冲刺",
      { topic: "江湖刀光打斗" },
    );
    expect(ui.fullBriefZh).toContain("【视觉提示词简报");
    expect(ui.topicZh).toContain("江湖");
    expect(ui.pathLabelZh || ui.actionLabelZh || ui.events.length).toBeTruthy();
  });

  it("builds scene plate prompt with soft no-text preference", () => {
    const p = buildManhuaScenePlateGenPrompt({
      sceneNameZh: "秘境洞府",
      scenePromptZh: "发光晶石与石阶",
      topic: "外门闯秘境",
    });
    expect(p).toContain("主场景空镜参考");
    expect(p).toContain("秘境洞府");
    expect(p).toContain("强烈建议");
    expect(p).toContain("Strong preference");
    expect(p).not.toContain("硬约束");
    expect(p).not.toContain("STRICT NO TEXT");
  });
});
