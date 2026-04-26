import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import * as sessionDb from "./sessionDb";
import { invokeLLM } from "./_core/llm";
import { storagePut, storageGet } from "./storage";
import { usageRouter, incrementUsageCount } from "./routers/usage";
import { phoneRouter } from "./routers/phone";
import { studentRouter } from "./routers/student";
import { paymentRouter } from "./routers/payment";
import { emailAuthRouter } from "./routers/emailAuth";
import { betaRouter } from "./routers/beta";
import { betaCodeRouter } from "./routers/betaCode";
import { feedbackRouter } from "./routers/feedback";
import { inviteApplyRouter } from "./routers/inviteApply";
import { staticPayRouter } from "./routers/staticPay";
import { educationRouter } from "./routers/education";
import { emailOtpRouter, phoneOtpRouter } from "./routers/emailOtp";
import { stripeRouter } from "./routers/stripe";
import { teamRouter } from "./routers/team";
import { videoSubmissionRouter } from "./routers/videoSubmission";
import { nanoBananaRouter } from "./routers/nanoBanana";
import { showcaseRouter } from "./routers/showcase";
import { klingRouter } from "./routers/kling";
import { hunyuan3dRouter } from "./routers/hunyuan3d";
import { sunoRouter } from "./routers/suno";
import { buildAuthorAnalysis, buildGrowthSnapshotFromCollections, buildMockGrowthSnapshot, buildPlatformSupportActivities, normalizePlatforms } from "./growth/growthSchema";
import { analyzeDocument } from "./growth/analyzeDocument";
import { analyzeVideo } from "./growth/analyzeVideo";
import { resolveGrowthCampExtractorModel, resolveGrowthCampPipelineMode, resolveGrowthCampStrategistModel } from "./growth/extractorPipeline";
import { buildPremiumRemixPlan, generatePremiumRemixAssets } from "./growth/premiumRemix";
import { collectTrendPlatforms } from "./growth/trendCollector";
import { exportTrendCollectionsCsv, getGrowthTrendStats, isTrendCollectionStale, mergeTrendCollections, readGrowthDebugSummary, readGrowthRuntimeControl, readGrowthStatusSnapshot, readTrendRuntimeMeta, readTrendSchedulerState, readTrendStore, readTrendStoreForPlatforms, reconcileTrendHistoryState, updateTrendSchedulerState, writeGrowthRuntimeControl } from "./growth/trendStore";
import { getSmtpStatus, sendMailWithAttachments } from "./services/smtp-mailer";
import { runVertexUpscaleImage } from "./services/vertexImage";
import { creationsRouter, recordCreation } from "./routers/creations";
import { workflowRouter } from "./routers/workflow";
import { generateGeminiImage, isGeminiImageAvailable } from "./gemini-image";
import {
  deductCredits,
  deductCreditsAmount,
  getCredits,
  getUserPlan,
  addCredits,
  getCreditTransactions,
  getOrCreateBalance,
  refundCredits,
} from "./credits";
import { CREDIT_COSTS, CREDIT_TO_CNY } from "./plans";
import {
  IMAGE_UPSCALE_BASE_CREDIT_KEYS,
  imageUpscaleTotalCredits,
  getProductPackageDisplayRows,
  type ImageUpscaleBaseCreditKey,
} from "../shared/plans";
import { generateVideo, isVeoAvailable } from "./veo";
import { isGeminiAudioAvailable, analyzeAudioWithGemini } from "./gemini-audio";
import { executeProviderFallback } from "./services/provider-manager";
import { createGcsSignedUploadUrl } from "./services/gcs";
import { getTierProviderChain, resolveUserTier, resolveWatermark, shouldApplyWatermarkForTier } from "./services/tier-provider-routing";
import { getAdminStats, getVideoComments, addVideoComment, deleteVideoComment, toggleCommentLike, createStoryboard, updateStoryboardStatus } from "./db";
import { checkUsageLimit, getOrCreateUsageTracking, getAllBetaQuotas, createBetaQuota, getAllTeams, getAllStoryboards, getPaymentSubmissions, updatePaymentSubmissionStatus, createVideoGeneration, getVideoGenerationById, getVideoGenerationsByUserId, updateVideoGeneration, getVideoLikeStatus, toggleVideoLike, getUserCommentLikes, isAdmin } from "./db-extended";
import { registerOriginalVideo } from "./video-signature";
import { nanoid } from "nanoid";
import {
  createJob as createJobRecord,
  markJobSucceeded,
  markJobFailed,
} from "./jobs/repository";
import {
  growthAssetAdaptationSchema,
  growthAnalysisModeSchema,
  growthPlatformValues,
  growthAnalysisScoresSchema,
  growthBusinessInsightSchema,
  growthCampModelSchema,
  growthCreationAssistSchema,
  growthDecisionFrameworkSchema,
  growthDashboardConsoleSchema,
  growthHandoffSchema,
  growthDataLibrarySectionSchema,
  growthMonetizationTrackSchema,
  growthMonetizationStrategySchema,
  growthPlanStepSchema,
  growthPremiumRemixAssetsSchema,
  growthPremiumRemixSchema,
  growthPlatformActivitySchema,
  growthPlatformRecommendationSchema,
  growthSnapshotSchema,
  growthTitleExecutionSchema,
} from "@shared/growth";
import { nowShanghaiIso } from "./growth/time";
import { videoPlatformLinks, videoSubmissions } from "../drizzle/schema";
import { stripeUsageLogs } from "../drizzle/schema-stripe";
import { and, desc, eq, gte } from "drizzle-orm";

const DOUYIN_CREATOR_CENTER_BUCKET_PREFIXES = [
  "douyin_creator_center",
  "douyin_creator_index",
] as const;

const GROWTH_PLATFORM_META: Record<string, { label: string; description: string }> = {
  douyin: { label: "抖音", description: "短视频主阵地，当前样本量最大，优先看热点与爆发趋势。" },
  xiaohongshu: { label: "小红书", description: "种草与搜索场景为主，适合看内容沉淀与转化线索。" },
  kuaishou: { label: "快手", description: "下沉与直播氛围更强，适合看高频更新和稳定增量。" },
  toutiao: { label: "头条", description: "资讯分发场景，样本量相对小，适合单独看补齐情况。" },
  bilibili: { label: "B站", description: "中长视频与社区互动更强，适合看内容深度与长期沉淀。" },
};

function getGrowthPlatformMeta(platform?: string) {
  const key = String(platform || "").trim();
  return GROWTH_PLATFORM_META[key] || { label: key || "-", description: "平台说明暂未配置。" };
}

function addMinutesToIso(base?: string, minutes = 15) {
  const time = new Date(String(base || "")).getTime();
  if (!Number.isFinite(time) || time <= 0) return undefined;
  return new Date(time + minutes * 60 * 1000).toISOString();
}

function isDouyinCreatorCenterBucket(bucket: string) {
  return DOUYIN_CREATOR_CENTER_BUCKET_PREFIXES.some((prefix) => bucket.startsWith(prefix));
}

function getCollectionBucketCounts(items: Array<{ bucket?: string }> = []) {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const bucket = String(item?.bucket || "").trim();
    if (!bucket) continue;
    counts[bucket] = (counts[bucket] || 0) + 1;
  }
  return counts;
}

function resolveGrowthCampFinalModel(modelName?: string) {
  return resolveGrowthCampStrategistModel(modelName);
}

type GrowthArchiveSummaryPlatform = {
  platform: string;
  currentTotal: number;
  archivedTotal: number;
};

async function readGrowthArchiveMergeSummary(): Promise<{
  totals: { currentItems: number; archivedItems: number } | null;
  platforms: Record<string, GrowthArchiveSummaryPlatform>;
} | null> {
  const parseSummary = (raw: any) => ({
    totals: {
      currentItems: Number(raw?.totals?.currentItems || 0),
      archivedItems: Number(raw?.totals?.archivedItems || 0),
    },
    platforms: Object.fromEntries(
      Array.isArray(raw?.platforms)
        ? raw.platforms.map((item: any) => [
            String(item?.platform || ""),
            {
              platform: String(item?.platform || ""),
              currentTotal: Number(item?.currentTotal || 0),
              archivedTotal: Number(item?.archivedItems || 0),
            },
          ])
        : [],
    ),
  });

  try {
    const storeDir = String(process.env.GROWTH_STORE_DIR || "/data/growth").trim() || "/data/growth";
    const summaryPath = path.join(storeDir, "backups", "archive-merge-summary.json");
    return parseSummary(JSON.parse(await fs.readFile(summaryPath, "utf8")));
  } catch {
    try {
      const response = await fetch(
        "https://github.com/gabrieltan0506-prog/mvstudiopro/releases/download/growth-recovery-20260321/archive-merge-summary.json",
        { signal: AbortSignal.timeout(5000) },
      );
      if (!response.ok) return null;
      return parseSummary(await response.json());
    } catch {
      return null;
    }
  }
}

function buildDouyinCreatorCenterStats(store: Awaited<ReturnType<typeof readTrendStore>>) {
  const douyinCollection = store.collections?.douyin;
  const douyinCurrentBucketCounts =
    douyinCollection?.stats?.bucketCounts ||
    getCollectionBucketCounts(douyinCollection?.items || []);
  const douyinCreatorCenterBuckets = Object.entries(douyinCurrentBucketCounts)
    .filter(([bucket]) => isDouyinCreatorCenterBucket(bucket))
    .sort((left, right) => right[1] - left[1])
    .map(([bucket, currentTotal]) => ({
      bucket,
      currentTotal,
      archivedTotal: 0,
    }));
  const douyinCreatorCenterBucketMap = new Map(
    douyinCreatorCenterBuckets.map((item) => [item.bucket, item]),
  );

  const historyBucketCounts = store.history?.platforms?.douyin?.bucketCounts || {};
  for (const [bucket, archivedCount] of Object.entries(historyBucketCounts)) {
    if (!isDouyinCreatorCenterBucket(bucket)) continue;
    const current = douyinCreatorCenterBucketMap.get(bucket) || {
      bucket,
      currentTotal: 0,
      archivedTotal: 0,
    };
    current.archivedTotal = archivedCount;
    douyinCreatorCenterBucketMap.set(bucket, current);
  }

  const douyinCreatorCenterBucketList = Array.from(douyinCreatorCenterBucketMap.values())
    .sort((left, right) => right.currentTotal - left.currentTotal || right.archivedTotal - left.archivedTotal);
  const rawDouyinCreatorNotes = (douyinCollection?.notes || []).filter((note) => /Douyin creator center|Douyin creator index/i.test(note));
  const douyinCreatorNotes = rawDouyinCreatorNotes.filter((note) => {
    if (/itemBase .* responded with 404/i.test(note)) return false;
    if (/returned encrypted payload\./i.test(note) && /itemBase|keyword valid-date|keyword trend|keyword interpretation|brand lines|brand radar|brand cycles/i.test(note)) {
      return false;
    }
    return true;
  });

  return {
    currentTotal: douyinCreatorCenterBucketList.reduce((sum, item) => sum + item.currentTotal, 0),
    archivedTotal: douyinCreatorCenterBucketList.reduce((sum, item) => sum + item.archivedTotal, 0),
    buckets: douyinCreatorCenterBucketList,
    notes: douyinCreatorNotes.slice(-12),
    diagnostics: {
      hasCreatorCenterCookie: Boolean(String(process.env.DOUYIN_CREATOR_CENTER_COOKIE || "").trim() || String(process.env.DOUYIN_CREATOR_CENTER_COOKIE_BACKUP || "").trim()),
      hasCreatorIndexCookie: Boolean(String(process.env.DOUYIN_CREATOR_INDEX_COOKIE || "").trim()),
      hasCreatorCsrfToken: Boolean(String(process.env.DOUYIN_CREATOR_INDEX_CSRF_TOKEN || "").trim() || String(process.env.DOUYIN_CREATOR_CENTER_CSRF_TOKEN || "").trim()),
      pageCaptureEnabled: String(process.env.DOUYIN_CREATOR_INDEX_PAGE_CAPTURE || "0") === "1",
    },
  };
}

type CreatorCenterLiteStats = ReturnType<typeof buildDouyinCreatorCenterStats>;

async function readDouyinCreatorCenterStatsLite(): Promise<CreatorCenterLiteStats> {
  const storeDir = path.resolve(
    process.env.GROWTH_STORE_DIR || path.join(path.resolve(process.cwd(), ".cache"), "growth"),
  );
  const platformFile = path.join(storeDir, "platforms", "douyin.json");
  const storeFile = path.join(storeDir, "current.json");
  const ledgerFile = path.join(storeDir, "history-ledger", "douyin.json");
  const diagnostics = {
    hasCreatorCenterCookie: Boolean(String(process.env.DOUYIN_CREATOR_CENTER_COOKIE || "").trim() || String(process.env.DOUYIN_CREATOR_CENTER_COOKIE_BACKUP || "").trim()),
    hasCreatorIndexCookie: Boolean(String(process.env.DOUYIN_CREATOR_INDEX_COOKIE || "").trim()),
    hasCreatorCsrfToken: Boolean(String(process.env.DOUYIN_CREATOR_INDEX_CSRF_TOKEN || "").trim() || String(process.env.DOUYIN_CREATOR_CENTER_CSRF_TOKEN || "").trim()),
    pageCaptureEnabled: String(process.env.DOUYIN_CREATOR_INDEX_PAGE_CAPTURE || "0") === "1",
  };

  let currentBucketCounts: Record<string, number> = {};
  let notes: string[] = [];
  try {
    const parsed = JSON.parse(await fs.readFile(platformFile, "utf8")) as {
      collection?: {
        items?: Array<{ bucket?: string }>;
        notes?: string[];
        stats?: { bucketCounts?: Record<string, number> };
      };
    };
    currentBucketCounts =
      parsed.collection?.stats?.bucketCounts
      || getCollectionBucketCounts(parsed.collection?.items || []);
    notes = (parsed.collection?.notes || []).filter((note) => /Douyin creator center|Douyin creator index/i.test(note));
  } catch {
    try {
      const parsed = JSON.parse(await fs.readFile(storeFile, "utf8")) as {
        collections?: {
          douyin?: {
            items?: Array<{ bucket?: string }>;
            notes?: string[];
            stats?: { bucketCounts?: Record<string, number> };
          };
        };
      };
      const collection = parsed.collections?.douyin;
      currentBucketCounts =
        collection?.stats?.bucketCounts
        || getCollectionBucketCounts(collection?.items || []);
      notes = (collection?.notes || []).filter((note) => /Douyin creator center|Douyin creator index/i.test(note));
    } catch {
      return {
        currentTotal: 0,
        archivedTotal: 0,
        buckets: [],
        notes: [],
        diagnostics,
      };
    }
  }

  const bucketMap = new Map<string, { bucket: string; currentTotal: number; archivedTotal: number }>();
  for (const [bucket, currentTotal] of Object.entries(currentBucketCounts)) {
    if (!isDouyinCreatorCenterBucket(bucket)) continue;
    bucketMap.set(bucket, { bucket, currentTotal, archivedTotal: 0 });
  }

  try {
    const parsed = JSON.parse(await fs.readFile(ledgerFile, "utf8")) as
      | { items?: Record<string, { bucket?: string }> }
      | Record<string, { bucket?: string }>;
    const entries = "items" in parsed && parsed.items ? Object.values(parsed.items) : Object.values(parsed || {});
    for (const entry of entries) {
      const bucket = String(entry?.bucket || "").trim();
      if (!isDouyinCreatorCenterBucket(bucket)) continue;
      const current = bucketMap.get(bucket) || { bucket, currentTotal: 0, archivedTotal: 0 };
      current.archivedTotal += 1;
      bucketMap.set(bucket, current);
    }
  } catch {
    // keep current-only stats when ledger is unavailable
  }

  const creatorNotes = notes.filter((note) => {
    if (/itemBase .* responded with 404/i.test(note)) return false;
    if (/returned encrypted payload\./i.test(note) && /itemBase|keyword valid-date|keyword trend|keyword interpretation|brand lines|brand radar|brand cycles/i.test(note)) {
      return false;
    }
    return true;
  });
  const buckets = Array.from(bucketMap.values())
    .sort((left, right) => right.currentTotal - left.currentTotal || right.archivedTotal - left.archivedTotal);

  return {
    currentTotal: buckets.reduce((sum, item) => sum + item.currentTotal, 0),
    archivedTotal: buckets.reduce((sum, item) => sum + item.archivedTotal, 0),
    buckets,
    notes: creatorNotes.slice(-12),
    diagnostics,
  };
}

const growthSnapshotPersonalizationSchema = z.object({
  overview: z.object({
    summary: z.string(),
    trendNarrative: z.string(),
    nextCollectionPlan: z.string(),
  }),
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
  statusNotes: z.array(z.string()).default([]),
  authorAnalysis: z.any().optional(),
});

const platformFollowUpResponseSchema = z.object({
  title: z.string(),
  answer: z.string(),
  encouragement: z.string(),
  nextQuestions: z.array(z.string()).default([]),
});

const PLATFORM_LLM_TIMEOUT_MS = 8 * 60_000;

// Call 2 schema — lightweight direction (platform + signals), no heavy copywriting
// All array fields use z.any() to tolerate Gemini returning strings instead of objects
// (confirmed bug: topSignals returned as string[] instead of object[])
const platformDashboardResponseSchema = z.object({
  headline: z.string(),
  subheadline: z.string().default(""),
  personaSummary: z.string().default(""),
  // Use z.any() for all array fields — Gemini sometimes returns string[] instead of object[]
  topSignals: z.array(z.any()).default([]),
  platformMenu: z.array(z.object({
    platform: z.string().optional(),
    whyNow: z.string().optional(),
    referenceAccounts: z.array(z.any()).optional(),
    primaryTrack: z.string().optional(),
    estimatedTraffic: z.string().optional(),
    ipUniqueness: z.string().optional(),
    commercialConversion: z.string().optional(),
    trafficBoosters: z.array(z.string()).optional(),
  }).passthrough()).default([]),
  hotTopics: z.array(z.any()).default([]),
  contentBlueprints: z.array(z.any()).default([]),
  monetizationLanes: z.array(z.any()).default([]),
  actionCards: z.array(z.any()).default([]),
  conversationStarters: z.array(z.any()).default([]),
}).passthrough();

// Call 3 schema — detailed content blueprints and monetization (heavy copywriting)
// Use z.any() for all array fields to tolerate Gemini schema drift
// executionDetails is an optional sub-object in each contentBlueprint item
const platformContentResponseSchema = z.object({
  contentBlueprints: z.array(z.object({
    title: z.string().optional(),
    format: z.string().optional(),
    hook: z.string().optional(),
    copywriting: z.string().optional(),
    // z.any() — Gemini sometimes returns comma-string instead of array, or adds extra fields
    suitablePlatforms: z.any().optional(),
    // z.any() — Gemini sometimes returns mixed types in actionableSteps
    actionableSteps: z.any().optional(),
    detailedScript: z.string().optional(),
    publishingAdvice: z.string().optional(),
    // .passthrough() — allow any extra fields Gemini adds to executionDetails without crashing schema
    executionDetails: z.object({
      environmentAndWardrobe: z.string().optional(),
      lightingAndCamera: z.string().optional(),
      // z.any() — can be string or string[] depending on model version
      stepByStepScript: z.any().optional(),
    }).passthrough().optional(),
  }).passthrough()).default([]),
  monetizationLanes: z.array(z.any()).default([]),
}).passthrough();

async function buildPlatformDashboard(params: {
  snapshot: z.infer<typeof growthSnapshotSchema>;
  context?: string;
  requestedPlatforms: string[];
  store: Awaited<ReturnType<typeof readTrendStore>>;
  windowDays: number;
}) {
  // Filter items to the user's selected windowDays window (15 / 30 / 45 days back from now)
  // so that collectionEvidence reflects exactly what the user asked to analyze.
  // Note: platformBaselineStats always uses full 45-day data (separate section below).
  const windowCutoffMs = Date.now() - params.windowDays * 24 * 60 * 60 * 1000;
  const filterItemsByWindow = (items: any[]): any[] =>
    items.filter((item) => {
      const ts =
        item?.collectedAt ||
        item?.collected_at ||
        item?.publishedAt ||
        item?.published_at ||
        item?.createdAt ||
        item?.created_at ||
        item?.date ||
        null;
      if (!ts) return true; // No date info — include to avoid dropping valid data
      const ms = new Date(String(ts)).getTime();
      return Number.isFinite(ms) && ms >= windowCutoffMs;
    });

  const collectionEvidence = params.requestedPlatforms.map((platform) => {
    const collection = params.store.collections?.[platform as keyof typeof params.store.collections];
    const allItems: any[] = collection?.items || [];
    // Use window-filtered items for evidence sent to LLM (reflects user's selected time range)
    const windowItems = filterItemsByWindow(allItems);
    // Fall back to allItems if filtering removed everything (sparse data scenario)
    const evidenceItems = windowItems.length > 0 ? windowItems : allItems;
    const bucketCounts = getCollectionBucketCounts(evidenceItems);
    return {
      platform,
      collectedAt: collection?.collectedAt || null,
      itemCount: evidenceItems.length,
      windowDays: params.windowDays,
      hotTitles: evidenceItems.slice(0, 10).map((item: any) => item.title).filter(Boolean),
      topBuckets: Object.entries(bucketCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 6)
        .map(([bucket, count]) => ({ bucket, count })),
    };
  });

  // Compute platform baseline stats from the ALWAYS-45-day store data
  // These numbers ground the LLM's metric calculation regardless of the user's window selection
  const platformBaselineStats = params.requestedPlatforms.map((platform) => {
    const allCollections = params.store.collections || {};
    const col = allCollections[platform as keyof typeof allCollections];
    const items: any[] = col?.items || [];
    const totalItems = items.length;
    // Median play count from items that have playCount
    const playCounts = items.map((i: any) => Number(i.playCount || i.play_count || 0)).filter(v => v > 0).sort((a, b) => a - b);
    const medianTraffic45d = playCounts.length > 0 ? playCounts[Math.floor(playCounts.length / 2)] : 0;
    // Competitor density: ratio of items from competitors (not our own) out of total (proxy: items with high play count are popular creators)
    const highCompetition = playCounts.length > 0 ? Math.min(0.85, playCounts.filter(v => v > 100000).length / Math.max(1, playCounts.length)) : 0.3;
    // Benchmark conversion rate by platform (industry knowledge)
    const benchmarkConversionMap: Record<string, number> = {
      xiaohongshu: 0.025, douyin: 0.012, bilibili: 0.018, kuaishou: 0.010, toutiao: 0.008, weixin_channels: 0.020,
    };
    const benchmarkConversionRate = benchmarkConversionMap[platform] ?? 0.015;
    return {
      platform,
      totalItems45d: totalItems,
      medianTraffic45d,
      competitorDensity: highCompetition,
      benchmarkConversionRate,
    };
  });

  // Phase 1-A: Persona-bound context hint injected into system prompt
  const personaContextLine = params.context
    ? `\n\n用户背景补充（所有输出必须明显针对此背景，不得输出通用模板）：${params.context.slice(0, 300)}`
    : "";
  // If context mentions medical/doctor or culture/art, add hard constraint against generic monetization
  // Support both Simplified and Traditional Chinese in persona detection
  const hasMedicalPersona = /医生|医生|医师|医师|医疗|医疗|心脏|心脏|临床|临床|doctor/i.test(params.context || "");
  const hasCulturePersona = /文化|艺术|艺术|历史|历史|书画|书画|收藏|人文/i.test(params.context || "");
  const personaConstraint = (hasMedicalPersona || hasCulturePersona)
    ? `\n\n特别约束：此用户具有专业身份与文化审美背景。monetizationLanes 中禁止出现电商带货路径。变现路径只能包含：知识付费（课程/私人咨询）、专业背书型品牌合作、机构讲座/合作、高端审美内容服务。platformMenu 中的第一顺位必须是与知识型/审美型内容适配度最高的平台（通常是小红书或B站），而非纯流量平台。`
    : "";

  const response = await invokeLLM({
    // Upgraded to Vertex 3.1 Pro Preview for richer dashboard analysis
    provider: "vertex",
    modelName: "gemini-3.1-pro-preview",
    messages: [
      {
        role: "system",
        content: `你是一位资深内容商业顾问，帮创作者判断平台优先级和商业化切入点。

请根据用户背景和近 ${params.windowDays} 天平台数据，生成平台决策看板（轻量版，不包含长文案）。

【绝对禁止输出泛平台画像】
在生成 platformMenu 的推荐理由（whyNow 等字段）时，绝对禁止写「抖音适合短视频」、「B站适合长视频讲透」、「小红书适合图文」等通用废话。
你的 positioning 或推荐理由，必须 100% 绑定该用户的 Persona 与专长领域。
例如：如果用户是"爱好中国历史的心脏科医生"，你必须写出「B站更适合你拆解古代『榫卯结构』与『现代心脏支架』的硬核医学科普，能建立极高信任感」这类高度专属的理由。

【强制热点关联与深度四维量化】
你在输出 platformMenu 的各个平台时，必须提供以下深度指标与分析：
1. referenceAccounts：若找不到具体账号，改为输出针对该平台的「目标用户画像」：描述在此平台上，谁最有可能成为这位创作者的忠实粉丝（年龄、职业、阅读偏好、消费能力）。格式：{account: "目标用户画像", reason: "具体描述"}。禁止输出 "[object Object]" 或空值。
2. trafficBoosters：强制从 \`snapshot\` 近期热点与趋势数据中提取。给出 1-3 个该平台目前正在进行的流量扶持活动（如官方打卡、赛道扶持）或即将到来的节日热点。例如："带上 #医学硬核科普 参与近期知识区流量扶持"。
3. primaryTrack (赛道)：结合 snapshot 选出最适合该用户的主攻赛道。
4. estimatedTraffic (预估流量)：从 platformBaselineStats 提取该平台的 medianTraffic45d（45天中位数流量），结合该用户的专业反差感给予 1.2x-1.5x 的溢价。
   【严格禁止输出"XX万"、"X万+"等占位符！必须计算真实数字！】
   计算公式：真实值 = medianTraffic45d × 1.2~1.5。然后格式化：
   - 如果结果 >1,000,000 → 输出 "X.XM+"（例如 1,200,000 → "1.2M+"）
   - 如果结果 >100,000 → 输出 "XXXK+"（例如 850,000 → "850K+"）
   - 如果结果 >10,000 → 输出 具体数字+"万+"（例如 52,000 → "5.2万+"）
   - 如果 medianTraffic45d === 0（无样本）→ 使用 audienceFitScore × 8000 × 1.3 作为代理估算，再格式化
   禁止输出文字描述（如"流量极大"），禁止输出"XX万"这种没有数字的占位符，只输出包含真实数字的格式化字符串。
5. ipUniqueness (IP独特性)：从 platformBaselineStats 提取该平台的 competitorDensity（0-1，越高越拥挤），公式：round((1 - competitorDensity) * 100 + 专业壁壘加分5-10)%，最高99%。输出格式："XX%"。
6. commercialConversion (商业转化率)：从 platformBaselineStats 提取 benchmarkConversionRate，高信任专业人设（医生/专家）给予 1.5x-2.5x 倍数加成。输出格式保留一位小数的百分比字符串如"4.2%"。禁止输出文字描述，只输出量化百分比。
7. nextMove（建议动作）：必须明确说出「发什么内容」与「如何开头」两件事。禁止写"先发一版内容拿反馈"这种空话。必须写出：具体的内容标题/主题 + 第一句话怎么说。例如：「发布《心脏科医生揭秘：古代『心主神明』竟然是神经科学！》，开头说：『你以为睡不好是脑子累？错了，2000年前的古人早就告诉你：问题可能出在你的心脏上。』」

严格要求：
1. 所有输出必须针对这个具体用户，不得写成通用模板。
2. headline 要是成熟顾问的核心判断，personaSummary 一句话说清身份与商业价值。
3. platformMenu：最多 3 个平台，每个平台必须包含 nextMove（含具体标题+开头第一句），并严格遵守【绝对禁止输出泛平台画像】约束。
4. topSignals：3 个关键信号；hotTopics：3 个热点方向；actionCards：3 个立刻能做的动作。
   【actionCards 极其重要】title 字段写「做什么动作」，detail 字段必须写出**完整的执行细节**：要发什么（具体标题）、第一句怎么说（完整的开头文案）、在哪个平台发、什么时间发。禁止 detail 写「先做一个可以快速拿到反馈的动作」这种废话。例如 detail："在B站发布《古代『养心』秘方 vs 现代心脏科学》，第一句：『你吃的那些养心安神的食物，到底有没有用？心脏科医生来告诉你真相。』工作日晚上 8 点发布，带 #医学硬核科普 标签。"
5. conversationStarters：3 个让用户愿意继续追问的问题。
6. 不要出现后台工程术语，不要出现"可能都可以""先试试"等空话。在回答"为什么这条路更适合你"时必须深度剖析，禁止出现"电商带货"等泛泛而谈词汇。${personaContextLine}${personaConstraint}

注意：contentBlueprints 和 monetizationLanes 不需要输出（留空数组即可）。

【绝对警告 — JSON 输出规范】：
请直接且仅输出合法的 JSON 对象，绝对不要包含任何 Markdown 标记（如 \`\`\`json 或 \`\`\`）、前言、结语或解释文字！
输出的第一个字符必须是 {，最后一个字符必须是 }。如果 JSON 未能完整输出会导致系统崩溃，请确保所有括号都正确关闭。
字段为：headline、subheadline、personaSummary、topSignals、platformMenu、hotTopics、contentBlueprints（空数组）、monetizationLanes（空数组）、actionCards、conversationStarters。`,
      },
      {
        role: "user",
        content: JSON.stringify({
          context: params.context || "",
          windowDays: params.windowDays,
          // Trimmed to reduce Vertex output token pressure
          platforms: params.snapshot.platformSnapshots.slice(0, 4).map((item) => ({
            platform: item.platform,
            displayName: item.displayName,
            audienceFitScore: item.audienceFitScore,
            momentumScore: item.momentumScore,
            summary: item.summary,
            sampleTopics: item.sampleTopics.slice(0, 3),
          })),
          topRecommendations: params.snapshot.platformRecommendations.slice(0, 2).map((item) => ({
            name: item.name,
            reason: item.reason,
            action: item.action,
          })),
          topTopics: params.snapshot.topicLibrary.slice(0, 4).map((item) => ({
            title: item.title,
            rationale: item.rationale,
            executionHint: item.executionHint,
          })),
          monetizationHints: params.snapshot.monetizationStrategies.slice(0, 2).map((item) => ({
            platform: item.platformLabel,
            track: item.primaryTrack,
            offerType: item.offerType,
          })),
          mainPath: {
            title: (params.snapshot as any).mainPath?.title,
            summary: (params.snapshot as any).mainPath?.summary,
            whyNow: (params.snapshot as any).mainPath?.whyNow,
          },
          // Always-45-day database baseline for metric calculation
          platformBaselineStats,
          collections: collectionEvidence.slice(0, 3).map((item) => ({
            platform: item.platform,
            itemCount: item.itemCount,
            hotTitles: item.hotTitles.slice(0, 4),
          })),
        }),
      },
    ],
  });

  // Phase 0-C: Robust JSON extraction — greedy bracket extraction, then fence strip fallback
  const rawContent = String(response.choices[0]?.message?.content || "");
  // Step 1: greedy bracket extraction — find the outermost { … } block in the raw output
  // This is the most reliable method when Gemini adds preamble/postamble text
  const bracketMatch = rawContent.match(/\{[\s\S]*\}/);
  const bracketExtracted = bracketMatch ? bracketMatch[0].trim() : "";
  // Step 2: fence strip fallback (original method, kept as secondary)
  const fenceMatch = rawContent.match(/```(?:json)?\s*([\s\S]+?)```/);
  const strippedContent = fenceMatch
    ? fenceMatch[1].trim()
    : rawContent.replace(/^```(?:json)?[\r\n]*/i, "").replace(/[\r\n]*```\s*$/i, "").trim();
  let parsedRaw: unknown;
  try {
    // Prefer greedy bracket extraction — handles preamble/postamble text
    parsedRaw = JSON.parse(bracketExtracted || strippedContent);
  } catch {
    // Fallback 1: fence-stripped content
    try {
      parsedRaw = JSON.parse(strippedContent);
    } catch {
      // Fallback 2: raw content (last resort)
      try {
        parsedRaw = JSON.parse(rawContent);
      } catch {
        // Crime scene logging — print the raw output so we can diagnose truncation
        console.error("[buildPlatformDashboard] JSON parse FAILED on all attempts.");
        console.error("[buildPlatformDashboard] rawContent length:", rawContent.length);
        console.error("[buildPlatformDashboard] rawContent preview (first 600 chars):", rawContent.slice(0, 600));
        console.error("[buildPlatformDashboard] rawContent tail (last 200 chars):", rawContent.slice(-200));
        parsedRaw = {};
      }
    }
  }

  // Use safeParse to avoid throwing on minor schema drift; log what failed
  const partial = (parsedRaw || {}) as Record<string, unknown>;
  if (!partial.headline || !partial.platformMenu) {
    const rawPreview = JSON.stringify(parsedRaw || {}).slice(0, 500);
    console.error("[buildPlatformDashboard] missing required fields. parsedRaw preview:", rawPreview);
    throw new Error(`buildPlatformDashboard: missing required fields. rawPreview: ${rawPreview}`);
  }
  const parseResult = platformDashboardResponseSchema.safeParse(partial);
  if (parseResult.success) {
    return parseResult.data;
  }
  console.error("[buildPlatformDashboard] schema drift detected:", (parseResult.error as any).issues?.slice(0, 5) ?? parseResult.error.message);
  console.warn("[buildPlatformDashboard] attempting loose parse with defaults");
  // Loose parse — fill missing optional fields with defaults, use safeParse to never throw
  const looseResult = platformDashboardResponseSchema.safeParse({
    headline: partial.headline || "",
    subheadline: partial.subheadline || "",
    personaSummary: partial.personaSummary || "",
    topSignals: Array.isArray(partial.topSignals) ? partial.topSignals : [],
    platformMenu: Array.isArray(partial.platformMenu) ? partial.platformMenu : [],
    hotTopics: Array.isArray(partial.hotTopics) ? partial.hotTopics : [],
    contentBlueprints: [],
    monetizationLanes: [],
    actionCards: Array.isArray(partial.actionCards) ? partial.actionCards : [],
    conversationStarters: Array.isArray(partial.conversationStarters) ? partial.conversationStarters : [],
  });
  if (looseResult.success) return looseResult.data;
  console.error("[buildPlatformDashboard] loose parse also failed:", (looseResult.error as any).issues?.slice(0, 5) ?? looseResult.error.message);
  throw new Error(`buildPlatformDashboard: loose parse failed. errors: ${JSON.stringify((looseResult.error as any).issues?.slice(0, 3) ?? looseResult.error.message)}`);
}

