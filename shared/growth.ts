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

export const growthAnalysisModeValues = ["GROWTH", "REMIX"] as const;
export const growthAnalysisModeSchema = z.enum(growthAnalysisModeValues);
export type GrowthAnalysisMode = z.infer<typeof growthAnalysisModeSchema>;

export const growthPlatformScoresSchema = z.object({
  xiaohongshu: z.number().default(0),
  douyin: z.number().default(0),
  bilibili: z.number().default(0),
  kuaishou: z.number().default(0),
});

export const growthReverseEngineeringSchema = z.object({
  hookStrategy: z.string().default(""),
  emotionalArc: z.string().default(""),
  commercialLogic: z.string().default(""),
});

export const growthDirectorExecutionSchema = z.object({
  storyboard: z.array(z.string()).default([]).describe("分镜拆解：逐条写清镜头顺序、画面内容、动作、时长和剪辑点"),
  lighting: z.string().default("").describe("灯光布置：包含主光、轮廓光、色温、角度和现场质感"),
  blocking: z.string().default("").describe("走位调度：包含站位、动线、手部动作和与产品/证据物的关系"),
  emotionalTension: z.string().default("").describe("情绪控制：包含表情、停顿、语速、冲突推进和收束方式"),
}).describe("导演级实战执行指令");

export const growthShootingBlueprintSchema = z.object({
  storyboard: z.array(z.string()).default([]),
  lighting: z.string().default(""),
  blocking: z.string().default(""),
  shotSize: z.string().default(""),
  emotionalTension: z.string().default(""),
  cameraPerformance: z.string().default(""),
});

export const growthRemixBusinessInsightSchema = z.object({
  video: z.string().default(""),
  imageText: z.string().default(""),
  monetizationLogic: z.string().default(""),
});

export const growthPremiumContentTopicSchema = z.object({
  title: z.string().default(""),
  formatType: z.enum(["VIDEO", "IMAGE_TEXT"]).default("VIDEO"),
  businessInsight: z.string().describe("【商業深度洞察】必須包含具體的：引流品設計、利潤品設計、轉化路徑。不少於 300 字。").default(""),
  contentBrief: z.string().default(""),
  directorExecution: z.object({
    storyboard: z.array(z.string()).default([]),
    lighting: z.string().default(""),
    blocking: z.string().default(""),
    emotionalTension: z.string().describe("必須生成具體的導演情緒指導，絕對禁止輸出佔位符。").default("")
  }).default({ storyboard: [], lighting: "", blocking: "", emotionalTension: "" })
});

export const growthPremiumContentSchema = z.object({
  summary: z.string().default(""),
  strategy: z.string().describe("頂級商業顧問：人設拆解與產品矩陣規劃").default(""),
  actionableTopics: z.array(growthPremiumContentTopicSchema).describe("現在就能執行的版本：必須帶有完整分鏡與腳本").default([]),
  topics: z.array(growthPremiumContentTopicSchema).describe("核心爆款選題").default([]),
  explosiveTopicAnalysis: z.string().describe("選題深度綜述分析").default(""),
  musicAndExpressionAnalysis: z.string().describe("表達與配樂分析：BGM 建議與表達技巧").default(""),
  musicPrompt: z.string().describe("AI Music Prompt：專為 Suno/Udio 設計的提示詞，格式：[Style], [Instruments], [Mood], [Tempo]").default(""),
});

export const growthStrategySchema = z.object({
  gapAnalysis: z.string().default(""),
  commercialMatrix: z.string().default(""),
});

export const growthRemixExecutionSchema = z.object({
  hookLibrary: z.array(z.string()).default([]),
  emotionalPacing: z.string().default(""),
  visualPaletteAndScript: z.string().default(""),
  productMatrix: z.string().default(""),
  shootingGuidance: z.string().default(""),
  businessInsight: growthRemixBusinessInsightSchema.default({
    video: "",
    imageText: "",
    monetizationLogic: "",
  }),
  shootingBlueprint: growthShootingBlueprintSchema.default({
    storyboard: [],
    lighting: "",
    blocking: "",
    shotSize: "",
    emotionalTension: "",
    cameraPerformance: "",
  }),
  imageTextNoteGuide: z.object({
    coverSetup: z.string().default(""),
    titleOptions: z.array(z.string()).default([]),
    structuredBody: z.string().default(""),
  }).default({
    coverSetup: "",
    titleOptions: [],
    structuredBody: "",
  }),
  xiaohongshuLayout: z.string().default(""),
});

