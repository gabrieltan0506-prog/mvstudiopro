import { describe, expect, it } from "vitest";
import {
  composeDistilledAdvisorSoftBlock,
  DISTILLED_CHINA_SHORT_VIDEO_GROWTH_ZH,
  DISTILLED_MANHUA_VISUAL_NARRATIVE_ZH,
} from "./distilledAgencyAdvisorBlocks";

describe("distilledAgencyAdvisorBlocks", () => {
  it("keeps user-facing blocks free of model / vendor flex", () => {
    const blob = `${DISTILLED_CHINA_SHORT_VIDEO_GROWTH_ZH}\n${DISTILLED_MANHUA_VISUAL_NARRATIVE_ZH}`;
    expect(blob).not.toMatch(/GPT|Claude|Gemini|OpenAI|Midjourney|DALL-?E|agency-agents/i);
  });

  it("selects manhua block for storyboard questions", () => {
    const block = composeDistilledAdvisorSoftBlock("帮我写古装 CG 分镜静帧");
    expect(block).toContain("漫剧视觉叙事");
    expect(block).toContain("画风硬锁");
  });

  it("selects short-video growth for Douyin questions", () => {
    const block = composeDistilledAdvisorSoftBlock("抖音完播钩子怎么写");
    expect(block).toContain("国内短视频增长");
    expect(block).toContain("抖音");
  });

  it("always includes manhua block on canvas advisor path", () => {
    const block = composeDistilledAdvisorSoftBlock("随便聊聊", { canvasManhua: true });
    expect(block).toContain("漫剧视觉叙事");
  });
});
