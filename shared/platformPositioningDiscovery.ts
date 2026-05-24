import { z } from "zod";

export const platformPositioningTurnSchema = z.object({
  questions: z.array(z.string()),
  answer: z.string().optional(),
});

export const platformTargetSubgroupSchema = z.object({
  label: z.string(),
  ageRange: z.string().optional(),
  occupation: z.string().optional(),
  incomeRange: z.string().optional(),
  familySituation: z.string().optional(),
  cityTier: z.string().optional(),
  topAnxiety: z.string().optional(),
  painPoints: z.array(z.string()).default([]),
  userQuotes: z.array(z.string()).default([]),
});

export const platformDeepPositioningBriefSchema = z.object({
  positioningOneLiner: z.string(),
  positioningType: z.enum(["capability", "industry", "resource"]),
  uniqueSolution: z.string(),
  painPointSummary: z.string(),
  targetSubgroups: z.array(platformTargetSubgroupSchema).default([]),
  topPrioritySubgroup: z
    .object({
      label: z.string(),
      willingnessToPay: z.string().optional(),
      painIntensity: z.string().optional(),
      reachCost: z.string().optional(),
      rationale: z.string().optional(),
    })
    .optional(),
  recommendedPlatforms: z.array(z.string()).default([]),
  platformRationale: z.string().optional(),
  acquisitionOptimizationNotes: z.string().optional(),
  resourceLeverageFormula: z.string().optional(),
  topicSeeds: z.array(z.string()).default([]),
});

export const platformPositioningInterviewResponseSchema = z.object({
  status: z.enum(["continue", "ready"]),
  round: z.number().int().min(1),
  resonance: z.string().optional(),
  questions: z.array(z.string()).default([]),
  deepPositioningBrief: platformDeepPositioningBriefSchema.optional(),
});

export type PlatformPositioningTurn = z.infer<typeof platformPositioningTurnSchema>;
export type PlatformDeepPositioningBrief = z.infer<typeof platformDeepPositioningBriefSchema>;
export type PlatformPositioningInterviewResponse = z.infer<
  typeof platformPositioningInterviewResponseSchema
>;

/** 将深度定位简报合并进 Stage1/2 的 context 字段 */
export function mergePlatformContextWithDeepPositioning(
  userPrompt: string,
  brief: PlatformDeepPositioningBrief | null | undefined,
): string {
  const prompt = String(userPrompt || "").trim();
  if (!brief) return prompt;
  const lines = [
    prompt ? `【用户原始诉求】\n${prompt}` : "",
    `【深度定位简报 · 定位获客六步法（第一部分）】`,
    `一句话定位：${brief.positioningOneLiner}`,
    `定位类型：${brief.positioningType === "capability" ? "能力型" : brief.positioningType === "industry" ? "行业型" : "资源借力型"}`,
    `独特解决方案：${brief.uniqueSolution}`,
    `核心痛点：${brief.painPointSummary}`,
    brief.topPrioritySubgroup
      ? `优先服务人群：${brief.topPrioritySubgroup.label}（付费意愿：${brief.topPrioritySubgroup.willingnessToPay || "—"}；痛点强度：${brief.topPrioritySubgroup.painIntensity || "—"}；触达成本：${brief.topPrioritySubgroup.reachCost || "—"}）`
      : "",
    brief.recommendedPlatforms.length
      ? `推荐平台：${brief.recommendedPlatforms.join("、")}${brief.platformRationale ? `（${brief.platformRationale}）` : ""}`
      : "",
    brief.acquisitionOptimizationNotes
      ? `获客优化要点：${brief.acquisitionOptimizationNotes}`
      : "",
    brief.resourceLeverageFormula ? `借力公式：${brief.resourceLeverageFormula}` : "",
    brief.topicSeeds.length ? `选题种子：${brief.topicSeeds.slice(0, 8).join("；")}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