export const growthAnalysisScoresSchema = z.object({
  composition: z.number(),
  color: z.number(),
  lighting: z.number(),
  impact: z.number(),
  viralPotential: z.number(),
  explosiveIndex: z.number().default(0),
  platformScores: growthPlatformScoresSchema.optional(),
  realityCheck: z.string().default(""),
  reverseEngineering: growthReverseEngineeringSchema.default({
    hookStrategy: "",
    emotionalArc: "",
    commercialLogic: "",
  }),
  premiumContent: growthPremiumContentSchema.default({
    summary: "",
    strategy: "",
    actionableTopics: [],
    topics: [],
    explosiveTopicAnalysis: "",
    musicAndExpressionAnalysis: "",
    musicPrompt: "",
  }),
  growthStrategy: growthStrategySchema.optional(),
  remixExecution: growthRemixExecutionSchema.optional(),
  visualSummary: z.string().default(""),
  openingFrameAssessment: z.string().default(""),
  sceneConsistency: z.string().default(""),
  languageExpression: z.string().default(""),
  emotionalExpression: z.string().default(""),
  cameraEmotionTension: z.string().default(""),
  bgmAnalysis: z.string().default(""),
  musicRecommendation: z.string().default(""),
  sunoPrompt: z.string().default(""),
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
  source: z.enum(["live", "historical", "hybrid"]),
  generatedAt: z.string(),
  windowDays: z.number().int().positive(),
  freshnessLabel: z.string(),
  collectorReady: z.boolean(),
  missingConnectors: z.array(z.string()),
  notes: z.array(z.string()),
});

export const growthDualTrackSchema = z.object({
  mode: z.literal("双主链"),
  liveSummary: z.string(),
  historicalSummary: z.string(),
  liveHotTopic: z.string(),
  hotTopicTimeliness: z.string(),
});

export const growthDataAnalystPlatformRowSchema = z.object({
  platform: growthPlatformSchema,
  platformLabel: z.string(),
  currentTotal: z.number().int().nonnegative(),
  archivedTotal: z.number().int().nonnegative(),
  datedCurrentCount: z.number().int().nonnegative(),
  undatedCurrentCount: z.number().int().nonnegative(),
  liveCoverageStart: z.string().default(""),
  liveCoverageEnd: z.string().default(""),
  dominantFormat: z.string(),
  note: z.string(),
});

export const growthDataAnalystSummarySchema = z.object({
  platformRows: z.array(growthDataAnalystPlatformRowSchema).default([]),
  liveCoverageWindow: z.string(),
  historicalCoverageWindow: z.string(),
  undatedRetainedItems: z.array(z.string()).default([]),
  missingRangesOrBrokenLayers: z.array(z.string()).default([]),
  recommendation: z.enum(["keep", "backfill", "restore", "verify"]),
  recommendationReason: z.string(),
});

export const growthPremiumRemixCharacterSchema = z.object({
  id: z.string(),
  label: z.string(),
  role: z.string(),
  visualPrompt: z.string(),
  consistencyRules: z.array(z.string()).default([]),
  referenceImageUrl: z.string().default(""),
});

export const growthPremiumRemixShotSchema = z.object({
  shotId: z.number().int().positive(),
  durationSeconds: z.number().positive(),
  characterId: z.string().default(""),
  purpose: z.string(),
  framing: z.string(),
  cameraMovement: z.string(),
  lighting: z.string(),
  pacingRole: z.string(),
  sceneDescription: z.string(),
  onScreenText: z.string().default(""),
  voiceover: z.string().default(""),
  performanceNote: z.string().default(""),
  referencePrompt: z.string().default(""),
  referenceImageUrl: z.string().default(""),
  veoPrompt: z.string(),
  negativePrompt: z.string().default(""),
});

