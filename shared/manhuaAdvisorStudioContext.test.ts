import { describe, expect, it } from "vitest";
import { currentAdvisorStudioContext, manhuaAdvisorStudioContextSchema } from "./manhuaAdvisorStudioContext";
import { manhuaCreativeAdvisorContextSchema } from "./manhuaCreativeAdvisor";
import { buildManhuaAdvisorProject } from "../client/src/lib/manhuaAdvisorProject";
import { buildManhuaCreativeAdvisorLlmMessages } from "../server/services/platformSkillQa";

const project = { pack: null, bible: null, episodeIndex: 1, phase: "outline" as const, videoModel: "未选择", writerConfirmed: false, refs: [], blocks: [] };

describe("当前工作区的顾问上下文", () => {
  it.each(["model3d", "world3d", "previs", "actionTimeline", "audio", "edit", "postprod"] as const)("%s 从真实生产者通过严格合同进入服务端提示词", tool => {
    const activeStudio = { tool, episodeIndex: 1, segmentIndex: 2, clipId: "clip-e01-g02", assetId: "asset-test" };
    const produced = buildManhuaAdvisorProject({ ...project, activeStudio });
    const context = manhuaCreativeAdvisorContextSchema.parse(produced.context);
    expect(context.activeStudio).toEqual(activeStudio);
    expect(context.stage).toBe("outline");
    const messages = buildManhuaCreativeAdvisorLlmMessages({ question: "检查当前选中的对象", context });
    expect(messages.map(message => message.content).join("\n")).toContain(JSON.stringify(activeStudio));
  });
  it("切集间隙丢弃上一集工具目标，不把旧片段带入新正文", () => {
    const previous = { tool: "audio" as const, episodeIndex: 1, clipId: "clip-e01-g01" };
    expect(buildManhuaAdvisorProject({ ...project, episodeIndex: 2, activeStudio: previous }).context.activeStudio).toBeUndefined();
    expect(currentAdvisorStudioContext(null, 2)).toBeUndefined();
  });
  it("拒绝伪造权限与无效目标，旧上下文仍兼容", () => {
    expect(manhuaAdvisorStudioContextSchema.safeParse({ tool: "audio", episodeIndex: 1, confirmedCost: true }).success).toBe(false);
    expect(manhuaAdvisorStudioContextSchema.safeParse({ tool: "audio", episodeIndex: 0 }).success).toBe(false);
    expect(manhuaAdvisorStudioContextSchema.safeParse({ tool: "unknown", episodeIndex: 1 }).success).toBe(false);
    expect(manhuaCreativeAdvisorContextSchema.safeParse(buildManhuaAdvisorProject(project).context).success).toBe(true);
  });
});
