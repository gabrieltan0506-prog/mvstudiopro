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

/** 不纳入增长统计聚合的平台（样本过少会拉歪口径；仍可采集与单独展示）。 */
const growthPlatformsExcludedFromStatsAggregate = new Set<string>(["toutiao"]);

export function isGrowthPlatformInStatsAggregate(platform: (typeof growthPlatformValues)[number]): boolean {
  return !growthPlatformsExcludedFromStatsAggregate.has(platform);
}

/** 参与全站 trend 汇总、覆盖窗口等统计的平台列表（与采集列表分离）。 */
export function growthPlatformsForStatsAggregationList(): (typeof growthPlatformValues)[number][] {
  return growthPlatformValues.filter((p) => isGrowthPlatformInStatsAggregate(p));
}

/** Phase2 主力 gpt-5.6-sol；gemini 仅语音 scan；gpt-5.5 兼容旧入参 */
export const growthCampModelValues = [
  "gpt-5.6-sol",
  "gemini-3.5-flash",
  "gpt-5.5",
] as const;

export const growthCampModelSchema = z.enum(growthCampModelValues);
export type GrowthCampModel = (typeof growthCampModelValues)[number];

export const growthAnalysisModeValues = ["GROWTH", "REMIX"] as const;
export const growthAnalysisModeSchema = z.enum(growthAnalysisModeValues);
export type GrowthAnalysisMode = z.infer<typeof growthAnalysisModeSchema>;

/** 完整商业分析 vs 单纯提取内容（跳过情绪/钩子/分镜/商业路径） */
export const growthAnalysisProfileValues = ["full", "extract_only"] as const;
export const growthAnalysisProfileSchema = z.enum(growthAnalysisProfileValues);
export type GrowthAnalysisProfile = z.infer<typeof growthAnalysisProfileSchema>;

/** 提取模式可选输出块（仅 extract_only 时生效） */
export const growthExtractSectionsSchema = z.object({
  transcript: z.boolean().default(true),
  contentOutline: z.boolean().default(true),
  visualNotes: z.boolean().default(false),
  keyMoments: z.boolean().default(false),
});
export type GrowthExtractSections = z.infer<typeof growthExtractSectionsSchema>;

export const defaultGrowthExtractSections: GrowthExtractSections = {
  transcript: true,
  contentOutline: true,
  visualNotes: false,
  keyMoments: false,
};

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
  businessInsight: z.string().describe("【商业深度洞察】必须包含具体的：引流品设计、利润品设计、转化路径。不少于 300 字。").default(""),
  contentBrief: z.string().default(""),
  directorExecution: z.object({
    storyboard: z.array(z.string()).default([]),
    lighting: z.string().default(""),
    blocking: z.string().default(""),
    emotionalTension: z.string().describe("必须生成具体的导演情绪指导，绝对禁止输出占位符。").default("")
  }).default({ storyboard: [], lighting: "", blocking: "", emotionalTension: "" })
});

/** Vertex / strategist 第二轮专模：字段全必填，禁止 optional / default 搪塞 */
export const growthPremiumContentTopicLlmSchema = z.object({
  title: z.string(),
  formatType: z.enum(["VIDEO", "IMAGE_TEXT"]),
  businessInsight: z.string().describe("深度商业洞察"),
  contentBrief: z.string(),
  directorExecution: z.object({
    storyboard: z.array(z.string()),
    lighting: z.string(),
    blocking: z.string(),
    emotionalTension: z.string(),
  }),
});

/** GROWTH 模式：strategist premium 专模输出（不含 remix 字段） */
export const growthLlmSchema = z.object({
  strategy: z.string(),
  actionableTopics: z.array(growthPremiumContentTopicLlmSchema).min(3).max(3),
  topics: z.array(growthPremiumContentTopicLlmSchema).min(3).max(3),
  explosiveTopicAnalysis: z.string(),
  musicAndExpressionAnalysis: z.string(),
  musicPrompt: z.string(),
});