export const growthPremiumRemixLoopSegmentSchema = z.object({
  segmentIndex: z.number().int().min(1).max(4),
  startSecond: z.number().min(0),
  endSecond: z.number().min(0),
  prompt: z.string(),
  stabilityPrompt: z.string(),
  referenceHint: z.string().default(""),
});

export const growthPremiumRemixTransitionNodeSchema = z.object({
  nodeId: z.string(),
  label: z.string(),
  prompt: z.string(),
  imageUrl: z.string().default(""),
});

export const growthPremiumRemixTrackPlanSchema = z.object({
  title: z.string(),
  summary: z.string(),
  whyItWorks: z.string(),
});

export const growthPremiumRemixSchema = z.object({
  title: z.literal("优质视频二创"),
  sourceSummary: z.string(),
  visualDnaSummary: z.string(),
  contentRebuildSummary: z.string(),
  personaFit: z.string(),
  performanceDirection: z.string(),
  languageExpression: z.string().default(""),
  emotionalExpression: z.string().default(""),
  cameraEmotionTension: z.string().default(""),
  bgmAnalysis: z.string().default(""),
  musicRecommendation: z.string().default(""),
  sunoPrompt: z.string().default(""),
  characterAnchors: z.array(growthPremiumRemixCharacterSchema).default([]),
  storyboard: z.array(growthPremiumRemixShotSchema).default([]),
  loopTrack: z.object({
    plan: growthPremiumRemixTrackPlanSchema,
    segments: z.array(growthPremiumRemixLoopSegmentSchema).default([]),
  }),
  interpolationTrack: z.object({
    plan: growthPremiumRemixTrackPlanSchema,
    nodes: z.array(growthPremiumRemixTransitionNodeSchema).default([]),
  }),
  deliveryNotes: z.array(z.string()).default([]),
});

export const growthPremiumRemixAssetsSchema = z.object({
  mode: z.enum(["loop", "interpolation"]),
  referenceImages: z.array(z.object({
    id: z.string(),
    label: z.string(),
    imageUrl: z.string(),
  })).default([]),
  clips: z.array(z.object({
    label: z.string(),
    videoUrl: z.string(),
  })).default([]),
});

// ── Author Identity & Monetization Value ─────────────────────────────────
export const growthAuthorTierSchema = z.enum(["素人", "腰部达人", "头部创作者"]);

export const growthAuthorIdentitySchema = z.object({
  tier: growthAuthorTierSchema,
  tierReason: z.string(),
  identityTags: z.array(z.string()).default([]),
  verticalCategory: z.string().default(""),
  estimatedFollowers: z.string().default(""),
  commercialPotentialScore: z.number().min(0).max(100).default(0),
  commercialPotentialReason: z.string().default(""),
  monetizationPaths: z.array(z.string()).default([]),
});

export const growthAuthorMonetizationValueSchema = z.object({
  cpmEstimate: z.string().default(""),
  cpmReason: z.string().default(""),
  ecommerceConversionScore: z.number().min(0).max(100).default(0),
  ecommerceConversionReason: z.string().default(""),
  brandMatchScore: z.number().min(0).max(100).default(0),
  brandMatchReason: z.string().default(""),
  recommendedPaths: z.array(z.object({
    path: z.string(),
    platform: z.string(),
    reason: z.string(),
  })).default([]),
});

// ── Hot Word Matching ─────────────────────────────────────────────────────
export const growthHotWordMatchSchema = z.object({
  platform: growthPlatformSchema,
  platformLabel: z.string(),
  hotWord: z.string(),
  hotWordType: z.enum(["热词", "飙升话题", "挑战赛", "官方推流活动"]),
  matchScore: z.number().min(0).max(100),
  matchReason: z.string(),
  contentSuggestion: z.string().default(""),
  source: z.enum(["douyin_index", "creator_center", "live_collection", "fallback"]),
});