/**
 * normalizePlatformContentKeys — Key normalization layer for buildPlatformContent.
 * Gemini 2.5 Pro occasionally renames fields despite the strict JSON key-lock prompt.
 * This function remaps all documented alias variants to the canonical key names before
 * the Zod schema parse, so drifted responses are recovered gracefully instead of lost.
 *
 * Canonical keys (from prompt template):
 *   top-level: contentBlueprints, monetizationLanes
 *   blueprint item: title, format, hook, copywriting, suitablePlatforms,
 *                   actionableSteps, detailedScript, publishingAdvice, executionDetails
 *   monetization item: title, fitReason, offerShape, revenueModes, firstValidation
 */
function normalizePlatformContentKeys(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw };

  // ── Top-level array key aliases ──────────────────────────────────────────
  // contentBlueprints
  if (!Array.isArray(out.contentBlueprints)) {
    const alias =
      out.blueprints ?? out.contentPlans ?? out.contentPlan ??
      out.content_blueprints ?? out.plans ?? out.videos;
    if (Array.isArray(alias)) out.contentBlueprints = alias;
  }
  // monetizationLanes
  if (!Array.isArray(out.monetizationLanes)) {
    const alias =
      out.businessPaths ?? out.lanes ?? out.monetization_lanes ??
      out.monetizationPaths ?? out.bizPaths ?? out.businessLanes ??
      out.commercializationLanes ?? out.revenueLanes;
    if (Array.isArray(alias)) out.monetizationLanes = alias;
  }

  // ── Per-blueprint item key aliases ────────────────────────────────────────
  if (Array.isArray(out.contentBlueprints)) {
    out.contentBlueprints = (out.contentBlueprints as any[]).map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const b: Record<string, unknown> = { ...item };
      // title
      if (!b.title) b.title = b.theme ?? b.topicTitle ?? b.videoTitle ?? b.subject ?? b.name ?? "";
      // hook
      if (!b.hook) b.hook = b.contentHook ?? b.openingHook ?? b.hookLine ?? b.opener ?? "";
      // copywriting
      if (!b.copywriting) b.copywriting = b.copy ?? b.bodyText ?? b.content ?? b.mainCopy ?? "";
      // suitablePlatforms
      if (!Array.isArray(b.suitablePlatforms)) {
        const pa = b.platforms ?? b.targetPlatforms ?? b.suitable_platforms ?? b.platformList;
        b.suitablePlatforms = Array.isArray(pa) ? pa : [];
      }
      // actionableSteps
      if (!Array.isArray(b.actionableSteps)) {
        const sa = b.steps ?? b.actionSteps ?? b.actions ?? b.nextSteps ?? b.executionSteps;
        b.actionableSteps = Array.isArray(sa) ? sa : [];
      }
      // detailedScript
      if (!b.detailedScript) b.detailedScript = b.script ?? b.storyboard ?? b.detailed_script ?? b.shooting_script ?? "";
      // publishingAdvice
      if (!b.publishingAdvice) b.publishingAdvice = b.publishing ?? b.publishTips ?? b.publishing_advice ?? b.releaseAdvice ?? "";
      // executionDetails — normalize nested object if present
      if (b.executionDetails && typeof b.executionDetails === "object") {
        const ed = b.executionDetails as Record<string, unknown>;
        if (!ed.environmentAndWardrobe) ed.environmentAndWardrobe = ed.environment ?? ed.wardrobe ?? ed.scene ?? "";
        if (!ed.lightingAndCamera) ed.lightingAndCamera = ed.lighting ?? ed.camera ?? ed.lighting_camera ?? "";
        if (!Array.isArray(ed.stepByStepScript)) {
          const ss = ed.steps ?? ed.script ?? ed.stepByStep ?? ed.step_by_step_script;
          ed.stepByStepScript = Array.isArray(ss) ? ss : [];
        }
        b.executionDetails = ed;
      }
      return b;
    });
  }

  // ── Per-monetizationLane item key aliases ─────────────────────────────────
  if (Array.isArray(out.monetizationLanes)) {
    out.monetizationLanes = (out.monetizationLanes as any[]).map((item: any) => {
      if (!item || typeof item !== "object") return item;
      const m: Record<string, unknown> = { ...item };
      // title
      if (!m.title) m.title = m.laneName ?? m.name ?? m.direction ?? m.pathName ?? "";
      // fitReason
      if (!m.fitReason) m.fitReason = m.feasibility ?? m.reason ?? m.fit_reason ?? m.why ?? m.suitability ?? "";
      // offerShape
      if (!m.offerShape) m.offerShape = m.offer ?? m.deliverable ?? m.shape ?? m.offer_shape ?? "";
      // revenueModes
      if (!Array.isArray(m.revenueModes)) {
        const rm = m.revenue ?? m.modes ?? m.revenue_modes ?? m.monetizationMethods;
        m.revenueModes = Array.isArray(rm) ? rm : [];
      }
      // firstValidation
      if (!m.firstValidation) m.firstValidation = m.actionItem ?? m.validation ?? m.firstStep ?? m.first_validation ?? m.nextStep ?? "";
      return m;
    });
  }

  return out;
}

async function buildPlatformContent(params: {
  snapshot: any;
  platformMenu: any;
  context?: string;
  windowDays: number;
}) {
  const hasMedicalPersona = /医生|医生|医师|医师|医疗|医疗|心脏|心脏|临床|临床|doctor/i.test(params.context || "");
  const hasCulturePersona = /文化|艺术|艺术|历史|历史|书画|书画|收藏|人文/i.test(params.context || "");
  const personaConstraint = (hasMedicalPersona || hasCulturePersona)
    ? `\n\n特别约束：此用户具有专业身份与文化审美背景。monetizationLanes 中禁止出现电商带货路径。变现路径只能包含：知识付费（课程/私人咨询）、专业背书型品牌合作、机构讲座/合作、高端审美内容服务。`
    : "";

  const response = await invokeLLM({
    // Upgraded to Vertex 3.1 Pro Preview for premium content generation
    provider: "vertex",
    modelName: "gemini-3.1-pro-preview",
    messages: [
      {
        role: "system",
        content: `你是一个顶级的个人IP商业文案顾问。

根据已生成的平台方向与用户背景数据，请为这位创作者制定深度内容的执行蓝图与商业变现路径。

【绝对禁止词汇黑名单】（任何输出中出现以下词汇/句式即判定为不合格，必须重写）：
- "电商带货" / "带货" / "橱窗"
- "先做一轮轻量验证" / "先做轻量验证" / "轻量验证"
- "开头先给结果" / "视频开头先给判断，中段给例子，结尾给行动引导"
- "可能都可以" / "先试试" / "先探索一下"
- "制作身份名片" / "锁定文化符号" / "设计轻量级产品"
- 任何泛化建议，不针对此用户的具体身份和专长

严格要求：
1. contentBlueprints：生成至少 3 个具体可执行的内容方案。每个方案必须包含：
   - title（选题标题，必须是具体的，不是抽象的）
   - format（内容形式：短视频 / 图文）
   - hook（开头文案钩子，必须是一句具体的、能让用户停下来的话）
   - copywriting（核心文案方向，必须包含完整详细的正文内容，字数不少于200字。**无论是图文还是视频，都必须给出完整可直接使用的正文文案**，包含：开头段落全文、中间内容展开全文、结尾引导行动全文）
   - suitablePlatforms（适合发哪些平台，字符串数组）
   - actionableSteps（落地三步曲：必须给出至少 3 个具体、可行、有先后顺序的落地指导。例如：1.拍摄 15 秒榫卯对比视频；2.修改主页简介；3.加入当下话题等。此字段为 string 数组。）
	   - detailedScript（详细的拍摄脚本或大纲，必须是保姆级指导，将从前序提取出的 trafficBoosters 节日/活动热点一并融入，例如明确指出使用什么具体平台搜索关键词。
     【强制脚本排版规则 — 必须严格遵守，不得简化】：
     ▸ 如果 format 为「短视频」（抖音/B站/快手）：必须使用精确时间轴格式，每段必须包含「视觉描述」与「口播文案」，例如：
       "[00:00-00:05] 视觉：手持心脏支架特写，对准镜头。文案：你以为睡不好是脑子累？错了！"
       "[00:05-00:20] 视觉：切换古籍《黄帝内经》特写页。文案：两千年前的古人早就告诉你..."
       "[00:20-00:45] 视觉：心脏神经示意图动画。文案：心脏里有一个「第二大脑」..."
     ▸ 如果 format 为「图文」（小红书）：必须分封面+内页格式，例如：
       "[封面设计] 大标题：古代治心病就靠这3件事。视觉：高质感茶席+心电图拼接图。"
       "[图2-图4 痛点引入] 文案：你总是睡不好、心悸？其实古人早就有答案..."
       "[图5-图6 核心内容] 分步列出3个要点..."
	       "[正文区] 完整文案+平台搜索关键词，不要随意堆砌无关标签。"）
   - publishingAdvice（发布时机或平台设置建议，例如“蹭小红书RED新生代大赛热点，修改小红书简介为‘用东方审美重构健康叙事’”等具体设置。）
   - executionDetails（执行细节，必须极度具体）：
     * environmentAndWardrobe（拍摄环境 + 服装道具描述，例如："白色诊室背景，穿白大褂，手持医学影像片"）
     * lightingAndCamera（灯光 + 机位，例如："自然光侧光，手机固定在支架上正面对拍，避免背光"）
     * stepByStepScript（逐步脚本，数组格式，每条说明一个画面/步骤，例如：["【0-3秒】直接说出核心判断：……","【3-15秒】展示具体案例：……","【15-25秒】给出行动建议：……"]）

2. monetizationLanes：生成 1-2 条强相关的变现路径（例如"知识付费-心血管健康私人咨询"）。必须包含：
   - title（变现方向名，具体到品类）
   - fitReason（为什么适合此用户，基于其具体身份）
   - offerShape（交付形态，例如"90分钟1v1线上问诊+报告解读"）
   - revenueModes（具体变现方式数组）
   - firstValidation（**禁止写"先做一轮轻量验证"**，必须写具体的第一步：例如"在小红书发一条免费答疑视频，评论区收集付费意向用户"）

【强制 JSON Key 名称锁定 — 一字不差！】
你的输出 JSON 必须且只能使用以下 Key 名称，不得发明新字段名（如不能用 businessPaths、lanes、blueprints 等）：
{
  "contentBlueprints": [
    {
      "title": "具体的选题标题",
      "format": "短视频 或 图文",
      "hook": "开头钩子文案",
      "copywriting": "完整正文（≥200字）",
      "suitablePlatforms": ["平台1", "平台2"],
      "actionableSteps": ["第一步具体动作", "第二步具体动作", "第三步具体动作"],
      "detailedScript": "完整分镜脚本（视频用时间轴，图文用封面+内页格式）",
      "publishingAdvice": "发布时机与平台设置建议",
      "executionDetails": {
        "environmentAndWardrobe": "拍摄环境与服装道具",
        "lightingAndCamera": "灯光与机位建议",
        "stepByStepScript": ["【0-3秒】...", "【3-15秒】..."]
      }
    }
  ],
  "monetizationLanes": [
    {
      "title": "变现方向名",
      "fitReason": "为什么适合此人设",
      "offerShape": "交付形态",
      "revenueModes": ["具体变现方式1", "具体变现方式2"],
      "firstValidation": "第一步的具体行动"
    }
  ]
}

【绝对警告 — JSON 输出规范】：
请直接且仅输出合法的 JSON 对象，绝对不要包含任何 Markdown 标记（如 \`\`\`json 或 \`\`\`）、前言、结语或解释文字！
输出的第一个字符必须是 {，最后一个字符必须是 }。如果 JSON 未能完整输出会导致系统崩溃，请确保所有括号都正确关闭。

3. 你给出的「现在就能执行的动作」(以及 executionDetails 和 actionableSteps)，必须是极度具体的「物理级微小行动」。禁止写「制作身份名片」、「锁定文化符号」这种空泛的顾问废话。你必须具体到像这样：「第一步：拿一颗金属螺丝钉和一块木制榫卯，对着镜头录制一段 15 秒的对比短片。」越具体、越反常识越好。

4. 必须极度详细、有落地感，不要泛泛而谈。文案需完美匹配用户人设与专长。在详细脚本与指导设计中，强制融入从 Call 2 (platformMenu) 提取出的 \`trafficBoosters\` 热点或活动要求。${personaConstraint}

【重要】直接输出原始 JSON 对象，不要用 markdown 代码块包裹（不要加 \`\`\`json 或 \`\`\`），不要在 JSON 前后加任何解释文字。输出的第一个字符必须是 {，最后一个字符必须是 }。
字段为：contentBlueprints（数组，每项含 title/format/hook/copywriting/suitablePlatforms/executionDetails）, monetizationLanes。`,
      },
      {
        role: "user",
        content: JSON.stringify({
          context: params.context || "",
          windowDays: params.windowDays,
          platformMenu: params.platformMenu,
          snapshotData: {
            titleExecutions: params.snapshot.titleExecutions || [],
            monetizationStrategies: params.snapshot.monetizationStrategies || [],
            growthPlan: params.snapshot.growthPlan || [],
            creationAssist: params.snapshot.creationAssist || {},
          },
        }),
      },
    ],
  });

  // Robust JSON extraction — greedy bracket extraction, then fence strip fallback
  const rawContent = String(response.choices[0]?.message?.content || "");
  const bracketMatch = rawContent.match(/\{[\s\S]*\}/);
  const bracketExtracted = bracketMatch ? bracketMatch[0].trim() : "";
  
  const fenceMatch2 = rawContent.match(/```(?:json)?\s*([\s\S]+?)```/);
  const strippedContent2 = fenceMatch2
    ? fenceMatch2[1].trim()
    : rawContent.replace(/^```(?:json)?[\r\n]*/i, "").replace(/[\r\n]*```\s*$/i, "").trim();
  
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(bracketExtracted || strippedContent2);
  } catch {
    try {
      parsedRaw = JSON.parse(strippedContent2);
    } catch {
      try {
        parsedRaw = JSON.parse(rawContent);
      } catch {
        console.error("[buildPlatformContent] JSON parse FAILED on all attempts.");
        console.error("[buildPlatformContent] rawContent length:", rawContent.length);
        console.error("[buildPlatformContent] rawContent tail (last 200 chars):", rawContent.slice(-200));
        parsedRaw = {};
      }
    }
  }

  // Key normalization layer — handles known Gemini key-drift patterns before Zod parse.
  // Gemini may rename keys despite the 【强制 JSON Key 锁定】 prompt instruction.
  // This layer remaps all observed alias variants back to the canonical key names.
  const partial = normalizePlatformContentKeys((parsedRaw || {}) as Record<string, unknown>);
  const parseResult = platformContentResponseSchema.safeParse(partial);
  if (parseResult.success) return parseResult.data;

  console.error("[buildPlatformContent] schema drift detected:", (parseResult.error as any).issues?.slice(0, 5) ?? parseResult.error.message);
  console.warn("[buildPlatformContent] attempting loose parse with defaults");
  const looseResult = platformContentResponseSchema.safeParse({
    contentBlueprints: Array.isArray(partial.contentBlueprints) ? partial.contentBlueprints : [],
    monetizationLanes: Array.isArray(partial.monetizationLanes) ? partial.monetizationLanes : [],
  });
  if (looseResult.success) return looseResult.data;
  console.error("[buildPlatformContent] loose parse also failed:", (looseResult.error as any).issues?.slice(0, 5) ?? looseResult.error.message);
  throw new Error(`buildPlatformContent: loose parse failed. errors: ${JSON.stringify((looseResult.error as any).issues?.slice(0, 3) ?? looseResult.error.message)}`);
}

function buildFallbackPlatformDashboard(params: {
  snapshot: z.infer<typeof growthSnapshotSchema>;
  context?: string;
  windowDays: number;
}) {
  const topPlatform = params.snapshot.platformRecommendations[0];
  const topTopic = params.snapshot.topicLibrary[0];
  const topExecution = params.snapshot.titleExecutions[0];
  const topStrategy = params.snapshot.monetizationStrategies[0];
  const mainPath = params.snapshot.decisionFramework.mainPath;
  const assetAdaptation = params.snapshot.decisionFramework.assetAdaptation;
  const contextLabel = String(params.context || "").trim() || topTopic?.title || "当前方向";

  return platformDashboardResponseSchema.parse({
    headline: topPlatform
      ? `围绕 ${contextLabel}，先从 ${topPlatform.name} 入手更容易拿到第一轮反馈`
      : `围绕 ${contextLabel}，先用 ${params.windowDays} 天窗口做轻量验证`,
    subheadline: mainPath.summary
      || params.snapshot.overview.trendNarrative
      || `这版先基于近 ${params.windowDays} 天快照给出可执行判断，避免首轮分析长时间卡住。`,
    personaSummary: `把“${contextLabel}”收成一个兼具专业可信度和文化审美记忆点的内容身份，再决定放大到哪个平台。`,
    topSignals: [
      {
        title: "优先平台",
        detail: topPlatform?.reason || mainPath.whyNow || params.snapshot.overview.summary,
        badge: "先做",
      },
      {
        title: "选题切口",
        detail: topExecution?.copywriting || topTopic?.executionHint || assetAdaptation.structure,
        badge: "热点",
      },
      {
        title: "承接方式",
        detail: topStrategy?.strategy || params.snapshot.businessInsights[0]?.detail || mainPath.nextAction,
        badge: "承接",
      },
    ].filter((item) => item.detail),
    platformMenu: params.snapshot.platformSnapshots.slice(0, 4).map((item, index) => ({
      platform: item.platform,
      label: item.displayName,
      trend: `动量 ${item.momentumScore} / 适配 ${item.audienceFitScore}`,
      lane: item.sampleTopics[0] || item.summary,
      whyNow: item.summary,
      recommendedFormat: params.snapshot.platformActivities[index]?.recommendedFormat || params.snapshot.titleExecutions[index]?.presentationMode || "图文 + 短视频双测",
      titleExample: params.snapshot.titleExecutions[index]?.title || item.sampleTopics[0] || "",
      contentHook: params.snapshot.titleExecutions[index]?.openingHook || params.snapshot.creationAssist.brief || "",
      nextMove: params.snapshot.platformRecommendations[index]?.action || params.snapshot.growthPlan[index]?.action || "先用一个轻量主题验证反馈。",
      monetizationPath: params.snapshot.monetizationStrategies[index]?.primaryTrack || params.snapshot.businessInsights[index]?.title || "",
    })),
    hotTopics: params.snapshot.topicLibrary.slice(0, 6).map((item, index) => ({
      title: item.title,
      whyHot: item.rationale,
      howToUse: params.snapshot.titleExecutions[index]?.copywriting || item.executionHint,
    })),
    contentBlueprints: params.snapshot.titleExecutions.slice(0, 4).map((item) => ({
      title: item.title,
      format: item.presentationMode,
      hook: item.openingHook || item.copywriting,
      copywriting: item.copywriting,
      graphicPlan: item.graphicPlan,
      videoPlan: item.videoPlan,
      suitablePlatforms: item.suitablePlatforms,
    })),
    monetizationLanes: params.snapshot.monetizationStrategies.slice(0, 2).map((item) => ({
      title: item.primaryTrack,
      fitReason: item.reason,
      offerShape: item.offerType,
      revenueModes: [item.strategy, item.callToAction].filter(Boolean),
      firstValidation: params.snapshot.decisionFramework.validationPlan[0]?.nextMove || item.callToAction,
    })),
    actionCards: [
      {
        title: "首发内容怎么开头",
        detail: assetAdaptation.firstHook || topExecution?.openingHook || "先把用户是谁、为什么值得看、第一句结论写在开头。",
      },
      {
        title: "内容结构怎么排",
        detail: assetAdaptation.structure || topExecution?.graphicPlan || "先给判断，再给案例，再给用户可执行动作。",
      },
      {
        title: "商业承接先接什么",
        detail: topStrategy?.callToAction || topStrategy?.offerType || "先验证用户最愿意进一步咨询或收藏的那条服务承接。",
      },
      {
        title: "这一轮先验证什么",
        detail: params.snapshot.decisionFramework.validationPlan[0]?.nextMove || mainPath.nextAction || "先做一轮轻量内容验证平台反馈，再决定是否放大。",
      },
    ].filter((item) => item.detail),
    conversationStarters: [
      `如果我先做 ${topPlatform?.name || "当前优先平台"}，第一批内容应该先发图文还是视频？`,
      `围绕“${topTopic?.title || contextLabel}”，最值得先验证的商业化承接是什么？`,
      `在近 ${params.windowDays} 天窗口里，哪些方向应该先不做？`,
    ],
  });
}

function buildPlatformFollowUpFallback(params: {
  question: string;
  context?: string;
  windowDays: number;
  snapshot: z.infer<typeof growthSnapshotSchema>;
}) {
  const subject = String(params.context || "").trim() || "这条内容方向";
  const topPlatform = params.snapshot.platformRecommendations[0];
  const topExecution = params.snapshot.titleExecutions[0];
  const topMonetization = params.snapshot.monetizationStrategies[0];
  const secondMonetization = params.snapshot.monetizationStrategies[1];
  const nextQuestions = [
    `如果先做 ${topPlatform?.name || "当前优先平台"}，第一条内容我该发图文还是视频？`,
    `围绕“${subject}”，第一批标题我该先测哪 3 个？`,
    `现在最适合先验证哪一条商业承接，而不是同时铺很多条线？`,
  ].slice(0, 3);

  return platformFollowUpResponseSchema.parse({
    title: "继续往下拆成可执行动作",
    answer: [
      `先给判断：围绕“${subject}”，这一轮不要把平台、内容形式和商业路径一起铺开，优先从 ${topPlatform?.name || "当前优先平台"} 做一条能建立信任感的内容验证。`,
      `为什么：你当前更需要先验证“什么表达最容易让用户记住你”，而不是一上来堆很多泛变现路线。优先内容可以直接用“${topExecution?.title || "把专业身份和文化内容收成一个明确切口"}”，开头先说“${topExecution?.openingHook || "我先给你一个明确判断"}”，主体按“判断 -> 解释 -> 例子 -> 给行动”展开。${topExecution?.presentationMode === "图文" ? `图文写法先用 ${topExecution?.graphicPlan || "封面一句结论，正文三段展开"}。` : `视频拍法先用 ${topExecution?.videoPlan || "先给判断，再讲例子，最后给行动"}。`}`,
      `下一步怎么做：商业承接只先保留 ${topMonetization?.primaryTrack || "一条最贴近你身份的路径"}${secondMonetization ? `，备选是 ${secondMonetization.primaryTrack}` : ""}。先不要把所有变现方式一起上。第一轮只验证“${topMonetization?.callToAction || "用户会不会愿意继续咨询、收藏或私信"}”，看反馈后再决定是否放大。`,
    ].join("\n\n"),
    encouragement: "这轮先把第一条内容和第一条承接验证出来，不要同时铺四条线。",
    nextQuestions,
  });
}

