import { describe, expect, it, vi } from "vitest";
import type { InvokeParams, InvokeResult } from "../_core/llm";
import type {
  ManhuaViralTemplateCard,
  ManhuaViralTemplateOptimizeModel,
} from "../../shared/manhuaViralTemplateBank";
import { optimizeApprovedManhuaViralTemplate } from "./manhuaViralTemplateOptimize";

function approvedCard(): ManhuaViralTemplateCard {
  return {
    id: "tpl_series_ownerfixture",
    nameZh: "绝境反击节奏",
    laneZh: "系统觉醒",
    summaryZh: "绝境开场，能力觉醒，反击留钩。",
    hook3sZh: "主角被逼到悬崖边，掌心忽然亮起符纹。",
    beatGrid: [
      { atSec: 0, conflictZh: "绝境压迫", visualZh: "敌人封住退路" },
      { atSec: 15, conflictZh: "能力觉醒", visualZh: "掌心符纹照亮山壁" },
    ],
    scenePoolHints: ["悬崖", "山门"],
    castShape: { leadDesireZh: "活下来", pressureZh: "宗门追杀", foilZh: "冷眼师兄" },
    densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 },
    sourceRefs: [{ url: "https://example.com/private", fetchedAt: "2026-08-16" }],
    status: "approved",
    publicCode: "A7F2",
    approvedAt: "2026-08-16T00:00:00.000Z",
    provenance: {
      frameVision: { provider: "private", model: "vision", attemptedChunks: 2, successChunks: 2 },
    },
  };
}

function resultWith(content: unknown): InvokeResult {
  return {
    id: "result-1",
    created: 1,
    model: "test",
    choices: [{
      index: 0,
      message: { role: "assistant", content: JSON.stringify(content) },
      finish_reason: "stop",
    }],
  };
}

function optimizedOutput() {
  const card = approvedCard();
  return {
    candidate: {
      nameZh: card.nameZh,
      laneZh: card.laneZh,
      summaryZh: card.summaryZh,
      hook3sZh: "主角坠崖前一瞬，腕骨浮出跨世符印。",
      beatGrid: card.beatGrid,
      scenePoolHints: card.scenePoolHints,
      castShape: card.castShape,
      densityHints: card.densityHints,
    },
    reasons: [{ field: "hook3sZh", reasonZh: "按提示强化前三秒穿越异象和生死悬念。" }],
  };
}

describe("optimizeApprovedManhuaViralTemplate", () => {
  const cases: Array<{
    model: ManhuaViralTemplateOptimizeModel;
    modelName: string;
    effort: string;
    maxTokens: number;
  }> = [
    { model: "terra_high", modelName: "gpt-5.6-terra", effort: "high", maxTokens: 32_768 },
    { model: "kimi_k3_max", modelName: "moonshotai/kimi-k3", effort: "max", maxTokens: 32_768 },
    { model: "claude_opus_5_high", modelName: "claude-opus-5", effort: "high", maxTokens: 32_768 },
    {
      model: "deepseek_v4_0813_high",
      modelName: "deepseek/deepseek-v4-pro-0813",
      effort: "high",
      maxTokens: 65_536,
    },
  ];

  for (const item of cases) {
    it(`${item.model} 只按白名单参数调用一次并生成真实修订`, async () => {
      const calls: InvokeParams[] = [];
      const invoke = vi.fn(async (params: InvokeParams) => {
        calls.push(params);
        return resultWith(optimizedOutput());
      });
      const output = await optimizeApprovedManhuaViralTemplate({
        card: approvedCard(),
        model: item.model,
        promptZh: "强化穿越异象，但保留原有节奏。",
        requestId: "request_owner_1234",
        userId: 7,
        invoke,
      });
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(calls[0]).toMatchObject({
        modelName: item.modelName,
        reasoningEffort: item.effort,
        max_tokens: item.maxTokens,
        requestId: "request_owner_1234",
      });
      expect(calls[0]).not.toHaveProperty("temperature");
      expect(calls[0]).not.toHaveProperty("topP");
      if (item.model === "deepseek_v4_0813_high") {
        expect(calls[0]?.response_format).toEqual({ type: "json_object" });
        expect(calls[0]?.openRouterProviderPreferences).toEqual({ require_parameters: true });
      }
      expect(output.changedFields).toEqual(["hook3sZh"]);
      expect(output.proposal.status).toBe("proposed");
      expect(output.proposal.revision).toMatchObject({
        parentTemplateId: "tpl_series_ownerfixture",
        model: item.model,
        changedFields: ["hook3sZh"],
      });
      expect(output.proposal.sourceRefs).toEqual(approvedCard().sourceRefs);
      expect(output.proposal.provenance).toEqual(approvedCard().provenance);
      expect(output.proposal.publicCode).toBeUndefined();
    });
  }

  it("模型未为真实变更提供原因时拒绝生成修订", async () => {
    const invalid = optimizedOutput();
    invalid.reasons = [{ field: "summaryZh", reasonZh: "错误字段原因" }];
    await expect(optimizeApprovedManhuaViralTemplate({
      card: approvedCard(),
      model: "deepseek_v4_0813_high",
      promptZh: "强化穿越异象。",
      requestId: "request_owner_bad1",
      userId: 7,
      invoke: async () => resultWith(invalid),
    })).rejects.toThrow("缺少对应字段的优化原因");
  });

  it("finish_reason=length 时整条作废", async () => {
    const truncated = resultWith(optimizedOutput());
    truncated.choices[0]!.finish_reason = "length";
    await expect(optimizeApprovedManhuaViralTemplate({
      card: approvedCard(),
      model: "deepseek_v4_0813_high",
      promptZh: "强化穿越异象。",
      requestId: "request_owner_len1",
      userId: 7,
      invoke: async () => truncated,
    })).rejects.toThrow("输出被截断");
  });
});