/** REMIX 模式：strategist premium 专模输出（强制填满二创字段） */
export const remixLlmSchema = z.object({
  actionableTopics: z.array(growthPremiumContentTopicLlmSchema).min(3).max(3),
  topics: z.array(growthPremiumContentTopicLlmSchema).min(3).max(3),
  remixVisualAnalysis: z
    .string()
    .describe(
      "二次创作视觉分析（借鉴与避坑）：必须分析原视频优缺点，并明确指出新选题该借鉴什么、避开什么。",
    ),
  remixExpressionAnalysis: z
    .string()
    .describe(
      "二次创作专属表达指导：必须包含【参考语言表达力】、【参考情感表达方式】、【参考镜头表现与情绪张力】三个标题。",
    ),
  musicPrompt: z.string().describe("针对用户新选题方向的 BGM 提示词"),
});

export const growthPremiumContentSchema = z.object({
  summary: z.string().default(""),
  strategy: z.string().describe("顶级商业顾问：人设拆解与产品矩阵规划").default(""),
  actionableTopics: z.array(growthPremiumContentTopicSchema).describe("现在就能执行的版本：必须带有完整分镜与脚本").default([]),
  topics: z.array(growthPremiumContentTopicSchema).describe("核心爆款选题").default([]),
  explosiveTopicAnalysis: z.string().describe("选题深度综述分析").default(""),
  musicAndExpressionAnalysis: z.string().describe("表达与配乐分析：BGM 建议与表达技巧").default(""),
  /** REMIX 必填实质内容；GROWTH 可为 ""。勿用 .optional()，避免模型整段跳过。 */
  remixVisualAnalysis: z
    .string()
    .describe(
      "二次创作视觉分析 (借鉴与避坑)：分析原视频优缺点，并指导用户拍摄新选题时该借鉴什么、避开什么",
    )
    .default(""),
  remixExpressionAnalysis: z
    .string()
    .describe(
      "二次创作专属表达指导：必须包含【参考语言表达力】、【参考情感表达方式】、【参考镜头表现与情绪张力】",
    )
    .default(""),
  musicPrompt: z
    .string()
    .describe("针对用户专属选题方向的 BGM 提示词")
    .default(""),
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
  /** 与请求 mode 一致；供前端在刷新 / 导出 PDF 时还原二创版面。旧数据可缺省，由前端依 remix 字段推断。 */
  mode: growthAnalysisModeSchema.optional(),
  /** full=完整商业分析；extract_only=仅结构化提取 */
  analysisProfile: growthAnalysisProfileSchema.optional(),
  /** extract_only 模式下的 Markdown 正文 */
  extractedContent: z.string().optional(),
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
    remixVisualAnalysis: "",
    remixExpressionAnalysis: "",
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

const GROWTH_CORE_SCORE_FIELDS = ["composition", "color", "lighting", "impact", "viralPotential"] as const;

export type GrowthCoreScoreField = (typeof GROWTH_CORE_SCORE_FIELDS)[number];

/** Strategist 主 pass 是否已返回完整五维评分（0 分也算有效）。 */
export function hasGrowthCoreScores(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const obj = raw as Record<string, unknown>;
  return GROWTH_CORE_SCORE_FIELDS.every(
    (key) => typeof obj[key] === "number" && Number.isFinite(obj[key]),
  );
}

/**
 * 当专用评分 pass 也失败时，从 Strategist 已返回的 platformScores / explosiveIndex 推导五维分。
 * 数值来源于 LLM 同轮输出，不是硬编码占位。
 */
export function deriveGrowthCoreScoresFromPartial(partial: unknown): Record<string, number> | null {
  if (!partial || typeof partial !== "object" || Array.isArray(partial)) return null;
  const obj = partial as Record<string, unknown>;
  const platformScores = obj.platformScores;
  const platformNums: number[] = [];
  if (platformScores && typeof platformScores === "object" && !Array.isArray(platformScores)) {
    for (const key of ["xiaohongshu", "douyin", "bilibili", "kuaishou"]) {
      const v = Number((platformScores as Record<string, unknown>)[key]);
      if (Number.isFinite(v)) {
        platformNums.push(Math.min(100, Math.max(0, Math.round(v * 10))));
      }
    }
  }
  const explosiveRaw = Number(obj.explosiveIndex);
  const explosiveIndex = Number.isFinite(explosiveRaw)
    ? Math.min(10, Math.max(1, Math.round(explosiveRaw)))
    : undefined;

  if (platformNums.length >= 2) {
    const avg = Math.round(platformNums.reduce((a, b) => a + b, 0) / platformNums.length);
    return {
      composition: avg,
      color: Math.max(0, avg - 5),
      lighting: avg,
      impact: Math.min(100, avg + 3),
      viralPotential: Math.min(100, avg + 5),
      explosiveIndex: explosiveIndex ?? Math.min(10, Math.max(1, Math.round(avg / 10))),
    };
  }

  if (explosiveIndex !== undefined) {
    const base = Math.min(100, Math.max(0, explosiveIndex * 10));
    return {
      composition: base,
      color: Math.max(0, base - 4),
      lighting: Math.max(0, base - 2),
      impact: Math.min(100, base + 2),
      viralPotential: Math.min(100, base + 4),
      explosiveIndex,
    };
  }

  return null;
}

/** 将 LLM 可能返回的字符串转为 0–100 整数；无法解析时返回 fallback。 */
export function normalizeGrowthAnalysisScoreValue(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.min(100, Math.max(0, Math.round(value)));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return fallback;
    const n = Number(trimmed);
    if (Number.isFinite(n)) return Math.min(100, Math.max(0, Math.round(n)));
  }
  return fallback;
}

/** 将 LLM 可能返回的 object/array 转为可展示文本；过滤 [object Object] */
export function coerceDisplayText(value: unknown): string {
  if (typeof value === "string") {
    const t = value.trim();
    if (!t || t === "[object Object]") return "";
    return t;
  }
  if (Array.isArray(value)) {
    const parts = value.map((item) => coerceDisplayText(item)).filter(Boolean);
    return parts.join(" · ");
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    for (const key of [
      "text", "summary", "detail", "description", "title", "value", "arc", "content",
      "opening", "middle", "peak", "closing", "hook", "body", "cta",
      "rhythm", "insight", "comment", "point", "highlight", "note", "analysis",
    ]) {
      const candidate = obj[key];
      if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
    }
    if (obj.opening || obj.middle || obj.peak || obj.closing) {
      return [obj.opening, obj.middle, obj.peak, obj.closing]
        .map((v) => (typeof v === "string" ? v.trim() : ""))
        .filter(Boolean)
        .join(" → ");
    }
    if (Array.isArray(obj.phases)) {
      return obj.phases.map((p) => coerceDisplayText(p)).filter(Boolean).join(" → ");
    }
    const stringValues = Object.values(obj)
      .map((v) => (typeof v === "string" ? v.trim() : ""))
      .filter(Boolean);
    if (stringValues.length) return stringValues.join(" · ");
    try {
      const json = JSON.stringify(value);
      return json === "{}" ? "" : json;
    } catch {
      return "";
    }
  }
  if (value == null) return "";
  const s = String(value).trim();
  return s === "[object Object]" ? "" : s;
}

/** 去重相似文案（合并多轨报告、展示列表时用） */
export function dedupeSimilarTexts(items: unknown[], maxItems = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const t = coerceDisplayText(item).trim();
    if (!t) continue;
    const key = t.replace(/[\s\u00a0]+/g, "").slice(0, 48).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
    if (out.length >= maxItems) break;
  }
  return out;
}

