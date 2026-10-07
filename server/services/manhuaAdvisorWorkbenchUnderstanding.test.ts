import { expect, it } from "vitest";
import { buildManhuaCreativeAdvisorLlmMessages } from "./platformSkillQa";
import { manhuaCreativeAdvisorContextSchema } from "../../shared/manhuaCreativeAdvisor";
import { creativeVoiceConnectionPlans } from "./creativeVoiceFallback";
import { voiceSetup } from "./creativeVoiceTransport";

it("ordinary chat, text operations and Live receive the same actual preview and save boundaries", () => {
  const context = manhuaCreativeAdvisorContextSchema.parse({ seriesTitle: "离线咨询", episodeIndex: 1, episodeTitle: "", stage: "edit", videoModel: "seedance-2.0-mini", writerConfirmed: true, episodeBody: "守桥", assetSummary: "", shotSummary: "", blockers: [] });
  const question = "先看看轨迹，再决定是否渲染和采用";
  const ordinary = buildManhuaCreativeAdvisorLlmMessages({ question, context });
  const operation = buildManhuaCreativeAdvisorLlmMessages({ question, context: { ...context, workflowOperation: { workspace: "当前没有选中的原片；effects inspect可读取", revision: "offline-1" } } });
  const descriptions = [...ordinary, ...operation].filter(message => message.role === "user").map(message => message.content);
  for (const plan of [...creativeVoiceConnectionPlans(false), ...creativeVoiceConnectionPlans(true)]) {
    descriptions.push(voiceSetup(plan, "离线咨询", "offline").setup.tools[0].functionDeclarations.find(tool => tool.name === "creativeProduction")!.description);
  }
  for (const text of descriptions) {
    for (const boundary of ["播放秒位只定位原片", "不是完整特效画面", "与原片比较", "不保证逐帧同步", "比较不触发生成也不代表采用", "未保存编辑不能承诺刷新后保留", "未知提交只续查原请求", "不支持自动人物跟踪"]) expect(text).toContain(boundary);
    expect(text).toContain("展开工作台");
  }
});
