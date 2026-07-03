import type { GrowthAnalysisScores } from "@shared/growth";

export type AssetAnalysisHandoffPayload = {
  sourceText: string;
  optimizationBrief: string;
  visionContext: string;
};

/** 将素材视觉分析结果格式化为「深度优化文案」mutation 输入。 */
export function formatAssetAnalysisForOptimize(
  analysis: GrowthAnalysisScores,
  userContext?: string,
): AssetAnalysisHandoffPayload {
  const lines: string[] = [];

  if (analysis.summary?.trim()) lines.push(`【分析摘要】\n${analysis.summary.trim()}`);
  if (analysis.visualSummary?.trim()) lines.push(`【画面摘要】\n${analysis.visualSummary.trim()}`);
  if (analysis.realityCheck?.trim()) lines.push(`【现实查验】\n${analysis.realityCheck.trim()}`);

  const re = analysis.reverseEngineering;
  if (re?.hookStrategy || re?.emotionalArc || re?.commercialLogic) {
    lines.push(
      [
        re.hookStrategy ? `钩子策略：${re.hookStrategy}` : "",
        re.emotionalArc ? `情绪弧线：${re.emotionalArc}` : "",
        re.commercialLogic ? `商业逻辑：${re.commercialLogic}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }

  if (analysis.strengths?.length) {
    lines.push(`【优势】\n${analysis.strengths.map((s) => `· ${s}`).join("\n")}`);
  }
  if (analysis.improvements?.length) {
    lines.push(`【改进建议】\n${analysis.improvements.map((s) => `· ${s}`).join("\n")}`);
  }
  if (analysis.titleSuggestions?.length) {
    lines.push(`【标题建议】\n${analysis.titleSuggestions.map((s) => `· ${s}`).join("\n")}`);
  }

  const remixGuide = analysis.remixExecution?.imageTextNoteGuide;
  if (remixGuide?.structuredBody?.trim()) {
    lines.push(`【图文笔记指南】\n${remixGuide.structuredBody.trim()}`);
  }

  const visionContext = lines.join("\n\n").trim();
  const context = String(userContext || "").trim();

  const sourceText =
    visionContext.length >= 10
      ? visionContext
      : context.length >= 10
        ? context
        : `${visionContext}\n${context}`.trim();

  const optimizationBrief = [
    context ? `【用户补充背景】\n${context}` : "",
    "请基于上述上传素材的视觉分析（封面/分镜），深度优化封面主副标、2×4 分镜叙事节奏与各平台发布稿。",
    "必须紧扣素材内人物、场景与专业背景，禁止输出与用户素材无关的模板标题或套话。",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    sourceText: sourceText.slice(0, 11000),
    optimizationBrief: optimizationBrief.slice(0, 4000),
    visionContext: visionContext.slice(0, 8000),
  };
}