// ── Push Activity Match ───────────────────────────────────────────────────
export const growthPushActivitySchema = z.object({
  platform: growthPlatformSchema,
  platformLabel: z.string(),
  activityName: z.string(),
  activityType: z.enum(["官方推流活动", "品牌挑战赛", "节点营销", "创作激励"]),
  status: z.enum(["进行中", "即将开始", "已结束"]),
  deadline: z.string().default(""),
  matchScore: z.number().min(0).max(100),
  matchReason: z.string(),
  submissionSuggestion: z.string().default(""),
  dataSource: z.string().default(""),
});

export const growthAuthorAnalysisSchema = z.object({
  identity: growthAuthorIdentitySchema,
  monetizationValue: growthAuthorMonetizationValueSchema,
  hotWordMatches: z.array(growthHotWordMatchSchema).default([]),
  pushActivityMatches: z.array(growthPushActivitySchema).default([]),
  douyinIndexStatus: z.object({
    connected: z.boolean(),
    creatorCenterConnected: z.boolean(),
    lastSyncAt: z.string().optional(),
    notes: z.array(z.string()).default([]),
  }).default({ connected: false, creatorCenterConnected: false, notes: [] }),
});

export const growthSnapshotSchema = z.object({
  status: growthSnapshotStatusSchema,
  analysisTracks: growthDualTrackSchema,
  dataAnalystSummary: growthDataAnalystSummarySchema,
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
  authorAnalysis: growthAuthorAnalysisSchema.optional(),
  premiumRemix: growthPremiumRemixSchema.optional(),
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
export type GrowthAuthorIdentity = z.infer<typeof growthAuthorIdentitySchema>;
export type GrowthAuthorMonetizationValue = z.infer<typeof growthAuthorMonetizationValueSchema>;
export type GrowthHotWordMatch = z.infer<typeof growthHotWordMatchSchema>;
export type GrowthPushActivity = z.infer<typeof growthPushActivitySchema>;
export type GrowthAuthorAnalysis = z.infer<typeof growthAuthorAnalysisSchema>;

export type GrowthSnapshotStatus = z.infer<typeof growthSnapshotStatusSchema>;
export type GrowthDualTrack = z.infer<typeof growthDualTrackSchema>;
export type GrowthDataAnalystPlatformRow = z.infer<typeof growthDataAnalystPlatformRowSchema>;
export type GrowthDataAnalystSummary = z.infer<typeof growthDataAnalystSummarySchema>;
export type GrowthPremiumRemixCharacter = z.infer<typeof growthPremiumRemixCharacterSchema>;
export type GrowthPremiumRemixShot = z.infer<typeof growthPremiumRemixShotSchema>;
export type GrowthPremiumRemixTrackPlan = z.infer<typeof growthPremiumRemixTrackPlanSchema>;
export type GrowthPremiumRemixTransitionNode = z.infer<typeof growthPremiumRemixTransitionNodeSchema>;
export type GrowthPremiumRemix = z.infer<typeof growthPremiumRemixSchema>;
export type GrowthPremiumRemixAssets = z.infer<typeof growthPremiumRemixAssetsSchema>;
export type GrowthSnapshot = z.infer<typeof growthSnapshotSchema>;

// 新增導出以便其它模組引用
export type GrowthDirectorExecution = z.infer<typeof growthDirectorExecutionSchema>;
export type GrowthPremiumContentTopic = z.infer<typeof growthPremiumContentTopicSchema>;
export type GrowthPremiumContent = z.infer<typeof growthPremiumContentSchema>;

/** 成長營分析請求（語意層；實際 tRPC 另含 gcsUri / fileBase64 等上傳欄位） */
export const growthAnalyzeRequestSchema = z.object({
  videoUrl: z.string().optional(),
  businessGoal: z.string().optional(),
  mode: growthAnalysisModeSchema,
  forceRefresh: z.boolean().optional().default(false),
});
export type GrowthAnalyzeRequest = z.infer<typeof growthAnalyzeRequestSchema>;
