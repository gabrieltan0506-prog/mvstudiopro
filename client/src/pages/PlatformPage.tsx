import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { AnimatePresence, motion } from "framer-motion";
import PlatformAssetAnalysisPanel from "@/components/platform/PlatformAssetAnalysisPanel";
import { GrowthSystemDebugPanel } from "@/components/platform/GrowthSystemDebugPanel";
import { PlatformWorkspaceStepHint } from "@/components/platform/PlatformWorkspaceStepHint";
import PlatformHtmlPptPanel from "@/components/PlatformHtmlPptPanel";
import InfographicTemplatePicker from "@/components/InfographicTemplatePicker";
import {
  composeInfographicScriptContext,
  extractInfographicSubjectFromUserCopy,
} from "@shared/infographicNoteTemplates";
import { VisualReportTemplate, type VisualReportData } from "@/components/VisualReportTemplate";
import { PlatformReportDashboard } from "@/components/PlatformReportDashboard";
import {
  mapGenerateVisualReportResult,
  toVisualReportPlatforms,
  toVisualReportWindowDays,
  type VisualReportTheme,
} from "@/lib/visualReportMapper";
import { DecisionIntelLockedDemoPreview } from "@/components/DecisionIntelLockedDemoPreview";
import { ImageUpscaleBar } from "@/components/ImageUpscaleBar";
import IpProfileModal, { readIpProfile, isIpProfileReady, type IpProfile } from "@/components/IpProfileModal";
import { useAuth } from "@/_core/hooks/useAuth";
import TrialWatermarkImage from "@/components/TrialWatermarkImage";
import { useIsTrialUser } from "@/_core/hooks/useIsTrialUser";
import { getLoginUrl } from "@/const";
import { appendPollDebugLine, createJob, getJob, pollJobUntilTerminal } from "@/lib/jobs";
import { trpc } from "@/lib/trpc";
import { sanitizePlatformUserMessage } from "@/lib/platformUserFacingCopy";
import type { AssetAnalysisHandoffPayload } from "@/lib/platformAssetAnalysisHandoff";
import { buildBlueOceanLexicon } from "@shared/blueOceanLexicon";
import { appendFashionEditorialCharacterGuidance } from "@shared/platformFashionEditorialCharacter";
import {
  filterGraphicNoteReaderFacingSteps,
  focusGraphicNoteReaderScript,
  isGraphicNoteMetaCreatorGuidance,
} from "@shared/graphicNoteReaderFacing";
import { captureSupervisorTokenFromUrl, getSupervisorTrpcToken } from "@/lib/supervisorTrpcToken";
import { readTopicCoverDeepResearchProFromLs } from "@/lib/platformCoverDrProLs";
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
import type { PlatformMattingAspectRatio, PlatformMattingBatchCount } from "@shared/plans";
import {
  buildCustomCopyPdfHtml,
  hasCustomCopyPdfContent,
} from "@/lib/customCopyPdfExport";
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
  PLATFORM_TOPIC_EXPAND_MIN,
  PLATFORM_TOPIC_SHORTLIST_DEFAULT,
  PLATFORM_TOPIC_SHORTLIST_MAX,
  platformTopicShortlistTotalCredits,
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

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";

type PlatformImagePromptTranslator = "gpt54" | "vertex_gemini_3_flash_preview";

/** 2×4 分镜／小红书八格 **英文化**：默认 **GPT 5.4**（Gemini 3.5 Flash 兜底）；竖版封面单帧仍走 GPT 5.4。 */
const COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR: PlatformImagePromptTranslator = "gpt54";

/** 管理员／监管：单帧封面主生图是否走 Vertex Nano Banana 2（官方 API） */
const PLATFORM_COVER_NB2_LS_KEY = "mvstudiopro.platform.coverNanoBanana2.v1";
/** 旧键：曾标为 Pro，行为已统一为 NB2，读取时迁移 */
const PLATFORM_COVER_NB_PRO_LS_KEY_LEGACY = "mvstudiopro.platform.coverNanoBananaPro.v1";

/** 全用户：2×4 / 八格 **出图** 引擎（英文化不变；与封面单帧 NB2 开关独立） */
const PLATFORM_COMPOSITE_2X4_ENGINE_LS_KEY = "mvstudiopro.platform.composite2x4Engine.v1";
type PlatformComposite2x4ImageEngine = "gpt_image2" | "nano_banana_2";

/** 全用户：Stage 1 战略看板 + Stage 2 专属文案 LLM（localStorage 记忆） */
const PLATFORM_COPY_LLM_ENGINE_LS_KEY = "mvstudiopro.platform.copyLlmEngine.v1";
/** @deprecated 监管旧键；读取时 fallback */
const PLATFORM_STAGE2_SUPERVISOR_COPY_ENGINE_LS_KEY = "mvstudiopro.platform.stage2SupervisorCopyEngine.v1";
type PlatformCopyLlmEngine = "vertex" | "openai";

/** 创作顾问问答模型（所有登录用户可选；Sol/Terra 免费额度与超额单价不同） */
const PLATFORM_SKILL_QA_MODEL_LS_KEY = "mvstudiopro.platform.skillQaModel.v2";
type PlatformSkillQaModelChoice = "gpt-5.6-terra" | "gpt-5.6-sol";

function readPlatformSkillQaModelFromLs(): PlatformSkillQaModelChoice {
  if (typeof window === "undefined") return "gpt-5.6-terra";
  try {
    const raw = window.localStorage.getItem(PLATFORM_SKILL_QA_MODEL_LS_KEY);
    if (raw === "gpt-5.6-sol" || raw === "sol") return "gpt-5.6-sol";
  } catch {
    /* ignore */
  }
  return "gpt-5.6-terra";
}

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

type TrendPlatformKey = "xiaohongshu" | "bilibili" | "douyin" | "kuaishou" | "weixin_channels";

