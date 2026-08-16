import { describe, expect, it, vi } from "vitest";

const invokeLLMMock = vi.hoisted(() => vi.fn());

vi.mock("./_core/llm.js", () => ({
  invokeLLM: invokeLLMMock,
  extractJsonString: (value: string) => value,
}));

import { analyzeManhuaTemplateFrames } from "./manhuaTemplateFrameVision";

describe("analyzeManhuaTemplateFrames", () => {
  it("每个分片只调用一次 Terra 视觉 API，并固定 EvoLink 主、官方备用", async () => {
    invokeLLMMock.mockResolvedValueOnce({
      choices: [{
        finish_reason: "stop",
        message: {
          content: JSON.stringify({
            nameZh: "系统升级骨架",
            laneZh: "系统觉醒",
            summaryZh: "高压下连续升级",
            hook3sZh: "危机中面板突然亮起",
            beatGrid: [{ atSec: 0, conflictZh: "危机", visualZh: "面板亮起" }],
            scenePoolHints: ["废墟"],
            castShape: { leadDesireZh: "完成进化", pressureZh: "强敌追杀" },
          }),
        },
      }],
    });

    const result = await analyzeManhuaTemplateFrames({
      frames: [{ atSec: 0, dataUrl: "data:image/jpeg;base64,YQ==" }],
      requestId: "manhua-frame-series-1-0-600",
    });

    expect(result.model).toBe("gpt-5.6-terra");
    expect(invokeLLMMock).toHaveBeenCalledTimes(1);
    expect(invokeLLMMock).toHaveBeenCalledWith(expect.objectContaining({
      provider: "openai",
      modelName: "gpt-5.6-terra",
      reasoningEffort: "high",
      max_tokens: 32_768,
      openAiGateway: "evolink_primary",
      requestId: "manhua-frame-series-1-0-600",
    }));
  });
});
