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

export const growthCampModelValues = [
  "gemini-2.5-pro",
  "gemini-3.1-pro-preview",
] as const;

export const growthCampModelSchema = z.enum(growthCampModelValues);
export type GrowthCampModel = z.infer<typeof growthCampModelSchema>;

export const growthAnalysisScoresSchema = z.object({
  composition: z.number(),
  color: z.number(),
  lighting: z.number(),
  impact: z.number(),
  viralPotential: z.number(),
  visualSummary: z.string().default(""),
  openingFrameAssessment: z.string().default(""),
  sceneConsistency: z.string().default(""),
  trustSignals: z.array(z.string()).default([]),
  visualRisks: z.array(z.string()).default([]),
  keyFrames: z.array(z.object({
    timestamp: z.string(),
    whatShows: z.string(),
    commercialUse: z.string(),
    issue: z.string(),
    fix: z.string(),
  })).default([]),
  strengths: z.array(z.string()).default([]),
  improvements: z.array(z.string()).default([]),
  platforms: z.array(z.string()).default([]),
  summary: z.string().default(""),
  titleSuggestions: z.array(z.string()).default([]),
  creatorCenterSignals: z.array(z.string()).default([]),
  timestampSuggestions: z.array(z.object({
    timestamp: z.string(),
    issue: z.string(),
    fix: z.string(),
    opportunity: z.string().default(""),
  })).default([]),
  weakFrameReferences: z.array(z.object({
    timestamp: z.string(),
    reason: z.string(),
    fix: z.string(),
  })).default([]),
  commercialAngles: z.array(z.object({
    title: z.string(),
    scenario: z.string(),
    whyItFits: z.string(),
    brands: z.array(z.string()).default([]),
    execution: z.string(),
    hook: z.string(),
    veoPrompt: z.string().default(""),
  })).default([]),
  followUpPrompt: z.string().default(""),
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

export const growthPlatformTopicIdeaSchema = z.object({
  title: z.string(),
  angle: z.string(),
  expansion: z.string(),
});

export const growthPlatformRecommendationSchema = z.object({
  name: z.string(),
  reason: z.string(),
  action: z.string(),
  playbook: z.string().default(""),
  topicIdeas: z.array(growthPlatformTopicIdeaSchema).default([]),
});

export const growthTitleExecutionSchema = z.object({
  title: z.string(),
  copywriting: z.string(),
  presentationMode: z.enum(["图文", "短视频", "长视频"]),
  suitablePlatforms: z.array(growthPlatformSchema).default([]),
  reason: z.string(),
  openingHook: z.string().default(""),
  formatReason: z.string().default(""),
  graphicPlan: z.string().default(""),
  videoPlan: z.string().default(""),
});

export const growthBusinessInsightSchema = z.object({
  title: z.string(),
  detail: z.string(),
});

export const growthPlatformActivitySchema = z.object({
  platform: growthPlatformSchema,
  platformLabel: z.string(),
  summary: z.string(),
  activityLevel: z.enum(["高", "中", "低"]).default("中"),
  hotTopics: z.array(z.string()).default([]),
  recommendedFormat: z.string(),
  contentAngle: z.string(),
  suggestedTopics: z.array(z.string()).default([]),
  supportActivities: z.array(z.string()).default([]),
  supportSignal: z.string().default(""),
  potentialTrack: z.string().default(""),
  optimizationPlan: z.string().default(""),
});

export const growthMonetizationStrategySchema = z.object({
  platform: growthPlatformSchema,
  platformLabel: z.string(),
  primaryTrack: z.string(),
  strategy: z.string(),
  callToAction: z.string(),
  offerType: z.string(),
  reason: z.string(),
});

export const growthDataLibrarySectionSchema = z.object({
  id: z.string(),
  title: z.string(),
  purpose: z.string(),
  dataSources: z.array(z.string()).default([]),
  coreFields: z.array(z.string()).default([]),
  outputBoards: z.array(z.string()).default([]),
});

export const growthDecisionNoteSchema = z.object({
  title: z.string(),
  detail: z.string(),
});

export const growthEvidenceSignalSchema = z.object({
  title: z.string(),
  detail: z.string(),
  source: z.string(),
});

export const growthMainPathSchema = z.object({
  title: z.string(),
  summary: z.string(),
  whyNow: z.string(),
  nextAction: z.string(),
});

export const growthAvoidPathSchema = z.object({
  title: z.string(),
  reason: z.string(),
});

export const growthAssetAdaptationSchema = z.object({
  format: z.string(),
  firstHook: z.string(),
  structure: z.string(),
  callToAction: z.string(),
});

export const growthValidationStepSchema = z.object({
  label: z.string(),
  successSignal: z.string(),
  nextMove: z.string(),
});

export const growthAudienceTriggerSchema = z.object({
  label: z.string(),
  reason: z.string(),
  example: z.string(),
});

export const growthDecisionFrameworkSchema = z.object({
  materialFacts: z.array(growthDecisionNoteSchema),
  businessTranslation: z.array(growthDecisionNoteSchema),
  evidenceSignals: z.array(growthEvidenceSignalSchema),
  mainPath: growthMainPathSchema,
  avoidPaths: z.array(growthAvoidPathSchema),
  assetAdaptation: growthAssetAdaptationSchema,
  validationPlan: z.array(growthValidationStepSchema),
  audienceTriggers: z.array(growthAudienceTriggerSchema),
});

export const growthDashboardStatSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.string(),
  note: z.string(),
  delta: z.string(),
});

