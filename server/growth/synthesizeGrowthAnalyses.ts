import { type GrowthAnalysisScores, growthAnalysisScoresSchema } from "@shared/growth";
import { invokeLLM } from "../_core/llm";
import { resolveGrowthCampStrategistEngine } from "./extractorPipeline";

function mergeDeterministic(parts: GrowthAnalysisScores[]): GrowthAnalysisScores {
  const avg = (key: keyof GrowthAnalysisScores) => {
    const nums = parts
      .map((p) => (typeof p[key] === "number" ? (p[key] as number) : NaN))
      .filter((n) => Number.isFinite(n));
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 70;
  };
  const uniq = (items: string[]) => Array.from(new Set(items.map((s) => s.trim()).filter(Boolean))).slice(0, 6);

  return growthAnalysisScoresSchema.parse({
    composition: avg("composition"),
    color: avg("color"),
    lighting: avg("lighting"),
    impact: avg("impact"),
    viralPotential: avg("viralPotential"),
    strengths: uniq(parts.flatMap((p) => p.strengths || [])).slice(0, 4),
    improvements: uniq(parts.flatMap((p) => p.improvements || [])).slice(0, 4),
    platforms: uniq(parts.flatMap((p) => p.platforms || [])).slice(0, 4),
    summary: parts.map((p) => p.summary?.trim()).filter(Boolean).join("\n\n"),
  });
}

/** 将多段素材（视频/图片）分析结果合成为一份商业分析报告 */
export async function synthesizeGrowthAnalyses(params: {
  parts: Array<{ label: string; analysis: GrowthAnalysisScores }>;
  context?: string;
  modelName?: string;
}): Promise<GrowthAnalysisScores> {
  const parts = (params.parts || []).filter((p) => p.analysis);
  if (parts.length === 0) {
    throw new Error("无可合并的分析结果");
  }
  if (parts.length === 1) {
    return parts[0]!.analysis;
  }

  const strategistEngine = resolveGrowthCampStrategistEngine(params.modelName);
  const payload = parts.map((p) => ({
    label: p.label,
    analysis: p.analysis,
  }));

  try {
    const response = await invokeLLM({
      model: "pro",
      provider: strategistEngine.provider,
      modelName: strategistEngine.modelName,
      messages: [
        {
          role: "system",
          content: `你是 Creator Growth Camp 商业分析编辑。用户上传了多份素材（视频/图片），每份已有独立分析 JSON。
请合并为**一份**统一评分结构，去重、互补、不矛盾；summary 要连贯可读。

只返回 JSON（字段与单份分析相同）：
{
  "composition": number,
  "color": number,
  "lighting": number,
  "impact": number,
  "viralPotential": number,
  "strengths": ["string"],
  "improvements": ["string"],
  "platforms": ["string"],
  "summary": "string"
}`,
        },
        {
          role: "user",
          content: [
            params.context?.trim() ? `业务背景：${params.context.trim()}` : "",
            `待合并 ${parts.length} 份分析：\n${JSON.stringify(payload, null, 2)}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
      response_format: { type: "json_object" },
    });
    const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
    return growthAnalysisScoresSchema.parse(parsed);
  } catch (error) {
    console.warn("[growth.synthesizeGrowthAnalyses] fallback merge:", error);
    return mergeDeterministic(parts.map((p) => p.analysis));
  }
}
