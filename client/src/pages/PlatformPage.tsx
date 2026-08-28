import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { AnimatePresence, motion } from "framer-motion";
import PlatformAssetAnalysisPanel from "@/components/platform/PlatformAssetAnalysisPanel";
import { GrowthSystemDebugPanel } from "@/components/platform/GrowthSystemDebugPanel";
import { PlatformWorkspaceStepHint } from "@/components/platform/PlatformWorkspaceStepHint";
import { PlatformModeShell } from "@/components/platform/PlatformModeShell";
import { PlatformCreateStepRail } from "@/components/platform/PlatformCreateStepRail";
import { PlatformStickyCtaRail } from "@/components/platform/PlatformStickyCtaRail";
import { PlatformCreateWorkbench } from "@/components/platform/PlatformCreateWorkbench";
import { PlatformTrendWorkbench } from "@/components/platform/PlatformTrendWorkbench";
import { PlatformTrendReportRail } from "@/components/platform/PlatformTrendReportRail";
import { PlatformToolsWorkbench } from "@/components/platform/PlatformToolsWorkbench";
import { PlatformStructuredPersonaForm } from "@/components/platform/PlatformStructuredPersonaForm";
import { PlatformPersonaPolishPanel } from "@/components/platform/PlatformPersonaPolishPanel";
import {
  assessPlatformPersonaSpecificity,
  type PlatformTopicGoalId,
} from "@shared/platformPersonaPolish";
import { PlatformOutputTypePicker } from "@/components/platform/PlatformOutputTypePicker";
import { PlatformDraftPresetsBar } from "@/components/platform/PlatformDraftPresetsBar";
import { PlatformAdvancedSettingsFold } from "@/components/platform/PlatformAdvancedSettingsFold";
import { PlatformSkillDrawer } from "@/components/platform/PlatformSkillDrawer";
import PlatformHtmlPptPanel from "@/components/PlatformHtmlPptPanel";
import { ManhuaApprovedTemplateOwnerDrawer } from "@/components/ManhuaApprovedTemplateOwnerDrawer";
import { uploadFileToSignedUrl } from "@/lib/growthCampImagePipeline";
import PlatformImageGenPanel from "@/components/platform/PlatformImageGenPanel";
import {
  composeFocusPromptFromPersona,
  EMPTY_STRUCTURED_PERSONA,
  LEGACY_VIDEO_TO_ASSETS_HINT,
  normalizePlatformUrlInPlace,
  parsePersonaFromFocusPrompt,
  pushRecentTask,
  readConfigPresets,
  readDefaultSkillIds,
  readRecentTasks,
  readWorkbenchDraft,
  resolvePlatformLocation,
  syncPlatformModeToUrl,
  toolsTabFromMode,
  trackPlatformFunnel,
  writeConfigPresets,
  writeDefaultSkillIds,
  writePlatformModeToStorage,
  writeWorkbenchDraft,
  type PlatformConfigPreset,
  type PlatformCreateStepId,
  type PlatformOutputType,
  type PlatformRecentTask,
  type PlatformStructuredPersona,
  type PlatformWorkbenchMode,
} from "@/lib/platformWorkbenchMode";
import {
  buildCreatePrimaryCta,
  buildToolsPrimaryCta,
  buildTrendPrimaryCta,
  type PlatformPrimaryCtaState,
} from "@/lib/platformWorkbenchCta";
import InfographicTemplatePicker from "@/components/InfographicTemplatePicker";
import { extractInfographicSubjectFromUserCopy } from "@shared/infographicNoteTemplates";
import { VisualReportTemplate, type VisualReportData } from "@/components/VisualReportTemplate";
import { PlatformReportDashboard } from "@/components/PlatformReportDashboard";
import {
  mapGenerateVisualReportResult,
  toVisualReportPlatforms,
  toVisualReportWindowDays,
  type VisualReportTheme,
} from "@/lib/visualReportMapper";
import {
  clearPlatformVisualReportPersist,
  readPlatformVisualReportPendingJob,
  resolvePlatformVisualReportPendingJob,
  shouldRestoreLatestVisualReport,
  writePlatformVisualReportPendingJob,
  type PlatformVisualReportPendingJobV1,
} from "@/lib/platformVisualReportPersist";
import {
  readShortlistExpandPersist,
  writeShortlistExpandPersist,
} from "@/lib/platformShortlistExpandPersist";
import { DecisionIntelLockedDemoPreview } from "@/components/DecisionIntelLockedDemoPreview";
import { ImageUpscaleBar } from "@/components/ImageUpscaleBar";
import { type IpProfile } from "@/components/IpProfileModal";
import { useAuth } from "@/_core/hooks/useAuth";
import TrialWatermarkImage from "@/components/TrialWatermarkImage";
import { useIsTrialUser } from "@/_core/hooks/useIsTrialUser";
import { getLoginUrl } from "@/const";
import {
  appendPollDebugLine,
  cancelManhuaLearnServerJob,
  createJob,
  getJob,
  hideManhuaLearnServerSeries,
  listManhuaLearnServerJobs,
  pollJobUntilTerminal,
  skipManhuaLearnServerEpisode,
  type ManhuaLearnServerJob,
} from "@/lib/jobs";
import { isNativeVideoLearnedTemplate } from "@shared/manhuaViralTemplateBank";
import {
  buildApprovedNativeTemplateBadge,
  buildPendingNativeTemplateProgressCopy,
  readApprovedNativeTemplateProgress,
} from "@/lib/manhuaNativeTemplateProgress";
import { NATIVE_DEEP_READ_JOB_MAX_CALLS } from "@shared/manhuaNativeDeepReadJob";
import { formatManhuaTemplateNativeBeatZh } from "@/lib/manhuaTemplateNativeBeat";
import { trpc } from "@/lib/trpc";
import { sanitizePlatformUserMessage } from "@/lib/platformUserFacingCopy";
import { normalizeDouyinVideoUrl, shouldSkipLocalLearnFallback } from "@shared/manhuaLearnYtdlp";
import type { AssetAnalysisHandoffPayload } from "@/lib/platformAssetAnalysisHandoff";
import { buildBlueOceanLexicon, type BlueOceanLexicon } from "@shared/blueOceanLexicon";
import {
  buildStoryboardCellsFromStepScript,
  formatPlatformStoryboardCellsSixColumnText,
  normalizePlatformStoryboardCells,
  type PlatformStoryboardCell,
} from "@shared/platformStoryboardCells";
import PlatformStoryboardCellsTable from "@/components/platform/PlatformStoryboardCellsTable";
import { appendFashionEditorialCharacterGuidance } from "@shared/platformFashionEditorialCharacter";
import {
  filterGraphicNoteReaderFacingSteps,
  focusGraphicNoteReaderScript,
  isGraphicNoteMetaCreatorGuidance,
} from "@shared/graphicNoteReaderFacing";
import { readTopicCoverDeepResearchProFromLs } from "@/lib/platformCoverDrProLs";
import {
  hasSupervisorSessionHint,
  SUPERVISOR_SESSION_CHANGED_EVENT,
} from "@/lib/supervisorTrpcToken";
import {
  clearLegacyManhuaLearnStorage,
  getManhuaLearnSafeProgressLabelZh,
  getManhuaLearnContinueControl,
  isManhuaLearnEmptyBatchFailure,
  manhuaLearnResultFromFailure,
  manhuaLearnResultFromJobOutput,
  manhuaLearnResultFromLocalFallback,
  manhuaLearnResultFromSnapshot,
  manhuaLearnResultFromStart,
  mergeManhuaLearnLiveProgress,
  demoteStaleRunningManhuaLearnItems,
  mergeManhuaLearnServerJobsIntoBasket,
  nativeLearnTerminalProposalRefreshSignature,
  parseManhuaNativeModelReceipts,
  readManhuaLearnActiveJob,
  readManhuaLearnBasket,
  readManhuaLearnFocusSeriesKey,
  readManhuaLearnMissingDismissedKeys,
  readManhuaLearnResult,
  removeManhuaLearnBasketItem,
  resolveManhuaLearnBasketFocusKey,
  resolveManhuaLearnReloadDecision,
  reuseManhuaLearnResultIfUnchanged,
  reuseManhuaLearnServerJobsIfUnchanged,
  upsertManhuaLearnBasketItem,
  writeManhuaLearnActiveJob,
  writeManhuaLearnBasket,
  writeManhuaLearnFocusSeriesKey,
  writeManhuaLearnMissingDismissedKeys,
  writeManhuaLearnResult,
  type ManhuaLearnActiveJobRecord,
  type ManhuaLearnBasketItem,
  type ManhuaLearnResultUi,
} from "@/lib/manhuaLearnResultUi";
import { getManhuaLearnPipelineMeta } from "@shared/manhuaTemplateLearnPipeline";
import { clampManhuaLearnBatchSize } from "@shared/manhuaTemplateLearnSeries";
import { resolveManhuaNativeDeepReadGate } from "@/lib/manhuaNativeDeepReadGate";
import type {
  ManhuaViralTemplateCard,
  ManhuaViralTemplateChangeReason,
  ManhuaViralTemplateOptimizeField,
  ManhuaViralTemplateOptimizeModel,
} from "@shared/manhuaViralTemplateBank";
import type {
  GrowthAnalysisScores,
  GrowthMonetizationStrategy,
  GrowthPlatformActivity,
  GrowthPlatformRecommendation,
  GrowthSnapshot,
  GrowthTitleExecution,
} from "@shared/growth";
import {
  CREDIT_COSTS,
  PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL,
  PLATFORM_SKILL_QA_SOL_DAILY_FREE,
  PLATFORM_SKILL_QA_TERRA_DAILY_FREE,
  platformSkillQaPaidCredits,
  platformCoverBundleTotalCredits,
  platformCompositeBundleTotalCreditsForGrid,
  platformCoverCompositeBulkBundleTotalCreditsForGrid,
  platformCoverCompositeBundleCreditsForFormatGrid,
  platformCustomMattingTotalCredits,
  platformCustomTopicImageCredits,
} from "@shared/plans";
import {
  getPlatformTrendReportCredits,
} from "@shared/platformTrendPricing";
import type { PlatformMattingAspectRatio, PlatformMattingBatchCount } from "@shared/plans";
import {
  buildCustomCopyPdfHtml,
  hasCustomCopyPdfContent,
} from "@/lib/customCopyPdfExport";
import {
  estimateKnowledgeCardDistillTradeoff,
  KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS,
  knowledgeCardCreditsForPages,
  knowledgeCardImageQuality,
  planKnowledgeCardPages,
} from "@shared/knowledgeCardPagination";
import { suggestKnowledgeCardMinSections } from "@shared/knowledgeCardDistillSections";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS,
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL,
  knowledgeCardDistillFeeForModel,
  resolveKnowledgeCardDistillModel,
  type KnowledgeCardDistillModelId,
} from "@shared/knowledgeCardDistillModels";
import {
  injectPlatformPdfSnapshotSanitizeIntoHead,
  optimizePdfSnapshotHtml,
} from "@/lib/pdfHtmlOptimize";
import type { PlatformTitleVariant } from "@shared/platformTitleVariants";
import {
  buildAutoPickedTitleVariantsForBlueprint,
  buildTitleVariantsForBlueprint,
  pickPreferredTitleVariant,
} from "@shared/platformTitleVariants";
import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import { DEMO_ADVANCED_AI_REPORT_DATA } from "@shared/advancedAIReportDemoData";
import { buildSimulatedAdvancedAIReport } from "@shared/advancedPredictionEngine";
import {
  formatDecisionIntelDateRangeZh,
  type PlatformWindowDays,
  pickPrimaryDecisionIntelPlatformHint,
} from "@shared/decisionIntelligencePlatformHint";
import { selectDecisionIntelBonusTopics } from "@shared/decisionIntelBonusTopics";
import {
  normalizeDecisionIntelTopicTitleKey,
  type DecisionIntelTopicPick,
} from "@shared/decisionIntelTopicPicks";
import {
  PLATFORM_SKILL_MASTER_READONLY,
  PLATFORM_TOPIC_EXPAND_MAX,
  PLATFORM_TOPIC_SHORTLIST_DEFAULT,
  PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT,
  PLATFORM_TOPIC_TOP_PICK_COUNT,
  PLATFORM_TOPIC_SHORTLIST_MAX,
  clampTopicShortlistCount,
  normalizePlatformTopicExpandEngine,
  platformTopicShortlistTotalCredits,
  type PlatformTopicExpandEngineId,
  type PlatformTopicShortlistItem,
} from "@shared/platformTopicShortlist";
import {
  groupPlatformSkillsByCategory,
  PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE,
} from "@shared/platformSkills";
import {
  PLATFORM_SKILL_ROUTER_CORE_IDS,
  routePlatformSkillIds,
} from "@shared/platformSkillRouter";
import {
  formatAssignedCraftTechniqueZh,
  pickCraftTechniqueProfile,
} from "@shared/storyboardLightingEmotion";
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Award,
  BarChart3,
  BookOpen,
  Bot,
  Briefcase,
  CalendarRange,
  Camera,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  DollarSign,
  Download,
  Eye,
  FileText,
  Upload,
  Film,
  Flame,
  Globe,
  Heart,
  Image,
  Landmark,
  Layers,
  Loader2,
  Lock,
  MessageSquareText,
  Mic,
  Package,
  Palette,
  PenLine,
  PlayCircle,
  Rocket,
  Presentation,
  RefreshCw,
  Scissors,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  Target,
  TrendingUp,
  Trophy,
  UserRound,
  Users,
  Video,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import VoiceInputButton from "@/components/VoiceInputButton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { copyText, copyTextWithToast } from "@/lib/copyText";

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";

type PlatformImagePromptTranslator = "gpt54" | "vertex_gemini_3_flash_preview";

/** @deprecated 2×4 / 封面已中文直送，不再英文化；保留类型仅兼容旧入参。 */
const COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR: PlatformImagePromptTranslator = "gpt54";

/** 全用户：2×4 / 八格 **出图** 引擎选择（封面已固定 OpenAI 官方 Image-2） */
const PLATFORM_COMPOSITE_2X4_ENGINE_LS_KEY = "mvstudiopro.platform.composite2x4Engine.v1";
type PlatformComposite2x4ImageEngine = "gpt_image2" | "nano_banana_2";

/** 全用户：Stage 1 战略看板 + Stage 2 专属文案 LLM（localStorage 记忆） */
const PLATFORM_COPY_LLM_ENGINE_LS_KEY = "mvstudiopro.platform.copyLlmEngine.v1";

/**
 * 文生图/海报/知识卡任务的断线续航（2026-08-12：一夜连丢三单实证）——
 * 旧行为：jobId 只活在 React 态，刷新即丢、卡死无超时无恢复，积分照扣图拿不到。
 * 新行为：入队即落 localStorage，开页发现未完成任务自动续轮询；成品同样落库常驻。
 */
const PLATFORM_POSTER_RESUME_LS_KEY = "mvstudiopro.platform.posterResume.v1";
const PLATFORM_POSTER_LAST_RESULT_LS_KEY = "mvstudiopro.platform.posterLastResult.v1";
/** 超过这个时长的挂账任务不再续（后台任务墙钟 10 分钟 + 余量） */
const PLATFORM_POSTER_RESUME_MAX_AGE_MS = 30 * 60_000;

type PlatformPosterResumeRecord = {
  jobId: string;
  kind: string;
  titleHead: string;
  firedAt: number;
};

function readPosterResumeRecord(): PlatformPosterResumeRecord | null {
  try {
    const raw = window.localStorage.getItem(PLATFORM_POSTER_RESUME_LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as Partial<PlatformPosterResumeRecord>;
    if (!o || typeof o.jobId !== "string" || !o.jobId) return null;
    return {
      jobId: o.jobId,
      kind: String(o.kind || ""),
      titleHead: String(o.titleHead || "").slice(0, 40),
      firedAt: Number(o.firedAt) || 0,
    };
  } catch {
    return null;
  }
}

function writePosterResumeRecord(rec: PlatformPosterResumeRecord | null): void {
  try {
    if (rec) window.localStorage.setItem(PLATFORM_POSTER_RESUME_LS_KEY, JSON.stringify(rec));
    else window.localStorage.removeItem(PLATFORM_POSTER_RESUME_LS_KEY);
  } catch {
    /* 隐私模式忽略 */
  }
}

function writePosterLastResult(urls: string[], kind: string): void {
  try {
    const clean = urls.filter((u) => /^https:\/\//i.test(String(u || "")));
    if (!clean.length) return;
    window.localStorage.setItem(
      PLATFORM_POSTER_LAST_RESULT_LS_KEY,
      JSON.stringify({ urls: clean.slice(0, 12), kind, at: Date.now() }),
    );
  } catch {
    /* 忽略 */
  }
}

function readPosterLastResult(): { urls: string[]; kind: string; at: number } | null {
  try {
    const raw = window.localStorage.getItem(PLATFORM_POSTER_LAST_RESULT_LS_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as { urls?: unknown; kind?: unknown; at?: unknown };
    const urls = Array.isArray(o.urls)
      ? o.urls.map((u) => String(u || "")).filter((u) => /^https:\/\//i.test(u))
      : [];
    if (!urls.length) return null;
    return { urls, kind: String(o.kind || ""), at: Number(o.at) || 0 };
  } catch {
    return null;
  }
}
/** @deprecated 监管旧键；读取时 fallback */
const PLATFORM_STAGE2_SUPERVISOR_COPY_ENGINE_LS_KEY = "mvstudiopro.platform.stage2SupervisorCopyEngine.v1";
type PlatformCopyLlmEngine = "vertex" | "openai";

/**
 * 创作顾问问答档位。
 *
 * 用户 2026-08-05 明文**去掉深度档**，只留标准档：两档实际推理都是 Kimi K3，
 * 差异仅在每日免费次数与超额单价，双档只会让用户多做一次无意义的选择。
 * 服务端仍认 sol 参数（将来要恢复不必改后端），前台不再提供入口。
 */
type PlatformSkillQaModelChoice = "gpt-5.6-terra" | "gpt-5.6-sol";

/** /platform 挂载 Skill：勾选 id 列表（JSON string[]） */
/** v2：默认只开核心 Skill；旧 v1 全开记忆不再沿用 */
const PLATFORM_ENABLED_SKILL_IDS_LS_KEY = "mvstudiopro.platform.enabledSkillIds.v2";
/** 接受「博主/创作者」自称（默认关） */
const PLATFORM_ALLOW_BLOGGER_TITLE_LS_KEY = "mvstudiopro.platform.allowBloggerTitle.v1";

function readEnabledPlatformSkillIdsFromLs(): Set<string> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(PLATFORM_ENABLED_SKILL_IDS_LS_KEY);
    if (raw == null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.map(String).filter(Boolean));
  } catch {
    return null;
  }
}

function readAllowBloggerTitleFromLs(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PLATFORM_ALLOW_BLOGGER_TITLE_LS_KEY) === "1";
  } catch {
    return false;
  }
}

function parsePlatformCopyLlmEngineLs(raw: string | null): PlatformCopyLlmEngine {
  return raw === "vertex" ? "vertex" : "openai";
}

function readPlatformCopyLlmEngineFromLs(): PlatformCopyLlmEngine {
  if (typeof window === "undefined") return "openai";
  try {
    const primary = window.localStorage.getItem(PLATFORM_COPY_LLM_ENGINE_LS_KEY);
    if (primary != null) return parsePlatformCopyLlmEngineLs(primary);
    const legacy = window.localStorage.getItem(PLATFORM_STAGE2_SUPERVISOR_COPY_ENGINE_LS_KEY);
    if (legacy != null) return parsePlatformCopyLlmEngineLs(legacy);
  } catch {
    /* ignore */
  }
  return "openai";
}

function parseComposite2x4EngineLs(raw: string | null): PlatformComposite2x4ImageEngine {
  return raw === "nano_banana_2" ? "nano_banana_2" : "gpt_image2";
}

type CoverClickEstimate = { band: "high" | "medium"; score: number; labelZh: string };

function parseCoverClickEstimate(raw: unknown): CoverClickEstimate | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const band = r.band === "high" || r.band === "medium" ? r.band : undefined;
  const score = typeof r.score === "number" ? r.score : undefined;
  const labelZh = typeof r.labelZh === "string" ? r.labelZh : undefined;
  if (!band || score == null || !labelZh) return undefined;
  return { band, score, labelZh };
}
/** 与 MyReports `myreports-pdf-root` 对齐：只克隆报告主体，避免整页 document 带入 #root / portal */
const PLATFORM_PDF_SNAPSHOT_ROOT_ID = "platform-report";
/** 英雄区「付费能力」锚点：接线至下方对应区块 */
const PLATFORM_SECTION_DECISION_INTEL_ID = "platform-decision-intel";
const PLATFORM_SECTION_DEEP_QA_ID = "platform-deep-qa";
const PLATFORM_SECTION_TREND_RUN_ID = "platform-trend-run";
const PLATFORM_SECTION_TREND_SIGNALS_ID = "platform-trend-signals";

/** 快照克隆前：单张图 load/error 逾时（选题多时并行等待，总耗时≈最慢一张） */
const PLATFORM_PDF_PER_IMAGE_WAIT_MS = 12_000;

/**
 * 克隆 #platform-report 前，确保区域内 img 已载入（含 lazy→eager、decode），避免 PDF 空白图块。
 */
async function waitForPlatformReportImagesReady(pdfRoot: HTMLElement): Promise<void> {
  const images = Array.from(pdfRoot.querySelectorAll("img"));
  await Promise.all(images.map((img) => waitForSinglePlatformReportImageForPdf(img)));
}

async function waitForSinglePlatformReportImageForPdf(img: HTMLImageElement): Promise<void> {
  const raw = (img.currentSrc || img.src || "").trim();
  if (!raw) return;

  if (img.loading === "lazy") {
    img.loading = "eager";
  }

  if (img.complete && img.naturalWidth > 0) {
    try {
      await img.decode();
    } catch {
      /* 仍可有已解码栅格供 clone 使用 */
    }
    return;
  }

  await new Promise<void>((resolve) => {
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timeoutId);
      img.removeEventListener("load", finish);
      img.removeEventListener("error", finish);
      resolve();
    };
    const timeoutId = window.setTimeout(finish, PLATFORM_PDF_PER_IMAGE_WAIT_MS);
    img.addEventListener("load", finish);
    img.addEventListener("error", finish);
  });

  try {
    await img.decode();
  } catch {
    /* pdf-worker 仍会再挡 decode；此处不挡快照 */
  }
}

/** 选题封面 URL 若为占位、逾时或失败标记则视为未就绪（与卡片区 isBlackImageOrTimeout 对齐）。 */
function platformCoverImageUrlLooksInvalid(url: unknown): boolean {
  const raw = typeof url === "string" ? url.trim() : "";
  if (!raw) return true;
  const lower = raw.toLowerCase();
  // 仅识别明确失败哨兵；禁止对任意 URL 子串匹配 timeout/error（签名链、查询参数易误伤导致「有图却当坏链清掉」）。
  if (lower === "timeout" || lower === "error" || lower === "failed") return true;
  if (/^(error|timeout|failed)[:/]/i.test(raw)) return true;
  if (/[?&#](?:error|status|code)=(timeout|error|failed)\b/i.test(raw)) return true;
  if (/\b(image[_-]?timeout|gen[_-]?error|status[_-]?timeout)\b/i.test(lower)) return true;
  if (/\/(timeout|error|failed)(?:\/|$|\?)/i.test(raw)) return true;
  return false;
}

const WINDOW_OPTIONS = [
  { days: 3 as const, label: "3天", description: "盯最新风向与突发热点" },
  { days: 7 as const, label: "7天", description: "一周热度与即时机会" },
  { days: 15 as const, label: "15天", description: "看短期波动、热点与即时机会" },
  { days: 30 as const, label: "30天", description: "看平台主流结构与相对稳定方向" },
  { days: 45 as const, label: "45天", description: "看更长窗口的沉淀与长期可做性" },
] as const;

type TrendPlatformKey = "xiaohongshu" | "bilibili" | "douyin" | "weixin_channels";

const TREND_PLATFORM_OPTIONS: { key: TrendPlatformKey; label: string; comingSoon?: boolean }[] = [
  { key: "xiaohongshu", label: "小红书" },
  { key: "bilibili", label: "B站" },
  { key: "douyin", label: "抖音" },
  { key: "weixin_channels", label: "视频号" },
];

/** Only include platforms that are live (not comingSoon) in the default selection */
const ALL_TREND_PLATFORM_KEYS = TREND_PLATFORM_OPTIONS.filter((item) => !item.comingSoon).map((item) => item.key);

const EMPTY_ANALYSIS: GrowthAnalysisScores = {
  composition: 0,
  color: 0,
  lighting: 0,
  impact: 0,
  viralPotential: 0,
  explosiveIndex: 0,
  realityCheck: "",
  reverseEngineering: {
    hookStrategy: "",
    emotionalArc: "",
    commercialLogic: "",
  },
  premiumContent: {
    summary: "",
    strategy: "",
    actionableTopics: [],
    topics: [],
    explosiveTopicAnalysis: "",
    musicAndExpressionAnalysis: "",
    remixVisualAnalysis: "",
    remixExpressionAnalysis: "",
    musicPrompt: "",
  },
  visualSummary: "",
  openingFrameAssessment: "",
  sceneConsistency: "",
  languageExpression: "",
  emotionalExpression: "",
  cameraEmotionTension: "",
  bgmAnalysis: "",
  musicRecommendation: "",
  sunoPrompt: "",
  trustSignals: [],
  visualRisks: [],
  keyFrames: [],
  strengths: [],
  improvements: [],
  platforms: [],
  summary: "",
  titleSuggestions: [],
  creatorCenterSignals: [],
  timestampSuggestions: [],
  weakFrameReferences: [],
  commercialAngles: [],
  followUpPrompt: "",
};

type AskResult = {
  title: string;
  answer: string;
  encouragement: string;
  nextQuestions: string[];
};

type AiManhuaRisingEntryView = {
  mixId: string;
  mixName: string;
  dramaKind: string;
  categoryLabelZh?: string;
  tagLabelsZh?: string[];
  platform?: "douyin" | "kuaishou";
  mixPlayCount: number;
  delta7d: number | null;
  risingScore?: number;
  status: string;
  author?: string;
  sampleTitle?: string;
  gcsUri?: string;
  url?: string;
};

type AiManhuaRisingBoardView = {
  platform?: "douyin" | "kuaishou";
  windowDays: number;
  hasBaseline: boolean;
  note: string;
  storeReadFailed?: boolean;
  entries: AiManhuaRisingEntryView[];
};

type PlatformDashboard = {
  headline: string;
  subheadline: string;
  personaSummary: string;
  topSignals: any[];
  /** 后端 Zod 课程与 LLM 输出；含 referenceAccounts、trafficBoosters；允许 label/lane/nextMove 等旧栏位 */
  platformMenu: Array<Record<string, any>>;
  hotTopics: any[];
  contentBlueprints: Array<{
    title: string;
    format: string;
    hook: string;
    copywriting: string;
    graphicPlan?: string;
    videoPlan?: string;
    suitablePlatforms?: string[];
  }>;
  monetizationLanes: Array<{
    title: string;
    fitReason: string;
    offerShape: string;
    revenueModes: string[];
    firstValidation: string;
  }>;
  actionCards: Array<{ title: string; detail: string }>;
  conversationStarters: any[];
  /** 抖音 AI 漫剧合集飙升（兼容别名；完整见 aiManhuaRisingByPlatform） */
  aiManhuaRising?: AiManhuaRisingBoardView | null;
  aiManhuaRisingByPlatform?: {
    douyin: AiManhuaRisingBoardView;
    kuaishou: AiManhuaRisingBoardView;
  } | null;
};

type ProcessingStepCard = {
  id: string;
  label: string;
  detail: string;
  status: "done" | "active" | "pending";
};

/** Debug：单次 Fly job 在前端的入队与轮询步骤 */
type TranslationCompleteStats = {
  pipeline?: string;
  model?: string;
  reasoningEffort?: string;
  upstreamChars?: number;
  englishChars?: number;
  elapsedMs?: number;
  maxTokens?: number;
};

type ClientJobPollTrace = {
  jobId: string;
  label: string;
  lines: string[];
  pollCount: number;
  terminalStatus?: string;
  /** 进行中：仅保留一行「当前步骤」，不把整段 imageGenFlowLog / 轮询流水刷进面板 */
  currentStep?: string;
  /** 中文直送 / 指令组装阶段轮询次数（由 imageGenFlowLog 阶段推断；字段名历史遗留） */
  translationPollCount?: number;
  /** 封面·分镜像素生成阶段轮询次数 */
  imageGenPollCount?: number;
  translationStep?: string;
  imageGenStep?: string;
  /** 最近一次中文直送/旧英文化完成统计（来自 flowLog） */
  translationComplete?: TranslationCompleteStats;
};

function parseTranslationCompleteFromFlow(flow: string[]): TranslationCompleteStats | null {
  for (let i = flow.length - 1; i >= 0; i--) {
    const line = flow[i] ?? "";
    if (!/\[英文化·完成\]/.test(line)) continue;
    const pipeline = line.match(/pipeline=([^\s·]+)/)?.[1];
    const model = line.match(/model=([^\s·]+)/)?.[1];
    const reasoningEffort = line.match(/reasoning_effort=([^\s·]+)/)?.[1];
    const upstreamChars = Number(line.match(/上游=(\d+)字/)?.[1]);
    const englishChars = Number(line.match(/英文=(\d+)字/)?.[1]);
    const elapsedMs = Number(line.match(/耗时=(\d+)ms/)?.[1]);
    const maxTokens = Number(line.match(/max_tokens=(\d+)/)?.[1]);
    return {
      pipeline,
      model,
      reasoningEffort,
      upstreamChars: Number.isFinite(upstreamChars) ? upstreamChars : undefined,
      englishChars: Number.isFinite(englishChars) ? englishChars : undefined,
      elapsedMs: Number.isFinite(elapsedMs) ? elapsedMs : undefined,
      maxTokens: Number.isFinite(maxTokens) ? maxTokens : undefined,
    };
  }
  return null;
}

function formatTranslationCompleteStats(stats: TranslationCompleteStats): string {
  const parts: string[] = [];
  if (stats.model) parts.push(`模型 ${stats.model}`);
  if (stats.reasoningEffort) parts.push(`reasoning=${stats.reasoningEffort}`);
  if (stats.upstreamChars != null && stats.englishChars != null) {
    parts.push(`上游 ${stats.upstreamChars} 字 → 英文 ${stats.englishChars} 字`);
  } else if (stats.englishChars != null) {
    parts.push(`英文 ${stats.englishChars} 字`);
  }
  if (stats.elapsedMs != null) {
    const sec = stats.elapsedMs >= 1000 ? `${(stats.elapsedMs / 1000).toFixed(1)}s` : `${stats.elapsedMs}ms`;
    parts.push(`耗时 ${sec}`);
  }
  if (stats.maxTokens != null) parts.push(`max_tokens=${stats.maxTokens}`);
  if (stats.pipeline) parts.push(`pipeline=${stats.pipeline}`);
  return parts.join(" · ");
}

function isTranslationFlowLine(line: string): boolean {
  // B 栏：中文直送 / staging / 步骤1（含旧 job 的英文化行）
  return /中文直送|chineseStaging|\[步骤1·中文直送\]|\[步骤1b\]|\[2×4·中文|buildCompositeSheetDirectChineseBody|英文化|GPT54|GPT 5\.4|extractChineseVisualBrief|\[英文化·完成\]|骨架·中文视觉/i.test(
    line,
  );
}

function isImageGenFlowLine(line: string): boolean {
  return /GPT-IMAGE|生图|出图|封面·像素|2×4·步骤2|2×4·主路径|OpenAI\/OpenRouter|单帧·OpenAI|单帧·OpenRouter|fal|OhMyGPT|EvoLink|Nano Banana|FAL·|像素\]|compositeImageUrl|Vertex.*image|gpt_image2/i.test(
    line,
  );
}

function splitPollCountsFromFlow(
  attempt: number,
  flow: string[],
  label?: string,
): Pick<
  ClientJobPollTrace,
  "translationPollCount" | "imageGenPollCount" | "translationStep" | "imageGenStep"
> {
  const transLines = flow.filter(isTranslationFlowLine);
  const imgLines = flow.filter(isImageGenFlowLine);
  const trimTail = (s: string) => String(s || "").replace(/\s+/g, " ").slice(0, 140);
  const lastTrans = transLines.length ? trimTail(transLines[transLines.length - 1]!) : undefined;
  const lastImg = imgLines.length ? trimTail(imgLines[imgLines.length - 1]!) : undefined;
  const compositeOnly = /2×4|八格|分镜/.test(String(label || ""));

  if (transLines.length === 0 && (imgLines.length > 0 || compositeOnly)) {
    const tail = lastImg || (flow.length ? trimTail(flow[flow.length - 1]!) : undefined);
    return {
      translationPollCount: 0,
      imageGenPollCount: attempt,
      translationStep: undefined,
      imageGenStep: tail,
    };
  }
  if (imgLines.length === 0) {
    return {
      translationPollCount: attempt,
      imageGenPollCount: 0,
      translationStep: lastTrans,
      imageGenStep: undefined,
    };
  }
  const firstImgIdx = flow.findIndex(isImageGenFlowLine);
  const transPhasePolls = Math.max(1, Math.min(attempt, firstImgIdx >= 0 ? firstImgIdx + 1 : 1));
  return {
    translationPollCount: transPhasePolls,
    imageGenPollCount: Math.max(0, attempt - transPhasePolls),
    translationStep: lastTrans,
    imageGenStep: lastImg,
  };
}

function applyFlowLogToPollTrace(
  prev: ClientJobPollTrace,
  attempt: number,
  flow: string[],
): ClientJobPollTrace {
  const split = splitPollCountsFromFlow(attempt, flow, prev.label);
  const phaseStep = split.imageGenStep || split.translationStep;
  const translationComplete = parseTranslationCompleteFromFlow(flow) ?? prev.translationComplete;
  return {
    ...prev,
    pollCount: attempt,
    ...split,
    translationComplete,
    currentStep: phaseStep ? `第 ${attempt} 次 · ${phaseStep}` : `轮询 · ${attempt} 次`,
  };
}

function pickActiveStage2SubStepOneLine(contentDebug: Record<string, unknown> | null | undefined): string | null {
  const bp = contentDebug?.buildPlatformContent as
    | { stage2SubSteps?: { id: string; title: string; status: string }[] }
    | undefined;
  const sub = bp?.stage2SubSteps;
  if (!Array.isArray(sub) || sub.length === 0) return null;
  const terminal = /^(done|success|succeeded|complete|completed|failed|error)$/i;
  const active = sub.find((s) => !terminal.test(String(s.status || "").trim()));
  if (active) return `${active.id} ${active.title} · ${active.status}`;
  const last = sub[sub.length - 1];
  return last ? `${last.id} ${last.title} · ${last.status}` : null;
}

/** Stage 2 失败或空载荷时，从 `debug.buildPlatformContent` 摘录高信号栏位写入轮询区（避免只看 toast）。 */
function formatStage2DebugSnippet(debug: Record<string, unknown> | null | undefined): string {
  if (!debug || typeof debug !== "object") return "";
  const parts: string[] = [];
  const bp = debug.buildPlatformContent;
  if (bp && typeof bp === "object") {
    const o = bp as Record<string, unknown>;
    const keys = [
      "stage2MaxOutputTokens",
      "stage2MaxOutputTokensEnv",
      "stage2SubStepsSummary",
      "stage2OpenAiAssistantEmptyBeforeRecovery",
      "stage2OpenAiAssistantEmptyRecoveryPath",
      "openaiGpt5ReasoningEffort",
      "jsonParseStrategy",
      "rawContentEmpty",
      "vertexFinishReason",
      "modelUsed",
      "error",
    ] as const;
    for (const k of keys) {
      const v = o[k];
      if (v !== undefined && v !== null) {
        const s = typeof v === "string" ? v : JSON.stringify(v);
        parts.push(`${k}=${s.slice(0, 240)}`);
      }
    }
  }
  for (const k of ["stage2Error", "stage2TimedOut"] as const) {
    const v = debug[k];
    if (v !== undefined && v !== null) parts.push(`${k}=${String(v).slice(0, 200)}`);
  }
  return parts.slice(0, 8).join(" · ");
}

/**
 * renderHighlightText — parses **bold** markers and [高亮:keyword] patterns
 * from AI-generated text and renders them as highlighted spans.
 * Long bare URLs get overflow-safe wrapping so PDF/卡片不会横向撑破。
 */
function renderHighlightText(text: string): React.ReactNode {
  if (!text) return null;
  const parts = text.split(/(\*\*.*?\*\*|\[高亮:[^\]]+\])/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i} className="text-[#8cefff] font-bold">{part.slice(2, -2)}</strong>;
    }
    if (part.startsWith("[高亮:") && part.endsWith("]")) {
      const kw = part.slice(4, -1);
      return <mark key={i} className="rounded px-1 bg-[rgba(73,230,255,0.18)] text-[#49e6ff] font-semibold not-italic">{kw}</mark>;
    }
    // Split bare http(s) URLs so each can break independently.
    const urlSplit = part.split(/(https?:\/\/[^\s）】\]>，。；;]+)/g);
    if (urlSplit.length === 1) return <span key={i}>{part}</span>;
    return (
      <span key={i}>
        {urlSplit.map((seg, j) =>
          /^https?:\/\//i.test(seg) ? (
            <span
              key={`${i}-${j}`}
              className="break-all [overflow-wrap:anywhere] text-[#8cefff]/90"
              title={seg}
            >
              {seg}
            </span>
          ) : (
            <span key={`${i}-${j}`}>{seg}</span>
          ),
        )}
      </span>
    );
  });
}

/** 列表卡片左侧装饰图示：不依关键字猜使用者领域，仅由文案字串 hash **稳定**挑一个，避免每人都得像同一种帐号类型。 */
const PLATFORM_CARD_DECOR_ICONS: LucideIcon[] = [
  Sparkles,
  Star,
  Award,
  PlayCircle,
  ArrowRight,
  Rocket,
  TrendingUp,
  Eye,
  Bot,
  Camera,
  Film,
  CalendarRange,
  ShieldCheck,
  MessageSquareText,
  Globe,
  Target,
  Flame,
  Zap,
  Layers,
  Video,
  Image,
  FileText,
  Users,
  BarChart3,
  DollarSign,
  Briefcase,
  PenLine,
  BookOpen,
  Trophy,
  Share2,
  Heart,
  Mic,
  Palette,
  Landmark,
  Activity,
  Stethoscope,
  Package,
];

function platformCardDecorIconHash(text: string): number {
  let h = 2166136261;
  const s = String(text || "");
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// 列表／卡片用装饰图示：语意中性，同一条文案每次得到同一图、不同文案尽量错开
function getSmartIcon(text: string, className = "h-4 w-4 text-[#8cefff]"): React.ReactElement {
  const Icon = PLATFORM_CARD_DECOR_ICONS[platformCardDecorIconHash(text) % PLATFORM_CARD_DECOR_ICONS.length];
  return <Icon className={className} />;
}

// Universal safe-text extractor — handles string | object | null from LLM outputs
// Prevents [object Object] from rendering in JSX by extracting the most likely text field
function renderSafeText(item: any, fallback = ""): string {
  if (item === null || item === undefined || item === "") return fallback;
  if (typeof item === "string") {
    const t = item.trim();
    if (!t || t === "[object Object]" || t === "[object object]") return fallback;
    return item;
  }
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (typeof item === "object") {
    const pickStringField = (...keys: string[]): string => {
      for (const key of keys) {
        const v = (item as Record<string, unknown>)[key];
        if (typeof v === "string" && v.trim() && v.trim() !== "[object Object]") return v;
        if (typeof v === "number" || typeof v === "boolean") return String(v);
      }
      return "";
    };
    const fromKnown = pickStringField(
      "title",
      "text",
      "content",
      "name",
      "desc",
      "description",
      "detail",
      "action",
      "label",
      "value",
      "laneName",
      "account",
      "reason",
      "summary",
    );
    if (fromKnown) return fromKnown;
    const nested = Object.values(item as Record<string, unknown>).find(
      (v) => typeof v === "string" && v.trim() && v.trim() !== "[object Object]",
    );
    if (typeof nested === "string") return nested;
    try {
      const json = JSON.stringify(item);
      if (json && json !== "{}" && json !== "[]" && !json.includes("[object Object]")) return json;
    } catch {
      /* ignore */
    }
    return fallback;
  }
  return fallback;
}

function extractFocusKeywords(value: string) {
  return Array.from(
    new Set((String(value || "").match(/[\u4e00-\u9fa5A-Za-z]{2,}/g) || []).slice(0, 6)),
  );
}

function hasSupervisorAccess() {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("supervisor") === "1") {
    localStorage.setItem(SUPERVISOR_ACCESS_KEY, "1");
    return true;
  }
  return localStorage.getItem(SUPERVISOR_ACCESS_KEY) === "1";
}

function getRelativeBar(value: number, max: number) {
  if (!max || max <= 0) return 0;
  return Math.max(10, Math.round((value / max) * 100));
}

function revealText(text: string, elapsedTime: number, seed = 0, speed = 18) {
  const normalized = String(text || "");
  if (!normalized) return "";
  const visibleCount = Math.max(1, Math.min(normalized.length, Math.floor(elapsedTime * speed) - seed));
  return normalized.slice(0, visibleCount);
}

function buildPlatformProcessingSteps(selectedWindowDays: PlatformWindowDays, elapsedTime: number, focusPrompt: string): ProcessingStepCard[] {
  const phase = Math.floor(elapsedTime / 4);
  const subject = String(focusPrompt || "").trim() || "当前平台机会";
  const currentStep = Math.min(3, phase);
  return [
    {
      id: "collect",
      label: `读取近 ${selectedWindowDays} 天平台快照`,
      detail: "先把当前窗口里的平台热度、动量和样本结构取出来。",
      status: currentStep > 0 ? "done" : "active",
    },
    {
      id: "sort",
      label: "整理热点赛道与平台优先级",
      detail: `围绕“${subject}”筛出更值得先做的平台与切入方向。`,
      status: currentStep === 1 ? "active" : currentStep > 1 ? "done" : "pending",
    },
    {
      id: "advice",
      label: "生成商业化与动作建议",
      detail: "把热点翻译成可执行的选题、形式和承接动作。",
      status: currentStep === 2 ? "active" : currentStep > 2 ? "done" : "pending",
    },
    {
      id: "polish",
      label: "整理成顾问看板",
      detail: "把结论压缩成用户一眼能看懂、愿意继续追问的版本。",
      status: currentStep >= 3 ? "active" : "pending",
    },
  ];
}

function getWindowLabel(value: PlatformWindowDays) {
  return WINDOW_OPTIONS.find((item) => item.days === value)?.label || `${value}天`;
}

function shellCardClasses(extra = "") {
  return `rounded-2xl border border-white/8 bg-[rgba(12,8,28,0.9)] shadow-[0_12px_48px_rgba(0,0,0,0.22)] backdrop-blur ${extra}`.trim();
}

function splitAnswerParagraphs(value: string) {
  return String(value || "")
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanUserCopy(value: unknown, fallback = "") {
  // 先安全抽字串，避免对嵌套对象 String(obj) → "[object Object]"
  const normalized = renderSafeText(value, "").trim();
  if (!normalized) return fallback;

  const softened = normalized
    .replace(/\[object Object\]/gi, " ")
    .replace(/\bfallback\b/gi, "当前参考")
    .replace(/\blive sample(?:-\d+d)?\b/gi, "近期样本")
    .replace(/\bhistorical\b/gi, "中期沉淀")
    .replace(/\bverify\b/gi, "先验证")
    .replace(/\bcollector\b/gi, "")
    .replace(/\bcurrentTotal\b/gi, "")
    .replace(/\barchivedTotal\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (/(后台|工程|数据库|主链|样本裂缝|日期覆盖|补位|live sample|historical|fallback|collector|coverage)/i.test(softened)) {
    return fallback;
  }

  return softened || fallback;
}

/** menu 项常见栏位顺序（先找中文标签；若无汉字再整段扫一次取英文 slug 等）。 */
function stringContainsHan(text: string): boolean {
  /** 日用汉字区间检测；不依赖需 ES2018+ 的 Unicode 属性转义。 */
  return /[\u4e00-\u9fff]/.test(text);
}

/** LLM／示例 JSON 常用的假渠道占位（会被过滤，改走快照 hinted 名或可读英文字段）。 */
function looksLikeGarbagePlatformMenuLabel(raw: string): boolean {
  const s = String(raw || "").trim();
  if (!s) return true;
  const compact = s.replace(/\s+/g, "");
  const lower = s.toLowerCase();
  if (/^platform\s*\d+$/.test(lower)) return true;
  if (/^[p]\d+$/.test(lower)) return true;
  if (/^平台\d+$/.test(compact)) return true;
  if (/^平台[0-9０-９一二三四五六七八九十百千]+$/.test(compact)) return true;
  if (/^(平台一|平台二|平台三|平台四)$/.test(compact)) return true;
  return false;
}

/** 解析不出具体渠道名时的顺位备援（不使用「平台 1、2」式占位）。 */
function platformMenuRankFallback(index: number): string {
  switch (index) {
    case 0:
      return "首选顺位";
    case 1:
      return "次要顺位";
    case 2:
      return "第三顺位";
    case 3:
      return "第四顺位";
    default:
      return `第 ${index + 1} 顺位`;
  }
}

/**
 * platformMenu：优先后端约定的 platform / displayName，再扫 passthrough 栏位。
 * `snapshotHint` 为快照里对应顺位的真实平台名／展示名（补模型漏栏时用）。
 */
function resolvePlatformMenuDisplayName(
  item: Record<string, unknown> | null | undefined,
  rankIndex: number,
  snapshotHint?: string | null,
): string {
  const hint = typeof snapshotHint === "string" ? snapshotHint.trim() : "";

  const tryCoerce = (v: unknown): string => {
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
    if (typeof v === "object") {
      const n =
        (v as { zh?: unknown; name?: unknown; label?: unknown; title?: unknown }).zh
        ?? (v as { name?: unknown }).name
        ?? (v as { label?: unknown }).label
        ?? (v as { title?: unknown }).title;
      return typeof n === "string" ? n.trim() : "";
    }
    return "";
  };

  const candidates: string[] = [];
  if (item && typeof item === "object") {
    const o = item as Record<string, unknown>;
    /** 顺序对齐 growthPlatformMenuItemSchema + Prompt 明示的 platform / displayName。 */
    const keys: unknown[] = [
      o.platform,
      o.displayName,
      o.platformLabel,
      o.platformName,
      o.platform_name,
      o.label,
      o.name,
      o["平台"],
      o.channel,
      o["渠道"],
      o.slug,
      o.platformKey,
      o.signal,
    ];
    for (const k of keys) {
      const t = tryCoerce(k);
      if (t) candidates.push(t);
    }
  }

  const ordered = [...candidates];
  if (hint) ordered.push(hint);

  for (const raw of ordered) {
    if (looksLikeGarbagePlatformMenuLabel(raw)) continue;
    if (raw && stringContainsHan(raw)) return raw;
  }
  for (const raw of ordered) {
    if (!looksLikeGarbagePlatformMenuLabel(raw) && raw) return raw;
  }

  return hint && !looksLikeGarbagePlatformMenuLabel(hint)
    ? hint
    : platformMenuRankFallback(rankIndex);
}

function buildPlatformSceneText(item: {
  title: string;
  hook: string;
  copywriting: string;
  executionDetails?: { environmentAndWardrobe?: string; lightingAndCamera?: string };
}): string {
  let promptText = `${item.title} ${item.hook}\n${item.copywriting}`;
  const ex = item.executionDetails;
  if (ex) {
    const env = renderSafeText(ex.environmentAndWardrobe);
    const light = renderSafeText(ex.lightingAndCamera);
    if (env || light) {
      promptText = `场景与服装：${env}，灯光与镜头：${light}。\n主题：${item.title}\n${item.hook}\n${item.copywriting}`;
    }
  }
  return promptText;
}

/** 封面生图：只用人物背景摘要（不再注入无数据支撑的「企业 IP 基因」推测字段） */
function buildCoverPersonaContextForImageGen(personaSummary: string, _ipProfile?: IpProfile): string {
  const parts: string[] = [];
  const ps = String(personaSummary || "").trim();
  if (ps) parts.push(`【精神气质与内容身份】${ps.slice(0, 600)}`);
  return appendFashionEditorialCharacterGuidance(parts.join("\n").trim(), { maxChars: 3800, lang: "zh" });
}

/** 供分镜表 / 小红书图文单图：汇整折叠区内容，供 gpt-image-2 拆镜（后端再截断） */
function buildPlatformSheetScriptContext(
  item: {
    title: string;
    hook: string;
    copywriting: string;
    production?: string;
    detailedScript?: string;
    publishingAdvice?: string;
    actionableSteps?: string[];
    format?: string;
    commentHooks?: string[];
    graphicNotePages?: Array<{
      pageIndex?: number;
      role?: string;
      headline?: string;
      body?: string;
    }>;
    executionDetails?: {
      environmentAndWardrobe?: string;
      lightingAndCamera?: string;
      stepByStepScript?: string[];
    };
    storyboardCells?: PlatformStoryboardCell[];
  },
  opts?: {
    shootingTechniqueBrief?: string;
    gridVariant?: "2x4" | "3x4";
    /** 出图 kind 已知时优先用它判断（避免 format 缺失时误塞分镜六栏） */
    sheetKind?: "storyboard" | "graphic";
  },
): string {
  const parts: string[] = [];
  const isGraphic =
    opts?.sheetKind === "graphic" ||
    item.format === "图文" ||
    item.format === "小红书";
  const is3x4 = opts?.gridVariant === "3x4";
  parts.push(`【选题】${item.title}`);
  if (item.hook) parts.push(`【钩子】${item.hook}`);

  // 图文笔记：只喂读者向攻略正文；禁止发布建议/创作SOP（否则会画成「技术指导」格）
  if (isGraphic) {
    const pages = Array.isArray(item.graphicNotePages) ? item.graphicNotePages : [];
    if (pages.length >= 6) {
      const pageBlock = pages
        .slice(0, 12)
        .map((p, i) => {
          const idx = p.pageIndex ?? i + 1;
          const role = p.role || "page";
          const head = String(p.headline || "").trim();
          const body = String(p.body || "").trim();
          return `${idx}. [${role}] ${head}\n${body}`;
        })
        .join("\n\n");
      parts.push(`【可发图文页结构·按页排版】\n${pageBlock}`);
      parts.push(
        "【体裁·硬约束】按上方页结构直接排成读者向笔记；禁止创作 SOP 格；评论钩若出现须≤3字生活词。",
      );
    } else {
      if (item.copywriting) {
        const readerCopy = String(item.copywriting)
          .split(/\n+/)
          .map((l) => l.trim())
          .filter((l) => l && !isGraphicNoteMetaCreatorGuidance(l))
          .join("\n")
          .trim();
        if (readerCopy) parts.push(`【文案与结构】${readerCopy}`);
      }
      parts.push(
        "【体裁·硬约束】本图是小红书/图文**读者向攻略·避坑·知识笔记**（可直接发布），不是短视频分镜表，也不是创作者「技术指导手册」。禁止六栏分镜、灯光机位教学、口播时间轴；禁止「拍封面素材/拆八页/录60秒/发布建议/话题标签墙」等生产SOP格子。",
      );
      const readerScript = focusGraphicNoteReaderScript(item.detailedScript);
      if (readerScript) parts.push(`【图文大纲·读者页】${readerScript}`);
      const contentSteps = filterGraphicNoteReaderFacingSteps(item.actionableSteps);
      if (contentSteps.length) {
        parts.push(`【内容要点】\n${contentSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
      }
    }
    const hooks = Array.isArray(item.commentHooks) ? item.commentHooks.filter(Boolean).slice(0, 3) : [];
    if (hooks.length) parts.push(`【评论短钩】${hooks.join("、")}（每词≤3字）`);
    // 故意不喂 publishingAdvice：易变成「怎么发」技术指导格
    if (is3x4) {
      parts.push(
        "【版式·3×4 十二格图文笔记】须按 **3 行 × 4 列 = 12 格** 展开读者向知识节拍（序号徽章 01–12）。末 2–3 格只能是互动/清单CTA，禁止创作教学。凡出现现代解说/主人公的格子须锁参考人像同脸，衣着可随场景微调。",
      );
    } else {
      parts.push(
        "【版式·2×4 八格图文笔记】按 2 行 × 4 列共 8 格展开（序号 01–08）。对标可直接发布的笔记结构；禁止创作SOP格。凡出现现代解说/主人公的格子须锁参考人像同脸，衣着可随场景微调。",
      );
    }
    return parts.join("\n\n").slice(0, 12000);
  }

  if (item.copywriting) parts.push(`【文案与结构】${item.copywriting}`);
  if (item.production) parts.push(`【制作】${item.production}`);
  const ex = item.executionDetails;
  if (ex?.environmentAndWardrobe) parts.push(`【环境与服装】${ex.environmentAndWardrobe}`);
  if (ex?.lightingAndCamera) parts.push(`【灯光机位·导演灵感】${ex.lightingAndCamera}`);
  else {
    parts.push(
      "【灯光机位·高度需求】每格写清主光方向/质感/色温/明暗比（侧光、逆光、伦勃朗、窗光等），服务叙事，避免死白顶光。",
    );
  }
  // 自定义/全案出图：按选题标题稳定绑一张手法卡，与 Stage2 同源库
  const craftSeed = `${item.title || ""}:${item.hook || ""}`;
  const craftProfile = pickCraftTechniqueProfile(craftSeed || "platform-sheet");
  parts.push(
    formatAssignedCraftTechniqueZh(craftProfile, {
      slotLabel: String(item.title || "编导分镜").slice(0, 40),
    }),
  );
  parts.push(
    "【编导分镜·导演板】本图为编导分镜图（导演灵感画布可视化）：全局须可读风格气质、建议时长节拍、角色表演提要、起—承—转—合、关键技法与观众情绪弧；每格仍填六栏。勿做成互不关联的静帧清单。",
  );
  parts.push(
    "【情绪·运镜·灯光·高度需求】每格点明运镜意图、微表情与气氛；光影与情绪同步递进。只借专业影视手法（高反差建筑光、温暖魔术时刻、光晕剪影揭示、雾霾大光域静默、霓虹余韵、精密冷光不安、天气即光群像、动机窗光等），禁止点名导演或写「某某风/致敬」。编导分镜表六栏：景别/运镜/灯光安排/情绪表达/画面内容/台词与音效。",
  );
  if (is3x4) {
    parts.push(
      "【版式·3×4 十二格编导分镜】须按 3 行 × 4 列 = 12 格展开镜头节拍；现代主人公跨格同脸（锁参考人像），衣着可随场景微调。",
    );
  }
  // 有结构化逐镜拆片表时优先喂表：不让出图模型自己拆镜，画格更稳
  const cellsBlock = formatPlatformStoryboardCellsSixColumnText(
    normalizePlatformStoryboardCells(item.storyboardCells),
  );
  if (cellsBlock) {
    parts.push(cellsBlock);
  } else if (Array.isArray(ex?.stepByStepScript) && ex.stepByStepScript.length) {
    parts.push(`【编导分镜步骤】\n${ex.stepByStepScript.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }
  if (item.actionableSteps?.length) {
    parts.push(`【落地步骤】\n${item.actionableSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }
  if (item.detailedScript) parts.push(`【详细脚本】${item.detailedScript}`);
  if (item.publishingAdvice) parts.push(`【发布建议】${item.publishingAdvice}`);
  const shoot = String(opts?.shootingTechniqueBrief || "").trim();
  if (shoot) parts.push(`【上传素材拍摄技法】\n${shoot}`);
  return parts.join("\n\n").slice(0, 12000);
}

/** 合成生图：灯光／环境汇总，供后端写入 [EMOTION & LIGHTING]（Cam5） */
function buildPlatformExecutionDetailsPayload(item: {
  executionDetails?: { lightingAndCamera?: string; environmentAndWardrobe?: string };
}): string {
  const lighting = String(item.executionDetails?.lightingAndCamera || "").trim();
  const env = String(item.executionDetails?.environmentAndWardrobe || "").trim();
  if (!lighting && !env) {
    return "专业影视光影：动机窗光 + 伦勃朗补光，电影级明暗比；情绪弧线：开场克制好奇 → 中段共鸣紧绷 → 收束释然邀请。只写手法，不点名来源。";
  }
  return `[灯光机位]: ${lighting || "—"} | [环境与服化]: ${env || "—"} | [情绪设定]: 专业运镜与动机光/轮廓光 · 情绪随段落递进`.slice(
    0,
    4000,
  );
}

/** Cam8：从网址 `?reportId=<user_creations.id>` 绑定战报，生图扣点成功后写入该笔 metadata */
function readOptionalReportBindingCreationId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("reportId");
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** 仅在 ?reportId= 有效时带上；勿传 `creationRecordId: undefined`，否则 tRPC / Query 序列化会出现字串 "undefined" */
function optionalBoundCreationRecordId(): { creationRecordId: number } | Record<string, never> {
  const id = readOptionalReportBindingCreationId();
  return id !== undefined ? { creationRecordId: id } : {};
}

function normalizeTitleVariantsFromServer(raw: unknown, fallback: PlatformTitleVariant[]): PlatformTitleVariant[] {
  if (!Array.isArray(raw) || raw.length < 2) return fallback;
  const out: PlatformTitleVariant[] = [];
  for (const row of raw) {
    if (out.length >= 3) break;
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const title = String((row as { title?: unknown }).title ?? "").trim();
    if (!title) continue;
    if (id === "a" || id === "b" || id === "c") {
      out.push({ id, title });
    }
  }
  return out.length >= 2 ? out : fallback;
}

/** 与后端单条展示标题对齐（具体规则在 shared / 后台）。 */
function resolveExecutionCardTitleVariants(
  rawItem: Record<string, unknown>,
  title: string,
  hook: string,
  copywriting: string,
  index: number,
): PlatformTitleVariant[] {
  const hookStr = String(hook || "").replace(/\s+/g, " ").trim();
  const seed = { ...rawItem, title, hook, copywriting };
  const fallbackPair = buildTitleVariantsForBlueprint(seed, index);
  const raw = rawItem.titleVariants;
  if (Array.isArray(raw) && raw.length >= 2) {
    const normalized = normalizeTitleVariantsFromServer(raw, fallbackPair);
    const w = pickPreferredTitleVariant(normalized, hookStr);
    return [{ id: "a", title: w.title }];
  }
  if (Array.isArray(raw) && raw.length === 1) {
    const row = raw[0];
    if (row && typeof row === "object") {
      const t = String((row as { title?: unknown }).title ?? "").trim();
      if (t) return [{ id: "a", title: t }];
    }
  }
  return buildAutoPickedTitleVariantsForBlueprint(seed, index);
}

/** 执行选题卡 DOM id：稳定锚点 `execution-card-…`（画廊不绑定点击滚动） */
function executionCardDomId(sceneId: string): string {
  return `execution-card-${encodeURIComponent(sceneId).replace(/%/g, "")}`;
}

type PlatformContentExecutionCard = {
  id: string;
  title: string;
  hook: string;
  copywriting: string;
  production: string;
  format: string;
  suitablePlatforms: string[];
  actionableSteps: string[];
  detailedScript: string;
  publishingAdvice: string;
  executionDetails: {
    environmentAndWardrobe: string;
    lightingAndCamera: string;
    stepByStepScript: string[];
  };
  titleVariants: PlatformTitleVariant[];
  /** 逐镜拆片表（台词/场景/景别/动作/运镜/剪辑），服务端保底产出 */
  storyboardCells: PlatformStoryboardCell[];
  /** 蓝海词 / 高亮搜索词（推演文案） */
  highlightKeywords?: string[];
  /** 战略地图当次赠送选题（刷新后不再展示） */
  isDecisionIntelBonus?: boolean;
  /** 战略地图用户点选扩写（刷新后不再展示） */
  isDecisionIntelPicked?: boolean;
};

function mapContentBlueprintToExecutionCard(
  item: Record<string, unknown>,
  index: number,
  opts?: { isDecisionIntelBonus?: boolean; isDecisionIntelPicked?: boolean },
): PlatformContentExecutionCard {
  const format = item.format || item["格式"] || item["内容形式"] || item["形式"] || "";
  const title = item.title || item["标题"] || item["选题标题"] || "";
  const hook = item.hook || item.openingHook || item["开头文案钩子"] || item["hook"] || item["开头钩子"] || "";
  const copywriting =
    item.copywriting || item.body || item["核心文案方向"] || item["文案"] || item["正文"] || "";
  const productionRaw =
    item.graphicPlan ||
    item.videoPlan ||
    item["图文怎么排版/视频怎么拍"] ||
    item["图文排版"] ||
    item["视频拍摄"] ||
    item["制作建议"] ||
    "";
  const rawPlatforms = item.suitablePlatforms || item["适合平台"] || item["平台"] || [];
  const suitablePlatforms: string[] = Array.isArray(rawPlatforms)
    ? rawPlatforms.map((r) => renderSafeText(r))
    : typeof rawPlatforms === "string" && rawPlatforms.trim()
      ? rawPlatforms.split(/[,，、/]+/).map((s: string) => s.trim()).filter(Boolean)
      : [];

  const actionSteps: string[] = Array.isArray(item.actionableSteps)
    ? item.actionableSteps.map((a: unknown) => renderSafeText(a))
    : [];

  const execDetails =
    typeof item.executionDetails === "object" && item.executionDetails !== null
      ? (item.executionDetails as Record<string, unknown>)
      : {};
  const envWardrobe =
    execDetails.environmentAndWardrobe || execDetails["拍摄环境服装"] || execDetails["环境服装"] || "";
  const lightCam =
    execDetails.lightingAndCamera || execDetails["灯光机位"] || execDetails["灯光镜头"] || "";

  let scriptSteps: string[] = [];
  if (Array.isArray(execDetails.stepByStepScript)) {
    scriptSteps = execDetails.stepByStepScript.map((s: unknown) => renderSafeText(s));
  } else if (typeof execDetails.stepByStepScript === "string" && execDetails.stepByStepScript.trim()) {
    scriptSteps = [execDetails.stepByStepScript];
  } else if (typeof execDetails.stepByStepScript === "object" && execDetails.stepByStepScript !== null) {
    scriptSteps = [renderSafeText(execDetails.stepByStepScript)];
  }

  const titleVariants = resolveExecutionCardTitleVariants(
    item,
    String(title),
    String(hook),
    String(copywriting),
    index,
  );
  const baseTitle = cleanUserCopy(
    renderSafeText(
      titleVariants[0]?.title || title || item.theme || item.titleExample,
      `内容方案 ${index + 1}`,
    ),
    `内容方案 ${index + 1}`,
  );

  const highlightRaw =
    item.highlightKeywords ?? item.blueOceanKeywords ?? item.keywords ?? item["高亮词"] ?? item["蓝海词"];
  const highlightKeywords: string[] = Array.isArray(highlightRaw)
    ? highlightRaw.map((x) => renderSafeText(x)).filter(Boolean).slice(0, 8)
    : typeof highlightRaw === "string" && highlightRaw.trim()
      ? highlightRaw
          .split(/[,，、/\s]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .slice(0, 8)
      : [];

  return {
    id: String(item.id || item.sceneId || item.topicId || `topic-${index}`),
    title: baseTitle,
    hook: cleanUserCopy(
      renderSafeText(hook || item.contentHook, "先用一句明确判断开头。"),
      "先用一句明确判断开头。",
    ),
    copywriting: cleanUserCopy(
      renderSafeText(copywriting, "把这条内容写成用户一看就知道你在解决什么问题的版本。"),
      "把这条内容写成用户一看就知道你在解决什么问题的版本。",
    ),
    production: cleanUserCopy(renderSafeText(productionRaw), ""),
    format: renderSafeText(format),
    suitablePlatforms,
    actionableSteps: actionSteps,
    detailedScript: renderSafeText(item.detailedScript || ""),
    publishingAdvice: renderSafeText(item.publishingAdvice || ""),
    executionDetails: {
      environmentAndWardrobe: renderSafeText(envWardrobe),
      lightingAndCamera: renderSafeText(lightCam),
      stepByStepScript: scriptSteps,
    },
    titleVariants,
    storyboardCells: (() => {
      const normalized = normalizePlatformStoryboardCells(item.storyboardCells);
      if (normalized.length) return normalized;
      // 图文笔记无镜头概念，不从大纲硬造垃圾表
      if (/图文|小红书/.test(String(format || ""))) return [];
      return buildStoryboardCellsFromStepScript(scriptSteps);
    })(),
    highlightKeywords,
    isDecisionIntelBonus: opts?.isDecisionIntelBonus,
    isDecisionIntelPicked: opts?.isDecisionIntelPicked,
  };
}

function mapStrategicMapBlueprintsToExecutionCards(
  blueprints: unknown[],
  baseIndex: number,
  flags: { isDecisionIntelBonus?: boolean; isDecisionIntelPicked?: boolean },
): PlatformContentExecutionCard[] {
  if (!Array.isArray(blueprints)) return [];
  return blueprints
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .map((row, index) => mapContentBlueprintToExecutionCard(row, baseIndex + index, flags));
}

function mapBonusBlueprintsToExecutionCards(
  blueprints: unknown[],
  baseIndex = 0,
): PlatformContentExecutionCard[] {
  return mapStrategicMapBlueprintsToExecutionCards(blueprints, baseIndex, { isDecisionIntelBonus: true });
}

/** 封面 enqueue 仅认 DB 快照 sceneId；将会话执行卡写回快照所需的最小字段。 */
function executionCardToSnapshotBlueprint(card: PlatformContentExecutionCard): Record<string, unknown> {
  return {
    id: card.id,
    sceneId: card.id,
    title: card.title,
    hook: card.hook,
    copywriting: card.copywriting,
    format: card.format,
    executionDetails: card.executionDetails,
    titleVariants: card.titleVariants,
  };
}

/** 生图请求速率：滚动窗口长度（毫秒），与上游「每分钟 N 次」配额对齐。 */
const PLATFORM_IMAGE_RATE_WINDOW_MS = 60_000;
/**
 * 上述窗口内最多**发起**几次生图（封面单帧 · 2×4 编导分镜 · 小红书 2×4 八格图文合成等共用同一节流器）。
 * 可用 `VITE_PLATFORM_IMAGE_MAX_STARTS_PER_60S` 覆写（整数 1～24，预设 24；付费生图不设低上限）。
 */
const PLATFORM_IMAGE_MAX_STARTS_PER_60S = Math.min(
  24,
  Math.max(1, Number(import.meta.env.VITE_PLATFORM_IMAGE_MAX_STARTS_PER_60S) || 24),
);

const PLATFORM_REFERENCE_GALLERY_ID = "platform-reference-storyboard-gallery";

/** 宽幅合成：服务端 jobs 表旁路进度，供 GET /api/jobs 轮询 `imageGenFlowLog` */
function newPlatformCompositeProgressJobId(): string {
  try {
    const u = globalThis.crypto?.randomUUID?.();
    if (u) return u.replace(/-/g, "").slice(0, 24);
  } catch {
    /* ignore */
  }
  return `cs${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

type PlatformImageGenFlowSnapshot = {
  at: string;
  kind:
    | "batch_topic_frames"
    | "batch_composite_2x4"
    | "batch_cover_composite_bundle"
    | "composite_2x4"
    | "batch_topic_frames_failed"
    | "composite_2x4_failed";
  lines: string[];
  meta?: Record<string, unknown>;
};

function upsertPlatformImageFlowSnapshot(
  prev: PlatformImageGenFlowSnapshot[],
  next: PlatformImageGenFlowSnapshot,
): PlatformImageGenFlowSnapshot[] {
  const opId = String(next.meta?.localOpId || "").trim();
  if (!opId) {
    return [next, ...prev].slice(0, 8);
  }
  const withoutSameOp = prev.filter((item) => String(item.meta?.localOpId || "").trim() !== opId);
  return [next, ...withoutSameOp].slice(0, 8);
}

/** 滚动窗口内只保留「仍在 60s 内」的发起时间戳 */
function prunePlatformImageRateWindow(times: number[], now: number, windowMs: number): void {
  while (times.length > 0 && times[0]! <= now - windowMs) {
    times.shift();
  }
}

/** 失败时写入 Debug 绿框，便于对照 Network / 服务端日志 */
function linesFromClientMutationFailure(prefix: string, err: unknown): string[] {
  const lines = [`${prefix} · ${new Date().toISOString()}`];
  if (err instanceof Error) {
    lines.push(`name: ${err.name}`);
    const msg = err.message ?? "";
    if (msg.includes("\n")) {
      lines.push("message（分行）:");
      lines.push(...msg.split("\n"));
    } else {
      lines.push(`message: ${msg}`);
    }
    if (err.stack) lines.push("stack:", ...String(err.stack).split("\n"));
  } else {
    lines.push(`raw: ${String(err)}`);
  }
  const d = err as { data?: { code?: string; httpStatus?: number; path?: string; zodError?: unknown } };
  if (d?.data?.code != null) lines.push(`trpc.data.code: ${d.data.code}`);
  if (d?.data?.httpStatus != null) lines.push(`trpc.data.httpStatus: ${String(d.data.httpStatus)}`);
  if (d?.data?.path != null) lines.push(`trpc.data.path: ${d.data.path}`);
  if (d?.data?.zodError != null) {
    try {
      lines.push(`trpc.data.zodError:\n${JSON.stringify(d.data.zodError, null, 2)}`);
    } catch {
      lines.push("trpc.data.zodError: [无法序列化]");
    }
  }
  const shape = (err as { shape?: unknown }).shape;
  if (shape != null) {
    try {
      lines.push(`trpc.shape:\n${JSON.stringify(shape, null, 2)}`);
    } catch {
      lines.push("trpc.shape: [无法序列化]");
    }
  }
  return lines;
}

function buildPendingImageGenLines(kind: "cover_batch" | "storyboard" | "xiaohongshu", sceneId?: string): string[] {
  const ts = new Date().toISOString();
  if (kind === "cover_batch") {
    return [
      `${ts}  [客户端] 异步逐张封面生成已发起`,
      `${ts}  [等待中] sceneId=${sceneId || "N/A"}（详见下方服务端 imageGenFlowLog）`,
    ];
  }
  if (kind === "storyboard") {
    return [`${ts}  [客户端] 编导分镜生成已发起 · sceneId=${sceneId || "N/A"}（详见下方服务端流水）`];
  }
  return [`${ts}  [客户端] 小红书 2×4 八格图文生成已发起 · sceneId=${sceneId || "N/A"}（详见下方服务端流水）`];
}

/** 宽幅合成：pending 时由 progressJobId + GET /api/jobs 实时刷新（分镜 / 小红书同一套）。 */
function buildCompositeImageGenPendingLines(input: {
  kind:
    | "storyboard_sheet_portrait"
    | "storyboard_sheet_landscape"
    | "xiaohongshu_dual_note"
    | "single_page_knowledge_card";
  sceneId: string;
  title: string;
  imagePromptTranslator?: PlatformImagePromptTranslator | "vertex_gemini_31_pro_preview";
  progressJobId?: string;
  gridVariant?: "2x4" | "3x4";
}): string[] {
  const ts = new Date().toISOString();
  const is3x4 = input.gridVariant === "3x4";
  const trLine = is3x4
    ? "3×4 十二格：中文直送主体 + 分段横排生成后拼接（多数 3～5 分钟内完成）。"
    : "2×4／八格：中文直送主体出图；封面固定 OpenAI 官方 Image-2。";
  const kindLabel =
    input.kind === "xiaohongshu_dual_note"
      ? is3x4
        ? "小红书 3×4 十二格图文笔记"
        : "小红书 2×4 八格图文笔记"
      : input.kind === "storyboard_sheet_landscape"
        ? is3x4
          ? "视频向 3×4 十二格分镜主表 · 横版"
          : "视频向 2×4 编导分镜主表 · 横版"
        : is3x4
          ? "视频向 3×4 十二格分镜主表"
          : "视频向 2×4 编导分镜主表 · 竖版";
  const pid = String(input.progressJobId ?? "").trim();
  return [
    `${ts}  [客户端] 宽幅合成已发起 · ${kindLabel}`,
    `${ts}  [客户端] sceneId=${input.sceneId} · title=${input.title.slice(0, 72)}`,
    `${ts}  [客户端] 出图路径：${trLine}`,
    ...(pid.length >= 8
      ? [
          `${ts}  [实时进度] progressJobId=${pid} · 约每 0.85s 拉取 GET 计数；细节不写进「Fly Jobs」面板`,
        ]
      : [`${ts}  [提示] 未带 progressJobId，无法实时轮询步骤`]),
  ];
}

/**
 * 从轮询或响应合并后的 snapshot 文案推测进度标签，减少用户以为「卡住」。
 * （仅为 UX 辅助；细节仍以下方 Debug imageGenFlowLog 为准）
 */
function deriveCompositeUxPhaseHint(snapshotLines: readonly string[], liveServerTail = ""): string {
  const tail = `${liveServerTail}\n${snapshotLines.length ? snapshotLines.slice(-48).join("\n") : ""}`;
  if (/整链(?:重试|[\s\S]*?\d+\/\d+\s*次失败)/i.test(tail) || /\b第\s*\d+\/\d+\s*次失败/.test(tail)) {
    return "整链重试：重新中文直送 + 生图，可能仍需数分钟…";
  }
  if (/\[GPT-IMAGE-2|OpenAI\/OpenRouter|单帧·OpenAI|单帧·OpenRouter/.test(tail)) {
    return "绘制中 · 高清出图（单尺寸偶需 3～5 分钟）…";
  }
  if (/\[2×4·步骤2|\[步骤2\]|\[2×4·主路径\]/.test(tail)) {
    return "准备生图（像素锁已定）…";
  }
  if (/\[步骤1·中文直送\]|\[2×4·中文直送\]|\[chineseStaging|中文直送/.test(tail)) {
    return "中文直送 · 指令组装中…";
  }
  if (/GPT54·英文化|骨架·中文视觉|extractChineseVisualBrief|\[GPT54·翻译\]/.test(tail)) {
    return "旧任务日志：曾走英文化（当前管线已改为中文直送）…";
  }
  return "中文直送与绘图合计大约 3～5 分钟，请勿中途刷新 ";
}

/** Stage 2 等长任务：用 shimmer / 光斑 / 节拍点转移注意力（不向用户展示技术细节） */
function PlatformGeneratingCharm(props: {
  className?: string;
  iconClass?: string;
  pingClass?: string;
  title: string;
  subtitle?: string;
  orbAClass?: string;
  orbBClass?: string;
  dotClasses?: [string, string, string];
}) {
  const {
    className = "",
    iconClass = "text-[#49e6ff]",
    pingClass = "bg-[#49e6ff]/25",
    title,
    subtitle,
    orbAClass = "bg-[#ff4fb8]/28",
    orbBClass = "bg-[#49e6ff]/22",
    dotClasses = ["bg-[#ff4fb8]", "bg-[#49e6ff]", "bg-[#c4b5fd]"],
  } = props;
  return (
    <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] ${className}`}>
      <div className="pointer-events-none absolute inset-0 shimmer opacity-50" aria-hidden />
      <div
        className={`pointer-events-none absolute -left-10 -top-14 h-44 w-44 rounded-full ${orbAClass} blur-3xl motion-safe:animate-[mvspPlatformOrb_9s_ease-in-out_infinite]`}
        aria-hidden
      />
      <div
        className={`pointer-events-none absolute -right-12 bottom-0 h-40 w-40 rounded-full ${orbBClass} blur-3xl motion-safe:animate-[mvspPlatformOrb_11s_ease-in-out_infinite_reverse]`}
        style={{ animationDelay: "0.8s" }}
        aria-hidden
      />
      <div className="relative z-10 flex flex-col items-center justify-center gap-3 px-6 py-8 text-center">
        <div className="relative flex h-12 w-12 items-center justify-center">
          <span className={`absolute h-10 w-10 rounded-full ${pingClass} motion-safe:animate-ping`} aria-hidden />
          <Loader2 className={`relative z-10 h-7 w-7 animate-spin ${iconClass}`} />
        </div>
        <div className="text-sm font-semibold tracking-tight text-white/95">{title}</div>
        {subtitle ? <p className="max-w-md text-xs leading-relaxed text-[#c9c0e6]/88">{subtitle}</p> : null}
        <div className="mt-0.5 flex gap-1.5" aria-hidden>
          {dotClasses.map((c, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${c} motion-safe:animate-bounce opacity-90`}
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** 封面生成等待期间：轮播前四条选题文案摘要；每条约 60s；显示持续至当前列表内每条选题均有有效封面 URL（不依赖任务旗标提前收起）。 */
const COVER_GEN_WAIT_CAROUSEL_MS = 60_000;

type CoverGenWaitCarouselItem = { id: string; title: string; excerpt: string };

function CoverGenerationWaitCarousel({
  items,
  itemsKey,
  phaseLabel,
}: {
  items: CoverGenWaitCarouselItem[];
  itemsKey: string;
  /** 覆盖默认「封面绘制中」头部副标题（如出图阶段显示合成进度提示）。 */
  phaseLabel?: string;
}) {
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (items.length === 0) return;
    setIdx(0);
  }, [itemsKey, items.length]);

  useEffect(() => {
    if (items.length <= 1) return;
    const id = window.setInterval(() => setIdx((i) => (i + 1) % items.length), COVER_GEN_WAIT_CAROUSEL_MS);
    return () => window.clearInterval(id);
  }, [items.length]);

  if (items.length === 0) return null;

  const slide = items[idx]!;
  const slideAnimateKey = `${itemsKey}:${idx}:${slide.id}`;
  const barDurationSec = COVER_GEN_WAIT_CAROUSEL_MS / 1000;

  return (
    <div
      className="col-span-full overflow-hidden rounded-2xl border border-[#ff4fb8]/20 bg-[linear-gradient(135deg,rgba(255,79,184,0.08),rgba(106,92,255,0.06))] p-4 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)] md:p-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#ff9fe0]" aria-hidden />
        <span className="text-[11px] font-semibold tracking-wide text-[#ff9fe0]/90">
          {phaseLabel ? "出图进行中" : "封面绘制中"}
        </span>
        <span className="text-[11px] text-white/48">
          {phaseLabel ?? "合计常需约 3～5 分钟 · 每条预览约 1 分钟 · 全部选题均有有效封面后自动收起"}
        </span>
      </div>

      <div key={slideAnimateKey} className="mt-4 animate-in fade-in-0 slide-in-from-bottom-1 duration-500">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="max-w-[min(100%,48rem)] text-[15px] font-bold leading-snug text-white">{slide.title}</h4>
          <span className="shrink-0 tabular-nums text-[10px] text-white/40">
            {idx + 1} / {items.length}
          </span>
        </div>
        {slide.excerpt.trim() ? (
          <p className="mt-2 line-clamp-5 text-[13px] leading-relaxed text-[#dcd5f5]/92">{slide.excerpt}</p>
        ) : null}
      </div>

      <div className="mt-4 flex items-center gap-3">
        <div className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <div
            key={`${slideAnimateKey}-bar`}
            className="h-full w-full origin-left scale-x-0 bg-gradient-to-r from-[#ff4fb8]/85 to-[#6a5cff]/85 motion-reduce:!scale-x-100 motion-reduce:!animate-none"
            style={{
              animation: `coverGenWaitCarouselProgress ${barDurationSec}s linear forwards`,
            }}
          />
        </div>
        <div className="flex shrink-0 gap-1">
          {items.map((it, i) => (
            <span
              key={it.id}
              className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                i === idx ? "bg-[#ff4fb8] shadow-[0_0_8px_rgba(255,79,184,0.45)]" : "bg-white/18"
              }`}
              aria-hidden
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Stage 2 六个内容维度 + 变现路径的展示标签（与后端 BLUEPRINT_DIMENSIONS 顺序对齐）。 */
const STAGE2_BLUEPRINT_STEPS: ReadonlyArray<{ label: string; hint: string }> = [
  { label: "专业洞察", hint: "行业壁垒与权威结论" },
  { label: "跨界价值", hint: "美学与个人哲学视野" },
  { label: "受众痛点", hint: "击中核心焦虑" },
  { label: "人设魅力", hint: "真实经历建立信任" },
  { label: "多场景热点", hint: "趋势改写贴脸场景" },
  { label: "长尾常青", hint: "高搜索·吃长尾流量" },
];

/**
 * Stage 2 逐条 blueprint 生成进度：6 个内容维度 + 变现路径，各自独立进度条与状态。
 * 已到位的 blueprint（轮询增量）显示 100%，当前条「生成中」用时间推进的百分比缓爬，其余「排队中」。
 */
function Stage2BlueprintProgress({
  completedBlueprints,
  monetizationReady,
  statusText,
}: {
  completedBlueprints: number;
  monetizationReady: boolean;
  statusText: string;
}) {
  // 单条 blueprint 为一次原子 LLM 调用，无 token 级进度；用时间推进的缓爬百分比给出「正在动」的体感（封顶 95%）。
  const [activeCreep, setActiveCreep] = useState(14);
  useEffect(() => {
    setActiveCreep(14);
    const id = window.setInterval(() => {
      setActiveCreep((p) => (p >= 95 ? 95 : p + Math.max(1, Math.round((97 - p) * 0.07))));
    }, 850);
    return () => window.clearInterval(id);
  }, [completedBlueprints, monetizationReady]);

  const rows = [
    ...STAGE2_BLUEPRINT_STEPS.map((s, i) => ({
      label: s.label,
      hint: s.hint,
      status: i < completedBlueprints ? "done" : i === completedBlueprints ? "active" : "pending",
    })),
    {
      label: "变现路径",
      hint: "可落地的赚钱方式",
      status: monetizationReady
        ? "done"
        : completedBlueprints >= STAGE2_BLUEPRINT_STEPS.length
          ? "active"
          : "pending",
    },
  ];
  const doneCount = rows.filter((r) => r.status === "done").length;
  const overallPct = Math.round((doneCount / rows.length) * 100);

  return (
    <div
      className="col-span-full overflow-hidden rounded-2xl border border-[#7d73ff]/22 bg-[linear-gradient(135deg,rgba(125,115,255,0.08),rgba(73,230,255,0.05))] p-4 md:p-5"
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-white/10 pb-3">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[#c4b5fd]" aria-hidden />
        <span className="text-[11px] font-semibold tracking-wide text-[#c4b5fd]">专属文案逐条生成中</span>
        <span className="tabular-nums text-[11px] text-white/55">
          {doneCount} / {rows.length} 条已完成 · {overallPct}%
        </span>
        {statusText ? <span className="text-[11px] text-white/40">· {statusText}</span> : null}
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((row, i) => {
          const pct = row.status === "done" ? 100 : row.status === "active" ? activeCreep : 0;
          const barClass =
            row.status === "done"
              ? "bg-[linear-gradient(90deg,#6fffb0,#49e6ff)]"
              : row.status === "active"
                ? "bg-[linear-gradient(90deg,#7d73ff,#49e6ff)] motion-safe:animate-pulse"
                : "bg-white/15";
          const tagClass =
            row.status === "done"
              ? "text-[#92ffc1]"
              : row.status === "active"
                ? "text-[#8cefff]"
                : "text-white/35";
          return (
            <div key={row.label} className="rounded-xl border border-white/8 bg-black/25 px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-semibold text-white">
                  {i + 1}. {row.label}
                </span>
                <span className={`shrink-0 text-[10px] font-semibold tabular-nums ${tagClass}`}>
                  {row.status === "done"
                    ? "完成 · 100%"
                    : row.status === "active"
                      ? `生成中… ${pct}%`
                      : "排队中"}
                </span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10" aria-hidden>
                <div
                  className={`h-full rounded-full transition-all duration-700 ease-out ${barClass}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="mt-1.5 text-[10px] leading-4 text-white/45">{row.hint}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


/** 3A：五维度 IP 引导面板（与 buildPlatformContent 硬约束对齐） */
function PlatformIpDimensionGuide() {
  return (
    <div className="mb-6 rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-md">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#ff9900]">
        <Bot className="h-4 w-4 shrink-0 animate-pulse" />
        高定内容生成指南：五大维度
      </h3>
      <div className="grid grid-cols-1 gap-4 text-left sm:grid-cols-2 xl:grid-cols-5">
        {[
          { t: "专业洞察 (Insight)", d: "展现行业壁垒与权威知识。" },
          { t: "跨界价值 (Value)", d: "融合美学与个人哲学视野。" },
          { t: "受众痛点 (Pain Point)", d: "精准击中粉丝的核心焦虑。" },
          { t: "人设魅力 (Persona)", d: "分享真实经历建立情感信任。" },
          {
            t: "多场景热点 (Scenes)",
            d: "借趋势改写适配本人设；场景生动多元，避免总落在书房客厅。",
          },
        ].map((v, i) => (
          <div key={i} className="rounded-lg bg-white/5 p-3 transition-colors hover:bg-white/10">
            <div className="mb-1 text-[12px] font-bold text-gray-200">{v.t}</div>
            <p className="text-[11px] leading-relaxed text-gray-400">{v.d}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-gray-500">
        提示：在「自定义创作」里选题初选上方的「人物背景与创作诉求」写清职业、身份、兴趣、专长，生成更贴脸。
      </p>
    </div>
  );
}

/** 待提炼的上传文件：小文件走 base64 内联，大文件走 GCS 直传只带回 gs:// 地址 */
type KnowledgeCardPendingFile = {
  fileBase64?: string;
  gcsUri?: string;
  mimeType: string;
  fileName?: string;
};

type ManhuaLearnSourceRow = {
  url?: string | null;
  gcsUri?: string | null;
  fileName?: string | null;
  localFileName?: string | null;
  learnLlm?: "claude" | "gpt" | "deepseek";
  mixName?: string | null;
  mixId?: string | null;
  platform?: "douyin" | "kuaishou" | "upload" | string | null;
};

type ManhuaLearnContinuation = {
  row: ManhuaLearnSourceRow;
  rank: number;
  /** 服务端真实系列 key；首次入队前可能为空，终态回写后用于防止串剧续跑。 */
  seriesKey?: string;
  savedAt: number;
};

type ManhuaLearnActiveJob = ManhuaLearnActiveJobRecord & {
  continuation: ManhuaLearnContinuation;
};

const MANHUA_LEARN_CONTINUATION_LS_KEY = "mvs-manhua-learn-continuation-v1";
const MANHUA_LEARN_BATCH_SIZE_LS_KEY = "mvs-manhua-learn-batch-size-v1";

function readManhuaLearnBatchSize(): number {
  const fallback = getManhuaLearnPipelineMeta().batchDefault;
  try {
    const raw = window.localStorage.getItem(MANHUA_LEARN_BATCH_SIZE_LS_KEY);
    if (!raw) return fallback;
    return clampManhuaLearnBatchSize(Number(raw));
  } catch {
    return fallback;
  }
}

function writeManhuaLearnBatchSize(value: number): void {
  try {
    window.localStorage.setItem(
      MANHUA_LEARN_BATCH_SIZE_LS_KEY,
      String(clampManhuaLearnBatchSize(value)),
    );
  } catch {
    // 浏览器禁用本地存储时，本次页面状态仍然有效。
  }
}

function manhuaLearnContinuationStorageKey(userKey: string): string {
  const scope = String(userKey || "").trim();
  return scope ? `${MANHUA_LEARN_CONTINUATION_LS_KEY}:${encodeURIComponent(scope)}` : "";
}

/**
 * 学习进度日志：新行到达自动滚到最新（0826 用户点名，不用手动拉）。
 * 用户主动往上翻时暂停跟随（离底部 >24px 视为在回看），翻回底部恢复跟随。
 */
function ManhuaLearnProgressLogView({
  lines,
}: {
  lines: ReadonlyArray<{ atIso?: string; stage: string; detailZh: string }>;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const followRef = useRef(true);
  useEffect(() => {
    const el = boxRef.current;
    if (el && followRef.current) el.scrollTop = el.scrollHeight;
  }, [lines.length, lines[lines.length - 1]?.detailZh]);
  return (
    <div
      ref={boxRef}
      onScroll={(event) => {
        const el = event.currentTarget;
        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
      }}
      className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-[10px] opacity-90"
    >
      <div className="font-semibold opacity-95">学习进度</div>
      {lines.map((line, i) => (
        <div
          key={`${line.atIso}-${line.stage}-${i}`}
          className="border-t border-white/5 pt-1 first:border-0 first:pt-0"
        >
          <span className="opacity-50">
            {line.atIso
              ? new Date(line.atIso).toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                  second: "2-digit",
                })
              : ""}
          </span>{" "}
          {line.detailZh}
        </div>
      ))}
    </div>
  );
}

function nativeModelReceiptStageLabelZh(stage: string): string {
  if (stage === "audio_model") return "声音分析";
  if (stage === "visual_model") return "画面精读";
  if (stage === "visual_parse") return "结构校验";
  if (stage === "series_aggregation_model") return "系列整理";
  return stage;
}

function nativeModelReceiptStatusLabelZh(stage: string, status: string): string {
  if (status === "started") return "进行中";
  if (stage === "visual_model" && status === "completed") return "已返回，待校验";
  if (status === "completed") return "完成";
  if (status === "failed") return "失败";
  return status;
}

function readManhuaLearnContinuation(userKey: string): ManhuaLearnContinuation | null {
  const storageKey = manhuaLearnContinuationStorageKey(userKey);
  if (!storageKey) return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ManhuaLearnContinuation>;
    const url = String(parsed.row?.url || "").trim();
    const savedAt = Number(parsed.savedAt);
    if (!/^https?:\/\//i.test(url) || !Number.isFinite(savedAt)) {
      window.localStorage.removeItem(storageKey);
      return null;
    }
    return {
      row: {
        url,
        mixName: String(parsed.row?.mixName || "").trim() || null,
        mixId: String(parsed.row?.mixId || "").trim() || null,
        platform: String(parsed.row?.platform || "").trim() || null,
      },
      rank: Math.max(0, Math.floor(Number(parsed.rank) || 0)),
      seriesKey: String(parsed.seriesKey || "").trim() || undefined,
      savedAt,
    };
  } catch {
    return null;
  }
}

function writeManhuaLearnContinuation(
  userKey: string,
  value: ManhuaLearnContinuation | null,
): void {
  const storageKey = manhuaLearnContinuationStorageKey(userKey);
  if (!storageKey) return;
  try {
    const url = String(value?.row.url || "").trim();
    // 手动上传的 gs:// 路径不持久化；刷新后需重新选择素材，避免长期留下用户素材路径。
    if (!value || !/^https?:\/\//i.test(url)) {
      window.localStorage.removeItem(storageKey);
      return;
    }
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({
        row: {
          url,
          mixName: value.row.mixName || null,
          mixId: value.row.mixId || null,
          platform: value.row.platform || null,
        },
        rank: value.rank,
        seriesKey: value.seriesKey || undefined,
        savedAt: value.savedAt,
      }),
    );
  } catch {
    // localStorage 禁用时仍保留当前会话内的 ref，不阻断学习主链。
  }
}

/**
 * 超过这个体积就直传 GCS。
 *
 * base64 会把体积撑大约三分之一，请求体上限 18MB 折回原文件约 13.5MB；再大连接会在
 * 读 body 阶段被掐断，前端只看到含糊的「算力紧张」（用户 2026-08-06 的 42MB PDF）。
 * 阈值留到 8MB，是让常见的几百 KB 文档继续走内联，少一次签名往返。
 */
const KNOWLEDGE_CARD_DIRECT_UPLOAD_MIN_BYTES = 8 * 1024 * 1024;

/**
 * 大文档直传 GCS：一次 PUT，断了就重签名重传（签名地址 15 分钟过期，重试必须重新取）。
 *
 * 单次 PUT 不是分片续传，断线时会从头再传一遍；对几十 MB 的 PDF 够用，
 * 真正的分片续传要走 GCS resumable session，留到后面再补。
 */
async function uploadKnowledgeCardFileToGcs(params: {
  file: File;
  mimeType: string;
  label: string;
  getSignedUrl: (input: { fileName: string; mimeType: string }) => Promise<{
    uploadUrl: string;
    gcsUri?: string;
    requiredHeaders?: Record<string, string>;
  }>;
  onStatus: (text: string) => void;
}): Promise<string> {
  const maxAttempts = 3;
  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const signed = await params.getSignedUrl({
        fileName: params.file.name,
        mimeType: params.mimeType,
      });
      if (!signed.gcsUri) {
        throw new Error("未取得上传地址");
      }
      const retryHint = attempt > 1 ? `（第 ${attempt} 次尝试）` : "";
      await uploadFileToSignedUrl({
        file: params.file,
        uploadUrl: signed.uploadUrl,
        headers: signed.requiredHeaders,
        onProgress: (percent) => {
          params.onStatus(`正在上传 ${params.label} ${percent}%${retryHint}`);
        },
      });
      return signed.gcsUri;
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts) break;
      params.onStatus(`${params.label} 上传中断，正在重试（${attempt}/${maxAttempts - 1}）…`);
      await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError || "未知错误");
  throw new Error(`${params.file.name} 上传失败：${detail}`);
}

/**
 * 初选要吃的蓝海词入参：一级词定方向、二级词做标题落点。
 *
 * 用户 2026-08-06 明文：一级与二级蓝海词都要抓进选题，别只跟着红海热榜写。
 */
function buildShortlistBlueOceanInput(lexicon: BlueOceanLexicon): {
  blueOceanWords?: string[];
  blueOceanGroups?: Array<{ primary: string; secondary: string[] }>;
} {
  const words = lexicon.flat.filter((w) => w.length > 0 && w.length <= 24).slice(0, 40);
  const groups = lexicon.grouped
    .map((g) => ({
      primary: String(g.primary || "").trim().slice(0, 24),
      secondary: (g.secondary || [])
        .map((s) => String(s || "").trim().slice(0, 24))
        .filter(Boolean)
        .slice(0, 8),
    }))
    .filter((g) => g.primary.length > 0)
    .slice(0, 12);
  return {
    ...(words.length ? { blueOceanWords: words } : {}),
    ...(groups.length ? { blueOceanGroups: groups } : {}),
  };
}

/**
 * 上传文件时决定文本框既有文案要不要一并提炼。
 *
 * 提炼稿会写回文本框，所以下次上传若默认合并，就会把上一次的稿子混进这本新书
 * （用户 2026-08-05：整本书的知识卡第 1 页出的是上一次残留的内容）。
 */
function resolveKnowledgeCardSourceText(existing: string, fileCount: number): string | undefined {
  const text = String(existing || "").trim();
  if (!text || fileCount <= 0) return text || undefined;
  const merge = window.confirm(
    `上方文本框已有约 ${text.length} 字文案。\n\n` +
      `「确定」＝ 连同这段文案一起提炼\n` +
      `「取消」＝ 只提炼新上传的 ${fileCount} 个文件（上方文案会被新的提炼稿替换）`,
  );
  return merge ? text : undefined;
}

export default function PlatformPage() {
  const [supervisorAccess] = useState(() => hasSupervisorAccess());
  const [supervisorSessionReady, setSupervisorSessionReady] = useState(
    hasSupervisorSessionHint,
  );
  const [debugMode, setDebugMode] = useState(false);
  /** Debug 开启时加快轮询与刷新，让进度面板更接近即时 */
  const platformImageFlowPollIntervalMs = debugMode ? 650 : 2500;
  const compositeSheetLivePollIntervalMs = debugMode ? 380 : 850;

  const { isAuthenticated, loading, user } = useAuth({
    autoFetch: true,
    redirectOnUnauthenticated: true,
    redirectPath: getLoginUrl(),
  });
  useEffect(() => {
    const refresh = () => setSupervisorSessionReady(hasSupervisorSessionHint());
    window.addEventListener(SUPERVISOR_SESSION_CHANGED_EVENT, refresh);
    return () => window.removeEventListener(SUPERVISOR_SESSION_CHANGED_EVENT, refresh);
  }, []);
  const hasSupervisorOpsAccess = Boolean(
    user?.role === "admin" ||
    user?.role === "supervisor" ||
    (supervisorAccess && supervisorSessionReady),
  );
  const queryClient = useQueryClient();
  const trpcUtils = trpc.useUtils();
  const [selectedWindowDays, setSelectedWindowDays] = useState<PlatformWindowDays>(15);
  /** 平台趋势分析：单选（默认小红书）；不再默认勾选全部平台 */
  const [selectedTrendPlatforms, setSelectedTrendPlatforms] = useState<TrendPlatformKey[]>([
    "xiaohongshu",
  ]);
  const [focusPrompt, setFocusPrompt] = useState("");
  const [voiceDebugLog, setVoiceDebugLog] = useState<string[]>([]);
  const addVoiceDebug = (msg: string) => setVoiceDebugLog((prev) => [...prev.slice(-30), msg]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [platformComposite2x4Engine, setPlatformComposite2x4Engine] = useState<PlatformComposite2x4ImageEngine>(() => {
    if (typeof window === "undefined") return "gpt_image2";
    try {
      return parseComposite2x4EngineLs(window.localStorage.getItem(PLATFORM_COMPOSITE_2X4_ENGINE_LS_KEY));
    } catch {
      return "gpt_image2";
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(PLATFORM_COMPOSITE_2X4_ENGINE_LS_KEY, platformComposite2x4Engine);
    } catch {
      /* ignore */
    }
  }, [platformComposite2x4Engine]);

  const canConfigureCompositeImageTranslator = hasSupervisorOpsAccess;

  /** 与封面进阶开关一致：supervisor 入口 / admin / supervisor，一般用户不可见 */
  const canConfigureStage2CopyEngine = hasSupervisorOpsAccess;

  const canManageWeixinChannelsCollector = hasSupervisorOpsAccess;
  const weixinChannelsCollectorStatusQuery = trpc.mvAnalysis.getWeixinChannelsCollectorStatus.useQuery(
    undefined,
    {
      enabled: canManageWeixinChannelsCollector && isAuthenticated,
      refetchInterval: 15_000,
      refetchOnWindowFocus: false,
      retry: false,
    },
  );
  const setWeixinChannelsCaptureEnabledMutation = trpc.mvAnalysis.setWeixinChannelsCaptureEnabled.useMutation({
    onSuccess: async () => {
      await weixinChannelsCollectorStatusQuery.refetch();
    },
  });

  /**
   * 图文知识卡提炼三档（精细 / 均衡 / 轻量）：用户 2026-08-05 明文开放给所有登录用户自选，
   * 不再只对 supervisor 可见（页费按档位不同，见 KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS）。
   */
  const canChooseKnowledgeCardDistillModel = Boolean(isAuthenticated);

  const [platformCopyLlmEngine, setPlatformCopyLlmEngine] = useState<PlatformCopyLlmEngine>(() =>
    readPlatformCopyLlmEngineFromLs(),
  );

  useEffect(() => {
    try {
      window.localStorage.setItem(PLATFORM_COPY_LLM_ENGINE_LS_KEY, platformCopyLlmEngine);
    } catch {
      /* ignore */
    }
  }, [platformCopyLlmEngine]);

  // Separate state for dashboard — populated by the second call after snapshot loads.
  // 趋势长图以服务端 job 为持久真源；刷新后恢复最新任务，不再依赖旧版完整报表 localStorage。
  const [platformDashboard, setPlatformDashboard] = useState<PlatformDashboard | null>(null);
  const [dashboardDebug, setDashboardDebug] = useState<Record<string, unknown> | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [visualReportData, setVisualReportData] = useState<VisualReportData | null>(null);
  const [visualReportTheme] = useState<VisualReportTheme>("dark");
  const [isVisualReportLoading, setIsVisualReportLoading] = useState(false);
  const [isVisualReportDownloading, setIsVisualReportDownloading] = useState(false);
  const [visualReportError, setVisualReportError] = useState<string | null>(null);
  const visualReportPollingJobRef = useRef<string | null>(null);
  const visualReportOwnerRef = useRef<string | null>(null);
  /** 整段趋势独立分析（快照+看板+PNG）统一忙碌旗，避免只靠 isFetching 卡死「趋势分析中」 */
  const [trendStandaloneBusy, setTrendStandaloneBusy] = useState(false);

  /** 清掉旧版直接塞完整报表的 localStorage；新版本以服务端成功 job 为唯一持久真源。 */
  useEffect(() => {
    clearPlatformVisualReportPersist();
  }, []);

  useEffect(() => {
    const currentUserId = String(user?.id || "").trim() || null;
    if (visualReportOwnerRef.current && visualReportOwnerRef.current !== currentUserId) {
      setVisualReportData(null);
      setVisualReportError(null);
    }
    visualReportOwnerRef.current = currentUserId;
  }, [user?.id]);

  const latestVisualReportQuery = trpc.mvAnalysis.getLatestVisualReport.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const manhuaLearnUserKey = String(user?.id || "").trim();
  /** 平台趋势区子 Tab：指定平台分析 / AI 漫剧专区 */
  const [trendInsightTab, setTrendInsightTab] = useState<"overview" | "ai_manhua">(
    "overview",
  );
  /** AI 漫剧旧榜仍可只读，新的趋势采集平台选择不再包含快手。 */
  const [aiManhuaPlatformTab, setAiManhuaPlatformTab] = useState<"douyin" | "kuaishou">("douyin");
  /** AI 漫剧「学节奏」：当前进行中的行 key；学习/分析结果即时展示后再决定是否进库 */
  const [manhuaLearnBusyKey, setManhuaLearnBusyKey] = useState<string | null>(null);
  const [manhuaPasteUrl, setManhuaPasteUrl] = useState("");
  const [manhuaPasteTitle, setManhuaPasteTitle] = useState("");
  const [manhuaLearnBatchSize, setManhuaLearnBatchSize] = useState(readManhuaLearnBatchSize);
  const [manhuaLearnFocusSeriesKey, setManhuaLearnFocusSeriesKey] = useState("");
  const [manhuaLearnPanelCollapsed, setManhuaLearnPanelCollapsed] = useState(false);
  const [manhuaLearnResult, setManhuaLearnResult] = useState<ManhuaLearnResultUi | null>(null);
  /** 单批完成后由用户决定是否续学；同一 row/rank 复用，服务端按 GCS 检查点跳过已学集。 */
  const manhuaLearnContinueRef = useRef<ManhuaLearnContinuation | null>(null);
  const [manhuaLearnBasket, setManhuaLearnBasket] = useState<ManhuaLearnBasketItem[]>([]);
  const [manhuaLearnHydratedUserKey, setManhuaLearnHydratedUserKey] = useState("");
  const [manhuaLearnActiveJob, setManhuaLearnActiveJob] = useState<ManhuaLearnActiveJob | null>(null);
  const [manhuaLearnServerJobs, setManhuaLearnServerJobs] = useState<ManhuaLearnServerJob[]>([]);
  const [manhuaLearnServerJobsHydrated, setManhuaLearnServerJobsHydrated] = useState(false);
  const [manhuaLearnControlBusy, setManhuaLearnControlBusy] = useState<"cancel" | "skip" | "delete" | null>(null);
  /** 同一页面只允许一个轮询 owner；刷新后新页面从 active job 接手。 */
  const manhuaLearnPollingJobIdRef = useRef<string | null>(null);
  const [manhuaLearnContinueDismissedKey, setManhuaLearnContinueDismissedKey] = useState("");
  const [manhuaLearnMissingDismissedKeys, setManhuaLearnMissingDismissedKeys] = useState<string[]>([]);
  const manhuaLearnUserKeyRef = useRef(manhuaLearnUserKey);
  const manhuaLearnFocusSeriesKeyRef = useRef("");
  const manhuaLearnActiveJobRef = useRef<ManhuaLearnActiveJob | null>(null);

  useEffect(() => {
    manhuaLearnUserKeyRef.current = manhuaLearnUserKey;
    setManhuaLearnBusyKey(null);
    setManhuaPasteUrl("");
    setManhuaPasteTitle("");
    setManhuaLearnServerJobs([]);
    setManhuaLearnServerJobsHydrated(false);
    setManhuaLearnControlBusy(null);
    setManhuaLearnContinueDismissedKey("");
    setManhuaLearnPanelCollapsed(false);
    manhuaLearnPollingJobIdRef.current = null;

    if (!manhuaLearnUserKey) {
      manhuaLearnContinueRef.current = null;
      manhuaLearnFocusSeriesKeyRef.current = "";
      manhuaLearnActiveJobRef.current = null;
      setManhuaLearnFocusSeriesKey("");
      setManhuaLearnResult(null);
      setManhuaLearnBasket([]);
      setManhuaLearnActiveJob(null);
      setManhuaLearnMissingDismissedKeys([]);
      setManhuaLearnHydratedUserKey("");
      setTrendInsightTab("overview");
      return;
    }

    // 旧版无用户作用域记录无法证明归属，不能迁入当前账号；服务端任务表会恢复真实任务。
    clearLegacyManhuaLearnStorage();
    try {
      window.localStorage.removeItem(MANHUA_LEARN_CONTINUATION_LS_KEY);
    } catch {
      /* ignore */
    }
    const activeJob = readManhuaLearnActiveJob(manhuaLearnUserKey);
    const storedFocusSeriesKey = readManhuaLearnFocusSeriesKey(manhuaLearnUserKey);
    const storedBasket = readManhuaLearnBasket(manhuaLearnUserKey);
    const result = readManhuaLearnResult(manhuaLearnUserKey)
      || storedBasket.find((item) => item.seriesKey === storedFocusSeriesKey)?.result
      || null;
    const decision = resolveManhuaLearnReloadDecision({
      focusSeriesKey: storedFocusSeriesKey,
      activeJob,
      result,
    });
    const continuation = decision.restoreContinuation
      ? readManhuaLearnContinuation(manhuaLearnUserKey)
      : null;
    if (decision.clearFailedAutoResume) {
      writeManhuaLearnFocusSeriesKey(manhuaLearnUserKey, "");
      writeManhuaLearnResult(manhuaLearnUserKey, null);
      writeManhuaLearnContinuation(manhuaLearnUserKey, null);
    }
    manhuaLearnContinueRef.current = continuation;
    manhuaLearnFocusSeriesKeyRef.current = decision.focusSeriesKey;
    manhuaLearnActiveJobRef.current = activeJob;
    setManhuaLearnFocusSeriesKey(decision.focusSeriesKey);
    setManhuaLearnResult(decision.result);
    setManhuaLearnBasket(storedBasket);
    setManhuaLearnActiveJob(activeJob);
    setManhuaLearnMissingDismissedKeys(
      readManhuaLearnMissingDismissedKeys(manhuaLearnUserKey),
    );
    setTrendInsightTab(decision.tab);
    setManhuaLearnHydratedUserKey(manhuaLearnUserKey);
  }, [manhuaLearnUserKey]);

  useEffect(() => {
    manhuaLearnFocusSeriesKeyRef.current = manhuaLearnFocusSeriesKey;
  }, [manhuaLearnFocusSeriesKey]);

  useEffect(() => {
    manhuaLearnActiveJobRef.current = manhuaLearnActiveJob;
  }, [manhuaLearnActiveJob]);
  const manhuaLearnFocusSource = String(
    manhuaLearnContinueRef.current?.row.gcsUri
      || manhuaLearnContinueRef.current?.row.url
      || "",
  ).trim();
  const resolvedManhuaLearnFocusSeriesKey = resolveManhuaLearnBasketFocusKey(
    manhuaLearnBasket,
    manhuaLearnFocusSeriesKey,
    manhuaLearnFocusSource,
  );
  const focusedManhuaLearnBasketItem = manhuaLearnBasket.find(
    (item) => item.seriesKey === resolvedManhuaLearnFocusSeriesKey,
  );
  useEffect(() => {
    if (
      manhuaLearnHydratedUserKey !== manhuaLearnUserKey
      || !manhuaLearnUserKey
      || !resolvedManhuaLearnFocusSeriesKey
      || resolvedManhuaLearnFocusSeriesKey === manhuaLearnFocusSeriesKey
    ) return;
    setManhuaLearnFocusSeriesKey(resolvedManhuaLearnFocusSeriesKey);
    writeManhuaLearnFocusSeriesKey(manhuaLearnUserKey, resolvedManhuaLearnFocusSeriesKey);
  }, [
    manhuaLearnFocusSeriesKey,
    manhuaLearnHydratedUserKey,
    manhuaLearnUserKey,
    resolvedManhuaLearnFocusSeriesKey,
  ]);
  /**
   * 控制按钮（停止/跳过）真源：服务端任务列表，而不是 basket 焦点项。
   * 单集升级为合集学习时服务端会换 seriesKey，焦点 key 匹配不上 basket 项，
   * 旧判定会让「学习进行中」却永远看不到停止/跳过按钮（2026-08-11 用户实测）。
   * 兜底顺序：jobId 精确匹配 → seriesKey/来源 URL 匹配 → 全局唯一活跃任务。
   */
  const focusedManhuaLearnServerJob = useMemo(() => {
    const running = manhuaLearnServerJobs.filter(
      (job) => job.status === "queued" || job.status === "running",
    );
    const byJobId =
      manhuaLearnServerJobs.find((job) => job.jobId === focusedManhuaLearnBasketItem?.jobId)
      || null;
    if (byJobId && (byJobId.status === "queued" || byJobId.status === "running")) return byJobId;
    const focusKey = String(manhuaLearnFocusSeriesKey || "").trim();
    const focusSource = String(
      focusedManhuaLearnBasketItem?.continuation.row.gcsUri
        || focusedManhuaLearnBasketItem?.continuation.row.url
        || "",
    ).trim();
    const byKeyOrSource = running.find((job) => {
      const params = job.input?.params || {};
      const source = String(params.dedupeKey || params.gcsUri || params.url || "").trim();
      return (
        (focusKey && String(params.seriesKey || "").trim() === focusKey)
        || (focusKey && String(job.output?.seriesKey || "").trim() === focusKey)
        || (focusSource && source === focusSource)
      );
    });
    if (byKeyOrSource) return byKeyOrSource;
    // 全局唯一活跃任务兜底：只在焦点面板「自认为在跑」却匹配不上时启用——
    // 否则会把停止/跳过误挂到用户正看着的另一部空闲剧上
    const focusClaimsRunning =
      focusedManhuaLearnBasketItem?.jobStatus === "queued"
      || focusedManhuaLearnBasketItem?.jobStatus === "running"
      || focusedManhuaLearnBasketItem?.result.liveStatus === "queued"
      || focusedManhuaLearnBasketItem?.result.liveStatus === "running";
    if (running.length === 1 && (focusClaimsRunning || !focusedManhuaLearnBasketItem)) {
      return running[0];
    }
    return byJobId;
  }, [manhuaLearnServerJobs, focusedManhuaLearnBasketItem, manhuaLearnFocusSeriesKey]);
  const focusedManhuaNativeModelReceipts = useMemo(
    () => parseManhuaNativeModelReceipts(
      focusedManhuaLearnServerJob?.output?.nativeModelReceipts,
    ),
    [focusedManhuaLearnServerJob?.output?.nativeModelReceipts],
  );
  const focusedManhuaLearnJobActive =
    focusedManhuaLearnBasketItem?.jobStatus === "queued"
    || focusedManhuaLearnBasketItem?.jobStatus === "running"
    || focusedManhuaLearnServerJob?.status === "queued"
    || focusedManhuaLearnServerJob?.status === "running";
  const focusedManhuaLearnEpisodeIndex = Math.max(
    0,
    Math.floor(Number(focusedManhuaLearnServerJob?.output?.currentEpisodeIndex) || 0),
  );
  const activeManhuaLearnSources = useMemo(() => new Set(
    manhuaLearnServerJobs
      .filter((job) => job.status === "queued" || job.status === "running")
      .map((job) => String(
        job.input?.params?.dedupeKey
          || job.input?.params?.gcsUri
          || job.input?.params?.url
          || "",
      ).trim())
      .filter(Boolean),
  ), [manhuaLearnServerJobs]);
  const manhuaLearnContinueControl = getManhuaLearnContinueControl({
    pendingCount: manhuaLearnResult?.pendingCount,
    hasContinuation: Boolean(manhuaLearnContinueRef.current),
    busy: Boolean(manhuaLearnBusyKey),
    active: focusedManhuaLearnJobActive,
  });

  useEffect(() => {
    const continuation = manhuaLearnContinueRef.current;
    if (
      !manhuaLearnUserKey
      || manhuaLearnHydratedUserKey !== manhuaLearnUserKey
    ) {
      return;
    }
    writeManhuaLearnResult(manhuaLearnUserKey, manhuaLearnResult);
    if (!manhuaLearnResult || !continuation) {
      return;
    }
    setManhuaLearnBasket((prev) => {
      const next = upsertManhuaLearnBasketItem(prev, {
        seriesKey: manhuaLearnResult.seriesKey,
        continuation: {
          ...continuation,
          seriesKey: manhuaLearnResult.seriesKey,
        },
        result: manhuaLearnResult,
        updatedAt: Date.now(),
      });
      writeManhuaLearnBasket(manhuaLearnUserKey, next);
      return next;
    });
  }, [manhuaLearnHydratedUserKey, manhuaLearnResult, manhuaLearnUserKey]);
  const visualReportRef = useRef<HTMLDivElement>(null);
  // Call 3 state — content blueprints and monetization
  const [platformContent, setPlatformContent] = useState<{ contentBlueprints: PlatformDashboard["contentBlueprints"]; monetizationLanes: PlatformDashboard["monetizationLanes"] } | null>(null);
  const [contentDebug, setContentDebug] = useState<Record<string, unknown> | null>(null);
  const [isContentLoading, setIsContentLoading] = useState(false);
  /** 战略地图会话内额外执行选题：自动赠送 + 用户点选扩写（仅内存，刷新后清空） */
  const [strategicMapSessionExecutionCards, setStrategicMapSessionExecutionCards] = useState<
    PlatformContentExecutionCard[]
  >([]);
  const [generatingStrategicMapTopicKey, setGeneratingStrategicMapTopicKey] = useState<string | null>(null);
  /** Stage 2：伫列/worker 状态文案（不宣称具体模型已完成，仅描述后台进度） */
  const [contentLoadingText, setContentLoadingText] = useState("等待战略看板就绪…");
  const [stage2Failed, setStage2Failed] = useState(false);
  /** Stage 2：platform_build_content job + GET /api/jobs 轮询时的错误说明 */
  const [contentJobError, setContentJobError] = useState<string | null>(null);
  /** 供「重新生成文案」：上次入队的快照（避免虚构成功） */
  const lastStage2InputRef = useRef<{ snapshotSummary: Record<string, unknown>; windowDays: PlatformWindowDays } | null>(
    null,
  );
  /** Debug：Stage 2 文案 job 的 jobId、每次 GET、终态 */
  const [contentJobPollTrace, setContentJobPollTrace] = useState<ClientJobPollTrace | null>(null);
  /** Debug：最近一次封面单帧 job 的轮询（新任务会覆盖） */
  const [topicImageJobPollTrace, setTopicImageJobPollTrace] = useState<ClientJobPollTrace | null>(null);
  /** Debug：2×4 分镜 / 八格图文 合成 job（含 progressJobId、轮询次数） */
  const [compositeJobPollTrace, setCompositeJobPollTrace] = useState<ClientJobPollTrace | null>(null);
  /** Debug：AI 漫剧「学节奏」云端 Job 轮询（阶段日志 + 终态错误） */
  const [manhuaLearnJobPollTrace, setManhuaLearnJobPollTrace] = useState<ClientJobPollTrace | null>(null);
  useEffect(() => {
    setManhuaLearnJobPollTrace(null);
  }, [manhuaLearnUserKey]);
  /** Stage 2：有 platformContent 物件但选题与变现皆 0 条 — 假成功，须与真完成区分 */
  const stage2EmptyPayload = useMemo(() => {
    if (!platformContent) return false;
    const bp = Array.isArray(platformContent.contentBlueprints) ? platformContent.contentBlueprints.length : 0;
    const ml = Array.isArray(platformContent.monetizationLanes) ? platformContent.monetizationLanes.length : 0;
    return bp === 0 && ml === 0;
  }, [platformContent]);

  /** 与后台实际结果一致：不宣称具体模型「已完成」，只描述任务状态 */
  const stage2UserFacingLine = useMemo(() => {
    if (isContentLoading) return contentLoadingText;
    if (stage2Failed || contentJobError) return `无法完成：${contentJobError || "请重试"}`;
    if (stage2EmptyPayload) {
      return "后台已返回，但没有有效选题（0 条）。请展开 Debug「Stage 2」或点击重试（将再次扣除积分）。";
    }
    if (platformContent && !stage2EmptyPayload) {
      return "✅ 专属选题与文案已由后台写入（可下滑查看卡片）";
    }
    if (platformDashboard && !platformContent) {
      return "战略看板已就绪。若流程中断，可点下方手动「生成专属文案」继续。";
    }
    return `点击「生成选题」：一次出 ${PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT}–${PLATFORM_TOPIC_SHORTLIST_MAX} 条选题；挑中哪条再点「就写这条」写文案。`;
  }, [
    isContentLoading,
    contentLoadingText,
    stage2Failed,
    contentJobError,
    stage2EmptyPayload,
    platformContent,
    platformDashboard,
  ]);
  const isTrial = useIsTrialUser();
  const [platformImageMap, setPlatformImageMap] = useState<Record<string, string>>({});
  /** 每条选题：用户上传的人像参考图（GCS 直链）→ 生成封面时换主角。key=sceneId；可覆盖全局人像 */
  const [coverReferencePhotoMap, setCoverReferencePhotoMap] = useState<Record<string, string>>({});
  /** 全局主人公照片（一键套装上方上传）→ 默认套用全部选题；单卡可覆盖 */
  const [globalCoverReferencePhotoUrl, setGlobalCoverReferencePhotoUrl] = useState<string | null>(null);
  const [globalCoverRefUploading, setGlobalCoverRefUploading] = useState(false);
  /** 正在上传人像参考图的 sceneId 集合（上传期间禁用生成按钮） */
  const [coverRefUploadingIds, setCoverRefUploadingIds] = useState<Set<string>>(() => new Set());
  /** 用户发起封面绘制后置为 true；收起条件为当前视窗内每一条选题均有有效封面 URL（与 Stage1 轮播只看「任务旗标」区分）。 */
  const [coverWaitCarouselEngaged, setCoverWaitCarouselEngaged] = useState(false);
  const [coverLoadRetriedIds, setCoverLoadRetriedIds] = useState<Set<string>>(() => new Set());
  const [compositeLoadRetriedKeys, setCompositeLoadRetriedKeys] = useState<Set<string>>(() => new Set());
  /** 横版 16:9 执行分镜表（单张合成）；API `kind` 使用 `storyboard_sheet_landscape`（旧别名 `storyboard_sheet_portrait` 服端视为同一产物）。 */
  const [platformStoryboardSheetMap, setPlatformStoryboardSheetMap] = useState<Record<string, string>>({});
  /** 小红书双笔记卡（单张合成） */
  const [platformXhsNoteMap, setPlatformXhsNoteMap] = useState<Record<string, string>>({});
  /** 自定義文案生成圖文筆記（獨立功能，不依賴 Stage 1/2） */
  const [customNoteText, setCustomNoteText] = useState("");
  /** 知識卡片：上篇圖（分鏡圖也用此槽，單張）。 */
  const [customNoteImageUpper, setCustomNoteImageUpper] = useState<string | null>(null);
  /** 知識卡片：下篇圖（分鏡圖不使用）。 */
  const [customNoteImageLower, setCustomNoteImageLower] = useState<string | null>(null);
  /** 多页知识卡结果（1…N）。 */
  const [customNoteImages, setCustomNoteImages] = useState<string[]>([]);
  const [customNoteError, setCustomNoteError] = useState<string | null>(null);
  /** 生成中（上篇/下篇/單張共用一個忙碌旗標）。 */
  const [customNoteBusy, setCustomNoteBusy] = useState(false);
  /** 進度提示：目前正在生成哪一篇（上篇/下篇），分鏡為 null。 */
  const [customNotePartInFlight, setCustomNotePartInFlight] = useState<"upper" | "lower" | null>(null);
  /** 多页进度：第 i/N 页；null=非知识卡多页。 */
  const [customNotePageProgress, setCustomNotePageProgress] = useState<{ i: number; n: number } | null>(null);
  const [customNoteUploadBusy, setCustomNoteUploadBusy] = useState(false);
  const [customNoteDistillModel, setCustomNoteDistillModel] = useState<KnowledgeCardDistillModelId>(() => {
    try {
      const raw = localStorage.getItem("mvs-knowledge-card-distill-model");
      // 旧 terra / OR-qwen slug 由 resolve 迁到 Sol / Evolink Qwen
      return resolveKnowledgeCardDistillModel(raw);
    } catch {
      return KNOWLEDGE_CARD_DISTILL_MODEL_SOL;
    }
  });
  /** 待随「生成」一并提炼的上传文件（含图片 OCR）。 */
  const customNotePendingFilesRef = useRef<KnowledgeCardPendingFile[]>([]);
  /** 上传区可见状态（成功/失败），避免只靠 toast */
  const [customNoteUploadStatus, setCustomNoteUploadStatus] = useState<string | null>(null);
  const [customNotePendingMeta, setCustomNotePendingMeta] = useState<Array<{ fileName: string; kind: "doc" | "image" }>>([]);
  /** 提炼完成后先展示再出图 */
  const [customNoteDistillPhase, setCustomNoteDistillPhase] = useState<"idle" | "distilling" | "ready">("idle");
  /** 用戶自選生成類型：單頁連貫圖文知識卡片 or 2×4 分鏡圖 or 深度优化文案（自定義文案專用） */
  const [customNoteKind, setCustomNoteKind] = useState<
    "single_page_knowledge_card" | "storyboard_sheet_landscape" | "optimize_custom_copy"
  >("single_page_knowledge_card");
  /** 百科可视化：只选版式；主题以正文为准，提示词后台注入 */
  const [customNoteInfographicTemplateId, setCustomNoteInfographicTemplateId] = useState<string | null>(
    null,
  );
  const [customNoteInfographicLabelZh, setCustomNoteInfographicLabelZh] = useState<string | null>(null);
  /** 深度优化：用户额外要求（封面/分镜/平台等） */
  const [customOptimizeBrief, setCustomOptimizeBrief] = useState("");
  /** 深度优化结果（Markdown） */
  const [customOptimizeResult, setCustomOptimizeResult] = useState<string | null>(null);
  const [customOptimizeSummary, setCustomOptimizeSummary] = useState<string | null>(null);
  const [isDownloadingCustomCopyPdf, setIsDownloadingCustomCopyPdf] = useState(false);
  /** 素材分析 → 深度优化：附带 vision 上下文与 live 趋势（一次性消费） */
  const pendingOptimizeVisionRef = useRef<string | undefined>(undefined);
  const pendingOptimizeLiveTrendsRef = useRef(false);
  const [assetAnalysisBusy, setAssetAnalysisBusy] = useState(false);
  const [locationPath, setLocationPath] = useLocation();
  /** 素材分析完成后的拍摄手法摘要，注入分镜 scriptContext */
  const lastShootingTechniqueBriefRef = useRef<string>("");
  /** 自定义工作区 Tab：粘贴文案生图 vs 主人公融合选题 vs 文生图海报 vs 自定义抠像 */
  const [customWorkspaceTab, setCustomWorkspaceTab] = useState<
    "copy" | "topic" | "imageGen" | "matting" | "assets" | "htmlPpt"
  >("copy");
  /** 顶栏双模式 + 更多工具（URL ?mode= / localStorage） */
  const [platformMode, setPlatformMode] = useState<PlatformWorkbenchMode>(() =>
    resolvePlatformLocation().mode,
  );
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [createStep, setCreateStep] = useState<PlatformCreateStepId>("persona");
  /** 这轮想获客/转化/涨粉：独立参数进选题提示词，不是装饰标签（用户 2026-08-06） */
  const [topicGoal, setTopicGoal] = useState<PlatformTopicGoalId | null>(null);
  const [structuredPersona, setStructuredPersona] = useState<PlatformStructuredPersona>({
    ...EMPTY_STRUCTURED_PERSONA,
  });
  const [outputType, setOutputType] = useState<PlatformOutputType | null>(null);
  const [configPresets, setConfigPresets] = useState<PlatformConfigPreset[]>([]);
  const [recentTasks, setRecentTasks] = useState<PlatformRecentTask[]>([]);
  const [draftMeta, setDraftMeta] = useState<{ savedAt: string } | null>(null);
  const [skillDrawerOpen, setSkillDrawerOpen] = useState(false);
  const [personaFieldErrors, setPersonaFieldErrors] = useState<
    Partial<Record<keyof PlatformStructuredPersona | "freeform", string>>
  >({});
  /** 完整描述是否被用户手动改写（canonical 仍为 structuredPersona） */
  const [freeformOverride, setFreeformOverride] = useState(false);
  const ctaInFlightRef = useRef(false);
  const platformModeRef = useRef<PlatformWorkbenchMode>(platformMode);
  const applyingFromHistoryRef = useRef(false);
  platformModeRef.current = platformMode;

  /** 仅登录且 auth 完成后才有稳定 userKey；禁止全体 anon 共桶 */
  const workbenchUserKey = !loading && user?.id != null ? String(user.id) : null;
  const workbenchStorageReady = Boolean(workbenchUserKey);

  useEffect(() => {
    if (!workbenchStorageReady || !workbenchUserKey) {
      // 登出 / 未 hydration：清内存草稿，避免串号
      setDraftMeta(null);
      setConfigPresets([]);
      setRecentTasks([]);
      return;
    }
    try {
      const draft = readWorkbenchDraft(workbenchUserKey);
      setConfigPresets(readConfigPresets(workbenchUserKey));
      setRecentTasks(readRecentTasks(workbenchUserKey));
      if (draft) {
        setDraftMeta({ savedAt: draft.updatedAt });
        setFocusPrompt((prev) => (prev.trim() ? prev : draft.focusPrompt || ""));
        if (draft.persona) setStructuredPersona(draft.persona);
        setFreeformOverride(Boolean(draft.freeformOverride));
        if (draft.outputType) setOutputType(draft.outputType);
        if (draft.createStep) setCreateStep(draft.createStep);
      } else {
        setDraftMeta(null);
      }
    } catch {
      setDraftMeta(null);
      setConfigPresets([]);
      setRecentTasks([]);
    }
  }, [workbenchStorageReady, workbenchUserKey]);

  const applyPlatformMode = useCallback(
    (next: PlatformWorkbenchMode, opts?: { toolTab?: "htmlPpt" | "matting" | "assets"; skipDirtyCheck?: boolean; history?: "push" | "replace" }) => {
      if (!opts?.skipDirtyCheck && next !== platformMode) {
        const draft = workbenchUserKey ? readWorkbenchDraft(workbenchUserKey) : null;
        const dirty =
          Boolean(focusPrompt.trim()) &&
          (!draft || draft.focusPrompt !== focusPrompt.trim());
        if (dirty) {
          const ok = window.confirm(
            "当前人物背景尚未写入草稿，切换模式前要先自动保存吗？\n\n确定=保存并切换；取消=留在当前模式。",
          );
          if (!ok) return;
          if (workbenchUserKey) {
            writeWorkbenchDraft(workbenchUserKey, {
              mode: platformMode,
              focusPrompt,
              persona: structuredPersona,
              freeformOverride,
              enabledSkillIds: draft?.enabledSkillIds ?? [],
              topicShortlistCount: draft?.topicShortlistCount ?? PLATFORM_TOPIC_SHORTLIST_DEFAULT,
              outputType: outputType ?? draft?.outputType ?? "single_page",
              createStep,
            });
            setDraftMeta({ savedAt: new Date().toISOString() });
            trackPlatformFunnel("draft_save", { reason: "mode_switch", mode: platformMode });
          }
        }
      }
      setPlatformMode(next);
      writePlatformModeToStorage(next);
      const tab = opts?.toolTab
        ? opts.toolTab
        : next === "tools"
          ? customWorkspaceTab === "htmlPpt" ||
              customWorkspaceTab === "matting" ||
              customWorkspaceTab === "assets"
            ? customWorkspaceTab
            : resolvePlatformLocation().tool
          : toolsTabFromMode(next, customWorkspaceTab);
      setCustomWorkspaceTab(tab);
      // popstate 还原时禁止再 push，避免历史膨胀
      if (!applyingFromHistoryRef.current) {
        syncPlatformModeToUrl(next, {
          tool:
            next === "tools" && (tab === "htmlPpt" || tab === "matting" || tab === "assets")
              ? tab
              : undefined,
          createTab: next === "create" ? (tab === "topic" ? "topic" : "copy") : undefined,
          history: opts?.history ?? "push",
        });
        try {
          const url = new URL(window.location.href);
          const path = `${url.pathname}${url.search}${url.hash}`;
          setLocationPath(path.startsWith("/platform") ? path : `/platform${url.search}`);
        } catch {
          /* ignore */
        }
      }
      trackPlatformFunnel("mode_switch", { mode: next, tool: next === "tools" ? String(tab) : undefined });
    },
    [
      platformMode,
      focusPrompt,
      structuredPersona,
      freeformOverride,
      outputType,
      createStep,
      customWorkspaceTab,
      setLocationPath,
      workbenchUserKey,
    ],
  );

  useEffect(() => {
    trackPlatformFunnel("mode_view", { mode: platformMode });
  }, [platformMode]);

  // URL 初始化 + popstate（前进/后退）；popstate 只读状态，不 push 历史
  useEffect(() => {
    const LEGACY_TOAST_KEY = "mvs.platform.legacyVideoToast.v1";
    const applyFromLocation = (opts?: { scroll?: boolean; fromPopstate?: boolean }) => {
      applyingFromHistoryRef.current = Boolean(opts?.fromPopstate);
      try {
        const loc = resolvePlatformLocation(window.location.search);
        if (loc.normalized || loc.legacyVideoMapped) {
          normalizePlatformUrlInPlace(loc); // replaceState only
        }
        setPlatformMode(loc.mode);
        writePlatformModeToStorage(loc.mode);
        if (loc.mode === "tools") {
          setCustomWorkspaceTab(loc.tool);
          if (loc.legacyVideoMapped) {
            try {
              if (sessionStorage.getItem(LEGACY_TOAST_KEY) !== "1") {
                sessionStorage.setItem(LEGACY_TOAST_KEY, "1");
                toast.message(LEGACY_VIDEO_TO_ASSETS_HINT);
                trackPlatformFunnel("legacy_tab_mapped", { legacy: "video", tool: "assets" });
              }
            } catch {
              /* ignore */
            }
          }
          if (opts?.scroll !== false && loc.tool === "assets") {
            window.setTimeout(() => {
              document.getElementById("platform-custom-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 80);
          }
        } else if (loc.mode === "create") {
          setCustomWorkspaceTab(loc.createTab);
        }
      } finally {
        applyingFromHistoryRef.current = false;
      }
    };
    applyFromLocation({ scroll: true, fromPopstate: false });
    const onPop = () => applyFromLocation({ scroll: false, fromPopstate: true });
    window.addEventListener("popstate", onPop);
    window.addEventListener("mvs:platform-tab", onPop as EventListener);
    return () => {
      window.removeEventListener("popstate", onPop);
      window.removeEventListener("mvs:platform-tab", onPop as EventListener);
    };
    // 仅挂载时绑定；后续靠 popstate / 显式 applyPlatformMode，避免 locationPath 循环写历史
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openVideoDeepBreakdown = useCallback(() => {
    applyPlatformMode("tools", { toolTab: "assets" });
    window.setTimeout(() => {
      document.getElementById("platform-custom-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }, [applyPlatformMode]);

  /** 自定义选题：选题标题（可选）、主人公特质、参考人像、分镜网格 */
  const [customTopicTitle, setCustomTopicTitle] = useState("");
  const [customTopicProtagonist, setCustomTopicProtagonist] = useState("");
  const [customTopicPhotoUrl, setCustomTopicPhotoUrl] = useState<string | null>(null);
  const [customTopicPhotoPreview, setCustomTopicPhotoPreview] = useState<string | null>(null);
  const [customTopicPhotoUploading, setCustomTopicPhotoUploading] = useState(false);
  const [customTopicGridVariant, setCustomTopicGridVariant] = useState<"2x4" | "3x4">("2x4");
  const [customTopicBusy, setCustomTopicBusy] = useState(false);
  const [customTopicPhase, setCustomTopicPhase] = useState<"idle" | "copy" | "images">("idle");
  const [customTopicCard, setCustomTopicCard] = useState<PlatformContentExecutionCard | null>(null);
  const [customTopicCoverUrl, setCustomTopicCoverUrl] = useState<string | null>(null);
  const [customTopicStoryboardUrl, setCustomTopicStoryboardUrl] = useState<string | null>(null);
  const [customTopicError, setCustomTopicError] = useState<string | null>(null);
  /** 自定义抠像：提示词、比例、张数、结果 */
  const [customMattingPrompt, setCustomMattingPrompt] = useState("");
  const [customMattingAspect, setCustomMattingAspect] = useState<PlatformMattingAspectRatio>("9:16");
  const [customMattingCount, setCustomMattingCount] = useState<PlatformMattingBatchCount>(1);
  const [customMattingBusy, setCustomMattingBusy] = useState(false);
  const [customMattingImages, setCustomMattingImages] = useState<string[]>([]);
  const [customMattingTransparentCutout, setCustomMattingTransparentCutout] = useState(false);
  const [customMattingError, setCustomMattingError] = useState<string | null>(null);
  const customWorkspaceOperating =
    customNoteBusy || customTopicBusy || customMattingBusy;
  /** 自定义选题：勾选生成项（文案 / 封面 / 分镜） */
  const [customTopicGenCopy, setCustomTopicGenCopy] = useState(true);
  const [customTopicGenCover, setCustomTopicGenCover] = useState(true);
  const [customTopicGenStoryboard, setCustomTopicGenStoryboard] = useState(true);
  /** Platform 可挂载 Skill：勾选 id（localStorage 持久化） */
  const [enabledPlatformSkillIds, setEnabledPlatformSkillIds] = useState<Set<string>>(() => {
    return readEnabledPlatformSkillIdsFromLs() ?? new Set();
  });
  const [platformSkillIdsHydrated, setPlatformSkillIdsHydrated] = useState(
    () => readEnabledPlatformSkillIdsFromLs() != null,
  );
  const [platformSkillUploading, setPlatformSkillUploading] = useState(false);
  const [skillQaQuestion, setSkillQaQuestion] = useState("");
  const [skillQaAnswer, setSkillQaAnswer] = useState("");
  const [skillQaRemaining, setSkillQaRemaining] = useState<number | null>(null);
  // 只剩标准档：不再有切换入口，也不必读写 localStorage
  const [skillQaModel] = useState<PlatformSkillQaModelChoice>("gpt-5.6-terra");
  const [skillQaImageOffer, setSkillQaImageOffer] = useState<null | {
    creationRelated: boolean;
    suggestedPrompt: string;
    creditCost: number;
    isFirstImageDiscount: boolean;
    guideMessage: string;
  }>(null);
  const [skillQaImageUrl, setSkillQaImageUrl] = useState<string | null>(null);
  const askPlatformSkillQaMutation = trpc.mvAnalysis.askPlatformSkillQa.useMutation();
  const confirmPlatformSkillQaImageMutation = trpc.mvAnalysis.confirmPlatformSkillQaImage.useMutation();
  const approveManhuaViralTemplateMutation = trpc.manhuaViralTemplate.approve.useMutation();
  /** 下架待确认的模板 id：点第一次进入确认态，再点一次才真下架 */
  const [archiveConfirmId, setArchiveConfirmId] = useState("");
  const archiveManhuaTemplateMutation = trpc.manhuaViralTemplate.archiveApproved.useMutation();
  /* ── 换代体检与归档回看：学习方式升级后，得先看得出哪些是旧一代学的 ── */
  const [templateReviewOpen, setTemplateReviewOpen] = useState(false);
  const [archivedForId, setArchivedForId] = useState<string | null>(null);
  const manhuaTemplateOwnerCapabilitiesQuery =
    trpc.manhuaViralTemplate.getOwnerOptimizeCapabilities.useQuery(
      { cacheScope: manhuaLearnUserKey || "anonymous" },
      {
        enabled: trendInsightTab === "ai_manhua" && Boolean(user?.id),
        staleTime: 5 * 60_000,
        retry: false,
      },
    );
  // owner 能力只能信服务端本次回包。localStorage 可由浏览器任意改写，不能当授权依据。
  const ownerTemplateOptimizeAllowed =
    manhuaTemplateOwnerCapabilitiesQuery.data?.allowed === true;
  const ownerTemplateCapabilityPending =
    aiManhuaPlatformTab === "douyin"
    && trendInsightTab === "ai_manhua"
    && Boolean(user?.id)
    && manhuaTemplateOwnerCapabilitiesQuery.isLoading;
  const ownerTemplateOptimizeModels =
    manhuaTemplateOwnerCapabilitiesQuery.data?.models || [];
  const ownerNativeDeepReadPanel =
    aiManhuaPlatformTab === "douyin" && ownerTemplateOptimizeAllowed;
  const canSeeManhuaLearnTechnicalDetails =
    hasSupervisorOpsAccess || ownerTemplateOptimizeAllowed;
  const manhuaLearnPipelineMeta = getManhuaLearnPipelineMeta({
    nativeDeepRead: ownerNativeDeepReadPanel,
  });
  /**
   * 占位管理（0826 用户点名）：历史占位此前没有任何 UI 入口，全靠助手代办。
   * 列表列出该剧仍在占位的集（集数/占位时间/已花金额/卡点），弃置由用户亲手点。
   * 「弃置并设 1 集」只做弃置＋把批量设为 1；计划仍按最早待学集选择，不冒充定向重跑。
   */
  const [manhuaClaimsPanelOpen, setManhuaClaimsPanelOpen] = useState(false);
  const [manhuaClaimBusyEpisode, setManhuaClaimBusyEpisode] = useState<number | null>(null);
  const manhuaClaimsQuery = trpc.manhuaViralTemplate.listNativeDeepReadClaims.useQuery(
    { seriesKey: resolvedManhuaLearnFocusSeriesKey },
    {
      enabled:
        ownerNativeDeepReadPanel
        && manhuaClaimsPanelOpen
        && Boolean(resolvedManhuaLearnFocusSeriesKey),
      staleTime: 30_000,
      retry: false,
    },
  );
  const manhuaClaimsRefetchRef = useRef(manhuaClaimsQuery.refetch);
  const manhuaClaimsCanRefetchRef = useRef(false);
  useEffect(() => {
    manhuaClaimsRefetchRef.current = manhuaClaimsQuery.refetch;
    manhuaClaimsCanRefetchRef.current = Boolean(
      ownerNativeDeepReadPanel
      && manhuaClaimsPanelOpen
      && resolvedManhuaLearnFocusSeriesKey,
    );
  }, [
    manhuaClaimsQuery.refetch,
    manhuaClaimsPanelOpen,
    ownerNativeDeepReadPanel,
    resolvedManhuaLearnFocusSeriesKey,
  ]);
  const discardManhuaClaimMutation = trpc.manhuaViralTemplate.discardNativeDeepReadClaim.useMutation();
  const discardManhuaClaim = useCallback(async (
    episodeIndex: number,
    claimGeneration: string | null,
    setSingleEpisodeAfter: boolean,
  ) => {
    const seriesKey = resolvedManhuaLearnFocusSeriesKey;
    if (!seriesKey || !claimGeneration) return;
    if (!window.confirm(
      `弃置第 ${episodeIndex} 集的占位？已花费用不退；弃置后这一集会重新纳入学习计划。`,
    )) return;
    setManhuaClaimBusyEpisode(episodeIndex);
    try {
      await discardManhuaClaimMutation.mutateAsync({
        seriesKey,
        episodeIndex,
        claimGeneration,
        confirmDiscard: true,
      });
      await manhuaClaimsQuery.refetch();
      if (setSingleEpisodeAfter) {
        setManhuaLearnBatchSize(1);
        writeManhuaLearnBatchSize(1);
        toast.success(`第 ${episodeIndex} 集占位已弃置；批量已设为 1，下次会处理计划中的最早待学集`);
      } else {
        toast.success(`第 ${episodeIndex} 集占位已弃置`);
      }
    } catch (error) {
      toast.error(
        `弃置失败：${error instanceof Error ? error.message.slice(0, 120) : "请稍后重试"}`,
      );
    } finally {
      setManhuaClaimBusyEpisode(null);
    }
  }, [
    resolvedManhuaLearnFocusSeriesKey,
    discardManhuaClaimMutation,
    manhuaClaimsQuery,
  ]);
  /**
   * 生命周期三条链路（换代体检 / 归档查看 / 恢复）**仅 owner 可见**。
   *
   * 声明必须排在 `ownerTemplateOptimizeAllowed` 之后：原来放在它前面，
   * `enabled` 里根本拿不到这个值 —— 于是非 owner 也会看到入口、也会发出请求，
   * 要等服务端拒绝才知道不能用。门禁得在按钮出现之前就生效。
   */
  const templateReviewQuery = trpc.manhuaViralTemplate.reviewTemplateGenerations.useQuery(
    undefined,
    {
      enabled: ownerTemplateOptimizeAllowed && templateReviewOpen,
      staleTime: 60_000,
      retry: false,
    },
  );
  const archivedVersionsQuery = trpc.manhuaViralTemplate.listArchivedVersions.useQuery(
    { id: archivedForId || "" },
    {
      enabled: ownerTemplateOptimizeAllowed && Boolean(archivedForId),
      retry: false,
    },
  );
  const restoreArchivedMutation = trpc.manhuaViralTemplate.restoreArchived.useMutation();

  /**
   * 生命周期相关缓存的**唯一**失效入口。
   *
   * 批准 / 下架 / 恢复三个动作都会改变「哪些卡是现役的」，
   * 而换代体检、归档列表、canvas 可选模板读的是三份不同缓存 ——
   * 少刷一处，用户就会看到自相矛盾的页面（体检说该换，库里已经换过了）。
   */
  const invalidateTemplateLifecycle = useCallback(
    async (id?: string) => {
      const tasks: Promise<unknown>[] = [
        trpcUtils.manhuaViralTemplate.listApprovedPrivate.invalidate(),
        trpcUtils.manhuaViralTemplate.listApprovedPublic.invalidate(),
        trpcUtils.manhuaViralTemplate.reviewTemplateGenerations.invalidate(),
      ];
      if (id) {
        tasks.push(trpcUtils.manhuaViralTemplate.listArchivedVersions.invalidate({ id }));
      }
      await Promise.all(tasks);
    },
    [trpcUtils],
  );

  const manhuaViralProposalsQuery = trpc.manhuaViralTemplate.listProposals.useQuery(
    undefined,
    {
      enabled:
        trendInsightTab === "ai_manhua" &&
        (hasSupervisorOpsAccess || ownerTemplateOptimizeAllowed),
      staleTime: 30_000,
      retry: false,
    },
  );
  const pendingManhuaViralProposals = useMemo(
    () => (manhuaViralProposalsQuery.data?.items || []).filter((item) => item.status !== "approved"),
    [manhuaViralProposalsQuery.data?.items],
  );
  /**
   * tRPC query result 对象会随 render 换引用；轮询 callback 若依赖整个对象，
   * setState → render → effect 重启 → 立刻再 GET，最终把 3 秒轮询打成无间隔请求。
   * ref 只更新可调用函数，不改变轮询 effect 的身份。
   */
  const manhuaViralProposalsRefetchRef = useRef(manhuaViralProposalsQuery.refetch);
  useEffect(() => {
    manhuaViralProposalsRefetchRef.current = manhuaViralProposalsQuery.refetch;
  }, [manhuaViralProposalsQuery.refetch]);
  const nativeProposalRefreshSignatureRef = useRef("");
  useEffect(() => {
    nativeProposalRefreshSignatureRef.current = "";
  }, [manhuaLearnUserKey]);
  const [selectedManhuaProposalId, setSelectedManhuaProposalId] = useState("");
  const selectedManhuaProposal = useMemo(
    () => pendingManhuaViralProposals.find((item) => item.id === selectedManhuaProposalId)
      || pendingManhuaViralProposals[0]
      || null,
    [pendingManhuaViralProposals, selectedManhuaProposalId],
  );
  useEffect(() => {
    if (!pendingManhuaViralProposals.length) {
      setSelectedManhuaProposalId("");
      return;
    }
    if (!pendingManhuaViralProposals.some((item) => item.id === selectedManhuaProposalId)) {
      setSelectedManhuaProposalId(pendingManhuaViralProposals[0].id);
    }
  }, [pendingManhuaViralProposals, selectedManhuaProposalId]);

  const refreshManhuaLearnServerJobs = useCallback(async () => {
    const requestUserKey = manhuaLearnUserKeyRef.current;
    if (!requestUserKey) return { items: [] as ManhuaLearnServerJob[] };
    const listed = await listManhuaLearnServerJobs();
    // 账号切换时丢弃旧请求回包，禁止上一账号的选中项、面板或任务写入新页面。
    if (manhuaLearnUserKeyRef.current !== requestUserKey) {
      return { items: [] as ManhuaLearnServerJob[] };
    }
    setManhuaLearnServerJobs((prev) =>
      reuseManhuaLearnServerJobsIfUnchanged(prev, listed.items));
    setManhuaLearnServerJobsHydrated(true);
    setManhuaLearnBasket((prev) => {
      const merged = demoteStaleRunningManhuaLearnItems(
        mergeManhuaLearnServerJobsIntoBasket(prev, listed.items),
        listed.items,
      );
      writeManhuaLearnBasket(requestUserKey, merged);
      const focused = merged.find(
        (item) => item.seriesKey === manhuaLearnFocusSeriesKeyRef.current,
      );
      if (focused) {
        setManhuaLearnResult((prev) =>
          reuseManhuaLearnResultIfUnchanged(prev, focused.result));
      }
      return merged;
    });
    const legacy = manhuaLearnActiveJobRef.current;
    if (legacy && listed.items.some((job) => job.jobId === legacy.jobId)) {
      setManhuaLearnActiveJob(null);
      writeManhuaLearnActiveJob(requestUserKey, null);
    }
    const nativeTerminalSignature = nativeLearnTerminalProposalRefreshSignature(listed.items);
    if (
      nativeTerminalSignature
      && nativeTerminalSignature !== nativeProposalRefreshSignatureRef.current
    ) {
      let terminalRefreshFailed = false;
      try {
        const refreshed = await manhuaViralProposalsRefetchRef.current();
        if (refreshed.isError) throw refreshed.error;
        if (manhuaLearnUserKeyRef.current !== requestUserKey) return listed;
      } catch (error) {
        // job 恢复不能被待审列表的一次读取失败拖垮；不记签名，下一轮轮询继续重试。
        terminalRefreshFailed = true;
        console.warn("[manhua-learn] refresh native proposals failed", error);
      }
      if (manhuaClaimsCanRefetchRef.current) {
        try {
          const refreshed = await manhuaClaimsRefetchRef.current();
          if (refreshed.isError) throw refreshed.error;
          if (manhuaLearnUserKeyRef.current !== requestUserKey) return listed;
        } catch (error) {
          terminalRefreshFailed = true;
          console.warn("[manhua-learn] refresh native claims failed", error);
        }
      }
      if (!terminalRefreshFailed) {
        nativeProposalRefreshSignatureRef.current = nativeTerminalSignature;
      }
    }
    return listed;
  }, []);

  const stopFocusedManhuaLearnJob = useCallback(async () => {
    const jobId = focusedManhuaLearnServerJob?.jobId || focusedManhuaLearnBasketItem?.jobId;
    if (!jobId || manhuaLearnControlBusy) return;
    if (!window.confirm("停止这部剧的学习？已落盘分集和静帧会保留，后续媒体流读取与模型调用将停止。")) return;
    setManhuaLearnControlBusy("cancel");
    try {
      await cancelManhuaLearnServerJob(jobId);
      await refreshManhuaLearnServerJobs();
      toast.success("已请求停止这部剧", { description: "已落盘内容保留，不再继续下一集。" });
    } catch (error) {
      toast.error("停止失败", { description: sanitizePlatformUserMessage(error instanceof Error ? error.message : String(error)) });
    } finally {
      setManhuaLearnControlBusy(null);
    }
  }, [focusedManhuaLearnServerJob?.jobId, focusedManhuaLearnBasketItem?.jobId, manhuaLearnControlBusy, refreshManhuaLearnServerJobs]);

  const skipFocusedManhuaLearnEpisode = useCallback(async () => {
    const jobId = focusedManhuaLearnServerJob?.jobId || focusedManhuaLearnBasketItem?.jobId;
    const jobRunning =
      focusedManhuaLearnServerJob?.status === "running"
      || focusedManhuaLearnBasketItem?.jobStatus === "running";
    if (!jobId || !jobRunning || focusedManhuaLearnEpisodeIndex <= 0 || manhuaLearnControlBusy) return;
    setManhuaLearnControlBusy("skip");
    try {
      await skipManhuaLearnServerEpisode(jobId);
      toast.success("已请求跳过本集", { description: "服务器会保留此前检查点并转到下一集。" });
    } catch (error) {
      toast.error("跳过失败", { description: sanitizePlatformUserMessage(error instanceof Error ? error.message : String(error)) });
    } finally {
      setManhuaLearnControlBusy(null);
    }
  }, [focusedManhuaLearnServerJob?.jobId, focusedManhuaLearnServerJob?.status, focusedManhuaLearnBasketItem?.jobId, focusedManhuaLearnBasketItem?.jobStatus, focusedManhuaLearnEpisodeIndex, manhuaLearnControlBusy]);

  useEffect(() => {
    const allowed = Boolean(
      user?.id && hasSupervisorOpsAccess,
    );
    if (!allowed || trendInsightTab !== "ai_manhua") return;
    let disposed = false;
    let timer: number | undefined;
    const sync = async () => {
      let hasActive = false;
      try {
        const listed = await refreshManhuaLearnServerJobs();
        hasActive = listed.items.some((job) => job.status === "queued" || job.status === "running");
      } catch (error) {
        if (!disposed) console.warn("[manhua-learn] refresh server jobs failed", error);
      } finally {
        if (!disposed) timer = window.setTimeout(() => void sync(), hasActive ? 3_000 : 15_000);
      }
    };
    void sync();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [refreshManhuaLearnServerJobs, hasSupervisorOpsAccess, trendInsightTab, user?.id]);
  /** owner 专用完整库；先通过能力查询再请求，其他监管账号不会触发私有列表请求。 */
  const manhuaViralApprovedQuery = trpc.manhuaViralTemplate.listApprovedPrivate.useQuery(
    undefined,
    {
      enabled:
        trendInsightTab === "ai_manhua" &&
        ownerTemplateOptimizeAllowed,
      staleTime: 60_000,
      retry: false,
    },
  );
  const approvedManhuaTemplateById = useMemo(() => {
    const entries = (manhuaViralApprovedQuery.data?.groups || [])
      .flatMap((group) => group.items)
      .map((card) => [card.id, card] as const);
    return new Map(entries);
  }, [manhuaViralApprovedQuery.data?.groups]);
  const selectedManhuaProposalProgressCopy = useMemo(() => {
    if (!selectedManhuaProposal?.nativeProgress) return undefined;
    const approvedProgress = readApprovedNativeTemplateProgress(
      approvedManhuaTemplateById.get(selectedManhuaProposal.id),
    );
    return buildPendingNativeTemplateProgressCopy({
      id: selectedManhuaProposal.id,
      progress: selectedManhuaProposal.nativeProgress,
      approvedSuccessSegments: approvedProgress?.successSegments,
    });
  }, [approvedManhuaTemplateById, selectedManhuaProposal]);
  const [ownerTemplateDetailId, setOwnerTemplateDetailId] = useState<string | null>(null);
  const [ownerTemplateOptimizeModel, setOwnerTemplateOptimizeModel] =
    useState<ManhuaViralTemplateOptimizeModel>("terra_high");
  const [ownerTemplateOptimizePrompt, setOwnerTemplateOptimizePrompt] = useState("");
  const [ownerTemplateOptimizeResult, setOwnerTemplateOptimizeResult] = useState<null | {
    original: ManhuaViralTemplateCard;
    proposal: ManhuaViralTemplateCard;
    changedFields: ManhuaViralTemplateOptimizeField[];
    reasons: ManhuaViralTemplateChangeReason[];
  }>(null);
  const ownerTemplateDetailQuery = trpc.manhuaViralTemplate.getApprovedOwnerDetail.useQuery(
    { id: ownerTemplateDetailId || "tpl_placeholder" },
    {
      enabled: ownerTemplateOptimizeAllowed && Boolean(ownerTemplateDetailId),
      staleTime: 10_000,
      retry: false,
    },
  );
  const ownerTemplateOptimizeMutation =
    trpc.manhuaViralTemplate.optimizeApproved.useMutation();
  useEffect(() => {
    if (manhuaTemplateOwnerCapabilitiesQuery.isSuccess && !ownerTemplateOptimizeAllowed) {
      setOwnerTemplateDetailId(null);
      setOwnerTemplateOptimizeResult(null);
      // owner 能力掉了，生命周期面板也要一起收掉，别留着一个点不动的空壳
      setTemplateReviewOpen(false);
      setArchivedForId(null);
    }
  }, [manhuaTemplateOwnerCapabilitiesQuery.isSuccess, ownerTemplateOptimizeAllowed]);
  const openOwnerTemplateDetail = useCallback((id: string) => {
    setOwnerTemplateDetailId(id);
    setOwnerTemplateOptimizePrompt("");
    setOwnerTemplateOptimizeResult(null);
  }, []);
  const runOwnerTemplateOptimize = useCallback(async () => {
    const id = String(ownerTemplateDetailId || "").trim();
    const promptZh = ownerTemplateOptimizePrompt.trim();
    const selected = ownerTemplateOptimizeModels.find(
      (model) => model.id === ownerTemplateOptimizeModel,
    );
    if (!id || promptZh.length < 2 || !selected) return;
    if (!window.confirm(
      `确认使用「${selected.labelZh}」按你的提示词优化该模板？\n\n` +
      "这会产生一次真实模型调用。结果只进入待审修订，不会自动覆盖正式模板；失败不自动重试。",
    )) {
      return;
    }
    try {
      const result = await ownerTemplateOptimizeMutation.mutateAsync({
        id,
        model: ownerTemplateOptimizeModel,
        promptZh,
        requestId: `tplopt_${crypto.randomUUID()}`,
        confirmPaidCall: true,
      });
      setOwnerTemplateOptimizeResult(result);
      await manhuaViralProposalsQuery.refetch();
      toast.success("已生成待审优化稿", {
        description: `共 ${result.changedFields.length} 项真实变更，正式模板尚未替换。`,
      });
    } catch (error) {
      toast.error(sanitizePlatformUserMessage(
        error instanceof Error ? error.message : String(error),
      ));
    }
  }, [
    manhuaViralProposalsQuery,
    ownerTemplateDetailId,
    ownerTemplateOptimizeModel,
    ownerTemplateOptimizeModels,
    ownerTemplateOptimizeMutation,
    ownerTemplateOptimizePrompt,
  ]);
  const manhuaLearnSnapshotQuery = trpc.manhuaViralTemplate.getSeriesLearnSnapshot.useQuery(
    {
      seriesKey: manhuaLearnFocusSeriesKey,
    },
    {
      enabled:
        trendInsightTab === "ai_manhua" &&
        manhuaLearnFocusSeriesKey.length >= 4 &&
        hasSupervisorOpsAccess,
      staleTime: 15_000,
      refetchInterval: focusedManhuaLearnJobActive ? 15_000 : false,
      retry: false,
    },
  );

  useEffect(() => {
    const snap = manhuaLearnSnapshotQuery.data;
    if (
      !snap
      || !manhuaLearnFocusSeriesKey
      || !manhuaLearnUserKey
      || manhuaLearnHydratedUserKey !== manhuaLearnUserKey
    ) return;
    const persistedSourceUrl = String(snap.progress?.sourceUrl || "").trim();
    if (/^https?:\/\//i.test(persistedSourceUrl)) {
      const continuation: ManhuaLearnContinuation = {
        row: {
          url: persistedSourceUrl,
          mixName: String(snap.progress?.titleHint || "").trim() || null,
          mixId: String(snap.progress?.mixId || "").trim() || null,
          platform: /kuaishou\.com/i.test(persistedSourceUrl) ? "kuaishou" : "douyin",
        },
        rank: 0,
        seriesKey: manhuaLearnFocusSeriesKey,
        savedAt: Date.now(),
      };
      manhuaLearnContinueRef.current = continuation;
      writeManhuaLearnContinuation(manhuaLearnUserKey, continuation);
    }
    setManhuaLearnResult((prev) => {
      // 本轮 Job / 失败态优先：勿被空 GCS 快照盖成「尚无已学分集」
      if (prev && prev.seriesKey === manhuaLearnFocusSeriesKey) {
        if (
          prev.liveStatus === "running" ||
          prev.liveStatus === "queued" ||
          prev.liveStatus === "failed" ||
          Boolean(prev.errorZh) ||
          prev.batchLearned > 0
        ) {
          return prev;
        }
        const snapN = Array.isArray(snap.digestsPreview) ? snap.digestsPreview.length : 0;
        const prevN = prev.digestsPreview?.length || 0;
        if (prevN > snapN) return prev;
      }
      const next = manhuaLearnResultFromSnapshot({
        seriesKey: manhuaLearnFocusSeriesKey,
        progress: snap.progress,
        digestsPreview: (snap.digestsPreview || []).map((d) => ({
          episodeIndex: d.episodeIndex,
          title: d.title,
          hookNoteZh: d.hookNoteZh,
          transcriptPreview: d.transcriptPreview,
          durationSec: d.durationSec,
          learnedThroughSec: d.learnedThroughSec,
          complete: d.complete,
          previewFrameUrls: d.previewFrameUrls,
          categoryLabelZh: d.categoryLabelZh,
          tagLabelsZh: d.tagLabelsZh,
        })),
        completedCount: (snap as { completedCount?: number }).completedCount,
        pipelineMode: (snap as {
          pipelineMode?: "native_deep_read" | "audio_dense_frames";
        }).pipelineMode,
        analysisReady: snap.analysisReady,
        proposal: snap.proposal as Record<string, unknown> | null,
      });
      return reuseManhuaLearnResultIfUnchanged(prev, next);
    });
  }, [
    manhuaLearnHydratedUserKey,
    manhuaLearnSnapshotQuery.data,
    manhuaLearnFocusSeriesKey,
    manhuaLearnUserKey,
  ]);

  const selectManhuaLearnBasketItem = useCallback(
    (seriesKey: string) => {
      const item = manhuaLearnBasket.find((candidate) => candidate.seriesKey === seriesKey);
      if (!item) return;
      const continuation: ManhuaLearnContinuation = {
        ...item.continuation,
        seriesKey: item.seriesKey,
        savedAt: Date.now(),
      };
      manhuaLearnContinueRef.current = continuation;
      writeManhuaLearnContinuation(manhuaLearnUserKey, continuation);
      setManhuaLearnResult(item.result);
      setManhuaLearnFocusSeriesKey(item.seriesKey);
      writeManhuaLearnFocusSeriesKey(manhuaLearnUserKey, item.seriesKey);
      setManhuaLearnContinueDismissedKey("");
      setManhuaLearnPanelCollapsed(false);
    },
    [manhuaLearnBasket, manhuaLearnUserKey],
  );

  const deleteFocusedManhuaLearnSeries = useCallback(async () => {
    const seriesKey = String(manhuaLearnResult?.seriesKey || manhuaLearnFocusSeriesKey).trim();
    const userKey = manhuaLearnUserKey;
    const jobId = focusedManhuaLearnServerJob?.jobId || focusedManhuaLearnBasketItem?.jobId;
    if (!seriesKey || !userKey || manhuaLearnControlBusy) return;
    if (!window.confirm("从列表删除这部剧？若正在学习会立即停止；已落盘分集、静帧和已批准模板仍会保留。")) return;
    setManhuaLearnControlBusy("delete");
    try {
      const hidden = jobId
        ? await hideManhuaLearnServerSeries(jobId)
        : null;
      const nextBasket = removeManhuaLearnBasketItem(manhuaLearnBasket, seriesKey);
      setManhuaLearnBasket(nextBasket);
      writeManhuaLearnBasket(userKey, nextBasket);
      const hiddenIds = new Set(hidden?.hiddenJobIds || (jobId ? [jobId] : []));
      setManhuaLearnServerJobs((prev) => prev.filter((job) => !hiddenIds.has(job.jobId)));
      const next = nextBasket[0];
      if (next) {
        selectManhuaLearnBasketItem(next.seriesKey);
      } else {
        manhuaLearnContinueRef.current = null;
        writeManhuaLearnContinuation(manhuaLearnUserKey, null);
        setManhuaLearnActiveJob(null);
        writeManhuaLearnActiveJob(manhuaLearnUserKey, null);
        setManhuaLearnResult(null);
        writeManhuaLearnResult(manhuaLearnUserKey, null);
        setManhuaLearnFocusSeriesKey("");
        writeManhuaLearnFocusSeriesKey(manhuaLearnUserKey, "");
        setManhuaLearnContinueDismissedKey("");
      }
      setManhuaLearnPanelCollapsed(false);
      toast.success("已从列表删除", { description: "落盘学习成果和已批准模板没有删除。" });
    } catch (error) {
      toast.error("删除失败", { description: sanitizePlatformUserMessage(error instanceof Error ? error.message : String(error)) });
    } finally {
      setManhuaLearnControlBusy(null);
    }
  }, [focusedManhuaLearnBasketItem?.jobId, focusedManhuaLearnServerJob?.jobId, manhuaLearnBasket, manhuaLearnControlBusy, manhuaLearnFocusSeriesKey, manhuaLearnResult?.seriesKey, manhuaLearnUserKey, selectManhuaLearnBasketItem]);
  const [allowBloggerTitle, setAllowBloggerTitle] = useState(() => readAllowBloggerTitleFromLs());
  /** 全案分析确认前：Skill/提示词优先级对话气泡 */
  const [fullAnalysisConfirmOpen, setFullAnalysisConfirmOpen] = useState(false);
  const [pendingFullAnalysisLabels, setPendingFullAnalysisLabels] = useState("");
  /** 选题初选 20–30 条 → 用户自己挑 → 可改标题 → 单条扩写（全案默认 20） */
  const [topicShortlist, setTopicShortlist] = useState<PlatformTopicShortlistItem[]>([]);
  const [topicShortlistCount, setTopicShortlistCount] = useState(PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT);
  /** 全案过程日志：选题初选 · 扩写 · 封面/分镜出图（进顶部 Debug；失败时按钮下方也可见末行） */
  const [shortlistDebugLines, setShortlistDebugLines] = useState<string[]>([]);
  const [shortlistLastError, setShortlistLastError] = useState<string | null>(null);
  const pushShortlistDebug = useCallback((line: string) => {
    const stamp = new Date().toLocaleTimeString("zh-CN", { hour12: false });
    setShortlistDebugLines((prev) => [...prev.slice(-160), `[${stamp}] ${line}`]);
  }, []);
  /** 出图快照 / Job 轮询 → 镜像进全案 Debug（按 opId / jobId 去重，避免刷屏） */
  const fullcaseImageDebugSigByKeyRef = useRef<Map<string, string>>(new Map());
  /** 正在改标题的初选条目 id 与草稿文字（改完才扩写） */
  const [editingShortlistTopicId, setEditingShortlistTopicId] = useState<string | null>(null);
  const [editingShortlistTitle, setEditingShortlistTitle] = useState("");
  /** 多选扩写：勾选 id；「就写这条」也会走同一 expand 接口 */
  const [selectedShortlistIds, setSelectedShortlistIds] = useState<string[]>([]);
  /** 烧积分结果本机恢复：按 userKey 只 hydrate 一次，避免覆盖刚打完的 API */
  const shortlistExpandRestoredForKeyRef = useRef<string | null>(null);
  const startEditingShortlistTitle = useCallback((topic: PlatformTopicShortlistItem) => {
    setEditingShortlistTopicId(topic.id);
    setEditingShortlistTitle(topic.title);
  }, []);
  const cancelEditingShortlistTitle = useCallback(() => {
    setEditingShortlistTopicId(null);
    setEditingShortlistTitle("");
  }, []);
  const commitEditingShortlistTitle = useCallback(() => {
    const id = editingShortlistTopicId;
    if (!id) return;
    const next = editingShortlistTitle.trim().slice(0, 120);
    if (next.length < 4) {
      toast.error("标题至少 4 个字");
      return;
    }
    setTopicShortlist((prev) => prev.map((t) => (t.id === id ? { ...t, title: next } : t)));
    setEditingShortlistTopicId(null);
    setEditingShortlistTitle("");
  }, [editingShortlistTitle, editingShortlistTopicId]);
  const generateTopicShortlistMutation = trpc.mvAnalysis.generatePlatformTopicShortlist.useMutation();
  /** 免费试跑还剩几次；打码位数量也读它 */
  const { data: shortlistFreeQuota, refetch: refetchShortlistQuota } =
    trpc.mvAnalysis.platformTopicShortlistQuota.useQuery(undefined, { retry: false, staleTime: 60_000 });
  /** 免费试跑后还有多少条没生成（付费才跑） */
  const [shortlistMaskedCount, setShortlistMaskedCount] = useState(0);
  /** 智能优化的免费额度：决定含糊背景是硬拦还是软提示 */
  const { data: personaPolishQuota } = trpc.mvAnalysis.platformPersonaPolishQuota.useQuery(undefined, {
    retry: false,
    staleTime: 60_000,
  });
  /** 扩写引擎（用户可选，2026-08-12）：稳定档主走 OpenRouter 抖动自动换备用通道；轻快档直走备用通道 */
  const [platformExpandEngine, setPlatformExpandEngine] = useState<PlatformTopicExpandEngineId>(() => {
    try {
      const raw = window.localStorage.getItem("mvstudiopro.platform.expandEngine.v1");
      return normalizePlatformTopicExpandEngine(raw);
    } catch {
      return "kimi-k3";
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem("mvstudiopro.platform.expandEngine.v1", platformExpandEngine);
    } catch {
      /* 忽略隐私模式写失败 */
    }
  }, [platformExpandEngine]);

  /**
   * 文生图断线续航：开页发现有未完成的出图任务就自动续轮询到终态；
   * 没有挂账任务但有历史成品时，把「最近一次生成结果」找回到结果区。
   * 治的是 2026-08-12 实证的三连丢：刷新即丢单、卡死无超时、成品拿不回。
   */
  const posterResumeRanRef = useRef(false);
  useEffect(() => {
    if (posterResumeRanRef.current) return;
    posterResumeRanRef.current = true;
    const pending = readPosterResumeRecord();
    if (pending) {
      const age = Date.now() - pending.firedAt;
      if (age > PLATFORM_POSTER_RESUME_MAX_AGE_MS) {
        writePosterResumeRecord(null);
        toast.info("上次的出图任务已超时未完成，可重新生成（失败会自动退积分）");
      } else {
        setCustomNoteBusy(true);
        toast.info(`找到未完成的出图任务（${pending.titleHead || "上次生成"}），正在续接结果…`);
        void pollJobUntilTerminal(pending.jobId, {
          intervalMs: 2500,
          // 后台墙钟 10 分钟，续航最多再等 12 分钟减去已耗时，别把整区锁半小时
          maxWaitMs: Math.max(60_000, 12 * 60_000 - age),
          adaptiveBackoffAfterAttempts: 20,
          maxIntervalMs: 6000,
        })
          .then((j) => {
            const out = (j.output || {}) as { compositeImageUrl?: string; imageUrl?: string };
            const url = out.compositeImageUrl || out.imageUrl || "";
            if (j.status === "failed" || !url) {
              setCustomNoteError(j.error || "上次的出图任务未成功，请重试（失败会自动退积分）");
              return;
            }
            if (
              pending.kind === "storyboard_sheet_landscape" ||
              pending.kind === "single_page_knowledge_card"
            ) {
              setCustomNoteKind(pending.kind);
            }
            setCustomNoteImages([url]);
            writePosterLastResult([url], pending.kind);
            toast.success("已找回上次未完成的生成结果");
          })
          .catch(() => {
            setCustomNoteError("续接上次出图任务失败，请重新生成");
          })
          .finally(() => {
            if (readPosterResumeRecord()?.jobId === pending.jobId) writePosterResumeRecord(null);
            setCustomNoteBusy(false);
          });
      }
      return;
    }
    const last = readPosterLastResult();
    if (last && Date.now() - last.at < 24 * 3600_000) {
      // 只在结果区为空时找回，并明示这是历史结果（防把昨天的图当本次发出去）
      setCustomNoteImages((prev) => {
        if (prev.length) return prev;
        const mins = Math.max(1, Math.round((Date.now() - last.at) / 60_000));
        const ago = mins >= 60 ? `${Math.round(mins / 60)} 小时前` : `${mins} 分钟前`;
        toast.info(`已恢复上次的生成结果（${ago}），重新生成会覆盖`);
        if (last.kind === "storyboard_sheet_landscape" || last.kind === "single_page_knowledge_card") {
          setCustomNoteKind(last.kind);
        }
        return last.urls;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /** 扩写改走后台任务 + 轮询：每条写完就渲染，不再等七条跑完 */
  const enqueueTopicExpandMutation = trpc.mvAnalysis.enqueuePlatformTopicExpand.useMutation();
  const [shortlistExpandBusy, setShortlistExpandBusy] = useState(false);
  const [shortlistExpandProgress, setShortlistExpandProgress] = useState<{
    done: number;
    total: number;
  } | null>(null);
  const topicShortlistPrice = platformTopicShortlistTotalCredits({
    count: topicShortlistCount,
    baseCredits: CREDIT_COSTS.platformTopicShortlist,
    extraPerTopic: CREDIT_COSTS.platformTopicShortlistExtra,
  });
  const expandedBlueprintCount = Array.isArray(platformContent?.contentBlueprints)
    ? platformContent!.contentBlueprints.length
    : 0;

  // 登录后恢复：选题 + 已扩写文案（刷新/误切 Tab 不丢烧积分结果）
  useEffect(() => {
    if (!workbenchUserKey) return;
    if (shortlistExpandRestoredForKeyRef.current === workbenchUserKey) return;
    shortlistExpandRestoredForKeyRef.current = workbenchUserKey;
    const saved = readShortlistExpandPersist(workbenchUserKey);
    if (!saved) return;
    if (saved.topics.length > 0) {
      setTopicShortlist((prev) => (prev.length > 0 ? prev : saved.topics));
    }
    if (saved.contentBlueprints.length > 0) {
      setPlatformContent((prev) => {
        if (Array.isArray(prev?.contentBlueprints) && prev!.contentBlueprints.length > 0) return prev;
        return {
          monetizationLanes: Array.isArray(prev?.monetizationLanes) ? prev!.monetizationLanes : [],
          contentBlueprints: saved.contentBlueprints as any[],
        };
      });
      setHasAnalyzed(true);
      pushShortlistDebug(`本机恢复：扩写文案 ${saved.contentBlueprints.length} 条（刷新不丢）`);
    } else if (saved.topics.length > 0) {
      pushShortlistDebug(`本机恢复：选题初选 ${saved.topics.length} 条`);
    }
  }, [workbenchUserKey, pushShortlistDebug]);

  // 有结果就落盘；空状态不写，避免把已存文案冲掉
  useEffect(() => {
    if (!workbenchUserKey) return;
    const bps = Array.isArray(platformContent?.contentBlueprints)
      ? (platformContent!.contentBlueprints as Array<Record<string, unknown>>)
      : [];
    if (topicShortlist.length === 0 && bps.length === 0) return;
    writeShortlistExpandPersist({
      userKey: workbenchUserKey,
      topics: topicShortlist,
      contentBlueprints: bps,
    });
  }, [workbenchUserKey, topicShortlist, platformContent?.contentBlueprints]);

  // 监管验收：?demoExpand=1 注入假文案，不烧积分，只验同页可见
  useEffect(() => {
    if (!supervisorAccess) return;
    try {
      const q = new URLSearchParams(window.location.search);
      if (q.get("demoExpand") !== "1") return;
      setHasAnalyzed(true);
      setTopicShortlist([
        {
          id: "demo-topic-expand-1",
          title: "验收用选题：晚间护肤三步清单",
          hookSketch: "加班到点还要护肤？先收这三步",
          conveyGoal: "让读者收藏并留言想要",
          skillsUsed: ["生活节奏"],
          primaryLane: "default",
          formatHint: "图文",
          dedupeKey: "demo:expand:1",
          commentHook: "想要",
          isTopPick: true,
          viralScore: 88,
          viralReason: "强收藏欲",
          commentHeat: 76,
        },
      ]);
      setPlatformContent({
        monetizationLanes: [],
        contentBlueprints: [
          {
            title: "验收用文案：晚间护肤三步清单",
            hook: "加班到点还硬撑护肤？先把这三步钉在洗手台。",
            copywriting:
              "第一步：温水洗脸，别用热水烫脸。\n第二步：精华只涂需要的区域。\n第三步：面霜锁水，明天妆才服帖。\n\n收藏这篇，今晚就按顺序做一遍。",
            format: "图文",
            commentHooks: ["想要", "收藏", "同款"],
            shortlistId: "demo-topic-expand-1",
          },
        ] as any,
      });
      pushShortlistDebug("验收注入 demoExpand=1：选题+文案已挂本页（不烧积分）");
      window.setTimeout(() => {
        document
          .getElementById("platform-topic-shortlist-expanded")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch {
      /* ignore */
    }
  }, [supervisorAccess, pushShortlistDebug]);
  /** 選題卡片分鏡/圖文網格：2×4（單張）或 3×4 十二格（後端分段生成再拼成一張長圖，降低糊字，定價另算）。 */
  const [compositeGridVariant, setCompositeGridVariant] = useState<"2x4" | "3x4">("2x4");
  const [pendingCompositeSheet, setPendingCompositeSheet] = useState<{
    sceneId: string;
    kind:
      | "storyboard_sheet_portrait"
      | "storyboard_sheet_landscape"
      | "xiaohongshu_dual_note"
      | "single_page_knowledge_card";
  } | null>(null);
  /**
   * 2×4 非同步：TRPC 已 200 但须轮询 GET /api/jobs 至 succeeded/failed。
   * 须与 {@link generatePlatformCompositeSheetMutation.isPending} 一并作为「仍在处理」与轮询 effect 依赖，否则 isPending 瞬间 false 会拆掉轮询、清掉 ref，画面也不转圈。
   */
  const [compositeAwaitingJobTerminal, setCompositeAwaitingJobTerminal] = useState(false);
  /** 2×4 宽幅合成：与 TRPC 并行的 GET /api/jobs 轮询（progressJobId） */
  const compositeSheetLivePollCtxRef = useRef<{
    jobId: string;
    localOpId: string;
    sceneId: string;
    title: string;
    kind:
      | "storyboard_sheet_portrait"
      | "storyboard_sheet_landscape"
      | "xiaohongshu_dual_note"
      | "single_page_knowledge_card";
    gridVariant?: "2x4" | "3x4";
  } | null>(null);
  /** 与 GET /api/jobs 合成轮询同步的计数（仅用于 Debug 面板，不刷整条 imageGenFlowLog） */
  const compositeLivePollAttemptRef = useRef(0);
  /** Debug：批量单帧 / 2×4 合成 · 服务端逐步日志（最新在前） */
  const [platformImageGenFlowSnapshots, setPlatformImageGenFlowSnapshots] = useState<PlatformImageGenFlowSnapshot[]>(
    [],
  );
  /** 封面 / 分镜出图步骤同步写入顶部「全案 Debug」（原先只埋在下方失败流水） */
  useEffect(() => {
    const kindLabel = (kind: PlatformImageGenFlowSnapshot["kind"]) => {
      switch (kind) {
        case "batch_topic_frames":
          return "封面批量";
        case "batch_composite_2x4":
          return "分镜/图文批量";
        case "batch_cover_composite_bundle":
          return "封面加分镜";
        case "composite_2x4":
          return "分镜/图文";
        case "batch_topic_frames_failed":
          return "封面失败";
        case "composite_2x4_failed":
          return "分镜失败";
        default:
          return String(kind);
      }
    };
    for (const snap of platformImageGenFlowSnapshots) {
      const opKey = String(snap.meta?.localOpId || snap.at || "").trim() || snap.kind;
      const last = snap.lines[snap.lines.length - 1] || "";
      if (!last.trim()) continue;
      const sig = `${snap.lines.length}|${last}`;
      if (fullcaseImageDebugSigByKeyRef.current.get(`snap:${opKey}`) === sig) continue;
      fullcaseImageDebugSigByKeyRef.current.set(`snap:${opKey}`, sig);
      const short = last.replace(/^\d{4}-\d{2}-\d{2}T[^\s]+\s+/, "").slice(0, 160);
      const pending = snap.meta?.pending === true ? "⏳ " : "";
      pushShortlistDebug(`${pending}出图·${kindLabel(snap.kind)} ${short}`);
    }
  }, [platformImageGenFlowSnapshots, pushShortlistDebug]);
  useEffect(() => {
    const traces = [topicImageJobPollTrace, compositeJobPollTrace].filter(Boolean) as ClientJobPollTrace[];
    for (const t of traces) {
      const step = t.imageGenStep || t.currentStep || t.translationStep || "";
      if (!step && !t.terminalStatus) continue;
      const sig = `${step}|${t.terminalStatus || "run"}|${t.translationStep || ""}`;
      const key = `job:${t.jobId}`;
      if (fullcaseImageDebugSigByKeyRef.current.get(key) === sig) continue;
      fullcaseImageDebugSigByKeyRef.current.set(key, sig);
      const tail = t.terminalStatus ? ` · ${t.terminalStatus}` : "";
      pushShortlistDebug(`出图·轮询 ${t.label} · ${step || "进行中"}${tail}`);
    }
  }, [topicImageJobPollTrace, compositeJobPollTrace, pushShortlistDebug]);
  /** 2×4 / 小红书合成进行中：由 live log 粗略推进度标签 */
  const compositePendingUxHints = useMemo(() => {
    const map: Record<string, string> = {};
    for (const snap of platformImageGenFlowSnapshots) {
      if (snap.kind !== "composite_2x4") continue;
      if (snap.meta?.pending !== true) continue;
      const sid = String(snap.meta?.sceneId ?? "").trim();
      const apiKind = String(snap.meta?.apiKind ?? "").trim();
      if (!sid || !apiKind) continue;
      map[`${sid}::${apiKind}`] = deriveCompositeUxPhaseHint(
        snap.lines,
        String(snap.meta?.liveCompositeFlowTail ?? ""),
      );
    }
    return map;
  }, [platformImageGenFlowSnapshots]);
  const markCoverGenerationStarted = useCallback((sceneId: string) => {
    setCoverWaitCarouselEngaged(true);
    setBatchGeneratingCoverIds((prev) => {
      const next = new Set(prev);
      next.add(sceneId);
      return next;
    });
  }, []);

  const markCoverGenerationFinished = useCallback((sceneId: string) => {
    setBatchGeneratingCoverIds((prev) => {
      if (!prev.has(sceneId)) return prev;
      const next = new Set(prev);
      next.delete(sceneId);
      return next;
    });
  }, []);
  /** sceneId → user_creations.id（免扣补发、履历；刷新页面会丢失本地条目） */
  const [sceneJobIds, setSceneJobIds] = useState<Record<string, string>>({});
  /** 封面成功返回后：规则估计的点击率档位（非实测） */
  const [platformCoverCtrBySceneId, setPlatformCoverCtrBySceneId] = useState<Record<string, CoverClickEstimate>>(
    () => ({}),
  );
  /** 批量后静默补发进行中：用于单卡呼吸骨架（Set 避免并发重复 id） */
  const [coverSilentRetryIds, setCoverSilentRetryIds] = useState<Set<string>>(() => new Set());
  /** 一键封面：前端异步逐张生成（单张串行） */
  const [batchGeneratingCoverIds, setBatchGeneratingCoverIds] = useState<Set<string>>(() => new Set());
  const [isSequentialCoverBatchGenerating, setIsSequentialCoverBatchGenerating] = useState(false);
  /** 一键 2×4 / 八格：逐题入队后端异步任务，每题 pollJobUntilTerminal 至终态再发下一题（与封面批量一致；批量时禁用下方单槽轮询 effect） */
  const [isSequentialCompositeBatchGenerating, setIsSequentialCompositeBatchGenerating] = useState(false);
  /** 选题套装：竖版封面 + 2×4/八格 · 客户端逐选题串行（每题 worker 内双链并发） */
  const [isSequentialCoverCompositeBundleBatchGenerating, setIsSequentialCoverCompositeBundleBatchGenerating] =
    useState(false);
  /** 单卡套装进行中（避免与批量/单帧/单合成并行） */
  const [coverCompositeBundleSceneId, setCoverCompositeBundleSceneId] = useState<string | null>(null);
  const compositeBatchSilentUiRef = useRef(false);
  /** 封面生成区旁：决策智库对外试读样张（演示数据 + 脱敏） */
  const [coverDecisionTrialReadOpen, setCoverDecisionTrialReadOpen] = useState(false);
  /** 封面图 onError：已对原始 URL 尝试过一次 cache-bust（避免误用「免扣 failedJobId」清图） */
  const coverImageCacheBustTriedRef = useRef<Set<string>>(new Set());
  /** 每次点击「开始全案分析」确认后递增，随决策智库 mutation 写入 requestHash，避免命中上一轮同参缓存 */
  const platformAnalysisEpochRef = useRef(0);

  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: focusPrompt || undefined,
      modelName: "gemini-3.5-flash",
      requestedPlatforms: selectedTrendPlatforms,
      analysis: EMPTY_ANALYSIS,
      windowDays: selectedWindowDays,
      interactivePlatform: true,
    },
    {
      enabled: false,
      staleTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: false,
    },
  );

  const enqueuePlatformContentJobMutation = trpc.mvAnalysis.enqueuePlatformContentJob.useMutation();

  const platformSkillsQuery = trpc.mvAnalysis.listPlatformSkills.useQuery(undefined, {
    enabled: isAuthenticated,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const uploadPlatformSkillMutation = trpc.mvAnalysis.uploadPlatformSkill.useMutation();
  const deletePlatformSkillMutation = trpc.mvAnalysis.deletePlatformSkill.useMutation();
  /** 大文档直传 GCS 用的签名地址（与素材分析共用同一条通道） */
  const getUploadUrlMutation = trpc.mvAnalysis.getVideoUploadSignedUrl.useMutation();

  useEffect(() => {
    const skills = platformSkillsQuery.data?.skills;
    if (!skills?.length || platformSkillIdsHydrated) return;
    // 未主动勾选时：只开核心 Skill（不再默认全开 defaultEnabled）
    const core = new Set<string>(PLATFORM_SKILL_ROUTER_CORE_IDS as readonly string[]);
    const next = new Set(
      skills.map((s) => s.id).filter((id) => core.has(id)),
    );
    if (next.size === 0) {
      for (const id of PLATFORM_SKILL_ROUTER_CORE_IDS) next.add(id);
    }
    setEnabledPlatformSkillIds(next);
    setPlatformSkillIdsHydrated(true);
  }, [platformSkillsQuery.data?.skills, platformSkillIdsHydrated]);

  useEffect(() => {
    if (!platformSkillIdsHydrated) return;
    try {
      window.localStorage.setItem(
        PLATFORM_ENABLED_SKILL_IDS_LS_KEY,
        JSON.stringify(Array.from(enabledPlatformSkillIds)),
      );
    } catch {
      /* ignore */
    }
  }, [enabledPlatformSkillIds, platformSkillIdsHydrated]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PLATFORM_ALLOW_BLOGGER_TITLE_LS_KEY, allowBloggerTitle ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [allowBloggerTitle]);

  const togglePlatformSkillCategory = useCallback((ids: string[], enable: boolean) => {
    setEnabledPlatformSkillIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (enable) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const platformSkillRecommend = useMemo(() => {
    const skills = platformSkillsQuery.data?.skills ?? [];
    const poolIds = skills.map((s) => s.id);
    const routed = routePlatformSkillIds({
      poolIds: poolIds.length ? poolIds : [...PLATFORM_SKILL_ROUTER_CORE_IDS],
      context: focusPrompt,
      sheetKind: "unknown",
      maxSkills: 14,
    });
    const core = new Set<string>(PLATFORM_SKILL_ROUTER_CORE_IDS as readonly string[]);
    const extraIds = routed.selectedIds.filter((id) => !core.has(id)).slice(0, 6);
    const nameById = new Map(skills.map((s) => [s.id, s.name] as const));
    return {
      lane: routed.primaryLane,
      extraIds,
      labels: extraIds.map((id) => nameById.get(id) || id),
    };
  }, [focusPrompt, platformSkillsQuery.data?.skills]);

  const applyPlatformSkillRecommend = useCallback(() => {
    setEnabledPlatformSkillIds((prev) => {
      const next = new Set(prev);
      for (const id of PLATFORM_SKILL_ROUTER_CORE_IDS) next.add(id);
      for (const id of platformSkillRecommend.extraIds) next.add(id);
      return next;
    });
    toast.success(
      platformSkillRecommend.extraIds.length
        ? `已采纳推荐 Skill（${platformSkillRecommend.labels.join(" · ")}）`
        : "已确认核心 Skill（当前背景暂无额外赛道推荐）",
    );
  }, [platformSkillRecommend.extraIds, platformSkillRecommend.labels]);

  const togglePlatformSkillId = useCallback((id: string) => {
    setEnabledPlatformSkillIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleUploadPlatformSkillFile = useCallback(
    async (file: File) => {
      if (!isAuthenticated) {
        toast.error("请先登录后再上传 Skill");
        return;
      }
      const name = String(file.name || "").toLowerCase();
      if (!name.endsWith(".md") && file.type && !/markdown|text\/plain/i.test(file.type)) {
        toast.error("请上传 .md 文件");
        return;
      }
      setPlatformSkillUploading(true);
      try {
        const markdown = await file.text();
        if (markdown.trim().length < 20) {
          toast.error("Skill 内容过短（至少约 20 字）");
          return;
        }
        const res = await uploadPlatformSkillMutation.mutateAsync({
          markdown,
          filenameHint: file.name,
        });
        const sid = res.skill?.id;
        if (sid) {
          setEnabledPlatformSkillIds((prev) => new Set(prev).add(sid));
        }
        toast.success(`已上传 Skill：${res.skill?.name || sid || "ok"}`);
        void platformSkillsQuery.refetch();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "上传 Skill 失败");
      } finally {
        setPlatformSkillUploading(false);
      }
    },
    [isAuthenticated, uploadPlatformSkillMutation, platformSkillsQuery],
  );

  const handleAskPlatformSkillQa = useCallback(async () => {
    const q = skillQaQuestion.trim();
    if (q.length < 2) {
      toast.error("请先输入问题");
      return;
    }
    if (!isAuthenticated) {
      toast.error("请先登录后再提问");
      return;
    }
    const mode = skillQaModel === "gpt-5.6-sol" ? "sol" : "terra";
    const paidUnit = platformSkillQaPaidCredits(mode);
    const freeLimit = mode === "sol" ? PLATFORM_SKILL_QA_SOL_DAILY_FREE : PLATFORM_SKILL_QA_TERRA_DAILY_FREE;
    const remaining = skillQaRemaining;
    let confirmPaid = false;
    if (remaining != null && remaining <= 0) {
      const ok = window.confirm(
        `今日 ${mode === "sol" ? "5.6 Sol" : "5.6 Terra"} 免费 ${freeLimit} 次已用完。继续将扣除 ${paidUnit} 积分/次。确认？`,
      );
      if (!ok) return;
      confirmPaid = true;
    }
    try {
      const res = await askPlatformSkillQaMutation.mutateAsync({
        question: q,
        enabledSkillIds: Array.from(enabledPlatformSkillIds),
        allowBloggerTitle,
        qaModel: skillQaModel,
        confirmPaid,
      });
      setSkillQaAnswer(res.answer || "");
      setSkillQaRemaining(res.remainingFreeToday);
      setSkillQaImageOffer(res.imageOffer ?? null);
      setSkillQaImageUrl(null);
      if (res.paidThisTurn && res.creditsCharged > 0) {
        toast.message(`已扣 ${res.creditsCharged} 积分（超额问答）`);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/免费.*已用完|PAYMENT_REQUIRED|扣除/.test(msg) && !confirmPaid) {
        const ok = window.confirm(`${sanitizePlatformUserMessage(msg, "")}\n\n确认扣点继续？`);
        if (ok) {
          try {
            const res = await askPlatformSkillQaMutation.mutateAsync({
              question: q,
              enabledSkillIds: Array.from(enabledPlatformSkillIds),
              allowBloggerTitle,
              qaModel: skillQaModel,
              confirmPaid: true,
            });
            setSkillQaAnswer(res.answer || "");
            setSkillQaRemaining(res.remainingFreeToday);
            setSkillQaImageOffer(res.imageOffer ?? null);
            setSkillQaImageUrl(null);
            if (res.creditsCharged > 0) toast.message(`已扣 ${res.creditsCharged} 积分（超额问答）`);
            return;
          } catch (err2) {
            toast.error(
              sanitizePlatformUserMessage(
                err2 instanceof Error ? err2.message : String(err2),
                "问答失败，请稍后重试",
              ),
            );
            return;
          }
        }
      }
      toast.error(sanitizePlatformUserMessage(msg, "问答失败，请稍后重试"));
    }
  }, [
    skillQaQuestion,
    isAuthenticated,
    askPlatformSkillQaMutation,
    enabledPlatformSkillIds,
    allowBloggerTitle,
    skillQaModel,
    skillQaRemaining,
  ]);

  const handleConfirmSkillQaImage = useCallback(async () => {
    const offer = skillQaImageOffer;
    const prompt = offer?.suggestedPrompt?.trim();
    if (!offer || !prompt) return;
    if (!isAuthenticated) {
      toast.error("请先登录");
      return;
    }
    const cost = offer.creditCost;
    const ok = window.confirm(
      `确认生成单页图？将扣除 ${cost} 积分${
        offer.isFirstImageDiscount ? "（生涯首张·封面九折）" : "（封面原价）"
      }。生图会参考下方已勾选的 Skill。`,
    );
    if (!ok) return;
    try {
      const res = await confirmPlatformSkillQaImageMutation.mutateAsync({
        imagePrompt: prompt,
        enabledSkillIds: Array.from(enabledPlatformSkillIds),
        aspectRatio: "9:16",
      });
      setSkillQaImageUrl(res.imageUrl);
      toast.success(
        res.isFirstImageDiscount
          ? `已生成（首张九折，扣 ${res.creditsCharged} 点）`
          : `已生成（扣 ${res.creditsCharged} 点）`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生图失败");
    }
  }, [
    skillQaImageOffer,
    isAuthenticated,
    confirmPlatformSkillQaImageMutation,
    enabledPlatformSkillIds,
  ]);

  const scrollToPlatformSection = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const toggleShortlistSelection = useCallback((id: string) => {
    setSelectedShortlistIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (prev.length >= PLATFORM_TOPIC_EXPAND_MAX) {
        toast.error(`一次最多勾选 ${PLATFORM_TOPIC_EXPAND_MAX} 条再写文案`);
        return prev;
      }
      return [...prev, id];
    });
  }, []);

  /** 初选 → 正式文案：走 expandPlatformTopicPicks（不依赖战略看板） */
  const expandShortlistPicks = useCallback(
    async (picksIn: PlatformTopicShortlistItem[]) => {
      const picks = picksIn.slice(0, PLATFORM_TOPIC_EXPAND_MAX);
      if (!picks.length) {
        toast.error("请先勾选至少一条选题");
        return;
      }
      if (shortlistExpandBusy) return;
      // 按条计费（2026-08-12 拍板，单价见 CREDIT_COSTS）
      const cost = CREDIT_COSTS.platformTopicExpand * picks.length;
      if (
        !supervisorAccess &&
        !window.confirm(
          `将为选中的 ${picks.length} 条选题扩写正式文案（${CREDIT_COSTS.platformTopicExpand} 点/条 × ${picks.length} = ${cost} 点；失败条自动退款）。是否继续？`,
        )
      ) {
        return;
      }
      setShortlistLastError(null);
      pushShortlistDebug(`扩写开始：${picks.length} 条 · 后台任务逐条回传`);
      picks.forEach((p, i) => pushShortlistDebug(`  ${i + 1}. ${p.title.slice(0, 48)}`));
      const t0 = Date.now();
      setShortlistExpandBusy(true);
      setShortlistExpandProgress({ done: 0, total: picks.length });
      /** 已渲染过的条目，避免每次轮询都整批重写 state */
      const rendered = new Set<string>();
      const mergeBlueprints = (rawList: unknown) => {
        const bps = (Array.isArray(rawList) ? rawList : []).map((raw, i) => {
          const bp = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
          const sid = String(bp.id || bp.sceneId || bp.shortlistId || `expand-${t0}-${i}`);
          return { ...bp, id: sid, sceneId: String(bp.sceneId || sid) };
        });
        const fresh = bps.filter((b) => !rendered.has(String(b.id)));
        if (!fresh.length) return 0;
        for (const b of fresh) rendered.add(String(b.id));
        setPlatformContent((prev) => {
          const prevBps = Array.isArray(prev?.contentBlueprints) ? prev!.contentBlueprints : [];
          const byId = new Map<string, Record<string, unknown>>();
          for (const row of prevBps as Array<Record<string, unknown>>) {
            const k = String(row.id || row.sceneId || row.shortlistId || "");
            if (k) byId.set(k, row);
          }
          for (const row of bps) byId.set(String(row.id), row);
          return {
            monetizationLanes: Array.isArray(prev?.monetizationLanes) ? prev!.monetizationLanes : [],
            contentBlueprints: Array.from(byId.values()) as any[],
          };
        });
        return fresh.length;
      };
      try {
        const { jobId, freeRetry } = await enqueueTopicExpandMutation.mutateAsync({
          context: focusPrompt.trim() || undefined,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
          expandEngine: platformExpandEngine,
          picks: picks.map((p) => ({
            id: p.id,
            title: p.title,
            hookSketch: p.hookSketch,
            conveyGoal: p.conveyGoal,
            skillsUsed: p.skillsUsed,
            primaryLane: p.primaryLane,
            formatHint: p.formatHint,
            dedupeKey: p.dedupeKey,
            commentHook: p.commentHook,
            linkedCampaigns: p.linkedCampaigns,
          })),
        });
        pushShortlistDebug(
          `已入队 job=${jobId}，每条写完即刻显示${freeRetry ? " · 上次未出稿，本次重跑不扣点" : ""}`,
        );
        if (freeRetry) toast.success("上次没写出来的条目，本次重跑不扣点");
        const job = await pollJobUntilTerminal(jobId, {
          intervalMs: 3000,
          maxWaitMs: 80 * 60_000,
          adaptiveBackoffAfterAttempts: 60,
          maxIntervalMs: 6000,
          onPoll: ({ output }) => {
            const out = (output || {}) as {
              contentBlueprints?: unknown;
              expandDoneCount?: number;
              expandTotalCount?: number;
            };
            const added = mergeBlueprints(out.contentBlueprints);
            const done = Number(out.expandDoneCount) || 0;
            const total = Number(out.expandTotalCount) || picks.length;
            if (done) setShortlistExpandProgress({ done, total });
            if (added > 0) {
              // 第一条一到就切到结果区，别让用户对着转圈
              setCreateStep("result");
              setHasAnalyzed(true);
              pushShortlistDebug(
                `📄 第 ${done || rendered.size}/${total} 条已出 · ${Math.round((Date.now() - t0) / 1000)}s`,
              );
              if (rendered.size === added) toast.success("第 1 条文案已出，其余在后台逐条生成");
            }
          },
        });
        if (job.status === "failed") throw new Error(job.error || "扩写失败，请稍后重试");
        const out = (job.output || {}) as {
          contentBlueprints?: unknown;
          chargedCredits?: number;
          diagnostics?: { failedCount?: number; failedPicks?: Array<{ id?: string; title?: string }> };
        };
        mergeBlueprints(out.contentBlueprints);
        const bps = Array.from(rendered);
        const failedPicks = Array.isArray(out.diagnostics?.failedPicks)
          ? out.diagnostics!.failedPicks!
          : [];
        setCreateStep("result");
        setHasAnalyzed(true);
        // 失败的留在勾选里，用户可以只重跑这几条
        setSelectedShortlistIds(
          failedPicks.map((f) => String(f?.id || "")).filter((id) => id && picks.some((p) => p.id === id)),
        );
        setShortlistExpandProgress({ done: bps.length, total: picks.length });
        if (failedPicks.length) {
          for (const f of failedPicks) {
            pushShortlistDebug(`⚠️ 未出：${String(f?.title || f?.id || "").slice(0, 40)}`);
          }
          toast.error(
            `${failedPicks.length} 条没写出来（已保留勾选，可单独重跑），其余 ${bps.length} 条已在下方`,
          );
        }
        // 快照：visibleExecutionCards effect 会 sync；出图按钮点击前也会再 sync 一次
        pushShortlistDebug(
          `✅ 扩写完成 ${bps.length} 条 · ${Math.round((Date.now() - t0) / 1000)}s · 扣点 ${out.chargedCredits ?? "—"}`,
        );
        pushShortlistDebug("同页展示：文案卡上直接接一键套装/仅封面/分镜·图文（不跳内容创作）");
        toast.success(
          `已扩写 ${bps.length} 条文案${out.chargedCredits ? `（扣 ${out.chargedCredits} 点）` : ""}；本卡可出封面 / 分镜 / 图文`,
        );
        // 全案入口在「平台趋势」：结果必须同页可见，禁止切 Tab / 滚到内容创作执行区
        window.setTimeout(() => {
          const anchor =
            document.getElementById("platform-topic-shortlist-expanded") ||
            document.getElementById("platform-stage2-copy");
          anchor?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 120);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const friendly =
          msg.includes("timeout") || msg.includes("504")
            ? "扩写超时，请少选几条或稍后重试"
            : msg.includes("空内容")
              ? "算力紧张，请再试一次"
              : sanitizePlatformUserMessage(msg, "扩写失败，请稍后重试");
        setShortlistLastError(friendly);
        pushShortlistDebug(`❌ 扩写失败：${msg}（已等 ${Math.round((Date.now() - t0) / 1000)}s）`);
        // 已经冒出来的条目留在页面上，别因为后半段失败把用户已看到的稿子清掉
        toast.error(rendered.size > 0 ? `${friendly}（已出 ${rendered.size} 条已保留）` : friendly);
      } finally {
        setShortlistExpandBusy(false);
      }
    },
    [
      enqueueTopicExpandMutation,
      shortlistExpandBusy,
      supervisorAccess,
      pushShortlistDebug,
      focusPrompt,
      enabledPlatformSkillIds,
      allowBloggerTitle,
      scrollToPlatformSection,
    ],
  );

  /** 选题初选卡片：可多处挂载（须各自独立 React 节点 + 不同 domId，禁止复用同一 element） */
  const renderTopicShortlistSection = (domId: string, opts?: { showGenerateButton?: boolean }) => {
    const showGenerateButton = opts?.showGenerateButton !== false;
    return (
      <div
        id={domId}
        className="scroll-mt-24 rounded-2xl border border-[#49e6ff]/25 bg-[rgba(10,15,35,0.75)] px-4 py-4 md:px-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-white md:text-xl">
              选题初选
              {topicShortlist.length > 0 ? (
                <span className="ml-2 text-base font-black text-[#8cefff]">
                  · 已出 {topicShortlist.length} 条
                </span>
              ) : null}
            </div>
            <p className="mt-1 text-[13px] leading-snug text-gray-300">
              默认 {PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT} 条（可调 25/30）；以小红书为主，参考 B站与抖音的近期热点。
              <strong className="text-white/90">这步只出题</strong>，挑哪条、标题改成什么都由你定，确认后才写文案与封面。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-gray-300">
              <span>条数</span>
              {([6, 12, 20, 25, 30] as const).map((n) => (
                <button
                  key={`${domId}-n-${n}`}
                  type="button"
                  onClick={() => setTopicShortlistCount(n)}
                  className={`rounded border px-2.5 py-1 font-semibold ${
                    topicShortlistCount === n
                      ? "border-[#49e6ff]/50 bg-[#49e6ff]/20 text-[#b8f4ff]"
                      : "border-white/15 text-gray-400"
                  }`}
                >
                  {n}
                  {n === PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT
                    ? "·常用"
                    : n > PLATFORM_TOPIC_SHORTLIST_DEFAULT
                      ? "·加量"
                      : "·少出"}
                </button>
              ))}
            </div>
          </div>
          {showGenerateButton ? (
            <div className="flex shrink-0 flex-col items-stretch gap-1.5">
              <button
                type="button"
                disabled={!isAuthenticated || generateTopicShortlistMutation.isPending}
                onClick={() => void runCreateTopicShortlist()}
                className="rounded-xl border border-[#49e6ff]/50 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-[14px] font-bold text-white shadow-[0_10px_32px_rgba(73,230,255,0.18)] transition hover:brightness-110 disabled:opacity-50"
              >
                {generateTopicShortlistMutation.isPending
                  ? "生成中…"
                  : `生成 ${topicShortlistCount} 条选题（${topicShortlistPrice.total} 点）`}
              </button>
              {shortlistFreeQuota?.nextFree ? (
                <button
                  type="button"
                  disabled={!isAuthenticated || generateTopicShortlistMutation.isPending}
                  onClick={() => void runCreateTopicShortlist({ freeTrial: true })}
                  className="rounded-xl border border-emerald-400/45 bg-emerald-500/12 px-5 py-2 text-[12px] font-semibold text-emerald-100 transition hover:brightness-110 disabled:opacity-50"
                >
                  先免费试跑 {shortlistFreeQuota.freeTopics} 条
                  {shortlistFreeQuota.firstFreeLeft > 0 ? `（还剩 ${shortlistFreeQuota.firstFreeLeft} 次）` : "（今日）"}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        {generateTopicShortlistMutation.isPending ? (
          <div className="mt-3 flex items-center gap-2 text-sm text-[#8cefff]">
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
            正在读取小红书 / B站 / 抖音热点并生成约 {topicShortlistCount} 条选题…
          </div>
        ) : null}
        {topicShortlist.length > 0 ? (
          <>
            <p className="mt-3 text-[12px] leading-snug text-gray-400">
              已按爆款概率 + 评论区热度排序，前 {PLATFORM_TOPIC_TOP_PICK_COUNT} 条标了「优先」。
              <strong className="text-white/90">可勾选多条</strong>
              （最多 {PLATFORM_TOPIC_EXPAND_MAX}），再点「写选中的」；也可单条点「就写这条」。改标题后再写。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  const topIds = topicShortlist
                    .filter((t) => t.isTopPick)
                    .map((t) => t.id)
                    .slice(0, PLATFORM_TOPIC_EXPAND_MAX);
                  setSelectedShortlistIds(topIds);
                }}
                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-gray-300"
              >
                勾选优先
              </button>
              <button
                type="button"
                onClick={() => setSelectedShortlistIds([])}
                className="rounded-lg border border-white/15 px-2.5 py-1.5 text-[11px] text-gray-400"
              >
                清空勾选
              </button>
              <button
                type="button"
                disabled={selectedShortlistIds.length === 0 || shortlistExpandBusy}
                onClick={() => {
                  const picks = topicShortlist.filter((t) => selectedShortlistIds.includes(t.id));
                  void expandShortlistPicks(picks);
                }}
                className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-3 py-1.5 text-[11px] font-bold text-emerald-50 disabled:opacity-40"
              >
                {shortlistExpandBusy
                  ? shortlistExpandProgress
                    ? `扩写中 ${shortlistExpandProgress.done}/${shortlistExpandProgress.total}…`
                    : "扩写中…"
                  : `写选中的 ${selectedShortlistIds.length || ""} 条（${
                      CREDIT_COSTS.platformTopicExpand * Math.max(1, selectedShortlistIds.length)
                    } 点 · ${CREDIT_COSTS.platformTopicExpand}/条）`}
              </button>
              <select
                value={platformExpandEngine}
                onChange={(e) => setPlatformExpandEngine(normalizePlatformTopicExpandEngine(e.target.value))}
                title="扩写引擎：稳定档遇高峰自动切备用通道；轻快档速度更快、文风更简"
                className="rounded-lg border border-white/15 bg-black/45 px-2 py-1.5 text-[11px] text-gray-300"
              >
                <option value="kimi-k3">扩写·稳定档</option>
                <option value="qwen3.8-max">扩写·轻快档</option>
                <option value="deepseek-v4">扩写·经济档</option>
              </select>
              <span className="text-[11px] text-gray-500">
                已勾 {selectedShortlistIds.length}/{PLATFORM_TOPIC_EXPAND_MAX}
              </span>
            </div>
            {shortlistExpandBusy ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-emerald-200/90">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                {shortlistExpandProgress && shortlistExpandProgress.done > 0
                  ? `已出 ${shortlistExpandProgress.done}/${shortlistExpandProgress.total} 条，写好的已显示在下方，其余继续生成…`
                  : `正在写第 1 条（共 ${shortlistExpandProgress?.total ?? selectedShortlistIds.length} 条）；每写好一条就会显示，可以先看不用等全部完成`}
              </div>
            ) : null}
            <div className="mt-2 max-h-[420px] space-y-1.5 overflow-y-auto pr-1">
              {topicShortlist.map((t, i) => {
                const checked = selectedShortlistIds.includes(t.id);
                return (
                <div
                  key={`${domId}-${t.id}`}
                  className={`rounded-md border px-2.5 py-2 text-[12px] ${
                    checked
                      ? "border-emerald-400/50 bg-emerald-500/10 text-gray-200"
                      : t.isTopPick
                      ? "border-[#fde047]/40 bg-[#fde047]/8 text-gray-200"
                      : "border-white/10 bg-black/20 text-gray-300"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={shortlistExpandBusy}
                        onChange={() => toggleShortlistSelection(t.id)}
                        className="mt-1 h-3.5 w-3.5 shrink-0 accent-emerald-400"
                        aria-label={`勾选选题：${t.title}`}
                      />
                      <div className="min-w-0 flex-1">
                      <span className="mr-1.5 text-[11px] font-bold text-gray-500">{i + 1}.</span>
                      {t.isTopPick ? (
                        <span className="mr-1.5 rounded bg-[#fde047]/20 px-1.5 py-0.5 text-[10px] font-bold text-[#fde047]">
                          优先
                        </span>
                      ) : null}
                      {editingShortlistTopicId === t.id ? (
                        <input
                          value={editingShortlistTitle}
                          autoFocus
                          maxLength={120}
                          onChange={(e) => setEditingShortlistTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              commitEditingShortlistTitle();
                            }
                            if (e.key === "Escape") cancelEditingShortlistTitle();
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full rounded border border-[#49e6ff]/40 bg-black/40 px-2 py-1 text-[12px] font-semibold text-white outline-none"
                          aria-label="修改选题标题"
                        />
                      ) : (
                        <span className="font-semibold text-white/95">{t.title}</span>
                      )}
                      {typeof t.commentHeat === "number" && editingShortlistTopicId !== t.id ? (
                        <span
                          className={`ml-1.5 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            t.commentHeat >= 70
                              ? "bg-[#ff8fab]/20 text-[#ffb3c6]"
                              : "bg-white/10 text-gray-400"
                          }`}
                          title="预估评论区热度：大家想不想在评论里说话"
                        >
                          评论热 {t.commentHeat}
                        </span>
                      ) : null}
                      <span className="mt-0.5 block text-gray-400">{t.conveyGoal}</span>
                      {t.viralReason ? (
                        <span className="mt-0.5 block text-[11px] text-[#8cefff]/70">
                          {typeof t.viralScore === "number" ? `${t.viralScore} 分 · ` : ""}
                          {t.viralReason}
                        </span>
                      ) : null}
                      </div>
                    </label>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {editingShortlistTopicId === t.id ? (
                        <>
                          <button
                            type="button"
                            onClick={commitEditingShortlistTitle}
                            className="rounded-lg border border-[#49e6ff]/50 bg-[#49e6ff]/20 px-2 py-1.5 text-[11px] font-bold text-[#b8f4ff]"
                          >
                            存标题
                          </button>
                          <button
                            type="button"
                            onClick={cancelEditingShortlistTitle}
                            className="rounded-lg border border-white/15 px-2 py-1.5 text-[11px] text-gray-400"
                          >
                            取消
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => startEditingShortlistTitle(t)}
                            className="rounded-lg border border-white/15 px-2 py-1.5 text-[11px] text-gray-300"
                          >
                            改标题
                          </button>
                          <button
                            type="button"
                            disabled={shortlistExpandBusy}
                            onClick={() => void expandShortlistPicks([t])}
                            className="rounded-lg border border-emerald-400/50 bg-emerald-500/20 px-2.5 py-1.5 text-[11px] font-bold text-emerald-50 disabled:opacity-40"
                          >
                            就写这条
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
              })}
              {shortlistMaskedCount > 0
                ? Array.from({ length: Math.min(shortlistMaskedCount, 8) }).map((_, i) => (
                    <div
                      key={`${domId}-masked-${i}`}
                      className="relative overflow-hidden rounded-md border border-white/10 bg-black/30 px-2.5 py-2"
                      aria-hidden
                    >
                      <div className="select-none blur-[5px]">
                        <div className="h-3 w-3/5 rounded bg-white/25" />
                        <div className="mt-1.5 h-2.5 w-4/5 rounded bg-white/12" />
                      </div>
                    </div>
                  ))
                : null}
            </div>
            {shortlistMaskedCount > 0 ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#fbbf24]/30 bg-[rgba(251,191,36,0.07)] px-3 py-2.5">
                <p className="min-w-0 flex-1 text-[12px] leading-snug text-[#fde68a]">
                  还有 {shortlistMaskedCount} 条没生成。免费这次只跑看得见的几条，解锁后按你选的条数重新出一整批。
                </p>
                <button
                  type="button"
                  disabled={generateTopicShortlistMutation.isPending}
                  onClick={() => void runCreateTopicShortlist()}
                  className="shrink-0 rounded-lg border border-[#fbbf24]/45 bg-[rgba(251,191,36,0.14)] px-3 py-1.5 text-[11px] font-bold text-[#fde68a] transition hover:brightness-110 disabled:opacity-50"
                >
                  解锁 {topicShortlistCount} 条（{topicShortlistPrice.total} 点）
                </button>
              </div>
            ) : null}
          </>
        ) : !generateTopicShortlistMutation.isPending ? (
          <p className="mt-3 text-[12px] text-gray-500">
            点右上「生成 {topicShortlistCount} 条选题」后，选题会出现在这里（约 1–2 分钟）。
          </p>
        ) : null}
        {/* 扩写文案 + 出图按钮：见 renderExpandedShortlistGenZone（接旧 Stage2 同套接线） */}
      </div>
    );
  };

  const platformMainPersonaTopicsPanel = (
    <div className="space-y-4">
      <PlatformStructuredPersonaForm
        id="platform-persona-focus"
        value={structuredPersona}
        onChange={(next) => {
          setStructuredPersona(next);
          // 结构化为 canonical：未 override 时同步序列化到 focusPrompt
          if (!freeformOverride) {
            setFocusPrompt(composeFocusPromptFromPersona(next));
          }
          setPersonaFieldErrors({});
        }}
        freeform={focusPrompt}
        onFreeformChange={(v) => {
          setFocusPrompt(v);
          const composed = composeFocusPromptFromPersona(structuredPersona);
          setFreeformOverride(v.trim() !== composed.trim());
          setPersonaFieldErrors({});
        }}
        errors={personaFieldErrors}
        voiceSlot={
          <VoiceInputButton
            onTranscript={(t) => {
              setFocusPrompt((prev) => (prev ? `${prev} ${t}` : t));
              setFreeformOverride(true);
            }}
            onDebugLog={addVoiceDebug}
            size={26}
          />
        }
      />
      <PlatformPersonaPolishPanel
        id="platform-persona-polish"
        value={focusPrompt}
        onApply={(next) => {
          setFocusPrompt(next);
          setFreeformOverride(true);
          setPersonaFieldErrors({});
        }}
        goal={topicGoal}
        onGoalChange={setTopicGoal}
      />
      <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] px-4 py-3.5 md:px-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white">
              Skill · 已启用 {enabledPlatformSkillIds.size}
              {platformSkillRecommend.labels.length
                ? ` · 推荐 ${platformSkillRecommend.labels.length}`
                : ""}
            </div>
            <p className="mt-1 text-[12px] leading-snug text-gray-300">
              核心已默认开启。推荐原因：匹配你的人物背景
              {platformSkillRecommend.lane !== "default" ? `（赛道 ${platformSkillRecommend.lane}）` : ""}
              。建议加开：
              <span className="text-[#a7f3d0]">
                {platformSkillRecommend.labels.length
                  ? platformSkillRecommend.labels.join(" · ")
                  : "暂无额外赛道（保持核心即可）"}
              </span>
            </p>
            <p className="mt-1 text-[11px] text-[#c9c0e6]/50">选题初选约 1–2 分钟；挑完再扩写，点数见主按钮。</p>
          </div>
          <button
            type="button"
            onClick={applyPlatformSkillRecommend}
            className="shrink-0 rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-[11px] font-semibold text-[#c9c0e6] hover:bg-white/10"
          >
            采纳推荐（次级）
          </button>
        </div>
      </div>

      {renderTopicShortlistSection("platform-topic-shortlist")}
    </div>
  );

  const platformSkillsAccessoryPanel = (
    <details className="rounded-xl border border-white/10 bg-black/25 open:bg-black/30">
      <summary className="cursor-pointer list-none px-4 py-3 text-[12px] font-semibold text-gray-300">
        更多 Skill 与顾问（可选 · 默认折叠，不挡主功能）
        <span className="ml-2 font-normal text-gray-500">
          已开 {enabledPlatformSkillIds.size} 项 · 核心已默认
        </span>
      </summary>
      <div className="space-y-3 border-t border-white/10 px-3 pb-3 pt-3">
      <div
        className="flex items-start gap-3 rounded-2xl border border-[#49e6ff]/20 bg-[linear-gradient(135deg,rgba(73,230,255,0.08),rgba(99,102,241,0.05))] px-3 py-2.5"
        role="status"
        aria-label="Skill 与提示词优先级说明"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#49e6ff]/35 bg-[#49e6ff]/12 text-[#8cefff]">
          <Bot className="h-3.5 w-3.5" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#8cefff]/80">陪衬说明</div>
          <div className="text-[11px] leading-relaxed text-gray-400">
            不选额外 Skill 时只开核心。提示词要求优先于 Skill。想省事就用上方「一键采纳推荐」。
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#49e6ff]/25 bg-[#49e6ff]/6 px-3 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-white/90">创作顾问问答</div>
            <p className="mt-0.5 text-[10px] leading-snug text-gray-500">
              可问创作 / Skill / 运营等问题。 每日免费 {PLATFORM_SKILL_QA_TERRA_DAILY_FREE} 次
              {skillQaRemaining != null ? ` · 今日剩 ${skillQaRemaining}` : ""}
              ，超额 {platformSkillQaPaidCredits("terra")} 积分/次。 生图另计：首张九折{" "}
              {CREDIT_COSTS.platformSkillQaImageFirst} 点，之后{" "}
              {CREDIT_COSTS.platformTopicFrameGraphic} 点。
            </p>
          </div>
          {/* 深度档已下线：只剩一档，不再放选择器（用户 2026-08-05 明文） */}
        </div>
        <textarea
          value={skillQaQuestion}
          onChange={(e) => setSkillQaQuestion(e.target.value)}
          rows={3}
          placeholder="例如：小红书一年各时节热销的电子版/虚拟资料有哪些？封面怎么写才不说教？帮我画一张网球发球封面试试…"
          className="mt-3 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-[12px] text-white placeholder:text-gray-600 focus:border-[#49e6ff]/50 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={askPlatformSkillQaMutation.isPending || !skillQaQuestion.trim()}
            onClick={() => void handleAskPlatformSkillQa()}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#49e6ff]/45 bg-[#49e6ff]/15 px-3 py-1.5 text-[11px] font-bold text-[#b8f4ff] transition hover:bg-[#49e6ff]/25 disabled:opacity-50"
          >
            {askPlatformSkillQaMutation.isPending ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                思考中…
              </>
            ) : (
              "免费提问"
            )}
          </button>
        </div>
        {skillQaAnswer ? (
          <div className="mt-3 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-[12px] leading-relaxed whitespace-pre-wrap text-gray-200">
            {skillQaAnswer}
          </div>
        ) : null}
        {skillQaImageOffer ? (
          <div className="mt-3 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2">
            <p className="text-[11px] leading-snug text-amber-100/90">{skillQaImageOffer.guideMessage}</p>
            {skillQaImageOffer.creationRelated ? (
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="rounded-md border border-[#ff4fb8]/45 bg-[#ff4fb8]/15 px-2.5 py-1 text-[10px] font-bold text-[#ff9fe0]"
                  onClick={() => scrollToPlatformSection("platform-custom-workspace")}
                >
                  去自定义创作（推荐）
                </button>
                <button
                  type="button"
                  className="rounded-md border border-[#7d73ff]/45 bg-[#7d73ff]/15 px-2.5 py-1 text-[10px] font-bold text-[#c4b5fd]"
                  onClick={() => scrollToPlatformSection("platform-report")}
                >
                  去生成选题（推荐）
                </button>
              </div>
            ) : null}
            <p className="mt-2 text-[10px] text-gray-400 line-clamp-3">
              试一张提示词：{skillQaImageOffer.suggestedPrompt}
            </p>
            <button
              type="button"
              disabled={confirmPlatformSkillQaImageMutation.isPending}
              onClick={() => void handleConfirmSkillQaImage()}
              className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-300/40 bg-amber-400/15 px-3 py-1.5 text-[11px] font-bold text-amber-100 disabled:opacity-50"
            >
              {confirmPlatformSkillQaImageMutation.isPending ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  生图中…
                </>
              ) : (
                `确认生图（${skillQaImageOffer.creditCost} 积分${
                  skillQaImageOffer.isFirstImageDiscount ? "·首张九折" : ""
                }）`
              )}
            </button>
          </div>
        ) : null}
        {skillQaImageUrl ? (
          <div className="mt-3 overflow-hidden rounded-lg border border-white/10">
            <img src={skillQaImageUrl} alt="创作顾问生图" className="max-h-[420px] w-full object-contain bg-black/40" />
          </div>
        ) : null}
      </div>

      <div className="rounded-xl border border-[#10B981]/25 bg-[#10B981]/6 px-3 py-2.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-semibold text-white/90">手动勾选 Skill</div>
          <p className="mt-0.5 text-[10px] leading-snug text-gray-500">
            分类默认折叠。不勾选则仅核心生效；也可上方「一键采纳推荐」。
          </p>
        </div>
        <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#10B981]/35 bg-[#10B981]/10 px-2 py-1 text-[10px] font-bold text-[#a7f3d0] transition hover:bg-[#10B981]/20">
          {platformSkillUploading ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              上传中…
            </>
          ) : (
            <>上传 Skill.md</>
          )}
          <input
            type="file"
            accept=".md,text/markdown,text/plain"
            className="hidden"
            disabled={platformSkillUploading || !isAuthenticated}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void handleUploadPlatformSkillFile(f);
            }}
          />
        </label>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-white/10 bg-black/20 px-2.5 py-2 text-[11px] text-gray-300">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={allowBloggerTitle}
          onChange={(e) => setAllowBloggerTitle(e.target.checked)}
        />
        <span>
          <span className="font-semibold text-white/90">允许使用「博主 / 创作者」自称</span>
          <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">
            默认关闭：强制「职业 × 客户 × 场景」。勾选后才允许空壳自称。
          </span>
        </span>
      </label>
      <div className="mt-3 space-y-3">
        {groupPlatformSkillsByCategory(platformSkillsQuery.data?.skills ?? []).map(({ category, skills }) => {
          const enabledCount = skills.filter((sk) => enabledPlatformSkillIds.has(sk.id)).length;
          const allOn = enabledCount === skills.length && skills.length > 0;
          return (
            <details
              key={category.id}
              open={false}
              className="rounded-xl border border-white/10 bg-black/20"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3 py-2.5 text-[11px]">
                <span className="min-w-0">
                  <span className="font-semibold text-white">{category.label}</span>
                  <span className="ml-2 text-gray-500">
                    {enabledCount}/{skills.length} 已开
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">{category.hint}</span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    className="rounded border border-[#10B981]/35 bg-[#10B981]/10 px-2 py-1 text-[10px] font-semibold text-[#a7f3d0]"
                    onClick={(e) => {
                      e.preventDefault();
                      togglePlatformSkillCategory(
                        skills.map((s) => s.id),
                        !allOn,
                      );
                    }}
                  >
                    {allOn ? "本组全关" : "本组全开"}
                  </button>
                </span>
              </summary>
              <div className="grid gap-2 border-t border-white/5 px-2.5 py-2.5 sm:grid-cols-2">
                {skills.map((sk) => {
                  const on = enabledPlatformSkillIds.has(sk.id);
                  return (
                    <label
                      key={sk.id}
                      className={`flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-[11px] transition ${
                        on
                          ? "border-[#10B981]/50 bg-[#10B981]/12 text-white"
                          : "border-white/10 bg-black/20 text-gray-400"
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={on}
                        onChange={() => togglePlatformSkillId(sk.id)}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold text-white/90">{sk.name}</span>
                        <span className="ml-1 text-[10px] text-gray-500">
                          {sk.source === "builtin" ? "内置" : "上传"}
                        </span>
                        {sk.description ? (
                          <span className="mt-0.5 block text-[10px] leading-snug text-gray-500">
                            {sk.description}
                          </span>
                        ) : null}
                      </span>
                      {sk.source === "user" ? (
                        <button
                          type="button"
                          className="shrink-0 text-[10px] text-rose-300/80 hover:text-rose-200"
                          onClick={(ev) => {
                            ev.preventDefault();
                            void (async () => {
                              try {
                                await deletePlatformSkillMutation.mutateAsync({ skillId: sk.id });
                                setEnabledPlatformSkillIds((prev) => {
                                  const next = new Set(prev);
                                  next.delete(sk.id);
                                  return next;
                                });
                                toast.success("已删除上传 Skill");
                                void platformSkillsQuery.refetch();
                              } catch (err) {
                                toast.error(err instanceof Error ? err.message : "删除失败");
                              }
                            })();
                          }}
                        >
                          删除
                        </button>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            </details>
          );
        })}
        {!platformSkillsQuery.data?.skills?.length ? (
          <div className="text-[11px] text-gray-500">
            {platformSkillsQuery.isLoading ? "加载 Skill…" : "暂无 Skill（请确认 docs/2026Jul11/skill 已部署）"}
          </div>
        ) : null}
      </div>

      <div className="mt-2 rounded-lg border border-white/10 bg-black/25 px-3 py-2">
        <div className="text-[11px] font-semibold text-[#a7f3d0]">{PLATFORM_SKILL_MASTER_READONLY.title}</div>
        <p className="mt-1 text-[10px] leading-snug text-gray-500">{PLATFORM_SKILL_MASTER_READONLY.summary}</p>
      </div>
      </div>
      </div>
      </details>
  );

  /** Fly worker 回传后解析 platformContent（轮询与错误处理集中一处，供初次与重试共用） */
  const runStage2FromJobId = useCallback(async (jobId: string) => {
    setContentLoadingText("Pro 深度优化选题后，正在生成专属文案…");
    const j = await pollJobUntilTerminal(jobId, {
      intervalMs: 2500,
      maxWaitMs: 25 * 60_000,
      adaptiveBackoffAfterAttempts: 36,
      maxIntervalMs: 8000,
      onPoll: ({ attempt, status, output }) => {
        setContentJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? { ...prev, pollCount: attempt, currentStep: `轮询 · ${attempt} 次` }
            : prev,
        );
        if (status === "queued") {
          setContentLoadingText("任务排队中，请稍候…");
        } else if (status === "running") {
          // Show partial blueprints immediately as they are generated one by one
          if (output && typeof output === "object" && !Array.isArray(output)) {
            const runningOut = output as Record<string, unknown>;
            const partialPc = runningOut.platformContent;
            if (partialPc && typeof partialPc === "object" && !Array.isArray(partialPc)) {
              const pcObj = partialPc as Record<string, unknown>;
              const partialBps = Array.isArray(pcObj.contentBlueprints) ? pcObj.contentBlueprints : [];
              if (partialBps.length > 0) {
                // Incrementally update platformContent so UI can render as blueprints arrive
                setPlatformContent((prev) => {
                  const prevBps = Array.isArray(prev?.contentBlueprints) ? prev!.contentBlueprints : [];
                  // Only update if we have more blueprints than before
                  if (partialBps.length > prevBps.length) {
                    return {
                      contentBlueprints: partialBps as typeof prevBps,
                      monetizationLanes: (prev?.monetizationLanes ?? []),
                    };
                  }
                  return prev;
                });
                const count = partialBps.length;
                setContentLoadingText(`已生成 ${count}/6 条专属选题，继续生成中…`);
                return;
              }
            }
          }
          if (attempt < 12) setContentLoadingText("后台正在生成专属文案（撰写与校对中）…");
          else if (attempt < 28) setContentLoadingText("内容较长，后台仍在处理…");
          else setContentLoadingText("已等待较久，后台仍在处理；请勿关闭页面…");
        }
      },
    });
    if (j.status === "failed") {
      const out = j.output;
      if (out && typeof out === "object" && !Array.isArray(out)) {
        const d = (out as Record<string, unknown>).debug;
        if (d && typeof d === "object" && !Array.isArray(d)) {
          setContentDebug(d as Record<string, unknown>);
        }
      }
      setContentJobPollTrace((prev) =>
        prev && prev.jobId === jobId
          ? {
              ...prev,
              terminalStatus: j.status,
              lines: appendPollDebugLine(
                prev.lines,
                `${new Date().toISOString()} 轮询结束 · status=failed · error=${j.error || ""}`,
              ),
            }
          : prev,
      );
      throw new Error(j.error || "专属文案任务失败");
    }
    const raw = j.output;
    if (!raw || typeof raw !== "object") {
      setContentJobPollTrace((prev) =>
        prev && prev.jobId === jobId
          ? {
              ...prev,
              terminalStatus: j.status,
              lines: appendPollDebugLine(
                prev.lines,
                `${new Date().toISOString()} 任务返回但无法解析 output`,
              ),
            }
          : prev,
      );
      throw new Error("任务已完成但无有效输出，请重试");
    }
    const out = raw as Record<string, unknown>;
    const res = {
      platformContent: (out.platformContent ?? null) as typeof out.platformContent,
      debug: (out.debug && typeof out.debug === "object" && !Array.isArray(out.debug)
        ? (out.debug as Record<string, unknown>)
        : {}) as Record<string, unknown>,
    };
    const dbg = res.debug as
      | {
          totalMs?: number;
          stage2Error?: string | null;
          stage2TimedOut?: boolean;
        }
      | undefined;
    if (dbg?.stage2Error) {
      setContentDebug(res.debug as Record<string, unknown>);
      setContentJobPollTrace((prev) =>
        prev && prev.jobId === jobId
          ? {
              ...prev,
              lines: appendPollDebugLine(
                prev.lines,
                `${new Date().toISOString()} stage2Error: ${dbg.stage2Error}`,
              ),
            }
          : prev,
      );
      throw new Error(dbg.stage2Error);
    }
    if (dbg?.stage2TimedOut) {
      setContentDebug(res.debug as Record<string, unknown>);
      setContentJobPollTrace((prev) =>
        prev && prev.jobId === jobId
          ? {
              ...prev,
              lines: appendPollDebugLine(
                prev.lines,
                `${new Date().toISOString()} stage2TimedOut · totalMs=${dbg?.totalMs ?? "?"}`,
              ),
            }
          : prev,
      );
      throw new Error("专属文案生成逾时，请稍后再试或缩短背景描述");
    }
    if (res.platformContent) {
      const pc = res.platformContent as { contentBlueprints?: unknown[]; monetizationLanes?: unknown[] };
      const bp = Array.isArray(pc.contentBlueprints) ? pc.contentBlueprints.length : 0;
      const ml = Array.isArray(pc.monetizationLanes) ? pc.monetizationLanes.length : 0;
      if (bp === 0 && ml === 0) {
        const snippet = formatStage2DebugSnippet(res.debug as Record<string, unknown> | undefined);
        const dbgObj =
          res.debug && typeof res.debug === "object" && !Array.isArray(res.debug)
            ? (res.debug as Record<string, unknown>)
            : null;
        setContentDebug(dbgObj && Object.keys(dbgObj).length > 0 ? dbgObj : null);
        setContentJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                lines: appendPollDebugLine(
                  prev.lines,
                  snippet
                    ? `${new Date().toISOString()} Stage 2 任务成功但 0 条选题 · 摘要: ${snippet}`
                    : `${new Date().toISOString()} Stage 2 任务成功但 0 条选题（无 buildPlatformContent 摘要）`,
                ),
              }
            : prev,
        );
        toast.error(
          "专属文案没有生成有效选题（0 条）。请展开下方 Debug「Stage 2」查看 buildPlatformContent，或重新分析一次。",
        );
      } else {
        setContentJobPollTrace(null);
        setContentDebug(null);
      }
      setPlatformContent(res.platformContent as any);
    } else {
      const snippet = formatStage2DebugSnippet(res.debug as Record<string, unknown> | undefined);
      const dbgObj =
        res.debug && typeof res.debug === "object" && !Array.isArray(res.debug)
          ? (res.debug as Record<string, unknown>)
          : null;
      setContentDebug(dbgObj && Object.keys(dbgObj).length > 0 ? dbgObj : null);
      setContentJobPollTrace((prev) =>
        prev && prev.jobId === jobId
          ? {
              ...prev,
              lines: appendPollDebugLine(
                prev.lines,
                snippet
                  ? `${new Date().toISOString()} 未返回 platformContent · 摘要: ${snippet}`
                  : `${new Date().toISOString()} 未返回 platformContent（无 debug 摘要）`,
              ),
            }
          : prev,
      );
      setContentJobError("专属文案生成失败：任务完成但未返回有效内容");
      toast.error("专属文案生成失败：AI 数据格式异常，请重试");
    }
  }, []);

  /** 入队并轮询专属文案（扣费发生在后端 enqueue 时）；供主流程链式调用与手动重试 */
  const enqueueAndPollExclusiveContent = useCallback(
    async (
      dash: PlatformDashboard,
      snapshotSummary: Record<string, unknown>,
      windowDays: PlatformWindowDays,
      /** 若傳入（含 `""`），本輪入隊用該字串；省略則用當前 `focusPrompt`（手動重試 Stage 2） */
      capturedJudgment?: string,
    ) => {
      setContentJobError(null);
      setIsContentLoading(true);
      setStage2Failed(false);
      setContentLoadingText("正在提交专属文案后台任务…");
      setContentDebug(null);
      try {
        const ctxForJob =
          capturedJudgment !== undefined
            ? String(capturedJudgment).trim() || undefined
            : focusPrompt.trim() || undefined;
        const { jobId } = await enqueuePlatformContentJobMutation.mutateAsync({
          context: ctxForJob,
          windowDays,
          platformMenu: dash.platformMenu || [],
          globalBlueOceanWords: visualReportData?.globalBlueOceanWords ?? [],
          snapshotSummary,
          strategicDashboard: dash as unknown as Record<string, unknown>,
          stage2LlmMode: "openai" as const,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
        });
        setContentJobPollTrace({
          jobId,
          label: "Stage 2 · platform_build_content",
          lines: [
            `${new Date().toISOString()} 已入队 · 专属文案生成`,
          ],
          pollCount: 0,
          currentStep: "已入队，等待轮询…",
        });
        await runStage2FromJobId(jobId);
      } catch (e) {
        console.warn("[PlatformPage] Stage 2 enqueue/poll error:", e);
        const msg = e instanceof Error ? e.message : String(e);
        setStage2Failed(true);
        setContentJobError(msg);
        toast.error(sanitizePlatformUserMessage(msg, "文案生成失败，请稍后重试"));
        setContentJobPollTrace((prev) =>
          prev
            ? {
                ...prev,
                terminalStatus: prev.terminalStatus ?? "client_error",
                lines: appendPollDebugLine(prev.lines, `${new Date().toISOString()} 客户端异常: ${msg}`),
              }
            : prev,
        );
      } finally {
        setIsContentLoading(false);
      }
    },
    [
      focusPrompt,
      enqueuePlatformContentJobMutation,
      runStage2FromJobId,
      platformCopyLlmEngine,
      visualReportData,
      enabledPlatformSkillIds,
      allowBloggerTitle,
    ],
  );

  /** 用户确认后入队 Stage 2（后端立即扣积分）并轮询直至完成 */
  const startStage2ContentGeneration = useCallback(async () => {
    if (!platformDashboard || !lastStage2InputRef.current) {
      toast.error("请先完成战略看板分析");
      return;
    }
    const inp = lastStage2InputRef.current;
    const cost = CREDIT_COSTS.platformStage2Copywriting;
    if (
      !window.confirm(
        `专属文案与选题将消耗 ${cost} 积分，确认后立即扣费并由后台生成（约数分钟，请勿关闭页面）。是否继续？`,
      )
    ) {
      return;
    }
    await enqueueAndPollExclusiveContent(platformDashboard, inp.snapshotSummary, inp.windowDays);
  }, [platformDashboard, enqueueAndPollExclusiveContent]);

  const retryStage2Content = useCallback(async () => {
    await startStage2ContentGeneration();
  }, [startStage2ContentGeneration]);

  const buildManhuaLocalLearnCmd = useCallback((row: ManhuaLearnSourceRow) => {
    const title = String(row.mixName || "").trim();
    const url = String(row.url || "").trim();
    const localFileName = String(row.localFileName || "").trim();
    if (localFileName) {
      const command = `pnpm run manhua:template-learn -- --video ${JSON.stringify(`/完整路径/${localFileName}`)} --title ${JSON.stringify(title)}`;
      return command;
    }
    if (url) {
      // 远程学习不再回退到本机 yt-dlp 下载；只保留用户主动导入本地文件的 CLI。
      return "";
    }
    return `pnpm run manhua:template-learn -- --title ${JSON.stringify(title)}`;
  }, []);

  const copyManhuaLocalLearnFallback = useCallback(
    async (row: ManhuaLearnSourceRow, reasonZh: string) => {
      const learnCmd = buildManhuaLocalLearnCmd(row);
      const title = String(row.mixName || "").trim();
      const url = String(row.url || "").trim();
      let copied = false;
      if (!learnCmd) {
        toast.error("云端媒体流未完成", {
          description: "已停止「再下载一次」的碰运气回退；请稍后重试，或手动导入本地视频学习。",
        });
        return;
      }
      copied = await copyText(learnCmd);
      setManhuaLearnResult((prev) =>
        manhuaLearnResultFromLocalFallback({
          reasonZh: copied
            ? reasonZh
            : `${reasonZh}（未能自动复制，请手动复制下方命令）`,
          cmd: learnCmd,
          url,
          title,
          prev,
        }),
      );
      setManhuaLearnPanelCollapsed(false);
      toast.message("学习进度已更新", {
        description: copied
          ? "已回退本机学习：命令已复制，步骤见下方面板。"
          : "已回退本机学习：步骤与命令见下方面板。",
      });
    },
    [buildManhuaLocalLearnCmd],
  );

  const applyManhuaLearnJobOutput = useCallback((out: Record<string, unknown>) => {
    const next = manhuaLearnResultFromJobOutput(out);
    if (manhuaLearnContinueRef.current && next.seriesKey) {
      const continuation = {
        ...manhuaLearnContinueRef.current,
        seriesKey: next.seriesKey,
        savedAt: Date.now(),
      };
      manhuaLearnContinueRef.current = continuation;
      writeManhuaLearnContinuation(manhuaLearnUserKey, continuation);
    }
    setManhuaLearnResult((prev) => {
      const mergedLines = [
        ...(prev?.progressLines || []),
        ...(next.progressLines || []),
      ];
      // 去重：同 stage+detail 相邻只留一条
      const progressLines: NonNullable<ManhuaLearnResultUi["progressLines"]> = [];
      for (const line of mergedLines) {
        const last = progressLines[progressLines.length - 1];
        if (last && last.stage === line.stage && last.detailZh === line.detailZh) continue;
        progressLines.push(line);
      }
      return {
        ...next,
        startedAtIso: prev?.startedAtIso || next.startedAtIso,
        progressLines: progressLines.slice(-40),
        liveLabelZh: next.liveLabelZh || prev?.liveLabelZh,
      };
    });
    setManhuaLearnPanelCollapsed(false);
    if (next.seriesKey) {
      setManhuaLearnFocusSeriesKey(next.seriesKey);
      writeManhuaLearnFocusSeriesKey(manhuaLearnUserKey, next.seriesKey);
    }
  }, [manhuaLearnUserKey]);

  const runManhuaTemplateLearnCloud = useCallback(
    async (
      row: ManhuaLearnSourceRow,
      rank: number,
      resumeSeriesKey?: string,
      options?: { refreshPreviewFrames?: boolean; retrySkippedEpisodes?: boolean },
    ) => {
      const canOps = hasSupervisorOpsAccess;
      if (!canOps) {
        toast.error("学节奏为监管专用");
        return;
      }
      if (!user?.id) {
        toast.error("请先登录后再学节奏");
        return;
      }
      const requestUserKey = manhuaLearnUserKey;
      if (!requestUserKey) return;
      // 0826 回归修复：modal_id 搜索页先规范化成 /video/ 单集形态再进任何闸与提交
      const url = normalizeDouyinVideoUrl(String(row.url || "").trim());
      const gcsUri = String(row.gcsUri || "").trim();
      const title = String(row.mixName || "").trim();
      const source = gcsUri || url;
      const busyKey = String(row.mixId || source || title || rank);
      const isKuaishou = row.platform === "kuaishou";
      if (!source) {
        if (isKuaishou && title) {
          if (await copyText(title)) {
            toast.message("暂无成片链接", {
              description: "已复制剧名，请自行找到合集/成片后再学节奏。",
            });
          } else {
            toast.message("暂无成片链接", {
              description: title ? `可搜索剧名：${title}` : "该行无可用链接，无法下片学习。",
            });
          }
          return;
        }
        await copyManhuaLocalLearnFallback(row, "无成片链接，无法云端下片");
        return;
      }
      // 0826：url 已在入口规范化，带 modal_id 的形态不复存在——仍是 /search/ 的就是真搜索页
      if (
        url
        && (
          /douyin\.com\/search\//i.test(url)
          || /kuaishou\.com\/search\//i.test(url)
        )
      ) {
        await copyManhuaLocalLearnFallback(row, "当前是搜索页链接");
        return;
      }
      let nativeConfirmedParams: Record<string, unknown> = {};
      const nativePlanCandidate =
        (row.platform === "douyin" || /(?:^|\.)douyin\.com/i.test((() => {
          try {
            return new URL(url).hostname;
          } catch {
            return "";
          }
        })()))
        && Boolean(url)
        && !gcsUri
        && options?.refreshPreviewFrames !== true
        && options?.retrySkippedEpisodes !== true;
      const nativeGate = resolveManhuaNativeDeepReadGate({
        candidate: nativePlanCandidate,
        capabilityLoading: manhuaTemplateOwnerCapabilitiesQuery.isLoading,
        capabilityError: manhuaTemplateOwnerCapabilitiesQuery.isError,
        ownerAllowed: ownerTemplateOptimizeAllowed,
      });
      if (nativeGate === "blocked_unconfirmed") {
        toast.error("正在确认原生精读权限", {
          description: "权限状态未确认前不会回落旧学习链，请稍后再点一次。",
        });
        setManhuaLearnBusyKey(null);
        return;
      }
      if (nativeGate === "blocked_not_owner") {
        toast.error("原生精读仅限站点拥有者", {
          description: "本次未建立任务，也没有回落旧学习链。",
        });
        setManhuaLearnBusyKey(null);
        return;
      }
      if (nativeGate === "unsupported_source") {
        toast.error("当前素材不能进入原生精读", {
          description: "本次未建立任务；请使用可解析的抖音单集或合集链接。",
        });
        setManhuaLearnBusyKey(null);
        return;
      }
      if (nativeGate === "ready") {
        // 点击即建立真实后台任务；worker 会在同一任务内完成素材、集数、占位与调用上限校验。
        // 这里不再先调用前端预演接口，也不再弹出第二次确认框。
        nativeConfirmedParams = {
          nativeDeepReadConfirmed: true,
          nativeMaxCalls: NATIVE_DEEP_READ_JOB_MAX_CALLS,
          nativePlanLimit: manhuaLearnBatchSize,
        };
      }
      const continuation: ManhuaLearnContinuation = {
        row: { ...row },
        rank,
        seriesKey: String(resumeSeriesKey || "").trim() || undefined,
        savedAt: Date.now(),
      };
      manhuaLearnContinueRef.current = continuation;
      writeManhuaLearnContinuation(manhuaLearnUserKey, continuation);
      setManhuaLearnContinueDismissedKey("");
      setManhuaLearnBusyKey(busyKey);
      const startUi = manhuaLearnResultFromStart({
        channel: "cloud",
        url: source,
        title,
        seriesKey: continuation.seriesKey,
        pipelineMode: "native_deep_read",
      });
      setManhuaLearnResult(startUi);
      setManhuaLearnPanelCollapsed(false);
      setManhuaLearnFocusSeriesKey(startUi.seriesKey);
      writeManhuaLearnFocusSeriesKey(manhuaLearnUserKey, startUi.seriesKey);
      setManhuaLearnJobPollTrace({
        jobId: "pending",
        label: `学节奏 · ${title.slice(0, 24) || "未命名"}`,
        lines: [`${new Date().toISOString()} 准备入队…`],
        pollCount: 0,
        currentStep: "准备入队",
      });
      // 新任务只负责持久入队；后续进度由服务端任务列表统一恢复/轮询，页面关闭不影响执行。
      continuation.seriesKey = startUi.seriesKey;
      const optimisticItem: ManhuaLearnBasketItem = {
        seriesKey: startUi.seriesKey,
        continuation,
        result: startUi,
        updatedAt: Date.now(),
        jobStatus: "queued",
      };
      setManhuaLearnBasket((prev) => {
        const next = upsertManhuaLearnBasketItem(prev, optimisticItem);
        writeManhuaLearnBasket(requestUserKey, next);
        return next;
      });
      try {
        const { jobId } = await createJob({
          type: "video",
          userId: String(user.id),
          input: {
            action: "manhua_template_learn",
            params: {
              url,
              gcsUri: gcsUri || undefined,
              fileName: String(row.fileName || "").trim() || undefined,
              title,
              mixId: String(row.mixId || "").trim() || undefined,
              platform: row.platform || undefined,
              rank,
              seriesKey: startUi.seriesKey,
              dedupeKey: source,
              batchSize: options?.refreshPreviewFrames ? 8 : manhuaLearnBatchSize,
              refreshPreviewFrames: options?.refreshPreviewFrames === true,
              retrySkippedEpisodes: options?.retrySkippedEpisodes === true,
              learnLlm: row.learnLlm,
              ...nativeConfirmedParams,
            },
          },
        });
        if (manhuaLearnUserKeyRef.current !== requestUserKey) return;
        setManhuaLearnBasket((prev) => {
          const next = upsertManhuaLearnBasketItem(prev, {
            ...optimisticItem,
            jobId,
            jobStatus: "queued",
            updatedAt: Date.now(),
          });
          writeManhuaLearnBasket(requestUserKey, next);
          return next;
        });
        setManhuaLearnJobPollTrace((prev) => ({
          jobId,
          label: prev?.label || `学节奏 · ${title.slice(0, 24) || "未命名"}`,
          lines: appendPollDebugLine(prev?.lines || [], `${new Date().toISOString()} 已持久入队 jobId=${jobId}`),
          pollCount: 0,
          currentStep: "服务器已接管",
        }));
        await refreshManhuaLearnServerJobs();
        toast.message("已交给服务器学习", {
          description: "最多同时学习两部，其余自动排队；关闭页面也会继续。",
        });
      } catch (e) {
        if (manhuaLearnUserKeyRef.current !== requestUserKey) return;
        const msg = sanitizePlatformUserMessage(e instanceof Error ? e.message : String(e));
        const failed = manhuaLearnResultFromFailure({ errorZh: msg, url, title, prev: startUi });
        setManhuaLearnResult(failed);
        setManhuaLearnBasket((prev) => {
          const next = upsertManhuaLearnBasketItem(prev, {
            ...optimisticItem,
            result: failed,
            jobStatus: "failed",
            jobErrorZh: msg,
            updatedAt: Date.now(),
          });
          writeManhuaLearnBasket(requestUserKey, next);
          return next;
        });
        toast.error("学习入队失败", { description: msg });
      } finally {
        if (manhuaLearnUserKeyRef.current === requestUserKey) {
          setManhuaLearnBusyKey(null);
        }
      }
      return;
    },
    [
      hasSupervisorOpsAccess,
      user?.id,
      copyManhuaLocalLearnFallback,
      refreshManhuaLearnServerJobs,
      manhuaLearnBatchSize,
      manhuaLearnUserKey,
      ownerTemplateOptimizeAllowed,
      manhuaTemplateOwnerCapabilitiesQuery.isError,
      manhuaTemplateOwnerCapabilitiesQuery.isLoading,
    ],
  );

  /**
   * 刷新/断线恢复：接管同一个后台 job，而不是重新入队。
   * job 终态后才清 active marker；轮询网络失败则保留，下一次刷新仍可继续接管。
   */
  useEffect(() => {
    const active = manhuaLearnActiveJob;
    if (!manhuaLearnServerJobsHydrated) return;
    if (!active || !manhuaLearnUserKey) return;
    if (!hasSupervisorOpsAccess) return;
    if (manhuaLearnPollingJobIdRef.current === active.jobId) return;

    let cancelled = false;
    let terminalReached = false;
    const { continuation, jobId, busyKey } = active;
    const row = continuation.row;
    const url = String(row.url || "").trim();
    const title = String(row.mixName || "").trim();
    manhuaLearnPollingJobIdRef.current = jobId;
    manhuaLearnContinueRef.current = continuation;
    writeManhuaLearnContinuation(manhuaLearnUserKey, continuation);
    setTrendInsightTab("ai_manhua");
    setManhuaLearnBusyKey(busyKey);
    if (continuation.seriesKey) {
      setManhuaLearnFocusSeriesKey(continuation.seriesKey);
      writeManhuaLearnFocusSeriesKey(manhuaLearnUserKey, continuation.seriesKey);
    }
    setManhuaLearnResult((prev) =>
      prev ||
      manhuaLearnResultFromStart({
        channel: "cloud",
        url,
        title,
        seriesKey: continuation.seriesKey,
      }),
    );
    setManhuaLearnJobPollTrace({
      jobId,
      label: `恢复学习 · ${title.slice(0, 24) || "未命名"}`,
      lines: [`${new Date().toISOString()} 刷新后重新接管后台任务…`],
      pollCount: 0,
      currentStep: "正在恢复后台进度…",
    });

    void (async () => {
      let pollAttempt = 0;
      try {
        const job = await pollJobUntilTerminal(jobId, {
          maxWaitMs: 95 * 60_000,
          onPoll: (tick) => {
            if (cancelled) return;
            pollAttempt += 1;
            const out = (tick.output || {}) as Record<string, unknown>;
            const log = Array.isArray(out.learnProgressLog)
              ? (out.learnProgressLog as Array<{ detailZh?: string }>)
              : [];
            const currentStep = String(
              log[log.length - 1]?.detailZh || out.analysisStageLabel || tick.status,
            ).slice(0, 200);
            setManhuaLearnJobPollTrace((prev) => ({
              jobId,
              label: prev?.label || `恢复学习 · ${title.slice(0, 24) || "未命名"}`,
              lines: appendPollDebugLine(
                prev?.lines || [],
                `${new Date().toISOString()} #${pollAttempt} ${tick.status} · ${currentStep}`,
              ),
              pollCount: pollAttempt,
              currentStep,
              terminalStatus: undefined,
            }));
            setManhuaLearnResult((prev) =>
              mergeManhuaLearnLiveProgress(prev, {
                status: tick.status,
                output: tick.output,
              }),
            );
          },
        });
        if (cancelled) return;
        terminalReached = true;
        if (job.status !== "succeeded") {
          const errZh = sanitizePlatformUserMessage(job.error || "云端学习失败");
          setManhuaLearnResult((prev) =>
            manhuaLearnResultFromFailure({ errorZh: errZh, url, title, prev }),
          );
          setManhuaLearnJobPollTrace((prev) =>
            prev
              ? { ...prev, terminalStatus: job.status, currentStep: errZh }
              : prev,
          );
          return;
        }
        const out = (job.output || {}) as Record<string, unknown>;
        if (isManhuaLearnEmptyBatchFailure(out)) {
          const errZh = sanitizePlatformUserMessage(
            String(out.messageZh || "本轮未能成功采下新集"),
          );
          setManhuaLearnResult((prev) =>
            manhuaLearnResultFromFailure({ errorZh: errZh, url, title, prev }),
          );
          return;
        }
        applyManhuaLearnJobOutput(out);
        void manhuaViralProposalsRefetchRef.current();
        setManhuaLearnJobPollTrace((prev) =>
          prev
            ? {
                ...prev,
                terminalStatus: "succeeded",
                currentStep: String(out.messageZh || "本轮学习结束").slice(0, 160),
              }
            : prev,
        );
      } catch (e) {
        if (cancelled) return;
        const msg = sanitizePlatformUserMessage(e instanceof Error ? e.message : String(e));
        setManhuaLearnResult((prev) =>
          manhuaLearnResultFromFailure({
            errorZh: `${msg}（后台任务记录已保留，刷新可继续恢复）`,
            url,
            title,
            prev,
          }),
        );
        // 后台 job 可能在旧版本部署时已被清理。不能继续把本地 active marker
        // 当作“运行中”，否则“继续学习”永久 disabled；保留剧集与已落盘检查点，
        // 让用户一键重新入队并从未学集继续。
        setManhuaLearnActiveJob(null);
        writeManhuaLearnActiveJob(manhuaLearnUserKey, null);
        setManhuaLearnBasket((prev) => {
          const next = prev.map((item) =>
            item.jobId === jobId
              ? {
                  ...item,
                  jobStatus: "failed" as const,
                  jobErrorZh: msg,
                  updatedAt: Date.now(),
                }
              : item,
          );
          writeManhuaLearnBasket(manhuaLearnUserKey, next);
          return next;
        });
      } finally {
        if (cancelled) return;
        manhuaLearnPollingJobIdRef.current = null;
        setManhuaLearnBusyKey(null);
        if (terminalReached) {
          setManhuaLearnActiveJob(null);
          writeManhuaLearnActiveJob(manhuaLearnUserKey, null);
        }
      }
    })();

    return () => {
      cancelled = true;
      if (manhuaLearnPollingJobIdRef.current === jobId) {
        manhuaLearnPollingJobIdRef.current = null;
      }
    };
  }, [
    applyManhuaLearnJobOutput,
    manhuaLearnActiveJob,
    manhuaLearnServerJobsHydrated,
    hasSupervisorOpsAccess,
    manhuaLearnUserKey,
  ]);

  const approveManhuaLearnProposal = useCallback(
    async (id: string, nameZh?: string, revisionOf?: string) => {
      const confirmMessage = revisionOf
        ? `确认批准「${nameZh || "该优化修订"}」并替换原正式模板？原版会先归档，公开句柄保持不变。`
        : `确认批准「${nameZh || "该节奏模板"}」进节奏模板库？批准后编剧室可选，无需改代码发版。`;
      if (!window.confirm(confirmMessage)) {
        return;
      }
      try {
        // 审查收紧：只传 id，服务端按落盘提案批准，不信任客户端卡片
        const res = await approveManhuaViralTemplateMutation.mutateAsync({
          id,
          confirmApprove: true,
        });
        toast.success(revisionOf ? `已替换正式模板：${res.card.nameZh}` : `已批准进库：${res.card.nameZh}`);
        setManhuaLearnResult((prev) =>
          prev
            ? {
                ...prev,
                proposal: prev.proposal
                  ? { ...prev.proposal, nameZh: res.card.nameZh }
                  : prev.proposal,
              }
            : prev,
        );
        await manhuaViralProposalsQuery.refetch();
        setSelectedManhuaProposalId("");
        void manhuaViralApprovedQuery.refetch();
        // 批准改变了「哪些卡是现役的」，换代体检的结论必须跟着重算，
        // 否则体检还在建议「换成这张待审卡」，而它已经批准进库了
        await invalidateTemplateLifecycle(res.card.id);
      } catch (e) {
        toast.error(sanitizePlatformUserMessage(e instanceof Error ? e.message : String(e)));
      }
    },
    [
      approveManhuaViralTemplateMutation,
      manhuaViralProposalsQuery,
      manhuaViralApprovedQuery,
      invalidateTemplateLifecycle,
    ],
  );

  // Stage 1 Mutation: 战略看板（除 handleAnalyze 外通常不单独触发；成功时不保留 debug，仅失败时保留）
  const getPlatformDashboardMutation = trpc.mvAnalysis.getPlatformDashboard.useMutation({
    onSuccess: (result) => {
      const dbg = result.debug as Record<string, unknown> | null | undefined;
      const hasErr = Boolean(dbg && typeof dbg.error === "string" && String(dbg.error).trim().length > 0);
      const ok = Boolean(result.platformDashboard) && !hasErr;
      setDashboardDebug(ok ? null : (dbg ?? null));
    },
    onError: (error) => {
      console.warn("[PlatformPage] dashboard mutation error:", error.message);
    },
  });

  /** 全案短链：只补 monetizationLanes，不重跑六条文案 */
  const generatePlatformMonetizationLanesMutation =
    trpc.mvAnalysis.generatePlatformMonetizationLanes.useMutation();

  const enqueueVisualReportMutation = trpc.mvAnalysis.enqueueVisualReport.useMutation();

  const monitorVisualReportJob = useCallback(async (
    pending: PlatformVisualReportPendingJobV1,
    announceSuccess: boolean,
  ) => {
    if (visualReportPollingJobRef.current === pending.jobId) return;
    visualReportPollingJobRef.current = pending.jobId;
    setVisualReportError(null);
    setTrendStandaloneBusy(true);
    setIsVisualReportLoading(true);
    try {
      const job = await pollJobUntilTerminal(pending.jobId, {
        intervalMs: 2_000,
        maxWaitMs: 15 * 60_000,
      });
      if (job.status === "failed") {
        writePlatformVisualReportPendingJob(null);
        const message = sanitizePlatformUserMessage(
          String(job.error || ""),
          "趋势报表生成失败，积分已进入退回流程，请重试",
        );
        setVisualReportError(message);
        toast.error(message);
        return;
      }
      const mapped = mapGenerateVisualReportResult(job.output || {}, {
        windowDays: pending.windowDays,
        theme: pending.theme,
      });
      if (!mapped) {
        writePlatformVisualReportPendingJob(null);
        const message = `后台任务 ${pending.jobId} 已结束，但返回格式异常，请联系客服核对`;
        setVisualReportError(message);
        toast.error(message);
        return;
      }
      writePlatformVisualReportPendingJob(null);
      visualReportOwnerRef.current = pending.userId;
      setVisualReportData(mapped);
      setTrendInsightTab("overview");
      setHasAnalyzed(true);
      if (announceSuccess) toast.success("平台趋势 PNG 报表已生成");
      window.setTimeout(() => {
        document
          .getElementById("platform-trend-visual-report")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 120);
    } catch (error) {
      // 轮询网络中断或页面停留超时不删除 pending；刷新页面后继续同一 job，不重复扣费。
      const message = sanitizePlatformUserMessage(
        error instanceof Error ? error.message : String(error),
        "趋势报表仍在后台生成，可刷新页面继续查看",
      );
      setVisualReportError(message);
      toast.error(message);
    } finally {
      visualReportPollingJobRef.current = null;
      setTrendStandaloneBusy(false);
      setIsVisualReportLoading(false);
    }
  }, []);

  /**
   * 服务端最新任务是刷新恢复的唯一真源；本机 pending 只补充窗口/主题，不能盖过服务端更新的 jobId。
   * 这样可避免另一标签页已重跑时，本页刷新却继续轮询旧任务并覆盖新结果。
   */
  useEffect(() => {
    if (latestVisualReportQuery.isLoading) return;
    const userId = String(user?.id || "").trim();
    const latest = latestVisualReportQuery.data;
    if (!userId || !latest || String(latest.userId || "") !== userId || !latest.jobId) return;
    const windowDays = ["3", "7", "15", "30"].includes(String(latest.windowDays))
      ? String(latest.windowDays) as "3" | "7" | "15" | "30"
      : "7";
    const theme = latest.theme === "light" ? "light" : "dark";
    if (latest.status === "queued" || latest.status === "running") {
      const savedPending = readPlatformVisualReportPendingJob(userId);
      const pending = resolvePlatformVisualReportPendingJob({
        saved: savedPending,
        latestJobId: latest.jobId,
        userId,
        windowDays,
        theme,
        createdAt: Date.parse(String(latest.createdAt || "")) || Date.now(),
      });
      writePlatformVisualReportPendingJob(pending);
      void monitorVisualReportJob(pending, true);
      return;
    }
    if (latest.status === "failed") {
      writePlatformVisualReportPendingJob(null);
      if (!visualReportData) {
        setVisualReportError(sanitizePlatformUserMessage(
          String(latest.error || ""),
          "最近一次趋势报表生成失败，积分已进入退回流程",
        ));
      }
      return;
    }
    if (!latest.result) return;
    const hasPendingJob = Boolean(readPlatformVisualReportPendingJob(userId));
    if (!shouldRestoreLatestVisualReport({
      currentUserId: userId,
      responseUserId: String(latest.userId || ""),
      hasPendingJob,
      hasCurrentReport: Boolean(visualReportData),
      hasCurrentError: Boolean(visualReportError),
      busy: trendStandaloneBusy,
    })) return;
    const mapped = mapGenerateVisualReportResult(latest.result, { windowDays, theme });
    if (mapped) {
      visualReportOwnerRef.current = userId;
      setVisualReportData(mapped);
      setHasAnalyzed(true);
    }
  }, [
    latestVisualReportQuery.data,
    latestVisualReportQuery.isLoading,
    monitorVisualReportJob,
    trendStandaloneBusy,
    user?.id,
    visualReportData,
    visualReportError,
  ]);

  const askPlatformFollowUpMutation = trpc.mvAnalysis.askPlatformFollowUp.useMutation({
    onSuccess: (result) => {
      setAskResult(result.result);
    },
    onError: (error) => {
      toast.error(error.message || "平台追问失败");
    },
  });

  const pipelineDebugShowExtras = useMemo(() => {
    return (
      stage2Failed ||
      Boolean(contentJobError) ||
      stage2EmptyPayload ||
      Boolean(getPlatformDashboardMutation.error) ||
      Boolean(growthSnapshotQuery.error) ||
      Boolean(askPlatformFollowUpMutation.error) ||
      (typeof contentDebug?.stage2Error === "string" && Boolean(contentDebug.stage2Error)) ||
      Boolean(
        dashboardDebug &&
          typeof dashboardDebug === "object" &&
          typeof (dashboardDebug as { error?: unknown }).error === "string" &&
          (dashboardDebug as { error: string }).error,
      )
    );
  }, [
    stage2Failed,
    contentJobError,
    stage2EmptyPayload,
    getPlatformDashboardMutation.error,
    growthSnapshotQuery.error,
    askPlatformFollowUpMutation.error,
    contentDebug,
    dashboardDebug,
  ]);

  const platformImageGenFlowSnapshotsFailedOnly = useMemo(
    () =>
      platformImageGenFlowSnapshots.filter(
        (s) => s.kind === "batch_topic_frames_failed" || s.kind === "composite_2x4_failed",
      ),
    [platformImageGenFlowSnapshots],
  );

  const flyJobsPollDebugPanel = useMemo(() => {
    const imageTraces = [topicImageJobPollTrace, compositeJobPollTrace].filter(
      Boolean,
    ) as ClientJobPollTrace[];
    const hasContent = Boolean(contentJobPollTrace);
    const hasManhuaLearn = Boolean(manhuaLearnJobPollTrace);
    if (imageTraces.length === 0 && !hasContent && !hasManhuaLearn) return null;

    const renderTraceRows = (
      traces: ClientJobPollTrace[],
      pick: (t: ClientJobPollTrace) => { count: number; step?: string },
    ) =>
      traces.map((t) => {
        const { count, step } = pick(t);
        const tail = t.terminalStatus ? `终态 ${t.terminalStatus}` : "进行中";
        return `${t.label} · jobId=${t.jobId} · ${count} 次 · ${step ? `${step} · ` : ""}${tail}`;
      });

    const translationTotal = imageTraces.reduce(
      (sum, t) => sum + (t.translationPollCount ?? (t.pollCount > 0 ? t.pollCount : 0)),
      0,
    );
    const imageGenTotal = imageTraces.reduce(
      (sum, t) => sum + (t.imageGenPollCount ?? (t.pollCount > 0 ? t.pollCount : 0)),
      0,
    );
    const translationOverview = renderTraceRows(imageTraces, (t) => ({
      count: t.translationPollCount ?? 0,
      step: t.translationStep,
    }));
    const translationStatsRows = imageTraces
      .map((t) => {
        if (!t.translationComplete) return null;
        const summary = formatTranslationCompleteStats(t.translationComplete);
        if (!summary) return null;
        return `${t.label} · ${summary}`;
      })
      .filter(Boolean) as string[];
    const imageGenOverview = renderTraceRows(imageTraces, (t) => ({
      count: t.imageGenPollCount ?? t.pollCount,
      step: t.imageGenStep || t.currentStep,
    }));

    const allTraces = [
      ...imageTraces,
      ...(contentJobPollTrace ? [contentJobPollTrace] : []),
      ...(manhuaLearnJobPollTrace ? [manhuaLearnJobPollTrace] : []),
    ];
    const showFailureLog = allTraces.some((t) => {
      if (t.lines.length === 0) return false;
      if (t.terminalStatus === "failed" || t.terminalStatus === "client_error") return true;
      if (t.terminalStatus === "succeeded")
        return t.lines.some((ln) => /无有效|无 output|异常|失败|✗/i.test(ln));
      return true;
    });

    return (
      <div className="rounded-2xl border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.05)] p-4 space-y-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#49e6ff]">Fly Jobs · 轮询</div>
        <p className="text-[11px] leading-relaxed text-[#d7d0ef]">
          中文直送与生图分开展示；每行均含 <span className="text-gray-300">jobId</span>（可复制到 Fly 日志或{" "}
          <code className="text-gray-400">GET /api/jobs/&lt;id&gt;</code>）
        </p>

        {imageTraces.length > 0 ? (
          <div className="rounded-xl border border-[#c4b5fd]/25 bg-[rgba(99,102,241,0.08)] p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4b5fd]">
              中文直送 · 指令组装
            </div>
            <p className="mt-1 text-[11px] text-[#d7d0ef]">
              合计轮询{" "}
              <span className="font-semibold tabular-nums text-white">{translationTotal}</span> 次
            </p>
            {translationStatsRows.length > 0 ? (
              <div className="mt-2 space-y-1.5 rounded-lg border border-[#c4b5fd]/20 bg-black/20 px-2.5 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#e9d5ff]">
                  指令组装统计（旧任务可能仍显示英文化）
                </div>
                {translationStatsRows.map((row) => (
                  <p key={row} className="break-words text-[10px] leading-relaxed text-[#f5f3ff]">
                    {row}
                  </p>
                ))}
              </div>
            ) : null}
            <p className="mt-2 break-words text-[10px] leading-relaxed text-gray-400">
              {translationOverview.join("  ·  ")}
            </p>
          </div>
        ) : null}

        {imageTraces.length > 0 ? (
          <div className="rounded-xl border border-[#49e6ff]/20 bg-[rgba(73,230,255,0.06)] p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#8cefff]">
              生图 · 封面与分镜
            </div>
            <p className="mt-1 text-[11px] text-[#d7d0ef]">
              合计轮询 <span className="font-semibold tabular-nums text-white">{imageGenTotal}</span> 次
            </p>
            <p className="mt-2 break-words text-[10px] leading-relaxed text-gray-400">
              {imageGenOverview.join("  ·  ")}
            </p>
          </div>
        ) : null}

        {contentJobPollTrace ? (
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-gray-400">Stage 2 · 专属文案</div>
            <p className="mt-2 break-words text-[10px] leading-relaxed text-gray-400">
              {contentJobPollTrace.label} · jobId={contentJobPollTrace.jobId} · {contentJobPollTrace.pollCount} 次 ·{" "}
              {contentJobPollTrace.terminalStatus ? `终态 ${contentJobPollTrace.terminalStatus}` : "进行中"}
            </p>
          </div>
        ) : null}

        {manhuaLearnJobPollTrace ? (
          <div className="rounded-xl border border-amber-300/30 bg-amber-500/10 p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-amber-100">
              AI 漫剧 · 学节奏
            </div>
            <p className="mt-2 break-words text-[10px] leading-relaxed text-amber-50/85">
              {manhuaLearnJobPollTrace.label} · jobId={manhuaLearnJobPollTrace.jobId} ·{" "}
              {manhuaLearnJobPollTrace.pollCount} 次 ·{" "}
              {manhuaLearnJobPollTrace.terminalStatus
                ? `终态 ${manhuaLearnJobPollTrace.terminalStatus}`
                : "进行中"}
            </p>
            {manhuaLearnJobPollTrace.currentStep ? (
              <p className="mt-1 break-words text-[10px] text-amber-100/70">
                当前：{manhuaLearnJobPollTrace.currentStep}
              </p>
            ) : null}
          </div>
        ) : null}

        {showFailureLog ? (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 pt-3 text-[10px] leading-5 text-[#c9c0e6]">
            {allTraces
              .filter((t) => t.lines.length > 0)
              .map((t) => `── ${t.label} · ${t.jobId} ──\n${t.lines.join("\n")}`)
              .join("\n\n")}
          </pre>
        ) : null}
      </div>
    );
  }, [
    contentJobPollTrace,
    topicImageJobPollTrace,
    compositeJobPollTrace,
    manhuaLearnJobPollTrace,
  ]);

  const enqueueGenerateTopicImageMutation = trpc.mvAnalysis.enqueueGenerateTopicImage.useMutation();
  const uploadCoverReferencePhotoMutation = trpc.mvAnalysis.uploadCoverReferencePhoto.useMutation();
  /** 读取人像文件 → canvas 压缩为 JPEG（长边≤1280）→ 上传 GCS → 写入 coverReferencePhotoMap[sceneId]。 */
  const handleUploadCoverReferencePhoto = useCallback(
    async (sceneId: string, file: File) => {
      const sid = String(sceneId || "").trim();
      if (!sid) return;
      if (!file.type.startsWith("image/")) {
        toast.error("请上传图片文件（JPG / PNG）");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error("图片过大（请 ≤ 25MB）");
        return;
      }
      setCoverRefUploadingIds((prev) => new Set(prev).add(sid));
      try {
        const jpegBase64 = await new Promise<string>((resolve, reject) => {
          const img = new window.Image();
          const objectUrl = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const maxEdge = 1280;
            const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const cctx = canvas.getContext("2d");
            if (!cctx) {
              reject(new Error("无法处理图片（canvas 不可用）"));
              return;
            }
            cctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
            const base64 = dataUrl.split(",")[1] || "";
            if (!base64) {
              reject(new Error("图片编码失败"));
              return;
            }
            resolve(base64);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("图片读取失败"));
          };
          img.src = objectUrl;
        });
        const { url } = await uploadCoverReferencePhotoMutation.mutateAsync({
          imageBase64: jpegBase64,
          mimeType: "image/jpeg",
        });
        if (!url) throw new Error("上传未返回 URL");
        setCoverReferencePhotoMap((prev) => ({ ...prev, [sid]: url }));
        toast.success("人像已上传，将用于替换封面主角");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "人像上传失败");
      } finally {
        setCoverRefUploadingIds((prev) => {
          const next = new Set(prev);
          next.delete(sid);
          return next;
        });
      }
    },
    [uploadCoverReferencePhotoMutation],
  );

  /** 单卡人像优先，否则用全局主人公照片；再否则用已生成封面（锁脸续用） */
  const resolveReferencePhotoForScene = useCallback(
    (sceneId: string): string | undefined => {
      const per = String(coverReferencePhotoMap[sceneId] || "").trim();
      if (per) return per;
      const global = String(globalCoverReferencePhotoUrl || "").trim();
      if (global) return global;
      const cover = String(platformImageMap[sceneId] || "").trim();
      return cover || undefined;
    },
    [coverReferencePhotoMap, globalCoverReferencePhotoUrl, platformImageMap],
  );

  const handleUploadGlobalCoverReferencePhoto = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("请上传图片文件（JPG / PNG）");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error("图片过大（请 ≤ 25MB）");
        return;
      }
      setGlobalCoverRefUploading(true);
      try {
        const jpegBase64 = await new Promise<string>((resolve, reject) => {
          const img = new window.Image();
          const objectUrl = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const maxEdge = 1280;
            const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const cctx = canvas.getContext("2d");
            if (!cctx) {
              reject(new Error("无法处理图片（canvas 不可用）"));
              return;
            }
            cctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
            const base64 = dataUrl.split(",")[1] || "";
            if (!base64) {
              reject(new Error("图片编码失败"));
              return;
            }
            resolve(base64);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("图片读取失败"));
          };
          img.src = objectUrl;
        });
        const { url } = await uploadCoverReferencePhotoMutation.mutateAsync({
          imageBase64: jpegBase64,
          mimeType: "image/jpeg",
        });
        if (!url) throw new Error("上传未返回 URL");
        setGlobalCoverReferencePhotoUrl(url);
        toast.success("全局主人公照片已上传 · 封面/分镜/图文将锁脸（衣着可随场景微调）");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "人像上传失败");
      } finally {
        setGlobalCoverRefUploading(false);
      }
    },
    [uploadCoverReferencePhotoMutation],
  );
  const syncPlatformExecutionBlueprintsSnapshotMutation =
    trpc.mvAnalysis.syncPlatformExecutionBlueprintsSnapshot.useMutation();
  const enqueueTopicCoverAndCompositeBundleMutation =
    trpc.mvAnalysis.enqueueTopicCoverAndCompositeBundle.useMutation();

  const runEnqueueTopicCoverCompositeBundleAndPoll = useCallback(
    async (inp: {
      sceneId: string;
      coverPersonaContext?: string;
      headlineTitle: string;
      compositeKind:
        | "storyboard_sheet_portrait"
        | "storyboard_sheet_landscape"
        | "xiaohongshu_dual_note";
      scriptContext: string;
      executionDetails: string;
      /** 上传素材拍摄手法 → 2×4 / 3×4 分镜 */
      shootingTechniqueBrief?: string;
      gridVariant?: "2x4" | "3x4";
      pollDebugLabel?: string;
      /** 用户上传人像 → 封面/分镜融合主人公相貌 */
      referencePhotoUrl?: string;
      /** 有参考人像时分镜须走 GPT-IMAGE-2 edit，可显式传入 gpt_image2 */
      compositeImageEngine?: PlatformComposite2x4ImageEngine;
    }) => {
      const pollLabel =
        inp.pollDebugLabel ??
        (inp.sceneId ? `套装 · ${inp.sceneId}` : "套装 · platform_topic_cover_composite_bundle");
      const { jobId } = await enqueueTopicCoverAndCompositeBundleMutation.mutateAsync({
        sceneId: inp.sceneId,
        coverPersonaContext: inp.coverPersonaContext,
        compositeTitle: inp.headlineTitle,
        compositeScriptContext: inp.scriptContext,
        compositeKind: inp.compositeKind,
        compositeExecutionDetails: inp.executionDetails,
        ...(inp.shootingTechniqueBrief?.trim()
          ? { compositeShootingTechniqueBrief: inp.shootingTechniqueBrief.trim() }
          : {}),
        gridVariant: inp.gridVariant ?? "2x4",
        imagePromptTranslator: COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
        ...optionalBoundCreationRecordId(),
        ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
          ? { enableTopicCoverDeepResearchPro: true }
          : {}),
        compositeImageEngine: inp.compositeImageEngine ?? (inp.referencePhotoUrl ? "gpt_image2" : platformComposite2x4Engine),
        ...(inp.referencePhotoUrl ? { referencePhotoUrl: inp.referencePhotoUrl } : {}),
        enabledSkillIds: Array.from(enabledPlatformSkillIds),
        allowBloggerTitle,
        coverPlatformHint: selectedTrendPlatforms[0],
      });
      setTopicImageJobPollTrace({
        jobId,
        label: pollLabel,
        lines: [],
        pollCount: 0,
        currentStep: "套装已入队…",
      });
      let j: Awaited<ReturnType<typeof pollJobUntilTerminal>>;
      try {
        j = await pollJobUntilTerminal(jobId, {
          intervalMs: platformImageFlowPollIntervalMs,
          maxWaitMs: 28 * 60_000,
          onPoll: ({ attempt, output }) => {
            const out = output as { imageGenFlowLog?: string[] } | undefined;
            const flow = Array.isArray(out?.imageGenFlowLog) ? out.imageGenFlowLog : null;
            const tail =
              flow && flow.length > 0 ? String(flow[flow.length - 1]!).replace(/\s+/g, " ").slice(0, 140) : "";
            setTopicImageJobPollTrace((prev) =>
              prev && prev.jobId === jobId
                ? {
                    ...prev,
                    pollCount: attempt,
                    currentStep: tail ? `第 ${attempt} 次 · ${tail}` : `套装轮询 · ${attempt} 次`,
                  }
                : prev,
            );
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTopicImageJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                terminalStatus: prev.terminalStatus ?? "client_error",
                lines: appendPollDebugLine(prev.lines, `${new Date().toISOString()} 客户端异常: ${msg}`),
              }
            : prev,
        );
        throw err;
      }
      if (j.status === "failed") {
        const flow = Array.isArray((j.output as { imageGenFlowLog?: string[] } | undefined)?.imageGenFlowLog)
          ? ((j.output as { imageGenFlowLog?: string[] }).imageGenFlowLog ?? [])
          : [];
        setTopicImageJobPollTrace((prev) => {
          if (!prev || prev.jobId !== jobId) return prev;
          let lines = prev.lines;
          for (const row of flow) {
            lines = appendPollDebugLine(lines, String(row));
          }
          return {
            ...prev,
            terminalStatus: j.status,
            lines: appendPollDebugLine(
              lines,
              `${new Date().toISOString()} 终态 failed · error=${j.error || ""} · ${pollLabel}`,
            ),
          };
        });
        throw new Error(j.error || "套装生图任务失败");
      }
      const raw = j.output;
      if (!raw || typeof raw !== "object") {
        setTopicImageJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                terminalStatus: "succeeded",
                lines: appendPollDebugLine(
                  prev.lines,
                  `${new Date().toISOString()} 终态 succeeded 但无 output 对象 · ${pollLabel}`,
                ),
              }
            : prev,
        );
        return {
          success: false as const,
          imageUrl: null as string | null,
          url: null as string | null,
          creationId: undefined as number | undefined,
          imageGenFlowLog: [] as string[],
          coverClickEstimate: undefined,
          compositeImageUrl: null as string | null,
          compositeKind: null as
            | "storyboard_sheet_portrait"
            | "storyboard_sheet_landscape"
            | "xiaohongshu_dual_note"
            | null,
        };
      }
      const o = raw as Record<string, unknown>;
      const finalFlowLog = Array.isArray(o.imageGenFlowLog) ? (o.imageGenFlowLog as string[]) : [];
      const imageUrl = String(o.imageUrl ?? o.url ?? "").trim() || null;
      const creationId = typeof o.creationId === "number" ? o.creationId : undefined;
      const compositeImageUrl = String(o.compositeImageUrl ?? "").trim() || null;
      const ckRaw = o.compositeKind;
      const compositeKindParsed =
        ckRaw === "storyboard_sheet_portrait" ||
        ckRaw === "storyboard_sheet_landscape" ||
        ckRaw === "xiaohongshu_dual_note"
          ? ckRaw
          : null;
      const coverOk =
        Boolean(imageUrl) && o.success !== false && !platformCoverImageUrlLooksInvalid(imageUrl);
      const compositeOk = Boolean(compositeImageUrl) && compositeKindParsed != null;
      const success = coverOk && compositeOk;
      const coverClickEstimate = parseCoverClickEstimate(o.coverClickEstimate);
      if (success && inp.sceneId && coverClickEstimate) {
        setPlatformCoverCtrBySceneId((prev) => ({ ...prev, [inp.sceneId]: coverClickEstimate }));
      }
      if (success) {
        setTopicImageJobPollTrace(null);
      } else {
        setTopicImageJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                terminalStatus: "succeeded",
                lines: appendPollDebugLine(
                  prev.lines,
                  `${new Date().toISOString()} 终态 succeeded 但套装输出不完整 · ${pollLabel}`,
                ),
              }
            : prev,
        );
      }
      return {
        success: success as boolean,
        imageUrl,
        url: imageUrl,
        creationId,
        imageGenFlowLog: finalFlowLog,
        coverClickEstimate,
        compositeImageUrl,
        compositeKind: compositeKindParsed,
      };
    },
    [
      enqueueTopicCoverAndCompositeBundleMutation,
      canConfigureCompositeImageTranslator,
      platformImageFlowPollIntervalMs,
      platformComposite2x4Engine,
      enabledPlatformSkillIds,
      allowBloggerTitle,
      selectedTrendPlatforms,
    ],
  );

  const runEnqueueTopicImageAndPoll = useCallback(
    async (inp: {
      /** @deprecated 忽略；服端仅使用 DB 快照优化后的主句。 */
      topicHook?: string;
      format: "短视频" | "图文";
      /** @deprecated 忽略。 */
      context?: string;
      coverPersonaContext?: string;
      failedJobId?: string;
      sceneId: string;
      /** Debug 面板区分来源：批量兜底 / 逐张 / 手动 / 静默 */
      pollDebugLabel?: string;
      /** 一键封面套装：40×N 按序分拆扣费 */
      bulkCoverPack?: { packSceneIds: string[]; sequentialSlot: number };
      /** 用户上传人像照片 URL → OpenAI 官方 GPT-Image-2 edit 换封面主角 */
      referencePhotoUrl?: string;
    }) => {
      const pollLabel =
        inp.pollDebugLabel ?? (inp.sceneId ? `封面 · ${inp.sceneId}` : "封面 · platform_topic_image");
      const { jobId } = await enqueueGenerateTopicImageMutation.mutateAsync({
        topicHook: (inp.topicHook ?? "").slice(0, 500),
        format: inp.format,
        context: inp.context,
        coverPersonaContext: inp.coverPersonaContext,
        failedJobId: inp.failedJobId,
        sceneId: inp.sceneId,
        /** 封面 topic 管线；与 2×4 合成出图开关无关。 */
        imagePromptTranslator: "gpt54" as const,
        ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
          ? { enableTopicCoverDeepResearchPro: true }
          : {}),
        ...(inp.bulkCoverPack ? { bulkCoverPack: inp.bulkCoverPack } : {}),
        ...(inp.referencePhotoUrl ? { referencePhotoUrl: inp.referencePhotoUrl } : {}),
        coverPlatformHint: selectedTrendPlatforms[0],
      });
      setTopicImageJobPollTrace({
        jobId,
        label: pollLabel,
        lines: [
          `${new Date().toISOString()} 已入队 · 封面中文直送与出图`,
        ],
        pollCount: 0,
        currentStep: "已入队…",
      });
      let j: Awaited<ReturnType<typeof pollJobUntilTerminal>>;
      try {
        j = await pollJobUntilTerminal(jobId, {
          intervalMs: platformImageFlowPollIntervalMs,
          maxWaitMs: 18 * 60_000,
          onPoll: ({ attempt, output }) => {
            const out = output as { imageGenFlowLog?: string[] } | undefined;
            const flow = Array.isArray(out?.imageGenFlowLog) ? out.imageGenFlowLog : null;
            const tail =
              flow && flow.length > 0 ? String(flow[flow.length - 1]!).replace(/\s+/g, " ").slice(0, 140) : "";
            setTopicImageJobPollTrace((prev) =>
              prev && prev.jobId === jobId
                ? applyFlowLogToPollTrace(prev, attempt, flow ?? [])
                : prev,
            );
          },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setTopicImageJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                terminalStatus: prev.terminalStatus ?? "client_error",
                lines: appendPollDebugLine(prev.lines, `${new Date().toISOString()} 客户端异常: ${msg}`),
              }
            : prev,
        );
        throw err;
      }
      if (j.status === "failed") {
        const flow = Array.isArray((j.output as { imageGenFlowLog?: string[] } | undefined)?.imageGenFlowLog)
          ? ((j.output as { imageGenFlowLog?: string[] }).imageGenFlowLog ?? [])
          : [];
        setTopicImageJobPollTrace((prev) => {
          if (!prev || prev.jobId !== jobId) return prev;
          let lines = prev.lines;
          for (const row of flow) {
            lines = appendPollDebugLine(lines, String(row));
          }
          return {
            ...prev,
            terminalStatus: j.status,
            lines: appendPollDebugLine(
              lines,
              `${new Date().toISOString()} 终态 failed · error=${j.error || ""} · ${pollLabel}`,
            ),
          };
        });
        throw new Error(j.error || "生图任务失败");
      }
      const raw = j.output;
      if (!raw || typeof raw !== "object") {
        setTopicImageJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                terminalStatus: "succeeded",
                lines: appendPollDebugLine(
                  prev.lines,
                  `${new Date().toISOString()} 终态 succeeded 但无 output 对象 · ${pollLabel}`,
                ),
              }
            : prev,
        );
        return {
          success: false as const,
          imageUrl: null as string | null,
          url: null as string | null,
          creationId: undefined as number | undefined,
          imageGenFlowLog: [] as string[],
          coverClickEstimate: undefined,
          userFacingError: undefined as string | undefined,
        };
      }
      const o = raw as Record<string, unknown>;
      const finalFlowLog = Array.isArray(o.imageGenFlowLog) ? (o.imageGenFlowLog as string[]) : [];
      const imageUrl = String(o.imageUrl ?? o.url ?? "").trim() || null;
      const creationId = typeof o.creationId === "number" ? o.creationId : undefined;
      const userFacingError =
        typeof o.userFacingError === "string" && o.userFacingError.trim() ? o.userFacingError.trim() : undefined;
      /** job output 若仅缺 success（序列化/进度合并），有 URL 也应写入 platformImageMap */
      const success =
        Boolean(imageUrl) &&
        o.success !== false &&
        !platformCoverImageUrlLooksInvalid(imageUrl);
      const coverClickEstimate = parseCoverClickEstimate(o.coverClickEstimate);
      if (success && inp.sceneId && coverClickEstimate) {
        setPlatformCoverCtrBySceneId((prev) => ({ ...prev, [inp.sceneId]: coverClickEstimate }));
      }
      if (success) {
        setTopicImageJobPollTrace(null);
      } else {
        setTopicImageJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                terminalStatus: "succeeded",
                lines: appendPollDebugLine(
                  prev.lines,
                  `${new Date().toISOString()} 终态 succeeded 但无有效 URL · ${pollLabel}`,
                ),
              }
            : prev,
        );
      }
      return {
        success: success as boolean,
        imageUrl,
        url: imageUrl,
        creationId,
        imageGenFlowLog: finalFlowLog,
        coverClickEstimate,
        userFacingError,
      };
    },
    [enqueueGenerateTopicImageMutation, canConfigureCompositeImageTranslator, platformImageFlowPollIntervalMs, selectedTrendPlatforms],
  );

  const generateAllPlatformImagesMutation = trpc.mvAnalysis.generateAllPlatformTopicImages.useMutation({
    onMutate: (variables) => {
      const localOpId = `batch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setPlatformImageGenFlowSnapshots((prev) =>
        upsertPlatformImageFlowSnapshot(prev, {
          at: new Date().toISOString(),
          kind: "batch_topic_frames",
          lines: [
            `${new Date().toISOString()}  [客户端] 批量单帧已发起 · platformType=${variables.platformType} · sceneCount=${variables.scenes.length}`,
            `${new Date().toISOString()}  [等待中] 进度见 Debug「Fly Jobs · 轮询」当前步骤`,
          ],
          meta: {
            localOpId,
            platformType: variables.platformType,
            sceneCount: variables.scenes.length,
            pending: true,
          },
        }),
      );
      return { localOpId };
    },
    onSuccess: async (res, variables, ctx) => {
      setPlatformImageMap((prev) => {
        const next = { ...prev };
        for (const r of res.results) {
          if (r.url) next[r.id] = r.url;
        }
        return next;
      });
      setSceneJobIds((prev) => {
        const next = { ...prev };
        for (const r of res.results) {
          const cid = (r as { creationId?: number }).creationId;
          if (cid != null) next[r.id] = String(cid);
        }
        return next;
      });

      let retryRecovered = 0;
      for (const r of res.results) {
        const bad = platformCoverImageUrlLooksInvalid(r.url);
        const cid = (r as { creationId?: number }).creationId;
        if (!bad || cid == null) continue;
        if (!r.id?.trim()) continue;
        try {
          const retried = await runEnqueueTopicImageAndPoll({
            topicHook: "",
            format: variables.platformType === "video" ? "短视频" : "图文",
            coverPersonaContext: variables.coverPersonaContext,
            failedJobId: String(cid),
            sceneId: r.id,
            pollDebugLabel: `批量兜底重试 · ${r.id}`,
          });
          const recoveredUrl = String(retried.imageUrl ?? retried.url ?? "").trim();
          if (recoveredUrl) {
            retryRecovered += 1;
          }
        } catch (err) {
          console.warn(`[PlatformPage] batch auto retry failed for ${r.id}:`, err);
        }
      }
      const ok = res.results.filter((r) => r.url && String(r.url).trim()).length + retryRecovered;
      const label = "图文封面参考";
      toast.success(
        `已生成 ${ok}/${res.results.length} 张${label}单帧${res.totalCost ? `（消耗 ${res.totalCost} 点）` : ""}${retryRecovered > 0 ? ` · 自动补救 ${retryRecovered} 张` : ""}`,
      );
      const lines = (res as { imageGenFlowLog?: string[] }).imageGenFlowLog;
      const meta = (res as { imageGenMeta?: Record<string, unknown> }).imageGenMeta;
      if (Array.isArray(lines) && lines.length > 0) {
        setPlatformImageGenFlowSnapshots((prev) =>
          upsertPlatformImageFlowSnapshot(prev, {
            at: new Date().toISOString(),
            kind: "batch_topic_frames" as const,
            lines,
            meta: {
              ...(meta || {}),
              localOpId: ctx?.localOpId,
            },
          }),
        );
      }
    },
    onError: (err, variables, ctx) => {
      console.error("[PlatformPage] generateAllPlatformTopicImages failed:", err);
      toast.error(err.message || "批量生图失败");
      setPlatformImageGenFlowSnapshots((prev) =>
        upsertPlatformImageFlowSnapshot(prev, {
          at: new Date().toISOString(),
          kind: "batch_topic_frames_failed" as const,
          lines: linesFromClientMutationFailure(`[客户端] 批量单帧 mutation 失败 · platformType=${variables.platformType}`, err),
          meta: {
            localOpId: ctx?.localOpId,
            platformType: variables.platformType,
          },
        }),
      );
    },
  });

  const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
  const platformImageRequestQueueRef = useRef<Promise<void>>(Promise.resolve());
  const platformImageStartTimesRef = useRef<number[]>([]);
  const runThrottledPlatformImageRequest = useCallback(
    async (
      label: string,
      fn: () => Promise<any>,
      onWait?: (waitMs: number) => void,
    ) => {
      void label;
      const previous = platformImageRequestQueueRef.current;
      let releaseQueue = () => {};
      platformImageRequestQueueRef.current = new Promise<void>((resolve) => {
        releaseQueue = resolve;
      });
      await previous;
      try {
        const times = platformImageStartTimesRef.current;
        for (;;) {
          const now = Date.now();
          prunePlatformImageRateWindow(times, now, PLATFORM_IMAGE_RATE_WINDOW_MS);
          if (times.length < PLATFORM_IMAGE_MAX_STARTS_PER_60S) break;
          const waitMs = times[0]! + PLATFORM_IMAGE_RATE_WINDOW_MS - now + 25;
          if (waitMs > 0) {
            onWait?.(waitMs);
            await sleep(waitMs);
          } else {
            times.shift();
          }
        }
        times.push(Date.now());
        return await fn();
      } finally {
        releaseQueue();
      }
    },
    [],
  );

  const runSequentialCoverBatchGeneration = async (
    scenes: Array<{ id: string }>,
    coverPersonaContext: string,
  ) => {
    const packSceneIds = scenes.map((s) => s.id);
    const localOpId = `batch-seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setIsSequentialCoverBatchGenerating(true);
    setPlatformImageGenFlowSnapshots((prev) =>
      upsertPlatformImageFlowSnapshot(prev, {
        at: new Date().toISOString(),
        kind: "batch_topic_frames",
        lines: [
          `${new Date().toISOString()}  [客户端] 异步逐张封面生成已发起 · sceneCount=${scenes.length} · concurrency=1`,
          ...buildPendingImageGenLines("cover_batch"),
        ],
        meta: {
          localOpId,
          platformType: "graphic",
          sceneCount: scenes.length,
          concurrency: 1,
          pending: true,
        },
      }),
    );

    let successCount = 0;
    const liveLines: string[] = [];
    for (let slotIndex = 0; slotIndex < scenes.length; slotIndex++) {
      const scene = scenes[slotIndex]!;
      setBatchGeneratingCoverIds((prev) => new Set(prev).add(scene.id));
      liveLines.push(`${new Date().toISOString()}  [客户端] 开始单张生成 · sceneId=${scene.id}`);
      setPlatformImageGenFlowSnapshots((prev) =>
        upsertPlatformImageFlowSnapshot(prev, {
          at: new Date().toISOString(),
        kind: "batch_topic_frames",
          lines: [...liveLines, ...buildPendingImageGenLines("cover_batch", scene.id)],
          meta: {
            localOpId,
            platformType: "graphic",
            sceneCount: scenes.length,
            concurrency: 1,
            currentSceneId: scene.id,
            successCount,
            pending: true,
          },
        }),
      );
      try {
        const result = await runThrottledPlatformImageRequest(
          `cover:${scene.id}`,
          () =>
            runEnqueueTopicImageAndPoll({
              topicHook: "",
              format: "图文",
              coverPersonaContext: coverPersonaContext.trim() || undefined,
              sceneId: scene.id,
              pollDebugLabel: `异步逐张批量 · ${scene.id}`,
              bulkCoverPack: { packSceneIds, sequentialSlot: slotIndex },
              referencePhotoUrl: resolveReferencePhotoForScene(scene.id),
            }),
          (waitMs) => {
            liveLines.push(
              `${new Date().toISOString()}  [客户端] 节流等待 ${Math.ceil(waitMs / 1000)} 秒 · 滚动 ${PLATFORM_IMAGE_RATE_WINDOW_MS / 1000}s 内已排满 ${PLATFORM_IMAGE_MAX_STARTS_PER_60S} 次发起 · sceneId=${scene.id}`,
            );
            setPlatformImageGenFlowSnapshots((prev) =>
              upsertPlatformImageFlowSnapshot(prev, {
                at: new Date().toISOString(),
                kind: "batch_topic_frames",
                lines: [...liveLines],
                meta: {
                  localOpId,
                  platformType: "graphic",
                  sceneCount: scenes.length,
                  concurrency: 1,
                  currentSceneId: scene.id,
                  successCount,
                  pending: true,
                },
              }),
            );
          },
        );
        const out = String(result.imageUrl ?? (result as { url?: string | null }).url ?? "").trim();
        const serverLines = Array.isArray((result as { imageGenFlowLog?: string[] }).imageGenFlowLog)
          ? ((result as { imageGenFlowLog?: string[] }).imageGenFlowLog ?? [])
          : [];
        if (serverLines.length > 0) {
          liveLines.push(...serverLines);
        }
        if (out) {
          successCount += 1;
          setPlatformImageMap((prev) => ({ ...prev, [scene.id]: out }));
          if (result.creationId != null) {
            setSceneJobIds((prev) => ({ ...prev, [scene.id]: String(result.creationId) }));
          }
          const ctr = parseCoverClickEstimate(
            (result as { coverClickEstimate?: unknown }).coverClickEstimate,
          );
          if (ctr) {
            setPlatformCoverCtrBySceneId((prev) => ({ ...prev, [scene.id]: ctr }));
          }
          liveLines.push(`${new Date().toISOString()}  ✓ 单张完成 · sceneId=${scene.id}`);
        } else {
          liveLines.push(`${new Date().toISOString()}  ✗ 单张无图 · sceneId=${scene.id}`);
        }
      } catch (err) {
        liveLines.push(
          `${new Date().toISOString()}  ✗ 单张异常 · sceneId=${scene.id} · ${err instanceof Error ? err.message : String(err)}`,
        );
      } finally {
        setBatchGeneratingCoverIds((prev) => {
          const next = new Set(prev);
          next.delete(scene.id);
          return next;
        });
      }
    }

    setIsSequentialCoverBatchGenerating(false);
    setPlatformImageGenFlowSnapshots((prev) =>
      upsertPlatformImageFlowSnapshot(prev, {
        at: new Date().toISOString(),
        kind: "batch_topic_frames",
        lines: [
          ...liveLines,
          `${new Date().toISOString()}  [客户端] 异步逐张封面生成结束 · success=${successCount}/${scenes.length}`,
        ],
        meta: {
          localOpId,
          platformType: "graphic",
          sceneCount: scenes.length,
          concurrency: 1,
          successCount,
          pending: false,
        },
      }),
    );
    toast.success(`已生成 ${successCount}/${scenes.length} 张图文封面单帧（共消耗 ${platformBulkGraphicCost} 点）`);
  };

  const updateCompositeFlowSnapshotFromPoll = useCallback(
    (
      ctx: NonNullable<typeof compositeSheetLivePollCtxRef.current>,
      attempt: number,
      status: string,
      log: string[],
    ) => {
      const ts = new Date().toISOString();
      const last = log.length > 0 ? String(log[log.length - 1]) : "";
      setPlatformImageGenFlowSnapshots((prev) => {
        const opId = ctx.localOpId;
        const existing = prev.find(
          (p) => String(p.meta?.localOpId || "").trim() === opId && p.kind === "composite_2x4",
        );
        const kept =
          existing?.lines?.filter((ln) => !/\[实时进度\] HTTP \d+ 次 · status=/.test(ln)) ?? [];
        const baseLines =
          kept.length > 0
            ? kept
            : buildCompositeImageGenPendingLines({
                kind: ctx.kind,
                sceneId: ctx.sceneId,
                title: (ctx.title || "（未命名）").slice(0, 240),
                progressJobId: ctx.jobId,
              });
        const lines = [...baseLines, `${ts}  [实时进度] HTTP ${attempt} 次 · status=${status}`];
        const priorMeta =
          existing?.meta && typeof existing.meta === "object" ? { ...existing.meta } : {};
        return upsertPlatformImageFlowSnapshot(prev, {
          at: ts,
          kind: "composite_2x4",
          lines,
          meta: {
            ...priorMeta,
            localOpId: opId,
            apiKind: ctx.kind,
            sceneId: ctx.sceneId,
            title: ctx.title.slice(0, 80),
            pending: status === "running" || status === "queued",
            liveProgressJobId: ctx.jobId,
            liveCompositeFlowTail: last,
            serverFlowLogEntries: log.length,
          },
        });
      });
    },
    [],
  );

  const pollCompositeProgressJob = useCallback(
    async (ctx: NonNullable<typeof compositeSheetLivePollCtxRef.current>) => {
      try {
        const j = await pollJobUntilTerminal(ctx.jobId, {
          intervalMs: compositeSheetLivePollIntervalMs,
          maxWaitMs: 28 * 60_000,
          adaptiveBackoffAfterAttempts: 36,
          maxIntervalMs: 8000,
          onPoll: ({ attempt, output, status }) => {
            const log = Array.isArray((output as { imageGenFlowLog?: string[] })?.imageGenFlowLog)
              ? ((output as { imageGenFlowLog?: string[] }).imageGenFlowLog ?? [])
              : [];
            setCompositeJobPollTrace((prev) =>
              prev && prev.jobId === ctx.jobId ? applyFlowLogToPollTrace(prev, attempt, log) : prev,
            );
            updateCompositeFlowSnapshotFromPoll(ctx, attempt, status, log);
          },
        });
        const out = j.output as
          | { compositeImageUrl?: string; imageGenFlowLog?: string[]; error?: string }
          | undefined;
        const log = Array.isArray(out?.imageGenFlowLog) ? out.imageGenFlowLog : [];
        setCompositeJobPollTrace((prev) =>
          prev && prev.jobId === ctx.jobId
            ? {
                ...applyFlowLogToPollTrace(prev, Math.max(prev.pollCount, 1), log),
                terminalStatus: j.status,
                currentStep: j.status === "succeeded" ? "终态 succeeded" : "终态 failed",
              }
            : prev,
        );
        const doneUrl =
          String(out?.compositeImageUrl || "").trim() ||
          String((out as { imageUrl?: string } | undefined)?.imageUrl || "").trim();
        if (j.status === "succeeded" && doneUrl) {
          if (ctx.kind === "storyboard_sheet_portrait" || ctx.kind === "storyboard_sheet_landscape") {
            setPlatformStoryboardSheetMap((p) => ({ ...p, [ctx.sceneId]: doneUrl }));
          } else {
            setPlatformXhsNoteMap((p) => ({ ...p, [ctx.sceneId]: doneUrl }));
          }
          if (!compositeBatchSilentUiRef.current) {
            toast.success(
              ctx.gridVariant === "3x4" ? "3×4 合成成功（异步轮询）" : "2×4 合成成功（异步轮询）",
            );
          }
        } else if (j.status === "failed") {
          if (!compositeBatchSilentUiRef.current) {
            toast.error(
              `${ctx.gridVariant === "3x4" ? "3×4" : "2×4"} 合成失败: ${out?.error || j.error || "未知错误"}`,
            );
          }
        }
      } catch {
        setCompositeJobPollTrace((prev) =>
          prev && prev.jobId === ctx.jobId
            ? { ...prev, terminalStatus: "client_error", currentStep: "客户端轮询异常" }
            : prev,
        );
      } finally {
        setCompositeAwaitingJobTerminal(false);
        setPendingCompositeSheet(null);
        compositeSheetLivePollCtxRef.current = null;
      }
    },
    [compositeSheetLivePollIntervalMs, updateCompositeFlowSnapshotFromPoll],
  );

  const generatePlatformCompositeSheetMutation = trpc.mvAnalysis.generatePlatformCompositeSheet.useMutation({
    onMutate: (input) => {
      setPendingCompositeSheet({ sceneId: input.sceneId, kind: input.kind });
      const localOpId = `composite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const pid = String(input.progressJobId ?? "").trim();
      compositeLivePollAttemptRef.current = 0;
      compositeSheetLivePollCtxRef.current =
        pid.length >= 8
          ? {
              jobId: pid,
              localOpId,
              sceneId: input.sceneId,
              title: input.title ?? "",
              kind: input.kind,
              gridVariant: input.gridVariant === "3x4" ? "3x4" : "2x4",
            }
          : null;
      const is3x4Dbg = input.gridVariant === "3x4";
      const compositeDbgLabel =
        input.kind === "xiaohongshu_dual_note"
          ? is3x4Dbg
            ? "图文笔记 · 3×4 十二格合成"
            : "图文笔记 · 2×4 八格合成"
          : is3x4Dbg
            ? "编导分镜图 · 3×4 十二格合成"
            : "编导分镜图 · 2×4 宽幅合成";
      if (pid.length >= 8) {
        setCompositeJobPollTrace({
          jobId: pid,
          label: compositeDbgLabel,
          lines: [],
          pollCount: 0,
          currentStep: "已入队…",
        });
      } else {
        setCompositeJobPollTrace(null);
      }
      setPlatformImageGenFlowSnapshots((prev) =>
        upsertPlatformImageFlowSnapshot(prev, {
          at: new Date().toISOString(),
          kind: "composite_2x4",
          lines: buildCompositeImageGenPendingLines({
            kind: input.kind,
            sceneId: input.sceneId,
            title: input.title,
            imagePromptTranslator: input.imagePromptTranslator,
            progressJobId: pid.length >= 8 ? pid : undefined,
            gridVariant: input.gridVariant,
          }),
          meta: {
            localOpId,
            apiKind: input.kind,
            sceneId: input.sceneId,
            title: input.title?.slice(0, 80),
            pending: true,
            progressJobId: pid.length >= 8 ? pid : undefined,
          },
        }),
      );
      return { localOpId };
    },
    onSuccess: (res, variables, ctx) => {
      const ts = new Date().toISOString();
      const serverLines = Array.isArray((res as { imageGenFlowLog?: string[] }).imageGenFlowLog)
        ? ((res as { imageGenFlowLog?: string[] }).imageGenFlowLog ?? [])
        : [];
      const headerLines = [
        `${ts}  [客户端] 2×4/图文合成 · 请求完成 · kind=${variables.kind} · sceneId=${variables.sceneId} · imageUrl=${res.imageUrl ? "已返回" : "无"}`,
      ];
      const mergedLines =
        serverLines.length > 0
          ? [...headerLines, `${ts}  [收尾步骤] ${serverLines[serverLines.length - 1]}`]
          : headerLines;

      const isAsyncComposite =
        Boolean((res as { isAsync?: boolean }).isAsync) && !String(res.imageUrl ?? "").trim();

      setPlatformImageGenFlowSnapshots((prev) =>
        upsertPlatformImageFlowSnapshot(prev, {
          at: ts,
          kind: "composite_2x4" as const,
          lines: mergedLines,
          meta: {
            localOpId: ctx?.localOpId,
            apiKind: variables.kind,
            sceneId: variables.sceneId,
            title: variables.title?.slice(0, 80),
            pending: isAsyncComposite,
            serverLogLines: serverLines.length,
          },
        }),
      );

      const syncUrl =
        String(res.imageUrl || "").trim() ||
        String((res as { compositeImageUrl?: string }).compositeImageUrl || "").trim();
      if (syncUrl) {
        if (variables.kind === "storyboard_sheet_portrait" || variables.kind === "storyboard_sheet_landscape") {
          setPlatformStoryboardSheetMap((p) => ({ ...p, [variables.sceneId]: syncUrl }));
        } else {
          setPlatformXhsNoteMap((p) => ({ ...p, [variables.sceneId]: syncUrl }));
        }
        const label =
          variables.kind === "storyboard_sheet_portrait" || variables.kind === "storyboard_sheet_landscape"
            ? "编导分镜图文参考"
            : "小红书 2×4 八格图文参考";
        if (!compositeBatchSilentUiRef.current) {
          toast.success(`已生成${label}${res.totalCost ? `（${res.totalCost} 点）` : ""}`);
        }
      } else if ((res as any).isAsync) {
        setCompositeAwaitingJobTerminal(true);
        const pollCtx = compositeSheetLivePollCtxRef.current;
        if (pollCtx?.jobId) {
          void pollCompositeProgressJob(pollCtx);
        }
      }
    },
    onError: (error, variables, ctx) => {
      const refunded =
        variables.kind === "xiaohongshu_dual_note"
          ? CREDIT_COSTS.platformXhsDualNote
          : CREDIT_COSTS.platformStoryboardSheet;
      const fullMsg = error instanceof Error ? error.message : String(error);
      const looksLikeTransport =
        /\bFailed to fetch\b|Load failed|NetworkError|ECONNRESET|ERR_NETWORK\b/i.test(fullMsg);
      const refundPhrase = looksLikeTransport
        ? `网络层中断（常见于代理/链路抖动）；若服务端已扣款，请以页面刷新后实际结果为准；有疑问请查积分明细或 Debug 服务端流水`
        : `已退回 ${refunded} 积分`;
      const head = `❌ 2x4 合成失败 · kind=${variables.kind} · sceneId=${variables.sceneId} · title=${String(variables.title ?? "").slice(0, 80)} · ${refundPhrase}`;
      const preview = fullMsg.length > 360 ? `${fullMsg.slice(0, 360)}…（完整见下方 Debug）` : fullMsg;
      if (!compositeBatchSilentUiRef.current) {
        toast.error(`${head}\n\n${preview}`, { duration: 14_000 });
      }
      console.error("[PlatformPage] generatePlatformCompositeSheet failed:", error);

      setPlatformImageGenFlowSnapshots((prev) => {
        return upsertPlatformImageFlowSnapshot(prev, {
          at: new Date().toISOString(),
          kind: "composite_2x4_failed" as const,
          lines: linesFromClientMutationFailure(head, error),
          meta: {
            localOpId: ctx?.localOpId,
            apiKind: variables.kind,
            sceneId: variables.sceneId,
            title: variables.title?.slice(0, 80),
          },
        });
      });
    },
    onSettled: (data, error) => {
      if (error) {
        setCompositeAwaitingJobTerminal(false);
        setPendingCompositeSheet(null);
        compositeSheetLivePollCtxRef.current = null;
        setCompositeJobPollTrace(null);
        return;
      }
      const asyncWaiting =
        Boolean(data && (data as { isAsync?: boolean }).isAsync) &&
        !String((data as { imageUrl?: string | null })?.imageUrl ?? "").trim();
      if (asyncWaiting) {
        return;
      }
      setCompositeJobPollTrace((prev) =>
        prev
          ? {
              ...prev,
              pollCount: Math.max(prev.pollCount, 1),
              imageGenPollCount: Math.max(prev.imageGenPollCount ?? 0, 1),
              terminalStatus: "succeeded",
              currentStep: "终态 succeeded（同步返回）",
            }
          : null,
      );
      setCompositeAwaitingJobTerminal(false);
      setPendingCompositeSheet(null);
      compositeSheetLivePollCtxRef.current = null;
    },
  });

  const compositeMutationBusy =
    generatePlatformCompositeSheetMutation.isPending || compositeAwaitingJobTerminal;

  /** 自定義文案生成圖文筆記 — 獨立 mutation；回呼留空，全部流程在 handler 以 mutateAsync 串接控制。 */
  const generateCustomNoteMutation = trpc.mvAnalysis.generatePlatformCompositeSheet.useMutation();
  const prepareKnowledgeCardCopyMutation = trpc.mvAnalysis.prepareKnowledgeCardCopy.useMutation();
  const extractPlatformDocumentTextMutation = trpc.mvAnalysis.extractPlatformDocumentText.useMutation();
  const optimizeCustomCopyMutation = trpc.mvAnalysis.optimizeCustomCopy.useMutation();
  const customOptimizeCopyCost = CREDIT_COSTS.platformOptimizeCustomCopy;
  const customNoteKnowledgePlan = useMemo(
    () => planKnowledgeCardPages(customNoteText, customNoteDistillModel),
    [customNoteText, customNoteDistillModel],
  );
  const customNoteKnowledgeCredits =
    customNoteKnowledgePlan.credits ||
    knowledgeCardCreditsForPages(customNoteKnowledgePlan.pageCount || 0, customNoteDistillModel);

  /**
   * 提炼：短文同步直出；长书由服务端转后台任务，这里轮询进度直到拿到稿子。
   * 上传后与「点生成时仍有待处理文件」两条路径共用，避免逻辑分叉。
   */
  const runKnowledgeCardDistill = async (args: {
    sourceText?: string;
    files?: KnowledgeCardPendingFile[];
    onStatus?: (text: string) => void;
    /** 纯文本长文里用户主动买的提炼，服务端据此收提炼费 */
    chargeDistillFee?: boolean;
  }): Promise<string> => {
    const queued = await prepareKnowledgeCardCopyMutation.mutateAsync({
      sourceText: args.sourceText,
      files: args.files?.length ? args.files : undefined,
      forceDistill: true,
      distillModel: customNoteDistillModel,
      ...(args.chargeDistillFee ? { chargeDistillFee: true } : {}),
    });

    if (!queued.isAsync || !queued.progressJobId) {
      return String(queued.distilledMarkdown || "").trim();
    }

    const totalHint = Math.max(1, queued.estimatedChunks || 1);
    args.onStatus?.(`已读出约 ${queued.sourceChars.toLocaleString()} 字，正在分 ${totalHint} 段提炼…`);
    const job = await pollJobUntilTerminal(queued.progressJobId, {
      intervalMs: 3000,
      maxWaitMs: 45 * 60_000,
      adaptiveBackoffAfterAttempts: 40,
      maxIntervalMs: 8000,
      onPoll: ({ output }) => {
        const out = (output || {}) as {
          distillPhase?: string;
          distillDoneChunks?: number;
          distillTotalChunks?: number;
        };
        const total = Number(out.distillTotalChunks) || totalHint;
        const done = Number(out.distillDoneChunks) || 0;
        args.onStatus?.(
          out.distillPhase === "refining"
            ? `已提炼 ${total} 段，正在统稿合并…`
            : `正在分段提炼…已完成 ${done}/${total} 段`,
        );
      },
    });
    if (job.status === "failed") throw new Error(job.error || "提炼失败，请稍后重试");
    const out = (job.output || {}) as { distilledMarkdown?: string };
    return String(out.distilledMarkdown || "").trim();
  };

  /**
   * 生成一張卡片：同步回 imageUrl 直接用；非同步回 progressJobId 則輪詢至終態取圖。
   * @param notePart 舊上/下篇兼容；新路径用 notePageIndex。
   */
  const generateCustomNoteOne = async (
    trimmed: string,
    kind: "single_page_knowledge_card" | "storyboard_sheet_landscape",
    notePart?: "upper" | "lower",
    notePage?: { index: number; total: number },
  ): Promise<string> => {
    const sceneId = `custom-note-${notePage?.index ?? notePart ?? "single"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const progressJobId = newPlatformCompositeProgressJobId();
    const title = extractInfographicSubjectFromUserCopy(trimmed);
    /**
     * 知识卡的 scriptContext 会被 `planKnowledgeCardPages` 逐页切开当**正文**渲染，
     * 所以绝不能把版式块拼进来：`composeInfographicScriptContext` 的块以
     * 「【图文可视化模板·X·仅版式】+ 版式元结构 + 内容锁定 + LAYOUT ONLY 英文 prompt」开头，
     * 排在正文之前就整页印成模板说明书（用户 2026-08-05 选「左右对半对比」后第 1 页即是）。
     * 版式意图只能走出图约束，不能当内容。
     */
    const scriptContext = trimmed;
    const res = await generateCustomNoteMutation.mutateAsync({
      sceneId,
      title,
      scriptContext,
      kind,
      ...(notePage
        ? { notePageIndex: notePage.index, notePageTotal: notePage.total }
        : notePart
          ? { notePart }
          : {}),
      ...(kind === "single_page_knowledge_card"
        ? {
            distillModel: customNoteDistillModel,
            // 版式走独立字段进出图指令；拼进 scriptContext 会被当正文印出来
            ...(customNoteInfographicTemplateId
              ? { infographicTemplateId: customNoteInfographicTemplateId }
              : {}),
          }
        : {}),
      imagePromptTranslator: COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
      progressJobId,
      enabledSkillIds: Array.from(enabledPlatformSkillIds),
      allowBloggerTitle,
    });
    if (res.imageUrl) {
      writePosterLastResult([res.imageUrl], kind);
      return res.imageUrl;
    }
    if ((res as { isAsync?: boolean }).isAsync && (res as { progressJobId?: string }).progressJobId) {
      const pid = (res as { progressJobId?: string }).progressJobId!;
      // 入队即落库：刷新/换页后开页可自动续轮询，不再丢单（2026-08-12 实证三连丢后加）
      writePosterResumeRecord({ jobId: pid, kind, titleHead: title, firedAt: Date.now() });
      try {
        const j = await pollJobUntilTerminal(pid, {
          intervalMs: 1500,
          maxWaitMs: 10 * 60_000,
          adaptiveBackoffAfterAttempts: 20,
          maxIntervalMs: 5000,
        });
        if (j.status === "failed") throw new Error(j.error || "生成失敗，請重試");
        const out = j.output as { compositeImageUrl?: string; imageUrl?: string } | null;
        const url = out?.compositeImageUrl || out?.imageUrl || "";
        if (!url) throw new Error("未取得圖片 URL，請重試");
        writePosterLastResult([url], kind);
        return url;
      } finally {
        // 只清自己的挂账：无条件清会把并发新任务的记录误删（审查抓的竞态）
        if (readPosterResumeRecord()?.jobId === pid) writePosterResumeRecord(null);
      }
    }
    throw new Error("生成失敗，請重試");
  };

  const mapCustomNoteError = (error: unknown): string => {
    const message = String((error as { message?: string })?.message || "");
    if (message.includes("文档较长") || message.includes("提炼超时")) {
      return message.includes("超时") ? message : "文档较长，提炼超时，请稍后重试";
    }
    if (message.includes("算力紧张")) {
      return message;
    }
    if (
      message.includes("Unexpected end of JSON input") ||
      message.includes("Unexpected token") ||
      message.includes("is not valid JSON") ||
      message.includes("An error o") ||
      message.includes("模型返回格式异常") ||
      message.includes("模型服务暂时异常")
    ) {
      return "算力紧张或请求超时，请稍后重试";
    }
    return message || "生成失败，请稍后重试";
  };

  const handleGenerateCustomNote = async (overrides?: {
    text?: string;
    kind?: typeof customNoteKind;
    skipClearOptimize?: boolean;
  }) => {
    // 连点/续航进行中兜底：busy 期间一切入口直接弹提示，不叠任务
    if (customNoteBusy) {
      toast.info("上一个生成任务还在进行中，请稍候");
      return;
    }
    const kind = overrides?.kind ?? customNoteKind;
    const trimmed = (overrides?.text ?? customNoteText).trim();
    const pendingAhead = customNotePendingFilesRef.current.length;
    if (!trimmed && !(customNoteKind === "single_page_knowledge_card" && pendingAhead > 0)) {
      toast.error(pendingAhead > 0 ? "请等待文件读取完成，或重新上传" : "请先输入中文文案或上传文件");
      return;
    }
    setCustomNoteImageUpper(null);
    setCustomNoteImageLower(null);
    setCustomNoteImages([]);
    setCustomNotePageProgress(null);
    setCustomNoteError(null);
    if (!overrides?.skipClearOptimize) {
      setCustomOptimizeResult(null);
      setCustomOptimizeSummary(null);
    }
    setCustomNoteBusy(true);
    try {
      if (kind === "optimize_custom_copy") {
        const res = await optimizeCustomCopyMutation.mutateAsync({
          sourceText: trimmed,
          optimizationBrief: customOptimizeBrief.trim() || undefined,
          visionContext: pendingOptimizeVisionRef.current,
          includeLiveTrends: pendingOptimizeLiveTrendsRef.current || Boolean(pendingOptimizeVisionRef.current),
          liveTrendWindowDays: 7,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
        });
        pendingOptimizeVisionRef.current = undefined;
        pendingOptimizeLiveTrendsRef.current = false;
        setCustomOptimizeResult(res.result.optimizedMarkdown);
        setCustomOptimizeSummary(res.result.summary);
        toast.success(`深度优化完成${res.cost > 0 ? `（已扣 ${res.cost} 积分）` : ""}`);
        return;
      }
      if (kind === "single_page_knowledge_card") {
        setCustomNoteImages([]);
        setCustomNoteImageUpper(null);
        setCustomNoteImageLower(null);
        const pendingFiles = customNotePendingFilesRef.current.slice();
        let distilled = trimmed;
        // 上传路径已提炼进文本框时，生成只出图；仅当仍有待处理文件或无文案时再提炼
        if (pendingFiles.length > 0 || !distilled) {
          setCustomNoteDistillPhase("distilling");
          distilled = await runKnowledgeCardDistill({
            sourceText: resolveKnowledgeCardSourceText(trimmed, pendingFiles.length),
            files: pendingFiles,
            onStatus: setCustomNoteUploadStatus,
          });
          if (!distilled) throw new Error("提炼结果为空，请调整文案后重试");
          setCustomNoteText(distilled);
          customNotePendingFilesRef.current = [];
          setCustomNotePendingMeta([]);
          setCustomNoteUploadStatus(null);
          setCustomNoteDistillPhase("ready");
          await new Promise<void>((r) => requestAnimationFrame(() => r()));
        } else if (distilled.length > KNOWLEDGE_CARD_SKIP_DISTILL_MAX_CHARS) {
          /**
           * 纯文本长文：先把「提炼 vs 直接出图」的账摆给用户看。
           * 一万字直接出图要 9 页 264 积分，而且超过 6 页整套降到 2K；
           * 花提炼费换成 4 页 120 积分还能保住 4K。默认劝提炼，但省不回本时不打扰。
           */
          const tradeoff = estimateKnowledgeCardDistillTradeoff(
            distilled,
            customNoteDistillModel,
            suggestKnowledgeCardMinSections,
            knowledgeCardDistillFeeForModel(customNoteDistillModel),
          );
          if (tradeoff.saved > 0) {
            setCustomNoteBusy(false);
            const wantDistill = window.confirm(
              [
                `这段文字约 ${distilled.length.toLocaleString()} 字。`,
                "",
                `直接出图：约 ${tradeoff.full.pages} 页 · ${tradeoff.full.credits} 积分 · 画质 ${tradeoff.full.is4k ? "4K" : "2K"}`,
                `先做提炼：约 ${tradeoff.distilled.pages} 页 · ${tradeoff.distilled.credits} 积分 + 提炼费 ${tradeoff.distilled.distillFee} · 画质 ${tradeoff.distilled.is4k ? "4K" : "2K"}`,
                "",
                `提炼可省约 ${tradeoff.saved} 积分${tradeoff.distilled.is4k && !tradeoff.full.is4k ? "，画质还更高（超过 6 页会整套降到 2K）" : ""}。`,
                "",
                "点「确定」先提炼（推荐），点「取消」按原文全量出图。",
              ].join("\n"),
            );
            setCustomNoteBusy(true);
            if (wantDistill) {
              setCustomNoteDistillPhase("distilling");
              const refined = await runKnowledgeCardDistill({
                sourceText: distilled,
                onStatus: setCustomNoteUploadStatus,
                chargeDistillFee: true,
              });
              if (!refined) throw new Error("提炼结果为空，请调整文案后重试");
              distilled = refined;
              setCustomNoteText(refined);
              setCustomNoteUploadStatus(null);
              setCustomNoteDistillPhase("ready");
              await new Promise<void>((r) => requestAnimationFrame(() => r()));
            }
          }
        }
        const plan = planKnowledgeCardPages(distilled, customNoteDistillModel);
        const pages = plan.pages.length ? plan.pages : [distilled];
        const total = pages.length;
        const q = knowledgeCardImageQuality(total);
        const qLabel = q === "high" ? "4K" : "2K";
        const credits = plan.credits || knowledgeCardCreditsForPages(total, customNoteDistillModel);
        setCustomNoteBusy(false);
        const continueGen = window.confirm(
          `约 ${total} 页图文笔记（出图 ${qLabel}，约 ${credits} 积分）。\n\n是否继续出图？\n选「取消」将保留上方提炼稿，不出图。`,
        );
        if (!continueGen) {
          toast.success(`已保留提炼稿（约 ${total} 页），未出图`);
          setCustomNoteDistillPhase("idle");
          return;
        }
        setCustomNoteBusy(true);
        toast.success(`开始出图 · ${total} 页 · ${qLabel}`);
        const urls: string[] = [];
        for (let i = 0; i < total; i++) {
          setCustomNotePageProgress({ i: i + 1, n: total });
          setCustomNotePartInFlight(i === 0 ? "upper" : "lower");
          const url = await generateCustomNoteOne(distilled, "single_page_knowledge_card", undefined, {
            index: i + 1,
            total,
          });
          urls.push(url);
          setCustomNoteImages([...urls]);
          // 逐页累积落库：单页内的写入是覆盖式，只存这里的全量才不会「三页只找回最后一页」
          writePosterLastResult([...urls], "single_page_knowledge_card");
          setCustomNoteImageUpper(urls[0] ?? null);
          setCustomNoteImageLower(urls[1] ?? null);
        }
        toast.success(`已生成 ${total} 页图文笔记（${qLabel} · 约 ${credits} 积分）`);
        setCustomNoteDistillPhase("idle");
      } else {
        setCustomNotePartInFlight(null);
        setCustomNotePageProgress(null);
        const img = await generateCustomNoteOne(trimmed, "storyboard_sheet_landscape", undefined);
        setCustomNoteImageUpper(img);
        setCustomNoteImages([img]);
        toast.success("分鏡圖已生成");
      }
    } catch (e) {
      const msg = mapCustomNoteError(e);
      setCustomNoteError(msg);
      toast.error(`生成失敗：${msg.slice(0, 120)}`);
    } finally {
      setCustomNoteBusy(false);
      setCustomNotePartInFlight(null);
      setCustomNotePageProgress(null);
      setCustomNoteDistillPhase("idle");
    }
  };

  const handleAssetDeepOptimize = useCallback(
    async (payload: AssetAnalysisHandoffPayload) => {
      if (payload.shootingTechniqueBrief?.trim()) {
        lastShootingTechniqueBriefRef.current = payload.shootingTechniqueBrief.trim();
      }
      pendingOptimizeVisionRef.current = payload.visionContext || undefined;
      pendingOptimizeLiveTrendsRef.current = true;
      const res = await optimizeCustomCopyMutation.mutateAsync({
        sourceText: payload.sourceText,
        optimizationBrief: payload.optimizationBrief,
        visionContext: payload.visionContext,
        includeLiveTrends: true,
        liveTrendWindowDays: 7,
        enabledSkillIds: Array.from(enabledPlatformSkillIds),
        allowBloggerTitle,
      });
      pendingOptimizeVisionRef.current = undefined;
      pendingOptimizeLiveTrendsRef.current = false;
      return {
        optimizedMarkdown: res.result.optimizedMarkdown,
        summary: res.result.summary,
      };
    },
    [optimizeCustomCopyMutation, enabledPlatformSkillIds, allowBloggerTitle],
  );

  const handleAssetGenerateFromText = useCallback(
    async (text: string, kind: "storyboard_sheet_landscape" | "single_page_knowledge_card") => {
      setCustomNoteImageUpper(null);
      setCustomNoteImageLower(null);
      setCustomNoteError(null);
      setCustomNoteBusy(true);
      try {
        const shoot = lastShootingTechniqueBriefRef.current.trim();
        const scriptWithShoot = shoot
          ? `${text.trim()}\n\n【上传素材拍摄技法】\n${shoot}`.slice(0, 12000)
          : text;
        if (kind === "single_page_knowledge_card") {
          setCustomNotePartInFlight("upper");
          const upper = await generateCustomNoteOne(scriptWithShoot, "single_page_knowledge_card", "upper");
          setCustomNoteImageUpper(upper);
          setCustomNotePartInFlight("lower");
          const lower = await generateCustomNoteOne(scriptWithShoot, "single_page_knowledge_card", "lower");
          setCustomNoteImageLower(lower);
        } else {
          setCustomNotePartInFlight(null);
          const img = await generateCustomNoteOne(scriptWithShoot, "storyboard_sheet_landscape", undefined);
          setCustomNoteImageUpper(img);
        }
      } catch (e) {
        const msg = mapCustomNoteError(e);
        setCustomNoteError(msg);
        throw new Error(msg);
      } finally {
        setCustomNoteBusy(false);
        setCustomNotePartInFlight(null);
      }
    },
    [generateCustomNoteOne, mapCustomNoteError],
  );

  const handleGenerateFromOptimizedCopy = useCallback(
    async (kind: "single_page_knowledge_card" | "storyboard_sheet_landscape") => {
      const text = customOptimizeResult?.trim();
      if (!text) {
        toast.error("暂无优化稿可生图");
        return;
      }
      setCustomNoteKind(kind);
      setCustomNoteText(text);
      await handleGenerateCustomNote({ text, kind, skipClearOptimize: true });
    },
    [customOptimizeResult, handleGenerateCustomNote],
  );

  const handleUploadCustomTopicPhoto = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) {
        toast.error("请上传图片文件（JPG / PNG）");
        return;
      }
      if (file.size > 25 * 1024 * 1024) {
        toast.error("图片过大（请 ≤ 25MB）");
        return;
      }
      setCustomTopicPhotoUploading(true);
      try {
        const jpegBase64 = await new Promise<string>((resolve, reject) => {
          const img = new window.Image();
          const objectUrl = URL.createObjectURL(file);
          img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            const maxEdge = 1280;
            const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
            const w = Math.max(1, Math.round(img.width * scale));
            const h = Math.max(1, Math.round(img.height * scale));
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const cctx = canvas.getContext("2d");
            if (!cctx) {
              reject(new Error("无法处理图片（canvas 不可用）"));
              return;
            }
            cctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
            const base64 = dataUrl.split(",")[1] || "";
            if (!base64) {
              reject(new Error("图片编码失败"));
              return;
            }
            resolve(base64);
          };
          img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error("图片读取失败"));
          };
          img.src = objectUrl;
        });
        const { url } = await uploadCoverReferencePhotoMutation.mutateAsync({
          imageBase64: jpegBase64,
          mimeType: "image/jpeg",
        });
        if (!url) throw new Error("上传未返回 URL");
        setCustomTopicPhotoUrl(url);
        setCustomTopicPhotoPreview(URL.createObjectURL(file));
        toast.success("主人公图像已上传");
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "人像上传失败");
      } finally {
        setCustomTopicPhotoUploading(false);
      }
    },
    [uploadCoverReferencePhotoMutation],
  );

  const customTopicImageCost = useMemo(
    () =>
      platformCustomTopicImageCredits({
        includeCover: customTopicGenCover,
        includeStoryboard: customTopicGenStoryboard,
        is3x4: customTopicGridVariant === "3x4",
      }),
    [customTopicGenCover, customTopicGenStoryboard, customTopicGridVariant],
  );

  const customMattingCost = useMemo(
    () => platformCustomMattingTotalCredits(customMattingCount),
    [customMattingCount],
  );

  const handleGenerateCustomMatting = async () => {
    const prompt = customMattingPrompt.trim();
    if (prompt.length < 4) {
      toast.error("请至少输入 4 个字的描述");
      return;
    }
    if (!isAuthenticated) {
      toast.error("请先登录");
      return;
    }

    const discountLabel =
      customMattingCount === 1
        ? "原价"
        : customMattingCount === 2
          ? "九折"
          : "八折";
    if (
      !supervisorAccess &&
      !window.confirm(
        `将消耗 ${customMattingCost} 积分（${customMattingCount} 张 · ${discountLabel}），按描述生成 ${customMattingAspect} 人物/主体图。是否继续？`,
      )
    ) {
      return;
    }

    setCustomMattingBusy(true);
    setCustomMattingError(null);
    setCustomMattingImages([]);
    setCustomMattingTransparentCutout(false);

    try {
      const res = await generatePlatformCustomMattingMutation.mutateAsync({
        prompt,
        aspectRatio: customMattingAspect,
        count: customMattingCount,
      });
      setCustomMattingImages(res.imageUrls ?? []);
      setCustomMattingTransparentCutout(!!res.transparentCutout);
      toast.success(`已生成 ${res.imageUrls?.length ?? 0} 张图片`);
      void queryClient.invalidateQueries({ queryKey: [["credits"]] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setCustomMattingError(msg);
      toast.error(msg.slice(0, 120));
    } finally {
      setCustomMattingBusy(false);
    }
  };

  const customTopicActionLabel = useMemo(() => {
    const parts: string[] = [];
    if (customTopicGenCopy) parts.push("文案");
    if (customTopicGenCover) parts.push("封面");
    if (customTopicGenStoryboard) parts.push("分镜");
    return parts.length > 0 ? `生成 ${parts.join(" + ")}` : "请选择生成项";
  }, [customTopicGenCopy, customTopicGenCover, customTopicGenStoryboard]);

  const customTopicCanSubmit = useMemo(() => {
    if (!customTopicGenCopy && !customTopicGenCover && !customTopicGenStoryboard) return false;
    if (customTopicGenCopy && !customTopicProtagonist.trim()) return false;
    if (customTopicGenCover && !customTopicPhotoUrl) return false;
    if (
      customTopicGenStoryboard &&
      !customTopicPhotoUrl &&
      !(customTopicCoverUrl && !customTopicGenCover)
    ) {
      return false;
    }
    if ((customTopicGenCover || customTopicGenStoryboard) && !customTopicGenCopy && !customTopicCard) return false;
    return true;
  }, [
    customTopicGenCopy,
    customTopicGenCover,
    customTopicGenStoryboard,
    customTopicProtagonist,
    customTopicPhotoUrl,
    customTopicCoverUrl,
    customTopicCard,
  ]);

  const generateCustomTopicStoryboardOne = async (
    card: PlatformContentExecutionCard,
    opts?: { coverReferenceUrl?: string | null },
  ): Promise<string> => {
    const protagonist = customTopicProtagonist.trim();
    const storyboardRefUrl =
      opts?.coverReferenceUrl ?? customTopicCoverUrl ?? customTopicPhotoUrl ?? undefined;
    const refFromApprovedCover = Boolean(opts?.coverReferenceUrl ?? customTopicCoverUrl);
    const coverPersona = appendFashionEditorialCharacterGuidance(
      [
        `【主人公特质与专长】\n${protagonist || card.title}`,
        refFromApprovedCover
          ? "【视觉锚点】分镜各格须与已生成竖版封面为同一人（以封面人脸为唯一标准，跨格禁止换脸）；仅脚本明确描写古人/历史角色等时才使用不同人物。"
          : "【视觉锚点】分镜各格须融合用户上传的主人公参考人像，保持相貌、气质与造型一致；仅脚本明确描写古人/历史角色等时才使用不同人物。",
      ].join("\n\n"),
      { maxChars: 3800, lang: "zh" },
    );
    const progressJobId = newPlatformCompositeProgressJobId();
    const shootBrief = lastShootingTechniqueBriefRef.current.trim() || undefined;
    const res = await generatePlatformCompositeSheetMutation.mutateAsync({
      sceneId: card.id,
      title: card.title,
      scriptContext: buildPlatformSheetScriptContext(card, { shootingTechniqueBrief: shootBrief }),
      kind: "storyboard_sheet_landscape",
      gridVariant: customTopicGridVariant,
      executionDetails: buildPlatformExecutionDetailsPayload(card),
      shootingTechniqueBrief: shootBrief,
      imagePromptTranslator: COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
      coverPersonaContext: coverPersona,
      referencePhotoUrl: storyboardRefUrl,
      referencePhotoFromApprovedCover: refFromApprovedCover,
      progressJobId,
      compositeImageEngine: storyboardRefUrl ? "gpt_image2" : platformComposite2x4Engine,
      enabledSkillIds: Array.from(enabledPlatformSkillIds),
      allowBloggerTitle,
    });
    if (res.imageUrl) return res.imageUrl;
    if ((res as { isAsync?: boolean }).isAsync) {
      const j = await pollJobUntilTerminal(progressJobId, {
        intervalMs: platformImageFlowPollIntervalMs,
        maxWaitMs: 28 * 60_000,
      });
      if (j.status === "failed") throw new Error(j.error || "分镜生成失败");
      const out = j.output as { imageUrl?: string; compositeImageUrl?: string } | null;
      const url = String(out?.compositeImageUrl || out?.imageUrl || "").trim();
      if (!url) throw new Error("未取得分镜 URL");
      return url;
    }
    throw new Error("分镜生成失败");
  };

  const handleGenerateCustomTopic = async () => {
    if (!customTopicGenCopy && !customTopicGenCover && !customTopicGenStoryboard) {
      toast.error("请至少勾选一项生成内容");
      return;
    }
    const protagonist = customTopicProtagonist.trim();
    if (customTopicGenCopy && !protagonist) {
      toast.error("请先填写主人公特质与专长");
      return;
    }
    if (customTopicGenCover && !customTopicPhotoUrl) {
      toast.error("生成封面请先上传主人公图像");
      return;
    }
    if (customTopicGenStoryboard && !customTopicPhotoUrl && !(customTopicCoverUrl && !customTopicGenCover)) {
      toast.error("生成分镜请先上传主人公图像，或使用已有封面作为人脸参考");
      return;
    }
    if ((customTopicGenCover || customTopicGenStoryboard) && !customTopicGenCopy && !customTopicCard) {
      toast.error("未勾选文案时，请先生成过文案，或勾选「文案生成」");
      return;
    }
    if (!isAuthenticated) {
      toast.error("请先登录");
      return;
    }

    const title = customTopicTitle.trim() || protagonist.slice(0, 48) || "主人公主题内容";
    const imageCost = customTopicImageCost;
    const bundleDiscount =
      customTopicGenCover && customTopicGenStoryboard ? PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL : "";

    setCustomTopicBusy(true);
    setCustomTopicError(null);
    if (customTopicGenCopy) {
      setCustomTopicCard(null);
      if (customTopicGenCover) setCustomTopicCoverUrl(null);
      if (customTopicGenStoryboard) setCustomTopicStoryboardUrl(null);
    } else {
      if (customTopicGenCover) setCustomTopicCoverUrl(null);
      if (customTopicGenStoryboard) setCustomTopicStoryboardUrl(null);
    }

    try {
      let card = customTopicCard;

      if (customTopicGenCopy) {
        setCustomTopicPhase("copy");
        const structure = [
          "【主人公特质与专长】",
          protagonist,
          customTopicTitle.trim() ? `\n【选题方向】${customTopicTitle.trim()}` : "",
          "\n【商业闭环·强烈建议】先从主人公背景与赛道推断：① 目标客户是谁；② 1–2 个核心痛点；③ 吸睛标题（好奇缺口/反常识/反差/时事）；④ 钩子停滑句；⑤ 正文给 2–3 个半成品解法并故意留白；⑥ 结尾咨询/私信/预约 CTA。少写成纯百科。",
          "\n【素材多样性·强烈建议】少默认苏轼/李清照/宋朝词人。**高度需求**从周秦汉唐宋元明清及近现代轮换；包括但不限于史记/战国策/唐诗/医籍/小说/文物/历史事件/当代影视与时事；人物覆盖贵族到平民；文化是容器，带回扣人设的钩子与解法。",
          "\n【灯光·运镜·情绪·高度需求】分镜与脚本写清每段运镜、灯光安排与情绪表达，目标达专业影视级水准；只借手法与创意（高反差、魔术时刻、剪影揭示、工业冷光、运动闪切、雾霾静默、霓虹余韵、精密冷光、天气即光、动机窗光、剧集人物主光等），禁止点名导演/片名或写致敬。画内表建议含运镜、灯光安排、情绪表达。",
          "\n【审核友好·强烈建议】若涉及健康/医学/法律/金融等强监管领域：用学者/生活美学/生命科学表达，少用病名治疗干预、听诊器/CT 等临床强视觉锚点与疗效承诺。",
          "\n请围绕该主人公的专业背景、人格特质与视觉形象，设计一条适合短视频传播的单条选题执行方案。",
          "\n【分镜视觉约束】各格分镜须以上传参考人像为主人公/主讲人相貌（跨格同一人，禁止换成陌生面孔）；仅脚本明确描写古人、历史人物、古代场景或独立第三方角色时，才使用不同人物造型。封面亦须融合同一参考人像。",
        ]
          .filter(Boolean)
          .join("\n");

        const res = await generateDecisionIntelTopicCopyMutation.mutateAsync({
          topic: strategicMapTopic || "自定义主人公选题",
          contentBlueprint: {
            summary: title,
            source: "custom_topic_workspace",
            protagonist,
            topicTitle: customTopicTitle.trim() || undefined,
          },
          platformHint: decisionIntelPlatformHint,
          blueOceanLexicon: decisionIntelBlueOceanLexicon,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
          pick: {
            title: title.slice(0, 240),
            structure: structure.slice(0, 8000),
            source: "personalization" as const,
          },
        });

        const mapped = mapStrategicMapBlueprintsToExecutionCards(res.executionBlueprints ?? [], 9000, {
          isDecisionIntelPicked: true,
        });
        if (mapped.length === 0) throw new Error("未能生成执行文案，请稍后重试");
        card = mapped[0]!;
        setCustomTopicCard(card);
        await syncPlatformExecutionBlueprintsSnapshotMutation.mutateAsync({
          contentBlueprints: res.executionBlueprints ?? [],
        });
        toast.success("文案已生成");
      }

      if (!customTopicGenCover && !customTopicGenStoryboard) return;

      if (!card) throw new Error("缺少执行文案，无法生成图片");

      setCustomTopicPhase("images");

      const imageParts: string[] = [];
      if (customTopicGenCover) imageParts.push("竖版封面");
      if (customTopicGenStoryboard) {
        imageParts.push(`${customTopicGridVariant === "3x4" ? "3×4 十二格" : "2×4 八格"}分镜`);
      }
      const confirmMsg =
        imageCost > 0
          ? `将消耗 ${imageCost} 积分${bundleDiscount}，生成 ${imageParts.join(" + ")}（文案扩写首次免费）。是否继续？`
          : `即将生成 ${imageParts.join(" + ")}。是否继续？`;

      if (!supervisorAccess && !window.confirm(confirmMsg)) return;

      const coverPersona = appendFashionEditorialCharacterGuidance(
        [
          `【主人公特质与专长】\n${protagonist || card.title}`,
          "【视觉锚点】封面与分镜须融合用户上传的主人公参考人像，保持相貌、气质与造型一致；分镜各格跨格同一人，仅古人/历史角色等脚本明示时换脸。",
        ].join("\n\n"),
        { maxChars: 3800, lang: "zh" },
      );
      const storyboardCompositeEngine = customTopicPhotoUrl ? ("gpt_image2" as const) : platformComposite2x4Engine;

      if (customTopicGenCover && customTopicGenStoryboard) {
        const bundleRes = await runEnqueueTopicCoverCompositeBundleAndPoll({
          sceneId: card.id,
          coverPersonaContext: coverPersona,
          headlineTitle: card.title,
          compositeKind: "storyboard_sheet_landscape",
          scriptContext: buildPlatformSheetScriptContext(card, { shootingTechniqueBrief: lastShootingTechniqueBriefRef.current.trim() || undefined }),
          executionDetails: buildPlatformExecutionDetailsPayload(card),
          shootingTechniqueBrief: lastShootingTechniqueBriefRef.current.trim() || undefined,
          gridVariant: customTopicGridVariant,
          referencePhotoUrl: customTopicPhotoUrl ?? undefined,
          compositeImageEngine: storyboardCompositeEngine,
          pollDebugLabel: `自定义选题 · ${card.id}`,
        });
        if (bundleRes.imageUrl) setCustomTopicCoverUrl(bundleRes.imageUrl);
        if (bundleRes.compositeImageUrl) setCustomTopicStoryboardUrl(bundleRes.compositeImageUrl);
        if (!bundleRes.success) throw new Error("套装未完成，请重试");
        toast.success(`封面 + ${customTopicGridVariant === "3x4" ? "3×4" : "2×4"} 分镜已生成`);
      } else {
        let freshCoverUrl: string | undefined;
        if (customTopicGenCover) {
          const coverRes = await runEnqueueTopicImageAndPoll({
            sceneId: card.id,
            format: "短视频",
            coverPersonaContext: coverPersona,
            referencePhotoUrl: customTopicPhotoUrl ?? undefined,
            pollDebugLabel: `自定义选题封面 · ${card.id}`,
          });
          freshCoverUrl = coverRes.imageUrl ?? undefined;
          if (coverRes.imageUrl) setCustomTopicCoverUrl(coverRes.imageUrl);
          else throw new Error("封面生成失败");
        }
        if (customTopicGenStoryboard) {
          const storyboardUrl = await generateCustomTopicStoryboardOne(card, {
            coverReferenceUrl: freshCoverUrl ?? customTopicCoverUrl,
          });
          setCustomTopicStoryboardUrl(storyboardUrl);
        }
        const done: string[] = [];
        if (customTopicGenCover) done.push("封面");
        if (customTopicGenStoryboard) done.push("分镜");
        toast.success(`${done.join(" + ")}已生成`);
      }

      void queryClient.invalidateQueries({ queryKey: [["credits"]] });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const friendly = sanitizePlatformUserMessage(msg, "生成失败，请稍后重试");
      setCustomTopicError(friendly);
      toast.error(friendly.slice(0, 120));
    } finally {
      setCustomTopicBusy(false);
      setCustomTopicPhase("idle");
    }
  };

  const runSequentialCompositeBatchGeneration = async () => {
    const cards = visibleExecutionCards;
    const packSceneIds = cards.map((c) => c.id);
    const batchIs3x4 = compositeGridVariant === "3x4";
    const localOpId = `batch-composite-seq-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    compositeBatchSilentUiRef.current = true;
    setIsSequentialCompositeBatchGenerating(true);
    setPlatformImageGenFlowSnapshots((prev) =>
      upsertPlatformImageFlowSnapshot(prev, {
        at: new Date().toISOString(),
        kind: "batch_composite_2x4",
        lines: [
          `${new Date().toISOString()}  [客户端] 一键 ${batchIs3x4 ? "3×4 十二格" : "2×4/八格"}批量已发起 · topicCount=${cards.length} · 每题后台异步执行 · 客户端轮询至完成后再发下一题（与封面批量一致）`,
          `${new Date().toISOString()}  [等待中] 编导分镜套装合计 ${platformCompositeBundleTotalCreditsForGrid(cards.length, batchIs3x4)} 积分（${batchIs3x4 ? 108 : 54}×${cards.length}·${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}），单张约 3～5 分钟`,
        ],
        meta: {
          localOpId,
          platformType: "composite_2x4",
          topicCount: cards.length,
          concurrency: 1,
          pending: true,
        },
      }),
    );

    let successCount = 0;
    const liveLines: string[] = [];
    try {
      for (let slotIndex = 0; slotIndex < cards.length; slotIndex++) {
        const item = cards[slotIndex]!;
        const headlineTitle = item.title;
        const isGraphicFormat = item.format === "图文" || item.format === "小红书";
        const compositeKind = isGraphicFormat ? "xiaohongshu_dual_note" : "storyboard_sheet_landscape";
        const coverPersona = buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim();
        const compositeSupervisorExtras = {
          ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
            ? { enableTopicCoverDeepResearchPro: true as const }
            : {}),
          ...(coverPersona ? { coverPersonaContext: coverPersona } : {}),
        };
        liveLines.push(`${new Date().toISOString()}  [客户端] 开始合成 · sceneId=${item.id} · kind=${compositeKind}`);
        setPlatformImageGenFlowSnapshots((prev) =>
          upsertPlatformImageFlowSnapshot(prev, {
            at: new Date().toISOString(),
            kind: "batch_composite_2x4",
            lines: [
              ...liveLines,
              `${new Date().toISOString()}  [等待中] ${item.id}（详见下方各条 composite_2x4 服务端流水）`,
            ],
            meta: {
              localOpId,
              platformType: "composite_2x4",
              topicCount: cards.length,
              concurrency: 1,
              currentSceneId: item.id,
              successCount,
              pending: true,
            },
          }),
        );
        try {
          const progressJobId = newPlatformCompositeProgressJobId();
          const res = await runThrottledPlatformImageRequest(
            `composite:${item.id}:${compositeKind}`,
            () =>
              generatePlatformCompositeSheetMutation.mutateAsync({
                sceneId: item.id,
                title: headlineTitle,
                scriptContext: buildPlatformSheetScriptContext(item as any, {
                  shootingTechniqueBrief:
                    compositeKind === "xiaohongshu_dual_note"
                      ? undefined
                      : lastShootingTechniqueBriefRef.current.trim() || undefined,
                  gridVariant: compositeGridVariant,
                  sheetKind: compositeKind === "xiaohongshu_dual_note" ? "graphic" : "storyboard",
                }),
                kind: compositeKind,
                gridVariant: compositeGridVariant,
                executionDetails: buildPlatformExecutionDetailsPayload(item as any),
                shootingTechniqueBrief: lastShootingTechniqueBriefRef.current.trim() || undefined,
                ...optionalBoundCreationRecordId(),
                imagePromptTranslator: COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
                progressJobId,
                ...compositeSupervisorExtras,
                bulkCompositePack: { packSceneIds, sequentialSlot: slotIndex },
                compositeImageEngine: resolveReferencePhotoForScene(item.id)
                  ? "gpt_image2"
                  : platformComposite2x4Engine,
                ...(resolveReferencePhotoForScene(item.id)
                  ? { referencePhotoUrl: resolveReferencePhotoForScene(item.id) }
                  : {}),
                enabledSkillIds: Array.from(enabledPlatformSkillIds),
                allowBloggerTitle,
              }),
            (waitMs) => {
              liveLines.push(
                `${new Date().toISOString()}  [客户端] 节流等待 ${Math.ceil(waitMs / 1000)} 秒 · 滚动 ${PLATFORM_IMAGE_RATE_WINDOW_MS / 1000}s 内已排满 ${PLATFORM_IMAGE_MAX_STARTS_PER_60S} 次发起 · sceneId=${item.id}`,
              );
              setPlatformImageGenFlowSnapshots((prev) =>
                upsertPlatformImageFlowSnapshot(prev, {
                  at: new Date().toISOString(),
                  kind: "batch_composite_2x4",
                  lines: [...liveLines],
                  meta: {
                    localOpId,
                    platformType: "composite_2x4",
                    topicCount: cards.length,
                    concurrency: 1,
                    currentSceneId: item.id,
                    successCount,
                    pending: true,
                  },
                }),
              );
            },
          );
          let out = String(res.imageUrl ?? "").trim();
          const serverLines = Array.isArray((res as { imageGenFlowLog?: string[] }).imageGenFlowLog)
            ? ((res as { imageGenFlowLog?: string[] }).imageGenFlowLog ?? [])
            : [];
          if (serverLines.length > 0) {
            liveLines.push(`${new Date().toISOString()}  [当前步骤] ${serverLines[serverLines.length - 1]}`);
          }
          const asyncMeta = res as { isAsync?: boolean; progressJobId?: string };
          const pollJobId = String(asyncMeta.progressJobId ?? progressJobId ?? "").trim();
          if (!out && asyncMeta.isAsync && pollJobId.length >= 8) {
            liveLines.push(
              `${new Date().toISOString()}  [客户端] 2×4 已入队 · progressJobId=${pollJobId} · pollJobUntilTerminal 等待终态后再下一题…`,
            );
            setCompositeAwaitingJobTerminal(false);
            try {
              const batchIs3x4Label = compositeGridVariant === "3x4";
              const batchCompositeDbgLabel =
                compositeKind === "xiaohongshu_dual_note"
                  ? batchIs3x4Label
                    ? "图文笔记 · 3×4 十二格合成"
                    : "图文笔记 · 2×4 八格合成"
                  : batchIs3x4Label
                    ? "编导分镜图 · 3×4 十二格合成"
                    : "编导分镜图 · 2×4 宽幅合成";
              const j = await pollJobUntilTerminal(pollJobId, {
                intervalMs: compositeSheetLivePollIntervalMs,
                maxWaitMs: 18 * 60_000,
                adaptiveBackoffAfterAttempts: 36,
                maxIntervalMs: 8000,
                onPoll: ({ attempt, output }) => {
                  const flow = Array.isArray((output as { imageGenFlowLog?: string[] })?.imageGenFlowLog)
                    ? ((output as { imageGenFlowLog?: string[] }).imageGenFlowLog ?? [])
                    : [];
                  setCompositeJobPollTrace((prev) => {
                    const base =
                      prev && prev.jobId === pollJobId
                        ? prev
                        : {
                            jobId: pollJobId,
                            label: batchCompositeDbgLabel,
                            lines: [],
                            pollCount: 0,
                          };
                    return applyFlowLogToPollTrace(base, attempt, flow);
                  });
                },
              });
              const jo = j.output as {
                compositeImageUrl?: string;
                imageUrl?: string;
                imageGenFlowLog?: string[];
              } | undefined;
              const flowTail = Array.isArray(jo?.imageGenFlowLog) ? jo!.imageGenFlowLog! : [];
              setCompositeJobPollTrace((prev) =>
                prev && prev.jobId === pollJobId
                  ? {
                      ...applyFlowLogToPollTrace(prev, Math.max(prev.pollCount, 1), flowTail),
                      terminalStatus: j.status,
                      currentStep: j.status === "succeeded" ? "终态 succeeded" : "终态 failed",
                    }
                  : prev,
              );
              if (flowTail.length > 0) {
                liveLines.push(`${new Date().toISOString()}  [当前步骤] ${flowTail[flowTail.length - 1]}`);
              }
              const polledUrl =
                String(jo?.compositeImageUrl || "").trim() || String(jo?.imageUrl || "").trim();
              if (j.status === "succeeded" && polledUrl) {
                out = polledUrl;
                if (out) {
                  if (compositeKind === "storyboard_sheet_landscape") {
                    setPlatformStoryboardSheetMap((p) => ({ ...p, [item.id]: out }));
                  } else {
                    setPlatformXhsNoteMap((p) => ({ ...p, [item.id]: out }));
                  }
                  successCount += 1;
                  liveLines.push(`${new Date().toISOString()}  ✓ 合成完成（异步轮询）· sceneId=${item.id}`);
                }
              } else if (j.status === "failed") {
                liveLines.push(
                  `${new Date().toISOString()}  ✗ 合成失败（异步）· sceneId=${item.id} · ${j.error || "未知错误"}`,
                );
              } else if (!out) {
                liveLines.push(`${new Date().toISOString()}  ✗ 合成无图（异步终态）· sceneId=${item.id}`);
              }
            } catch (pollErr) {
              liveLines.push(
                `${new Date().toISOString()}  ✗ 异步轮询异常 · sceneId=${item.id} · ${
                  pollErr instanceof Error ? pollErr.message : String(pollErr)
                }`,
              );
            } finally {
              setCompositeAwaitingJobTerminal(false);
              compositeSheetLivePollCtxRef.current = null;
              setPendingCompositeSheet(null);
            }
          } else if (out) {
            successCount += 1;
            liveLines.push(`${new Date().toISOString()}  ✓ 合成完成 · sceneId=${item.id}`);
          } else {
            liveLines.push(`${new Date().toISOString()}  ✗ 合成无图 · sceneId=${item.id}`);
          }
        } catch (err) {
          liveLines.push(
            `${new Date().toISOString()}  ✗ 合成异常 · sceneId=${item.id} · ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      compositeBatchSilentUiRef.current = false;
      setIsSequentialCompositeBatchGenerating(false);
      setPlatformImageGenFlowSnapshots((prev) =>
        upsertPlatformImageFlowSnapshot(prev, {
          at: new Date().toISOString(),
          kind: "batch_composite_2x4",
          lines: [
            ...liveLines,
            `${new Date().toISOString()}  [客户端] 一键 2×4/八格批量结束 · success=${successCount}/${cards.length}`,
          ],
          meta: {
            localOpId,
            platformType: "composite_2x4",
            topicCount: cards.length,
            concurrency: 1,
            successCount,
            pending: false,
          },
        }),
      );
      toast.success(
        `已为 ${successCount}/${cards.length} 个选题完成 2×4 编导分镜／八格图文（合计 ${platformBulkCompositeCost} 积分）`,
      );
    }
  };

  const createPlatformQAJobMutation = trpc.mvAnalysis.createPlatformQAJob.useMutation();
  const savePlatformSessionBundleMutation = trpc.mvAnalysis.savePlatformSessionBundle.useMutation();
  /** 避免在 visibleExecutionCards / unlockedStrategicReport 定义前引用（TDZ） */
  const saveCurrentPlatformSessionToMyWorksRef = useRef<
    (opts?: {
      titleSuffix?: string;
      toastOnSuccess?: boolean;
      decisionIntelOverride?: AdvancedAIReportData | null;
    }) => Promise<{ success: boolean; id: number } | null>
  >(async () => null);

  const downloadPlatformPdfMutation = trpc.mvAnalysis.downloadPlatformPdf.useMutation({
    onSuccess: (result) => {
      setIsDownloadingPdf(false);
      if (!result.pdfBase64) { toast.error("PDF 生成成功但内容为空，请重试"); return; }
      try {
        const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `platform-analysis-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        toast.success("平台分析 PDF 已开始下载");
        // 完整作品包（文案/分镜/追问/趋势/战略全景）→ 我的作品
        void saveCurrentPlatformSessionToMyWorksRef.current({
          titleSuffix: "PDF导出",
          toastOnSuccess: true,
        });
      } catch { toast.error("PDF 下载时出错，请重试"); }
    },
    onError: (err) => { setIsDownloadingPdf(false); toast.error(err.message || "PDF 导出失败"); },
  });

  const downloadCustomCopyPdfMutation = trpc.mvAnalysis.downloadPlatformPdf.useMutation({
    onSuccess: (result) => {
      setIsDownloadingCustomCopyPdf(false);
      if (!result.pdfBase64) {
        toast.error("PDF 生成成功但内容为空，请重试");
        return;
      }
      try {
        const bytes = Uint8Array.from(atob(result.pdfBase64), (c) => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: "application/pdf" });
        const blobUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = blobUrl;
        a.download = `custom-copy-${Date.now()}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
        toast.success("自定义文案 PDF 已开始下载");
      } catch {
        toast.error("PDF 下载时出错，请重试");
      }
    },
    onError: (err) => {
      setIsDownloadingCustomCopyPdf(false);
      toast.error(err.message || "PDF 导出失败");
    },
  });

  const customCopyPdfPayload = useMemo(
    () => ({
      kind: customNoteKind,
      sourceText: customNoteText,
      optimizeBrief: customOptimizeBrief,
      optimizeResult: customOptimizeResult,
      optimizeSummary: customOptimizeSummary,
      imageUpperUrl: customNoteImageUpper,
      imageLowerUrl: customNoteImageLower,
      imageUrls: customNoteImages.length ? customNoteImages : undefined,
    }),
    [
      customNoteKind,
      customNoteText,
      customOptimizeBrief,
      customOptimizeResult,
      customOptimizeSummary,
      customNoteImageUpper,
      customNoteImageLower,
      customNoteImages,
    ],
  );

  const canExportCustomCopyPdf = useMemo(
    () => hasCustomCopyPdfContent(customCopyPdfPayload),
    [customCopyPdfPayload],
  );

  const handleExportCustomCopyPdf = useCallback(() => {
    if (!canExportCustomCopyPdf) {
      toast.error("请先输入文案或完成生成后再导出 PDF");
      return;
    }
    try {
      setIsDownloadingCustomCopyPdf(true);
      let html = buildCustomCopyPdfHtml(customCopyPdfPayload);
      html = optimizePdfSnapshotHtml(html);
      toast.info("正在生成自定义文案 PDF，请稍候…", { duration: 8000 });
      downloadCustomCopyPdfMutation.mutate({ html, token: "custom-copy-export" });
    } catch (e) {
      setIsDownloadingCustomCopyPdf(false);
      toast.error(e instanceof Error ? e.message : "构建 PDF 快照失败，请重试");
    }
  }, [canExportCustomCopyPdf, customCopyPdfPayload, downloadCustomCopyPdfMutation]);

  // 拆片表导出走「复制表格」（Markdown）；PDF 链路依赖 GCS pdf-worker，按用户口径不动

  /** /platform 不再展示或写入企业 IP 基因；保留空壳仅兼容既有函数签名 */
  const ipProfile: IpProfile = {
    industry: "",
    advantage: "",
    audience: "",
    flagship: "",
    taboos: "",
  };

  const [qaJobId, setQaJobId] = useState<string | null>(null);
  const [isDownloadingPdf, setIsDownloadingPdf] = useState(false);
  const [isExportingStrategicPng, setIsExportingStrategicPng] = useState(false);
  const strategicReportDashboardRef = useRef<HTMLDivElement>(null);
  const qaPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // QA file attachment state
  const [qaFileUri, setQaFileUri] = useState<string | null>(null);
  const [qaFileMimeType, setQaFileMimeType] = useState<string>("");
  const [qaFileName, setQaFileName] = useState<string>("");
  const [isUploadingQaFile, setIsUploadingQaFile] = useState(false);
  const [qaUploadStatus, setQaUploadStatus] = useState<"idle" | "success" | "error">("idle");
  const [isQaLoading, setIsQaLoading] = useState(false);
  const qaFileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup polling intervals on unmount
  useEffect(() => {
    return () => {
      if (qaPollingRef.current) clearInterval(qaPollingRef.current);
    };
  }, []);

  const startQAPolling = useCallback((jobId: string) => {
    if (qaPollingRef.current) clearInterval(qaPollingRef.current);
    let transientFailures = 0;
    qaPollingRef.current = setInterval(async () => {
      try {
        const job = await getJob(jobId);
        transientFailures = 0;
        if (job.status === "succeeded") {
          clearInterval(qaPollingRef.current!);
          qaPollingRef.current = null;
          setIsQaLoading(false);
          const output = job.output as any;
          if (output?.result) {
            setAskResult(output.result);
          } else if (output?.answer || typeof output === "string") {
            setAskResult({
              title: "深度追问解答",
              answer: typeof output === "string" ? output : (output.answer || ""),
              encouragement: "以上是结合最新数据的专属执行建议。",
              nextQuestions: [],
            });
          }
        } else if (job.status === "failed") {
          clearInterval(qaPollingRef.current!);
          qaPollingRef.current = null;
          setIsQaLoading(false);
          toast.error(`追问任务失败: ${job.error || "未知错误"}`);
        }
      } catch {
        transientFailures += 1;
        if (transientFailures >= 5) {
          clearInterval(qaPollingRef.current!);
          qaPollingRef.current = null;
          setIsQaLoading(false);
          toast.error("轮询追问任务时出错，请重试");
        }
      }
    }, 3000);
  }, []);

  const handleDownloadPlatformPdf = useCallback(async () => {
    // 与 MyReports `captureAndUploadSnapshot` 对齐：精准克隆 `#platform-report` + head 副本 +
    // optimizePdfSnapshotHtml / injectPlatformPdfSnapshotSanitizeIntoHead；并保留 details 行内展开以防截断。
    // 图片：克隆前 waitForPlatformReportImagesReady（lazy→eager、load/decode），避免 GPT 封面等尚未载入即成空块。
    try {
      setIsDownloadingPdf(true);
      if (typeof document !== "undefined" && (document as any).fonts?.ready) {
        await (document as any).fonts.ready;
      }
      await new Promise((r) => setTimeout(r, 600));

      toast.dismiss();
      await new Promise((r) => setTimeout(r, 400));

      const pdfRoot = document.getElementById(PLATFORM_PDF_SNAPSHOT_ROOT_ID);
      if (!pdfRoot) {
        toast.error("找不到报告容器（platform-report），请先完成分析后再试");
        setIsDownloadingPdf(false);
        return;
      }

      await waitForPlatformReportImagesReady(pdfRoot);

      const fragment = pdfRoot.cloneNode(true) as HTMLElement;
      fragment.querySelectorAll("script").forEach((n) => n.remove());
      fragment.querySelectorAll('[data-pdf-exclude="true"]').forEach((n) => n.remove());
      fragment.querySelector(`#${PLATFORM_REFERENCE_GALLERY_ID}`)?.remove();
      fragment.querySelectorAll("[data-pdf-only]").forEach((n) => {
        n.classList.remove("hidden");
      });
      fragment.querySelectorAll("button").forEach((n) => n.remove());
      fragment
        .querySelectorAll("[data-sonner-toaster], [data-sonner-toast], .toaster.group")
        .forEach((n) => n.remove());
      fragment.querySelectorAll("[class*='sonner']").forEach((n) => n.remove());

      fragment.querySelectorAll("details").forEach((detail) => {
        detail.setAttribute("open", "true");
        (detail as HTMLElement).style.display = "block";
        const content = detail.lastElementChild as HTMLElement | null;
        if (content) {
          content.style.display = "block";
          content.style.height = "auto";
          content.style.opacity = "1";
          content.style.overflow = "visible";
        }
      });

      const headEl = document.head.cloneNode(true) as HTMLHeadElement;
      headEl.querySelectorAll("script").forEach((n) => n.remove());
      const baseEl = document.createElement("base");
      baseEl.href = window.location.origin + "/";
      headEl.insertBefore(baseEl, headEl.firstChild);

      let html = `<!DOCTYPE html><html lang="zh-CN">${headEl.outerHTML}<body>${fragment.outerHTML}</body></html>`;
      html = optimizePdfSnapshotHtml(html);
      html = injectPlatformPdfSnapshotSanitizeIntoHead(html);

      toast.info("云端压制 PDF 中，多数约 15～45 分钟，请保持页面打开。", { duration: 10_000 });
      downloadPlatformPdfMutation.mutate({ html, token: `wait=360000&selector=%23platform-report` });
    } catch (e) {
      setIsDownloadingPdf(false);
      toast.error(e instanceof Error ? e.message : "构建 PDF 快照失败，请重试");
    }
  }, [downloadPlatformPdfMutation]);

  const snapshot = growthSnapshotQuery.data?.snapshot as GrowthSnapshot | undefined;
  const snapshotDebug = growthSnapshotQuery.data?.debug as Record<string, unknown> | undefined;
  const askDebug = askPlatformFollowUpMutation.data?.debug as Record<string, unknown> | undefined;
  const mainPath = snapshot?.decisionFramework.mainPath;
  const assetAdaptation = snapshot?.decisionFramework.assetAdaptation;
  const topRecommendation = snapshot?.platformRecommendations[0];
  const topMonetization = snapshot?.monetizationStrategies[0];
  const validationPlan = snapshot?.decisionFramework.validationPlan ?? [];
  const businessTranslation = snapshot?.decisionFramework.businessTranslation ?? [];
  const materialFacts = snapshot?.decisionFramework.materialFacts ?? [];
  const audienceTriggers = snapshot?.decisionFramework.audienceTriggers ?? [];
  const titleExecutions = snapshot?.titleExecutions ?? [];
  const platformActivities = snapshot?.platformActivities ?? [];
  const monetizationStrategies = snapshot?.monetizationStrategies ?? [];

  const primaryPlatforms = useMemo(() => snapshot?.platformSnapshots.slice(0, 4) ?? [], [snapshot]);
  const decisionIntelPlatformHint = useMemo(
    () => pickPrimaryDecisionIntelPlatformHint(primaryPlatforms),
    [primaryPlatforms],
  );
  /** 决策智库 / 自定义选题推演文案：合并看板蓝海词 + 趋势报表全局蓝海词 */
  const decisionIntelBlueOceanLexicon = useMemo(
    () =>
      buildBlueOceanLexicon({
        platformMenu: platformDashboard?.platformMenu,
        globalBlueOceanWords: visualReportData?.globalBlueOceanWords,
      }),
    [platformDashboard?.platformMenu, visualReportData?.globalBlueOceanWords],
  );
  const maxFit = Math.max(...primaryPlatforms.map((item) => item.audienceFitScore), 100);
  const maxMomentum = Math.max(...primaryPlatforms.map((item) => item.momentumScore), 100);
  const topTopics = useMemo(
    () =>
      platformDashboard?.hotTopics.length
        ? platformDashboard.hotTopics
        : (snapshot?.topicLibrary.slice(0, 8).map((item) => ({
            title: item.title,
            whyHot: item.rationale,
            howToUse: item.executionHint,
          })) ?? []),
    [platformDashboard, snapshot],
  );

  const strategicMapBlueprint = useMemo(
    () => ({
      headline: platformDashboard?.headline,
      subheadline: platformDashboard?.subheadline,
      personaSummary: platformDashboard?.personaSummary,
      hotTopics: platformDashboard?.hotTopics?.slice(0, 12),
      monetizationLanes: platformDashboard?.monetizationLanes?.slice(0, 6),
      trendNarrative: snapshot?.overview?.trendNarrative,
      /** Stage 2 专属文案／选题结构 — 决策智库仅在写入完成后开放，一并纳入分析 */
      stage2ContentBlueprints: platformContent?.contentBlueprints?.slice(0, 8),
      stage2MonetizationLanes: platformContent?.monetizationLanes?.slice(0, 8),
    }),
    [platformDashboard, snapshot, platformContent],
  );

  /**
   * 战略地图独立化：只要「快照 + Stage 1 战略看板」就绪即可扣点生成，**不再强制 Stage 2 专属文案**。
   * 若已跑 Stage 2，其选题会一并纳入分析（见 strategicMapBlueprint）；正在跑 Stage 2 时先等其完成，避免竞态。
   */
  const decisionIntelInputReady = useMemo(() => {
    if (!snapshot || !platformDashboard) return false;
    return true;
  }, [snapshot, platformDashboard]);
  const strategicMapTopic = useMemo(() => {
    const raw = (platformDashboard?.headline || platformDashboard?.subheadline || "").trim();
    return raw.slice(0, 160) || "个性化战略选题";
  }, [platformDashboard]);

  /**
   * 仅在全案专属文案已落地后演算示意预览，避免用浅层看板做出「很满」的假预览误导付费。
   * 与付费入库同一套引擎与输入；锁定态仅作模糊示意（非外制静态 Demo）。
   */
  const strategicMapPreviewReport = useMemo((): AdvancedAIReportData | null => {
    if (!decisionIntelInputReady || !platformDashboard) return null;
    const dateRange = formatDecisionIntelDateRangeZh(selectedWindowDays);
    return buildSimulatedAdvancedAIReport({
      topic: strategicMapTopic,
      dateRange,
      contentBlueprint: strategicMapBlueprint,
      platformData: { platform: decisionIntelPlatformHint },
      thinkingLevel: "HIGH",
      windowDays: selectedWindowDays,
    });
  }, [
    decisionIntelInputReady,
    platformDashboard,
    strategicMapTopic,
    strategicMapBlueprint,
    selectedWindowDays,
    decisionIntelPlatformHint,
  ]);

  /** 价格与历史报告始终可查，避免按钮无价、界面像故障或诱导 */
  const decisionIntelPricingQuery = trpc.mvAnalysis.getDecisionIntelligencePricing.useQuery(undefined, {
    enabled: isAuthenticated && !!platformDashboard && !!snapshot,
    staleTime: 60_000,
  });
  const decisionIntelLatestQuery = trpc.mvAnalysis.getLatestDecisionIntelligenceReport.useQuery(undefined, {
    enabled: isAuthenticated && !!platformDashboard && !!snapshot,
  });
  const generateDecisionIntelMutation = trpc.mvAnalysis.generateDecisionIntelligenceReport.useMutation({
    onSuccess: (data) => {
      toast.success("战略地图已解锁，报告已为您存档（未查看也会保留）");
      const bonusRaw = (data as { bonusExecutionBlueprints?: unknown[] }).bonusExecutionBlueprints ?? [];
      const bonus = mapBonusBlueprintsToExecutionCards(bonusRaw);
      setStrategicMapSessionExecutionCards((prev) => {
        const keptPicked = prev.filter((c) => c.isDecisionIntelPicked);
        return [...keptPicked, ...bonus];
      });
      if (bonus.length > 0) {
        toast.success(
          `已赠送 ${bonus.length} 条高契合战略选题文案（仅本次浏览可见，刷新页面后将不再显示，请当场保存或开拍）`,
          { duration: 8000 },
        );
      }
      void decisionIntelLatestQuery.refetch();
      void decisionIntelPricingQuery.refetch();
      const report = (data as { report?: AdvancedAIReportData })?.report ?? null;
      void saveCurrentPlatformSessionToMyWorksRef.current({
        titleSuffix: "战略全景解锁",
        toastOnSuccess: true,
        decisionIntelOverride: report,
      });
    },
    onError: (e) => toast.error(e.message || "解锁失败"),
  });

  const generateDecisionIntelTopicCopyMutation =
    trpc.mvAnalysis.generateDecisionIntelTopicExecutionCopy.useMutation({
      onError: (e) => toast.error(e.message || "战略选题文案扩写失败"),
    });
  const generatePlatformCustomMattingMutation =
    trpc.mvAnalysis.generatePlatformCustomMatting.useMutation({
      onError: (e) => toast.error(e.message || "自定义抠像生成失败"),
    });
  const unlockedStrategicReport = useMemo((): AdvancedAIReportData | null => {
    const fromLatest = decisionIntelLatestQuery.data?.report;
    const fromMut = generateDecisionIntelMutation.data?.report;
    const raw = fromLatest ?? fromMut;
    if (!raw || typeof raw !== "object") return null;
    return raw as AdvancedAIReportData;
  }, [decisionIntelLatestQuery.data?.report, generateDecisionIntelMutation.data?.report]);

  const handleExportStrategicDashboardPng = useCallback(async () => {
    const el = strategicReportDashboardRef.current;
    const report = unlockedStrategicReport;
    if (!el || !report) {
      toast.error("请先解锁报告后再导出");
      return;
    }
    setIsExportingStrategicPng(true);
    try {
      if (typeof document !== "undefined" && (document as any).fonts?.ready) {
        await (document as any).fonts.ready;
      }
      await new Promise((r) => setTimeout(r, 400));
      const dataUrl = await toPng(el, {
        pixelRatio: 2,
        backgroundColor: "#0B0F19",
        cacheBust: true,
      });
      const link = document.createElement("a");
      const rawTopic = String(report.topic || "decision-report").replace(/[\\/:*?"<>|]/g, "·");
      const safeTopic = rawTopic.slice(0, 48);
      link.download = `mvstudiopro-决策智库-${safeTopic}-${Date.now()}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("报告图已下载（PNG）");
      void saveCurrentPlatformSessionToMyWorksRef.current({
        titleSuffix: "战略全景PNG",
        toastOnSuccess: false,
        decisionIntelOverride: report,
      });
    } catch (e) {
      console.error(e);
      toast.error("导出图片失败，请稍后再试");
    } finally {
      setIsExportingStrategicPng(false);
    }
  }, [unlockedStrategicReport]);

  const recommendedPlatforms = useMemo(() => snapshot?.platformRecommendations.slice(0, 4) ?? [], [snapshot]);
  const actionSteps = useMemo(
    () => {
      if (platformDashboard?.actionCards && platformDashboard.actionCards.length > 0) {
        return platformDashboard.actionCards.map((item: any, index: number) => ({
          day: index + 1,
          title: cleanUserCopy(
            renderSafeText(item.title || item["动作"] || item["标题"] || ""),
            `第 ${index + 1} 步`,
          ),
          // Fix #5: pass "" as fallback — never show generic "先做一个可以快速拿到反馈的动作"
          action: cleanUserCopy(
            renderSafeText(item.detail || item.action || item["详情"] || item["建议"] || ""),
            "",
          ),
        }));
      }
      if (validationPlan.length) {
        return validationPlan.slice(0, 4).map((item, index) => ({
          day: index + 1,
          title: cleanUserCopy(item.label, `第 ${index + 1} 步`),
          action: cleanUserCopy(item.nextMove || item.successSignal, ""),
        }));
      }
      return (snapshot?.growthPlan.slice(0, 4) ?? []).map((item, index) => ({
        day: index + 1,
        title: cleanUserCopy(item.title, `第 ${index + 1} 步`),
        action: cleanUserCopy(item.action, ""),
      }));
    },
    [platformDashboard, snapshot, validationPlan],
  );
  const keyInsights = useMemo(
    () =>
      platformDashboard?.topSignals && platformDashboard.topSignals.length > 0
        ? platformDashboard.topSignals.map((item: any) => typeof item === "string"
            ? { title: item, detail: "", badge: "" }
            : { title: item.title || item["标题"] || item["核心判断"] || "", detail: item.detail || item.desc || item.description || item["详情"] || "", badge: item.badge || item["标签"] || "" })
        : (snapshot?.businessInsights.slice(0, 4).map((item) => ({
            title: item.title,
            detail: item.detail,
            badge: "结论",
          })) ?? []),
    [platformDashboard, snapshot],
  );
  const focusKeywords = useMemo(() => extractFocusKeywords(focusPrompt), [focusPrompt]);
  const personalizedSubject = useMemo(() => {
    if (focusKeywords.length) return focusKeywords.join(" / ");
    return topTopics[0]?.title || platformDashboard?.headline || "当前内容方向";
  }, [focusKeywords, platformDashboard, topTopics]);
  const recommendationHeadline = useMemo(() => {
    // Prefer LLM-generated headline first to avoid snapshot "电商带货" leaking here
    if (platformDashboard?.headline) return platformDashboard.headline;
    if (mainPath?.title) return cleanUserCopy(mainPath.title, mainPath.title);
    const topPlatform = recommendedPlatforms[0]?.name || "当前优先平台";
    return `围绕 ${personalizedSubject}，先把 ${topPlatform} 做透`;
  }, [mainPath, personalizedSubject, platformDashboard, recommendedPlatforms]);
  const hotQuestionSuggestions = useMemo(() => {
    const platformLead = topRecommendation?.name || recommendedPlatforms[0]?.name || "小红书";
    const topicLead = titleExecutions[0]?.title || topTopics[0]?.title || personalizedSubject;
    if (platformDashboard?.conversationStarters.length) return platformDashboard.conversationStarters.slice(0, 4);
    return [
      `如果我先发${platformLead}，围绕“${topicLead}”应该先做哪三个选题？`,
      `在${selectedWindowDays}天维度里，现在哪个平台最值得优先押注？`,
      `如果我只做图文，不做视频，围绕“${personalizedSubject}”应该怎么切入？`,
      `结合这轮趋势，${personalizedSubject} 最容易做成哪种商业承接？`,
    ];
  }, [personalizedSubject, platformDashboard, recommendedPlatforms, selectedWindowDays, titleExecutions, topRecommendation, topTopics]);

  const heroTrustPoints = useMemo(
    () => [
      { label: "交付内容", value: "选题、文案、封面与分镜脚本" },
      { label: "不含在内", value: "封面图、编导分镜图、MV Studio Pro AI 决策智库报告（均需另购）" },
      { label: "分析方式", value: `${getWindowLabel(selectedWindowDays)} 窗口 + 人物背景与诉求，不做泛建议` },
    ],
    [selectedWindowDays],
  );

  const resultSummaryCards = useMemo(() => {
    if (!snapshot) {
      return [
        { label: "你会拿到", value: "优先平台判断", detail: "不是平台百科，而是告诉你先打哪里" },
        { label: "你会拿到", value: "热点和赛道切口", detail: "把热点翻成可执行题目和表达方式" },
        { label: "你会拿到", value: "商业化承接建议", detail: "告诉你什么能接单、什么暂时别做" },
        { label: "你会拿到", value: "顾问式追问", detail: "继续问到形式、节奏、承接动作这一级" },
      ];
    }

    if (platformDashboard) {
      // If we have LLM analysis, prefer topSignals over snapshot
      const getSignal = (idx: number, fallbackValue: string, fallbackDetail: string) => {
        const signal: any = platformDashboard.topSignals[idx];
        if (!signal) return { value: fallbackValue, detail: fallbackDetail };
        if (typeof signal === "string") return { value: signal, detail: fallbackDetail };
        return {
          value: cleanUserCopy(signal.title || signal["标题"] || fallbackValue, fallbackValue),
          detail: cleanUserCopy(signal.detail || signal.desc || signal.description || signal["详情"] || fallbackDetail, fallbackDetail)
        };
      };

      const sig0 = getSignal(0, platformDashboard.headline || "先收口成一个明确方向", platformDashboard.subheadline || "先把最容易拿到反馈的平台和切口做透。");
      const menu0 = platformDashboard.platformMenu?.[0];
      const menuSnapHint =
        String(recommendedPlatforms[0]?.name ?? "").trim() ||
        String(primaryPlatforms[0]?.displayName ?? "").trim();
      const sig1 = getSignal(
        1,
        menu0 != null
          ? resolvePlatformMenuDisplayName(menu0 as Record<string, unknown>, 0, menuSnapHint || undefined)
          : platformMenuRankFallback(0),
        menu0?.whyNow || "先做最容易拿到正反馈的平台版本。",
      );
      
      const sig2 = getSignal(2, "先收口一个可承接方向", "把内容先做成有人愿意继续咨询或收藏的版本。");
      const sig3 = getSignal(3, "先写出第一条内容", "先做一轮验证，再决定是否放大。");

      const ipScarcity = (platformDashboard as any)?.ipScarcity;
      const trafficForecast = (platformDashboard as any)?.trafficForecast;
      const conversionRate = (platformDashboard as any)?.conversionRate;

      return [
        { label: "当前判断", value: sig0.value, detail: sig0.detail },
        { label: "优先平台", value: sig1.value, detail: sig1.detail },
        { label: "商业赛道", value: sig2.value, detail: sig2.detail, isLoadingSkeleton: (sig2 as any).isLoadingSkeleton },
        { label: "首发动作", value: sig3.value, detail: sig3.detail, isLoadingSkeleton: (sig3 as any).isLoadingSkeleton },
      ];
    }

    return [
      {
        label: "当前判断",
        value: cleanUserCopy(mainPath?.summary || snapshot.overview.summary, "先收口成一个明确方向"),
        detail: cleanUserCopy(mainPath?.whyNow || snapshot.overview.trendNarrative, "先把最容易拿到反馈的平台和切口做透。"),
      },
      {
        label: "优先平台",
        value: cleanUserCopy(topRecommendation?.name || recommendationHeadline, "先做当前优先平台"),
        detail: cleanUserCopy(topRecommendation?.reason || businessTranslation[0]?.detail || "先做最容易拿到正反馈的平台版本。", "先做最容易拿到正反馈的平台版本。"),
      },
      {
        label: "商业赛道",
        value: "专属变现路径分析中...",
        detail: "基于当前窗口热点重新推演，不使用往期模板...",
        isLoadingSkeleton: true,
      },
      {
        label: "首发动作",
        value: "首发具体动作推演中...",
        detail: "正在提取近期验证过的内容格式...",
        isLoadingSkeleton: true,
      },
    ];
  }, [
    businessTranslation,
    isContentLoading,
    mainPath,
    recommendationHeadline,
    snapshot,
    topRecommendation,
    platformDashboard,
    recommendedPlatforms,
    primaryPlatforms,
  ]);

  const platformDecisionRows = useMemo(
    () => {
      if (platformDashboard?.platformMenu.length) {
        return platformDashboard.platformMenu.slice(0, 4).map((item: any, index: number) => {
          // Keep raw objects — rendering code at referenceAccounts.map handles both string | {account,reason} polymorphically
          // DO NOT call .map(String) here — that converts {account,reason} objects to "[object Object]"
          const refs: any[] = Array.isArray(item.referenceAccounts) ? item.referenceAccounts : [];
          // Use renderSafeText to prevent [object Object] when Gemini returns nested objects
          const boosters = Array.isArray(item.trafficBoosters) ? item.trafficBoosters.map((b: any) => renderSafeText(b)) : [];
          const rSafe = (v: any) => renderSafeText(v);
          const snapshotNameHint =
            String(recommendedPlatforms[index]?.name ?? "").trim() ||
            String(primaryPlatforms[index]?.displayName ?? "").trim() ||
            String(platformActivities[index]?.platformLabel ?? "").trim();
          const menuLabel = resolvePlatformMenuDisplayName(
            item as Record<string, unknown>,
            index,
            snapshotNameHint || undefined,
          );
          // Extract blueOceanWords array from dashboard output
          const blueOceanRaw = item.blueOceanWords || item.blue_ocean_words || item["蓝海词"] || [];
          const blueOceanWords: string[] = Array.isArray(blueOceanRaw)
            ? blueOceanRaw.map((w: unknown) => renderSafeText(w)).filter(Boolean)
            : typeof blueOceanRaw === "string" && blueOceanRaw.trim()
            ? blueOceanRaw.split(/[,，、;；\n]+/).map((s) => s.trim()).filter(Boolean)
            : [];
          return {
            id: `${menuLabel}-${index}`,
            name: menuLabel,
            lane: cleanUserCopy(rSafe(item.lane || item.contentAngle || item["赛道"] || item["内容赛道"] || ""), menuLabel),
            trend: cleanUserCopy(rSafe(item.recommendedFormat || item.trend || item.format || item["内容形式"] || item["推荐形式"] || ""), "先从更顺手的表达方式切入"),
            whyNow: cleanUserCopy(rSafe(item.whyNow || item.reason || item.summary || item["为什么"] || item["推荐理由"] || ""), "当前窗口里，这个平台更容易拿到第一轮反馈。"),
            nextMove: cleanUserCopy(rSafe(item.titleExample || item.nextMove || item.action || item["标题示例"] || item["下一步"] || ""), "先发一版内容拿反馈。"),
            hook: cleanUserCopy(rSafe(item.contentHook || item.hook || item.nextMove || item["开头怎么说"] || item["开头钩子"] || ""), "先把第一句判断说出来。"),
            monetization: cleanUserCopy(rSafe(item.monetizationPath || item.monetization || item["商业承接路径"] || item["变现路径"] || ""), ""),
            referenceAccounts: refs,
            primaryTrack: item.primaryTrack || "",
            estimatedTraffic: item.estimatedTraffic || "",
            ipUniqueness: item.ipUniqueness || "",
            commercialConversion: item.commercialConversion || "",
            trafficBoosters: boosters,
            blueOceanWords,
          };
        });
      }

      // If we are loading the dashboard, return empty placeholders to avoid flashing generic snapshot data
      if (isDashboardLoading) {
        return [];
      }

      const rows = (snapshot?.platformRecommendations.length ? snapshot.platformRecommendations : recommendedPlatforms).slice(0, 4);
      return rows.map((item: GrowthPlatformRecommendation, index) => {
        const activity = platformActivities[index] as GrowthPlatformActivity | undefined;
        const platformSnapshot = primaryPlatforms[index];
        return {
          id: `${item.name}-${index}`,
          name: item.name,
          lane: cleanUserCopy(activity?.contentAngle || item.topicIdeas[0]?.title || platformSnapshot?.fitLabel || "先做与你当前身份更匹配的表达方向", "先做与你当前身份更匹配的表达方向"),
          trend: cleanUserCopy(activity?.recommendedFormat || item.playbook || `动量 ${platformSnapshot?.momentumScore || 0} / 适配 ${platformSnapshot?.audienceFitScore || 0}`, "先用更适合的平台内容形式启动"),
          whyNow: cleanUserCopy(item.reason || activity?.summary || platformSnapshot?.summary || "这个平台更适合你当前这轮内容验证。", "这个平台更适合你当前这轮内容验证。"),
          nextMove: cleanUserCopy(item.action || activity?.optimizationPlan || validationPlan[index]?.nextMove || "正在推演专属于你的行动建议...", "正在推演专属于你的行动建议..."),
          hook: cleanUserCopy(titleExecutions[index]?.openingHook || titleExecutions[index]?.copywriting || "", ""),
          monetization: cleanUserCopy(monetizationStrategies[index]?.primaryTrack || "", ""),
          referenceAccounts: [] as string[],
          primaryTrack: "",
          estimatedTraffic: "",
          ipUniqueness: "",
          commercialConversion: "",
          trafficBoosters: [] as string[],
        };
      });
    },
    [
      isDashboardLoading,
      monetizationStrategies,
      platformActivities,
      platformDashboard,
      primaryPlatforms,
      recommendedPlatforms,
      snapshot,
      titleExecutions,
      validationPlan,
    ],
  );

  const monetizationCards = useMemo(() => {
    try {
      // Data normalizer: maps Gemini raw item → clean { revenueModes: string[] } shape
      // Handles: missing key, Chinese key, string-instead-of-array type drift
      const normalizeMonetizationItem = (it: any) => {
        const rawRev =
          it?.revenueModes ||
          it?.["商业承接路径"] ||
          it?.["商业化路径"] ||
          it?.["变现路径"] ||
          it?.["变现方式"] ||
          it?.revenue_modes;
        const normalizedRev: string[] = Array.isArray(rawRev)
          ? rawRev.map((r) => renderSafeText(r))
          : typeof rawRev === "string" && rawRev.trim()
          ? [rawRev]
          : [];
        return { ...it, revenueModes: normalizedRev };
      }

      // Prefer Call 3 result, fall back to Call 2
      const rawLanes =
        Array.isArray(platformContent?.monetizationLanes) && platformContent!.monetizationLanes.length > 0
          ? platformContent!.monetizationLanes
          : Array.isArray(platformDashboard?.monetizationLanes) && platformDashboard!.monetizationLanes.length > 0
          ? platformDashboard!.monetizationLanes
          : null;

      const monetizationSource = rawLanes ? rawLanes.map(normalizeMonetizationItem) : null;

      if (monetizationSource && monetizationSource.length > 0) {
        return monetizationSource.slice(0, 2).map((item: any, index: number) => {
          // Task II: Support laneName / feasibility / actionItem keys from strict JSON template
          const title = item.title || item.laneName || item["变现方向名"] || item["标题"] || "";
          const summary = item.fitReason || item.feasibility || item.summary || item["为什么适合此人设"] || "";
          const actionPieces = [
            item.offerShape || item["交付形态"],
            ...item.revenueModes,
            item.firstValidation || item.actionItem || item["第一步如何做轻量验证"]
          ];
          return {
            id: `${title || index}-${index}`,
            title: cleanUserCopy(renderSafeText(title, `变现路径 ${index + 1}`), `变现路径 ${index + 1}`),
            summary: cleanUserCopy(renderSafeText(summary), ""),
            action: cleanUserCopy(
              actionPieces.map((p) => renderSafeText(p)).filter(Boolean).join(" / "),
              ""
            ),
          };
        });
      }

      if (isDashboardLoading || isContentLoading || platformDashboard || platformContent) {
        return [];
      }

      // If Call 3 is loading or completed, only show real LLM data.
      // 绝对禁止 fallback 到 snapshot 里的写死内容，避免泄漏"电商带货"
      return [];
    } catch (err) {
      console.error("[monetizationCards] render error:", err);
      return [];
    }
  }, [platformContent, platformDashboard]);

  const contentExecutionCards = useMemo((): PlatformContentExecutionCard[] => {
    // Prefer Call 3 result, fall back to Call 2
    const blueprintsSource =
      Array.isArray(platformContent?.contentBlueprints) && platformContent!.contentBlueprints.length > 0
        ? platformContent!.contentBlueprints
        : Array.isArray(platformDashboard?.contentBlueprints) && platformDashboard!.contentBlueprints.length > 0
        ? platformDashboard!.contentBlueprints
        : null;
    if (blueprintsSource && blueprintsSource.length > 0) {
      return blueprintsSource.map((item: Record<string, unknown>, index: number) =>
        mapContentBlueprintToExecutionCard(item, index),
      );
    }

    // Once LLM analysis is in flight or complete, refuse snapshot fallbacks to prevent generic text leaking.
    // Show loading state via empty array — the JSX layer handles the spinner.
    if (isContentLoading || isDashboardLoading || platformDashboard || platformContent) {
      return [];
    }

    // Pre-analysis state only: show snapshot topics as preview placeholders
    return topTopics.slice(0, 4).map((item, index) => {
      const baseTitleRaw = item.title;
      const hookRaw = item.howToUse;
      const copyRaw = item.whyHot;
      const titleVariants = resolveExecutionCardTitleVariants(
        { title: baseTitleRaw, hook: hookRaw, copywriting: copyRaw },
        baseTitleRaw,
        hookRaw,
        copyRaw,
        index,
      );
      const baseTitle = cleanUserCopy(
        titleVariants[0]?.title || baseTitleRaw,
        `内容方案 ${index + 1}`,
      );
      return {
        id: String((item as { id?: string; sceneId?: string }).id || (item as { sceneId?: string }).sceneId || `topic-${index}`),
        title: baseTitle,
        hook: cleanUserCopy(item.howToUse, "先把用户最关心的问题直接说出来。"),
        copywriting: cleanUserCopy(item.whyHot, "围绕这个切口写成用户能立刻代入的内容。"),
        production: "",
        format: recommendedPlatforms[index]?.topicIdeas?.[0] ? "短视频" : "图文",
        suitablePlatforms: [],
        actionableSteps: [],
        detailedScript: "",
        publishingAdvice: "",
        executionDetails: {
          environmentAndWardrobe: "",
          lightingAndCamera: "",
          stepByStepScript: [],
        },
        titleVariants,
        storyboardCells: [],
      };
    });
  }, [isContentLoading, isDashboardLoading, platformDashboard, platformContent, recommendedPlatforms, topTopics]);

  const visibleExecutionCards = useMemo(() => {
    const byKey = new Map<string, PlatformContentExecutionCard>();
    for (const card of contentExecutionCards) {
      byKey.set(normalizeDecisionIntelTopicTitleKey(card.title), card);
    }
    for (const card of strategicMapSessionExecutionCards) {
      byKey.set(normalizeDecisionIntelTopicTitleKey(card.title), card);
    }
    return Array.from(byKey.values());
  }, [contentExecutionCards, strategicMapSessionExecutionCards]);

  /** 将当前平台页全案状态打包写入「我的作品」 */
  const saveCurrentPlatformSessionToMyWorks = useCallback(
    async (opts?: {
      titleSuffix?: string;
      toastOnSuccess?: boolean;
      decisionIntelOverride?: AdvancedAIReportData | null;
    }) => {
      try {
        const gmt8Label = new Date().toLocaleDateString("zh-TW", {
          timeZone: "Asia/Shanghai",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        });
        const cards = (visibleExecutionCards || []).slice(0, 24).map((card) => ({
          id: card.id,
          title: card.title,
          hook: card.hook,
          copywriting: card.copywriting,
          format: card.format,
          detailedScript: card.detailedScript,
          publishingAdvice: card.publishingAdvice,
          suitablePlatforms: card.suitablePlatforms,
          highlightKeywords: card.highlightKeywords,
          executionDetails: card.executionDetails,
          coverImageUrl: platformImageMap[card.id] || null,
          storyboardImageUrl:
            platformStoryboardSheetMap[card.id] ||
            (platformImageMap[`${card.id}:storyboard`] as string | undefined) ||
            null,
        }));
        const thumb =
          cards.map((c) => c.coverImageUrl).find(Boolean) ||
          cards.map((c) => c.storyboardImageUrl).find(Boolean) ||
          undefined;
        const title = `平台全案 · ${gmt8Label}${opts?.titleSuffix ? ` · ${opts.titleSuffix}` : ""}`;
        const res = await savePlatformSessionBundleMutation.mutateAsync({
          title: title.slice(0, 200),
          thumbnailUrl: typeof thumb === "string" && thumb.startsWith("http") ? thumb : undefined,
          windowDays: selectedWindowDays,
          platformDashboard: platformDashboard
            ? (platformDashboard as unknown as Record<string, unknown>)
            : null,
          platformContent: platformContent
            ? {
                contentBlueprints: platformContent.contentBlueprints?.slice(0, 12) ?? [],
                monetizationLanes: platformContent.monetizationLanes?.slice(0, 8) ?? [],
              }
            : null,
          visualReport: visualReportData
            ? (visualReportData as unknown as Record<string, unknown>)
            : null,
          decisionIntelReport:
            opts?.decisionIntelOverride !== undefined
              ? opts.decisionIntelOverride
              : unlockedStrategicReport ?? null,
          executionCards: cards,
          deepQa: askResult
            ? {
                question: askResult.title,
                answer: [askResult.answer, askResult.encouragement].filter(Boolean).join("\n\n"),
                askedAt: new Date().toISOString(),
              }
            : null,
          customCopy: customOptimizeResult || customNoteText || null,
          customTopicProtagonist: customTopicProtagonist || null,
        });
        if (opts?.toastOnSuccess !== false) {
          toast.success(res.id ? `已保存至「我的作品」（#${res.id}）` : "已保存至「我的作品」");
        }
        return res;
      } catch (e) {
        console.warn("[PlatformPage] savePlatformSessionBundle failed:", e);
        toast.error(e instanceof Error ? e.message : "保存作品包失败");
        return null;
      }
    },
    [
      askResult,
      customNoteText,
      customOptimizeResult,
      customTopicProtagonist,
      platformContent,
      platformDashboard,
      platformImageMap,
      platformStoryboardSheetMap,
      savePlatformSessionBundleMutation,
      selectedWindowDays,
      unlockedStrategicReport,
      visibleExecutionCards,
      visualReportData,
    ],
  );
  saveCurrentPlatformSessionToMyWorksRef.current = saveCurrentPlatformSessionToMyWorks;

  const visibleExecutionCardsKey = useMemo(
    () => visibleExecutionCards.map((c) => c.id).join("|"),
    [visibleExecutionCards],
  );

  const contentExecutionCardsKey = useMemo(
    () => contentExecutionCards.map((c) => c.id).join("|"),
    [contentExecutionCards],
  );

  useEffect(() => {
    const validIds = new Set(visibleExecutionCards.map((row) => row.id));
    setPlatformStoryboardSheetMap((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => validIds.has(key))),
    );
    setPlatformXhsNoteMap((prev) =>
      Object.fromEntries(Object.entries(prev).filter(([key]) => validIds.has(key))),
    );
    setCompositeLoadRetriedKeys((prev) => {
      const next = new Set<string>();
      prev.forEach((key) => {
        const sceneId = key.split("::")[0];
        if (validIds.has(sceneId)) next.add(key);
      });
      return next;
    });
  }, [visibleExecutionCards, visibleExecutionCardsKey]);

  const executionSnapshotSyncKeyRef = useRef("");
  useEffect(() => {
    if (!isAuthenticated || visibleExecutionCards.length === 0) return;
    const key = visibleExecutionCardsKey;
    if (executionSnapshotSyncKeyRef.current === key) return;
    executionSnapshotSyncKeyRef.current = key;
    const blueprints = visibleExecutionCards.map(executionCardToSnapshotBlueprint);
    void syncPlatformExecutionBlueprintsSnapshotMutation
      .mutateAsync({ contentBlueprints: blueprints })
      .catch((err) => {
        executionSnapshotSyncKeyRef.current = "";
        console.warn("[platform] execution snapshot sync failed:", err);
      });
  }, [
    isAuthenticated,
    visibleExecutionCards,
    visibleExecutionCardsKey,
    syncPlatformExecutionBlueprintsSnapshotMutation,
  ]);

  const platformTopicCount = visibleExecutionCards.length;
  const platformBulkGraphicCost = useMemo(
    () => platformCoverBundleTotalCredits(platformTopicCount),
    [platformTopicCount],
  );
  const platformBulkCompositeCost = useMemo(
    () => platformCompositeBundleTotalCreditsForGrid(platformTopicCount, compositeGridVariant === "3x4"),
    [platformTopicCount, compositeGridVariant],
  );
  const platformBulkCoverCompositeCost = useMemo(
    () =>
      platformCoverCompositeBulkBundleTotalCreditsForGrid(
        visibleExecutionCards,
        compositeGridVariant === "3x4",
      ),
    [visibleExecutionCards, compositeGridVariant],
  );
  /** 一键 2×4 合成：短影音向（分镜主表）vs 图文/小红书（八格）条数，用于展示合计积分由来 */
  const platformBulkCompositeBreakdown = useMemo(() => {
    let videoLike = 0;
    let graphicLike = 0;
    for (const row of visibleExecutionCards) {
      const isGraphic = row.format === "图文" || row.format === "小红书";
      if (isGraphic) graphicLike++;
      else videoLike++;
    }
    return { videoLike, graphicLike };
  }, [visibleExecutionCards]);

  /** 全案选题一键：依次为每条生成 2×4 分镜或八格（四题为套装总价；否则按单条价累加） */
  function onBulkCompositeOneClick() {
    if (!isAuthenticated) {
      toast.error("请先登录");
      return;
    }
    const bulkIs3x4 = compositeGridVariant === "3x4";
    const bulkUnit = bulkIs3x4 ? 108 : 54;
    const note = supervisorAccess
      ? ""
      : `将为 ${platformTopicCount} 个选题依次各生成一张${bulkIs3x4 ? " 3×4 十二格" : " 2×4"}分镜或小红书${bulkIs3x4 ? "十二格" : "八格"}图文。套装价 **${bulkUnit}×${platformTopicCount}=${platformBulkCompositeCost} 积分**${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}（散买单条短视频 ${bulkIs3x4 ? CREDIT_COSTS.platformStoryboardSheet3x4 : CREDIT_COSTS.platformStoryboardSheet}、图文/小红书 ${bulkIs3x4 ? CREDIT_COSTS.platformXhsDualNote3x4 : CREDIT_COSTS.platformXhsDualNote}）。每条约 3～5 分钟。是否继续？`;
    if (!supervisorAccess && !window.confirm(note)) return;
    void runSequentialCompositeBatchGeneration();
  }

  async function runSequentialCoverCompositeBundleBatchGeneration() {
    const cards = visibleExecutionCards;
    const localOpId = `batch-cover-composite-bundle-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    setIsSequentialCoverCompositeBundleBatchGenerating(true);
    setPlatformImageGenFlowSnapshots((prev) =>
      upsertPlatformImageFlowSnapshot(prev, {
        at: new Date().toISOString(),
        kind: "batch_cover_composite_bundle",
        lines: [
          `${new Date().toISOString()}  [客户端] 选题套装已发起 · topicCount=${cards.length} · 封面+分镜九折按条计价 · worker 内封面与 2×4 并发`,
          `${new Date().toISOString()}  [等待中] 客户端逐题串行 · 单题常需约 3～5 分钟`,
        ],
        meta: {
          localOpId,
          platformType: "cover_composite_bundle",
          topicCount: cards.length,
          concurrency: 1,
          pending: true,
        },
      }),
    );
    let successCount = 0;
    const liveLines: string[] = [];
    try {
      for (const item of cards) {
        const headlineTitle = item.title;
        const isGraphicFormat = item.format === "图文" || item.format === "小红书";
        const compositeKind = isGraphicFormat ? "xiaohongshu_dual_note" : "storyboard_sheet_landscape";
        const coverPersona = buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim();
        liveLines.push(
          `${new Date().toISOString()}  [客户端] 开始套装 · sceneId=${item.id} · compositeKind=${compositeKind}`,
        );
        setPlatformImageGenFlowSnapshots((prev) =>
          upsertPlatformImageFlowSnapshot(prev, {
            at: new Date().toISOString(),
            kind: "batch_cover_composite_bundle",
            lines: [
              ...liveLines,
              `${new Date().toISOString()}  [等待中] ${item.id}`,
            ],
            meta: {
              localOpId,
              platformType: "cover_composite_bundle",
              topicCount: cards.length,
              concurrency: 1,
              currentSceneId: item.id,
              successCount,
              pending: true,
            },
          }),
        );
        try {
          const res = await runThrottledPlatformImageRequest(
            `cover-composite-bundle:${item.id}`,
            () =>
              runEnqueueTopicCoverCompositeBundleAndPoll({
                sceneId: item.id,
                coverPersonaContext: coverPersona || undefined,
                headlineTitle,
                compositeKind,
                scriptContext: buildPlatformSheetScriptContext(item as any, {
                  shootingTechniqueBrief:
                    compositeKind === "xiaohongshu_dual_note"
                      ? undefined
                      : lastShootingTechniqueBriefRef.current.trim() || undefined,
                  gridVariant: compositeGridVariant,
                  sheetKind: compositeKind === "xiaohongshu_dual_note" ? "graphic" : "storyboard",
                }),
                executionDetails: buildPlatformExecutionDetailsPayload(item as any),
                shootingTechniqueBrief: lastShootingTechniqueBriefRef.current.trim() || undefined,
                gridVariant: compositeGridVariant,
                pollDebugLabel: `套装批量 · ${item.id}`,
                referencePhotoUrl: resolveReferencePhotoForScene(item.id),
                compositeImageEngine: resolveReferencePhotoForScene(item.id)
                  ? "gpt_image2"
                  : platformComposite2x4Engine,
              }),
            (waitMs) => {
              liveLines.push(
                `${new Date().toISOString()}  [客户端] 节流等待 ${Math.ceil(waitMs / 1000)} 秒 · 滚动 ${PLATFORM_IMAGE_RATE_WINDOW_MS / 1000}s 内已排满 ${PLATFORM_IMAGE_MAX_STARTS_PER_60S} 次发起 · sceneId=${item.id}`,
              );
              setPlatformImageGenFlowSnapshots((prev) =>
                upsertPlatformImageFlowSnapshot(prev, {
                  at: new Date().toISOString(),
                  kind: "batch_cover_composite_bundle",
                  lines: [...liveLines],
                  meta: {
                    localOpId,
                    platformType: "cover_composite_bundle",
                    topicCount: cards.length,
                    concurrency: 1,
                    currentSceneId: item.id,
                    successCount,
                    pending: true,
                  },
                }),
              );
            },
          );
          const coverOut = String(res.imageUrl ?? "").trim();
          const compUrl = String(res.compositeImageUrl ?? "").trim();
          const flowTail = Array.isArray(res.imageGenFlowLog) ? res.imageGenFlowLog : [];
          if (flowTail.length > 0) {
            liveLines.push(`${new Date().toISOString()}  [当前步骤] ${flowTail[flowTail.length - 1]}`);
          }
          if (res.success && coverOut && compUrl && res.compositeKind) {
            successCount += 1;
            setPlatformImageMap((prev) => ({ ...prev, [item.id]: coverOut }));
            if (res.creationId != null) {
              setSceneJobIds((prev) => ({ ...prev, [item.id]: String(res.creationId) }));
            }
            const ctr = parseCoverClickEstimate(res.coverClickEstimate);
            if (ctr) {
              setPlatformCoverCtrBySceneId((prev) => ({ ...prev, [item.id]: ctr }));
            }
            if (
              res.compositeKind === "storyboard_sheet_portrait" ||
              res.compositeKind === "storyboard_sheet_landscape"
            ) {
              setPlatformStoryboardSheetMap((p) => ({ ...p, [item.id]: compUrl }));
            } else if (res.compositeKind === "xiaohongshu_dual_note") {
              setPlatformXhsNoteMap((p) => ({ ...p, [item.id]: compUrl }));
            }
            liveLines.push(`${new Date().toISOString()}  ✓ 套装完成 · sceneId=${item.id}`);
          } else {
            liveLines.push(`${new Date().toISOString()}  ✗ 套装输出不完整 · sceneId=${item.id}`);
          }
        } catch (err) {
          liveLines.push(
            `${new Date().toISOString()}  ✗ 套装异常 · sceneId=${item.id} · ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } finally {
      setIsSequentialCoverCompositeBundleBatchGenerating(false);
      setPlatformImageGenFlowSnapshots((prev) =>
        upsertPlatformImageFlowSnapshot(prev, {
          at: new Date().toISOString(),
          kind: "batch_cover_composite_bundle",
          lines: [
            ...liveLines,
            `${new Date().toISOString()}  [客户端] 选题套装批量结束 · success=${successCount}/${cards.length}`,
          ],
          meta: {
            localOpId,
            platformType: "cover_composite_bundle",
            topicCount: cards.length,
            concurrency: 1,
            successCount,
            pending: false,
          },
        }),
      );
      toast.success(`已为 ${successCount}/${cards.length} 个选题完成封面加分镜`);
    }
  }

  function onBulkCoverCompositeBundleOneClick() {
    if (!isAuthenticated) {
      toast.error("请先登录");
      return;
    }
    const bundleIs3x4 = compositeGridVariant === "3x4";
    const note = supervisorAccess
      ? ""
      : `将为 ${platformTopicCount} 个选题依次生成封面 +${bundleIs3x4 ? " 3×4 十二格" : " 2×4/八格"}，合计 ${platformBulkCoverCompositeCost} 积分${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}（按每条体裁：封面 48 + 分镜 ${bundleIs3x4 ? "120/144" : "60/72"} 后打九折）。是否继续？`;
    if (!supervisorAccess && !window.confirm(note)) return;
    void runSequentialCoverCompositeBundleBatchGeneration();
  }

  const coverGenWaitCarouselItems = useMemo((): CoverGenWaitCarouselItem[] => {
    return visibleExecutionCards.map((c) => {
      const hook = (c.hook || "").replace(/\s+/g, " ").trim();
      const body = (c.copywriting || "").replace(/\s+/g, " ").trim();
      const pick = hook.length >= 48 ? hook : body.length >= 24 ? body : hook || body;
      const excerptRaw = pick;
      const excerpt =
        excerptRaw.length > 260 ? `${excerptRaw.slice(0, 260)}…` : excerptRaw;
      return {
        id: c.id,
        title: (c.title || "").trim(),
        excerpt,
      };
    });
  }, [visibleExecutionCards]);

  const coverGenWaitCarouselItemsKey = useMemo(
    () => coverGenWaitCarouselItems.map((row) => row.id).join("|"),
    [coverGenWaitCarouselItems],
  );

  const anyCoverImagePipelineBusy = useMemo(
    () =>
      isSequentialCoverBatchGenerating ||
      isSequentialCoverCompositeBundleBatchGenerating ||
      coverCompositeBundleSceneId !== null ||
      batchGeneratingCoverIds.size > 0 ||
      coverSilentRetryIds.size > 0,
    [
      isSequentialCoverBatchGenerating,
      isSequentialCoverCompositeBundleBatchGenerating,
      coverCompositeBundleSceneId,
      batchGeneratingCoverIds,
      coverSilentRetryIds,
    ],
  );

  /** 出图（2×4 / 3×4 合成）阶段忙碌：等待动效需覆盖封面阶段 + 出图阶段。 */
  const anyCompositeOutputBusy = useMemo(
    () => compositeMutationBusy || isSequentialCompositeBatchGenerating,
    [compositeMutationBusy, isSequentialCompositeBatchGenerating],
  );

  const allTopicCoverImagesReady = useMemo(() => {
    if (visibleExecutionCards.length === 0) return true;
    return visibleExecutionCards.every((row) => {
      const u = platformImageMap[row.id];
      return typeof u === "string" && u.trim().length > 0 && !platformCoverImageUrlLooksInvalid(u);
    });
  }, [visibleExecutionCards, platformImageMap]);

  useEffect(() => {
    if (anyCoverImagePipelineBusy || anyCompositeOutputBusy) setCoverWaitCarouselEngaged(true);
  }, [anyCoverImagePipelineBusy, anyCompositeOutputBusy]);

  useEffect(() => {
    // 封面已就绪且出图阶段也已结束，才收起等待动效。
    if (!coverWaitCarouselEngaged || !allTopicCoverImagesReady || anyCompositeOutputBusy) return;
    setCoverWaitCarouselEngaged(false);
  }, [coverWaitCarouselEngaged, allTopicCoverImagesReady, anyCompositeOutputBusy]);

  /** 顶部「2×4 / 3×4 / 小红书合成」画廊：各选题合成 URL / pending（Grid + ImageUpscaleBar） */
  const referenceStoryboardGraphicStrip = useMemo(() => {
    type StripItem = {
      key: string;
      sceneId: string;
      title: string;
      url: string | null;
      kindLabel: string;
      layout: "portrait" | "landscape";
      pending: boolean;
    };
    const items: StripItem[] = [];
    const pend = pendingCompositeSheet;
    const is3x4 = compositeGridVariant === "3x4";
    const sbLabel = is3x4 ? "编导分镜 · 3×4 十二格合成" : "编导分镜 · 2×4 合成";
    const xhsLabel = is3x4 ? "小红书 · 3×4 十二格图文" : "小红书 · 2×4 八格图文";
    for (const row of visibleExecutionCards) {
      const id = row.id;
      const title = row.title;
      const sbUrl = platformStoryboardSheetMap[id];
      if (sbUrl) {
        items.push({
          key: `${id}-sb-sheet`,
          sceneId: id,
          title,
          url: sbUrl,
          kindLabel: sbLabel,
          layout: "landscape",
          pending: false,
        });
      } else if (
        pend?.sceneId === id &&
        (pend.kind === "storyboard_sheet_portrait" || pend.kind === "storyboard_sheet_landscape")
      ) {
        items.push({
          key: `${id}-sb-sheet-pend`,
          sceneId: id,
          title,
          url: null,
          kindLabel: sbLabel,
          layout: "landscape",
          pending: true,
        });
      }
      const xhsUrl = platformXhsNoteMap[id];
      if (xhsUrl) {
        items.push({
          key: `${id}-xhs-sheet`,
          sceneId: id,
          title,
          url: xhsUrl,
          kindLabel: xhsLabel,
          layout: "landscape",
          pending: false,
        });
      } else if (pend?.sceneId === id && pend.kind === "xiaohongshu_dual_note") {
        items.push({
          key: `${id}-xhs-sheet-pend`,
          sceneId: id,
          title,
          url: null,
          kindLabel: xhsLabel,
          layout: "landscape",
          pending: true,
        });
      }
    }
    return items;
  }, [
    visibleExecutionCards,
    platformStoryboardSheetMap,
    platformXhsNoteMap,
    pendingCompositeSheet,
    compositeGridVariant,
  ]);

  // 分镜图独立导出（原始整图 URL，不经 PDF、不会被分页截断）
  const [isExportingStoryboardSheets, setIsExportingStoryboardSheets] = useState(false);
  const storyboardSheetDownloadItems = useMemo(
    () => referenceStoryboardGraphicStrip.filter((it) => !!it.url),
    [referenceStoryboardGraphicStrip],
  );
  const downloadSingleImageFile = useCallback(async (url: string, filename: string) => {
    try {
      const res = await fetch(url, { mode: "cors", cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objectUrl), 4000);
      return true;
    } catch {
      // CORS/网络失败兜底：新标签打开，用户可右键/长按保存（仍是原图、无截断）
      try {
        window.open(url, "_blank", "noopener,noreferrer");
      } catch {
        /* ignore */
      }
      return false;
    }
  }, []);
  const buildStoryboardSheetFilename = useCallback((item: { key: string; title: string }, index: number) => {
    const safeTitle = (item.title || "编导分镜").replace(/[\\/:*?"<>|]+/g, "").slice(0, 24);
    const kindTag = item.key.includes("xhs")
      ? compositeGridVariant === "3x4"
        ? "小红书十二格图文"
        : "小红书八格图文"
      : compositeGridVariant === "3x4"
        ? "编导分镜3x4"
        : "编导分镜2x4";
    return `mvstudiopro-${kindTag}-${safeTitle}-${index + 1}.png`;
  }, [compositeGridVariant]);
  const handleExportAllStoryboardSheets = useCallback(async () => {
    const items = storyboardSheetDownloadItems;
    if (items.length === 0) {
      toast.error("暂无可导出的编导分镜图");
      return;
    }
    setIsExportingStoryboardSheets(true);
    let ok = 0;
    let fallback = 0;
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!;
      const success = await downloadSingleImageFile(it.url as string, buildStoryboardSheetFilename(it, i));
      if (success) ok++;
      else fallback++;
      // 间隔，避免浏览器拦截连续多文件下载
      await new Promise((r) => setTimeout(r, 450));
    }
    setIsExportingStoryboardSheets(false);
    if (fallback === 0) toast.success(`已导出全部 ${ok} 张编导分镜图`);
    else toast.message(`已导出 ${ok} 张，另有 ${fallback} 张已在新标签打开，可右键/长按保存原图`);
  }, [storyboardSheetDownloadItems, downloadSingleImageFile, buildStoryboardSheetFilename]);

  const evidenceNotes = useMemo(() => {
    if (!snapshot) {
      return [
        "分析按 15 天 / 30 天 / 45 天三种窗口切开看，不把短期噪音和中期趋势混在一起。",
        "输出重点是先做哪个平台、切哪条赛道、怎样承接商业价值。",
        "追问继续基于本轮分析，不会把问题重新打回泛泛的平台介绍。",
      ];
    }
    return [
      ...materialFacts.slice(0, 2).map((item) => cleanUserCopy(item.detail, "")),
      cleanUserCopy(businessTranslation[0]?.detail || audienceTriggers[0]?.reason || "", ""),
    ].filter(Boolean);
  }, [audienceTriggers, businessTranslation, materialFacts, snapshot]);

  const directConclusion = useMemo(
    () => cleanUserCopy(platformDashboard?.subheadline || mainPath?.whyNow || snapshot?.overview.trendNarrative || "", "先把最值得验证的一条内容路线做透。"),
    [mainPath, platformDashboard, snapshot],
  );

  const personaSummary = useMemo(
    () =>
      cleanUserCopy(
        platformDashboard?.personaSummary || "",
        "在「自定义创作」选题初选上方填写人物背景与创作诉求（与全案共用）；结合近窗口 trendStore 样本，给出可挑选的选题与可落地建议。",
      ),
    [platformDashboard],
  );

  /** 全局主人公照片：扩写区与编导区共用同一份状态，禁止只藏在下方 */
  const renderGlobalProtagonistPhotoBlock = (opts?: { className?: string }) => (
    <div
      className={
        opts?.className ??
        "rounded-xl border border-[#c4b5fd]/35 bg-[#6a5cff]/10 px-4 py-3"
      }
    >
      <div className="flex flex-wrap items-start gap-3">
        {globalCoverReferencePhotoUrl ? (
          <img
            src={globalCoverReferencePhotoUrl}
            alt="全局主人公"
            className="h-14 w-14 shrink-0 rounded-lg object-cover ring-1 ring-[#c4b5fd]/50"
          />
        ) : (
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-[#c4b5fd]/40 text-[#c4b5fd]/70">
            <UserRound className="h-5 w-5" aria-hidden />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-white">全局主人公照片（出图前先上传）</div>
          <p className="mt-0.5 text-[11px] leading-snug text-gray-400">
            套用全部选题的封面、编导分镜表与图文笔记解说人物：
            <strong className="text-white/80">锁脸</strong>
            ，衣着可随场景微调。单卡可另传照片覆盖。封面失败时也靠这张脸继续出分镜。
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <label
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-[#6a5cff]/45 bg-[#6a5cff]/20 px-2.5 py-1.5 text-[11px] font-bold text-[#c4b5fd] transition hover:bg-[#6a5cff]/30 ${
                globalCoverRefUploading ? "cursor-wait opacity-70" : ""
              }`}
            >
              {globalCoverRefUploading ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  上传中…
                </>
              ) : (
                <>
                  <UserRound className="h-3 w-3" aria-hidden />
                  {globalCoverReferencePhotoUrl ? "更换全局照片" : "上传全局主人公照片"}
                </>
              )}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={globalCoverRefUploading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void handleUploadGlobalCoverReferencePhoto(f);
                }}
              />
            </label>
            {globalCoverReferencePhotoUrl ? (
              <button
                type="button"
                onClick={() => setGlobalCoverReferencePhotoUrl(null)}
                className="rounded-md border border-white/15 px-2 py-1 text-[10px] font-medium text-gray-400 transition hover:border-white/30 hover:text-gray-200"
              >
                移除
              </button>
            ) : null}
          </div>
          <p className="mt-1.5 text-[10px] leading-tight text-amber-300/70">
            请仅上传本人或已获授权人物的照片（着装得体、成年）；请勿上传他人、未成年或不雅照片。
          </p>
        </div>
      </div>
    </div>
  );

  /**
   * 全案「就写这条」扩写结果：文案 + 旧 Stage2 同套出图接线（一键套装 / 仅封面 / 分镜或图文）。
   * 必须挂在选题列表正下方，禁止只留「去下方」空链。
   */
  const renderExpandedShortlistGenZone = (domId: string) => {
    const bps = Array.isArray(platformContent?.contentBlueprints)
      ? (platformContent!.contentBlueprints as Array<Record<string, unknown>>)
      : [];
    if (bps.length === 0) return null;
    const cards = bps.map((bp, bi) => mapContentBlueprintToExecutionCard(bp, bi));
    const genBusy =
      isSequentialCoverBatchGenerating ||
      isSequentialCompositeBatchGenerating ||
      isSequentialCoverCompositeBundleBatchGenerating ||
      compositeMutationBusy ||
      coverCompositeBundleSceneId !== null ||
      isDashboardLoading ||
      isContentLoading;

    return (
      <div
        id={`${domId}-expanded`}
        className="mt-5 scroll-mt-24 rounded-2xl border border-emerald-400/40 bg-[rgba(16,185,129,0.1)] px-4 py-4"
      >
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-lg font-bold text-white sm:text-xl">
            <Sparkles className="h-5 w-5 shrink-0 text-emerald-300" />
            专属选题与文案 · {cards.length} 条
          </div>
          <p className="mt-1 text-[12px] leading-snug text-emerald-100/70">
            先上传主人公照片锁脸，再出封面 / 编导分镜或图文。文案与出图同页，刷新可恢复。
          </p>
        </div>

        {cards.length > 0 ? (
          <div className="mt-3 space-y-3">
            {renderGlobalProtagonistPhotoBlock()}
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap">
              <button
                type="button"
                disabled={genBusy || !isAuthenticated}
                onClick={() => {
                  if (!isAuthenticated) {
                    toast.error("请先登录");
                    return;
                  }
                  const scenes = cards.map((row) => ({ id: row.id }));
                  const discountNote = supervisorAccess
                    ? ""
                    : `将为您一次性生成 ${cards.length} 个选题的竖版封面（套装 40×${cards.length}=${platformCoverBundleTotalCredits(cards.length)} 积分${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}）。是否继续？`;
                  if (!supervisorAccess && !window.confirm(discountNote)) return;
                  void (async () => {
                    try {
                      await syncPlatformExecutionBlueprintsSnapshotMutation.mutateAsync({
                        contentBlueprints: cards.map(executionCardToSnapshotBlueprint),
                      });
                      await runSequentialCoverBatchGeneration(
                        scenes,
                        buildCoverPersonaContextForImageGen(personaSummary, ipProfile),
                      );
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "封面套装发起失败");
                    }
                  })();
                }}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border-2 border-[#ff4fb8]/55 bg-[#ff4fb8]/10 px-4 py-2 text-[12px] font-bold text-[#ff9fe0] transition hover:bg-[#ff4fb8]/18 disabled:opacity-50"
              >
                {isSequentialCoverBatchGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Sparkles className="h-3.5 w-3.5" />
                )}
                一键封面套装
              </button>
              <button
                type="button"
                disabled={genBusy || !isAuthenticated}
                onClick={onBulkCompositeOneClick}
                className="inline-flex items-center justify-center gap-1.5 rounded-full border-2 border-[#10B981] bg-[#10B981]/20 px-4 py-2 text-[12px] font-bold text-[#a7f3d0] transition hover:bg-[#10B981]/28 disabled:opacity-50"
              >
                {isSequentialCompositeBatchGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Layers className="h-3.5 w-3.5" />
                )}
                一键分镜/图文套装
              </button>
              <button
                type="button"
                disabled={genBusy || !isAuthenticated}
                onClick={onBulkCoverCompositeBundleOneClick}
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[#ff4fb8] to-[#6a5cff] px-4 py-2 text-[12px] font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-50"
              >
                {isSequentialCoverCompositeBundleBatchGenerating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Package className="h-3.5 w-3.5" />
                )}
                一键封面加分镜
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-4 max-h-[900px] space-y-4 overflow-y-auto pr-1">
          {cards.map((item, bi) => {
            const isGraphicFormat = item.format === "图文" || item.format === "小红书";
            const compositeKind = isGraphicFormat
              ? ("xiaohongshu_dual_note" as const)
              : ("storyboard_sheet_landscape" as const);
            const is3x4 = compositeGridVariant === "3x4";
            const compositeCost = isGraphicFormat
              ? is3x4
                ? CREDIT_COSTS.platformXhsDualNote3x4
                : CREDIT_COSTS.platformXhsDualNote
              : is3x4
                ? CREDIT_COSTS.platformStoryboardSheet3x4
                : CREDIT_COSTS.platformStoryboardSheet;
            const compositeLabel = isGraphicFormat
              ? is3x4
                ? "小红书 3×4 十二格图文"
                : "小红书 2×4 八格图文"
              : is3x4
                ? "3×4 十二格编导分镜表"
                : "2×4 高定编导分镜表";
            const CompositeIcon = isGraphicFormat ? Heart : Film;
            const bundleCost = platformCoverCompositeBundleCreditsForFormatGrid(item.format, is3x4);
            const normalCoverCost = CREDIT_COSTS.platformTopicFrameGraphic;
            const isThisBundleLoading = coverCompositeBundleSceneId === item.id;
            const isThisCompositeLoading =
              compositeMutationBusy &&
              pendingCompositeSheet?.sceneId === item.id &&
              pendingCompositeSheet?.kind === compositeKind;
            const coverUrl = platformImageMap[item.id] || "";
            const sheetUrl =
              (isGraphicFormat ? platformXhsNoteMap[item.id] : platformStoryboardSheetMap[item.id]) || "";

            const runSingleCover = () => {
              if (!isAuthenticated) {
                toast.error("请先登录");
                return;
              }
              if (!String(item.id || "").trim()) {
                toast.error("选题缺少 ID，无法生成");
                return;
              }
              if (
                !supervisorAccess &&
                !window.confirm(`将为本选题生成竖版封面，消耗 ${normalCoverCost} 积分，是否继续？`)
              ) {
                return;
              }
              markCoverGenerationStarted(item.id);
              void runThrottledPlatformImageRequest(`shortlist-cover:${item.id}`, async () => {
                await syncPlatformExecutionBlueprintsSnapshotMutation.mutateAsync({
                  contentBlueprints: [executionCardToSnapshotBlueprint(item)],
                });
                return runEnqueueTopicImageAndPoll({
                  topicHook: "",
                  format: isGraphicFormat ? "图文" : "短视频",
                  coverPersonaContext:
                    buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim() || undefined,
                  sceneId: item.id,
                  referencePhotoUrl: resolveReferencePhotoForScene(item.id),
                  pollDebugLabel: `扩写区单张封面 · ${item.id}`,
                });
              })
                .then((res) => {
                  const finalUrl = res.imageUrl ?? (res as { url?: string | null }).url ?? null;
                  if (res.creationId != null) {
                    setSceneJobIds((prev) => ({ ...prev, [item.id]: String(res.creationId) }));
                  }
                  if (res.success && finalUrl) {
                    setPlatformImageMap((prev) => ({ ...prev, [item.id]: finalUrl }));
                    toast.success("单张封面已生成");
                  } else {
                    toast.error(
                      (res as { userFacingError?: string }).userFacingError || "单帧生图失败，可稍后重试。",
                    );
                  }
                  markCoverGenerationFinished(item.id);
                })
                .catch((err) => {
                  markCoverGenerationFinished(item.id);
                  toast.error(err instanceof Error ? err.message : "操作失败");
                });
            };

            const runSingleComposite = () => {
              if (!isAuthenticated) {
                toast.error("请先登录");
                return;
              }
              if (
                !supervisorAccess &&
                !window.confirm(`将消耗 ${compositeCost} 积分，生成${compositeLabel}，是否继续？`)
              ) {
                return;
              }
              const coverPersona = buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim();
              const compositeSupervisorExtras = {
                ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
                  ? { enableTopicCoverDeepResearchPro: true as const }
                  : {}),
                ...(coverPersona ? { coverPersonaContext: coverPersona } : {}),
              };
              void (async () => {
                try {
                  await syncPlatformExecutionBlueprintsSnapshotMutation.mutateAsync({
                    contentBlueprints: [executionCardToSnapshotBlueprint(item)],
                  });
                } catch {
                  /* 出图前尽力同步；失败仍尝试入队 */
                }
                void runThrottledPlatformImageRequest(`shortlist-composite:${item.id}:${compositeKind}`, () =>
                  generatePlatformCompositeSheetMutation.mutateAsync({
                    sceneId: item.id,
                    title: item.title,
                    scriptContext: buildPlatformSheetScriptContext(item as any, {
                      shootingTechniqueBrief:
                        compositeKind === "xiaohongshu_dual_note"
                          ? undefined
                          : lastShootingTechniqueBriefRef.current.trim() || undefined,
                      gridVariant: compositeGridVariant,
                      sheetKind: compositeKind === "xiaohongshu_dual_note" ? "graphic" : "storyboard",
                    }),
                    kind: compositeKind,
                    gridVariant: compositeGridVariant,
                    executionDetails: buildPlatformExecutionDetailsPayload(item as any),
                    shootingTechniqueBrief: lastShootingTechniqueBriefRef.current.trim() || undefined,
                    ...optionalBoundCreationRecordId(),
                    imagePromptTranslator: COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
                    progressJobId: newPlatformCompositeProgressJobId(),
                    ...compositeSupervisorExtras,
                    compositeImageEngine: resolveReferencePhotoForScene(item.id)
                      ? "gpt_image2"
                      : platformComposite2x4Engine,
                    ...(resolveReferencePhotoForScene(item.id)
                      ? {
                          referencePhotoUrl: resolveReferencePhotoForScene(item.id),
                          referencePhotoFromApprovedCover: Boolean(
                            String(platformImageMap[item.id] || "").trim() &&
                              resolveReferencePhotoForScene(item.id) ===
                                String(platformImageMap[item.id] || "").trim(),
                          ),
                        }
                      : {}),
                    enabledSkillIds: Array.from(enabledPlatformSkillIds),
                    allowBloggerTitle,
                  }),
                ).catch((err) => toast.error(err instanceof Error ? err.message : "分镜/图文发起失败"));
              })();
            };

            const runBundle = () => {
              if (!isAuthenticated) {
                toast.error("请先登录");
                return;
              }
              if (!String(item.id || "").trim()) {
                toast.error("选题缺少 ID，无法生成");
                return;
              }
              const retailSum = CREDIT_COSTS.platformTopicFrameGraphic + compositeCost;
              if (
                !supervisorAccess &&
                !window.confirm(
                  `将消耗 ${bundleCost} 积分${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}，为本选题并发生成竖版封面与${compositeLabel}（散买合计 ${retailSum}）。是否继续？`,
                )
              ) {
                return;
              }
              setCoverCompositeBundleSceneId(item.id);
              const coverPersona = buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim();
              void runThrottledPlatformImageRequest(`shortlist-bundle:${item.id}`, async () => {
                await syncPlatformExecutionBlueprintsSnapshotMutation.mutateAsync({
                  contentBlueprints: [executionCardToSnapshotBlueprint(item)],
                });
                return runEnqueueTopicCoverCompositeBundleAndPoll({
                  sceneId: item.id,
                  coverPersonaContext: coverPersona || undefined,
                  headlineTitle: item.title,
                  compositeKind,
                  scriptContext: buildPlatformSheetScriptContext(item as any, {
                    shootingTechniqueBrief:
                      compositeKind === "xiaohongshu_dual_note"
                        ? undefined
                        : lastShootingTechniqueBriefRef.current.trim() || undefined,
                    gridVariant: compositeGridVariant,
                    sheetKind: compositeKind === "xiaohongshu_dual_note" ? "graphic" : "storyboard",
                  }),
                  executionDetails: buildPlatformExecutionDetailsPayload(item as any),
                  shootingTechniqueBrief: lastShootingTechniqueBriefRef.current.trim() || undefined,
                  gridVariant: compositeGridVariant,
                  pollDebugLabel: `扩写区套装 · ${item.id}`,
                  referencePhotoUrl: resolveReferencePhotoForScene(item.id),
                  compositeImageEngine: resolveReferencePhotoForScene(item.id)
                    ? "gpt_image2"
                    : platformComposite2x4Engine,
                });
              })
                .then((res) => {
                  if (res.creationId != null) {
                    setSceneJobIds((prev) => ({ ...prev, [item.id]: String(res.creationId) }));
                  }
                  if (res.success && res.imageUrl) {
                    setPlatformImageMap((prev) => ({ ...prev, [item.id]: res.imageUrl! }));
                  }
                  const compUrl = res.compositeImageUrl?.trim();
                  if (compUrl && res.compositeKind) {
                    if (
                      res.compositeKind === "storyboard_sheet_portrait" ||
                      res.compositeKind === "storyboard_sheet_landscape"
                    ) {
                      setPlatformStoryboardSheetMap((p) => ({ ...p, [item.id]: compUrl }));
                    } else if (res.compositeKind === "xiaohongshu_dual_note") {
                      setPlatformXhsNoteMap((p) => ({ ...p, [item.id]: compUrl }));
                    }
                  }
                  if (res.success && res.imageUrl && res.compositeImageUrl) {
                    toast.success(`套装已完成：封面 + ${compositeLabel}`);
                  } else {
                    toast.error("套装未完成，请重试或用「仅封面 / 分镜·图文」分步生成。");
                  }
                })
                .catch((err) => toast.error(err instanceof Error ? err.message : "操作失败"))
                .finally(() => setCoverCompositeBundleSceneId(null));
            };

            return (
              <article
                key={`${domId}-expand-gen-${item.id}-${bi}`}
                className="rounded-2xl border border-white/12 bg-[rgba(18,13,43,0.75)] p-4 sm:p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 flex-1 text-lg font-bold leading-snug text-white sm:text-xl">
                    {bi + 1}. {item.title}
                  </h3>
                  {item.format ? (
                    <span className="shrink-0 rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-[11px] text-[#8cefff]">
                      {item.format}
                    </span>
                  ) : null}
                </div>
                {item.hook ? (
                  <p className="mt-3 text-sm leading-relaxed text-[#8cefff]">
                    <span className="font-semibold text-[#8cefff]/80">钩子 · </span>
                    {item.hook}
                  </p>
                ) : null}
                {item.copywriting ? (
                  <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-gray-200">
                    {item.copywriting}
                  </p>
                ) : (
                  <p className="mt-3 text-sm text-amber-200/80">正文为空（可再点「就写这条」重试）</p>
                )}
                {item.publishingAdvice ? (
                  <div className="mt-3 rounded-xl border border-[#fbbf24]/30 bg-[rgba(251,191,36,0.08)] px-3 py-2.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-[#fcd34d]/90">
                      发布时间 / 发布建议
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm leading-6 text-[#ffe9a8]">
                      {item.publishingAdvice}
                    </div>
                  </div>
                ) : null}
                {item.detailedScript ? (
                  <details className="mt-3 text-xs text-gray-400">
                    <summary className="cursor-pointer select-none text-[13px] font-semibold text-[#ff9900]">
                      ▶ 详细脚本与大纲（点击展开）
                    </summary>
                    <div className="mt-2 whitespace-pre-wrap rounded-lg bg-black/30 p-3 text-sm leading-relaxed text-[#d3caef]">
                      {item.detailedScript}
                    </div>
                  </details>
                ) : null}
                {Array.isArray((item as any).storyboardCells) &&
                (item as any).storyboardCells.length > 0 &&
                !/图文|小红书/.test(String(item.format || "")) ? (
                  <div className="mt-3 rounded-lg bg-black/30 p-3 text-xs text-gray-400">
                    <PlatformStoryboardCellsTable
                      cells={(item as any).storyboardCells as PlatformStoryboardCell[]}
                    />
                  </div>
                ) : null}

                {(coverUrl || sheetUrl) && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {coverUrl ? (
                      <a
                        href={coverUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg border border-white/15"
                      >
                        <img src={coverUrl} alt="" className="h-28 w-auto object-cover" />
                      </a>
                    ) : null}
                    {sheetUrl ? (
                      <a
                        href={sheetUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="block overflow-hidden rounded-lg border border-white/15"
                      >
                        <img src={sheetUrl} alt="" className="h-28 w-auto object-cover" />
                      </a>
                    ) : null}
                  </div>
                )}

                <div className="mt-4 flex flex-wrap gap-2 border-t border-white/10 pt-3">
                  <button
                    type="button"
                    disabled={genBusy || !isAuthenticated || batchGeneratingCoverIds.has(item.id)}
                    onClick={runBundle}
                    className={`inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff4fb8] to-[#6a5cff] px-3 py-2 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-50 ${
                      isThisBundleLoading ? "cursor-wait ring-2 ring-[#c4b5fd]/55" : ""
                    }`}
                  >
                    {isThisBundleLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        套装生成中…
                      </>
                    ) : (
                      <>
                        <Package className="h-3.5 w-3.5" />
                        {`一键套装 · ${bundleCost} 点${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}`}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={genBusy || !isAuthenticated || batchGeneratingCoverIds.has(item.id)}
                    onClick={runSingleCover}
                    className="inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg border border-[#ff4fb8]/45 bg-[#ff4fb8]/12 px-3 py-2 text-xs font-bold text-[#ff9fe0] transition hover:bg-[#ff4fb8]/22 disabled:opacity-50"
                  >
                    {batchGeneratingCoverIds.has(item.id) ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        封面生成中…
                      </>
                    ) : (
                      <>
                        <Image className="h-3.5 w-3.5" />
                        {`仅封面 · ${normalCoverCost} 点`}
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    disabled={genBusy || !isAuthenticated}
                    onClick={runSingleComposite}
                    className={`inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition disabled:opacity-50 ${
                      isGraphicFormat
                        ? "border-[#ff4fb8]/40 bg-[#ff4fb8]/10 text-[#ff9fe0] hover:bg-[#ff4fb8]/20"
                        : "border-[#49e6ff]/40 bg-[#49e6ff]/10 text-[#8cefff] hover:bg-[#49e6ff]/20"
                    } ${isThisCompositeLoading ? "cursor-wait ring-2 ring-white/30" : ""}`}
                  >
                    {isThisCompositeLoading ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        生成中…
                      </>
                    ) : (
                      <>
                        <CompositeIcon className="h-3.5 w-3.5" />
                        {`${compositeLabel} · ${compositeCost} 点`}
                      </>
                    )}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    );
  };

  const isAnalyzing = growthSnapshotQuery.isFetching;
  const processingSteps = useMemo(
    () => buildPlatformProcessingSteps(selectedWindowDays, elapsedTime, focusPrompt),
    [selectedWindowDays, elapsedTime, focusPrompt],
  );
  const activeProcessingStep = processingSteps.find((item) => item.status === "active") || processingSteps[processingSteps.length - 1] || null;
  const animatedProcessingSteps = useMemo(
    () => processingSteps.map((step, index) => ({
      ...step,
      animatedLabel: step.status === "done" ? step.label : revealText(step.label, elapsedTime, index * 10, 10),
      animatedDetail: step.status === "done" ? step.detail : revealText(step.detail, elapsedTime, index * 14, 16),
    })),
    [processingSteps, elapsedTime],
  );
  useEffect(() => {
    if (!isAnalyzing) {
      setElapsedTime(0);
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedTime((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  /** 独立趋势 PNG：持久入队，浏览器断线或刷新不会取消模型任务。 */
  const handleTrendStandaloneAnalyze = async () => {
    if (selectedTrendPlatforms.length !== 1) {
      toast.error("请选择一个分析平台");
      return;
    }
    const visualPlatforms = toVisualReportPlatforms(selectedTrendPlatforms);
    if (!visualPlatforms.length) {
      toast.error("当前所选平台暂不支持图文报表");
      return;
    }
    const selectedPlatformLabels = selectedTrendPlatforms
      .map((key) => TREND_PLATFORM_OPTIONS.find((item) => item.key === key)?.label)
      .filter(Boolean)
      .join("、");

    const cost = getPlatformTrendReportCredits(selectedWindowDays);
    const reportWindowDays = toVisualReportWindowDays(selectedWindowDays);
    const windowNote =
      selectedWindowDays === 45
        ? "（45 天窗口的 PNG 报表按 30 天口径生成）"
        : "";
    if (
      !window.confirm(
        `【平台趋势分析】将读取${selectedPlatformLabels || "所选平台"}近 ${selectedWindowDays} 天样本，后台生成趋势 PNG${windowNote}。\n\n扣除 ${cost} 积分；页面刷新后仍可继续取回结果。是否开始？`,
      )
    ) {
      return;
    }

    // 重跑只清本区旧报表；不重跑下方决策智库/Stage 1，避免无关慢任务阻塞 PNG。
    clearPlatformVisualReportPersist();
    setVisualReportData(null);
    setVisualReportError(null);
    setTrendInsightTab("overview");
    setTrendStandaloneBusy(true);
    setIsVisualReportLoading(true);

    try {
      const billingRequestId = crypto.randomUUID();
      const queued = await enqueueVisualReportMutation.mutateAsync({
        windowDays: reportWindowDays,
        theme: visualReportTheme,
        platforms: visualPlatforms,
        billingRequestId,
      });
      const pending: PlatformVisualReportPendingJobV1 = {
        v: 1,
        jobId: queued.jobId,
        userId: String(user?.id || ""),
        windowDays: reportWindowDays,
        theme: visualReportTheme,
        createdAt: Date.now(),
      };
      writePlatformVisualReportPendingJob(pending);
      toast.success("趋势报告已进入后台生成，通常约 30–40 秒");
      await monitorVisualReportJob(pending, true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const message = sanitizePlatformUserMessage(msg, "趋势报告入队失败，请稍后重试");
      setVisualReportError(message);
      toast.error(message);
      setTrendStandaloneBusy(false);
      setIsVisualReportLoading(false);
    }
  };

  const handleDownloadVisualReport = async () => {
    if (!visualReportRef.current || !visualReportData) return;
    setIsVisualReportDownloading(true);
    try {
      const reportWindowDays = toVisualReportWindowDays(selectedWindowDays);
      const dataUrl = await toPng(visualReportRef.current, {
        pixelRatio: 2,
        // 与 VisualReportTemplate 爱马仕橙页底中间调对齐，避免 PNG 四周露紫边
        backgroundColor: visualReportTheme === "dark" ? "#E4B8A8" : "#F3E0D6",
      });
      const link = document.createElement("a");
      link.download = `mvstudiopro-trend-report-${reportWindowDays}d-${visualReportTheme}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("趋势报告 PNG 已下载");
    } catch {
      toast.error("下载失败，请重试");
    } finally {
      setIsVisualReportDownloading(false);
    }
  };

  /** 全案分析主路径：确认后出 20–30 条选题初选（trendStore 小红书主 + B站/抖音辅），不直接烧六条文案 */
  const resolveFullcaseShortlistCount = useCallback(() => {
    const n = clampTopicShortlistCount(topicShortlistCount);
    return n >= PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT
      ? n
      : PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT;
  }, [topicShortlistCount]);

  /**
   * 全案确认后并行补齐：平台优先级看板 + 商业化路径（不覆盖选题扩写文案）。
   * 与 generatePlatformTopicShortlist 并行；失败只写 Debug，不阻断初选。
   */
  const runFullcaseDashboardAndMonetization = useCallback(async () => {
    const ctx = focusPrompt.trim() || undefined;
    pushShortlistDebug("并行：快照 → 平台优先级看板 → 商业化路径…");
    setIsDashboardLoading(true);
    try {
      const snapRes = await growthSnapshotQuery.refetch();
      const snap = snapRes.data?.snapshot;
      if (!snap) {
        pushShortlistDebug("❌ 并行看板：快照为空，跳过平台优先级/变现");
        return;
      }
      lastStage2InputRef.current = {
        snapshotSummary: snap as Record<string, unknown>,
        windowDays: selectedWindowDays,
      };
      const platforms =
        selectedTrendPlatforms.length > 0
          ? selectedTrendPlatforms
          : (["xiaohongshu", "bilibili", "douyin", "weixin_channels"] as typeof selectedTrendPlatforms);

      const dashResult = await getPlatformDashboardMutation.mutateAsync({
        context: ctx,
        windowDays: selectedWindowDays,
        snapshotSummary: snap as Record<string, unknown>,
        copyLlmMode: "openai" as const,
        requestedPlatforms: platforms,
      });
      const dash = dashResult.platformDashboard as PlatformDashboard | null;
      if (!dash) {
        const err =
          typeof (dashResult as { debug?: { error?: string } }).debug?.error === "string"
            ? String((dashResult as { debug: { error: string } }).debug.error)
            : "empty";
        pushShortlistDebug(`❌ 平台看板未返回 · ${err.slice(0, 100)}`);
        return;
      }
      setPlatformDashboard(dash);
      pushShortlistDebug(
        `✅ 平台优先级 · platformMenu=${Array.isArray(dash.platformMenu) ? dash.platformMenu.length : 0}`,
      );

      setIsContentLoading(true);
      setContentLoadingText("正在推演可落地商业化路径…");
      try {
        const mon = await generatePlatformMonetizationLanesMutation.mutateAsync({
          context: ctx,
          windowDays: selectedWindowDays,
          platformMenu: dash.platformMenu || [],
          snapshotSummary: snap as Record<string, unknown>,
          strategicDashboard: dash as unknown as Record<string, unknown>,
          stage2LlmMode: "openai" as const,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
        });
        const lanes = Array.isArray(mon.monetizationLanes) ? mon.monetizationLanes : [];
        if (lanes.length > 0) {
          setPlatformContent((prev) => ({
            contentBlueprints: Array.isArray(prev?.contentBlueprints) ? prev!.contentBlueprints : [],
            monetizationLanes: lanes as PlatformDashboard["monetizationLanes"],
          }));
          pushShortlistDebug(`✅ 商业化路径 ${lanes.length} 条已写入`);
        } else {
          const err =
            typeof (mon as { debug?: { error?: string } }).debug?.error === "string"
              ? String((mon as { debug: { error: string } }).debug.error)
              : "empty";
          pushShortlistDebug(`❌ 商业化路径空 · ${err.slice(0, 100)}`);
        }
      } finally {
        setIsContentLoading(false);
        setContentLoadingText("等待战略看板就绪…");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      pushShortlistDebug(`❌ 并行看板/变现失败：${msg.slice(0, 140)}`);
    } finally {
      setIsDashboardLoading(false);
    }
  }, [
    allowBloggerTitle,
    enabledPlatformSkillIds,
    focusPrompt,
    generatePlatformMonetizationLanesMutation,
    getPlatformDashboardMutation,
    growthSnapshotQuery,
    pushShortlistDebug,
    selectedTrendPlatforms,
    selectedWindowDays,
  ]);

  /**
   * 需要平台优先级看板的功能（决策智库、热点风向标）按需现拉一次。
   *
   * 以前每次出选题都顺手跑一遍，绝大多数用户根本不看，白烧三轮模型；
   * 现在改成谁要用谁触发（用户 2026-08-06）。
   */
  const ensureFullcaseDashboard = useCallback(async (): Promise<boolean> => {
    if (platformDashboard) return true;
    if (!focusPrompt.trim()) {
      toast.error("请先填写人物背景，再使用需要平台看板的功能");
      return false;
    }
    toast.message("正在准备平台优先级看板（约一分钟）…");
    await runFullcaseDashboardAndMonetization();
    return true;
  }, [platformDashboard, focusPrompt, runFullcaseDashboardAndMonetization]);

  const handleAnalyze = async () => {
    if (!focusPrompt.trim()) {
      setPersonaFieldErrors({ freeform: "请先填写人物背景" });
      setCreateStep("persona");
      scrollToPlatformSection("platform-persona-focus");
      toast.error("请先填写人物背景与创作诉求");
      return;
    }
    const n = resolveFullcaseShortlistCount();
    setTopicShortlistCount(n);
    setPendingFullAnalysisLabels(String(n));
    setFullAnalysisConfirmOpen(true);
  };

  const runFullAnalysisAfterConfirm = async () => {
    setFullAnalysisConfirmOpen(false);
    const n = resolveFullcaseShortlistCount();
    setTopicShortlistCount(n);
    setCreateStep("topics");
    setHasAnalyzed(true);
    setShortlistLastError(null);
    setShortlistDebugLines([]);
    pushShortlistDebug(`确认：请求 ${n} 条选题初选（小红书主 / B站+抖音辅）`);
    pushShortlistDebug(`人设长度 ${focusPrompt.trim().length} 字 · Skill ${enabledPlatformSkillIds.size} 项`);
    scrollToPlatformSection("platform-topic-shortlist");
    /**
     * 这里以前会并行跑「快照 → 平台优先级看板 → 商业化路径」三轮模型。
     * 用户 2026-08-06：那两块面板不收费也不进文案，选题根本不读它们，白烧算力还把页面撑乱——
     * 已下线，需要看板时另开入口。
     */
    const t0 = Date.now();
    const heartbeat = window.setInterval(() => {
      const sec = Math.round((Date.now() - t0) / 1000);
      pushShortlistDebug(`⏳ 仍在等待服务端… ${sec}s（本机趋势→LLM；勿刷新）`);
    }, 15_000);
    try {
      trackPlatformFunnel("fullcase_start", { mode: "create", handler: "generateTopicShortlist", count: n });
      trackPlatformFunnel("topic_shortlist_start", { count: n });
      pushShortlistDebug("调用 generatePlatformTopicShortlist…");
      const existingTitles = [
        ...(platformContent?.contentBlueprints || []).map((b: { title?: string }) => String(b?.title || "")),
        ...topicShortlist.map((t) => t.title),
      ].filter(Boolean);
      const res = await generateTopicShortlistMutation.mutateAsync({
        context: focusPrompt.trim() || undefined,
        enabledSkillIds: Array.from(enabledPlatformSkillIds),
        allowBloggerTitle,
        existingTitles,
        count: n,
        windowDays: selectedWindowDays,
        ...(topicGoal ? { topicGoal } : {}),
        ...buildShortlistBlueOceanInput(decisionIntelBlueOceanLexicon),
      });
      const topics = res.topics || [];
      const ms = Date.now() - t0;
      setTopicShortlist(topics);
      setSelectedShortlistIds([]);
      setCreateStep("result");
      pushShortlistDebug(
        `返回 topics=${topics.length} · 耗时 ${Math.round(ms / 1000)}s · 扣点 ${res.chargedCredits ?? "—"}`,
      );
      if (res.diagnostics && typeof res.diagnostics === "object") {
        const d = res.diagnostics as Record<string, unknown>;
        pushShortlistDebug(
          `诊断 raw=${String(d.rawCount ?? "—")} afterDedupe=${String(d.afterDedupe ?? "—")} trendStatus=${String(d.trendStatus ?? "—")} trend=${JSON.stringify(d.trendPlatforms ?? [])}`,
        );
        pushShortlistDebug(
          `LLM reasoning=${String(d.reasoningUsed ?? "—")} emptyRetried=${String(d.emptyRetried ?? false)}`,
        );
      }
      window.setTimeout(() => scrollToPlatformSection("platform-topic-shortlist"), 80);
      if (workbenchUserKey) {
        pushRecentTask(workbenchUserKey, {
          mode: "create",
          label: `全案选题初选 ${topics.length} 条`,
          credits: Number(res.chargedCredits) || undefined,
        });
        setRecentTasks(readRecentTasks(workbenchUserKey));
      }
      trackPlatformFunnel("topic_shortlist_done", { count: topics.length });
      if (!topics.length) {
        const err = "初选未返回选题（topics 为空）";
        setShortlistLastError(err);
        pushShortlistDebug(`❌ ${err}`);
        toast.error("初选未返回选题，请稍后重试");
        return;
      }
      pushShortlistDebug(`✅ 已在按钮下方展示 ${topics.length} 条，可改标题 / 就写这条`);
      toast.success(
        `已生成 ${topics.length} 条初选${res.chargedCredits ? `（扣 ${res.chargedCredits} 点）` : ""}；请在下方列表挑选或改标题，再点「就写这条」。`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly =
        msg.includes("timeout") || msg.includes("504")
          ? "算力紧张或请求超时，请稍后重试选题初选"
          : msg.includes("空内容")
            ? "算力紧张（已自动重试仍未成功），请再试一次"
            : sanitizePlatformUserMessage(msg, "选题初选失败，请稍后重试");
      setShortlistLastError(friendly);
      pushShortlistDebug(`❌ ${msg}（已等 ${Math.round((Date.now() - t0) / 1000)}s）`);
      toast.error(friendly);
    } finally {
      window.clearInterval(heartbeat);
    }
  };

  const handleUploadQaFile = useCallback(async (file: File) => {
    setIsUploadingQaFile(true);
    setQaUploadStatus("idle");
    setQaFileUri(null);
    setQaFileMimeType("");
    setQaFileName("");
    try {
      const formData = new FormData();
      formData.append("file", file, file.name);
      const response = await fetch("/api/platform/upload", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || `Upload failed (${response.status})`);
      }
      const data = await response.json();
      setQaFileUri(data.fileUri);
      setQaFileMimeType(data.mimeType);
      setQaFileName(file.name);
      setQaUploadStatus("success");
      toast.success(`✅ 已上传 ${file.name}`);
    } catch (err: any) {
      setQaUploadStatus("error");
      toast.error(err.message || "文档上传失败");
    } finally {
      setIsUploadingQaFile(false);
    }
  }, []);

  const handleAsk = async (nextQuestion?: string) => {
    const finalQuestion = String(nextQuestion || question).trim();
    if (!snapshot) {
      toast.error("请先完成平台分析");
      return;
    }
    if (!finalQuestion) {
      toast.error("先输入一个你想进一步了解的问题");
      return;
    }
    setQuestion(finalQuestion);
    setIsQaLoading(true);
    // Dispatch async QA Job — GPT‑5.5 answers in background（与 askPlatformFollowUp 同路径）
    // If a file was uploaded, pass fileUri + fileMimeType for multimodal analysis
    try {
      const { jobId } = await createPlatformQAJobMutation.mutateAsync({
        question: finalQuestion,
        context: focusPrompt || undefined,
        windowDays: selectedWindowDays,
        snapshot: snapshot as any,
        fileUri: qaFileUri || undefined,
        fileMimeType: qaFileMimeType || undefined,
      });
      setQaJobId(jobId);
      // Clear file after dispatch — GCS cleanup handled by server finally block
      setQaFileUri(null);
      setQaFileMimeType("");
      setQaFileName("");
      startQAPolling(jobId);
    } catch {
      // Fallback to synchronous askPlatformFollowUp if job creation fails
      await askPlatformFollowUpMutation.mutateAsync({
        question: finalQuestion,
        context: focusPrompt || undefined,
        windowDays: selectedWindowDays,
        snapshot,
        copyLlmMode: "openai" as const,
      });
    }
  };

  const scrollToPlatformExecutionCopy = useCallback(() => {
    document.getElementById("platform-stage2-copy")?.scrollIntoView({ behavior: "smooth", block: "start" });
    toast.message("请在下方「专属选题与文案」执行卡生成封面、2×4 分镜与图文");
  }, []);

  const strategicMapSessionBonusCount = useMemo(
    () => strategicMapSessionExecutionCards.filter((c) => c.isDecisionIntelBonus).length,
    [strategicMapSessionExecutionCards],
  );

  const existingStrategicExecutionTitleKeys = useMemo(
    () => visibleExecutionCards.map((c) => c.title),
    [visibleExecutionCards],
  );

  const handleStrategicMapGenerateTopicCopy = useCallback(
    async (pick: DecisionIntelTopicPick) => {
      if (!unlockedStrategicReport) {
        toast.error("请先解锁战略地图");
        return;
      }
      const titleKey = normalizeDecisionIntelTopicTitleKey(pick.title);
      if (existingStrategicExecutionTitleKeys.some((t) => normalizeDecisionIntelTopicTitleKey(t) === titleKey)) {
        toast.message("该选题已在下方执行区，可直接生封面与分镜");
        scrollToPlatformExecutionCopy();
        return;
      }
      if (generateDecisionIntelTopicCopyMutation.isPending) return;

      setGeneratingStrategicMapTopicKey(titleKey);
      try {
        const res = await generateDecisionIntelTopicCopyMutation.mutateAsync({
          topic: strategicMapTopic,
          contentBlueprint: strategicMapBlueprint,
          platformHint: decisionIntelPlatformHint,
          blueOceanLexicon: decisionIntelBlueOceanLexicon,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
          pick,
        });
        const mapped = mapStrategicMapBlueprintsToExecutionCards(
          res.executionBlueprints ?? [],
          contentExecutionCards.length + strategicMapSessionExecutionCards.length,
          { isDecisionIntelPicked: true },
        );
        if (mapped.length === 0) {
          toast.error("未能生成执行文案，请稍后重试");
          return;
        }
        setStrategicMapSessionExecutionCards((prev) => [...prev, ...mapped]);
        toast.success("已扩写并加入下方执行区");
        scrollToPlatformExecutionCopy();
      } finally {
        setGeneratingStrategicMapTopicKey(null);
      }
    },
    [
      unlockedStrategicReport,
      existingStrategicExecutionTitleKeys,
      generateDecisionIntelTopicCopyMutation,
      strategicMapTopic,
      strategicMapBlueprint,
      decisionIntelPlatformHint,
      contentExecutionCards.length,
      strategicMapSessionExecutionCards.length,
      scrollToPlatformExecutionCopy,
      enabledPlatformSkillIds,
      allowBloggerTitle,
    ],
  );

  const strategicMapGiftedStructureTitles = useMemo(() => {
    if (!unlockedStrategicReport) return [] as string[];
    return selectDecisionIntelBonusTopics(unlockedStrategicReport.topicStructureExamples).map((t) =>
      t.title.trim(),
    );
  }, [unlockedStrategicReport]);

  /**
   * 热点风向标「一键出图」：从 Stage1 看板热点（topTopics）直接扩写成可执行文案并入执行区，
   * **不依赖 200 积分报告，也不依赖 Stage2 智能文案**——只需先完成快照 + 战略看板。
   * 复用 generateDecisionIntelTopicExecutionCopy（同一选题首次免费），落地后即可在执行区直接出封面 / 分镜。
   */
  const handleQuickHotTopicToExecution = useCallback(
    async (topic: { title?: string; whyHot?: string; howToUse?: string }) => {
      if (!platformDashboard) {
        const ready = await ensureFullcaseDashboard();
        if (!ready || !platformDashboard) {
          toast.message("平台看板准备中，稍等片刻再点这条");
          return;
        }
      }
      const title = String(topic.title || "").trim();
      if (title.length < 2) {
        toast.error("该选题标题不足，无法扩写");
        return;
      }
      const structure =
        [topic.howToUse, topic.whyHot]
          .map((s) => String(s || "").trim())
          .filter(Boolean)
          .join("\n")
          .slice(0, 8000) || title;
      const titleKey = normalizeDecisionIntelTopicTitleKey(title);
      if (existingStrategicExecutionTitleKeys.some((t) => normalizeDecisionIntelTopicTitleKey(t) === titleKey)) {
        toast.message("该选题已在下方执行区，可直接生封面与分镜");
        scrollToPlatformExecutionCopy();
        return;
      }
      if (generateDecisionIntelTopicCopyMutation.isPending) return;

      setGeneratingStrategicMapTopicKey(titleKey);
      try {
        const res = await generateDecisionIntelTopicCopyMutation.mutateAsync({
          topic: strategicMapTopic,
          contentBlueprint: strategicMapBlueprint,
          platformHint: decisionIntelPlatformHint,
          blueOceanLexicon: decisionIntelBlueOceanLexicon,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
          pick: { title: title.slice(0, 240), structure, source: "structure" as const },
        });
        const mapped = mapStrategicMapBlueprintsToExecutionCards(
          res.executionBlueprints ?? [],
          contentExecutionCards.length + strategicMapSessionExecutionCards.length,
          { isDecisionIntelPicked: true },
        );
        if (mapped.length === 0) {
          toast.error("未能生成执行文案，请稍后重试");
          return;
        }
        setStrategicMapSessionExecutionCards((prev) => [...prev, ...mapped]);
        toast.success("已扩写并加入下方执行区，可直接出封面 / 分镜");
        scrollToPlatformExecutionCopy();
      } finally {
        setGeneratingStrategicMapTopicKey(null);
      }
    },
    [
      platformDashboard,
      existingStrategicExecutionTitleKeys,
      generateDecisionIntelTopicCopyMutation,
      strategicMapTopic,
      strategicMapBlueprint,
      decisionIntelPlatformHint,
      contentExecutionCards.length,
      strategicMapSessionExecutionCards.length,
      scrollToPlatformExecutionCopy,
      enabledPlatformSkillIds,
      allowBloggerTitle,
    ],
  );

  const handleStrategicMapRegenerateTopicCopy = useCallback(
    async (pick: DecisionIntelTopicPick) => {
      if (!unlockedStrategicReport) {
        toast.error("请先解锁战略地图");
        return;
      }
      const titleKey = normalizeDecisionIntelTopicTitleKey(pick.title);
      if (generateDecisionIntelTopicCopyMutation.isPending) return;

      const regenCost = CREDIT_COSTS.decisionIntelTopicExecutionCopyRegenerate;
      if (
        !supervisorAccess &&
        !window.confirm(
          `将重新生成该选题的执行文案（防护开关）。同一选题首次重新生成免费，之后每次 ${regenCost} 积分。是否继续？`,
        )
      ) {
        return;
      }

      const isGifted = strategicMapGiftedStructureTitles.some(
        (t) => normalizeDecisionIntelTopicTitleKey(t) === titleKey,
      );

      setGeneratingStrategicMapTopicKey(titleKey);
      try {
        const res = await generateDecisionIntelTopicCopyMutation.mutateAsync({
          topic: strategicMapTopic,
          contentBlueprint: strategicMapBlueprint,
          platformHint: decisionIntelPlatformHint,
          blueOceanLexicon: decisionIntelBlueOceanLexicon,
          enabledSkillIds: Array.from(enabledPlatformSkillIds),
          allowBloggerTitle,
          pick,
          regenerate: true,
        });
        const mapped = mapStrategicMapBlueprintsToExecutionCards(
          res.executionBlueprints ?? [],
          contentExecutionCards.length + strategicMapSessionExecutionCards.length,
          isGifted
            ? { isDecisionIntelBonus: true }
            : { isDecisionIntelPicked: true },
        );
        if (mapped.length === 0) {
          toast.error("未能重新生成执行文案，请稍后重试");
          return;
        }
        setStrategicMapSessionExecutionCards((prev) => {
          const filtered = prev.filter(
            (c) => normalizeDecisionIntelTopicTitleKey(c.title) !== titleKey,
          );
          return [...filtered, ...mapped];
        });
        const charged = Number(res.chargedCredits ?? 0);
        toast.success(
          charged > 0
            ? `已重新生成并更新执行区（扣 ${charged} 积分）`
            : "已重新生成并更新执行区（本次免费）",
        );
        scrollToPlatformExecutionCopy();
      } finally {
        setGeneratingStrategicMapTopicKey(null);
      }
    },
    [
      unlockedStrategicReport,
      generateDecisionIntelTopicCopyMutation,
      strategicMapTopic,
      strategicMapBlueprint,
      decisionIntelPlatformHint,
      strategicMapGiftedStructureTitles,
      contentExecutionCards.length,
      strategicMapSessionExecutionCards.length,
      supervisorAccess,
      scrollToPlatformExecutionCopy,
      enabledPlatformSkillIds,
      allowBloggerTitle,
    ],
  );

  const scrollToPaidDecisionIntel = useCallback(() => {
    const el = document.getElementById(PLATFORM_SECTION_DECISION_INTEL_ID);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    toast.message("请先填写人物背景并生成一次选题，再在此加购决策智库报告。");
    document.getElementById(PLATFORM_SECTION_TREND_RUN_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToPaidDeepQa = useCallback(() => {
    const el = document.getElementById(PLATFORM_SECTION_DEEP_QA_ID);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    toast.message("深度追问在战略看板结论下方：请先生成战略看板与报告内容。");
    document.getElementById(PLATFORM_SECTION_TREND_RUN_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToPaidPlatformTrends = useCallback(() => {
    if (snapshot || platformDashboard) {
      document.getElementById(PLATFORM_SECTION_TREND_SIGNALS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    // 趋势分析独立于全案：引导到工作台顶部「开始平台趋势分析」，勿误导向「开始全案分析」。
    toast.message("请先在上方「平台趋势分析报表」选择天数与平台，再点「开始平台趋势分析」（与选题分开计费）。");
    document.getElementById("platform-custom-workspace-trends")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [snapshot, platformDashboard]);


  /** Debug UI：优先 hasSupervisorAccess（含 ?supervisor=1），兼角色 admin/supervisor */
  const canShowPlatformDebug = hasSupervisorOpsAccess;

  useEffect(() => {
    if (!canShowPlatformDebug && debugMode) setDebugMode(false);
  }, [canShowPlatformDebug, debugMode]);

  // P1：仅存背景/配置草稿（不含生成结果）；按账号隔离；hydration 前不写
  useEffect(() => {
    if (!workbenchUserKey) return;
    if (!focusPrompt.trim() && !structuredPersona.identity.trim()) return;
    const t = window.setTimeout(() => {
      writeWorkbenchDraft(workbenchUserKey, {
        mode: platformMode,
        focusPrompt,
        persona: structuredPersona,
        freeformOverride,
        enabledSkillIds: Array.from(enabledPlatformSkillIds),
        topicShortlistCount,
        outputType: outputType ?? "single_page",
        createStep,
      });
      setDraftMeta({ savedAt: new Date().toISOString() });
    }, 1200);
    return () => window.clearTimeout(t);
  }, [
    focusPrompt,
    structuredPersona,
    freeformOverride,
    enabledPlatformSkillIds,
    topicShortlistCount,
    outputType,
    createStep,
    platformMode,
    workbenchUserKey,
  ]);

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!workbenchUserKey) return;
      const draft = readWorkbenchDraft(workbenchUserKey);
      if (focusPrompt.trim() && (!draft || draft.focusPrompt !== focusPrompt.trim())) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [focusPrompt, workbenchUserKey]);

  const createDoneSteps = useMemo(() => {
    const done = new Set<PlatformCreateStepId>();
    if (focusPrompt.trim() || structuredPersona.identity.trim()) done.add("persona");
    if (enabledPlatformSkillIds.size > 0) done.add("skills");
    if (topicShortlist.length > 0) done.add("topics");
    if (customNoteText.trim() || customTopicCard) done.add("copy");
    if (outputType) done.add("output");
    if (topicShortlist.length > 0 || platformContent) done.add("result");
    return done;
  }, [
    focusPrompt,
    structuredPersona.identity,
    enabledPlatformSkillIds.size,
    topicShortlist.length,
    customNoteText,
    customTopicCard,
    outputType,
    platformContent,
  ]);

  const createPrimaryCta = useMemo(
    () =>
      buildCreatePrimaryCta({
        createStep,
        focusPrompt,
        topicShortlistCount,
        isAuthenticated,
        shortlistPending: generateTopicShortlistMutation.isPending,
        fullcaseBusy: isAnalyzing || isDashboardLoading || isContentLoading,
        customNoteBusy,
        hasTopicResults: topicShortlist.length > 0,
      }),
    [
      createStep,
      focusPrompt,
      topicShortlistCount,
      isAuthenticated,
      generateTopicShortlistMutation.isPending,
      isAnalyzing,
      isDashboardLoading,
      isContentLoading,
      customNoteBusy,
      topicShortlist.length,
    ],
  );

  const trendPrimaryCta = useMemo(
    () =>
      buildTrendPrimaryCta({
        selectedPlatformCount: selectedTrendPlatforms.length,
        isAuthenticated,
        busy: trendStandaloneBusy || isAnalyzing || isDashboardLoading || isVisualReportLoading,
      }),
    [
      selectedTrendPlatforms.length,
      isAuthenticated,
      trendStandaloneBusy,
      isAnalyzing,
      isDashboardLoading,
      isVisualReportLoading,
    ],
  );

  const toolsPrimaryCta = useMemo(
    () =>
      buildToolsPrimaryCta({
        toolsTab:
          customWorkspaceTab === "matting" || customWorkspaceTab === "assets" || customWorkspaceTab === "htmlPpt"
            ? customWorkspaceTab
            : "htmlPpt",
        isAuthenticated,
        mattingPrompt: customMattingPrompt,
        mattingCount: customMattingCount,
        mattingBusy: customMattingBusy,
        customNoteBusy,
        customTopicBusy,
        assetBusy: assetAnalysisBusy,
      }),
    [
      customWorkspaceTab,
      isAuthenticated,
      customMattingPrompt,
      customMattingCount,
      customMattingBusy,
      customNoteBusy,
      customTopicBusy,
      assetAnalysisBusy,
    ],
  );

  const activePrimaryCta: PlatformPrimaryCtaState =
    platformMode === "trend"
      ? trendPrimaryCta
      : platformMode === "tools"
        ? toolsPrimaryCta
        : createPrimaryCta;

  const runCreateTopicShortlist = useCallback(async (opts?: { freeTrial?: boolean }) => {
    const freeTrial = Boolean(opts?.freeTrial);
    if (!focusPrompt.trim()) {
      setPersonaFieldErrors({ freeform: "请先填写人物背景" });
      setCreateStep("persona");
      scrollToPlatformSection("platform-persona-focus");
      toast.error("请先填写人物背景与创作诉求");
      trackPlatformFunnel("cta_disabled", { reason: "empty_persona" });
      return;
    }
    // 太笼统就先拦下来：出来的选题必然泛，等于白烧一轮的钱。
    // 但只在他还有免费优化额度时硬拦——额度用完还拦等于收保护费。
    const specificity = assessPlatformPersonaSpecificity(focusPrompt);
    if (!specificity.ok) {
      const canPolishFree = personaPolishQuota?.nextFree !== false;
      if (canPolishFree) {
        setPersonaFieldErrors({ freeform: specificity.reason });
        setCreateStep("persona");
        scrollToPlatformSection("platform-persona-polish");
        toast.error(`${specificity.reason}点「帮我理一理」，这次免费。`);
        trackPlatformFunnel("cta_disabled", { reason: "vague_persona" });
        return;
      }
      toast.warning(specificity.reason);
    }
    const count = clampTopicShortlistCount(topicShortlistCount);
    setShortlistLastError(null);
    pushShortlistDebug(`面板初选：请求 ${count} 条`);
    trackPlatformFunnel("topic_shortlist_start", { count });
    try {
      const existingTitles = [
        ...(platformContent?.contentBlueprints || []).map((b: { title?: string }) => String(b?.title || "")),
        ...topicShortlist.map((t) => t.title),
      ].filter(Boolean);
      const t0 = Date.now();
      const res = await generateTopicShortlistMutation.mutateAsync({
        context: focusPrompt.trim() || undefined,
        enabledSkillIds: Array.from(enabledPlatformSkillIds),
        allowBloggerTitle,
        existingTitles,
        count,
        windowDays: selectedWindowDays,
        ...(freeTrial ? { freeTrial: true } : {}),
        ...(topicGoal ? { topicGoal } : {}),
        ...buildShortlistBlueOceanInput(decisionIntelBlueOceanLexicon),
      });
      const topics = res.topics || [];
      setTopicShortlist(topics);
      setShortlistMaskedCount(Number(res.maskedCount) || 0);
      if (freeTrial) void refetchShortlistQuota();
      setSelectedShortlistIds([]);
      setCreateStep("result");
      scrollToPlatformSection("platform-topic-shortlist");
      pushShortlistDebug(
        `面板返回 topics=${topics.length} · ${Math.round((Date.now() - t0) / 1000)}s`,
      );
      if (res.diagnostics && typeof res.diagnostics === "object") {
        const d = res.diagnostics as Record<string, unknown>;
        pushShortlistDebug(
          `诊断 trendStatus=${String(d.trendStatus ?? "—")} reasoning=${String(d.reasoningUsed ?? "—")} emptyRetried=${String(d.emptyRetried ?? false)}`,
        );
      }
      if (workbenchUserKey) {
        pushRecentTask(workbenchUserKey, {
          mode: "create",
          label: `选题初选 ${topics.length} 条`,
          credits: Number(res.chargedCredits || topicShortlistPrice.total) || undefined,
        });
        setRecentTasks(readRecentTasks(workbenchUserKey));
      }
      trackPlatformFunnel("topic_shortlist_done", { count: topics.length });
      if (!topics.length) {
        const err = "初选未返回选题（topics 为空）";
        setShortlistLastError(err);
        pushShortlistDebug(`❌ ${err}`);
        toast.error("初选未返回选题，请稍后重试");
        return;
      }
      pushShortlistDebug(`✅ 面板已展示 ${topics.length} 条`);
      toast.success(
        freeTrial
          ? `免费试跑出了 ${topics.length} 条；还有 ${Number(res.maskedCount) || 0} 条要解锁才会生成。`
          : `已生成 ${topics.length} 条初选${res.chargedCredits ? `（扣 ${res.chargedCredits} 点）` : ""}；挑完再点「就写这条」。`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const friendly =
        msg.includes("timeout") || msg.includes("504")
          ? "算力紧张或请求超时，请稍后重试选题初选"
          : msg.includes("空内容")
            ? "算力紧张（已自动重试仍未成功），请再试一次"
            : sanitizePlatformUserMessage(msg, "初选生成失败，请稍后重试");
      setShortlistLastError(friendly);
      pushShortlistDebug(`❌ ${msg}`);
      toast.error(friendly);
    }
  }, [
    focusPrompt,
    topicGoal,
    personaPolishQuota,
    refetchShortlistQuota,
    topicShortlistCount,
    platformContent,
    topicShortlist,
    generateTopicShortlistMutation,
    enabledPlatformSkillIds,
    allowBloggerTitle,
    topicShortlistPrice.total,
    scrollToPlatformSection,
    workbenchUserKey,
    pushShortlistDebug,
  ]);

  const recordCtaDisabled = useCallback(
    (reason?: string) => {
      trackPlatformFunnel("cta_disabled", {
        mode: platformMode,
        reason: reason || activePrimaryCta.disabledReason || "disabled",
        handler: activePrimaryCta.handlerKey,
      });
      if (reason || activePrimaryCta.disabledReason) {
        toast.message(reason || activePrimaryCta.disabledReason || "当前无法操作");
      }
    },
    [platformMode, activePrimaryCta.disabledReason, activePrimaryCta.handlerKey],
  );

  const runActivePrimaryCta = useCallback(() => {
    if (ctaInFlightRef.current || activePrimaryCta.busy) {
      recordCtaDisabled("busy");
      return;
    }
    if (activePrimaryCta.disabled) {
      recordCtaDisabled();
      return;
    }
    // 再次校验 active mode，禁止跨模式 fallback
    if (activePrimaryCta.mode !== platformMode) {
      trackPlatformFunnel("cta_disabled", { mode: platformMode, reason: "mode_mismatch" });
      toast.message("模式已切换，请重试当前模式主按钮");
      return;
    }
    const startedMode = platformMode;
    const startedHandler = activePrimaryCta.handlerKey;
    const startedCredits = activePrimaryCta.credits;
    trackPlatformFunnel("cta_click", {
      mode: startedMode,
      handler: startedHandler,
      credits: startedCredits,
      confirmKind: activePrimaryCta.confirmKind,
    });

    ctaInFlightRef.current = true;
    const release = () => {
      ctaInFlightRef.current = false;
    };
    const stillSameMode = () => platformModeRef.current === startedMode;

    try {
      if (startedMode === "trend") {
        if (startedHandler !== "handleTrendStandaloneAnalyze") {
          trackPlatformFunnel("cta_disabled", { mode: "trend", reason: "bad_handler", handler: startedHandler });
          release();
          return;
        }
        void (async () => {
          try {
            if (!stillSameMode()) return;
            await handleTrendStandaloneAnalyze();
            if (!stillSameMode()) return;
            if (workbenchUserKey) {
              pushRecentTask(workbenchUserKey, {
                mode: "trend",
                label: "平台趋势分析",
                credits: startedCredits,
              });
              setRecentTasks(readRecentTasks(workbenchUserKey));
            }
            trackPlatformFunnel("trend_start", { mode: "trend", handler: startedHandler });
          } finally {
            release();
          }
        })();
        return;
      }

      if (startedMode === "tools") {
        if (startedHandler === "customMattingGenerate") {
          void (async () => {
            try {
              if (!stillSameMode()) return;
              await handleGenerateCustomMatting();
              if (!stillSameMode()) return;
              if (workbenchUserKey) {
                pushRecentTask(workbenchUserKey, {
                  mode: "tools",
                  label: "自定义抠像",
                  credits: startedCredits,
                });
                setRecentTasks(readRecentTasks(workbenchUserKey));
              }
            } finally {
              release();
            }
          })();
          return;
        }
        if (startedHandler === "panelLocal") {
          // 页级不代扣、不记虚假成功任务
          document.getElementById("platform-tools-htmlppt")?.scrollIntoView({ behavior: "smooth", block: "start" });
          toast.message("请在下方面板内完成当前步骤（页级不代扣）");
          release();
          return;
        }
        trackPlatformFunnel("cta_disabled", { mode: "tools", reason: "no_page_cta", handler: startedHandler });
        toast.message("请在下方面板内操作");
        release();
        return;
      }

      // create — 严格分支
      if (startedMode !== "create") {
        release();
        return;
      }
      if (startedHandler === "handleAnalyze") {
        void (async () => {
          try {
            if (!stillSameMode()) return;
            await handleAnalyze();
            if (!stillSameMode()) return;
            if (workbenchUserKey) {
              pushRecentTask(workbenchUserKey, {
                mode: "create",
                label: "生成选题与文案",
                credits: startedCredits,
              });
              setRecentTasks(readRecentTasks(workbenchUserKey));
            }
            trackPlatformFunnel("fullcase_start", { mode: "create", handler: startedHandler });
          } finally {
            release();
          }
        })();
        return;
      }
      if (startedHandler === "generateTopicShortlist") {
        void (async () => {
          try {
            if (!stillSameMode()) return;
            await runCreateTopicShortlist();
          } finally {
            release();
          }
        })();
        return;
      }
      if (startedHandler === "noop") {
        setCreateStep("result");
        scrollToPlatformSection("platform-persona-focus");
        release();
        return;
      }
      trackPlatformFunnel("cta_disabled", { mode: "create", reason: "unknown_handler", handler: startedHandler });
      toast.message("当前步骤无可用页级操作");
      release();
    } catch {
      release();
    }
  }, [
    activePrimaryCta,
    platformMode,
    handleTrendStandaloneAnalyze,
    handleGenerateCustomMatting,
    handleAnalyze,
    runCreateTopicShortlist,
    scrollToPlatformSection,
    recordCtaDisabled,
    workbenchUserKey,
  ]);

  const handleRestoreDraft = useCallback(() => {
    if (!workbenchUserKey) {
      toast.message("请先登录后再恢复草稿");
      return;
    }
    const draft = readWorkbenchDraft(workbenchUserKey);
    if (!draft) {
      toast.message("暂无草稿");
      return;
    }
    setFocusPrompt(draft.focusPrompt || "");
    setStructuredPersona(draft.persona || { ...EMPTY_STRUCTURED_PERSONA });
    setFreeformOverride(Boolean(draft.freeformOverride));
    setTopicShortlistCount(draft.topicShortlistCount || PLATFORM_TOPIC_SHORTLIST_DEFAULT);
    setOutputType(draft.outputType || null);
    setCreateStep(draft.createStep || "persona");
    if (Array.isArray(draft.enabledSkillIds) && draft.enabledSkillIds.length) {
      setEnabledPlatformSkillIds(new Set(draft.enabledSkillIds));
    }
    applyPlatformMode(draft.mode || "create", { skipDirtyCheck: true, history: "replace" });
    trackPlatformFunnel("draft_restore", { mode: draft.mode });
    toast.success("已恢复草稿");
  }, [applyPlatformMode, workbenchUserKey]);

  const handleSavePreset = useCallback(() => {
    if (!workbenchUserKey) {
      toast.message("请先登录后再保存预设");
      return;
    }
    const name = window.prompt("预设名称", `配置 ${configPresets.length + 1}`);
    if (!name?.trim()) return;
    const preset: PlatformConfigPreset = {
      id: `p-${Date.now()}`,
      name: name.trim().slice(0, 32),
      savedAt: new Date().toISOString(),
      enabledSkillIds: Array.from(enabledPlatformSkillIds),
      topicShortlistCount,
      outputType: outputType ?? "single_page",
      persona: structuredPersona,
      focusPrompt,
    };
    const next = [preset, ...configPresets].slice(0, 12);
    setConfigPresets(next);
    writeConfigPresets(workbenchUserKey, next);
    writeDefaultSkillIds(workbenchUserKey, preset.enabledSkillIds);
    trackPlatformFunnel("preset_save", { reason: "user_save" });
    toast.success("已保存预设");
  }, [
    configPresets,
    enabledPlatformSkillIds,
    topicShortlistCount,
    outputType,
    structuredPersona,
    focusPrompt,
    workbenchUserKey,
  ]);

  const handleApplyPreset = useCallback(
    (preset: PlatformConfigPreset) => {
      setFocusPrompt(preset.focusPrompt || composeFocusPromptFromPersona(preset.persona));
      setStructuredPersona(preset.persona || { ...EMPTY_STRUCTURED_PERSONA });
      setTopicShortlistCount(preset.topicShortlistCount || PLATFORM_TOPIC_SHORTLIST_DEFAULT);
      setOutputType(preset.outputType || null);
      setEnabledPlatformSkillIds(new Set(preset.enabledSkillIds || []));
      trackPlatformFunnel("preset_apply", { reason: "user_apply" });
      toast.success(`已应用预设「${preset.name}」`);
    },
    [],
  );

  const scrollToTrendVisualReport = useCallback(() => {
    document
      .getElementById("platform-trend-visual-report")
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const stickyCtaNode =
    platformMode === "trend" && visualReportData ? (
      <PlatformTrendReportRail
        data={visualReportData}
        onScrollToFull={scrollToTrendVisualReport}
        onDownload={() => void handleDownloadVisualReport()}
        onRerun={() => void handleTrendStandaloneAnalyze()}
        downloading={isVisualReportDownloading}
      />
    ) : (
      <PlatformStickyCtaRail
        title={platformMode === "trend" ? "趋势分析" : platformMode === "tools" ? "工具操作" : "内容创作"}
        label={activePrimaryCta.label}
        creditsLabel={activePrimaryCta.creditsLabel}
        disabled={activePrimaryCta.disabled}
        disabledReason={activePrimaryCta.disabledReason}
        busy={activePrimaryCta.busy}
        onClick={() => runActivePrimaryCta()}
        onDisabledAttempt={() => recordCtaDisabled()}
      />
    );

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#49e6ff]" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent px-6 text-white">
        <div className="max-w-lg rounded-[28px] border border-[#2b1f52] bg-[#100926]/95 p-8 text-center shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
          <div className="text-sm uppercase tracking-[0.24em] text-[#8cefff]">平台工作台</div>
          <div className="mt-4 text-3xl font-black">需要先登录</div>
          <p className="mt-4 text-sm leading-7 text-[#c8bfe7]">
            平台分析页不会再显示黑屏。当前会自动跳转登录；如果浏览器拦截了跳转，这里也会明确提示，而不是整页空白。
          </p>
          <a
            href={getLoginUrl()}
            className="mt-6 inline-flex items-center justify-center rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(73,230,255,0.18)] transition hover:brightness-110"
          >
            去登录
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent text-[#f7f2ff]">
      <style>{`@keyframes pulseHighlight{0%,95%,100%{box-shadow:none}96%{box-shadow:0 0 0 2px rgba(73,230,255,0.7),0 0 24px rgba(73,230,255,0.3)}98%{box-shadow:0 0 0 3px rgba(127,103,255,0.8),0 0 32px rgba(127,103,255,0.4)}}@keyframes mvspPlatformOrb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(12px,-10px) scale(1.07)}}@keyframes coverGenWaitCarouselProgress{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes platformCarouselProg{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes platformCarouselGlow{0%,100%{opacity:0.4}50%{opacity:0.92}}`}</style>

      <Dialog open={fullAnalysisConfirmOpen} onOpenChange={setFullAnalysisConfirmOpen}>
        <DialogContent className="max-w-lg border border-[#49e6ff]/25 bg-[#0a0618] text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">生成选题前确认</DialogTitle>
            <DialogDescription className="text-[#b7add8]">
              结合人物背景生成{" "}
              {pendingFullAnalysisLabels || PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT}{" "}
              条选题初选，并并行整理平台优先级与可落地商业化建议。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-2xl border border-[#49e6ff]/25 bg-[#49e6ff]/8 px-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#49e6ff]/40 bg-[#49e6ff]/15 text-[#8cefff]">
              <Bot className="h-4 w-4" aria-hidden />
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-white/10 bg-black/35 px-3 py-2.5 text-[12px] leading-relaxed text-gray-200">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8cefff]">智能提醒</p>
              <p>
                本步<strong className="text-white">先出选题初选</strong>
                （不直接写六条文案）；同时后台补齐
                <strong className="text-white">平台优先级</strong>与
                <strong className="text-white">商业化路径</strong>。挑选后再点「就写这条」扩写与出图。
              </p>
              <p className="mt-1.5 text-[#b8f4ff]">
                条数可在选题区改成 25 / 30；当前将生成{" "}
                <strong className="text-white">
                  {pendingFullAnalysisLabels || PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT}
                </strong>{" "}
                条。
              </p>
              <p className="mt-2 text-[10px] leading-snug text-gray-500 whitespace-pre-wrap">
                {PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-50/90">
            预计扣除{" "}
            <strong className="text-[#fef08a]">
              {
                platformTopicShortlistTotalCredits({
                  count: Number(pendingFullAnalysisLabels) || PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT,
                  baseCredits: CREDIT_COSTS.platformTopicShortlist,
                  extraPerTopic: CREDIT_COSTS.platformTopicShortlistExtra,
                }).total
              }{" "}
              积分
            </strong>
            （选题初选；平台优先级与商业化路径含在本步；扩写在「就写这条」时另计）。请勿关闭页面。
          </div>
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setFullAnalysisConfirmOpen(false)}
              className="rounded-full border border-white/15 px-4 py-2 text-[12px] text-gray-300 hover:bg-white/5"
            >
              再想想
            </button>
            <button
              type="button"
              onClick={() => void runFullAnalysisAfterConfirm()}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/35 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-4 py-2 text-[12px] font-semibold text-white"
            >
              <Sparkles className="h-3.5 w-3.5" />
              确认开始选题初选
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="relative mx-auto max-w-[1600px] px-4 py-6 md:px-6 md:py-8">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,rgba(73,230,255,0.08),transparent_55%),radial-gradient(ellipse_at_bottom,rgba(15,10,40,0.9),#07040f_70%)]"
        />
        <PlatformModeShell
          mode={platformMode}
          onModeChange={(m) => applyPlatformMode(m)}
          toolsOpen={toolsMenuOpen}
          onToolsOpenChange={setToolsMenuOpen}
          onToolsPick={(tool) => applyPlatformMode("tools", { toolTab: tool })}
          onHelp={() =>
            toast.message(
              platformMode === "trend"
                ? "平台趋势：单选平台与窗口后点主按钮开始分析（与内容创作分开计费）。"
                : platformMode === "tools"
                  ? "更多工具：动效 PPT、抠像与素材分析；请按面板内步骤操作。"
                  : "内容创作：填写人物背景 → 选题初选 → 文案/分镜；主按钮点数来自当前步骤。",
            )
          }
        />

        {canShowPlatformDebug ? (
          <div className="mb-4 flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                void import("@/components/PlatformProAgentDock").then((m) => m.requestOpenProAgent());
              }}
              className="rounded-full border border-violet-400/40 bg-violet-500/15 px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-violet-100 transition hover:bg-violet-500/25"
            >
              Pro Agent
            </button>
            <button
              type="button"
              onClick={() => setDebugMode((value) => !value)}
              className={`rounded-full border px-4 py-2 text-xs font-semibold uppercase tracking-[0.18em] transition ${
                debugMode
                  ? "border-[#49e6ff]/30 bg-[rgba(73,230,255,0.12)] text-[#8cefff]"
                  : "border-white/10 bg-white/5 text-[#b7add8] hover:bg-white/10"
              }`}
            >
              {debugMode ? "Debug On" : "Debug Off"}
            </button>
          </div>
        ) : null}
        {canShowPlatformDebug && debugMode ? (
          <div className="mb-6 rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff7fd5]">语音输入 Debug Log</div>
              <button onClick={() => setVoiceDebugLog([])} className="text-[10px] text-white/30 hover:text-white/60">清空</button>
            </div>
            {voiceDebugLog.length === 0 ? (
              <div className="mt-3 text-xs text-white/30">暂无记录，点击麦克风按钮开始…</div>
            ) : (
              <div className="mt-3 space-y-1">
                {voiceDebugLog.map((line, i) => (
                  <div key={i} className={`font-mono text-[11px] leading-5 ${line.includes("❌") ? "text-red-400" : line.includes("✅") ? "text-green-400" : "text-[#d7d0ef]"}`}>
                    {line}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {canShowPlatformDebug && debugMode ? (
          <GrowthSystemDebugPanel
            enabled={debugMode}
            pollActive={debugMode}
            growthSnapshotDebug={snapshotDebug}
            growthSnapshotNotes={snapshot?.status?.notes}
            className="mb-6"
          />
        ) : null}
        {canShowPlatformDebug && debugMode ? (
          <div className="mb-6 rounded-2xl border border-[#49e6ff]/30 bg-[rgba(73,230,255,0.06)] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#8cefff]">
                全案选题初选 Debug
              </div>
              <button
                type="button"
                onClick={() => {
                  setShortlistDebugLines([]);
                  setShortlistLastError(null);
                }}
                className="text-[10px] text-white/30 hover:text-white/60"
              >
                清空
              </button>
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[#c9c0e6]/65">
              过程：确认 → 初选（并行：快照→平台优先级看板→商业化路径）→ 勾选扩写 → 文案钉选题下方。
              Fly：generatePlatformTopicShortlist / getPlatformDashboard / generatePlatformMonetizationLanes /
              expandPlatformTopicPicks。
            </p>
            <div className="mt-2 flex flex-wrap gap-3 text-[11px] text-[#b8f4ff]/80">
              <span>shortlistPending={String(generateTopicShortlistMutation.isPending)}</span>
              <span>
                expandPending={String(shortlistExpandBusy)}
                {shortlistExpandProgress
                  ? ` (${shortlistExpandProgress.done}/${shortlistExpandProgress.total})`
                  : ""}
              </span>
              <span>勾选={selectedShortlistIds.length}</span>
              <span>条数档={topicShortlistCount}</span>
              <span>已出={topicShortlist.length}</span>
              {shortlistLastError ? (
                <span className="text-rose-300">lastError={shortlistLastError.slice(0, 120)}</span>
              ) : null}
            </div>
            {shortlistDebugLines.length === 0 ? (
              <div className="mt-3 text-xs text-white/30">暂无记录；点「生成选题」后会写入步骤。</div>
            ) : (
              <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/30 p-3 font-mono text-[11px] leading-5 text-[#d7d0ef]">
                {shortlistDebugLines.join("\n")}
              </pre>
            )}
          </div>
        ) : null}
        {canShowPlatformDebug && debugMode && (manhuaLearnJobPollTrace || manhuaLearnResult) ? (
          <div className="mb-6 rounded-[24px] border border-amber-300/25 bg-amber-500/5 p-5">
            <div className="text-sm font-semibold text-amber-100">AI 漫剧 · 学节奏 Debug</div>
            <p className="mt-1 text-[11px] leading-relaxed text-amber-50/70">
              云端 Job 阶段与错误（下片失败不再静默）。可复制 jobId 对照服务端日志。
            </p>
            {manhuaLearnJobPollTrace ? (
              <div className="mt-3 space-y-2 rounded-2xl border border-amber-300/20 bg-black/25 p-3 text-[11px] text-amber-50/85">
                <div>
                  <span className="text-amber-100/60">label</span> · {manhuaLearnJobPollTrace.label}
                </div>
                <div>
                  <span className="text-amber-100/60">jobId</span> ·{" "}
                  <span className="font-mono text-[#ffdd44]">{manhuaLearnJobPollTrace.jobId}</span>
                </div>
                <div>
                  <span className="text-amber-100/60">轮询</span> · {manhuaLearnJobPollTrace.pollCount} 次
                  {manhuaLearnJobPollTrace.terminalStatus
                    ? ` · 终态 ${manhuaLearnJobPollTrace.terminalStatus}`
                    : " · 进行中"}
                </div>
                {manhuaLearnJobPollTrace.currentStep ? (
                  <div>
                    <span className="text-amber-100/60">当前</span> · {manhuaLearnJobPollTrace.currentStep}
                  </div>
                ) : null}
                {manhuaLearnResult?.errorZh ? (
                  <div className="rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 py-1.5 text-rose-100">
                    错误：{manhuaLearnResult.errorZh}
                  </div>
                ) : null}
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words border-t border-amber-300/15 pt-2 text-[10px] leading-5 text-amber-50/75">
                  {(manhuaLearnJobPollTrace.lines || []).join("\n") || "（尚无轮询行）"}
                </pre>
              </div>
            ) : (
              <div className="mt-3 text-[11px] text-amber-50/60">
                面板有学习结果，但本会话尚未记录 Job 轮询（刷新后需再点一次学节奏才会写入）。
                {manhuaLearnResult?.errorZh ? (
                  <div className="mt-2 rounded-lg border border-rose-300/30 bg-rose-500/10 px-2 py-1.5 text-rose-100">
                    错误：{manhuaLearnResult.errorZh}
                  </div>
                ) : null}
              </div>
            )}
            {(manhuaLearnResult?.progressLines?.length || 0) > 0 ? (
              <div className="mt-3 rounded-2xl border border-white/10 bg-black/20 p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-white/50">
                  面板进度行
                </div>
                <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-[#d7d0ef]">
                  {(manhuaLearnResult?.progressLines || [])
                    .map((l) => `${l.atIso || ""} [${l.stage}] ${l.detailZh}`)
                    .join("\n")}
                </pre>
              </div>
            ) : null}
          </div>
        ) : null}

        {platformMode === "create" ? (
          <div className="mb-4">
            <PlatformDraftPresetsBar
              presets={configPresets}
              recent={recentTasks}
              onSavePreset={handleSavePreset}
              onApplyPreset={handleApplyPreset}
              onRestoreDraft={handleRestoreDraft}
              hasDraft={Boolean(draftMeta)}
              draftSavedAt={draftMeta?.savedAt}
            />
          </div>
        ) : null}

        {/* 三模式分流：仅渲染 active Workbench；state/hooks 留在 PlatformPage */}
        <section
          id="platform-custom-workspace"
          className={`${shellCardClasses("relative overflow-hidden p-5 md:p-6 mb-4 scroll-mt-24")} ${
            platformMode === "create"
              ? "border-[#ff4fb8]/20"
              : platformMode === "trend"
                ? "border-[#49e6ff]/20"
                : "border-[#34d399]/20"
          }`}
        >
          <div className="relative">
            {platformMode === "trend" ? (
              <PlatformTrendWorkbench stickyCta={stickyCtaNode}>
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <TrendingUp className="h-5 w-5 text-[#8cefff]" />
                  <h2 className="text-lg font-black text-white md:text-xl">平台趋势</h2>
                  <span className="rounded-full border border-[#49e6ff]/35 bg-[rgba(73,230,255,0.1)] px-2 py-0.5 text-[10px] font-bold text-[#8cefff]">
                    与内容创作分开计费
                  </span>
                </div>
                <p className="mb-4 text-xs text-[#c9c0e6]/55">
                  单选平台与分析窗口后，使用右侧（或底部）主按钮开始分析。按所选平台与窗口直接出趋势，不依赖人物背景。
                </p>
<div
            id="platform-custom-workspace-trends"
            className="mb-6 rounded-2xl border border-[#49e6ff]/20 bg-[linear-gradient(180deg,rgba(73,230,255,0.08),rgba(12,8,28,0.35))] p-5 scroll-mt-24"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-[#8cefff]" />
                  <h3 className="text-base font-bold text-white md:text-lg">平台趋势分析报表</h3>
                  {platformDashboard && isContentLoading ? (
                    <span className="rounded-full border border-[#c4b5fd]/35 bg-[rgba(196,181,253,0.12)] px-2.5 py-0.5 text-[10px] font-semibold text-[#ddd6fe]">
                      看板已就绪 · 专属文案生成中
                    </span>
                  ) : visualReportData ? (
                    <span className="rounded-full border border-[#6ee7b7]/35 bg-[rgba(52,211,153,0.1)] px-2.5 py-0.5 text-[10px] font-semibold text-[#6ee7b7]">
                      报表已就绪
                    </span>
                  ) : platformDashboard && (isVisualReportLoading || trendStandaloneBusy) ? (
                    <span className="rounded-full border border-[#49e6ff]/35 bg-[rgba(73,230,255,0.1)] px-2.5 py-0.5 text-[10px] font-semibold text-[#8cefff]">
                      看板已出 · 图文报表生成中
                    </span>
                  ) : platformDashboard ? (
                    <span className="rounded-full border border-[#6ee7b7]/35 bg-[rgba(52,211,153,0.1)] px-2.5 py-0.5 text-[10px] font-semibold text-[#6ee7b7]">
                      看板已就绪
                    </span>
                  ) : trendStandaloneBusy || isAnalyzing || isDashboardLoading || isVisualReportLoading ? (
                    <span className="rounded-full border border-[#49e6ff]/35 bg-[rgba(73,230,255,0.1)] px-2.5 py-0.5 text-[10px] font-semibold text-[#8cefff]">
                      生成中
                    </span>
                  ) : (
                    <span className="rounded-full border border-white/15 bg-white/5 px-2.5 py-0.5 text-[10px] font-semibold text-[#c9c0e6]/70">
                      可在此直接启动
                    </span>
                  )}
                </div>
                <p className="mt-1 max-w-2xl text-xs leading-relaxed text-[#c9c0e6]/60">
                  选择一个平台与时间窗口后，后台生成可下载的 PNG 趋势长图；刷新或短暂断线不会取消任务。不含决策智库全景。
                </p>
              </div>
              {platformDashboard ? (
                <button
                  type="button"
                  onClick={() => void scrollToPaidPlatformTrends()}
                  className="text-xs font-semibold text-[#8cefff] underline-offset-4 hover:underline"
                >
                  跳至完整趋势区 ↓
                </button>
              ) : null}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#8cefff]/60">分析窗口</span>
              {WINDOW_OPTIONS.map((item) => {
                const active = item.days === selectedWindowDays;
                return (
                  <button
                    key={`custom-ws-window-${item.days}`}
                    type="button"
                    onClick={() => setSelectedWindowDays(item.days)}
                    disabled={isAnalyzing || isDashboardLoading}
                    title={item.description}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      active
                        ? "border-[#49e6ff]/45 bg-[rgba(73,230,255,0.14)] text-[#8cefff]"
                        : "border-white/10 bg-black/25 text-[#c9c0e6]/70 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-[0.14em] text-[#8cefff]/60">分析平台</span>
              {TREND_PLATFORM_OPTIONS.map((item) => {
                const active = selectedTrendPlatforms.includes(item.key);
                const isComingSoon = Boolean(item.comingSoon);
                return (
                  <button
                    key={`custom-ws-platform-${item.key}`}
                    type="button"
                    onClick={() => {
                      if (isComingSoon) return;
                      setSelectedTrendPlatforms([item.key]);
                    }}
                    disabled={isAnalyzing || isDashboardLoading || isComingSoon}
                    title={isComingSoon ? "即将开放视频号数据抓取" : "单选：点击切换分析平台"}
                    className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                      isComingSoon
                        ? "border-[#fbbf24]/30 bg-[rgba(251,191,36,0.08)] text-[#fef08a]/50"
                        : active
                        ? "border-[#49e6ff]/45 bg-[rgba(73,230,255,0.14)] text-[#8cefff]"
                        : "border-white/10 bg-black/25 text-[#c9c0e6]/70 hover:text-white"
                    }`}
                  >
                    {item.label}{isComingSoon ? " ✦" : ""}
                  </button>
                );
              })}
            </div>

            {canManageWeixinChannelsCollector ? (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3 py-2.5">
                <div>
                  <div className="text-[11px] font-semibold text-emerald-100">视频号本机采集</div>
                  <div className="mt-0.5 text-[10px] text-emerald-100/55">
                    {weixinChannelsCollectorStatusQuery.data?.capture.enabled
                      ? "已开启，等待本机心跳领取任务"
                      : weixinChannelsCollectorStatusQuery.data?.capture.pausedBy === "collector_safety_fuse"
                        ? weixinChannelsCollectorStatusQuery.data.capture.pauseReason === "persistent_black_screen"
                          ? "已安全暂停：连续检测到黑屏"
                          : weixinChannelsCollectorStatusQuery.data.capture.pauseReason === "persistent_same_content"
                            ? "已安全暂停：连续检测到相同内容"
                            : "已安全暂停：采集环境持续异常"
                        : "已暂停，不影响其他平台采集"}
                    {weixinChannelsCollectorStatusQuery.data?.capture.lastHeartbeatAt
                      ? ` · 最近心跳 ${new Date(weixinChannelsCollectorStatusQuery.data.capture.lastHeartbeatAt).toLocaleString()}`
                      : " · 尚无本机心跳"}
                    {` · 待整理 ${weixinChannelsCollectorStatusQuery.data?.accumulatedQualifiedCount ?? 0}/1000`}
                    {` · DeepSeek批次 ${weixinChannelsCollectorStatusQuery.data?.deepseekCompletedBatchCount ?? 0}/${weixinChannelsCollectorStatusQuery.data?.terraCleanupBatchTarget ?? 8} 后 Terra 清洗`}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={setWeixinChannelsCaptureEnabledMutation.isPending || weixinChannelsCollectorStatusQuery.isLoading}
                  onClick={() => setWeixinChannelsCaptureEnabledMutation.mutate({
                    enabled: !Boolean(weixinChannelsCollectorStatusQuery.data?.capture.enabled),
                  })}
                  className={`rounded-full border px-3 py-1.5 text-[11px] font-semibold transition disabled:opacity-50 ${
                    weixinChannelsCollectorStatusQuery.data?.capture.enabled
                      ? "border-emerald-300/40 bg-emerald-400/15 text-emerald-100"
                      : "border-white/15 bg-black/25 text-white/65 hover:text-white"
                  }`}
                >
                  {setWeixinChannelsCaptureEnabledMutation.isPending
                    ? "保存中…"
                    : weixinChannelsCollectorStatusQuery.data?.capture.enabled
                      ? "停止采集"
                      : "开启采集"}
                </button>
              </div>
            ) : null}

            {!platformDashboard &&
            !visualReportData &&
            !trendStandaloneBusy &&
            !isAnalyzing &&
            !isDashboardLoading &&
            !isVisualReportLoading ? (
              <div className="mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTrendStandaloneAnalyze()}
                    disabled={trendStandaloneBusy || enqueueVisualReportMutation.isPending}
                    className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_28px_rgba(73,230,255,0.16)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {trendStandaloneBusy || enqueueVisualReportMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    开始平台趋势分析
                  </button>
                  <span className="rounded-full border border-[#fbbf24]/45 bg-[rgba(251,191,36,0.12)] px-3 py-1.5 text-[11px] font-black tabular-nums text-[#fef08a]">
                    {getPlatformTrendReportCredits(selectedWindowDays)} 积分/次
                  </span>
                  <span className="text-[11px] text-[#c9c0e6]/50">
                    {"含四格趋势摘要与可下载 PNG 长图"}
                  </span>
                </div>
              </div>
            ) : null}

            {(trendStandaloneBusy || isDashboardLoading || isVisualReportLoading || isAnalyzing) &&
            !visualReportData ? (
              <div className="mt-4 rounded-2xl border border-[#49e6ff]/20 bg-[rgba(73,230,255,0.06)] p-4">
                <div className="flex items-center gap-2 text-sm text-[#8cefff]">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  {`后台正在读取近 ${selectedWindowDays} 天样本并生成 PNG 趋势长图；通常约 30–40 秒，刷新后可继续取回…`}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                  <div
                    className={`h-full animate-pulse rounded-full bg-gradient-to-r from-[#49e6ff] via-[#7d73ff] to-[#ff4fb8] ${
                      platformDashboard ? "w-4/5" : "w-2/5"
                    }`}
                  />
                </div>
              </div>
            ) : null}

            {visualReportError && !isVisualReportLoading ? (
              <div className="mt-4 rounded-xl border border-red-400/25 bg-red-400/[0.08] px-4 py-3 text-xs leading-relaxed text-red-100">
                {visualReportError}
              </div>
            ) : null}

            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {resultSummaryCards.map((item, index) => (
                <div key={`custom-ws-trend-${item.label}-${index}`} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                  {item.isLoadingSkeleton ? (
                    <div className="animate-pulse space-y-2">
                      <Loader2 className="h-4 w-4 animate-spin text-[#49e6ff]/50" />
                      <div className="text-sm font-semibold text-white/70">{item.value}</div>
                    </div>
                  ) : (
                    <>
                      <div className="text-[10px] uppercase tracking-[0.16em] text-[#8cefff]/70">{item.label}</div>
                      <div className="mt-2 text-sm font-bold leading-snug text-white">{item.value}</div>
                      <p className="mt-2 text-[11px] leading-relaxed text-[#c9c0e6]/65">{item.detail}</p>
                    </>
                  )}
                </div>
              ))}
            </div>

            {visualReportData ? (
              <div
                id="platform-trend-visual-report"
                className="mt-4 scroll-mt-24 rounded-2xl border border-[#6fffb0]/20 bg-[rgba(111,255,176,0.06)] p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[#6fffb0]">浅色趋势分析报表已就绪</div>
                    <p className="mt-1 text-[11px] text-[#c9c0e6]/60">
                      右侧为摘要卡；下方为完整长图（含蓝海词）。
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDownloadVisualReport()}
                    disabled={isVisualReportDownloading}
                    className="inline-flex items-center gap-2 rounded-full border border-[#6fffb0]/25 bg-[rgba(111,255,176,0.10)] px-4 py-2 text-sm font-semibold text-[#6fffb0] transition hover:bg-[rgba(111,255,176,0.18)] disabled:opacity-60"
                  >
                    {isVisualReportDownloading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4" />
                    )}
                    下载 PNG 图文报表
                  </button>
                </div>
                <div className="mt-3 overflow-x-auto rounded-2xl border border-white/10">
                  <VisualReportTemplate data={visualReportData} ref={visualReportRef} />
                </div>
              </div>
            ) : null}

            {!platformDashboard &&
            !visualReportData &&
            !snapshot &&
            !trendStandaloneBusy &&
            !isAnalyzing &&
            !isDashboardLoading &&
            !isVisualReportLoading ? (
              <p className="mt-4 text-xs leading-relaxed text-[#c9c0e6]/45">
                启动后任务在后台持续生成；完成后右侧出现摘要，下方可下载含蓝海词的 PNG 长图。
              </p>
            ) : null}

            {(() => {
              const byPlatform =
                platformDashboard?.aiManhuaRisingByPlatform
                || (visualReportData as { aiManhuaRisingByPlatform?: PlatformDashboard["aiManhuaRisingByPlatform"] } | null)
                  ?.aiManhuaRisingByPlatform
                || null;
              const douyinBoard: AiManhuaRisingBoardView | null =
                byPlatform?.douyin
                || (platformDashboard?.aiManhuaRising?.entries?.length
                  ? platformDashboard.aiManhuaRising
                  : null)
                || (visualReportData?.aiManhuaRising?.entries?.length
                  ? (visualReportData.aiManhuaRising as AiManhuaRisingBoardView)
                  : null);
              const kuaishouBoard: AiManhuaRisingBoardView | null = byPlatform?.kuaishou || null;
              const rising =
                aiManhuaPlatformTab === "kuaishou" ? kuaishouBoard : douyinBoard;
              const overviewRising = douyinBoard?.entries?.length
                ? douyinBoard
                : kuaishouBoard?.entries?.length
                  ? kuaishouBoard
                  : null;
              const badgeCount =
                (douyinBoard?.entries?.length || 0) + (kuaishouBoard?.entries?.length || 0);
              const fmtPlay = (n: number) =>
                n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n || 0);
              const statusLabel = (s: string) =>
                s === "surging" ? "飙升" : s === "hot" ? "高热" : s === "new" ? "新爆" : "稳态";
              const categoryOf = (row: AiManhuaRisingEntryView) =>
                row.categoryLabelZh
                || (row.dramaKind === "ai_manhua"
                  ? "AI漫剧"
                  : row.dramaKind === "short_drama"
                    ? "短剧合集"
                    : "待判定");
              const kindCounts = (rising?.entries || []).reduce<Record<string, number>>((acc, row) => {
                const k = categoryOf(row);
                acc[k] = (acc[k] || 0) + 1;
                return acc;
              }, {});
              const chartEntries = rising?.entries || [];
              const chartMax = Math.max(
                1,
                ...chartEntries.map((e) => Number(e.risingScore || e.mixPlayCount || 0)),
              );
              const canLearnRow = (row: AiManhuaRisingEntryView) => {
                const u = String(row.url || "").trim();
                if (!u) return false;
                if (/douyin\.com\/search\//i.test(u) || /kuaishou\.com\/search\//i.test(u)) {
                  return false;
                }
                return true;
              };

              return (
                <>
                  <div className="mt-4 inline-flex flex-wrap rounded-xl border border-white/10 bg-black/35 p-0.5 gap-0.5">
                    <button
                      type="button"
                      onClick={() => setTrendInsightTab("overview")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition ${
                        trendInsightTab === "overview"
                          ? "bg-[linear-gradient(135deg,#15c8ff,#6a5cff)] text-white shadow-sm"
                          : "text-[#c9c0e6]/70 hover:text-white"
                      }`}
                    >
                      <BarChart3 className="h-3.5 w-3.5 shrink-0" />
                      指定平台分析
                    </button>
                    <button
                      type="button"
                      onClick={() => setTrendInsightTab("ai_manhua")}
                      className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition ${
                        trendInsightTab === "ai_manhua"
                          ? "bg-[linear-gradient(135deg,#ff4fb8,#c026d3)] text-white shadow-sm"
                          : "text-[#c9c0e6]/70 hover:text-white"
                      }`}
                    >
                      <Film className="h-3.5 w-3.5 shrink-0" />
                      AI 漫剧
                      {badgeCount ? (
                        <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] tabular-nums">
                          {badgeCount}
                        </span>
                      ) : null}
                    </button>
                  </div>

                  {trendInsightTab === "overview" ? (
                    <>
                      {overviewRising?.entries?.length ? (
                        <div className="mt-3 rounded-2xl border border-[#ff4fb8]/20 bg-[rgba(255,79,184,0.05)] px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[12px] font-semibold text-[#ff9fe0]">
                              AI 漫剧摘要 · Top {Math.min(3, overviewRising.entries.length)}
                            </div>
                            <button
                              type="button"
                              onClick={() => setTrendInsightTab("ai_manhua")}
                              className="text-[11px] font-semibold text-[#8cefff] underline-offset-2 hover:underline"
                            >
                              打开 AI 漫剧专区 →
                            </button>
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {overviewRising.entries.slice(0, 3).map((row, idx) => (
                              <span
                                key={row.mixId || idx}
                                className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] text-[#eeeaf8]"
                              >
                                <span className="text-[#c9c0e6]/45">#{idx + 1}</span>
                                <span className="truncate font-medium">{row.mixName}</span>
                                <span className="tabular-nums text-[#3eedff]">{fmtPlay(row.mixPlayCount)}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {visualReportData ? (
                        <p className="mt-3 text-[11px] text-[#c9c0e6]/55">
                          完整浅色长图已在上方「浅色趋势分析报表」区；完整 AI 漫剧榜单见右侧 Tab。
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-[#ff4fb8]/25 bg-[rgba(255,79,184,0.06)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-[#ff9fe0]">
                            {aiManhuaPlatformTab === "kuaishou" ? "快手" : "抖音"} AI 漫剧专区 ·{" "}
                            {rising?.windowDays || selectedWindowDays} 天飙升
                          </div>
                          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[#c9c0e6]/60">
                            {rising?.note
                              || "与总览报表数据同源：抖音/快手采集中的合集与漫剧样本单独聚合。其它种草、口播样本仍在「总览」里。"}
                            {" "}
                            {ownerNativeDeepReadPanel
                              ? "学节奏：按你设置的集数直接建立原生精读任务；模型直接读取视频，每集生成一张待审卡，你批准后才进入正式模板库。"
                              : "学节奏：有成片/合集链时可一点学习；无链仅展示剧名与归类。按集顺序学习你设置的本轮集数，结果在本页展示，你看完再决定是否批准进库。"}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {rising?.entries?.length ? (
                            <button
                              type="button"
                              onClick={() => {
                                const payload = {
                                  exportedAt: new Date().toISOString(),
                                  platform: aiManhuaPlatformTab,
                                  windowDays: rising.windowDays,
                                  note: rising.note,
                                  entries: rising.entries,
                                };
                                const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], {
                                  type: "application/json",
                                });
                                const a = document.createElement("a");
                                a.href = URL.createObjectURL(blob);
                                a.download = `ai-manhua-rising-${aiManhuaPlatformTab}-${new Date().toISOString().slice(0, 10)}.json`;
                                a.click();
                                URL.revokeObjectURL(a.href);
                                toast.success("已导出飙升榜 JSON", {
                                  description:
                                    "备用本机：pnpm run manhua:template-learn -- --rising-json <文件> --rank 1",
                                });
                              }}
                              className="inline-flex items-center gap-1.5 rounded-full border border-[#8cefff]/30 bg-[rgba(140,239,255,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[#8cefff] transition hover:bg-[rgba(140,239,255,0.18)]"
                            >
                              <Download className="h-3.5 w-3.5" />
                              导出学习 JSON
                            </button>
                          ) : null}
                          <a
                            href="/canvas"
                            className="inline-flex items-center gap-1.5 rounded-full border border-[#ff4fb8]/30 bg-[rgba(255,79,184,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[#ff9fe0] transition hover:bg-[rgba(255,79,184,0.18)]"
                          >
                            <Film className="h-3.5 w-3.5" />
                            去漫剧工厂
                          </a>
                        </div>
                      </div>

                      <div className="mt-3 inline-flex rounded-lg border border-white/10 bg-black/35 p-0.5">
                        <button
                          type="button"
                          onClick={() => setAiManhuaPlatformTab("douyin")}
                          className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
                            aiManhuaPlatformTab === "douyin"
                              ? "bg-white/15 text-white"
                              : "text-[#c9c0e6]/65 hover:text-white"
                          }`}
                        >
                          抖音
                          {douyinBoard?.entries?.length ? (
                            <span className="ml-1 tabular-nums text-[#c9c0e6]/50">
                              {douyinBoard.entries.length}
                            </span>
                          ) : null}
                        </button>
                        <button
                          type="button"
                          onClick={() => setAiManhuaPlatformTab("kuaishou")}
                          className={`rounded-md px-3 py-1 text-[11px] font-semibold transition ${
                            aiManhuaPlatformTab === "kuaishou"
                              ? "bg-white/15 text-white"
                              : "text-[#c9c0e6]/65 hover:text-white"
                          }`}
                        >
                          快手
                          {kuaishouBoard?.entries?.length ? (
                            <span className="ml-1 tabular-nums text-[#c9c0e6]/50">
                              {kuaishouBoard.entries.length}
                            </span>
                          ) : null}
                        </button>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#8cefff]/15 bg-[rgba(140,239,255,0.06)] px-3 py-2">
                        <label
                          htmlFor="manhua-learn-batch-size"
                          className="text-[11px] font-semibold text-[#c9c0e6]/90"
                        >
                          单次学习集数
                        </label>
                        <input
                          id="manhua-learn-batch-size"
                          type="number"
                          min={manhuaLearnPipelineMeta.batchMin}
                          max={manhuaLearnPipelineMeta.batchMax}
                          step={1}
                          value={manhuaLearnBatchSize}
                          disabled={Boolean(manhuaLearnBusyKey)}
                          onChange={(event) => {
                            const next = clampManhuaLearnBatchSize(Number(event.target.value));
                            setManhuaLearnBatchSize(next);
                            writeManhuaLearnBatchSize(next);
                          }}
                          className="w-20 rounded-lg border border-white/15 bg-black/40 px-2.5 py-1 text-[11px] tabular-nums text-white disabled:opacity-45"
                        />
                        <span className="text-[10px] text-[#c9c0e6]/50">
                          可选 {manhuaLearnPipelineMeta.batchMin}–{manhuaLearnPipelineMeta.batchMax} 集，默认 {manhuaLearnPipelineMeta.batchDefault}；连续失败 8 集自动停止
                        </span>
                        <span className="rounded-md border border-[#8cefff]/20 bg-black/25 px-2 py-1 text-[10px] font-semibold text-[#8cefff]">
                          学习模型：Gemini 3.1 Pro · 原生视频精读
                        </span>
                      </div>

                      {aiManhuaPlatformTab === "douyin" ? (
                        <div className="mt-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                          <div className="text-[11px] font-semibold text-[#c9c0e6]/90">贴链接学节奏</div>
                          <p className="mt-0.5 text-[10px] text-[#c9c0e6]/45">
                            {ownerTemplateCapabilityPending
                              ? "正在确认可用的学习方式；确认完成前不会建立任务。"
                              : manhuaLearnPipelineMeta.summaryZh}
                          </p>
                          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                            <input
                              type="url"
                              value={manhuaPasteUrl}
                              onChange={(e) => setManhuaPasteUrl(e.target.value)}
                              placeholder="https://… 单集成片或合集页"
                              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/30"
                            />
                            <input
                              type="text"
                              value={manhuaPasteTitle}
                              onChange={(e) => setManhuaPasteTitle(e.target.value)}
                              placeholder="可选剧名"
                              className="w-full rounded-lg border border-white/15 bg-black/40 px-2.5 py-1.5 text-[11px] text-white placeholder:text-white/30 sm:w-36"
                            />
                            <button
                              type="button"
                              disabled={
                                Boolean(manhuaLearnBusyKey)
                                || ownerTemplateCapabilityPending
                                || activeManhuaLearnSources.has(manhuaPasteUrl.trim())
                                || !manhuaPasteUrl.trim()
                              }
                              onClick={() =>
                                void runManhuaTemplateLearnCloud(
                                  {
                                    // 剧名留空让服务端从抖音详情/合集接口回填真剧名，
                                    // 不再传「贴链接学习」占位（会压住回填且写脏进度）
                                    mixName: manhuaPasteTitle.trim(),
                                    url: manhuaPasteUrl.trim(),
                                    platform: "douyin",
                                  },
                                  0,
                                )
                              }
                              className="shrink-0 rounded-lg border border-[#8cefff]/35 bg-[rgba(140,239,255,0.12)] px-3 py-1.5 text-[11px] font-semibold text-[#8cefff] disabled:opacity-45"
                            >
                              {manhuaLearnBusyKey === manhuaPasteUrl.trim()
                                ? "处理中…"
                                : ownerTemplateCapabilityPending
                                  ? "正在确认…"
                                : ownerNativeDeepReadPanel
                                  ? `开始精读 ${manhuaLearnBatchSize} 集`
                                  : `开始学 ${manhuaLearnBatchSize} 集`}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="mt-3 text-[10px] leading-relaxed text-[#c9c0e6]/45">
                          快手榜：有样本链可点开或学节奏；无链时展示剧名、类别与标签，可复制剧名自行查找。
                        </p>
                      )}

                      {manhuaLearnBasket.length > 0 ? (
                        <div className="mt-3 rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2.5">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <label
                              htmlFor="manhua-learn-series-select"
                              className="shrink-0 text-[11px] font-semibold text-amber-50/90"
                            >
                              剧集学习（{manhuaLearnBasket.length}）
                            </label>
                            <select
                              id="manhua-learn-series-select"
                              value={
                                resolvedManhuaLearnFocusSeriesKey
                              }
                              onChange={(event) => selectManhuaLearnBasketItem(event.target.value)}
                              className="min-w-0 flex-1 rounded-lg border border-amber-200/20 bg-black/45 px-2.5 py-1.5 text-[11px] text-amber-50 disabled:opacity-50"
                            >
                              <option value="">选择一部待学习剧</option>
                              {manhuaLearnBasket.map((item) => {
                                const title = String(
                                  item.continuation.row.mixName
                                    || item.result.proposal?.nameZh
                                    || "未命名剧集",
                                ).trim();
                                const pending = typeof item.result.pendingCount === "number"
                                  ? item.result.pendingCount
                                  : "待确认";
                                const status = item.jobStatus === "running"
                                  ? "学习中"
                                  : item.jobStatus === "queued"
                                    ? "排队中"
                                    : item.jobStatus === "failed"
                                      ? "已停止/失败"
                                      : "可续学";
                                return (
                                  <option key={item.seriesKey} value={item.seriesKey}>
                                    {title} · 原生精读 · {status} · 已学 {item.result.learnedCount} · 待学 {pending}
                                  </option>
                                );
                              })}
                            </select>
                            <button
                              type="button"
                              disabled={!manhuaLearnFocusSeriesKey || Boolean(manhuaLearnControlBusy)}
                              onClick={() => void deleteFocusedManhuaLearnSeries()}
                              className="shrink-0 rounded-lg border border-rose-300/30 bg-rose-500/10 px-2.5 py-1.5 text-[10px] font-semibold text-rose-100 hover:bg-rose-500/20 disabled:opacity-40"
                            >
                              {manhuaLearnControlBusy === "delete" ? "正在删除…" : "删除这部剧"}
                            </button>
                          </div>
                          <p className="mt-1.5 text-[10px] text-amber-100/50">
                            每部剧独立续学；刷新后仍保留。删除会停止该剧，但保留已经落盘的成果。
                          </p>
                        </div>
                      ) : null}

                      {ownerNativeDeepReadPanel && resolvedManhuaLearnFocusSeriesKey ? (
                        <div className="mt-3 rounded-xl border border-white/10 bg-black/25 px-3 py-2.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="text-[11px] font-semibold text-[#c9c0e6]/90">
                              占位管理 · 运行中与失败记录
                            </div>
                            <button
                              type="button"
                              onClick={() => setManhuaClaimsPanelOpen((open) => !open)}
                              className="rounded-md border border-white/15 px-2.5 py-1 text-[10px] text-[#c9c0e6] hover:bg-white/10"
                            >
                              {manhuaClaimsPanelOpen ? "收起" : "查看占位"}
                            </button>
                          </div>
                          {manhuaClaimsPanelOpen ? (
                            manhuaClaimsQuery.isLoading ? (
                              <p className="mt-2 text-[10px] text-[#c9c0e6]/50">正在读取占位…</p>
                            ) : manhuaClaimsQuery.isError ? (
                              <p className="mt-2 text-[10px] text-rose-200/80">
                                占位读取失败：{String(manhuaClaimsQuery.error?.message || "").slice(0, 120) || "请稍后重试"}
                              </p>
                            ) : (manhuaClaimsQuery.data?.items.length || 0) === 0 ? (
                              <p className="mt-2 text-[10px] text-[#c9c0e6]/50">
                                这部剧当前没有历史占位，可正常开始学习。
                              </p>
                            ) : (
                              <div className="mt-2 space-y-1.5">
                                <p className="text-[10px] text-[#c9c0e6]/45">
                                  “失败待重跑”不会再挤掉集号，下轮会自动接管并复用已成段；
                                  只有仍在处理的集会暂时隔离。「弃置并设 1 集」不会自动扣费。
                                </p>
                                {(manhuaClaimsQuery.data?.items || []).map((item) => (
                                  <div
                                    key={item.episodeIndex}
                                    className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2.5 py-1.5 text-[10px] text-[#d7d0ef]"
                                  >
                                    <span className="font-semibold">第 {item.episodeIndex} 集</span>
                                    <span className={item.reclaimable ? "text-sky-200/85" : "text-amber-200/85"}>
                                      {item.reclaimable ? "失败待重跑·自动让位" : "疑似仍在处理"}
                                    </span>
                                    <span className="text-[#c9c0e6]/55">
                                      {item.createdAtIso
                                        ? `占位于 ${new Date(item.createdAtIso).toLocaleString("zh-CN", {
                                            month: "2-digit",
                                            day: "2-digit",
                                            hour: "2-digit",
                                            minute: "2-digit",
                                          })}`
                                        : "占位时间未知"}
                                    </span>
                                    <span className={item.spentCny != null ? "text-amber-200/90" : "text-[#c9c0e6]/45"}>
                                      {item.spentCny != null ? `已花 ¥${item.spentCny.toFixed(2)}` : "金额未知"}
                                    </span>
                                    {item.stuckZh ? (
                                      <span
                                        className="min-w-0 flex-1 truncate text-rose-200/75"
                                        title={item.stuckZh}
                                      >
                                        卡点：{item.stuckZh}
                                      </span>
                                    ) : null}
                                    <span className="ml-auto flex shrink-0 gap-1.5">
                                      <button
                                        type="button"
                                        disabled={
                                          !item.claimGeneration
                                          || manhuaClaimBusyEpisode != null
                                          || Boolean(manhuaLearnBusyKey)
                                        }
                                        title={item.claimGeneration ? undefined : "占位版本读取失败，请刷新后重试"}
                                        onClick={() => void discardManhuaClaim(
                                          item.episodeIndex,
                                          item.claimGeneration,
                                          false,
                                        )}
                                        className="rounded-md border border-rose-300/30 px-2 py-0.5 text-rose-100 hover:bg-rose-500/15 disabled:opacity-40"
                                      >
                                        {manhuaClaimBusyEpisode === item.episodeIndex ? "处理中…" : "弃置"}
                                      </button>
                                      <button
                                        type="button"
                                        disabled={
                                          !item.claimGeneration
                                          || manhuaClaimBusyEpisode != null
                                          || Boolean(manhuaLearnBusyKey)
                                        }
                                        title={item.claimGeneration ? undefined : "占位版本读取失败，请刷新后重试"}
                                        onClick={() => void discardManhuaClaim(
                                          item.episodeIndex,
                                          item.claimGeneration,
                                          true,
                                        )}
                                        className="rounded-md border border-sky-300/30 px-2 py-0.5 text-sky-100 hover:bg-sky-500/15 disabled:opacity-40"
                                      >
                                        弃置并设 1 集
                                      </button>
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )
                          ) : null}
                        </div>
                      ) : null}

                      {Object.keys(kindCounts).length > 0 ? (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {Object.entries(kindCounts).map(([label, count]) => (
                            <span
                              key={label}
                              className="rounded-full border border-white/10 bg-black/30 px-2.5 py-1 text-[11px] text-[#c9c0e6]"
                            >
                              {label} · {count}
                            </span>
                          ))}
                        </div>
                      ) : null}

                      {manhuaLearnFocusSeriesKey && manhuaLearnPanelCollapsed ? (
                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300/20 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-50/80">
                          <span>
                            已折叠学习结果
                            {manhuaLearnResult
                              ? ` · 已学完 ${manhuaLearnResult.learnedCount} 集`
                              : ""}
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => setManhuaLearnPanelCollapsed(false)}
                              className="rounded-md border border-amber-300/35 px-2.5 py-1 text-[10px] text-amber-50 hover:bg-amber-500/20"
                            >
                              展开学习结果
                            </button>
                            <button
                              type="button"
                              disabled={Boolean(manhuaLearnBusyKey)}
                              onClick={() => void deleteFocusedManhuaLearnSeries()}
                              className="rounded-md border border-rose-300/30 px-2.5 py-1 text-[10px] text-rose-100 hover:bg-rose-500/15 disabled:opacity-45"
                            >
                              删除这部剧
                            </button>
                          </div>
                        </div>
                      ) : null}

                      {manhuaLearnResult && !manhuaLearnPanelCollapsed ? (
                        <div
                          className={`mt-3 space-y-2 rounded-xl border px-3 py-2.5 text-[11px] ${
                            // 状态色语义（0826 用户点名）：进行中/排队一律蓝色；
                            // 只有真终态失败才红。残留 errorZh 不许把跑着的任务染红。
                            manhuaLearnResult.liveStatus === "running" ||
                            manhuaLearnResult.liveStatus === "queued"
                              ? "border-sky-300/30 bg-sky-500/10 text-sky-50/90"
                              : manhuaLearnResult.errorZh || manhuaLearnResult.liveStatus === "failed"
                                ? "border-rose-300/35 bg-rose-500/10 text-rose-50/90"
                                : manhuaLearnResult.liveStatus === "local"
                                  ? "border-violet-300/30 bg-violet-500/10 text-violet-50/90"
                                  : "border-amber-300/25 bg-amber-500/10 text-amber-50/90"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="font-semibold">
                              {manhuaLearnResult.liveStatus === "running"
                                ? "学习进行中"
                                : manhuaLearnResult.liveStatus === "queued"
                                  ? "排队中"
                                : manhuaLearnResult.liveStatus === "local"
                                  ? "本机学习"
                                  : manhuaLearnResult.errorZh || manhuaLearnResult.liveStatus === "failed"
                                    ? "学习未完成"
                                    : "学习结果"}
                              {manhuaLearnResult.channel === "cloud"
                                ? " · 云端"
                                : manhuaLearnResult.channel === "local"
                                  ? " · 本机"
                                  : ""}
                              {" · 原生精读"}
                              {!manhuaLearnResult.errorZh && manhuaLearnResult.proposal?.nameZh
                                ? ` · ${manhuaLearnResult.proposal.nameZh}`
                                : ""}
                            </div>
                            <button
                              type="button"
                              disabled={Boolean(manhuaLearnBusyKey)}
                              onClick={() => void deleteFocusedManhuaLearnSeries()}
                              className="shrink-0 rounded-md border border-rose-300/30 px-2 py-0.5 text-[10px] font-normal text-rose-100 hover:bg-rose-500/15 disabled:opacity-45"
                            >
                              删除这部剧
                            </button>
                          </div>
                          <p className="text-[10px] opacity-90">
                            当前：{canSeeManhuaLearnTechnicalDetails
                              ? manhuaLearnResult.liveLabelZh
                                || getManhuaLearnSafeProgressLabelZh(manhuaLearnResult)
                              : getManhuaLearnSafeProgressLabelZh(manhuaLearnResult)}
                          </p>
                          {focusedManhuaLearnJobActive ? (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                disabled={
                                  (focusedManhuaLearnServerJob?.status !== "running"
                                    && focusedManhuaLearnBasketItem?.jobStatus !== "running")
                                  || focusedManhuaLearnEpisodeIndex <= 0
                                  || Boolean(manhuaLearnControlBusy)
                                }
                                onClick={() => void skipFocusedManhuaLearnEpisode()}
                                className="rounded-md border border-amber-200/35 bg-amber-400/10 px-2.5 py-1 text-[10px] font-semibold text-amber-50 hover:bg-amber-400/20 disabled:opacity-40"
                              >
                                {manhuaLearnControlBusy === "skip"
                                  ? "正在跳过…"
                                  : focusedManhuaLearnEpisodeIndex > 0
                                    ? `跳过第 ${focusedManhuaLearnEpisodeIndex} 集`
                                    : "等待进入分集"}
                              </button>
                              <button
                                type="button"
                                disabled={Boolean(manhuaLearnControlBusy)}
                                onClick={() => void stopFocusedManhuaLearnJob()}
                                className="rounded-md border border-rose-300/40 bg-rose-500/15 px-2.5 py-1 text-[10px] font-semibold text-rose-50 hover:bg-rose-500/25 disabled:opacity-40"
                              >
                                {manhuaLearnControlBusy === "cancel" ? "正在停止…" : "停止这部剧"}
                              </button>
                              <span className="self-center text-[10px] text-white/45">已落盘内容与静帧不会删除</span>
                            </div>
                          ) : null}
                          {canSeeManhuaLearnTechnicalDetails
                            && (manhuaLearnResult.progressLines?.length || 0) > 0 ? (
                            <ManhuaLearnProgressLogView
                              lines={manhuaLearnResult.progressLines || []}
                            />
                          ) : null}
                          {manhuaLearnResult.errorZh
                            && manhuaLearnResult.liveStatus !== "running"
                            && manhuaLearnResult.liveStatus !== "queued" ? (
                            // 跑着的任务不展示上一轮残留错误，防「进行中却一片红」误读
                            <p className="text-rose-100/80">
                              {canSeeManhuaLearnTechnicalDetails
                                ? manhuaLearnResult.errorZh
                                : "本轮学习未完成，已保留成功进度；请稍后重试。"}
                            </p>
                          ) : null}
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            <button
                              type="button"
                              disabled={manhuaLearnContinueControl.disabled}
                              onClick={() => {
                                const next = manhuaLearnContinueRef.current;
                                if (
                                  !next
                                  || (
                                    typeof manhuaLearnResult.pendingCount === "number"
                                    && manhuaLearnResult.pendingCount <= 0
                                  )
                                ) return;
                                void runManhuaTemplateLearnCloud(next.row, next.rank, next.seriesKey);
                              }}
                              title={manhuaLearnContinueControl.titleZh}
                              className="rounded-full border border-white/15 bg-black/25 px-2 py-0.5 transition enabled:cursor-pointer enabled:hover:border-sky-200/50 enabled:hover:bg-sky-400/15 enabled:hover:text-sky-50 disabled:cursor-default"
                            >
                              {`原生精读 · ${manhuaLearnContinueControl.labelZh}`}
                            </button>
                            <span className="rounded-full border border-emerald-300/30 bg-black/25 px-2 py-0.5 text-emerald-100/85">
                              已学完 {manhuaLearnResult.learnedCount}
                            </span>
                          </div>
                          {(manhuaLearnResult.missingEpisodeCount || 0) > 0
                            && !manhuaLearnMissingDismissedKeys.includes(manhuaLearnResult.seriesKey) ? (
                            <div className="rounded-lg border border-orange-300/35 bg-orange-500/10 px-2.5 py-2 text-orange-50/90">
                              <div className="flex items-start justify-between gap-3">
                                <div>
                                  <p className="font-semibold">
                                    本季尚缺 {manhuaLearnResult.missingEpisodeCount} 集
                                  </p>
                                  <p className="mt-1 text-[10px] text-orange-100/70">
                                    {manhuaLearnResult.paywallStartEpisodeIndex
                                      ? `已确认第 ${manhuaLearnResult.paywallStartEpisodeIndex} 集起需要购买；系统不再尝试付费段，也不计入连续失败。`
                                      : "已识别付费缺集；系统不再尝试，也不计入连续失败。"}
                                    后续可贴同剧名混剪补学；混剪覆盖范围不明确，因此不会自动冒充补齐原集。
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = Array.from(new Set([
                                      ...manhuaLearnMissingDismissedKeys,
                                      manhuaLearnResult.seriesKey,
                                    ]));
                                    setManhuaLearnMissingDismissedKeys(next);
                                    writeManhuaLearnMissingDismissedKeys(manhuaLearnUserKey, next);
                                  }}
                                  className="shrink-0 rounded-md border border-orange-200/30 px-2 py-0.5 text-[10px] hover:bg-orange-400/15"
                                >
                                  删除提示
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {(manhuaLearnResult.categoryLabelZh
                            || (manhuaLearnResult.tagLabelsZh?.length || 0) > 0) ? (
                            <div className="flex flex-wrap gap-1.5">
                              {manhuaLearnResult.categoryLabelZh ? (
                                <span className="rounded-full border border-amber-300/30 bg-amber-500/15 px-2 py-0.5 text-[10px]">
                                  {manhuaLearnResult.categoryLabelZh}
                                </span>
                              ) : null}
                              {(manhuaLearnResult.tagLabelsZh || []).map((tag) => (
                                <span
                                  key={tag}
                                  className="rounded-full border border-white/10 bg-black/25 px-2 py-0.5 text-[10px] text-amber-50/70"
                                >
                                  {tag}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <p className="text-amber-100/70">
                            进度 {manhuaLearnResult.learnedCount} 集
                            {"（一集一张原生精读待审卡）"}
                            {manhuaLearnResult.batchLearned > 0
                              ? ` · 本轮新增 ${manhuaLearnResult.batchLearned}`
                              : " · 云端进度"}
                            {" · 待审卡已直接进入批准区"}
                          </p>
                          {canSeeManhuaLearnTechnicalDetails && manhuaLearnResult.nativeUsage ? (
                            <p className="text-amber-100/55">
                              {manhuaLearnResult.nativeUsage.model} · {
                                manhuaLearnResult.nativeUsage.billingMode === "plan_quota"
                                  ? "套餐额度折算"
                                  : manhuaLearnResult.nativeUsage.billingMode === "payg"
                                    ? "按量计费"
                                    : "计费通道待核"
                              } ¥{manhuaLearnResult.nativeUsage.priceEquivalentCny.toFixed(4)} ·
                              输入 {Math.round(manhuaLearnResult.nativeUsage.inputTokens).toLocaleString()} / 输出 {Math.round(manhuaLearnResult.nativeUsage.outputTokens).toLocaleString()} tokens ·
                              {Math.round(manhuaLearnResult.nativeUsage.elapsedMs / 1000)} 秒
                              {manhuaLearnResult.nativeUsage.receiptComplete ? "" : " · 回执不完整，勿按 0 元对账"}
                              {(manhuaLearnResult.nativeUsage.audioInputTokens || 0) > 0 ? (
                                <span className="mt-0.5 block text-[9px] text-[#c9c0e6]/45">
                                  画面套餐折算 ¥{(manhuaLearnResult.nativeUsage.visualPriceEquivalentCny || 0).toFixed(4)} ·
                                  声音按量 ¥{(manhuaLearnResult.nativeUsage.audioCostCny || 0).toFixed(4)} ·
                                  声音输入 {Math.round(manhuaLearnResult.nativeUsage.audioInputTokens || 0).toLocaleString()} /
                                  输出 {Math.round(manhuaLearnResult.nativeUsage.audioOutputTokens || 0).toLocaleString()} tokens
                                </span>
                              ) : null}
                            </p>
                          ) : null}
                          {ownerTemplateOptimizeAllowed
                            && focusedManhuaNativeModelReceipts.length > 0 ? (
                            <details className="rounded-lg border border-cyan-300/20 bg-black/25 px-2.5 py-2 text-[10px] text-cyan-50/80">
                              <summary className="cursor-pointer font-semibold text-cyan-100/90">
                                逐次模型回执（{focusedManhuaNativeModelReceipts.length}）
                                {focusedManhuaNativeModelReceipts.some((receipt) => receipt.status === "failed")
                                  ? " · 含失败正文"
                                  : ""}
                              </summary>
                              <div className="mt-2 max-h-72 space-y-2 overflow-y-auto pr-1">
                                {[...focusedManhuaNativeModelReceipts].reverse().map((receipt) => {
                                  const providerError = receipt.providerError;
                                  const episodeLabel = receipt.episodeIndexes.length > 0
                                    ? `第 ${receipt.episodeIndexes.join("、")} 集`
                                    : "系列级";
                                  const tokenLabel = typeof receipt.inputTokens === "number"
                                    || typeof receipt.outputTokens === "number"
                                    ? `输入 ${Math.round(receipt.inputTokens || 0).toLocaleString()} / 输出 ${Math.round(receipt.outputTokens || 0).toLocaleString()}`
                                    : "尚无 token 回执";
                                  return (
                                    <div
                                      key={`${receipt.callId}-${receipt.stage}`}
                                      className={`rounded-md border px-2 py-1.5 ${receipt.status === "failed"
                                        ? "border-rose-300/30 bg-rose-500/10"
                                        : receipt.status === "completed"
                                          ? "border-emerald-300/20 bg-emerald-500/5"
                                          : "border-sky-300/20 bg-sky-500/5"}`}
                                    >
                                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-medium">
                                        <span>{nativeModelReceiptStageLabelZh(receipt.stage)}</span>
                                        <span>{nativeModelReceiptStatusLabelZh(receipt.stage, receipt.status)}</span>
                                        <span>{episodeLabel}</span>
                                        {receipt.chunkIndex !== undefined ? (
                                          <span>
                                            {receipt.stage.startsWith("audio_") ? "音轨片" : "分片"}
                                            {` ${receipt.chunkIndex + 1}${receipt.segmentCount ? `/${receipt.segmentCount}` : ""}`}
                                          </span>
                                        ) : null}
                                        {receipt.attemptNumber ? <span>第 {receipt.attemptNumber}/3 次</span> : null}
                                        {typeof receipt.temperature === "number" ? (
                                          <span>temperature {receipt.temperature}</span>
                                        ) : null}
                                        {receipt.variant ? <span>{receipt.variant}</span> : null}
                                      </div>
                                      <div className="mt-1 break-all text-cyan-50/55">
                                        {receipt.model} · {receipt.route}
                                        {receipt.provider ? ` · ${receipt.provider}` : ""}
                                        {` · ${tokenLabel}`}
                                        {typeof receipt.priceEquivalentCny === "number"
                                          ? ` · ¥${receipt.priceEquivalentCny.toFixed(4)}`
                                          : ""}
                                        {typeof receipt.elapsedMs === "number"
                                          ? ` · ${(receipt.elapsedMs / 1000).toFixed(1)} 秒`
                                          : ""}
                                        {receipt.finishReason ? ` · finish=${receipt.finishReason}` : ""}
                                      </div>
                                      {receipt.providerRequestId || providerError?.requestId ? (
                                        <div className="mt-1 break-all font-mono text-[9px] text-cyan-50/45">
                                          request_id={receipt.providerRequestId || providerError?.requestId}
                                        </div>
                                      ) : null}
                                      {receipt.errorZh || providerError ? (
                                        <div className="mt-1.5 rounded border border-rose-200/15 bg-black/25 px-1.5 py-1 text-rose-50/80">
                                          {receipt.errorZh ? <p className="whitespace-pre-wrap break-words">{receipt.errorZh}</p> : null}
                                          {providerError ? (
                                            <p className="mt-0.5 break-words text-rose-100/65">
                                              {providerError.httpStatus ? `HTTP ${providerError.httpStatus}` : "上游错误"}
                                              {providerError.code ? ` · code=${providerError.code}` : ""}
                                              {providerError.type ? ` · type=${providerError.type}` : ""}
                                              {providerError.param ? ` · param=${providerError.param}` : ""}
                                              {providerError.message ? ` · ${providerError.message}` : ""}
                                            </p>
                                          ) : null}
                                          {providerError?.responseBody ? (
                                            <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-all rounded bg-black/35 p-1 font-mono text-[9px] text-rose-100/55">
                                              {providerError.responseBody}
                                            </pre>
                                          ) : null}
                                        </div>
                                      ) : null}
                                    </div>
                                  );
                                })}
                              </div>
                            </details>
                          ) : null}
                          {manhuaLearnResult.liveStatus === "succeeded"
                            && (manhuaLearnResult.pendingCount || 0) > 0
                            && manhuaLearnContinueRef.current
                            && manhuaLearnContinueDismissedKey !== manhuaLearnResult.seriesKey ? (
                            <div className="rounded-lg border border-sky-300/25 bg-sky-500/10 px-2.5 py-2 text-sky-50/90">
                              <p>
                                本轮 {manhuaLearnResult.batchLearned || "已选"} 集已全部落盘，合集仍有{" "}
                                {manhuaLearnResult.pendingCount} 集。是否继续学习下一批？
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  disabled={
                                    Boolean(manhuaLearnBusyKey) || focusedManhuaLearnJobActive
                                  }
                                  onClick={() => {
                                    const next = manhuaLearnContinueRef.current;
                                    if (!next) return;
                                    void runManhuaTemplateLearnCloud(next.row, next.rank, next.seriesKey);
                                  }}
                                  className="rounded-md border border-sky-200/40 bg-sky-400/20 px-2.5 py-1 font-semibold text-sky-50 hover:bg-sky-400/30 disabled:opacity-45"
                                >
                                  继续学 {manhuaLearnBatchSize} 集
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setManhuaLearnContinueDismissedKey(manhuaLearnResult.seriesKey)}
                                  className="rounded-md border border-white/15 bg-black/20 px-2.5 py-1 text-white/70 hover:text-white"
                                >
                                  本轮先到这里
                                </button>
                              </div>
                            </div>
                          ) : null}
                          {canSeeManhuaLearnTechnicalDetails && manhuaLearnResult.messageZh ? (
                            <p className="text-amber-100/60">{manhuaLearnResult.messageZh}</p>
                          ) : null}
                          {manhuaLearnResult.digestsPreview.length > 0 ? (
                            <div className="max-h-96 space-y-2 overflow-y-auto rounded-lg border border-amber-300/15 bg-black/20 px-2 py-1.5 text-[10px] text-amber-50/80">
                              <div className="font-semibold text-amber-100/90">
                                分集摘要（本页即时可见）
                              </div>
                              {manhuaLearnResult.digestsPreview.map((d) => (
                                <div
                                  key={`${d.episodeIndex}-${d.title}`}
                                  className="border-t border-white/5 pt-1"
                                >
                                  <span className="font-medium">第{d.episodeIndex}集</span>
                                  <span className={`ml-1 ${d.complete ? "text-emerald-200/70" : "text-sky-200/70"}`}>
                                    · {d.complete ? "已落盘" : `学习中 ${Math.round((Number(d.learnedThroughSec) || 0) / 60)} 分`}
                                  </span>
                                  {d.title ? ` · ${d.title}` : ""}
                                  {d.categoryLabelZh ? (
                                    <span className="ml-1 text-amber-100/45">
                                      · {d.categoryLabelZh}
                                      {(d.tagLabelsZh || []).length
                                        ? ` · ${(d.tagLabelsZh || []).join(" / ")}`
                                        : ""}
                                    </span>
                                  ) : null}
                                  {d.hookNoteZh ? (
                                    <div className="text-amber-100/55">钩子：{d.hookNoteZh}</div>
                                  ) : null}
                                  {d.transcriptPreview ? (
                                    <div className="line-clamp-2 text-amber-100/40">
                                      {d.transcriptPreview}
                                    </div>
                                  ) : null}
                                  {(d.previewFrameUrls || []).length ? (
                                    <div className="mt-1 grid grid-cols-3 gap-1.5">
                                      {(d.previewFrameUrls || []).map((url, frameIndex) => (
                                        <a key={`${url}-${frameIndex}`} href={url} target="_blank" rel="noreferrer">
                                          <img
                                            src={url}
                                            alt={`第${d.episodeIndex}集代表帧${frameIndex + 1}`}
                                            loading="lazy"
                                            className="aspect-video w-full rounded border border-white/10 object-cover"
                                          />
                                        </a>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ))}
                            </div>
                          ) : null}
                          {manhuaLearnResult.proposal ? (
                            <div className="rounded-lg border border-amber-300/30 bg-amber-500/15 px-2.5 py-2">
                              <div className="font-semibold">
                                总分析提案 · {manhuaLearnResult.proposal.nameZh}
                                <span className="ml-2 font-normal text-amber-100/55">
                                  {manhuaLearnResult.proposal.laneZh}
                                </span>
                              </div>
                              {manhuaLearnResult.proposal.hook3sZh ? (
                                <p className="mt-1 text-amber-100/70">
                                  钩子：{manhuaLearnResult.proposal.hook3sZh}
                                </p>
                              ) : null}
                              {manhuaLearnResult.proposal.summaryZh ? (
                                <p className="mt-1 text-[10px] text-amber-100/55">
                                  {manhuaLearnResult.proposal.summaryZh}
                                </p>
                              ) : null}
                              <p className="mt-1 text-[10px] text-amber-100/50">
                                这份提案已进入下方「待批准入库」下拉；未批准不会进入编剧室可选库。
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() => setManhuaLearnPanelCollapsed(true)}
                                  className="rounded-md border border-white/15 px-2.5 py-1 text-[10px] text-white/60 hover:bg-white/5"
                                >
                                  收起面板
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setManhuaLearnPanelCollapsed(true)}
                                className="rounded-md border border-white/15 px-2.5 py-1 text-[10px] text-white/60 hover:bg-white/5"
                              >
                                收起面板
                              </button>
                            </div>
                          )}
                        </div>
                      ) : null}

                      {manhuaViralApprovedQuery.data?.groups?.length ? (
                        <div className="mt-3 rounded-xl border border-emerald-400/20 bg-emerald-500/10 px-3 py-2.5 text-[10px] text-emerald-50/85">
                          <div className="mb-1 font-semibold text-emerald-50/95">
                            模板库（已批准 · 编剧室可选）
                          </div>
                          <p className="mb-2 text-[10px] leading-4 text-emerald-50/55">
                            学习提案批准后会出现在此；到 /canvas 编剧室点选即可注入节奏骨架。
                          </p>
                          <div className="space-y-2">
                            {manhuaViralApprovedQuery.data.groups.map((group) => (
                              <div key={group.laneZh}>
                                <div className="mb-1 text-[10px] font-semibold text-emerald-100/50">
                                  {group.laneZh}
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {group.items.map((tpl) => {
                                    const nativeProgressBadge = buildApprovedNativeTemplateBadge(
                                      readApprovedNativeTemplateProgress(tpl),
                                    );
                                    return (
                                    <div
                                      key={tpl.id}
                                      title={tpl.summaryZh}
                                      className="flex flex-wrap items-center gap-1.5 rounded-lg border border-emerald-300/25 bg-black/25 px-2 py-1 text-[10px] text-emerald-50/80"
                                    >
                                      <span className="font-semibold">{tpl.nameZh}</span>
                                      {isNativeVideoLearnedTemplate(tpl) ? (
                                        <span
                                          title="原生视频精读：含逐镜构图、运镜、角色站位、肢体/道具、微表情、视线呼吸、关系反应、光影与转场证据"
                                          className="shrink-0 rounded border border-cyan-300/45 bg-cyan-400/15 px-1 text-[9px] font-bold text-cyan-100"
                                        >
                                          🎬 精读
                                        </span>
                                      ) : (
                                        <span
                                          title="抽帧学习（旧形态）：只有节拍三栏，没有运镜/转场——这些是帧间差分，抽帧学不到"
                                          className="shrink-0 rounded border border-white/15 bg-white/[0.04] px-1 text-[9px] text-white/40"
                                        >
                                          抽帧
                                        </span>
                                      )}
                                      {nativeProgressBadge ? (
                                        <span className="shrink-0 rounded border border-emerald-300/30 bg-emerald-400/10 px-1 text-[9px] font-semibold text-emerald-100">
                                          {nativeProgressBadge}
                                        </span>
                                      ) : null}
                                      {ownerTemplateOptimizeAllowed ? (
                                        <>
                                          <select
                                            aria-label={`优化模型：${tpl.nameZh}`}
                                            value={ownerTemplateOptimizeModel}
                                            onChange={(event) => {
                                              setOwnerTemplateOptimizeModel(
                                                event.target.value as ManhuaViralTemplateOptimizeModel,
                                              );
                                              setOwnerTemplateOptimizeResult(null);
                                            }}
                                            onClick={(event) => event.stopPropagation()}
                                            className="max-w-[190px] rounded-md border border-emerald-200/15 bg-black/55 px-1.5 py-0.5 text-[9px] text-emerald-50 outline-none"
                                          >
                                            {ownerTemplateOptimizeModels.map((model) => (
                                              <option key={model.id} value={model.id}>{model.labelZh}</option>
                                            ))}
                                          </select>
                                          <button
                                            type="button"
                                            onClick={() => openOwnerTemplateDetail(tpl.id)}
                                            className="rounded-md border border-amber-300/25 bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-100 hover:bg-amber-400/15"
                                          >
                                            查看
                                          </button>
                                          <button
                                            type="button"
                                            title="下架＝移入归档，文件保留可恢复，不是物理删除"
                                            disabled={archiveManhuaTemplateMutation.isPending}
                                            onClick={async () => {
                                              if (archiveConfirmId !== tpl.id) {
                                                setArchiveConfirmId(tpl.id);
                                                window.setTimeout(() => {
                                                  setArchiveConfirmId((cur) => (cur === tpl.id ? "" : cur));
                                                }, 5000);
                                                return;
                                              }
                                              setArchiveConfirmId("");
                                              try {
                                                await archiveManhuaTemplateMutation.mutateAsync({
                                                  id: tpl.id,
                                                  confirmArchive: true,
                                                });
                                                void manhuaViralApprovedQuery.refetch();
                                                // 编剧室（/canvas）读的是 listApprovedPublic，跨页面拿不到实例，
                                                // 失效缓存让它下次挂载时重新拉，否则下架的模板还能被选中
                                                void trpcUtils.manhuaViralTemplate.listProposals.invalidate();
                                                // 下架同时产生新归档版本，体检结论与归档列表都要重算
                                                await invalidateTemplateLifecycle(tpl.id);
                                              } catch (e) {
                                                window.alert(
                                                  `下架失败：${e instanceof Error ? e.message : "未知错误"}`,
                                                );
                                              }
                                            }}
                                            className={`rounded-md border px-2 py-0.5 font-semibold transition disabled:opacity-45 ${
                                              archiveConfirmId === tpl.id
                                                ? "border-rose-300/60 bg-rose-500/25 text-rose-50"
                                                : "border-white/15 bg-white/[0.04] text-white/55 hover:border-rose-300/40 hover:text-rose-100"
                                            }`}
                                          >
                                            {archiveConfirmId === tpl.id ? "再点一次确认下架" : "下架"}
                                          </button>
                                        </>
                                      ) : null}
                                    </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : null}

                      {/* 换代体检：学习方式升级后，库里同时躺着抽帧卡与精读卡。
                          淘汰谁的前提是先看得出谁是旧的 —— 只给建议，不自动执行。
                          整块仅 owner 可见：入口不该先露出来、点了才被服务端拒。 */}
                      {ownerTemplateOptimizeAllowed ? (
                      <div className="mt-3 rounded-xl border border-white/12 bg-black/25 p-3">
                        <button
                          type="button"
                          onClick={() => setTemplateReviewOpen((v) => !v)}
                          className="text-[11px] font-semibold text-cyan-100/80 hover:text-cyan-50"
                        >
                          {templateReviewOpen ? "收起换代体检" : "换代体检：哪些还是旧学法学的"}
                        </button>
                        {templateReviewOpen ? (
                          <div className="mt-2 space-y-1.5">
                            {templateReviewQuery.isLoading ? (
                              <p className="text-[10px] text-white/40">体检中…</p>
                            ) : null}
                            {/* 读取失败不能渲染成「没问题」——空结论会被当成体检通过 */}
                            {templateReviewQuery.isError ? (
                              <p className="text-[10px] text-rose-200/80">
                                体检读取失败，请稍后重试；当前结果不能视为库里没有旧卡。
                              </p>
                            ) : null}
                            {(templateReviewQuery.data?.items || []).map((it) => (
                              <div
                                key={it.id}
                                className={`rounded-lg border px-2.5 py-2 text-[10px] leading-4 ${
                                  it.action === "replace_with"
                                    ? "border-amber-300/35 bg-amber-500/[0.06] text-amber-50/85"
                                    : it.action === "consider_relearn"
                                      ? "border-white/12 bg-white/[0.03] text-white/60"
                                      : "border-emerald-300/25 bg-emerald-500/[0.05] text-emerald-50/75"
                                }`}
                              >
                                <div className="font-semibold">
                                  {it.nameZh}
                                  <span className="ml-1.5 font-normal opacity-60">
                                    {it.laneZh} · {it.beatCount} 镜
                                  </span>
                                </div>
                                {it.learnSourceZh ? (
                                  <div className="opacity-70">学习来源｜{it.learnSourceZh}</div>
                                ) : null}
                                <div className="mt-0.5">{it.reasonZh}</div>
                                <div className="mt-1 flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setArchivedForId(archivedForId === it.id ? null : it.id)
                                    }
                                    className="underline underline-offset-2 opacity-70 hover:opacity-100"
                                  >
                                    {archivedForId === it.id ? "收起历史版本" : "看历史版本"}
                                  </button>
                                  {it.sameLaneApprovedCount <= 1 ? (
                                    <span className="opacity-55">
                                      本赛道仅此一张，下架会让编剧室选不出模板
                                    </span>
                                  ) : null}
                                </div>
                                {archivedForId === it.id ? (
                                  <div className="mt-1.5 space-y-1 border-t border-white/10 pt-1.5">
                                    {archivedVersionsQuery.isLoading ? (
                                      <p className="opacity-50">读取归档…</p>
                                    ) : null}
                                    {/* 读取失败 ≠ 没有历史版本：说成「没有」会让用户以为旧版丢了 */}
                                    {archivedVersionsQuery.isError ? (
                                      <p className="text-rose-200/80">
                                        归档读取失败，请稍后重试；当前结果不能视为没有历史版本。
                                      </p>
                                    ) : null}
                                    {(archivedVersionsQuery.data?.items || []).length === 0
                                    && !archivedVersionsQuery.isLoading
                                    && !archivedVersionsQuery.isError ? (
                                      <p className="opacity-50">还没有归档版本</p>
                                    ) : null}
                                    {(archivedVersionsQuery.data?.items || []).map((v) => (
                                      <div
                                        key={v.generation}
                                        className="flex items-center gap-2"
                                      >
                                        <span className="min-w-0 flex-1 truncate opacity-75">
                                          {v.beatCount} 镜 · {v.learnSourceZh || "来源不明"} ·{" "}
                                          {String(v.updatedAt || "").slice(0, 10)}
                                        </span>
                                        <button
                                          type="button"
                                          disabled={restoreArchivedMutation.isPending}
                                          onClick={async () => {
                                            if (
                                              !window.confirm(
                                                `恢复这一版为正式模板？\n库里已有同 id 的现役版本时会被拒绝——那时请先下架现役版本。`,
                                              )
                                            )
                                              return;
                                            try {
                                              await restoreArchivedMutation.mutateAsync({
                                                id: it.id,
                                                generation: v.generation,
                                                confirmRestore: true,
                                              });
                                              await invalidateTemplateLifecycle(it.id);
                                              window.alert("已恢复为正式模板");
                                            } catch (e) {
                                              window.alert(
                                                `恢复失败：${e instanceof Error ? e.message : "未知错误"}`,
                                              );
                                            }
                                          }}
                                          className="shrink-0 rounded border border-white/15 px-1.5 py-0.5 hover:border-cyan-300/40 hover:text-cyan-100 disabled:opacity-40"
                                        >
                                          恢复这一版
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                ) : null}
                              </div>
                            ))}

                            {/* 独立归档区：**不依赖 approved 行存在**。
                                恢复入口原来嵌在现役卡里，模板一下架就从 approved 消失、
                                恢复入口跟着消失 —— 等于下架即不可逆。 */}
                            {(templateReviewQuery.data?.archivedItems || []).length ? (
                              <div className="mt-3 border-t border-white/10 pt-2">
                                <p className="mb-1.5 text-[10px] font-semibold text-white/50">
                                  已归档模板（已下架，可恢复）
                                </p>
                                {(templateReviewQuery.data?.archivedItems || []).map((arch) => (
                                  <div
                                    key={arch.id}
                                    className="mb-1 rounded-lg border border-white/12 bg-black/20 px-2.5 py-2 text-[10px] leading-4 text-white/70"
                                  >
                                    <div className="flex items-center gap-2">
                                      <span className="min-w-0 flex-1 truncate">
                                        {arch.nameZh} · {arch.laneZh} · {arch.beatCount} 镜
                                        {arch.learnSourceZh ? ` · ${arch.learnSourceZh}` : ""}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setArchivedForId(archivedForId === arch.id ? null : arch.id)
                                        }
                                        className="shrink-0 text-cyan-100/80 hover:text-cyan-50"
                                      >
                                        {archivedForId === arch.id ? "收起历史版本" : "看历史版本"}
                                      </button>
                                    </div>
                                    {archivedForId === arch.id ? (
                                      <div className="mt-1.5 space-y-1 border-t border-white/10 pt-1.5">
                                        {archivedVersionsQuery.isLoading ? (
                                          <p className="opacity-50">读取归档…</p>
                                        ) : null}
                                        {archivedVersionsQuery.isError ? (
                                          <p className="text-rose-200/80">
                                            归档读取失败，请稍后重试；当前结果不能视为没有历史版本。
                                          </p>
                                        ) : null}
                                        {(archivedVersionsQuery.data?.items || []).map((v) => (
                                          <div key={v.generation} className="flex items-center gap-2">
                                            <span className="min-w-0 flex-1 truncate opacity-75">
                                              {v.beatCount} 镜 · {v.learnSourceZh || "来源不明"} ·{" "}
                                              {String(v.updatedAt || "").slice(0, 10)}
                                            </span>
                                            <button
                                              type="button"
                                              disabled={restoreArchivedMutation.isPending}
                                              onClick={async () => {
                                                if (
                                                  !window.confirm(
                                                    "恢复这一版为正式模板？库里已有同 id 的现役版本时会被拒绝——那时请先下架现役版本。",
                                                  )
                                                )
                                                  return;
                                                try {
                                                  await restoreArchivedMutation.mutateAsync({
                                                    id: arch.id,
                                                    generation: v.generation,
                                                    confirmRestore: true,
                                                  });
                                                  await invalidateTemplateLifecycle(arch.id);
                                                  window.alert("已恢复为正式模板");
                                                } catch (e) {
                                                  window.alert(
                                                    `恢复失败：${e instanceof Error ? e.message : "未知错误"}`,
                                                  );
                                                }
                                              }}
                                              className="shrink-0 rounded border border-emerald-300/35 px-1.5 py-0.5 text-emerald-100/85 hover:bg-emerald-500/10 disabled:opacity-50"
                                            >
                                              恢复这一版
                                            </button>
                                          </div>
                                        ))}
                                      </div>
                                    ) : null}
                                  </div>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                      ) : null}

                      {ownerTemplateOptimizeAllowed ? (
                        <ManhuaApprovedTemplateOwnerDrawer
                          open={Boolean(ownerTemplateDetailId)}
                          detail={ownerTemplateDetailQuery.data?.card || null}
                          detailLoading={ownerTemplateDetailQuery.isLoading}
                          models={ownerTemplateOptimizeModels}
                          selectedModel={ownerTemplateOptimizeModel}
                          promptZh={ownerTemplateOptimizePrompt}
                          optimizePending={ownerTemplateOptimizeMutation.isPending}
                          result={ownerTemplateOptimizeResult}
                          onClose={() => {
                            setOwnerTemplateDetailId(null);
                            setOwnerTemplateOptimizeResult(null);
                          }}
                          onModelChange={(model) => {
                            setOwnerTemplateOptimizeModel(model);
                            setOwnerTemplateOptimizeResult(null);
                          }}
                          onPromptChange={(value) => {
                            setOwnerTemplateOptimizePrompt(value);
                            setOwnerTemplateOptimizeResult(null);
                          }}
                          onOptimize={() => void runOwnerTemplateOptimize()}
                        />
                      ) : null}

                      {pendingManhuaViralProposals.length > 0 && selectedManhuaProposal ? (
                        <div className="mt-3 rounded-xl border border-[#8cefff]/20 bg-[rgba(140,239,255,0.07)] px-3 py-2.5 text-[10px] text-[#c9c0e6]/70">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                            <label
                              htmlFor="manhua-proposal-select"
                              className="shrink-0 font-semibold text-[#c9c0e6]/90"
                            >
                              待批准入库（{pendingManhuaViralProposals.length}）
                            </label>
                            <select
                              id="manhua-proposal-select"
                              value={selectedManhuaProposal.id}
                              onChange={(event) => setSelectedManhuaProposalId(event.target.value)}
                              className="min-w-0 flex-1 rounded-lg border border-white/15 bg-black/45 px-2.5 py-1.5 text-[11px] text-white"
                            >
                              {pendingManhuaViralProposals.map((proposal) => {
                                const approvedProgress = readApprovedNativeTemplateProgress(
                                  approvedManhuaTemplateById.get(proposal.id),
                                );
                                const progressCopy = buildPendingNativeTemplateProgressCopy({
                                  id: proposal.id,
                                  progress: proposal.nativeProgress,
                                  approvedSuccessSegments: approvedProgress?.successSegments,
                                });
                                return (
                                  <option key={proposal.id} value={proposal.id}>
                                    {proposal.nameZh} · {proposal.laneZh}
                                    {proposal.revisionOf ? " · 优化修订" : ""}
                                    {progressCopy ? ` · ${progressCopy.optionSuffixZh}` : ""}
                                  </option>
                                );
                              })}
                            </select>
                            <button
                              type="button"
                              disabled={approveManhuaViralTemplateMutation.isPending}
                              onClick={() =>
                                void approveManhuaLearnProposal(
                                  selectedManhuaProposal.id,
                                  selectedManhuaProposal.nameZh,
                                  selectedManhuaProposal.revisionOf,
                                )
                              }
                              className="shrink-0 rounded-lg border border-[#8cefff]/30 bg-[rgba(140,239,255,0.1)] px-2.5 py-1.5 font-semibold text-[#8cefff] disabled:opacity-50"
                            >
                              {approveManhuaViralTemplateMutation.isPending
                                ? "处理中…"
                                : selectedManhuaProposal.revisionOf
                                  ? "批准替换原版"
                                  : selectedManhuaProposalProgressCopy?.approveButtonZh || "批准入库"}
                            </button>
                          </div>
                          {selectedManhuaProposalProgressCopy ? (
                            <p className="mt-2 rounded-lg border border-cyan-300/20 bg-cyan-300/[0.06] px-2.5 py-2 text-[10px] font-semibold leading-relaxed text-cyan-100/80">
                              {selectedManhuaProposalProgressCopy.detailZh}
                            </p>
                          ) : null}
                          {selectedManhuaProposal.hook3sZh ? (
                            <p className="mt-2 text-[#c9c0e6]/65">
                              钩子：{selectedManhuaProposal.hook3sZh}
                            </p>
                          ) : null}
                          {selectedManhuaProposal.summaryZh ? (
                            <p className="mt-1 line-clamp-2 text-[#c9c0e6]/45">
                              {selectedManhuaProposal.summaryZh}
                            </p>
                          ) : null}
                          {selectedManhuaProposal.revisionOf && selectedManhuaProposal.reasons?.length ? (
                            <div className="mt-2 space-y-1 rounded-lg border border-amber-300/15 bg-amber-400/[0.05] px-2.5 py-2 text-amber-100/70">
                              {selectedManhuaProposal.reasons.map((reason) => (
                                <p key={reason.field}>{reason.field}：{reason.reasonZh}</p>
                              ))}
                            </div>
                          ) : null}
                          {/* 审批可见性：批准前把学到的结构摊开，不让人盲批 */}
                          {selectedManhuaProposal.beatGrid?.length ||
                          selectedManhuaProposal.learnSourceZh ||
                          selectedManhuaProposal.classification ||
                          selectedManhuaProposal.reusableZh ||
                          selectedManhuaProposal.genPromptHintZh ||
                          selectedManhuaProposal.storyStructure ||
                          selectedManhuaProposal.audioStory ||
                          selectedManhuaProposal.subtitleTrack?.length ||
                          selectedManhuaProposal.scenePoolHints?.length ||
                          selectedManhuaProposal.castShape ||
                          selectedManhuaProposal.densityHints ? (
                            <details
                              open
                              className="mt-2 rounded-lg border border-white/12 bg-black/25 px-2.5 py-2"
                            >
                              <summary className="cursor-pointer select-none text-[11px] font-semibold text-white/70">
                                学到的结构（批准前请看完）
                                {selectedManhuaProposal.beatGrid?.length
                                  ? ` · ${selectedManhuaProposal.beatGrid.length} 个节拍`
                                  : ""}
                                {selectedManhuaProposal.sourceRefCount
                                  ? ` · 来源 ${selectedManhuaProposal.sourceRefCount} 条`
                                  : ""}
                              </summary>
                              {/* 来源摘要：精读卡与抽帧卡门槛差很多，批准前必须能分辨；
                                  丢镜与触顶抽稀也在这行，静默少几个镜头比整体失败更难发现 */}
                              {selectedManhuaProposal.learnSourceZh ? (
                                <div className="mt-2 text-[10px] leading-relaxed text-[#8cefff]/70">
                                  <span className="text-white/45">学习来源｜</span>
                                  {selectedManhuaProposal.learnSourceZh}
                                </div>
                              ) : null}
                              {selectedManhuaProposal.classification ? (
                                <div className="mt-2 text-[10px] leading-relaxed text-[#8cefff]/70">
                                  <span className="text-white/45">多维特征｜</span>
                                  {Object.values(selectedManhuaProposal.classification)
                                    .flat()
                                    .filter(Boolean)
                                    .join(" · ")}
                                </div>
                              ) : null}
                              {selectedManhuaProposal.storyStructure ? (
                                <div className="mt-2 space-y-1 rounded-lg border border-fuchsia-300/10 bg-fuchsia-300/[0.04] px-2 py-2 text-[10px] leading-relaxed text-[#c9c0e6]/65">
                                  <div>
                                    <span className="text-white/45">核心故事承诺｜</span>
                                    {selectedManhuaProposal.storyStructure.corePromiseZh}
                                  </div>
                                  <div>
                                    <span className="text-white/45">持续冲突引擎｜</span>
                                    {selectedManhuaProposal.storyStructure.conflictEngineZh}
                                  </div>
                                  <div>
                                    <span className="text-white/45">关系变化引擎｜</span>
                                    {selectedManhuaProposal.storyStructure.relationshipEngineZh}
                                  </div>
                                  <div>
                                    <span className="text-white/45">跨集推进规律｜</span>
                                    {selectedManhuaProposal.storyStructure.episodeProgressionZh.join("；")}
                                  </div>
                                  <div>
                                    <span className="text-white/45">避免重复规则｜</span>
                                    {selectedManhuaProposal.storyStructure.variationRulesZh.join("；")}
                                  </div>
                                </div>
                              ) : (
                                <div className="mt-2 rounded-lg border border-amber-300/10 bg-amber-300/[0.04] px-2 py-1.5 text-[10px] leading-relaxed text-amber-100/55">
                                  故事骨架｜旧卡未记录五项系列骨架；下方继续展示已有节拍、角色与可复用手法，批准前请按旧卡证据判断。
                                </div>
                              )}
                              {selectedManhuaProposal.reusableZh ? (
                                <div className="mt-2 text-[10px] leading-relaxed text-[#c9c0e6]/60">
                                  <span className="text-white/45">可复用手法｜</span>
                                  {selectedManhuaProposal.reusableZh}
                                </div>
                              ) : null}
                              {selectedManhuaProposal.genPromptHintZh ? (
                                <div className="mt-1.5 text-[10px] leading-relaxed text-[#c9c0e6]/60">
                                  <span className="text-white/45">生成要素｜</span>
                                  {selectedManhuaProposal.genPromptHintZh}
                                </div>
                              ) : null}
                              {selectedManhuaProposal.audioStory?.hasAudio ? (
                                <div className="mt-2 rounded-lg border border-cyan-300/10 bg-cyan-300/[0.04] px-2 py-2 text-[10px] leading-relaxed text-[#c9c0e6]/60">
                                  <div>
                                    <span className="text-white/45">声音节奏｜</span>
                                    {selectedManhuaProposal.audioStory.audioBeatStructureZh || "—"}
                                  </div>
                                  {selectedManhuaProposal.audioStory.mixNotesZh ? (
                                    <div className="mt-1">
                                      <span className="text-white/45">混音手法｜</span>
                                      {selectedManhuaProposal.audioStory.mixNotesZh}
                                    </div>
                                  ) : null}
                                  {selectedManhuaProposal.audioStory.reusableAudioZh ? (
                                    <div className="mt-1">
                                      <span className="text-white/45">可复用声音手法｜</span>
                                      {selectedManhuaProposal.audioStory.reusableAudioZh}
                                    </div>
                                  ) : null}
                                  {selectedManhuaProposal.audioStory.audioTrack?.length ? (
                                    <div className="mt-1 max-h-40 overflow-y-auto rounded border border-white/10">
                                      {selectedManhuaProposal.audioStory.audioTrack.map((track, index) => (
                                        <div
                                          key={`${track.fromSec}-${track.toSec}-${index}`}
                                          className="grid grid-cols-[72px_1fr] gap-2 border-b border-white/5 px-2 py-1 last:border-b-0"
                                        >
                                          <span className="tabular-nums text-[#8cefff]/70">
                                            {track.fromSec.toFixed(1)}–{track.toSec.toFixed(1)}s
                                          </span>
                                          <span>
                                            {track.emotionArcZh}
                                            <span className="block text-[9px] text-white/35">
                                              {[track.toneZh, track.sfxZh, track.bgmZh, track.atmosphereZh, track.silenceZh]
                                                .filter(Boolean)
                                                .join(" · ")}
                                            </span>
                                          </span>
                                        </div>
                                      ))}
                                    </div>
                                  ) : null}
                                </div>
                              ) : selectedManhuaProposal.audioStory ? (
                                <div className="mt-2 text-[10px] text-white/40">声音结构｜来源无音轨</div>
                              ) : null}
                              {selectedManhuaProposal.subtitleTrack?.length ? (
                                <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-[10px] text-white/55">
                                  <div className="mb-1 text-white/40">画面字幕证据（仅审批可见，不注入新剧本原句）</div>
                                  {selectedManhuaProposal.subtitleTrack.map((row, index) => (
                                    <div key={`${row.atSec}-${index}`} className="grid grid-cols-[52px_1fr] gap-2 py-0.5">
                                      <span className="tabular-nums text-[#8cefff]/60">{row.atSec.toFixed(1)}s</span>
                                      <span>{row.textZh}</span>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                              {selectedManhuaProposal.castShape ? (
                                <div className="mt-2 text-[10px] leading-relaxed text-[#c9c0e6]/60">
                                  <span className="text-white/45">角色结构｜</span>
                                  主角欲望：{selectedManhuaProposal.castShape.leadDesireZh || "—"}
                                  ｜压力：{selectedManhuaProposal.castShape.pressureZh || "—"}
                                  {selectedManhuaProposal.castShape.foilZh
                                    ? `｜对照：${selectedManhuaProposal.castShape.foilZh}`
                                    : ""}
                                </div>
                              ) : null}
                              {selectedManhuaProposal.scenePoolHints?.length ? (
                                <div className="mt-1.5 text-[10px] leading-relaxed text-[#c9c0e6]/60">
                                  <span className="text-white/45">场景池｜</span>
                                  {selectedManhuaProposal.scenePoolHints.join(" · ")}
                                </div>
                              ) : null}
                              {selectedManhuaProposal.densityHints ? (
                                <div className="mt-1.5 text-[10px] text-[#c9c0e6]/50">
                                  <span className="text-white/45">密度下限｜</span>
                                  正文 {selectedManhuaProposal.densityHints.minBodyChars} 字 ｜ 对白{" "}
                                  {selectedManhuaProposal.densityHints.minDialogueLines} 行 ｜ 场景{" "}
                                  {selectedManhuaProposal.densityHints.minLocationHits} 处
                                </div>
                              ) : null}
                              {selectedManhuaProposal.beatGrid?.length ? (
                                <div className="mt-2">
                                  <div className="text-[10px] text-white/45">
                                    节拍网格（秒位 · 冲突 · 可拍动作）
                                  </div>
                                  <div className="mt-1 max-h-56 overflow-y-auto rounded border border-white/10">
                                    {selectedManhuaProposal.beatGrid.map((beat, index) => (
                                      <div
                                        key={`${beat.atSec}-${index}`}
                                        className="flex gap-2 border-b border-white/5 px-2 py-1 text-[10px] last:border-b-0"
                                      >
                                        <span className="w-10 shrink-0 tabular-nums text-[#8cefff]/70">
                                          {Math.round(Number(beat.atSec) || 0)}s
                                        </span>
                                        <span className="w-24 shrink-0 text-[#c9c0e6]/70">
                                          {beat.conflictZh}
                                        </span>
                                        <span className="min-w-0 flex-1 text-[#c9c0e6]/50">
                                          {beat.visualZh}
                                          {formatManhuaTemplateNativeBeatZh(beat) ? (
                                            <span className="mt-0.5 block text-[9px] text-[#8cefff]/45">
                                              {formatManhuaTemplateNativeBeatZh(beat)}
                                            </span>
                                          ) : null}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </details>
                          ) : null}
                        </div>
                      ) : null}

                      {rising?.entries?.length ? (
                        <div className="mt-3 space-y-2">
                          <div className="grid grid-cols-[28px_1fr_72px_72px_40px_64px] gap-2 px-1 text-[10px] text-[#c9c0e6]/45">
                            <span />
                            <span>剧名 / 归类</span>
                            <span className="text-right">播放</span>
                            <span className="text-right">环比</span>
                            <span className="text-right">状态</span>
                            <span className="text-right">学习</span>
                          </div>
                          {rising.entries.map((row, idx) => {
                            const tags = row.tagLabelsZh || [];
                            const learnable = canLearnRow(row);
                            const titleNode = (
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-white">{row.mixName}</div>
                                <div className="truncate text-[10px] text-[#c9c0e6]/50">
                                  {categoryOf(row)}
                                  {tags.length ? ` · ${tags.join(" / ")}` : ""}
                                  {row.author ? ` · ${row.author}` : ""}
                                </div>
                                {!row.url ? (
                                  <div className="text-[10px] text-[#c9c0e6]/35">暂无合集链</div>
                                ) : null}
                              </div>
                            );
                            // 与 runManhuaTemplateLearnCloud 的 busyKey 同口径（那边 trim 过）
                            const busyKey = String(
                              String(row.mixId || "").trim()
                                || String(row.url || "").trim()
                                || String(row.mixName || "").trim()
                                || idx + 1,
                            );
                            const busy = manhuaLearnBusyKey === busyKey;
                            return (
                              <div
                                key={row.mixId || idx}
                                className="grid grid-cols-[28px_1fr_72px_72px_40px_64px] items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-3 py-2 text-[12px]"
                              >
                                <span className="font-bold text-[#c9c0e6]/45">#{idx + 1}</span>
                                {row.url ? (
                                  <a
                                    href={row.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 hover:opacity-90"
                                    title={
                                      aiManhuaPlatformTab === "kuaishou"
                                        ? "在快手打开"
                                        : "在抖音打开"
                                    }
                                  >
                                    {titleNode}
                                  </a>
                                ) : (
                                  titleNode
                                )}
                                <span className="text-right font-semibold tabular-nums text-[#3eedff]">
                                  {fmtPlay(row.mixPlayCount)}
                                </span>
                                <span className="text-right font-semibold tabular-nums text-[#ff4fb8]">
                                  {row.delta7d == null ? "—" : `+${fmtPlay(row.delta7d)}`}
                                </span>
                                <span className="text-right text-[10px] font-semibold text-[#ff9fe0]">
                                  {statusLabel(row.status)}
                                </span>
                                <button
                                  type="button"
                                  disabled={
                                    Boolean(manhuaLearnBusyKey)
                                    || activeManhuaLearnSources.has(String(row.gcsUri || row.url || "").trim())
                                    || !learnable
                                  }
                                  title={
                                    learnable
                                      ? "云端学节奏；失败回退本机命令"
                                      : "暂无可用成片链接，无法下片学习"
                                  }
                                  onClick={() =>
                                    void runManhuaTemplateLearnCloud(
                                      { ...row, platform: aiManhuaPlatformTab },
                                      idx + 1,
                                    )
                                  }
                                  className="justify-self-end rounded-md border border-[#8cefff]/25 bg-[rgba(140,239,255,0.08)] px-1.5 py-0.5 text-[10px] font-semibold text-[#8cefff] hover:bg-[rgba(140,239,255,0.16)] disabled:opacity-40"
                                >
                                  {busy ? "学习中…" : `学 ${manhuaLearnBatchSize} 集`}
                                </button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/20 px-4 py-6 text-center text-[12px] leading-relaxed text-[#c9c0e6]/55">
                          {rising?.storeReadFailed
                            ? "趋势库读取超时，暂未拿到合集样本。请稍后重试分析；总览其它数据不受影响。"
                            : aiManhuaPlatformTab === "kuaishou"
                              ? "本窗快手侧暂无已确认的漫剧/短剧合集样本（不会把普通短视频当成短剧）。可继续看总览；采集命中后将展示剧名、类别与标签。"
                              : "本窗抖音侧暂无已确认的漫剧/短剧合集样本。请完成趋势分析，且采集侧已跑出带合集字段的条目。"}
                          <br />
                          总览里的多平台口播/种草数据不受影响。
                        </div>
                      )}
                    </div>
                  )}
                </>
              );
            })()}
          </div>
              </PlatformTrendWorkbench>
            ) : null}

            {platformMode === "create" ? (
              <PlatformCreateWorkbench
                className="mb-0"
                stepRail={
                  <PlatformCreateStepRail
                    activeStep={createStep}
                    onStepChange={setCreateStep}
                    doneSteps={createDoneSteps}
                  />
                }
                mobileStepRail={
                  <PlatformCreateStepRail
                    orientation="horizontal"
                    activeStep={createStep}
                    onStepChange={setCreateStep}
                    doneSteps={createDoneSteps}
                  />
                }
                stickyCta={stickyCtaNode}
              >
                <div className="mb-3 flex flex-wrap gap-2 lg:hidden">
                  <button
                    type="button"
                    onClick={() => setSkillDrawerOpen(true)}
                    className="rounded-lg border border-white/12 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-[#c9c0e6]"
                  >
                    Skill / 模板
                  </button>
                </div>
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <PenLine className="h-5 w-5 text-[#ff4fb8]" />
                  <h2 className="text-lg font-black tracking-tight text-white md:text-xl">内容创作</h2>
                  <span className="rounded-full border border-[#ff4fb8]/35 bg-[rgba(255,79,184,0.1)] px-2 py-0.5 text-[10px] font-bold text-[#ff9fe0]">
                    生成选题与文案
                  </span>
                </div>
                <p className="mb-4 text-xs text-[#c9c0e6]/55">
                  人物背景 → Skill → 选题初选 → 文案/分镜 → 输出形式。
                </p>

          {/* 内容创作 Tab：文案 / 选题 / 文生图与海报 */}
          <div className="mb-5 inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-xl border border-white/10 bg-black/35 p-1">
              <button
                type="button"
                onClick={() => setCustomWorkspaceTab("copy")}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
                  customWorkspaceTab === "copy"
                    ? "bg-[linear-gradient(135deg,#ff4fb8,#c026d3)] text-white shadow-sm"
                    : "text-[#c9c0e6]/70 hover:text-white"
                }`}
              >
                <PenLine className="h-3.5 w-3.5 shrink-0" />
                自定义文案
              </button>
              <button
                type="button"
                onClick={() => {
                  if (customWorkspaceTab !== "copy") setCustomWorkspaceTab("copy");
                  void handleExportCustomCopyPdf();
                }}
                disabled={
                  customNoteBusy ||
                  customTopicBusy ||
                  customMattingBusy ||
                  isDownloadingCustomCopyPdf ||
                  !canExportCustomCopyPdf
                }
                title={
                  canExportCustomCopyPdf
                    ? "导出当前自定义文案、优化结果与生成图片为 PDF"
                    : "请先输入文案或完成生成"
                }
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#ff4fb8]/35 bg-[rgba(255,79,184,0.08)] px-2.5 py-2 text-[11px] font-semibold text-[#ff9fe0] transition hover:bg-[rgba(255,79,184,0.16)] disabled:cursor-not-allowed disabled:opacity-45"
              >
                {isDownloadingCustomCopyPdf ? (
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                ) : (
                  <FileText className="h-3.5 w-3.5 shrink-0" />
                )}
                导出 PDF
              </button>
              <button
                type="button"
                onClick={() => setCustomWorkspaceTab("topic")}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
                  customWorkspaceTab === "topic"
                    ? "bg-[linear-gradient(135deg,#49e6ff,#6a5cff)] text-white shadow-sm"
                    : "text-[#c9c0e6]/70 hover:text-white"
                }`}
              >
                <UserRound className="h-3.5 w-3.5 shrink-0" />
                自定义选题
              </button>
              <button
                type="button"
                onClick={() => setCustomWorkspaceTab("imageGen")}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
                  customWorkspaceTab === "imageGen"
                    ? "bg-[linear-gradient(135deg,#34d399,#0ea5e9)] text-white shadow-sm"
                    : "text-[#c9c0e6]/70 hover:text-white"
                }`}
              >
                <Image className="h-3.5 w-3.5 shrink-0" />
                文生图与海报
              </button>
          </div>


          {customWorkspaceTab === "copy" || customWorkspaceTab === "topic" ? (
            <div className="mb-5 space-y-4">
              {platformMainPersonaTopicsPanel}
              {renderExpandedShortlistGenZone("platform-topic-shortlist")}
              {platformSkillsAccessoryPanel}
            </div>
          ) : null}

          {customWorkspaceTab === "copy" ? (
            <>
              <div className="mb-5 grid gap-2 sm:grid-cols-2">
                <PlatformWorkspaceStepHint
                  step={1}
                  title="粘贴文案"
                  lines={["贴入 Markdown 或分镜脚本，并选择生成类型。", "可选「优化自定义文案」先深度改写再出图。"]}
                  active={!customNoteText.trim()}
                  done={Boolean(customNoteText.trim())}
                />
                <PlatformWorkspaceStepHint
                  step={2}
                  title="生成结果"
                  lines={["点击生成按钮，等待任务完成。", "图片或优化稿直接显示在本 Tab 下方。"]}
                  active={Boolean(customNoteText.trim()) && !customNoteImages.length && !customNoteImageUpper && !customOptimizeResult}
                  done={Boolean(customNoteImages.length || customNoteImageUpper || customNoteImageLower || customOptimizeResult)}
                />
              </div>

              <div className="mb-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-2">生成类型</div>
                <div className="inline-flex flex-wrap rounded-xl border border-white/10 bg-black/35 p-0.5 gap-0.5">
                  <button
                    type="button"
                    onClick={() => { setCustomNoteKind("single_page_knowledge_card"); setCustomNoteImageUpper(null); setCustomNoteImageLower(null); setCustomNoteImages([]); setCustomNoteError(null); setCustomOptimizeResult(null); setCustomOptimizeSummary(null); }}
                    disabled={customNoteBusy}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
                      customNoteKind === "single_page_knowledge_card"
                        ? "bg-[linear-gradient(135deg,#ff4fb8,#c026d3)] text-white shadow-sm"
                        : "text-[#c9c0e6]/70 hover:text-white"
                    }`}
                  >
                    <Image className="h-3.5 w-3.5 shrink-0" />
                    单页图文卡片
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCustomNoteKind("storyboard_sheet_landscape"); setCustomNoteImageUpper(null); setCustomNoteImageLower(null); setCustomNoteImages([]); setCustomNoteError(null); setCustomOptimizeResult(null); setCustomOptimizeSummary(null); }}
                    disabled={customNoteBusy}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
                      customNoteKind === "storyboard_sheet_landscape"
                        ? "bg-[linear-gradient(135deg,#49e6ff,#6a5cff)] text-white shadow-sm"
                        : "text-[#c9c0e6]/70 hover:text-white"
                    }`}
                  >
                    <Film className="h-3.5 w-3.5 shrink-0" />
                    2×4 编导分镜图
                  </button>
                  <button
                    type="button"
                    onClick={() => { setCustomNoteKind("optimize_custom_copy"); setCustomNoteImageUpper(null); setCustomNoteImageLower(null); setCustomNoteImages([]); setCustomNoteError(null); setCustomOptimizeResult(null); setCustomOptimizeSummary(null); }}
                    disabled={customNoteBusy}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
                      customNoteKind === "optimize_custom_copy"
                        ? "bg-[linear-gradient(135deg,#fbbf24,#f97316)] text-white shadow-sm"
                        : "text-[#c9c0e6]/70 hover:text-white"
                    }`}
                  >
                    <FileText className="h-3.5 w-3.5 shrink-0" />
                    优化自定义文案
                  </button>
                </div>
              </div>

              <div className="mb-3 space-y-3">
                <PlatformOutputTypePicker
                  value={outputType}
                  onChange={(v) => {
                    setOutputType(v);
                    trackPlatformFunnel("output_type_pick", { outputType: v });
                    setCreateStep("output");
                    if (v === "single_page") setCustomNoteKind("single_page_knowledge_card");
                    else if (v === "storyboard_2x4") setCustomNoteKind("storyboard_sheet_landscape");
                    else setCustomNoteKind("optimize_custom_copy");
                  }}
                />
                {outputType ? (
                  <PlatformAdvancedSettingsFold
                    title="高级设置"
                    badge="百科可视化等版式"
                    defaultOpen={Boolean(customNoteInfographicTemplateId)}
                  >
                    <InfographicTemplatePicker
                      disabled={customNoteBusy}
                      selectedTemplateId={customNoteInfographicTemplateId}
                      onSelect={(t) => {
                        setCustomNoteInfographicTemplateId(t?.id ?? null);
                        setCustomNoteInfographicLabelZh(t?.labelZh ?? null);
                        if (t) {
                          setCustomNoteKind("single_page_knowledge_card");
                          setOutputType("single_page");
                          toast.success(`已选版式「${t.labelZh}」· 主题以正文为准`);
                        }
                      }}
                    />
                    {customNoteInfographicLabelZh ? (
                      <p className="mt-1.5 text-[11px] text-cyan-100/55">
                        已选版式：{customNoteInfographicLabelZh}（生成时后台套用你的正文）
                      </p>
                    ) : null}
                  </PlatformAdvancedSettingsFold>
                ) : null}
              </div>

              <textarea
                className="w-full min-h-[140px] resize-y rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm leading-relaxed text-white placeholder-[#6d6384] focus:border-[#ff4fb8]/60 focus:outline-none focus:ring-1 focus:ring-[#ff4fb8]/30 transition"
                placeholder={
                  customNoteKind === "optimize_custom_copy"
                    ? "粘贴待优化的封面文案、分镜描述或完整 Markdown…（建议 100–3000 字）"
                    : customNoteKind === "single_page_knowledge_card"
                      ? "粘贴中文正文 / Markdown，或上传文档/图片后自动提炼…约 4–8 页图文笔记（页数随内容，第 9 页起八折）"
                      : "输入中文文案或分镜脚本，系统自动翻译并生成 2×4 编导分镜图…（建议 100–800 字）"
                }
                value={customNoteText}
                onChange={(e) => setCustomNoteText(e.target.value)}
                disabled={customNoteBusy}
              />
              {customNoteKind === "single_page_knowledge_card" ? (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <label className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-white/15 bg-black/30 px-3 py-1.5 text-xs font-semibold text-[#c9c0e6] transition hover:border-[#ff4fb8]/40 hover:text-white ${customNoteBusy || customNoteUploadBusy ? "opacity-50 pointer-events-none" : ""}`}>
                    <Upload className="h-3.5 w-3.5" />
                    {customNoteUploadBusy ? "读取中…" : "上传文档/图片（可多选）"}
                    <input
                      type="file"
                      className="hidden"
                      multiple
                      accept=".pptx,.docx,.pdf,.png,.jpg,.jpeg,.webp,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.openxmlformats-officedocument.presentationml.presentation,image/png,image/jpeg,image/webp"
                      disabled={customNoteBusy || customNoteUploadBusy}
                      onChange={(e) => {
                        const list = Array.from(e.target.files || []);
                        e.target.value = "";
                        if (!list.length) return;
                        void (async () => {
                          setCustomNoteUploadBusy(true);
                          try {
                            const encoded: KnowledgeCardPendingFile[] = [];
                            for (const file of list) {
                              const mimeType = file.type || "application/octet-stream";
                              /**
                               * 超过阈值改走 GCS 直传：base64 会把体积撑大三分之一，
                               * 请求体上限约 13.5MB 原文件，再大连接会在读 body 阶段被掐断
                               * （2026-08-06：42MB 的 PDF 传不上去，却报「算力紧张」）。
                               * 直传还顺带绕开了那台 2 核机器，机器忙也不影响上传。
                               */
                              if (file.size > KNOWLEDGE_CARD_DIRECT_UPLOAD_MIN_BYTES) {
                                const mb = (file.size / 1024 / 1024).toFixed(1);
                                const gcsUri = await uploadKnowledgeCardFileToGcs({
                                  file,
                                  mimeType,
                                  getSignedUrl: (input) => getUploadUrlMutation.mutateAsync(input),
                                  onStatus: (text) => setCustomNoteUploadStatus(text),
                                  label: `${file.name}（${mb}MB）`,
                                });
                                encoded.push({ gcsUri, mimeType, fileName: file.name });
                                continue;
                              }
                              const buf = await file.arrayBuffer();
                              const bytes = new Uint8Array(buf);
                              let binary = "";
                              const chunk = 0x8000;
                              for (let i = 0; i < bytes.length; i += chunk) {
                                binary += String.fromCharCode(...Array.from(bytes.subarray(i, i + chunk)));
                              }
                              encoded.push({
                                fileBase64: btoa(binary),
                                mimeType,
                                fileName: file.name,
                              });
                            }
                            setCustomNoteUploadStatus(null);
                            // 生成按钮依赖文本框非空：上传后立刻 OCR+提炼写入文本框，否则无法点生成
                            const allPending = [...customNotePendingFilesRef.current, ...encoded];
                            customNotePendingFilesRef.current = allPending;
                            const docs = allPending.filter(
                              (f) =>
                                !String(f.mimeType).startsWith("image/") &&
                                !/\.(png|jpe?g|webp)$/i.test(f.fileName || ""),
                            );
                            const imgEncoded = allPending.filter((f) => !docs.includes(f));
                            setCustomNotePendingMeta(
                              allPending.map((f) => ({
                                fileName: f.fileName || (String(f.mimeType).startsWith("image/") ? "图片" : "文档"),
                                kind:
                                  String(f.mimeType).startsWith("image/") ||
                                  /\.(png|jpe?g|webp)$/i.test(f.fileName || "")
                                    ? ("image" as const)
                                    : ("doc" as const),
                              })),
                            );
                            setCustomNoteDistillPhase("distilling");
                            setCustomNoteUploadStatus(
                              "上传成功，正在读文/读图并提炼写入文本框（长文档会自动分段，可能需数分钟）…",
                            );
                            toast.message("正在提炼（长文档较久），完成后会写入上方文本框…");
                            const distilled = await runKnowledgeCardDistill({
                              sourceText: resolveKnowledgeCardSourceText(
                                customNoteText,
                                allPending.length,
                              ),
                              files: allPending,
                              onStatus: setCustomNoteUploadStatus,
                            });
                            if (!distilled) {
                              throw new Error("提炼结果为空，请换文件或改用可选中文字的 PDF / 关键页图片");
                            }
                            setCustomNoteText(distilled);
                            customNotePendingFilesRef.current = [];
                            setCustomNotePendingMeta([]);
                            setCustomNoteDistillPhase("ready");
                            const plan = planKnowledgeCardPages(distilled, customNoteDistillModel);
                            const pages = Math.max(1, plan.pageCount || 1);
                            const credits =
                              plan.credits || knowledgeCardCreditsForPages(pages, customNoteDistillModel);
                            const okMsg = `提炼完成：已写入文本框 · 约 ${pages} 页 · 约 ${credits} 积分（可点生成出图）`;
                            setCustomNoteUploadStatus(okMsg);
                            toast.success(okMsg);
                          } catch (err) {
                            setCustomNoteDistillPhase("idle");
                            // 失败必须清掉待处理文件：否则用户再传一次会把同一本书叠上去（曾出现 9.5 万 → 28 万字）
                            customNotePendingFilesRef.current = [];
                            setCustomNotePendingMeta([]);
                            const rawFail = String((err as { message?: string })?.message || "读取/提炼失败");
                            const failMsg = sanitizePlatformUserMessage(
                              mapCustomNoteError(err),
                              /超时|较长/.test(rawFail)
                                ? "文档较长，提炼超时，请稍后重试"
                                : "算力紧张或请求超时，请稍后重试",
                            );
                            setCustomNoteUploadStatus(`上传或提炼失败：${failMsg}（请重新上传，勿在失败态叠加）`);
                            toast.error(failMsg);
                          } finally {
                            setCustomNoteUploadBusy(false);
                          }
                        })();
                      }}
                    />
                  </label>
                  <span className="text-[11px] text-[#c9c0e6]/45">
                    上传后自动读文/读图提炼并写入上方文本框；确认后点生成出图
                  </span>
                  {customNoteUploadStatus ? (
                    <span className={`w-full text-[11px] leading-5 ${customNoteUploadStatus.startsWith("上传失败") || customNoteUploadStatus.includes("未探测") || customNoteUploadStatus.includes("未抽出") ? "text-rose-300/90" : "text-emerald-300/85"}`}>
                      {customNoteUploadStatus}
                    </span>
                  ) : null}
                  {customNotePendingMeta.length > 0 ? (
                    <span className="w-full text-[11px] text-[#c9c0e6]/55">
                      待处理 {customNotePendingMeta.length} 个：
                      {customNotePendingMeta.slice(0, 6).map((f) => f.fileName).join("、")}
                      {customNotePendingMeta.length > 6 ? "…" : ""}
                    </span>
                  ) : null}
                  {customNoteDistillPhase === "distilling" ? (
                    <span className="w-full text-[11px] text-amber-200/85">正在提炼，完成后会写入上方文本框再出图…</span>
                  ) : null}
                  {customNoteDistillPhase === "ready" ? (
                    <span className="w-full text-[11px] text-emerald-300/85">提炼稿已写入文本框；确认后将按页出图…</span>
                  ) : null}
                  {canChooseKnowledgeCardDistillModel ? (
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-[#c9c0e6]/70">
                      <span className="shrink-0">提炼档位</span>
                      <select
                        className="rounded-md border border-white/15 bg-black/50 px-2 py-1 text-[11px] font-semibold text-white focus:border-[#ff4fb8]/50 focus:outline-none"
                        value={customNoteDistillModel}
                        disabled={
                          customNoteBusy
                          || customNoteUploadBusy
                          || customNoteDistillPhase !== "idle"
                        }
                        title={
                          customNoteDistillPhase !== "idle"
                            ? "本次提炼按当前档位计费，出图完成后才能换档"
                            : undefined
                        }
                        onChange={(e) => {
                          const next = e.target.value as KnowledgeCardDistillModelId;
                          setCustomNoteDistillModel(next);
                          try {
                            localStorage.setItem("mvs-knowledge-card-distill-model", next);
                          } catch {
                            /* ignore */
                          }
                        }}
                      >
                        {KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS.map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.labelZh} · {o.creditsFull}积分/页
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  <span className="text-[11px] text-[#c9c0e6]/45">
                    支持 pptx / docx / pdf / png / jpg；上传文档的提炼含在页费中，超长纯文本主动提炼另收一次性提炼费
                  </span>
                </div>
              ) : null}
              {customNoteKind === "optimize_custom_copy" ? (
                <textarea
                  className="mt-3 w-full min-h-[96px] resize-y rounded-2xl border border-[#fbbf24]/20 bg-[rgba(251,191,36,0.04)] px-4 py-3 text-sm leading-relaxed text-white placeholder-[#6d6384] focus:border-[#fbbf24]/50 focus:outline-none focus:ring-1 focus:ring-[#fbbf24]/30 transition"
                  placeholder="优化要求（可选）：例如「针对上传的封面与 2×4 分镜，强化苏轼×哈佛医学博士人设，小红书首发标题与八格叙事节奏」…"
                  value={customOptimizeBrief}
                  onChange={(e) => setCustomOptimizeBrief(e.target.value)}
                  disabled={customNoteBusy}
                />
              ) : null}
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleGenerateCustomNote()}
                  disabled={
                    customNoteBusy ||
                    customNoteUploadBusy ||
                    customNoteDistillPhase === "distilling" ||
                    !customNoteText.trim()
                  }
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-[0_6px_24px_rgba(255,79,184,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${
                    customNoteKind === "optimize_custom_copy"
                      ? "border border-[#fbbf24]/30 bg-[linear-gradient(135deg,#fbbf24,#f97316)]"
                      : customNoteKind === "single_page_knowledge_card"
                      ? "border border-[#ff4fb8]/30 bg-[linear-gradient(135deg,#ff4fb8,#c026d3)]"
                      : "border border-[#49e6ff]/30 bg-[linear-gradient(135deg,#49e6ff,#6a5cff)]"
                  }`}
                >
                  {customNoteBusy || customNoteUploadBusy || customNoteDistillPhase === "distilling" ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />{customNoteKind === "optimize_custom_copy" ? "优化中…" : customNoteDistillPhase === "distilling" || customNoteUploadBusy ? "提炼中…" : "生成中…"}</>
                  ) : customNoteKind === "optimize_custom_copy" ? (
                    <><Sparkles className="h-4 w-4" />深度优化文案（{customOptimizeCopyCost} 积分）</>
                  ) : customNoteKind === "single_page_knowledge_card" ? (
                    <><Sparkles className="h-4 w-4" />生成图文笔记（约 {Math.max(1, customNoteKnowledgePlan.pageCount || 1)} 页 · {knowledgeCardImageQuality(Math.max(1, customNoteKnowledgePlan.pageCount || 1)) === "high" ? "4K" : "2K"} · {customNoteKnowledgeCredits || 30} 积分）</>
                  ) : (
                    <><Film className="h-4 w-4" />生成编导分镜图</>
                  )}
                </button>
                {(customNoteImageUpper || customNoteImageLower || customNoteError || customOptimizeResult) && !customNoteBusy && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomNoteImageUpper(null);
                      setCustomNoteImageLower(null);
                      setCustomNoteImages([]);
                      setCustomNotePageProgress(null);
                      setCustomNoteError(null);
                      setCustomOptimizeResult(null);
                      setCustomOptimizeSummary(null);
                      setCustomNoteText("");
                      setCustomOptimizeBrief("");
                      setCustomNoteInfographicTemplateId(null);
                      setCustomNoteInfographicLabelZh(null);
                      customNotePendingFilesRef.current = [];
                      setCustomNotePendingMeta([]);
                      setCustomNoteUploadStatus(null);
                      setCustomNoteDistillPhase("idle");
                    }}
                    className="text-xs text-[#c9c0e6]/60 hover:text-white transition"
                  >
                    清除
                  </button>
                )}
              </div>

              {!customOptimizeResult && visibleExecutionCards.some((c) => c.publishingAdvice?.trim()) ? (
                <div className="mt-5 rounded-xl border border-[#fbbf24]/25 bg-[rgba(251,191,36,0.06)] px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-[#fcd34d]/90">
                    发布时间 / 发布建议（来自全案选题）
                  </div>
                  <div className="mt-1.5 space-y-1.5">
                    {visibleExecutionCards
                      .filter((c) => c.publishingAdvice?.trim())
                      .slice(0, 3)
                      .map((c) => (
                        <div key={`custom-pub-${c.id}`} className="text-sm leading-6 text-[#ffe9a8]">
                          <span className="font-semibold text-white/80">{c.title.slice(0, 28)}</span>
                          {c.title.length > 28 ? "…" : ""}
                          <span className="text-white/40"> · </span>
                          {c.publishingAdvice}
                        </div>
                      ))}
                  </div>
                </div>
              ) : null}

              {customNoteBusy && (
                <div className="mt-5 flex items-center gap-2 rounded-2xl border border-[#ff4fb8]/15 bg-[rgba(255,79,184,0.05)] px-4 py-3 text-sm text-[#ff9fe0]/80">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#ff4fb8]" />
                  {customNoteKind === "optimize_custom_copy"
                    ? "正在深度优化文案，约需 30–90 秒…"
                    : customNotePageProgress
                      ? `正在生成第 ${customNotePageProgress.i}/${customNotePageProgress.n} 页，请勿关闭页面…`
                      : prepareKnowledgeCardCopyMutation.isPending
                        ? "正在提炼文案与读图要点…"
                        : "正在生成图片，约需数分钟，请勿关闭页面…"}
                </div>
              )}

              {customNoteError && (
                <div className="mt-5 rounded-2xl border border-red-500/25 bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm text-red-300">
                  ❌ {customNoteError}
                </div>
              )}

              {customOptimizeResult ? (
                <div className="mt-5 space-y-3 rounded-2xl border border-[#fbbf24]/25 bg-[rgba(251,191,36,0.06)] p-5">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#fcd34d]/80">
                    深度优化结果{customOptimizeSummary ? ` · ${customOptimizeSummary}` : ""}
                  </div>
                  <div className="whitespace-pre-wrap text-sm leading-7 text-white/88">{customOptimizeResult}</div>
                  {visibleExecutionCards.some((c) => c.publishingAdvice?.trim()) ? (
                    <div className="rounded-xl border border-[#fbbf24]/25 bg-black/20 px-3 py-2.5">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-[#fcd34d]/90">
                        发布时间 / 发布建议（参考全案选题）
                      </div>
                      <div className="mt-1.5 space-y-1.5">
                        {visibleExecutionCards
                          .filter((c) => c.publishingAdvice?.trim())
                          .slice(0, 3)
                          .map((c) => (
                            <div key={`pub-${c.id}`} className="text-sm leading-6 text-[#ffe9a8]">
                              <span className="font-semibold text-white/80">{c.title.slice(0, 28)}</span>
                              {c.title.length > 28 ? "…" : ""}
                              <span className="text-white/40"> · </span>
                              {c.publishingAdvice}
                            </div>
                          ))}
                      </div>
                    </div>
                  ) : null}
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      type="button"
                      disabled={customNoteBusy}
                      onClick={() => void handleGenerateFromOptimizedCopy("storyboard_sheet_landscape")}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/30 bg-[linear-gradient(135deg,#49e6ff,#6a5cff)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <Film className="h-3.5 w-3.5" />
                      用优化稿生成编导分镜（60 积分）
                    </button>
                    <button
                      type="button"
                      disabled={customNoteBusy}
                      onClick={() => void handleGenerateFromOptimizedCopy("single_page_knowledge_card")}
                      className="inline-flex items-center gap-1.5 rounded-full border border-[#ff4fb8]/30 bg-[linear-gradient(135deg,#ff4fb8,#c026d3)] px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <Image className="h-3.5 w-3.5" />
                      用优化稿生成图文笔记（按页计费）
                    </button>
                  </div>
                </div>
              ) : null}

              {(customNoteImages.length > 0 || customNoteImageUpper || customNoteImageLower) && (
                <div className="mt-5 space-y-6">
                  {customNoteKind === "single_page_knowledge_card" && (customNoteImages.length > 0 ? customNoteImages : [customNoteImageUpper, customNoteImageLower].filter(Boolean) as string[]).map((url, idx, arr) => (
                    <div key={`kc-${idx}-${url.slice(-24)}`} className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#ff9fe0]/70">
                        图文卡片 · 第 {idx + 1}/{arr.length} 页
                      </div>
                      <img
                        src={url}
                        alt={`图文知识卡片第 ${idx + 1} 页`}
                        className="w-full rounded-2xl border border-white/10 object-contain shadow-[0_12px_48px_rgba(0,0,0,0.35)]"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          setCustomNoteError("图片加载失败，请确认图片 URL 是否有效");
                        }}
                      />
                      <div className="flex justify-end">
                        <a
                          href={url}
                          download={`knowledge-card-p${idx + 1}.png`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[rgba(73,230,255,0.15)]"
                        >
                          <Download className="h-4 w-4" />
                          下载第 {idx + 1} 页
                        </a>
                      </div>
                    </div>
                  ))}
                  {customNoteKind !== "single_page_knowledge_card" && customNoteImageUpper && (
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#ff9fe0]/70">编导分镜图生成结果</div>
                      <img
                        src={customNoteImageUpper}
                        alt="2×4 编导分镜图"
                        className="w-full rounded-2xl border border-white/10 object-contain shadow-[0_12px_48px_rgba(0,0,0,0.35)]"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          setCustomNoteError("图片加载失败，请确认图片 URL 是否有效");
                        }}
                      />
                      <div className="flex justify-end">
                        <a
                          href={customNoteImageUpper}
                          download="storyboard-2x4.png"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[rgba(73,230,255,0.15)]"
                        >
                          <Download className="h-4 w-4" />
                          下载图片
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : customWorkspaceTab === "topic" ? (
            <>
              <div className="mb-5 grid gap-2 sm:grid-cols-3">
                <PlatformWorkspaceStepHint
                  step={1}
                  title="填写设定"
                  lines={["写主人公特质与专长，可选填选题标题。", "勾选需要生成的文案、封面或分镜。"]}
                  active={!customTopicProtagonist.trim()}
                  done={Boolean(customTopicProtagonist.trim())}
                />
                <PlatformWorkspaceStepHint
                  step={2}
                  title="上传人像"
                  lines={["上传参考人像，封面与分镜会融合相貌。", "生成封面/分镜时必填；仅文案可跳过。"]}
                  active={Boolean(customTopicProtagonist.trim()) && !customTopicPhotoUrl && (customTopicGenCover || customTopicGenStoryboard)}
                  done={Boolean(customTopicPhotoUrl) || (!customTopicGenCover && !customTopicGenStoryboard && Boolean(customTopicProtagonist.trim()))}
                />
                <PlatformWorkspaceStepHint
                  step={3}
                  title="一键生成"
                  lines={["文案扩写首次免费，图片积分见按钮。", "结果在本 Tab 预览，可下载或设为参考。"]}
                  active={Boolean(customTopicProtagonist.trim()) && !(customTopicCard || customTopicCoverUrl || customTopicStoryboardUrl)}
                  done={Boolean(customTopicCard || customTopicCoverUrl || customTopicStoryboardUrl)}
                />
              </div>

              <div className="mb-5 rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] px-4 py-3">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-2.5">
                  生成内容（可多选）
                </div>
                <div className="flex flex-wrap gap-x-5 gap-y-2">
                  {(
                    [
                      ["copy", "文案生成", customTopicGenCopy, setCustomTopicGenCopy],
                      ["cover", "封面生成", customTopicGenCover, setCustomTopicGenCover],
                      ["storyboard", "分镜生成", customTopicGenStoryboard, setCustomTopicGenStoryboard],
                    ] as const
                  ).map(([key, label, checked, setter]) => (
                    <label
                      key={key}
                      className={`inline-flex items-center gap-2 text-sm cursor-pointer select-none ${
                        customTopicBusy ? "opacity-50 cursor-not-allowed" : "text-white/90"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={customTopicBusy}
                        onChange={(e) => setter(e.target.checked)}
                        className="h-4 w-4 rounded border-white/20 bg-black/40 text-[#49e6ff] focus:ring-[#49e6ff]/40"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-6">
                {/* 左侧表单 */}
                <div className="space-y-4">
                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-1.5 block">
                      选题标题（可选）
                    </label>
                    <input
                      type="text"
                      maxLength={80}
                      placeholder="例：职场妈妈的时间管理心法"
                      value={customTopicTitle}
                      onChange={(e) => setCustomTopicTitle(e.target.value)}
                      disabled={customTopicBusy}
                      className="w-full rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)] px-4 py-2.5 text-sm text-white placeholder-[#6d6384] focus:border-[#49e6ff]/50 focus:outline-none focus:ring-1 focus:ring-[#49e6ff]/30 transition"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-1.5 block">
                      主人公特质与专长 {customTopicGenCopy ? <span className="text-[#ff9fe0]">*</span> : null}
                    </label>
                    <textarea
                      className="w-full min-h-[120px] resize-y rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm leading-relaxed text-white placeholder-[#6d6384] focus:border-[#49e6ff]/50 focus:outline-none focus:ring-1 focus:ring-[#49e6ff]/30 transition"
                      placeholder="描述主人公的身份、性格、专业领域、表达风格、目标受众…（建议 50–400 字）&#10;例：35 岁儿科医生，温和专业，擅长用生活化比喻讲育儿知识，面向 0–3 岁新手爸妈。"
                      value={customTopicProtagonist}
                      onChange={(e) => setCustomTopicProtagonist(e.target.value)}
                      disabled={customTopicBusy}
                    />
                  </div>

                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-2">分镜网格</div>
                    <div className="inline-flex rounded-xl border border-white/10 bg-black/35 p-0.5 gap-0.5">
                      <button
                        type="button"
                        onClick={() => setCustomTopicGridVariant("2x4")}
                        disabled={customTopicBusy}
                        className={`rounded-lg px-4 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
                          customTopicGridVariant === "2x4"
                            ? "bg-[linear-gradient(135deg,#49e6ff,#6a5cff)] text-white"
                            : "text-[#c9c0e6]/70 hover:text-white"
                        }`}
                      >
                        2×4 八格
                      </button>
                      <button
                        type="button"
                        onClick={() => setCustomTopicGridVariant("3x4")}
                        disabled={customTopicBusy}
                        className={`rounded-lg px-4 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
                          customTopicGridVariant === "3x4"
                            ? "bg-[linear-gradient(135deg,#49e6ff,#6a5cff)] text-white"
                            : "text-[#c9c0e6]/70 hover:text-white"
                        }`}
                      >
                        3×4 十二格
                      </button>
                    </div>
                    <p className="mt-1.5 text-[11px] text-[#c9c0e6]/50">
                      3×4 为分段拼接长图，文字更清晰，积分略高。
                    </p>
                  </div>
                </div>

                {/* 右侧人像上传 */}
                <div className="flex flex-col">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-1.5 block">
                    主人公图像 {(customTopicGenCover || customTopicGenStoryboard) ? <span className="text-[#ff9fe0]">*</span> : null}
                  </label>
                  <div
                    className={`relative flex-1 min-h-[220px] rounded-2xl border-2 border-dashed transition overflow-hidden ${
                      customTopicPhotoPreview
                        ? "border-[#49e6ff]/40 bg-[rgba(73,230,255,0.04)]"
                        : "border-white/15 bg-[rgba(255,255,255,0.02)] hover:border-[#49e6ff]/30"
                    }`}
                  >
                    {customTopicPhotoPreview ? (
                      <>
                        <img
                          src={customTopicPhotoPreview}
                          alt="主人公参考图"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                        <div className="absolute bottom-0 left-0 right-0 p-3 flex items-center justify-between gap-2">
                          <span className="text-[11px] text-white/80">已上传 · 封面与分镜将融合此相貌</span>
                          {!customTopicBusy && (
                            <button
                              type="button"
                              onClick={() => {
                                setCustomTopicPhotoUrl(null);
                                setCustomTopicPhotoPreview(null);
                              }}
                              className="text-[11px] text-red-300 hover:text-red-200 transition"
                            >
                              移除
                            </button>
                          )}
                        </div>
                      </>
                    ) : (
                      <label
                        className={`flex flex-col items-center justify-center h-full min-h-[220px] cursor-pointer px-4 text-center ${
                          customTopicPhotoUploading ? "cursor-wait opacity-70" : ""
                        }`}
                      >
                        {customTopicPhotoUploading ? (
                          <Loader2 className="h-8 w-8 animate-spin text-[#49e6ff] mb-2" />
                        ) : (
                          <UserRound className="h-10 w-10 text-[#49e6ff]/60 mb-2" />
                        )}
                        <span className="text-sm font-medium text-white/90">
                          {customTopicPhotoUploading ? "上传中…" : "点击上传人像"}
                        </span>
                        <span className="mt-1 text-[11px] text-[#c9c0e6]/50">JPG / PNG · ≤ 25MB · 长边自动压缩至 1280px</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          disabled={customTopicPhotoUploading || customTopicBusy}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleUploadCustomTopicPhoto(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                    {customTopicPhotoPreview && !customTopicBusy && (
                      <label className="absolute top-2 right-2 cursor-pointer rounded-full border border-white/20 bg-black/50 px-2.5 py-1 text-[10px] text-white/80 hover:bg-black/70 transition">
                        更换
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          disabled={customTopicPhotoUploading}
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) void handleUploadCustomTopicPhoto(f);
                            e.target.value = "";
                          }}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => void handleGenerateCustomTopic()}
                  disabled={customTopicBusy || !customTopicCanSubmit}
                  className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/30 bg-[linear-gradient(135deg,#49e6ff,#6a5cff)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_6px_24px_rgba(73,230,255,0.2)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {customTopicBusy ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {customTopicPhase === "copy"
                        ? "扩写文案中…"
                        : customTopicGenCover && customTopicGenStoryboard
                          ? "生成封面与分镜…"
                          : customTopicGenCover
                            ? "生成封面…"
                            : "生成编导分镜…"}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" />
                      {customTopicActionLabel}
                    </>
                  )}
                </button>
                {(customTopicCard || customTopicCoverUrl || customTopicStoryboardUrl || customTopicError) && !customTopicBusy && (
                  <button
                    type="button"
                    onClick={() => {
                      setCustomTopicTitle("");
                      setCustomTopicProtagonist("");
                      setCustomTopicPhotoUrl(null);
                      setCustomTopicPhotoPreview(null);
                      setCustomTopicCard(null);
                      setCustomTopicCoverUrl(null);
                      setCustomTopicStoryboardUrl(null);
                      setCustomTopicError(null);
                    }}
                    className="text-xs text-[#c9c0e6]/60 hover:text-white transition"
                  >
                    清除
                  </button>
                )}
              </div>

              {customTopicBusy && (
                <div className="mt-5 flex items-center gap-2 rounded-2xl border border-[#49e6ff]/15 bg-[rgba(73,230,255,0.05)] px-4 py-3 text-sm text-[#8cefff]/80">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#49e6ff]" />
                  {customTopicPhase === "copy"
                    ? "正在 AI 扩写选题文案…"
                    : customTopicGenCover && customTopicGenStoryboard
                      ? `正在先生成竖版封面，再以封面人脸生成 ${customTopicGridVariant === "3x4" ? "3×4" : "2×4"} 分镜，约需 8–12 分钟，请勿关闭页面…`
                      : customTopicGenCover
                        ? "正在生成竖版封面，约需 3–5 分钟，请勿关闭页面…"
                        : `正在生成 ${customTopicGridVariant === "3x4" ? "3×4" : "2×4"} 分镜（融合主人公参考图），约需 5–8 分钟，请勿关闭页面…`}
                </div>
              )}

              {customTopicError && (
                <div className="mt-5 rounded-2xl border border-red-500/25 bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm text-red-300">
                  ❌ {sanitizePlatformUserMessage(customTopicError, "生成失败，请稍后重试")}
                </div>
              )}

              {customTopicCard && (
                <div className="mt-6 rounded-2xl border border-[#f472b6]/25 bg-[rgba(244,114,182,0.06)] p-5 space-y-3">
                  <div className="text-xs font-semibold uppercase tracking-wide text-[#ff9fe0]/70">扩写文案</div>
                  <h3 className="text-base font-bold text-white leading-snug">{customTopicCard.title}</h3>
                  {customTopicCard.hook && (
                    <p className="text-sm text-[#fde047]/90 leading-relaxed">
                      <span className="text-[#c9c0e6]/50 text-xs mr-1">钩子</span>
                      {customTopicCard.hook}
                    </p>
                  )}
                  {customTopicCard.copywriting && (
                    <div className="text-sm text-[#c9c0e6]/90 leading-relaxed whitespace-pre-wrap max-h-[240px] overflow-y-auto rounded-xl border border-white/5 bg-black/20 px-4 py-3">
                      {customTopicCard.copywriting}
                    </div>
                  )}
                </div>
              )}

              {(customTopicCoverUrl || customTopicStoryboardUrl) && (
                <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {customTopicCoverUrl && (
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#8cefff]/70">竖版封面 · 主人公融合</div>
                      <img
                        src={customTopicCoverUrl}
                        alt="自定义选题封面"
                        className="w-full max-w-[280px] mx-auto rounded-2xl border border-white/10 object-contain shadow-[0_12px_48px_rgba(0,0,0,0.35)]"
                      />
                      <div className="flex justify-center">
                        <a
                          href={customTopicCoverUrl}
                          download="custom-topic-cover.png"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[rgba(73,230,255,0.15)]"
                        >
                          <Download className="h-4 w-4" />
                          下载封面
                        </a>
                      </div>
                    </div>
                  )}
                  {customTopicStoryboardUrl && (
                    <div className="space-y-3 md:col-span-1">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#8cefff]/70">
                        {customTopicGridVariant === "3x4" ? "3×4 十二格分镜" : "2×4 八格分镜"}
                      </div>
                      <img
                        src={customTopicStoryboardUrl}
                        alt="自定义选题分镜"
                        className="w-full rounded-2xl border border-white/10 object-contain shadow-[0_12px_48px_rgba(0,0,0,0.35)]"
                      />
                      <div className="flex justify-end">
                        <a
                          href={customTopicStoryboardUrl}
                          download={`custom-topic-storyboard-${customTopicGridVariant}.png`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[rgba(73,230,255,0.15)]"
                        >
                          <Download className="h-4 w-4" />
                          下载分镜
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          ) : customWorkspaceTab === "imageGen" ? (
            <div className="mb-4">
              <PlatformImageGenPanel
                disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
              />
            </div>
          ) : null}

              </PlatformCreateWorkbench>
            ) : null}

            {platformMode === "tools" ? (
              <PlatformToolsWorkbench
                activeTab={
                  customWorkspaceTab === "matting" || customWorkspaceTab === "assets" || customWorkspaceTab === "htmlPpt"
                    ? customWorkspaceTab
                    : "htmlPpt"
                }
                onTabChange={(tab) => applyPlatformMode("tools", { toolTab: tab, skipDirtyCheck: true })}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
              >
                <div className="mb-3 hidden lg:block">{stickyCtaNode}</div>
                <div id="platform-tools-htmlppt" className="scroll-mt-24">
          {customWorkspaceTab === "htmlPpt" ? (
            <PlatformHtmlPptPanel
              disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
            />
          ) : customWorkspaceTab === "assets" ? (
            <>
              <PlatformAssetAnalysisPanel
                debugMode={debugMode}
                supervisorAccess={hasSupervisorOpsAccess}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy}
                personaSummary={personaSummary}
                ipProfile={undefined}
                trendPlatforms={
                  snapshot?.platformSnapshots
                    ?.slice(0, 4)
                    .map((p) => p.platform)
                    .filter(Boolean) as Array<
                    "douyin" | "xiaohongshu" | "bilibili" | "kuaishou" | "weixin_channels" | "toutiao"
                  >
                }
                onBusyChange={setAssetAnalysisBusy}
                onDeepOptimize={handleAssetDeepOptimize}
                onShootingTechniqueReady={(brief) => {
                  lastShootingTechniqueBriefRef.current = brief;
                }}
                onLearnVideoRhythm={async ({ gcsUri, fileName, title }) => {
                  await runManhuaTemplateLearnCloud(
                    {
                      gcsUri,
                      fileName,
                      localFileName: fileName,
                      mixName: title,
                      platform: "upload",
                      learnLlm: "gpt",
                    },
                    0,
                  );
                }}
                onGenerateFromText={handleAssetGenerateFromText}
                optimizeCopyCost={customOptimizeCopyCost}
              />
              {(customNoteImageUpper || customNoteImageLower) && !customNoteBusy ? (
                <div className="mt-6 grid gap-4 md:grid-cols-2">
                  {customNoteImageUpper ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#8cefff]/70">
                        {customNoteImageLower ? "上篇" : "生成结果"}
                      </div>
                      <img
                        src={customNoteImageUpper}
                        alt="素材流程生成图"
                        className="w-full rounded-2xl border border-white/10 object-contain shadow-[0_12px_48px_rgba(0,0,0,0.35)]"
                      />
                    </div>
                  ) : null}
                  {customNoteImageLower ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#ff9fe0]/70">下篇</div>
                      <img
                        src={customNoteImageLower}
                        alt="素材流程生成图下篇"
                        className="w-full rounded-2xl border border-white/10 object-contain shadow-[0_12px_48px_rgba(0,0,0,0.35)]"
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
              {customNoteBusy && customWorkspaceTab === "assets" ? (
                <div className="mt-5 flex items-center gap-2 rounded-2xl border border-[#ff4fb8]/15 bg-[rgba(255,79,184,0.05)] px-4 py-3 text-sm text-[#ff9fe0]/80">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#ff4fb8]" />
                  正在生成图片，约需 3–5 分钟，请勿关闭页面…
                </div>
              ) : null}
              {customNoteError && customWorkspaceTab === "assets" ? (
                <div className="mt-5 flex flex-wrap items-center gap-3 rounded-2xl border border-red-500/25 bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm text-red-300">
                  <span className="min-w-0 flex-1">❌ {customNoteError}</span>
                  <button
                    type="button"
                    onClick={() => void handleGenerateCustomNote()}
                    className="shrink-0 rounded-lg border border-red-300/40 px-3 py-1 text-xs font-semibold text-red-200 transition-colors hover:bg-red-500/20"
                  >
                    重试
                  </button>
                </div>
              ) : null}
            </>

          ) : (
            <>
              <div className="mb-5 grid gap-2 sm:grid-cols-2">
                <PlatformWorkspaceStepHint
                  step={1}
                  title="描述场景"
                  lines={["写人物姿态、服装与背景提示词。", "需要白底主体请在描述中注明「去背景」。"]}
                  active={!customMattingPrompt.trim()}
                  done={Boolean(customMattingPrompt.trim())}
                />
                <PlatformWorkspaceStepHint
                  step={2}
                  title="生成下载"
                  lines={["选择比例与张数，点击开始生成。", `单张 ${CREDIT_COSTS.platformCustomMattingImage} 积分，2/4 张有折扣。`]}
                  active={Boolean(customMattingPrompt.trim()) && customMattingImages.length === 0}
                  done={customMattingImages.length > 0}
                />
              </div>

              <div className="space-y-4">
                <div>
                  <label className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-1.5 block">
                    主体描述 / 场景提示词
                  </label>
                  <textarea
                    className="w-full min-h-[120px] resize-y rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm leading-relaxed text-white placeholder-[#6d6384] focus:border-[#34d399]/60 focus:outline-none focus:ring-1 focus:ring-[#34d399]/30 transition"
                    placeholder="例：年轻女医生穿白大褂，坐姿，微笑，背景是明亮的书房；或：全身站姿，自动去背景，双手自然下垂…"
                    value={customMattingPrompt}
                    onChange={(e) => setCustomMattingPrompt(e.target.value)}
                    disabled={customMattingBusy}
                  />
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-2">画面比例</div>
                  <div className="flex flex-wrap gap-1.5">
                    {(["9:16", "16:9", "3:4", "4:3", "21:9"] as const).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setCustomMattingAspect(ratio)}
                        disabled={customMattingBusy}
                        className={`rounded-lg px-3 py-1.5 text-[12px] font-semibold transition disabled:opacity-50 ${
                          customMattingAspect === ratio
                            ? "bg-[linear-gradient(135deg,#34d399,#059669)] text-white shadow-sm"
                            : "border border-white/10 bg-black/35 text-[#c9c0e6]/70 hover:text-white"
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-2">一次生成张数</div>
                  <div className="inline-flex rounded-xl border border-white/10 bg-black/35 p-0.5 gap-0.5">
                    {([1, 2, 4] as const).map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setCustomMattingCount(n)}
                        disabled={customMattingBusy}
                        className={`rounded-lg px-4 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
                          customMattingCount === n
                            ? "bg-[linear-gradient(135deg,#34d399,#059669)] text-white shadow-sm"
                            : "text-[#c9c0e6]/70 hover:text-white"
                        }`}
                      >
                        {n} 张
                        {n === 1 ? " · 原价" : n === 2 ? " · 九折" : " · 八折"}
                      </button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-[#c9c0e6]/50">
                    本次合计 <strong className="text-[#6ee7b7]">{customMattingCost} 积分</strong>
                    {customMattingCount > 1 && `（单张 ${CREDIT_COSTS.platformCustomMattingImage} × ${customMattingCount}${customMattingCount === 2 ? " × 0.9" : " × 0.8"}）`}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => void handleGenerateCustomMatting()}
                    disabled={customMattingBusy || customMattingPrompt.trim().length < 4}
                    className="inline-flex items-center gap-2 rounded-full border border-[#34d399]/30 bg-[linear-gradient(135deg,#34d399,#059669)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_6px_24px_rgba(52,211,153,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {customMattingBusy ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />生成抠像中…</>
                    ) : (
                      <><Scissors className="h-4 w-4" />开始生成（{customMattingCost} 积分）</>
                    )}
                  </button>
                  {(customMattingImages.length > 0 || customMattingError) && !customMattingBusy && (
                    <button
                      type="button"
                      onClick={() => {
                        setCustomMattingImages([]);
                        setCustomMattingError(null);
                        setCustomMattingTransparentCutout(false);
                        setCustomMattingPrompt("");
                      }}
                      className="text-xs text-[#c9c0e6]/60 hover:text-white transition"
                    >
                      清除
                    </button>
                  )}
                </div>
              </div>

              {customMattingBusy && (
                <div className="mt-5 flex items-center gap-2 rounded-2xl border border-[#34d399]/15 bg-[rgba(52,211,153,0.05)] px-4 py-3 text-sm text-[#6ee7b7]/80">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#34d399]" />
                  正在生成 {customMattingCount} 张 {customMattingAspect} 图片，每张约 2–4 分钟，请勿关闭页面…
                </div>
              )}

              {customMattingError && (
                <div className="mt-5 rounded-2xl border border-red-500/25 bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm text-red-300">
                  ❌ {customMattingError}
                </div>
              )}

              {customMattingImages.length > 0 && (
                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {customMattingImages.map((url, idx) => (
                    <div key={`${url}-${idx}`} className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#6ee7b7]/70">
                        生成结果 #{idx + 1} · {customMattingAspect}
                        {customMattingTransparentCutout ? " · 白底主体" : ""}
                      </div>
                      <div
                        className={
                          customMattingTransparentCutout
                            ? "rounded-2xl border border-white/10 bg-white p-3"
                            : "rounded-2xl border border-white/10 bg-black/20 p-3"
                        }
                      >
                        <img
                          src={url}
                          alt={`自定义抠像 ${idx + 1}`}
                          className="w-full rounded-xl object-contain max-h-[420px]"
                          onError={(e) => {
                            (e.target as HTMLImageElement).style.display = "none";
                            setCustomMattingError("图片加载失败，请确认 URL 是否有效");
                          }}
                        />
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomTopicPhotoUrl(url);
                            setCustomTopicPhotoPreview(url);
                            setCustomWorkspaceTab("topic");
                            toast.success("已设为参考人像，可在「主人公融合选题」生成封面与分镜");
                          }}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[rgba(73,230,255,0.15)]"
                        >
                          <UserRound className="h-4 w-4" />
                          设为参考人像
                        </button>
                        <a
                          href={url}
                          download={`custom-matting-${customMattingAspect.replace(":", "x")}-${idx + 1}.png`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#34d399]/25 bg-[rgba(52,211,153,0.08)] px-4 py-2 text-sm font-semibold text-[#6ee7b7] transition hover:bg-[rgba(52,211,153,0.15)]"
                        >
                          <Download className="h-4 w-4" />
                          下载 PNG
                        </a>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
                </div>
              </PlatformToolsWorkbench>
            ) : null}
          </div>
        </section>

        <div className="lg:hidden">
          <PlatformStickyCtaRail
            variant="bar"
            title={platformMode === "trend" ? "趋势分析" : platformMode === "tools" ? "工具操作" : "内容创作"}
            label={activePrimaryCta.label}
            creditsLabel={activePrimaryCta.creditsLabel}
            disabled={activePrimaryCta.disabled}
            disabledReason={activePrimaryCta.disabledReason}
            busy={activePrimaryCta.busy}
            onClick={() => runActivePrimaryCta()}
            onDisabledAttempt={() => recordCtaDisabled()}
          />
        </div>

        <PlatformSkillDrawer open={skillDrawerOpen} onClose={() => setSkillDrawerOpen(false)} title="Skill 与顾问">
          {platformSkillsAccessoryPanel}
        </PlatformSkillDrawer>

        {customWorkspaceOperating && platformMode === "create" ? (
          <p className="mb-4 text-center text-xs text-[#c9c0e6]/45">
            自定义文案/选题/抠像进行中，下方选题区已收起；平台趋势报表与视频深度拆解仍可在上方工作台查看。
          </p>
        ) : null}
        <div
          className={
            platformMode === "tools" || customWorkspaceOperating
              ? "hidden"
              : undefined
          }
          aria-hidden={platformMode === "tools" || customWorkspaceOperating}
        >
        <section className={shellCardClasses("overflow-hidden p-5 md:p-6")}>
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(73,230,255,0.55),transparent)]" />
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#362561] bg-[rgba(23,13,53,0.9)] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#aa95dc]">
                <TrendingUp className="h-3.5 w-3.5" />
                平台顾问台
              </div>
              {/* 双入口大按钮已由顶栏模式切换替代，避免同屏两套主任务 */}
              <div className="mt-4 hidden flex-col gap-3" aria-hidden>
                <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#8cefff] md:text-base">
                  本页付费能力 · 一键直达
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                  <button
                    type="button"
                    onClick={() => void scrollToPaidPlatformTrends()}
                    className="group flex min-w-0 flex-1 items-center gap-4 rounded-2xl border-2 border-white/15 bg-[rgba(255,255,255,0.07)] px-5 py-4 text-left transition hover:border-[#49e6ff]/45 hover:bg-[rgba(73,230,255,0.12)] md:min-w-[15rem] md:px-6 md:py-5 sm:flex-none"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#49e6ff]/35 bg-[#49e6ff]/15 text-[#8cefff] md:h-14 md:w-14">
                      <BarChart3 className="h-6 w-6 md:h-7 md:w-7" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-white md:text-lg">平台趋势分析</span>
                        <span className="rounded-full border border-[#fef08a]/40 bg-[rgba(254,240,138,0.15)] px-2.5 py-0.5 text-xs font-semibold text-[#fef08a]">
                          {getPlatformTrendReportCredits(selectedWindowDays)} 积分/次
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-snug text-[#c4b8e8] md:text-[15px]">
                        四格趋势摘要与可下载 PNG 图文报表（不含专属文案 / 决策智库）
                      </p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void scrollToPaidDecisionIntel()}
                    className="group flex min-w-0 flex-1 items-center gap-4 rounded-2xl border-2 border-white/15 bg-[rgba(255,255,255,0.07)] px-5 py-4 text-left transition hover:border-[#ff4fb8]/45 hover:bg-[rgba(255,79,184,0.12)] md:min-w-[15rem] md:px-6 md:py-5 sm:flex-none"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-[#0a0a0f] p-1 md:h-14 md:w-14">
                      <img
                        src="/brand/mvstudiopro-strategic-intel-logo.png"
                        alt=""
                        className="h-full w-full object-contain"
                        width={112}
                        height={112}
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-white md:text-lg">MV Studio Pro AI 决策智库</span>
                        <span className="rounded-full border border-[#f472b6]/45 bg-[rgba(244,114,182,0.15)] px-2.5 py-0.5 text-xs font-semibold text-[#fbcfe8]">
                          单独加购
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-snug text-[#c4b8e8] md:text-[15px]">基于全案背景生成可视化决策报告；不含在全案积分内</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void scrollToPaidDeepQa()}
                    className="group flex min-w-0 flex-1 items-center gap-4 rounded-2xl border-2 border-white/15 bg-[rgba(255,255,255,0.07)] px-5 py-4 text-left transition hover:border-[#a78bfa]/50 hover:bg-[rgba(167,139,250,0.14)] md:min-w-[15rem] md:px-6 md:py-5 sm:flex-none"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#a78bfa]/40 bg-[#a78bfa]/18 text-[#ddd6fe] md:h-14 md:w-14">
                      <MessageSquareText className="h-6 w-6 md:h-7 md:w-7" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-white md:text-lg">深度追问</span>
                        <span className="rounded-full border border-[#c4b5fd]/40 bg-[rgba(196,181,253,0.14)] px-2.5 py-0.5 text-xs font-semibold text-[#e9d5ff]">
                          按次扣点
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-snug text-[#c4b8e8] md:text-[15px]">基于当前窗口数据追问到形式、节奏与承接</p>
                    </div>
                  </button>
                </div>
              </div>
              {/* 落地页式大标题与卖点格已移除：工作台里用户要的是操作面，宣传话留在首页（用户 2026-08-06） */}
              <p className="mt-4 max-w-3xl text-sm leading-7 text-[#c9c0e6]/70">
                {platformDashboard?.subheadline || personaSummary}
              </p>

            </div>

            <div id={PLATFORM_SECTION_TREND_RUN_ID} className="scroll-mt-20 grid gap-4">
              <div className="rounded-[26px] border border-[#2a1c55] bg-[linear-gradient(180deg,rgba(28,16,60,0.96),rgba(12,8,28,0.96))] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <CalendarRange className="h-4 w-4 text-[#49e6ff]" />
                  选择分析窗口
                </div>
                <div className="mt-4 grid gap-3">
                  {WINDOW_OPTIONS.map((item) => {
                    const active = item.days === selectedWindowDays;
                    return (
                      <button
                        key={item.days}
                        type="button"
                        onClick={() => setSelectedWindowDays(item.days)}
                        className={`rounded-2xl border px-4 py-4 text-left transition ${
                          active
                            ? "border-[#49e6ff]/45 bg-[linear-gradient(135deg,rgba(73,230,255,0.14),rgba(125,115,255,0.10))] shadow-[0_0_0_1px_rgba(73,230,255,0.15)]"
                            : "border-white/10 bg-white/5 hover:bg-white/10"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className={`text-lg font-bold ${active ? "text-[#8cefff]" : "text-white"}`}>{item.label}</div>
                          {active ? <div className="rounded-full bg-[rgba(73,230,255,0.12)] px-2 py-1 text-[11px] text-[#8cefff]">当前窗口</div> : null}
                        </div>
                        <div className="mt-1 text-sm leading-6 text-[#b7add8]">{item.description}</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {debugMode && (
                <div className="rounded-[26px] border border-[#2a1c55] bg-[rgba(11,7,26,0.94)] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">封面 / 分镜 · 中文直送</div>
                      <p className="mt-1 text-xs leading-relaxed text-white/55">
                        封面为中文直送 + OpenAI 官方 Image-2（不走 OpenRouter）；编导分镜同为中文直送像素链。
                      </p>
                    </div>
                    <div className="rounded-full border border-amber-400/50 bg-[rgba(251,191,36,0.12)] px-4 py-2 text-xs font-semibold text-amber-100">
                      中文直送
                    </div>
                  </div>
                </div>
              )}

              {debugMode && (
                <div className="rounded-[26px] border border-[#2a1c55] bg-[rgba(11,7,26,0.94)] p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">文案引擎（战略看板 + 专属文案 + 深度追问）</div>
                      <p className="mt-1 text-xs leading-relaxed text-white/55">
                        战略看板、专属选题文案与深度追问走平台文案引擎；Debug 会显示实际进度与用量。
                      </p>
                    </div>
                    <div className="rounded-full border border-amber-400/50 bg-[rgba(251,191,36,0.12)] px-4 py-2 text-xs font-semibold text-amber-100">
                      文案引擎
                    </div>
                  </div>
                </div>
              )}

              {canConfigureStage2CopyEngine && debugMode ? (
                <div className="rounded-[26px] border border-amber-500/20 bg-[rgba(120,53,15,0.08)] px-5 py-3 text-xs text-white/50">
                  监管提示：文案与深度追问已固定平台文案引擎；封面固定 OpenAI 官方 Image-2（无 Nano Banana 可选）。
                </div>
              ) : null}

              {/*
                旧版「人物背景与创作诉求 + 生成选题 + 选题列表 + 文案区」整段已撤除。
                这一页曾把新工作台与旧版页面上下叠着放，同样的东西渲染两遍：两个人物背景输入框、
                两份选题列表、两份文案区，用户点完按钮还得往下找结果（用户 2026-08-06：版面太混乱）。
                现在只保留工作台里那一份，这里只留跑完后的下载入口。
              */}
              {hasAnalyzed && !isDashboardLoading && !isContentLoading ? (
                <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] px-4 py-3">
                  <span className="text-[12px] text-[#c9c0e6]/60">当前窗口：近 {selectedWindowDays} 天</span>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPlatformPdf()}
                    disabled={isDownloadingPdf}
                    className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-2 text-xs font-semibold text-[#c9c0e6] transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDownloadingPdf ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        生成中…
                      </>
                    ) : (
                      <>
                        <FileText className="h-3 w-3" />
                        下载 PDF
                      </>
                    )}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </section>

        {isAnalyzing ? (
          <section className="mt-6 grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
            <div className={shellCardClasses("p-6")}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Loader2 className="h-4 w-4 animate-spin text-[#49e6ff]" />
                平台分析进行中
              </div>
              <div className="mt-3 text-sm leading-7 text-[#c8bfe7]">
                这一版会先读取近 {selectedWindowDays} 天平台快照，再整理热点、赛道和商业化建议。就算需要更长时间，也会把每一步拆给用户看。
              </div>
              {/* Phase 2-A: Show wait notice after 20s to prevent user from thinking the page is frozen */}
              {elapsedTime >= 20 ? (
                <div className="mt-4 rounded-2xl border border-[#ffdd44]/20 bg-[rgba(255,221,68,0.06)] p-4 text-sm leading-7 text-[#ffeea0]">
                  ⏳ 顾问报告正在生成中，通常需要 15–35 秒。请勿关闭页面，结果会自动显示。
                </div>
              ) : null}
              {activeProcessingStep ? (
                <div className="mt-5 rounded-2xl border border-[#2f2558] bg-[rgba(255,255,255,0.04)] p-4">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">当前阶段</div>
                  <div className="mt-2 text-lg font-semibold text-white">{activeProcessingStep.label}</div>
                  <div className="mt-2 text-sm leading-7 text-[#d3caef]">{activeProcessingStep.detail}</div>
                </div>
              ) : null}
              <div className="mt-5 space-y-3">
                {animatedProcessingSteps.map((step) => (
                  <div key={step.id} className={`rounded-2xl border p-4 transition ${
                    step.status === "done"
                      ? "border-[#284f4c] bg-[rgba(111,255,176,0.08)]"
                      : step.status === "active"
                        ? "border-[#2f5a7a] bg-[rgba(73,230,255,0.10)]"
                        : "border-white/10 bg-[rgba(255,255,255,0.04)]"
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-sm font-semibold text-white">{step.animatedLabel}</div>
                      <div className={`rounded-full px-2 py-1 text-[11px] ${
                        step.status === "done"
                          ? "bg-[rgba(111,255,176,0.12)] text-[#92ffc1]"
                          : step.status === "active"
                            ? "bg-[rgba(73,230,255,0.12)] text-[#8cefff]"
                            : "bg-[rgba(255,255,255,0.05)] text-[#b5abd5]"
                      }`}>
                        {step.status === "done" ? "完成" : step.status === "active" ? "进行中" : "待处理"}
                      </div>
                    </div>
                    <div className="mt-2 text-sm leading-7 text-[#d3caef]">{step.animatedDetail}</div>
                  </div>
                ))}
              </div>
            </div>

          </section>
        ) : null}

        <section
          id={PLATFORM_SECTION_TREND_SIGNALS_ID}
          className="scroll-mt-20 mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4"
        >
          {resultSummaryCards.map((item, index) => (
            <div key={`${item.label}-${index}`} className={shellCardClasses("p-5 flex flex-col justify-center")}>
              {item.isLoadingSkeleton ? (
                <div className="flex h-full w-full animate-pulse flex-col justify-center rounded-lg border border-white/5 bg-[rgba(255,255,255,0.02)] p-4 text-center">
                  <Loader2 className="mx-auto mb-2 h-5 w-5 animate-spin text-[#49e6ff]/50" />
                  <div className="text-[13px] font-semibold text-[#8cefff]/70">{item.value}</div>
                  <div className="mt-1 text-[11px] text-[#c9c0e6]/50">{item.detail}</div>
                </div>
              ) : (
                <>
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff]">{item.label}</div>
                  <div className="mt-3 text-xl font-bold leading-8 text-white">{item.value}</div>
                  <div className="mt-3 text-sm leading-7 text-[#c9c0e6]">{item.detail}</div>
                </>
              )}
            </div>
          ))}
        </section>

        {/* Debug panel: show as soon as snapshot is available */}
        {snapshot && debugMode ? (
          <section className="mt-6">
            <div className={shellCardClasses("p-5")}>
              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                <Bot className="h-4 w-4 text-[#49e6ff]" />
                Debug Flow
              </div>

              <div className="mt-4 rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">流程摘要</div>
                <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs leading-6 text-[#d7d0ef]">
                  <div>
                    快照 ·{" "}
                    {growthSnapshotQuery.isFetched
                      ? `✅ ${snapshotDebug?.baseSource ?? ""}`
                      : growthSnapshotQuery.isFetching
                        ? "⏳"
                        : "⏸"}
                  </div>
                  <div>
                    Stage 1 看板 ·{" "}
                    {isDashboardLoading ? "⏳" : platformDashboard ? "✅" : "⏸"}
                  </div>
                  <div>
                    Stage 2 文案 ·{" "}
                    {isContentLoading
                      ? "⏳"
                      : platformContent && !stage2EmptyPayload
                        ? "✅"
                        : platformContent && stage2EmptyPayload
                          ? "⚠️ 空载荷"
                          : contentJobError || stage2Failed
                            ? "❌"
                            : "⏸"}
                  </div>
                  <div className="text-[10px] text-gray-500">
                    QA · {isQaLoading ? "⏳" : qaJobId ? "✅" : "⏸"}{" "}
                    {qaJobId ? <span className="font-mono text-gray-400">· {qaJobId}</span> : null}
                  </div>
                </div>
                {!pipelineDebugShowExtras && isDashboardLoading ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-[#8cefff]">当前：战略看板生成中…</div>
                ) : null}
                {!pipelineDebugShowExtras && isContentLoading && contentJobPollTrace?.currentStep ? (
                  <div className="mt-2 text-[11px] leading-relaxed text-gray-300">
                    当前：{contentJobPollTrace.currentStep}
                  </div>
                ) : null}
              </div>

              {pipelineDebugShowExtras ? (
                <>
                  <div className="mt-4 rounded-2xl border border-rose-500/35 bg-[rgba(127,29,29,0.12)] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-rose-200">错误 / 异常摘要</div>
                    <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[#fde8e8]">
                      {(
                        [
                          growthSnapshotQuery.error?.message,
                          getPlatformDashboardMutation.error?.message,
                          askPlatformFollowUpMutation.error?.message,
                          contentJobError,
                          typeof dashboardDebug?.error === "string" ? dashboardDebug.error : null,
                          typeof contentDebug?.stage2Error === "string" ? contentDebug.stage2Error : null,
                          stage2EmptyPayload
                            ? "Stage 2 返回空选题：请查看下方 Stage 2.debug（如 buildPlatformContent / jsonParseStrategy / rawContentEmpty）。"
                            : null,
                        ]
                          .filter(Boolean)
                          .join("\n\n") || "（无聚合错误文案 — 请结合下方分步与 JSON）"
                      )}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">详细分步（异常诊断）</div>
                    <div className="mt-4 space-y-1 text-xs leading-6 text-[#d7d0ef]">
                      <div className="text-[#8cefff] font-semibold">── Call 1: 快照 ──</div>
                      <div>1. 快照分析 (getGrowthSnapshot — 同步 tRPC query)</div>
                      <div>
                        1a. 状态:{" "}
                        {growthSnapshotQuery.isFetched
                          ? `✅ 已返回 (${snapshotDebug?.baseSource})`
                          : growthSnapshotQuery.isFetching
                            ? "⏳ 进行中"
                            : "⏸ 未开始"}
                      </div>
                      <div>1b. 真实采集: {String(snapshotDebug?.hasAnyLiveCollection ?? "?")} / 平台数: {(snapshotDebug as any)?.stalePlatforms !== undefined ? `${(snapshotDebug as any)?.platformCount ?? 4}` : "?"}</div>
                      <div>1c. storeMs: {String((snapshotDebug?.timing as any)?.storeMs ?? "?")}</div>
                      <div className="text-[#8cefff] font-semibold mt-1">── Stage 1: 看板先行 ──</div>
                      <div>2. 平台优先级看板（getPlatformDashboard）</div>
                      <div>
                        2a. 状态:{" "}
                        <span>
                          {isDashboardLoading ? "⏳ 正在推演战略看板..." : platformDashboard ? "✅ 已完成" : "⏸ 等待"}
                        </span>
                      </div>
                      <div>2b. headline: {(platformDashboard as any)?.headline?.slice(0, 60) || "-"}</div>
                      <div>2c. hotTopics: {(platformDashboard as any)?.hotTopics?.length ?? "-"} 条</div>
                      <div className="text-[#8cefff] font-semibold mt-1">── Stage 2: 文案与选题跟进 ──</div>
                      <div>
                        3. 专属文案（enqueuePlatformContentJob · 入队时扣 {CREDIT_COSTS.platformStage2Copywriting} 积分 → Fly worker；轮询见下方面板）
                      </div>
                      <div>
                        3a. 状态:{" "}
                        <span>
                          {isContentLoading
                            ? "⏳ 正在生成原创文案..."
                            : platformContent && !stage2EmptyPayload
                              ? "✅ 已完成"
                              : platformContent && stage2EmptyPayload
                                ? "⚠️ 接口成功但内容为空"
                                : contentJobError
                                  ? "❌ 解析失败"
                                  : "⏸ 等待 Stage 1"}
                        </span>
                      </div>
                      <div>3b. contentBlueprints: {(platformContent as any)?.contentBlueprints?.length ?? "-"} 条</div>
                      <div>3c. monetizationLanes: {(platformContent as any)?.monetizationLanes?.length ?? "-"} 条</div>
                      <div>
                        3f. Stage2 max_output:{" "}
                        <span className="font-mono text-[#ffdd44]">
                          {String(
                            (contentDebug?.buildPlatformContent as { stage2MaxOutputTokens?: number } | undefined)
                              ?.stage2MaxOutputTokens ?? "—",
                          )}
                        </span>
                      </div>
                      <div className="break-words">
                        3g. 文案推理诊断:{" "}
                        <span className="font-mono text-[10px] text-[#d7d0ef]">
                          {(() => {
                            const r = (
                              contentDebug?.buildPlatformContent as { openaiGpt5ReasoningEffort?: unknown } | undefined
                            )?.openaiGpt5ReasoningEffort;
                            return r != null ? JSON.stringify(r) : "—";
                          })()}
                        </span>
                      </div>
                      <div className="break-words">
                        3h. Stage 2 当前步骤:{" "}
                        <span className="font-mono text-[10px] text-[#d7d0ef]">
                          {pickActiveStage2SubStepOneLine(contentDebug ?? undefined) ?? "—"}
                        </span>
                      </div>
                      <details className="mt-2 rounded-lg border border-white/10 bg-black/25 px-2 py-1.5">
                        <summary className="cursor-pointer select-none text-[10px] text-gray-400">
                          展开全部 Stage 2 子步（仅排查需要）
                        </summary>
                        <div className="mt-2 space-y-0.5 pl-1 font-mono text-[10px] text-[#d7d0ef]">
                          {(() => {
                            const bp = contentDebug?.buildPlatformContent as
                              | {
                                  stage2SubSteps?: { id: string; title: string; model?: string; status: string }[];
                                }
                              | undefined;
                            const sub = bp?.stage2SubSteps;
                            if (!Array.isArray(sub) || sub.length === 0) {
                              return <div>—</div>;
                            }
                            return sub.map((s) => (
                              <div key={s.id}>
                                <span className="text-[#ffdd44]">{s.id}</span> {s.title}
                                {s.model ? <span className="text-gray-500"> · model={s.model}</span> : null} · {s.status}
                              </div>
                            ));
                          })()}
                        </div>
                      </details>
                      <div className="text-[#8cefff] font-semibold mt-1">── QA 答疑 Job ──</div>
                      <div>4. 纯文本对话分析（支持 fileUri 多模态）</div>
                      <div>
                        4a. QA Job ID: <span className="font-mono text-[#ffdd44]">{qaJobId || "未创建"}</span>
                      </div>
                      <div>4b. 状态: {isQaLoading ? "⏳ 运行中，轮询每 3 秒" : qaJobId ? "✅ job 已完成" : "⏸ 等待提问"}</div>
                    </div>
                  </div>

                  <div className="mt-4 space-y-4">
                    <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">getGrowthSnapshot.debug</div>
                      <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                        {JSON.stringify(snapshotDebug || null, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">getPlatformDashboard.debug</div>
                      <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                        {JSON.stringify(dashboardDebug || null, null, 2)}
                      </pre>
                    </div>
                    <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">Stage 2 · debug</div>
                      <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                        {JSON.stringify(contentDebug || null, null, 2)}
                      </pre>
                    </div>
                  </div>
                </>
              ) : null}

              {flyJobsPollDebugPanel ? <div className="mt-4">{flyJobsPollDebugPanel}</div> : null}
            </div>
          </section>
        ) : null}

        {snapshot && !platformDashboard && isDashboardLoading ? (
          <section className="mt-6">
            <div className={shellCardClasses("p-6")}>
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-[#49e6ff]" />
                <div>
                  <div className="text-sm font-semibold text-white">平台样本已就绪，正在生成战略优先级看板…</div>
                  <div className="mt-1 text-xs text-[#b7add8]">
                    通常 30–90 秒生成<strong className="text-[#d4d4ff]">平台优先级与切入方向</strong>，随后自动入队选题文案与分镜脚本（不含出图与决策智库报告）。请勿关闭页面。
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {/* 有战略看板，或仅有扩写执行卡（全案选题→就写这条）时都要挂出封面/分镜区；禁止再被 platformDashboard 门闩挡死 */}
        {(Boolean(snapshot && platformDashboard) || visibleExecutionCards.length > 0) ? (
          <section id="platform-report" className="mt-8 space-y-6">
            {platformDashboard ? (
              <>
            {/* 仅写入 PDF 快照：页面视觉隐藏，克隆后于导出前移除 hidden（含顾问台主标 + 四格摘要，避免报告缺头） */}
            <div
              data-pdf-only
              className="hidden space-y-4 rounded-2xl border border-[#49e6ff]/20 bg-[rgba(7,10,20,0.92)] p-4 md:p-5"
            >
              <div className="inline-flex items-center gap-2 rounded-full border border-[#362561] bg-[rgba(23,13,53,0.9)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#aa95dc]">
                <TrendingUp className="h-3.5 w-3.5 shrink-0" aria-hidden />
                平台顾问台
              </div>
              <p className="text-xs font-semibold text-[#8cefff]">分析窗口 · {getWindowLabel(selectedWindowDays)}</p>
              <div className="space-y-3">
                <div className="text-sm font-bold uppercase tracking-[0.14em] text-[#8cefff] md:text-base">
                  本页付费能力 · 一键直达
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">平台趋势分析</span>
                      <span className="rounded-full border border-[#fef08a]/40 bg-[rgba(254,240,138,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[#fef08a]">
                        {getPlatformTrendReportCredits(selectedWindowDays)} 积分/次
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-[#c4b8e8]">
                      四格趋势摘要与可下载 PNG 图文报表（不含专属文案 / 决策智库）
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">MV Studio Pro AI 决策智库</span>
                      <span className="rounded-full border border-[#f472b6]/45 bg-[rgba(244,114,182,0.15)] px-2 py-0.5 text-[10px] font-semibold text-[#fbcfe8]">
                        单独加购
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-[#c4b8e8]">基于全案背景的可视化决策报告，不含在全案积分内</p>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-bold text-white">深度追问</span>
                      <span className="rounded-full border border-[#c4b5fd]/40 bg-[rgba(196,181,253,0.14)] px-2 py-0.5 text-[10px] font-semibold text-[#e9d5ff]">
                        按次扣点
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-[#c4b8e8]">基于当前窗口数据追问到形式、节奏与承接</p>
                  </div>
                </div>
              </div>
              <h2 className="max-w-5xl text-2xl font-black leading-tight text-white md:text-4xl">
                不是告诉你&quot;平台都能做&quot;
                <span className="mt-2 block bg-[linear-gradient(135deg,#5af2ff,#7d73ff_45%,#ff75bd_85%)] bg-clip-text text-transparent">
                  而是告诉你现在该先打哪里
                </span>
              </h2>
              <p className="max-w-3xl text-sm leading-7 text-[#d3caef]">{personaSummary}</p>
              <p className="max-w-3xl text-sm leading-7 text-[#b8afd9]">
                {platformDashboard?.subheadline ||
                  "这个页面不做视频上传，不做二次创作流程，不讲空泛平台画像。它只解决三件事：当前时间窗口里，哪个平台值得优先做；热点赛道该怎么切；以及你怎样把这轮内容机会变成真实商业承接。"}
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {heroTrustPoints.map((item) => (
                  <div
                    key={`pdf-hero-${item.label}`}
                    className="rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-3"
                  >
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">{item.label}</div>
                    <div className="mt-2 text-sm leading-7 text-white">{item.value}</div>
                  </div>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {resultSummaryCards.map((item, index) => (
                  <div
                    key={`pdf-context-${index}-${item.label}`}
                    className="rounded-xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-3"
                  >
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#9ddcff]">{item.label}</div>
                    <div className="mt-2 text-base font-bold leading-snug text-white">{item.value}</div>
                    <div className="mt-2 text-sm leading-6 text-[#c9c0e6]">{item.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            <div
              className="scroll-mt-24 rounded-2xl border border-[#f59e0b]/30 bg-[rgba(245,158,11,0.07)] px-4 py-3.5 md:px-5"
              role="region"
              aria-label="生成选题扣费说明"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex shrink-0 items-center gap-2 text-[#ffedd5]">
                  <CircleDollarSign className="h-6 w-6 shrink-0 text-[#fbbf24]" aria-hidden />
                  <span className="text-base font-black tracking-tight text-white sm:text-lg">生成选题 · 扣费说明</span>
                </div>
                <div className="min-w-0 flex-1 text-sm leading-7 text-[#ffe4c4]">
                  「生成选题」会基于你的人物背景，读取近期热点与蓝海词，一次出默认{" "}
                  <strong className="text-white">{PLATFORM_TOPIC_SHORTLIST_FULLCASE_COUNT} 条</strong>选题（可调 25/30）。
                  <strong className="text-white">这步只出题</strong>，按条数计价；挑中哪条点「就写这条」才写文案，封面与分镜按条另计。
                  任务失败或结果不满意，<strong className="text-red-200">积分不予退还</strong>。
                </div>
              </div>
            </div>

            {platformDashboard && topTopics.length > 0 ? (
              <div className="scroll-mt-20 rounded-2xl border border-[#7d73ff]/25 bg-[rgba(12,10,30,0.7)] p-4 md:p-5">
                <div className="flex flex-col gap-1 border-b border-white/8 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <TrendingUp className="h-4 w-4 shrink-0 text-[#c4b5fd]" aria-hidden />
                    <h3 className="text-base font-bold text-white md:text-lg">热点风向标 · 一键出图</h3>
                    <span className="rounded-full border border-[#49e6ff]/30 bg-[#49e6ff]/10 px-2 py-0.5 text-[10px] font-semibold text-[#8cefff]">
                      独立 · 免跑专属文案
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[#b7add8]">
                    基于当前窗口热点切口，可将选题<strong className="text-white">扩写为文案与分镜脚本</strong>（同一选题<strong className="text-white">首次免费</strong>）。
                    <strong className="text-white">封面图与编导分镜图</strong>需在下方执行区<strong className="text-white">另行加购</strong>出图积分。
                  </p>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {topTopics.slice(0, 6).map((t: any, i: number) => {
                    const tTitle = String(t?.title || "").trim();
                    const tKey = normalizeDecisionIntelTopicTitleKey(tTitle);
                    const tBusy = generatingStrategicMapTopicKey === tKey;
                    const tAlready = existingStrategicExecutionTitleKeys.some(
                      (x) => normalizeDecisionIntelTopicTitleKey(x) === tKey,
                    );
                    return (
                      <div
                        key={`${tKey || "topic"}-${i}`}
                        className="flex flex-col gap-2 rounded-xl border border-white/8 bg-black/25 p-3"
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-semibold text-white" title={tTitle}>
                            {tTitle || "（未命名选题）"}
                          </div>
                          {t?.whyHot ? (
                            <div className="mt-1 truncate text-[11px] leading-snug text-white/55" title={String(t.whyHot)}>
                              {String(t.whyHot)}
                            </div>
                          ) : null}
                        </div>
                        <button
                          type="button"
                          disabled={tBusy || generateDecisionIntelTopicCopyMutation.isPending || tTitle.length < 2}
                          onClick={() => void handleQuickHotTopicToExecution(t)}
                          className="inline-flex min-h-[2.1rem] items-center justify-center gap-1.5 self-start rounded-lg border border-[#49e6ff]/40 bg-[#49e6ff]/10 px-3 py-1.5 text-[11px] font-bold text-[#8cefff] transition hover:bg-[#49e6ff]/20 disabled:opacity-45"
                        >
                          {tBusy ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              扩写中…
                            </>
                          ) : tAlready ? (
                            "已在执行区 · 去出图"
                          ) : (
                            "扩写并出图（首次免费）"
                          )}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div
              id={PLATFORM_SECTION_DECISION_INTEL_ID}
              data-pdf-exclude="true"
              className="scroll-mt-20 rounded-2xl border border-[#49e6ff]/25 bg-[rgba(10,15,35,0.75)] p-4 md:p-5"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#49e6ff]/35 bg-[#49e6ff]/10">
                    <Lock className="h-5 w-5 text-[#8cefff]" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white md:text-lg">MV Studio Pro AI 决策智库报告</h3>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#b7add8]">
                      <strong className="text-white">单独加购模块</strong>：需先填写人物背景并生成一次选题，再付费解锁本报告。
                      报告将把你的背景、平台优先级与选题<strong className="text-white">收敛为一页可视化决策地图</strong>（雷达、执行建议与阅读向排行；均为模型辅助推演，不构成效果承诺）。
                      与全案入队扣点<strong className="text-white">分开计费</strong>：首次体验{" "}
                      <strong className="text-[#fde047]">{CREDIT_COSTS.decisionIntelligenceReportFirst} 积分</strong>，之后每次{" "}
                      <strong className="text-[#fde047]">{CREDIT_COSTS.decisionIntelligenceReport} 积分</strong>。
                      <strong className="text-white">不含</strong>封面图、编导分镜图（出图需在执行区另购）。
                      扣费于后台<strong className="text-white">成功产出后结算</strong>并存档；除可验证的系统故障外，<strong className="text-red-200/95">与全案相同不因主观不满意而退点</strong>。
                    </p>
                  </div>
                </div>
                {isAuthenticated ? (
                  <div className="flex shrink-0 flex-col items-stretch gap-2 md:items-end">
                    <span className="text-[11px] text-gray-500">
                      {decisionIntelPricingQuery.data?.priorCompletedCount
                        ? `已生成 ${decisionIntelPricingQuery.data.priorCompletedCount} 次 · 下次 ${decisionIntelPricingQuery.data.nextCredits} 点`
                        : `尚未解锁 · 首次体验 ${CREDIT_COSTS.decisionIntelligenceReportFirst} 点`}
                    </span>
                    {!decisionIntelInputReady ? (
                      <span className="max-w-[14rem] text-[10px] leading-snug text-amber-200/90 md:text-right">
                        请先填写人物背景并生成一次选题，再在此加购决策智库报告。
                      </span>
                    ) : isContentLoading ? (
                      <span className="max-w-[14rem] text-[10px] leading-snug text-[#8cefff]/90 md:text-right">
                        专属文案生成中；趋势看板与战略地图可先解锁，完成后选题会自动纳入。
                      </span>
                    ) : null}
                    <button
                      type="button"
                      disabled={
                        generateDecisionIntelMutation.isPending ||
                        !decisionIntelPricingQuery.data ||
                        !decisionIntelInputReady
                      }
                      onClick={() => {
                        const next = decisionIntelPricingQuery.data?.nextCredits;
                        if (next == null) return;
                        const latestWd = decisionIntelLatestQuery.data?.windowDays;
                        if (
                          latestWd != null &&
                          latestWd !== selectedWindowDays &&
                          decisionIntelLatestQuery.data?.report
                        ) {
                          const okWin = window.confirm(
                            `您已存档的战略地图为「近 ${latestWd} 天」分析窗口；目前页面选的是「近 ${selectedWindowDays} 天」。\n\n重新生成将依新窗口重算日期区间与模型指纹，并可能依价格表扣除积分（与旧报告参数不同时不会免费命中缓存）。是否继续？`,
                          );
                          if (!okWin) return;
                        }
                        if (!supervisorAccess) {
                          const ok = window.confirm(
                            `将扣除 ${next} 积分，基于你当前的全案结果（人物背景、平台优先级${platformContent ? "、已写入的选题文案与分镜" : ""}）与「近 ${selectedWindowDays} 天」窗口，生成 MV Studio Pro AI 决策智库报告并存档。\n\n本报告为单独加购，不含封面图与编导分镜图。报告为模型辅助阅读与推演，非效果保证；成功出货后恕不因主观不满意退点（与全案说明一致）。是否继续？`,
                          );
                          if (!ok) return;
                        }
                        generateDecisionIntelMutation.mutate({
                          topic: strategicMapTopic,
                          contentBlueprint: strategicMapBlueprint,
                          platformHint: decisionIntelPlatformHint,
                          blueOceanLexicon: decisionIntelBlueOceanLexicon,
                          windowDays: selectedWindowDays,
                          dateRange: formatDecisionIntelDateRangeZh(selectedWindowDays),
                          platformAnalysisEpoch: platformAnalysisEpochRef.current,
                        });
                      }}
                      className="inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl border border-[#ff4fb8]/50 bg-[#ff4fb8]/15 px-4 py-2 text-sm font-bold text-[#ffc6e8] transition hover:bg-[#ff4fb8]/25 disabled:opacity-45"
                    >
                      {generateDecisionIntelMutation.isPending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                          解锁中…
                        </>
                      ) : unlockedStrategicReport ? (
                        <>
                          再次生成（{decisionIntelPricingQuery.data?.nextCredits ?? CREDIT_COSTS.decisionIntelligenceReport}{" "}
                          点）
                        </>
                      ) : (
                        <>付费解锁战略地图</>
                      )}
                    </button>
                    {unlockedStrategicReport ? (
                      <button
                        type="button"
                        disabled={isExportingStrategicPng}
                        onClick={() => void handleExportStrategicDashboardPng()}
                        className="inline-flex min-h-[2.5rem] items-center justify-center gap-2 rounded-xl border border-[#49e6ff]/40 bg-[#49e6ff]/10 px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[#49e6ff]/20 disabled:opacity-45"
                      >
                        {isExportingStrategicPng ? (
                          <>
                            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                            导出中…
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 shrink-0" />
                            导出报告图（PNG）
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-amber-200/90">登入后可解锁此增值模组。</p>
                )}
              </div>

              <div className="platform-report-dashboard-shell relative mt-5 overflow-x-auto overflow-y-visible rounded-xl border border-white/10 bg-black/40">
                {unlockedStrategicReport ? (
                  <div className="w-full overflow-x-auto overflow-y-visible">
                    <div ref={strategicReportDashboardRef} className="inline-block align-top">
                      <PlatformReportDashboard
                        data={unlockedStrategicReport}
                        className="!min-h-0"
                        giftedStructureTitles={strategicMapGiftedStructureTitles}
                        existingExecutionTitleKeys={existingStrategicExecutionTitleKeys}
                        onGenerateTopicCopy={(pick) => void handleStrategicMapGenerateTopicCopy(pick)}
                        onRegenerateTopicCopy={(pick) => void handleStrategicMapRegenerateTopicCopy(pick)}
                        generatingTopicCopyKey={generatingStrategicMapTopicKey}
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <DecisionIntelLockedDemoPreview
                      footnote={
                        strategicMapPreviewReport
                          ? "上为匿名化演示样张（英文与品牌区已打码）。加购后将依你的全案背景与看板结果生成清晰专属版并存档。"
                          : "上为匿名化演示样张（英文与品牌区已打码）。生成过选题后可单独加购，获取基于你背景与数据的完整报告。"
                      }
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 md:p-4">
                      <div className="flex max-w-lg flex-col items-center gap-2 rounded-2xl border border-[#49e6ff]/25 bg-[#070a12]/90 px-4 py-3 text-center shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
                        <Lock className="h-7 w-7 text-[#8cefff]/90" aria-hidden />
                        <p className="text-sm font-semibold text-white">
                          {strategicMapPreviewReport ? "试读样张 · 加购拿专属高清版" : "试读样张 · 完成全案后可加购"}
                        </p>
                        <p className="text-[11px] leading-relaxed text-[#d7d0ef]">
                          {strategicMapPreviewReport ? (
                            <>
                              加购后版式与演示一致，但数字与建议均来自<strong className="text-[#fde047]">你的全案背景与看板结果</strong>
                              ，非示意样张。
                            </>
                          ) : (
                            <>
                              请先填写背景并生成一次选题；本报告与选题积分分开计费，价格见上方。
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            {debugMode ? (
              <div className={shellCardClasses("p-5")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Bot className="h-4 w-4 text-[#49e6ff]" />
                  Debug Flow（报告区）
                </div>
                <div className="mt-4 rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">流程摘要</div>
                  <div className="mt-3 space-y-1.5 text-xs leading-6 text-[#d7d0ef]">
                    <div>auth · {supervisorAccess ? "supervisor" : isAuthenticated ? "user" : "guest"}</div>
                    <div>windowDays · {selectedWindowDays} · focus · {focusPrompt || "—"}</div>
                    <div>
                      快照 · {growthSnapshotQuery.isFetched ? "✅" : growthSnapshotQuery.isFetching ? "⏳" : "⏸"} ·
                      query · {growthSnapshotQuery.status}/{growthSnapshotQuery.fetchStatus}
                    </div>
                    <div>
                      Stage 1 · {isDashboardLoading ? "⏳" : platformDashboard ? "✅" : "⏸"} / Stage 2 ·{" "}
                      {isContentLoading ? "⏳" : platformContent && !stage2EmptyPayload ? "✅" : platformContent && stage2EmptyPayload ? "⚠️" : "⏸"}
                    </div>
                    <div>
                      追问 · {askPlatformFollowUpMutation.isPending ? "⏳" : askPlatformFollowUpMutation.isSuccess ? "✅" : "⏸"}
                    </div>
                  </div>
                  {!pipelineDebugShowExtras && isDashboardLoading ? (
                    <div className="mt-2 text-[11px] text-[#8cefff]">当前：战略看板生成中…</div>
                  ) : null}
                  {!pipelineDebugShowExtras && isContentLoading && contentJobPollTrace?.currentStep ? (
                    <div className="mt-2 text-[11px] text-gray-300">当前：{contentJobPollTrace.currentStep}</div>
                  ) : null}
                </div>
                {pipelineDebugShowExtras ? (
                  <>
                    <div className="mt-4 rounded-2xl border border-rose-500/35 bg-[rgba(127,29,29,0.12)] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-rose-200">错误 / 异常摘要</div>
                      <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[#fde8e8]">
                        {(
                          [
                            growthSnapshotQuery.error?.message,
                            getPlatformDashboardMutation.error?.message,
                            askPlatformFollowUpMutation.error?.message,
                            contentJobError,
                            typeof dashboardDebug?.error === "string" ? dashboardDebug.error : null,
                            typeof contentDebug?.stage2Error === "string" ? contentDebug.stage2Error : null,
                            stage2EmptyPayload
                              ? "Stage 2 返回空选题：请查看 Stage 2.debug。"
                              : null,
                          ]
                            .filter(Boolean)
                            .join("\n\n") || "（无聚合错误文案 — 请结合 JSON）"
                        )}
                      </div>
                    </div>
                    <div className="mt-4 rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                      <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">详细分步（异常诊断）</div>
                      <div className="mt-3 space-y-2 text-xs leading-6 text-[#d7d0ef]">
                        <div>1. getGrowthSnapshot: {growthSnapshotQuery.isFetched ? "已返回" : growthSnapshotQuery.isFetching ? "进行中" : "未开始"}</div>
                        <div>2. snapshot 构建: {snapshotDebug?.baseSource ? `已完成 (${snapshotDebug.baseSource})` : "未知"}</div>
                        <div>3. personalization: {String(snapshotDebug?.personalizedApplied ?? false)}</div>
                        <div>4. Stage1 / Stage2: {isDashboardLoading ? "⏳" : platformDashboard ? "✅" : "⏸"} · {isContentLoading ? "⏳" : platformContent ? "✅" : "⏸"}</div>
                        <div>5. hasDashboard / hasContent: {String(Boolean(platformDashboard))} / {String(Boolean(platformContent))}</div>
                        <div>6. 继续追问: {askPlatformFollowUpMutation.isSuccess ? "已返回" : askPlatformFollowUpMutation.isPending ? "进行中" : "未开始"}</div>
                      </div>
                    </div>
                    <div className="mt-4 space-y-4">
                      <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">getGrowthSnapshot.debug</div>
                        <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                          {JSON.stringify(snapshotDebug || null, null, 2)}
                        </pre>
                      </div>
                      <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">getPlatformDashboard.debug</div>
                        <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                          {JSON.stringify(dashboardDebug || null, null, 2)}
                        </pre>
                      </div>
                      <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                        <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">askPlatformFollowUp.debug</div>
                        <pre className="mt-3 max-h-[32rem] overflow-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                          {JSON.stringify(askDebug || null, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </>
                ) : null}
                <div className="mt-4 rounded-2xl border border-[#10B981]/35 bg-[rgba(16,185,129,0.06)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#10B981]">
                      出图失败流水（imageGenFlowLog · 仅失败保留）
                    </div>
                    {platformImageGenFlowSnapshotsFailedOnly.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setPlatformImageGenFlowSnapshots([])}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-400 hover:bg-white/10"
                      >
                        清空全部快照
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                    成功跑通的单帧 / 2×4 不再占用本区；仅在客户端标记为失败时显示。
                  </p>
                  {platformImageGenFlowSnapshotsFailedOnly.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-black/30 px-3 py-6 text-center text-[11px] leading-relaxed text-gray-500">
                      目前无失败流水。若批量或合成报错，此处会出现红框记录。
                    </div>
                  ) : (
                    <div className="mt-3 max-h-[min(70vh,520px)] space-y-4 overflow-y-auto">
                      {platformImageGenFlowSnapshotsFailedOnly.map((snap, i) => (
                        <div
                          key={`${snap.at}-fail-${snap.kind}-${i}`}
                          className="rounded-xl border border-rose-500/40 bg-black/40 p-3"
                        >
                          <div className="font-mono text-[10px] text-rose-300">
                            {snap.at} ·{" "}
                            {snap.kind === "batch_topic_frames_failed" ? "批量单帧 · 失败" : "2×4 合成 · 失败"}
                            {snap.meta ? ` · ${JSON.stringify(snap.meta)}` : ""}
                          </div>
                          <div className="mt-2">
                            <button
                              type="button"
                              onClick={async () => {
                                await copyTextWithToast(snap.lines.join("\n"), {
                                  successZh: "已复制本段日志（含 TRPC 详情）",
                                  errorZh: "复制没成功",
                                  errorDescriptionZh: "请手动选中下方文本复制。",
                                });
                              }}
                              className="rounded-lg border border-rose-400/40 bg-rose-500/10 px-2 py-1 text-[10px] text-rose-200 hover:bg-rose-500/20"
                            >
                              复制本段报错全文
                            </button>
                          </div>
                          <pre className="mt-2 max-h-[min(85vh,920px)] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-[#d7d0ef]">
                            {snap.lines.join("\n")}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                {flyJobsPollDebugPanel ? <div className="mt-4">{flyJobsPollDebugPanel}</div> : null}
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className={`${shellCardClasses("p-6")} relative`} style={{ animation: "pulseHighlight 30s ease-in-out infinite" }}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">
                      <ShieldCheck className="h-3.5 w-3.5" />
                      为什么这个方向现在值得做
                    </div>
                    <div className="mt-4 max-w-3xl text-3xl font-black leading-tight text-white md:text-4xl">
                      {recommendationHeadline}
                    </div>
                    <div className="mt-4 max-w-3xl text-sm leading-8 text-[#d3caef]">
                      {directConclusion}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-4 py-3 text-right">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff]">时间口径</div>
                    <div className="mt-2 text-xl font-bold text-white">{getWindowLabel(selectedWindowDays)}</div>
                  </div>
                </div>

                {keyInsights.filter(item => item.title || item.detail).length > 0 ? (
                  <div className="mt-6 grid gap-3 md:grid-cols-3">
                    {keyInsights.filter(item => item.title || item.detail).slice(0, 3).map((item, index) => (
                      <div key={`${item.title}-${index}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {getSmartIcon((item.title || "") + " " + (item.detail || ""), "h-4 w-4 text-[#8cefff] shrink-0")}
                            <div className="text-sm font-semibold text-white">{item.title}</div>
                          </div>
                          {item.badge ? (
                            <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-[11px] text-[#8cefff]">
                              {item.badge}
                            </div>
                          ) : null}
                        </div>
                        {item.detail ? <div className="mt-3 text-sm leading-7 text-[#c9c0e6]">{item.detail}</div> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

            </div>

            <div className="mt-6 grid gap-4 xl:grid-cols-2 xl:items-start">
                            <div id={PLATFORM_SECTION_DEEP_QA_ID} className={`scroll-mt-20 ${shellCardClasses("p-6")}`}>
                              <div className="flex items-center gap-2 text-sm font-semibold text-white">
                                <MessageSquareText className="h-4 w-4 text-[#8cefff]" />
                                深度追问
                              </div>
                              <p className="mt-3 max-w-3xl text-sm leading-7 text-[#c8bfe7]">
                                这一轮追问会继续锁定在近 {selectedWindowDays} 天的数据，把结论继续往"选题、形式、节奏、承接动作"推进。点击问题加载到输入框后可以补充或修改，再点击发送。
                              </p>

                              <div className="mt-5 flex flex-wrap gap-2">
                                {hotQuestionSuggestions.map((item) => (
                                  <button
                                    key={item}
                                    type="button"
                                    onClick={() => setQuestion(item)}
                                    className="rounded-full border border-[#3a2b6a] bg-[#140b31] px-3 py-2 text-sm text-[#d7d0ef] transition hover:border-[#49e6ff]/25 hover:bg-[rgba(73,230,255,0.08)]"
                                  >
                                    {item}
                                  </button>
                                ))}
                              </div>

                              <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
                                <div className="flex flex-col gap-2">
                                  <div className="relative">
                                    <textarea
                                      value={question}
                                      onChange={(event) => setQuestion(event.target.value)}
                                      placeholder="例如：如果我现在先做小红书，应该先做图文还是视频？为什么？"
                                      className="min-h-[128px] w-full rounded-2xl border border-white/10 bg-[#0c061e] px-4 py-3 pr-12 text-sm leading-7 text-white outline-none transition focus:border-[#49e6ff]/35"
                                    />
                                    <div className="absolute right-3 top-3">
                                      <VoiceInputButton
                                        onTranscript={(t) => setQuestion((prev) => prev ? prev + " " + t : t)}
                                        onDebugLog={addVoiceDebug}
                                        size={28}
                                      />
                                    </div>
                                  </div>
                                  <div className="mt-3 rounded-xl border border-[#6366f1]/40 bg-[linear-gradient(135deg,rgba(99,102,241,0.18),rgba(79,70,229,0.08))] px-4 py-3.5 shadow-[0_8px_28px_rgba(99,102,241,0.12)]">
                                    <p className="text-base font-black tracking-tight text-[#e9d5ff] sm:text-lg">文本支持语音输入</p>
                                    <p className="mt-1.5 text-sm leading-relaxed text-white/65 sm:text-[15px]">
                                      点击输入框旁 <span className="font-semibold text-[#c4b5fd]">麦克风</span>
                                      ，说话即可写入追问内容。推荐使用{" "}
                                      <span className="rounded-md border border-[#818cf8]/50 bg-[rgba(129,140,248,0.2)] px-1.5 py-0.5 font-semibold text-[#c7d2fe]">
                                        Chrome、Edge、Safari
                                      </span>
                                      。
                                    </p>
                                  </div>
                                  {/* File attachment for multimodal QA */}
                                  <div className="flex items-center gap-2">
                                    <input
                                      ref={qaFileInputRef}
                                      type="file"
                                      accept="image/*,application/pdf"
                                      className="hidden"
                                      onChange={(e) => {
                                        const f = e.target.files?.[0];
                                        if (f) void handleUploadQaFile(f);
                                        e.target.value = "";
                                      }}
                                    />
                                    <button
                                      type="button"
                                      onClick={() => qaFileInputRef.current?.click()}
                                      disabled={isUploadingQaFile}
                                      className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition disabled:opacity-50 ${
                                        qaUploadStatus === "success"
                                          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                                          : qaUploadStatus === "error"
                                            ? "border-rose-400/30 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20"
                                            : "border-white/10 bg-white/5 text-[#c8bfe7] hover:bg-white/10"
                                      }`}
                                    >
                                      {isUploadingQaFile
                                        ? <><Loader2 className="h-3 w-3 animate-spin" />上传中...</>
                                        : qaUploadStatus === "success"
                                          ? <><FileText className="h-3 w-3" />✅ 已上传</>
                                          : qaUploadStatus === "error"
                                            ? <><Image className="h-3 w-3" />❌ 上传失败，重试</>
                                            : <><Image className="h-3 w-3" />上传参考图片/PDF（可选）</>
                                      }
                                    </button>
                                    {qaFileName && qaUploadStatus === "success" && (
                                      <span className="flex items-center gap-1 text-xs text-emerald-300">
                                        <FileText className="h-3 w-3" />
                                        {qaFileName}
                                        <button
                                          type="button"
                                          onClick={() => { setQaFileUri(null); setQaFileMimeType(""); setQaFileName(""); setQaUploadStatus("idle"); }}
                                          className="ml-1 text-white/40 hover:text-white/70"
                                        >×</button>
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleAsk()}
                                  disabled={isQaLoading || isUploadingQaFile}
                                  className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#14d6ff,#5f6bff)] px-5 py-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {isQaLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                                  {isQaLoading ? "AI 思考中..." : qaFileUri ? "多模态追问" : "继续追问"}
                                </button>
                              </div>

                              {askResult ? (
                                <div className="mt-6 grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
                                  <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                                    <div className="flex items-center gap-2 text-lg font-bold text-white">
                                      <MessageSquareText className="h-5 w-5 text-[#8cefff]" />
                                      {askResult.title}
                                    </div>
                                    <div className="mt-4 space-y-4 text-sm leading-8 text-[#d7d0ef]">
                                      {splitAnswerParagraphs(askResult.answer).map((paragraph, index) => (
                                        <p key={`${paragraph.slice(0, 24)}-${index}`}>{renderHighlightText(paragraph)}</p>
                                      ))}
                                    </div>
                                  </div>
                                  <div className="space-y-4">
                                    <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                                      <div className="text-sm font-semibold text-[#8cefff]">顾问建议</div>
                                      <div className="mt-3 text-sm leading-7 text-[#d7d0ef]">{askResult.encouragement}</div>
                                    </div>
                                    <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                                      <div className="text-sm font-semibold text-[#ffdd44]">继续往下问</div>
                                      <div className="mt-3 space-y-2">
                                        {askResult.nextQuestions.map((item) => (
                                          <button
                                            key={item}
                                            type="button"
                                            onClick={() => {
                                              setQuestion(item);
                                              void handleAsk(item);
                                            }}
                                            className="block w-full rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-left text-sm text-[#d7d0ef] transition hover:bg-white/10"
                                          >
                                            <div className="flex items-start justify-between gap-3">
                                              <span>{item}</span>
                                              <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-[#8cefff]" />
                                            </div>
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              ) : null}
                          </div>
          </div>
              </>
            ) : null}

            <section id="platform-stage2-copy" className="mt-2 scroll-mt-28 px-1" aria-label="专属选题与文案状态">
              <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[rgba(18,13,43,0.65)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight text-white sm:text-xl">
                    <Sparkles className="h-5 w-5 shrink-0 text-[#c4b5fd]" />
                    专属选题与文案
                    {isContentLoading ? (
                      <Loader2 className="h-5 w-5 shrink-0 animate-spin text-[#c4b5fd]" aria-hidden />
                    ) : null}
                  </h2>
                  <p
                    className={`mt-1 text-sm leading-relaxed ${
                      isContentLoading
                        ? "text-[#c4b5fd]/90"
                        : stage2Failed || contentJobError
                          ? "text-red-400"
                          : stage2EmptyPayload
                            ? "text-amber-400/95"
                            : platformContent && !stage2EmptyPayload
                              ? "text-emerald-400/95"
                              : "text-gray-500"
                    }`}
                  >
                    {stage2UserFacingLine}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                  {platformDashboard &&
                  !isContentLoading &&
                  !platformContent &&
                  !stage2Failed &&
                  !stage2EmptyPayload ? (
                    <button
                      type="button"
                      onClick={() => void startStage2ContentGeneration()}
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-[#c4b5fd]/40 bg-[linear-gradient(135deg,rgba(196,181,253,0.18),rgba(125,115,255,0.14))] px-5 py-2.5 text-sm font-bold text-white shadow-[0_8px_28px_rgba(125,115,255,0.25)] transition hover:brightness-110"
                    >
                      <CircleDollarSign className="h-4 w-4 text-[#fde68a]" aria-hidden />
                      补跑专属文案（全案未自动入队时 · {CREDIT_COSTS.platformStage2Copywriting} 积分）
                    </button>
                  ) : null}
                  {(stage2Failed || stage2EmptyPayload) && platformDashboard && !isContentLoading ? (
                    <button
                      type="button"
                      onClick={() => void retryStage2Content()}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-red-500/35 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
                    >
                      <RefreshCw className="h-4 w-4" />
                      重新生成（再扣 {CREDIT_COSTS.platformStage2Copywriting} 积分）
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              <div className="min-w-0">
              <div className={shellCardClasses("p-6")}>
                <div className="mb-8 space-y-4 border-b border-white/10 pb-6">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="flex items-center gap-2 text-xl font-bold text-white">
                        <Sparkles className="h-5 w-5 shrink-0 text-[#ff4fb8]" />
                        视频图文编导分镜表
                      </h3>
                      <p className="mt-1 text-xs text-gray-500">批量：一键生成封面套装、一键生成编导分镜套装、一键生成封面加编导分镜。</p>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <p className="text-[12px] leading-relaxed text-[#c9c0e6]/55">
                      选题请在上方「生成选题」按钮下方挑选；此处专做封面与分镜出图。
                    </p>
                    {topicShortlist.length > 0 ? (
                      <a
                        href="#platform-topic-shortlist"
                        className="inline-flex text-[12px] font-semibold text-[#8cefff] underline underline-offset-2"
                      >
                        已有 {topicShortlist.length} 条选题 · 回到列表挑选 →
                      </a>
                    ) : null}
                  </div>
                  {platformTopicCount > 0 ? renderGlobalProtagonistPhotoBlock() : null}
                  {platformTopicCount > 0 ? (
                    <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap lg:justify-end">
                        <button
                          type="button"
                          disabled={
                            isSequentialCoverBatchGenerating ||
                            isSequentialCompositeBatchGenerating ||
                            isSequentialCoverCompositeBundleBatchGenerating ||
                            compositeMutationBusy ||
                            coverCompositeBundleSceneId !== null ||
                            isDashboardLoading ||
                            isContentLoading ||
                            !isAuthenticated ||
                            platformTopicCount === 0
                          }
                          onClick={() => {
                            if (!isAuthenticated) {
                              toast.error("请先登录");
                              return;
                            }
                            const scenes = visibleExecutionCards.map((row) => ({ id: row.id }));
                            const discountNote = supervisorAccess
                              ? ""
                              : `将为您一次性生成 ${platformTopicCount} 个选题的竖版封面（套装 40×${platformTopicCount}=${platformBulkGraphicCost} 积分${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}；散买单张 ${CREDIT_COSTS.platformTopicFrameGraphic} 积分）。是否继续？`;
                            if (!supervisorAccess && !window.confirm(discountNote)) return;
                            void (async () => {
                              try {
                                await syncPlatformExecutionBlueprintsSnapshotMutation.mutateAsync({
                                  contentBlueprints: visibleExecutionCards.map(
                                    executionCardToSnapshotBlueprint,
                                  ),
                                });
                                await runSequentialCoverBatchGeneration(
                                  scenes,
                                  buildCoverPersonaContextForImageGen(personaSummary, ipProfile),
                                );
                              } catch (err) {
                                toast.error(
                                  err instanceof Error ? err.message : "封面套装发起失败",
                                );
                              }
                            })();
                          }}
                          className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full border-2 border-[#ff4fb8]/55 bg-[#ff4fb8]/10 px-8 py-2.5 text-sm font-bold text-[#ff9fe0] shadow-md transition hover:bg-[#ff4fb8]/18 hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 sm:w-auto"
                        >
                          {isSequentialCoverBatchGenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Sparkles className="h-4 w-4" />
                          )}
                          {isSequentialCoverBatchGenerating
                            ? "生成中…"
                            : `一键生成封面套装 · ${platformBulkGraphicCost}点${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}`}
                        </button>
                        <button
                          type="button"
                          disabled={
                            isSequentialCoverBatchGenerating ||
                            isSequentialCompositeBatchGenerating ||
                            isSequentialCoverCompositeBundleBatchGenerating ||
                            compositeMutationBusy ||
                            coverCompositeBundleSceneId !== null ||
                            isDashboardLoading ||
                            isContentLoading ||
                            !isAuthenticated ||
                            platformTopicCount === 0
                          }
                          onClick={onBulkCompositeOneClick}
                          className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full border-2 border-[#10B981] bg-[#10B981]/20 px-8 py-2.5 text-sm font-bold text-[#a7f3d0] shadow-[0_6px_24px_rgba(16,185,129,0.22)] transition hover:bg-[#10B981]/28 hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 sm:w-auto"
                        >
                          {isSequentialCompositeBatchGenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Layers className="h-4 w-4" />
                          )}
                          {isSequentialCompositeBatchGenerating
                            ? "生成中…"
                            : `一键生成编导分镜套装 · ${platformBulkCompositeCost}点${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}`}
                        </button>
                        <button
                          type="button"
                          disabled={
                            isSequentialCoverBatchGenerating ||
                            isSequentialCompositeBatchGenerating ||
                            isSequentialCoverCompositeBundleBatchGenerating ||
                            compositeMutationBusy ||
                            coverCompositeBundleSceneId !== null ||
                            isDashboardLoading ||
                            isContentLoading ||
                            !isAuthenticated ||
                            platformTopicCount === 0
                          }
                          onClick={onBulkCoverCompositeBundleOneClick}
                          className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#ff4fb8] to-[#6a5cff] px-8 py-2.5 font-bold text-white shadow-lg transition hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 sm:w-auto"
                        >
                          {isSequentialCoverCompositeBundleBatchGenerating ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Package className="h-4 w-4" />
                          )}
                          {isSequentialCoverCompositeBundleBatchGenerating
                            ? "生成中…"
                            : `一键生成封面加编导分镜 · ${platformBulkCoverCompositeCost}点${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}`}
                        </button>
                        <button
                          type="button"
                          onClick={() => setCoverDecisionTrialReadOpen(true)}
                          className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full border border-[#49e6ff]/50 bg-[#49e6ff]/12 px-6 py-2.5 text-sm font-semibold text-[#a5f3fc] shadow-[0_6px_24px_rgba(72,212,240,0.15)] transition hover:bg-[#49e6ff]/22 sm:w-auto"
                        >
                          <Eye className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                          点击试读 · 决策智库样张
                        </button>
                        <Dialog open={coverDecisionTrialReadOpen} onOpenChange={setCoverDecisionTrialReadOpen}>
                          <DialogContent className="max-h-[92vh] max-w-[min(1720px,calc(100vw-1rem))] w-full gap-0 overflow-y-auto overflow-x-auto border border-white/12 bg-[#05080f] p-3 sm:max-w-[min(1720px,calc(100vw-1rem))]">
                            <DialogHeader className="sr-only">
                              <DialogTitle>决策智库试读样张</DialogTitle>
                              <DialogDescription>
                                演示数据排版，选题与正文类文案已脱敏；付费解锁后可查看基于您全案数据的完整报告。
                              </DialogDescription>
                            </DialogHeader>
                            <PlatformReportDashboard
                              data={DEMO_ADVANCED_AI_REPORT_DATA}
                              presentation="trialRead"
                              className="!box-border !w-[min(1680px,100%)] !max-w-[1680px] border-0 !px-3 !pb-4 !pt-3 md:!w-[1680px]"
                            />
                          </DialogContent>
                        </Dialog>
                      </div>
                    ) : null}
                  </div>
                {contentExecutionCards.length > 0 ? (
                  <div
                    id={PLATFORM_REFERENCE_GALLERY_ID}
                    className="mb-10 rounded-3xl border border-white/5 bg-[#0a0a0a]/50 p-6"
                  >
                    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-4">
                      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
                        <div className="h-6 w-1.5 shrink-0 rounded-full bg-[#10B981]" />
                        <h3 className="text-xl font-bold tracking-tight text-white">
                          {compositeGridVariant === "3x4"
                            ? "3×4 十二格编导分镜 · 小红书十二格图文 画廊"
                            : "2×4 编导分镜 · 小红书 2×4 八格图文 画廊"}
                        </h3>
                        {!isTrial && storyboardSheetDownloadItems.length > 0 ? (
                          <button
                            type="button"
                            onClick={() => void handleExportAllStoryboardSheets()}
                            disabled={isExportingStoryboardSheets}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-[#10B981]/40 bg-[#10B981]/15 px-3 py-1.5 text-xs font-bold text-[#6ee7b7] transition hover:bg-[#10B981]/25 disabled:cursor-not-allowed disabled:opacity-50"
                            title="把全部编导分镜图下载为原始高清图片（不经 PDF，不会被截断）"
                          >
                            {isExportingStoryboardSheets ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Download className="h-4 w-4" />
                            )}
                            一键导出全部（{storyboardSheetDownloadItems.length}）
                          </button>
                        ) : null}
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <div className="inline-flex rounded-lg border border-white/10 bg-black/35 p-0.5">
                          <button
                            type="button"
                            onClick={() => setCompositeGridVariant("2x4")}
                            className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${
                              compositeGridVariant === "2x4"
                                ? "bg-[#10B981]/20 text-[#10B981]"
                                : "text-gray-400 hover:text-white"
                            }`}
                          >
                            2×4 单张
                          </button>
                          <button
                            type="button"
                            onClick={() => setCompositeGridVariant("3x4")}
                            className={`rounded-md px-3 py-1.5 text-[11px] font-semibold transition ${
                              compositeGridVariant === "3x4"
                                ? "bg-[#ff4fb8]/20 text-[#ff9fe0]"
                                : "text-gray-400 hover:text-white"
                            }`}
                          >
                            3×4 十二格
                          </button>
                        </div>
                        <span className="max-w-[22rem] text-right text-[10px] leading-snug text-gray-500">
                          {compositeGridVariant === "3x4"
                            ? `3×4 十二格：内容更完整、画面更清晰 · 分镜 ${CREDIT_COSTS.platformStoryboardSheet3x4} 点 / 图文 ${CREDIT_COSTS.platformXhsDualNote3x4} 点`
                            : `2×4 八格：经典单图 · 分镜 ${CREDIT_COSTS.platformStoryboardSheet} 点 / 图文 ${CREDIT_COSTS.platformXhsDualNote} 点`}
                        </span>
                      </div>
                    </div>
                    {referenceStoryboardGraphicStrip.length === 0 ? (
                      <div className="flex min-h-[160px] w-full items-center justify-center text-center text-sm italic text-gray-600">
                        尚未生成{" "}
                        {compositeGridVariant === "3x4"
                          ? "3×4 十二格分镜或小红书十二格图文"
                          : "2×4 编导分镜或小红书 2×4 八格图文"}
                        （请在下方选题卡片中点击生成）
                      </div>
                    ) : (
                      <div className="grid gap-6 md:grid-cols-2">
                        {referenceStoryboardGraphicStrip.map((ref) => {
                          const isXhs = ref.key.includes("xhs-sheet");
                          const compositeRetryKey = `${ref.sceneId}::${isXhs ? "xhs" : "storyboard"}`;
                          const sourceRow = visibleExecutionCards.find((row) => row.id === ref.sceneId);
                          const queueSilentCompositeRetry = () => {
                            if (!sourceRow || compositeLoadRetriedKeys.has(compositeRetryKey)) return;
                            const rawUrl = String(ref.url || "").trim();
                            // 加载失败时先 cache-bust，禁止立刻清图并重新扣费生图（否则画廊空白）。
                            if (rawUrl && !compositeLoadRetriedKeys.has(`${compositeRetryKey}::cb`)) {
                              setCompositeLoadRetriedKeys((prev) => new Set(prev).add(`${compositeRetryKey}::cb`));
                              const sep = rawUrl.includes("?") ? "&" : "?";
                              const busted = `${rawUrl}${sep}mv_img_cb=${Date.now()}`;
                              if (isXhs) {
                                setPlatformXhsNoteMap((prev) => ({ ...prev, [ref.sceneId]: busted }));
                              } else {
                                setPlatformStoryboardSheetMap((prev) => ({ ...prev, [ref.sceneId]: busted }));
                              }
                              return;
                            }
                            setCompositeLoadRetriedKeys((prev) => new Set(prev).add(compositeRetryKey));
                            toast.error(
                              `${isXhs ? "图文笔记" : "编导分镜"}图暂时无法加载。请点下方按钮重新生成，或稍后再试。`,
                            );
                          };
                          return (
                            <div
                              key={ref.key}
                              className="flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0a] shadow-2xl transition-all hover:border-white/20"
                            >
                              <div className="flex items-center justify-between border-b border-white/5 bg-white/5 px-4 py-3">
                                <div className="truncate pr-2 text-sm font-bold text-white">{ref.title}</div>
                                <div
                                  className={`shrink-0 rounded-full border px-2 py-1 text-[10px] ${
                                    isXhs
                                      ? "border-[#ff4fb8]/30 bg-[#ff4fb8]/10 text-[#ff9fe0]"
                                      : "border-[#10B981]/20 bg-[#10B981]/10 text-[#10B981]"
                                  }`}
                                >
                                  {ref.kindLabel}
                                </div>
                              </div>

                              <div className="relative flex min-h-[300px] w-full flex-1 items-center justify-center overflow-hidden bg-black/60 p-2">
                                {ref.url ? (
                                  <TrialWatermarkImage
                                    src={ref.url}
                                    isTrial={isTrial}
                                    objectFit="contain"
                                    className="h-full w-full max-h-[600px] object-contain transition-transform duration-500 hover:scale-[1.01]"
                                    alt={`${ref.title} · ${ref.kindLabel}`}
                                    onLoad={() => {
                                      setCompositeLoadRetriedKeys((prev) => {
                                        if (!prev.has(compositeRetryKey)) return prev;
                                        const next = new Set(prev);
                                        next.delete(compositeRetryKey);
                                        return next;
                                      });
                                    }}
                                    onError={() => {
                                      console.warn(`[PlatformPage] composite image load failed, scheduling silent retry: ${ref.sceneId} (${isXhs ? "xhs" : "storyboard"})`);
                                      queueSilentCompositeRetry();
                                    }}
                                  />
                                ) : ref.pending ? (
                                  <div className="flex flex-col items-center justify-center gap-3 px-4 text-center opacity-80">
                                    <Loader2
                                      className={`h-8 w-8 animate-spin ${isXhs ? "text-[#ff4fb8]" : "text-[#10B981]"}`}
                                    />
                                    <span className="max-w-[20rem] text-xs leading-snug text-gray-400">
                                      {compositePendingUxHints[
                                        `${ref.sceneId}::${isXhs ? "xiaohongshu_dual_note" : "storyboard_sheet_landscape"}`
                                      ] ?? "正在绘制高定画面 · 合计常需约 3～5 分钟，请勿中途刷新"}
                                    </span>
                                  </div>
                                ) : null}
                              </div>

                              {ref.url ? (
                                <div className="border-t border-white/5 bg-[rgba(14,9,32,0.88)] p-3">
                                  {!isTrial ? (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void downloadSingleImageFile(
                                          ref.url as string,
                                          buildStoryboardSheetFilename(ref, 0),
                                        )
                                      }
                                      className="mb-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold text-gray-200 transition hover:bg-white/10"
                                      title="下载这张分镜原图（高清、不截断）"
                                    >
                                      <Download className="h-3.5 w-3.5" />
                                      下载这张原图
                                    </button>
                                  ) : null}
                                  <ImageUpscaleBar
                                    imageUrl={ref.url}
                                    baseCreditKey="forgeImage"
                                    className="mt-1"
                                    onUpscaled={(url) => {
                                      if (isXhs) {
                                        setPlatformXhsNoteMap((prev) => ({ ...prev, [ref.sceneId]: url }));
                                      } else {
                                        setPlatformStoryboardSheetMap((prev) => ({ ...prev, [ref.sceneId]: url }));
                                      }
                                    }}
                                  />
                                </div>
                              ) : null}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ) : null}

                {/* 3A：选题卡片 Grid 上方 — IP 维度引导（含底部提示） */}
                {platformDashboard ? <PlatformIpDimensionGuide /> : null}

                {visibleExecutionCards.length > 0 ? (
                  <div
                    className="mt-4 rounded-xl border border-[#49e6ff]/20 bg-[rgba(73,230,255,0.06)] px-4 py-3 text-sm leading-relaxed text-[#c8eef9]"
                    role="status"
                  >
                    已启用<strong className="text-white">选题与封面一体化优化</strong>
                    ：后台会为每条方案<strong className="text-white">择优主标题</strong>
                    并与出图主句对齐（正文与分镜不改编），竖版封面强调
                    <strong className="text-white">信息流缩略图可读</strong>。推荐优先使用一键套装（封面+分镜按体裁九折，见上方批量按钮
                    {PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}）或于下方卡片分步购买。
                    {strategicMapSessionExecutionCards.length > 0 ? (
                      <>
                        {" "}
                        下方含{" "}
                        <strong className="text-[#fde047]">
                          {strategicMapSessionExecutionCards.length} 条战略地图扩写选题
                        </strong>
                        {strategicMapSessionBonusCount > 0
                          ? `（其中 ${strategicMapSessionBonusCount} 条为赠送，仅本次浏览可见，刷新后不再显示）`
                          : "（仅本次浏览可见，刷新后不再显示）"}
                        。
                      </>
                    ) : null}
                  </div>
                ) : null}

                <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {isContentLoading ? (
                    <Stage2BlueprintProgress
                      completedBlueprints={platformContent?.contentBlueprints?.length ?? 0}
                      monetizationReady={Boolean(platformContent?.monetizationLanes?.length)}
                      statusText={contentLoadingText}
                    />
                  ) : null}
                  {visibleExecutionCards.length > 0 &&
                  coverWaitCarouselEngaged &&
                  (!allTopicCoverImagesReady || anyCompositeOutputBusy) &&
                  coverGenWaitCarouselItems.some((row) => row.title || row.excerpt.trim()) ? (
                    <CoverGenerationWaitCarousel
                      items={coverGenWaitCarouselItems}
                      itemsKey={coverGenWaitCarouselItemsKey}
                      phaseLabel={anyCompositeOutputBusy ? "正在出图（2×4 / 3×4 合成）· 约 3～5 分钟" : undefined}
                    />
                  ) : null}
                  {visibleExecutionCards.length === 0 && isDashboardLoading ? (
                    <div className="col-span-full flex h-32 w-full animate-pulse flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#ff4fb8]/70">
                      <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                      正在生成专属选题与配套文案...
                    </div>
                  ) : visibleExecutionCards.length === 0 && platformDashboard && !isContentLoading ? (
                    <div className="col-span-full flex h-32 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#c9c0e6]/70">
                      无对应的选题方向数据
                    </div>
                  ) : (
                    visibleExecutionCards.map((item) => {
                      const copyFlat = (item.copywriting || "").replace(/\s+/g, " ").trim();
                      const headlineTitle = item.title;
                      const isGraphicFormat = item.format === "图文" || item.format === "小红书";
                      const compositeKind = isGraphicFormat ? "xiaohongshu_dual_note" : "storyboard_sheet_landscape";
                      const is3x4 = compositeGridVariant === "3x4";
                      const compositeCost = isGraphicFormat
                        ? (is3x4 ? CREDIT_COSTS.platformXhsDualNote3x4 : CREDIT_COSTS.platformXhsDualNote)
                        : (is3x4 ? CREDIT_COSTS.platformStoryboardSheet3x4 : CREDIT_COSTS.platformStoryboardSheet);
                      const compositeLabel = isGraphicFormat
                        ? (is3x4 ? "小红书 3×4 十二格图文" : "小红书 2×4 八格图文")
                        : (is3x4 ? "3×4 十二格编导分镜表" : "2×4 高定编导分镜表");
                      const CompositeIcon = isGraphicFormat ? Heart : Film;
                      const compositeColorClass = isGraphicFormat
                        ? "text-[#ff9fe0] bg-[#ff4fb8]/10 border-[#ff4fb8]/40 hover:bg-[#ff4fb8]/20"
                        : "text-[#8cefff] bg-[#49e6ff]/10 border-[#49e6ff]/40 hover:bg-[#49e6ff]/20";
                      const compositeRingClass = isGraphicFormat ? "ring-[#ff4fb8]/35" : "ring-[#49e6ff]/35";
                      const isThisCompositeLoading =
                        compositeMutationBusy &&
                        pendingCompositeSheet?.sceneId === item.id &&
                        pendingCompositeSheet?.kind === compositeKind;
                      const compositePhaseHint =
                        compositePendingUxHints[`${item.id}::${compositeKind}`] ??
                        "中文直送与出图 · 合计常需 3～5 分钟，请勿中途刷新";
                      const bundleCost = platformCoverCompositeBundleCreditsForFormatGrid(item.format, is3x4);
                      const bundleRetailSum =
                        CREDIT_COSTS.platformTopicFrameGraphic + compositeCost;
                      const isThisBundleLoading = coverCompositeBundleSceneId === item.id;
                      const currentImageUrl = platformImageMap[item.id] || "";
                      const isBlackImageOrTimeout = platformCoverImageUrlLooksInvalid(currentImageUrl);
                      const isGraphicCover = item.format === "图文" || item.format === "小红书";
                      /** 单张竖版封面统一按「图文封面」定价扣点（与后端 generateTopicImage 一致），与选题是短视频还是图文无关 */
                      const normalCoverCost = CREDIT_COSTS.platformTopicFrameGraphic;
                      const hasValidJobId = Boolean(sceneJobIds[item.id]);
                      const isEligibleFreeRetry = isBlackImageOrTimeout && hasValidJobId;
                      const actualCost = isEligibleFreeRetry ? 0 : normalCoverCost;
                      const singleCoverFooterPointsLabel =
                        isEligibleFreeRetry ? "免费补救" : `${normalCoverCost} 点`;
                      const handleGenerateSingleCoverFooter = () => {
                        if (!isAuthenticated) {
                          toast.error("请先登录");
                          return;
                        }
                        if (!String(item.id || "").trim()) {
                          toast.error("选题缺少 ID，无法生成");
                          return;
                        }
                        const displayedUrl = (platformImageMap[item.id] || "").trim();
                        const hasDisplayedUrl = displayedUrl.length > 0;

                        if (isBlackImageOrTimeout && !hasValidJobId && !supervisorAccess) {
                          const warning =
                            "检测到超时黑图，但由于页面刷新，本地安全凭证已丢失。本次补发将作为新任务消耗积分，是否继续？(建议：勿在生图期间刷新页面)";
                          if (!window.confirm(warning)) return;
                        } else if (!supervisorAccess) {
                          let confirmNote: string;
                          if (isEligibleFreeRetry) {
                            confirmNote = "检测到黑图，本次将免费补发，是否继续？";
                          } else if (!hasDisplayedUrl) {
                            confirmNote = `将为本选题生成竖版封面（单帧高精出图），消耗 ${normalCoverCost} 积分，是否继续？`;
                          } else {
                            confirmNote = `将为该选题重新生成竖版封面，消耗 ${normalCoverCost} 积分（沿用当前选题文案与人设锚点），是否继续？`;
                          }
                          if (!window.confirm(confirmNote)) return;
                        }
                        markCoverGenerationStarted(item.id);
                        void runThrottledPlatformImageRequest(`single-cover:${item.id}`, async () => {
                          await syncPlatformExecutionBlueprintsSnapshotMutation.mutateAsync({
                            contentBlueprints: [executionCardToSnapshotBlueprint(item)],
                          });
                          return runEnqueueTopicImageAndPoll({
                            topicHook: "",
                            format: isGraphicCover ? "图文" : "短视频",
                            coverPersonaContext:
                              buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim() || undefined,
                            failedJobId: isEligibleFreeRetry ? sceneJobIds[item.id] : undefined,
                            sceneId: item.id,
                            referencePhotoUrl: resolveReferencePhotoForScene(item.id),
                            pollDebugLabel: `单张选题封面 · ${item.id}`,
                          });
                        })
                          .then((res) => {
                            const finalUrl =
                              res.imageUrl ?? (res as { url?: string | null }).url ?? null;
                            if (res.creationId != null) {
                              setSceneJobIds((prev) => ({
                                ...prev,
                                [item.id]: String(res.creationId),
                              }));
                            }
                            if (res.success && finalUrl) {
                              setPlatformImageMap((prev) => ({
                                ...prev,
                                [item.id]: finalUrl,
                              }));
                              toast.success(hasDisplayedUrl ? "单张封面已更新" : "单张封面已生成");
                            } else {
                              toast.error(
                                (res as { userFacingError?: string }).userFacingError ||
                                  "单帧生图失败，可稍后在本卡重试或联系支持。",
                              );
                            }
                            markCoverGenerationFinished(item.id);
                          })
                          .catch((err) => {
                            markCoverGenerationFinished(item.id);
                            toast.error(err.message || "操作失败");
                          });
                      };
                      const handleManualRegenerateCover = () => {
                        if (!isAuthenticated) {
                          toast.error("请先登录");
                          return;
                        }
                        if (!String(item.id || "").trim()) {
                          toast.error("选题缺少 ID，无法生成");
                          return;
                        }
                        if (isBlackImageOrTimeout && !hasValidJobId && !supervisorAccess) {
                          const warning =
                            "检测到超时黑图，但由于页面刷新，本地安全凭证已丢失。本次补发将作为新任务消耗积分，是否继续？(建议：勿在生图期间刷新页面)";
                          if (!window.confirm(warning)) return;
                        } else {
                          const confirmNote = isEligibleFreeRetry
                            ? "检测到黑图，本次将免费补发，是否继续？"
                            : !hasValidJobId && !supervisorAccess
                              ? "凭证因刷新丢失，本次将扣分补发，是否继续？"
                              : `重新生成此单帧将消耗 ${normalCoverCost} 积分（使用新种子算绘），是否继续？`;
                          if (!supervisorAccess && !window.confirm(confirmNote)) return;
                        }
                        markCoverGenerationStarted(item.id);
                        void runThrottledPlatformImageRequest(`manual-cover:${item.id}`, async () => {
                          await syncPlatformExecutionBlueprintsSnapshotMutation.mutateAsync({
                            contentBlueprints: [executionCardToSnapshotBlueprint(item)],
                          });
                          return runEnqueueTopicImageAndPoll({
                            topicHook: "",
                            format: isGraphicCover ? "图文" : "短视频",
                            coverPersonaContext:
                              buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim() || undefined,
                            failedJobId: isEligibleFreeRetry ? sceneJobIds[item.id] : undefined,
                            sceneId: item.id,
                            referencePhotoUrl: resolveReferencePhotoForScene(item.id),
                            pollDebugLabel: `手动重生成 · ${item.id}`,
                          });
                        })
                          .then((res) => {
                            const finalUrl =
                              res.imageUrl ?? (res as { url?: string | null }).url ?? null;
                            if (res.creationId != null) {
                              setSceneJobIds((prev) => ({
                                ...prev,
                                [item.id]: String(res.creationId),
                              }));
                            }
                            if (res.success && finalUrl) {
                              setPlatformImageMap((prev) => ({
                                ...prev,
                                [item.id]: finalUrl,
                              }));
                              toast.success(
                                isEligibleFreeRetry ? "免费补发成功" : "重新生成成功",
                              );
                            } else {
                              toast.error(
                                (res as { userFacingError?: string }).userFacingError ||
                                  "单帧生图失败，已记录任务。可再次尝试免费或付费补发。",
                              );
                            }
                            markCoverGenerationFinished(item.id);
                          })
                          .catch((err) => {
                            markCoverGenerationFinished(item.id);
                            toast.error(err.message || "操作失败");
                          });
                      };
                      const queueSilentImageLoadRetry = () => {
                        if (coverSilentRetryIds.has(item.id) || coverLoadRetriedIds.has(item.id)) return;
                        if (!String(item.id || "").trim()) return;

                        /**
                         * 服务端免扣补发要求 failedJobId 对应行 status ∈ {failed,timeout}。
                         * 批量成功写入的 creationId 多为 completed — 不能当 failedJobId 传，否则 BAD_REQUEST
                         * 且客户端已清图 → 卡片空白（见 topic-1：Nano 成功但封面不显示）。
                         */
                        const rawUrl = platformImageMap[item.id] || "";
                        const urlLooksLikeServerRetryPayload = platformCoverImageUrlLooksInvalid(rawUrl);
                        const freeRetryJobId =
                          urlLooksLikeServerRetryPayload && sceneJobIds[item.id] ? sceneJobIds[item.id] : undefined;

                        if (!freeRetryJobId) {
                          if (!coverImageCacheBustTriedRef.current.has(item.id) && rawUrl) {
                            coverImageCacheBustTriedRef.current.add(item.id);
                            const sep = rawUrl.includes("?") ? "&" : "?";
                            setPlatformImageMap((prev) => ({
                              ...prev,
                              [item.id]: `${rawUrl}${sep}mv_img_cb=${Date.now()}`,
                            }));
                            return;
                          }
                          toast.error("封面图无法加载。请点下方「重新生成」或稍后重试。");
                          return;
                        }

                        setCoverLoadRetriedIds((prev) => new Set(prev).add(item.id));
                        setPlatformImageMap((prev) => {
                          const next = { ...prev };
                          delete next[item.id];
                          return next;
                        });
                        setCoverSilentRetryIds((prev) => new Set(prev).add(item.id));
                        void runThrottledPlatformImageRequest(`silent-cover:${item.id}`, () =>
                          runEnqueueTopicImageAndPoll({
                            topicHook: "",
                            format: isGraphicCover ? "图文" : "短视频",
                            coverPersonaContext:
                              buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim() || undefined,
                            failedJobId: freeRetryJobId,
                            sceneId: item.id,
                            pollDebugLabel: `静默加载失败补发 · ${item.id}`,
                          }),
                        )
                          .then((res) => {
                            if (res.creationId != null) {
                              setSceneJobIds((prev) => ({
                                ...prev,
                                [item.id]: String(res.creationId),
                              }));
                            }
                            if (res.success && res.imageUrl) {
                              setPlatformImageMap((prev) => ({
                                ...prev,
                                [item.id]: res.imageUrl!,
                              }));
                            }
                          })
                          .catch((err) => console.warn(`[PlatformPage] silent cover retry: ${err.message}`))
                          .finally(() => {
                            setCoverSilentRetryIds((prev) => {
                              const n = new Set(prev);
                              n.delete(item.id);
                              return n;
                            });
                          });
                      };
                      const handleCoverCompositeBundleFooter = () => {
                        if (!isAuthenticated) {
                          toast.error("请先登录");
                          return;
                        }
                        if (!String(item.id || "").trim()) {
                          toast.error("选题缺少 ID，无法生成");
                          return;
                        }
                        if (
                          !supervisorAccess &&
                          !window.confirm(
                            `将消耗 ${bundleCost} 积分${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}，为本选题并发生成竖版封面与${compositeLabel}（封面 48 + 分镜 ${compositeCost}，散买合计 ${bundleRetailSum}）。是否继续？`,
                          )
                        )
                          return;
                        setCoverCompositeBundleSceneId(item.id);
                        const coverPersona = buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim();
                        void runThrottledPlatformImageRequest(`single-bundle:${item.id}`, () =>
                          runEnqueueTopicCoverCompositeBundleAndPoll({
                            sceneId: item.id,
                            coverPersonaContext: coverPersona || undefined,
                            headlineTitle,
                            compositeKind,
                            scriptContext: buildPlatformSheetScriptContext(item as any, {
                              shootingTechniqueBrief:
                                compositeKind === "xiaohongshu_dual_note"
                                  ? undefined
                                  : lastShootingTechniqueBriefRef.current.trim() || undefined,
                              gridVariant: compositeGridVariant,
                              sheetKind: compositeKind === "xiaohongshu_dual_note" ? "graphic" : "storyboard",
                            }),
                            executionDetails: buildPlatformExecutionDetailsPayload(item as any),
                            shootingTechniqueBrief: lastShootingTechniqueBriefRef.current.trim() || undefined,
                            gridVariant: compositeGridVariant,
                            pollDebugLabel: `套装单卡 · ${item.id}`,
                            referencePhotoUrl: resolveReferencePhotoForScene(item.id),
                            compositeImageEngine: resolveReferencePhotoForScene(item.id)
                              ? "gpt_image2"
                              : platformComposite2x4Engine,
                          }),
                        )
                          .then((res) => {
                            if (res.creationId != null) {
                              setSceneJobIds((prev) => ({
                                ...prev,
                                [item.id]: String(res.creationId),
                              }));
                            }
                            if (res.success && res.imageUrl) {
                              setPlatformImageMap((prev) => ({
                                ...prev,
                                [item.id]: res.imageUrl!,
                              }));
                            }
                            const compUrl = res.compositeImageUrl?.trim();
                            if (compUrl && res.compositeKind) {
                              if (
                                res.compositeKind === "storyboard_sheet_portrait" ||
                                res.compositeKind === "storyboard_sheet_landscape"
                              ) {
                                setPlatformStoryboardSheetMap((p) => ({ ...p, [item.id]: compUrl }));
                              } else if (res.compositeKind === "xiaohongshu_dual_note") {
                                setPlatformXhsNoteMap((p) => ({ ...p, [item.id]: compUrl }));
                              }
                            }
                            if (res.success && res.imageUrl && res.compositeImageUrl) {
                              toast.success(`套装已完成：封面 + ${compositeLabel}`);
                            } else {
                              toast.error("套装未完成，请重试或使用「仅封面 / 仅 2×4」分步生成。");
                            }
                          })
                          .catch((err) => toast.error(err.message || "操作失败"))
                          .finally(() => setCoverCompositeBundleSceneId(null));
                      };
                      return (
                      <div
                        key={item.id}
                        id={executionCardDomId(item.id)}
                        className={`group scroll-mt-28 flex flex-col rounded-2xl border bg-white/5 p-5 ${
                          item.isDecisionIntelBonus
                            ? "border-[#fde047]/35 ring-1 ring-[#fde047]/20"
                            : item.isDecisionIntelPicked
                              ? "border-[#f472b6]/35 ring-1 ring-[#f472b6]/20"
                              : "border-white/10"
                        }`}
                      >
                        {item.isDecisionIntelBonus ? (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-[#fde047]/40 bg-[#fde047]/10 px-2.5 py-1 text-[11px] font-semibold text-[#fde047]"
                          >
                            <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                            战略地图赠送 · 仅本次浏览
                          </motion.div>
                        ) : item.isDecisionIntelPicked ? (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="mb-3 inline-flex w-fit items-center gap-1.5 rounded-full border border-[#f472b6]/40 bg-[#f472b6]/10 px-2.5 py-1 text-[11px] font-semibold text-[#fbcfe8]"
                          >
                            <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                            战略地图点选 · 仅本次浏览
                          </motion.div>
                        ) : null}
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-1 items-start gap-2">
                            {item.format === "图文" ? (
                              <Image className="mt-0.5 h-4 w-4 shrink-0 text-[#ff7fd5]" />
                            ) : (
                              <Video className="mt-0.5 h-4 w-4 shrink-0 text-[#49e6ff]" />
                            )}
                            <h3
                              className="min-w-0 flex-1 whitespace-normal break-words text-xl font-bold leading-snug text-white"
                              title={headlineTitle}
                            >
                              {headlineTitle}
                            </h3>
                          </div>
                          <div className="mt-0.5 shrink-0 rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-[11px] text-[#8cefff]">
                            {item.format}
                          </div>
                        </div>
                        {copyFlat ? (
                          <p className="mt-3 whitespace-normal break-words break-all [overflow-wrap:anywhere] text-sm leading-relaxed text-gray-400">
                            {copyFlat}
                          </p>
                        ) : null}
                        {Array.isArray(item.highlightKeywords) && item.highlightKeywords.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[#3eedff]/80">
                              蓝海 / 高亮
                            </span>
                            {item.highlightKeywords.map((w, wi) => (
                              <span
                                key={`${item.id}-hk-${wi}`}
                                className="rounded-md border border-[rgba(62,237,255,0.28)] bg-[rgba(62,237,255,0.08)] px-2 py-0.5 text-[11px] text-[#a5f3fc]"
                              >
                                {w}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        {item.publishingAdvice ? (
                          <div className="mt-3 rounded-xl border border-[#fbbf24]/30 bg-[rgba(251,191,36,0.08)] px-3 py-2.5">
                            <div className="text-[10px] font-semibold uppercase tracking-wide text-[#fcd34d]/90">
                              发布时间 / 发布建议
                            </div>
                            <div className="mt-1 break-words break-all [overflow-wrap:anywhere] text-sm leading-6 text-[#ffe9a8] whitespace-pre-wrap">
                              {renderSafeText(item.publishingAdvice)}
                            </div>
                          </div>
                        ) : null}
                        <details className="mb-4 mt-3 cursor-pointer text-xs text-gray-500">
                          <summary className="cursor-pointer select-none text-[15px] font-black text-[#ff9900] animate-pulse transition-colors hover:text-[#ffb84d]">
                            ▶ 执行细项与分镜（点击展开查看详细步骤）
                          </summary>
                          <div className="mt-3 space-y-2.5 rounded-lg bg-black/30 p-3 leading-relaxed text-[#d3caef]">
                            {item.production ? (
                              <p>
                                <strong className="text-[#9ddcff]">制作：</strong>
                                {item.production}
                              </p>
                            ) : null}
                            {(item as any).executionDetails?.environmentAndWardrobe ? (
                              <p>
                                <strong className="text-[#9ddcff]">拍摄环境 &amp; 服装道具：</strong>
                                {(item as any).executionDetails.environmentAndWardrobe}
                              </p>
                            ) : null}
                            {(item as any).executionDetails?.lightingAndCamera ? (
                              <p>
                                <strong className="text-[#9ddcff]">导演灵感 · 灯光 &amp; 运镜：</strong>
                                {(item as any).executionDetails.lightingAndCamera}
                              </p>
                            ) : null}
                            {Array.isArray((item as any).storyboardCells) &&
                            (item as any).storyboardCells.length > 0 &&
                            !/图文|小红书/.test(String((item as any).format || "")) ? (
                              <PlatformStoryboardCellsTable
                                cells={(item as any).storyboardCells as PlatformStoryboardCell[]}
                              />
                            ) : null}
                            {Array.isArray((item as any).executionDetails?.stepByStepScript) &&
                            (item as any).executionDetails.stepByStepScript.length > 0 ? (
                              <div>
                                <strong className="text-[#9ddcff]">编导拍摄顺序（灵感画布）：</strong>
                                <div className="mt-1 space-y-1">
                                  {(item as any).executionDetails.stepByStepScript.map((step: unknown, si: number) => {
                                    const stepText = renderSafeText(step);
                                    if (!stepText) return null;
                                    return <div key={si}>{stepText}</div>;
                                  })}
                                </div>
                              </div>
                            ) : null}
                            {Array.isArray((item as any).actionableSteps) && (item as any).actionableSteps.length > 0 ? (
                              <div>
                                <strong className="text-[#9ddcff]">落地三步曲：</strong>
                                <div className="mt-1 space-y-1">
                                  {(item as any).actionableSteps.map((step: unknown, si: number) => {
                                    const stepText = renderSafeText(step);
                                    if (!stepText) return null;
                                    return (
                                      <div key={si}>
                                        {si + 1}. {stepText}
                                      </div>
                                    );
                                  })}
                                </div>
                              </div>
                            ) : null}
                            {(item as any).detailedScript ? (
                              <div>
                                <strong className="text-[#9ddcff]">详细脚本与大纲（导演灵感画布）：</strong>
                                <div className="mt-1 break-words break-all [overflow-wrap:anywhere] whitespace-pre-wrap text-sm">
                                  {renderHighlightText(renderSafeText((item as any).detailedScript))}
                                </div>
                              </div>
                            ) : null}
                            {item.hook || item.copywriting ? (
                              <div className="border-t border-white/10 pt-2.5">
                                <strong className="text-[#9ddcff]">钩子与完整文案</strong>
                                {item.hook ? (
                                  <div className="mt-1 break-words [overflow-wrap:anywhere] text-sm leading-7 text-[#8cefff]">
                                    {renderSafeText(item.hook)}
                                  </div>
                                ) : null}
                                <div className="mt-1 break-words break-all [overflow-wrap:anywhere] whitespace-pre-wrap text-sm">
                                  {renderHighlightText(renderSafeText(item.copywriting || ""))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                        </details>
                        <div className="mt-4">
                          {platformImageMap[item.id] ? (
                            <div className="overflow-hidden rounded-xl border border-white/10 shadow-2xl">
                              <div className="group relative aspect-[9/16] w-full bg-black/40">
                                <TrialWatermarkImage
                                  src={platformImageMap[item.id]}
                                  isTrial={isTrial}
                                  className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                                  onLoad={() => {
                                    coverImageCacheBustTriedRef.current.delete(item.id);
                                    setCoverLoadRetriedIds((prev) => {
                                      if (!prev.has(item.id)) return prev;
                                      const next = new Set(prev);
                                      next.delete(item.id);
                                      return next;
                                    });
                                  }}
                                  onError={() => {
                                    console.warn(`[PlatformPage] cover image load failed, scheduling silent retry: ${item.id}`);
                                    queueSilentImageLoadRetry();
                                  }}
                                />
                              </div>
                              <div className="border-t border-white/10 bg-[rgba(14,9,32,0.88)]">
                                {platformCoverCtrBySceneId[item.id] ? (
                                  <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2">
                                    <span
                                      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                                        platformCoverCtrBySceneId[item.id]!.band === "high"
                                          ? "bg-emerald-500/25 text-emerald-100"
                                          : "bg-amber-500/20 text-amber-100"
                                      }`}
                                    >
                                      {platformCoverCtrBySceneId[item.id]!.labelZh}
                                    </span>
                                    <span className="text-[10px] text-gray-500">规则估计 · 非实测</span>
                                  </div>
                                ) : null}
                                <div className="flex items-center justify-between p-2 px-3">
                                <div className="min-w-0 flex-1">
                                  <ImageUpscaleBar
                                    imageUrl={currentImageUrl}
                                    baseCreditKey="forgeImage"
                                    className="mt-0"
                                    onUpscaled={(url) =>
                                      setPlatformImageMap((prev) => ({ ...prev, [item.id]: url }))
                                    }
                                  />
                                </div>
                                <div className="ml-3 shrink-0 border-l border-white/10 pl-3">
                                  <button
                                    type="button"
                                    disabled={
                                      !isAuthenticated ||
                                      isSequentialCoverBatchGenerating ||
                                      isSequentialCompositeBatchGenerating ||
                                      isSequentialCoverCompositeBundleBatchGenerating ||
                                      coverCompositeBundleSceneId !== null ||
                                      batchGeneratingCoverIds.has(item.id) ||
                                      isDashboardLoading ||
                                      isContentLoading
                                    }
                                    onClick={handleManualRegenerateCover}
                                    className="group flex items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] font-medium text-gray-400 transition hover:bg-white/5 hover:text-white disabled:opacity-50"
                                    title={
                                      isEligibleFreeRetry
                                        ? "重新免费请求生图（已校验任务记录）"
                                        : "使用新种子重新生成此封面"
                                    }
                                  >
                                    <RefreshCw
                                      className={`h-3 w-3 ${
                                        batchGeneratingCoverIds.has(item.id)
                                          ? "animate-spin text-[#ff4fb8]"
                                          : "text-gray-400 group-hover:text-white"
                                      }`}
                                    />
                                    <span>
                                      {isEligibleFreeRetry ? "免费补发" : `重新生成 · ${actualCost}点`}
                                    </span>
                                  </button>
                                </div>
                              </div>
                              </div>
                            </div>
                          ) : (batchGeneratingCoverIds.has(item.id) ||
                              coverCompositeBundleSceneId === item.id ||
                              isSequentialCoverBatchGenerating ||
                              batchGeneratingCoverIds.has(item.id) ||
                              coverSilentRetryIds.has(item.id)) &&
                            !platformImageMap[item.id] ? (
                            <div className="flex w-full aspect-[9/16] flex-col items-center justify-center gap-3 rounded-xl border border-white/5 bg-[#0a0a0a]/60 animate-pulse">
                              <Loader2 className="h-7 w-7 animate-spin text-[#ff4fb8]/70" />
                              <span className="text-xs font-medium tracking-widest text-gray-400 px-3 text-center">
                                {coverCompositeBundleSceneId === item.id
                                  ? "套装绘制中（封面+2×4 并发）…"
                                  : batchGeneratingCoverIds.has(item.id)
                                    ? "单帧重新绘制中..."
                                    : coverSilentRetryIds.has(item.id)
                                      ? "检测到异常，正在自动重试补救..."
                                      : batchGeneratingCoverIds.has(item.id)
                                        ? "异步逐张生成中..."
                                        : "高定视觉绘制中..."}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        {(() => {
                          const sheetUrl =
                            (isGraphicFormat
                              ? platformXhsNoteMap[item.id]
                              : platformStoryboardSheetMap[item.id]) || "";
                          const sheetPending =
                            !sheetUrl &&
                            pendingCompositeSheet?.sceneId === item.id &&
                            pendingCompositeSheet?.kind === compositeKind;
                          if (!sheetUrl && !sheetPending) return null;
                          return (
                            <div className="mt-4 overflow-hidden rounded-xl border border-white/10 shadow-2xl">
                              <div className="flex items-center justify-between border-b border-white/10 bg-white/5 px-3 py-2">
                                <span className="text-xs font-bold text-white">{compositeLabel}</span>
                                <span className="text-[10px] text-gray-500">选题卡内预览 · 与上方画廊同步</span>
                              </div>
                              <div className="relative flex min-h-[220px] w-full items-center justify-center bg-black/50 p-2">
                                {sheetUrl ? (
                                  <TrialWatermarkImage
                                    src={sheetUrl}
                                    isTrial={isTrial}
                                    objectFit="contain"
                                    className="h-full w-full max-h-[480px] object-contain"
                                    alt={`${headlineTitle} · ${compositeLabel}`}
                                  />
                                ) : (
                                  <div className="flex flex-col items-center gap-2 px-4 text-center">
                                    <Loader2 className="h-6 w-6 animate-spin text-[#49e6ff]/80" />
                                    <span className="text-xs text-gray-400">{compositePhaseHint}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          );
                        })()}

                        <div className="mt-4 space-y-3 rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.55)] p-3">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] tracking-[0.08em]">
                            <span
                              className="font-black uppercase tracking-[0.14em] text-[#49e6ff] [text-shadow:0_0_14px_rgba(73,230,255,0.55)]"
                            >
                              {is3x4 ? "3×4 十二格" : "2×4 八格"}
                            </span>
                            <span className="normal-case tracking-normal text-[10px] leading-none text-gray-500">
                              · 推荐一键套装 {bundleCost} 点{PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}（竖版封面 + 本条{is3x4 ? " 3×4 十二格" : " 2×4 八格"}；散买约 {bundleRetailSum} 点）· 本条仅{is3x4 ? " 3×4" : " 2×4"}：{compositeCost}{" "}
                              点（{isGraphicFormat ? "图文/小红书" : "短视频分镜"}）
                            </span>
                          </div>
                          <div className="mb-2 flex items-center gap-2 rounded-lg border border-[#6a5cff]/30 bg-[#6a5cff]/8 px-2.5 py-2">
                            {resolveReferencePhotoForScene(item.id) ? (
                              <img
                                src={resolveReferencePhotoForScene(item.id)}
                                alt="人像参考"
                                className="h-10 w-10 shrink-0 rounded-md object-cover ring-1 ring-[#c4b5fd]/50"
                              />
                            ) : (
                              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-dashed border-[#c4b5fd]/40 text-[#c4b5fd]/70">
                                <UserRound className="h-4 w-4" aria-hidden />
                              </span>
                            )}
                            <div className="flex min-w-0 flex-1 flex-col">
                              <label
                                className={`inline-flex w-fit cursor-pointer items-center gap-1.5 rounded-md border border-[#6a5cff]/45 bg-[#6a5cff]/15 px-2 py-1 text-[11px] font-bold text-[#c4b5fd] transition hover:bg-[#6a5cff]/25 ${
                                  coverRefUploadingIds.has(item.id) ? "cursor-wait opacity-70" : ""
                                }`}
                              >
                                {coverRefUploadingIds.has(item.id) ? (
                                  <>
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    上传中…
                                  </>
                                ) : (
                                  <>
                                    <UserRound className="h-3 w-3" aria-hidden />
                                    {coverReferencePhotoMap[item.id]
                                      ? "更换本条人物照片"
                                      : "本条覆盖人物照片（可选）"}
                                  </>
                                )}
                                <input
                                  type="file"
                                  accept="image/png,image/jpeg,image/webp"
                                  className="hidden"
                                  disabled={coverRefUploadingIds.has(item.id)}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    e.target.value = "";
                                    if (f) void handleUploadCoverReferencePhoto(item.id, f);
                                  }}
                                />
                              </label>
                              <span className="mt-0.5 text-[10px] leading-tight text-gray-500">
                                {coverReferencePhotoMap[item.id]
                                  ? "已用本条照片覆盖 · 封面/分镜/图文锁脸"
                                  : globalCoverReferencePhotoUrl
                                    ? "沿用上方全局主人公 · 可在此覆盖"
                                    : "可选 · 或先在上方上传全局主人公照片"}
                              </span>
                              <span className="mt-0.5 text-[10px] leading-tight text-amber-300/70">
                                请仅上传本人或已获授权人物的照片（着装得体、成年）；请勿上传他人、未成年或不雅照片。
                              </span>
                            </div>
                            {coverReferencePhotoMap[item.id] ? (
                              <button
                                type="button"
                                onClick={() =>
                                  setCoverReferencePhotoMap((prev) => {
                                    const next = { ...prev };
                                    delete next[item.id];
                                    return next;
                                  })
                                }
                                className="shrink-0 rounded-md border border-white/15 px-2 py-1 text-[10px] font-medium text-gray-400 transition hover:border-white/30 hover:text-gray-200"
                              >
                                移除本条
                              </button>
                            ) : null}
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={
                                !isAuthenticated ||
                                compositeMutationBusy ||
                                isSequentialCompositeBatchGenerating ||
                                isSequentialCoverCompositeBundleBatchGenerating ||
                                coverCompositeBundleSceneId !== null ||
                                isSequentialCoverBatchGenerating ||
                                                                batchGeneratingCoverIds.has(item.id) ||
                                coverSilentRetryIds.has(item.id) ||
                                isDashboardLoading ||
                                isContentLoading
                              }
                              onClick={handleCoverCompositeBundleFooter}
                              className={`inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#ff4fb8] to-[#6a5cff] px-3 py-2 text-xs font-bold text-white shadow-md transition hover:brightness-110 disabled:opacity-50 ${
                                compositeMutationBusy && !isThisCompositeLoading ? "opacity-45" : ""
                              } ${isThisBundleLoading ? "cursor-wait ring-2 ring-[#c4b5fd]/55 [&:disabled]:opacity-95" : ""}`}
                            >
                              {isThisBundleLoading ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                  套装生成中…
                                </span>
                              ) : (
                                <>
                                  <Package className="h-3.5 w-3.5 shrink-0" />
                                  {`一键套装 · ${bundleCost} 点${PLATFORM_BUNDLE_NINE_DISCOUNT_LABEL}`}
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={
                                !isAuthenticated ||
                                compositeMutationBusy ||
                                isSequentialCompositeBatchGenerating ||
                                isSequentialCoverCompositeBundleBatchGenerating ||
                                coverCompositeBundleSceneId !== null ||
                                isDashboardLoading ||
                                isContentLoading
                              }
                              onClick={() => {
                                if (!isAuthenticated) {
                                  toast.error("请先登录");
                                  return;
                                }
                                const note = supervisorAccess
                                  ? ""
                                  : `将消耗 ${compositeCost} 积分，生成${compositeLabel}，是否继续？`;
                                if (!supervisorAccess && !window.confirm(note)) return;
                                const coverPersona = buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim();
                            const compositeSupervisorExtras = {
                              ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
                                ? { enableTopicCoverDeepResearchPro: true as const }
                                : {}),
                              ...(coverPersona ? { coverPersonaContext: coverPersona } : {}),
                            };
                                void runThrottledPlatformImageRequest(`composite:${item.id}:${compositeKind}`, () =>
                                  generatePlatformCompositeSheetMutation.mutateAsync({
                                    sceneId: item.id,
                                    title: headlineTitle,
                                    scriptContext: buildPlatformSheetScriptContext(item as any, {
                                      shootingTechniqueBrief:
                                        compositeKind === "xiaohongshu_dual_note"
                                          ? undefined
                                          : lastShootingTechniqueBriefRef.current.trim() || undefined,
                                      gridVariant: compositeGridVariant,
                                      sheetKind: compositeKind === "xiaohongshu_dual_note" ? "graphic" : "storyboard",
                                    }),
                                    kind: compositeKind,
                                    gridVariant: compositeGridVariant,
                                    executionDetails: buildPlatformExecutionDetailsPayload(item as any),
                                    shootingTechniqueBrief: lastShootingTechniqueBriefRef.current.trim() || undefined,
                                    ...optionalBoundCreationRecordId(),
                                    imagePromptTranslator: COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
                                    progressJobId: newPlatformCompositeProgressJobId(),
                                    ...compositeSupervisorExtras,
                                    compositeImageEngine: resolveReferencePhotoForScene(item.id)
                                      ? "gpt_image2"
                                      : platformComposite2x4Engine,
                                    ...(resolveReferencePhotoForScene(item.id)
                                      ? {
                                          referencePhotoUrl: resolveReferencePhotoForScene(item.id),
                                          referencePhotoFromApprovedCover: Boolean(
                                            String(platformImageMap[item.id] || "").trim() &&
                                              resolveReferencePhotoForScene(item.id) ===
                                                String(platformImageMap[item.id] || "").trim(),
                                          ),
                                        }
                                      : {}),
                                    enabledSkillIds: Array.from(enabledPlatformSkillIds),
                                    allowBloggerTitle,
                                  }),
                                ).catch(() => {});
                              }}
                              className={`inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold transition ${compositeColorClass} ${
                                compositeMutationBusy && !isThisCompositeLoading ? "opacity-45" : ""
                              } ${isThisCompositeLoading ? `cursor-wait ring-2 ${compositeRingClass} [&:disabled]:opacity-100` : ""}`}
                            >
                              {isThisCompositeLoading ? (
                                <span className="flex max-w-[16rem] flex-col items-start gap-0.5 text-left leading-tight">
                                  <span className="inline-flex items-center gap-1.5">
                                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                    生成中（约 3～5 分钟）
                                  </span>
                                  <span className="pl-5 text-[10px] font-medium normal-case tracking-normal text-white/70">
                                    {compositePhaseHint}
                                  </span>
                                </span>
                              ) : (
                                <>
                                  <CompositeIcon className="h-3.5 w-3.5 shrink-0" />
                                  {`${compositeLabel} · ${compositeCost} 点`}
                                </>
                              )}
                            </button>
                            <button
                              type="button"
                              disabled={
                                !isAuthenticated ||
                                isSequentialCoverBatchGenerating ||
                                isSequentialCompositeBatchGenerating ||
                                isSequentialCoverCompositeBundleBatchGenerating ||
                                coverCompositeBundleSceneId !== null ||
                                batchGeneratingCoverIds.has(item.id) ||
                                coverSilentRetryIds.has(item.id) ||
                                isDashboardLoading ||
                                isContentLoading
                              }
                              onClick={handleGenerateSingleCoverFooter}
                              className={`inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg border border-[#ff4fb8]/45 bg-[#ff4fb8]/12 px-3 py-2 text-xs font-bold text-[#ff9fe0] transition hover:bg-[#ff4fb8]/22 ${
                                batchGeneratingCoverIds.has(item.id) ? "cursor-wait ring-2 ring-[#ff4fb8]/35 opacity-95 [&:disabled]:opacity-95" : ""
                              }`}
                              title={
                                isEligibleFreeRetry
                                  ? "检测到黑图，本次可走免费补救链路（免扣积分）"
                                  : `仅此选题生成竖版封面单帧 · ${normalCoverCost} 点`
                              }
                            >
                              {batchGeneratingCoverIds.has(item.id) ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                  封面生成中…
                                </span>
                              ) : (
                                <>
                                  <Image className="h-3.5 w-3.5 shrink-0 opacity-95" aria-hidden />
                                  {`仅封面 · ${singleCoverFooterPointsLabel}`}
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      </div>
                      );
                    })
                  )}
                </div>
              </div>
              </div>
              </div>

              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <CircleDollarSign className="h-4 w-4 text-[#ffdd44]" />
                  商业化建议先磨到可落地
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {monetizationCards.length === 0 && (isDashboardLoading || isContentLoading) ? (
                    <div className="col-span-2 flex h-32 w-full animate-pulse flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#8cefff]/70">
                      <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                      正在推演专属商业变现路径...
                    </div>
                  ) : monetizationCards.length === 0 ? (
                    <div className="col-span-2 flex h-32 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#c9c0e6]">
                      {hasAnalyzed
                        ? "本轮未写出变现路径（可重试）"
                        : "生成平台看板后显示可落地商业化建议"}
                    </div>
                  ) : (
                    monetizationCards.map((item) => (
                      <div key={item.id} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                        <div className="flex items-center gap-2">
                          {getSmartIcon(item.title + " 变现 付费", "h-4 w-4 text-[#ffdd44] shrink-0")}
                          <div className="text-sm font-semibold text-white">{item.title}</div>
                        </div>
                        <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.summary}</div>
                        {item.action ? (
                          <div className="mt-3 rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-3 text-sm leading-7 text-[#ffdd44]">
                            {item.action}
                          </div>
                        ) : null}
                      </div>
                    ))
                  )}
                </div>

                <div className="mt-8 border-t border-white/10 pt-6">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-sm font-semibold text-white">
                      <TrendingUp className="h-4 w-4 text-[#49e6ff]" />
                      平台优先级与切入方式
                    </div>
                    <div className="text-[11px] text-[#9b8fc4]">近 {selectedWindowDays} 天窗口 · 条越长越优先</div>
                  </div>
                  {isDashboardLoading && platformDecisionRows.length === 0 ? (
                    <div className="mt-4 flex h-28 animate-pulse items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-sm text-[#8cefff]/70">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      正在整理平台优先级…
                    </div>
                  ) : platformDecisionRows.length === 0 ? (
                    <div className="mt-4 flex h-24 items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-sm text-[#c9c0e6]/70">
                      生成平台看板后显示平台优先级图
                    </div>
                  ) : (
                    <div className="mt-4 space-y-3">
                      {platformDecisionRows.map((item, index) => {
                        const barPct = Math.max(28, 100 - index * 18);
                        const barColors = [
                          "from-[#49e6ff] to-[#6a5cff]",
                          "from-[#6fffb0] to-[#49e6ff]",
                          "from-[#fbbf24] to-[#ff4fb8]",
                          "from-[#a78bfa] to-[#6366f1]",
                        ];
                        const moveOneLine = String(item.nextMove || "")
                          .replace(/\s+/g, " ")
                          .trim()
                          .slice(0, 72);
                        const blueWords = Array.isArray((item as { blueOceanWords?: string[] }).blueOceanWords)
                          ? (item as { blueOceanWords: string[] }).blueOceanWords.slice(0, 4)
                          : [];
                        return (
                          <div
                            key={item.id}
                            className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.03)] px-4 py-3"
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="rounded-full border border-[#49e6ff]/35 bg-[#49e6ff]/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8cefff]">
                                P{index + 1}
                              </span>
                              <span className="text-sm font-bold text-white">{item.name}</span>
                              {item.trend ? (
                                <span className="rounded-md border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-[#c9c0e6]">
                                  {renderSafeText(item.trend)}
                                </span>
                              ) : null}
                              {item.lane ? (
                                <span className="rounded-md border border-[#ffdd44]/25 bg-[#ffdd44]/8 px-2 py-0.5 text-[10px] text-[#ffe08a]">
                                  {renderSafeText(item.lane)}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-white/5">
                              <div
                                className={`h-full rounded-full bg-gradient-to-r ${barColors[index % barColors.length]}`}
                                style={{ width: `${barPct}%` }}
                                title={`Priority ${index + 1}`}
                              />
                            </div>
                            {moveOneLine ? (
                              <div className="mt-2 truncate text-[12px] leading-5 text-[#b9afd9]" title={String(item.nextMove || "")}>
                                切入：{moveOneLine}
                                {String(item.nextMove || "").trim().length > 72 ? "…" : ""}
                              </div>
                            ) : null}
                            {blueWords.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {blueWords.map((w, wi) => (
                                  <span
                                    key={`${item.id}-bo-${wi}`}
                                    className="rounded-full border border-[#22d3ee]/35 bg-[rgba(34,211,238,0.1)] px-2 py-0.5 text-[10px] text-[#a5f3fc]"
                                  >
                                    {w}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

            <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Target className="h-4 w-4 text-[#6fffb0]" />
                  个性化分析
                </div>
                <div className="mt-5 space-y-3">
                  {/* Prefer LLM topSignals (Call 2) — never fall back to snapshot generic text */}
                  {isDashboardLoading ? (
                    <div className="flex h-16 w-full animate-pulse items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-sm text-[#8cefff]/60">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      正在生成个性化判断...
                    </div>
                  ) : platformDashboard?.topSignals && platformDashboard.topSignals.length > 0 ? (
                    platformDashboard.topSignals.slice(0, 4).map((signal: any, idx: number) => {
                      const sigTitle = typeof signal === "string" ? signal : cleanUserCopy(signal?.title || signal?.["标题"] || signal?.["核心判断"] || "", "");
                      const sigDetail = typeof signal === "object" ? cleanUserCopy(signal?.detail || signal?.desc || signal?.description || signal?.["详情"] || "", "") : "";
                      if (!sigTitle && !sigDetail) return null;
                      return (
                        <div key={`sig-${idx}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                          {sigTitle ? <div className="text-sm font-semibold text-white">{sigTitle}</div> : null}
                          {sigDetail ? <div className="mt-2 text-sm leading-7 text-[#d3caef]">{sigDetail}</div> : null}
                        </div>
                      );
                    })
                  ) : (
                    // No LLM data — show empty state rather than stale snapshot text
                    <div className="flex h-16 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-sm text-[#c9c0e6]/60">
                      暂无个性化判断数据
                    </div>
                  )}
                </div>
              </div>

            <div className={shellCardClasses("p-6 mt-4")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Rocket className="h-4 w-4 text-[#6fffb0]" />
                  现在就能执行的动作
                </div>
                <div className="mt-5 space-y-3">
                  {actionSteps.map((item) => (
                    <div key={`step-${item.day}-${item.title}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                          {getSmartIcon(item.title + " " + item.action, "h-4 w-4 text-[#6fffb0] shrink-0")}
                          <div className="font-semibold text-white">{item.title}</div>
                        </div>
                        <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[11px] text-[#8cefff]">
                          第 {item.day} 步
                        </div>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.action}</div>
                    </div>
                  ))}
                </div>
              </div>

            {/* PDF Download — captures current rendered page via Cloud Run Puppeteer */}
            {hasAnalyzed && (
              <div className="mt-4 space-y-3">
                {/* 时效性提醒 */}
                <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
                  <span className="text-lg leading-none mt-0.5">⚡</span>
                  <div>
                    <div className="font-semibold mb-0.5">分析结果具有时效性</div>
                    <div className="text-xs text-amber-200/80">
                      平台数据每日更新，本次分析基于当前时间点快照。建议立即下载 PDF 保存，下载后快照记录将同步保存至「我的作品」。
                      PDF <strong className="text-amber-100">不含</strong>决策智库全景（另购另存）；趋势含蓝海词请用上方「PNG 图文报表」。
                      2×4 编导分镜／八格图文请用上方画廊「一键导出全部」单独下载原图（PDF 不含编导分镜图，避免长图被截断）。
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <a href="/my-works" className="inline-flex items-center gap-1.5 rounded-full border border-purple-500/30 bg-purple-500/10 px-4 py-2.5 text-sm font-semibold text-purple-300 transition hover:bg-purple-500/20">
                    📁 我的作品
                  </a>
                  <button
                    type="button"
                    onClick={() => void handleDownloadPlatformPdf()}
                    disabled={isDownloadingPdf || isDashboardLoading || isContentLoading}
                    className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff)] px-5 py-2.5 text-sm font-semibold text-white shadow-[0_8px_32px_rgba(73,230,255,0.15)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isDownloadingPdf ? (
                      <><Loader2 className="h-4 w-4 animate-spin" />生成 PDF 中...</>
                    ) : (
                      <><FileText className="h-4 w-4" />下载平台分析 PDF</>
                    )}
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}
        </div>


        {/* 邀请码管理已迁移至 /admin 页面 */}
      </div>
    </div>
  );
}
