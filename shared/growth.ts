import { z } from "zod";

export const growthPlatformValues = [
  "douyin",
  "weixin_channels",
  "xiaohongshu",
  "bilibili",
  "kuaishou",
  "toutiao",
] as const;

export const growthPlatformSchema = z.enum(growthPlatformValues);

export const growthAnalysisScoresSchema = z.object({
  composition: z.number(),
  color: z.number(),
  lighting: z.number(),
  impact: z.number(),
  viralPotential: z.number(),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default([]),
  summary: z.string().default(""),
});

export const growthMetricWindowSchema = z.object({
  postsAnalyzed: z.number().int().nonnegative(),
  creatorsTracked: z.number().int().nonnegative(),
  avgViews: z.number().nonnegative(),
  avgLikes: z.number().nonnegative(),
  avgComments: z.number().nonnegative(),
  avgShares: z.number().nonnegative(),
  engagementRateMedian: z.number().nonnegative(),
  growthRate: z.number(),
  saveRateMedian: z.number().nonnegative(),
  topDurationRange: z.string(),
  sampleSizeLabel: z.string(),
});

export const growthPlatformSnapshotSchema = z.object({
  platform: growthPlatformSchema,
  displayName: z.string(),
  summary: z.string(),
  fitLabel: z.string(),
  momentumScore: z.number().min(0).max(100),
  audienceFitScore: z.number().min(0).max(100),
  competitionLevel: z.enum(["low", "medium", "high"]),
  recommendedFormats: z.array(z.string()),
  bestPostingWindows: z.array(z.string()),
  watchouts: z.array(z.string()),
  sampleTopics: z.array(z.string()),
  last30d: growthMetricWindowSchema,
});

export const growthTrendLayerSchema = z.object({
  id: z.string(),
  platform: growthPlatformSchema,
  platformLabel: z.string(),
  layerType: z.enum(["topic", "content", "structure"]),
  sourceType: z.enum(["live", "structure"]),
  title: z.string(),
  summary: z.string(),
  sampleCount: z.number().int().nonnegative(),
  sampleLabel: z.string(),
  items: z.array(z.string()),
});

export const growthTopicLibraryItemSchema = z.object({
  id: z.string(),
  platform: growthPlatformSchema,
  platformLabel: z.string(),
  title: z.string(),
  rationale: z.string(),
  executionHint: z.string(),
  commercialAngle: z.string(),
  confidence: z.number().min(0).max(100),
});

export const growthIndustryTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  audience: z.string(),
  painPoint: z.string(),
  positioningHint: z.string(),
  analysisHint: z.string(),
  trustAsset: z.string(),
  primaryConversion: z.string(),
  commercialFocus: z.string(),
  offerExamples: z.array(z.string()).default([]),
});

export const growthContentPatternSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  momentum: z.enum(["rising", "stable", "cooling"]),
  platforms: z.array(growthPlatformSchema),
  hookTemplate: z.string(),
  monetizationHint: z.string(),
});

export const growthOpportunitySchema = z.object({
  id: z.string(),
  title: z.string(),
  whyNow: z.string(),
  nextAction: z.string(),
  linkedPlatforms: z.array(growthPlatformSchema),
});

export const growthStructurePatternSchema = z.object({
  id: z.string(),
  title: z.string(),
  angle: z.string(),
  hook: z.string(),
  cta: z.string(),
  recommendedPlatforms: z.array(growthPlatformSchema),
  evidence: z.string(),
});

export const growthMonetizationTrackSchema = z.object({
  name: z.string(),
  fit: z.number().min(0).max(100),
  reason: z.string(),
  nextStep: z.string(),
});

export const growthPlatformRecommendationSchema = z.object({
  name: z.string(),
  reason: z.string(),
  action: z.string(),
});

export const growthBusinessInsightSchema = z.object({
  title: z.string(),
  detail: z.string(),
});

export const growthPlanStepSchema = z.object({
  day: z.number().int().min(1).max(30),
  title: z.string(),
  action: z.string(),
});

export const growthCreationAssistSchema = z.object({
  brief: z.string(),
  storyboardPrompt: z.string(),
  workflowPrompt: z.string(),
});

export const growthHandoffSchema = z.object({
  brief: z.string(),
  storyboardPrompt: z.string(),
  workflowPrompt: z.string(),
  recommendedTrack: z.string(),
  recommendedPlatforms: z.array(growthPlatformSchema),
  businessGoal: z.string(),
});

export const growthSnapshotStatusSchema = z.object({
  source: z.enum(["mock", "fallback", "live", "hybrid"]),
  generatedAt: z.string(),
  windowDays: z.number().int().positive(),
  freshnessLabel: z.string(),
  collectorReady: z.boolean(),
  missingConnectors: z.array(z.string()),
  notes: z.array(z.string()),
});

export const growthSnapshotSchema = z.object({
  status: growthSnapshotStatusSchema,
  requestedPlatforms: z.array(growthPlatformSchema),
  industryTemplate: growthIndustryTemplateSchema,
  overview: z.object({
    summary: z.string(),
    trendNarrative: z.string(),
    nextCollectionPlan: z.string(),
  }),
  trendLayers: z.array(growthTrendLayerSchema),
  topicLibrary: z.array(growthTopicLibraryItemSchema),
  platformSnapshots: z.array(growthPlatformSnapshotSchema),
  contentPatterns: z.array(growthContentPatternSchema),
  opportunities: z.array(growthOpportunitySchema),
  structurePatterns: z.array(growthStructurePatternSchema),
  monetizationTracks: z.array(growthMonetizationTrackSchema),
  platformRecommendations: z.array(growthPlatformRecommendationSchema),
  businessInsights: z.array(growthBusinessInsightSchema),
  growthPlan: z.array(growthPlanStepSchema),
  creationAssist: growthCreationAssistSchema,
  growthHandoff: growthHandoffSchema,
});

export type GrowthPlatform = z.infer<typeof growthPlatformSchema>;
export type GrowthAnalysisScores = z.infer<typeof growthAnalysisScoresSchema>;
export type GrowthMetricWindow = z.infer<typeof growthMetricWindowSchema>;
export type GrowthPlatformSnapshot = z.infer<typeof growthPlatformSnapshotSchema>;
export type GrowthTrendLayer = z.infer<typeof growthTrendLayerSchema>;
export type GrowthTopicLibraryItem = z.infer<typeof growthTopicLibraryItemSchema>;
export type GrowthIndustryTemplate = z.infer<typeof growthIndustryTemplateSchema>;
export type GrowthContentPattern = z.infer<typeof growthContentPatternSchema>;
export type GrowthOpportunity = z.infer<typeof growthOpportunitySchema>;
export type GrowthStructurePattern = z.infer<typeof growthStructurePatternSchema>;
export type GrowthMonetizationTrack = z.infer<typeof growthMonetizationTrackSchema>;
export type GrowthPlatformRecommendation = z.infer<typeof growthPlatformRecommendationSchema>;
export type GrowthBusinessInsight = z.infer<typeof growthBusinessInsightSchema>;
export type GrowthPlanStep = z.infer<typeof growthPlanStepSchema>;
export type GrowthCreationAssist = z.infer<typeof growthCreationAssistSchema>;
export type GrowthHandoff = z.infer<typeof growthHandoffSchema>;
export type GrowthSnapshotStatus = z.infer<typeof growthSnapshotStatusSchema>;
export type GrowthSnapshot = z.infer<typeof growthSnapshotSchema>;
