import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { COOKIE_NAME, TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, protectedProcedure, adminProcedure, router } from "./_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "./db";
import * as sessionDb from "./sessionDb";
import {
  extractFirstChoicePlainText,
  extractJsonString,
  getOpenAiGpt5ReasoningEffortDiagnostics,
  invokeLLM,
  truncateForMemory,
} from "./_core/llm";
import {
  getPlatformStage2OpenAiModel,
  resolvePlatformStage2LlmMode,
  resolvePlatformStage2OpenAiReasoningEffort,
  resolveSupervisorTopicCoverPixelEngineInput,
  type PlatformStage2LlmMode,
} from "./config/platformSwitches.js";
import {
  callGemini35FlashCopywriting,
  GEMINI_35_FLASH_COPYWRITING_MAX_OUTPUT_TOKENS,
  resolveGemini35FlashCopywritingMaxOutputTokens,
  resolvePlatformStage2GeminiModel,
} from "./services/gemini35FlashRuntime.js";
import { storagePut, storageGet } from "./storage";
import { usageRouter, incrementUsageCount } from "./routers/usage";
import { phoneRouter } from "./routers/phone";
import { studentRouter } from "./routers/student";
import { paymentRouter } from "./routers/payment";
import { emailAuthRouter } from "./routers/emailAuth";
import { betaRouter } from "./routers/beta";
import { betaCodeRouter } from "./routers/betaCode";
import { isValidSupervisorSecret, resolvePlatformSupervisorOpsAllowed } from "./services/access-policy";
import {
  buildIndustryGrowthHintMap,
  filterTrackGrowthHotOnly,
  reconcilePlatformHotTopicsWithGlobalTrackGrowth,
  repairTrackGrowthRows,
} from "./services/visualReportTrackGrowth";
import { feedbackRouter } from "./routers/feedback";
import { paidTrafficReviewsRouter } from "./routers/paidTrafficReviews";
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
import { enterpriseAgentsRouter } from "./routers/enterpriseAgents";
import { buildAuthorAnalysis, buildGrowthSnapshotFromCollections, buildMockGrowthSnapshot, buildPlatformSupportActivities, normalizePlatforms } from "./growth/growthSchema";
import { analyzeDocument } from "./growth/analyzeDocument";
import { analyzeGrowthCampImages } from "./growth/analyzeGrowthCampImages";
import { synthesizeGrowthAnalyses } from "./growth/synthesizeGrowthAnalyses";
import { analyzeVideo } from "./growth/analyzeVideo";
import { resolveGrowthCampExtractorModel, resolveGrowthCampPipelineMode, resolveGrowthCampStrategistModel } from "./growth/extractorPipeline";
import { buildPremiumRemixPlan, generatePremiumRemixAssets } from "./growth/premiumRemix";
import { collectTrendPlatforms, type TrendItem } from "./growth/trendCollector";
import { exportTrendCollectionsCsv, getGrowthTrendStats, isTrendCollectionStale, mergeTrendCollections, readGrowthDebugSummary, readGrowthRuntimeControl, readGrowthStatusSnapshot, readTrendRuntimeMeta, readTrendSchedulerState, readTrendStore, readTrendStoreForPlatforms, reconcileTrendHistoryState, updateTrendSchedulerState, writeGrowthRuntimeControl } from "./growth/trendStore";
import { selectByGrowthPotential } from "./growth/trendGrowthScoring.js";
import { summarizeTrendWindowCounts } from "./growth/trendWindow";
import { filterTrendItemsWithEngagementFloor } from "./services/trendEngagementVisualBrief.js";
import {
  BLUE_OCEAN_USAGE_POLICY,
  buildBlueOceanLexicon,
  deriveTagCandidatesFromTrendSamples,
} from "../shared/blueOceanLexicon.js";
import {
  PLATFORM_AUDIENCE_PAIN_DIMENSION_EXTRA,
  PLATFORM_HOOK_SOLUTION_CONSULTATION_GUIDANCE,
  PLATFORM_REVIEW_SAFE_VOICE_GUIDANCE,
  buildKnowledgeMonetizationConstraint,
  needsReviewSafeVoice,
} from "../shared/platformCreatorInsightFraming.js";
import {
  PLATFORM_CULTURAL_MATERIAL_DIVERSITY_GUIDANCE,
  needsCulturalMaterialDiversity,
} from "../shared/platformCulturalMaterialDiversity.js";
import { STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH } from "../shared/storyboardLightingEmotion.js";
import {
  normalizePlatformVariants,
  PLATFORM_NATIVE_VARIANTS_SCHEMA_HINT,
  composePlatformImageSkillHints,
} from "../shared/platformNativeVariants.js";
import { ensureMinGraphicNoteBlueprints } from "../shared/ensureMinGraphicNoteBlueprints.js";
import { getSmtpStatus, sendMailWithAttachments } from "./services/smtp-mailer";
import { runVertexUpscaleImage } from "./services/vertexImage";
import {
  appendRuntimeMetric,
  getRuntimeMetricTail,
  getRuntimeMetricsMeta,
  summarizeRuntimeMetrics,
} from "./services/runtimeMetricsBuffer.js";
import {
  PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE,
  zPlatformImagePromptTranslatorInput,
} from "./services/geminiPlatformCompositeTranslation.js";

const zPlatformTopicCoverPixelEngine = z.enum(["gpt_image2", "nano_banana_2", "nano_banana_pro"]);

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
import { CREDIT_COSTS } from "./plans";
import {
  IMAGE_UPSCALE_BASE_CREDIT_KEYS,
  imageUpscaleTotalCredits,
  getProductPackageDisplayRows,
  platformBundleCreditsForSlot,
  platformCoverBundleTotalCredits,
  platformCoverCompositeBundleCreditsForCompositeKindGrid,
  platformCompositeBundleTotalCreditsForGrid,
  platformCustomMattingTotalCredits,
  PLATFORM_MATTING_ASPECT_RATIOS,
  PLATFORM_MATTING_BATCH_COUNTS,
  type ImageUpscaleBaseCreditKey,
} from "../shared/plans";
import { generateVideo, isVeoAvailable } from "./veo";
import { isGeminiAudioAvailable, analyzeAudioWithGemini } from "./gemini-audio";
import { executeProviderFallback } from "./services/provider-manager";
import { createGcsSignedUploadUrl, uploadBufferToGcs, resolvePdfExportBucketName } from "./services/gcs";
import { fetchPdfBufferFromWorker, getPdfWorkerFetchTimeoutMs } from "./services/pdfWorkerClient";
import { buildStage1StrategicHandoffForStage2 } from "./services/stage1StrategicHandoff.js";
import { invokePlatformFollowUpGpt55 } from "./services/platformFollowUpLlm.js";
import {
  createJob as createJobRecord,
  getJobById,
  markJobSucceeded,
  markJobFailed,
  insertRunningCompositeSheetProgressJob,
} from "./jobs/repository";
import { getTierProviderChain, resolveUserTier, resolveWatermark, shouldApplyWatermarkForTier } from "./services/tier-provider-routing";
import { getAdminStats, getVideoComments, addVideoComment, deleteVideoComment, toggleCommentLike, createStoryboard, updateStoryboardStatus } from "./db";
import { checkUsageLimit, getOrCreateUsageTracking, getAllBetaQuotas, createBetaQuota, getAllTeams, getAllStoryboards, getPaymentSubmissions, updatePaymentSubmissionStatus, createVideoGeneration, getVideoGenerationById, getVideoGenerationsByUserId, updateVideoGeneration, getVideoLikeStatus, toggleVideoLike, getUserCommentLikes, isAdmin } from "./db-extended";
import { registerOriginalVideo } from "./video-signature";
import { nanoid } from "nanoid";
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
  growthPlatformMenuItemSchema,
  growthPlatformRecommendationSchema,
  growthSnapshotSchema,
  growthTitleExecutionSchema,
} from "@shared/growth";
import { buildAutoPickedTitleVariantsForBlueprint } from "@shared/platformTitleVariants";
import { formatShanghaiDateZh, getShanghaiVisualReportWindows, nowShanghaiIso } from "./growth/time";
import { videoPlatformLinks, videoSubmissions } from "../drizzle/schema";
import { stripeUsageLogs } from "../drizzle/schema-stripe";
import { and, desc, eq, gte, or, sql } from "drizzle-orm";