export const growthDashboardSeriesPointSchema = z.object({
  label: z.string(),
  value: z.number(),
});

export const growthDashboardSeriesSchema = z.object({
  id: z.string(),
  label: z.string(),
  points: z.array(growthDashboardSeriesPointSchema),
});

export const growthFunnelStageSchema = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number().min(0).max(100),
  detail: z.string(),
});

export const growthUserSegmentFunnelSchema = z.object({
  id: z.string(),
  label: z.string(),
  persona: z.string(),
  conversionGoal: z.string(),
  preferredPlatform: z.string(),
  trigger: z.string(),
  action: z.string(),
  stages: z.array(growthFunnelStageSchema),
});

export const growthPersonalizedRecommendationSchema = z.object({
  id: z.string(),
  title: z.string(),
  audience: z.string(),
  why: z.string(),
  evidence: z.string(),
  action: z.string(),
});

export const growthReferenceExampleSchema = z.object({
  id: z.string(),
  platform: growthPlatformSchema,
  platformLabel: z.string(),
  account: z.string(),
  title: z.string(),
  url: z.string().optional(),
  reason: z.string(),
  production: z.string(),
  conversion: z.string(),
});

export const growthDashboardConsoleSchema = z.object({
  headline: z.string(),
  summary: z.string(),
  stats: z.array(growthDashboardStatSchema),
  trendSeries: z.array(growthDashboardSeriesSchema),
  conversionFunnels: z.array(growthUserSegmentFunnelSchema),
  personalizedRecommendations: z.array(growthPersonalizedRecommendationSchema),
  referenceExamples: z.array(growthReferenceExampleSchema).default([]),
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
  assetExtensions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    scenario: z.string(),
    commercialGoal: z.string(),
    bridgeReason: z.string(),
    transitionIdea: z.string(),
    sourceCue: z.string(),
    veoPrompt: z.string(),
    executionNotes: z.string(),
  })).default([]),
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
  titleExecutions: z.array(growthTitleExecutionSchema).default([]),
  platformActivities: z.array(growthPlatformActivitySchema).default([]),
  monetizationStrategies: z.array(growthMonetizationStrategySchema).default([]),
  dataLibraryStructure: z.array(growthDataLibrarySectionSchema).default([]),
  businessInsights: z.array(growthBusinessInsightSchema),
  decisionFramework: growthDecisionFrameworkSchema,
  dashboardConsole: growthDashboardConsoleSchema,
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
export type GrowthPlatformTopicIdea = z.infer<typeof growthPlatformTopicIdeaSchema>;
export type GrowthPlatformRecommendation = z.infer<typeof growthPlatformRecommendationSchema>;
export type GrowthTitleExecution = z.infer<typeof growthTitleExecutionSchema>;
export type GrowthBusinessInsight = z.infer<typeof growthBusinessInsightSchema>;
export type GrowthPlatformActivity = z.infer<typeof growthPlatformActivitySchema>;
export type GrowthMonetizationStrategy = z.infer<typeof growthMonetizationStrategySchema>;
export type GrowthDataLibrarySection = z.infer<typeof growthDataLibrarySectionSchema>;
export type GrowthDecisionNote = z.infer<typeof growthDecisionNoteSchema>;
export type GrowthEvidenceSignal = z.infer<typeof growthEvidenceSignalSchema>;
export type GrowthMainPath = z.infer<typeof growthMainPathSchema>;
export type GrowthAvoidPath = z.infer<typeof growthAvoidPathSchema>;
export type GrowthAssetAdaptation = z.infer<typeof growthAssetAdaptationSchema>;
export type GrowthValidationStep = z.infer<typeof growthValidationStepSchema>;
export type GrowthAudienceTrigger = z.infer<typeof growthAudienceTriggerSchema>;
export type GrowthDecisionFramework = z.infer<typeof growthDecisionFrameworkSchema>;
export type GrowthDashboardStat = z.infer<typeof growthDashboardStatSchema>;
export type GrowthDashboardSeries = z.infer<typeof growthDashboardSeriesSchema>;
export type GrowthFunnelStage = z.infer<typeof growthFunnelStageSchema>;
export type GrowthUserSegmentFunnel = z.infer<typeof growthUserSegmentFunnelSchema>;
export type GrowthPersonalizedRecommendation = z.infer<typeof growthPersonalizedRecommendationSchema>;
export type GrowthReferenceExample = z.infer<typeof growthReferenceExampleSchema>;
export type GrowthDashboardConsole = z.infer<typeof growthDashboardConsoleSchema>;
export type GrowthPlanStep = z.infer<typeof growthPlanStepSchema>;
export type GrowthCreationAssist = z.infer<typeof growthCreationAssistSchema>;
export type GrowthHandoff = z.infer<typeof growthHandoffSchema>;
export type GrowthSnapshotStatus = z.infer<typeof growthSnapshotStatusSchema>;
export type GrowthSnapshot = z.infer<typeof growthSnapshotSchema>;