export function coerceStringList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => coerceDisplayText(item))
    .filter((s) => s.length > 0);
}

function coerceReverseEngineeringFields(re: unknown): unknown {
  if (!re || typeof re !== "object" || Array.isArray(re)) return re;
  const obj = { ...(re as Record<string, unknown>) };
  for (const key of ["hookStrategy", "emotionalArc", "commercialLogic"]) {
    if (obj[key] !== undefined) obj[key] = coerceDisplayText(obj[key]);
  }
  return obj;
}

/** 仅对已存在的分数字段做类型校正，不伪造缺失值。 */
export function coerceGrowthAnalysisScoresInput(raw: unknown): Record<string, unknown> {
  const base =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? { ...(raw as Record<string, unknown>) }
      : {};
  for (const key of GROWTH_CORE_SCORE_FIELDS) {
    const v = base[key];
    if (v !== undefined && v !== null && v !== "") {
      base[key] = normalizeGrowthAnalysisScoreValue(v, 0);
    }
  }
  if (base.explosiveIndex !== undefined && base.explosiveIndex !== null && base.explosiveIndex !== "") {
    const ei = normalizeGrowthAnalysisScoreValue(base.explosiveIndex, 0);
    base.explosiveIndex = Math.min(10, Math.max(0, ei));
  }
  if (base.strengths !== undefined) base.strengths = coerceStringList(base.strengths);
  if (base.improvements !== undefined) base.improvements = coerceStringList(base.improvements);
  if (base.titleSuggestions !== undefined) base.titleSuggestions = coerceStringList(base.titleSuggestions);
  if (base.platforms !== undefined) base.platforms = coerceStringList(base.platforms);
  if (base.reverseEngineering !== undefined) {
    base.reverseEngineering = coerceReverseEngineeringFields(base.reverseEngineering);
  }
  if (typeof base.summary === "string") base.summary = coerceDisplayText(base.summary);
  else if (base.summary !== undefined) base.summary = coerceDisplayText(base.summary);
  if (typeof base.realityCheck === "string") base.realityCheck = coerceDisplayText(base.realityCheck);
  else if (base.realityCheck !== undefined) base.realityCheck = coerceDisplayText(base.realityCheck);
  if (base.visualSummary !== undefined) base.visualSummary = coerceDisplayText(base.visualSummary);
  if (base.bgmAnalysis !== undefined) base.bgmAnalysis = coerceDisplayText(base.bgmAnalysis);
  if (base.musicRecommendation !== undefined) base.musicRecommendation = coerceDisplayText(base.musicRecommendation);
  return base;
}

