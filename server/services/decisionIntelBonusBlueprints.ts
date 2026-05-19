/**
 * 决策智库 · 战略地图生成成功后，为筛选出的 2 条选题扩写可执行级专属文案（仅随 mutation 返回，不入库展示）。
 */

import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import { selectDecisionIntelBonusTopics } from "@shared/decisionIntelBonusTopics";
import { buildAutoPickedTitleVariantsForBlueprint } from "@shared/platformTitleVariants";
import { extractJsonString, invokeLLM } from "../_core/llm";
import { resolveGrowthCampExtractorModel } from "../growth/extractorPipeline";

function blueprintJsonForPrompt(contentBlueprint: unknown, maxChars = 10_000): string {
  try {
    return JSON.stringify(contentBlueprint ?? {}).slice(0, maxChars);
  } catch {
    return "{}";
  }
}

type BonusBlueprintOutput = {
  contentBlueprints?: Array<Record<string, unknown>>;
};

/**
 * 依战略地图选题结构实例筛选 Top2，并扩写为与 Stage2 兼容的 contentBlueprint 条目。
 */
export async function generateDecisionIntelBonusBlueprints(params: {
  report: AdvancedAIReportData;
  contentBlueprint: unknown;
  topic: string;
  platformHint: string;
  abortSignal?: AbortSignal;
}): Promise<Record<string, unknown>[]> {
  const selected = selectDecisionIntelBonusTopics(params.report.topicStructureExamples);
  if (selected.length === 0) return [];

  const platformLabelMap = {
    douyin: "抖音",
    bilibili: "B站",
    xiaohongshu: "小红书",
    kuaishou: "快手",
  } as const;
  const platformLabel =
    platformLabelMap[params.platformHint as keyof typeof platformLabelMap] ?? params.platformHint;

  const topicsBlock = selected
    .map(
      (ex, i) =>
        `${i + 1}. 标题：${ex.title}\n   结构骨架：${ex.structure}\n   预估：封面 CTR ${ex.predictedCtr}% · 转化 ${ex.predictedConversion}% · 契合 ${ex.brandMatchFit}`,
    )
    .join("\n\n");

  const modelName = resolveGrowthCampExtractorModel();
  const system = `你是资深内容策划，负责把「战略地图选题结构」扩写为可立刻开拍的执行方案。
【规则】
- 只输出一个 JSON 对象，键名 contentBlueprints，数组长度必须恰好等于输入选题条数（通常 2）。
- 每条须含：title、format（「短视频」或「图文」）、hook（≥30字）、copywriting（≥180字）、suitablePlatforms（字符串数组）、actionableSteps（≥3条）、detailedScript（≥280字）、publishingAdvice、executionDetails（含 environmentAndWardrobe、lightingAndCamera、stepByStepScript 数组≥4步）。
- 须严格延续输入标题与结构骨架的主线，不得偏题；语气专业、可拍、简体中文。
- 禁止 markdown 代码块；第一个字符必须是 {。`;

  const user = `【账号选题方向】${params.topic}
【主战场平台】${platformLabel}
【既有内容蓝图参考】${blueprintJsonForPrompt(params.contentBlueprint)}

请为以下 ${selected.length} 条战略地图优选选题各写 1 套完整执行文案（顺序与编号一致）：

${topicsBlock}`;

  const response = await invokeLLM({
    model: "flash",
    provider: "vertex",
    modelName,
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    response_format: { type: "json_object" },
    maxTokens: 8192,
    abortSignal: params.abortSignal,
  });

  const raw = String(response.choices[0]?.message?.content ?? "{}");
  let parsed: BonusBlueprintOutput;
  try {
    parsed = JSON.parse(extractJsonString(raw)) as BonusBlueprintOutput;
  } catch {
    return [];
  }

  const list = Array.isArray(parsed.contentBlueprints) ? parsed.contentBlueprints : [];
  const out: Record<string, unknown>[] = [];

  for (let i = 0; i < Math.min(selected.length, list.length); i++) {
    const bp = list[i];
    if (!bp || typeof bp !== "object") continue;
    const seed = {
      ...bp,
      title: String(bp.title ?? selected[i]!.title).trim() || selected[i]!.title,
      structure: selected[i]!.structure,
      decisionIntelBonus: true,
      predictedCtr: selected[i]!.predictedCtr,
      predictedConversion: selected[i]!.predictedConversion,
      brandMatchFit: selected[i]!.brandMatchFit,
    };
    const titleVariants = buildAutoPickedTitleVariantsForBlueprint(seed, 4 + i);
    const picked = String(titleVariants[0]?.title ?? "").trim();
    out.push({
      ...seed,
      id: `decision-intel-bonus-${i}-${Date.now()}`,
      title: picked || seed.title,
      titleVariants,
    });
  }

  return out;
}