async function personalizeGrowthSnapshot(params: {
  snapshot: z.infer<typeof growthSnapshotSchema>;
  analysis: z.infer<typeof growthAnalysisScoresSchema>;
  context?: string;
  requestedPlatforms: string[];
  modelName?: string;
  store: Awaited<ReturnType<typeof readTrendStore>>;
  userEvidence?: Awaited<ReturnType<typeof readGrowthUserEvidence>>;
  windowDays?: number;
}) {
  const { snapshot, analysis, context, requestedPlatforms, modelName, store, userEvidence, windowDays } = params;
  const finalModel = resolveGrowthCampFinalModel(modelName);
  const is31 = /3\.1/i.test(finalModel);
  const backfillPlatforms = (store.backfill?.platforms || [])
    .filter((item) => requestedPlatforms.includes(item.platform))
    .map((item) => ({
      platform: item.platform,
      currentTotal: item.currentTotal || 0,
      archivedTotal: item.archivedTotal || 0,
      status: item.status,
      plateauCount: item.plateauCount || 0,
    }));
  const creatorCenterStats = buildDouyinCreatorCenterStats(store);
  const creatorCenterEvidence = requestedPlatforms.includes("douyin")
    ? {
        currentTotal: creatorCenterStats.currentTotal,
        archivedTotal: creatorCenterStats.archivedTotal,
        buckets: creatorCenterStats.buckets.slice(0, 6),
      }
    : null;
  const collectionEvidence = requestedPlatforms.map((platform) => {
    const collection = store.collections?.[platform as keyof typeof store.collections];
    const bucketCounts = collection?.stats?.bucketCounts || getCollectionBucketCounts(collection?.items || []);
    return {
      platform,
      collectedAt: collection?.collectedAt || null,
      itemCount: collection?.items?.length || 0,
      sampleTitles: (collection?.items || []).slice(0, 8).map((item) => item.title),
      topBuckets: Object.entries(bucketCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([bucket, count]) => ({ bucket, count })),
      notes: (collection?.notes || []).slice(0, 5),
    };
  });

  const response = await invokeLLM({
    model: "pro",
    provider: "gemini",
    modelName: finalModel,
    messages: [
      {
        role: "system",
        content: `你是一个擅长内容商业化、平台策略和素材转译的资深顾问。

请像用户在直接向 Gemini 求助那样思考问题，而不是先套产品模板。
你必须先理解“这个人是谁、这条素材是什么、他想实现什么商业价值”，再给判断。

输出规则：
0. 如果 evidence 里有 userEvidence，优先把它当成这个创作者自己的历史数据库证据；不要被泛行业模板带偏。
1. 优先依据上传内容分析、用户业务背景和平台证据，不得复读通用模板。
2. 如果用户身份与素材主题跨域，先回答“这条素材怎么桥接回原业务”，不要直接跳到卖课、社群或咨询。
3. 严禁把“知识付费、社群会员、咨询陪跑”当默认答案，除非证据充分。
4. decisionFramework 是主输出，必须保留一条 mainPath 和至少一条 avoidPath。
5. decisionFramework.assetAdaptation 必须直接说明更适合视频还是图文、开头怎么改、结构怎么改、结尾动作是什么；不要出现英文缩写，要统一写成“行动引导”。
6. 平台数据和历史沉淀只能作为证据，不要暴露后台统计口径、内部排序机制或工程逻辑。
7. 必须额外返回：
   - 把视频抽帧视觉结论真正写进输出，不要只复述音频。尤其要吸收 keyFrames、openingFrameAssessment、visualSummary。
   - titleExecutions：3 条标题，每条都要有详细文案、适合图文还是视频、适合的平台和为什么；并补 formatReason、graphicPlan、videoPlan，图文怎么写和视频怎么拍必须写到能直接执行。
   - platformActivities：各平台当前活跃方向、热点主题和最适合的呈现方式；并补 supportActivities、supportSignal、potentialTrack、optimizationPlan。抖音、小红书、B站、快手的描述必须明显不同，不能复用同一句平台画像。
   - monetizationStrategies：推荐平台对应的商业变现策略、行动引导和承接产品形态。
   - recommendedPlatforms：至少给 2 到 3 个推荐发布平台，并给出相关账号示例或对标方向。
   - dataLibraryStructure：说明这个分析结果背后应该由哪些数据层来支撑。
   - 如果 evidence 里已经有 collections / platformSnapshots / currentVsArchiveByPlatform，就必须把它们吃进分析，不能脱离数据库空写平台特征。
8. ${is31
    ? "当前模型是 3.1 Pro。请把输出拉到“操盘手级”细度：图文怎么写要写出页数与每页职责，视频怎么拍要写到几秒出现什么画面、字幕和动作，推荐平台要更明确说明为什么这个平台优先。"
    : "当前模型是 2.5 Pro。输出仍然要细，但优先保证结构清楚、执行明确，少讲抽象的情绪渲染。"}
9. 输出必须是结构化 JSON，不要写成散文。`,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              `用户任务：我是${String(context || "").trim() || "一个正在寻找内容商业化方向的创作者"}，请用这条素材，分析我怎样把它转成对我有商业价值的内容。`,
              "请先判断这条素材和我原本业务的连接点，再告诉我最值得做的一条商业路径、当前不要做的路径、适合发视频还是图文、首发应该怎么改，以及我该用什么方式验证这条路径是否成立。",
              `当前用户选择关注的时间维度：${Number(windowDays || snapshot.status.windowDays || 30)} 天。请让你的判断和建议明确对应这个时间窗口。`,
              "不要给泛泛的商业模板，也不要默认推荐社群、课程或咨询，除非这条素材和我的业务真的有直接证据支持。",
              "",
              "下面是你可以使用的证据：",
              JSON.stringify({
                requestedPlatforms,
                analysis,
                baseSnapshot: {
                  status: snapshot.status,
                  overview: snapshot.overview,
                  platformSnapshots: snapshot.platformSnapshots,
                  topicLibrary: snapshot.topicLibrary.slice(0, 8),
                  trendLayers: snapshot.trendLayers.slice(0, 8),
                  opportunities: snapshot.opportunities.slice(0, 6),
                  structurePatterns: snapshot.structurePatterns.slice(0, 6),
                },
                commercialSeeds: {
                  titleSuggestions: analysis.titleSuggestions || [],
                  commercialAngles: analysis.commercialAngles || [],
                  creatorCenterSignals: analysis.creatorCenterSignals || [],
                  weakFrameReferences: analysis.weakFrameReferences || [],
                  visualSummary: analysis.visualSummary || "",
                  openingFrameAssessment: analysis.openingFrameAssessment || "",
                  sceneConsistency: analysis.sceneConsistency || "",
                  trustSignals: analysis.trustSignals || [],
                  visualRisks: analysis.visualRisks || [],
                  keyFrames: analysis.keyFrames || [],
                  timestampSuggestions: analysis.timestampSuggestions || [],
                  followUpPrompt: analysis.followUpPrompt || "",
                },
                platformEvidence: {
                  selectedWindowDays: store.backfill?.selectedWindowDays || snapshot.status.windowDays,
                  currentVsArchiveByPlatform: backfillPlatforms,
                  creatorCenterEvidence,
                  collections: collectionEvidence,
                  dataAnalystSummary: snapshot.dataAnalystSummary,
                },
                userEvidence,
                pipelineRouting: {
                  extractorModel: resolveGrowthCampExtractorModel(),
                  strategistModel: finalModel,
                  pipelineMode: resolveGrowthCampPipelineMode(finalModel),
                },
              }, null, 2),
            ].join("\n"),
          },
        ],
      },
    ],
    response_format: { type: "json_object" },
  });

  const parsed = JSON.parse(String(response.choices[0]?.message?.content || "{}"));
  return growthSnapshotPersonalizationSchema.parse({
    ...parsed,
    decisionFramework: parsed?.decisionFramework || snapshot.decisionFramework,
  });
}

function buildGrowthDataEvidenceNotes(params: {
  requestedPlatforms: string[];
  store: Awaited<ReturnType<typeof readTrendStore>>;
  userEvidence?: Awaited<ReturnType<typeof readGrowthUserEvidence>>;
}) {
  const platformRows = (params.store.backfill?.platforms || [])
    .filter((item) => params.requestedPlatforms.includes(item.platform))
    .map((item) => `${item.platform}: 当前 ${item.currentTotal || 0} / 历史 ${item.archivedTotal || 0}`)
    .slice(0, 6);
  const notes = [
    platformRows.length
      ? `平台数据证据：${platformRows.join("；")}。`
      : "",
    params.userEvidence?.summaryNote || "",
  ];
  return notes.filter(Boolean);
}

type GrowthUserEvidence = {
  recentSubmissions: Array<{
    title: string;
    category: string;
    viralScore: number;
    createdAt: string;
    scoreStatus: string;
    platforms: Array<{
      platform: string;
      playCount: number;
      likeCount: number;
      commentCount: number;
      shareCount: number;
      verifyStatus: string;
    }>;
  }>;
  recurringThemes: string[];
  platformPerformance: Array<{
    platform: string;
    submissions: number;
    avgPlayCount: number;
    avgLikeCount: number;
    avgCommentCount: number;
    avgShareCount: number;
    topPlayCount: number;
    topViralScore: number;
  }>;
  strongestPlatforms: string[];
  summaryNote: string;
};

