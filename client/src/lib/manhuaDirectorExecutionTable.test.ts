import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ManhuaDirectorExecutionTable } from "../components/canvas/ManhuaDirectorExecutionTable";
import { MANHUA_DIALOGUE_CRAFT_ZH } from "@shared/manhuaDialogueCraft";
import { buildTemplateRewriteQuestion } from "./manhuaAdvisorTemplates";
import { manhuaSevenCoreDirectives } from "@shared/manhuaDirectionSevenCores";

describe("导演执行表与表演传导", () => {
  it("情绪不遮住身体细节，完整保留对话轮次、声音和无对白状态", () => {
    const html = renderToStaticMarkup(createElement(ManhuaDirectorExecutionTable, { shots: [
      {index: 1, durationSec: 5, cameraZh: "双人中景，缓推", actionZh: "阿菁看向娘，双手握拳后松开", emotionZh: "隐忍", microExpressionZh: "听到拒绝后肩背轻颤，呼气后稳定", dialogueZh: "娘：我陪你回去。", additionalDialogueCues: [{speakerNameZh:"阿菁",dialogueZh:"好，您慢一点。"}], voiceToneZh: "放轻声音", soundZh: "门外雨声"},
      {index:2,durationSec:3,cameraZh:"全景",actionZh:"两人走出门外",dialogueSuppressed:true,dialogueZh:"不应出现的旧台词"},
    ] }));
    for (const text of ["隐忍", "肩背轻颤，呼气后稳定", "双手握拳后松开", "阿菁：好，您慢一点。", "门外雨声", "本镜无对白", "未填写"]) expect(html).toContain(text);
    expect(html).not.toContain("不应出现的旧台词");
  });
  it("初稿与模板改写要求具备触发/反应/恢复，静帧不灌连续身体动作", () => {
    expect(MANHUA_DIALOGUE_CRAFT_ZH).toContain("具体事件或台词触发→可见反应→收住或恢复");
    const rewrite=buildTemplateRewriteQuestion({ publicId:"test",reason:"亲情冲突",changes:["保留因果"],preserve:"角色" });
    expect(rewrite).toContain("全身轻颤");
    expect(rewrite.length).toBeLessThan(3900);
    expect(manhuaSevenCoreDirectives("clip").join("\n")).toContain("无五官白模");
    expect(manhuaSevenCoreDirectives("keyframe").join("\n")).not.toContain("双手握紧后松开");
    expect(manhuaSevenCoreDirectives("review").join("\n")).toContain("面部表演未验");
  });
});