export function parseGrowthAnalysisScores(input: unknown): z.infer<typeof growthAnalysisScoresSchema> {
  return growthAnalysisScoresSchema.parse(coerceGrowthAnalysisScoresInput(input));
}

/** 多素材快速合并（无 LLM），Platform 混传默认用此路径以省掉第三轮等待。 */
export function mergeGrowthAnalysesDeterministic(
  parts: Array<{ label?: string; analysis: z.infer<typeof growthAnalysisScoresSchema> }>,
): z.infer<typeof growthAnalysisScoresSchema> {
  if (parts.length === 0) {
    throw new Error("无可合并的分析结果");
  }
  if (parts.length === 1) {
    return parts[0]!.analysis;
  }

  const analyses = parts.map((p) => p.analysis);
  const avgScore = (key: GrowthCoreScoreField) => {
    const nums = analyses
      .map((a) => (typeof a[key] === "number" ? a[key] : NaN))
      .filter((n) => Number.isFinite(n));
    return nums.length ? Math.round(nums.reduce((a, b) => a + b, 0) / nums.length) : 0;
  };
  const uniq = (items: unknown[], max = 6) => dedupeSimilarTexts(items, max);

  const explosiveNums = analyses
    .map((a) => a.explosiveIndex)
    .filter((n) => typeof n === "number" && Number.isFinite(n));
  const explosiveIndex = explosiveNums.length
    ? Math.min(10, Math.max(1, Math.round(explosiveNums.reduce((a, b) => a + b, 0) / explosiveNums.length)))
    : Math.min(10, Math.max(1, Math.round(avgScore("impact") / 10)));

  const primary = analyses[0]!;
  const secondary = analyses[1];
  const summary = parts
    .map((p) => {
      const s = p.analysis.summary?.trim();
      if (!s) return "";
      return p.label ? `【${p.label}】\n${s}` : s;
    })
    .filter(Boolean)
    .join("\n\n");

  const mergeReField = (key: "hookStrategy" | "emotionalArc" | "commercialLogic") => {
    const parts = analyses
      .map((a) => coerceDisplayText(a.reverseEngineering?.[key]))
      .filter(Boolean);
    return parts.length ? parts.join("\n\n") : "";
  };

  const bgmAnalysis =
    analyses.map((a) => coerceDisplayText(a.bgmAnalysis)).find(Boolean) || "";

  return parseGrowthAnalysisScores({
    composition: avgScore("composition"),
    color: avgScore("color"),
    lighting: avgScore("lighting"),
    impact: avgScore("impact"),
    viralPotential: avgScore("viralPotential"),
    explosiveIndex,
    summary,
    realityCheck: primary.realityCheck || secondary?.realityCheck || "",
    visualSummary: [primary.visualSummary, secondary?.visualSummary].filter(Boolean).join("\n\n"),
    reverseEngineering: {
      hookStrategy: mergeReField("hookStrategy"),
      emotionalArc: mergeReField("emotionalArc"),
      commercialLogic: mergeReField("commercialLogic"),
    },
    bgmAnalysis,
    strengths: uniq(analyses.flatMap((a) => a.strengths || []), 4),
    improvements: uniq(analyses.flatMap((a) => a.improvements || []), 4),
    platforms: uniq(analyses.flatMap((a) => a.platforms || []), 4),
    titleSuggestions: uniq(analyses.flatMap((a) => a.titleSuggestions || []), 5),
    premiumContent: {
      ...(primary.premiumContent ?? {}),
      topics: [
        ...(primary.premiumContent?.topics ?? []),
        ...(secondary?.premiumContent?.topics ?? []),
      ].slice(0, 6),
      actionableTopics: [
        ...(primary.premiumContent?.actionableTopics ?? []),
        ...(secondary?.premiumContent?.actionableTopics ?? []),
      ].slice(0, 6),
    },
    remixExecution: primary.remixExecution ?? secondary?.remixExecution,
  });
}

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