function extractGrowthKeywords(values: string[]) {
  const stopwords = new Set([
    "视频", "内容", "作品", "分享", "记录", "日常", "今天", "这个", "那个", "一种", "一次", "真的",
    "我们", "你们", "他们", "自己", "一下", "时候", "相关", "个人", "平台", "创作", "商业", "方向",
  ]);
  const counts = new Map<string, number>();
  for (const value of values) {
    const matches = String(value || "").match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || [];
    for (const raw of matches) {
      const token = raw.trim().toLowerCase();
      if (!token || stopwords.has(token)) continue;
      counts.set(token, (counts.get(token) || 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([keyword]) => keyword);
}

async function readGrowthUserEvidence(userId: number, requestedPlatforms: string[]): Promise<GrowthUserEvidence | null> {
  const conn = await db.getDb();
  if (!conn) return null;

  const submissions = await conn
    .select({
      id: videoSubmissions.id,
      title: videoSubmissions.title,
      description: videoSubmissions.description,
      category: videoSubmissions.category,
      viralScore: videoSubmissions.viralScore,
      scoreStatus: videoSubmissions.scoreStatus,
      createdAt: videoSubmissions.createdAt,
    })
    .from(videoSubmissions)
    .where(eq(videoSubmissions.userId, userId))
    .orderBy(desc(videoSubmissions.createdAt))
    .limit(6);

  if (!submissions.length) return null;

  const recentSubmissions: GrowthUserEvidence["recentSubmissions"] = [];
  const performance = new Map<string, {
    submissions: number;
    playCount: number;
    likeCount: number;
    commentCount: number;
    shareCount: number;
    topPlayCount: number;
    topViralScore: number;
  }>();

  for (const submission of submissions) {
    const links = await conn
      .select({
        platform: videoPlatformLinks.platform,
        playCount: videoPlatformLinks.playCount,
        likeCount: videoPlatformLinks.likeCount,
        commentCount: videoPlatformLinks.commentCount,
        shareCount: videoPlatformLinks.shareCount,
        verifyStatus: videoPlatformLinks.verifyStatus,
      })
      .from(videoPlatformLinks)
      .where(eq(videoPlatformLinks.videoSubmissionId, submission.id));

    const filteredLinks = links.filter((item) => !requestedPlatforms.length || requestedPlatforms.includes(String(item.platform)));
    recentSubmissions.push({
      title: submission.title,
      category: submission.category || "",
      viralScore: Number(submission.viralScore || 0),
      createdAt: submission.createdAt?.toISOString?.() || new Date(submission.createdAt as any).toISOString(),
      scoreStatus: String(submission.scoreStatus || ""),
      platforms: filteredLinks.map((item) => ({
        platform: String(item.platform),
        playCount: Number(item.playCount || 0),
        likeCount: Number(item.likeCount || 0),
        commentCount: Number(item.commentCount || 0),
        shareCount: Number(item.shareCount || 0),
        verifyStatus: String(item.verifyStatus || ""),
      })),
    });

    for (const link of filteredLinks) {
      const key = String(link.platform);
      const row = performance.get(key) || {
        submissions: 0,
        playCount: 0,
        likeCount: 0,
        commentCount: 0,
        shareCount: 0,
        topPlayCount: 0,
        topViralScore: 0,
      };
      row.submissions += 1;
      row.playCount += Number(link.playCount || 0);
      row.likeCount += Number(link.likeCount || 0);
      row.commentCount += Number(link.commentCount || 0);
      row.shareCount += Number(link.shareCount || 0);
      row.topPlayCount = Math.max(row.topPlayCount, Number(link.playCount || 0));
      row.topViralScore = Math.max(row.topViralScore, Number(submission.viralScore || 0));
      performance.set(key, row);
    }
  }

  const platformPerformance = Array.from(performance.entries())
    .map(([platform, row]) => ({
      platform,
      submissions: row.submissions,
      avgPlayCount: Math.round(row.playCount / Math.max(row.submissions, 1)),
      avgLikeCount: Math.round(row.likeCount / Math.max(row.submissions, 1)),
      avgCommentCount: Math.round(row.commentCount / Math.max(row.submissions, 1)),
      avgShareCount: Math.round(row.shareCount / Math.max(row.submissions, 1)),
      topPlayCount: row.topPlayCount,
      topViralScore: row.topViralScore,
    }))
    .sort((left, right) => right.avgPlayCount - left.avgPlayCount || right.topViralScore - left.topViralScore);

  const strongestPlatforms = platformPerformance.slice(0, 2).map((item) => getGrowthPlatformMeta(item.platform).label);
  const recurringThemes = extractGrowthKeywords(submissions.flatMap((item) => [item.title, item.description || "", item.category || ""]));
  const summaryNote = `用户历史投稿证据：最近 ${recentSubmissions.length} 条投稿里，${strongestPlatforms.join("、") || "主平台"} 更强，重复主题集中在 ${recurringThemes.slice(0, 4).join("、") || "当前业务核心词"}。`;

  return {
    recentSubmissions,
    recurringThemes,
    platformPerformance,
    strongestPlatforms,
    summaryNote,
  };
}

function buildFallbackFrameAnalysis(context?: string) {
  const text = String(context || "").trim();
  const isCommercial = /品牌|招商|客户|服务|案例/.test(text);
  const isEducation = /课程|教学|训练营|教程|知识/.test(text);
  const isCommerce = /商品|带货|电商|转化/.test(text);

  return {
    composition: 74,
    color: 78,
    lighting: 72,
    impact: isCommerce ? 84 : 76,
    viralPotential: isCommercial || isEducation ? 81 : 75,
    strengths: [
      "主体信息较集中，便于包装单一卖点。",
      "画面风格具备继续放大的基础。",
      "适合延展成封面版、拆解版和平台适配版。",
    ],
    improvements: [
      "开场结果还可以更前置，减少铺垫。",
      "需要补更明确的商业行动引导和标题结构。",
      "建议针对不同平台输出不同版本，而不是一稿通发。",
    ],
    platforms: isEducation ? ["B站", "小红书", "抖音"] : ["抖音", "小红书", "B站"],
    summary: isCommercial
      ? "当前内容具备商业展示与转化潜力，建议围绕案例、结果和服务说明重构成更清晰的商业表达。"
      : "当前内容具备继续放大的基础，建议先强化开场钩子、平台适配和转化动作，再进入系列化发布。",
  };
}

function formatBackfillIntervalLabel(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

async function generateKlingBeijingVideo(params: {
  prompt: string;
  imageUrl?: string;
  aspectRatio: "16:9" | "9:16";
  negativePrompt?: string;
}): Promise<{ videoUrl: string; mimeType: string; jobId: string | null }> {
  const { configureKlingClient, parseKeysFromEnv, createOmniVideoTask, getOmniVideoTask, buildT2VRequest, buildI2VRequest } = await import("./kling");
  const keys = parseKeysFromEnv();
  if (keys.length === 0) {
    throw new Error("kling_beijing unavailable: Kling API keys not configured");
  }
  configureKlingClient(keys, "cn");

  const request = params.imageUrl
    ? buildI2VRequest({
        prompt: params.prompt,
        imageUrl: params.imageUrl,
        aspectRatio: params.aspectRatio,
        mode: "pro",
        negativePrompt: params.negativePrompt,
        duration: "5",
      })
    : buildT2VRequest({
        prompt: params.prompt,
        aspectRatio: params.aspectRatio,
        mode: "pro",
        negativePrompt: params.negativePrompt,
        duration: "5",
      });

  const created = await createOmniVideoTask(request, "cn");
  if (!created.task_id) {
    throw new Error("kling_beijing failed: task creation returned no task id");
  }

  const timeoutMs = 90_000;
  const pollMs = 5_000;
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await new Promise(resolve => setTimeout(resolve, pollMs));
    const task = await getOmniVideoTask(created.task_id, "cn");
    if (task.task_status === "succeed") {
      const videoUrl = task.task_result?.videos?.[0]?.url;
      if (!videoUrl) {
        throw new Error("kling_beijing succeeded but no video URL returned");
      }
      return {
        videoUrl,
        mimeType: "video/mp4",
        jobId: created.task_id,
      };
    }
    if (task.task_status === "failed") {
      throw new Error(task.task_status_msg || "kling_beijing video generation failed");
    }
  }

  throw new Error("kling_beijing video generation timeout");
}


function resolveImageUrlForVertexFetch(imageUrl: string): string {
  const u = String(imageUrl || "").trim();
  if (!u) return u;
  if (u.startsWith("data:") || u.startsWith("http://") || u.startsWith("https://")) return u;
  const base = String(process.env.OAUTH_SERVER_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  if (u.startsWith("/") && base) return `${base}${u}`;
  return u;
}

export const appRouter = router({
  // if you need to use socket.io, read and register route in server/_core/index.ts, all api should start with '/api/' so that the gateway can route correctly
  system: systemRouter,
  usage: usageRouter,
  phone: phoneRouter,
  student: studentRouter,
  payment: paymentRouter,
  betaCode: betaCodeRouter,
  feedback: feedbackRouter,
  inviteApply: inviteApplyRouter,
  staticPay: staticPayRouter,
  education: educationRouter,
  emailAuth: emailAuthRouter,
  beta: betaRouter,
  emailOtp: emailOtpRouter,
  stripe: stripeRouter,
  team: teamRouter,
  videoSubmission: videoSubmissionRouter,
  nanoBanana: nanoBananaRouter,
  showcase: showcaseRouter,
  kling: klingRouter,
  hunyuan3d: hunyuan3dRouter,
  suno: sunoRouter,
  creations: creationsRouter,
  workflow: workflowRouter,
  // phoneOtp: phoneOtpRouter, // 暂不上线，等短信服务开通后取消注释
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // Delete session from database
      const authHeader = ctx.req.headers.authorization || ctx.req.headers.Authorization;
      let token: string | undefined;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length).trim();
      }
      const cookieToken = ctx.req.cookies?.[COOKIE_NAME];
      const sessionToken = token || cookieToken;
      if (sessionToken) {
        await sessionDb.deleteSessionByToken(sessionToken);
      }

      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return {
        success: true,
      } as const;
    }),
  }),

  mvReviews: router({
    // Submit a new review for an MV (public, no auth required)
    submit: publicProcedure
      .input(
        z.object({
          mvId: z.string().min(1).max(64),
          nickname: z.string().min(1, "请输入暱称").max(100),
          rating: z.number().int().min(1).max(5),
          comment: z.string().min(1, "请输入评论").max(2000),
        })
      )
      .mutation(async ({ input }) => {
        const id = await db.createMvReview({
          mvId: input.mvId,
          nickname: input.nickname,
          rating: input.rating,
          comment: input.comment,
        });
        return { success: true, id };
      }),

    // Get reviews for a specific MV
    list: publicProcedure
      .input(z.object({ mvId: z.string().min(1), limit: z.number().min(1).max(100).default(20) }))
      .query(async ({ input }) => {
        return db.getMvReviews(input.mvId, input.limit);
      }),

    // Get rating stats for a specific MV
    stats: publicProcedure
      .input(z.object({ mvId: z.string().min(1) }))
      .query(async ({ input }) => {
        return db.getMvRatingStats(input.mvId);
      }),
  }),

  // Video PK Rating - upload video frame and get AI analysis
  mvAnalysis: router({
    analyzeFrame: publicProcedure
      .input(z.object({
        imageBase64: z.string().min(1),
        mimeType: z.string().default("image/jpeg"),
        context: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Upload the frame to S3 first
        const buffer = Buffer.from(input.imageBase64, "base64");
        const { url: frameUrl } = await storagePut(
          `analysis/${Date.now()}.jpg`,
          buffer,
          input.mimeType
        );

        // Use LLM to analyze the frame
        try {
          const response = await invokeLLM({
            messages: [
              {
                role: "system",
                content: `你是一位专业的视频视觉分析师。请分析这张视频画面截屏，从以下维度给出评分和建议：
1. 构图评分 (1-100)
2. 色彩运用评分 (1-100)
3. 光影效果评分 (1-100)
4. 整体视觉冲击力评分 (1-100)
5. 爆款潜力评分 (1-100)
6. 优点分析（2-3 点）
7. 改进建议（2-3 点）
8. 适合的发布平台推荐

请用 JSON 格式回复：
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
}`
              },
              {
                role: "user",
                content: [
                  { type: "text", text: input.context || "请分析这张视频画面" },
                  { type: "image_url", image_url: { url: frameUrl } }
                ]
              }
            ],
            response_format: { type: "json_object" }
          });

          const analysis = JSON.parse(response.choices[0].message.content as string);
          return {
            success: true,
            analysis,
            frameUrl,
            debug: {
              route: "analyzeFrame",
              provider: response.provider || "unknown",
              model: response.model || "unknown",
              fallback: false,
            },
          };
        } catch (error) {
          console.warn("[mvAnalysis.analyzeFrame] Falling back to deterministic analysis:", error);
          return {
            success: true,
            analysis: buildFallbackFrameAnalysis(input.context),
            frameUrl,
            fallback: true,
            debug: {
              route: "analyzeFrame",
              provider: "fallback",
              model: "deterministic",
              fallback: true,
            },
          };
        }
      }),

    analyzeDocument: publicProcedure
      .input(z.object({
        fileBase64: z.string().min(1),
        mimeType: z.string().min(1),
        fileName: z.string().optional(),
        context: z.string().optional(),
        modelName: growthCampModelSchema.optional(),
        mode: growthAnalysisModeSchema.default("GROWTH"),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── 扣費邏輯：每次分析扣除對應積分 ──────────────────────────────
        if (ctx.user?.id) {
          const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
          if (!isAdminUser) {
            const mode = input.mode || "GROWTH";
            const creditKey = mode === "REMIX" ? "growthCampRemix" : "growthCampGrowth";
            const cost = CREDIT_COSTS[creditKey];
            const creditsInfo = await getCredits(ctx.user.id);
            if (creditsInfo.totalAvailable < cost) {
              throw new Error(
                `Credits 不足，${mode === "REMIX" ? "二創分析" : "成長營分析"}需要 ${cost} Credits（當前餘額：${creditsInfo.totalAvailable}）`
              );
            }
            await deductCredits(
              ctx.user.id,
              creditKey,
              `創作者成長營 ${mode} 分析（文件）`
            );
          }
        } else {
          throw new Error("請先登入，才能使用分析功能");
        }
        const result = await analyzeDocument(input);
        return {
          success: true,
          analysis: result.analysis,
          fileUrl: result.documentMeta.fileUrl,
          extractionMethod: result.documentMeta.extractionMethod,
          extractedTextPreview: result.documentMeta.extractedTextPreview,
          debug: {
            route: "analyzeDocument",
            provider: result.documentMeta.provider,
            model: result.documentMeta.model,
            fallback: result.documentMeta.fallback,
            extractionMethod: result.documentMeta.extractionMethod,
          },
        };
      }),

    getVideoUploadSignedUrl: publicProcedure
      .input(z.object({
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        return createGcsSignedUploadUrl({
          fileName: input.fileName,
          contentType: input.mimeType,
        });
      }),

    analyzeVideo: publicProcedure
      .input(z.object({
        gcsUri: z.string().optional(),
        fileBase64: z.string().optional(),
        fileUrl: z.string().optional(),
        fileKey: z.string().optional(),
        mimeType: z.string().min(1),
        fileName: z.string().optional(),
        context: z.string().optional(),
        modelName: growthCampModelSchema.optional(),
        forceRefresh: z.boolean().optional().default(false),
      }))
      .mutation(async ({ input }) => {
        const result = await analyzeVideo(input);
        return {
          success: true,
          analysis: result.analysis,
          videoUrl: result.videoMeta.videoUrl,
          transcript: result.videoMeta.transcript,
          videoDuration: result.videoMeta.videoDuration,
          debug: {
            route: "analyzeVideo",
            provider: result.videoMeta.provider,
            model: result.videoMeta.model,
            fallback: result.videoMeta.fallback,
            transcriptChars: result.videoMeta.transcript.length,
            videoDuration: result.videoMeta.videoDuration,
            failureStage: result.videoMeta.failureStage || null,
            failureReason: result.videoMeta.failureReason || null,
          },
        };
      }),

    buildPremiumRemix: publicProcedure
      .input(z.object({
        context: z.string().optional(),
        transcript: z.string().optional(),
        analysis: growthAnalysisScoresSchema.optional(),
        modelName: growthCampModelSchema.optional(),
        titleExecutions: z.array(growthTitleExecutionSchema).optional(),
        assetAdaptation: growthAssetAdaptationSchema.optional(),
        growthHandoff: growthHandoffSchema.optional(),
        creationStoryboardPrompt: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const fallbackAnalysis = input.analysis || {
          composition: 0, color: 0, lighting: 0, impact: 0, viralPotential: 0,
          explosiveIndex: 0, realityCheck: "",
          reverseEngineering: { hookStrategy: "", emotionalArc: "", commercialLogic: "" },
          premiumContent: { summary: "", strategy: "", actionableTopics: [], topics: [], explosiveTopicAnalysis: "", musicAndExpressionAnalysis: "", remixVisualAnalysis: "", remixExpressionAnalysis: "", musicPrompt: "" },
          visualSummary: "", openingFrameAssessment: "", sceneConsistency: "",
          languageExpression: "", emotionalExpression: "", cameraEmotionTension: "",
          bgmAnalysis: "", musicRecommendation: "", sunoPrompt: "",
          trustSignals: [], visualRisks: [], keyFrames: [], strengths: [], improvements: [], platforms: [], summary: "", titleSuggestions: [], creatorCenterSignals: [], timestampSuggestions: [], weakFrameReferences: [], commercialAngles: [], followUpPrompt: ""
        };
        const requestedPlatforms = normalizePlatforms(fallbackAnalysis.platforms);
        const store = await readTrendStore({ preferDerivedFiles: true }).catch(() => null);
        const userEvidence = ctx.user ? await readGrowthUserEvidence(ctx.user.id, requestedPlatforms).catch(() => null) : null;
        const remixEvidence = await (async () => {
          if (!store) return null;
          const historicalPlatformTotals = Object.fromEntries(
            requestedPlatforms.map((platform) => [
              platform,
              {
                currentTotal: Number(store.collections?.[platform]?.items?.length || 0),
                archivedTotal: Number(store.history?.platforms?.[platform]?.archivedItems || 0),
              },
            ]),
          ) as Partial<Record<typeof requestedPlatforms[number], { currentTotal?: number; archivedTotal?: number }>>;
          const hasAnyLiveCollection = requestedPlatforms.some((platform) => (store.collections?.[platform]?.items?.length || 0) > 0);
          const baseSnapshot = hasAnyLiveCollection
            ? buildGrowthSnapshotFromCollections({
                analysis: fallbackAnalysis,
                context: input.context,
                requestedPlatforms,
                collections: store.collections,
                historicalPlatformTotals,
                errors: {},
              })
            : buildMockGrowthSnapshot({
                analysis: fallbackAnalysis,
                context: input.context,
                requestedPlatforms,
                historicalPlatformTotals,
              });
          const effectiveStore = {
            ...store,
            collections: store.collections,
          };
          const personalized = await personalizeGrowthSnapshot({
            snapshot: baseSnapshot,
            analysis: fallbackAnalysis,
            context: input.context,
            requestedPlatforms,
            modelName: input.modelName,
            store: effectiveStore,
            userEvidence,
          }).catch((error) => {
            console.warn("[growth.buildPremiumRemix] personalization fallback:", error);
            return null;
          });

          return {
            source: baseSnapshot.status.source,
            liveSummary: baseSnapshot.analysisTracks?.liveSummary || "",
            historicalSummary: baseSnapshot.analysisTracks?.historicalSummary || "",
            hotTopic: baseSnapshot.analysisTracks?.liveHotTopic || "",
            recommendationReason: baseSnapshot.dataAnalystSummary?.recommendationReason || "",
            personalizedOverview: personalized ? {
              summary: personalized.overview?.summary || "",
              trendNarrative: personalized.overview?.trendNarrative || "",
              nextCollectionPlan: personalized.overview?.nextCollectionPlan || "",
            } : undefined,
            decisionFramework: personalized ? {
              recommendedFormat: personalized.decisionFramework?.assetAdaptation?.format || "",
              mainPathTitle: personalized.decisionFramework?.mainPath?.title || "",
              mainPathWhyNow: personalized.decisionFramework?.mainPath?.whyNow || "",
              mainPathExecution: personalized.decisionFramework?.mainPath?.nextAction || "",
              avoidPathTitle: personalized.decisionFramework?.avoidPaths?.[0]?.title || "",
              avoidPathReason: personalized.decisionFramework?.avoidPaths?.[0]?.reason || "",
              assetAdaptation: personalized.decisionFramework?.assetAdaptation,
            } : undefined,
            platformRows: (baseSnapshot.dataAnalystSummary?.platformRows || []).slice(0, 4).map((item) => ({
              platformLabel: item.platformLabel,
              currentTotal: item.currentTotal,
              archivedTotal: item.archivedTotal,
              note: item.note || "",
            })),
            platformSnapshots: (baseSnapshot.platformSnapshots || []).slice(0, 4).map((item) => ({
              platformLabel: item.displayName,
              summary: item.summary,
              fitLabel: item.fitLabel,
              sampleTopics: item.sampleTopics.slice(0, 3),
              recommendedFormats: item.recommendedFormats.slice(0, 2),
            })),
            topicLibrary: (baseSnapshot.topicLibrary || []).slice(0, 6).map((item) => ({
              platformLabel: item.platformLabel,
              title: item.title,
              rationale: item.rationale,
            })),
            platformRecommendations: (personalized?.platformRecommendations || []).slice(0, 4).map((item) => ({
              platformLabel: item.name,
              strategy: item.playbook,
              action: item.action,
              reason: item.reason,
            })),
            businessInsights: (personalized?.businessInsights || []).slice(0, 4).map((item) => ({
              title: item.title,
              detail: item.detail,
            })),
            growthPlan: (personalized?.growthPlan || []).slice(0, 4).map((item) => ({
              title: `Day ${item.day} ${item.title}`,
              nextStep: item.action,
            })),
            referenceExamples: (personalized?.dashboardConsole?.referenceExamples || []).slice(0, 4).map((item) => ({
              title: `${item.platformLabel} / ${item.account} / ${item.title}`,
              reason: item.reason,
            })),
            authorSummary: personalized?.authorAnalysis
              ? [
                  personalized.authorAnalysis.identity?.tierReason,
                  personalized.authorAnalysis.identity?.identityTags?.join("、"),
                  personalized.authorAnalysis.identity?.verticalCategory,
                  personalized.authorAnalysis.monetizationValue?.recommendedPaths?.[0]?.reason,
                ].filter(Boolean).join("；")
              : "",
            userEvidence: userEvidence ? {
              strongestPlatforms: userEvidence.strongestPlatforms,
              recurringThemes: userEvidence.recurringThemes,
              summaryNote: userEvidence.summaryNote,
            } : null,
            personalized,
          };
        })();

        const result = await buildPremiumRemixPlan({
          context: input.context,
          transcript: input.transcript,
          analysis: fallbackAnalysis,
          modelName: input.modelName,
          titleExecutions: input.titleExecutions?.length
            ? input.titleExecutions
            : remixEvidence?.personalized?.titleExecutions,
          assetAdaptation: input.assetAdaptation
            || remixEvidence?.personalized?.decisionFramework?.assetAdaptation,
          growthHandoff: input.growthHandoff
            || remixEvidence?.personalized?.growthHandoff,
          creationStoryboardPrompt: input.creationStoryboardPrompt
            || remixEvidence?.personalized?.creationAssist?.storyboardPrompt,
          dataEvidence: remixEvidence
            ? {
                source: remixEvidence.source,
                liveSummary: remixEvidence.liveSummary,
                historicalSummary: remixEvidence.historicalSummary,
                hotTopic: remixEvidence.hotTopic,
                recommendationReason: remixEvidence.recommendationReason,
                personalizedOverview: remixEvidence.personalizedOverview,
                decisionFramework: remixEvidence.decisionFramework,
                platformRows: remixEvidence.platformRows,
                platformSnapshots: remixEvidence.platformSnapshots,
                topicLibrary: remixEvidence.topicLibrary,
                platformRecommendations: remixEvidence.platformRecommendations,
                businessInsights: remixEvidence.businessInsights,
                growthPlan: remixEvidence.growthPlan,
                referenceExamples: remixEvidence.referenceExamples,
                authorSummary: remixEvidence.authorSummary,
                userEvidence: remixEvidence.userEvidence,
              }
            : undefined,
        });
        return {
          success: true,
          remix: growthPremiumRemixSchema.parse(result.remix),
          debug: {
            route: "mvAnalysis.buildPremiumRemix",
            personalizedApplied: Boolean(remixEvidence?.personalized),
            ...result.debug,
          },
        };
      }),

    generatePremiumRemixAssets: publicProcedure
      .input(z.object({
        remix: growthPremiumRemixSchema,
        mode: z.enum(["loop", "interpolation"]).default("loop"),
      }))
      .mutation(async ({ input }) => {
        const result = await generatePremiumRemixAssets({
          remix: input.remix,
          mode: input.mode,
        });
        return {
          success: true,
          assets: growthPremiumRemixAssetsSchema.parse(result.assets),
          debug: {
            route: "mvAnalysis.generatePremiumRemixAssets",
            ...result.debug,
          },
        };
      }),

    getGrowthSnapshot: publicProcedure
      .input(z.object({
        context: z.string().optional(),
        requestedPlatforms: z.array(z.string()).optional(),
        analysis: growthAnalysisScoresSchema,
        modelName: growthCampModelSchema.optional(),
        windowDays: z.union([z.literal(15), z.literal(30), z.literal(45)]).optional(),
        interactivePlatform: z.boolean().optional(),
      }))
      .query(async ({ input, ctx }) => {
        const t0 = Date.now();
        const timing: Record<string, number> = {};
        const requestedPlatforms = normalizePlatforms(input.requestedPlatforms || input.analysis.platforms);
        const selectedWindowDays = Number(input.windowDays || 30);
        const interactivePlatform = Boolean(input.interactivePlatform);
        // Fly disk I/O for readTrendStoreForPlatforms can take 12-25s — give it 60s
        // Previous values of 5s/10s/20s/45s were all cutting off the read before completion
        const STORE_TIMEOUT_MS = PLATFORM_LLM_TIMEOUT_MS;
        const storeNull = { collections: {}, history: null, backfill: null } as unknown as Awaited<ReturnType<typeof readTrendStore>>;
        const store = await Promise.race([
          interactivePlatform
            ? readTrendStoreForPlatforms(requestedPlatforms, { preferDerivedFiles: true })
            : readTrendStore({ preferDerivedFiles: true }),
          new Promise<Awaited<ReturnType<typeof readTrendStore>>>((resolve) => {
            setTimeout(() => {
                  console.warn(`[platform.getGrowthSnapshot] 趋势数据读取超时，已等待 ${STORE_TIMEOUT_MS}ms，改用空数据`);
              resolve(storeNull);
            }, STORE_TIMEOUT_MS);
          }),
        ]);
        timing.storeMs = Date.now() - t0;
        console.log(`[platform.getGrowthSnapshot] store read done in ${timing.storeMs}ms`);
        // Phase 0-B: Guard readGrowthUserEvidence against slow DB connections
        const USER_EVIDENCE_TIMEOUT_MS = 3_000;
        const userEvidence = ctx.user
          ? await Promise.race([
              readGrowthUserEvidence(ctx.user.id, requestedPlatforms),
              new Promise<null>((resolve) => setTimeout(() => resolve(null), USER_EVIDENCE_TIMEOUT_MS)),
            ]).catch(() => null)
          : null;
        timing.userEvidenceMs = Date.now() - t0 - timing.storeMs;
        const historicalPlatformTotals = Object.fromEntries(
          requestedPlatforms.map((platform) => [
            platform,
            {
              currentTotal: Number(store.collections?.[platform]?.items?.length || 0),
              archivedTotal: Number(store.history?.platforms?.[platform]?.archivedItems || 0),
            },
          ]),
        ) as Partial<Record<typeof requestedPlatforms[number], { currentTotal?: number; archivedTotal?: number }>>;
        const stalePlatforms = requestedPlatforms.filter((platform) =>
          isTrendCollectionStale(store.collections[platform]?.collectedAt, 6),
        );

        const collections = store.collections;
        const errors: Partial<Record<typeof requestedPlatforms[number], string>> = {};
        const effectiveStore = {
          ...store,
          collections,
        };

        const hasAnyLiveCollection = requestedPlatforms.some((platform) => collections[platform]?.items.length);
        // For interactivePlatform (Platform page): require real data — never use mock
        if (interactivePlatform && !hasAnyLiveCollection) {
          throw new TRPCError({
            code: "SERVICE_UNAVAILABLE",
            message: "平台数据尚未就绪，请稍后再试。当前窗口内没有可用的实时平台样本。",
          });
        }
        const baseSnapshot = hasAnyLiveCollection
          ? buildGrowthSnapshotFromCollections({
              analysis: input.analysis,
              context: input.context,
              requestedPlatforms,
              collections,
              historicalPlatformTotals,
              errors,
              windowDaysOverride: selectedWindowDays,
            })
          : buildMockGrowthSnapshot({
              analysis: input.analysis,
              context: input.context,
              requestedPlatforms,
              historicalPlatformTotals,
              windowDaysOverride: selectedWindowDays,
            });
        const t1 = Date.now();
        // For interactivePlatform (Platform page): skip personalization entirely.
        // buildPlatformDashboard already receives context and personalizes output there.
        // Adding a separate personalization LLM call adds 45-90s with no visible user benefit.
        // For Growth Camp (interactivePlatform=false): run full personalization as before.
        const PERSONALIZATION_TIMEOUT_MS = interactivePlatform ? 0 : PLATFORM_LLM_TIMEOUT_MS;
        const personalized = interactivePlatform
          ? null
          : await Promise.race([
              personalizeGrowthSnapshot({
                snapshot: baseSnapshot,
                analysis: input.analysis,
                context: input.context,
                requestedPlatforms,
                modelName: input.modelName,
                store: effectiveStore,
                userEvidence,
                windowDays: selectedWindowDays,
              }),
              new Promise<null>((resolve) => {
                setTimeout(() => {
                  console.warn(`[platform.getGrowthSnapshot] 个性化分析超时，已等待 ${PERSONALIZATION_TIMEOUT_MS}ms`);
                  resolve(null);
                }, PERSONALIZATION_TIMEOUT_MS);
              }),
            ]).catch((error) => {
              console.warn("[growth.getGrowthSnapshot] personalization fallback:", error);
              return null;
            });
        timing.personalizationMs = Date.now() - t1;
        console.log(`[platform.getGrowthSnapshot] personalization done in ${timing.personalizationMs}ms (skipped=${interactivePlatform})`);
        const dataEvidenceNotes = buildGrowthDataEvidenceNotes({
          requestedPlatforms,
          store: effectiveStore,
          userEvidence,
        });
        const snapshot = personalized
          ? growthSnapshotSchema.parse({
              ...baseSnapshot,
              overview: personalized.overview,
              monetizationTracks: personalized.monetizationTracks,
              platformRecommendations: personalized.platformRecommendations,
              titleExecutions: personalized.titleExecutions?.length ? personalized.titleExecutions : baseSnapshot.titleExecutions,
              platformActivities: personalized.platformActivities?.length ? personalized.platformActivities : baseSnapshot.platformActivities,
              monetizationStrategies: personalized.monetizationStrategies?.length ? personalized.monetizationStrategies : baseSnapshot.monetizationStrategies,
              dataLibraryStructure: personalized.dataLibraryStructure?.length ? personalized.dataLibraryStructure : baseSnapshot.dataLibraryStructure,
              businessInsights: personalized.businessInsights,
              decisionFramework: personalized.decisionFramework,
              dashboardConsole: personalized.dashboardConsole,
              growthPlan: personalized.growthPlan,
              creationAssist: personalized.creationAssist,
              growthHandoff: personalized.growthHandoff,
              authorAnalysis: personalized.authorAnalysis ?? baseSnapshot.authorAnalysis,
              status: {
                ...baseSnapshot.status,
                notes: [
                  ...baseSnapshot.status.notes,
                  ...(stalePlatforms.length
                    ? [`部分平台数据仍在后台补位中：${stalePlatforms.join("、")}。本次先基于已沉淀数据生成结果，不阻塞报告返回。`]
                    : []),
                  ...dataEvidenceNotes,
                  ...personalized.statusNotes,
                ].slice(0, 16),
              },
            })
          : growthSnapshotSchema.parse({
              ...baseSnapshot,
              status: {
                ...baseSnapshot.status,
                notes: [
                  ...baseSnapshot.status.notes,
                  ...(stalePlatforms.length
                    ? [`部分平台数据仍在后台补位中：${stalePlatforms.join("、")}。本次先基于已沉淀数据生成结果，不阻塞报告返回。`]
                    : []),
                  ...dataEvidenceNotes,
                ].slice(0, 16),
              },
            });

        const platformDashboardSource = snapshot;
        const t2 = Date.now();
        // For interactivePlatform (Platform page): skip dashboard here — it is called separately
        // via getPlatformDashboard mutation to avoid one giant 100s+ request
        const DASHBOARD_TIMEOUT_MS = interactivePlatform ? 0 : PLATFORM_LLM_TIMEOUT_MS;
        const platformDashboard = interactivePlatform
          ? null
          : await Promise.race([
              buildPlatformDashboard({
                snapshot: platformDashboardSource,
                context: input.context,
                requestedPlatforms,
                store: effectiveStore,
                windowDays: selectedWindowDays,
              }),
              new Promise<z.infer<typeof platformDashboardResponseSchema>>((resolve) => {
                setTimeout(() => {
                  console.warn(`[platform.getGrowthSnapshot] 平台看板生成超时，已等待 ${DASHBOARD_TIMEOUT_MS}ms，改用兜底结果`);
                  resolve(buildFallbackPlatformDashboard({
                    snapshot: platformDashboardSource,
                    context: input.context,
                    windowDays: selectedWindowDays,
                  }));
                }, DASHBOARD_TIMEOUT_MS);
              }),
            ]).catch((error) => {
              console.warn("[growth.getGrowthSnapshot] platform dashboard fallback:", error);
              return buildFallbackPlatformDashboard({
                snapshot: platformDashboardSource,
                context: input.context,
                windowDays: selectedWindowDays,
              });
            });
        timing.dashboardMs = Date.now() - t2;
        const totalMs = Date.now() - t0;
        console.log(`[platform.getGrowthSnapshot] dashboard done in ${timing.dashboardMs}ms | total=${totalMs}ms | personalization=${timing.personalizationMs}ms | store=${timing.storeMs}ms`);

        return {
          success: true,
          source: snapshot.status.source,
          snapshot,
          platformDashboard,
          debug: {
            route: "mvAnalysis.getGrowthSnapshot",
            modelName: resolveGrowthCampFinalModel(input.modelName),
            requestedPlatforms,
            stalePlatforms,
            hasAnyLiveCollection,
            personalizedApplied: Boolean(personalized),
            userEvidenceApplied: Boolean(userEvidence),
            selectedWindowDays,
            interactivePlatform,
            skippedPersonalization: false,
            skippedPlatformDashboard: false,
            baseSource: baseSnapshot.status.source,
            finalSource: snapshot.status.source,
            windowDays: snapshot.status.windowDays,
            notesCount: snapshot.status.notes.length,
            trendLayerCount: snapshot.trendLayers.length,
            topicLibraryCount: snapshot.topicLibrary.length,
            platformSnapshotCount: snapshot.platformSnapshots.length,
            monetizationTrackCount: snapshot.monetizationTracks.length,
            recommendationCount: snapshot.platformRecommendations.length,
            businessInsightCount: snapshot.businessInsights.length,
            growthPlanCount: snapshot.growthPlan.length,
            creationAssetExtensionCount: snapshot.creationAssist.assetExtensions.length,
            timing,
            totalMs: Date.now() - t0,
          },
        };
      }),

    askPlatformFollowUp: publicProcedure
      .input(z.object({
        question: z.string().min(3).max(1200),
        context: z.string().optional(),
        windowDays: z.union([z.literal(15), z.literal(30), z.literal(45)]),
        snapshot: growthSnapshotSchema,
      }))
      .mutation(async ({ ctx, input }) => {
        if (ctx.user?.id) {
          const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
          // 试用包用户不支持趋势续分析
          const isTrial = !isAdminUser && (await resolveWatermark(ctx.user.id, isAdminUser));
          if (isTrial) {
            throw new Error("試用包不支持趋势续分析，请升级至正式方案後使用。");
          }

          const drizzleDb = await import("./db").then(m => m.getDb());
          let isFreeThisTime = false;
          if (drizzleDb) {
            // 正式包每日首次趋势续分析免费，之后每次扣 platformTrendFollowUp（6 cr）
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0);
            const [todayRecord] = await drizzleDb
              .select({ id: stripeUsageLogs.id })
              .from(stripeUsageLogs)
              .where(
                and(
                  eq(stripeUsageLogs.userId, ctx.user.id),
                  eq(stripeUsageLogs.action, "platformTrendFollowUp"),
                  gte(stripeUsageLogs.createdAt, todayStart),
                )
              )
              .limit(1);
            isFreeThisTime = !todayRecord;
          }
          if (!isFreeThisTime) {
            await deductCredits(
              ctx.user.id,
              "platformTrendFollowUp",
              `平台趋势续分析 (${input.windowDays}天 / Gemini 3.1 Pro)`,
            );
          }
        }
        try {
          const response = await invokeLLM({
            // Vertex 3.1 Pro Preview for platform follow-up QA
            provider: "vertex",
            modelName: "gemini-3.1-pro-preview",
            messages: [
              {
                role: "system",
                content: `你是一位专业、克制、会直接给判断的平台策略顾问，也会把策略翻成用户马上能开拍、开写、开卖的动作。

你的任务是基于用户当前选中的平台趋势看板，回答后续追问。

要求：
1. 回答必须专业，但语气要有温度，像一个成熟顾问在帮用户梳理方向。
2. 第一段必须先给出明确判断，不要先铺垫，不要两边都说。
3. answer 必须明显分成三个部分：结论、为什么、下一步怎么做。可以用自然段，不要写成模板编号。
4. 如果用户问“从哪些平台入手”“怎么实现商业价值”这类问题，必须明确给出优先顺序、适合承接的商业方向，以及短期不建议投入的方向。
5. 如果问题涉及选题、文案、图文、视频、脚本、拍法，你必须写出具体方案，至少覆盖：题目方向、开头怎么说、结构怎么排、视频怎么拍或图文怎么写。
6. 如果 snapshot 里已经有 titleExecutions、creationAssist、monetizationStrategies、decisionFramework，要优先把这些证据翻译成“这个用户现在就能执行”的动作，而不是继续抽象分析。
7. 变现路径只能保留和这个用户身份、内容方向、平台表达直接相关的 1 到 3 条。不要把带货、课程、咨询、社群、品牌合作全部列一遍。
8. 如果用户背景是专业身份和文化审美内容的结合，就优先写与信任、解释力、审美内容承接有关的路径，而不是默认带货。
9. 不要泄露后台工程逻辑，不要出现 fallback、live sample、historical、verify、数据库、覆盖率、补位、主链、样本裂缝 这类内部词。
10. 只能围绕用户当前选中的 ${input.windowDays} 天窗口来回答。
11. 回答必须明显带入用户当前问题和关注点，不能输出放在哪个用户身上都成立的套话。
12. 不要把平台介绍或平台画像原样搬给用户，要把后台证据翻译成前台可执行结论。
13. encouragement 必须是一句短的执行提醒，不要像客服安慰。
14. nextQuestions 要像真人顾问会继续往下问的具体问题，最多 4 个。
15. 输出严格 JSON，字段为 title、answer、encouragement、nextQuestions。`,
              },
              {
                role: "user",
                content: JSON.stringify({
                  windowDays: input.windowDays,
                  context: input.context || "",
                  question: input.question,
                  // Phase 1-C: Slim snapshot to reduce Gemini token usage for follow-up calls
                  snapshot: {
                    overview: input.snapshot.overview,
                    platformSnapshots: input.snapshot.platformSnapshots.slice(0, 4).map((item) => ({
                      platform: item.platform,
                      displayName: item.displayName,
                      audienceFitScore: item.audienceFitScore,
                      momentumScore: item.momentumScore,
                      summary: item.summary,
                      fitLabel: item.fitLabel,
                    })),
                    platformRecommendations: input.snapshot.platformRecommendations.slice(0, 3),
                    topicLibrary: input.snapshot.topicLibrary.slice(0, 5),
                    businessInsights: input.snapshot.businessInsights.slice(0, 3),
                    growthPlan: input.snapshot.growthPlan.slice(0, 2),
                    titleExecutions: input.snapshot.titleExecutions.slice(0, 3),
                    monetizationStrategies: input.snapshot.monetizationStrategies.slice(0, 2),
                    decisionFramework: {
                      mainPath: input.snapshot.decisionFramework.mainPath,
                      validationPlan: input.snapshot.decisionFramework.validationPlan.slice(0, 2),
                      assetAdaptation: input.snapshot.decisionFramework.assetAdaptation,
                    },
                    creationAssist: {
                      brief: input.snapshot.creationAssist.brief,
                    },
                  },
                }),
              },
            ],
          });
          // Gemini sometimes wraps JSON in ```json``` fences — extract robustly
          const rawFollowUpContent = String(response.choices[0]?.message?.content || "{}");
          let parsedFollowUpRaw: unknown;
          try {
            parsedFollowUpRaw = JSON.parse(rawFollowUpContent);
          } catch {
            const match = rawFollowUpContent.match(/```(?:json)?\s*([\s\S]+?)```/);
            try {
              parsedFollowUpRaw = match ? JSON.parse(match[1].trim()) : {};
            } catch {
              parsedFollowUpRaw = {};
            }
          }
          const parsed = platformFollowUpResponseSchema.parse(parsedFollowUpRaw);
          return {
            success: true,
            result: parsed,
            debug: {
              route: "mvAnalysis.askPlatformFollowUp",
              modelName: "gemini-2.5-pro",
              windowDays: input.windowDays,
              fallbackUsed: false,
            },
          };
        } catch (error) {
          console.warn("[growth.askPlatformFollowUp] fallback:", error);
          return {
            success: true,
            result: buildPlatformFollowUpFallback(input),
            debug: {
              route: "mvAnalysis.askPlatformFollowUp",
              modelName: "gemini-2.5-pro",
              windowDays: input.windowDays,
              fallbackUsed: true,
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      }),

    // ─────────────────────────────────────────────────────────────────────────
    // Platform Analysis Job — async queue architecture
    // createPlatformAnalysisJob: creates a queued job record, returns jobId
    // immediately, then runs buildPlatformDashboard + buildPlatformContent in
    // the background and writes the result to the DB via markJobSucceeded.
    // Frontend polls GET /api/jobs/:id every 3 seconds.
    // ─────────────────────────────────────────────────────────────────────────
    createPlatformAnalysisJob: publicProcedure
      .input(z.object({
        context: z.string().optional(),
        windowDays: z.number().int().min(3).max(90).default(15),
        requestedPlatforms: z.array(z.string()).default(["douyin", "xiaohongshu", "bilibili", "kuaishou"]),
        snapshotSummary: z.record(z.string(), z.any()).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── 扣費：每次平台數據分析扣 platformTrend（50 cr）─────────────────
        if (ctx.user?.id) {
          const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
          if (!isAdminUser) {
            const cost = CREDIT_COSTS["platformTrend"];
            const creditsInfo = await getCredits(ctx.user.id);
            if (creditsInfo.totalAvailable < cost) {
              throw new Error(
                `Credits 不足，平台數據分析需要 ${cost} Credits（當前餘額：${creditsInfo.totalAvailable}）`
              );
            }
            await deductCredits(ctx.user.id, "platformTrend", `平台數據分析（${input.windowDays}天窗口）`);
          }
        } else {
          throw new Error("請先登入，才能使用平台數據分析功能");
        }

        const jobId = nanoid(16);
        await createJobRecord({
          id: jobId,
          userId: String(ctx.user.id),
          type: "platform",
          provider: "vertex",
          input: {
            action: "platform_analysis",
            params: {
              context: input.context,
              windowDays: input.windowDays,
              requestedPlatforms: input.requestedPlatforms,
              snapshotSummary: input.snapshotSummary ?? {},
            },
          },
        });

        return { jobId, status: "queued" };
      }),

    // Platform Follow-Up (QA) Job — same async pattern
    createPlatformQAJob: publicProcedure
      .input(z.object({
        question: z.string().min(1),
        windowDays: z.number().int().min(3).max(90).default(15),
        snapshot: z.record(z.string(), z.any()),
        context: z.string().optional(),
        // Optional: gs:// URI of a file uploaded via /api/platform/upload for multimodal QA
        fileUri: z.string().optional(),
        fileMimeType: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const jobId = nanoid(16);
        await createJobRecord({
          id: jobId,
          userId: "public",
          type: "platform",
          provider: "vertex",
          input: {
            action: "platform_qa",
            params: {
              question: input.question,
              windowDays: input.windowDays,
              snapshot: input.snapshot,
              context: input.context,
              fileUri: input.fileUri,
              fileMimeType: input.fileMimeType,
            },
          },
        });

        // Job is now processed by the Worker (processPlatformJob in runner.ts).
        // No setImmediate here — worker handles platform_qa including fileUri multimodal + GCS cleanup.
        return { jobId, status: "queued" };
      }),

    // Platform-specific PDF download — same as downloadAnalysisPdf but named
    // separately so PlatformPage can use it without touching MVAnalysis routes.
    downloadPlatformPdf: publicProcedure
      .input(z.object({
        html: z.string().min(100),
        token: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const cloudRunUrl = String(process.env.CLOUD_RUN_PDF_URL || "").trim();
        if (!cloudRunUrl) {
          throw new Error("CLOUD_RUN_PDF_URL env var is not set.");
        }
        const proxyUrl = cloudRunUrl.replace(/\/$/, "") + "/generate-pdf";
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 720_000);
        try {
          const res = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ html: input.html, token: input.token ?? "" }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new Error(`pdf-worker returned ${res.status}: ${errBody.slice(0, 200)}`);
          }
          const arrayBuffer = await res.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          return { success: true, pdfBase64: base64 };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error("[downloadPlatformPdf] proxy error:", msg);
          throw new Error(`downloadPlatformPdf failed: ${msg}`);
        } finally {
          clearTimeout(timeoutId);
        }
      }),

    downloadAnalysisPdf: publicProcedure
      .input(z.object({
        html: z.string().min(100),
        // Optional token forwarded from the frontend for auditing / future auth use.
        // In supervisor mode the frontend passes "supervisor"; authenticated users pass
        // their session token. The pdf-worker currently uses page.setContent(html) so
        // no auth session is required, but we preserve the token for future page.goto()
        // scenarios or access-control logging.
        token: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const cloudRunUrl = String(process.env.CLOUD_RUN_PDF_URL || "").trim();
        if (!cloudRunUrl) {
          throw new Error("CLOUD_RUN_PDF_URL env var is not set. Deploy the pdf-worker to Cloud Run and set this variable.");
        }
        const proxyUrl = cloudRunUrl.replace(/\/$/, "") + "/generate-pdf";
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 720_000);
        try {
          const res = await fetch(proxyUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // Forward html + token to pdf-worker so it can use token for future page.goto() auth
            body: JSON.stringify({ html: input.html, token: input.token ?? "" }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const errBody = await res.text().catch(() => "");
            throw new Error(`pdf-worker returned ${res.status}: ${errBody.slice(0, 200)}`);
          }
          const arrayBuffer = await res.arrayBuffer();
          const base64 = Buffer.from(arrayBuffer).toString("base64");
          return { success: true, pdfBase64: base64 };
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          console.error("[downloadAnalysisPdf] proxy error:", msg);
          throw new Error(`downloadAnalysisPdf failed: ${msg}`);
        } finally {
          clearTimeout(timeoutId);
        }
      }),

    recordAnalysisSnapshot: protectedProcedure
      .input(z.object({
        analysisType: z.enum(["growth_camp", "platform"]),
        title: z.string().max(200),
        summary: z.string().max(2000).optional(),
        thumbnailUrl: z.string().url().optional(),
        analysisDate: z.string().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        try {
          const plan = await getUserPlan(ctx.user.id);
          const id = await recordCreation({
            userId: ctx.user.id,
            type: "storyboard",
            title: input.title,
            thumbnailUrl: input.thumbnailUrl,
            metadata: {
              analysisType: input.analysisType,
              summary: input.summary,
              analysisDate: input.analysisDate ?? new Date().toISOString(),
              isSnapshot: true,
            },
            quality: input.analysisType === "growth_camp" ? "成長營分析" : "平台趨勢分析",
            creditsUsed: 0,
            plan,
          });
          return { success: true, id };
        } catch (e) {
          console.error("[recordAnalysisSnapshot] failed:", e);
          return { success: false, id: 0 };
        }
      }),

    generateVisualReport: publicProcedure
      .input(z.object({
        // Extended to support short-form trend radar: 3d and 7d windows
        windowDays: z.enum(["3", "7", "15", "30"]),
        theme: z.enum(["light", "dark"]),
        platforms: z.array(z.enum(["douyin", "kuaishou", "xiaohongshu", "bilibili"])),
      }))
      .mutation(async ({ input }) => {
        const PLATFORM_NAMES: Record<string, string> = {
          douyin: "抖音", kuaishou: "快手", xiaohongshu: "小红书", toutiao: "今日头条",
        };
        const platformListStr = input.platforms.map((p) => PLATFORM_NAMES[p] || p).join("、");

        // Build date anchor — always report on the PAST, never the future
        const nowDate = new Date();
        const todayStr = nowDate.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
        const pastDate = new Date(nowDate.getTime() - Number(input.windowDays) * 24 * 60 * 60 * 1000);
        const pastStr = pastDate.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });

        // Read store data for selected platforms (best-effort, 15s cap)
        const storeNull = { collections: {}, history: null, backfill: null } as unknown as Awaited<ReturnType<typeof readTrendStore>>;
        const store = await Promise.race([
          readTrendStoreForPlatforms(input.platforms as any[], { preferDerivedFiles: true }),
          new Promise<Awaited<ReturnType<typeof readTrendStore>>>((resolve) => setTimeout(() => resolve(storeNull), 15_000)),
        ]).catch(() => storeNull);

        // Build concise evidence from real store data for each platform
        const platformEvidence = input.platforms.map((platform) => {
          const col = (store.collections as any)?.[platform];
          const items: any[] = col?.items || [];
          const windowCutoff = Date.now() - Number(input.windowDays) * 24 * 60 * 60 * 1000;
          const windowItems = items.filter((item: any) => {
            const ts = item?.collectedAt || item?.publishedAt || item?.date || null;
            if (!ts) return true;
            const ms = new Date(String(ts)).getTime();
            return Number.isFinite(ms) && ms >= windowCutoff;
          });
          const evidenceItems = windowItems.length > 0 ? windowItems : items.slice(0, 30);
          const hotTitles = evidenceItems.slice(0, 15).map((i: any) => i.title || i.keyword || "").filter(Boolean);
          const playCounts = evidenceItems.map((i: any) => Number(i.playCount || i.play_count || 0)).filter((v) => v > 0).sort((a, b) => b - a);
          return {
            platform,
            displayName: PLATFORM_NAMES[platform] || platform,
            itemCount: evidenceItems.length,
            topTitles: hotTitles,
            medianPlayCount: playCounts.length > 0 ? playCounts[Math.floor(playCounts.length / 2)] : 0,
            topPlayCount: playCounts[0] || 0,
          };
        });

        // Fully dynamic prompt — windowDays drives all time references, no hardcoded day counts
        const wd = Number(input.windowDays);
        const totalDays = wd * 2;
        const currentDateStr = todayStr; // ISO-style date already computed above
        const systemPrompt = `你是一位顶级的新媒体数据分析师，专注于发现平台算法逻辑与赛道流量趋势。今天是 ${currentDateStr}。

【关键时间约束 — 绝对禁止预测未来！】
本报告分析的时间段是：${pastStr} 至 ${todayStr}（过去 ${wd} 天）。
你将对比「近 ${wd} 天」与「前 ${wd} 天」（共 ${totalDays} 天数据）来识别赛道加速或减速信号。
绝对禁止使用"将会"、"预计"等预测性语言。所有描述必须是已发生的历史事实。

【真实数据矩阵】
以下是从数据库提取的各平台真实近 ${wd} 天数据快照，你必须从中提取洞察，不可凭空捏造：
${JSON.stringify(platformEvidence, null, 2)}

【核心要求】针对每个选定的平台给出（在 platformDetails 内）：
1. trafficBoosters：官方流量扶持活动，每个平台至少 2-3 条。${wd <= 7 ? " 【极速窗口：" + wd + " 天】重点关注短期爆发信号（当日热点、突发推流、节假日驱动）。" : ""}
2. cashRewards：现金奖励任务，每个平台至少 2 条，必须包含激励金额或门槛。
3. hotTopics：**【强制数量：5-8个】** 具体细分赛道名称（如"城市日常 vlog"），附带简短内容说明。

报告全局层级（不在 platformDetails 内）必须输出以下维度（不得省略）：
- reportTitle：精准标题，包含时间段（${pastStr} – ${todayStr}）
- insightSummary：输出 4 个核心洞察，必须严格遵循 [{"title":"短标题","description":"详细分析"}] 的 JSON 对象数组格式。
  - title：必须是明确的结论型标题，可以完整表达重点，不要故意压缩到不自然。
  - description：必须是具体的详细分析与案例，必须引用真实数据、真实平台现象或真实热点活动，至少 30-50 个字。
  - 【强制约束】：description 的内容绝对不能与 title 重复，不能只是改写 title，必须是一段有起承转合、包含现象或数据支撑的完整论述；如果输出重复内容，视为严重错误。
- trackGrowth：**【强制数量：5-8条】** 近 ${wd} 天爆款赛道增长排行，基于真实数据矩阵，绝对禁止捏造。格式：{"name": "赛道名称", "growth": "+XX%", "isHot": true/false}
- audiencesAndBiz：目标人群与商业方向（2-3条）。格式：{"audience": "人群描述", "bizDirection": "商业方向"}
- topicExamples：针对排名前三赛道设计选题公式与案例（3-5条）。格式：{"structure": "标题公式", "concept": "内容说明", "realCase": "接地气的真实感文章标题"}
- trafficSupport：扫描当前平台正在进行的官方流量扶持活动（全局跨平台维度，2-3条）。必须列出具体活动名称，格式：["活动名称：详细说明"]
- hotFestivals：根據今天 ${currentDateStr} 及前后 ${wd} 天范围，指出当下正在爆发或即将到来的节日、节气或社会热点（2-3个）。格式：["节日/热点：简要说明与内容切入角度"]

【绝对警告 — JSON 输出规范】请直接且仅输出合法的 JSON 对象，不要包含任何 Markdown 标记。第一个字符必须是 {，最后一个字符必须是 }。`;

        try {
          const response = await invokeLLM({
            model: "pro",
            provider: "gemini",
            modelName: "gemini-2.5-pro",
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: JSON.stringify({ windowDays: input.windowDays, platforms: input.platforms, today: todayStr, pastDate: pastStr, platformEvidence }) },
            ],
          });

          const rawContent = String(response.choices[0]?.message?.content || "{}");
          const fenceMatch = rawContent.match(/```(?:json)?\s*([\s\S]+?)```/);
          const stripped = fenceMatch ? fenceMatch[1].trim() : rawContent.replace(/^```(?:json)?[\r\n]*/i, "").replace(/[\r\n]*```\s*$/i, "").trim();
          let parsed: any = {};
          try { parsed = JSON.parse(stripped); } catch { try { parsed = JSON.parse(rawContent); } catch { parsed = {}; } }

          // safeStr: smart object-aware extractor — prevents [object Object] strings in arrays
          const safeStr = (v: any): string => {
            if (v === null || v === undefined) return "";
            if (typeof v === "string") return v;
            if (typeof v === "object") return String(v.text || v.title || v.name || v.content || v.desc || v.trackName || v.label || v.value || Object.values(v)[0] || "");
            return String(v);
          };
          const normalizeInsightItem = (item: any) => {
            if (typeof item === "string") {
              return { title: item, description: item };
            }
            const title = safeStr(item?.title || item?.name || "");
            const fallbackDescription = safeStr(item?.content || item?.detail || item?.analysis || item?.reason || "");
            const rawDescription = safeStr(item?.description || item?.desc || fallbackDescription);
            const description = rawDescription && rawDescription.trim() !== title.trim()
              ? rawDescription
              : fallbackDescription && fallbackDescription.trim() !== title.trim()
                ? fallbackDescription
                : rawDescription;
            return { title, description };
          };
          return {
            success: true,
            report: {
              reportTitle: safeStr(parsed.reportTitle || `平台趋势看板 · ${pastStr}–${todayStr}`),
              // insightSummary: support both {title, description} objects and legacy string arrays
              insightSummary: Array.isArray(parsed.insightSummary)
                ? parsed.insightSummary.map(normalizeInsightItem)
                : [],
              trackGrowth: Array.isArray(parsed.trackGrowth)
                ? parsed.trackGrowth.map((t: any) => ({ name: safeStr(t?.name || t), growth: safeStr(t?.growth || ""), isHot: Boolean(t?.isHot) }))
                : [],
              audiencesAndBiz: Array.isArray(parsed.audiencesAndBiz)
                ? parsed.audiencesAndBiz.map((a: any) => ({ audience: safeStr(a?.audience || a), bizDirection: safeStr(a?.bizDirection || "") }))
                : [],
              topicExamples: Array.isArray(parsed.topicExamples)
                ? parsed.topicExamples.map((e: any) => ({ structure: safeStr(e?.structure || e), concept: safeStr(e?.concept || ""), realCase: safeStr(e?.realCase || "") }))
                : [],
              // New global fields: trafficSupport, hotFestivals
              trafficSupport: Array.isArray(parsed.trafficSupport) ? parsed.trafficSupport.map(safeStr) : [],
              hotFestivals: Array.isArray(parsed.hotFestivals) ? parsed.hotFestivals.map(safeStr) : [],
              platformDetails: Array.isArray(parsed.platformDetails)
                ? parsed.platformDetails.map((p: any) => ({
                    platform: safeStr(p?.platform || ""),
                    trafficBoosters: Array.isArray(p?.trafficBoosters) ? p.trafficBoosters.map(safeStr) : [],
                    cashRewards: Array.isArray(p?.cashRewards) ? p.cashRewards.map(safeStr) : [],
                    hotTopics: Array.isArray(p?.hotTopics) ? p.hotTopics.map(safeStr) : [],
                  }))
                : [],
            },
          };
        } catch (error) {
          throw new Error(`generateVisualReport failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),

    generateTopicImage: publicProcedure
      .input(z.object({
        topicHook: z.string().min(1).max(500),
        format: z.enum(["短视频", "图文"]).optional(),
        context: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Proxy to Vercel /api/google?op=nanoImage — all Vertex env vars live on Vercel, not Fly
        // Single image only (numberOfImages: 1) to avoid rate limit
        const vercelBaseUrl = String(process.env.VERCEL_APP_URL || "https://mvstudiopro.vercel.app").replace(/\/$/, "");
        const aspectRatio = input.format === "图文" ? "3:4" : "16:9";
        const styleHint = input.format === "图文"
          ? "high-quality social media graphic for Xiaohongshu, elegant minimalist aesthetic, warm pastel tones, no text overlays"
          : "professional short video thumbnail for Douyin/Bilibili, dynamic and engaging, high contrast, cinematic";
        const imagePrompt = `Professional social media cover image: ${input.topicHook}. ${styleHint}. Clean composition, visually striking, no watermarks, no text overlays.`;

        // Read Vercel token from env — set VERCEL_ACCESS_TOKEN on Fly.io
        const SAFE_TOKEN = String(process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN || "").trim();

        try {
          const res = await fetch(
            `${vercelBaseUrl}/api/google?op=nanoImage&tier=flash&model=gemini-3.1-flash-image-preview&imageSize=1K&aspectRatio=${encodeURIComponent(aspectRatio)}&numberOfImages=1&guidanceScale=4.0`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${SAFE_TOKEN}`
              },
              body: JSON.stringify({
                prompt: imagePrompt,
                tier: "flash",
                model: "gemini-3.1-flash-image-preview",
                imageSize: "1K",
                aspectRatio,
                numberOfImages: 1,
                guidanceScale: 4.0,
              }),
              signal: AbortSignal.timeout(PLATFORM_LLM_TIMEOUT_MS),
            }
          );
          const json: any = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(`Vercel nanoImage error ${res.status}: ${JSON.stringify(json).slice(0, 300)}`);
          const imageUrl = String(json?.imageUrl || (Array.isArray(json?.imageUrls) ? json.imageUrls[0] : "") || "").trim();
          if (!imageUrl) throw new Error(`generateTopicImage: no imageUrl in Vercel response. raw: ${JSON.stringify(json).slice(0, 300)}`);
          return { success: true, imageUrl };
        } catch (error) {
          console.warn("[generateTopicImage] error:", error instanceof Error ? error.message : String(error));
          throw new Error(`generateTopicImage failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),

    getPlatformDashboard: publicProcedure
      .input(z.object({
        context: z.string().optional(),
        windowDays: z.union([z.literal(15), z.literal(30), z.literal(45)]),
        requestedPlatforms: z.array(z.string()).optional(),
        snapshotSummary: z.record(z.string(), z.any()),
      }))
      .mutation(async ({ input }) => {
        const requestedPlatforms = normalizePlatforms(input.requestedPlatforms || []);
        const selectedWindowDays = Number(input.windowDays);
        const t0 = Date.now();

        // Read narrow store for evidence enrichment (best-effort, 20s cap)
        const storeNull = { collections: {}, history: null, backfill: null } as unknown as Awaited<ReturnType<typeof readTrendStore>>;
        const store = await Promise.race([
          readTrendStoreForPlatforms(requestedPlatforms.length ? requestedPlatforms as any[] : ["douyin", "xiaohongshu", "bilibili", "kuaishou"], { preferDerivedFiles: true }),
          new Promise<Awaited<ReturnType<typeof readTrendStore>>>((resolve) => setTimeout(() => resolve(storeNull), 20_000)),
        ]).catch(() => storeNull);

        // Build dashboard — 120s cap, return null on timeout (no fallback)
        const DASHBOARD_TIMEOUT_MS = PLATFORM_LLM_TIMEOUT_MS;
        let platformDashboard: z.infer<typeof platformDashboardResponseSchema> | null = null;
        try {
          platformDashboard = await Promise.race([
            buildPlatformDashboard({
              // Cast to any since snapshotSummary is a slim version — buildPlatformDashboard only reads the fields we provide
              snapshot: input.snapshotSummary as any,
              context: input.context,
              requestedPlatforms: requestedPlatforms.length ? requestedPlatforms : ["douyin", "xiaohongshu", "bilibili", "kuaishou"],
              store,
              windowDays: selectedWindowDays,
            }),
            new Promise<null>((resolve) => setTimeout(() => {
              console.warn(`[platform.getPlatformDashboard] 平台看板生成超时，已等待 ${DASHBOARD_TIMEOUT_MS}ms，返回空结果`);
              resolve(null);
            }, DASHBOARD_TIMEOUT_MS)),
          ]);
        } catch (error) {
          console.error("[platform.getPlatformDashboard] dashboard error:", error);
          if (error instanceof Error) {
            console.error("[platform.getPlatformDashboard] error message:", error.message);
          }
          if ((error as any)?.name === "ZodError" || (error as any)?.issues) {
            console.error("[platform.getPlatformDashboard] ZodError issues:", JSON.stringify((error as any).issues?.slice(0, 5)));
          }
          const errorMessage = error instanceof Error ? error.message : String(error);
          return {
            success: false,
            platformDashboard: null,
            debug: {
              route: "mvAnalysis.getPlatformDashboard",
              totalMs: Date.now() - t0,
              hasDashboard: false,
              error: errorMessage,
            },
          };
        }

        return {
          success: true,
          platformDashboard,
          debug: {
            route: "mvAnalysis.getPlatformDashboard",
            totalMs: Date.now() - t0,
            hasDashboard: Boolean(platformDashboard),
            error: null as string | null,
          },
        };
      }),

    getPlatformContent: publicProcedure
      .input(z.object({
        context: z.string().optional(),
        windowDays: z.union([z.literal(15), z.literal(30), z.literal(45)]),
        platformMenu: z.array(z.any()).optional(),
        snapshotSummary: z.record(z.string(), z.any()),
      }))
      .mutation(async ({ input }) => {
        const t0 = Date.now();
        let platformContent: z.infer<typeof platformContentResponseSchema> | null = null;
        try {
          platformContent = await Promise.race([
            buildPlatformContent({
              snapshot: input.snapshotSummary,
              platformMenu: input.platformMenu || [],
              context: input.context,
              windowDays: Number(input.windowDays),
            }),
            new Promise<null>((resolve) => setTimeout(() => {
              console.warn(`[platform.getPlatformContent] 平台内容生成超时，已等待 ${PLATFORM_LLM_TIMEOUT_MS}ms，返回空结果`);
              resolve(null);
            }, PLATFORM_LLM_TIMEOUT_MS)),
          ]);
        } catch (error) {
          console.error("[platform.getPlatformContent] error:", error);
          if (error instanceof Error) {
            console.error("[platform.getPlatformContent] error message:", error.message);
          }
          // @ts-ignore
          if (error?.name === "ZodError" || (error as any)?.errors) {
            console.error("[platform.getPlatformContent] ZodError details:", JSON.stringify((error as any).errors?.slice(0, 5)));
          }
          platformContent = null;
        }
        return {
          success: true,
          platformContent,
          debug: {
            route: "mvAnalysis.getPlatformContent",
            totalMs: Date.now() - t0,
            hasContent: Boolean(platformContent),
          },
        };
      }),

    getGrowthSystemStatus: publicProcedure
      .query(async () => {
        const store = await readTrendStore({ preferDerivedFiles: true }).catch(() => null);
        const smtp = getSmtpStatus();
        const snapshot = await readGrowthStatusSnapshot();
        const runtimeMeta = snapshot?.runtimeMeta || await readTrendRuntimeMeta();
        const runtimeControl = snapshot?.runtimeControl || await readGrowthRuntimeControl();
        const debugSummary = snapshot?.debugSummary !== undefined ? snapshot.debugSummary : await readGrowthDebugSummary();
        const targetEmail = String(process.env.GROWTH_TREND_REPORT_EMAIL || "").trim();
        let storage: {
          totalBytes: number;
          freeBytes: number;
          usedBytes: number;
          freeMb: number;
          usedMb: number;
          totalMb: number;
          lowSpace: boolean;
        } | null = null;
        try {
          const stat = await fs.statfs("/data");
          const totalBytes = Number(stat.bsize) * Number(stat.blocks);
          const freeBytes = Number(stat.bsize) * Number(stat.bavail);
          const usedBytes = Math.max(0, totalBytes - freeBytes);
          storage = {
            totalBytes,
            freeBytes,
            usedBytes,
            freeMb: Math.round((freeBytes / 1024 / 1024) * 10) / 10,
            usedMb: Math.round((usedBytes / 1024 / 1024) * 10) / 10,
            totalMb: Math.round((totalBytes / 1024 / 1024) * 10) / 10,
            lowSpace: freeBytes < 300 * 1024 * 1024,
          };
        } catch {
          storage = null;
        }
        const normalizeBackfill = (backfill: typeof runtimeMeta.backfill | null | undefined) => {
          if ((runtimeControl?.mode || "auto") === "live") return null;
          if (!backfill) return null;
          const selectedWindowDays = Number(backfill.selectedWindowDays || 0) || (backfill.mode === "live" ? 30 : 90);
          const configuredMinutes = Math.max(
            1,
            Math.round((Number(process.env.GROWTH_BACKFILL_ACTIVE_INTERVAL_MS || 10 * 60 * 1000) || 10 * 60 * 1000) / (60 * 1000)),
          );
          const nextRunAt = backfill.nextRunAt || addMinutesToIso(backfill.updatedAt || backfill.startedAt, configuredMinutes);
          const startedAt = backfill.startedAt || backfill.updatedAt;
          const note = backfill.mode === "live"
            ? `近期回填运行中：窗口 ${selectedWindowDays} 天，夜间模式，默认每 ${formatBackfillIntervalLabel(configuredMinutes)} 一次。`
            : `历史回填运行中：窗口 ${selectedWindowDays} 天，夜间模式，默认每 ${formatBackfillIntervalLabel(configuredMinutes)} 一次。`;
          const backfillPlatforms = new Map(
            (backfill.platforms || []).map((item) => [String(item.platform), {
              ...item,
              startedAt: item.startedAt || startedAt,
              nextRunAt: item.nextRunAt || nextRunAt,
            }]),
          );
          for (const platform of growthPlatformValues.filter((item) => item !== "weixin_channels")) {
            if (backfillPlatforms.has(platform)) continue;
            backfillPlatforms.set(platform, {
              platform,
              target: 0,
              currentTotal: 0,
              archivedTotal: 0,
              startedAt,
              nextRunAt,
              status: "pending" as const,
            });
          }
          return {
            ...backfill,
            startedAt,
            nextRunAt,
            selectedWindowDays,
            note,
            platforms: Array.from(backfillPlatforms.values()).map((item) => ({
              ...item,
              platformLabel: getGrowthPlatformMeta(item.platform).label,
              platformDescription: getGrowthPlatformMeta(item.platform).description,
            })),
          };
        };
        const backfill = normalizeBackfill(runtimeMeta.backfill);
        const backfillLive = normalizeBackfill(runtimeMeta.backfillLive);
        const backfillHistory = normalizeBackfill(runtimeMeta.backfillHistory);
        const scheduler = Object.values(runtimeMeta.scheduler || {})
          .filter((item) => item?.platform && item.platform !== "weixin_channels")
          .map((item) => ({
            platform: item?.platform,
            platformLabel: getGrowthPlatformMeta(item?.platform).label,
            platformDescription: getGrowthPlatformMeta(item?.platform).description,
            lastRunAt: item?.lastRunAt,
            lastSuccessAt: item?.lastSuccessAt,
            nextRunAt: item?.nextRunAt,
            failureCount: item?.failureCount ?? 0,
            burstMode: item?.burstMode ?? false,
            burstTriggeredAt: item?.burstTriggeredAt,
            lastCollectedCount: item?.lastCollectedCount ?? 0,
            lastError: item?.lastError,
          }));
        const anomalies: Array<{ level: "warning" | "critical"; title: string; message: string }> = [];
        if (storage?.lowSpace) {
          anomalies.push({
            level: "critical",
            title: "磁碟空間過低",
            message: `Fly /data 剩餘 ${storage.freeMb} MB，低於 300 MB 門檻。`,
          });
        }
        const effectiveMode = runtimeControl?.mode || "auto";
        const now = Date.now();
        // Only check live scheduler staleness when mode is "auto" or "live".
        // When mode is "backfill", live scheduler is intentionally paused.
        const staleSchedulers = effectiveMode === "backfill" ? [] : scheduler.filter((item) => {
          if (!item.nextRunAt) return false;
          const nextRun = Date.parse(String(item.nextRunAt));
          if (!Number.isFinite(nextRun)) return false;
          return nextRun < now - 5 * 60 * 1000;
        });
        if (staleSchedulers.length) {
          anomalies.push({
            level: "critical",
            title: "Live 排程逾期未推进",
            message: `${staleSchedulers.map((item) => item.platformLabel || getGrowthPlatformMeta(item.platform).label).join("、")} 已超过 5 分钟未按 nextRunAt 启动。`,
          });
        }
        const schedulerErrors = scheduler.filter((item) => item.lastError);
        if (schedulerErrors.length) {
          anomalies.push({
            level: "warning",
            title: "平台抓取出錯",
            message: `${schedulerErrors.map((item) => `${item.platformLabel || getGrowthPlatformMeta(item.platform).label}：${String(item.lastError)}`).join("；")}`,
          });
        }
        const failedBackfills = [backfillLive, backfillHistory].filter((item) => item?.active && item?.status === "failed");
        if (failedBackfills.length) {
          anomalies.push({
            level: "warning",
            title: "回填失敗",
            message: failedBackfills.map((item) => String(item?.note || "回填失败")).join("；"),
          });
        }
        const criticalAnomalies = anomalies.filter((item) => item.level === "critical");
        const warningAnomalies = anomalies.filter((item) => item.level === "warning");
        const currentSupportActivities = growthPlatformValues
          .filter((platform) => platform !== "weixin_channels")
          .map((platform) => {
            const platformLabel = getGrowthPlatformMeta(platform).label;
            const collection = store?.collections?.[platform];
            const topItem = (collection?.items || [])
              .filter((item) => item.title)
              .sort((left, right) => ((right.likes || 0) + (right.comments || 0) * 3 + (right.shares || 0) * 5 + Math.round((right.views || 0) / 1000))
                - ((left.likes || 0) + (left.comments || 0) * 3 + (left.shares || 0) * 5 + Math.round((left.views || 0) / 1000)))[0];
            return {
              platform,
              platformLabel,
              summary: getGrowthPlatformMeta(platform).description,
              hotTopic: topItem?.title || "",
              supportActivities: buildPlatformSupportActivities(platform),
            };
          })
          .filter((item) => item.supportActivities.length || item.hotTopic);

        return {
          success: true,
          targetEmail,
          smtp,
          truthStore: {
            source: debugSummary?.truthSource || "current-json",
            updatedAt: debugSummary?.updatedAt || runtimeMeta.updatedAt || null,
            currentItems: debugSummary?.totals.currentItems || 0,
            archivedItems: debugSummary?.totals.archivedItems || 0,
            platforms: growthPlatformValues
              .filter((platform) => platform !== "weixin_channels")
              .map((platform) => ({
                platform,
                platformLabel: getGrowthPlatformMeta(platform).label,
                platformDescription: getGrowthPlatformMeta(platform).description,
                currentItems: Number(debugSummary?.platforms?.[platform]?.currentTotal || 0),
                archivedItems: Number(debugSummary?.platforms?.[platform]?.archivedTotal || 0),
              })),
          },
          runtimeControl: {
            mode: runtimeControl?.mode || "auto",
            burst: runtimeControl?.burst || "auto",
            burstPlatforms: runtimeControl?.burstPlatforms || [],
            updatedAt: runtimeControl?.updatedAt || null,
          },
          serviceHealth: {
            status: criticalAnomalies.length ? "critical" : "passing",
            label: criticalAnomalies.length ? "critical" : "passing",
            warningCount: warningAnomalies.length,
            criticalCount: criticalAnomalies.length,
            checkedAt: new Date().toISOString(),
          },
          anomalies,
          currentSupportActivities,
          storage,
          backfill,
          backfillLive,
          backfillHistory,
          mailDigest: runtimeMeta.mailDigest || {
            lastWindowMinutes: 30,
          },
          scheduler,
        };
      }),

    setGrowthRuntimeMode: publicProcedure
      .input(z.object({
        mode: z.enum(["auto", "live", "backfill"]),
      }))
      .mutation(async ({ input }) => {
        const current = await readGrowthRuntimeControl();
        const schedulerState = await readTrendSchedulerState();
        const saved = await writeGrowthRuntimeControl({
          mode: input.mode,
          burst: current?.burst || "auto",
          burstPlatforms: current?.burstPlatforms || [],
        });
        if (input.mode === "live") {
          const nextRunAt = nowShanghaiIso();
          await Promise.all(
            growthPlatformValues
              .filter((platform) => platform !== "weixin_channels")
              .map((platform) => {
                const currentState = schedulerState[platform];
                const currentNextRunAt = currentState?.nextRunAt ? Date.parse(String(currentState.nextRunAt)) : 0;
                const shouldResetRunAt = !Number.isFinite(currentNextRunAt) || currentNextRunAt <= Date.now();
                return updateTrendSchedulerState(platform, {
                  nextRunAt: shouldResetRunAt ? nextRunAt : currentState?.nextRunAt,
                  failureCount: 0,
                  lastError: undefined,
                  burstMode: false,
                  burstTriggeredAt: undefined,
                  lastFrequencyLabel: "每 20 分钟一次",
                });
              }),
          );
        }
        return {
          success: true,
          mode: saved.mode,
          burst: saved.burst,
          burstPlatforms: saved.burstPlatforms,
          updatedAt: saved.updatedAt,
        };
      }),

    setGrowthBurstControl: publicProcedure
      .input(z.object({
        burst: z.enum(["auto", "manual", "off"]),
        platforms: z.array(z.enum(["douyin", "xiaohongshu", "bilibili", "kuaishou", "weixin_channels", "toutiao"])).default([]),
      }))
      .mutation(async ({ input }) => {
        const current = await readGrowthRuntimeControl();
        const schedulerState = await readTrendSchedulerState();
        const burstPlatforms = input.burst === "manual"
          ? input.platforms.filter((platform) => platform !== "weixin_channels")
          : [];
        const saved = await writeGrowthRuntimeControl({
          mode: current?.mode || "auto",
          burst: input.burst,
          burstPlatforms,
        });
        const nextRunAt = nowShanghaiIso();
        await Promise.all(
          growthPlatformValues
            .filter((platform) => platform !== "weixin_channels")
            .map((platform) => {
              const currentState = schedulerState[platform];
              const enabled = input.burst === "manual"
                ? burstPlatforms.includes(platform)
                : input.burst === "off"
                  ? false
                  : undefined;
              return updateTrendSchedulerState(platform, {
                nextRunAt: enabled ? nextRunAt : (currentState?.nextRunAt || nextRunAt),
                failureCount: 0,
                lastError: undefined,
                burstMode: enabled,
                burstTriggeredAt: enabled ? nextRunAt : undefined,
                lastFrequencyLabel: input.burst === "manual"
                  ? (enabled ? "手动 burst / 15 分钟一次" : (currentState?.lastFrequencyLabel || "每 20 分钟一次"))
                  : input.burst === "off"
                    ? "每 20 分钟一次"
                    : undefined,
              });
            }),
        );
        return {
          success: true,
          mode: saved.mode,
          burst: saved.burst,
          burstPlatforms: saved.burstPlatforms,
          updatedAt: saved.updatedAt,
        };
      }),

    getGrowthMonotonicStatus: publicProcedure
      .query(async () => {
        const stats = await getGrowthTrendStats();
        return {
          success: true,
          fetchedAt: new Date().toISOString(),
          platforms: Object.fromEntries(
            stats.platforms.map((item) => [
              item.platform,
              {
                currentTotal: Number(item.currentTotal || 0),
                archivedTotal: Number(item.archivedItems || 0),
              },
            ]),
          ),
          source: "growth-trend-stats",
        };
      }),

    getGrowthTrendStats: adminProcedure
      .query(async () => {
        const stats = await getGrowthTrendStats();
        return {
          success: true,
          currentTotal: stats.totals.currentItems,
          historicalTotal: stats.totals.archivedItems,
          coverage: stats.coverage,
          platforms: stats.platforms,
          buckets: stats.buckets,
          industries: stats.industries,
          ages: stats.ages,
          contentTypes: stats.contentTypes,
          references: stats.references,
          scheduler: stats.scheduler,
          burst: {
            activePlatforms: stats.totals.burstActivePlatforms,
            enterCount: stats.totals.burstEnterCount,
            exitCount: stats.totals.burstExitCount,
          },
          stats,
        };
      }),

    getHotTopicsByWindow: publicProcedure
      .input(z.object({
        windowDays: z.number().int().min(7).max(90).default(15),
        platforms: z.array(z.enum(["douyin", "xiaohongshu", "bilibili", "kuaishou", "toutiao"])).default(["douyin", "xiaohongshu", "bilibili", "kuaishou"]),
      }))
      .query(async ({ input }) => {
        const store = await readTrendStore({ preferDerivedFiles: true }).catch(() => null);
        const windowCutoff = Date.now() - input.windowDays * 24 * 60 * 60 * 1000;

        const results = input.platforms.map((platform) => {
          const collection = store?.collections?.[platform as keyof typeof store.collections];
          const items = (collection?.items || []).filter((item: any) => {
            if (!item?.title) return false;
            const collectedAt = Date.parse(String(collection?.collectedAt || ""));
            return !Number.isFinite(collectedAt) || collectedAt >= windowCutoff;
          });
          const topicItems = items.filter((item: any) => item.bucket === "douyin_topics" || item.contentType === "topic");
          const contentItems = items.filter((item: any) => item.bucket !== "douyin_topics" && item.contentType !== "topic");
          const scored = [...topicItems, ...contentItems]
            .map((item: any) => ({
              title: String(item.title || ""),
              type: (topicItems.includes(item) ? "热词" : "热门内容") as string,
              likes: Number(item.likes || item.hotValue || 0),
              comments: Number(item.comments || 0),
              shares: Number(item.shares || 0),
              views: Number(item.views || 0),
              score: (item.likes || item.hotValue || 0) + (item.comments || 0) * 3 + (item.shares || 0) * 5 + Math.round((item.views || 0) / 1000),
            }))
            .sort((a: any, b: any) => b.score - a.score)
            .slice(0, 8);
          return {
            platform,
            platformLabel: { douyin: "抖音", xiaohongshu: "小红书", bilibili: "B站", kuaishou: "快手", toutiao: "今日头条" }[platform] || platform,
            windowDays: input.windowDays,
            itemCount: items.length,
            hotTopics: scored,
            collectedAt: collection?.collectedAt || null,
          };
        });

        return {
          success: true,
          windowDays: input.windowDays,
          fetchedAt: new Date().toISOString(),
          platforms: results,
        };
      }),

    refreshGrowthTrends: publicProcedure
      .input(z.object({
        platforms: z.array(z.enum(["douyin", "xiaohongshu", "bilibili", "kuaishou", "weixin_channels", "toutiao"])).default(["douyin", "kuaishou", "bilibili", "xiaohongshu"]),
      }))
      .mutation(async ({ input }) => {
        const collected = await collectTrendPlatforms(input.platforms);
        const store = await mergeTrendCollections(collected.collections);

        return {
          success: true,
          updatedAt: store.updatedAt,
          collections: Object.values(store.collections).map((item) => ({
            platform: item?.platform,
            collectedAt: item?.collectedAt,
            source: item?.source,
            count: item?.items.length ?? 0,
          })),
          mergeStats: store.mergeStats || {},
          errors: collected.errors,
        };
      }),

    exportGrowthTrendsCsv: publicProcedure
      .input(z.object({
        email: z.string().email().optional(),
      }))
      .mutation(async ({ input }) => {
        const exported = await exportTrendCollectionsCsv();
        const targetEmail = input.email || String(process.env.GROWTH_TREND_REPORT_EMAIL || "").trim() || undefined;
        let emailed = false;
        let emailError: string | undefined;

        if (targetEmail) {
          try {
            await sendMailWithAttachments({
              to: targetEmail,
              subject: "Creator Growth Camp 趋势抓取 CSV",
              requireResend: true,
              text: `最新趋势抓取 CSV 已按平台分别导出，共 ${exported.rows} 行。\n清单：${exported.manifestPath}`,
              attachments: exported.files.map((file) => ({
                filename: file.filePath.split("/").pop() || `${file.platform}-growth-trends.csv`,
                path: file.filePath,
                contentType: "text/csv",
              })),
            });
            emailed = true;
          } catch (error) {
            emailError = error instanceof Error ? error.message : String(error);
          }
        }

        return {
          success: true,
          manifestPath: exported.manifestPath,
          files: exported.files,
          rows: exported.rows,
          emailed,
          targetEmail,
          emailError,
        };
      }),

    // Analyze a single segment frame (used by full video analysis)
    analyzeSegment: publicProcedure
      .input(z.object({
        imageBase64: z.string().min(1),
        mimeType: z.string().default("image/jpeg"),
        segmentIndex: z.number(),
        totalSegments: z.number(),
        timestampSec: z.number(),
        videoDurationSec: z.number(),
        context: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.imageBase64, "base64");
        const { url: frameUrl } = await storagePut(
          `analysis/segment_${Date.now()}_${input.segmentIndex}.jpg`,
          buffer,
          input.mimeType
        );

        const minutes = Math.floor(input.timestampSec / 60);
        const seconds = Math.floor(input.timestampSec % 60);
        const timeLabel = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的视频视觉分析师。这是一支 MV 的第 ${input.segmentIndex + 1}/${input.totalSegments} 个片段（时间点 ${timeLabel}，视频总长 ${Math.round(input.videoDurationSec)} 秒）。

请从以下维度分析这个片段的画面：
1. 构图评分 (1-100)
2. 色彩运用评分 (1-100)
3. 光影效果评分 (1-100)
4. 视觉冲击力评分 (1-100)
5. 这个片段的主要优点（1-2 点，具体描述画面内容）
6. 这个片段的改进建议（1-2 点，具体且可操作）
7. 画面内容简述（一句话描述这个片段在做什么）

请用 JSON 格式回复：
{
  "composition": number,
  "color": number,
  "lighting": number,
  "impact": number,
  "strengths": ["string"],
  "improvements": ["string"],
  "sceneDescription": "string"
}`
            },
            {
              role: "user",
              content: [
                { type: "text", text: input.context || `请分析这个视频片段（${timeLabel}）` },
                { type: "image_url", image_url: { url: frameUrl } }
              ]
            }
          ],
          response_format: { type: "json_object" }
        });

        const segmentAnalysis = JSON.parse(response.choices[0].message.content as string);
        return {
          success: true,
          segmentIndex: input.segmentIndex,
          timestampSec: input.timestampSec,
          timeLabel,
          frameUrl,
          analysis: segmentAnalysis,
        };
      }),

    // Generate final summary report from all segment analyses
    generateReport: publicProcedure
      .input(z.object({
        segments: z.array(z.object({
          segmentIndex: z.number(),
          timestampSec: z.number(),
          timeLabel: z.string(),
          frameUrl: z.string(),
          analysis: z.object({
            composition: z.number(),
            color: z.number(),
            lighting: z.number(),
            impact: z.number(),
            strengths: z.array(z.string()),
            improvements: z.array(z.string()),
            sceneDescription: z.string(),
          }),
        })),
        videoDurationSec: z.number(),
        fileName: z.string().optional(),
        context: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const segmentSummaries = input.segments.map((seg) => {
          const avgScore = Math.round(
            (seg.analysis.composition + seg.analysis.color + seg.analysis.lighting + seg.analysis.impact) / 4
          );
          return `[${seg.timeLabel}] 场景：${seg.analysis.sceneDescription}｜平均分：${avgScore}｜优点：${seg.analysis.strengths.join("；")}｜改进：${seg.analysis.improvements.join("；")}`;
        }).join("\n");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位资深视频导演和视觉分析专家。以下是一支视频各个时间片段的逐段分析结果。请基于这些数据生成一份完整的视频分析总报告。

## 要求
1. 给出整体评分（构图、色彩、光影、冲击力、爆款潜力，各 1-100）
2. 列出 3-5 个关键优点，每个优点要标明对应的时间节点和帧号
3. 列出 3-5 个改进建议，每个建议要标明对应的时间节点和帧号，说明具体需要优化的片段
4. 给出整体总结和推荐发布平台
5. 标记出全片最佳片段和最需改进片段的时间点

## 输出 JSON 格式
{
  "overallScores": {
    "composition": number,
    "color": number,
    "lighting": number,
    "impact": number,
    "viralPotential": number
  },
  "keyStrengths": [
    { "point": "string", "timeLabel": "string", "segmentIndex": number }
  ],
  "keyImprovements": [
    { "point": "string", "timeLabel": "string", "segmentIndex": number }
  ],
  "bestMoment": { "timeLabel": "string", "segmentIndex": number, "reason": "string" },
  "worstMoment": { "timeLabel": "string", "segmentIndex": number, "reason": "string" },
  "platforms": ["string"],
  "summary": "string",
  "detailedNarrative": "string"
}`
            },
            {
              role: "user",
              content: `视频名称：${input.fileName || "未命名视频"}\n视频时长：${Math.round(input.videoDurationSec)} 秒\n分析片段数：${input.segments.length}\n${input.context ? `补充说明：${input.context}\n` : ""}\n逐段分析结果：\n${segmentSummaries}`
            }
          ],
          response_format: { type: "json_object" }
        });

        const report = JSON.parse(response.choices[0].message.content as string);
        return { success: true, report };
      }),
  }),

  // Virtual Idol Generation
  virtualIdol: router({
    generate: protectedProcedure
      .input(z.object({
        style: z.enum(["anime", "realistic", "chibi", "cyberpunk", "fantasy"]),
        gender: z.enum(["female", "male", "neutral"]),
        description: z.string().max(500).optional(),
        referenceImageUrl: z.string().url().optional(),
        quality: z.enum(["free", "2k", "4k"]).default("free"),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";
        const userTier = await resolveUserTier(userId, isAdminUser);
        const stylePrompts: Record<string, string> = {
          anime: "anime style virtual idol singer, vibrant colors, detailed eyes, professional character design, concert stage background, high quality anime illustration",
          realistic: "ultra photorealistic portrait photo of a real person, natural skin texture with pores and fine details, real human being not CGI not 3D render not anime not cartoon, shot on Canon EOS R5 85mm f/1.4 lens, natural golden hour sunlight, shallow depth of field bokeh background, professional fashion photography, 8K resolution, RAW photo quality, real person photographed in outdoor garden setting",
          chibi: "chibi style cute virtual idol singer, kawaii, big eyes, colorful outfit, stage performance, adorable character design",
          cyberpunk: "cyberpunk virtual idol singer, neon lights, futuristic outfit, holographic effects, digital art, sci-fi aesthetic",
          fantasy: "fantasy virtual idol singer, ethereal glow, magical effects, elegant costume, enchanted stage, dreamlike atmosphere",
        };
        const genderPrompts: Record<string, string> = {
          female: "young East Asian woman, beautiful natural face, long flowing hair, wearing fashionable outfit",
          male: "young East Asian man, handsome natural face, styled hair, wearing modern outfit",
          neutral: "young East Asian person, attractive androgynous features, stylish modern look",
        };

        // Build prompt based on style
        let prompt: string;
        if (input.referenceImageUrl) {
          const refNote = "Use the provided reference image as the base appearance and facial features. Transform the person in the reference image into";
          if (input.style === "realistic") {
            prompt = `${refNote} ${stylePrompts[input.style]}, ${genderPrompts[input.gender]}${input.description ? `, ${input.description}` : ""}, maintain the facial features from the reference, NOT anime NOT cartoon NOT illustration NOT 3D render, real human photograph`;
          } else {
            prompt = `${refNote} ${stylePrompts[input.style]}, ${genderPrompts[input.gender]}${input.description ? `, ${input.description}` : ""}, maintain the facial features from the reference, high quality, detailed, professional`;
          }
        } else {
          if (input.style === "realistic") {
            prompt = `${stylePrompts[input.style]}, ${genderPrompts[input.gender]}${input.description ? `, ${input.description}` : ""}, NOT anime NOT cartoon NOT illustration NOT 3D render, real human photograph`;
          } else {
            prompt = `${stylePrompts[input.style]}, ${genderPrompts[input.gender]}${input.description ? `, ${input.description}` : ""}, high quality, detailed, professional`;
          }
        }

        // ─── FREE tier: use nano-banana-flash (1K) ───────────────
        if (input.quality === "free") {
          const imageProviderChain = getTierProviderChain(userTier, "image");
          const imageResult = await executeProviderFallback<{ imageUrl: string }>({
            apiName: "virtualIdol.generate.image",
            providers: imageProviderChain,
            execute: async (provider) => {
              if (provider === "nano-banana-flash") {
                if (!isGeminiImageAvailable()) {
                  throw new Error("Nano Banana Flash unavailable: Vertex AI credentials not configured");
                }
                const result = await generateGeminiImage({
                  prompt: `high resolution 1K, ${prompt}`,
                  quality: "1k",
                  referenceImageUrl: input.referenceImageUrl,
                });
                return { data: { imageUrl: result.imageUrl } };
              }

              if (provider === "nano-banana-pro") {
                if (!isGeminiImageAvailable()) {
                  throw new Error("Nano Banana Pro unavailable: Vertex AI credentials not configured");
                }
                const result = await generateGeminiImage({
                  prompt: `high resolution 2K, ${prompt}`,
                  quality: "2k",
                  referenceImageUrl: input.referenceImageUrl,
                });
                return { data: { imageUrl: result.imageUrl } };
              }

              throw new Error(`Unsupported image provider: ${provider}`);
            },
          });
          if (!imageResult.success) {
            return {
              success: false,
              error: imageResult.error,
              quality: "free" as const,
              providerUsed: imageResult.providerUsed,
              jobId: imageResult.jobId,
              data: imageResult.data,
              fallback: imageResult.fallback,
            };
          }
          
          // 僅 trial199 / 免費帳號添加水印（管理員及正式加值包用戶跳過）
          let finalUrl = imageResult.data.imageUrl;
          if (await resolveWatermark(userId, isAdminUser)) {
            try {
              const { addWatermarkToUrl } = await import("./watermark");
              const { storagePut } = await import("./storage");
              const watermarkedBuffer = await addWatermarkToUrl(imageResult.data.imageUrl, "bottom-right");
              const key = `watermarked/${userId}/${Date.now()}-idol.png`;
              const uploaded = await storagePut(key, watermarkedBuffer, "image/png");
              finalUrl = uploaded.url;
            } catch (wmErr) {
              console.error("[VirtualIdol] Watermark failed, using original:", wmErr);
            }
          }
          
          await incrementUsageCount(userId, "avatar");
          // Auto-record creation
          try {
            const plan = await getUserPlan(userId);
            await recordCreation({
              userId,
              type: "idol_image",
              title: input.description?.slice(0, 100) || `${input.style} ${input.gender} 偶像`,
              outputUrl: finalUrl,
              thumbnailUrl: finalUrl,
              quality: "free",
              creditsUsed: 0,
              plan,
            });
          } catch (e) { console.error("[VirtualIdol] recordCreation failed:", e); }
          return {
            success: true,
            imageUrl: finalUrl,
            quality: "free" as const,
            providerUsed: imageResult.providerUsed,
            jobId: imageResult.jobId,
            data: { imageUrl: finalUrl },
            fallback: imageResult.fallback,
          };
        }

        // ─── 2K / 4K tier: use Gemini API (Nano Banana Pro) ─────
        const creditKey = input.quality === "4k" ? "nbpImage4K" as const : "nbpImage2K" as const;

        // Admin skips credits deduction
        if (!isAdminUser) {
          const deduction = await deductCredits(userId, creditKey);
          if (!deduction.success) {
            return { success: false, error: "Credits 不足，请充值后再试", quality: input.quality };
          }
        }

        try {
          const qualityHint = input.quality === "4k" ? "ultra high resolution 4K 4096x4096, extremely detailed" : "high resolution 2K 2048x2048, detailed";
          const paidImageProviderChain = getTierProviderChain(userTier, "image");
          const imageResult = await executeProviderFallback<{ imageUrl: string }>({
            apiName: "virtualIdol.generate.image.paid",
            providers: paidImageProviderChain,
            execute: async (provider) => {
              if (provider === "nano-banana-pro") {
                const result = await generateGeminiImage({
                  prompt: `${qualityHint}, ${prompt}`,
                  quality: input.quality as "2k" | "4k",
                  referenceImageUrl: input.referenceImageUrl,
                });
                return { data: { imageUrl: result.imageUrl } };
              }
              if (provider === "nano-banana-flash") {
                if (!isGeminiImageAvailable()) {
                  throw new Error("Nano Banana Flash unavailable: Vertex AI credentials not configured");
                }
                const result = await generateGeminiImage({
                  prompt: `high resolution 1K, ${prompt}`,
                  quality: "1k",
                  referenceImageUrl: input.referenceImageUrl,
                });
                return { data: { imageUrl: result.imageUrl } };
              }
              throw new Error(`Unsupported image provider: ${provider}`);
            },
          });
          if (!imageResult.success) {
            throw new Error(imageResult.error || "图片生成失败");
          }
          await incrementUsageCount(userId, "avatar");
          // Auto-record Gemini creation
          try {
            const plan = await getUserPlan(userId);
            await recordCreation({
              userId,
              type: "idol_image",
              title: input.description?.slice(0, 100) || `NBP ${input.quality} 偶像`,
              outputUrl: imageResult.data.imageUrl,
              thumbnailUrl: imageResult.data.imageUrl,
              quality: `nbp-${input.quality}`,
              creditsUsed: CREDIT_COSTS[creditKey],
              plan,
            });
          } catch (e) { console.error("[VirtualIdol] recordCreation failed:", e); }
          return {
            success: true,
            imageUrl: imageResult.data.imageUrl,
            quality: input.quality,
            providerUsed: imageResult.providerUsed,
            jobId: imageResult.jobId,
            data: imageResult.data,
            fallback: imageResult.fallback,
          };
        } catch (err: any) {
          if (!isAdminUser) {
            try {
              await refundCredits(
                userId,
                CREDIT_COSTS[creditKey],
                "虚拟偶像·图片生成失败·退回已扣积分",
              );
            } catch (restoreErr) {
              console.error("[VirtualIdol] Failed to restore credits:", restoreErr);
            }
          }
          console.error("[VirtualIdol] Gemini image generation failed:", err);
          return { success: false, error: `图片生成失败: ${err.message || '请稍后再试'}`, quality: input.quality };
        }
      }),

    // ─── 偶像图片转 3D（仅限 Pro 以上方案） ────────────
    convertTo3D: protectedProcedure
      .input(z.object({
        imageUrl: z.string().url(),
        enablePbr: z.boolean().default(true),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const userRole = ctx.user.role;

        // 管理员直接放行
        if (userRole !== "admin") {
          // 检查是否为 Pro 以上方案
          const { getUserPlan } = await import("./credits");
          const plan = await getUserPlan(userId);
          if (plan === "free") {
            throw new Error("偶像转 3D 功能仅限专业版以上用户使用，请升级您的方案");
          }

          // 扣除 Credits
          const { deductCredits } = await import("./credits");
          await deductCredits(userId, "idol3D", "偶像图片转 3D (Hunyuan3D)");
        }

        // 检查 fal.ai 是否已配置
        const { isFalConfigured, imageToThreeD } = await import("./fal-3d");
        if (!isFalConfigured()) {
          // 回退到 2D 图像风格化仿真
          const prompt = `Convert this 2D character image into a high-quality 3D render. Pixar 3D animation style, smooth subsurface scattering skin, big expressive eyes, stylized proportions, Disney quality rendering, volumetric lighting, 3D character render, three-quarter view portrait, dynamic angle, maintain the original character's identity and outfit details, professional 3D modeling quality, octane render, depth of field`;
          const imageResult = await generateGeminiImage({
            prompt,
            quality: "2k",
            referenceImageUrl: input.imageUrl,
          });
          return {
            success: true,
            mode: "fallback" as const,
            imageUrl3D: imageResult.imageUrl,
            glbUrl: null,
            objUrl: null,
            textureUrl: null,
            thumbnailUrl: null,
            availableFormats: ["image"],
            timeTaken: 0,
          };
        }

        // 使用 fal.ai Hunyuan3D v3.1 Rapid 生成真实 3D 模型
        const result = await imageToThreeD({
          imageUrl: input.imageUrl,
          enablePbr: input.enablePbr,
        });

        // Auto-record 3D creation
        try {
          const plan = await getUserPlan(userId);
          await recordCreation({
            userId,
            type: "idol_3d",
            title: "3D 模型轉換",
            outputUrl: result.glbUrl,
            secondaryUrl: result.objUrl ?? undefined,
            thumbnailUrl: result.thumbnailUrl || result.glbUrl,
            metadata: { mode: "real3d", enablePbr: input.enablePbr },
            quality: input.enablePbr ? "PBR" : "Basic",
            creditsUsed: CREDIT_COSTS.idol3D,
            plan,
          });
        } catch (e) { console.error("[VirtualIdol] 3D recordCreation failed:", e); }

        return {
          success: true,
          mode: "real3d" as const,
          imageUrl3D: result.thumbnailUrl || result.glbUrl,
          glbUrl: result.glbUrl,
          objUrl: result.objUrl,
          textureUrl: result.textureUrl,
          thumbnailUrl: result.thumbnailUrl,
          availableFormats: result.availableFormats,
          timeTaken: result.timeTaken,
        };
      }),

    // ─── 检查 fal.ai 3D 服务状态 ─────────────────────
    check3DService: protectedProcedure
      .query(async () => {
        const { isFalConfigured } = await import("./fal-3d");
        return {
          configured: isFalConfigured(),
          provider: isFalConfigured() ? "fal.ai Hunyuan3D v3.1 Rapid" : "LLM Fallback (2D Simulation)",
          costPerGeneration: isFalConfigured() ? 0.225 : 0,
          creditsRequired: 10,
        };
      }),
  }),

  // Video Storyboard Script Generator
  storyboard: router({
    generate: protectedProcedure
      .input(z.object({
        lyrics: z.string().min(1),
        sceneCount: z.number().min(1).max(20).default(5),
        model: z.enum(["flash", "gpt5", "pro"]).default("flash"),
        visualStyle: z.enum(["cinematic", "anime", "documentary", "realistic", "scifi"]).default("cinematic"),
        referenceImageUrl: z.string().url().optional(),
        referenceStyleDescription: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";
        const userTier = await resolveUserTier(userId, isAdminUser);

        // 所有模型都需要 Credits，管理員免費
        if (!isAdminUser) {
          const { deductCredits, hasEnoughCredits } = await import("./credits");
          const creditKey = input.model === "gpt5" ? "storyboardGpt5" : input.model === "pro" ? "storyboard" : "storyboardFlash";
          const canAfford = await hasEnoughCredits(userId, creditKey);
          if (!canAfford) {
            const modelLabel = input.model === "gpt5" ? "GPT 5.1" : input.model === "pro" ? "Gemini 3.0 Pro" : "Gemini 3.0 Flash";
            throw new Error(`Credits 不足，无法使用 ${modelLabel} 模型。请充值 Credits。`);
          }
          await deductCredits(userId, creditKey, `分镜脚本生成 (${input.model === "gpt5" ? "GPT 5.1" : input.model === "pro" ? "Gemini 3.0 Pro" : "Gemini 3.0 Flash"})`);
        }

        // Use LLM to analyze lyrics and generate storyboard
        const llmResult = await executeProviderFallback<Awaited<ReturnType<typeof invokeLLM>>>({
          apiName: "storyboard.generate.story",
          providers: getTierProviderChain(userTier, "text"),
          execute: async (provider) => {
            const providerModel =
              provider === "gpt_5_1" || provider === "veo3.1-pro"
                ? ("gpt5" as const)
                : provider === "gemini_3_pro" || provider === "nano-banana-pro"
                ? ("pro" as const)
                : ("flash" as const);
            const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的视频导演和电影摄影师，拥有丰富的视觉叙事经验。请根据歌词或文本内容，生成一个完整且专业的 视频分镜脚本。

## 视觉风格
本次分镜脚本的视觉风格为：**${{
  cinematic: "电影感（Cinematic）— 使用电影级别的光影、色彩分级、宽银幕构图。追求胶片质感、浅景深、戏剧性光线。参考风格：王家卫、扎克·施奈德、罗杰·迪金斯。",
  anime: "动漫风（Anime）— 使用日系动漫的视觉语言。鲜艳色彩、夸张表情、速度线、光效粒子、樱花飘落等经典元素。参考风格：新海诚、宫崎骏、MAPPA。",
  documentary: "纪录片（Documentary）— 使用纪录片的真实感和沉浸感。自然光线、手持镜头、长镜头、采访式构图。追求真实、客观、有深度的视觉叙事。",
  realistic: "写实片（Realistic）— 使用写实主义的视觉风格。自然色调、真实场景、生活化的光线和构图。追求贴近现实的质感，避免过度修饰。",
  scifi: "科幻片（Sci-Fi）— 使用科幻电影的视觉语言。霓虹灯光、全息投影、赛博朋克色调、未来感建筑和科技元素。参考风格：银翼杀手、攻壳机动队、星际穿越。"
}[input.visualStyle]}**

请确保所有场景的视觉元素、色彩分级、光影设计和特效都严格遵循此风格。

## 音乐分析维度
请从以下维度分析歌曲特性：
1. **BPM（节奏速度）**：根据歌词情绪和节奏推测，范围 60-180
2. **情感基调**：如欢快、忧郁、激昂、温柔、怀旧、希望、悲伤、狂野等
3. **音乐风格**：如流行、摇滚、电子、民谣、R&B、嘻哈、爵士、古典等
4. **调性**：如 C大调、A小调、G大调等（根据情感推测）

## 分镜场景要求
每个场景必须包含以下专业元素：

### 1. 场景描述（description）
- 详细描述视觉画面，与歌词内容紧密结合
- 包含场景地点、时间、人物动作、环境氛围
- 使用电影化的描述语言，具体且富有画面感
- 例如：「黄昏时分的海边，主角背对镜头站在礁石上，海风吹动长发，远处夕阳将天空染成橙红色」

### 2. 镜头运动（cameraMovement）
使用专业的镜头语言，从以下类型中选择并详细说明：

**基础运动镜头**：
- **推镜（Push In / Dolly In）**：镜头向前推进，强调主体或情绪升级
- **拉镜（Pull Out / Dolly Out）**：镜头向后拉远，展现环境或情绪释放
- **摇镜（Pan）**：水平旋转，展现空间或跟随动作（左摇 / 右摇）
- **倾斜（Tilt）**：垂直旋转，展现高度或视角变化（上倾 / 下倾）
- **跟镜（Follow / Tracking）**：跟随主体移动，营造动态感
- **环绕（Orbit / Arc）**：围绕主体旋转，展现立体空间

**高端运动镜头**：
- **推轨（Dolly Track）**：使用轨道推拉，流畅且稳定
- **摇臂（Jib / Crane）**：大幅度升降运动，展现宏大场景
- **斯坦尼康（Steadicam）**：手持稳定器跟拍，自然且灵活
- **航拍（Drone / Aerial）**：俯瞰或大范围移动，展现空间感
- **变焦（Zoom In / Out）**：镜头焦距变化，营造视觉冲击
- **手持（Handheld）**：手持晃动，营造真实感或紧张感

**特殊镜头**：
- **固定镜头（Static / Locked）**：静止不动，强调稳定或凝视
- **升格（Slow Motion）**：慢动作，强调细节或情感
- **降格（Fast Motion / Time-lapse）**：快动作或延时，展现时间流逝
- **第一人称视角（POV）**：主观视角，增强代入感
- **旋转镜头（Rotation / Roll）**：画面旋转，营造失重或迷幻感

**组合运动**：
- 例如：「推轨 + 摇臂上升」、「航拍环绕 + 降格」、「斯坦尼康跟拍 + 升格」

### 3. 情绪氛围（mood）
- 描述场景的情感色彩和氛围感受
- 例如：浪漫、紧张、梦幻、孤独、希望、忧伤、狂野、宁静、压抑、释放等
- 可以组合多个情绪，例如：「忧伤中带着希望」、「狂野且自由」

### 4. 视觉效果（visualElements）
必须包含以下专业视觉设计元素（每个场景至少 3-5 个）：

**光影设计**：
- 自然光：金色时光（Golden Hour）、蓝调时光（Blue Hour）、正午强光、阴天柔光
- 人工光：逆光、侧光、顶光、底光、轮廓光、Rembrandt 光
- 特殊光效：光束、光晕（Lens Flare）、体积光（Volumetric Light）、霓虹灯

**色彩分级（Color Grading）**：
- 暖色调：橙黄、金色、琥珀色
- 冷色调：蓝色、青色、银灰色
- 对比色：橙蓝对比、红绿对比、黄紫对比
- 风格化：复古胶片感、赛博朋克、黑白高反差、褪色复古、电影感

**特效与后期**：
- 粒子效果：灰尘、雨滴、雪花、火花、光点
- 动态模糊：运动模糊、径向模糊
- 景深效果：浅景深（背景虚化）、深景深（全景清晰）
- 画面质感：颗粒感、胶片划痕、漏光效果
- 特殊效果：重曝（Double Exposure）、分屏、镜像、故障艺术（Glitch）

**构图元素**：
- 前景元素：树叶、窗框、人物剪影
- 几何线条：引导线、对称构图、三分法
- 环境元素：烟雾、雾气、水面倒影、玻璃反射

### 5. 场景转场建议（transition）
在 JSON 中添加 "transition" 字段，描述如何过渡到下一个场景：
- 淡入淡出（Fade In / Out）
- 交叉溶解（Cross Dissolve）
- 硬切（Hard Cut）
- 匹配剪辑（Match Cut）：动作匹配或形状匹配
- 擦除转场（Wipe）
- 推拉转场（Push / Pull）
- 旋转转场（Spin）
- 故障转场（Glitch Transition）

## JSON 输出格式
请严格按照以下格式输出：

\`\`\`json
{
  "title": "视频标题（根据歌词主题命名）",
  "musicInfo": {
    "bpm": 120,
    "emotion": "情感基调",
    "style": "音乐风格",
    "key": "调性"
  },
  "scenes": [
    {
      "sceneNumber": 1,
      "timestamp": "00:00-00:15",
      "duration": "15秒",
      "description": "详细的场景描述，包含地点、人物、动作、环境",
      "cameraMovement": "具体的镜头运动类型和说明，例如：推轨 + 摇臂上升，从地面推进至主角特写，展现情绪升级",
      "mood": "情绪氛围描述",
      "visualElements": [
        "光影设计：金色时光逆光",
        "色彩分级：暖色调橙黄色",
        "特效：镜头光晕",
        "粒子效果：漂浮的灰尘",
        "构图：浅景深背景虚化"
      ],
      "transition": "转场方式：交叉溶解过渡到下一场景"
    }
  ],
  "summary": "整体建议和创意方向，包含视觉风格统一性、叙事节奏、情感曲线、技术实现建议等"
}
\`\`\`

## 人物一致性要求（极其重要）
- 在 JSON 输出中增加一个顶层字段 "characterDescription"，详细描述主角的外观特征：性别、年龄、发型发色、五官特征、体型、服装风格、标志性配饰等
- 每个场景的 description 中必须重复描述主角的外观，确保 AI 生图时人物外观一致
- 主角的服装、发型、体型在所有场景中保持一致（除非剧情需要换装）
- 如果歌词中没有明确的人物描述，请根据歌词情感和风格创造一个合适的主角形象
${input.referenceImageUrl ? `
## 参考图风格
用户上传了参考图片，请在生成分镜时参考该图片的视觉风格、色彩、构图和氛围。
${input.referenceStyleDescription ? `参考图风格分析：${input.referenceStyleDescription}` : ''}
` : ''}
## 创意要求
1. **视觉叙事**：每个场景要与歌词内容和情感紧密结合，形成完整的视觉故事线
2. **节奏把控**：镜头运动和转场要与音乐节奏（BPM）相匹配
3. **情感曲线**：场景情绪要有起伏变化，符合歌曲的情感发展
4. **视觉统一**：整体色彩和风格要保持一致性，形成独特的视觉语言
5. **技术可行性**：建议的镜头和效果要考虑实际拍摄的可行性
6. **创意亮点**：每个视频要有 1-2 个视觉记忆点，让观众印象深刻
7. **人物一致性**：主角在所有场景中必须保持外观一致，包括发型、服装、体型、配饰等

请确保生成的分镜脚本专业、详细、具有电影感，能够直接用于视频拍摄指导。`
            },
            {
              role: "user",
              content: input.referenceImageUrl
                ? [
                    { type: "text" as const, text: `请根据以下歌词或文本内容，生成 ${input.sceneCount} 个视频分镜场景。同时参考附图的视觉风格、色彩和氛围：\n\n${input.lyrics}` },
                    { type: "image_url" as const, image_url: { url: input.referenceImageUrl, detail: "high" as const } },
                  ]
                : `请根据以下歌词或文本内容，生成 ${input.sceneCount} 个 视频分镜场景：\n\n${input.lyrics}`
            }
          ],
          response_format: { type: "json_object" },
          model: providerModel as any,
            });
            return { data: response };
          },
        });
        if (!llmResult.success) {
          return {
            success: false,
            error: llmResult.error,
            providerUsed: llmResult.providerUsed,
            jobId: llmResult.jobId,
            data: llmResult.data,
            fallback: llmResult.fallback,
          };
        }
        const response = llmResult.data;

        const storyboardData = JSON.parse(response.choices[0].message.content as string);
        
        // Generate preview images for all scenes in parallel
        const sceneImagePromises = storyboardData.scenes.map(async (scene: any) => {
          // Create a detailed prompt for image generation based on scene description
          // 人物一致性優化：提取主角外觀描述并在每个场景中重複使用
          const characterLock = storyboardData.characterDescription || "";
          const refStyleNote = input.referenceStyleDescription ? ` Reference style: ${input.referenceStyleDescription}.` : "";
          const stylePromptMap: Record<string, string> = {
            cinematic: "Cinematic film style, anamorphic lens, shallow depth of field, teal-orange color grading, dramatic volumetric lighting, 2.39:1 composition.",
            anime: "Japanese anime cel-shaded style, vibrant saturated colors, bold outlines, speed lines, sparkle effects, Studio Ghibli aesthetic.",
            documentary: "Documentary photography style, natural lighting, handheld camera feel, film grain, muted earth tones, photojournalistic composition.",
            realistic: "Hyper-realistic photography, natural colors, DSLR quality, accurate skin textures, soft natural daylight, lifestyle aesthetic.",
            scifi: "Sci-fi concept art style, neon lighting, holographic displays, cyberpunk color palette with teals and magentas, futuristic architecture.",
          };
          const styleNote = stylePromptMap[input.visualStyle] || stylePromptMap.cinematic;
          const imagePrompt = `${styleNote} ${scene.description}. ${scene.visualElements.join(", ")}. ${scene.mood} mood.${characterLock ? ` IMPORTANT - Main character consistency: ${characterLock}. The main character MUST look exactly the same across all scenes.` : ""}${refStyleNote} High quality, detailed, 16:9 aspect ratio.`;
          
          try {
            const imageResult = await generateGeminiImage({ prompt: imagePrompt, quality: "1k" });
            // 僅 trial199 / 免費帳號添加水印（管理員及正式加值包用戶跳過）
            let finalUrl = imageResult.imageUrl;
            if ((await resolveWatermark(userId, isAdminUser)) && imageResult.imageUrl) {
              try {
                const { addWatermarkToUrl } = await import("./watermark");
                const { storagePut } = await import("./storage");
                const wmBuf = await addWatermarkToUrl(imageResult.imageUrl, "bottom-right");
                const wmKey = `watermarked/${userId}/${Date.now()}-scene-${scene.sceneNumber}.png`;
                const wmUp = await storagePut(wmKey, wmBuf, "image/png");
                finalUrl = wmUp.url;
              } catch { /* fallback to original */ }
            }
            return { ...scene, previewImageUrl: finalUrl };
          } catch (error) {
            console.error(`Failed to generate preview image for scene ${scene.sceneNumber}:`, error);
            return { ...scene, previewImageUrl: null };
          }
        });
        
        // Wait for all images to be generated
        const scenesWithImages = await Promise.all(sceneImagePromises);
        storyboardData.scenes = scenesWithImages;
        
        // Increment usage count after successful generation
        await incrementUsageCount(userId, "storyboard");
        
        // Return storyboard data with preview images
        return { 
          success: true, 
          storyboard: storyboardData,
          message: "分镜脚本已生成！",
          providerUsed: llmResult.providerUsed,
          jobId: llmResult.jobId,
          data: { storyboard: storyboardData },
          fallback: llmResult.fallback,
        };
      }),

    // Export storyboard to PDF
    exportPDF: protectedProcedure
      .input(z.object({
        storyboard: z.object({
          title: z.string(),
          musicInfo: z.object({
            bpm: z.number(),
            emotion: z.string(),
            style: z.string(),
            key: z.string(),
          }),
          scenes: z.array(z.object({
            sceneNumber: z.number(),
            timestamp: z.string(),
            duration: z.string(),
            description: z.string(),
            cameraMovement: z.string(),
            mood: z.string(),
            visualElements: z.array(z.string()),
            transition: z.string().optional(),
            previewImageUrl: z.string().nullable().optional(),
          })),
          summary: z.string(),
        }),
        format: z.enum(["pdf", "word"]).default("pdf"),
      }))
      .mutation(async ({ input, ctx }) => {
        const { exportToPDF, exportToWord } = await import("./storyboard-export");
        const isAdminUser = ctx.user.role === "admin";
        const userTier = await resolveUserTier(ctx.user.id, isAdminUser);
        const shouldWatermark = await resolveWatermark(ctx.user.id, isAdminUser);

        // 试用包（trial-only / free）不支持任何格式的导出
        if (!isAdminUser && shouldWatermark) {
          throw new Error("試用包不支持 PDF/Word 導出功能，請升級至正式方案後使用。");
        }

        if (input.format === "word") {
          const result = await exportToWord(input.storyboard, { addWatermark: shouldWatermark });
          return { success: true, pdfUrl: result.url, message: result.message };
        }

        const result = await exportToPDF(input.storyboard, { addWatermark: shouldWatermark });
        return { success: true, pdfUrl: result.url, message: result.message };
      }),

    // Get pending storyboards for admin review
    getPendingReviews: protectedProcedure
      .query(async ({ ctx }) => {
        // Only admin can access pending reviews
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can access pending reviews");
        }
        return db.getPendingStoryboards(50);
      }),

    // Approve a storyboard
    approveStoryboard: protectedProcedure
      .input(z.object({ storyboardId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        // Only admin can approve storyboards
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can approve storyboards");
        }
        await db.updateStoryboardStatus(input.storyboardId, "approved", ctx.user.id);
        return { success: true };
      }),

    // Reject a storyboard
    rejectStoryboard: protectedProcedure
      .input(z.object({
        storyboardId: z.number(),
        rejectionReason: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        // Only admin can reject storyboards
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can reject storyboards");
        }
        await db.updateStoryboardStatus(
          input.storyboardId,
          "rejected",
          ctx.user.id,
          input.rejectionReason
        );
        return { success: true };
      }),

    // Get user's storyboards (for checking review status)
    getUserStoryboards: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getUserStoryboards(ctx.user.id, 20);
      }),

    // Batch approve storyboards
    batchApproveStoryboards: protectedProcedure
      .input(z.object({ storyboardIds: z.array(z.number()).min(1) }))
      .mutation(async ({ input, ctx }) => {
        // Only admin can approve storyboards
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can approve storyboards");
        }
        // Approve each storyboard
        for (const storyboardId of input.storyboardIds) {
          await db.updateStoryboardStatus(storyboardId, "approved", ctx.user.id);
        }
        return { success: true, count: input.storyboardIds.length };
      }),

    // Batch reject storyboards
    batchRejectStoryboards: protectedProcedure
      .input(z.object({
        storyboardIds: z.array(z.number()).min(1),
        rejectionReason: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        // Only admin can reject storyboards
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can reject storyboards");
        }
        // Reject each storyboard with the same reason
        for (const storyboardId of input.storyboardIds) {
          await db.updateStoryboardStatus(
            storyboardId,
            "rejected",
            ctx.user.id,
            input.rejectionReason
          );
        }
        return { success: true, count: input.storyboardIds.length };
      }),
    // AI 改写分镜脚本 - 用戶提供 3 句話修改意見，AI 重新生成
    rewrite: protectedProcedure
      .input(z.object({
        originalStoryboard: z.object({
          title: z.string(),
          musicInfo: z.object({
            bpm: z.number(),
            emotion: z.string(),
            style: z.string(),
            key: z.string(),
          }),
          scenes: z.array(z.object({
            sceneNumber: z.number(),
            timestamp: z.string(),
            duration: z.string(),
            description: z.string(),
            cameraMovement: z.string(),
            mood: z.string(),
            visualElements: z.array(z.string()),
            transition: z.string().optional(),
            previewImageUrl: z.string().nullable().optional(),
          })),
          summary: z.string(),
        }),
        userFeedback: z.string().min(1).max(500),
        visualStyle: z.enum(["cinematic", "anime", "documentary", "realistic", "scifi"]).default("cinematic"),
        model: z.enum(["flash", "gpt5", "pro"]).default("flash"),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";
        const userTier = await resolveUserTier(userId, isAdminUser);

        // 扣除 Credits（管理員免扣）
        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < CREDIT_COSTS.storyboardRewrite) {
            throw new Error(`Credits 不足，AI 改寫需要 ${CREDIT_COSTS.storyboardRewrite} Credits`);
          }
          await deductCredits(userId, "storyboardRewrite", "AI 改写分镜脚本");
        }

        const styleLabels: Record<string, string> = {
          cinematic: "电影感",
          anime: "动漫风",
          documentary: "紀錄片",
          realistic: "写实片",
          scifi: "科幻片",
        };

        const rewriteResult = await executeProviderFallback<Awaited<ReturnType<typeof invokeLLM>>>({
          apiName: "storyboard.rewrite.story",
          providers: getTierProviderChain(userTier, "text"),
          execute: async (provider) => {
            const providerModel =
              provider === "gpt_5_1" || provider === "veo3.1-pro"
                ? ("gpt5" as const)
                : provider === "gemini_3_pro" || provider === "nano-banana-pro"
                ? ("pro" as const)
                : ("flash" as const);
            const response = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `你是一位专业的视频导演。用户对之前生成的分镜脚本不满意，提供了修改意见。请根据用户的反馈，重新改写整个分镜脚本。

要求：
1. 保持原有的场景数量（${input.originalStoryboard.scenes.length} 个场景）
2. 视觉风格：${styleLabels[input.visualStyle] || "电影感"}
3. 根據用戶反饋大幅調整场景描述、镜头运动、情緒氛圍和视覺效果
4. 保持 JSON 格式輸出，與原始格式完全一致
5. 確保改寫后的腳本质量更高、更符合用戶期望

輸出格式與原始腳本相同的 JSON 结構。`
                },
                {
                  role: "user",
                  content: `原始分镜腳本：\n${JSON.stringify(input.originalStoryboard, null, 2)}\n\n用戶修改意見：\n${input.userFeedback}\n\n请根據以上修改意見，重新改寫整个分镜腳本。`
                }
              ],
              response_format: { type: "json_object" },
              model: providerModel as any,
            });
            return { data: response };
          },
        });
        if (!rewriteResult.success) {
          return {
            success: false,
            error: rewriteResult.error,
            providerUsed: rewriteResult.providerUsed,
            jobId: rewriteResult.jobId,
            data: rewriteResult.data,
            fallback: rewriteResult.fallback,
          };
        }
        const rewrittenData = JSON.parse(rewriteResult.data.choices[0].message.content as string);

        return {
          success: true,
          storyboard: rewrittenData,
          message: "分镜腳本已根據您的意見重新改寫！",
          providerUsed: rewriteResult.providerUsed,
          jobId: rewriteResult.jobId,
          data: { storyboard: rewrittenData },
          fallback: rewriteResult.fallback,
        };
      }),

    // AI Inspiration Generator - generate script from 3 sentences (Gemini, consumes Credits)
    generateInspiration: protectedProcedure
      .input(z.object({
        briefDescription: z.string().min(1).max(200),
      }))
      .mutation(async ({ input, ctx }) => {
        // 检查并扣除 Credits（管理员免扣）
        const { deductCredits, hasEnoughCredits } = await import("./credits");
        const userId = ctx.user.id;
        const userTier = await resolveUserTier(userId, ctx.user.role === "admin");

        const canAfford = await hasEnoughCredits(userId, "aiInspiration");
        if (!canAfford) {
          throw new Error("Credits 不足，无法使用 AI 灵感助手。请充值 Credits 后重试。");
        }

        await deductCredits(userId, "aiInspiration", "AI 灵感助手生成脚本 (Gemini)");

        const scriptResult = await executeProviderFallback<Awaited<ReturnType<typeof invokeLLM>>>({
          apiName: "storyboard.generateInspiration.script",
          providers: getTierProviderChain(userTier, "text"),
          execute: async (provider) => {
            const providerModel =
              provider === "gpt_5_1" || provider === "veo3.1-pro"
                ? ("gpt5" as const)
                : provider === "gemini_3_pro" || provider === "nano-banana-pro"
                ? ("pro" as const)
                : ("flash" as const);
            const response = await invokeLLM({
              messages: [
                {
                  role: "system",
                  content: `你是一位专业的视频创作助手，擅长将简短的灵感描述扩展成完整的视频脚本文本。

用户会给你一段简短的描述（通常 1-3 句话），你需要将它扩展成一个完整的视频脚本，包含：

1. **故事线**：明确的开头、发展、高潮、结尾
2. **场景描述**：具体的场景、时间、氛围
3. **情感表达**：情绪的起伏变化
4. **视觉元素**：色调、光影、特效建议

输出要求：
- 用中文书写
- 字数控制在 300-500 字
- 分段落书写，每段落代表一个场景
- 语言要有画面感，像电影剧本一样
- 不要加标题或分镜号，直接输出文本内容
- 可以适当加入对话、旁白、音乐描述`
                },
                {
                  role: "user",
                  content: `请根据以下灵感描述，扩展成一个完整的视频脚本文本：\n\n${input.briefDescription}`
                }
              ],
              model: providerModel as any,
            });
            return { data: response };
          },
        });
        if (!scriptResult.success) {
          return {
            success: false,
            error: scriptResult.error,
            providerUsed: scriptResult.providerUsed,
            jobId: scriptResult.jobId,
            data: scriptResult.data,
            fallback: scriptResult.fallback,
          };
        }

        const generatedText = scriptResult.data.choices[0].message.content as string;

        return {
          success: true,
          text: generatedText.trim(),
          message: "灵感脚本已生成！",
          providerUsed: scriptResult.providerUsed,
          jobId: scriptResult.jobId,
          data: { text: generatedText.trim() },
          fallback: scriptResult.fallback,
        };
      }),

    // AI 推荐 BGM 描述 - 使用 Gemini 3.0 Pro 分析分镜內容生成 BGM 描述
    recommendBGM: protectedProcedure
      .input(z.object({
        storyboard: z.object({
          title: z.string(),
          musicInfo: z.object({
            bpm: z.number(),
            emotion: z.string(),
            style: z.string(),
            key: z.string(),
          }),
          scenes: z.array(z.object({
            sceneNumber: z.number(),
            description: z.string(),
            mood: z.string(),
            visualElements: z.array(z.string()),
          })),
          summary: z.string(),
        }),
        model: z.enum(["pro", "gpt5"]).default("pro"),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < CREDIT_COSTS.recommendBGM) {
            throw new Error(`Credits 不足，AI 推薦 BGM 需要 ${CREDIT_COSTS.recommendBGM} Credits`);
          }
          await deductCredits(userId, "recommendBGM", `AI 推薦 BGM 描述 (${input.model === "gpt5" ? "GPT 5.1" : "Gemini 3.0 Pro"})`);
        }

        const sceneSummary = input.storyboard.scenes.map(s =>
          `场景${s.sceneNumber}: ${s.description} (情绪: ${s.mood})`
        ).join("\n");

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的影视配乐师和音乐总监。请根据分镜脚本的内容、情绪和音乐信息，生成一段详细的 BGM 描述，用于 Suno AI 音乐生成。

输出要求（严格 JSON 格式）：
{
  "title": "BGM 标题（英文，简洁有力）",
  "description": "用英文描述 BGM 的风格、情绪、节奏、乐器组合，适合 Suno AI 的 prompt 格式，200字以内",
  "style": "音乐风格标签（如 cinematic orchestral, electronic ambient, lo-fi hip hop 等）",
  "mood": "情绪标签（如 melancholic, uplifting, intense, dreamy 等）",
  "bpm": 推荐 BPM 数值,
  "instruments": ["主要乐器列表"],
  "duration": "推荐时长（如 2:30）"
}`
            },
            {
              role: "user",
              content: `请根据以下分镜脚本信息，生成适合的 BGM 描述：

标题：${input.storyboard.title}
音乐信息：BPM ${input.storyboard.musicInfo.bpm}, 情感 ${input.storyboard.musicInfo.emotion}, 风格 ${input.storyboard.musicInfo.style}, 调性 ${input.storyboard.musicInfo.key}

场景概要：
${sceneSummary}

整体建议：${input.storyboard.summary}`
            }
          ],
          response_format: { type: "json_object" },
          model: input.model === "gpt5" ? ("gpt5" as any) : ("pro" as any),
        });

        const bgmData = JSON.parse(response.choices[0].message.content as string);

        return {
          success: true,
          bgm: bgmData,
          message: "BGM 描述已生成！可直接用于 Suno 生成音乐。",
        };
      }),

    // 參考图風格分析 - 使用 Gemini Vision 分析上传的參考图片
    analyzeReferenceImage: protectedProcedure
      .input(z.object({
        imageUrl: z.string().url(),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < CREDIT_COSTS.referenceImageAnalysis) {
            throw new Error(`Credits 不足，參考图分析需要 ${CREDIT_COSTS.referenceImageAnalysis} Credits`);
          }
          await deductCredits(userId, "referenceImageAnalysis", "參考图風格分析 (Gemini Vision)");
        }

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是一位专业的视觉设计师和电影摄影师。请分析这张参考图片的视觉风格，输出一段英文描述，用于指导 AI 生成类似风格的分镜图片。

分析维度：
1. 色彩调性（color palette, grading）
2. 光影风格（lighting style）
3. 构图特点（composition）
4. 氛围感受（mood, atmosphere）
5. 艺术风格（art style, medium）
6. 特效元素（special effects, textures）

输出格式：一段 100-200 字的英文描述，可直接用于 AI 生图 prompt。不要加任何 JSON 或标记，直接输出纯文本。`
            },
            {
              role: "user",
              content: [
                { type: "text" as const, text: "请分析这张参考图片的视觉风格：" },
                { type: "image_url" as const, image_url: { url: input.imageUrl, detail: "high" as const } },
              ]
            }
          ],
        });

        const styleDescription = response.choices[0].message.content as string;

        return {
          success: true,
          styleDescription: styleDescription.trim(),
          message: "參考图風格分析完成！",
        };
      }),
  }),

  paymentSubmission: router({
    // Upload payment screenshot to S3
    uploadScreenshot: protectedProcedure
      .input(
        z.object({
          imageBase64: z.string().min(1),
          mimeType: z.string().default("image/jpeg"),
        })
      )
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.imageBase64, "base64");
        const { url } = await storagePut(
          `payment-screenshots/${Date.now()}.jpg`,
          buffer,
          input.mimeType
        );
        return { url };
      }),

    // Submit payment screenshot for review
    submit: protectedProcedure
      .input(
        z.object({
          packageType: z.string().min(1),
          amount: z.string().min(1),
          paymentMethod: z.string().optional(),
          screenshotUrl: z.string().url(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        await db.createPaymentSubmission({
          userId,
          packageType: input.packageType,
          amount: input.amount,
          paymentMethod: input.paymentMethod,
          screenshotUrl: input.screenshotUrl,
        });
        return { 
          success: true,
          message: "付款截屏已提交，正在等待人工审核..."
        };
      }),

    // Get user's payment submissions
    getUserPayments: protectedProcedure
      .query(async ({ ctx }) => {
        return db.getUserPayments(ctx.user.id, 50);
      }),

    // Get pending payments for admin review
    getPendingPayments: protectedProcedure
      .query(async ({ ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can access pending payments");
        }
        return db.getPendingPayments(50);
      }),

    // Approve a payment
    approvePayment: protectedProcedure
      .input(z.object({ paymentId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can approve payments");
        }
        
        // Get payment details to determine package type and user
        const payment = await db.getPaymentById(input.paymentId);
        
        if (!payment) {
          throw new Error("Payment not found");
        }
        
        // Update payment status
        await db.updatePaymentStatus(input.paymentId, "approved", ctx.user.id);
        
        // Grant usage credits based on package type
        const packageCredits = {
          basic: 4,      // 基础版：4次
          pro: 2,        // 专业版：2次
          enterprise: 30 // 企业版：30次（仿真月付无限次）
        };
        
        const credits = packageCredits[payment.packageType as keyof typeof packageCredits] || 0;
        
        if (credits > 0) {
          // Add credits to all three features
          const { decreaseUsageCount } = await import("../server/db-extended");
          await decreaseUsageCount(payment.userId, "storyboard", credits);
          await decreaseUsageCount(payment.userId, "analysis", credits);
          await decreaseUsageCount(payment.userId, "avatar", credits);
        }
        
        return { success: true };
      }),

    // Reject a payment
    rejectPayment: protectedProcedure
      .input(z.object({
        paymentId: z.number(),
        rejectionReason: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can reject payments");
        }
        await db.updatePaymentStatus(input.paymentId, "rejected", ctx.user.id, input.rejectionReason);
        return { success: true };
      }),

    // Batch approve payments
    batchApprovePayments: protectedProcedure
      .input(z.object({ paymentIds: z.array(z.number()) }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can batch approve payments");
        }
        
        const { decreaseUsageCount } = await import("../server/db-extended");
        
        const packageCredits = {
          basic: 4,      // 基础版：4次
          pro: 2,        // 专业版：2次
          enterprise: 30 // 企业版：30次（仿真月付无限次）
        };
        
        for (const paymentId of input.paymentIds) {
          // Get payment details for each payment ID
          const payment = await db.getPaymentById(paymentId);
          
          if (!payment) {
            continue; // Skip if payment not found
          }
          
          // Update payment status
          await db.updatePaymentStatus(paymentId, "approved", ctx.user.id);
          
          // Grant usage credits
          const credits = packageCredits[payment.packageType as keyof typeof packageCredits] || 0;
          
          if (credits > 0) {
            await decreaseUsageCount(payment.userId, "storyboard", credits);
            await decreaseUsageCount(payment.userId, "analysis", credits);
            await decreaseUsageCount(payment.userId, "avatar", credits);
          }
        }
        
        return { success: true, count: input.paymentIds.length };
      }),

    // Batch reject payments
    batchRejectPayments: protectedProcedure
      .input(z.object({
        paymentIds: z.array(z.number()),
        rejectionReason: z.string().min(1),
      }))
      .mutation(async ({ input, ctx }) => {
        if (ctx.user.role !== "admin") {
          throw new Error("Unauthorized: Only admins can batch reject payments");
        }
        for (const paymentId of input.paymentIds) {
          await db.updatePaymentStatus(paymentId, "rejected", ctx.user.id, input.rejectionReason);
        }
        return { success: true, count: input.paymentIds.length };
      }),
  }),

  guestbook: router({
    // Submit a new guestbook message (public, no auth required)
    submit: publicProcedure
      .input(
        z.object({
          name: z.string().min(1, "请输入姓名").max(100),
          email: z.string().email("请输入有效的电子邮件").max(320).optional().or(z.literal("")),
          phone: z.string().max(30).optional().or(z.literal("")),
          company: z.string().max(200).optional().or(z.literal("")),
          subject: z.string().min(1, "请选择咨询主题").max(255),
          message: z.string().min(1, "请输入咨询内容").max(5000),
        })
      )
      .mutation(async ({ input }) => {
        const data = {
          name: input.name,
          email: input.email || null,
          phone: input.phone || null,
          company: input.company || null,
          subject: input.subject,
          message: input.message,
        };
        const id = await db.createGuestbookMessage(data);
        return { success: true, id };
      }),

    // List recent guestbook messages (public)
    list: publicProcedure
      .input(z.object({ limit: z.number().min(1).max(100).default(20) }).optional())
      .query(async ({ input }) => {
        const limit = input?.limit ?? 20;
        return db.getGuestbookMessages(limit);
      }),
  }),

  // ─── 会员欢迎语生成 ──────────────────────────
  welcomeMessage: router({
    generate: protectedProcedure
      .input(z.object({
        planName: z.string(),
        userName: z.string().optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const displayName = input.userName || ctx.user.name || "创作者";

        const response = await invokeLLM({
          messages: [
            {
              role: "system",
              content: `你是 MV Studio Pro 的 AI 助手，一个一站式视频创作平台。请为新升级的会员生成一段个性化、热情的欢迎语。

要求：
1. 称呼用户名称，让他们感受到被重视
2. 根据方案等级提及专属功能亮点
3. 鼓励他们开始创作之旅
4. 语气热情但不过度夸张，像一个专业的音乐制作人在欢迎新团队成员
5. 使用繁体中文
6. 长度控制在 100-150 字以内
7. 可以加入 1-2 个音乐相关的 emoji

方案功能参考：
- 专业版：无限视频 PK 评分、偶像生成、分镜脚本、偶像转 3D、视频生成、500 Credits/月
- 企业版：所有专业版功能 + API 访问、团队席位、白标授权、专属客服、2000 Credits/月`,
            },
            {
              role: "user",
              content: `用户名称：${displayName}
升级方案：${input.planName}
请生成欢迎语。`,
            },
          ],
        });

        const rawContent = response.choices?.[0]?.message?.content;
        const msg = typeof rawContent === "string" ? rawContent : "";
        return {
          success: true,
          message: msg,
        };
      }),
  }),


  // === Restored routes from previous version ===

  admin: router({
    stats: adminProcedure.query(async () => getAdminStats()),
    creditBreakdown: adminProcedure.query(() => ({
      creditToCny: CREDIT_TO_CNY,
      packages: getProductPackageDisplayRows(),
    })),
    paymentList: adminProcedure.input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional() }).optional()).query(async ({ input }) => getPaymentSubmissions(input?.status)),
    paymentReview: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["approved", "rejected"]),
      rejectionReason: z.string().optional(),
      creditsToAdd: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      await updatePaymentSubmissionStatus(input.id, input.status, ctx.user.id, input.rejectionReason);
      if (input.status === "approved" && input.creditsToAdd) {
        // Find the payment submission to get userId
        const submissions = await getPaymentSubmissions("approved", 100);
        const sub = submissions.find(s => s.id === input.id);
        if (sub) await addCredits(sub.userId, input.creditsToAdd, "payment", "付款審核通過");
      }
      return { success: true };
    }),
    storyboardList: adminProcedure.query(async () => getAllStoryboards()),
    storyboardReview: adminProcedure.input(z.object({
      id: z.number(),
      status: z.enum(["approved", "rejected"]),
      rejectionReason: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      await updateStoryboardStatus(input.id, input.status, ctx.user.id, input.rejectionReason);
      return { success: true };
    }),
    betaList: adminProcedure.query(async () => getAllBetaQuotas()),
    betaGrant: adminProcedure.input(z.object({
      userId: z.number(),
      totalQuota: z.number().default(20),
      note: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const inviteCode = nanoid(8).toUpperCase();
      await createBetaQuota({ userId: input.userId, feature: 'beta', totalQuota: input.totalQuota });
      return { success: true, inviteCode };
    }),
     teamList: adminProcedure.query(async () => getAllTeams()),
  }),

  audioLab: router({
    /** Check if Gemini audio analysis is available */
    status: publicProcedure.query(() => ({ available: isGeminiAudioAvailable() })),

    /** Analyze uploaded audio with Gemini */
    analyze: protectedProcedure.input(z.object({
      audioUrl: z.string().url(),
      fileName: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      // Gemini audio analysis costs credits
      if (!isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, "audioAnalysis");
        if (!deduction.success) return { success: false as const, error: "Credits 不足，请充值后再试" };
      }

      const audioResult = await executeProviderFallback({
        apiName: "audioLab.analyze.audio",
        execute: async (provider) => {
          if (provider === "fal.ai" && !process.env.FAL_API_KEY) {
            throw new Error("fal.ai unavailable: FAL_API_KEY is not configured");
          }
          const analysis = await analyzeAudioWithGemini(input.audioUrl);
          return { data: analysis };
        },
      });
      if (audioResult.success) {
        return {
          success: true as const,
          analysis: audioResult.data,
          providerUsed: audioResult.providerUsed,
          jobId: audioResult.jobId,
          data: { analysis: audioResult.data },
          fallback: audioResult.fallback,
        };
      }

      try {
        if (!isAdmin(ctx.user)) {
          await refundCredits(
            ctx.user.id,
            CREDIT_COSTS.audioAnalysis,
            "音频分析·生成失败·退回已扣积分",
          );
        }
        return {
          success: false as const,
          error: audioResult.error || "音频分析失败",
          providerUsed: audioResult.providerUsed,
          jobId: audioResult.jobId,
          data: audioResult.data,
          fallback: audioResult.fallback,
        };
      } catch (err: any) {
        return { success: false as const, error: err.message || "音频分析失败" };
      }
    }),

    /** Generate storyboard from audio analysis result */
    generateStoryboard: protectedProcedure.input(z.object({
      lyrics: z.string(),
      bpm: z.number(),
      bpmRange: z.string(),
      overallMood: z.string(),
      genre: z.string(),
      sections: z.array(z.object({
        name: z.string(),
        timeRange: z.string(),
        mood: z.string(),
        energy: z.string(),
        instruments: z.string(),
        rhythmPattern: z.string(),
        lyrics: z.string().optional(),
      })),
      suggestedColorPalette: z.string(),
      suggestedVisualStyle: z.string(),
      instrumentation: z.string(),
      sceneCount: z.number().min(2).max(20).default(8),
    })).mutation(async ({ ctx, input }) => {
      // Uses storyboard credits (same as normal storyboard)
      if (!isAdmin(ctx.user)) {
        const usage = await checkUsageLimit(ctx.user.id, "storyboard");
        if (!usage.allowed) {
          const deduction = await deductCredits(ctx.user.id, "storyboard");
          if (!deduction.success) return { success: false, error: "Credits 不足" };
        } else {
          await incrementUsageCount(ctx.user.id, "storyboard");
        }
      }

      const sectionInfo = input.sections.map(s => `[${s.name}] ${s.timeRange} | 情绪: ${s.mood} | 能量: ${s.energy} | 乐器: ${s.instruments} | 节奏: ${s.rhythmPattern}${s.lyrics ? ` | 歌词: ${s.lyrics}` : ""}`).join("\n");

      const systemPrompt = `你是一位世界级的 MV 导演、电影摄影指导和分镜师。
根据 AI 对歌曲的音频分析结果，生成 ${input.sceneCount} 个专业级分镜场景。

【歌曲分析数据】
- BPM: ${input.bpm}（范围 ${input.bpmRange}）
- 整体情绪: ${input.overallMood}
- 音乐风格: ${input.genre}
- 乐器编排: ${input.instrumentation}
- 建议色彩: ${input.suggestedColorPalette}
- 建议视觉风格: ${input.suggestedVisualStyle}

【歌曲段落结构】
${sectionInfo}

【歌词】
${input.lyrics || "（纯音乐，无歌词）"}

【每个分镜必须包含以下维度】
1. 场景编号与时间段（对应歌曲段落）
2. 画面描述（场景环境、空间布局、视觉元素）
3. 灯光设计（主光源方向、色温冷暖、光影对比、补光方式、特殊光效）
4. 人物表情（面部微表情、眼神方向、情绪传达）
5. 人物动作（肢体动作、手势、身体姿态、运动轨迹）
6. 人物神态（内心状态、气质表现、情绪张力）
7. 人物互动（角色之间的空间关系、眼神交流、肢体接触）
8. 摄影机位（远景/全景/中景/近景/特写/大特写）
9. 镜头运动（推/拉/摇/移/跟/升降/手持/航拍/旋转）
10. 色调与调色（整体色调、色彩倾向、对比度、饱和度）
11. 配乐节奏（对应段落的BPM、节奏强弱、音乐情绪）
12. 情绪氛围（整体情绪基调、氛围营造手法）
13. 对应歌词段落
14. 分镜图提示词（英文prompt，包含场景、灯光、人物、构图等关键视觉信息）

请根据歌曲的节奏变化、情绪起伏和段落结构来安排分镜节奏，确保视觉叙事与音乐完美同步。`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `请根据以上歌曲分析数据生成 ${input.sceneCount} 个分镜场景` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "audio_storyboard",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string", description: "分镜脚本标题" },
                overallMood: { type: "string", description: "整体情绪基调" },
                suggestedBPM: { type: "string", description: "配乐BPM" },
                colorPalette: { type: "string", description: "色彩方案" },
                scenes: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      sceneNumber: { type: "integer" },
                      timeRange: { type: "string" },
                      description: { type: "string" },
                      lighting: { type: "string" },
                      characterExpression: { type: "string" },
                      characterAction: { type: "string" },
                      characterDemeanor: { type: "string" },
                      characterInteraction: { type: "string" },
                      shotType: { type: "string" },
                      cameraMovement: { type: "string" },
                      colorTone: { type: "string" },
                      bpm: { type: "string" },
                      mood: { type: "string" },
                      lyrics: { type: "string" },
                      imagePrompt: { type: "string" },
                    },
                    required: ["sceneNumber", "timeRange", "description", "lighting", "characterExpression", "characterAction", "characterDemeanor", "characterInteraction", "shotType", "cameraMovement", "colorTone", "bpm", "mood", "lyrics", "imagePrompt"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["title", "overallMood", "suggestedBPM", "colorPalette", "scenes"],
              additionalProperties: false,
            },
          },
        },
      });

      const storyboardData = String(response.choices[0].message.content ?? "{}");
      const parsed = JSON.parse(storyboardData);
      const id = await createStoryboard({ userId: ctx.user.id, lyrics: input.lyrics || "（音频分析生成）", sceneCount: input.sceneCount, storyboard: storyboardData });

      // Auto-generate storyboard images for each scene using nano-banana-flash (1K)
      const scenesWithImages = await Promise.all(
        (parsed.scenes || []).map(async (scene: any) => {
          try {
            const imageResult = await generateGeminiImage({
              prompt: `Cinematic MV storyboard frame: ${scene.imagePrompt}. Professional film quality, 16:9 aspect ratio, detailed lighting.`,
              quality: "1k",
            });
            return { ...scene, generatedImageUrl: imageResult.imageUrl };
          } catch {
            return { ...scene, generatedImageUrl: null };
          }
        })
      );
      parsed.scenes = scenesWithImages;

      // Auto-record storyboard creation
      try {
        const plan = await getUserPlan(ctx.user.id);
        await recordCreation({
          userId: ctx.user.id,
          type: "storyboard",
          title: parsed.title || "分镜腳本",
          outputUrl: parsed.scenes?.[0]?.previewImageUrl ?? undefined,
          metadata: {
            sceneCount: input.sceneCount,
            overallMood: parsed.overallMood,
            script: parsed.scenes?.map((s: any) => `Scene ${s.sceneNumber}: ${s.description || s.script || ""}`).join("\n"),
            fullScript: parsed,
          },
          quality: `${input.sceneCount} 场景`,
          creditsUsed: 0,
          plan,
        });
      } catch (e) { console.error("[Storyboard] recordCreation failed:", e); }

      return { success: true, id, storyboard: parsed };
    }),
  }),

  community: router({
    /** 获取视频评论列表 */
    getComments: publicProcedure.input(z.object({ videoUrl: z.string() })).query(async ({ input }) => {
      return getVideoComments(input.videoUrl);
    }),
    /** 发表评论 */
    addComment: protectedProcedure.input(z.object({
      videoUrl: z.string(),
      content: z.string().min(1).max(500),
      parentId: z.number().optional(),
    })).mutation(async ({ ctx, input }) => {
      const commentId = await addVideoComment({
        videoUrl: input.videoUrl,
        userId: ctx.user.id,
        parentId: input.parentId,
        content: input.content,
      });
      return { success: true, commentId };
    }),
    /** 删除评论（仅自己的） */
    deleteComment: protectedProcedure.input(z.object({ commentId: z.number() })).mutation(async ({ ctx, input }) => {
      await deleteVideoComment(input.commentId, ctx.user.id);
      return { success: true };
    }),
    /** 点赞/取消点赞视频 */
    toggleVideoLike: protectedProcedure.input(z.object({ videoUrl: z.string() })).mutation(async ({ ctx, input }) => {
      return toggleVideoLike(input.videoUrl, ctx.user.id);
    }),
    /** 获取视频点赞状态 */
    getVideoLikeStatus: protectedProcedure.input(z.object({ videoUrl: z.string() })).query(async ({ ctx, input }) => {
      return getVideoLikeStatus(input.videoUrl, ctx.user.id);
    }),
    /** 点赞/取消点赞评论 */
    toggleCommentLike: protectedProcedure.input(z.object({ commentId: z.number() })).mutation(async ({ ctx, input }) => {
      return toggleCommentLike(input.commentId, ctx.user.id);
    }),
    /** 获取用户对评论的点赞状态 */
    getUserCommentLikes: protectedProcedure.input(z.object({ commentIds: z.array(z.number()) })).query(async ({ ctx, input }) => {
      return getUserCommentLikes(ctx.user.id);
    }),
    /** 生成分享链接 */
    generateShareLink: publicProcedure.input(z.object({
      videoUrl: z.string(),
      title: z.string().optional(),
    })).query(async ({ input }) => {
      const shareId = Buffer.from(input.videoUrl).toString('base64url').slice(0, 32);
      return {
        shareId,
        shareUrl: `/share/${shareId}`,
        videoUrl: input.videoUrl,
        title: input.title || 'MV Studio Pro 作品',
      };
    }),
  }),

  credits: router({
    balance: protectedProcedure.query(async ({ ctx }) => {
      const b = await getOrCreateBalance(ctx.user.id);
      return { balance: b.balance, lifetimeEarned: b.lifetimeEarned, lifetimeSpent: b.lifetimeSpent };
    }),
    transactions: protectedProcedure.query(async ({ ctx }) => getCreditTransactions(ctx.user.id)),
    usage: protectedProcedure.query(async ({ ctx }) => {
      const [storyboard, analysis, avatar] = await Promise.all([
        getOrCreateUsageTracking(ctx.user.id, "storyboard"),
        getOrCreateUsageTracking(ctx.user.id, "analysis"),
        getOrCreateUsageTracking(ctx.user.id, "avatar"),
      ]);
      return { storyboard, analysis, avatar };
    }),
  }),

  veo: router({
    /** Check if Veo API is available */
    status: publicProcedure.query(() => ({ available: isVeoAvailable() })),

    /** Generate video from storyboard scene */
    generate: protectedProcedure.input(z.object({
      prompt: z.string().min(1).max(2000),
      imageUrl: z.string().url().optional(),
      quality: z.enum(["fast", "standard"]).default("fast"),
      resolution: z.enum(["720p", "1080p"]).default("720p"),
      aspectRatio: z.enum(["16:9", "9:16"]).default("16:9"),
      emotionFilter: z.string().optional(),
      transition: z.string().optional(),
      storyboardId: z.number().optional(),
      negativePrompt: z.string().optional(),
    })).mutation(async ({ ctx, input }) => {
      const userTier = await resolveUserTier(ctx.user.id, isAdmin(ctx.user));
      // Determine credit cost based on quality + resolution
      const costKey = `videoGeneration${input.quality === "fast" ? "Fast" : "Std"}${input.resolution === "1080p" ? "1080" : "720"}` as keyof typeof CREDIT_COSTS;
      let creditsUsed = 0;
      if (!isAdmin(ctx.user)) {
        const deduction = await deductCredits(ctx.user.id, costKey);
        if (!deduction.success) {
          return { success: false, error: "Credits 不足，请充值后再试" };
        }
        creditsUsed = deduction.cost;
      }

      // Create DB record
      const genId = (await createVideoGeneration({
        userId: ctx.user.id,
        storyboardId: input.storyboardId ?? null,
        prompt: input.prompt,
        imageUrl: input.imageUrl ?? null,
        quality: input.quality,
        resolution: input.resolution,
        aspectRatio: input.aspectRatio,
        emotionFilter: input.emotionFilter ?? null,
        transition: input.transition ?? null,
        status: "generating",
        creditsUsed,
      })) as unknown as number;

      const videoResult = await executeProviderFallback<{
        videoUrl: string;
        mimeType?: string;
      }>({
        apiName: "veo.generate.video",
        providers: getTierProviderChain(userTier, "video"),
        execute: async (provider) => {
          if (provider === "fal_kling_video" || provider === "fal.ai") {
            const { falKlingSubmit } = await import("./kling/fal-proxy");
            const endpoint = input.imageUrl ? "v3-pro-i2v" : "v3-pro-t2v";
            const falResult = await falKlingSubmit(
              endpoint,
              {
                prompt: input.prompt,
                ...(input.imageUrl ? { image_url: input.imageUrl } : {}),
                aspect_ratio: input.aspectRatio,
                duration: 5,
                negative_prompt: input.negativePrompt,
              },
              () => undefined
            );
            const videoUrl = falResult.video?.url;
            if (!videoUrl) {
              throw new Error("fal.ai video generation succeeded but no video URL returned");
            }
            return { data: { videoUrl, mimeType: falResult.video?.content_type || "video/mp4" }, jobId: falResult.request_id || null };
          }

          if (provider === "kling_beijing") {
            const kling = await generateKlingBeijingVideo({
              prompt: input.prompt,
              imageUrl: input.imageUrl,
              aspectRatio: input.aspectRatio,
              negativePrompt: input.negativePrompt,
            });
            return {
              data: { videoUrl: kling.videoUrl, mimeType: kling.mimeType },
              jobId: kling.jobId,
            };
          }

          if (provider === "cometapi") {
            const hasComet = Boolean(process.env.COMETAPI_API_KEY || process.env.COMET_API_KEY || process.env.COMETAPI_KEY);
            if (!hasComet) {
              throw new Error("cometapi unavailable: API key is not configured");
            }
            throw new Error("cometapi fallback is configured but not integrated in this deployment");
          }

          const result = await generateVideo({
            prompt: input.prompt,
            imageUrl: input.imageUrl,
            quality: provider === "veo3.1-pro" || provider === "veo_3_1" ? "standard" : input.quality,
            resolution: input.resolution,
            aspectRatio: input.aspectRatio,
            negativePrompt: input.negativePrompt,
          });
          return { data: result };
        },
      });

      if (videoResult.success) {
        const result = videoResult.data;

        await updateVideoGeneration(genId, {
          videoUrl: result.videoUrl,
          status: "completed",
          completedAt: new Date(),
        });

        // 注册平台原创视频签名（用于 PK 评分验证）
        try {
          await registerOriginalVideo(ctx.user.id, result.videoUrl, genId);
        } catch (sigErr) {
          console.error("[Veo] Failed to register video signature:", sigErr);
        }

        return {
          success: true,
          id: genId,
          videoUrl: result.videoUrl,
          providerUsed: videoResult.providerUsed,
          jobId: videoResult.jobId,
          data: { videoUrl: result.videoUrl },
          fallback: videoResult.fallback,
        };
      }

      if (creditsUsed > 0) {
        await refundCredits(ctx.user.id, creditsUsed, "视频生成·失败·退回已扣积分");
      }
      await updateVideoGeneration(genId, {
        status: "failed",
        errorMessage: videoResult.error || "Unknown error",
      });
      return {
        success: false,
        error: videoResult.error || "视频生成失败，请稍后重试",
        providerUsed: videoResult.providerUsed,
        jobId: videoResult.jobId,
        data: videoResult.data,
        fallback: videoResult.fallback,
      };
    }),

    /** Get user's video generation history */
    myList: protectedProcedure.query(async ({ ctx }) => {
      return getVideoGenerationsByUserId(ctx.user.id);
    }),

    /** Get single video generation by ID */
    get: protectedProcedure.input(z.object({ id: z.number() })).query(async ({ ctx, input }) => {
      const gen = await getVideoGenerationById(input.id);
      if (!gen || (gen as any).userId !== ctx.user.id) return null;
      return gen;
    }),
  }),

  /** Vertex Imagen 图片高清放大（积分 = 原图单价 × 3 或 ×5） */
  vertexImage: router({
    upscale: protectedProcedure
      .input(
        z.object({
          imageUrl: z.string().min(1),
          upscaleFactor: z.enum(["x2", "x4"]),
          baseCreditKey: z.string().refine(
            (v): v is ImageUpscaleBaseCreditKey =>
              (IMAGE_UPSCALE_BASE_CREDIT_KEYS as readonly string[]).includes(v),
            { message: "invalid_base_credit_key" },
          ),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const isAdminUser = ctx.user.role === "admin";
        const creditsNeeded = imageUpscaleTotalCredits(
          input.baseCreditKey as ImageUpscaleBaseCreditKey,
          input.upscaleFactor,
        );

        if (!isAdminUser) {
          try {
            await deductCreditsAmount(
              ctx.user.id,
              creditsNeeded,
              "imageUpscale",
              `图片高清放大 ${input.upscaleFactor}（基准 ${input.baseCreditKey}）`,
            );
          } catch (e: any) {
            return { success: false as const, error: e?.message || "Credits 不足，请充值后再试" };
          }
        }

        // 优先在 Fly 直接走 GCS 长任务（2x/4x 同一路径，300s 与 GCS 轮询一致）；无凭据时回退 Vercel
        const hasVertexCreds = Boolean(String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim());
        const vercelBaseUrl = String(process.env.VERCEL_APP_URL || "https://mvstudiopro.vercel.app").replace(/\/$/, "");
        const safeToken = String(process.env.VERCEL_ACCESS_TOKEN || process.env.VERCEL_TOKEN || "").trim();

        let imageUrl = "";
        let upscaleOk = false;

        if (hasVertexCreds) {
          try {
            const result = await runVertexUpscaleImage({
              imageUrl: input.imageUrl,
              upscaleFactor: input.upscaleFactor,
              prompt: "",
              outputMimeType: "image/png",
            });
            imageUrl = String(result?.imageUrl || (Array.isArray(result?.imageUrls) ? result.imageUrls[0] : "") || "").trim();
            upscaleOk = result.ok && !!imageUrl;
            if (!upscaleOk) {
              console.error(`[vertexImage.upscale] ${input.upscaleFactor} (direct) failed:`, result?.error);
            }
          } catch (e: any) {
            console.error("[vertexImage.upscale] direct GCS path failed:", e?.message);
          }
        } else {
          try {
            const res = await fetch(`${vercelBaseUrl}/api/google?op=upscaleImage`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                ...(safeToken ? { Authorization: `Bearer ${safeToken}` } : {}),
              },
              body: JSON.stringify({
                imageUrl: input.imageUrl,
                upscaleFactor: input.upscaleFactor,
                prompt: "",
                outputMimeType: "image/png",
              }),
              signal: AbortSignal.timeout(300_000),
            });
            const json: any = await res.json().catch(() => ({}));
            imageUrl = String(json?.imageUrl || (Array.isArray(json?.imageUrls) ? json.imageUrls[0] : "") || "").trim();
            upscaleOk = res.ok && !!imageUrl;
            if (!upscaleOk) {
              const vertexErr = String(json?.error || json?.raw?.error?.message || "").slice(0, 300);
              console.error(`[vertexImage.upscale] ${input.upscaleFactor} (vercel) failed (HTTP ${res.status}): ${vertexErr}`);
            }
          } catch (e: any) {
            console.error("[vertexImage.upscale] vercel proxy failed:", e?.message);
          }
        }

        if (!upscaleOk || !imageUrl) {
          if (!isAdminUser) {
            try {
              await refundCredits(ctx.user.id, creditsNeeded, "图片放大·失败·退回已扣积分");
            } catch (refErr) {
              console.error("[vertexImage.upscale] restore credits failed", refErr);
            }
          }
          return { success: false as const, error: "放大失败，请稍后重试（已退回积分）" };
        }

        return {
          success: true as const,
          imageUrl,
          creditsUsed: isAdminUser ? 0 : creditsNeeded,
          upscaleFactor: input.upscaleFactor,
        };
      }),
  }),

  /** GPT-image-2 生图（TestLab 调试用，走 Fly 直连 OpenAI） */
  openaiImage: router({
    generate: publicProcedure
      .input(z.object({
        prompt: z.string().min(1),
        model: z.string().optional(),
        size: z.string().optional(),
        quality: z.string().optional(),
        output_format: z.string().optional(),
        output_compression: z.number().optional(),
        n: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiKey = String(process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim();
        if (!apiKey) return { ok: false as const, error: "Missing OPENAI_IMAGE_API_KEY on server" };
        const body: Record<string, unknown> = {
          model: input.model || "gpt-image-2",
          prompt: input.prompt,
          n: input.n || 1,
          size: input.size || "1024x1024",
          quality: input.quality || "high",
          output_format: input.output_format || "png",
        };
        if ((input.output_format === "jpeg" || input.output_format === "webp") && input.output_compression != null) {
          body.output_compression = input.output_compression;
        }
        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(120_000),
          });
        } catch (e: any) {
          return { ok: false as const, error: e?.message || "fetch failed" };
        }
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          const errMsg = String(json?.error?.message || `HTTP ${res.status}`);
          console.error("[openaiImage.generate] failed:", errMsg);
          return { ok: false as const, error: errMsg };
        }
        const items: Array<{ b64_json?: string; url?: string }> = Array.isArray(json?.data) ? json.data : [];
        const { put } = await import("@vercel/blob");
        const imageUrls: string[] = [];
        for (const item of items) {
          if (item.url) { imageUrls.push(item.url); continue; }
          if (item.b64_json) {
            try {
              const buf = Buffer.from(item.b64_json, "base64");
              const blob = await put(`gpt-image-${Date.now()}.png`, buf, { access: "public", contentType: "image/png" });
              imageUrls.push(blob.url);
            } catch {
              imageUrls.push(`data:image/png;base64,${item.b64_json}`);
            }
          }
        }
        if (imageUrls.length === 0) return { ok: false as const, error: "no image in response" };
        return { ok: true as const, imageUrl: imageUrls[0], imageUrls };
      }),

    /** 竞品图片视觉分析（调用 gpt-4.1-mini vision） */
    analyze: publicProcedure
      .input(z.object({
        imageUrl: z.string().min(1),
        question: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiKey = String(process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim();
        if (!apiKey) return { ok: false as const, error: "Missing OPENAI_API_KEY" };

        const question = input.question ||
          "请详细分析这张图片的视觉风格、色彩搭配、构图特点、情绪氛围，以及创作者可以借鉴的核心元素。用简体中文回答，分点说明。";

        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
            body: JSON.stringify({
              model: "gpt-5.4",
              input: [{
                role: "user",
                content: [
                  { type: "input_text", text: question },
                  { type: "input_image", image_url: input.imageUrl },
                ],
              }],
            }),
            signal: AbortSignal.timeout(60_000),
          });
        } catch (e: any) {
          return { ok: false as const, error: e?.message || "fetch failed" };
        }

        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false as const, error: String(json?.error?.message || `HTTP ${res.status}`) };
        }

        const text = String(json?.output_text || "").trim();
        if (!text) return { ok: false as const, error: "no analysis returned" };
        return { ok: true as const, analysis: text };
      }),

    /** 图片编辑（gpt-image-2 edit endpoint，用现有图 + 新 prompt 修改） */
    edit: publicProcedure
      .input(z.object({
        imageUrl: z.string().min(1),
        prompt: z.string().min(1),
        size: z.string().optional(),
        quality: z.string().optional(),
        output_format: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const apiKey = String(process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim();
        if (!apiKey) return { ok: false as const, error: "Missing OPENAI_API_KEY" };

        // 下载原图为 Buffer
        let imgBuf: Buffer;
        try {
          const imgRes = await fetch(input.imageUrl, { signal: AbortSignal.timeout(30_000) });
          if (!imgRes.ok) return { ok: false as const, error: `download image failed: ${imgRes.status}` };
          imgBuf = Buffer.from(await imgRes.arrayBuffer());
        } catch (e: any) {
          return { ok: false as const, error: `download image error: ${e?.message}` };
        }

        // 构建 multipart/form-data
        const boundary = `----FormBoundary${Date.now()}`;
        const crlf = "\r\n";
        const parts: Buffer[] = [];

        const addField = (name: string, value: string) => {
          parts.push(Buffer.from(
            `--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`
          ));
        };

        addField("model", "gpt-image-2");
        addField("prompt", input.prompt);
        if (input.size) addField("size", input.size);
        if (input.quality) addField("quality", input.quality);
        if (input.output_format) addField("output_format", input.output_format);

        // 图片 part
        const ext = (input.output_format === "jpeg" ? "jpg" : (input.output_format || "png"));
        const mime = ext === "jpg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png";
        parts.push(Buffer.from(
          `--${boundary}${crlf}Content-Disposition: form-data; name="image[]"; filename="image.${ext}"${crlf}Content-Type: ${mime}${crlf}${crlf}`
        ));
        parts.push(imgBuf);
        parts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

        const body = Buffer.concat(parts);

        let res: Response;
        try {
          res = await fetch("https://api.openai.com/v1/images/edits", {
            method: "POST",
            headers: {
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
              Authorization: `Bearer ${apiKey}`,
            },
            body,
            signal: AbortSignal.timeout(180_000),
          });
        } catch (e: any) {
          return { ok: false as const, error: e?.message || "fetch failed" };
        }

        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          return { ok: false as const, error: String(json?.error?.message || `HTTP ${res.status}`) };
        }

        const items: Array<{ b64_json?: string; url?: string }> = Array.isArray(json?.data) ? json.data : [];
        const { put } = await import("@vercel/blob");
        const imageUrls: string[] = [];
        for (const item of items) {
          if (item.url) { imageUrls.push(item.url); continue; }
          if (item.b64_json) {
            try {
              const buf = Buffer.from(item.b64_json, "base64");
              const blob = await put(`gpt-edit-${Date.now()}.png`, buf, { access: "public", contentType: "image/png" });
              imageUrls.push(blob.url);
            } catch {
              imageUrls.push(`data:image/png;base64,${item.b64_json}`);
            }
          }
        }
        if (imageUrls.length === 0) return { ok: false as const, error: "no image in response" };
        return { ok: true as const, imageUrl: imageUrls[0] };
      }),
  }),

});

export type AppRouter = typeof appRouter;