async function mapWithPool<T, R>(items: T[], pool: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  };
  const workers = Math.min(Math.max(1, pool), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

/** 平台批量/单帧封面参考：写入 user_creations，供免扣补发时 failedJobId 校验 */
const PLATFORM_TOPIC_FRAME_TYPE = "platform_topic_frame";

function parseUserCreationMetadata(raw: string | null | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** 根据 imageUrl 判定 creation 终态（failed / timeout 可申请一次免扣补发，由服务端校验 job） */
function classifyPlatformTopicFrameStatus(url: string | null | undefined): "completed" | "failed" | "timeout" {
  const u = String(url ?? "").trim();
  if (!u) return "failed";
  const l = u.toLowerCase();
  if (l.includes("timeout")) return "timeout";
  if (l.includes("error")) return "failed";
  return "completed";
}

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

/**
 * Stage 2 · getPlatformContent（同步 HTTP / tRPC）：默认与 platform_build_content job 同级（20min，`PLATFORM_STAGE2_SYNC_TIMEOUT_MS`，封顶 25min）。
 * Fly 上长等待无下行字节会触发 idle_timeout（900s）→ 502 空体；若设 FLY_APP_NAME 则再封顶 ~845s。队列版 job 不受此限。
 */
const PLATFORM_STAGE2_SYNC_LLM_TIMEOUT_MS = (() => {
  const raw = Number(process.env.PLATFORM_STAGE2_SYNC_TIMEOUT_MS);
  const requested = Number.isFinite(raw) && raw >= 120_000 ? Math.min(Math.floor(raw), 25 * 60_000) : 20 * 60_000;
  const flyIdleMs = 900_000;
  const flyHeadroomMs = 55_000;
  const flySyncCap = Math.max(120_000, flyIdleMs - flyHeadroomMs);
  if (String(process.env.FLY_APP_NAME || "").trim()) {
    return Math.min(requested, flySyncCap);
  }
  return requested;
})();

/**
 * Stage 2 `buildPlatformContent`：送進各家 API 的 **completion / max_output 上限**，與線路標籤無關。  
 * `PLATFORM_STAGE2_LLM=openai` 走 GPT，`vertex`/`gemini` 走 Gemini；**共用**環境變數 `PLATFORM_STAGE2_MAX_OUTPUT_TOKENS`（勿與 Google Vertex AI 這條線名混淆）。預設 65536，上限 65536，下限 4096。
 */
const STAGE2_SHARED_MAX_OUTPUT_TOKENS = (() => {
  const raw = Number(process.env.PLATFORM_STAGE2_MAX_OUTPUT_TOKENS || "65536");
  if (!Number.isFinite(raw) || raw < 4096) return 65536;
  return Math.min(65536, Math.floor(raw));
})();

/** Stage 1 / Stage 2 取樣溫度（GPT‑5 系 OpenAI 可能忽略 temperature，见 llm.ts）。 */
const STAGE2_LLM_TEMPERATURE = 0.8;

/** Stage 1 / Stage 2 / 深度追问：固定 OhMyGPT GPT‑5.6 Sol（忽略 env `PLATFORM_STAGE2_LLM=vertex` 与 UI 历史选项）。 */
function resolvePlatformCopyLlmMode(_input?: PlatformStage2LlmMode | null): PlatformStage2LlmMode {
  return "openai";
}

/** Stage 1 看板 / 趋势追问等：结构化 JSON 文案（Gemini 3.5 Flash 或 GPT‑5.6 Sol）。 */
async function invokePlatformStructuredCopyLlm(options: {
  copyLlmMode: PlatformStage2LlmMode;
  systemInstruction: string;
  userText: string;
  abortSignal?: AbortSignal;
  /** 覆寫 GPT‑5.6 推理檔位：空回重試時降到 low/minimal，逼模型把预算用于直接输出 JSON 而非耗尽在推理。 */
  reasoningEffortOverride?: ReturnType<typeof resolvePlatformStage2OpenAiReasoningEffort>;
}): Promise<string> {
  if (options.copyLlmMode === "openai") {
    const modelName = getPlatformStage2OpenAiModel();
    const reasoningEffort = options.reasoningEffortOverride ?? resolvePlatformStage2OpenAiReasoningEffort();
    const response = await invokeLLM({
      provider: "openai",
      modelName,
      max_tokens: STAGE2_SHARED_MAX_OUTPUT_TOKENS,
      temperature: STAGE2_LLM_TEMPERATURE,
      response_format: { type: "json_object" },
      reasoningEffort,
      messages: [
        { role: "system", content: options.systemInstruction },
        { role: "user", content: options.userText },
      ],
      abortSignal: options.abortSignal,
    });
    return extractFirstChoicePlainText(response);
  }
  const geminiModel = resolvePlatformStage2GeminiModel();
  return callGemini35FlashCopywriting({
    taskSystemInstruction: options.systemInstruction,
    userText: options.userText,
    responseMimeType: "application/json",
    maxOutputTokens: STAGE2_SHARED_MAX_OUTPUT_TOKENS,
    temperature: STAGE2_LLM_TEMPERATURE,
    topP: 0.9,
    modelName: geminiModel,
    abortSignal: options.abortSignal,
  });
}

const zPlatformCopyLlmModeInput = z.enum(["vertex", "openai"]).optional();

// Call 2 schema — lightweight direction (platform + signals), no heavy copywriting。
// platformMenu 與 @shared/growth 的 growthPlatformMenuItemSchema 對齊；referenceAccounts / trafficBoosters 強制為陣列，由 Prompt 保證格式。
const platformDashboardResponseSchema = z.object({
  headline: z.string(),
  subheadline: z.string().default(""),
  personaSummary: z.string().default(""),
  topSignals: z.array(z.any()).default([]),
  platformMenu: z.array(growthPlatformMenuItemSchema).default([]),
  hotTopics: z.array(z.any()).default([]),
  contentBlueprints: z.array(z.any()).default([]),
  monetizationLanes: z.array(z.any()).default([]),
  actionCards: z.array(z.any()).default([]),
  conversationStarters: z.array(z.any()).default([]),
}).passthrough();

// Call 3 — LLM 常把 executionDetails 打成字符串、把 title 打成数字、monetizationLanes 打成单对象。
// 这里只用 z.any() 收束形状；细粒度纠错放在 normalizePlatformContentKeys + 最后一道 return。
const platformContentResponseSchema = z.object({
  contentBlueprints: z.array(z.any()).default([]),
  monetizationLanes: z.array(z.any()).default([]),
}).passthrough();

function attachTitleVariantsToPlatformContent(
  data: z.infer<typeof platformContentResponseSchema>,
): z.infer<typeof platformContentResponseSchema> {
  const list = Array.isArray(data.contentBlueprints) ? data.contentBlueprints : [];
  return {
    ...data,
    contentBlueprints: list.map((bp: Record<string, unknown>, i: number) => {
      const titleVariants = buildAutoPickedTitleVariantsForBlueprint(bp, i);
      const picked = String(titleVariants[0]?.title ?? "").trim();
      const prev = String(bp.title ?? bp["标题"] ?? bp["选题标题"] ?? "").trim();
      const title = picked || prev;
      return {
        ...bp,
        title,
        titleVariants,
      };
    }),
  };
}

const PLATFORM_MENU_TARGET_MIN = 3;
const PLATFORM_MENU_TARGET_MAX = 4;

/** LLM 有時只給 2 條 platformMenu；與輪播/文案提及的平台不一致時，用快照補齊至少 3 條（含快手等弱樣本）。 */
function padPlatformMenuFromSnapshot(
  dashboard: z.infer<typeof platformDashboardResponseSchema>,
  snapshot: z.infer<typeof growthSnapshotSchema>,
): z.infer<typeof platformDashboardResponseSchema> {
  const menu: any[] = Array.isArray(dashboard.platformMenu) ? [...dashboard.platformMenu] : [];
  const keyOf = (row: Record<string, unknown>): string => {
    const p = String(row.platform ?? row["平台"] ?? "").trim().toLowerCase();
    if (p) return p;
    return String(row.label ?? row.displayName ?? row.name ?? "")
      .trim()
      .toLowerCase();
  };
  const seen = new Set<string>();
  for (const row of menu) {
    const k = keyOf(row as Record<string, unknown>);
    if (k) seen.add(k);
  }
  for (const snap of snapshot.platformSnapshots.slice(0, PLATFORM_MENU_TARGET_MAX)) {
    if (menu.length >= PLATFORM_MENU_TARGET_MIN) break;
    const p = String(snap.platform || "").trim().toLowerCase();
    if (!p || seen.has(p)) continue;
    seen.add(p);
    const topic0 =
      Array.isArray(snap.sampleTopics) && snap.sampleTopics[0] ? String(snap.sampleTopics[0]) : "";
    const why =
      String(snap.summary || "").trim() ||
      `近窗补充顺位：${snap.displayName} 动量 ${snap.momentumScore} / 适配 ${snap.audienceFitScore}（样本较少也单列，便于与热点叙述中的平台一致）。`;
    const nextMove = topic0
      ? `在${snap.displayName}先发一条验证：围绕「${topic0.slice(0, 56)}」，开头直接抛出你的专业结论，观察评论与完播。`
      : `在${snap.displayName}用一条轻量主题验证：讲清「你是谁、为什么现在值得看」，再引导用户下一步互动。`;
    menu.push({
      platform: snap.platform,
      displayName: snap.displayName,
      label: snap.displayName,
      whyNow: why,
      nextMove,
      primaryTrack: topic0 || String(snap.summary || "").trim().slice(0, 80) || "",
      referenceAccounts: [],
      trafficBoosters: [],
    });
  }
  return { ...dashboard, platformMenu: menu.slice(0, PLATFORM_MENU_TARGET_MAX) };
}

/**
 * 兜底看板：当 Stage 1 LLM（GPT‑5.5）多次返回空内容或缺字段时，用 **live 快照** 直接合成一份可用看板，
 * 避免硬报错 `missing required fields` 卡死整条流程（快照已采集成功，数据齐全）。
 * 可叠加 LLM 已部分产出的字段（partial）。
 */
function buildSnapshotFallbackDashboard(
  snapshot: z.infer<typeof growthSnapshotSchema>,
  partial?: Record<string, unknown>,
): z.infer<typeof platformDashboardResponseSchema> {
  const mainPath = (snapshot as any).mainPath ?? {};
  const topics = Array.isArray(snapshot.topicLibrary) ? snapshot.topicLibrary : [];
  const headline =
    String(partial?.headline || mainPath?.title || topics[0]?.title || "你的多平台成长看板").slice(0, 80);
  const subheadline = String(partial?.subheadline || mainPath?.summary || "").slice(0, 160);
  const personaSummary = String(partial?.personaSummary || mainPath?.whyNow || "").slice(0, 240);
  const hotTopics =
    Array.isArray(partial?.hotTopics) && (partial!.hotTopics as unknown[]).length > 0
      ? (partial!.hotTopics as unknown[])
      : topics.slice(0, 6).map((item) => ({
          title: item.title,
          rationale: item.rationale,
          executionHint: item.executionHint,
        }));
  const base = platformDashboardResponseSchema.parse({
    headline,
    subheadline,
    personaSummary,
    topSignals: Array.isArray(partial?.topSignals) ? partial!.topSignals : [],
    platformMenu: Array.isArray(partial?.platformMenu) ? partial!.platformMenu : [],
    hotTopics,
    contentBlueprints: [],
    monetizationLanes: [],
    actionCards: Array.isArray(partial?.actionCards) ? partial!.actionCards : [],
    conversationStarters: Array.isArray(partial?.conversationStarters) ? partial!.conversationStarters : [],
  });
  return padPlatformMenuFromSnapshot(base, snapshot);
}

async function buildPlatformDashboard(params: {
  snapshot: z.infer<typeof growthSnapshotSchema>;
  context?: string;
  requestedPlatforms: string[];
  store: Awaited<ReturnType<typeof readTrendStore>>;
  windowDays: number;
  abortSignal?: AbortSignal;
  /** UI / 请求覆写：vertex=Gemini 3.5 Flash · openai=GPT‑5.5 */
  copyLlmMode?: PlatformStage2LlmMode | null;
}) {
  /** 与用户所选 3/7/15/30/45 对齐；短窗不再硬编码 5/15，避免分析样本与 UI 脱节。 */
  const getPlatformDecisionWindowDays = (_platform: string): number => {
    return Math.max(3, Math.min(45, Number(params.windowDays) || 15));
  };
  const readTrendItemTimestampMs = (item: any): number | null => {
    const ts =
      item?.collectedAt ||
      item?.collected_at ||
      item?.publishedAt ||
      item?.published_at ||
      item?.createdAt ||
      item?.created_at ||
      item?.date ||
      null;
    if (!ts) return null;
    const ms = new Date(String(ts)).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  const filterItemsByWindow = (platform: string, items: any[]): any[] => {
    const windowDays = getPlatformDecisionWindowDays(platform);
    const cutoffMs = Date.now() - windowDays * 24 * 60 * 60 * 1000;
    return items.filter((item) => {
      const ms = readTrendItemTimestampMs(item);
      if (!ms) return true;
      return ms >= cutoffMs;
    });
  };
  const dynamicDecisionEvidence = params.requestedPlatforms.map((platform) => {
    const collection = params.store.collections?.[platform as keyof typeof params.store.collections];
    const allItems: any[] = collection?.items || [];
    const decisionWindowDays = getPlatformDecisionWindowDays(platform);
    const recentItems = filterItemsByWindow(platform, allItems);
    const evidenceItems = recentItems.length > 0 ? recentItems : allItems;
    const bucketCounts = getCollectionBucketCounts(evidenceItems);
    const datedItems = evidenceItems
      .map((item) => ({ item, ts: readTrendItemTimestampMs(item) || 0 }))
      .sort((left, right) => right.ts - left.ts);
    return {
      platform,
      decisionWindowDays,
      collectedAt: collection?.collectedAt || null,
      itemCount: evidenceItems.length,
      recentTitles: datedItems.slice(0, 8).map(({ item }) => item?.title).filter(Boolean),
      topBuckets: Object.entries(bucketCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 6)
        .map(([bucket, count]) => ({ bucket, count })),
      notes: (collection?.notes || []).slice(-6),
    };
  });

  const collectionEvidence = params.requestedPlatforms.map((platform) => {
    const collection = params.store.collections?.[platform as keyof typeof params.store.collections];
    const allItems: any[] = collection?.items || [];
    // UI-selected window remains the broad reporting window; dynamicDecisionEvidence below
    // is the shorter decision chain for fast-moving platforms.
    const windowCutoffMs = Date.now() - params.windowDays * 24 * 60 * 60 * 1000;
    const windowItems = allItems.filter((item) => {
      const ms = readTrendItemTimestampMs(item);
      if (!ms) return true;
      return ms >= windowCutoffMs;
    });
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
  const personaConstraint =
    buildKnowledgeMonetizationConstraint(params.context || "") +
    (needsReviewSafeVoice(params.context || "")
      ? `\n\n${PLATFORM_REVIEW_SAFE_VOICE_GUIDANCE}\n另：platformMenu 第一顺位优先知识型/审美型适配平台（通常小红书或B站），而非纯流量平台。`
      : "") +
    (needsCulturalMaterialDiversity(params.context || "")
      ? `\n\n${PLATFORM_CULTURAL_MATERIAL_DIVERSITY_GUIDANCE}`
      : "");

  const dashboardSystemInstruction = `你是一位资深内容商业顾问，帮创作者判断平台优先级和商业化切入点。

请根据用户背景和近 ${params.windowDays} 天平台数据，生成平台决策看板（轻量版，不包含长文案）。

【人设口径】此处「人设 / Persona / IP」均指在可获知信息下尽量还原的创作者真实画像，须至少纳入**职业、身份、兴趣、爱好、专长**等可解释、可拍成内容的维度；禁止把人设写成泛化的「创作者」「博主」「达人」等空壳。headline、subheadline、personaSummary、positioning、trafficBoosters、hotTopics、platformMenu 的推荐理由与 nextMove 等，须显式用上述人设各维说清楚「为什么是你」；热点与扶持活动可参考 snapshot / 趋势证据，但必须**改写**为贴合该用户口吻与身份的事实落点，禁止机械硬套无关热梗。

【绝对禁止输出泛平台画像】
在生成 platformMenu 的推荐理由（whyNow 等字段）时，绝对禁止写「抖音适合短视频」、「B站适合长视频讲透」、「小红书适合图文」等通用废话。
你的 positioning 或推荐理由，必须 100% 绑定该用户的上述人设各维（职业、身份、兴趣、爱好、专长等），而非笼统「专长」一词带过。
例如：如果用户是"爱好中国历史的生命科学学者"，你必须写出「B站更适合你拆解古代『榫卯结构』与『当代生命科学隐喻』的硬核科普，能建立极高信任感」这类高度专属的理由。

【强制热点关联与平台深度指标（须对齐人设各维）】
你在输出 platformMenu 的各个平台时，必须提供以下深度指标与分析：
1. referenceAccounts：若找不到具体账号，改为输出针对该平台的「目标用户画像」：描述在此平台上，谁最有可能成为这位创作者的忠实粉丝（年龄、职业、阅读偏好、消费能力）。【格式必须为对象数组】：[{"account": "画像名称", "reason": "具体描述"}]。绝对禁止输出单个对象或单个字符串。
2. trafficBoosters：强制从 \`snapshot\` 近期热点与趋势数据中提取。给出 1-3 个该平台目前正在进行的流量扶持活动或即将到来的节日热点；每条须**改写**为贴合该用户人设（职业、身份、兴趣、爱好、专长）的表达，禁止照抄榜单句式或与本人无关的热梗。【格式必须为字符串数组】：例如 ["带上 #医学硬核科普 参与近期知识区流量扶持", "夏季健康打卡"]。绝对禁止输出单行字符串。
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
7. nextMove（建议动作）：必须明确说出「发什么内容」与「如何开头」两件事。禁止写"先发一版内容拿反馈"这种空话。必须写出：具体的内容标题/主题 + 第一句话怎么说。例如：「发布《史记里最会止损的人，今天会怎么过中年？》，开头说：『你以为内耗是现代病？一本两千年前的书，早就写过另一种止损法。』」标题须有好奇缺口；素材勿默认苏轼/李清照；开头须点名受众痛点并留半成品解法空间。
8. 平台动态决策链必须强制使用：抖音 / 快手优先参考近 3-5 天样本（当前统一按 5 天窗口给你），B站 / 小红书优先参考近 7-15 天样本（当前统一按 15 天窗口给你）。判断“现在先做什么”时，优先读取 dynamicDecisionEvidence，不要只复述宽窗口快照。

严格要求：
1. 所有输出必须针对这个具体用户，不得写成通用模板。
2. headline 要是成熟顾问的核心判断，personaSummary 一句话说清人设各维度中的身份与商业价值（职业、身份、兴趣、爱好、专长中至少点到 2～3 维，禁止只写「博主」）；若涉及古典文化，须写「跨朝代典籍与生活场域」而非只写「唐诗宋词」。
3. platformMenu：**必须输出至少 3 条、至多 4 条**。凡是上方 \`platforms\` 数组中出现的抖音 / 快手 / 小红书 / B站，只要带有 summary 或动量/适配分数，就应各占一条 platformMenu（**快手样本稀疏也必须写 nextMove**，不得以「数据少」整条省略；顺位仍可 1→4 排序）。**严禁只输出 2 条就结束。** 每条必须包含 nextMove（含具体标题+开头第一句），并严格遵守【绝对禁止输出泛平台画像】约束。
   每条 platformMenu 还须包含 **blueOceanWords（蓝海词）**：从该平台在 \`snapshot\` 热点/关键词中，挑选 3-5 个符合蓝海词定义的词条（搜索量大 >10万/月、同类笔记少 <200篇、用户意图精准离成交近）。如果该平台是小红书，优先从搜索下拉联想词和爆款笔记评论区高频需求词中提取。格式：字符串数组，每项为 2-8 字，例如 ["同城相亲攻略","油皮抗老水乳","家庭急救技巧"]。
4. topSignals：3 个关键信号；hotTopics：3 个热点方向（须说明如何经人设各维——职业、身份、兴趣、爱好、专长——改写落地，禁止纯泛热榜）；actionCards：3 个立刻能做的动作。
   【actionCards 极其重要】title 字段写「做什么动作」，detail 字段必须写出**完整的执行细节**：要发什么（具体标题）、第一句怎么说（完整的开头文案）、在哪个平台发、什么时间发。禁止 detail 写「先做一个可以快速拿到反馈的动作」这种废话。例如 detail："在B站发布《古代『养心』秘方 vs 现代心脏科学》，第一句：『你吃的那些养心安神的食物，到底有没有用？心脏科医生来告诉你真相。』工作日晚上 8 点发布，带 #医学硬核科普 标签。"
5. conversationStarters：3 个让用户愿意继续追问的问题。
6. 不要出现后台工程术语，不要出现"可能都可以""先试试"等空话。在回答"为什么这条路更适合你"时必须深度剖析，禁止出现"电商带货"等泛泛而谈词汇。${personaContextLine}${personaConstraint}

注意：contentBlueprints 和 monetizationLanes 不需要输出（留空数组即可）。

【绝对警告 — JSON 输出规范】：
请直接且仅输出合法的 JSON 对象，绝对不要包含任何 Markdown 标记（如 \`\`\`json 或 \`\`\`）、前言、结语或解释文字！
输出的第一个字符必须是 {，最后一个字符必须是 }。如果 JSON 未能完整输出会导致系统崩溃，请确保所有括号都正确关闭。
字段为：headline、subheadline、personaSummary、topSignals、platformMenu（每项含 blueOceanWords 字符串数组）、hotTopics、contentBlueprints（空数组）、monetizationLanes（空数组）、actionCards、conversationStarters。`;

  const dashboardUserPayload = JSON.stringify({
          context: params.context || "",
          windowDays: params.windowDays,
          platforms: params.snapshot.platformSnapshots.slice(0, 4).map((item) => ({
            platform: item.platform,
            displayName: item.displayName,
            audienceFitScore: item.audienceFitScore,
            momentumScore: item.momentumScore,
            summary: item.summary,
            sampleTopics: item.sampleTopics.slice(0, 3),
          })),
          topRecommendations: params.snapshot.platformRecommendations.slice(0, 4).map((item) => ({
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
          dynamicDecisionEvidence,
          collections: collectionEvidence.slice(0, 3).map((item) => ({
            platform: item.platform,
            itemCount: item.itemCount,
            hotTitles: item.hotTitles.slice(0, 4),
          })),
        });

  const copyLlmMode = resolvePlatformCopyLlmMode(params.copyLlmMode);
  // 看板本质是「把 live 快照浓缩成结构化 JSON」，答案基本已在输入里，无需高推理；
  // 固定用 low：更快、更省，且避免 GPT‑5.5 medium 推理把输出预算耗尽导致 content 为空（rawPreview: {}）。
  // Stage 2（buildPlatformContent）需要跨维度策略协调，仍保留 medium，不受此处影响。
  const DASHBOARD_LLM_MAX_ATTEMPTS = 3;
  let rawContent = "";
  for (let attempt = 1; attempt <= DASHBOARD_LLM_MAX_ATTEMPTS; attempt += 1) {
    rawContent = await invokePlatformStructuredCopyLlm({
      copyLlmMode,
      systemInstruction: dashboardSystemInstruction,
      userText: dashboardUserPayload,
      abortSignal: params.abortSignal,
      reasoningEffortOverride: "low",
    });
    if (String(rawContent || "").trim()) break;
    console.warn(
      `[buildPlatformDashboard] LLM 第 ${attempt}/${DASHBOARD_LLM_MAX_ATTEMPTS} 次返回空内容` +
        `（low 推理仍空，疑似 Evolink 瞬时空回）${attempt < DASHBOARD_LLM_MAX_ATTEMPTS ? "，重试…" : "，放弃重试，转用快照兜底"}`,
    );
    if (params.abortSignal?.aborted) break;
  }
  // 三次仍空 → 直接用 live 快照合成兜底看板，不让 Stage 1 硬失败。
  if (!String(rawContent || "").trim()) {
    console.warn("[buildPlatformDashboard] LLM 持续空回，使用快照兜底看板（headline/platformMenu 取自 live snapshot）。");
    return buildSnapshotFallbackDashboard(params.snapshot);
  }

  // Phase 0-C: Robust JSON extraction — greedy bracket extraction, then fence strip fallback
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
    console.error("[buildPlatformDashboard] missing required fields, 使用快照兜底叠加已产出字段. parsedRaw preview:", rawPreview);
    return buildSnapshotFallbackDashboard(params.snapshot, partial);
  }
  const parseResult = platformDashboardResponseSchema.safeParse(partial);
  if (parseResult.success) {
    return padPlatformMenuFromSnapshot(parseResult.data, params.snapshot);
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
  if (looseResult.success) return padPlatformMenuFromSnapshot(looseResult.data, params.snapshot);
  console.error("[buildPlatformDashboard] loose parse also failed, 使用快照兜底:", (looseResult.error as any).issues?.slice(0, 5) ?? looseResult.error.message);
  return buildSnapshotFallbackDashboard(params.snapshot, partial);
}

/**
 * normalizePlatformContentKeys — Key normalization layer for buildPlatformContent.
 * Gemini 3.1 Pro occasionally renames fields despite the strict JSON key-lock prompt.
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
  /** LLM 常返回「單物件」而非陣列 — 必須包成一條，否則 z.array 整段失敗 */
  if (out.monetizationLanes != null && !Array.isArray(out.monetizationLanes)) {
    out.monetizationLanes =
      typeof out.monetizationLanes === "object" ? [out.monetizationLanes] : [];
  }
  if (out.contentBlueprints != null && !Array.isArray(out.contentBlueprints)) {
    out.contentBlueprints =
      typeof out.contentBlueprints === "object" ? [out.contentBlueprints] : [];
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
      // executionDetails：可能是字符串 / 数组 / 对象 — 统一收成对象，避免下游类型爆炸
      if (b.executionDetails == null || b.executionDetails === "") {
        /* optional */
      } else if (typeof b.executionDetails === "string") {
        b.executionDetails = {
          environmentAndWardrobe: b.executionDetails,
          lightingAndCamera: "",
          stepByStepScript: [],
        };
      } else if (Array.isArray(b.executionDetails)) {
        b.executionDetails = {
          environmentAndWardrobe: "",
          lightingAndCamera: "",
          stepByStepScript: b.executionDetails,
        };
      } else if (typeof b.executionDetails === "object") {
        const ed = b.executionDetails as Record<string, unknown>;
        if (!ed.environmentAndWardrobe) ed.environmentAndWardrobe = ed.environment ?? ed.wardrobe ?? ed.scene ?? "";
        if (!ed.lightingAndCamera) ed.lightingAndCamera = ed.lighting ?? ed.camera ?? ed.lighting_camera ?? "";
        if (!Array.isArray(ed.stepByStepScript)) {
          const ss = ed.steps ?? ed.script ?? ed.stepByStep ?? ed.step_by_step_script;
          ed.stepByStepScript = Array.isArray(ss) ? ss : [];
        }
        b.executionDetails = ed;
      }
      // 常见标量字段若被模型打成数字，转成 string，避免 UI / 下游报错
      for (const key of ["title", "format", "hook", "copywriting", "detailedScript", "publishingAdvice"] as const) {
        const v = b[key];
        if (v != null && typeof v !== "string") b[key] = String(v);
      }
      // highlightKeywords：蓝海/高亮词，统一为 string[]
      if (!Array.isArray(b.highlightKeywords)) {
        const hk = b.highlightKeywords ?? b.blueOceanKeywords ?? b.keywords ?? b["高亮词"] ?? b["蓝海词"];
        if (Array.isArray(hk)) {
          b.highlightKeywords = hk.map((x) => String(x).trim()).filter(Boolean).slice(0, 8);
        } else if (typeof hk === "string" && hk.trim()) {
          b.highlightKeywords = hk
            .split(/[,，、/\s]+/)
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 8);
        } else {
          b.highlightKeywords = [];
        }
      } else {
        b.highlightKeywords = (b.highlightKeywords as unknown[])
          .map((x) => String(x).trim())
          .filter(Boolean)
          .slice(0, 8);
      }
      // platformVariants：三平台钩子/封面/标签差异块
      const pv = normalizePlatformVariants(b.platformVariants ?? b.platformAdaptations);
      if (pv.length > 0) b.platformVariants = pv;
      return b;
    });
    // 小红书测流：全案 6 条中至少保底若干条为图文笔记（不足则从尾部短视频改写体裁标记）
    out.contentBlueprints = ensureMinGraphicNoteBlueprints(out.contentBlueprints as any[], 3);
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

/** Stage2 文案 / 分镜：场景须生动具体，供 system prompt 复用。 */
const PLATFORM_COPY_VIVID_SCENES_GUIDANCE = `【场景生命力与隐喻美学·软边界】**强烈建议**文案与分镜选用**具体、可拍、有心理张力**的场景——博物馆侧光、极地旷野、精密实验室、废墟工业风、烟火市集、高空天台、泳池边、球场、路边大排档等皆可；**优先**让读者「看见画面、感到情绪」，并与本人设（职业、身份、专长）互证。**不推荐**五套方案扎堆同一套书房/客厅/书桌模板，除非人设或选题明确需要。`;

/** Stage2 口吻：减轻「合规顾问模板腔」+ 去无聊。 */
const PLATFORM_STAGE2_VOICE_GUIDANCE = `【口吻与生命力·第一优先】你写的是**给人愿意看完、愿意点开**的稿子，不是合规摘要，也不是说教课。
- **幽默风趣、禁训话**：像朋友吐槽/抬杠，可用反问、自嘲、夸张比喻；**禁止**「你应该」「必须明白」「请务必」与「首先…其次…综上所述」公文/说教腔。
- **痛点与爽点前置（黄金三秒）**：hook 与 copywriting 开场须**同时**戳中窘境 + 给一点痛快/反转/解气；禁止先背定义、先「今天我们来聊聊」。短视频前 3 秒口播、图文封面+次屏同理。
- **去无聊硬门槛**：标题若读起来像「××观 / ××管理 / 用 A 与 B 观察 C」且无可拍画面 → **必须重写**。每条标题须含物件、身体动作、不信感或身份反差之一。
- **完播画面**：detailedScript / 封面须提示**多元表情、可夸张姿势**（错愕、坏笑、失衡、发球定格等轮换），禁止六条端坐上课脸。
- **每条方案应有辨识度**：六条的标题、场景、情绪基调、开头句式 **必须明显不同**。
- **具体优先于正确**：数字、道具、场所、第一句话怎么开口——**越能直接开拍越好**；允许适度文学化与比喻。
- **coverHeadline**：8–14 字停滑短句；**禁止**把长 title 原样当封面主句。

${PLATFORM_HOOK_SOLUTION_CONSULTATION_GUIDANCE}`;

/**
 * 6 個內容維度（順序固定，與 Prompt 對齊）。
 * `reasoning`：逐維度 GPT‑5.5 推理檔位。維度 1/3/4/5 走 high（更吃策略/場景推理），
 * 維度 2 留 medium。每條 blueprint 都是獨立 LLM 呼叫、獨立 token 預算（非共用一個預算）。
 */
const BLUEPRINT_DIMENSIONS: ReadonlyArray<{
  index: number;
  name: string;
  reasoning: "high" | "medium";
}> = [
  { index: 1, name: "核心专业洞察(Professional Insight)", reasoning: "high" },
  { index: 2, name: "跨界结合与价值观(Cross-over Value)", reasoning: "medium" },
  { index: 3, name: "目标受众痛点暴击(Audience Pain Point)", reasoning: "high" },
  { index: 4, name: "个人经历与人设魅力(IP Persona Story)", reasoning: "high" },
  { index: 5, name: "强冲突场景与深层热点转译（Cinematic Scenes & Deep Trend Remix）", reasoning: "high" },
  { index: 6, name: "长尾常青与搜索流量（Long-tail Evergreen & Search Traffic）", reasoning: "medium" },
];

export async function buildPlatformContent(params: {
  snapshot: any;
  platformMenu: any;
  context?: string;
  windowDays: number;
  requestedPlatforms: string[];
  store: Awaited<ReturnType<typeof readTrendStore>>;
  abortSignal?: AbortSignal;
  /** Stage 1 戰略看板清洗摘要（標題／文案／分鏡種子）；由 worker 或同步路由注入 */
  stage1Handoff?: ReturnType<typeof buildStage1StrategicHandoffForStage2> | null;
  /** 趋势报表全局蓝海词（一级/二级），与 platformMenu 合并进推演文案词表 */
  globalBlueOceanWords?: unknown;
  /**
   * 單次請求覆寫 Stage2 線路（Vertex **Gemini 3.5 Flash** vs OpenAI GPT‑5.5）。
   * 未傳時沿用 {@link resolvePlatformStage2LlmMode}（Fly env 等）。
   */
  stage2LlmModeOverride?: PlatformStage2LlmMode | null;
  /**
   * 逐條生成回呼：每生成一條 blueprint 立即觸發，供呼叫端即時持久化至 job output。
   * `dimIndex` 為 0-based 維度序號（0–5）。
   */
  onBlueprintGenerated?: (blueprint: unknown, dimIndex: number) => Promise<void> | void;
  /**
   * /platform 勾选 Skill 拼成的强制 Prompt 块（由 resolvePlatformSkillsPrompt 生成）。
   * 注入后与软建议冲突时以 Skill 为准。
   */
  platformSkillsPrompt?: string;
}): Promise<{
  data: z.infer<typeof platformContentResponseSchema>;
  diagnostics: Record<string, unknown>;
}> {
  const diagnostics: Record<string, unknown> = {
    stage: "buildPlatformContent",
    at: new Date().toISOString(),
    windowDays: params.windowDays,
    requestedPlatforms: params.requestedPlatforms,
    contextLen: String(params.context || "").length,
    platformMenuCount: Array.isArray(params.platformMenu) ? params.platformMenu.length : 0,
    stage2MaxOutputTokens: STAGE2_SHARED_MAX_OUTPUT_TOKENS,
    /** 對應上方數字的環境變數（OpenAI 與 Gemini 路線共用，非 Vertex 專用）。 */
    stage2MaxOutputTokensEnv: "PLATFORM_STAGE2_MAX_OUTPUT_TOKENS",
    openaiGpt5ReasoningEffort: getOpenAiGpt5ReasoningEffortDiagnostics(),
  };
  const handoff = params.stage1Handoff ?? null;
  if (handoff) {
    diagnostics.stage1HandoffSourceNote = handoff.sourceNote;
    diagnostics.stage1HandoffSeedCount = handoff.contentSeeds.length;
  } else {
    diagnostics.stage1HandoffSourceNote = null;
    diagnostics.stage1HandoffSeedCount = 0;
  }
  try {
    const cols = (params.store?.collections || {}) as Record<string, { items?: unknown[] }>;
    diagnostics.storeCollectionKeys = Object.keys(cols);
    diagnostics.storeItemCountsByPlatform = Object.fromEntries(
      Object.entries(cols).map(([k, v]) => [k, Array.isArray(v?.items) ? v.items.length : 0]),
    );
    const totalItems = Object.values(diagnostics.storeItemCountsByPlatform as Record<string, number>).reduce(
      (a, b) => a + b,
      0,
    );
    diagnostics.storeTotalItems = totalItems;
  } catch {
    diagnostics.storeItemCountsByPlatform = "unavailable";
  }
  const getPlatformDecisionWindowDays = (platform: string): number => {
    if (platform === "douyin" || platform === "kuaishou") return 5;
    if (platform === "bilibili" || platform === "xiaohongshu") return 15;
    return params.windowDays;
  };
  const readTrendItemTimestampMs = (item: any): number | null => {
    const ts =
      item?.collectedAt ||
      item?.collected_at ||
      item?.publishedAt ||
      item?.published_at ||
      item?.createdAt ||
      item?.created_at ||
      item?.date ||
      null;
    if (!ts) return null;
    const ms = new Date(String(ts)).getTime();
    return Number.isFinite(ms) ? ms : null;
  };
  /** 無可靠发布时间、增长潜力筛空时：用评论/转发/赞 粗排，供 Stage2 对齐「高互动」结构 */
  const engagementProxyScore = (item: any): number => {
    const c = Number(item?.comments ?? 0) || 0;
    const s = Number(item?.shares ?? 0) || 0;
    const l = Number(item?.likes ?? 0) || 0;
    return c * 4 + s * 6 + l * 0.3;
  };
  const pickHighEngagementSamplesForStage2 = (
    evidenceItems: any[],
    decisionWindowDays: number,
  ): {
    samples: Array<{
      title: string;
      category: string;
      growthPercentileBand: number | null;
      isBreakout: boolean;
      tags: string[];
      source: "growthPotential" | "engagementProxyFallback";
    }>;
    growthDebugKept: number;
  } => {
    const heated = filterTrendItemsWithEngagementFloor(evidenceItems as TrendItem[]);
    if (heated.length === 0) {
      return { samples: [], growthDebugKept: 0 };
    }
    const { selected, debug } = selectByGrowthPotential(heated, {
      topN: 10,
      windowDays: decisionWindowDays,
    });
    if (selected.length > 0) {
      return {
        samples: selected.map((s) => ({
          title: String(s.item.title || "").trim().slice(0, 200),
          category: s.category,
          growthPercentileBand: s.growthPercentile,
          isBreakout: s.isBreakout,
          tags: (s.item.tags || []).slice(0, 5).map((t) => String(t)),
          source: "growthPotential" as const,
        })),
        growthDebugKept: debug.kept,
      };
    }
    const fallback = [...heated]
      .filter((it) => String(it?.title || "").trim())
      .sort((a, b) => engagementProxyScore(b) - engagementProxyScore(a))
      .slice(0, 10);
    return {
      samples: fallback.map((it) => ({
        title: String(it.title || "").trim().slice(0, 200),
        category: String(it.bucket || "（采集桶未标）").slice(0, 64),
        growthPercentileBand: null,
        isBreakout: false,
        tags: (it.tags || []).slice(0, 5).map((t: unknown) => String(t)),
        source: "engagementProxyFallback" as const,
      })),
      growthDebugKept: 0,
    };
  };
  const dynamicDecisionChain = params.requestedPlatforms.map((platform) => {
    const collection = params.store.collections?.[platform as keyof typeof params.store.collections];
    const items: any[] = collection?.items || [];
    const decisionWindowDays = getPlatformDecisionWindowDays(platform);
    const cutoffMs = Date.now() - decisionWindowDays * 24 * 60 * 60 * 1000;
    const filteredItems = items.filter((item) => {
      const ms = readTrendItemTimestampMs(item);
      if (!ms) return true;
      return ms >= cutoffMs;
    });
    const evidenceItems = filteredItems.length > 0 ? filteredItems : items;
    const bucketCounts = getCollectionBucketCounts(evidenceItems);
    const { samples: highEngagementSamples, growthDebugKept } = pickHighEngagementSamplesForStage2(
      evidenceItems,
      decisionWindowDays,
    );
    const titleFromSamples = highEngagementSamples.map((h) => h.title).filter(Boolean);
    const recentTitles =
      titleFromSamples.length > 0
        ? titleFromSamples.slice(0, 8)
        : evidenceItems.slice(0, 8).map((item) => item?.title).filter(Boolean);
    const tagCandidates = deriveTagCandidatesFromTrendSamples(
      [
        ...highEngagementSamples,
        ...evidenceItems.slice(0, 12).map((item: any) => ({
          tags: item?.tags,
          title: item?.title,
        })),
      ],
      12,
    );
    return {
      platform,
      decisionWindowDays,
      itemCount: evidenceItems.length,
      /** 供模型显式对齐：采集样本经增长潜力/互动 proxy 排序，非用户账号实测 CTR */
      trendSampleEngagementNote:
        "highEngagementSamples 来自 trendStore 抓取样本在本窗口内的「评论/转发加权互动 × 时效 × 同账号爆发」排序（与企业/投流样本已尽量剔除）。请对齐其钩子与节奏偏好；禁止字面抄袭标题。非真实点击率。",
      growthPotentialRankedCount: growthDebugKept,
      highEngagementSamples: highEngagementSamples.slice(0, 8),
      recentTitles,
      /** trendStore 标签/标题碎片 → 蓝海二级词种子（数据驱动，不强行凑数） */
      tagCandidates,
      topBuckets: Object.entries(bucketCounts)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 6)
        .map(([bucket, count]) => ({ bucket, count })),
    };
  });
  const allTagCandidates = Array.from(
    new Set(
      dynamicDecisionChain.flatMap((row) =>
        Array.isArray(row.tagCandidates) ? row.tagCandidates.map(String) : [],
      ),
    ),
  ).slice(0, 20);
  const blueOceanLexicon = buildBlueOceanLexicon({
    platformMenu: params.platformMenu,
    globalBlueOceanWords: params.globalBlueOceanWords,
    tagCandidates: allTagCandidates,
  });
  diagnostics.blueOceanFlatCount = blueOceanLexicon.flat.length;
  diagnostics.blueOceanGroupedCount = blueOceanLexicon.grouped.length;
  diagnostics.blueOceanTagCandidateCount = blueOceanLexicon.tagCandidates.length;
  const reviewSafe = needsReviewSafeVoice(params.context || "");
  diagnostics.reviewSafeVoice = reviewSafe;
  diagnostics.culturalMaterialDiversity = needsCulturalMaterialDiversity(params.context || "");
  const skillsBlock = String(params.platformSkillsPrompt || "").trim();
  diagnostics.platformSkillsPromptChars = skillsBlock.length;
  const personaConstraint =
    buildKnowledgeMonetizationConstraint(params.context || "") +
    (reviewSafe ? `\n\n${PLATFORM_REVIEW_SAFE_VOICE_GUIDANCE}` : "") +
    (needsCulturalMaterialDiversity(params.context || "")
      ? `\n\n${PLATFORM_CULTURAL_MATERIAL_DIVERSITY_GUIDANCE}`
      : "") +
    `\n\n${STAGE2_LIGHTING_EMOTION_DIRECTOR_HINT_ZH}` +
    (skillsBlock ? `\n\n${skillsBlock}` : "") +
    `\n\n${PLATFORM_NATIVE_VARIANTS_SCHEMA_HINT}`;

  const douyinHotForWeixin =
    (Array.isArray(dynamicDecisionChain)
      ? dynamicDecisionChain.find((row: { platform?: string }) => row?.platform === "douyin")
      : null) ?? null;
  const weixinChannelsDouyinHotRef = douyinHotForWeixin
    ? {
        note: "视频号母语参照：抖音近窗（约3–5天）高互动样本的钩子结构与节奏；禁止抄标题。",
        decisionWindowDays: (douyinHotForWeixin as { decisionWindowDays?: number }).decisionWindowDays ?? 5,
        highEngagementSamples: Array.isArray(
          (douyinHotForWeixin as { highEngagementSamples?: unknown }).highEngagementSamples,
        )
          ? (douyinHotForWeixin as { highEngagementSamples: unknown[] }).highEngagementSamples.slice(0, 8)
          : [],
      }
    : {
        note: "当前请求未含抖音链；视频号仍按生活一句人话母语写，勿抄热梗标题。",
        highEngagementSamples: [],
      };

  const stage2UserJsonString = JSON.stringify({
          context: params.context || "",
          windowDays: params.windowDays,
          platformMenu: params.platformMenu,
          dynamicDecisionChain,
          weixinChannelsDouyinHotRef,
          blueOceanLexicon,
          blueOceanUsagePolicy: BLUE_OCEAN_USAGE_POLICY,
          /** 与 dynamicDecisionChain 内 trendSampleEngagementNote 同源，便于模型扫读 */
          trendEngagementAlignmentPolicy:
            "dynamicDecisionChain 中 highEngagementSamples 为抓取样本的高互动/增长潜力参考（非用户账号实测CTR或转化）。contentBlueprints 的 title/hook/copywriting/detailedScript 须在完整人设（职业、身份、兴趣、爱好、专长）约束下对齐其钩子结构与内容节拍；可借鉴切口与张力，热点与样本仅作参考，须改写为贴合本人设的表达，禁止字面抄袭标题或正文，禁止硬套无关热梗。",
          snapshotData: {
            titleExecutions: params.snapshot.titleExecutions || [],
            monetizationStrategies: params.snapshot.monetizationStrategies || [],
            growthPlan: params.snapshot.growthPlan || [],
            creationAssist: params.snapshot.creationAssist || {},
          },
          /** Stage 1 看板清洗手遞：含 contentSeeds（title/hook/copywriting/分鏡欄位） */
          stage1StrategicHandoff: handoff,
          ipContextBinding:
            "当前用户真实人设（职业、身份、兴趣、爱好、专长等，见 context 与用户 JSON 快照），必须据此生成恰好 6 条、六个内容维度各一的 contentBlueprints。泛化、与此人设脱钩或仅用「创作者」「博主」等空壳表述的内容将被拒收（除非用户明确放开博主自称）。",
        });

  const structuredStage2Messages: Parameters<typeof invokeLLM>[0]["messages"] = [
      {
        role: "system",
        content: `你是一个顶级的个人IP商业文案顾问。

${PLATFORM_STAGE2_VOICE_GUIDANCE}

根据已生成的平台方向与用户背景数据，请为这位创作者制定深度内容的执行蓝图与商业变现路径。

【人设口径】此处「人设 / Persona / IP」均指可获知信息下尽量还原的真实创作者画像；选题、脚本、变现须能用**职业、身份、兴趣、爱好、专长**等多维解释。**不建议**把人设写成泛化「创作者」「博主」。热点与高互动样本仅作结构与节奏参考，**须改写**为贴合本人设的事实与口气，**不建议**硬套无关热梗。

【Stage 1 战略看板已定稿】user JSON 中的 stage1StrategicHandoff 为系统对战略看板的清洗摘要，其中 contentSeeds 每条可含 title、hook、copywriting 及分镜类字段（detailedScript、graphicPlan、videoPlan）。请在此基础上产出 **6 条**更深、更可执行的 contentBlueprints：允许重写、扩写与改分镜以符合本任务 schema，但**不建议**偏离人设与 headline/subheadline/persona 主线；若种子不足 6 条，可补充新选题但须与同一真实人设一致。

【绝对禁止词汇黑名单】（任何输出中出现以下词汇/句式即判定为不合格，须重写）：
- "电商带货" / "带货" / "橱窗"
- "先做一轮轻量验证" / "先做轻量验证" / "轻量验证"
- "开头先给结果" / "视频开头先给判断，中段给例子，结尾给行动引导"
- "可能都可以" / "先试试" / "先探索一下"
- "制作身份名片" / "锁定文化符号" / "设计轻量级产品"
- 任何泛化建议，不针对此用户具体人设维度（职业、身份、兴趣、爱好、专长等），或仅使用空泛「创作者」「博主」套话

输出要求：
须严格输出纯 JSON 格式，不要包含任何 markdown 代码块标记或前后缀说明文字。

【核心数量与维度指令】：须为该平台精确生成 **6** 个深度内容方案（**少于 6 个将导致系统拒收**）。请结合 ipContextBinding，依序从以下**六个维度**各发散**一个**独特选题（每条对应一个维度，顺序不可乱）：
1.核心专业洞察(Professional Insight)
2.跨界结合与价值观(Cross-over Value)
3.目标受众痛点暴击(Audience Pain Point)：${PLATFORM_AUDIENCE_PAIN_DIMENSION_EXTRA}
4.个人经历与人设魅力(IP Persona Story)
5.强冲突场景与深层热点转译（Cinematic Scenes & Deep Trend Remix）：结合文案、上下文与 snapshot / 动态链中可援引的趋势与热点，设计**极具视觉识别度的热门切口**；${PLATFORM_COPY_VIVID_SCENES_GUIDANCE} 热点梗**建议经解构与重塑**，使其贴合用户的**职业、身份与美学基因**；本条为**软约束**：不强制与某一高互动样本逐条绑定，但须在人设各维上讲得通，**不建议**为凑热点而脱钩。
6.长尾常青与搜索流量（Long-tail Evergreen & Search Traffic）：面向**可持续吃长尾流量**的常青选题——围绕用户赛道里**高搜索意图、低时效衰减**的真实问题/关键词（如「如何…」「…怎么选」「…避坑」「…对比」等），设计可被反复搜索与收藏的实用内容；**建议**明确给出该平台可布局的**搜索关键词**与可系列化的子选题方向，便于沉淀为 IP 资产。
【资安要求】：若内容与人设脱钩或使用泛化模板，则视为不合格。须恰好 **6** 条。
【动态决策链要求】：在判断四个平台的标题、呈现形式、内容节奏时，**优先**读取 dynamicDecisionChain。抖音 / 快手使用近 5 天样本，B站 / 小红书使用近 15 天样本。快平台更重近期节奏与强钩子，慢平台更重 7-15 天持续讨论度与搜索沉淀，**不建议**混成同一判断。
【高互动样本对齐（抓取数据 · 非实测CTR/转化）】：每条 dynamicDecisionChain 附有 highEngagementSamples（由 trendStore 样本经「评论/转发加权互动 × 时效 × 同账号爆发」排序；已尽量剔除企业号与明显投流笔记——见 trendSampleEngagementNote）。请：
(1) 在 title、hook、copywriting、detailedScript、publishingAdvice 中体现与之同构的「好奇缺口、反常识断言、具体数字/场景、情绪递进」——**适配该用户本人设（职业、身份、兴趣、爱好、专长）**，而非泛化稿；热点结构须**改写**落地到本人设；
(2) **优先**借鉴切口、句式节奏与信息密度，**不建议**字面抄袭 sample 标题或洗稿；
(3) 若某平台 highEngagementSamples 为空或仅含 engagementProxyFallback，则结合 recentTitles 与 topBuckets，仍须保持上述对齐意图；
(4) user JSON 顶层的 trendEngagementAlignmentPolicy 与上条一体遵循。

【蓝海词与标签推演】：须读取 user JSON 的 blueOceanLexicon（flat / grouped）与 blueOceanUsagePolicy，以及 platformMenu[].blueOceanWords、dynamicDecisionChain[].tagCandidates。${BLUE_OCEAN_USAGE_POLICY} 维度 6（长尾常青）优先覆盖 secondary 与 tagCandidates。每条 blueprint 须输出 highlightKeywords（本条实际使用的蓝海/高亮词 2–6 个）。

请忠于当前用户的真实行业背景与人设各维，**不建议**套用任何无关的专业标签。

1. contentBlueprints：须恰好包含 **6** 个具体可执行的内容方案，并与上方 **6** 个维度一一对应（第 1 条对应维度 1，依此类推，第 6 条对应维度 6）。每个方案须包含：
   - title（选题标题：**必须**有好奇缺口/反常识/反差/时事切口之一，具体有画面；禁止正确但无聊的百科题）
   - format（内容形式：短视频 / 图文）。**【图文配额·硬】** 6 条中 **至少 3 条** \`format=图文\`（小红书笔记可发、可收藏），用于近期小红书流量验证；其余可为短视频。维度「痛点 / 人设 / 长尾搜索」**优先图文**；图文的 detailedScript **必须**用 \`[封面]\`/\`[图N]\` 大纲，不要写成口播时间轴。
   - hook（开头文案钩子：**必须**黄金三秒级停滑——**痛点与爽点前置**同句或紧挨；反问/物件/窘境一击 + 痛快反转；建议≥30字仍口语；禁先讲定义或说教开场）
   - copywriting（核心文案方向，**建议**完整正文不少于200字。结构须含：**开场痛点+爽点** → 点名目标客户 → 痛点展开 → **2–3 个半成品解法要点（故意留白完整方案）** → **结尾咨询/私信/预约类 CTA**。口吻**幽默风趣、禁训话/公文**；图文与视频均给出可直接使用的正文）
   - suitablePlatforms（适合发哪些平台，字符串数组）
   - actionableSteps（落地三步曲：**建议**给出至少 3 个具体、可行、有先后顺序的落地指导。例如：1.拍摄 15 秒榫卯对比视频；2.修改主页简介；3.加入当下话题等。此字段为 string 数组。）
	   - detailedScript（详细的拍摄脚本或大纲，**建议**保姆级指导，将从前序提取出的 trafficBoosters 节日/活动热点**经人设改写后**融入，例如明确指出使用什么具体平台搜索关键词。**场景与镜头须与人设各维一致**；${PLATFORM_COPY_VIVID_SCENES_GUIDANCE} **第 5 条（维度 5）**建议在视觉与场域上与前几段方案明显区隔。
     【脚本排版·建议格式（可灵活，勿牺牲可读性）】：
     ▸ 如果 format 为「短视频」（抖音/B站/快手）：**建议**用时间轴分段，每段含「视觉描述」与「口播文案」，例如：
       "[00:00-00:05] 视觉：手持一本泛黄史书特写，对准镜头。文案：你以为熬夜只是意志力差？古人早有另一套说法。"
       "[00:05-00:20] 视觉：切换青铜器/舆图与当代书桌并置。文案：把典籍里的一句，翻译成今天能用的生活判断……"
       "[00:20-00:45] 视觉：旅行/球场/音乐现场等生活场域。文案：给你两个可立刻试的觉察动作——完整路径，我们私聊再拆。"
     ▸ 如果 format 为「图文」（小红书）：**必须**写成**读者可直接收藏发布**的笔记页大纲，用 \`[封面]\`/\`[图2]\`…\`[图N]\`。每页只写读者用得上的生活/知识要点（痛点、误区、场景、关系、节律、常见问、评论领清单）。
       **严禁**在图文大纲里写创作者技术指导页：禁止「今晚拍封面素材 / 拆成八页 / 同步录60秒 / 发布建议 / hashtag 墙 / 怎么拍怎么发 / 落地执行三步曲」等元内容——那些属于 publishingAdvice 或短视频，**不要**画进图文格。
       对标正常可发笔记结构示例：
       "[封面] 别再对爸妈说你该运动了"
       "[图2] 你可能是这三类人……"
       "[图3] 这些误区让你越走越累……"
       "[图4] 先看场景：平路、微风、灯光软……"
       "[图5] 再看关系：改成陪我走十分钟……"
       "[图6] 再看节律：可重复的小顺序……"
       "[图7] 大家真正想搜的三个问题……"
       "[图8] 想要清单？评论区打「饭后散步」"
   - publishingAdvice（发布时机或平台设置建议，例如“蹭小红书RED新生代大赛热点，修改小红书简介为‘用东方审美重构健康叙事’”等具体设置。）
   - highlightKeywords（字符串数组：本条实际嵌入的蓝海词/高亮搜索词 2–6 个，须来自 blueOceanLexicon 或 tagCandidates，禁止堆砌无关标签）
   - platformVariants（**必须**：数组，覆盖 xiaohongshu / bilibili / weixin_channels；每项含 platform、format、hook、coverHeadline(8–14字)、coverSubline、tags、blueOceanKeywords(1–3且三平台不同)、reuseMainCopy。主文案一套，三平台只差这三块+标签。**当主 format=图文时，xiaohongshu.format 必须=图文且 reuseMainCopy=false**。主 format=短视频时小红书可为短视频 reuseMainCopy=true。B站与视频号默认短视频。视频号参照 weixinChannelsDouyinHotRef。）
   - executionDetails（执行细节，**建议**极度具体）：
     * environmentAndWardrobe（拍摄环境 + 服装道具描述，须写出**具体场所与氛围**（可参考博物馆、户外景区、泳池、球场、音乐厅、餐厅、大排档等生动场域，须贴合人设），例如："市立博物馆青铜器展厅侧光位，穿深色高定西装/丝绸衬衫，面料有羊毛或缎面质感，可点缀腕表或翡翠，整体呈 VOGUE/ELLE 时尚编辑大片气质"；**强监管赛道避免听诊器/CT 屏等临床强锚点**）
     * lightingAndCamera（灯光 + 机位，**高度需求专业影视手法**：写清主光方向/质感/色温/明暗比、运镜意图与情绪服务关系；可借用高反差建筑光、温暖魔术时刻、光晕剪影、雾霾大光域、霓虹溢光、精密冷光、天气即光、动机窗光、剧集人物主光等——按段落选用一种主手法。**禁止**点名导演/片名或写「某某味/致敬」。例如："窗侧动机光 + 伦勃朗补光，色温偏暖，明暗比 4:1，轮廓光勾勒西装质感；手机固定支架正面对拍"）
     * stepByStepScript（逐步脚本；**强烈建议**每步含画面 + 运镜 + 灯光要点 + 情绪表达 + 口播节奏。例如：["【0-3秒】钩子｜侧光高反差｜缓推｜克制好奇：……","【3-15秒】痛点｜略压暗青冷｜固定｜紧绷：……","【15-25秒】解法｜柔窗光｜微推｜释然：……","【25-35秒】CTA｜正面暖柔光｜正反打｜邀请感：……"]）

2. monetizationLanes：生成 1-2 条强相关的变现路径（例如"知识付费-深度私人顾问交流"）。必须包含：
   - title（变现方向名，具体到品类）
   - fitReason（为什么适合此用户，基于其具体人设各维：职业、身份、兴趣、爱好、专长等）
   - offerShape（交付形态，例如"90分钟1v1深度交流+书面要点"）
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
      "highlightKeywords": ["蓝海词1", "蓝海词2"],
      "platformVariants": [
        {
          "platform": "xiaohongshu",
          "format": "图文或短视频",
          "hook": "小红书停滑句",
          "coverHeadline": "八到十四字主句",
          "coverSubline": "可选副标",
          "tags": ["标签1", "标签2"],
          "blueOceanKeywords": ["词1"],
          "reuseMainCopy": false
        },
        {
          "platform": "bilibili",
          "format": "短视频",
          "hook": "B站停滑句",
          "coverHeadline": "知识反差主句",
          "tags": ["标签A"],
          "blueOceanKeywords": ["词2"],
          "reuseMainCopy": false
        },
        {
          "platform": "weixin_channels",
          "format": "短视频",
          "hook": "视频号人话钩子",
          "coverHeadline": "生活一句主句",
          "tags": ["标签B"],
          "blueOceanKeywords": ["词3"],
          "reuseMainCopy": false
        }
      ],
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

3. 你给出的「现在就能执行的动作」(以及 executionDetails 和 actionableSteps)，**建议**极度具体的「物理级微小行动」。**不建议**写「制作身份名片」、「锁定文化符号」这类空泛顾问废话。**建议**具体到像这样：「第一步：拿一颗金属螺丝钉和一块木制榫卯，对着镜头录制一段 15 秒的对比短片。」越具体、越反常识越好。

4. **建议**详细、有落地感，避免泛泛而谈。${PLATFORM_COPY_VIVID_SCENES_GUIDANCE} 文案、脚本中的场景与主张须能用**人设各维**（职业、身份、兴趣、爱好、专长）解释。在详细脚本与指导设计中，融入从 Call 2 (platformMenu) 提取出的 \`trafficBoosters\` 热点或活动时**须经人设改写适配**，**不建议**硬套。同步自然嵌入 blueOceanLexicon 中的蓝海词与标签。${personaConstraint}

【重要】直接输出原始 JSON 对象，不要用 markdown 代码块包裹（不要加 \`\`\`json 或 \`\`\`），不要在 JSON 前后加任何解释文字。输出的第一个字符必须是 {，最后一个字符必须是 }。
字段为：contentBlueprints（数组，每项含 title/format/hook/copywriting/suitablePlatforms/executionDetails）, monetizationLanes。`,
      },
      {
        role: "user",
        content: stage2UserJsonString,
      },
  ];

  const stage2LlmMode: PlatformStage2LlmMode = "openai";
  diagnostics.stage2LlmMode = stage2LlmMode;
  diagnostics.stage2LlmModeSource = "fixed_gpt56_sol";
  const openaiCreativeModel = getPlatformStage2OpenAiModel();
  const stage2ReasoningEffort = resolvePlatformStage2OpenAiReasoningEffort();
  diagnostics.platformStage2OpenAiModel = openaiCreativeModel;
  diagnostics.platformStage2OpenAiReasoningEffort = stage2ReasoningEffort;

  console.log("[buildPlatformContent] Stage2 incremental LLM", {
    stage2LlmMode,
    stage2LlmModeSource: diagnostics.stage2LlmModeSource,
    openaiModel: openaiCreativeModel,
    mode: "parallel_per_dimension",
  });

  // ── 逐條生成：每個維度獨立呼叫 LLM，每條完成後立即回呼 onBlueprintGenerated ──────────
  // 共 5 條 contentBlueprints（維度 1-5）+ 1 次 monetizationLanes，並行發出。
  // 任一條失敗不中斷整體：記錯誤、繼續其他條。

  const systemContent = String(structuredStage2Messages.find((m) => m.role === "system")?.content ?? "");
  const userContent = String(structuredStage2Messages.find((m) => m.role === "user")?.content ?? "");

  /**
   * 為單一維度生成一條 blueprint。
   * Prompt 告知 LLM 只輸出這個維度的方案，格式：`{ "blueprint": { ...fields } }`。
   */
  const tryJson = (s: string): unknown | null => {
    const t = String(s || "").trim();
    if (!t) return null;
    try { return JSON.parse(t); } catch { return null; }
  };

  const parseSingleBlueprintRaw = (raw: string): Record<string, unknown> | null => {
    const candidates = [
      extractJsonString(raw),
      (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? m[0] : ""; })(),
      raw,
    ];
    for (const c of candidates) {
      if (!c.trim()) continue;
      const v = tryJson(c);
      if (!v || typeof v !== "object" || Array.isArray(v)) continue;
      const obj = v as Record<string, unknown>;
      // Unwrap `{ blueprint: {...} }` or `{ contentBlueprints: [{...}] }` or root blueprint fields
      if (obj.blueprint && typeof obj.blueprint === "object" && !Array.isArray(obj.blueprint)) {
        return obj.blueprint as Record<string, unknown>;
      }
      if (Array.isArray(obj.contentBlueprints) && obj.contentBlueprints.length > 0) {
        const first = obj.contentBlueprints[0];
        if (first && typeof first === "object" && !Array.isArray(first)) return first as Record<string, unknown>;
      }
      // root object with known blueprint fields
      if (obj.title || obj.hook || obj.copywriting || obj.format) return obj;
    }
    return null;
  };

  const parseMonetizationRaw = (raw: string): unknown[] => {
    const candidates = [
      extractJsonString(raw),
      (() => { const m = raw.match(/\{[\s\S]*\}/); return m ? m[0] : ""; })(),
      raw,
    ];
    for (const c of candidates) {
      if (!c.trim()) continue;
      const v = tryJson(c);
      if (!v || typeof v !== "object") continue;
      if (Array.isArray(v)) return v;
      const obj = v as Record<string, unknown>;
      if (Array.isArray(obj.monetizationLanes)) return obj.monetizationLanes as unknown[];
      if (Array.isArray(obj.lanes)) return obj.lanes as unknown[];
    }
    return [];
  };

  type OpenAiEffort = NonNullable<Parameters<typeof invokeLLM>[0]["reasoningEffort"]>;

  const invokeOneBlueprintLlm = async (
    dimIndex: number,
    dimName: string,
    dimReasoning: OpenAiEffort = stage2ReasoningEffort,
  ): Promise<Record<string, unknown> | null> => {
    // 痛点(2) / 人设(3) / 长尾(5) 优先图文，凑满「至少 3 条图文」测小红书流量
    const preferGraphicNote = dimIndex === 2 || dimIndex === 3 || dimIndex === 5;
    const formatHint = preferGraphicNote
      ? `本维度 **优先 format=「图文」**（小红书笔记）；detailedScript 用 [封面]/[图2]…[图N] 攻略大纲；platformVariants.xiaohongshu.format=图文、reuseMainCopy=false。`
      : `本维度可用短视频；若更适合收藏型清单/避坑笔记，也可选图文。`;
    // Per-dimension system override: tell LLM to output exactly ONE blueprint for this dimension
    const dimSystemSuffix = `

【本次任務限制】本次請求只需輸出維度 ${dimIndex + 1}「${dimName}」的 **一條** blueprint。
【体裁】${formatHint}
輸出格式必須嚴格為：
{ "blueprint": { "title": "...", "format": "短视频 或 图文", "hook": "...", "copywriting": "（≥200字完整正文）", "suitablePlatforms": ["小红书","B站","视频号"], "actionableSteps": [...], "detailedScript": "（≥400字分鏡或图文大纲）", "publishingAdvice": "...", "highlightKeywords": [...], "platformVariants": [{"platform":"xiaohongshu","format":"图文或短视频","hook":"...","coverHeadline":"...","tags":[...],"blueOceanKeywords":[...],"reuseMainCopy":false},{"platform":"bilibili","format":"短视频","hook":"...","coverHeadline":"...","tags":[...],"blueOceanKeywords":[...]},{"platform":"weixin_channels","format":"短视频","hook":"...","coverHeadline":"...","tags":[...],"blueOceanKeywords":[...]}], "executionDetails": { "environmentAndWardrobe": "...", "lightingAndCamera": "...", "stepByStepScript": [...] } } }
不輸出其他鍵（不要 contentBlueprints 陣列、不要 monetizationLanes）。第一個字元必須是 {，最後必須是 }。`;

    const dimMessages: typeof structuredStage2Messages = [
      { role: "system", content: systemContent + dimSystemSuffix },
      { role: "user", content: userContent },
    ];

    const invoke = (effort?: OpenAiEffort) => invokeLLM({
      provider: "openai",
      modelName: openaiCreativeModel,
      // 每條 blueprint 獨立 token 預算；給滿 65K headroom，避免 high 推理把輸出預算耗盡 → 空回。
      max_tokens: STAGE2_SHARED_MAX_OUTPUT_TOKENS,
      temperature: STAGE2_LLM_TEMPERATURE,
      response_format: { type: "json_object" },
      messages: dimMessages,
      abortSignal: params.abortSignal,
      reasoningEffort: effort ?? dimReasoning,
    });

    try {
      let res = await invoke();
      let rawText = extractFirstChoicePlainText(res).trim();
      // Retry if empty (reasoning budget exhaustion)
      if (!rawText) {
        res = await invoke("minimal");
        rawText = extractFirstChoicePlainText(res).trim();
      }
      if (!rawText) return null;
      return parseSingleBlueprintRaw(rawText);
    } catch (e) {
      console.warn(`[buildPlatformContent] dim ${dimIndex + 1} (${dimName}) failed:`, e instanceof Error ? e.message : e);
      return null;
    }
  };

  const invokeMonetizationLlm = async (): Promise<unknown[]> => {
    const monetizationSystemOverride = `

【本次任務限制】本次請求只需輸出 monetizationLanes（1-2 條變現路徑），不輸出 contentBlueprints。
格式：{ "monetizationLanes": [ { "title": "...", "fitReason": "...", "offerShape": "...", "revenueModes": [...], "firstValidation": "..." } ] }
第一個字元必須是 {，最後必須是 }。`;

    const monetizationMessages: typeof structuredStage2Messages = [
      { role: "system", content: systemContent + monetizationSystemOverride },
      { role: "user", content: userContent },
    ];

    try {
      const res = await invokeLLM({
        provider: "openai",
        modelName: openaiCreativeModel,
        // 變現條較短，但仍給足 headroom（16K）並走 high：fit 判斷需要策略推理。
        max_tokens: Math.min(STAGE2_SHARED_MAX_OUTPUT_TOKENS, 16000),
        temperature: STAGE2_LLM_TEMPERATURE,
        response_format: { type: "json_object" },
        messages: monetizationMessages,
        abortSignal: params.abortSignal,
        reasoningEffort: "high",
      });
      const rawText = extractFirstChoicePlainText(res).trim();
      if (!rawText) return [];
      return parseMonetizationRaw(rawText);
    } catch (e) {
      console.warn("[buildPlatformContent] monetizationLanes call failed:", e instanceof Error ? e.message : e);
      return [];
    }
  };

  // 6 個維度並行 + 1 個 monetizationLanes 並行（共 7 個並行 LLM 呼叫）
  // 每條 blueprint 完成後立即回呼 onBlueprintGenerated
  const collectedBlueprints: Array<Record<string, unknown> | null> = new Array(BLUEPRINT_DIMENSIONS.length).fill(null);
  let completedCount = 0;

  const dimensionPromises = BLUEPRINT_DIMENSIONS.map(async ({ index, name, reasoning }) => {
    const dimIndex = index - 1; // 0-based
    const bp = await invokeOneBlueprintLlm(dimIndex, name, reasoning);
    collectedBlueprints[dimIndex] = bp;
    if (bp) {
      completedCount++;
      if (params.onBlueprintGenerated) {
        try {
          await params.onBlueprintGenerated(bp, dimIndex);
        } catch (cbErr) {
          console.warn("[buildPlatformContent] onBlueprintGenerated callback error:", cbErr);
        }
      }
      console.log(`[buildPlatformContent] dim ${index} (${name}) done · total=${completedCount}`);
    } else {
      console.warn(`[buildPlatformContent] dim ${index} (${name}) returned null, skipped`);
    }
  });

  const [, rawMonetization] = await Promise.all([
    Promise.all(dimensionPromises),
    invokeMonetizationLlm(),
  ]);

  // Aggregate: filter out failed (null) blueprints, preserve order
  const rawBp = collectedBlueprints.filter((bp): bp is Record<string, unknown> => bp !== null);
  diagnostics.blueprintDimResults = collectedBlueprints.map((bp, i) => ({
    dim: i + 1,
    success: bp !== null,
    title: bp ? String(bp.title || "").slice(0, 60) : null,
  }));
  diagnostics.blueprintCountCollected = rawBp.length;
  diagnostics.llmPath = "openai_parallel_per_dimension";

  const coercedBp = rawBp.map((item: unknown) => {
    if (item != null && typeof item === "object" && !Array.isArray(item)) {
      return item as Record<string, unknown>;
    }
    if (typeof item === "string") {
      return { title: "", hook: "", copywriting: item };
    }
    return { title: "", hook: "", copywriting: "" };
  });
  const blueprintsForSchema = coercedBp.length > 48 ? coercedBp.slice(0, 48) : coercedBp;

  const rawMl = Array.isArray(rawMonetization) ? rawMonetization : [];
  const monetizationCoerced = (rawMl as unknown[]).map((item: unknown) => {
    if (item != null && typeof item === "object" && !Array.isArray(item)) return item as Record<string, unknown>;
    if (typeof item === "string") {
      return { title: "", fitReason: item, offerShape: "", revenueModes: [] as string[], firstValidation: "" };
    }
    return { title: "", fitReason: "", offerShape: "", revenueModes: [] as string[], firstValidation: "" };
  });

  const partial = normalizePlatformContentKeys({
    contentBlueprints: blueprintsForSchema,
    monetizationLanes: monetizationCoerced,
  });
  const partialForParse = {
    contentBlueprints: Array.isArray(partial.contentBlueprints) ? partial.contentBlueprints : blueprintsForSchema,
    monetizationLanes: Array.isArray(partial.monetizationLanes) ? partial.monetizationLanes : monetizationCoerced,
  };

  diagnostics.normalizedTopLevelKeys = Object.keys(partial);
  diagnostics.blueprintCountAfterKeyNormalize = rawBp.length;
  diagnostics.monetizationCountAfterKeyNormalize = rawMl.length;
  diagnostics.blueprintCountAfterCoerce = blueprintsForSchema.length;
  diagnostics.monetizationCountAfterCoerce = monetizationCoerced.length;

  {
    const steps: Array<{ id: string; title: string; model: string; status: string }> = BLUEPRINT_DIMENSIONS.map((d, i) => ({
      id: `2-dim${d.index}`,
      title: d.name,
      model: openaiCreativeModel,
      status: collectedBlueprints[i] !== null ? "✅ 已完成" : "❌ 失敗（跳過）",
    }));
    steps.push({
      id: "2-monetization",
      title: "monetizationLanes",
      model: openaiCreativeModel,
      status: rawMl.length > 0 ? "✅ 已完成" : "⚠️ 空",
    });
    diagnostics.stage2SubSteps = steps;
    diagnostics.stage2SubStepsSummary = steps
      .map((s) => `${s.id} ${s.title} · model=${s.model} · ${s.status}`)
      .join(" → ");
  }

  const parseResult = platformContentResponseSchema.safeParse(partialForParse);
  if (parseResult.success) {
    return {
      data: attachTitleVariantsToPlatformContent(parseResult.data),
      diagnostics: { ...diagnostics, zodPath: "strict_ok" },
    };
  }

  console.error("[buildPlatformContent] schema drift detected:", (parseResult.error as any).issues?.slice(0, 5) ?? parseResult.error.message);
  diagnostics.zodStrictIssues = (parseResult.error as any).issues?.slice(0, 12) ?? String(parseResult.error.message);
  const looseResult = platformContentResponseSchema.safeParse({
    contentBlueprints: blueprintsForSchema,
    monetizationLanes: monetizationCoerced,
  });
  if (looseResult.success) {
    return {
      data: attachTitleVariantsToPlatformContent(looseResult.data),
      diagnostics: { ...diagnostics, zodPath: "loose_ok" },
    };
  }
  console.error("[buildPlatformContent] loose parse also failed:", (looseResult.error as any).issues?.slice(0, 5) ?? looseResult.error.message);
  diagnostics.zodLooseIssues = (looseResult.error as any).issues?.slice(0, 12) ?? String(looseResult.error.message);
  return {
    data: attachTitleVariantsToPlatformContent({
      contentBlueprints: blueprintsForSchema as any[],
      monetizationLanes: monetizationCoerced as any[],
    }),
    diagnostics: { ...diagnostics, zodPath: "fallback_coerced_no_throw" },
  };
}

const STAGE2_DIAG_JOB_STRING_MAX = 3500;

/**
 * platform_build_content 寫入 job / 回傳前瘦身 diagnostics，避免長字串與多餘片段在序列化與持有期佔滿堆。
 * （完整診斷仍可由服務端 console / 日誌追；此處只保留除錯足夠的預覽。）
 */
export function slimBuildPlatformContentDiagnosticsForJob(d: Record<string, unknown>): Record<string, unknown> {
  const slim: Record<string, unknown> = { ...d };
  delete slim.rawContentHead280;
  delete slim.rawContentTail280;
  const trunc = (s: string, max: number) =>
    s.length <= max ? s : `${s.slice(0, max)}\n…[truncated ${s.length - max} chars for job payload]`;
  for (const key of Object.keys(slim)) {
    const v = slim[key];
    if (typeof v === "string" && v.length > STAGE2_DIAG_JOB_STRING_MAX) {
      slim[key] = trunc(v, STAGE2_DIAG_JOB_STRING_MAX);
    }
  }
  return slim;
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
    contentBlueprints: params.snapshot.titleExecutions.slice(0, 6).map((item) => ({
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
    encouragement: "这轮先把第一条内容和第一条承接验证出来，不要同时铺五条线。",
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

  // Use extractFirstChoicePlainText to handle GPT-5 multi-part content arrays,
  // reasoning-only responses (empty content), and other provider-specific formats.
  // Then strip any markdown fences before JSON.parse to avoid "Unexpected token '<'"
  // or "Unexpected token '`'" when Evolink returns an HTML page or the model wraps JSON.
  const rawText = extractFirstChoicePlainText(response);
  if (!rawText.trim()) {
    throw new Error("personalizeGrowthSnapshot: LLM returned empty content (possible Evolink 524 or reasoning budget exhausted)");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonString(rawText));
  } catch (jsonErr) {
    throw new Error(`personalizeGrowthSnapshot: JSON parse failed — ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)} — head: ${rawText.slice(0, 120)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("personalizeGrowthSnapshot: parsed result is not an object");
  }
  const parsedObj = parsed as Record<string, unknown>;
  return growthSnapshotPersonalizationSchema.parse({
    ...parsedObj,
    decisionFramework: parsedObj?.decisionFramework || snapshot.decisionFramework,
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
  paidTrafficReviews: paidTrafficReviewsRouter,
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
  enterpriseAgents: enterpriseAgentsRouter,
  workflow: workflowRouter,
  videoParser: router({
    parse: protectedProcedure
      .input(z.object({ url: z.string().url() }))
      .mutation(async ({ input }) => {
        const { parseVideoUrl } = await import('./services/videoParserService.js');
        return parseVideoUrl(input.url);
      }),
    checkHealth: protectedProcedure.query(async () => {
      const { checkYtdlpHealth } = await import('./services/videoParserService.js');
      return checkYtdlpHealth();
    }),
  }),
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

  /** 時間 / 天氣 / 路況 / 即時新聞（免登入；新聞約 30 分鐘、天氣路況約 10 分鐘節流） */
  ambient: router({
    /** 天氣 + 路況 + 時間（建議前端 10 分鐘 refetch） */
    dashboardLive: publicProcedure
      .input(
        z.object({
          timeZone: z.string().min(1).max(64).optional(),
          weatherCity: z.string().min(1).max(120).optional(),
          lat: z.number().gte(-90).lte(90).optional(),
          lon: z.number().gte(-180).lte(180).optional(),
          trafficLocation: z.string().min(1).max(200).optional(),
        }),
      )
      .query(async ({ input }) => {
        const { executeDashboardLive } = await import("./services/hybridDashboardEngine.js");
        return executeDashboardLive({
          timeZone: input.timeZone,
          weatherCity: input.weatherCity,
          lat: input.lat,
          lon: input.lon,
          trafficLocation: input.trafficLocation,
        });
      }),
    /** 即時新聞：Gemini 為主（建議前端 30 分鐘 refetch）；可傳瀏覽器定位以差異化周邊 2 條 */
    dashboardNews: publicProcedure
      .input(
        z.object({
          lat: z.number().gte(-90).lte(90).optional(),
          lon: z.number().gte(-180).lte(180).optional(),
        }),
      )
      .query(async ({ input }) => {
        const { executeDashboardNews } = await import("./services/hybridDashboardEngine.js");
        return executeDashboardNews(input);
      }),
    hybridDashboard: publicProcedure
      .input(
        z.object({
          timeZone: z.string().min(1).max(64).optional(),
          weatherCity: z.string().min(1).max(120).optional(),
          lat: z.number().gte(-90).lte(90).optional(),
          lon: z.number().gte(-180).lte(180).optional(),
          trafficLocation: z.string().min(1).max(200).optional(),
        }),
      )
      .query(async ({ input }) => {
        const { executeHybridDashboardPipeline } = await import("./services/hybridDashboardEngine.js");
        return executeHybridDashboardPipeline({
          timeZone: input.timeZone,
          weatherCity: input.weatherCity,
          lat: input.lat,
          lon: input.lon,
          trafficLocation: input.trafficLocation,
        });
      }),
    /** 吉祥物情緒關懷短語（Gemini）：僅 Admin / Supervisor 可調用，前台不提供入口 */
    mascotCareMessage: adminProcedure
      .input(
        z.object({
          userNote: z.string().max(800).optional(),
          currentTime: z.string().max(160).optional(),
          pagePath: z.string().max(200).optional(),
          weather: z
            .object({
              condition: z.string().max(80),
              temperature: z.string().max(40),
              humidity: z.string().max(40),
            })
            .optional(),
          trafficSummary: z.string().max(2000).optional(),
          trafficAreas: z.array(z.string().max(120)).max(10).optional(),
          newsLines: z.array(z.string().max(320)).max(12).optional(),
          changeHints: z.array(z.string().max(200)).max(6).optional(),
        }),
      )
      .mutation(async ({ input }) => {
        const { generateMascotCareMessage } = await import("./services/mascotCareMessage.js");
        const message = await generateMascotCareMessage({
          userNote: input.userNote,
          currentTime: input.currentTime,
          pagePath: input.pagePath,
          weather: input.weather,
          trafficSummary: input.trafficSummary,
          trafficAreas: input.trafficAreas,
          newsLines: input.newsLines,
          changeHints: input.changeHints,
        });
        return { message };
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

    analyzeGrowthCampImages: publicProcedure
      .input(
        z.object({
          images: z
            .array(
              z
                .object({
                  gcsUri: z.string().min(1).optional(),
                  fileBase64: z.string().min(1).optional(),
                  mimeType: z.string().min(1),
                  fileName: z.string().optional(),
                })
                .refine((item) => Boolean(String(item.gcsUri || "").trim() || String(item.fileBase64 || "").trim()), {
                  message: "每张图片需提供 gcsUri 或 fileBase64",
                }),
            )
            .min(1)
            .max(64),
          context: z.string().optional(),
          modelName: growthCampModelSchema.optional(),
          mode: growthAnalysisModeSchema.default("GROWTH"),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (!ctx.user?.id) {
          throw new Error("請先登入，才能使用分析功能");
        }
        // 积分在 growth_analyze_images Job 内扣除；此 mutation 仅供兼容/调试，勿在前端主路径调用
        const result = await analyzeGrowthCampImages(input);
        return {
          success: true,
          analysis: result.analysis,
          fileUrls: result.imageMeta.fileUrls,
          imageCount: result.imageMeta.imageCount,
          debug: {
            route: "analyzeGrowthCampImages",
            provider: result.imageMeta.provider,
            model: result.imageMeta.model,
            fallback: result.imageMeta.fallback,
            primaryError: result.imageMeta.primaryError || null,
            imageCount: result.imageMeta.imageCount,
          },
        };
      }),

    synthesizeGrowthCampAnalyses: publicProcedure
      .input(
        z.object({
          parts: z
            .array(
              z.object({
                label: z.string().min(1).max(120),
                analysis: growthAnalysisScoresSchema,
              }),
            )
            .min(2)
            .max(16),
          context: z.string().optional(),
          modelName: growthCampModelSchema.optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        if (!ctx.user?.id) {
          throw new Error("請先登入，才能使用分析功能");
        }
        const analysis = await synthesizeGrowthAnalyses(input);
        return { success: true, analysis };
      }),

    getVideoUploadSignedUrl: publicProcedure
      .input(z.object({
        fileName: z.string().min(1),
        mimeType: z.string().min(1),
        objectName: z.string().min(1).optional(),
      }))
      .mutation(async ({ input }) => {
        return createGcsSignedUploadUrl({
          fileName: input.fileName,
          contentType: input.mimeType,
          objectName: input.objectName,
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
        windowDays: z.union([z.literal(3), z.literal(7), z.literal(15), z.literal(30), z.literal(45)]).optional(),
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
        const platformInventory = Object.fromEntries(
          requestedPlatforms.map((platform) => {
            const items = store.collections?.[platform]?.items || [];
            const warehouseTotal = items.length;
            const window15 = summarizeTrendWindowCounts(items, 15);
            const window30 = summarizeTrendWindowCounts(items, selectedWindowDays);
            return [platform, {
              warehouseTotal,
              window15d: window15.windowFiltered,
              window30d: window30.windowFiltered,
              selectedWindowDays: selectedWindowDays,
              selectedWindowFiltered: window30.windowFiltered,
            }];
          }),
        );
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
                abortSignal: ctx.clientDisconnected,
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
            platformInventory,
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
        windowDays: z.union([z.literal(3), z.literal(7), z.literal(15), z.literal(30), z.literal(45)]),
        snapshot: growthSnapshotSchema,
        copyLlmMode: zPlatformCopyLlmModeInput,
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
              `平台趋势续分析 (${input.windowDays}天 / GPT 5.5)`,
            );
          }
        }
        const followUpCopyLlmMode: PlatformStage2LlmMode = "openai";
        const followUpModel = getPlatformStage2OpenAiModel();
        try {
          const { raw: rawFollowUpContent, modelName: followUpModelUsed } =
            await invokePlatformFollowUpGpt55({
              windowDays: input.windowDays,
              context: input.context || "",
              question: input.question,
              snapshot: input.snapshot,
            });

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
              modelName: followUpModelUsed || followUpModel,
              provider: "openai",
              copyLlmMode: followUpCopyLlmMode,
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
              modelName: followUpModel,
              provider: "openai",
              copyLlmMode: followUpCopyLlmMode,
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
        // ── 维护模式拦截：开启时拒绝新付费任务 ─────────────────────────────
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("平台數據分析");

        // ── 扣費：每次平台數據分析扣 platformTrend（50 cr）─────────────────
        let creditsBilled = 0;
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
            creditsBilled = cost;
          }
        } else {
          throw new Error("請先登入，才能使用平台數據分析功能");
        }

        const jobId = nanoid(16);

        // ── paidJobLedger：登记 active hold（runner.ts 失败兜底退积分） ────
        if (creditsBilled > 0) {
          const { registerActiveJob } = await import("./services/paidJobLedger");
          await registerActiveJob({
            jobId,
            taskType: "platformAnalysis",
            userId: ctx.user.id,
            creditsBilled,
            action: `平台數據分析（${input.windowDays}天窗口）`,
            externalApiCostHint: "Gemini 3.1 Pro 双阶段推演",
            metadata: {
              windowDays: input.windowDays,
              requestedPlatforms: input.requestedPlatforms,
            },
          }).catch((e: any) => {
            console.warn(`[platformAnalysis] registerActiveJob 失败（non-fatal）：${e?.message}`);
          });
        }

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
              // 让 runner 知道这次的 ledger 任务类型，方便结清/退积分
              _ledger: { taskType: "platformAnalysis", creditsBilled },
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
          provider: "openai",
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
        const timeoutId = setTimeout(() => controller.abort(), getPdfWorkerFetchTimeoutMs());
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
        const timeoutId = setTimeout(() => controller.abort(), getPdfWorkerFetchTimeoutMs());
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

    /** 瀏覽器直傳 HTML 快照到 GCS（與異步 pdf_export 同桶），供作品庫 queuePdfFromHtml。 */
    getPdfHtmlSnapshotUploadUrl: protectedProcedure.mutation(async ({ ctx }) => {
      const safeUser = String(ctx.user.id).replace(/[^0-9a-zA-Z_-]/g, "");
      const objectName = `pdf-async/html/${safeUser}/${Date.now()}-${nanoid(12)}.html`;
      return createGcsSignedUploadUrl({
        contentType: "text/html; charset=utf-8",
        objectName,
        bucket: resolvePdfExportBucketName(),
        expiresInMinutes: 45,
      });
    }),

    /** 異步 PDF：HTML 快照已在 GCS 時入隊，後台 html → pdf-worker → PDF 上傳 GCS → 簽名下載鏈。 */
    queuePdfFromHtml: protectedProcedure
      .input(
        z.object({
          htmlGcsUri: z.string().regex(/^gs:\/\//, "必須為 gs:// URI"),
          token: z.string().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const jobId = nanoid(16);
        await createJobRecord({
          id: jobId,
          userId: String(ctx.user.id),
          type: "pdf_export",
          provider: "pdf-worker-async",
          input: {
            action: "render_html",
            params: {
              htmlGcsUri: input.htmlGcsUri,
              token: input.token ?? "",
            },
          },
        });
        return { jobId, status: "queued" as const };
      }),

    /** 查詢異步 PDF 任務（含 _pdfDebug 步驟時間線，供 God View DEBUG）。 */
    getPdfExportJob: protectedProcedure
      .input(z.object({ jobId: z.string().min(1) }))
      .query(async ({ ctx, input }) => {
        const job = await getJobById(input.jobId);
        if (!job || job.type !== "pdf_export") {
          throw new TRPCError({ code: "NOT_FOUND", message: "PDF 導出任務不存在" });
        }
        if (String(job.userId) !== String(ctx.user.id)) {
          throw new TRPCError({ code: "FORBIDDEN", message: "無權查看此任務" });
        }
        const rawInput = job.input;
        const pdfDebug =
          rawInput && typeof rawInput === "object" && !Array.isArray(rawInput) && "_pdfDebug" in rawInput
            ? (rawInput as Record<string, unknown>)._pdfDebug
            : null;
        return {
          jobId: job.id,
          status: job.status,
          error: job.error,
          output: job.output,
          pdfDebug,
          provider: job.provider,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        };
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

    /**
     * 平台全案会话包 →「我的作品」：保存文案、执行卡（封面/分镜 URL）、深度追问、
     * 自定义文案、趋势报表、战略全景整页数据，供日后完整回看。
     */
    savePlatformSessionBundle: protectedProcedure
      .input(
        z.object({
          title: z.string().min(2).max(200),
          thumbnailUrl: z.string().url().optional(),
          windowDays: z.number().int().min(1).max(90).optional(),
          platformDashboard: z.record(z.string(), z.any()).nullable().optional(),
          platformContent: z
            .object({
              contentBlueprints: z.array(z.any()).optional(),
              monetizationLanes: z.array(z.any()).optional(),
            })
            .nullable()
            .optional(),
          visualReport: z.record(z.string(), z.any()).nullable().optional(),
          decisionIntelReport: z.any().nullable().optional(),
          executionCards: z.array(z.any()).max(48).optional(),
          deepQa: z
            .object({
              question: z.string().max(2000).optional(),
              answer: z.string().max(20000).optional(),
              askedAt: z.string().max(64).optional(),
            })
            .nullable()
            .optional(),
          customCopy: z.string().max(50000).nullable().optional(),
          customTopicProtagonist: z.string().max(4000).nullable().optional(),
          notes: z.string().max(2000).optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const {
          PLATFORM_SESSION_BUNDLE_SCHEMA_VERSION,
          summarizePlatformSessionBundle,
        } = await import("../shared/platformSessionBundle.js");
        const plan = await getUserPlan(ctx.user.id);
        const bundle = {
          schemaVersion: PLATFORM_SESSION_BUNDLE_SCHEMA_VERSION,
          capturedAt: new Date().toISOString(),
          windowDays: input.windowDays,
          platformDashboard: input.platformDashboard ?? null,
          platformContent: input.platformContent ?? null,
          visualReport: input.visualReport ?? null,
          decisionIntelReport: input.decisionIntelReport ?? null,
          executionCards: Array.isArray(input.executionCards) ? input.executionCards.slice(0, 48) : [],
          deepQa: input.deepQa ?? null,
          customCopy: input.customCopy ?? null,
          customTopicProtagonist: input.customTopicProtagonist ?? null,
          notes: input.notes,
        };
        const summary = summarizePlatformSessionBundle(bundle);
        const id = await recordCreation({
          userId: ctx.user.id,
          type: "platform_session_bundle",
          title: input.title,
          thumbnailUrl: input.thumbnailUrl,
          metadata: {
            isPlatformSessionBundle: true,
            isSnapshot: true,
            analysisType: "platform",
            summary,
            analysisDate: bundle.capturedAt,
            bundle,
          },
          quality: "平台全案作品包",
          creditsUsed: 0,
          plan,
        });
        return { success: true, id };
      }),

    /** 个性化战略地图：首次体验价与历史次数（登录后可查） */
    getDecisionIntelligencePricing: protectedProcedure.query(async ({ ctx }) => {
      const database = await db.getDb();
      if (!database) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "數據庫不可用" });
      }
      const { userCreations } = await import("../drizzle/schema-creations");
      const { and, eq, count } = await import("drizzle-orm");
      const [countRow] = await database
        .select({ c: count() })
        .from(userCreations)
        .where(
          and(
            eq(userCreations.userId, ctx.user.id),
            eq(userCreations.type, "advanced_decision_report"),
            eq(userCreations.status, "completed"),
          ),
        );
      const priorCompletedCount = Number(countRow?.c ?? 0);
      const nextCredits =
        priorCompletedCount === 0
          ? CREDIT_COSTS.decisionIntelligenceReportFirst
          : CREDIT_COSTS.decisionIntelligenceReport;
      return {
        priorCompletedCount,
        nextCredits,
        standardCredits: CREDIT_COSTS.decisionIntelligenceReport,
        firstCredits: CREDIT_COSTS.decisionIntelligenceReportFirst,
      };
    }),

    /** 最近一次已付费生成的战略地图（免费重看，不必再次扣点） */
    getLatestDecisionIntelligenceReport: protectedProcedure.query(async ({ ctx }) => {
      const database = await db.getDb();
      if (!database) {
        return {
          report: null,
          creationId: null as number | null,
          createdAt: null as string | null,
          windowDays: null as null | 3 | 7 | 15 | 30 | 45,
          dateRange: null as string | null,
        };
      }
      const { userCreations } = await import("../drizzle/schema-creations");
      const { and, eq, desc } = await import("drizzle-orm");
      const [row] = await database
        .select()
        .from(userCreations)
        .where(
          and(
            eq(userCreations.userId, ctx.user.id),
            eq(userCreations.type, "advanced_decision_report"),
            eq(userCreations.status, "completed"),
          ),
        )
        .orderBy(desc(userCreations.createdAt))
        .limit(1);
      if (!row?.metadata) {
        return { report: null, creationId: null, createdAt: null, windowDays: null, dateRange: null };
      }
      try {
        const meta = JSON.parse(row.metadata) as { report?: unknown };
        if (meta?.report && typeof meta.report === "object") {
          const wdRaw = (meta as { windowDays?: unknown }).windowDays;
          const windowDays =
            typeof wdRaw === "number" && (wdRaw === 15 || wdRaw === 30 || wdRaw === 45) ? wdRaw : null;
          const drRaw = (meta as { dateRange?: unknown }).dateRange;
          const dateRange = typeof drRaw === "string" && drRaw.trim() ? drRaw.trim() : null;
          return {
            report: meta.report,
            creationId: row.id,
            createdAt: row.createdAt ? new Date(row.createdAt).toISOString() : null,
            windowDays,
            dateRange,
          };
        }
      } catch {
        /* ignore */
      }
      return { report: null, creationId: row.id, createdAt: null, windowDays: null, dateRange: null };
    }),

    /**
     * 解锁并生成个性化战略地图：本地数字壳 + 并行 Gemini Flash 扩写；缓存命中免扣点；
     * 双轨 Flash 皆失败不扣点；成功后才扣点并写入 user_creations。
     */
    generateDecisionIntelligenceReport: protectedProcedure
      .input(
        z.object({
          topic: z.string().max(160).optional(),
          contentBlueprint: z.unknown().optional(),
          platformHint: z.enum(["douyin", "bilibili", "xiaohongshu", "kuaishou"]).optional(),
          dateRange: z.string().max(120).optional(),
          windowDays: z.union([z.literal(3), z.literal(7), z.literal(15), z.literal(30), z.literal(45)]).optional(),
          /** 每次「全案分析」由前端递增，写入 requestHash，避免命中 user_creations 中上一份同参报告缓存。 */
          platformAnalysisEpoch: z.number().int().min(0).max(1_000_000_000).optional(),
          /** 可选：平台蓝海词词表，注入赠送选题扩写 */
          blueOceanLexicon: z
            .object({
              flat: z.array(z.string()).optional(),
              grouped: z.array(z.any()).optional(),
              tagCandidates: z.array(z.string()).optional(),
            })
            .optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const database = await db.getDb();
        if (!database) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "數據庫不可用" });
        }
        const { userCreations } = await import("../drizzle/schema-creations");
        const { and, eq, count } = await import("drizzle-orm");
        const [countRow] = await database
          .select({ c: count() })
          .from(userCreations)
          .where(
            and(
              eq(userCreations.userId, ctx.user.id),
              eq(userCreations.type, "advanced_decision_report"),
              eq(userCreations.status, "completed"),
            ),
          );
        const priorCompletedCount = Number(countRow?.c ?? 0);
        const cost =
          priorCompletedCount === 0
            ? CREDIT_COSTS.decisionIntelligenceReportFirst
            : CREDIT_COSTS.decisionIntelligenceReport;

        const { buildSimulatedAdvancedAIReport } = await import("../shared/advancedPredictionEngine.js");
        const { hashDecisionIntelligenceRequest, runGeminiFlashPipeline } = await import(
          "./services/decisionIntelligenceFlashPipeline.js",
        );
        const { generateDecisionIntelBonusBlueprints } = await import(
          "./services/decisionIntelBonusBlueprints.js",
        );

        const persistExecutionBlueprintsToSnapshot = async (blueprints: Record<string, unknown>[]) => {
          if (blueprints.length === 0) return;
          try {
            const { upsertPlatformBlueprintSnapshotEntries } = await import(
              "./services/platformStrategicBlueprintSnapshots.js"
            );
            await upsertPlatformBlueprintSnapshotEntries({
              userId: ctx.user.id,
              contentBlueprints: blueprints,
            });
          } catch (err) {
            console.warn(
              "[decisionIntel] snapshot upsert skipped:",
              err instanceof Error ? err.message.slice(0, 200) : err,
            );
          }
        };

        const attachBonusBlueprints = async (
          report: import("@shared/advancedAIReport").AdvancedAIReportData,
        ): Promise<Record<string, unknown>[]> => {
          try {
            const bonus = await generateDecisionIntelBonusBlueprints({
              report,
              contentBlueprint,
              topic,
              platformHint,
              blueOceanLexicon: input.blueOceanLexicon,
              abortSignal: ctx.clientDisconnected,
            });
            await persistExecutionBlueprintsToSnapshot(bonus);
            return bonus;
          } catch (err) {
            console.warn("[decisionIntel] bonus blueprints skipped:", err);
            return [];
          }
        };

        const now = new Date();
        const windowDays = input.windowDays ?? 15;
        const dateRange =
          input.dateRange?.trim() ||
          `${new Date(now.getTime() - windowDays * 864e5).toLocaleDateString("zh-CN")} — ${now.toLocaleDateString("zh-CN")}`;
        const topic = (input.topic || "").trim() || "个性化战略选题";
        const platformHint = input.platformHint ?? "douyin";
        const contentBlueprint =
          input.contentBlueprint ??
          ({
            summary: topic,
            source: "platform_strategic_map",
            userId: ctx.user.id,
          } as Record<string, unknown>);

        const requestHash = hashDecisionIntelligenceRequest({
          topic,
          contentBlueprint,
          platformHint,
          windowDays,
          platformAnalysisEpoch: input.platformAnalysisEpoch,
        });

        const [cached] = await database
          .select()
          .from(userCreations)
          .where(
            and(
              eq(userCreations.userId, ctx.user.id),
              eq(userCreations.type, "advanced_decision_report"),
              eq(userCreations.status, "completed"),
              sql`coalesce((${userCreations.metadata})::jsonb->>'requestHash','') = ${requestHash}`,
            ),
          )
          .limit(1);

        if (cached?.metadata) {
          try {
            const meta = JSON.parse(cached.metadata) as { report?: import("@shared/advancedAIReport").AdvancedAIReportData };
            if (meta?.report && typeof meta.report === "object") {
              const creditsInfo = await getCredits(ctx.user.id);
              const bonusExecutionBlueprints = await attachBonusBlueprints(meta.report);
              return {
                report: meta.report,
                chargedCredits: 0,
                creationId: cached.id,
                totalAvailable: creditsInfo.totalAvailable,
                fromCache: true as const,
                bonusExecutionBlueprints,
              };
            }
          } catch {
            /* 繼續正常生成 */
          }
        }

        const preCredits = await getCredits(ctx.user.id);
        if (preCredits.totalAvailable < cost) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `积分不足。解锁智库战略地图需要 ${cost} 点（当前可用 ${preCredits.totalAvailable}）。`,
          });
        }

        const baseReport = buildSimulatedAdvancedAIReport({
          topic,
          dateRange,
          contentBlueprint,
          platformData: { platform: platformHint },
          thinkingLevel: "MEDIUM",
          windowDays,
        });

        let enrichedReport: typeof baseReport;
        try {
          enrichedReport = await runGeminiFlashPipeline({
            base: baseReport,
            contentBlueprint,
            platformHint,
            topic,
            abortSignal: ctx.clientDisconnected,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.startsWith("DECISION_INTEL_GPT55_ALL_FAILED") || msg.startsWith("DECISION_INTEL_FLASH_ALL_FAILED")) {
            throw new TRPCError({
              code: "SERVICE_UNAVAILABLE",
              message: "智库文案扩写暂时不可用，请稍后重试（未扣点）。",
            });
          }
          throw err;
        }

        await deductCreditsAmount(ctx.user.id, cost, "decisionIntel", `个性化战略地图（${cost}点）`);

        const plan = await getUserPlan(ctx.user.id);
        const creationId = await recordCreation({
          userId: ctx.user.id,
          type: "advanced_decision_report",
          title: `战略地图 · ${enrichedReport.topic}`.slice(0, 250),
          metadata: {
            report: enrichedReport,
            schemaVersion: 2,
            requestHash,
            windowDays,
            dateRange,
            chargedCredits: cost,
            dataRetention: "user_ledger_advanced_decision_report",
            flashModel: "gemini-3.5-flash-via-GROWTH_CAMP_EXTRACTOR_MODEL",
          },
          creditsUsed: cost,
          plan,
          quality: "决策智库",
        });

        const creditsInfo = await getCredits(ctx.user.id);
        const bonusExecutionBlueprints = await attachBonusBlueprints(enrichedReport);
        return {
          report: enrichedReport,
          chargedCredits: cost,
          creationId,
          totalAvailable: creditsInfo.totalAvailable,
          fromCache: false as const,
          bonusExecutionBlueprints,
        };
      }),

    /** 战略地图：用户点选单条选题方向，扩写 1 套执行级文案（会话内展示，不入库） */
    generateDecisionIntelTopicExecutionCopy: protectedProcedure
      .input(
        z.object({
          topic: z.string().max(160).optional(),
          contentBlueprint: z.unknown().optional(),
          platformHint: z.enum(["douyin", "bilibili", "xiaohongshu", "kuaishou"]).optional(),
          /** true：防护性重生成（同选题首次免费，之后扣 decisionIntelTopicExecutionCopyRegenerate） */
          regenerate: z.boolean().optional(),
          pick: z.object({
            title: z.string().min(2).max(240),
            structure: z.string().min(4).max(8000),
            predictedCtr: z.number().optional(),
            predictedConversion: z.number().optional(),
            brandMatchFit: z.number().optional(),
            source: z.enum(["structure", "personalization"]).optional(),
          }),
          /** 可选：平台蓝海词词表，写入推演文案 */
          blueOceanLexicon: z
            .object({
              flat: z.array(z.string()).optional(),
              grouped: z.array(z.any()).optional(),
              tagCandidates: z.array(z.string()).optional(),
            })
            .optional(),
          /** /platform 勾选启用的 Skill id */
          enabledSkillIds: z.array(z.string().min(1).max(80)).max(24).optional(),
          allowBloggerTitle: z.boolean().optional(),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { generateDecisionIntelTopicBlueprints } = await import(
          "./services/decisionIntelBonusBlueprints.js"
        );
        const {
          decisionIntelTopicRegenDescriptionMarker,
          normalizeDecisionIntelTopicTitleKey,
        } = await import("../shared/decisionIntelTopicPicks.js");
        const topic = (input.topic || "").trim() || "个性化战略选题";
        const platformHint = input.platformHint ?? "douyin";
        const contentBlueprint =
          input.contentBlueprint ??
          ({
            summary: topic,
            source: "platform_strategic_map_pick",
            userId: ctx.user.id,
          } as Record<string, unknown>);

        const titleKey = normalizeDecisionIntelTopicTitleKey(input.pick.title);
        let chargedCredits = 0;
        let regenerateOrdinal = 0;

        if (input.regenerate) {
          const database = await db.getDb();
          if (!database) {
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "數據庫不可用" });
          }
          const { creditTransactions } = await import("../drizzle/schema.js");
          const { and, eq, count, sql } = await import("drizzle-orm");
          const marker = decisionIntelTopicRegenDescriptionMarker(titleKey);
          const [countRow] = await database
            .select({ c: count() })
            .from(creditTransactions)
            .where(
              and(
                eq(creditTransactions.userId, ctx.user.id),
                eq(creditTransactions.action, "decisionIntelTopicCopyRegen"),
                sql`${creditTransactions.description} LIKE ${`%${marker}%`}`,
              ),
            );
          regenerateOrdinal = Number(countRow?.c ?? 0) + 1;
          const cost =
            regenerateOrdinal <= 1 ? 0 : CREDIT_COSTS.decisionIntelTopicExecutionCopyRegenerate;
          if (cost > 0) {
            await deductCreditsAmount(
              ctx.user.id,
              cost,
              "decisionIntelTopicCopyRegen",
              `战略地图选题文案重生成 · ${input.pick.title.slice(0, 48)} · ${marker}`,
            );
            chargedCredits = cost;
          } else {
            const balance = await getOrCreateBalance(ctx.user.id);
            await database.insert(creditTransactions).values({
              userId: ctx.user.id,
              amount: 0,
              type: "debit",
              source: "usage",
              action: "decisionIntelTopicCopyRegen",
              description: `战略地图选题文案重生成（首次免费）· ${input.pick.title.slice(0, 48)} · ${marker}`,
              balanceAfter: balance.balance,
            });
          }
        }

        const platformSkillsPrompt = await (async () => {
          try {
            const { resolvePlatformSkillsPrompt } = await import("./services/platformSkillsService.js");
            return await resolvePlatformSkillsPrompt({
              userId: ctx.user.id,
              enabledSkillIds: Array.isArray(input.enabledSkillIds) ? input.enabledSkillIds : null,
              allowBloggerTitle: Boolean(input.allowBloggerTitle),
            });
          } catch {
            return "";
          }
        })();

        const blueprints = await generateDecisionIntelTopicBlueprints({
          picks: [input.pick],
          contentBlueprint,
          topic,
          platformHint,
          idPrefix: input.regenerate ? "decision-intel-regen" : "decision-intel-picked",
          abortSignal: ctx.clientDisconnected,
          blueOceanLexicon: input.blueOceanLexicon,
          platformSkillsPrompt,
        });

        if (blueprints.length > 0) {
          const { upsertPlatformBlueprintSnapshotEntries } = await import(
            "./services/platformStrategicBlueprintSnapshots.js"
          );
          await upsertPlatformBlueprintSnapshotEntries({
            userId: ctx.user.id,
            contentBlueprints: blueprints,
          });
        }

        return { executionBlueprints: blueprints, chargedCredits, regenerateOrdinal };
      }),

    /** 将会话内全部执行卡合并进 DB 快照，供封面 enqueue 解析 sceneId（刷新后战略地图卡亦需同步）。 */
    syncPlatformExecutionBlueprintsSnapshot: protectedProcedure
      .input(
        z.object({
          contentBlueprints: z.array(z.unknown()).min(1).max(48),
        }),
      )
      .mutation(async ({ ctx, input }) => {
        const { upsertPlatformBlueprintSnapshotEntries } = await import(
          "./services/platformStrategicBlueprintSnapshots.js"
        );
        await upsertPlatformBlueprintSnapshotEntries({
          userId: ctx.user.id,
          contentBlueprints: input.contentBlueprints,
        });
        return { ok: true as const, count: input.contentBlueprints.length };
      }),

    generateVisualReport: publicProcedure
      .input(z.object({
        // Extended to support short-form trend radar: 3d and 7d windows
        windowDays: z.enum(["3", "7", "15", "30"]),
        theme: z.enum(["light", "dark"]),
        platforms: z.array(z.enum(["douyin", "kuaishou", "xiaohongshu", "bilibili"])),
        /** 可選：創作者人設補充（職業、身份、興趣、專長等），用於收窄熱點解讀與選題公式落點 */
        personaContext: z.string().max(4000).optional(),
      }))
      .mutation(async ({ input }) => {
        const PLATFORM_NAMES: Record<string, string> = {
          douyin: "抖音", kuaishou: "快手", xiaohongshu: "小红书", toutiao: "今日头条",
        };
        const platformListStr = input.platforms.map((p) => PLATFORM_NAMES[p] || p).join("、");

        // Build date anchor — Asia/Shanghai（UTC+8）日曆對齊；與賽道樣本對照窗一致
        const anchorMs = Date.now();
        const wd = Number(input.windowDays);
        const shBounds = getShanghaiVisualReportWindows(wd, anchorMs);
        const todayStr = formatShanghaiDateZh(anchorMs);
        const pastStr = formatShanghaiDateZh(shBounds.currentStart);

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
          const windowCutoff = shBounds.currentStart;
          const windowItems = items.filter((item: any) => {
            const ts = item?.collectedAt || item?.publishedAt || item?.date || null;
            if (!ts) return true;
            const ms = new Date(String(ts)).getTime();
            return Number.isFinite(ms) && ms >= windowCutoff && ms < shBounds.currentEndExclusive;
          });
          const evidenceItems = windowItems.length > 0 ? windowItems : items.slice(0, 30);
          const hotTitles = evidenceItems.slice(0, 15).map((i: any) => i.title || i.keyword || "").filter(Boolean);
          const playCounts = evidenceItems
            .map((i: any) => Number(i.playCount || i.play_count || i.likes || i.views || 0))
            .filter((v) => v > 0)
            .sort((a, b) => b - a);
          return {
            platform,
            displayName: PLATFORM_NAMES[platform] || platform,
            itemCount: evidenceItems.length,
            topTitles: hotTitles,
            medianPlayCount: playCounts.length > 0 ? playCounts[Math.floor(playCounts.length / 2)] : 0,
            topPlayCount: playCounts[0] || 0,
          };
        });

        const industryGrowthHintMap = buildIndustryGrowthHintMap(store, input.platforms as string[], wd, anchorMs);
        const industryGrowthHintsObj = Object.fromEntries(
          Array.from(industryGrowthHintMap.entries()).sort(([a], [b]) => a.localeCompare(b, "zh-Hans-CN")),
        );

        // Fully dynamic prompt — windowDays drives all time references, no hardcoded day counts
        const totalDays = wd * 2;
        const currentDateStr = todayStr; // ISO-style date already computed above
        const systemPrompt = `你是一位顶级的新媒体数据分析师，专注于发现平台算法逻辑与赛道流量趋势。今天是 ${currentDateStr}（时间一律按 Asia/Shanghai 北京时间 UTC+8）。

【人设口径】此处「人设」指创作者可辨识的真实画像：**职业、身份、兴趣、爱好、专长** 等；不是泛化「博主」「达人」。本报告中的 insightSummary、topicExamples、hotTopics、trafficSupport、audiencesAndBiz 等，应写得让**某一类具体身份的人**能对号入座——说明「谁更适合借这条趋势发力、怎样用自身维度解释该热点」，避免与任何人都无关的纯大盘词云或空泛平台运营套话。若 user JSON 中含 personaContext，你必须以其为主轴收紧解读与选题示例，热点只可参考、**须改写为可落在该人设上的表达**，禁止硬套无关梗。

【关键时间约束 — 绝对禁止预测未来！】
本报告分析的时间段是：${pastStr} 至 ${todayStr}（过去 ${wd} 个连续上海日，含今天；与前一同长度上海日窗口对照）。
你将对比「近 ${wd} 天」与「前 ${wd} 天」（共 ${totalDays} 天数据，均为上海日历连续日）来识别赛道加速或减速信号。
绝对禁止使用"将会"、"预计"等预测性语言。所有描述必须是已发生的历史事实。

【真实数据矩阵】
以下是从数据库提取的各平台真实近 ${wd} 天数据快照，你必须从中提取洞察，不可凭空捏造：
${JSON.stringify(platformEvidence, null, 2)}

【赛道口径 — 须与历史分类对齐】
下方「行业样本推断」JSON 的每个 **key** 来自趋势样本入库时的 **正式分类**（industryLabels / contentLabels；缺省时为与增长评分一致的规则化大类兜底），**不是**从标题或评论里切出来的热词碎片。trackGrowth[].name **必须**优先 **逐字**使用该 JSON 的某一 key；若要「主赛道 · 子切口」式合并，**建议**两段均取自该 JSON 的不同 key。**不建议**使用与表中 key 无语义包含/对应关系的碎词、纯地名或账号梗充当整条赛道名。

【行业样本推断（近 ${wd} 天 vs 前 ${wd} 天，Asia/Shanghai 连续日对照）：**有前窗对照**用样本量推算增速，表中 **至 +100% 写「+N%」**；**若推算超过 +100% 则该 key 对应文案必须为「高热」**，禁止写百分比或「增长X倍」。**无前窗对照**用排序刻度 +12%～+98%（见下表数值）。热门赛道列表不得含负向样本桶。trackGrowth.growth 必须与下表一致；禁止 N/A 与长句】
${JSON.stringify(industryGrowthHintsObj, null, 2)}

【核心要求】针对每个选定的平台给出（在 platformDetails 内）：
1. trafficBoosters：官方流量扶持活动，每个平台至少 2-3 条。必须结合当前日期 ${currentDateStr} 与 snapshot.supportActivities / 推流活动匹配结果，优先仍在进行中的活动（如抖音 AI 创作大赛、小红书 RED 新生代/中长视频激励、B 站任务中心当月征稿、快手光合计划），禁止写已过期活动。${wd <= 7 ? " 【极速窗口：" + wd + " 天】重点关注短期爆发信号（当日热点、突发推流、节假日驱动）。" : wd <= 15 ? " 【短窗：" + wd + " 天】优先近两周仍可报名的征稿/激励。" : ""} 格式要求：每条注明平台活动名称 + 参与门槛或奖励。
2. cashRewards：现金奖励任务，每个平台至少 2 条，必须包含激励金额或门槛。
3. hotTopics：**【强制数量：5-8个】** 每条须为**可读的一句式细分赛道**，**优先**能在上文「行业样本推断」JSON 的 **key** 中找到词汇锚点，或与全局 **trackGrowth[].name** 使用同一套正式分类口径；附带简短内容说明。**不建议**纯热搜词云、与表中 key 无语义对应关系的碎片标签或碎词充当整条赛道名。**禁止**与本报告全局 trackGrowth 中 growth 已为负值（如 -60%）的赛道语义重复；热榜应体现仍能加码的方向。
4. blueOceanWords：**蓝海词（分级）**，每个平台 2-4 组，每组格式为 { "primary": "一级蓝海词（父词，搜索量 >10万/月）", "secondary": ["二级词1", "二级词2", "二级词3"]}。定义：搜索量大（>10万/月）+ 同行内容少（同类笔记 <200篇）+ 用户意图精准（离成交近）。二级词来源：用一级词在该平台搜索后，整理下拉联想词 + 评论区高赞高频词中高流量（点赞>1万/收藏>5000/评论热烈）的子词条。二级词数量：有数据则列出 3-5 个，无法确认满足标准的词条不强行凑数。小红书优先从搜索下拉联想词和爆款笔记评论区高频需求词中提取；抖音优先从热门话题下评论区高频词中提取。

报告全局层级（不在 platformDetails 内）必须输出以下维度（不得省略）：
- reportTitle：精准标题，包含时间段（${pastStr} – ${todayStr}）
- insightSummary：输出 4 个核心洞察，必须严格遵循 [{"title":"短标题","description":"详细分析"}] 的 JSON 对象数组格式。
  - title：必须是明确的结论型标题，可以完整表达重点，不要故意压缩到不自然。
  - description：必须是具体的详细分析与案例，必须引用真实数据、真实平台现象或真实热点活动，至少 30-50 个字。
  - 【强制约束】：description 的内容绝对不能与 title 重复，不能只是改写 title，必须是一段有起承转合、包含现象或数据支撑的完整论述；如果输出重复内容，视为严重错误。
- trackGrowth：**【强制数量：5-8条】** 仅含**非负向**热门赛道（服务端会剔除负增长/无匹配）；**growth** 与下表完全一致：**+100% 及以下写「+N%」**；**超过 +100% 的格子表里会是「高热」，你必须写「高热」**，禁止自造百分比或倍数。**name** 与上表 JSON 的 key 对齐（见「赛道口径」）。勿编造。**严禁** N/A、括号长句。
- audiencesAndBiz：目标人群与商业方向（2-3条）。格式：{"audience": "人群描述", "bizDirection": "商业方向"}
- topicExamples：针对排名前三赛道设计选题公式与案例（3-5条）。格式：{"structure": "标题公式", "concept": "内容说明", "realCase": "接地气的真实感文章标题"}
- trafficSupport：扫描当前平台正在进行的官方流量扶持活动（全局跨平台维度，2-3条）。必须列出具体活动名称，格式：["活动名称：详细说明"]
- hotFestivals：根據今天 ${currentDateStr} 及前后 ${wd} 天范围，指出当下正在爆发或即将到来的节日、节气或社会热点（2-3个）。格式：["节日/热点：简要说明与内容切入角度"]
- globalBlueOceanWords：**【必须输出，不可省略】** 聚合所有选定平台的蓝海词，提取 4-6 组，一/二级分级。格式：[{"primary":"一级蓝海词（父词）","secondary":["二级词1","二级词2","二级词3"]}]。定义：搜索量大（>10万次/月）+ 同类笔记少（<200篇）+ 用户意图精准（离成交近）。二级词来源：用一级词在各平台搜索后，整理下拉联想词 + 评论区高赞高频词（点赞>1万/收藏>5000）。无法确认满足标准的词不强行凑数。小红书优先从搜索下拉联想词和爆款笔记评论区高频需求词中提取；抖音优先从热门话题下评论区高频词中提取；B站从专栏/视频弹幕高频词提取；快手从同城热点话题提取。

【绝对警告 — JSON 输出规范】请直接且仅输出合法的 JSON 对象，不要包含任何 Markdown 标记。第一个字符必须是 {，最后一个字符必须是 }。`;

        /** Consumer Gemini 預設 `gemini-3-flash-preview`（可 `VISUAL_REPORT_GEMINI_MODEL` 覆寫）；改 OpenAI 時設 `VISUAL_REPORT_ENGINE=openai` */
        const visualReportGeminiModel =
          String(process.env.VISUAL_REPORT_GEMINI_MODEL ?? "").trim() || "gemini-3-flash-preview";
        const visualReportEngineRaw = String(process.env.VISUAL_REPORT_ENGINE ?? "gemini").trim().toLowerCase();
        const visualReportUsesGeminiConsumer =
          visualReportEngineRaw === "gemini" ||
          visualReportEngineRaw === "gemini25" ||
          visualReportEngineRaw === "gemini_25" ||
          visualReportEngineRaw === "gemini_2_5" ||
          visualReportEngineRaw === "gemini_2_5_pro" ||
          visualReportEngineRaw === "gemini-2.5-pro" ||
          visualReportEngineRaw === "gemini3flash" ||
          visualReportEngineRaw === "gemini_3_flash" ||
          visualReportEngineRaw === "gemini-3-flash-preview";
        const llmStartedAtMs = Date.now();
        try {
          const userPayload = JSON.stringify({
            windowDays: input.windowDays,
            platforms: input.platforms,
            today: todayStr,
            pastDate: pastStr,
            platformEvidence,
            industrySampleGrowth: industryGrowthHintsObj,
            ...(String(input.personaContext || "").trim()
              ? { personaContext: String(input.personaContext).trim().slice(0, 4000) }
              : {}),
          });

          const response = visualReportUsesGeminiConsumer
            ? await invokeLLM({
                model: "pro",
                provider: "gemini",
                modelName: visualReportGeminiModel,
                response_format: { type: "json_object" },
                max_tokens: Math.min(
                  32768,
                  Math.max(2048, Number(process.env.VISUAL_REPORT_MAX_COMPLETION_TOKENS) || 32768),
                ),
                temperature: 0.8,
                messages: [
                  { role: "system", content: systemPrompt },
                  { role: "user", content: userPayload },
                ],
              })
            : await invokeLLM({
                provider: "openai",
                model: "gpt54",
                modelName:
                  String(process.env.VISUAL_REPORT_OPENAI_MODEL ?? "").trim() ||
                  String(process.env.OPENAI_GPT54_MODEL ?? "").trim() ||
                  undefined,
                response_format: { type: "json_object" },
                max_tokens: Math.min(
                  32_768,
                  Math.max(4096, Number(process.env.VISUAL_REPORT_MAX_COMPLETION_TOKENS) || 16_384),
                ),
                messages: [
                  { role: "system", content: systemPrompt },
                  {
                    role: "user",
                    content: `${userPayload}\n\n【輸出】僅輸出一個合法 JSON 物件（禁止 markdown围栏與前言後語）；首尾字元為 { 與 }。`,
                  },
                ],
              });

          const choice0 = response.choices?.[0];
          const rawBody =
            typeof choice0?.message?.content === "string"
              ? choice0.message.content
              : extractFirstChoicePlainText(response) || "{}";
          const fenceMatch = rawBody.match(/```(?:json)?\s*([\s\S]+?)```/);
          const stripped = fenceMatch ? fenceMatch[1].trim() : rawBody.replace(/^```(?:json)?[\r\n]*/i, "").replace(/[\r\n]*```\s*$/i, "").trim();
          let parsed: any = {};
          try {
            parsed = JSON.parse(stripped);
          } catch {
            try {
              parsed = JSON.parse(rawBody);
            } catch {
              parsed = {};
            }
          }

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
          const normalizeBlueOceanWords = (raw: unknown): Array<{ primary: string; secondary: string[] }> => {
            if (!Array.isArray(raw)) return [];
            return raw
              .filter((b) => b && typeof b === "object" && (b as { primary?: unknown }).primary)
              .map((b) => {
                const item = b as { primary?: unknown; secondary?: unknown };
                return {
                  primary: safeStr(item.primary),
                  secondary: Array.isArray(item.secondary)
                    ? item.secondary.map((s) => safeStr(s)).filter(Boolean)
                    : [],
                };
              })
              .filter((b) => b.primary);
          };
          appendRuntimeMetric("visual.report", {
            ok: true,
            engineEnv: visualReportEngineRaw || "openai(default)",
            provider: visualReportUsesGeminiConsumer ? `gemini_consumer:${visualReportGeminiModel}` : "openai_json",
            durationMs: Date.now() - llmStartedAtMs,
            upstreamModel: String(response?.model ?? "").trim() || null,
            finishReason: choice0?.finish_reason ?? null,
            promptTokens: response.usage?.prompt_tokens ?? null,
            completionTokens: response.usage?.completion_tokens ?? null,
            windowDays: input.windowDays,
            platformCount: input.platforms.length,
          });
          const repairedTrackGrowth = repairTrackGrowthRows(
            Array.isArray(parsed.trackGrowth)
              ? parsed.trackGrowth.map((t: any) => ({
                  name: safeStr(t?.name || t),
                  growth: safeStr(t?.growth || ""),
                  isHot: Boolean(t?.isHot),
                }))
              : [],
            industryGrowthHintMap,
          );
          const displayTrackGrowth = filterTrackGrowthHotOnly(repairedTrackGrowth);
          const platformDetails = Array.isArray(parsed.platformDetails)
            ? parsed.platformDetails.map((p: any) => ({
                platform: safeStr(p?.platform || ""),
                trafficBoosters: Array.isArray(p?.trafficBoosters) ? p.trafficBoosters.map(safeStr) : [],
                cashRewards: Array.isArray(p?.cashRewards) ? p.cashRewards.map(safeStr) : [],
                hotTopics: reconcilePlatformHotTopicsWithGlobalTrackGrowth(
                  Array.isArray(p?.hotTopics) ? p.hotTopics.map(safeStr) : [],
                  repairedTrackGrowth,
                  industryGrowthHintMap,
                ),
                blueOceanWords: normalizeBlueOceanWords(p?.blueOceanWords),
              }))
            : [];
          let globalBlueOceanWords = normalizeBlueOceanWords(parsed.globalBlueOceanWords);
          if (globalBlueOceanWords.length === 0) {
            const aggregated = platformDetails.flatMap(
              (p: { blueOceanWords?: Array<{ primary: string; secondary: string[] }> }) =>
                p.blueOceanWords || [],
            );
            globalBlueOceanWords = aggregated.slice(0, 6);
          }
          return {
            success: true,
            report: {
              reportTitle: safeStr(parsed.reportTitle || `平台趋势看板 · ${pastStr}–${todayStr}`),
              // insightSummary: support both {title, description} objects and legacy string arrays
              insightSummary: Array.isArray(parsed.insightSummary)
                ? parsed.insightSummary.map(normalizeInsightItem)
                : [],
              trackGrowth: displayTrackGrowth,
              audiencesAndBiz: Array.isArray(parsed.audiencesAndBiz)
                ? parsed.audiencesAndBiz.map((a: any) => ({ audience: safeStr(a?.audience || a), bizDirection: safeStr(a?.bizDirection || "") }))
                : [],
              topicExamples: Array.isArray(parsed.topicExamples)
                ? parsed.topicExamples.map((e: any) => ({ structure: safeStr(e?.structure || e), concept: safeStr(e?.concept || ""), realCase: safeStr(e?.realCase || "") }))
                : [],
              // New global fields: trafficSupport, hotFestivals
              trafficSupport: Array.isArray(parsed.trafficSupport) ? parsed.trafficSupport.map(safeStr) : [],
              hotFestivals: Array.isArray(parsed.hotFestivals) ? parsed.hotFestivals.map(safeStr) : [],
              globalBlueOceanWords,
              platformDetails,
            },
          };
        } catch (error) {
          appendRuntimeMetric("visual.report", {
            ok: false,
            engineEnv: visualReportEngineRaw || "openai(default)",
            provider: visualReportUsesGeminiConsumer ? `gemini_consumer:${visualReportGeminiModel}` : "openai_json",
            durationMs: Date.now() - llmStartedAtMs,
            message: error instanceof Error ? error.message.slice(0, 800) : String(error).slice(0, 800),
            windowDays: input.windowDays,
            platformCount: input.platforms.length,
          });
          throw new Error(`generateVisualReport failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }),

    generateTopicImage: protectedProcedure
      .input(
        z.object({
          /** @deprecated 忽略；封面主句僅從已入庫快照經演算法優化後取得。 */
          topicHook: z.string().max(500).optional().default(""),
          format: z.enum(["短视频", "图文"]).optional(),
          /** @deprecated 忽略；语境僅從快照優化後取得。 */
          context: z.string().optional(),
          /** 封面／单帧出镜身份：IP 基因 + persona 摘要等，注入 GPT 5.4，避免仅由选题文案猜测人设 */
          coverPersonaContext: z.string().max(4000).optional(),
          /** user_creations.id：须为当前用户、type=platform_topic_frame、status∈{failed,timeout} 且未消费过免费补发 */
          failedJobId: z.string().max(32).optional(),
          /** 單幀封面必須綁定選題 ID，以便從 DB 快照載入並優化文案 */
          sceneId: z.string().min(1).max(128),
          /** @deprecated 封面單幀固定 GPT 5.4；此欄位忽略。 */
          imagePromptTranslator: zPlatformImagePromptTranslatorInput,
          /** 監管：豎封像素三選一；普通帳戶傳入無效 */
          topicCoverPixelEngine: zPlatformTopicCoverPixelEngine.optional(),
          /** @deprecated 等同 `topicCoverPixelEngine: "nano_banana_2"` */
          coverProEngine: z.enum(["nano_banana_2", "nano_banana_pro"]).optional(),
          /** 管理員／監管：選題封面步驟 0.5 Deep Research Pro；普通帳戶傳入無效 */
          enableTopicCoverDeepResearchPro: z.boolean().optional(),
          /** 可選第二條選題 sceneId（同用戶快照）；DR-Pro 雙條並行，皆失敗則單題 + GPT 5.4 */
          drProSecondarySceneId: z.string().min(1).max(128).optional(),
          /** 與服端 env `SUPERVISOR_SECRET` 一致時，承認 coverProEngine／Deep Research Pro（不免扣積分）。 */
          supervisorToken: z.string().max(512).optional(),
          /**
           * 封面平台母语偏好（决策智库 / 趋势选中平台）：优先取 platformVariants.coverHeadline。
           * 可为 douyin / xiaohongshu / bilibili / kuaishou / weixin_channels。
           */
          coverPlatformHint: z.string().max(40).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const supervisorOpsAllowed = resolvePlatformSupervisorOpsAllowed(ctx.user, input.supervisorToken);
        const topicCoverPixelEngine = supervisorOpsAllowed
          ? resolveSupervisorTopicCoverPixelEngineInput({
              topicCoverPixelEngine: input.topicCoverPixelEngine,
              coverProEngine: input.coverProEngine,
            })
          : undefined;
        const enableTopicCoverDeepResearchProAdmin =
          supervisorOpsAllowed && input.enableTopicCoverDeepResearchPro === true;
        const topicFramePaidCost = CREDIT_COSTS.platformTopicFrameGraphic;

        const database = await db.getDb();
        const { userCreations } = await import("../drizzle/schema-creations");

        const sid = String(input.sceneId ?? "").trim();
        const {
          assertOptimizedCoverInputsFromDb,
          PlatformCoverInputsError,
        } = await import("./services/platformStrategicBlueprintSnapshots.js");
        let resolvedCover;
        try {
          resolvedCover = await assertOptimizedCoverInputsFromDb({
            userId,
            sceneId: sid,
            preferredPlatform: input.coverPlatformHint,
          });
        } catch (e) {
          if (e instanceof PlatformCoverInputsError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
          }
          throw e;
        }
        const finalTopicHook = resolvedCover.topicHook;
        const finalFormatForPipeline = resolvedCover.format;
        const title = String(finalTopicHook || "").trim().slice(0, 80);

        let creationIdOut: number | undefined;
        let isFreeRetry = false;
        let consumedParentId: number | null = null;

        /**
         * Append-Only + 防并发：先 insert 新 pending 行占位，再尝试 UPDATE 旧失败行消耗凭证；
         * 若 UPDATE 返回 0 行（已消耗/并发）则删除新行并 BAD_REQUEST，避免先烧凭证却无新任务。
         * 付费路径：仅在新行存在后再检查余额并扣款，失败则删新行；扣款成功后写回 creditsUsed。
         */
        if (database) {
          try {
            const [newRow] = await database
              .insert(userCreations)
              .values({
                userId,
                type: PLATFORM_TOPIC_FRAME_TYPE,
                title: title.slice(0, 255),
                status: "pending",
                creditsUsed: 0,
                metadata: JSON.stringify({
                  sceneId: sid.length > 0 ? sid : null,
                  source: "generateTopicImage",
                }),
              })
              .returning({ id: userCreations.id });
            creationIdOut = newRow?.id;
          } catch (e) {
            console.warn("[mvAnalysis.generateTopicImage] insert pending platform_topic_frame failed:", e);
          }

          if (creationIdOut == null) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "创建单帧任务失败，请稍后重试",
            });
          }

          if (input.failedJobId && creationIdOut) {
            const failedIdNum = Number(input.failedJobId);
            const updated = await database
              .update(userCreations)
              .set({
                metadata: sql<string>`(jsonb_set(coalesce((${userCreations.metadata})::jsonb, '{}'::jsonb), '{platformFreeRetryConsumed}', 'true'::jsonb, true))::text`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(userCreations.id, failedIdNum),
                  eq(userCreations.userId, userId),
                  eq(userCreations.type, PLATFORM_TOPIC_FRAME_TYPE),
                  sql`coalesce((${userCreations.metadata})::jsonb->>'platformFreeRetryConsumed', '') <> 'true'`,
                  or(eq(userCreations.status, "failed"), eq(userCreations.status, "timeout")),
                ),
              )
              .returning({ id: userCreations.id });

            if (updated.length > 0) {
              isFreeRetry = true;
              consumedParentId = failedIdNum;
            } else {
              await database.delete(userCreations).where(eq(userCreations.id, creationIdOut));
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "凭证无效或已被使用",
              });
            }
          }

          if (!isAdminUser && !isFreeRetry) {
            const creditsInfo = await getCredits(userId);
            if (creditsInfo.totalAvailable < topicFramePaidCost) {
              await database.delete(userCreations).where(eq(userCreations.id, creationIdOut));
              creationIdOut = undefined;
              throw new TRPCError({
                code: "PAYMENT_REQUIRED",
                message: `Credits 不足，单帧需要 ${topicFramePaidCost} 点（当前可用：${creditsInfo.totalAvailable}）`,
              });
            }
            await deductCreditsAmount(
              userId,
              topicFramePaidCost,
              "platformTopicImages",
              `平台单帧参考重绘（${topicFramePaidCost}点）`,
            );
            await database
              .update(userCreations)
              .set({ creditsUsed: topicFramePaidCost, updatedAt: new Date() })
              .where(eq(userCreations.id, creationIdOut));
          }
        } else if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < topicFramePaidCost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，单帧需要 ${topicFramePaidCost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCreditsAmount(
            userId,
            topicFramePaidCost,
            "platformTopicImages",
            `平台单帧参考重绘（${topicFramePaidCost}点）`,
          );
        }

        const newJobMetaBase: Record<string, unknown> = {
          sceneId: sid.length > 0 ? sid : null,
          source: "generateTopicImage",
          isFreeRetry,
          parentFailedJobId: consumedParentId,
        };

        if (database && creationIdOut != null) {
          try {
            await database
              .update(userCreations)
              .set({
                metadata: JSON.stringify(newJobMetaBase),
                updatedAt: new Date(),
              })
              .where(eq(userCreations.id, creationIdOut));
          } catch (e) {
            console.warn("[mvAnalysis.generateTopicImage] enrich pending metadata failed:", e);
          }
        }

        const { runPlatformTopicImagePipeline } = await import("./services/runPlatformTopicImagePipeline.js");
        const { buildPlatformCoverHistoryHintFromDb, mergeCoverContextWithDbHint } = await import(
          "./services/platformCoverHistoryHint.js",
        );
        const coverHistoryHint = await buildPlatformCoverHistoryHintFromDb({ userId });
        const enrichedContext = mergeCoverContextWithDbHint(resolvedCover.context, coverHistoryHint);
        const preferFlyLiveTrend = process.env.PLATFORM_TREND_PREFER_FLY_LIVE === "true";
        const { loadMergedTrendEngagementVisualBriefForUserSnapshot } = await import(
          "./services/trendEngagementVisualBrief.js",
        );
        const trendEngagementVisualBrief = await loadMergedTrendEngagementVisualBriefForUserSnapshot({
          platformsKeyCsv: resolvedCover.snapshotPlatformsKey ?? "",
          preferFlyLive: preferFlyLiveTrend,
        });
        void input.imagePromptTranslator;
        let drProSecondaryCoverInputs: { topicHook: string; context: string } | undefined;
        const sid2 = String(input.drProSecondarySceneId ?? "").trim();
        if (sid2 && sid2 !== sid) {
          const { resolveOptionalDrProSecondaryCoverFromScene } = await import("./services/coverDeepResearchProBrief.js");
          drProSecondaryCoverInputs = await resolveOptionalDrProSecondaryCoverFromScene({
            userId,
            secondarySceneId: sid2,
          });
        }
        return runPlatformTopicImagePipeline({
          topicHook: finalTopicHook,
          format: finalFormatForPipeline,
          context: enrichedContext,
          coverPersonaContext: input.coverPersonaContext,
          sceneId: input.sceneId,
          appealHook: resolvedCover.appealHook,
          creationIdOut,
          isFreeRetry,
          newJobMetaBase,
          coverPixelEngine: topicCoverPixelEngine,
          enableTopicCoverDeepResearchPro: enableTopicCoverDeepResearchProAdmin,
          drProSecondaryCoverInputs,
          trendEngagementVisualBrief: trendEngagementVisualBrief || undefined,
          coverSubline: resolvedCover.coverSubline,
          coverNativePlatform: resolvedCover.coverNativePlatform,
          coverHeadlineFromVariant: resolvedCover.coverHeadlineFromVariant,
        });
      }),

    /**
     * 平台单帧生图：先入队，由 Fly jobs worker 执行生图；前端轮询 GET /api/jobs/:id，避免长 HTTP 占用。
     */
    /**
     * 上传一张人像照片 → 返回公网直链 URL，供 {@link enqueueGenerateTopicImage} 的 `referencePhotoUrl`
     * 走 EvoLink GPT-Image-2 edit 模式替换封面主角。URL 须 EvoLink 服务器可直接抓取（S3/Blob 公链）。
     */
    uploadCoverReferencePhoto: protectedProcedure
      .input(
        z.object({
          imageBase64: z.string().min(1),
          mimeType: z
            .enum(["image/jpeg", "image/jpg", "image/png", "image/webp"])
            .default("image/jpeg"),
        }),
      )
      .mutation(async ({ input }) => {
        const rawBuffer = Buffer.from(input.imageBase64, "base64");
        // GPT-Image-2 单图 ≤ 50MB；这里收敛到 12MB，避免超大上传与超时。
        if (rawBuffer.length < 64) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "图片为空或损坏" });
        }
        if (rawBuffer.length > 12 * 1024 * 1024) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "图片过大（请 ≤ 12MB）" });
        }
        // 第1级「无损正规化」：sharp 自动按 EXIF 旋正 → 抹掉所有元数据 → 长边收敛 1280 → 重编码 JPEG q90。
        // 很多内容审核「误判」其实来自相机元数据 / 异常编码 / 过大尺寸，重编码后常可直接通过，且对人像质感几乎无损。
        // 重编码失败（极少数损坏文件）则退回原图，不阻断上传。
        let buffer: Buffer = rawBuffer;
        let mimeType: "image/jpeg" | "image/png" = "image/jpeg";
        try {
          const { default: sharp } = await import("sharp");
          buffer = await sharp(rawBuffer, { failOn: "none" })
            .rotate()
            .resize({ width: 1280, height: 1280, fit: "inside", withoutEnlargement: true })
            .jpeg({ quality: 90, chromaSubsampling: "4:4:4" })
            .toBuffer();
        } catch {
          buffer = rawBuffer;
          mimeType = input.mimeType === "image/png" ? "image/png" : "image/jpeg";
        }
        // 与封面成品同一套存储：优先 GCS（签名 7 天直链，EvoLink 服务器可抓取），未配置则落 Fly 卷。
        const { uploadBufferToPlatformStorage } = await import("./services/evolinkGptImage2.js");
        try {
          const url = await uploadBufferToPlatformStorage(buffer, "platform_cover_reference");
          return { url };
        } catch (e) {
          // 兜底：GCS/Fly 不可用时退回 S3/Blob（storagePut）。
          const ext = mimeType === "image/png" ? "png" : "jpg";
          const key = `platform-cover-reference/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
          const { url } = await storagePut(key, buffer, mimeType);
          if (!url) throw e;
          return { url };
        }
      }),

    /** /platform：列出内置 + 当前用户上传的 Skill */
    listPlatformSkills: protectedProcedure.query(async ({ ctx }) => {
      const { listAllPlatformSkillsForUser } = await import("./services/platformSkillsService.js");
      const skills = await listAllPlatformSkillsForUser(ctx.user.id);
      return {
        skills: skills.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          version: s.version,
          defaultEnabled: s.defaultEnabled,
          source: s.source,
          updatedAt: s.updatedAt,
          bodyChars: String(s.body || "").length,
        })),
      };
    }),

    /**
     * Skill 区上方·GPT‑5.5 免费问答（每日 30 次）。
     * 若检测到生图意图，返回 imageOffer（须用户再点确认才扣费生图）。
     */
    askPlatformSkillQa: protectedProcedure
      .input(
        z.object({
          question: z.string().min(2).max(2000),
          enabledSkillIds: z.array(z.string().min(1).max(80)).max(24).optional(),
          allowBloggerTitle: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const { askPlatformSkillQa } = await import("./services/platformSkillQa.js");
        try {
          const result = await askPlatformSkillQa({
            userId: ctx.user.id,
            question: input.question,
            enabledSkillIds: Array.isArray(input.enabledSkillIds) ? input.enabledSkillIds : null,
            allowBloggerTitle: Boolean(input.allowBloggerTitle),
            isAdmin: isAdminUser,
          });
          return { success: true as const, ...result };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : "问答失败";
          throw new TRPCError({
            code: /上限/.test(msg) ? "TOO_MANY_REQUESTS" : "BAD_REQUEST",
            message: msg,
          });
        }
      }),

    /**
     * Skill 问答·确认单页生图：生涯首张封面九折，其后封面原价；可挂载当前勾选 Skill。
     */
    confirmPlatformSkillQaImage: protectedProcedure
      .input(
        z.object({
          imagePrompt: z.string().min(4).max(2000),
          enabledSkillIds: z.array(z.string().min(1).max(80)).max(24).optional(),
          aspectRatio: z.enum(["9:16", "16:9", "3:4", "4:3"]).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const { confirmPlatformSkillQaImage, PLATFORM_SKILL_QA_IMAGE_ACTION } = await import(
          "./services/platformSkillQa.js"
        );
        const prepared = await confirmPlatformSkillQaImage({
          userId,
          imagePrompt: input.imagePrompt,
          enabledSkillIds: Array.isArray(input.enabledSkillIds) ? input.enabledSkillIds : null,
          aspectRatio: input.aspectRatio,
        });
        const cost = prepared.needCharge;
        let charged = false;
        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < cost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，需要 ${cost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCreditsAmount(
            userId,
            cost,
            PLATFORM_SKILL_QA_IMAGE_ACTION,
            `Skill 问答生图${prepared.isFirstImageDiscount ? "·首张九折" : ""} · ${input.imagePrompt.slice(0, 48)}`,
          );
          charged = true;
        } else {
          // 管理员也记一笔 0 元 usage，保证「首张九折」计数一致
          const drizzleDb = await import("./db").then((m) => m.getDb());
          if (drizzleDb) {
            const { stripeUsageLogs } = await import("../drizzle/schema-stripe");
            await drizzleDb.insert(stripeUsageLogs).values({
              userId,
              action: PLATFORM_SKILL_QA_IMAGE_ACTION,
              creditsCost: 0,
              isFreeQuota: 1,
              description: `Skill 问答生图（管理员）· ${input.imagePrompt.slice(0, 80)}`,
            });
          }
        }

        try {
          const result = await prepared.runGenerate();
          return {
            success: true as const,
            imageUrl: result.imageUrl,
            creditsCharged: isAdminUser ? 0 : result.creditsCharged,
            isFirstImageDiscount: result.isFirstImageDiscount,
            englishPrompt: result.englishPrompt,
            imageGenFlowLog: result.imageGenFlowLog,
          };
        } catch (error) {
          if (charged) {
            const { refundCredits } = await import("./credits.js");
            await refundCredits(userId, cost, "Skill 问答生图失败退还").catch((refundErr: unknown) => {
              console.error("[confirmPlatformSkillQaImage] refund failed:", refundErr);
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: error instanceof Error ? error.message : "生图失败",
          });
        }
      }),

    /** /platform：上传 .md Skill（账号持久化） */
    uploadPlatformSkill: protectedProcedure
      .input(
        z.object({
          markdown: z.string().min(20).max(80_000),
          filenameHint: z.string().max(120).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const { saveUserPlatformSkill } = await import("./services/platformSkillsService.js");
        const skill = await saveUserPlatformSkill({
          userId: ctx.user.id,
          markdown: input.markdown,
          filenameHint: input.filenameHint,
        });
        return {
          skill: {
            id: skill.id,
            name: skill.name,
            description: skill.description,
            version: skill.version,
            defaultEnabled: skill.defaultEnabled,
            source: skill.source,
            updatedAt: skill.updatedAt,
            bodyChars: String(skill.body || "").length,
          },
        };
      }),

    /** /platform：删除用户上传的 Skill（不可删内置） */
    deletePlatformSkill: protectedProcedure
      .input(z.object({ skillId: z.string().min(1).max(80) }))
      .mutation(async ({ input, ctx }) => {
        const { deleteUserPlatformSkill } = await import("./services/platformSkillsService.js");
        const ok = await deleteUserPlatformSkill(ctx.user.id, input.skillId);
        if (!ok) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "只能删除自己上传的 Skill（user-*）" });
        }
        return { ok: true as const };
      }),

    enqueueGenerateTopicImage: protectedProcedure
      .input(
        z.object({
          /** @deprecated 忽略。 */
          topicHook: z.string().max(500).optional().default(""),
          format: z.enum(["短视频", "图文"]).optional(),
          /** @deprecated 忽略。 */
          context: z.string().optional(),
          coverPersonaContext: z.string().max(4000).optional(),
          failedJobId: z.string().max(32).optional(),
          sceneId: z.string().min(1).max(128),
          /** @deprecated 封面固定 GPT 5.4；入隊後寫入 job 時強制 gpt54。 */
          imagePromptTranslator: zPlatformImagePromptTranslatorInput,
          topicCoverPixelEngine: zPlatformTopicCoverPixelEngine.optional(),
          /** @deprecated 等同 `topicCoverPixelEngine: "nano_banana_2"` */
          coverProEngine: z.enum(["nano_banana_2", "nano_banana_pro"]).optional(),
          /** 管理員／監管：選題封面步驟 0.5 Deep Research Pro；普通帳戶傳入無效 */
          enableTopicCoverDeepResearchPro: z.boolean().optional(),
          /** 可選：第二條選題 sceneId（同用戶快照）· DR-Pro 雙條並行 */
          drProSecondarySceneId: z.string().min(1).max(128).optional(),
          /** 與服端 env `SUPERVISOR_SECRET` 一致時，承認監管參數（不免扣積分）。 */
          supervisorToken: z.string().max(512).optional(),
          /** 可選：用户上传人像照片 URL（公网直链）→ EvoLink GPT-Image-2 edit 换封面主角 */
          referencePhotoUrl: z.string().url().max(2048).optional(),
          /** 封面平台母语偏好：优先 platformVariants.coverHeadline */
          coverPlatformHint: z.string().max(40).optional(),
          /** 一键封面套装：40×N 按序分拆扣费 */
          bulkCoverPack: z
            .object({
              packSceneIds: z.array(z.string().min(1).max(128)).min(1).max(24),
              sequentialSlot: z.number().int().min(0),
            })
            .optional(),
        })
        .superRefine((data, ctx) => {
          const pack = data.bulkCoverPack;
          if (!pack) return;
          const { packSceneIds, sequentialSlot } = pack;
          if (sequentialSlot >= packSceneIds.length) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "bulkCoverPack.sequentialSlot 超出 packSceneIds 长度",
              path: ["bulkCoverPack", "sequentialSlot"],
            });
          }
          if (new Set(packSceneIds).size !== packSceneIds.length) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "bulkCoverPack.packSceneIds 须互不相同",
              path: ["bulkCoverPack", "packSceneIds"],
            });
          }
          if (packSceneIds[sequentialSlot] !== data.sceneId) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              message: "sceneId 须与 bulkCoverPack.packSceneIds[sequentialSlot] 一致",
              path: ["sceneId"],
            });
          }
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const supervisorOpsAllowed = resolvePlatformSupervisorOpsAllowed(ctx.user, input.supervisorToken);
        const topicCoverPixelEngine = supervisorOpsAllowed
          ? resolveSupervisorTopicCoverPixelEngineInput({
              topicCoverPixelEngine: input.topicCoverPixelEngine,
              coverProEngine: input.coverProEngine,
            })
          : undefined;
        const enableTopicCoverDeepResearchProAdmin =
          supervisorOpsAllowed && input.enableTopicCoverDeepResearchPro === true;
        const coverPack = input.bulkCoverPack;
        const topicFramePaidCost = coverPack
          ? platformBundleCreditsForSlot(
              platformCoverBundleTotalCredits(coverPack.packSceneIds.length),
              coverPack.sequentialSlot,
              coverPack.packSceneIds.length,
            )
          : CREDIT_COSTS.platformTopicFrameGraphic;

        const database = await db.getDb();
        const { userCreations } = await import("../drizzle/schema-creations");

        const sid = String(input.sceneId ?? "").trim();
        const {
          assertOptimizedCoverInputsFromDb,
          PlatformCoverInputsError,
        } = await import("./services/platformStrategicBlueprintSnapshots.js");
        let resolvedCover;
        try {
          resolvedCover = await assertOptimizedCoverInputsFromDb({
            userId,
            sceneId: sid,
            preferredPlatform: input.coverPlatformHint,
          });
        } catch (e) {
          if (e instanceof PlatformCoverInputsError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
          }
          throw e;
        }
        const finalTopicHook = resolvedCover.topicHook;
        const finalFormatForPipeline = resolvedCover.format;
        const title = String(finalTopicHook || "").trim().slice(0, 80);

        let creationIdOut: number | undefined;
        let isFreeRetry = false;
        let consumedParentId: number | null = null;

        if (database) {
          try {
            const [newRow] = await database
              .insert(userCreations)
              .values({
                userId,
                type: PLATFORM_TOPIC_FRAME_TYPE,
                title: title.slice(0, 255),
                status: "pending",
                creditsUsed: 0,
                metadata: JSON.stringify({
                  sceneId: sid.length > 0 ? sid : null,
                  source: "generateTopicImage",
                }),
              })
              .returning({ id: userCreations.id });
            creationIdOut = newRow?.id;
          } catch (e) {
            console.warn("[mvAnalysis.enqueueGenerateTopicImage] insert pending platform_topic_frame failed:", e);
          }

          if (creationIdOut == null) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "创建单帧任务失败，请稍后重试",
            });
          }

          if (input.failedJobId && creationIdOut) {
            const failedIdNum = Number(input.failedJobId);
            const updated = await database
              .update(userCreations)
              .set({
                metadata: sql<string>`(jsonb_set(coalesce((${userCreations.metadata})::jsonb, '{}'::jsonb), '{platformFreeRetryConsumed}', 'true'::jsonb, true))::text`,
                updatedAt: new Date(),
              })
              .where(
                and(
                  eq(userCreations.id, failedIdNum),
                  eq(userCreations.userId, userId),
                  eq(userCreations.type, PLATFORM_TOPIC_FRAME_TYPE),
                  sql`coalesce((${userCreations.metadata})::jsonb->>'platformFreeRetryConsumed', '') <> 'true'`,
                  or(eq(userCreations.status, "failed"), eq(userCreations.status, "timeout")),
                ),
              )
              .returning({ id: userCreations.id });

            if (updated.length > 0) {
              isFreeRetry = true;
              consumedParentId = failedIdNum;
            } else {
              await database.delete(userCreations).where(eq(userCreations.id, creationIdOut));
              throw new TRPCError({
                code: "BAD_REQUEST",
                message: "凭证无效或已被使用",
              });
            }
          }

          if (!isAdminUser && !isFreeRetry) {
            const creditsInfo = await getCredits(userId);
            if (creditsInfo.totalAvailable < topicFramePaidCost) {
              await database.delete(userCreations).where(eq(userCreations.id, creationIdOut));
              creationIdOut = undefined;
              throw new TRPCError({
                code: "PAYMENT_REQUIRED",
                message: `Credits 不足，单帧需要 ${topicFramePaidCost} 点（当前可用：${creditsInfo.totalAvailable}）`,
              });
            }
            await deductCreditsAmount(
              userId,
              topicFramePaidCost,
              "platformTopicImages",
              `平台单帧参考重绘（${topicFramePaidCost}点）`,
            );
            await database
              .update(userCreations)
              .set({ creditsUsed: topicFramePaidCost, updatedAt: new Date() })
              .where(eq(userCreations.id, creationIdOut));
          }
        } else if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < topicFramePaidCost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，单帧需要 ${topicFramePaidCost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCreditsAmount(
            userId,
            topicFramePaidCost,
            "platformTopicImages",
            `平台单帧参考重绘（${topicFramePaidCost}点）`,
          );
        }

        const newJobMetaBase: Record<string, unknown> = {
          sceneId: sid.length > 0 ? sid : null,
          source: "generateTopicImage",
          isFreeRetry,
          parentFailedJobId: consumedParentId,
        };

        if (database && creationIdOut != null) {
          try {
            await database
              .update(userCreations)
              .set({
                metadata: JSON.stringify(newJobMetaBase),
                updatedAt: new Date(),
              })
              .where(eq(userCreations.id, creationIdOut));
          } catch (e) {
            console.warn("[mvAnalysis.enqueueGenerateTopicImage] enrich pending metadata failed:", e);
          }
        }

        const { buildPlatformCoverHistoryHintFromDb, mergeCoverContextWithDbHint } = await import(
          "./services/platformCoverHistoryHint.js",
        );
        const coverHistoryHint = await buildPlatformCoverHistoryHintFromDb({ userId });
        const enrichedContext = mergeCoverContextWithDbHint(resolvedCover.context, coverHistoryHint);

        const jobId = nanoid(16);
        const sid2Enqueue = String(input.drProSecondarySceneId ?? "").trim();
        if (sid2Enqueue && sid2Enqueue !== sid) {
          const { resolveOptionalDrProSecondaryCoverFromScene } = await import("./services/coverDeepResearchProBrief.js");
          const secRowEnqueue = await resolveOptionalDrProSecondaryCoverFromScene({
            userId,
            secondarySceneId: sid2Enqueue,
          });
          if (secRowEnqueue) {
            const { insertDrProSecondaryStaging } = await import("./services/drProSecondaryStaging.js");
            try {
              await insertDrProSecondaryStaging({
                jobId,
                userId,
                primarySceneId: sid,
                secondarySceneId: sid2Enqueue,
                secondaryTopicHook: secRowEnqueue.topicHook,
                secondaryContext: secRowEnqueue.context,
              });
            } catch (e) {
              console.warn("[mvAnalysis.enqueueGenerateTopicImage] DR secondary staging insert failed:", e);
              throw new TRPCError({
                code: "INTERNAL_SERVER_ERROR",
                message: "副选题暂存失败，请稍后重试",
              });
            }
          }
        }
        try {
          await createJobRecord({
            id: jobId,
            userId: String(userId),
            type: "platform",
            provider: "vertex",
            input: {
              action: "platform_topic_image",
              params: {
                creationId: creationIdOut ?? null,
                topicHook: finalTopicHook,
                format: finalFormatForPipeline,
                context: enrichedContext,
                coverPersonaContext: input.coverPersonaContext,
                sceneId: input.sceneId,
                appealHook: resolvedCover.appealHook,
                imagePromptTranslator: "gpt54",
                isFreeRetry,
                newJobMetaBase,
                topicCoverPixelEngine,
                enableTopicCoverDeepResearchPro: enableTopicCoverDeepResearchProAdmin,
                drProSecondarySceneId: input.drProSecondarySceneId,
                referencePhotoUrl: input.referencePhotoUrl,
                coverPlatformHint: input.coverPlatformHint,
                coverSubline: resolvedCover.coverSubline,
                coverNativePlatform: resolvedCover.coverNativePlatform,
                coverHeadlineFromVariant: resolvedCover.coverHeadlineFromVariant,
              },
            },
          });
        } catch (e) {
          const { deleteDrProSecondaryStagingByJobId } = await import("./services/drProSecondaryStaging.js");
          await deleteDrProSecondaryStagingByJobId(jobId);
          throw e;
        }

        return { jobId, creationId: creationIdOut ?? null, status: "queued" as const };
      }),

    /**
     * 同一選題：**豎版封面 + 2×4 分鏡或八格** 一次扣费（封面 48 + 分镜 60|72，九折）；
     * 異步 worker 內 **封面與 2×4 並行**（`Promise.allSettled`）：封面鏈 GPT 5.4 英文化；2×4 預設 Vertex Flash 英文化（可改 gpt54）。2×4 側強制跳過 DR-Pro，避免與封面鏈重複貴價 Interactions。
     */
    enqueueTopicCoverAndCompositeBundle: protectedProcedure
      .input(
        z.object({
          coverPersonaContext: z.string().max(4000).optional(),
          sceneId: z.string().min(1).max(128),
          topicCoverPixelEngine: zPlatformTopicCoverPixelEngine.optional(),
          /** @deprecated 等同 `topicCoverPixelEngine: "nano_banana_2"` */
          coverProEngine: z.enum(["nano_banana_2", "nano_banana_pro"]).optional(),
          enableTopicCoverDeepResearchPro: z.boolean().optional(),
          supervisorToken: z.string().max(512).optional(),
          compositeTitle: z.string().min(1).max(220),
          compositeScriptContext: z.string().min(1).max(12000),
          compositeKind: z.enum([
            "storyboard_sheet_portrait",
            "storyboard_sheet_landscape",
            "xiaohongshu_dual_note",
          ]),
          compositeExecutionDetails: z.string().max(4000).optional(),
          /** 上传素材拍摄手法摘要 → 2×4 / 3×4 分镜共用 */
          compositeShootingTechniqueBrief: z.string().max(4000).optional(),
          imagePromptTranslator: zPlatformImagePromptTranslatorInput,
          creationRecordId: z.number().int().positive().optional(),
          compositeImageEngine: z.enum(["gpt_image2", "nano_banana_2"]).optional(),
          gridVariant: z.enum(["2x4", "3x4"]).optional(),
          /** 用户上传人像 URL → 封面 EvoLink edit 融合主人公相貌 */
          referencePhotoUrl: z.string().url().max(2048).optional(),
          enabledSkillIds: z.array(z.string().min(1).max(80)).max(24).optional(),
          allowBloggerTitle: z.boolean().optional(),
          /** 封面平台母语偏好：优先 platformVariants.coverHeadline */
          coverPlatformHint: z.string().max(40).optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const supervisorOpsAllowed = resolvePlatformSupervisorOpsAllowed(ctx.user, input.supervisorToken);
        const topicCoverPixelEngine = supervisorOpsAllowed
          ? resolveSupervisorTopicCoverPixelEngineInput({
              topicCoverPixelEngine: input.topicCoverPixelEngine,
              coverProEngine: input.coverProEngine,
            })
          : undefined;
        const enableTopicCoverDeepResearchProAdmin =
          supervisorOpsAllowed && input.enableTopicCoverDeepResearchPro === true;

        // 3×4 仅 landscape / 小红书图文支持；其余按 2×4。
        const bundleIs3x4 =
          input.gridVariant === "3x4" &&
          (input.compositeKind === "storyboard_sheet_landscape" ||
            input.compositeKind === "xiaohongshu_dual_note");
        const bundleCost = platformCoverCompositeBundleCreditsForCompositeKindGrid(
          input.compositeKind,
          bundleIs3x4,
        );
        const database = await db.getDb();
        const { userCreations } = await import("../drizzle/schema-creations");

        const sid = String(input.sceneId ?? "").trim();
        const {
          assertOptimizedCoverInputsFromDb,
          PlatformCoverInputsError,
        } = await import("./services/platformStrategicBlueprintSnapshots.js");
        let resolvedCover;
        try {
          resolvedCover = await assertOptimizedCoverInputsFromDb({
            userId,
            sceneId: sid,
            preferredPlatform: input.coverPlatformHint,
          });
        } catch (e) {
          if (e instanceof PlatformCoverInputsError) {
            throw new TRPCError({ code: "PRECONDITION_FAILED", message: e.message });
          }
          throw e;
        }
        const finalTopicHook = resolvedCover.topicHook;
        const finalFormatForPipeline = resolvedCover.format;
        const title = String(finalTopicHook || "").trim().slice(0, 80);

        let creationIdOut: number | undefined;
        if (database) {
          try {
            const [newRow] = await database
              .insert(userCreations)
              .values({
                userId,
                type: PLATFORM_TOPIC_FRAME_TYPE,
                title: title.slice(0, 255),
                status: "pending",
                creditsUsed: 0,
                metadata: JSON.stringify({
                  sceneId: sid.length > 0 ? sid : null,
                  source: "enqueueTopicCoverAndCompositeBundle",
                  compositeKind: input.compositeKind,
                }),
              })
              .returning({ id: userCreations.id });
            creationIdOut = newRow?.id;
          } catch (e) {
            console.warn("[mvAnalysis.enqueueTopicCoverAndCompositeBundle] insert pending failed:", e);
          }
          if (creationIdOut == null) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "创建套裝任务失败，请稍后重试",
            });
          }

          if (!isAdminUser) {
            const creditsInfo = await getCredits(userId);
            if (creditsInfo.totalAvailable < bundleCost) {
              await database.delete(userCreations).where(eq(userCreations.id, creationIdOut));
              creationIdOut = undefined;
              throw new TRPCError({
                code: "PAYMENT_REQUIRED",
                message: `Credits 不足，封面+分镜套装（九折）需要 ${bundleCost} 点（当前可用：${creditsInfo.totalAvailable}）`,
              });
            }
            await deductCreditsAmount(
              userId,
              bundleCost,
              "platformTopicCoverAndCompositeBundle",
              `平台选题套装·封面+2×4（九折 ${bundleCost}点）`,
            );
            await database
              .update(userCreations)
              .set({ creditsUsed: bundleCost, updatedAt: new Date() })
              .where(eq(userCreations.id, creationIdOut));
          }
        } else if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < bundleCost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，封面+分镜套装（九折）需要 ${bundleCost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCreditsAmount(
            userId,
            bundleCost,
            "platformTopicCoverAndCompositeBundle",
            `平台选题套装·封面+2×4（九折 ${bundleCost}点）`,
          );
        }

        const newJobMetaBase: Record<string, unknown> = {
          sceneId: sid.length > 0 ? sid : null,
          source: "enqueueTopicCoverAndCompositeBundle",
          compositeKind: input.compositeKind,
        };

        if (database && creationIdOut != null) {
          try {
            await database
              .update(userCreations)
              .set({
                metadata: JSON.stringify(newJobMetaBase),
                updatedAt: new Date(),
              })
              .where(eq(userCreations.id, creationIdOut));
          } catch (e) {
            console.warn("[mvAnalysis.enqueueTopicCoverAndCompositeBundle] metadata enrich failed:", e);
          }
        }

        const { buildPlatformCoverHistoryHintFromDb, mergeCoverContextWithDbHint } = await import(
          "./services/platformCoverHistoryHint.js",
        );
        const coverHistoryHint = await buildPlatformCoverHistoryHintFromDb({ userId });
        const enrichedContext = mergeCoverContextWithDbHint(resolvedCover.context, coverHistoryHint);

        void input.imagePromptTranslator;
        const imagePromptTranslatorForComposite = "gpt54" as const;

        const enrichedBundleScriptContext = (() => {
          const base = String(input.compositeScriptContext || "").trim();
          const hints = composePlatformImageSkillHints(
            Array.isArray(input.enabledSkillIds) ? input.enabledSkillIds : null,
          );
          if (!hints.trim()) return base;
          return `${hints}\n\n${base}`.slice(0, 12000);
        })();

        const jobId = nanoid(16);
        await createJobRecord({
          id: jobId,
          userId: String(userId),
          type: "platform",
          provider: "vertex",
          input: {
            action: "platform_topic_cover_composite_bundle",
            params: {
              bundleCreditsCharged: isAdminUser ? 0 : bundleCost,
              creationId: creationIdOut ?? null,
              topicHook: finalTopicHook,
              format: finalFormatForPipeline,
              context: enrichedContext,
              coverPersonaContext: input.coverPersonaContext,
              sceneId: input.sceneId,
              appealHook: resolvedCover.appealHook,
              imagePromptTranslator: "gpt54",
              newJobMetaBase,
              topicCoverPixelEngine,
              enableTopicCoverDeepResearchPro: enableTopicCoverDeepResearchProAdmin,
              compositeTitle: input.compositeTitle,
              compositeScriptContext: enrichedBundleScriptContext,
              compositeKind: input.compositeKind,
              compositeExecutionDetails: input.compositeExecutionDetails,
              compositeShootingTechniqueBrief: input.compositeShootingTechniqueBrief,
              compositeImagePromptTranslator: imagePromptTranslatorForComposite,
              creationRecordId: input.creationRecordId,
              enableCompositeDeepResearchPro: enableTopicCoverDeepResearchProAdmin,
              compositeImageEngine: input.compositeImageEngine,
              compositeGridVariant: bundleIs3x4 ? "3x4" : "2x4",
              referencePhotoUrl: input.referencePhotoUrl,
              coverPlatformHint: input.coverPlatformHint,
              coverSubline: resolvedCover.coverSubline,
              coverNativePlatform: resolvedCover.coverNativePlatform,
              coverHeadlineFromVariant: resolvedCover.coverHeadlineFromVariant,
            },
          },
        });

        return { jobId, creationId: creationIdOut ?? null, status: "queued" as const };
      }),

    /** 平台页：一键批量单帧——短视频分镜 {@link CREDIT_COSTS.platformTopicFrameVideo} 点/张，图文封面 {@link CREDIT_COSTS.platformTopicFrameGraphic} 点/张；主路径英文化 → GPT-IMAGE-2，失败则版式兜底。 */
    generateAllPlatformTopicImages: protectedProcedure
      .input(
        z.object({
          jobId: z.string().max(128).optional(),
          platformType: z.enum(["video", "graphic"]),
          /** 与单张 generateTopicImage.coverPersonaContext 一致，批量时复用同一人设 */
          coverPersonaContext: z.string().max(4000).optional(),
          /** @deprecated 批量封面固定 GPT 5.4；此欄位忽略。 */
          imagePromptTranslator: zPlatformImagePromptTranslatorInput,
          /** 封面平台母语偏好：优先 platformVariants.coverHeadline */
          coverPlatformHint: z.string().max(40).optional(),
          scenes: z
            .array(
              z.object({
                id: z.string().min(1),
                /** @deprecated 忽略；主句與正文語境僅從已入庫快照經服端優化讀取。 */
                title: z.string().max(500).optional(),
                text: z.string().max(8000).optional(),
                copywriting: z.string().max(8000).optional(),
              }),
            )
            .min(1)
            .max(24),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const batchCoverPersona = String(input.coverPersonaContext || "").trim();
        void input.imagePromptTranslator;

        const isVideo = input.platformType === "video";
        const costPerImage = isVideo ? CREDIT_COSTS.platformTopicFrameVideo : CREDIT_COSTS.platformTopicFrameGraphic;
        const totalCost = input.scenes.length * costPerImage;

        const {
          assertOptimizedCoverInputsFromDb,
          PlatformCoverInputsError,
        } = await import("./services/platformStrategicBlueprintSnapshots.js");
        const optimizedByScene = new Map<string, Awaited<ReturnType<typeof assertOptimizedCoverInputsFromDb>>>();
        for (const s of input.scenes) {
          try {
            optimizedByScene.set(
              s.id,
              await assertOptimizedCoverInputsFromDb({
                userId,
                sceneId: s.id,
                preferredPlatform: input.coverPlatformHint,
              }),
            );
          } catch (e) {
            if (e instanceof PlatformCoverInputsError) {
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message: `${e.message}（sceneId=${s.id}）`,
              });
            }
            throw e;
          }
        }

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < totalCost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，一键生成需要 ${totalCost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCreditsAmount(
            userId,
            totalCost,
            "platformTopicImages",
            `批量生成分鏡/封面參考（${input.scenes.length} 张 · 共 ${totalCost} 点）`,
          );
        }

        if (input.jobId) {
          console.log(
            `[mvAnalysis.generateAllPlatformTopicImages] jobId=${input.jobId} scenes=${input.scenes.length} platformType=${input.platformType} userId=${userId}`,
          );
        }

        const {
          buildPlatformTopicCoverDirectChinesePrompt,
        } = await import("./services/geminiPlatformCompositeTranslation.js");
        const { focusCoverChineseContextForDirectSend } = await import(
          "./services/platformImageChineseStaging.js"
        );
        const {
          buildImagePromptStats,
          generatePlatformTopicCoverNanoBanana2FromEnglishPrompt,
          appendImageFlowLog,
        } = await import("./services/proxyImageService.js");
        const geminiVariant = isVideo ? ("video" as const) : ("graphic" as const);
        /** 逐張串行：降低同題多張對 Vertex 生圖的尖峰失敗率。 */
        const pool = 1;
        const batchHeader = `${new Date().toISOString()}  [批量单帧] 开始 · platformType=${input.platformType}（${isVideo ? "短视频·分镜参考" : "图文·封面参考"}）· 选题数=${input.scenes.length} · 串行（并发=1）· 单价=${costPerImage}点`;

        const drizzleDb = await db.getDb();
        const { userCreations } = await import("../drizzle/schema-creations");
        const sceneToCreationId = new Map<string, number>();
        if (drizzleDb) {
          for (const s of input.scenes) {
            try {
              const [row] = await drizzleDb
                .insert(userCreations)
                .values({
                  userId,
                  type: PLATFORM_TOPIC_FRAME_TYPE,
                  title: (optimizedByScene.get(s.id)?.topicHook ?? s.id).slice(0, 255),
                  status: "pending",
                  creditsUsed: 0,
                  metadata: JSON.stringify({
                    sceneId: s.id,
                    platformType: input.platformType,
                    batchJobId: input.jobId ?? null,
                  }),
                })
                .returning({ id: userCreations.id });
              if (row?.id != null) sceneToCreationId.set(s.id, row.id);
            } catch (e) {
              console.warn("[mvAnalysis.generateAllPlatformTopicImages] insert platform_topic_frame failed:", e);
            }
          }
        }

        const { buildPlatformCoverHistoryHintFromDb } = await import("./services/platformCoverHistoryHint.js");
        const batchCoverHistoryHint = await buildPlatformCoverHistoryHintFromDb({ userId });

        const results = await mapWithPool(input.scenes, pool, async (s, idx) => {
          const opt = optimizedByScene.get(s.id)!;
          const body = opt.context;
          const briefSource = [batchCoverPersona, batchCoverHistoryHint, body].filter(Boolean).join("\n\n");
          const flowLog: string[] = [];
          appendImageFlowLog(flowLog, `──────── 选题「${opt.topicHook.slice(0, 48)}」· id=${s.id} ────────`);
          appendImageFlowLog(
            flowLog,
            "[快照] 已从数据库载入本选题并执行主句/语境优化（与客户端展示文案解耦）",
          );
          appendImageFlowLog(
            flowLog,
            `[主路径] 中文直送封面指令 → 豎封像素引擎（預設 GPT‑Image‑2 / NB2）`,
          );
          appendImageFlowLog(
            flowLog,
            `说明: 豎封中文直送；出图依 PLATFORM_TOPIC_COVER_PIXEL_ENGINE / 监管覆写`,
          );
          let url: string | null = null;
          let fallbackUsed = false;
          let promptStats = {
            translatedPromptChars: 0,
            translatedPromptWords: 0,
          };
          try {
            const coverContextZh = focusCoverChineseContextForDirectSend(briefSource, 1800);
            const safePrompt = buildPlatformTopicCoverDirectChinesePrompt({
              topicHook: opt.topicHook,
              context: coverContextZh,
              variant: geminiVariant,
              coverPersonaContext: batchCoverPersona || undefined,
              coverSubline: opt.coverSubline,
              coverNativePlatform: opt.coverNativePlatform,
            }).trim();
            if (!safePrompt) {
              throw new Error("中文封面指令为空");
            }
            appendImageFlowLog(
              flowLog,
              `[步骤1·中文直送] 中文封面指令送像素链路 · 约 ${safePrompt.length} 字符（无模型聚焦；headline=${opt.coverHeadlineFromVariant ? "coverHeadline" : "title"}）`,
            );
            appendImageFlowLog(
              flowLog,
              `[步骤1b] 无智能提炼 · 主体直接进封面像素链路（NB2 / Imagen 由 PLATFORM_TOPIC_COVER_PIXEL_ENGINE 决定，chars=${safePrompt.length}）`,
            );
            promptStats = buildImagePromptStats(safePrompt);
            appendImageFlowLog(
              flowLog,
              `[统计] englishPrompt=${promptStats.translatedPromptChars} chars/${promptStats.translatedPromptWords} words`,
            );
            appendImageFlowLog(flowLog, "[步骤2] 竖封像素（NB2 与 Imagen Ultra 并存，见下组 flowLog · PLATFORM_TOPIC_COVER_PIXEL_ENGINE）…");
            url = await generatePlatformTopicCoverNanoBanana2FromEnglishPrompt({
              englishPrompt: safePrompt,
              flowLog,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            appendImageFlowLog(flowLog, `[步骤1/2] 主路径异常: ${msg}`);
            console.warn(
              `[mvAnalysis.generateAllPlatformTopicImages] 封面主路径失败 scene=${s.id}:`,
              e instanceof Error ? e.message : e,
            );
          }
          if (!url) {
            appendImageFlowLog(flowLog, "[步骤3] 主路径无图 · 已關閉二次兜底 · 本条失败");
          }
          appendImageFlowLog(flowLog, url ? "✓ 本条结束：已得到 imageUrl" : "✗ 本条结束：仍无 URL");
          const creationId = sceneToCreationId.get(s.id);
          if (drizzleDb && creationId != null) {
            try {
              const finalStatus = classifyPlatformTopicFrameStatus(url);
              await drizzleDb
                .update(userCreations)
                .set({
                  status: finalStatus,
                  outputUrl: url ?? null,
                  updatedAt: new Date(),
                  metadata: JSON.stringify({
                    sceneId: s.id,
                    platformType: input.platformType,
                    batchJobId: input.jobId ?? null,
                    imagePromptStats: promptStats,
                    fallbackUsed,
                  }),
                })
                .where(eq(userCreations.id, creationId));
            } catch (e) {
              console.warn(`[mvAnalysis.generateAllPlatformTopicImages] update creation ${creationId}:`, e);
            }
          }
          return { id: s.id, url, flowLog, creationId: creationId ?? undefined, promptStats, fallbackUsed };
        });
        const mergedFlowLog = [batchHeader, ...results.flatMap((r) => [`▶ ${r.id}`, ...(r.flowLog ?? [])])];
        return {
          success: true as const,
          results,
          totalCost: isAdminUser ? 0 : totalCost,
          imageGenFlowLog: mergedFlowLog,
          imageGenMeta: {
            platformType: input.platformType,
            concurrency: pool,
            sceneCount: input.scenes.length,
          },
        };
      }),

    /**
     * 平台页：单张原生 2×4 大图 — 双语编导产出英文 prompt → GPT-IMAGE-2 + Vertex 兜底。
     * 单条散买：分镜 {@link CREDIT_COSTS.platformStoryboardSheet} cr、小红书八格 {@link CREDIT_COSTS.platformXhsDualNote} cr。
     * 一键套装：传 `bulkCompositePack` 时按 54×选题数 整数分拆扣费。
     */
    generatePlatformCompositeSheet: protectedProcedure
      .input(
        z
          .object({
            jobId: z.string().max(128).optional(),
            sceneId: z.string().min(1),
            title: z.string().min(1).max(220),
            scriptContext: z.string().min(1).max(12000),
            kind: z.enum([
              "storyboard_sheet_portrait",
              "storyboard_sheet_landscape",
              "xiaohongshu_dual_note",
              "single_page_knowledge_card",
            ]),
            /** 仅 single_page_knowledge_card：上篇 / 下篇分页（标题自动加「（上篇）/（下篇）」，仅取对应半篇内容）。 */
            notePart: z.enum(["upper", "lower"]).optional(),
            /** 仅 storyboard_sheet_landscape / xiaohongshu_dual_note：2×4(默认) 或 3×4 十二格（后端分 2 段生成再 sharp 拼成一张长图，降低糊字）。 */
            gridVariant: z.enum(["2x4", "3x4"]).optional(),
            /** 可選：客戶端生成並輪詢 GET /api/jobs/:id，實時顯示 imageGenFlowLog */
            progressJobId: z.string().min(8).max(64).optional(),
            executionDetails: z.string().max(4000).optional(),
            /** 上传素材拍摄手法摘要（景别/布光/走位），并入 2×4 中文脚本 */
            shootingTechniqueBrief: z.string().max(4000).optional(),
            /** 與單幀一致：英文 prompt 翻譯引擎 */
            imagePromptTranslator: zPlatformImagePromptTranslatorInput,
            /** Cam8：綁定 `user_creations`（deep_research_report）時寫入 metadata.storyboardSheetExport */
            creationRecordId: z.number().int().positive().optional(),
            /** 與單幀封面同源：admin/supervisor + supervisorToken 時採納 */
            supervisorToken: z.string().max(512).optional(),
            /** 监管：2×4 / 八格在英文化前插入 Deep Research Pro（与普通账号仅 env 总闸并行） */
            enableTopicCoverDeepResearchPro: z.boolean().optional(),
            /** IP / 身份锚点，供 DR Pro 与翻译链 */
            coverPersonaContext: z.string().max(8000).optional(),
            /** 用户上传主人公参考人像 → 分镜各格融合同一人（古人/历史角色等除外） */
            referencePhotoUrl: z.string().url().max(2048).optional(),
            /** 参考图为已生成竖版封面（非原始抠像）→ 加强跨格同脸 */
            referencePhotoFromApprovedCover: z.boolean().optional(),
            /** 2×4 出图：GPT-Image-2 主链 vs Vertex Nano Banana 2 主路径（优先于部署变量 PLATFORM_COMPOSITE_SHEET_ENGINE） */
            compositeImageEngine: z.enum(["gpt_image2", "nano_banana_2"]).optional(),
            /** /platform 挂载 Skill（注入脚本语境） */
            enabledSkillIds: z.array(z.string().min(1).max(80)).max(24).optional(),
            allowBloggerTitle: z.boolean().optional(),
            /** 一键分镜/八格套装：54×N 按序分拆扣费 */
            bulkCompositePack: z
              .object({
                packSceneIds: z.array(z.string().min(1).max(128)).min(1).max(24),
                sequentialSlot: z.number().int().min(0),
              })
              .optional(),
          })
          .superRefine((data, ctx) => {
            const pack = data.bulkCompositePack;
            if (!pack) return;
            const { packSceneIds, sequentialSlot } = pack;
            if (sequentialSlot >= packSceneIds.length) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "bulkCompositePack.sequentialSlot 超出 packSceneIds 长度",
                path: ["bulkCompositePack", "sequentialSlot"],
              });
            }
            if (new Set(packSceneIds).size !== packSceneIds.length) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "bulkCompositePack.packSceneIds 须互不相同",
                path: ["bulkCompositePack", "packSceneIds"],
              });
            }
            if (packSceneIds[sequentialSlot] !== data.sceneId) {
              ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: "sceneId 须与 bulkCompositePack.packSceneIds[sequentialSlot] 一致",
                path: ["sceneId"],
              });
            }
          }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const supervisorOpsAllowed = resolvePlatformSupervisorOpsAllowed(ctx.user, input.supervisorToken);
        const enableCompositeDeepResearchProAdmin =
          supervisorOpsAllowed && input.enableTopicCoverDeepResearchPro === true;
        void input.imagePromptTranslator;
        const imagePromptTranslatorForComposite = "gpt54" as const;
        const compositePack = input.bulkCompositePack;
        // 3×4 十二格：仅 storyboard_sheet_landscape / xiaohongshu_dual_note 支持，后端分段生成再拼接，定价另算。
        // 套装（bulkCompositePack）随前端 3×4 开关换算单价（2×4→54/条；3×4→108/条），避免「选了 3×4 仍出 2×4」。
        const is3x4Grid =
          input.gridVariant === "3x4" &&
          (input.kind === "storyboard_sheet_landscape" || input.kind === "xiaohongshu_dual_note");
        const cost = compositePack
          ? platformBundleCreditsForSlot(
              platformCompositeBundleTotalCreditsForGrid(compositePack.packSceneIds.length, is3x4Grid),
              compositePack.sequentialSlot,
              compositePack.packSceneIds.length,
            )
          : input.kind === "storyboard_sheet_portrait" || input.kind === "storyboard_sheet_landscape"
            ? (is3x4Grid ? CREDIT_COSTS.platformStoryboardSheet3x4 : CREDIT_COSTS.platformStoryboardSheet)
            : input.kind === "single_page_knowledge_card"
              ? CREDIT_COSTS.platformSinglePageKnowledgeCard // 25/篇；上篇+下篇两次合计 50
              : (is3x4Grid ? CREDIT_COSTS.platformXhsDualNote3x4 : CREDIT_COSTS.platformXhsDualNote);

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < cost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，需要 ${cost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          const compositeDeductionNote =
            input.kind === "storyboard_sheet_portrait" || input.kind === "storyboard_sheet_landscape"
              ? `分镜图文参考（双语编导；生图采用 GPT-IMAGE-2）· ${input.title.slice(0, 48)}`
              : input.kind === "single_page_knowledge_card"
                ? `单页连贯图文知识卡片（双语编导；GPT-IMAGE-2 · Vertex 2K 兜底）· ${input.title.slice(0, 48)}`
                : `小红书 2×4 八格图文参考（双语编导；GPT-IMAGE-2 · Vertex 2K 兜底）· ${input.title.slice(0, 48)}`;
          const bulkTag = compositePack
            ? ` · 分镜套装（九折）第${compositePack.sequentialSlot + 1}/${compositePack.packSceneIds.length}笔`
            : "";
          await deductCreditsAmount(userId, cost, "platformCompositeSheet", compositeDeductionNote + bulkTag);
        }

        if (input.jobId) {
          console.log(
            `[mvAnalysis.generatePlatformCompositeSheet] jobId=${input.jobId} kind=${input.kind} sceneId=${input.sceneId} userId=${userId}`,
          );
        }

        const progressJobIdRaw = String(input.progressJobId ?? "").trim();
        const progressJobId = progressJobIdRaw.length >= 8 ? progressJobIdRaw : null;

        const enrichedCompositeScriptContext = (() => {
          const base = String(input.scriptContext || "").trim();
          const hints = composePlatformImageSkillHints(
            Array.isArray(input.enabledSkillIds) ? input.enabledSkillIds : null,
          );
          if (!hints.trim()) return base;
          return `${hints}\n\n${base}`.slice(0, 12000);
        })();

        let detachLiveProgress: (() => void) | undefined;

        const { generatePlatformCompositeSheetImage, generatePlatformGridStitchedSheetImage, appendImageFlowLog } = await import("./services/proxyImageService.js");
        // 3×4 → 走「分段生成 + sharp 直向拼接」总控；否则走单张合成
        const generateSheet = is3x4Grid ? generatePlatformGridStitchedSheetImage : generatePlatformCompositeSheetImage;
        const imageGenFlowLog: string[] = [];

        if (progressJobId) {
          try {
            await insertRunningCompositeSheetProgressJob({
              id: progressJobId,
              userId: String(userId),
              sceneId: input.sceneId,
              kind: input.kind,
              titleSlice: input.title.slice(0, 80),
            });
          } catch (pe) {
            console.warn("[mvAnalysis.generatePlatformCompositeSheet] progress job insert failed:", pe);
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "無法建立實時進度任務，請稍後再試",
            });
          }
          
          // 🚀 核心修復：如果前端傳了 progressJobId（非同步輪詢模式），
          // 則在背景啟動耗時的生成任務，並立即回傳 HTTP 200 給前端，避免 Vercel 60s Timeout。
          const runBackgroundComposite = async () => {
            const { attachCompositeSheetFlowLogLiveSync } = await import("./jobs/compositeSheetLiveProgress.js");
            detachLiveProgress = attachCompositeSheetFlowLogLiveSync(imageGenFlowLog, progressJobId);
            
            appendImageFlowLog(
              imageGenFlowLog,
              `[2×4 接口] generatePlatformCompositeSheet 开始 (异步背景执行) · sceneId=${input.sceneId} · kind=${input.kind} · title=${input.title.slice(0, 60)} · 本笔 ${cost} 点`,
            );
            const isTrial = !isAdminUser && (await resolveWatermark(userId, isAdminUser));
            appendImageFlowLog(imageGenFlowLog, `[2×4 接口] 试用水印 isTrial=${isTrial}`);
            let imageUrl: string | null = null;
            try {
              imageUrl = await generateSheet({
                kind: input.kind,
                title: input.title,
                scriptContext: enrichedCompositeScriptContext,
                isTrial,
                executionDetails: input.executionDetails,
                shootingTechniqueBrief: input.shootingTechniqueBrief,
                imagePromptTranslator: imagePromptTranslatorForComposite,
                flowLog: imageGenFlowLog,
                enableCompositeDeepResearchPro: enableCompositeDeepResearchProAdmin,
                coverPersonaContext: String(input.coverPersonaContext ?? "").trim() || undefined,
                referencePhotoUrl: String(input.referencePhotoUrl ?? "").trim() || undefined,
                referencePhotoFromApprovedCover: input.referencePhotoFromApprovedCover === true,
                compositeImageEngine: input.compositeImageEngine,
                notePart: input.notePart,
              });

              appendImageFlowLog(imageGenFlowLog, imageUrl ? "✓ generatePlatformCompositeSheet 完成" : "✗ 无 imageUrl（应已在上方抛错）");
              await markJobSucceeded(progressJobId, {
                imageGenFlowLog,
                compositeSheetProgress: true,
                compositeImageUrl: imageUrl,
                done: true,
              });
            } catch (error: any) {
              const rawMessage = error instanceof Error ? error.message : String(error);
              console.error("\n[生图致命错误 (Async Background)]:", rawMessage);
              
              const tail = imageGenFlowLog.filter((s) => String(s).trim()).slice(-24).join("\n").slice(0, 1200);
              await markJobFailed(
                progressJobId,
                tail ? `${rawMessage}\n── log ──\n${tail}` : rawMessage,
              );
              
              if (!isAdminUser) {
                await refundCredits(userId, cost, "platformCompositeSheet 生图致命错误退还");
              }
            } finally {
              detachLiveProgress?.();
            }
          };

          // 啟動背景任務 (Fire-and-Forget)
          runBackgroundComposite().catch(e => console.error("Unhandled background composite error:", e));

          // 立刻返回給前端，避免 Timeout（回傳 progressJobId 與封面 jobId 對齊，方便 Network 除錯）
          return {
            success: true as const,
            imageUrl: null, // 前端會從輪詢 API 去拿真正的圖
            totalCost: isAdminUser ? 0 : cost,
            kind: input.kind,
            imageGenFlowLog: ["[系統] 任務已成功送入背景駐列，請透過實時進度追蹤。"],
            isAsync: true,
            progressJobId,
          };
        }

        // --- 若無 progressJobId，則退回原本的同步等待邏輯 (極少發生，保留作相容) ---
        appendImageFlowLog(
          imageGenFlowLog,
          `[2×4 接口] generatePlatformCompositeSheet 开始 (同步执行) · sceneId=${input.sceneId} · kind=${input.kind} · title=${input.title.slice(0, 60)} · 本笔 ${cost} 点`,
        );
        // --- 同步執行部分 (繼續) ---
        const isTrial = !isAdminUser && (await resolveWatermark(userId, isAdminUser));
        appendImageFlowLog(imageGenFlowLog, `[2×4 接口] 试用水印 isTrial=${isTrial}`);
        let imageUrl: string | null = null;
        try {
          imageUrl = await generateSheet({
            kind: input.kind,
            title: input.title,
            scriptContext: enrichedCompositeScriptContext,
            isTrial,
            executionDetails: input.executionDetails,
            shootingTechniqueBrief: input.shootingTechniqueBrief,
            imagePromptTranslator: imagePromptTranslatorForComposite,
            flowLog: imageGenFlowLog,
            enableCompositeDeepResearchPro: enableCompositeDeepResearchProAdmin,
            coverPersonaContext: String(input.coverPersonaContext ?? "").trim() || undefined,
            referencePhotoUrl: String(input.referencePhotoUrl ?? "").trim() || undefined,
            referencePhotoFromApprovedCover: input.referencePhotoFromApprovedCover === true,
            compositeImageEngine: input.compositeImageEngine,
            notePart: input.notePart,
          });
        } catch (error: any) {
          detachLiveProgress?.();
          detachLiveProgress = undefined;
          if (progressJobId) {
            const tail = imageGenFlowLog.filter((s) => String(s).trim()).slice(-24).join("\n").slice(0, 1200);
            await markJobFailed(
              progressJobId,
              tail ? `${error instanceof Error ? error.message : String(error)}\n── log ──\n${tail}` : String(error),
            );
          }
          const rawMessage = error instanceof Error ? error.message : String(error);

          console.error("\n[生图致命错误 (Global Node)]:", rawMessage);

          if (!isAdminUser) {
            await refundCredits(ctx.user.id, cost, "platformCompositeSheet Global Node 生图致命错误退还");
          }

          const hasFullLogInMessage =
            rawMessage.includes("执行日志:") || rawMessage.includes("—— imageGenFlowLog ——");
          const isCompositeCapacity =
            rawMessage.trim() === PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE ||
            rawMessage.includes(PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE);
          let clientMessage = isCompositeCapacity
            ? `${PLATFORM_COMPOSITE_TRANSLATION_CAPACITY_MESSAGE}（积分已退回）`
            : `引擎错误 (积分已退回): \n${rawMessage}`;
          if (!isCompositeCapacity && !hasFullLogInMessage && imageGenFlowLog.length > 0) {
            const logTail = imageGenFlowLog
              .filter((s) => String(s).trim())
              .slice(-72)
              .join("\n")
              .trim();
            const cap = 6000;
            const detail =
              logTail.length > cap ? `${logTail.slice(0, cap)}…\n（日志已截断）` : logTail;
            if (detail) {
              clientMessage += `\n—— imageGenFlowLog ——\n${detail}`;
            }
          }

          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: clientMessage,
          });
        }

        if (!imageUrl) {
          detachLiveProgress?.();
          if (progressJobId) {
            await markJobFailed(progressJobId, "imageUrl 为空");
          }
          if (!isAdminUser) {
            await refundCredits(userId, cost, "platformCompositeSheet 生图失败退还");
          }
          const logTail = imageGenFlowLog
            .filter((s) => String(s).trim())
            .slice(-72)
            .join("\n")
            .trim();
          const cap = 6000;
          const detail =
            logTail.length > cap ? `${logTail.slice(0, cap)}…\n（日志已截断）` : logTail;
          const rawMessage = detail
            ? `imageUrl 为空\n—— imageGenFlowLog ——\n${detail}`
            : "imageUrl 为空（无 imageGenFlowLog 明细）";
          console.error("\n[生图致命错误 (Global Node)]:", rawMessage);
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `引擎错误 (积分已退回): \n${rawMessage}`,
          });
        }

        try {
          const { persistStoryboardSheetExportAfterGeneration } = await import(
            "./services/storyboardSheetExportPersistence"
          );
          await persistStoryboardSheetExportAfterGeneration({
            userId,
            creationRecordId: input.creationRecordId,
            jobId: input.jobId,
            sceneId: input.sceneId,
            payload: {
              imageUrl,
              scriptContextForPanels: input.scriptContext,
              executionDetails: input.executionDetails,
              reportTitle: input.title,
              kind: input.kind,
              sceneId: input.sceneId,
              updatedAt: new Date().toISOString(),
            },
          });
        } catch (e: any) {
          console.error("[mvAnalysis.generatePlatformCompositeSheet] metadata persist failed:", e?.message || e);
        }

        appendImageFlowLog(imageGenFlowLog, imageUrl ? "✓ generatePlatformCompositeSheet 完成" : "✗ 无 imageUrl（应已在上方抛错）");
        detachLiveProgress?.();
        if (progressJobId) {
          await markJobSucceeded(progressJobId, {
            imageGenFlowLog,
            compositeSheetProgress: true,
            done: true,
          });
        }
        return {
          success: true as const,
          imageUrl,
          totalCost: isAdminUser ? 0 : cost,
          kind: input.kind,
          imageGenFlowLog,
        };
      }),

    /**
     * 平台页·自定义抠像：用户描述主体、姿态与场景（如坐姿+海边/书房）→ GPT-IMAGE-2 生图。
     * 若描述含「去背景 / 自动去背景」等关键词，则 GPT-IMAGE-2 直出白底主体图（无 fal 后处理）。
     * 单独扣费：1 张原价、2 张九折、4 张八折（见 platformCustomMattingTotalCredits）。
     */
    generatePlatformCustomMatting: protectedProcedure
      .input(
        z.object({
          prompt: z.string().min(4).max(2000),
          aspectRatio: z.enum(PLATFORM_MATTING_ASPECT_RATIOS),
          count: z.union([z.literal(1), z.literal(2), z.literal(4)]),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const cost = platformCustomMattingTotalCredits(input.count);

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < cost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，需要 ${cost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCreditsAmount(
            userId,
            cost,
            "platformCustomMatting",
            `自定义抠像 · ${input.aspectRatio} · ${input.count} 张 · ${input.prompt.slice(0, 48)}`,
          );
        }

        const imageGenFlowLog: string[] = [];
        const { generatePlatformCustomMattingImages } = await import("./services/platformCustomMatting.js");
        const { imageUrls, englishPrompt, transparentCutout } = await generatePlatformCustomMattingImages({
          userPrompt: input.prompt,
          aspectRatio: input.aspectRatio,
          count: input.count,
          flowLog: imageGenFlowLog,
        });

        return {
          success: true as const,
          imageUrls,
          totalCost: isAdminUser ? 0 : cost,
          aspectRatio: input.aspectRatio,
          count: input.count,
          englishPrompt,
          imageGenFlowLog,
          transparentCutout,
        };
      }),

    /**
     * GodView 研报完成后：按章节一键生成战略扉页竖版海报（Gemini 英文指令 → GPT-IMAGE-2 + Nano Banana 2 兜底；试用水印跟任务走）。
     * 不扣积分；水印严格跟随该任务的 `strategicImagesTrialWatermark`（首购尝鲜），不信任客户端传参绕过。
     */
    generateGodViewChapterPosters: protectedProcedure
      .input(z.object({
        jobId: z.string().min(1),
        chapters: z.array(z.object({
          id: z.string().min(1).max(128),
          title: z.string().min(1).max(220),
          context: z.string().max(2500).optional(),
        })).min(1).max(24),
      }))
      .mutation(async ({ input, ctx }) => {
        const { readJob } = await import("./services/deepResearchService");
        const job = await readJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (job.userId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        const allowed = new Set(["completed", "awaiting_review"]);
        if (!allowed.has(job.status)) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "研报未完成，无法生成扉页" });
        }
        const md = String(job.reportMarkdown || "").trim();
        if (md.length < 40) {
          throw new TRPCError({ code: "BAD_REQUEST", message: "报告正文不可用" });
        }
        const isTrial = !!job.strategicImagesTrialWatermark;
        const { buildChapterPosterGeminiTask, runGemini31ProPreviewText } = await import(
          "./services/geminiPlatformCompositeTranslation.js",
        );
        const { generateImageGpt2WithImagenFallback, generateGptImage2FromRawEnglishPrompt } = await import(
          "./services/proxyImageService",
        );
        const results: { id: string; title: string; url: string | null }[] = [];
        for (const ch of input.chapters) {
          const ctxText = String(ch.context || "").trim() || ch.title;
          let url: string | null = null;
          try {
            const englishPrompt = await runGemini31ProPreviewText(
              buildChapterPosterGeminiTask(ch.title, ctxText),
            );
            url = await generateGptImage2FromRawEnglishPrompt({
              englishPrompt,
              aspectRatio: "9:16",
              gcsSubdir: "godview_chapter_poster_gpt2",
              trialWatermarkPromptSuffix: isTrial ? TRIAL_READ_WATERMARK_IMAGE_PROMPT_INSTRUCTION : undefined,
            });
          } catch (e: unknown) {
            console.warn(
              `[mvAnalysis.generateGodViewChapterPosters] Gemini→GPT-IMAGE-2 失败 chapter=${ch.id}:`,
              e instanceof Error ? e.message : e,
            );
          }
          if (!url) {
            url = await generateImageGpt2WithImagenFallback({
              title: ch.title,
              copywriting: ctxText,
              mode: "STRATEGIC",
              isTrial,
            });
          }
          results.push({ id: ch.id, title: ch.title, url });
        }
        const okCount = results.filter((r) => r.url).length;
        if (okCount === 0) {
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "扉页生成失败（生图服务不可用）" });
        }
        return { ok: true as const, totalCost: 0 as const, results, isTrial };
      }),

    getPlatformDashboard: publicProcedure
      .input(z.object({
        context: z.string().optional(),
        windowDays: z.union([z.literal(3), z.literal(7), z.literal(15), z.literal(30), z.literal(45)]),
        requestedPlatforms: z.array(z.string()).optional(),
        snapshotSummary: z.record(z.string(), z.any()),
        copyLlmMode: zPlatformCopyLlmModeInput,
      }))
      .mutation(async ({ input, ctx }) => {
        const requestedPlatforms = normalizePlatforms(input.requestedPlatforms || []);
        const selectedWindowDays = Number(input.windowDays);
        const t0 = Date.now();

        // Read narrow store for evidence enrichment (best-effort, 20s cap)
        const storeNull = { collections: {}, history: null, backfill: null } as unknown as Awaited<ReturnType<typeof readTrendStore>>;
        const store = await Promise.race([
          readTrendStoreForPlatforms(requestedPlatforms.length ? requestedPlatforms as any[] : ["douyin", "xiaohongshu", "bilibili", "kuaishou"], { preferDerivedFiles: true, preferFlyLive: true }),
          new Promise<Awaited<ReturnType<typeof readTrendStore>>>((resolve) => setTimeout(() => resolve(storeNull), 20_000)),
        ]).catch(() => storeNull);

        // Build dashboard — timeout cap scales with windowDays:
        // 30/45-day requests carry more trend data → LLM takes longer.
        // The inner AbortSignal.timeout (DEFAULT_LLM_TIMEOUT_MS = 480s in llm.ts) may
        // fire before our outer Promise.race timer for large windows, producing a
        // "fetch failed" TypeError caught here. We give the outer timer 10s of headroom
        // over the inner fetch timeout so the outer timer always wins.
        const DASHBOARD_TIMEOUT_MS = selectedWindowDays >= 30
          ? Math.max(PLATFORM_LLM_TIMEOUT_MS, 600_000)  // 10 min for 30/45-day windows
          : PLATFORM_LLM_TIMEOUT_MS;
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
              abortSignal: ctx.clientDisconnected,
              copyLlmMode: input.copyLlmMode,
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
          // Treat fetch-failed / AbortError as a graceful timeout rather than a hard failure.
          // Root cause: for 30-day windows the Evolink/OpenAI call approaches the
          // DEFAULT_LLM_TIMEOUT_MS (480s) in llm.ts, causing AbortSignal.timeout() to fire
          // and throw "fetch failed" BEFORE our outer Promise.race timer resolves to null.
          // Both outcomes mean the same thing (LLM timed out) — normalize to success+null
          // so the client handles it identically to the outer-timer timeout path.
          const isFetchTimeoutOrAbort =
            (error as any)?.name === "AbortError" ||
            errorMessage.toLowerCase().includes("fetch failed") ||
            errorMessage.toLowerCase().includes("aborted") ||
            errorMessage.toLowerCase().includes("超时") ||
            errorMessage.toLowerCase().includes("timeout");
          if (isFetchTimeoutOrAbort) {
            console.warn(
              `[platform.getPlatformDashboard] fetch-failed/abort treated as graceful timeout (windowDays=${selectedWindowDays}, totalMs=${Date.now() - t0}): ${errorMessage}`,
            );
            return {
              success: true,
              platformDashboard: null,
              debug: {
                route: "mvAnalysis.getPlatformDashboard",
                totalMs: Date.now() - t0,
                hasDashboard: false,
                error: `graceful_timeout: ${errorMessage}`,
              },
            };
          }
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

    /**
     * Stage 2 文案與選題：**已登入使用者**點擊生成後扣 {@link CREDIT_COSTS.platformStage2Copywriting} 積分並入隊 `platform_build_content`。
     */
    enqueuePlatformContentJob: protectedProcedure
      .input(
        z.object({
          context: z.string().optional(),
          windowDays: z.union([z.literal(3), z.literal(7), z.literal(15), z.literal(30), z.literal(45)]),
          platformMenu: z.array(z.any()).optional(),
          /** 趋势报表全局蓝海词（一级/二级），并入 Stage2 推演文案词表 */
          globalBlueOceanWords: z.array(z.any()).optional(),
          snapshotSummary: z.record(z.string(), z.any()),
          /** Stage 1 完整戰略看板：後端清洗為 stage1StrategicHandoff 再併入 Stage 2 提示 */
          strategicDashboard: z.record(z.string(), z.any()).optional(),
          /**
           * Stage 1 / Stage 2 文案线路：`vertex`=Gemini 3.5 Flash · `openai`=GPT‑5.5（默认）。
           */
          stage2LlmMode: zPlatformCopyLlmModeInput,
          supervisorToken: z.string().max(512).optional(),
          /** /platform 勾选启用的 Skill id 列表（内置 + 用户上传） */
          enabledSkillIds: z.array(z.string().min(1).max(80)).max(24).optional(),
          /** UI：接受「博主/创作者」自称；默认 false */
          allowBloggerTitle: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const stage2LlmModeForJob =
          input.stage2LlmMode === "vertex" || input.stage2LlmMode === "openai"
            ? input.stage2LlmMode
            : undefined;
        if (!isAdminUser) {
          const cost = CREDIT_COSTS.platformStage2Copywriting;
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < cost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，專屬文案生成需要 ${cost} 點（當前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCredits(
            userId,
            "platformStage2Copywriting",
            `專屬選題與文案（Stage 2 · ${input.windowDays} 天窗口）`,
          );
        }

        const jobId = nanoid(16);
        const uid = String(userId);
        await createJobRecord({
          id: jobId,
          userId: uid,
          type: "platform",
          provider: "vertex",
          input: {
            action: "platform_build_content",
            params: {
              context: input.context,
              windowDays: input.windowDays,
              platformMenu: input.platformMenu ?? [],
              globalBlueOceanWords: input.globalBlueOceanWords ?? [],
              snapshotSummary: input.snapshotSummary,
              strategicDashboard: input.strategicDashboard,
              ...(stage2LlmModeForJob ? { stage2LlmMode: stage2LlmModeForJob } : {}),
              ...(Array.isArray(input.enabledSkillIds)
                ? { enabledSkillIds: input.enabledSkillIds }
                : {}),
              ...(typeof input.allowBloggerTitle === "boolean"
                ? { allowBloggerTitle: input.allowBloggerTitle }
                : {}),
            },
          },
        });
        return { jobId, status: "queued" as const };
      }),

    /**
     * 自定义创作工作台 · 深度优化文案（纯 LLM，无出图）。
     * 扣 {@link CREDIT_COSTS.platformOptimizeCustomCopy} 积分/次。
     */
    optimizeCustomCopy: protectedProcedure
      .input(
        z.object({
          sourceText: z.string().min(10).max(12000),
          optimizationBrief: z.string().max(4000).optional(),
          visionContext: z.string().max(8000).optional(),
          includeLiveTrends: z.boolean().optional(),
          liveTrendWindowDays: z.number().int().min(3).max(15).optional(),
          supervisorToken: z.string().max(512).optional(),
          enabledSkillIds: z.array(z.string().min(1).max(80)).max(24).optional(),
          allowBloggerTitle: z.boolean().optional(),
        }),
      )
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin" || ctx.user.role === "supervisor";
        const cost = CREDIT_COSTS.platformOptimizeCustomCopy;
        let creditsCharged = false;

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < cost) {
            throw new TRPCError({
              code: "PAYMENT_REQUIRED",
              message: `Credits 不足，深度优化文案需要 ${cost} 点（当前可用：${creditsInfo.totalAvailable}）`,
            });
          }
          await deductCredits(
            userId,
            "platformOptimizeCustomCopy",
            "自定义文案 · 深度优化",
          );
          creditsCharged = true;
        }

        try {
          const platformSkillsPrompt = await (async () => {
            try {
              const { resolvePlatformSkillsPrompt } = await import("./services/platformSkillsService.js");
              return await resolvePlatformSkillsPrompt({
                userId,
                enabledSkillIds: Array.isArray(input.enabledSkillIds) ? input.enabledSkillIds : null,
                allowBloggerTitle: Boolean(input.allowBloggerTitle),
              });
            } catch {
              return "";
            }
          })();

          const { optimizeCustomCopy } = await import("./services/platformOptimizeCustomCopy");
          const result = await optimizeCustomCopy({
            sourceText: input.sourceText,
            optimizationBrief: input.optimizationBrief,
            visionContext: input.visionContext,
            includeLiveTrends: input.includeLiveTrends,
            liveTrendWindowDays: input.liveTrendWindowDays,
            platformSkillsPrompt: platformSkillsPrompt || undefined,
          });

          return {
            success: true as const,
            cost: isAdminUser ? 0 : cost,
            result,
          };
        } catch (error) {
          if (creditsCharged) {
            const { refundCredits } = await import("./credits.js");
            await refundCredits(userId, cost, "platformOptimizeCustomCopy 深度优化失败退还").catch(
              (refundErr: unknown) => {
                console.error("[optimizeCustomCopy] refund failed:", refundErr);
              },
            );
          }
          const { OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE } = await import(
            "./services/platformOptimizeCustomCopy.js"
          );
          const rawMessage = error instanceof Error ? error.message : String(error);
          const isCapacity = rawMessage === OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE;
          throw new TRPCError({
            code: isCapacity ? "SERVICE_UNAVAILABLE" : "INTERNAL_SERVER_ERROR",
            message: isCapacity
              ? `${OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE}${creditsCharged ? "（积分已退回）" : ""}`
              : rawMessage.includes("is not valid JSON")
                ? `${OPTIMIZE_CUSTOM_COPY_CAPACITY_MESSAGE}${creditsCharged ? "（积分已退回）" : ""}`
                : rawMessage || `文案优化失败${creditsCharged ? "，积分已退回" : ""}，请稍后重试`,
          });
        }
      }),

    getPlatformContent: publicProcedure
      .input(z.object({
        context: z.string().optional(),
        windowDays: z.union([z.literal(3), z.literal(7), z.literal(15), z.literal(30), z.literal(45)]),
        platformMenu: z.array(z.any()).optional(),
        snapshotSummary: z.record(z.string(), z.any()),
        strategicDashboard: z.record(z.string(), z.any()).optional(),
        stage2LlmMode: zPlatformCopyLlmModeInput,
        supervisorToken: z.string().max(512).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const t0 = Date.now();
        let platformContent: z.infer<typeof platformContentResponseSchema> | null = null;
        let stage2Error: string | null = null;
        let stage2TimedOut = false;
        const preferFlyLive = process.env.PLATFORM_TREND_PREFER_FLY_LIVE === "true";
        let storeReadTimedOut = false;
        let buildDiagnostics: Record<string, unknown> | null = null;
        const storeReadT0 = Date.now();
        try {
          const requestedPlatforms = normalizePlatforms([
            ...((input.snapshotSummary?.platformSnapshots || []) as Array<{ platform?: string }>).map((item) => String(item?.platform || "")),
            ...((input.platformMenu || []) as Array<{ platform?: string }>).map((item) => String(item?.platform || "")),
          ]);
          const storeNull = { collections: {}, history: null, backfill: null } as unknown as Awaited<ReturnType<typeof readTrendStore>>;
          const storeReadPromise = requestedPlatforms.length
            ? readTrendStoreForPlatforms(requestedPlatforms, { preferDerivedFiles: true, preferFlyLive })
            : readTrendStore({ preferDerivedFiles: true, preferFlyLive });
          const store = await new Promise<Awaited<ReturnType<typeof readTrendStore>>>((resolve) => {
            let settled = false;
            const timer = setTimeout(() => {
              if (settled) return;
              settled = true;
              storeReadTimedOut = true;
              resolve(storeNull);
            }, 20_000);
            storeReadPromise
              .then((s) => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(s);
              })
              .catch(() => {
                if (settled) return;
                settled = true;
                clearTimeout(timer);
                resolve(storeNull);
              });
          });
          const storeReadMs = Date.now() - storeReadT0;

          const stage1Handoff = buildStage1StrategicHandoffForStage2(
            input.strategicDashboard,
            input.snapshotSummary,
          );

          const stage2LlmModeOverride =
            input.stage2LlmMode === "vertex" || input.stage2LlmMode === "openai"
              ? input.stage2LlmMode
              : undefined;

          type Stage2RaceDone = { kind: "done"; data: z.infer<typeof platformContentResponseSchema>; diagnostics: Record<string, unknown> };
          type Stage2RaceTimeout = { kind: "timeout" };
          const raced = await Promise.race([
            buildPlatformContent({
              snapshot: input.snapshotSummary,
              platformMenu: input.platformMenu || [],
              context: input.context,
              windowDays: Number(input.windowDays),
              requestedPlatforms,
              store,
              abortSignal: ctx.clientDisconnected,
              stage1Handoff,
              stage2LlmModeOverride: stage2LlmModeOverride ?? null,
            }).then(
              (r): Stage2RaceDone => ({
                kind: "done",
                data: r.data,
                diagnostics: { ...r.diagnostics, storeReadMs },
              }),
            ),
            new Promise<Stage2RaceTimeout>((resolve) => {
              setTimeout(() => {
                console.warn(
                  `[platform.getPlatformContent] 平台内容生成超时，已等待 ${PLATFORM_STAGE2_SYNC_LLM_TIMEOUT_MS}ms，返回空结果`,
                );
                stage2TimedOut = true;
                resolve({ kind: "timeout" });
              }, PLATFORM_STAGE2_SYNC_LLM_TIMEOUT_MS);
            }),
          ]);

          if (raced.kind === "timeout") {
            platformContent = null;
            buildDiagnostics = { stage2TimedOut: true, storeReadMs, storeReadTimedOut };
          } else {
            platformContent = raced.data;
            buildDiagnostics = {
              ...raced.diagnostics,
              storeReadMs,
              storeReadTimedOut,
            };
            if (ctx.user?.id && Array.isArray(platformContent.contentBlueprints) && platformContent.contentBlueprints.length > 0) {
              const { savePlatformStrategicBlueprintSnapshot } = await import(
                "./services/platformStrategicBlueprintSnapshots.js",
              );
              void savePlatformStrategicBlueprintSnapshot({
                userId: ctx.user.id,
                windowDays: Number(input.windowDays),
                context: input.context,
                requestedPlatforms,
                contentBlueprints: platformContent.contentBlueprints as unknown[],
              });
            }
          }
        } catch (error) {
          console.error("[platform.getPlatformContent] error:", error);
          stage2Error = error instanceof Error ? error.message : String(error);
          if (error instanceof Error) {
            console.error("[platform.getPlatformContent] error message:", error.message);
          }
          // @ts-ignore
          if (error?.name === "ZodError" || (error as any)?.errors) {
            console.error("[platform.getPlatformContent] ZodError details:", JSON.stringify((error as any).errors?.slice(0, 5)));
          }
          platformContent = null;
          buildDiagnostics = {
            ...(buildDiagnostics && typeof buildDiagnostics === "object" ? buildDiagnostics : {}),
            stage2Exception: true,
            storeReadElapsedMs: Date.now() - storeReadT0,
          };
        }
        return {
          success: true,
          platformContent,
          debug: {
            route: "mvAnalysis.getPlatformContent",
            totalMs: Date.now() - t0,
            hasContent: Boolean(platformContent),
            preferFlyLive,
            stage2Error,
            stage2TimedOut,
            platformLlmTimeoutMs: PLATFORM_LLM_TIMEOUT_MS,
            platformStage2SyncTimeoutMs: PLATFORM_STAGE2_SYNC_LLM_TIMEOUT_MS,
            buildPlatformContent: buildDiagnostics,
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
            Math.round((Number(process.env.GROWTH_BACKFILL_ACTIVE_INTERVAL_MS || 5 * 60 * 1000) || 5 * 60 * 1000) / (60 * 1000)),
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
            lastAddedCount: item?.lastAddedCount ?? 0,
            lastMergedCount: item?.lastMergedCount ?? 0,
            lastRawFetchedCount: item?.lastRawFetchedCount,
            lastAfterDedupCount: item?.lastAfterDedupCount,
            lastAfterWindowFilterCount: item?.lastAfterWindowFilterCount,
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
              .map((platform) => {
                const items = store?.collections?.[platform]?.items || [];
                const w15 = summarizeTrendWindowCounts(items, 15);
                const w30 = summarizeTrendWindowCounts(items, 30);
                const sched = runtimeMeta.scheduler?.[platform];
                return {
                  platform,
                  platformLabel: getGrowthPlatformMeta(platform).label,
                  platformDescription: getGrowthPlatformMeta(platform).description,
                  currentItems: Number(debugSummary?.platforms?.[platform]?.currentTotal || w30.warehouseTotal || 0),
                  archivedItems: Number(debugSummary?.platforms?.[platform]?.archivedTotal || 0),
                  warehouseTotal: w30.warehouseTotal,
                  windowItems15d: w15.windowFiltered,
                  windowItems30d: w30.windowFiltered,
                  lastPipeline: sched
                    ? {
                        rawFetched: sched.lastRawFetchedCount,
                        afterDedup: sched.lastAfterDedupCount,
                        afterWindowFilter: sched.lastAfterWindowFilterCount,
                        mergedAdded: sched.lastAddedCount,
                      }
                    : undefined,
                };
              }),
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

    /** 首页智能向导：和善、专业地介绍站内付费能力（Gemini 3.1 Pro · Vertex global） */
    homeProductGuide: protectedProcedure
      .input(z.object({ message: z.string().min(1).max(4000) }))
      .mutation(async ({ input, ctx }) => {
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("首页智能向导");

        const COST = 2;
        let deduct: Awaited<ReturnType<typeof deductCreditsAmount>>;
        try {
          deduct = await deductCreditsAmount(ctx.user.id, COST, "aiAssistEditor", "首页智能向导·产品咨询");
          if (!deduct.success) throw new Error(`积分不足，需要 ${COST} 点`);
        } catch (e: any) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: e?.message || "积分不足" });
        }

        const { registerActiveJob, refundCreditsOnFailure, unregisterActiveJob } = await import(
          "./services/paidJobLedger",
        );
        const jobId = `hpg_${Date.now()}_${nanoid(6)}`;
        await registerActiveJob({
          jobId,
          taskType: "aiAssistEditor",
          userId: ctx.user.id,
          creditsBilled: deduct.source === "admin" ? 0 : COST,
          action: "首页智能向导",
          externalApiCostHint: "Vertex gemini-3.1-pro-preview",
          metadata: { kind: "homeProductGuide" },
        }).catch(() => {});

        const system = `你是 MV Studio Pro 站内智能向导。用户可能不了解产品。
请用温暖、耐心、专业的简体中文回答，避免生硬推销；若涉及付费，诚实说明「大约需要多少积分/适合谁」，并给出 1～2 个最相关的站内路径（如 /platform、/god-view、/research、/creator-growth-camp/premium-remix）。
回答控制在 400 字以内，分条陈述，不要编造不存在的功能。若问题与产品无关，礼貌引导回创作与增长相关主题。`;

        try {
          const { callGemini3_1_Pro } = await import("./services/vertexGemini31ProGlobal.js");
          const reply = (
            await callGemini3_1_Pro(`${system}\n\n用户问题：\n${input.message}`, {
              maxOutputTokens: 2048,
              temperature: 0.65,
            })
          ).trim();
          if (!reply) {
            await refundCreditsOnFailure(jobId, "aiAssistEditor", "external_api_error", "empty").catch(() => {});
            throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "AI 未返回内容" });
          }
          await unregisterActiveJob(jobId, "aiAssistEditor", "settled").catch(() => {});
          return { reply, creditsCost: COST };
        } catch (e: any) {
          await refundCreditsOnFailure(jobId, "aiAssistEditor", "task_failed", String(e?.message ?? "")).catch(
            () => {},
          );
          if (e instanceof TRPCError) throw e;
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: e?.message || "智能向导调用失败",
          });
        }
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
        model: z.enum(["flash", "gpt5", "gpt54", "pro"]).default("flash"),
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
          const isGptTier = input.model === "gpt5" || input.model === "gpt54";
          const creditKey = isGptTier ? "storyboardGpt5" : input.model === "pro" ? "storyboard" : "storyboardFlash";
          const canAfford = await hasEnoughCredits(userId, creditKey);
          if (!canAfford) {
            const modelLabel = isGptTier ? "GPT 5.4" : input.model === "pro" ? "Gemini 3.0 Pro" : "Gemini 3.0 Flash";
            throw new Error(`Credits 不足，无法使用 ${modelLabel} 模型。请充值 Credits。`);
          }
          await deductCredits(userId, creditKey, `分镜脚本生成 (${isGptTier ? "GPT 5.4" : input.model === "pro" ? "Gemini 3.0 Pro" : "Gemini 3.0 Flash"})`);
        }

        // Use LLM to analyze lyrics and generate storyboard
        const llmResult = await executeProviderFallback<Awaited<ReturnType<typeof invokeLLM>>>({
          apiName: "storyboard.generate.story",
          providers: getTierProviderChain(userTier, "text"),
          execute: async (provider) => {
            const providerModel =
              input.model === "gpt54" || input.model === "gpt5"
                ? input.model
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
        model: z.enum(["flash", "gpt5", "gpt54", "pro"]).default("flash"),
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
              input.model === "gpt54" || input.model === "gpt5"
                ? input.model
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
        model: z.enum(["pro", "gpt5", "gpt54"]).default("pro"),
      }))
      .mutation(async ({ input, ctx }) => {
        const userId = ctx.user.id;
        const isAdminUser = ctx.user.role === "admin";

        if (!isAdminUser) {
          const creditsInfo = await getCredits(userId);
          if (creditsInfo.totalAvailable < CREDIT_COSTS.recommendBGM) {
            throw new Error(`Credits 不足，AI 推薦 BGM 需要 ${CREDIT_COSTS.recommendBGM} Credits`);
          }
          await deductCredits(userId, "recommendBGM", `AI 推薦 BGM 描述 (${input.model === "gpt54" || input.model === "gpt5" ? "GPT 5.4" : "Gemini 3.0 Pro"})`);
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
          model: input.model === "gpt54" || input.model === "gpt5" ? (input.model as any) : ("pro" as any),
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

    // ──────────────────────────────────────────────────────────────────────
    // 付费任务运营面板 — paidJobLedger 视图
    // ──────────────────────────────────────────────────────────────────────

    /** 列出当前所有 active 付费任务（兜底退积分账本 + 部署闸门数据源） */
    activeJobsList: adminProcedure.query(async () => {
      const { listAllActiveJobs } = await import("./services/paidJobLedger");
      const all = await listAllActiveJobs();
      const now = Date.now();
      return {
        count: all.length,
        jobs: all.map((j) => ({
          jobId: j.jobId,
          taskType: j.taskType,
          userId: j.userId,
          creditsBilled: j.creditsBilled,
          action: j.action,
          chargedAt: j.chargedAt,
          lastHeartbeatAt: j.lastHeartbeatAt,
          ageSec: Math.round((now - new Date(j.chargedAt).getTime()) / 1000),
          heartbeatLagSec: Math.round((now - new Date(j.lastHeartbeatAt).getTime()) / 1000),
          pid: j.pid ?? null,
          externalApiCostHint: j.externalApiCostHint ?? null,
          paused: Boolean(j.holdPausedAt),
          pausedSince: j.holdPausedAt ?? null,
          cancelRequested: Boolean(j.cancelRequestedAt),
          cancelRequestedAt: j.cancelRequestedAt ?? null,
        })),
      };
    }),

    /** 强制取消任意 active 付费任务（管理员紧急按钮）。
     *  by="admin" → refundReason="user_cancelled" → 仍走幂等退积分。
     *  与用户主动取消（user_cancelled_no_refund 不退积分）路径区分清楚。 */
    activeJobsCancel: adminProcedure
      .input(z.object({ jobId: z.string().min(1), taskType: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const { requestCancel } = await import("./services/paidJobLedger");
        const r = await requestCancel(input.jobId, input.taskType, "admin");
        // Deep Research 同时同步 job 文件（admin 路径仍退积分）
        if (input.taskType === "deepResearch") {
          try {
            const { requestCancelDeepResearchJob } = await import("./services/deepResearchService");
            await requestCancelDeepResearchJob(input.jobId, "admin", "user_cancelled");
          } catch (e: any) {
            console.warn("[admin.activeJobsCancel] deep-research sync failed:", e?.message);
          }
        }
        return r;
      }),

    /** 强制让 reaper 跑一遍（管理员排错用，幂等） */
    activeJobsReap: adminProcedure
      .input(z.object({ staleMs: z.number().int().min(0).optional() }).optional())
      .mutation(async ({ input }) => {
        const { reapStuckPaidJobs } = await import("./services/paidJobLedger");
        return await reapStuckPaidJobs({ staleMs: input?.staleMs });
      }),

    /**
     * Neon `jobs` 表：與 `reapStaleJobsOnce`（staleJobsReaper）相同 DELETE 規則；
     * 手動觸發時 **會略過** `DISABLE_JOBS_STALE_REAPER`（與定時器 / worker 前置掃描不同）。
     * 允許 admin/supervisor 登入，或未登入但提供與 `betaCode.generate` 相同的 `supervisorToken`（`SUPERVISOR_SECRET`）。
     */
    reapStaleNeonJobs: publicProcedure
      .input(z.object({ supervisorToken: z.string().optional() }).optional())
      .mutation(async ({ ctx, input }) => {
        const role = ctx.user?.role;
        const sessionOk = role === "admin" || role === "supervisor";
        const tokenOk = isValidSupervisorSecret(input?.supervisorToken);
        if (!sessionOk && !tokenOk) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "需要管理員登入或有效的 supervisor token",
          });
        }
        const { reapStaleJobsOnce } = await import("./jobs/staleJobsReaper");
        return await reapStaleJobsOnce({ bypassDisable: true });
      }),

    runtimeMetricsOverview: adminProcedure
      .input(z.object({ tail: z.number().int().min(20).max(1200).optional() }).optional())
      .query(async ({ input }) => {
        const tail = Math.min(1200, Math.max(20, input?.tail ?? 420));
        return {
          meta: getRuntimeMetricsMeta(),
          rollup: summarizeRuntimeMetrics(),
          recent: getRuntimeMetricTail(tail),
        };
      }),

    // ──────────────────────────────────────────────────────────────────────
    // 维护模式（关闭新付费任务入口）
    // ──────────────────────────────────────────────────────────────────────

    maintenanceState: adminProcedure.query(async () => {
      const { getMaintenanceState } = await import("./services/maintenanceMode");
      return await getMaintenanceState();
    }),

    setMaintenance: adminProcedure
      .input(z.object({ enabled: z.boolean(), note: z.string().max(500).optional() }))
      .mutation(async ({ ctx, input }) => {
        const { enableMaintenance, disableMaintenance } = await import("./services/maintenanceMode");
        if (input.enabled) {
          return await enableMaintenance(`admin:${ctx.user.email ?? ctx.user.id}`, input.note);
        }
        return await disableMaintenance(`admin:${ctx.user.email ?? ctx.user.id}`);
      }),
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

        // 优先在 Fly 直接走 GCS 长任务（2x/4x 同一路径，300s 与 GCS 轮询一致）；无凭据时对**对外公開** `/api/google` 做 HTTP 回退（與本站同域，如已把正式域名指到 Fly 則為 `https://mvstudiopro.com`）
        const hasVertexCreds = Boolean(String(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON || "").trim());
        const publicAppBase = String(
          process.env.PUBLIC_APP_URL ||
            process.env.OAUTH_SERVER_URL ||
            process.env.FRONTEND_URL ||
            process.env.VERCEL_APP_URL ||
            "https://mvstudiopro.com",
        ).replace(/\/$/, "");
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
            const res = await fetch(`${publicAppBase}/api/google?op=upscaleImage`, {
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
              console.error(`[vertexImage.upscale] ${input.upscaleFactor} (public /api/google fallback) failed (HTTP ${res.status}): ${vertexErr}`);
            }
          } catch (e: any) {
            console.error("[vertexImage.upscale] public /api/google fallback failed:", e?.message);
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
    generate: protectedProcedure
      .input(z.object({
        prompt: z.string().min(1),
        model: z.string().optional(),
        size: z.string().optional(),
        quality: z.string().optional(),
        output_format: z.string().optional(),
        output_compression: z.number().optional(),
        n: z.number().optional(),
      }))
      .mutation(async ({ ctx, input }) => {
        // Daily limit check for GPT-image-2
        if (input.model === "gpt-image-2" || !input.model) {
          const { getDb } = await import("./db");
          const database = await getDb();
          if (database) {
            const { getUserPlan } = await import("./credits");
            const { creditTransactions, stripeUsageLogs } = await import("../drizzle/schema");
            const { eq, and, count, sql } = await import("drizzle-orm");

            const userPlan = await getUserPlan(ctx.user.id);
            const isAdmin = ctx.user.role === "admin" || ctx.user.role === "supervisor";
            
            if (userPlan === "free" && !isAdmin) {
              // Check if user has purchased credit pack
              const [purchaseCount] = await database
                .select({ count: count() })
                .from(creditTransactions)
                .where(
                  and(
                    eq(creditTransactions.userId, ctx.user.id),
                    eq(creditTransactions.source, "purchase"),
                    eq(creditTransactions.type, "credit")
                  )
                );
                
              const hasPurchasedCredits = Number(purchaseCount?.count || 0) > 0;
              
              if (!hasPurchasedCredits) {
                // Check today's usage
                const [usage] = await database
                  .select({ count: count() })
                  .from(stripeUsageLogs)
                  .where(
                    and(
                      eq(stripeUsageLogs.userId, ctx.user.id),
                      eq(stripeUsageLogs.action, "gpt-image-2-generate"),
                      sql`DATE(${stripeUsageLogs.createdAt}) = CURRENT_DATE`
                    )
                  );
                  
                if (Number(usage?.count || 0) >= 2) {
                  return { ok: false as const, error: "一天限用两次，超过必须购买积分或订阅才能继续使用。" };
                }
                
                // Record usage
                await database.insert(stripeUsageLogs).values({
                  userId: ctx.user.id,
                  action: "gpt-image-2-generate",
                  description: "GPT-image-2 免费限额生图"
                });
              }
            }
          }
        }

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
        const evolinkKey = String(process.env.EVOLINK_API_KEY || "").trim();
        const apiKey = evolinkKey || String(process.env.OPENAI_IMAGE_API_KEY || process.env.OPENAI_API_KEY || "").trim();
        if (!apiKey) return { ok: false as const, error: "Missing EVOLINK_API_KEY or OPENAI_API_KEY" };
        const analysisBaseUrl = evolinkKey ? "https://api.evolink.ai/v1" : "https://api.openai.com/v1";

        const question = input.question ||
          "请详细分析这张图片的视觉风格、色彩搭配、构图特点、情绪氛围，以及创作者可以借鉴的核心元素。用简体中文回答，分点说明。";

        let res: Response;
        try {
          res = await fetch(`${analysisBaseUrl}/responses`, {
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

  /**
   * 三大 Agent 场景（基于 Deep Research Max + Interactions API stateful flow）
   *   1) platformIpMatrix · 多平台 IP 矩阵 · 跨界爆款脚本
   *   2) competitorRadar  · 竞品/赛道雷达
   *   3) vipTracker       · VIP 客户身心抗衰追踪（stateful，previous_interaction_id 续接）
   * 共用前端组件 AgentInputPanel：文字 + 图片/PDF 上传 + 语音输入
   */
  agent: router({
    /** 指挥官档案 · 战略边界 + 核心资产（一次性设定，所有场景自动注入） */
    getCommanderProfile: protectedProcedure.query(async ({ ctx }) => {
      const { readCommanderProfile } = await import("./services/commanderProfileStore");
      const profile = await readCommanderProfile(String(ctx.user.id));
      return profile ?? {
        strategicBoundary: "",
        coreAssets: "",
        outputFormatPreferences: "",
        notes: "",
        updatedAt: "",
      };
    }),

    /** 保存/更新指挥官档案 */
    saveCommanderProfile: protectedProcedure
      .input(z.object({
        strategicBoundary: z.string().max(4000).optional(),
        coreAssets: z.string().max(4000).optional(),
        outputFormatPreferences: z.string().max(2000).optional(),
        notes: z.string().max(2000).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { writeCommanderProfile } = await import("./services/commanderProfileStore");
        const next = await writeCommanderProfile(String(ctx.user.id), input);
        return next;
      }),

    /** 平台趋势数据预览（让用户在派发前能看到将注入什么爆款数据） */
    previewPlatformBriefing: protectedProcedure
      .input(z.object({
        platforms: z.array(z.enum(["douyin", "xiaohongshu", "bilibili", "kuaishou", "weixin_channels", "toutiao"])).optional(),
        topN: z.number().int().min(3).max(20).optional(),
      }))
      .query(async ({ input }) => {
        const { loadFreshPlatformBriefing } = await import("./services/commanderPromptBuilder");
        return loadFreshPlatformBriefing({
          platforms: input.platforms as any,
          topN: input.topN,
          preferFlyLive: true,
        });
      }),

    /** 4 平台实时热点（结构化逐条），供前端 widget 显示「一键深潜」按钮 */
    listTrendHotspots: protectedProcedure
      .input(z.object({
        platforms: z.array(z.enum(["douyin", "xiaohongshu", "bilibili", "kuaishou", "weixin_channels", "toutiao"])).optional(),
        topN: z.number().int().min(3).max(15).optional(),
      }).optional())
      .query(async ({ input }) => {
        const { listFreshTrendItems } = await import("./services/commanderPromptBuilder");
        return listFreshTrendItems({
          platforms: input?.platforms as any,
          topN: input?.topN,
          preferFlyLive: true,
        });
      }),

    /** 多平台 IP 矩阵 · 跨界爆款脚本 */
    launchPlatformIpMatrix: protectedProcedure
      .input(z.object({
        topicDirection: z.string().min(2).max(2000),
        accounts: z.array(z.object({
          platform: z.string().min(1).max(40),
          handle: z.string().min(1).max(120),
          notes: z.string().max(200).optional(),
        })).max(20).default([]),
        supplementaryText: z.string().max(8000).optional(),
        outputFormatOverride: z.string().max(2000).optional(),
        supplementaryFiles: z.array(z.object({
          name: z.string(),
          type: z.enum(["image", "pdf"]),
          mimeType: z.string(),
          url: z.string().url(),
          gcsUri: z.string(),
        })).max(5).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── 维护模式拦截：开启时拒绝新付费任务（已经在跑的不受影响） ──────
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("多平台 IP 矩阵");

        const userId = ctx.user.id;
        const { calcAgentScenarioPrice } = await import("./services/billingService");
        const { price: cost, label: billingLabel } = calcAgentScenarioPrice("platform_ip_matrix");

        let deductResult: Awaited<ReturnType<typeof deductCreditsAmount>>;
        try {
          deductResult = await deductCreditsAmount(userId, cost, "deepResearch", `${billingLabel}（${cost}点）`);
        } catch (e: any) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: e?.message || "积分扣除失败" });
        }
        if (!deductResult.success) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: `积分不足，需要 ${cost} 点，请充值` });
        }

        const billed = deductResult.source === "admin" ? 0 : cost;
        try {
          const { launchPlatformIpMatrix } = await import("./services/agentScenarios");
          return await launchPlatformIpMatrix({
            userId: String(ctx.user.id),
            text: input.topicDirection,
            topicDirection: input.topicDirection,
            accounts: input.accounts,
            supplementaryText: input.supplementaryText,
            outputFormatOverride: input.outputFormatOverride,
            supplementaryFiles: input.supplementaryFiles,
            creditsUsed: billed,
          });
        } catch (e: any) {
          if (billed > 0) {
            try {
              await refundCredits(userId, billed, `多平台IP矩阵·启动失败·退回`);
            } catch {}
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e?.message || "任务启动失败，已退回积分" });
        }
      }),

    /** 竞品/赛道雷达 */
    launchCompetitorRadar: protectedProcedure
      .input(z.object({
        benchmarks: z.array(z.object({
          platform: z.string().min(1).max(40),
          handle: z.string().min(1).max(120),
          notes: z.string().max(200).optional(),
        })).max(20).default([]),
        focusDimensions: z.array(z.string().max(40)).max(12).default([]),
        painPoint: z.string().max(2000).optional(),
        outputFormatOverride: z.string().max(2000).optional(),
        supplementaryText: z.string().max(8000).optional(),
        supplementaryFiles: z.array(z.object({
          name: z.string(),
          type: z.enum(["image", "pdf"]),
          mimeType: z.string(),
          url: z.string().url(),
          gcsUri: z.string(),
        })).max(5).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── 维护模式拦截：开启时拒绝新付费任务（已经在跑的不受影响） ──────
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("竞品/赛道雷达");

        const userId = ctx.user.id;
        const { calcAgentScenarioPrice } = await import("./services/billingService");
        const { price: cost, label: billingLabel } = calcAgentScenarioPrice("competitor_radar");

        let deductResult: Awaited<ReturnType<typeof deductCreditsAmount>>;
        try {
          deductResult = await deductCreditsAmount(userId, cost, "deepResearch", `${billingLabel}（${cost}点）`);
        } catch (e: any) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: e?.message || "积分扣除失败" });
        }
        if (!deductResult.success) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: `积分不足，需要 ${cost} 点，请充值` });
        }

        const billed = deductResult.source === "admin" ? 0 : cost;
        try {
          const { launchCompetitorRadar } = await import("./services/agentScenarios");
          return await launchCompetitorRadar({
            userId: String(ctx.user.id),
            text: input.supplementaryText || "",
            benchmarks: input.benchmarks,
            focusDimensions: input.focusDimensions,
            painPoint: input.painPoint,
            outputFormatOverride: input.outputFormatOverride,
            supplementaryText: input.supplementaryText,
            supplementaryFiles: input.supplementaryFiles,
            creditsUsed: billed,
          });
        } catch (e: any) {
          if (billed > 0) {
            try {
              await refundCredits(userId, billed, `竞品赛道雷达·启动失败·退回`);
            } catch {}
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e?.message || "任务启动失败，已退回积分" });
        }
      }),

    /** VIP · 列出当前运营者所有 VIP 档案 */
    listVipProfiles: protectedProcedure.query(async ({ ctx }) => {
      const { listVipProfiles } = await import("./services/agentScenarios");
      return { profiles: await listVipProfiles(String(ctx.user.id)) };
    }),

    /** VIP · 读取单个档案详情（含历次更新） */
    getVipProfile: protectedProcedure
      .input(z.object({ vipId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const { getVipProfile } = await import("./services/agentScenarios");
        const profile = await getVipProfile(String(ctx.user.id), input.vipId);
        if (!profile) throw new TRPCError({ code: "NOT_FOUND", message: "VIP 档案不存在" });
        return profile;
      }),

    /** VIP · 建档（首次基线评估，会走完整 plan→approve→execute 流程） */
    launchVipBaseline: protectedProcedure
      .input(z.object({
        vipName: z.string().min(1).max(80),
        baselineSummary: z.string().min(20).max(8000),
        supplementaryText: z.string().max(8000).optional(),
        supplementaryFiles: z.array(z.object({
          name: z.string(),
          type: z.enum(["image", "pdf"]),
          mimeType: z.string(),
          url: z.string().url(),
          gcsUri: z.string(),
        })).max(5).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── 维护模式拦截：开启时拒绝新付费任务（已经在跑的不受影响） ──────
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("VIP 客户建档");

        const { launchVipBaseline } = await import("./services/agentScenarios");
        return launchVipBaseline({
          userId: String(ctx.user.id),
          text: input.baselineSummary,
          vipName: input.vipName,
          baselineSummary: input.baselineSummary,
          supplementaryText: input.supplementaryText,
          supplementaryFiles: input.supplementaryFiles,
        });
      }),

    /** VIP · 月度更新（用 previous_interaction_id 续接 baseline，跳过 plan 阶段） */
    launchVipMonthlyUpdate: protectedProcedure
      .input(z.object({
        vipId: z.string().min(1),
        monthlyData: z.string().min(20).max(8000),
        supplementaryText: z.string().max(8000).optional(),
        supplementaryFiles: z.array(z.object({
          name: z.string(),
          type: z.enum(["image", "pdf"]),
          mimeType: z.string(),
          url: z.string().url(),
          gcsUri: z.string(),
        })).max(5).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── 维护模式拦截：开启时拒绝新付费任务（已经在跑的不受影响） ──────
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("VIP 月度更新");

        const { launchVipMonthlyUpdate } = await import("./services/agentScenarios");
        return launchVipMonthlyUpdate({
          userId: String(ctx.user.id),
          text: input.monthlyData,
          vipId: input.vipId,
          monthlyData: input.monthlyData,
          supplementaryText: input.supplementaryText,
          supplementaryFiles: input.supplementaryFiles,
        });
      }),

    /** 列出某场景的所有任务（产品列表 / 历史报告） */
    listScenarioJobs: protectedProcedure
      .input(z.object({
        productType: z.enum(["platform_ip_matrix", "competitor_radar", "vip_baseline", "vip_monthly"]),
      }))
      .query(async ({ input, ctx }) => {
        const { listAgentJobs } = await import("./services/agentScenarios");
        const items = await listAgentJobs(String(ctx.user.id), input.productType);
        return { items };
      }),

    /** 读取单个 job 详情（用于场景内的状态轮询） */
    getJob: protectedProcedure
      .input(z.object({ jobId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const { getJob } = await import("./services/agentScenarios");
        const job = await getJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (job.userId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        return {
          jobId: job.jobId,
          status: job.status,
          progress: job.progress || "",
          reportMarkdown: job.reportMarkdown || null,
          planText: job.planText || null,
          planInteractionId: job.planInteractionId || null,
          interactionId: job.interactionId || null,
          error: job.error || null,
          errorDetail: job.errorDetail || null,
          createdAt: job.createdAt,
          completedAt: job.completedAt || null,
          productType: job.productType || null,
          topic: job.topic,
          // ── Debug 信息（供 supervisor / 高阶用户排查）──
          lastHeartbeatAt: job.lastHeartbeatAt || null,
          pid: typeof job.pid === "number" ? job.pid : null,
          attemptCount: typeof job.attemptCount === "number" ? job.attemptCount : null,
          dbRecordId: typeof job.dbRecordId === "number" ? job.dbRecordId : null,
          creditsUsed: typeof job.creditsUsed === "number" ? job.creditsUsed : null,
          // 上传文件透传（让前端能确认到底有没有把文件传到后端）
          supplementaryFiles: Array.isArray(job.supplementaryFiles)
            ? job.supplementaryFiles.map((f) => ({ name: f.name, type: f.type, mimeType: f.mimeType }))
            : [],
        };
      }),
  }),

  /** AI 上帝视角：全息行业研报 — 脱机异步重算力推演 */
  deepResearch: router({
    launch: protectedProcedure
      .input(z.object({
        topic: z.string().min(5).max(1000),
        isFirstTime: z.boolean().optional(),
        productType: z.enum(["magazine_single", "magazine_sub", "personalized", "enterprise_flagship"]).optional(),
        isBundlePromo: z.boolean().optional(),
        // 半月刊补充资料（注入阶段 A Deep Research prompt）
        // 文件已上传到 GCS，这里传 URL 而非 base64
        supplementaryText: z.string().max(8000).optional(),
        supplementaryFiles: z.array(z.object({
          name: z.string().max(200),
          type: z.enum(["image", "pdf"]),
          mimeType: z.string().max(100),
          url: z.string().url().max(1000),    // 公开 HTTPS URL
          gcsUri: z.string().max(500),         // gs://bucket/path
        })).max(5).optional(),
        // 企业专属 IP 基因（B 端拦截弹窗，前端 localStorage["ipProfile.v1"]）
        // 注入到合成阶段 prompt 的 [全局战略预设] 段，让推演锁定高客单转化路径。
        ipProfile: z.object({
          industry: z.string().max(200),
          advantage: z.string().max(400),
          audience: z.string().max(200),
          taboos: z.string().max(400).optional(),
          flagship: z.string().max(400),
        }).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── 维护模式拦截：开启时拒绝新付费任务（已经在跑的不受影响） ──────
        // 严令：本拦截仅用 maintenanceMode.flag 判定，绝不触碰积分账本 / 支付网关。
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("上帝视角研报");

        const userId = ctx.user.id;
        const { calcGodViewPrice } = await import("./services/billingService");
        const productType = input.productType ?? "magazine_single";
        const { price: cost } = calcGodViewPrice(productType, !!input.isFirstTime, !!input.isBundlePromo);

        // 1. 扣费
        let deductResult: Awaited<ReturnType<typeof deductCreditsAmount>>;
        try {
          const { label: billingLabel } = calcGodViewPrice(productType, !!input.isFirstTime, !!input.isBundlePromo);
          deductResult = await deductCreditsAmount(userId, cost, "deepResearch", `${billingLabel}（${cost}点）`);
        } catch (e: any) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: e?.message || "积分扣除失败" });
        }
        if (!deductResult.success) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: `积分不足，需要 ${cost} 点，请充值` });
        }

        // 2. 创建任务（同步写入 Fly 磁盘 + Neon DB，立即返回 jobId）
        let jobId: string;
        let dbRecordId: number | undefined;
        try {
          const { createDeepResearchJob, runDeepResearchAsync } = await import("./services/deepResearchService");
          const result = await createDeepResearchJob(
            String(userId), input.topic, deductResult.source === "admin" ? 0 : cost, productType,
            {
              supplementaryText: input.supplementaryText,
              supplementaryFiles: input.supplementaryFiles,
              ipProfile: input.ipProfile,
              strategicImagesTrialWatermark: !!input.isFirstTime,
            },
          );
          jobId = result.jobId;
          dbRecordId = result.dbRecordId;
          // fire-and-forget：异步执行，不阻塞响应
          runDeepResearchAsync(jobId).catch(async (err) => {
          console.error("[deepResearch] 异步任务异常，尝试退还积分:", err?.message);
            try { await refundCredits(userId, cost, `上帝视角研报·异步失败·退回`); } catch {}
          });
        } catch (e: any) {
          try { await refundCredits(userId, cost, `上帝视角研报·启动失败·退回`); } catch {}
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e?.message || "任务启动失败，已退回积分" });
        }

        return { ok: true as const, jobId, dbRecordId: dbRecordId ?? null, creditsUsed: deductResult.source === "admin" ? 0 : cost };
      }),

    /**
     * 用户主动取消任务。立即向 worker 发送 cancel 信号 + 在 paidJobLedger
     * 标 cancelRequestedAt。worker 在下一次 polling 时检测到 → 抛
     * USER_CANCELLED → 走 failJobAndRefund。
     *
     * ⚠️ 商业护栏（防恶意刷算力）：用户主动取消的任务**按规则不退还积分**。
     *    系统故障 / 部署中断 / 外部 API 错误 / 进程崩溃等路径仍会幂等退积分。
     *    文案统一用「不退还积分」，绝不出现「退款」「退现金」字样。
     */
    cancelJob: protectedProcedure
      .input(z.object({ jobId: z.string().min(1) }))
      .mutation(async ({ input, ctx }) => {
        const { readJob, requestCancelDeepResearchJob } = await import("./services/deepResearchService");
        const job = await readJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (job.userId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        if (job.status === "completed") {
          throw new TRPCError({ code: "BAD_REQUEST", message: "任务已完成，无法取消" });
        }
        if (job.status === "failed") {
          return { ok: true as const, alreadyCancelled: true, status: job.status, message: "任务此前已失败" };
        }
        // 用户主动取消 → 默认 user_cancelled_no_refund（不退还积分）
        const result = await requestCancelDeepResearchJob(input.jobId, "user");
        const noRefund = result.refundReason === "user_cancelled_no_refund";
        return {
          ok: result.ok,
          alreadyCancelled: result.alreadyCancelled,
          status: result.status,
          refundReason: result.refundReason,
          message: result.alreadyCancelled
            ? noRefund
              ? "已记录取消请求，正在停止深潛引擎（按规则不退还积分）…"
              : "已记录取消请求，正在等待 worker 停止深潛引擎并退还积分…"
            : noRefund
              ? "已发起取消，正在停止深潛引擎（按规则不退还积分，防止算力恶意消耗）"
              : "已发起取消，正在停止深潛引擎，积分将退还至您的账户…",
        };
      }),

    status: protectedProcedure
      .input(z.object({ jobId: z.string().min(1) }))
      .query(async ({ input, ctx }) => {
        const { readJob } = await import("./services/deepResearchService");
        const job = await readJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (job.userId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        return {
          jobId: job.jobId,
          status: job.status,
          progress: job.progress || "",
          reportMarkdown: job.reportMarkdown || null,
          error: job.error || null,
          errorDetail: (job as any).errorDetail || null,
          createdAt: job.createdAt,
          completedAt: job.completedAt || null,
          planText: job.planText || null,
          planInteractionId: job.planInteractionId || null,
          interactionId: job.interactionId || null,
          creditsUsed: typeof job.creditsUsed === "number" ? job.creditsUsed : null,
          /** 首购尝鲜：与 deepResearch 内嵌配图 / 封面一致的试读水印策略 */
          strategicImagesTrialWatermark: !!(job as { strategicImagesTrialWatermark?: boolean }).strategicImagesTrialWatermark,
          // 真信号：心跳 / 更新时间，让前端展示真实推演进度
          updatedAt: (job as any).updatedAt || (job as any).lastHeartbeatAt || null,
          lastHeartbeatAt: (job as any).lastHeartbeatAt || null,
        };
      }),

    /**
     * 列出当前用户所有「正在跑」的深潜任务（用于跨页面持久化）。
     *
     * 用户跑深潜时跳到 MyReports 或别的页面再回来，GodView 应该自动检测
     * 还没完成的任务并恢复进度条 / 取消按钮 / debug terminal，避免每次都
     * 让用户重新点「启动」（双扣积分）。
     *
     * 数据来源：paidJobLedger 持久化记录 + readJob 取详细 status。
     * - 只返 deepResearch taskType 的 active hold
     * - 二次过滤掉已经 completed/failed 的（hold 文件可能滞后）
     */
    activeJobs: protectedProcedure.query(async ({ ctx }) => {
      try {
        const { listAllActiveJobs } = await import("./services/paidJobLedger");
        const { readJob } = await import("./services/deepResearchService");
        const all = await listAllActiveJobs();
        const userIdStr = String(ctx.user.id);
        const mine = all.filter(
          (h) => h.taskType === "deepResearch" && String(h.userId) === userIdStr,
        );

        const PROGRESS_STATES = new Set([
          "pending",
          "planning",
          "awaiting_plan_approval",
          "running",
          "awaiting_review",
        ]);

        const results: Array<{
          jobId: string;
          status: string;
          progress: string;
          topic: string;
          launchedAt: string;
          productType: string | null;
        }> = [];

        for (const hold of mine) {
          const job = await readJob(hold.jobId);
          if (!job) continue;
          if (!PROGRESS_STATES.has(job.status)) continue;
          results.push({
            jobId: job.jobId,
            status: job.status,
            progress: job.progress || "",
            topic: job.topic || "",
            launchedAt: job.createdAt,
            productType: job.productType ?? null,
          });
        }

        // 最新的排前面
        results.sort((a, b) => (a.launchedAt < b.launchedAt ? 1 : -1));
        return { jobs: results };
      } catch (e: any) {
        console.warn("[deepResearch.activeJobs] 查询失败:", e?.message);
        return { jobs: [] };
      }
    }),

    /**
     * 用户审核计划后批准启动深潛执行（Interactions API 第二阶段）
     * - 写入 planFeedback、状态改回 running
     * - 触发 runDeepResearchAsync 接力跑剩余阶段
     */
    approvePlan: protectedProcedure
      .input(z.object({
        jobId: z.string().min(1),
        feedback: z.string().max(2000).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        const { readJob, approvePlan } = await import("./services/deepResearchService");
        const job = await readJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "任务不存在" });
        if (job.userId !== String(ctx.user.id)) throw new TRPCError({ code: "FORBIDDEN" });
        if (job.status !== "awaiting_plan_approval") {
          throw new TRPCError({ code: "BAD_REQUEST", message: `任务当前状态 ${job.status}，无法批准计划` });
        }
        await approvePlan(input.jobId, input.feedback);
        return { ok: true, jobId: input.jobId };
      }),

    /**
     * @deprecated 已移除 — 战略 PDF 切到 PlatformPage 模式（前端 DOM 快照）。
     *
     * 历史背景：旧实现服务端用 `pdfTemplate.generateHtmlTemplate` + ECharts SSR 拼 HTML，
     * 再交给 Cloud Run pdf-worker 跑 puppeteer。对长报告（4–15k 字 → 8–25 MB HTML）
     * networkidle0 阶段经常超时 → PDF 截断或失败，用户多次反馈不稳定。
     *
     * 新路径：客户端在 MyReportsPage 全屏阅读模式 React 渲染完成后，
     * `document.documentElement.cloneNode(true)` 抓 DOM → 走 `mvAnalysis.downloadPlatformPdf`，
     * 与 PlatformPage 共享同一条稳定链路。
     *
     * 此 stub 仅为兼容旧 client 调用，立刻抛 GONE 让上游切到新流程。
     */
    exportBlackGoldPdf: protectedProcedure
      .input(z.object({
        jobId: z.string().min(1).optional(),
        reportId: z.number().int().positive().optional(),
        markdown: z.string().min(80).optional(),
        style: z.enum(["spring-mint", "neon-tech", "sunset-coral", "ocean-fresh", "business-bright"]).optional(),
      }))
      .mutation(async () => {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "服务端 PDF 路径已下线。请进入「战略作品快照库」点击「全息阅览」，再用阅览页里的「下载 PDF」按钮（前端渲染快照模式）。",
        });
      }),

    /** 查询当前用户所有战报（研报中心） */
    /** 主编后台：查看所有用户的研报（仅 supervisor/admin 可访问） */
    supervisorListAll: adminProcedure.query(async () => {
      try {
        const { userCreations } = await import("../drizzle/schema-creations");
        const { desc } = await import("drizzle-orm");
        const database = await db.getDb();
        if (!database) return { reports: [] };
        const rows = await database
          .select()
          .from(userCreations)
          .where((await import("drizzle-orm")).eq(userCreations.type, "deep_research_report"))
          .orderBy(desc(userCreations.createdAt))
          .limit(200);
        return {
          reports: rows.map((r) => {
            let meta: any = {};
            try { meta = JSON.parse(r.metadata || "{}"); } catch {}
            return {
              id: r.id,
              userId: r.userId,
              title: r.title || meta.lighthouseTitle || meta.topic || "无标题",
              lighthouseTitle: meta.lighthouseTitle || r.title || meta.topic || "",
              topic: meta.topic || r.title || "",
              status: r.status,
              progress: meta.progress || "",
              reportMarkdown: meta.reportMarkdown || null,
              draftMarkdown: meta.draftMarkdown || null,
              jobId: meta.jobId || null,
              creditsUsed: r.creditsUsed ?? 0,
              createdAt: r.createdAt.toISOString(),
              coverUrl: r.thumbnailUrl || null,
              summary: meta.summary || null,
              duration: meta.duration || null,
              storyboardSheetExport:
                meta.storyboardSheetExport && typeof meta.storyboardSheetExport === "object"
                  ? meta.storyboardSheetExport
                  : null,
            };
          }),
        };
      } catch (e: any) {
        console.error("[deepResearch.supervisorListAll] 查询失败:", e?.message);
        return { reports: [] };
      }
    }),

    /** Supervisor：查看任意 jobId 的完整 job 文件（含进度日志/错误/心跳） */
    supervisorJobStatus: adminProcedure
      .input(z.object({ jobId: z.string().min(1) }))
      .query(async ({ input }) => {
        const { readJob } = await import("./services/deepResearchService");
        const job = await readJob(input.jobId);
        if (!job) throw new TRPCError({ code: "NOT_FOUND", message: `Job ${input.jobId} 不存在（文件可能已清理）` });
        return {
          jobId: job.jobId,
          userId: job.userId,
          status: job.status,
          progress: job.progress || "",
          error: job.error || null,
          errorDetail: (job as any).errorDetail || null,
          createdAt: job.createdAt,
          completedAt: job.completedAt || null,
          lastHeartbeatAt: (job as any).lastHeartbeatAt || null,
          pid: (job as any).pid || null,
          attemptCount: (job as any).attemptCount ?? 0,
          creditsUsed: (job as any).creditsUsed ?? 0,
          topic: job.topic || "",
          hasMarkdown: !!job.reportMarkdown,
          markdownLen: job.reportMarkdown?.length ?? 0,
          dbRecordId: job.dbRecordId || null,
        };
      }),

    /**
     * 半月刊提醒：检查当前用户是否距上次生成 >= 10 天。
     * 到期则自动生成 3-5 个选题建议。
     */
    magazineReminder: protectedProcedure.query(async ({ ctx }) => {
      const { getMagazineSchedule, daysUntilReminder, generateTopicSuggestions, sendReminderEmailIfNeeded } =
        await import("./services/magazineScheduler");
      const userId = String(ctx.user.id);
      const schedule = await getMagazineSchedule(userId);
      if (!schedule) {
        // 从未生成过，立即提醒
        const topics = await generateTopicSuggestions();
        // 异步发邮件，不阻塞响应
        sendReminderEmailIfNeeded(userId, topics, undefined).catch(() => {});
        return { reminderDue: true, daysOverdue: null, topics, lastTopic: null };
      }
      const remaining = daysUntilReminder(schedule.lastGeneratedAt);
      if (remaining > 0) {
        return { reminderDue: false, daysRemaining: Math.ceil(remaining), topics: [], lastTopic: schedule.lastTopic ?? null };
      }
      const daysOverdue = Math.floor(-remaining);
      const topics = await generateTopicSuggestions(schedule.lastTopic);
      // 异步发邮件（每轮只发一次）
      sendReminderEmailIfNeeded(userId, topics, schedule.lastTopic).catch(() => {});
      return { reminderDue: true, daysOverdue, topics, lastTopic: schedule.lastTopic ?? null };
    }),

    /** 忽略本次提醒（将 lastGeneratedAt 重置为现在，推迟 10 天） */
    dismissReminder: protectedProcedure.mutation(async ({ ctx }) => {
      const { recordMagazineGenerated, getMagazineSchedule } =
        await import("./services/magazineScheduler");
      const userId = String(ctx.user.id);
      const schedule = await getMagazineSchedule(userId);
      await recordMagazineGenerated(userId, schedule?.lastTopic ?? "");
      return { ok: true };
    }),

    /** 主编奖励：采纳情报并发放 300 点 */
    supervisorReward: adminProcedure
      .input(z.object({ userId: z.number(), reportId: z.number(), credits: z.number().default(300) }))
      .mutation(async ({ input }) => {
        try {
          await addCredits(input.userId, input.credits, "bonus", `主编采纳情报奖励（研报 #${input.reportId}）`);
          return { success: true, message: `已发放 ${input.credits} 点奖励` };
        } catch (e: any) {
          throw new Error(`奖励发放失败: ${e?.message}`);
        }
      }),

    myReports: protectedProcedure.query(async ({ ctx }) => {
      try {
        const { userCreations } = await import("../drizzle/schema-creations");
        const { eq, and, desc, ne } = await import("drizzle-orm");
        const database = await db.getDb();
        if (!database) return { reports: [] };

        // 历史 awaiting_review 一进作品库即视为已出刊（与 saveDraft / 主流程一致）
        try {
          await database
            .update(userCreations)
            .set({ status: "completed", updatedAt: new Date() })
            .where(and(
              eq(userCreations.userId, ctx.user.id),
              eq(userCreations.type, "deep_research_report"),
              eq(userCreations.status, "awaiting_review"),
            ));
        } catch {
          /* non-fatal */
        }

        // 软删除（status="deleted"）的作品不出现在「我的作品库」列表里。
        // 物理记录保留以便客服恢复 / 事故稽核。
        const rows = await database
          .select()
          .from(userCreations)
          .where(and(
            eq(userCreations.userId, ctx.user.id),
            eq(userCreations.type, "deep_research_report"),
            ne(userCreations.status, "deleted"),
          ))
          .orderBy(desc(userCreations.createdAt))
          .limit(50);

        return {
          reports: rows.map((r) => {
            let meta: any = {};
            try { meta = JSON.parse(r.metadata || "{}"); } catch {}
            return {
              id: r.id,
              title: r.title || meta.lighthouseTitle || meta.topic || "无标题",
              lighthouseTitle: meta.lighthouseTitle || r.title || meta.topic || "",
              topic: meta.topic || r.title || "",
              // 状态：processing / awaiting_review / completed / failed
              status: r.status,
              progress: meta.progress || "",
              reportMarkdown: meta.reportMarkdown || null,
              draftMarkdown: meta.draftMarkdown || null,
              draftReadyAt: meta.draftReadyAt || null,
              publishedAt: meta.publishedAt || null,
              error: meta.error || null,
              jobId: meta.jobId || null,
              productType: meta.productType || null,
              creditsUsed: r.creditsUsed ?? 0,
              createdAt: r.createdAt.toISOString(),
              coverUrl: r.thumbnailUrl || null,
              summary: meta.summary || null,
              duration: meta.duration || null,
              /** Cam7：HTML 匯出用分鏡同步 payload（與 metadata.storyboardSheetExport 同源） */
              storyboardSheetExport:
                meta.storyboardSheetExport && typeof meta.storyboardSheetExport === "object"
                  ? meta.storyboardSheetExport
                  : null,
            };
          }),
        };
      } catch (e: any) {
        console.error("[deepResearch.myReports] 查询失败:", e?.message);
        return { reports: [] };
      }
    }),

    /** 保存修订：产品与主流程一致，直接已出刊（不再写入 awaiting_review） */
    saveDraft: protectedProcedure
      .input(z.object({
        recordId: z.number().int().positive(),
        markdown: z.string().min(50).max(200_000),
      }))
      .mutation(async ({ input, ctx }) => {
        const { userCreations } = await import("../drizzle/schema-creations");
        const { eq, and } = await import("drizzle-orm");
        const database = await db.getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库未就绪" });

        const rows = await database
          .select()
          .from(userCreations)
          .where(and(eq(userCreations.id, input.recordId), eq(userCreations.userId, ctx.user.id)))
          .limit(1);
        const row = rows[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "战报不存在或无权限" });

        let meta: any = {};
        try { meta = JSON.parse(row.metadata || "{}"); } catch {}
        meta.draftMarkdown = input.markdown;
        meta.reportMarkdown = input.markdown;
        meta.draftEditedAt = new Date().toISOString();
        if (!meta.progress || String(meta.progress).includes("待") || String(meta.progress).includes("审核")) {
          meta.progress = "✅ 战略研报已生成，请进入「战略作品快照库」查阅";
        }

        await database.update(userCreations).set({
          status: "completed",
          metadata: JSON.stringify(meta),
          updatedAt: new Date(),
        }).where(eq(userCreations.id, input.recordId));

        return { ok: true as const, savedAt: meta.draftEditedAt };
      }),

    /** 主编审核：正式出刊（草稿 → 正式版，状态改 completed） */
    publishDraft: protectedProcedure
      .input(z.object({
        recordId: z.number().int().positive(),
        markdown: z.string().min(50).max(200_000),
      }))
      .mutation(async ({ input, ctx }) => {
        const { userCreations } = await import("../drizzle/schema-creations");
        const { eq, and } = await import("drizzle-orm");
        const database = await db.getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库未就绪" });

        const rows = await database
          .select()
          .from(userCreations)
          .where(and(eq(userCreations.id, input.recordId), eq(userCreations.userId, ctx.user.id)))
          .limit(1);
        const row = rows[0];
        if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "战报不存在或无权限" });

        let meta: any = {};
        try { meta = JSON.parse(row.metadata || "{}"); } catch {}
        meta.reportMarkdown = input.markdown;        // 正式版
        meta.draftMarkdown = input.markdown;          // 草稿同步覆盖（保留可重新编辑能力）
        meta.publishedAt = new Date().toISOString();
        meta.progress = "✅ 战报已正式出刊，可下载富图文 PDF";

        await database.update(userCreations).set({
          status: "completed",
          metadata: JSON.stringify(meta),
          updatedAt: new Date(),
        }).where(eq(userCreations.id, input.recordId));

        return { ok: true as const, publishedAt: meta.publishedAt };
      }),

    /** AI 助手：对选中段落做重写 / 扩写 / 缩写 / 补一张表 */
    aiAssist: protectedProcedure
      .input(z.object({
        recordId: z.number().int().positive(),
        action: z.enum(["rewrite", "expand", "shrink", "addTable", "freeform"]),
        blockText: z.string().min(1).max(20_000),
        instruction: z.string().max(2000).optional(),
      }))
      .mutation(async ({ input, ctx }) => {
        // 鉴权：必须是当前用户的报告
        const { userCreations } = await import("../drizzle/schema-creations");
        const { eq, and } = await import("drizzle-orm");
        const database = await db.getDb();
        if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "数据库未就绪" });

        const rows = await database
          .select()
          .from(userCreations)
          .where(and(eq(userCreations.id, input.recordId), eq(userCreations.userId, ctx.user.id)))
          .limit(1);
        if (!rows[0]) throw new TRPCError({ code: "NOT_FOUND", message: "战报不存在或无权限" });

        // ── 维护模式拦截 ─────────────────────────────────────────────────
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("主编工作台 AI 助手");

        // 微扣 5 点（AI 助手按次计费）
        const COST = 5;
        let aiAssistDeduct: Awaited<ReturnType<typeof deductCreditsAmount>> | null = null;
        try {
          aiAssistDeduct = await deductCreditsAmount(ctx.user.id, COST, "aiAssistEditor", `主编工作台AI助手·${input.action}`);
          if (!aiAssistDeduct.success) throw new Error(`积分不足，需要 ${COST} 点`);
        } catch (e: any) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: e?.message || "积分不足" });
        }

        // ── 注册 ledger（失败/超时/进程崩溃自动幂等退积分） ─────────────────
        const { registerActiveJob, refundCreditsOnFailure, unregisterActiveJob } = await import("./services/paidJobLedger");
        const aiAssistJobId = `aae_${Date.now()}_${nanoid(6)}`;
        await registerActiveJob({
          jobId: aiAssistJobId,
          taskType: "aiAssistEditor",
          userId: ctx.user.id,
          creditsBilled: aiAssistDeduct.source === "admin" ? 0 : COST,
          action: `主编工作台AI助手·${input.action}`,
          externalApiCostHint: "Vertex gemini-3.1-pro-preview (global)",
          metadata: { recordId: input.recordId, action: input.action },
        }).catch(() => {});

        const ACTION_PROMPT: Record<string, string> = {
          rewrite: "请用同等字数重写以下段落，保持核心观点不变，但语言更精炼有力，避免任何英文专业名词（必须翻译成简体中文）。直接输出重写后的 markdown，不要任何前后说明。",
          expand: "请在保留原有观点的基础上，扩写以下段落到原长度的 1.6 倍，补充更具体的数据、案例和操作建议。直接输出扩写后的 markdown，不要任何前后说明。",
          shrink: "请把以下段落浓缩到原长度的 60%，保留核心数据与结论，删除冗余表达。直接输出浓缩后的 markdown，不要任何前后说明。",
          addTable: "请基于以下段落的主题，在段落末尾追加一张包含 4-6 行真实数据的 markdown 表格（必须有数据来源列）。直接输出原段落 + 新增表格的完整 markdown，不要任何前后说明。",
          freeform: "请根据以下「主编指令」修改给定段落。如果指令有歧义，按最合理的中文商务白皮书风格处理。直接输出修改后的 markdown，不要任何前后说明。",
        };

        const finalPrompt = `${ACTION_PROMPT[input.action]}

${input.instruction ? `【主编指令】\n${input.instruction}\n` : ""}
【原段落】
${input.blockText}`;

        // 调用 Gemini 3.1 Pro Preview · Vertex global（与平台编导同一管線，无需 GEMINI_API_KEY）
        try {
          const { callGemini3_1_Pro } = await import("./services/vertexGemini31ProGlobal.js");
          const text = (await callGemini3_1_Pro(finalPrompt, { maxOutputTokens: 8192, temperature: 0.9 })).trim();
          if (!text) {
            await refundCreditsOnFailure(aiAssistJobId, "aiAssistEditor", "external_api_error", "empty response").catch(() => {});
            throw new Error("AI 未返回内容");
          }
          // 任务成功 → 标 ledger settled
          await unregisterActiveJob(aiAssistJobId, "aiAssistEditor", "settled").catch(() => {});
          return { ok: true as const, suggestion: text, creditsCost: COST };
        } catch (e: any) {
          // 兜底：捕到未知错误也走 ledger 退分（幂等，已退过的 no-op）
          await refundCreditsOnFailure(aiAssistJobId, "aiAssistEditor", "task_failed", String(e?.message ?? "").slice(0, 200)).catch(() => {});
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: e?.message || "AI 助手调用失败" });
        }
      }),
  }),

  /** 竞品分析调研 — 双阶段 LLM + Fly 存储 + GitHub 备份 */
  competitorResearch: router({
    run: protectedProcedure
      .input(z.object({
        platform: z.enum(["douyin", "kuaishou", "xiaohongshu", "bilibili"]),
        competitorData: z.string().min(1).max(8000),
      }))
      .mutation(async ({ input, ctx }) => {
        // ── 维护模式拦截 ───────────────────────────────────────────────────
        const { assertMaintenanceOff } = await import("./services/maintenanceMode");
        await assertMaintenanceOff("竞品调研");

        const userId = ctx.user.id;
        const COST = 60;
        const PLATFORM_LABEL: Record<string, string> = {
          douyin: "抖音", kuaishou: "快手", xiaohongshu: "小红书", bilibili: "B站"
        };
        const label = PLATFORM_LABEL[input.platform] || input.platform;

        // 1. 扣费
        let deductResult: Awaited<ReturnType<typeof deductCreditsAmount>>;
        try {
          deductResult = await deductCreditsAmount(userId, COST, "competitorResearch", `${label}竞品调研（60点）`);
        } catch (e: any) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: e?.message || "积分扣除失败" });
        }
        if (!deductResult.success) {
          throw new TRPCError({ code: "PAYMENT_REQUIRED", message: `积分不足，需要 ${COST} 点，请充值` });
        }

        // 2. 包装到 paidJobLedger：失败 / cancel / 进程崩溃自动幂等退积分
        const { withLedgerRefundOnFailure } = await import("./services/paidJobLedger");
        const ledgerJobId = `cr_${Date.now()}_${nanoid(6)}`;
        let strategy: any = null;
        let pipelineDebug: import("../shared/researchPipelineDebugMarker.js").ResearchPipelineDebugStep[] = [];
        try {
          const packed = await withLedgerRefundOnFailure(
            {
              jobId: ledgerJobId,
              taskType: "competitorResearch",
              userId,
              creditsBilled: deductResult.source === "admin" ? 0 : COST,
              action: `${label}竞品调研（${COST}点）`,
              externalApiCostHint: "AI Studio 双引擎调用",
              metadata: { platform: input.platform },
            },
            async () => {
              const { runResearch } = await import("./services/researchService.js");
              return await runResearch(String(userId), String(input.platform), input.competitorData);
            },
          );
          strategy = packed.strategy;
          pipelineDebug = packed.pipelineDebug;
        } catch (e: any) {
          const dbg = (
            e as Error & {
              researchPipelineDebug?: import("../shared/researchPipelineDebugMarker.js").ResearchPipelineDebugStep[];
            }
          ).researchPipelineDebug;
          let msg = e?.message || "分析失败，积分已退还至您的账户";
          if (Array.isArray(dbg) && dbg.length > 0) {
            const { RESEARCH_PIPELINE_DEBUG_MARKER } = await import("../shared/researchPipelineDebugMarker.js");
            msg = `${msg}${RESEARCH_PIPELINE_DEBUG_MARKER}${JSON.stringify(dbg)}`;
          }
          throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: msg });
        }

        // Neon 精华快照存储
        try {
          const { userCreations } = await import("../drizzle/schema-creations");
          const database = await db.getDb();
          if (database) {
            await database.insert(userCreations).values({
              userId,
              type: "research_snapshot",
              title: `${label} 竞品调研 ${new Date().toLocaleDateString("zh-CN")}`,
              metadata: JSON.stringify({
                platform: input.platform,
                positioning: strategy?.positioning,
                scripts: strategy?.scripts,
                visuals: strategy?.visuals,
                publishStrategy: strategy?.publishStrategy,
                growthPlan30Days: strategy?.growthPlan30Days,
                generatedAt: strategy?.generatedAt,
              }),
              creditsUsed: deductResult.source === "admin" ? 0 : COST,
              status: "completed",
            });
          }
        } catch (e: any) {
          console.error("[competitorResearch] Neon 快照存储失败（non-fatal）:", e?.message);
        }

        return {
          ok: true as const,
          strategy,
          creditsUsed: deductResult.source === "admin" ? 0 : COST,
          pipelineDebug,
        };
      }),
  }),

});

export type AppRouter = typeof appRouter;