/**
 * getPlatformDashboard 的 platformMenu 单项（与 server/routers ` platformDashboardResponseSchema` 对齐）。
 * 勿与 {@link growthPlatformRecommendationSchema}（快照 platformRecommendations：name/reason/action）混淆。
 */
export const growthPlatformMenuItemSchema = z.object({
  platform: z.string().optional(),
  whyNow: z.string().optional(),
  referenceAccounts: z.array(z.any()).optional().default([]),
  primaryTrack: z.string().optional(),
  estimatedTraffic: z.string().optional(),
  ipUniqueness: z.string().optional(),
  commercialConversion: z.string().optional(),
  trafficBoosters: z.array(z.string()).optional().default([]),
}).passthrough();

export type GrowthPlatformMenuItem = z.infer<typeof growthPlatformMenuItemSchema>;

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
  title: z.union([z.literal("优质二次创作"), z.literal("优质视频二创")]),
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

// 添加导出以便其它模块引用
export type GrowthDirectorExecution = z.infer<typeof growthDirectorExecutionSchema>;
export type GrowthPremiumContentTopic = z.infer<typeof growthPremiumContentTopicSchema>;
export type GrowthPremiumContent = z.infer<typeof growthPremiumContentSchema>;

/** 成长营分析请求（语意层；实际 tRPC 另含 gcsUri / fileBase64 等上传字段） */
export const growthAnalyzeRequestSchema = z.object({
  videoUrl: z.string().optional(),
  businessGoal: z.string().optional(),
  mode: growthAnalysisModeSchema,
  forceRefresh: z.boolean().optional().default(false),
});
export type GrowthAnalyzeRequest = z.infer<typeof growthAnalyzeRequestSchema>;
