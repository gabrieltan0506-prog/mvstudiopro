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


/** 原生精读卡：95 镜、逐镜带六栏（与实测规模一致） */
function nativeCard(): ManhuaViralTemplateCard {
  const base = approvedCard();
  return {
    ...base,
    id: "tpl_series_native95",
    beatGrid: Array.from({ length: 95 }, (_, i) => ({
      atSec: i * 3,
      endSec: i * 3 + 2,
      conflictZh: `c${i}`,
      visualZh: `v${i}`,
      shotSizeZh: "特写",
      angleZh: "平视",
      cameraMoveZh: "固定机位",
      lightingZh: "冷光",
      transitionInZh: "硬切",
    })),
    reusableZh: "用机位稳定性区分攻守。",
    genPromptHintZh: "体积雾 · 逆光轮廓光 · 浅景深。",
  };
}

function nativeOutput(
  beatGrid: ManhuaViralTemplateCard["beatGrid"],
  reasons: Array<{ field: string; reasonZh: string }>,
  patch?: Partial<ManhuaViralTemplateCard>,
) {
  const c = nativeCard();
  return {
    candidate: {
      nameZh: c.nameZh,
      laneZh: c.laneZh,
      summaryZh: c.summaryZh,
      hook3sZh: c.hook3sZh,
      beatGrid,
      reusableZh: c.reusableZh,
      genPromptHintZh: c.genPromptHintZh,
      scenePoolHints: c.scenePoolHints,
      castShape: c.castShape,
      densityHints: c.densityHints,
      ...patch,
    },
    reasons,
  };
}

const runNative = (out: unknown, requestId: string) =>
  optimizeApprovedManhuaViralTemplate({
    card: nativeCard(),
    model: "deepseek_v4_0813_high",
    promptZh: "优化节奏。",
    requestId,
    userId: 7,
    invoke: async () => resultWith(out),
  });

describe("原生精读模板防丢门禁（复审 P0-1）", () => {
  it("超过 128 镜的完整证据可通过优化契约，不会在 schema 层截断", async () => {
    const card = nativeCard();
    card.beatGrid = Array.from({ length: 160 }, (_, i) => ({
      ...card.beatGrid[i % card.beatGrid.length]!,
      atSec: i * 2,
      endSec: i * 2 + 1,
      conflictZh: `c${i}`,
      visualZh: `v${i}`,
    }));
    const candidate = {
      nameZh: card.nameZh,
      laneZh: card.laneZh,
      summaryZh: "保留完整逐镜证据并强化摘要。",
      hook3sZh: card.hook3sZh,
      beatGrid: card.beatGrid,
      reusableZh: card.reusableZh,
      genPromptHintZh: card.genPromptHintZh,
      scenePoolHints: card.scenePoolHints,
      castShape: card.castShape,
      densityHints: card.densityHints,
    };

    const out = await optimizeApprovedManhuaViralTemplate({
      card,
      model: "deepseek_v4_0813_high",
      promptZh: "只优化摘要。",
      requestId: "req_native_160",
      userId: 7,
      invoke: async () => resultWith({
        candidate,
        reasons: [
          { field: "summaryZh", reasonZh: "摘要写得更具体。" },
          { field: "beatGrid", reasonZh: "逐镜证据完整原样带回。" },
        ],
      }),
    });

    expect(out.proposal.beatGrid).toHaveLength(160);
    expect(out.proposal.beatGrid.at(-1)?.visualZh).toBe("v159");
  });

  it("镜头数相同但省略六栏 —— 必须拒绝（只比数量拦不住这种）", async () => {
    const stripped = nativeCard().beatGrid.map((b) => ({
      atSec: b.atSec,
      conflictZh: b.conflictZh,
      visualZh: b.visualZh,
    }));
    await expect(
      runNative(
        nativeOutput(stripped as ManhuaViralTemplateCard["beatGrid"], [
          { field: "summaryZh", reasonZh: "精简摘要。" },
          { field: "beatGrid", reasonZh: "重排节拍。" },
        ], { summaryZh: "更紧凑的绝境开场。" }),
        "req_native_strip",
      ),
    ).rejects.toThrow(/缺少 endSec|缺少 shotSizeZh|缺少 cameraMoveZh/);
  });

  it("六栏完整、只改 conflictZh/visualZh —— 允许", async () => {
    const edited = nativeCard().beatGrid.map((b, i) =>
      i === 0 ? { ...b, conflictZh: "开场压制", visualZh: "两人对峙" } : b,
    );
    const out = await runNative(
      nativeOutput(edited, [{ field: "beatGrid", reasonZh: "首镜冲突写具体。" }]),
      "req_native_ok1",
    );
    expect(out.proposal.beatGrid).toHaveLength(95);
    expect(out.proposal.beatGrid[0]!.cameraMoveZh).toBe("固定机位");
  });

  it("六栏完整且明确优化 cameraMoveZh —— 允许", async () => {
    const edited = nativeCard().beatGrid.map((b, i) =>
      i === 0 ? { ...b, cameraMoveZh: "约2秒内从中景推至面部近景" } : b,
    );
    const out = await runNative(
      nativeOutput(edited, [{ field: "beatGrid", reasonZh: "首镜补运镜。" }]),
      "req_native_ok2",
    );
    expect(out.proposal.beatGrid[0]!.cameraMoveZh).toContain("推至面部近景");
  });

  it("少一镜 —— 继续拒绝", async () => {
    const fewer = nativeCard().beatGrid.slice(0, 94);
    await expect(
      runNative(
        nativeOutput(fewer, [{ field: "beatGrid", reasonZh: "删掉冗余镜。" }]),
        "req_native_fewer",
      ),
    ).rejects.toThrow("镜头数量发生变化");
  });
});