const TREND_PLATFORM_OPTIONS: { key: TrendPlatformKey; label: string; comingSoon?: boolean }[] = [
  { key: "xiaohongshu", label: "小红书" },
  { key: "bilibili", label: "B站" },
  { key: "douyin", label: "抖音" },
  { key: "kuaishou", label: "快手" },
  { key: "weixin_channels", label: "视频号", comingSoon: true },
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
  /** 抖音 AI 漫剧合集飙升（服务端结构化，非 LLM） */
  aiManhuaRising?: {
    windowDays: number;
    hasBaseline: boolean;
    note: string;
    entries: Array<{
      mixId: string;
      mixName: string;
      dramaKind: string;
      mixPlayCount: number;
      delta7d: number | null;
      status: string;
      author?: string;
      sampleTitle?: string;
      url?: string;
    }>;
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
  /** 英文化 / 模型翻译阶段轮询次数（由 imageGenFlowLog 阶段推断） */
  translationPollCount?: number;
  /** 封面·分镜像素生成阶段轮询次数 */
  imageGenPollCount?: number;
  translationStep?: string;
  imageGenStep?: string;
  /** 最近一次英文化完成统计（来自 imageGenFlowLog `[英文化·完成]`） */
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
  return /英文化|GPT54|GPT 5\.4|Gemini.*Flash|翻译|Vertex.*Flash|extractChineseVisualBrief|\[GPT54·翻译\]|\[英文化·完成\]|骨架·中文视觉/i.test(
    line,
  );
}

function isImageGenFlowLine(line: string): boolean {
  return /GPT-IMAGE|生图|出图|封面·像素|2×4·|fal|OhMyGPT|EvoLink|Nano Banana|FAL·|像素\]|compositeImageUrl|Vertex.*image|gpt_image2/i.test(
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
  return `rounded-[28px] border border-white/10 bg-[rgba(14,9,32,0.88)] shadow-[0_18px_80px_rgba(0,0,0,0.28)] backdrop-blur ${extra}`.trim();
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

/** 将 IP 基因库 + 仪表盘「精神气质与内容身份」注入封面生图链，并叠加国际时尚大片人物造型 */
function buildCoverPersonaContextForImageGen(personaSummary: string, ipProfile: IpProfile): string {
  const parts: string[] = [];
  const ps = String(personaSummary || "").trim();
  if (ps) parts.push(`【精神气质与内容身份】${ps.slice(0, 600)}`);
  if (isIpProfileReady(ipProfile)) {
    parts.push(
      `【IP 视觉与商业基因】行业身份：${ipProfile.industry.trim()}；核心优势：${ipProfile.advantage.trim()}；目标受众：${ipProfile.audience.trim()}；旗舰交付：${ipProfile.flagship.trim()}${ipProfile.taboos.trim() ? `；品牌禁忌（绝对避让）：${ipProfile.taboos.trim()}` : ""}`,
    );
  }
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
  if (Array.isArray(ex?.stepByStepScript) && ex.stepByStepScript.length) {
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
    ? "3×4 十二格：分段横排生成后拼接（多数 3～5 分钟内完成）。"
    : "2×4／八格英文化：自动翻译与版式适配（多数 1～3 分钟内完成）。";
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
    `${ts}  [客户端] 翻译引擎：${trLine}`,
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
    return "整链重试：重新英文化 + 生图，可能仍需数分钟…";
  }
  if (/\[2×4·NB2主路径]|Nano Banana|\[2×4·步骤3\] Vertex/.test(tail)) {
    return "绘制中 · 宽幅编导分镜生成（偶需数分钟）…";
  }
  if (/\[GPT-IMAGE-2\]|GPT-IMAGE-2/.test(tail)) {
    return "绘制中 · 高清封面生成（单尺寸偶需 3～5 分钟）…";
  }
  if (/\[2×4·步骤2|\[步骤2\]/.test(tail)) {
    return "准备生图（像素锁已定）…";
  }
  if (/PROMPT_CONDENSE|\[Prompt 提炼\]/.test(tail)) {
    return "精炼英文 prompt …";
  }
  if (/GPT54·英文化|骨架·中文视觉|extractChineseVisualBrief|\[GPT54·翻译\]/.test(tail)) {
    return "英文化中（骨架抽取，多数 1～3 分钟内）…";
  }
  return "英文化与绘图合计大约 3～5 分钟，请勿中途刷新 ";
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

export default function PlatformPage() {
  const [supervisorAccess] = useState(() => hasSupervisorAccess());
  const [debugMode, setDebugMode] = useState(false);
  /** Debug 开启时加快轮询与刷新，让进度面板更接近即时 */
  const platformImageFlowPollIntervalMs = debugMode ? 650 : 2500;
  const compositeSheetLivePollIntervalMs = debugMode ? 380 : 850;

  useEffect(() => {
    captureSupervisorTokenFromUrl();
  }, []);

  const { isAuthenticated, loading, user } = useAuth({
    autoFetch: true,
    redirectOnUnauthenticated: !supervisorAccess,
    redirectPath: getLoginUrl(),
  });
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
  const [platformCoverVertexNb2, setPlatformCoverVertexNb2] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      if (window.localStorage.getItem(PLATFORM_COVER_NB2_LS_KEY) === "1") return true;
      if (window.localStorage.getItem(PLATFORM_COVER_NB_PRO_LS_KEY_LEGACY) === "1") return true;
      return false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(PLATFORM_COVER_NB2_LS_KEY, platformCoverVertexNb2 ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [platformCoverVertexNb2]);

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

  const canConfigureCompositeImageTranslator =
    supervisorAccess || user?.role === "admin" || user?.role === "supervisor";

  /** 与封面进阶开关一致：supervisor 入口 / admin / supervisor，一般用户不可见 */
  const canConfigureStage2CopyEngine =
    supervisorAccess || user?.role === "admin" || user?.role === "supervisor";

  /** 创作顾问：所有登录用户可选 Sol / Terra（计费不同） */
  const canConfigureSkillQaModel = Boolean(isAuthenticated);

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

  // Separate state for dashboard — populated by the second call after snapshot loads
  const [platformDashboard, setPlatformDashboard] = useState<PlatformDashboard | null>(null);
  const [dashboardDebug, setDashboardDebug] = useState<Record<string, unknown> | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  const [visualReportData, setVisualReportData] = useState<VisualReportData | null>(null);
  const [visualReportTheme] = useState<VisualReportTheme>("dark");
  const [isVisualReportLoading, setIsVisualReportLoading] = useState(false);
  const [isVisualReportDownloading, setIsVisualReportDownloading] = useState(false);
  /** 平台趋势区子 Tab：总览（多平台报表）/ AI 漫剧专区 */
  const [trendInsightTab, setTrendInsightTab] = useState<"overview" | "ai_manhua">("overview");
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
    return `点击「开始全案分析」：先按所选周期用 Pro 深度优化选题，再生成六条文案（入队扣 ${CREDIT_COSTS.platformStage2Copywriting} 积分，含 Pro 优化不加收；不含封面/分镜/决策智库）。`;
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
  const [customNoteError, setCustomNoteError] = useState<string | null>(null);
  /** 生成中（上篇/下篇/單張共用一個忙碌旗標）。 */
  const [customNoteBusy, setCustomNoteBusy] = useState(false);
  /** 進度提示：目前正在生成哪一篇（上篇/下篇），分鏡為 null。 */
  const [customNotePartInFlight, setCustomNotePartInFlight] = useState<"upper" | "lower" | null>(null);
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
  /** 自定义工作区 Tab：粘贴文案生图 vs 主人公融合选题 vs 自定义抠像 */
  const [customWorkspaceTab, setCustomWorkspaceTab] = useState<
    "copy" | "topic" | "matting" | "assets" | "htmlPpt"
  >("copy");

  useEffect(() => {
    const applyTabFromUrl = (opts?: { scroll?: boolean }) => {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      const videoDeepTabs = new Set(["assets", "video", "deep-video", "video-deep"]);
      if (tab && videoDeepTabs.has(tab)) {
        setCustomWorkspaceTab("assets");
        if (opts?.scroll !== false) {
          window.setTimeout(() => {
            document.getElementById("platform-custom-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 80);
        }
        return;
      }
      if (tab === "copy" || tab === "topic" || tab === "matting" || tab === "htmlPpt") {
        setCustomWorkspaceTab(tab);
      }
    };
    applyTabFromUrl({ scroll: true });
    const onUrl = () => applyTabFromUrl({ scroll: true });
    window.addEventListener("popstate", onUrl);
    window.addEventListener("mvs:platform-tab", onUrl as EventListener);
    return () => {
      window.removeEventListener("popstate", onUrl);
      window.removeEventListener("mvs:platform-tab", onUrl as EventListener);
    };
  }, [locationPath]);

  const openVideoDeepBreakdown = useCallback(() => {
    setCustomWorkspaceTab("assets");
    setLocationPath("/platform?tab=video");
    window.dispatchEvent(new Event("mvs:platform-tab"));
    window.setTimeout(() => {
      document.getElementById("platform-custom-workspace")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 40);
  }, [setLocationPath]);

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
  const [skillQaModel, setSkillQaModel] = useState<PlatformSkillQaModelChoice>(() =>
    readPlatformSkillQaModelFromLs(),
  );
  useEffect(() => {
    try {
      window.localStorage.setItem(PLATFORM_SKILL_QA_MODEL_LS_KEY, skillQaModel);
    } catch {
      /* ignore */
    }
  }, [skillQaModel]);
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
  const [allowBloggerTitle, setAllowBloggerTitle] = useState(() => readAllowBloggerTitleFromLs());
  /** 全案分析确认前：Skill/提示词优先级对话气泡 */
  const [fullAnalysisConfirmOpen, setFullAnalysisConfirmOpen] = useState(false);
  const [pendingFullAnalysisLabels, setPendingFullAnalysisLabels] = useState("");
  /** 选题初选 20 → 勾选 5–6 → 扩写 */
  const [topicShortlist, setTopicShortlist] = useState<PlatformTopicShortlistItem[]>([]);
  const [selectedShortlistIds, setSelectedShortlistIds] = useState<Set<string>>(new Set());
  const [topicShortlistCount, setTopicShortlistCount] = useState(PLATFORM_TOPIC_SHORTLIST_DEFAULT);
  const generateTopicShortlistMutation = trpc.mvAnalysis.generatePlatformTopicShortlist.useMutation();
  const expandTopicPicksMutation = trpc.mvAnalysis.expandPlatformTopicPicks.useMutation();
  const topicShortlistPrice = platformTopicShortlistTotalCredits({
    count: topicShortlistCount,
    baseCredits: CREDIT_COSTS.platformTopicShortlist,
    extraPerTopic: CREDIT_COSTS.platformTopicShortlistExtra,
  });
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
      const supervisorTok = getSupervisorTrpcToken();
      const res = await askPlatformSkillQaMutation.mutateAsync({
        question: q,
        enabledSkillIds: Array.from(enabledPlatformSkillIds),
        allowBloggerTitle,
        qaModel: skillQaModel,
        confirmPaid,
        ...(supervisorTok ? { supervisorToken: supervisorTok } : {}),
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
            const supervisorTok = getSupervisorTrpcToken();
            const res = await askPlatformSkillQaMutation.mutateAsync({
              question: q,
              enabledSkillIds: Array.from(enabledPlatformSkillIds),
              allowBloggerTitle,
              qaModel: skillQaModel,
              confirmPaid: true,
              ...(supervisorTok ? { supervisorToken: supervisorTok } : {}),
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

  const platformMainPersonaTopicsPanel = (
    <div className="space-y-4">
      <div
        id="platform-persona-focus"
        className="rounded-2xl border border-[#fbbf24]/40 bg-[rgba(251,191,36,0.1)] px-4 py-4"
      >
        <div className="flex items-center gap-2 text-lg font-bold text-[#fef08a] md:text-xl">
          <Target className="h-5 w-5 shrink-0" aria-hidden />
          人物背景与创作诉求
          <span className="rounded border border-[#fbbf24]/35 bg-black/20 px-1.5 py-0.5 text-[11px] font-medium text-[#fde68a]">
            全案 / 选题共用
          </span>
        </div>
        <p className="mt-1.5 text-[13px] leading-snug text-gray-300">
          写清职业、专长、兴趣与目标；全案分析与下方选题初选 / 扩写都读这一栏。
        </p>
        <div className="relative mt-3">
          <textarea
            value={focusPrompt}
            onChange={(event) => setFocusPrompt(event.target.value)}
            placeholder="例如：我是医学背景创作者，做小红书虚拟资料店；擅长慢病科普与资料包变现，想找持续量大、利润清晰的品类与定价。"
            rows={4}
            className="min-h-[110px] w-full rounded-xl border border-white/15 bg-[#0c061e] px-3.5 py-3 pr-12 text-[14px] leading-relaxed text-white outline-none transition focus:border-[#fbbf24]/45"
          />
          <div className="absolute right-2 top-2">
            <VoiceInputButton
              onTranscript={(t) => setFocusPrompt((prev) => (prev ? `${prev} ${t}` : t))}
              onDebugLog={addVoiceDebug}
              size={26}
            />
          </div>
        </div>
        {!focusPrompt.trim() ? (
          <p className="mt-2 text-[12px] text-amber-200/90">未填写时无法生成初选（避免空背景抽卡）。</p>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[#10B981]/35 bg-[#10B981]/10 px-4 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-white">智能推荐 Skill</div>
            <p className="mt-1 text-[12px] leading-snug text-gray-300">
              核心 Skill 已默认开启。根据你的背景
              {platformSkillRecommend.lane !== "default" ? `（赛道 ${platformSkillRecommend.lane}）` : ""}
              ，建议加开：
              <span className="text-[#a7f3d0]">
                {platformSkillRecommend.labels.length
                  ? platformSkillRecommend.labels.join(" · ")
                  : "暂无额外赛道（保持核心即可）"}
              </span>
            </p>
          </div>
          <button
            type="button"
            onClick={applyPlatformSkillRecommend}
            className="shrink-0 rounded-lg border border-[#10B981]/45 bg-[#10B981]/20 px-3 py-2 text-[12px] font-bold text-[#a7f3d0] hover:bg-[#10B981]/30"
          >
            一键采纳推荐
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-[#49e6ff]/35 bg-[#49e6ff]/8 px-4 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-lg font-bold text-white md:text-xl">选题初选</div>
            <p className="mt-1 text-[13px] leading-snug text-gray-300">
              先填背景再生成。默认 {PLATFORM_TOPIC_SHORTLIST_DEFAULT} 条；扩写正式文案{" "}
              {CREDIT_COSTS.platformTopicExpand} 点/次（最多 {PLATFORM_TOPIC_EXPAND_MAX} 条）。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[12px] text-gray-300">
              <span>条数</span>
              {([6, 12, 20] as const).map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setTopicShortlistCount(n)}
                  className={`rounded border px-2.5 py-1 font-semibold ${
                    topicShortlistCount === n
                      ? "border-[#49e6ff]/50 bg-[#49e6ff]/20 text-[#b8f4ff]"
                      : "border-white/15 text-gray-400"
                  }`}
                >
                  {n}
                  {n > PLATFORM_TOPIC_SHORTLIST_DEFAULT ? "·加量" : "·默认"}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            disabled={
              !isAuthenticated ||
              generateTopicShortlistMutation.isPending ||
              expandTopicPicksMutation.isPending
            }
            onClick={() => {
              void (async () => {
                if (!focusPrompt.trim()) {
                  toast.error("请先填写上方「人物背景与创作诉求」，再生成初选");
                  scrollToPlatformSection("platform-persona-focus");
                  return;
                }
                try {
                  const existingTitles = [
                    ...(platformContent?.contentBlueprints || []).map((b: { title?: string }) =>
                      String(b?.title || ""),
                    ),
                    ...topicShortlist.map((t) => t.title),
                  ].filter(Boolean);
                  const res = await generateTopicShortlistMutation.mutateAsync({
                    context: focusPrompt.trim() || undefined,
                    enabledSkillIds: Array.from(enabledPlatformSkillIds),
                    allowBloggerTitle,
                    existingTitles,
                    count: topicShortlistCount,
                  });
                  const topics = res.topics || [];
                  setTopicShortlist(topics);
                  setSelectedShortlistIds(
                    new Set(topics.slice(0, PLATFORM_TOPIC_EXPAND_MAX).map((t) => t.id)),
                  );
                  if (!topics.length) {
                    toast.error(
                      "初选未返回选题（可能超时或模型空回）。请稍后重试；若刚扣点请联系管理员核对。",
                    );
                    return;
                  }
                  toast.success(
                    `已生成 ${topics.length} 条初选${
                      res.chargedCredits ? `（扣 ${res.chargedCredits} 点）` : ""
                    }`,
                  );
                } catch (err) {
                  const msg = err instanceof Error ? err.message : String(err);
                  const friendly =
                    msg.includes("Unexpected token") ||
                    msg.includes("is not valid JSON") ||
                    msg.includes("An error o") ||
                    msg.includes("timeout") ||
                    msg.includes("504")
                      ? "算力紧张或请求超时，请稍后重试选题初选"
                      : msg || "初选生成失败";
                  toast.error(friendly);
                }
              })();
            }}
            className="shrink-0 rounded-xl border border-[#49e6ff]/50 bg-[#49e6ff]/20 px-4 py-2.5 text-[14px] font-bold text-[#b8f4ff] disabled:opacity-50"
          >
            {generateTopicShortlistMutation.isPending
              ? "生成中…"
              : `生成 ${topicShortlistCount} 条初选（${topicShortlistPrice.total} 点）`}
          </button>
        </div>
        {topicShortlist.length > 0 ? (
          <>
            <div className="mt-3 max-h-[320px] space-y-1.5 overflow-y-auto pr-1">
              {topicShortlist.map((t) => {
                const on = selectedShortlistIds.has(t.id);
                return (
                  <label
                    key={t.id}
                    className={`flex cursor-pointer items-start gap-2 rounded-md border px-2.5 py-2 text-[12px] ${
                      on
                        ? "border-[#49e6ff]/50 bg-[#49e6ff]/10 text-white"
                        : "border-white/10 bg-black/20 text-gray-300"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={on}
                      onChange={() => {
                        setSelectedShortlistIds((prev) => {
                          const next = new Set(prev);
                          if (next.has(t.id)) next.delete(t.id);
                          else if (next.size < PLATFORM_TOPIC_EXPAND_MAX) next.add(t.id);
                          else toast.message(`最多勾选 ${PLATFORM_TOPIC_EXPAND_MAX} 条`);
                          return next;
                        });
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="font-semibold text-white/95">{t.title}</span>
                      <span className="mt-0.5 block text-gray-400">{t.conveyGoal}</span>
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={
                  expandTopicPicksMutation.isPending ||
                  selectedShortlistIds.size < PLATFORM_TOPIC_EXPAND_MIN ||
                  selectedShortlistIds.size > PLATFORM_TOPIC_EXPAND_MAX
                }
                onClick={() => {
                  void (async () => {
                    const picks = topicShortlist.filter((t) => selectedShortlistIds.has(t.id));
                    if (picks.length < PLATFORM_TOPIC_EXPAND_MIN) {
                      toast.message(`请至少勾选 ${PLATFORM_TOPIC_EXPAND_MIN} 条`);
                      return;
                    }
                    try {
                      const res = await expandTopicPicksMutation.mutateAsync({
                        context: focusPrompt.trim() || undefined,
                        enabledSkillIds: Array.from(enabledPlatformSkillIds),
                        allowBloggerTitle,
                        picks,
                      });
                      const bps = res.contentBlueprints || [];
                      setPlatformContent((prev: any) => ({
                        ...(prev && typeof prev === "object" ? prev : {}),
                        contentBlueprints: bps,
                        monetizationLanes: Array.isArray(prev?.monetizationLanes)
                          ? prev.monetizationLanes
                          : [],
                      }));
                      toast.success(`已扩写 ${bps.length} 条正式文案（含图文页结构）`);
                      scrollToPlatformExecutionCopy();
                    } catch (err) {
                      toast.error(err instanceof Error ? err.message : "扩写失败");
                    }
                  })();
                }}
                className="rounded-xl border border-emerald-400/50 bg-emerald-500/25 px-5 py-3 text-base font-black tracking-wide text-emerald-50 shadow-[0_8px_28px_rgba(16,185,129,0.25)] disabled:opacity-50"
              >
                {expandTopicPicksMutation.isPending
                  ? "扩写中…"
                  : `选题扩写（${selectedShortlistIds.size}/${PLATFORM_TOPIC_EXPAND_MAX}）`}
              </button>
              <button
                type="button"
                disabled={generateTopicShortlistMutation.isPending}
                onClick={() => {
                  setSelectedShortlistIds(new Set());
                  toast.message("已清空勾选；可再点生成换一批");
                }}
                className="rounded-lg border border-white/15 px-3 py-2 text-[12px] text-gray-300"
              >
                清空勾选
              </button>
            </div>
          </>
        ) : null}
      </div>
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
            不选额外 Skill 时只开核心。提示词要求优先于 Skill。全案请用上方「一键采纳推荐」。
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-[#49e6ff]/25 bg-[#49e6ff]/6 px-3 py-2.5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-semibold text-white/90">创作顾问问答</div>
            <p className="mt-0.5 text-[10px] leading-snug text-gray-500">
              可问创作 / Skill / 运营等问题。
              {skillQaModel === "gpt-5.6-sol" ? (
                <>
                  {" "}
                  Sol 每日免费 {PLATFORM_SKILL_QA_SOL_DAILY_FREE} 次
                  {skillQaRemaining != null ? ` · 今日剩 ${skillQaRemaining}` : ""}
                  ，超额 {platformSkillQaPaidCredits("sol")} 积分/次。
                </>
              ) : (
                <>
                  {" "}
                  Terra 每日免费 {PLATFORM_SKILL_QA_TERRA_DAILY_FREE} 次
                  {skillQaRemaining != null ? ` · 今日剩 ${skillQaRemaining}` : ""}
                  ，超额 {platformSkillQaPaidCredits("terra")} 积分/次。
                </>
              )}{" "}
              生图另计：首张九折 {CREDIT_COSTS.platformSkillQaImageFirst} 点，之后{" "}
              {CREDIT_COSTS.platformTopicFrameGraphic} 点。
            </p>
          </div>
          {canConfigureSkillQaModel ? (
            <label className="flex shrink-0 flex-col gap-1 text-[10px] text-[#8cefff]/90">
              <span className="font-semibold uppercase tracking-[0.12em]">问答模型</span>
              <select
                value={skillQaModel}
                onChange={(e) => {
                  const next = e.target.value === "gpt-5.6-sol" ? "gpt-5.6-sol" : "gpt-5.6-terra";
                  setSkillQaModel(next);
                  setSkillQaRemaining(null);
                }}
                className="rounded-md border border-[#49e6ff]/35 bg-black/50 px-2 py-1.5 text-[11px] font-semibold text-white focus:border-[#49e6ff]/60 focus:outline-none"
              >
                <option value="gpt-5.6-terra">5.6 Terra · 免{PLATFORM_SKILL_QA_TERRA_DAILY_FREE}次</option>
                <option value="gpt-5.6-sol">5.6 Sol · 免{PLATFORM_SKILL_QA_SOL_DAILY_FREE}次</option>
              </select>
            </label>
          ) : null}
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
                  去全案分析（推荐）
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

  const platformSkillsMountPanel = (
    <div className="space-y-4">
      {platformMainPersonaTopicsPanel}
      {platformSkillsAccessoryPanel}
    </div>
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
        const supervisorTok = getSupervisorTrpcToken();
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
          ...(supervisorTok ? { supervisorToken: supervisorTok } : {}),
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

  const generateVisualReportMutation = trpc.mvAnalysis.generateVisualReport.useMutation();

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
    if (imageTraces.length === 0 && !hasContent) return null;

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

    const showFailureLog = [...imageTraces, ...(contentJobPollTrace ? [contentJobPollTrace] : [])].some(
      (t) => {
        if (t.lines.length === 0) return false;
        if (t.terminalStatus === "failed" || t.terminalStatus === "client_error") return true;
        if (t.terminalStatus === "succeeded")
          return t.lines.some((ln) => /无有效|无 output|异常|失败|✗/i.test(ln));
        return true;
      },
    );

    return (
      <div className="rounded-2xl border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.05)] p-4 space-y-4">
        <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#49e6ff]">Fly Jobs · 轮询</div>
        <p className="text-[11px] leading-relaxed text-[#d7d0ef]">
          英文化与生图分开展示；每行均含 <span className="text-gray-300">jobId</span>（可复制到 Fly 日志或{" "}
          <code className="text-gray-400">GET /api/jobs/&lt;id&gt;</code>）
        </p>

        {imageTraces.length > 0 ? (
          <div className="rounded-xl border border-[#c4b5fd]/25 bg-[rgba(99,102,241,0.08)] p-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.12em] text-[#c4b5fd]">
              英文化 · 版式翻译
            </div>
            <p className="mt-1 text-[11px] text-[#d7d0ef]">
              合计轮询{" "}
              <span className="font-semibold tabular-nums text-white">{translationTotal}</span> 次
            </p>
            {translationStatsRows.length > 0 ? (
              <div className="mt-2 space-y-1.5 rounded-lg border border-[#c4b5fd]/20 bg-black/20 px-2.5 py-2">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#e9d5ff]">
                  翻译完成统计
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

        {showFailureLog ? (
          <pre className="max-h-56 overflow-auto whitespace-pre-wrap break-words border-t border-white/10 pt-3 text-[10px] leading-5 text-[#c9c0e6]">
            {[...imageTraces, ...(contentJobPollTrace ? [contentJobPollTrace] : [])]
              .filter((t) => t.lines.length > 0)
              .map((t) => `── ${t.label} · ${t.jobId} ──\n${t.lines.join("\n")}`)
              .join("\n\n")}
          </pre>
        ) : null}
      </div>
    );
  }, [contentJobPollTrace, topicImageJobPollTrace, compositeJobPollTrace]);

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
      const supervisorToken = getSupervisorTrpcToken();
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
        coverProEngine:
          canConfigureCompositeImageTranslator && platformCoverVertexNb2 ? "nano_banana_2" : undefined,
        ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
          ? { enableTopicCoverDeepResearchPro: true }
          : {}),
        ...(supervisorToken ? { supervisorToken } : {}),
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
      platformCoverVertexNb2,
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
      /** 管理员专用：Vertex Nano Banana 2 主生图（官方 API） */
      coverProEngine?: "nano_banana_2";
      /** 一键封面套装：40×N 按序分拆扣费 */
      bulkCoverPack?: { packSceneIds: string[]; sequentialSlot: number };
      /** 用户上传人像照片 URL → EvoLink GPT-Image-2 edit 换封面主角 */
      referencePhotoUrl?: string;
    }) => {
      const pollLabel =
        inp.pollDebugLabel ?? (inp.sceneId ? `封面 · ${inp.sceneId}` : "封面 · platform_topic_image");
      const supervisorToken = getSupervisorTrpcToken();
      const { jobId } = await enqueueGenerateTopicImageMutation.mutateAsync({
        topicHook: (inp.topicHook ?? "").slice(0, 500),
        format: inp.format,
        context: inp.context,
        coverPersonaContext: inp.coverPersonaContext,
        failedJobId: inp.failedJobId,
        sceneId: inp.sceneId,
        /** 封面 topic 管线；与 2×4 合成出图开关无关。 */
        imagePromptTranslator: "gpt54" as const,
        coverProEngine:
          canConfigureCompositeImageTranslator && platformCoverVertexNb2 ? "nano_banana_2" : undefined,
        ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
          ? { enableTopicCoverDeepResearchPro: true }
          : {}),
        ...(supervisorToken ? { supervisorToken } : {}),
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
    [enqueueGenerateTopicImageMutation, canConfigureCompositeImageTranslator, platformCoverVertexNb2, platformImageFlowPollIntervalMs, selectedTrendPlatforms],
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
  const optimizeCustomCopyMutation = trpc.mvAnalysis.optimizeCustomCopy.useMutation();
  const customOptimizeCopyCost = CREDIT_COSTS.platformOptimizeCustomCopy;

  /**
   * 生成一張卡片：同步回 imageUrl 直接用；非同步回 progressJobId 則輪詢至終態取圖。
   * @param notePart 知識卡片分頁（上篇/下篇）；分鏡圖傳 undefined。
   */
  const generateCustomNoteOne = async (
    trimmed: string,
    kind: "single_page_knowledge_card" | "storyboard_sheet_landscape",
    notePart?: "upper" | "lower",
  ): Promise<string> => {
    const sceneId = `custom-note-${notePart ?? "single"}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const progressJobId = newPlatformCompositeProgressJobId();
    const title = extractInfographicSubjectFromUserCopy(trimmed);
    const scriptContext =
      kind === "single_page_knowledge_card" && customNoteInfographicTemplateId
        ? composeInfographicScriptContext({
            templateId: customNoteInfographicTemplateId,
            userCopy: trimmed,
          })
        : trimmed;
    const res = await generateCustomNoteMutation.mutateAsync({
      sceneId,
      title,
      scriptContext,
      kind,
      ...(notePart ? { notePart } : {}),
      imagePromptTranslator: COMPOSITE_SHEET_IMAGE_PROMPT_TRANSLATOR,
      progressJobId,
      enabledSkillIds: Array.from(enabledPlatformSkillIds),
      allowBloggerTitle,
    });
    if (res.imageUrl) return res.imageUrl;
    if ((res as { isAsync?: boolean }).isAsync && (res as { progressJobId?: string }).progressJobId) {
      const pid = (res as { progressJobId?: string }).progressJobId!;
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
      return url;
    }
    throw new Error("生成失敗，請重試");
  };

  const mapCustomNoteError = (error: unknown): string => {
    const message = String((error as { message?: string })?.message || "");
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
      return "算力紧张，请稍后再试";
    }
    return message || "生成失败，请稍后重试";
  };

  const handleGenerateCustomNote = async (overrides?: {
    text?: string;
    kind?: typeof customNoteKind;
    skipClearOptimize?: boolean;
  }) => {
    const kind = overrides?.kind ?? customNoteKind;
    const trimmed = (overrides?.text ?? customNoteText).trim();
    if (!trimmed) {
      toast.error("请先输入中文文案");
      return;
    }
    setCustomNoteImageUpper(null);
    setCustomNoteImageLower(null);
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
        setCustomNotePartInFlight("upper");
        const upper = await generateCustomNoteOne(trimmed, "single_page_knowledge_card", "upper");
        setCustomNoteImageUpper(upper);
        toast.success("上篇已生成，正在生成下篇…");
        setCustomNotePartInFlight("lower");
        const lower = await generateCustomNoteOne(trimmed, "single_page_knowledge_card", "lower");
        setCustomNoteImageLower(lower);
        toast.success("上篇＋下篇已生成");
      } else {
        setCustomNotePartInFlight(null);
        const img = await generateCustomNoteOne(trimmed, "storyboard_sheet_landscape", undefined);
        setCustomNoteImageUpper(img);
        toast.success("分鏡圖已生成");
      }
    } catch (e) {
      const msg = mapCustomNoteError(e);
      setCustomNoteError(msg);
      toast.error(`生成失敗：${msg.slice(0, 120)}`);
    } finally {
      setCustomNoteBusy(false);
      setCustomNotePartInFlight(null);
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
        const supervisorTok = getSupervisorTrpcToken();
        const coverPersona = buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim();
        const compositeSupervisorExtras = {
          ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
            ? { enableTopicCoverDeepResearchPro: true as const }
            : {}),
          ...(supervisorTok ? { supervisorToken: supervisorTok } : {}),
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
    }),
    [
      customNoteKind,
      customNoteText,
      customOptimizeBrief,
      customOptimizeResult,
      customOptimizeSummary,
      customNoteImageUpper,
      customNoteImageLower,
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

  // ── B 端 IP 基因库（拦截弹窗，共享组件 IpProfileModal）─────────────────────
  // 落地需求：handleAnalyze 启动前必须先填齐 IP 护城河 + 高客单锚点，
  // 否则弹「靛青色」拦截弹窗，强制用户校准战略预设。
  // ipProfile 同步写 localStorage(`ipProfile.v1`)，GodView 一键深潜也会读它注入 prompt。
  const [ipProfile, setIpProfile] = useState<IpProfile>(() => readIpProfile());
  const [showIpModal, setShowIpModal] = useState(false);

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
      { label: "全案交付", value: "平台优先级、切入方向、选题文案与分镜脚本" },
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
        "在「自定义创作」选题初选上方填写人物背景与创作诉求（与全案共用），并载入 IP 基因；我们会结合近窗口样本，给出平台优先级、切入方向与可落地建议。",
      ),
    [platformDashboard],
  );

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

  /**
   * 轻量版趋势分析：Stage 1 看板 + 可下载 PNG 图文报表（generateVisualReport），不入队 Stage 2。
   * 供工作台顶部「平台趋势分析报表」区块独立启动，无需等全案分析。
   */
  const handleTrendStandaloneAnalyze = async () => {
    if (selectedTrendPlatforms.length !== 1) {
      toast.error("请选择一个分析平台");
      return;
    }
    const visualPlatforms = toVisualReportPlatforms(selectedTrendPlatforms);
    if (!visualPlatforms.length) {
      toast.error("当前所选平台暂不支持图文报表（视频号即将开放）");
      return;
    }
    const selectedPlatformLabels = selectedTrendPlatforms
      .filter((k) => k !== "weixin_channels")
      .map((key) => TREND_PLATFORM_OPTIONS.find((item) => item.key === key)?.label)
      .filter(Boolean)
      .join("、");

    const cost = CREDIT_COSTS.platformTrend ?? 50;
    const reportWindowDays = toVisualReportWindowDays(selectedWindowDays);
    const windowNote =
      selectedWindowDays === 45
        ? "（45 天窗口的 PNG 报表按 30 天口径生成）"
        : "";
    if (
      !window.confirm(
        `【平台趋势分析】将读取${selectedPlatformLabels || "所选平台"}近 ${selectedWindowDays} 天样本，生成四格战略摘要、Stage 1 看板，并同步生成含蓝海词的可下载 PNG 图文报表${windowNote}。\n\n扣除 ${cost} 积分，不含专属文案 / 决策智库全景（需另行加购）。是否开始？`,
      )
    ) {
      return;
    }

    platformAnalysisEpochRef.current += 1;
    void trpcUtils.mvAnalysis.getGrowthSnapshot.cancel();
    queryClient.removeQueries({ queryKey: [["mvAnalysis", "getGrowthSnapshot"]] });

    setAskResult(null);
    setPlatformDashboard(null);
    setDashboardDebug(null);
    setIsDashboardLoading(false);
    setVisualReportData(null);
    setIsVisualReportLoading(false);
    setPlatformContent(null);
    setContentDebug(null);
    setIsContentLoading(false);
    setStage2Failed(false);
    setContentJobError(null);
    setContentJobPollTrace(null);
    setElapsedTime(0);

    const result = await growthSnapshotQuery.refetch();
    if (!result.data?.snapshot) {
      toast.error("平台趋势分析暂时没有返回结果");
      return;
    }
    setHasAnalyzed(true);
    toast.success("快照已就绪，正在生成看板与 PNG 图文报表…");

    const snap = result.data.snapshot;
    const personaContext = String(focusPrompt || "").trim().slice(0, 4000);
    setIsDashboardLoading(true);
    setIsVisualReportLoading(true);
    try {
      // 平台趋势分析是独立功能：看板摘要 + PNG 图文报表并行；PNG 依赖 generateVisualReport（Evolink）
      const [dashSettled, visualSettled] = await Promise.allSettled([
        getPlatformDashboardMutation.mutateAsync({
          context: focusPrompt || undefined,
          windowDays: selectedWindowDays,
          snapshotSummary: snap as any,
          copyLlmMode: "openai" as const,
          requestedPlatforms: selectedTrendPlatforms,
        }),
        generateVisualReportMutation.mutateAsync({
          windowDays: reportWindowDays,
          theme: visualReportTheme,
          platforms: visualPlatforms,
          ...(personaContext ? { personaContext } : {}),
        }),
      ]);

      let hasDash = false;
      let hasReport = false;
      const errors: string[] = [];

      if (dashSettled.status === "fulfilled") {
        const dashResult = dashSettled.value;
        if (dashResult.platformDashboard) {
          setPlatformDashboard(dashResult.platformDashboard as unknown as PlatformDashboard);
          hasDash = true;
        } else {
          errors.push(
            sanitizePlatformUserMessage(
              String((dashResult as { debug?: { error?: string } }).debug?.error || ""),
              "趋势看板生成失败，请重试",
            ),
          );
        }
      } else {
        const msg = dashSettled.reason instanceof Error ? dashSettled.reason.message : String(dashSettled.reason);
        errors.push(sanitizePlatformUserMessage(msg, "趋势看板生成失败，请稍后重试"));
      }

      if (visualSettled.status === "fulfilled") {
        const mappedReport = mapGenerateVisualReportResult(visualSettled.value, {
          windowDays: reportWindowDays,
          theme: visualReportTheme,
        });
        if (mappedReport) {
          setVisualReportData(mappedReport);
          hasReport = true;
        } else {
          const softErr =
            typeof (visualSettled.value as { error?: unknown })?.error === "string"
              ? String((visualSettled.value as { error?: string }).error)
              : "";
          errors.push(sanitizePlatformUserMessage(softErr, "PNG 图文报表生成失败，请重试"));
        }
      } else {
        const msg =
          visualSettled.reason instanceof Error ? visualSettled.reason.message : String(visualSettled.reason);
        errors.push(sanitizePlatformUserMessage(msg, "PNG 图文报表生成失败，请稍后重试"));
      }

      if (hasDash && hasReport) {
        toast.success("平台趋势分析报表已就绪，可下载 PNG 长图。");
      } else if (hasReport) {
        toast.success("PNG 趋势报表已就绪，可下载长图。");
        if (errors[0]) toast.error(`看板摘要：${errors[0].slice(0, 100)}`);
      } else if (hasDash) {
        toast.error(
          `趋势 PNG 报表未生成：${(errors.find((e) => /报表|PNG|JSON|Evolink|网关|超时|算力/i.test(e)) || errors[0] || "请重试").slice(0, 140)}`,
        );
      } else {
        toast.error(errors[0] || "平台趋势分析失败，请稍后重试");
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(sanitizePlatformUserMessage(msg, "趋势分析失败，请稍后重试"));
    } finally {
      setIsDashboardLoading(false);
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
        backgroundColor: visualReportTheme === "dark" ? "#080618" : "#fff5f0",
      });
      const link = document.createElement("a");
      link.download = `mvstudiopro-trend-report-${reportWindowDays}d-${visualReportTheme}.png`;
      link.href = dataUrl;
      link.click();
      toast.success("PNG 图文报表已下载");
    } catch {
      toast.error("下载失败，请重试");
    } finally {
      setIsVisualReportDownloading(false);
    }
  };

  const handleAnalyze = async () => {
    // ── B 端拦截：必须先注入 IP 基因库（行业身份 / 优势 / 受众 / 旗舰交付）
    if (!isIpProfileReady(ipProfile)) {
      setShowIpModal(true);
      toast.message("启动战略推演前，请先载入企业专属 IP 基因");
      return;
    }

    if (!selectedTrendPlatforms.length) {
      toast.error("请至少选择一个分析平台");
      return;
    }

    const selectedPlatformLabels = selectedTrendPlatforms
      .map((key) => TREND_PLATFORM_OPTIONS.find((item) => item.key === key)?.label)
      .filter(Boolean)
      .join("、");

    setPendingFullAnalysisLabels(selectedPlatformLabels);
    setFullAnalysisConfirmOpen(true);
  };

  const runFullAnalysisAfterConfirm = async () => {
    setFullAnalysisConfirmOpen(false);
    const selectedPlatformLabels = pendingFullAnalysisLabels;

    /** 本輪 Stage1/2 使用此字串（與輸入框內容一致即可；不再自動清空輸入框）。 */
    const capturedJudgment = String(focusPrompt || "").trim();

    platformAnalysisEpochRef.current += 1;
    void trpcUtils.mvAnalysis.getGrowthSnapshot.cancel();
    queryClient.removeQueries({ queryKey: [["mvAnalysis", "getGrowthSnapshot"]] });

    setAskResult(null);
    setPlatformDashboard(null);
    setDashboardDebug(null);
    setIsDashboardLoading(false);
    setPlatformContent(null);
    setContentDebug(null);
    setIsContentLoading(false);
    setStage2Failed(false);
    setContentJobError(null);
    setContentJobPollTrace(null);
    setElapsedTime(0);
    setPlatformImageMap({});
    setPlatformStoryboardSheetMap({});
    setPlatformXhsNoteMap({});
    setSceneJobIds({});
    setPendingCompositeSheet(null);
    compositeSheetLivePollCtxRef.current = null;
    setPlatformImageGenFlowSnapshots([]);
    setCoverWaitCarouselEngaged(false);
    setCoverLoadRetriedIds(() => new Set());
    setCompositeLoadRetriedKeys(() => new Set());
    setCoverSilentRetryIds(() => new Set());
    setBatchGeneratingCoverIds(() => new Set());
    setIsSequentialCoverBatchGenerating(false);
    setTopicImageJobPollTrace(null);
    setCompositeJobPollTrace(null);
    coverImageCacheBustTriedRef.current = new Set();

    void trpcUtils.mvAnalysis.getLatestDecisionIntelligenceReport.invalidate();
    void trpcUtils.mvAnalysis.getDecisionIntelligencePricing.invalidate();
    generateDecisionIntelMutation.reset();

    const result = await growthSnapshotQuery.refetch();
    if (!result.data?.snapshot) {
      toast.error("平台分析暂时没有返回结果");
      return;
    }
    setHasAnalyzed(true);
    toast.success(
      `快照已就绪（${selectedPlatformLabels || "所选平台"}），正在生成战略看板与专属文案…`,
    );

    const snap = result.data.snapshot;
    const snapSummary = snap as Record<string, unknown>;
    setIsDashboardLoading(true);
    try {
      const dashResult = await getPlatformDashboardMutation.mutateAsync({
        context: capturedJudgment || undefined,
        windowDays: selectedWindowDays,
        snapshotSummary: snap as any,
        copyLlmMode: "openai" as const,
        requestedPlatforms: selectedTrendPlatforms,
      });

      if (!dashResult.platformDashboard) {
        console.warn("[PlatformPage] Stage 1 AI 解析失败:", dashResult.debug?.error);
        toast.error(
          `战略看板生成失败：AI 数据格式异常，请重试 (${String((dashResult.debug as { error?: unknown })?.error ?? "未知")})`,
        );
        return;
      }

      const dash = dashResult.platformDashboard as unknown as PlatformDashboard;
      setPlatformDashboard(dash);
      setContentJobError(null);
      setStage2Failed(false);
      setPlatformContent(null);
      setContentDebug(null);
      lastStage2InputRef.current = {
        snapshotSummary: snapSummary,
        windowDays: selectedWindowDays,
      };
      setIsDashboardLoading(false);

      await enqueueAndPollExclusiveContent(dash, snapSummary, selectedWindowDays, capturedJudgment);
    } catch (e) {
      console.warn("[PlatformPage] handleAnalyze chain error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (!String(msg).includes("文案生成失败")) {
        toast.error(`分析中断：${msg}`);
      }
    } finally {
      setIsDashboardLoading(false);
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
        toast.error("请先完成快照与战略看板（点「开始全案分析」）");
        return;
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
    toast.message("请先完成全案分析：填写人物背景并点「开始全案分析」，生成看板与文案后，可在此单独加购决策智库报告。");
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
    toast.message("请先在上方「平台趋势分析报表」选择天数与平台，再点「开始平台趋势分析」（与全案分析分开计费）。");
    document.getElementById("platform-custom-workspace-trends")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [snapshot, platformDashboard]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#49e6ff]" />
      </div>
    );
  }

  if (!isAuthenticated && !supervisorAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-transparent px-6 text-white">
        <div className="max-w-lg rounded-[28px] border border-[#2b1f52] bg-[#100926]/95 p-8 text-center shadow-[0_20px_80px_rgba(0,0,0,0.35)]">
          <div className="text-sm uppercase tracking-[0.24em] text-[#8cefff]">Platform Intelligence</div>
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

      {/* B 端 IP 基因库 · 靛青色拦截弹窗（共享组件 IpProfileModal） */}
      <IpProfileModal
        open={showIpModal}
        value={ipProfile}
        onChange={setIpProfile}
        onClose={() => setShowIpModal(false)}
      />

      <Dialog open={fullAnalysisConfirmOpen} onOpenChange={setFullAnalysisConfirmOpen}>
        <DialogContent className="max-w-lg border border-[#49e6ff]/25 bg-[#0a0618] text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-white">开始全案分析前确认</DialogTitle>
            <DialogDescription className="text-[#b7add8]">
              基于{pendingFullAnalysisLabels || "所选平台"}近 {selectedWindowDays}{" "}
              天样本 + 你的人物背景与创作诉求。
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-start gap-3 rounded-2xl border border-[#49e6ff]/25 bg-[#49e6ff]/8 px-3 py-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[#49e6ff]/40 bg-[#49e6ff]/15 text-[#8cefff]">
              <Bot className="h-4 w-4" aria-hidden />
            </div>
            <div className="rounded-2xl rounded-tl-sm border border-white/10 bg-black/35 px-3 py-2.5 text-[12px] leading-relaxed text-gray-200">
              <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#8cefff]">智能提醒</p>
              <p>
                核心 Skill 已默认开启；将按你的背景<strong className="text-white">智能推荐</strong>
                赛道 Skill（可在生成前一键采纳）。不必翻完整 Skill 墙。
              </p>
              <p className="mt-1.5 text-[#b8f4ff]">
                出六条前会先用 <strong className="text-white">Pro 深度优化选题</strong>
                （对齐你选的 {selectedWindowDays} 天热点并避开近期复读）。
              </p>
              <p className="mt-2 text-[10px] leading-snug text-gray-500 whitespace-pre-wrap">
                {PLATFORM_USER_PROMPT_OVERRIDES_SKILLS_RULE}
              </p>
            </div>
          </div>
          <div className="rounded-xl border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-amber-50/90">
            入队扣除 <strong className="text-[#fef08a]">{CREDIT_COSTS.platformStage2Copywriting} 积分</strong>
            （含 Pro 选题优化，不加收）。不含封面图、编导分镜图、决策智库报告。全程可能更久，请勿关闭页面。
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
              确认开始
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="mx-auto max-w-[min(1920px,100%)] px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => window.history.back()}
              className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10"
            >
              <ArrowLeft className="h-5 w-5" />
            </button>
            <a
              href="#platform-custom-workspace"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-[#ff4fb8]/35 bg-[linear-gradient(135deg,rgba(255,79,184,0.18),rgba(192,38,211,0.10))] px-3.5 py-2 text-xs font-bold text-[#ff9fe0] shadow-[0_4px_20px_rgba(255,79,184,0.15)] transition hover:border-[#ff4fb8]/55 hover:brightness-110"
            >
              <PenLine className="h-3.5 w-3.5" />
              自定义创作
            </a>
            <button
              type="button"
              onClick={openVideoDeepBreakdown}
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/40 bg-[linear-gradient(135deg,rgba(52,211,153,0.22),rgba(16,185,129,0.10))] px-3.5 py-2 text-xs font-bold text-emerald-100 shadow-[0_4px_20px_rgba(52,211,153,0.18)] transition hover:border-emerald-300/55 hover:brightness-110"
            >
              <Video className="h-3.5 w-3.5" />
              视频深度拆解
            </button>
          </div>
          <div className="rounded-full border border-[#49e6ff]/20 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-xs font-semibold uppercase tracking-[0.22em] text-[#8cefff]">
            Platform Intelligence
          </div>
        </div>


        {(supervisorAccess || user?.role === "supervisor" || user?.role === "admin") ? (
          <div className="mb-4 flex items-center justify-end">
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
        {debugMode && (
          <div className="mb-6 rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#ff7fd5]">🎤 语音输入 Debug Log</div>
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
        )}
        {debugMode ? (
          <GrowthSystemDebugPanel
            enabled={debugMode}
            pollActive={debugMode || isAnalyzing}
            growthSnapshotDebug={snapshotDebug}
            growthSnapshotNotes={snapshot?.status?.notes}
            className="mb-6"
          />
        ) : null}

        {/* ── 自定义创作工作台 · 页面顶部快捷入口（不依赖 Stage 1/2） ── */}
        <section
          id="platform-custom-workspace"
          className={`${shellCardClasses("relative overflow-hidden p-6 md:p-7 mb-6 scroll-mt-24")} ring-1 ring-[#ff4fb8]/30 shadow-[0_20px_70px_rgba(255,79,184,0.14)]`}
        >
          <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-[linear-gradient(90deg,#ff4fb8,#49e6ff,#7d73ff)]" />
          <div className="pointer-events-none absolute -left-20 -top-20 h-40 w-40 rounded-full bg-[#ff4fb8]/12 blur-3xl" />
          <div className="pointer-events-none absolute right-0 top-0 h-32 w-32 rounded-full bg-[#49e6ff]/8 blur-3xl" />
          <div className="relative">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <PenLine className="h-5 w-5 text-[#ff4fb8]" />
            <h2 className="text-lg md:text-xl font-black tracking-tight text-white">自定义创作工作台</h2>
            <span className="ml-1 rounded-full border border-emerald-400/45 bg-[rgba(52,211,153,0.12)] px-2.5 py-0.5 text-[10px] font-bold tracking-wide text-emerald-100">
              含视频深度拆解
            </span>
          </div>
          <p className="mb-4 text-xs text-[#c9c0e6]/55">粘贴文案、视频深度拆解、自定义选题与抠像，均在本页同屏完成，无需跳转</p>

          {/* 平台趋势分析 · 常驻在工作台顶部，不依赖下方全案区是否展开 */}
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
                  ) : platformDashboard ? (
                    <span className="rounded-full border border-[#6ee7b7]/35 bg-[rgba(52,211,153,0.1)] px-2.5 py-0.5 text-[10px] font-semibold text-[#6ee7b7]">
                      已出报告 · 无需等全案文案
                    </span>
                  ) : isAnalyzing || isDashboardLoading ? (
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
                  一次启动即可得到四格战略摘要、Stage 1 看板与 PNG 图文报表。「总览」看多平台；「AI 漫剧」专看抖音合集飙升（同源数据，不另开抓取）。不含决策智库全景。
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

            {!platformDashboard && !isAnalyzing && !isDashboardLoading && !isVisualReportLoading ? (
              <div className="mt-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleTrendStandaloneAnalyze()}
                    disabled={growthSnapshotQuery.isFetching}
                    className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_28px_rgba(73,230,255,0.16)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {growthSnapshotQuery.isFetching ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    开始平台趋势分析
                  </button>
                  <span className="rounded-full border border-[#fbbf24]/45 bg-[rgba(251,191,36,0.12)] px-3 py-1.5 text-[11px] font-black tabular-nums text-[#fef08a]">
                    {(CREDIT_COSTS as any).platformTrend ?? 50} 积分/次
                  </span>
                  <span className="text-[11px] text-[#c9c0e6]/50">含 PNG 图文报表 · 不含专属文案</span>
                </div>
              </div>
            ) : null}

            {(isDashboardLoading || isVisualReportLoading || isAnalyzing) && !platformDashboard && !visualReportData ? (
              <div className="mt-4 rounded-2xl border border-[#49e6ff]/20 bg-[rgba(73,230,255,0.06)] p-4">
                <div className="flex items-center gap-2 text-sm text-[#8cefff]">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  正在读取近 {selectedWindowDays} 天样本，生成战略看板与含蓝海词的 PNG 图文报表…
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/[0.08]">
                  <div className="h-full w-2/5 animate-pulse rounded-full bg-gradient-to-r from-[#49e6ff] via-[#7d73ff] to-[#ff4fb8]" />
                </div>
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

            {!platformDashboard && !snapshot && !isAnalyzing && !isDashboardLoading && !isVisualReportLoading ? (
              <p className="mt-4 text-xs leading-relaxed text-[#c9c0e6]/45">
                启动分析后，上方四格会先出战略摘要；完成后可下载含蓝海词的 PNG 长图（平台趋势报表，不是决策智库全景）。
              </p>
            ) : null}

            {(() => {
              const rising =
                platformDashboard?.aiManhuaRising?.entries?.length
                  ? platformDashboard.aiManhuaRising
                  : visualReportData?.aiManhuaRising?.entries?.length
                    ? visualReportData.aiManhuaRising
                    : null;
              const fmtPlay = (n: number) =>
                n >= 10000 ? `${(n / 10000).toFixed(1)}万` : String(n || 0);
              const statusLabel = (s: string) =>
                s === "surging" ? "飙升" : s === "hot" ? "高热" : s === "new" ? "新爆" : "稳态";
              const kindCounts = (rising?.entries || []).reduce<Record<string, number>>((acc, row) => {
                const k = row.dramaKind === "ai_manhua" ? "AI漫剧" : row.dramaKind === "short_drama" ? "短剧合集" : "待判定";
                acc[k] = (acc[k] || 0) + 1;
                return acc;
              }, {});

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
                      总览 · 多平台报表
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
                      {rising?.entries?.length ? (
                        <span className="rounded-full bg-white/15 px-1.5 py-0.5 text-[10px] tabular-nums">
                          {rising.entries.length}
                        </span>
                      ) : null}
                    </button>
                  </div>

                  {trendInsightTab === "overview" ? (
                    <>
                      {rising?.entries?.length ? (
                        <div className="mt-3 rounded-2xl border border-[#ff4fb8]/20 bg-[rgba(255,79,184,0.05)] px-4 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-[12px] font-semibold text-[#ff9fe0]">
                              AI 漫剧摘要 · Top {Math.min(3, rising.entries.length)}
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
                            {rising.entries.slice(0, 3).map((row, idx) => (
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
                        <div className="mt-4 rounded-2xl border border-[#6fffb0]/20 bg-[rgba(111,255,176,0.06)] p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-[#6fffb0]">PNG 图文报表已就绪</div>
                              <p className="mt-1 text-[11px] text-[#c9c0e6]/60">
                                多平台洞察 + 蓝海词；含漫剧摘要条（完整榜单见「AI 漫剧」Tab）。
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
                    </>
                  ) : (
                    <div className="mt-3 rounded-2xl border border-[#ff4fb8]/25 bg-[rgba(255,79,184,0.06)] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <div className="text-sm font-semibold text-[#ff9fe0]">
                            抖音 AI 漫剧专区 · {rising?.windowDays || selectedWindowDays} 天飙升
                          </div>
                          <p className="mt-1 max-w-2xl text-[11px] leading-relaxed text-[#c9c0e6]/60">
                            {rising?.note
                              || "与总览报表数据同源：抖音采集中的合集/漫剧字段单独聚合。其它种草、口播样本仍在「总览」里。"}
                          </p>
                        </div>
                        <a
                          href="/canvas"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#ff4fb8]/30 bg-[rgba(255,79,184,0.1)] px-3 py-1.5 text-[11px] font-semibold text-[#ff9fe0] transition hover:bg-[rgba(255,79,184,0.18)]"
                        >
                          <Film className="h-3.5 w-3.5" />
                          去漫剧工厂
                        </a>
                      </div>

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

                      {rising?.entries?.length ? (
                        <div className="mt-3 space-y-2">
                          <div className="grid grid-cols-[28px_1fr_72px_72px_40px] gap-2 px-1 text-[10px] text-[#c9c0e6]/45">
                            <span />
                            <span>剧名</span>
                            <span className="text-right">合集播放</span>
                            <span className="text-right">环比</span>
                            <span className="text-right">状态</span>
                          </div>
                          {rising.entries.slice(0, 12).map((row, idx) => {
                            const titleNode = (
                              <div className="min-w-0">
                                <div className="truncate font-semibold text-white">{row.mixName}</div>
                                <div className="truncate text-[10px] text-[#c9c0e6]/50">
                                  {row.author ? `${row.author} · ` : ""}
                                  {row.sampleTitle || row.dramaKind}
                                </div>
                              </div>
                            );
                            return (
                              <div
                                key={row.mixId || idx}
                                className="grid grid-cols-[28px_1fr_72px_72px_40px] items-center gap-2 rounded-xl border border-white/8 bg-black/25 px-3 py-2 text-[12px]"
                              >
                                <span className="font-bold text-[#c9c0e6]/45">#{idx + 1}</span>
                                {row.url ? (
                                  <a
                                    href={row.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="min-w-0 hover:opacity-90"
                                    title="在抖音打开"
                                  >
                                    {titleNode}
                                  </a>
                                ) : titleNode}
                                <span className="text-right font-semibold tabular-nums text-[#3eedff]">
                                  {fmtPlay(row.mixPlayCount)}
                                </span>
                                <span className="text-right font-semibold tabular-nums text-[#ff4fb8]">
                                  {row.delta7d == null ? "—" : `+${fmtPlay(row.delta7d)}`}
                                </span>
                                <span className="text-right text-[10px] font-semibold text-[#ff9fe0]">
                                  {statusLabel(row.status)}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="mt-4 rounded-xl border border-dashed border-white/15 bg-black/20 px-4 py-6 text-center text-[12px] leading-relaxed text-[#c9c0e6]/55">
                          暂无漫剧合集样本。请确认已选「抖音」、完成趋势分析，且采集侧已跑出带 mix_info 的条目。
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

          {/* 一级 Tab：文案 / 选题 / 动效PPT / 素材 — 同一条连续，中间不插 Skill */}
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
                onClick={() => setCustomWorkspaceTab("htmlPpt")}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[13px] font-semibold transition disabled:opacity-50 ${
                  customWorkspaceTab === "htmlPpt"
                    ? "bg-[linear-gradient(135deg,#818cf8,#6366f1)] text-white shadow-sm"
                    : "text-indigo-100/80 hover:text-white"
                }`}
              >
                <Presentation className="h-4 w-4 shrink-0" />
                动效PPT
              </button>
              <button
                type="button"
                onClick={openVideoDeepBreakdown}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
                  customWorkspaceTab === "assets"
                    ? "bg-[linear-gradient(135deg,#a3e635,#16a34a)] text-white shadow-sm"
                    : "text-[#c9c0e6]/70 hover:text-white"
                }`}
              >
                <Video className="h-3.5 w-3.5 shrink-0" />
                视频深度拆解
              </button>
              <button
                type="button"
                onClick={() => setCustomWorkspaceTab("matting")}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] font-semibold transition disabled:opacity-50 ${
                  customWorkspaceTab === "matting"
                    ? "bg-[linear-gradient(135deg,#34d399,#059669)] text-white shadow-sm"
                    : "text-[#c9c0e6]/70 hover:text-white"
                }`}
              >
                <Scissors className="h-3.5 w-3.5 shrink-0" />
                自定义抠像
              </button>
          </div>

          {customWorkspaceTab === "copy" || customWorkspaceTab === "topic" ? (
            <div className="mb-5 space-y-4">
              {platformMainPersonaTopicsPanel}
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
                  active={Boolean(customNoteText.trim()) && !customNoteImageUpper && !customOptimizeResult}
                  done={Boolean(customNoteImageUpper || customNoteImageLower || customOptimizeResult)}
                />
              </div>

              <div className="mb-4">
                <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#c9c0e6]/60 mb-2">生成类型</div>
                <div className="inline-flex flex-wrap rounded-xl border border-white/10 bg-black/35 p-0.5 gap-0.5">
                  <button
                    type="button"
                    onClick={() => { setCustomNoteKind("single_page_knowledge_card"); setCustomNoteImageUpper(null); setCustomNoteImageLower(null); setCustomNoteError(null); setCustomOptimizeResult(null); setCustomOptimizeSummary(null); }}
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
                    onClick={() => { setCustomNoteKind("storyboard_sheet_landscape"); setCustomNoteImageUpper(null); setCustomNoteImageLower(null); setCustomNoteError(null); setCustomOptimizeResult(null); setCustomOptimizeSummary(null); }}
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
                    onClick={() => { setCustomNoteKind("optimize_custom_copy"); setCustomNoteImageUpper(null); setCustomNoteImageLower(null); setCustomNoteError(null); setCustomOptimizeResult(null); setCustomOptimizeSummary(null); }}
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

              <div className="mb-3">
                <InfographicTemplatePicker
                  disabled={customNoteBusy}
                  selectedTemplateId={customNoteInfographicTemplateId}
                  onSelect={(t) => {
                    setCustomNoteInfographicTemplateId(t?.id ?? null);
                    setCustomNoteInfographicLabelZh(t?.labelZh ?? null);
                    if (t) {
                      setCustomNoteKind("single_page_knowledge_card");
                      toast.success(`已选版式「${t.labelZh}」· 主题以正文为准`);
                    }
                  }}
                />
                {customNoteInfographicLabelZh ? (
                  <p className="mt-1.5 text-[11px] text-cyan-100/55">
                    已选版式：{customNoteInfographicLabelZh}（提示词不展示，生成时后台套用你的正文）
                  </p>
                ) : null}
              </div>

              <textarea
                className="w-full min-h-[140px] resize-y rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] px-4 py-3 text-sm leading-relaxed text-white placeholder-[#6d6384] focus:border-[#ff4fb8]/60 focus:outline-none focus:ring-1 focus:ring-[#ff4fb8]/30 transition"
                placeholder={
                  customNoteKind === "optimize_custom_copy"
                    ? "粘贴待优化的封面文案、分镜描述或完整 Markdown…（建议 100–3000 字）"
                    : customNoteKind === "single_page_knowledge_card"
                      ? "粘贴中文正文 / Markdown（主题写在正文标题里即可）…生成上篇 + 下篇两张"
                      : "输入中文文案或分镜脚本，系统自动翻译并生成 2×4 编导分镜图…（建议 100–800 字）"
                }
                value={customNoteText}
                onChange={(e) => setCustomNoteText(e.target.value)}
                disabled={customNoteBusy}
              />
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
                  disabled={customNoteBusy || !customNoteText.trim()}
                  className={`inline-flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white shadow-[0_6px_24px_rgba(255,79,184,0.22)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 ${
                    customNoteKind === "optimize_custom_copy"
                      ? "border border-[#fbbf24]/30 bg-[linear-gradient(135deg,#fbbf24,#f97316)]"
                      : customNoteKind === "single_page_knowledge_card"
                      ? "border border-[#ff4fb8]/30 bg-[linear-gradient(135deg,#ff4fb8,#c026d3)]"
                      : "border border-[#49e6ff]/30 bg-[linear-gradient(135deg,#49e6ff,#6a5cff)]"
                  }`}
                >
                  {customNoteBusy ? (
                    <><Loader2 className="h-4 w-4 animate-spin" />{customNoteKind === "optimize_custom_copy" ? "优化中…" : "生成中…"}</>
                  ) : customNoteKind === "optimize_custom_copy" ? (
                    <><Sparkles className="h-4 w-4" />深度优化文案（{customOptimizeCopyCost} 积分）</>
                  ) : customNoteKind === "single_page_knowledge_card" ? (
                    <><Sparkles className="h-4 w-4" />生成图文卡片（上 + 下篇）</>
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
                      setCustomNoteError(null);
                      setCustomOptimizeResult(null);
                      setCustomOptimizeSummary(null);
                      setCustomNoteText("");
                      setCustomOptimizeBrief("");
                      setCustomNoteInfographicTemplateId(null);
                      setCustomNoteInfographicLabelZh(null);
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
                    : customNotePartInFlight === "upper"
                    ? "正在生成【上篇】，约需 3–5 分钟…（之后自动接着生成下篇）"
                    : customNotePartInFlight === "lower"
                      ? "上篇已完成 ✓ 正在生成【下篇】，约需 3–5 分钟，请勿关闭页面…"
                      : "正在生成图片，约需 3–5 分钟，请勿关闭页面…"}
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
                      用优化稿生成图文卡片（50 积分）
                    </button>
                  </div>
                </div>
              ) : null}

              {(customNoteImageUpper || customNoteImageLower) && (
                <div className="mt-5 space-y-6">
                  {customNoteImageUpper && (
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#ff9fe0]/70">
                        {customNoteKind === "single_page_knowledge_card" ? "图文卡片 ·（上篇）" : "编导分镜图生成结果"}
                      </div>
                      <img
                        src={customNoteImageUpper}
                        alt={customNoteKind === "single_page_knowledge_card" ? "单页图文知识卡片（上篇）" : "2×4 编导分镜图"}
                        className="w-full rounded-2xl border border-white/10 object-contain shadow-[0_12px_48px_rgba(0,0,0,0.35)]"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          setCustomNoteError("图片加载失败，请确认图片 URL 是否有效");
                        }}
                      />
                      <div className="flex justify-end">
                        <a
                          href={customNoteImageUpper}
                          download={customNoteKind === "single_page_knowledge_card" ? "knowledge-card-upper.png" : "storyboard-2x4.png"}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[rgba(73,230,255,0.15)]"
                        >
                          <Download className="h-4 w-4" />
                          下载{customNoteKind === "single_page_knowledge_card" ? "上篇" : "图片"}
                        </a>
                      </div>
                    </div>
                  )}
                  {customNoteImageLower && (
                    <div className="space-y-3">
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#ff9fe0]/70">图文卡片 ·（下篇）</div>
                      <img
                        src={customNoteImageLower}
                        alt="单页图文知识卡片（下篇）"
                        className="w-full rounded-2xl border border-white/10 object-contain shadow-[0_12px_48px_rgba(0,0,0,0.35)]"
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                          setCustomNoteError("下篇图片加载失败，请确认图片 URL 是否有效");
                        }}
                      />
                      <div className="flex justify-end">
                        <a
                          href={customNoteImageLower}
                          download="knowledge-card-lower.png"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-full border border-[#49e6ff]/25 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-sm font-semibold text-[#8cefff] transition hover:bg-[rgba(73,230,255,0.15)]"
                        >
                          <Download className="h-4 w-4" />
                          下载下篇
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
          ) : customWorkspaceTab === "assets" ? (
            <>
              <PlatformAssetAnalysisPanel
                debugMode={debugMode}
                supervisorAccess={Boolean(supervisorAccess || user?.role === "supervisor" || user?.role === "admin")}
                disabled={customNoteBusy || customTopicBusy || customMattingBusy}
                personaSummary={personaSummary}
                ipProfile={ipProfile}
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
                <div className="mt-5 rounded-2xl border border-red-500/25 bg-[rgba(239,68,68,0.08)] px-4 py-3 text-sm text-red-300">
                  ❌ {customNoteError}
                </div>
              ) : null}
            </>
          ) : customWorkspaceTab === "htmlPpt" ? (
            <PlatformHtmlPptPanel
              disabled={customNoteBusy || customTopicBusy || customMattingBusy || assetAnalysisBusy}
            />
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
        </section>

        {customWorkspaceOperating ? (
          <p className="mb-4 text-center text-xs text-[#c9c0e6]/45">
            自定义文案/选题/抠像进行中，下方全案分析区已收起；平台趋势报表与视频深度拆解仍可在上方工作台查看。
          </p>
        ) : null}
        <div className={customWorkspaceOperating ? "hidden" : undefined} aria-hidden={customWorkspaceOperating}>
        <section className={shellCardClasses("overflow-hidden p-6 md:p-8")}>
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(73,230,255,0.55),transparent)]" />
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#362561] bg-[rgba(23,13,53,0.9)] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#aa95dc]">
                <TrendingUp className="h-3.5 w-3.5" />
                平台顾问台
              </div>
              <div className="mt-4 flex flex-col gap-3">
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
                          {CREDIT_COSTS.platformTrend} 积分/次
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-snug text-[#c4b8e8] md:text-[15px]">
                        四格战略摘要、Stage 1 看板与可下载 PNG 图文报表（不含专属文案 / 决策智库）
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
              <h1 className="mt-5 max-w-5xl text-[40px] font-black leading-[0.92] text-white md:text-[64px] xl:text-[76px]">
                不是告诉你"平台都能做"
                <span className="mt-2 block bg-[linear-gradient(135deg,#5af2ff,#7d73ff_45%,#ff75bd_85%)] bg-clip-text text-transparent">
                  而是告诉你现在该先打哪里
                </span>
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-8 text-[#d3caef] md:text-base">
                {personaSummary}
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-8 text-[#b8afd9] md:text-[15px]">
                {platformDashboard?.subheadline
                  || "这个页面不做视频上传，不做二次创作流程，不讲空泛平台画像。它只解决三件事：当前时间窗口里，哪个平台值得优先做；热点赛道该怎么切；以及你怎样把这轮内容机会变成真实商业承接。"}
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {heroTrustPoints.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">{item.label}</div>
                    <div className="mt-2 text-sm leading-7 text-white">{item.value}</div>
                  </div>
                ))}
              </div>

              {/* IP 基因库入口（已填则显示战略锚点摘要 + 编辑按钮；未填则提示载入） */}
              <button
                type="button"
                onClick={() => setShowIpModal(true)}
                className={`mt-5 w-full rounded-2xl border px-5 py-4 text-left transition ${
                  isIpProfileReady(ipProfile)
                    ? "border-[#6366F1]/40 bg-[linear-gradient(135deg,rgba(79,70,229,0.18),rgba(99,102,241,0.10))] hover:border-[#818CF8]/60"
                    : "border-[#FCD34D]/30 bg-[rgba(252,211,77,0.06)] hover:border-[#FCD34D]/60 animate-[pulseHighlight_2.4s_ease-in-out_infinite]"
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] uppercase tracking-[0.22em] text-[#A5B4FC] mb-1">
                      {isIpProfileReady(ipProfile) ? "企业 IP 基因（已锁定）" : "尚未载入企业 IP 基因"}
                    </div>
                    {isIpProfileReady(ipProfile) ? (
                      <div className="text-[13px] leading-6 text-white truncate">
                        <span className="text-[#A5B4FC]">{ipProfile.industry}</span>
                        <span className="mx-2 text-white/30">·</span>
                        <span className="text-white/85">{ipProfile.advantage}</span>
                        <span className="mx-2 text-white/30">·</span>
                        <span className="text-[#FCD34D]">{ipProfile.flagship}</span>
                      </div>
                    ) : (
                      <div className="text-[13px] leading-6 text-white/85">
                        点此校准护城河 / 高客单锚点 → AI 推演会在 80% 篇幅锁定你的转化路径
                      </div>
                    )}
                  </div>
                  <div className="text-xs font-semibold text-[#A5B4FC] whitespace-nowrap">
                    {isIpProfileReady(ipProfile) ? "编辑 →" : "载入 →"}
                  </div>
                </div>
              </button>
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
                      <div className="text-sm font-semibold text-white">封面英文化</div>
                      <p className="mt-1 text-xs leading-relaxed text-white/55">
                        竖版封面会先完成英文版式适配，再进入高清出图（多数 1～3 分钟内完成）。
                      </p>
                    </div>
                    <div className="rounded-full border border-amber-400/50 bg-[rgba(251,191,36,0.12)] px-4 py-2 text-xs font-semibold text-amber-100">
                      封面英文化
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
                  监管提示：文案与深度追问已固定平台文案引擎；封面与 2×4 英文化走封面翻译引擎。
                </div>
              ) : null}

              <div id="platform-persona-focus-fullcase" className="rounded-[26px] border border-[#2a1c55] bg-[rgba(11,7,26,0.94)] p-5">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-white">
                  <Target className="h-4 w-4 text-[#ffdd44]" />
                  人物背景与创作诉求
                  <span className="rounded-full border border-[#fbbf24]/35 bg-[rgba(251,191,36,0.12)] px-2 py-0.5 text-[10px] font-medium text-[#fde68a]">
                    与自定义「选题初选」共用同一栏
                  </span>
                </div>
                <p className="mt-2 text-xs leading-relaxed text-[#b7add8]">
                  与上方自定义创作工作台为同一输入；请写清职业、专长、兴趣与商业目标。系统将据此生成<strong className="text-white">平台优先级与切入方向</strong>，并写入选题文案与分镜脚本（不含封面图、编导分镜图与决策智库报告）。也可
                  <button
                    type="button"
                    className="mx-1 font-semibold text-[#93c5fd] underline underline-offset-2 hover:text-white"
                    onClick={() => scrollToPlatformSection("platform-persona-focus")}
                  >
                    跳到选题初选旁填写
                  </button>
                  。
                </p>
                <div className="relative mt-4">
                  <textarea
                    value={focusPrompt}
                    onChange={(event) => setFocusPrompt(event.target.value)}
                    placeholder="例如：我是哈佛医学博士，擅长心脑血管慢病与中西医养生，热爱爵士乐与旅行。希望打造高价值商业 IP，结合史记/唐诗/医籍与西医观点，规划跨朝代差异化选题、赛道方向、产品矩阵与适合发布的平台。"
                    className="min-h-[136px] w-full rounded-2xl border border-white/10 bg-[#0c061e] px-4 py-3 pr-12 text-sm leading-7 text-white outline-none transition focus:border-[#49e6ff]/35"
                  />
                  <div className="absolute right-3 top-3">
                    <VoiceInputButton
                      onTranscript={(t) => setFocusPrompt((prev) => prev ? prev + " " + t : t)}
                      onDebugLog={addVoiceDebug}
                      size={28}
                    />
                  </div>
                </div>
                <div className="mt-3 rounded-xl border border-[#6366f1]/40 bg-[linear-gradient(135deg,rgba(99,102,241,0.18),rgba(79,70,229,0.08))] px-4 py-3.5 shadow-[0_8px_28px_rgba(99,102,241,0.12)]">
                  <p className="text-base font-black tracking-tight text-[#e9d5ff] sm:text-lg">文本支持语音输入</p>
                  <p className="mt-1.5 text-sm leading-relaxed text-white/65 sm:text-[15px]">
                    点击输入框旁 <span className="font-semibold text-[#c4b5fd]">麦克风</span>
                    ，说话即可写入本框焦点；中文识别。推荐使用{" "}
                    <span className="rounded-md border border-[#818cf8]/50 bg-[rgba(129,140,248,0.2)] px-1.5 py-0.5 font-semibold text-[#c7d2fe]">
                      Chrome、Edge、Safari
                    </span>
                    。
                  </p>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 sm:gap-3">
                  <button
                    type="button"
                    onClick={() => void handleAnalyze()}
                    disabled={growthSnapshotQuery.isFetching}
                    className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(73,230,255,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {growthSnapshotQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    开始全案分析
                  </button>
                  <span
                    className="inline-flex shrink-0 items-center rounded-full border border-[#fbbf24]/45 bg-[rgba(251,191,36,0.12)] px-3 py-2 text-xs font-black tabular-nums tracking-tight text-[#fef08a] shadow-[0_0_20px_rgba(251,191,36,0.12)]"
                    title="含平台优先级、切入方向、选题文案与分镜脚本；任务入队时扣除右侧积分（不含封面图、编导分镜图与决策智库报告）"
                  >
                    {CREDIT_COSTS.platformStage2Copywriting} 积分
                  </span>
                  {hasAnalyzed ? (
                    <div className="rounded-full border border-[#2f2260] bg-[#130b31] px-4 py-2 text-xs text-[#8cefff]">
                      当前窗口：近 {selectedWindowDays} 天
                    </div>
                  ) : null}
                  {hasAnalyzed && !isDashboardLoading && !isContentLoading && (
                    <button
                      type="button"
                      onClick={() => void handleDownloadPlatformPdf()}
                      disabled={isDownloadingPdf}
                      className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/30 bg-[rgba(73,230,255,0.08)] px-4 py-2 text-xs font-semibold text-[#49e6ff] transition hover:bg-[rgba(73,230,255,0.15)] disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {isDownloadingPdf ? <><Loader2 className="h-3 w-3 animate-spin" />生成中...</> : <><FileText className="h-3 w-3" />下载 PDF</>}
                    </button>
                  )}
                </div>
                <p className="mt-2 max-w-xl text-[11px] leading-5 text-white/38">
                  点击后会基于你的背景生成<strong className="text-white/80">平台优先级、切入方向、选题文案与分镜脚本</strong>；扣款在<strong className="text-[#fef08a]">后台任务入队时</strong>。封面图、编导分镜图与决策智库报告需<strong className="text-white/70">另行加购</strong>。
                  {hasAnalyzed ? (
                    <>
                      {" "}
                      <a
                        href="#platform-stage2-copy"
                        className="font-semibold text-[#93c5fd] underline underline-offset-2 hover:text-white"
                      >
                        跳至生成区
                      </a>
                    </>
                  ) : null}
                </p>
              </div>
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

        {snapshot && platformDashboard ? (
          <section id="platform-report" className="mt-8 space-y-6">
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
                        {CREDIT_COSTS.platformTrend} 积分/次
                      </span>
                    </div>
                    <p className="mt-1 text-xs leading-snug text-[#c4b8e8]">
                      四格战略摘要、Stage 1 看板与可下载 PNG 图文报表（不含专属文案 / 决策智库）
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
              className="scroll-mt-24 rounded-2xl border-2 border-[#f59e0b]/55 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(120,50,20,0.12))] px-4 py-4 shadow-[0_0_32px_rgba(245,158,11,0.12)] md:px-5"
              role="region"
              aria-label="全案分析扣费说明"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex shrink-0 items-center gap-2 text-[#ffedd5]">
                  <CircleDollarSign className="h-6 w-6 shrink-0 text-[#fbbf24]" aria-hidden />
                  <span className="text-base font-black tracking-tight text-white sm:text-lg">全案分析 · 扣费说明</span>
                </div>
                <div className="min-w-0 flex-1 text-sm leading-7 text-[#ffe4c4]">
                  「开始全案分析」会基于你填写的人物背景与 IP 基因，结合近 {selectedWindowDays} 天窗口样本，写入<strong className="text-white">平台优先级、切入方向、选题文案与分镜脚本</strong>。任务<strong className="text-white">入队时</strong>扣除{" "}
                  <strong className="text-[#fef08a]">{CREDIT_COSTS.platformStage2Copywriting} 积分</strong>。
                  <strong className="text-white">不含</strong>封面图、编导分镜图与 MV Studio Pro AI 决策智库报告（均需另购）。
                  任务失败、逾时或结果不满意，<strong className="text-red-200">积分不予退还</strong>。若之后点「重新生成」，<strong className="text-[#fef08a]">再扣 {CREDIT_COSTS.platformStage2Copywriting} 积分</strong>。
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
                      <strong className="text-white">单独加购模块</strong>：需先完成全案分析（填写人物背景并生成看板与文案），再付费解锁本报告。
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
                        请先填写人物背景并完成「开始全案分析」，生成看板与文案后，可在此单独加购决策智库报告。
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
                          : "上为匿名化演示样张（英文与品牌区已打码）。完成全案分析后可单独加购，获取基于你背景与数据的完整报告。"
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
                              请先完成<strong className="text-[#fde047]">全案分析</strong>（填写背景并生成看板与文案）；本报告与全案积分分开计费，价格见上方。
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
                                try {
                                  await navigator.clipboard.writeText(snap.lines.join("\n"));
                                  toast.success("已复制本段日志（含 TRPC 详情）");
                                } catch {
                                  toast.error("复制失败，请手动选中下方文本");
                                }
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
                  <div className="space-y-4">
                    {platformMainPersonaTopicsPanel}
                    {platformSkillsAccessoryPanel}
                  </div>
                  {platformTopicCount > 0 ? (
                    <div className="rounded-xl border border-[#c4b5fd]/35 bg-[#6a5cff]/10 px-4 py-3">
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
                          <div className="text-sm font-semibold text-white">全局主人公照片（推荐先上传）</div>
                          <p className="mt-0.5 text-[11px] leading-snug text-gray-400">
                            套用全部选题的封面、编导分镜表与图文笔记解说人物：<strong className="text-white/80">锁脸</strong>
                            ，衣着可随场景微调。单卡可另传照片覆盖。
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
                  ) : null}
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
                        "英文化与出图 · 合计常需 3～5 分钟，请勿中途刷新";
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
                                const supervisorTok = getSupervisorTrpcToken();
                                const coverPersona = buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim();
                            const compositeSupervisorExtras = {
                              ...(canConfigureCompositeImageTranslator && readTopicCoverDeepResearchProFromLs()
                                ? { enableTopicCoverDeepResearchPro: true as const }
                                : {}),
                              ...(supervisorTok ? { supervisorToken: supervisorTok } : {}),
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
                      没有生成相关变现路径
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
                      完成全案分析后显示平台优先级图
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
