import { z } from "zod";

export const platformTrustSystemSchema = z.object({
  resonance: z.string(),
  methodology: z.string(),
  caseProof: z.string(),
  guarantee: z.string(),
  journeyNote: z.string().optional(),
});

export const platformFourAiCapabilitiesSchema = z.object({
  dataAbility: z.string(),
  contentAbility: z.string(),
  thinkingAbility: z.string(),
  productAbility: z.string(),
});

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

export const platformTopicDirectionSchema = z.object({
  title: z.string(),
  angle: z.string(),
  painPointHotspotFormula: z.string(),
  platform: z.string().optional(),
});

export const platformHookStrategySchema = z.object({
  graphicHook: z.string().optional(),
  videoHook: z.string().optional(),
  advancedForm: z.string().optional(),
  principles: z.array(z.string()).default([]),
  conversionAction: z.string().optional(),
  conversionDirection: z.string().optional(),
  fulfillmentNote: z.string().optional(),
});

export const platformTrackDecisionSchema = z.object({
  platform: z.string(),
  track: z.string(),
  rationale: z.string(),
  contentFormat: z.string().optional(),
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
  /** 第二部分：平台 / 赛道 / 选题 / 钩子 / 转化 */
  primaryPlatform: z.string().optional(),
  primaryTrack: z.string().optional(),
  contentFormatRecommendation: z.enum(["graphic", "video", "mixed"]).optional(),
  topicDirections: z.array(platformTopicDirectionSchema).default([]),
  hookStrategy: platformHookStrategySchema.optional(),
  platformTrackDecision: platformTrackDecisionSchema.optional(),
  /** 四有信任体系（转化优先，与战略全景深度联动） */
  trustSystem: platformTrustSystemSchema.optional(),
  /** AI 超能力 · 四种核心能力 */
  fourAiCapabilities: platformFourAiCapabilitiesSchema.optional(),
});

export const platformPositioningInterviewResponseSchema = z.object({
  status: z.enum(["continue", "ready"]),
  round: z.number().int().min(1),
  resonance: z.string().optional(),
  questions: z.array(z.string()).default([]),
  deepPositioningBrief: platformDeepPositioningBriefSchema.optional(),
  /** 首轮返回的数据快照摘要（供 UI 展示） */
  dataSnapshotPreview: z.string().optional(),
});

export type PlatformPositioningTurn = z.infer<typeof platformPositioningTurnSchema>;
export type PlatformDeepPositioningBrief = z.infer<typeof platformDeepPositioningBriefSchema>;
export type PlatformPositioningInterviewResponse = z.infer<
  typeof platformPositioningInterviewResponseSchema
>;

function formatContentFormat(fmt: PlatformDeepPositioningBrief["contentFormatRecommendation"]): string {
  if (fmt === "graphic") return "图文笔记为主";
  if (fmt === "video") return "短视频/出镜为主";
  if (fmt === "mixed") return "图文+视频组合";
  return "";
}

/** 将深度定位简报合并进 Stage1/2 的 context 字段 */
export function mergePlatformContextWithDeepPositioning(
  userPrompt: string,
  brief: PlatformDeepPositioningBrief | null | undefined,
): string {
  const prompt = String(userPrompt || "").trim();
  if (!brief) return prompt;

  const hook = brief.hookStrategy;
  const track = brief.platformTrackDecision;
  const topicDirLines = (brief.topicDirections || [])
    .slice(0, 5)
    .map((t, i) => `${i + 1}. ${t.title}（${t.painPointHotspotFormula}）· ${t.angle}`);

  const lines = [
    prompt ? `【用户原始诉求】\n${prompt}` : "",
    `【深度定位与获客简报 · 定位获客六步法】`,
    `一句话定位：${brief.positioningOneLiner}`,
    `定位类型：${brief.positioningType === "capability" ? "能力型" : brief.positioningType === "industry" ? "行业型" : "资源借力型"}`,
    `独特解决方案：${brief.uniqueSolution}`,
    `核心痛点：${brief.painPointSummary}`,
    brief.topPrioritySubgroup
      ? `优先服务人群：${brief.topPrioritySubgroup.label}（付费意愿：${brief.topPrioritySubgroup.willingnessToPay || "—"}；痛点强度：${brief.topPrioritySubgroup.painIntensity || "—"}；触达成本：${brief.topPrioritySubgroup.reachCost || "—"}）`
      : "",
    brief.primaryPlatform || brief.recommendedPlatforms.length
      ? `首选平台：${brief.primaryPlatform || brief.recommendedPlatforms[0]}${brief.primaryTrack ? ` · 主攻赛道：${brief.primaryTrack}` : ""}${formatContentFormat(brief.contentFormatRecommendation) ? ` · ${formatContentFormat(brief.contentFormatRecommendation)}` : ""}`
      : "",
    track ? `平台赛道决策：${track.platform} / ${track.track} — ${track.rationale}` : brief.platformRationale || "",
    topicDirLines.length ? `选题方向（痛点×热点）：\n${topicDirLines.join("\n")}` : "",
    brief.topicSeeds.length ? `选题种子：${brief.topicSeeds.slice(0, 6).join("；")}` : "",
    hook
      ? [
          `钩子与转化：`,
          hook.graphicHook ? `图文钩子：${hook.graphicHook}` : "",
          hook.videoHook ? `视频钩子：${hook.videoHook}` : "",
          hook.advancedForm ? `内容即钩子：${hook.advancedForm}` : "",
          hook.conversionDirection ? `转化方向：${hook.conversionDirection}` : "",
          hook.conversionAction ? `承接动作：${hook.conversionAction}` : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "",
    brief.trustSystem
      ? [
          `四有信任体系：`,
          `有共鸣：${brief.trustSystem.resonance}`,
          `有方法：${brief.trustSystem.methodology}`,
          `有案例：${brief.trustSystem.caseProof}`,
          `有保障：${brief.trustSystem.guarantee}`,
        ].join("\n")
      : "",
    brief.fourAiCapabilities
      ? [
          `AI 四能力落地：`,
          `数据能力：${brief.fourAiCapabilities.dataAbility}`,
          `内容能力：${brief.fourAiCapabilities.contentAbility}`,
          `思考能力：${brief.fourAiCapabilities.thinkingAbility}`,
          `产品能力：${brief.fourAiCapabilities.productAbility}`,
        ].join("\n")
      : "",
    brief.acquisitionOptimizationNotes ? `获客优化要点：${brief.acquisitionOptimizationNotes}` : "",
    brief.resourceLeverageFormula ? `借力公式：${brief.resourceLeverageFormula}` : "",
  ].filter(Boolean);
  return lines.join("\n");
}
