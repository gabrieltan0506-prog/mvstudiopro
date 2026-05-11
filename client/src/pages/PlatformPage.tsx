import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toPng } from "html-to-image";
import { AnimatePresence, motion } from "framer-motion";
import ReportGeneratorPanel from "@/components/ReportGeneratorPanel";
import { PlatformReportDashboard } from "@/components/PlatformReportDashboard";
import { DecisionIntelLockedDemoPreview } from "@/components/DecisionIntelLockedDemoPreview";
import { ImageUpscaleBar } from "@/components/ImageUpscaleBar";
import IpProfileModal, { readIpProfile, isIpProfileReady, type IpProfile } from "@/components/IpProfileModal";
import { useAuth } from "@/_core/hooks/useAuth";
import TrialWatermarkImage from "@/components/TrialWatermarkImage";
import { useIsTrialUser } from "@/_core/hooks/useIsTrialUser";
import { getLoginUrl } from "@/const";
import { appendPollDebugLine, createJob, getJob, pollJobUntilTerminal } from "@/lib/jobs";
import { trpc } from "@/lib/trpc";
import type {
  GrowthAnalysisScores,
  GrowthMonetizationStrategy,
  GrowthPlatformActivity,
  GrowthPlatformRecommendation,
  GrowthSnapshot,
  GrowthTitleExecution,
} from "@shared/growth";
import { CREDIT_COSTS } from "@shared/plans";
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
  pickPrimaryDecisionIntelPlatformHint,
} from "@shared/decisionIntelligencePlatformHint";
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
  Map,
  MessageSquareText,
  Mic,
  Palette,
  PenLine,
  PlayCircle,
  Rocket,
  RefreshCw,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  Stethoscope,
  Target,
  TrendingUp,
  Trophy,
  Users,
  Video,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import VoiceInputButton from "@/components/VoiceInputButton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";

type PlatformImagePromptTranslator = "gpt54" | "vertex_gemini_3_flash_preview";

const PLATFORM_IMAGE_PROMPT_TRANSLATOR_LS_KEY = "mvstudiopro.platform.imagePromptTranslator.v1";
/** 管理員／監管：單幀封面主生圖是否走 Nano Banana Pro（Vertex global） */
const PLATFORM_COVER_NB_PRO_LS_KEY = "mvstudiopro.platform.coverNanoBananaPro.v1";
/** ↑ 管理員／監管帳號可見的 2×4 英文化開關偏好；一般帳號合成固定走 gpt54（後端同判）。 */

/** 與 MyReports `myreports-pdf-root` 對齊：只克隆報告主體，避免整頁 document 帶入 #root / portal */
const PLATFORM_PDF_SNAPSHOT_ROOT_ID = "platform-report";
/** 英雄區「付费能力」锚点：接線至下方對應區塊 */
const PLATFORM_SECTION_DECISION_INTEL_ID = "platform-decision-intel";
const PLATFORM_SECTION_DEEP_QA_ID = "platform-deep-qa";
const PLATFORM_SECTION_TREND_RUN_ID = "platform-trend-run";
const PLATFORM_SECTION_TREND_SIGNALS_ID = "platform-trend-signals";

/** 快照克隆前：單張圖 load/error 逾時（選題多時並行等待，總耗時≈最慢一張） */
const PLATFORM_PDF_PER_IMAGE_WAIT_MS = 12_000;

/**
 * 克隆 #platform-report 前，確保區域內 img 已載入（含 lazy→eager、decode），避免 PDF 空白圖塊。
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
      /* 仍可有已解碼柵格供 clone 使用 */
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
    /* pdf-worker 仍會再擋 decode；此處不擋快照 */
  }
}

/** 選題封面 URL 若為占位、逾時或失敗標記則視為未就緒（與卡片区 isBlackImageOrTimeout 對齊）。 */
function platformCoverImageUrlLooksInvalid(url: unknown): boolean {
  const raw = typeof url === "string" ? url.trim().toLowerCase() : "";
  return !raw || raw.includes("timeout") || raw.includes("error");
}

const WINDOW_OPTIONS = [
  { days: 15 as const, label: "15天", description: "看短期波动、热点与即时机会" },
  { days: 30 as const, label: "30天", description: "看平台主流结构与相对稳定方向" },
  { days: 45 as const, label: "45天", description: "看更长窗口的沉淀与长期可做性" },
] as const;

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
  /** 後端 Zod 課程與 LLM 輸出；含 referenceAccounts、trafficBoosters；允許 label/lane/nextMove 等舊欄位 */
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
};

type ProcessingStepCard = {
  id: string;
  label: string;
  detail: string;
  status: "done" | "active" | "pending";
};

/** Debug：單次 Fly job 在前端的入隊與輪詢步驟 */
type ClientJobPollTrace = {
  jobId: string;
  label: string;
  lines: string[];
  pollCount: number;
  terminalStatus?: string;
};

/** Stage 2 失敗或空載荷時，從 `debug.buildPlatformContent` 摘錄高信號欄位寫入輪詢區（避免只看 toast）。 */
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
    return <span key={i}>{part}</span>;
  });
}

// Smart icon picker — matches persona keywords or signal content to an appropriate Lucide icon
// Returns a JSX element (LucideIcon rendered at given size/color)
function getSmartIcon(text: string, className = "h-4 w-4 text-[#8cefff]"): React.ReactElement {
  const t = String(text || "").toLowerCase();
  if (/医生|医师|心脏|临床|心血管|stethoscope|doctor|cardio/.test(t)) return <Stethoscope className={className} />;
  if (/心电图|ekg|ecg|脉搏|动脉|血管/.test(t)) return <Activity className={className} />;
  if (/文化|艺术|书画|人文|古代|历史|文物|古建|收藏/.test(t)) return <Landmark className={className} />;
  if (/美学|审美|palette|设计|色彩|风格/.test(t)) return <Palette className={className} />;
  if (/视频|短视频|短片|拍摄|分镜|film|video/.test(t)) return <Video className={className} />;
  if (/图文|图片|封面|排版|image|photo|graphic/.test(t)) return <Image className={className} />;
  if (/播客|直播|podcast|音频|声音|mic/.test(t)) return <Mic className={className} />;
  if (/变现|收入|付费|课程|knowledge|monetize|商业化/.test(t)) return <DollarSign className={className} />;
  if (/品牌|合作|赞助|brand|sponsor/.test(t)) return <Briefcase className={className} />;
  if (/赛道|方向|策略|lane|track|strategy/.test(t)) return <Target className={className} />;
  if (/热点|趋势|话题|trending|booster/.test(t)) return <Flame className={className} />;
  if (/平台|platform|分发/.test(t)) return <Globe className={className} />;
  if (/文案|copy|写作|script|脚本|内容/.test(t)) return <PenLine className={className} />;
  if (/书|阅读|knowledge|知识/.test(t)) return <BookOpen className={className} />;
  if (/奖|top|第一|冠军|award|trophy/.test(t)) return <Trophy className={className} />;
  if (/步骤|行动|action|execute|step/.test(t)) return <Zap className={className} />;
  if (/粉丝|用户|audience|followers/.test(t)) return <Users className={className} />;
  if (/分享|share|传播/.test(t)) return <Share2 className={className} />;
  if (/数据|analytics|stat|metric/.test(t)) return <BarChart3 className={className} />;
  if (/layer|level|层|structure|结构/.test(t)) return <Layers className={className} />;
  if (/情感|情绪|emotion|心理/.test(t)) return <Heart className={className} />;
  if (/article|文章|报告|文档/.test(t)) return <FileText className={className} />;
  // Rotating fallback based on hash of text (ensures different cards get different icons)
  const fallbacks = [<Sparkles className={className} />, <Star className={className} />, <Award className={className} />, <PlayCircle className={className} />, <ArrowRight className={className} />];
  let hash = 0;
  for (let i = 0; i < t.length; i++) hash = (hash * 31 + t.charCodeAt(i)) & 0xffff;
  return fallbacks[hash % fallbacks.length];
}

// Universal safe-text extractor — handles string | object | null from LLM outputs
// Prevents [object Object] from rendering in JSX by extracting the most likely text field
function renderSafeText(item: any, fallback = ""): string {
  if (!item && item !== 0) return fallback;
  if (typeof item === "string") return item;
  if (typeof item === "number") return String(item);
  if (typeof item === "object") {
    return String(
      item.title || item.text || item.content || item.name || item.desc ||
      item.laneName || item.label || item.value || item.detail ||
      Object.values(item).find((v) => typeof v === "string") ||
      JSON.stringify(item)
    );
  }
  return String(item);
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

function buildPlatformProcessingSteps(selectedWindowDays: 15 | 30 | 45, elapsedTime: number, focusPrompt: string): ProcessingStepCard[] {
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

function getWindowLabel(value: 15 | 30 | 45) {
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

function cleanUserCopy(value: string, fallback = "") {
  const normalized = String(value || "").trim();
  if (!normalized) return fallback;

  const softened = normalized
    .replace(/\bfallback\b/gi, "当前参考")
    .replace(/\blive sample(?:-\d+d)?\b/gi, "近期样本")
    .replace(/\bhistorical\b/gi, "中期沉淀")
    .replace(/\bverify\b/gi, "先验证")
    .replace(/\bcollector\b/gi, "")
    .replace(/\bcurrentTotal\b/gi, "")
    .replace(/\barchivedTotal\b/gi, "");

  if (/(后台|工程|数据库|主链|样本裂缝|日期覆盖|补位|live sample|historical|fallback|collector|coverage)/i.test(softened)) {
    return fallback;
  }

  return softened.trim() || fallback;
}

/** menu 項常見欄位順序（先找中文標籤；若無漢字再整段掃一次取英文 slug 等）。 */
function stringContainsHan(text: string): boolean {
  /** 日用汉字區間檢測；不依賴需 ES2018+ 的 Unicode 屬性轉義。 */
  return /[\u4e00-\u9fff]/.test(text);
}

/** LLM／示例 JSON 常用的假渠道占位（會被過濾，改走快照 hinted 名或可讀英文字段）。 */
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

/** 解析不出具體渠道名時的順位備援（不使用「平台 1、2」式占位）。 */
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
 * platformMenu：優先後端約定的 platform / displayName，再掃 passthrough 欄位。
 * `snapshotHint` 為快照里對應順位的真實平台名／展示名（補模型漏欄時用）。
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
    /** 順序對齊 growthPlatformMenuItemSchema + Prompt 明示的 platform / displayName。 */
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

/** 将 IP 基因库 + 仪表盘「内容身份」注入封面生图链，供 GPT 5.4 锁定人設（此前仅传选题文案时模型无法看到身份设定） */
function buildCoverPersonaContextForImageGen(personaSummary: string, ipProfile: IpProfile): string {
  const parts: string[] = [];
  const ps = String(personaSummary || "").trim();
  if (ps) parts.push(`【内容身份】${ps.slice(0, 600)}`);
  if (isIpProfileReady(ipProfile)) {
    parts.push(
      `【IP 基因】行业身份：${ipProfile.industry.trim()}；核心优势：${ipProfile.advantage.trim()}；目标受众：${ipProfile.audience.trim()}；旗舰交付：${ipProfile.flagship.trim()}${ipProfile.taboos.trim() ? `；品牌禁忌：${ipProfile.taboos.trim()}` : ""}`,
    );
  }
  return parts.join("\n").trim().slice(0, 3800);
}

/** 供分鏡表 / 小紅書 2×4 八格圖文單圖：彙整摺疊區內容，供 gpt-image-2 拆鏡（後端再截斷） */
function buildPlatformSheetScriptContext(item: {
  title: string;
  hook: string;
  copywriting: string;
  production?: string;
  detailedScript?: string;
  publishingAdvice?: string;
  actionableSteps?: string[];
  executionDetails?: {
    environmentAndWardrobe?: string;
    lightingAndCamera?: string;
    stepByStepScript?: string[];
  };
}): string {
  const parts: string[] = [];
  parts.push(`【选题】${item.title}`);
  if (item.hook) parts.push(`【钩子】${item.hook}`);
  if (item.copywriting) parts.push(`【文案与结构】${item.copywriting}`);
  if (item.production) parts.push(`【制作】${item.production}`);
  const ex = item.executionDetails;
  if (ex?.environmentAndWardrobe) parts.push(`【环境与服装】${ex.environmentAndWardrobe}`);
  if (ex?.lightingAndCamera) parts.push(`【灯光机位】${ex.lightingAndCamera}`);
  if (Array.isArray(ex?.stepByStepScript) && ex.stepByStepScript.length) {
    parts.push(`【分镜步骤】\n${ex.stepByStepScript.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }
  if (item.actionableSteps?.length) {
    parts.push(`【落地步骤】\n${item.actionableSteps.map((s, i) => `${i + 1}. ${s}`).join("\n")}`);
  }
  if (item.detailedScript) parts.push(`【详细脚本】${item.detailedScript}`);
  if (item.publishingAdvice) parts.push(`【发布建议】${item.publishingAdvice}`);
  return parts.join("\n\n").slice(0, 12000);
}

/** 合成生圖：燈光／環境彙總，供後端寫入 [EMOTION & LIGHTING]（Cam5） */
function buildPlatformExecutionDetailsPayload(item: {
  executionDetails?: { lightingAndCamera?: string; environmentAndWardrobe?: string };
}): string {
  const lighting = String(item.executionDetails?.lightingAndCamera || "").trim();
  const env = String(item.executionDetails?.environmentAndWardrobe || "").trim();
  if (!lighting && !env) {
    return "高端医学权威风格，Rembrandt lighting, cinematic softbox, intellectual authority.";
  }
  return `[灯光机位]: ${lighting || "—"} | [环境与服化]: ${env || "—"} | [情绪设定]: 高端医学权威 · Rembrandt · 电影级软光`.slice(
    0,
    4000,
  );
}

/** Cam8：從網址 `?reportId=<user_creations.id>` 綁定戰報，生圖扣點成功後寫入該筆 metadata */
function readOptionalReportBindingCreationId(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const raw = new URLSearchParams(window.location.search).get("reportId");
  if (!raw) return undefined;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function normalizeTitleVariantsFromServer(raw: unknown, fallback: PlatformTitleVariant[]): PlatformTitleVariant[] {
  if (!Array.isArray(raw) || raw.length < 2) return fallback;
  const out: PlatformTitleVariant[] = [];
  for (const row of raw) {
    if (out.length >= 2) break;
    if (!row || typeof row !== "object") continue;
    const id = (row as { id?: unknown }).id;
    const title = String((row as { title?: unknown }).title ?? "").trim();
    if (!title) continue;
    if (id === "a" || id === "b") {
      out.push({ id, title });
    }
  }
  return out.length >= 2 ? out : fallback;
}

/** 與後端單條展示標題對齊（具體規則在 shared / 後台）。 */
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

/** 執行選題卡 DOM id：穩定錨點 `execution-card-…`（畫廊不綁定點擊滾動） */
function executionCardDomId(sceneId: string): string {
  return `execution-card-${encodeURIComponent(sceneId).replace(/%/g, "")}`;
}

/** 生圖請求速率：滾動窗口長度（毫秒），與上游「每分鐘 N 次」配額對齊。 */
const PLATFORM_IMAGE_RATE_WINDOW_MS = 60_000;
/**
 * 上述窗口內最多**發起**幾次生圖（封面單幀 · 2×4 分鏡 · 小紅書 2×4 八格圖文合成等共用同一節流器）。
 * 可用 `VITE_PLATFORM_IMAGE_MAX_STARTS_PER_60S` 覆寫（整數 1～24，預設 6）。
 */
const PLATFORM_IMAGE_MAX_STARTS_PER_60S = Math.min(
  24,
  Math.max(1, Number(import.meta.env.VITE_PLATFORM_IMAGE_MAX_STARTS_PER_60S) || 6),
);

const PLATFORM_REFERENCE_GALLERY_ID = "platform-reference-storyboard-gallery";

/** 寬幅合成：服务端 jobs 表旁路进度，供 GET /api/jobs 轮询 `imageGenFlowLog` */
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
  kind: "batch_topic_frames" | "composite_2x4" | "batch_topic_frames_failed" | "composite_2x4_failed";
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

/** 滾動窗口內只保留「仍在 60s 內」的發起時間戳 */
function prunePlatformImageRateWindow(times: number[], now: number, windowMs: number): void {
  while (times.length > 0 && times[0]! <= now - windowMs) {
    times.shift();
  }
}

/** 失敗時寫入 Debug 綠框，便于对照 Network / 服务端日志 */
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
      `${ts}  [等待中] sceneId=${sceneId || "N/A"}（詳見下方服務端 imageGenFlowLog）`,
    ];
  }
  if (kind === "storyboard") {
    return [`${ts}  [客户端] 电影级分镜生成已发起 · sceneId=${sceneId || "N/A"}（詳見下方服務端流水）`];
  }
  return [`${ts}  [客户端] 小红书 2×4 八格图文生成已发起 · sceneId=${sceneId || "N/A"}（詳見下方服務端流水）`];
}

/** 寬幅合成：pending 時由 progressJobId + GET /api/jobs 實時刷新（分鏡 / 小紅書同一套）。 */
function buildCompositeImageGenPendingLines(input: {
  kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note";
  sceneId: string;
  title: string;
  imagePromptTranslator?: PlatformImagePromptTranslator | "vertex_gemini_31_pro_preview";
  progressJobId?: string;
}): string[] {
  const ts = new Date().toISOString();
  const rawTr = input.imagePromptTranslator ?? "gpt54";
  const tr: PlatformImagePromptTranslator =
    rawTr === "vertex_gemini_31_pro_preview" ? "vertex_gemini_3_flash_preview" : rawTr;
  const trLine =
    tr === "vertex_gemini_3_flash_preview"
      ? "探索：直走 Vertex Flash（application/json），不經 GPT 三輪"
      : "默認 GPT 5.4：英文化最多 3 輪（間隔 3s/6s），無效後 Vertex Flash 兜底";
  const kindLabel =
    input.kind === "xiaohongshu_dual_note"
      ? "小红书 2×4 八格图文笔记（buildXhsNoteGeminiPrompt）"
      : input.kind === "storyboard_sheet_landscape"
        ? "视频向 2×4 分镜主表 · 横版（buildVideoStoryboardGeminiPrompt）"
        : "视频向 2×4 分镜主表 · portrait API kind（buildVideoStoryboardGeminiPrompt）";
  const pid = String(input.progressJobId ?? "").trim();
  return [
    `${ts}  [客户端] 宽幅合成已发起 · ${kindLabel}`,
    `${ts}  [客户端] sceneId=${input.sceneId} · title=${input.title.slice(0, 72)}`,
    `${ts}  [客户端] 翻译引擎：${trLine}`,
    ...(pid.length >= 8
      ? [
          `${ts}  [实时进度] progressJobId=${pid} · 约每 0.85s GET /api/jobs/${pid} · 下方【当前步骤】= 服务端流水最后一行`,
          `${ts}  [提示] 卡在 [GPT-IMAGE-2] 不动：单次尺寸可能接近 300s；失败会换尺寸重试（你看到的「多次 API」多为超时/账单上限/换尺寸，非客户端重复发起合成）`,
        ]
      : [
          `${ts}  [提示] 未带 progressJobId，无法轮询实时步骤；仅能在请求结束后看完整日志`,
        ]),
    `${ts}  [说明] 排查标签：[骨架·中文视觉]、[GPT54·英文化]、[Vertex·Flash]、[2×4·步骤…]、[GPT-IMAGE-2]、[2×4·整链]；整链失败最多 5 次完整重试`,
  ];
}

/**
 * 從輪詢或響應合併後的 snapshot 文案推測進度標籤，減少用戶以為「卡住」。
 * （僅為 UX 輔助；細節仍以下方 Debug imageGenFlowLog 為準）
 */
function deriveCompositeUxPhaseHint(snapshotLines: readonly string[]): string {
  const tail = snapshotLines.length ? snapshotLines.slice(-48).join("\n") : "";
  if (/整链(?:重试|[\s\S]*?\d+\/\d+\s*次失败)/i.test(tail) || /\b第\s*\d+\/\d+\s*次失败/.test(tail)) {
    return "整链重试：重新英文化 + 生图，可能仍需数分钟…";
  }
  if (/Nano Banana|\[2×4·步骤3\] Vertex/.test(tail)) {
    return "兜底绘图：Vertex 图像引擎…";
  }
  if (/\[GPT-IMAGE-2\]|GPT-IMAGE-2/.test(tail)) {
    return "绘制中 · GPT-IMAGE-2（单尺寸偶需 3～5 分钟仍属正常）";
  }
  if (/\[2×4·步骤2|\[步骤2\]/.test(tail)) {
    return "准备生图（像素锁已定）…";
  }
  if (/步骤1b|PROMPT_CONDENSE|\[Prompt 提炼\]/.test(tail)) {
    return "精炼英文 prompt …";
  }
  if (/GPT54·英文化|骨架·中文视觉|extractChineseVisualBrief|\[GPT54·翻译\]/.test(tail)) {
    return "英文 prompt · GPT 5.4／骨架抽取（多数 1～3 分钟内）…";
  }
  return "英文化与绘图合计大约 3～5 分钟，请勿中途刷新 ";
}

/** Stage 2 等長任務：用 shimmer / 光斑 / 節拍點轉移注意力（不向用戶展示技術細節） */
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

/** 封面生成等待期間：輪播前四條選題文案摘要；每條約 60s；顯示持續至當前列表內每條選題均有有效封面 URL（不依賴任務旗標提前收起）。 */
const COVER_GEN_WAIT_CAROUSEL_MS = 60_000;

type CoverGenWaitCarouselItem = { id: string; title: string; excerpt: string };

function CoverGenerationWaitCarousel({
  items,
  itemsKey,
}: {
  items: CoverGenWaitCarouselItem[];
  itemsKey: string;
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
        <span className="text-[11px] font-semibold tracking-wide text-[#ff9fe0]/90">封面绘制中</span>
        <span className="text-[11px] text-white/48">
          合计常需约 3～5 分钟 · 每条预览约 1 分钟 · 全部选题均有有效封面后自动收起
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

type PlatformSignalsCarouselTone = "platform" | "topic" | "action";

type PlatformSignalsCarouselItem = {
  title: string;
  summary: string;
  detail: string;
  tone: PlatformSignalsCarouselTone;
  /** 平台卡：引導購買趨勢分析額度 / 積分加值包 */
  purchaseCta?: { href: string; label: string };
};

function toneGlowFrom(tone: PlatformSignalsCarouselTone): string {
  switch (tone) {
    case "platform":
      return "from-[#49e6ff]/50 via-[#7d73ff]/35 to-transparent";
    case "topic":
      return "from-[#ff4fb8]/50 via-[#ff7fd5]/38 to-transparent";
    default:
      return "from-[#ffdd44]/52 via-[#ffb020]/40 to-transparent";
  }
}

/** 分析報告輪播大卡：與「分析中」「分鏡／封面區」共用。 */
function PlatformSignalsCarouselPanel(props: {
  items: PlatformSignalsCarouselItem[];
  activeIndex: number;
  onPickIndex: (i: number) => void;
  subtitle: string;
  eyebrow?: string;
}) {
  const { items, activeIndex, onPickIndex, subtitle, eyebrow = "战略信号 · 自动轮播" } = props;
  if (!items.length) return null;
  const safeIdx = activeIndex % items.length;
  const active = items[safeIdx] ?? items[0];
  const toneCn =
    active.tone === "platform" ? "平台信号" : active.tone === "topic" ? "热点切口" : "动作建议";

  return (
    <div
      className={`${shellCardClasses("relative overflow-hidden p-6 md:p-8")}`}
      role="region"
      aria-roledescription="carousel"
      aria-label="平台与热点信号轮播"
    >
      <div className={`pointer-events-none absolute inset-x-0 top-0 h-[4px] bg-gradient-to-r ${toneGlowFrom(active.tone)}`} />
      <div className="pointer-events-none absolute -right-20 -top-24 h-52 w-52 rounded-full bg-[radial-gradient(circle,rgba(73,230,255,0.16),transparent_65%)] motion-safe:opacity-75 motion-safe:animate-[platformCarouselGlow_10s_ease-in-out_infinite]" />

      <div className="relative flex flex-col gap-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Sparkles className="h-5 w-5 shrink-0 text-[#ffdd44] motion-safe:animate-pulse" />
              <span className="text-base font-black tracking-tight text-white md:text-lg">{eyebrow}</span>
              <span className="rounded-full border border-[#49e6ff]/35 bg-[rgba(73,230,255,0.09)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8cefff]">
                LIVE
              </span>
            </div>
            <p className="mt-3 max-w-lg text-sm leading-7 text-[#c8bfe7] md:text-[15px]">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start rounded-2xl border border-white/10 bg-black/35 px-4 py-3 text-[11px] text-[#dfe6ff]">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#49e6ff]/50" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-[#49e6ff]" />
            </span>
            每 <span className="mx-1 font-bold text-[#8cefff]">4.5</span> 秒自动切换 · 亦可点下方卡片预览
          </div>
        </div>

        <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]" aria-hidden>
          <div
            key={`prog-${safeIdx}`}
            className="h-full w-full origin-left scale-x-0 bg-gradient-to-r from-[#49e6ff] via-[#7d73ff] to-[#ff4fb8]"
            style={{
              animation: "platformCarouselProg 4.5s linear forwards",
            }}
          />
        </div>

        <div className="relative min-h-[clamp(220px,32vw,340px)]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={`${toneCn}-${safeIdx}-${active.title}`}
              initial={{ opacity: 0, y: 16, scale: 0.985 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -12, scale: 0.99 }}
              transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
              className="rounded-[28px] border border-white/14 bg-[linear-gradient(135deg,rgba(73,230,255,0.11),rgba(125,115,255,0.07),rgba(255,117,189,0.09))] p-6 md:p-8 shadow-[0_28px_80px_rgba(0,0,0,0.35)] backdrop-blur-sm"
            >
              <div
                className={`text-[12px] font-bold uppercase tracking-[0.26em] ${
                  toneCn === "平台信号" ? "text-[#8cefff]" : toneCn === "热点切口" ? "text-[#ff98d9]" : "text-[#ffe77a]"
                }`}
              >
                {toneCn}
              </div>
              <div className="mt-5 text-[1.65rem] font-black leading-[1.08] tracking-tight text-white md:text-4xl xl:text-[2.35rem]">
                {active.title}
              </div>
              <div className="mt-5 whitespace-pre-line text-base font-medium leading-relaxed text-[#eef6ff] md:text-lg">
                {active.summary}
              </div>
              <div className="mt-6 rounded-[22px] border border-white/12 bg-[rgba(8,6,22,0.55)] px-5 py-4 text-sm leading-8 text-[#d9d1f5] md:text-[15px]">
                {active.detail}
              </div>
              {active.purchaseCta ? (
                <a
                  href={active.purchaseCta.href}
                  className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[#8cefff] underline-offset-4 hover:text-[#49e6ff] hover:underline"
                >
                  {active.purchaseCta.label}
                  <ChevronRight className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                </a>
              ) : null}
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex gap-2.5 overflow-x-auto pb-1 custom-scrollbar [-webkit-overflow-scrolling:touch]">
          {items.map((item, idx) => {
            const selected = idx === safeIdx;
            return (
              <button
                key={`${item.title}-${idx}-${item.tone}`}
                type="button"
                onClick={() => onPickIndex(idx)}
                title={item.title}
                className={`min-w-[7.25rem] max-w-[min(11rem,calc((100vw-4rem)/2))] shrink-0 rounded-2xl border px-3 py-2.5 text-left transition hover:border-[#49e6ff]/35 hover:bg-[rgba(73,230,255,0.06)] md:min-w-[8.75rem] ${
                  selected
                    ? "border-[#49e6ff]/50 bg-[rgba(73,230,255,0.12)] shadow-[0_0_28px_-8px_rgba(73,230,255,0.55)]"
                    : "border-white/12 bg-black/25"
                }`}
              >
                <div
                  className={`text-[10px] font-semibold uppercase tracking-[0.2em] ${
                    item.tone === "platform"
                      ? "text-[#7ceaff]"
                      : item.tone === "topic"
                        ? "text-[#ff94d9]"
                        : "text-[#ffe07a]"
                  }`}
                >
                  {item.tone === "platform" ? "平台" : item.tone === "topic" ? "热点" : "动作"}
                </div>
                <div className="mt-2 line-clamp-2 text-xs font-semibold leading-5 text-white">{item.title}</div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** 3A：四維度 IP 引導面板（與 buildPlatformContent 硬約束對齊） */
function PlatformIpDimensionGuide() {
  return (
    <div className="mb-6 rounded-2xl border border-white/5 bg-white/[0.02] p-5 backdrop-blur-md">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-[#ff9900]">
        <Bot className="h-4 w-4 shrink-0 animate-pulse" />
        高定内容生成指南：四大维度
      </h3>
      <div className="grid grid-cols-1 gap-4 text-left md:grid-cols-2 lg:grid-cols-4">
        {[
          { t: "专业洞察 (Insight)", d: "展现行业壁垒与权威知识。" },
          { t: "跨界价值 (Value)", d: "融合美学与个人哲学视野。" },
          { t: "受众痛点 (Pain Point)", d: "精准击中粉丝的核心焦虑。" },
          { t: "人设魅力 (Persona)", d: "分享真实经历建立情感信任。" },
        ].map((v, i) => (
          <div key={i} className="rounded-lg bg-white/5 p-3 transition-colors hover:bg-white/10">
            <div className="mb-1 text-[12px] font-bold text-gray-200">{v.t}</div>
            <p className="text-[11px] leading-relaxed text-gray-400">{v.d}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] text-gray-500">提示：在上方 IP 定位中描述得越具体，内容生成越精准。</p>
    </div>
  );
}

export default function PlatformPage() {
  const [supervisorAccess] = useState(() => hasSupervisorAccess());
  const [debugMode, setDebugMode] = useState(false);
  const { isAuthenticated, loading, user } = useAuth({
    autoFetch: true,
    redirectOnUnauthenticated: !supervisorAccess,
    redirectPath: getLoginUrl(),
  });
  const queryClient = useQueryClient();
  const trpcUtils = trpc.useUtils();
  const [selectedWindowDays, setSelectedWindowDays] = useState<15 | 30 | 45>(15);
  const [focusPrompt, setFocusPrompt] = useState("");
  const [voiceDebugLog, setVoiceDebugLog] = useState<string[]>([]);
  const addVoiceDebug = (msg: string) => setVoiceDebugLog((prev) => [...prev.slice(-30), msg]);
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [rotatingCardIndex, setRotatingCardIndex] = useState(0);
  const [platformImagePromptTranslator, setPlatformImagePromptTranslator] = useState<PlatformImagePromptTranslator>(() => {
    if (typeof window === "undefined") return "gpt54";
    try {
      const v = window.localStorage.getItem(PLATFORM_IMAGE_PROMPT_TRANSLATOR_LS_KEY);
      if (v === "vertex_gemini_31_pro_preview") return "vertex_gemini_3_flash_preview";
      if (v === "vertex_gemini_3_flash_preview" || v === "gpt54") return v;
    } catch {
      /* ignore */
    }
    return "gpt54";
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(PLATFORM_IMAGE_PROMPT_TRANSLATOR_LS_KEY, platformImagePromptTranslator);
    } catch {
      /* ignore */
    }
  }, [platformImagePromptTranslator]);

  const [platformCoverNanoBananaPro, setPlatformCoverNanoBananaPro] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return window.localStorage.getItem(PLATFORM_COVER_NB_PRO_LS_KEY) === "1";
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(PLATFORM_COVER_NB_PRO_LS_KEY, platformCoverNanoBananaPro ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, [platformCoverNanoBananaPro]);

  const canConfigureCompositeImageTranslator =
    user?.role === "admin" || user?.role === "supervisor";

  const effectiveCompositeImagePromptTranslator = useMemo((): PlatformImagePromptTranslator => {
    if (
      canConfigureCompositeImageTranslator &&
      platformImagePromptTranslator === "vertex_gemini_3_flash_preview"
    ) {
      return "vertex_gemini_3_flash_preview";
    }
    return "gpt54";
  }, [canConfigureCompositeImageTranslator, platformImagePromptTranslator]);
  // Separate state for dashboard — populated by the second call after snapshot loads
  const [platformDashboard, setPlatformDashboard] = useState<PlatformDashboard | null>(null);
  const [dashboardDebug, setDashboardDebug] = useState<Record<string, unknown> | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  // Call 3 state — content blueprints and monetization
  const [platformContent, setPlatformContent] = useState<{ contentBlueprints: PlatformDashboard["contentBlueprints"]; monetizationLanes: PlatformDashboard["monetizationLanes"] } | null>(null);
  const [contentDebug, setContentDebug] = useState<Record<string, unknown> | null>(null);
  const [isContentLoading, setIsContentLoading] = useState(false);
  /** Stage 2：佇列/worker 狀態文案（不宣稱具體模型已完成，僅描述後台進度） */
  const [contentLoadingText, setContentLoadingText] = useState("等待戰略看板就緒…");
  const [stage2Failed, setStage2Failed] = useState(false);
  /** Stage 2：platform_build_content job + GET /api/jobs 輪詢時的錯誤說明 */
  const [contentJobError, setContentJobError] = useState<string | null>(null);
  /** 供「重新生成文案」：上次入隊的快照（避免虛構成功） */
  const lastStage2InputRef = useRef<{ snapshotSummary: Record<string, unknown>; windowDays: 15 | 30 | 45 } | null>(
    null,
  );
  /** Debug：Stage 2 文案 job 的 jobId、每次 GET、终态 */
  const [contentJobPollTrace, setContentJobPollTrace] = useState<ClientJobPollTrace | null>(null);
  /** Debug：最近一次封面单帧 job 的轮询（新任务会覆盖） */
  const [topicImageJobPollTrace, setTopicImageJobPollTrace] = useState<ClientJobPollTrace | null>(null);
  /** 輪詢時累加已展示的 jobs.output.imageGenFlowLog 條數，避免重複刷同一批 */
  const topicImagePollFlowLogCursorRef = useRef(0);
  /** Stage 2：有 platformContent 物件但選題與變現皆 0 條 — 假成功，須與真完成區分 */
  const stage2EmptyPayload = useMemo(() => {
    if (!platformContent) return false;
    const bp = Array.isArray(platformContent.contentBlueprints) ? platformContent.contentBlueprints.length : 0;
    const ml = Array.isArray(platformContent.monetizationLanes) ? platformContent.monetizationLanes.length : 0;
    return bp === 0 && ml === 0;
  }, [platformContent]);

  /** 與後台實際結果一致：不宣稱具體模型「已完成」，只描述任務狀態 */
  const stage2UserFacingLine = useMemo(() => {
    if (isContentLoading) return contentLoadingText;
    if (stage2Failed || contentJobError) return `無法完成：${contentJobError || "請重試"}`;
    if (stage2EmptyPayload) {
      return "後台已返回，但沒有有效選題（0 條）。請展開 Debug「Stage 2」或點擊重試（將再次扣除積分）。";
    }
    if (platformContent && !stage2EmptyPayload) {
      return "✅ 專屬選題與文案已由後台寫入（可下滑查看卡片）";
    }
    if (platformDashboard && !platformContent) {
      return "戰略看板已就緒。若流程中斷，可點下方手動「生成專屬文案」繼續。";
    }
    return `點擊「开始全案分析」將一次跑完戰略看板與專屬文案（入隊時扣 ${CREDIT_COSTS.platformStage2Copywriting} 積分）。`;
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
  /** 用戶發起封面繪製後置為 true；收起條件為當前視窗內每一條選題均有有效封面 URL（與 Stage1 輪播只看「任務旗標」區分）。 */
  const [coverWaitCarouselEngaged, setCoverWaitCarouselEngaged] = useState(false);
  const [coverLoadRetriedIds, setCoverLoadRetriedIds] = useState<Set<string>>(() => new Set());
  const [compositeLoadRetriedKeys, setCompositeLoadRetriedKeys] = useState<Set<string>>(() => new Set());
  /** 橫版 16:9 執行分鏡表（單張合成）；API kind 仍為 storyboard_sheet_portrait */
  const [platformStoryboardSheetMap, setPlatformStoryboardSheetMap] = useState<Record<string, string>>({});
  /** 小紅書雙筆記卡（單張合成） */
  const [platformXhsNoteMap, setPlatformXhsNoteMap] = useState<Record<string, string>>({});
  const [pendingCompositeSheet, setPendingCompositeSheet] = useState<{
    sceneId: string;
    kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note";
  } | null>(null);
  /** 2×4 寬幅合成：與 TRPC 並行的 GET /api/jobs 輪詢（progressJobId） */
  const compositeSheetLivePollCtxRef = useRef<{
    jobId: string;
    localOpId: string;
    sceneId: string;
    kind: "storyboard_sheet_portrait" | "storyboard_sheet_landscape" | "xiaohongshu_dual_note";
  } | null>(null);
  /** Debug：批量单帧 / 2×4 合成 · 服务端逐步日志（最新在前） */
  const [platformImageGenFlowSnapshots, setPlatformImageGenFlowSnapshots] = useState<PlatformImageGenFlowSnapshot[]>(
    [],
  );
  /** 2×4 / 小红书合成進行中：由 live log 粗略推進度標籤 */
  const compositePendingUxHints = useMemo(() => {
    const map: Record<string, string> = {};
    for (const snap of platformImageGenFlowSnapshots) {
      if (snap.kind !== "composite_2x4") continue;
      if (snap.meta?.pending !== true) continue;
      const sid = String(snap.meta?.sceneId ?? "").trim();
      const apiKind = String(snap.meta?.apiKind ?? "").trim();
      if (!sid || !apiKind) continue;
      map[`${sid}::${apiKind}`] = deriveCompositeUxPhaseHint(snap.lines);
    }
    return map;
  }, [platformImageGenFlowSnapshots]);
  /** 单张封面「重新生成」进行中（显示骨架，避免无反馈） */
  const [regeneratingCoverSceneId, setRegeneratingCoverSceneId] = useState<string | null>(null);
  /** sceneId → user_creations.id（免扣补发、履历；刷新页面会丢失本地条目） */
  const [sceneJobIds, setSceneJobIds] = useState<Record<string, string>>({});
  /** 批量后静默补发进行中：用于单卡呼吸骨架（Set 避免并发重复 id） */
  const [coverSilentRetryIds, setCoverSilentRetryIds] = useState<Set<string>>(() => new Set());
  /** 一键封面：前端异步逐张生成（单张串行） */
  const [batchGeneratingCoverIds, setBatchGeneratingCoverIds] = useState<Set<string>>(() => new Set());
  const [isSequentialCoverBatchGenerating, setIsSequentialCoverBatchGenerating] = useState(false);
  /** 封面生成区旁：决策智库对外试读样张（演示数据 + 脱敏） */
  const [coverDecisionTrialReadOpen, setCoverDecisionTrialReadOpen] = useState(false);
  /** 封面图 onError：已对原始 URL 尝试过一次 cache-bust（避免误用「免扣 failedJobId」清图） */
  const coverImageCacheBustTriedRef = useRef<Set<string>>(new Set());
  /** 每次点击「开始全案分析」确认后递增，随决策智库 mutation 写入 requestHash，避免命中上一轮同参缓存 */
  const platformAnalysisEpochRef = useRef(0);

  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: focusPrompt || undefined,
      modelName: "gemini-3.1-pro-preview",
      requestedPlatforms: ["douyin", "xiaohongshu", "bilibili", "kuaishou"],
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

  /** Fly worker 回傳後解析 platformContent（輪詢與錯誤處理集中一處，供初次與重試共用） */
  const runStage2FromJobId = useCallback(async (jobId: string) => {
    setContentLoadingText("後台正在處理專屬文案…");
    const j = await pollJobUntilTerminal(jobId, {
      intervalMs: 2500,
      maxWaitMs: 25 * 60_000,
      adaptiveBackoffAfterAttempts: 36,
      maxIntervalMs: 8000,
      onPoll: ({ attempt, status }) => {
        const line = `轮询 #${attempt} · status=${status}`;
        setContentJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? { ...prev, pollCount: attempt, lines: appendPollDebugLine(prev.lines, line) }
            : prev,
        );
        if (status === "queued") {
          setContentLoadingText("任務排隊中，請稍候…");
        } else if (status === "running") {
          if (attempt < 12) setContentLoadingText("後台正在生成專屬文案（撰寫與校對中）…");
          else if (attempt < 28) setContentLoadingText("內容較長，後台仍在處理…");
          else setContentLoadingText("已等待較久，後台仍在處理；請勿關閉頁面…");
        }
      },
    });
    const tPollEnd = new Date().toISOString();
    setContentJobPollTrace((prev) =>
      prev && prev.jobId === jobId
        ? {
            ...prev,
            terminalStatus: j.status,
            lines: appendPollDebugLine(
              prev.lines,
              `${tPollEnd} 轮询结束 · status=${j.status}${j.error ? ` · error=${j.error}` : ""}`,
            ),
          }
        : prev,
    );
    if (j.status === "failed") {
      throw new Error(j.error || "專屬文案任務失敗");
    }
    const raw = j.output;
    if (!raw || typeof raw !== "object") {
      throw new Error("任務已完成但無有效輸出，請重試");
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
    const tEnd = new Date().toISOString();
    let term: string;
    if (res.platformContent) {
      term = "succeeded";
    } else if (dbg?.stage2TimedOut) {
      term = "timeout";
    } else if (dbg?.stage2Error) {
      term = "failed";
    } else {
      term = "empty";
    }
    setContentJobPollTrace((prev) =>
      prev && prev.jobId === jobId
        ? {
            ...prev,
            lines: appendPollDebugLine(
              prev.lines,
              `${tEnd} 解析輸出完成 · totalMs=${dbg?.totalMs ?? "?"} · terminal=${term}`,
            ),
          }
        : prev,
    );
    if (dbg?.stage2Error) {
      throw new Error(dbg.stage2Error);
    }
    if (dbg?.stage2TimedOut) {
      throw new Error("專屬文案生成逾時，請稍後再試或縮短背景描述");
    }
    if (res.platformContent) {
      const pc = res.platformContent as { contentBlueprints?: unknown[]; monetizationLanes?: unknown[] };
      const bp = Array.isArray(pc.contentBlueprints) ? pc.contentBlueprints.length : 0;
      const ml = Array.isArray(pc.monetizationLanes) ? pc.monetizationLanes.length : 0;
      if (bp === 0 && ml === 0) {
        const snippet = formatStage2DebugSnippet(res.debug as Record<string, unknown> | undefined);
        setContentJobPollTrace((prev) =>
          prev && prev.jobId === jobId
            ? {
                ...prev,
                lines: appendPollDebugLine(
                  prev.lines,
                  snippet
                    ? `${new Date().toISOString()} Stage 2 任務成功但 0 條選題 · 摘要: ${snippet}`
                    : `${new Date().toISOString()} Stage 2 任務成功但 0 條選題（无 buildPlatformContent 摘要）`,
                ),
              }
            : prev,
        );
        toast.error(
          "專屬文案沒有生成有效選題（0 條）。請展開下方 Debug「Stage 2」查看 buildPlatformContent，或重新分析一次。",
        );
      }
      setPlatformContent(res.platformContent as any);
    } else {
      const snippet = formatStage2DebugSnippet(res.debug as Record<string, unknown> | undefined);
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
      setContentJobError("專屬文案生成失敗：任務完成但未返回有效內容");
      toast.error("專屬文案生成失敗：AI 數據格式異常，請重試");
    }
    setContentDebug((res.debug as Record<string, unknown>) ?? {});
  }, []);

  /** 入隊並輪詢專屬文案（扣費發生在後端 enqueue 時）；供主流程鏈式調用與手動重試 */
  const enqueueAndPollExclusiveContent = useCallback(
    async (
      dash: PlatformDashboard,
      snapshotSummary: Record<string, unknown>,
      windowDays: 15 | 30 | 45,
    ) => {
      setContentJobError(null);
      setIsContentLoading(true);
      setStage2Failed(false);
      setContentLoadingText("正在提交專屬文案後台任務…");
      try {
        const tStart = new Date().toISOString();
        const cost = CREDIT_COSTS.platformStage2Copywriting;
        const { jobId } = await enqueuePlatformContentJobMutation.mutateAsync({
          context: focusPrompt || undefined,
          windowDays,
          platformMenu: dash.platformMenu || [],
          snapshotSummary,
          strategicDashboard: dash as unknown as Record<string, unknown>,
        });
        setContentJobPollTrace({
          jobId,
          label: "Stage 2 · platform_build_content（Fly worker + GET /api/jobs 轮询）",
          lines: appendPollDebugLine(
            [],
            `${tStart} 已入队 enqueuePlatformContentJob → jobId=${jobId} · 扣費 ${cost} 積分（後端入隊時）`,
          ),
          pollCount: 0,
        });
        await runStage2FromJobId(jobId);
      } catch (e) {
        console.warn("[PlatformPage] Stage 2 enqueue/poll error:", e);
        const msg = e instanceof Error ? e.message : String(e);
        setStage2Failed(true);
        setContentJobError(msg);
        toast.error(`文案生成失敗: ${msg}`);
        setContentDebug(null);
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
    [focusPrompt, enqueuePlatformContentJobMutation, runStage2FromJobId],
  );

  /** 用戶確認後入隊 Stage 2（後端立即扣積分）並輪詢直至完成 */
  const startStage2ContentGeneration = useCallback(async () => {
    if (!platformDashboard || !lastStage2InputRef.current) {
      toast.error("請先完成戰略看板分析");
      return;
    }
    const inp = lastStage2InputRef.current;
    const cost = CREDIT_COSTS.platformStage2Copywriting;
    if (
      !window.confirm(
        `專屬文案與選題將消耗 ${cost} 積分，確認後立即扣費並由後台生成（約數分鐘，請勿關閉頁面）。是否繼續？`,
      )
    ) {
      return;
    }
    await enqueueAndPollExclusiveContent(platformDashboard, inp.snapshotSummary, inp.windowDays);
  }, [platformDashboard, enqueueAndPollExclusiveContent]);

  const retryStage2Content = useCallback(async () => {
    await startStage2ContentGeneration();
  }, [startStage2ContentGeneration]);

  // Stage 1 Mutation: 戰略看板（除 handleAnalyze 外通常不單獨觸發；onSuccess 僅同步 debug）
  const getPlatformDashboardMutation = trpc.mvAnalysis.getPlatformDashboard.useMutation({
    onSuccess: (result) => {
      setDashboardDebug(result.debug as Record<string, unknown>);
    },
    onError: (error) => {
      console.warn("[PlatformPage] dashboard mutation error:", error.message);
    },
  });

  const askPlatformFollowUpMutation = trpc.mvAnalysis.askPlatformFollowUp.useMutation({
    onSuccess: (result) => {
      setAskResult(result.result);
    },
    onError: (error) => {
      toast.error(error.message || "平台追问失败");
    },
  });

  const enqueueGenerateTopicImageMutation = trpc.mvAnalysis.enqueueGenerateTopicImage.useMutation();

  const runEnqueueTopicImageAndPoll = useCallback(
    async (inp: {
      topicHook: string;
      format: "短视频" | "图文";
      context?: string;
      coverPersonaContext?: string;
      failedJobId?: string;
      sceneId?: string;
      /** Debug 面板区分来源：批量兜底 / 逐张 / 手动 / 静默 */
      pollDebugLabel?: string;
      /** 管理員專用：Nano Banana Pro 主生圖 */
      coverProEngine?: "nano_banana_pro";
    }) => {
      const pollLabel =
        inp.pollDebugLabel ?? (inp.sceneId ? `封面 · ${inp.sceneId}` : "封面 · platform_topic_image");
      const { jobId } = await enqueueGenerateTopicImageMutation.mutateAsync({
        ...inp,
        /** 封面 topic 管線；與下方 2×4 合成英文化開關無關。 */
        imagePromptTranslator: "gpt54",
        coverProEngine:
          canConfigureCompositeImageTranslator && platformCoverNanoBananaPro ? "nano_banana_pro" : undefined,
      });
      const tEnq = new Date().toISOString();
      setTopicImageJobPollTrace({
        jobId,
        label: pollLabel,
        lines: appendPollDebugLine(
          [],
          `${tEnq} 已入队 enqueueGenerateTopicImage → jobId=${jobId} · ${pollLabel}，GET /api/jobs 每 2500ms`,
        ),
        pollCount: 0,
      });
      topicImagePollFlowLogCursorRef.current = 0;
      let j: Awaited<ReturnType<typeof pollJobUntilTerminal>>;
      try {
        j = await pollJobUntilTerminal(jobId, {
          intervalMs: 2500,
          maxWaitMs: 18 * 60_000,
          onPoll: ({ attempt, status, output }) => {
            const line = `轮询 #${attempt} · status=${status} · ${pollLabel}`;
            const flowRaw = output?.imageGenFlowLog;
            let extraLines: string[] = [];
            if (Array.isArray(flowRaw)) {
              const flow = flowRaw as string[];
              const start = topicImagePollFlowLogCursorRef.current;
              if (flow.length > start) {
                extraLines = flow.slice(start);
                topicImagePollFlowLogCursorRef.current = flow.length;
              }
            }
            setTopicImageJobPollTrace((prev) => {
              if (!prev || prev.jobId !== jobId) return prev;
              let lines = appendPollDebugLine(prev.lines, line);
              for (const sl of extraLines) {
                lines = appendPollDebugLine(lines, sl);
              }
              return { ...prev, pollCount: attempt, lines };
            });
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
      const termLine = `${new Date().toISOString()} 终态 status=${j.status}${j.error ? ` · error=${j.error}` : ""} · ${pollLabel}`;
      setTopicImageJobPollTrace((prev) =>
        prev && prev.jobId === jobId
          ? { ...prev, terminalStatus: j.status, lines: appendPollDebugLine(prev.lines, termLine) }
          : prev,
      );
      if (j.status === "failed") {
        throw new Error(j.error || "生图任务失败");
      }
      const raw = j.output;
      if (!raw || typeof raw !== "object") {
        return {
          success: false as const,
          imageUrl: null as string | null,
          url: null as string | null,
          creationId: undefined as number | undefined,
          imageGenFlowLog: [] as string[],
        };
      }
      const o = raw as Record<string, unknown>;
      const imageUrl = String(o.imageUrl ?? o.url ?? "").trim() || null;
      const creationId = typeof o.creationId === "number" ? o.creationId : undefined;
      const success = Boolean(o.success) && Boolean(imageUrl);
      return {
        success: success as boolean,
        imageUrl,
        url: imageUrl,
        creationId,
        imageGenFlowLog: Array.isArray(o.imageGenFlowLog) ? (o.imageGenFlowLog as string[]) : [],
      };
    },
    [enqueueGenerateTopicImageMutation, canConfigureCompositeImageTranslator, platformCoverNanoBananaPro],
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
            `${new Date().toISOString()}  [预估步骤] 1. 提取中文视觉骨架 → 2. GPT 5.4 翻译英文 prompt（最多 3 轮，失败再走服务端 Vertex 兜底）→ 3. Prompt 提炼 → 4. GPT-IMAGE-2 主路径 → 5. Nano Banana 2 / Vertex 兜底（如需要）`,
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
        const u = String(r.url ?? "").trim().toLowerCase();
        const bad = !r.url || !String(r.url).trim() || u.includes("timeout") || u.includes("error");
        const cid = (r as { creationId?: number }).creationId;
        if (!bad || cid == null) continue;
        const scene = variables.scenes.find((s) => s.id === r.id);
        if (!scene) continue;
        const topicHook = String(scene.title || "").trim().slice(0, 500);
        if (!topicHook) continue;
        const ctxBody = String(scene.text ?? scene.copywriting ?? "").trim().slice(0, 8000);
        try {
          const retried = await runEnqueueTopicImageAndPoll({
            topicHook,
            format: variables.platformType === "video" ? "短视频" : "图文",
            context: ctxBody,
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
    scenes: Array<{ id: string; title: string; text: string }>,
    coverPersonaContext: string,
  ) => {
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
    for (const scene of scenes) {
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
              topicHook: String(scene.title || "").trim().slice(0, 500),
              format: "图文",
              context: String(scene.text || "").trim().slice(0, 8000),
              sceneId: scene.id,
              coverPersonaContext: coverPersonaContext.trim() || undefined,
              pollDebugLabel: `异步逐张批量 · ${scene.id}`,
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

  const generatePlatformCompositeSheetMutation = trpc.mvAnalysis.generatePlatformCompositeSheet.useMutation({
    onMutate: (input) => {
      setPendingCompositeSheet({ sceneId: input.sceneId, kind: input.kind });
      const localOpId = `composite-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const pid = String(input.progressJobId ?? "").trim();
      compositeSheetLivePollCtxRef.current =
        pid.length >= 8
          ? { jobId: pid, localOpId, sceneId: input.sceneId, kind: input.kind }
          : null;
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
        `${ts}  [客户端] 以下为服务端 imageGenFlowLog 全量（${serverLines.length} 行）· ${serverLines.length === 0 ? "⚠ 响应未带日志字段，请查 TRPC 返回体" : "── 开始 ──"}`,
      ];
      const mergedLines = serverLines.length > 0 ? [...headerLines, ...serverLines] : headerLines;

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
            pending: false,
            serverLogLines: serverLines.length,
          },
        }),
      );

      if (!res.imageUrl) return;
      if (variables.kind === "storyboard_sheet_portrait" || variables.kind === "storyboard_sheet_landscape") {
        setPlatformStoryboardSheetMap((p) => ({ ...p, [variables.sceneId]: res.imageUrl! }));
      } else {
        setPlatformXhsNoteMap((p) => ({ ...p, [variables.sceneId]: res.imageUrl! }));
      }
      const label =
        variables.kind === "storyboard_sheet_portrait" || variables.kind === "storyboard_sheet_landscape"
          ? "分镜图文参考"
          : "小红书 2×4 八格图文参考";
      toast.success(`已生成${label}${res.totalCost ? `（${res.totalCost} 点）` : ""}`);
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
      toast.error(`${head}\n\n${preview}`, { duration: 14_000 });
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
    onSettled: () => {
      setPendingCompositeSheet(null);
      compositeSheetLivePollCtxRef.current = null;
    },
  });

  useEffect(() => {
    if (!generatePlatformCompositeSheetMutation.isPending) return;
    const ctx = compositeSheetLivePollCtxRef.current;
    if (!ctx?.jobId) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      try {
        const j = await getJob(ctx.jobId);
        const out = j.output as { imageGenFlowLog?: string[] } | undefined;
        const log = Array.isArray(out?.imageGenFlowLog) ? out.imageGenFlowLog : [];
        const ts = new Date().toISOString();
        const last = log.length > 0 ? String(log[log.length - 1]) : "";
        const lines: string[] = [
          `${ts}  [实时进度] GET /api/jobs/${ctx.jobId} · status=${j.status} · kind=${ctx.kind} · sceneId=${ctx.sceneId}`,
          `${ts}  [当前步骤] ${last || "（尚无流水行；稍等或检查 jobs 是否已写入）"}`,
        ];
        if (log.length > 0) {
          lines.push(`── 服务端 imageGenFlowLog（${log.length} 行）──`, ...log);
        }
        setPlatformImageGenFlowSnapshots((prev) =>
          upsertPlatformImageFlowSnapshot(prev, {
            at: ts,
            kind: "composite_2x4",
            lines,
            meta: {
              localOpId: ctx.localOpId,
              apiKind: ctx.kind,
              sceneId: ctx.sceneId,
              pending: true,
              liveProgressJobId: ctx.jobId,
            },
          }),
        );
      } catch {
        /* 下一拍重试 */
      }
    };
    void tick();
    const id = window.setInterval(tick, 850);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [generatePlatformCompositeSheetMutation.isPending]);

  const createPlatformQAJobMutation = trpc.mvAnalysis.createPlatformQAJob.useMutation();
  const recordSnapshotMutation = trpc.mvAnalysis.recordAnalysisSnapshot.useMutation();

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
        toast.success("平台分析 PDF 已开始下载，快照已保存至「我的作品」");
        // Save snapshot record (GMT+8 title) with summary content
        const gmt8Label = new Date().toLocaleDateString("zh-TW", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" });
        const summaryLines: string[] = [];
        if (platformDashboard?.headline) summaryLines.push(platformDashboard.headline);
        if (platformDashboard?.subheadline) summaryLines.push(platformDashboard.subheadline);
        if (platformDashboard?.hotTopics?.length) {
          summaryLines.push("\n🔥 热门趋势");
          platformDashboard.hotTopics.slice(0, 5).forEach((t: any) => {
            summaryLines.push(`• ${t.title || t.topic || t}`);
          });
        }
        if (platformDashboard?.platformMenu?.length) {
          summaryLines.push("\n📊 平台分析");
          const snapPdf = growthSnapshotQuery.data?.snapshot as GrowthSnapshot | undefined;
          const pdfRec = snapPdf?.platformRecommendations?.slice(0, 4) ?? [];
          const pdfPf = snapPdf?.platformSnapshots?.slice(0, 4) ?? [];
          platformDashboard.platformMenu.slice(0, 4).forEach((p: any, i: number) => {
            const nameHint = String(pdfRec[i]?.name ?? pdfPf[i]?.displayName ?? "").trim();
            summaryLines.push(
              `• ${resolvePlatformMenuDisplayName(p as Record<string, unknown>, i, nameHint || undefined)}`,
            );
          });
        }
        recordSnapshotMutation.mutate({
          analysisType: "platform",
          title: `平台趋势分析 ${gmt8Label}`,
          summary: summaryLines.join("\n").slice(0, 1800),
          analysisDate: new Date().toISOString(),
        });
      } catch { toast.error("PDF 下载时出错，请重试"); }
    },
    onError: (err) => { setIsDownloadingPdf(false); toast.error(err.message || "PDF 导出失败"); },
  });

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
    // 與 MyReports `captureAndUploadSnapshot` 對齊：精準克隆 `#platform-report` + head 副本 +
    // optimizePdfSnapshotHtml / injectPlatformPdfSnapshotSanitizeIntoHead；並保留 details 行內展開以防截斷。
    // 圖片：克隆前 waitForPlatformReportImagesReady（lazy→eager、load/decode），避免 GPT 封面等尚未載入即成空塊。
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

  /** 全案专属文案（Stage 2）成功落地后才允许示意预览与扣点生成；价格查询不受此限。 */
  const decisionIntelInputReady = useMemo(() => {
    if (!snapshot || !platformDashboard) return false;
    if (isContentLoading) return false;
    if (stage2Failed || contentJobError) return false;
    if (!platformContent || stage2EmptyPayload) return false;
    return true;
  }, [
    snapshot,
    platformDashboard,
    isContentLoading,
    stage2Failed,
    contentJobError,
    platformContent,
    stage2EmptyPayload,
  ]);
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
    onSuccess: () => {
      toast.success("战略地图已解锁，报告已为您存档（未查看也会保留）");
      void decisionIntelLatestQuery.refetch();
      void decisionIntelPricingQuery.refetch();
    },
    onError: (e) => toast.error(e.message || "解锁失败"),
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
          title: cleanUserCopy(item.title || item["动作"] || item["标题"] || "", `第 ${index + 1} 步`),
          // Fix #5: pass "" as fallback — never show generic "先做一个可以快速拿到反馈的动作"
          action: cleanUserCopy(item.detail || item.action || item["详情"] || item["建议"] || "", ""),
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
      { label: "交付内容", value: "平台优先级 + 热点赛道 + 商业化建议" },
      { label: "分析方式", value: `${getWindowLabel(selectedWindowDays)} 时间窗口，不做泛建议` },
      { label: "使用场景", value: "适合你决定先做哪个平台、发什么形式、怎么承接时使用" },
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
      
      // Task 1: 彻底物理消灭"电商带货"幽灵 — 严格的 Skeleton 状态，不显示任何兜底文本
      const sig2 = isContentLoading
        ? { isLoadingSkeleton: true, value: "正在推演专属商业变现路径...", detail: "深度定制，请稍候。" }
        : getSignal(2, "先收口一个可承接方向", "把内容先做成有人愿意继续咨询或收藏的版本。");
      
      const sig3 = isContentLoading
        ? { isLoadingSkeleton: true, value: "正在生成首发微小行动指令...", detail: "保姆级拆解，请稍候。" }
        : getSignal(3, "先写出第一条内容", "先做一轮验证，再决定是否放大。");

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

  const contentExecutionCards = useMemo(() => {
    // Prefer Call 3 result, fall back to Call 2
    const blueprintsSource =
      Array.isArray(platformContent?.contentBlueprints) && platformContent!.contentBlueprints.length > 0
        ? platformContent!.contentBlueprints
        : Array.isArray(platformDashboard?.contentBlueprints) && platformDashboard!.contentBlueprints.length > 0
        ? platformDashboard!.contentBlueprints
        : null;
    if (blueprintsSource && blueprintsSource.length > 0) {
      return blueprintsSource.slice(0, 4).map((item: any, index: number) => {
        const format = item.format || item["格式"] || item["内容形式"] || item["形式"] || "";
        const title = item.title || item["标题"] || item["选题标题"] || "";
        const hook = item.hook || item.openingHook || item["开头文案钩子"] || item["hook"] || item["开头钩子"] || "";
        const copywriting = item.copywriting || item.body || item["核心文案方向"] || item["文案"] || item["正文"] || "";
        const productionRaw =
          item.graphicPlan ||
          item.videoPlan ||
          item["图文怎么排版/视频怎么拍"] ||
          item["图文排版"] ||
          item["视频拍摄"] ||
          item["制作建议"] ||
          "";
        // Normalize suitablePlatforms: Gemini sometimes returns a comma-separated string instead of array
        const rawPlatforms = item.suitablePlatforms || item["适合平台"] || item["平台"] || [];
        const suitablePlatforms: string[] = Array.isArray(rawPlatforms)
          ? rawPlatforms.map((r) => renderSafeText(r))
          : typeof rawPlatforms === "string" && rawPlatforms.trim()
          ? rawPlatforms.split(/[,，、/]+/).map((s: string) => s.trim()).filter(Boolean)
          : [];
          
        const actionSteps: string[] = Array.isArray(item.actionableSteps) ? item.actionableSteps.map((a: any) => renderSafeText(a)) : [];

        const execDetails = typeof item.executionDetails === "object" && item.executionDetails !== null ? item.executionDetails : {};
        const envWardrobe = execDetails.environmentAndWardrobe || execDetails["拍摄环境服装"] || execDetails["环境服装"] || "";
        const lightCam = execDetails.lightingAndCamera || execDetails["灯光机位"] || execDetails["灯光镜头"] || "";
        
        let scriptSteps: string[] = [];
        if (Array.isArray(execDetails.stepByStepScript)) {
          scriptSteps = execDetails.stepByStepScript.map((s: any) => renderSafeText(s));
        } else if (typeof execDetails.stepByStepScript === "string" && execDetails.stepByStepScript.trim()) {
          scriptSteps = [execDetails.stepByStepScript];
        } else if (typeof execDetails.stepByStepScript === "object" && execDetails.stepByStepScript !== null) {
          scriptSteps = [renderSafeText(execDetails.stepByStepScript)];
        }

        const titleVariants = resolveExecutionCardTitleVariants(
          item as Record<string, unknown>,
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

        return {
          id: String(item.id || item.sceneId || item.topicId || `topic-${index}`),
          title: baseTitle,
          hook: cleanUserCopy(renderSafeText(hook || item.contentHook, "先用一句明确判断开头。"), "先用一句明确判断开头。"),
          copywriting: cleanUserCopy(renderSafeText(copywriting, "把这条内容写成用户一看就知道你在解决什么问题的版本。"), "把这条内容写成用户一看就知道你在解决什么问题的版本。"),
          production: cleanUserCopy(renderSafeText(productionRaw), ""),
          format: renderSafeText(format),
          suitablePlatforms,
          actionableSteps: actionSteps,
          detailedScript: renderSafeText(item.detailedScript || ""),
          publishingAdvice: renderSafeText(item.publishingAdvice || ""),
          executionDetails: {
            environmentAndWardrobe: renderSafeText(envWardrobe),
            lightingAndCamera: renderSafeText(lightCam),
            stepByStepScript: scriptSteps
          },
          titleVariants,
        };
      });
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
      id: String((item as any).id || (item as any).sceneId || `topic-${index}`),
      title: baseTitle,
      hook: cleanUserCopy(item.howToUse, "先把用户最关心的问题直接说出来。"),
      copywriting: cleanUserCopy(item.whyHot, "围绕这个切口写成用户能立刻代入的内容。"),
      production: "",
      format: recommendedPlatforms[index]?.topicIdeas?.[0] ? "短视频" : "图文",
      titleVariants,
    };
    });
  }, [isContentLoading, isDashboardLoading, platformDashboard, platformContent, recommendedPlatforms, topTopics]);

  const contentExecutionCardsKey = useMemo(
    () => contentExecutionCards.map((c) => c.id).join("|"),
    [contentExecutionCards],
  );

  useEffect(() => {
    const validIds = new Set(contentExecutionCards.map((row) => row.id));
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
  }, [contentExecutionCards, contentExecutionCardsKey]);

  const platformTopicCount = contentExecutionCards.length;
  const platformBulkGraphicCost = useMemo(
    () => platformTopicCount * CREDIT_COSTS.platformTopicFrameGraphic,
    [platformTopicCount],
  );

  const coverGenWaitCarouselItems = useMemo((): CoverGenWaitCarouselItem[] => {
    return contentExecutionCards.slice(0, 4).map((c) => {
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
  }, [contentExecutionCards]);

  const coverGenWaitCarouselItemsKey = useMemo(
    () => coverGenWaitCarouselItems.map((row) => row.id).join("|"),
    [coverGenWaitCarouselItems],
  );

  const anyCoverImagePipelineBusy = useMemo(
    () =>
      regeneratingCoverSceneId !== null ||
      isSequentialCoverBatchGenerating ||
      batchGeneratingCoverIds.size > 0 ||
      coverSilentRetryIds.size > 0,
    [
      regeneratingCoverSceneId,
      isSequentialCoverBatchGenerating,
      batchGeneratingCoverIds,
      coverSilentRetryIds,
    ],
  );

  const allTopicCoverImagesReady = useMemo(() => {
    if (contentExecutionCards.length === 0) return true;
    return contentExecutionCards.every((row) => {
      const u = platformImageMap[row.id];
      return typeof u === "string" && u.trim().length > 0 && !platformCoverImageUrlLooksInvalid(u);
    });
  }, [contentExecutionCards, platformImageMap]);

  useEffect(() => {
    if (anyCoverImagePipelineBusy) setCoverWaitCarouselEngaged(true);
  }, [anyCoverImagePipelineBusy]);

  useEffect(() => {
    if (!coverWaitCarouselEngaged || !allTopicCoverImagesReady) return;
    setCoverWaitCarouselEngaged(false);
  }, [coverWaitCarouselEngaged, allTopicCoverImagesReady]);

  /** 頂部「2×4 / 小紅書合成」畫廊：各選題合成 URL / pending（Grid + ImageUpscaleBar） */
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
    for (const row of contentExecutionCards) {
      const id = row.id;
      const title = row.title;
      const sbUrl = platformStoryboardSheetMap[id];
      if (sbUrl) {
        items.push({
          key: `${id}-sb-sheet`,
          sceneId: id,
          title,
          url: sbUrl,
          kindLabel: "分镜 · 2×4 合成",
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
          kindLabel: "分镜 · 2×4 合成",
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
          kindLabel: "小红书 · 2×4 八格图文",
          layout: "landscape",
          pending: false,
        });
      } else if (pend?.sceneId === id && pend.kind === "xiaohongshu_dual_note") {
        items.push({
          key: `${id}-xhs-sheet-pend`,
          sceneId: id,
          title,
          url: null,
          kindLabel: "小红书 · 2×4 八格图文",
          layout: "landscape",
          pending: true,
        });
      }
    }
    return items;
  }, [
    contentExecutionCards,
    platformStoryboardSheetMap,
    platformXhsNoteMap,
    pendingCompositeSheet,
  ]);

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
    () => cleanUserCopy(platformDashboard?.personaSummary || "", "把专业身份和中国文化审美结合成一个更容易创建信任的IP入口。"),
    [platformDashboard],
  );

  const executionBlueprint = useMemo(
    () => {
      // Prioritize platformContent.contentBlueprints[0] over snapshot assetAdaptation
      const bestBlueprint: any =
        Array.isArray(platformContent?.contentBlueprints) && platformContent!.contentBlueprints.length > 0
          ? platformContent!.contentBlueprints[0]
          : Array.isArray(platformDashboard?.contentBlueprints) && platformDashboard!.contentBlueprints.length > 0
          ? platformDashboard!.contentBlueprints[0]
          : null;

      if (bestBlueprint) {
        return [
          {
            label: "内容开头",
            // Fix #4: prefer hook field; never use generic fallback
            detail: cleanUserCopy(bestBlueprint.hook || bestBlueprint.openingHook || bestBlueprint["开头文案钩子"] || bestBlueprint["hook"] || bestBlueprint["开头钩子"] || contentExecutionCards[0]?.hook || "", ""),
          },
          {
            label: "内容结构",
            detail: cleanUserCopy(bestBlueprint.copywriting || bestBlueprint.body || bestBlueprint["核心文案方向"] || bestBlueprint["文案"] || bestBlueprint["正文"] || contentExecutionCards[0]?.copywriting || "", ""),
          },
          {
            label: "行动引导",
            // Fix #4: pull from actionableSteps first, then production/graphicPlan — never generic template
            detail: cleanUserCopy(
              (Array.isArray(bestBlueprint.actionableSteps) && bestBlueprint.actionableSteps.length > 0
                ? bestBlueprint.actionableSteps.join(" → ")
                : "") ||
              bestBlueprint.graphicPlan || bestBlueprint.videoPlan || bestBlueprint["图文怎么排版/视频怎么拍"] || bestBlueprint["图文排版"] || bestBlueprint["视频拍摄"] || bestBlueprint["制作建议"] || contentExecutionCards[0]?.production || "",
              ""
            ),
          },
        ].filter((item) => item.detail);
      }

      return [
        {
          label: "内容开头",
          detail: isContentLoading ? "正在重构开场三秒钩子..." : "",
        },
        {
          label: "内容结构",
          detail: isContentLoading ? "正在搭建高留存内容骨架..." : "",
        },
        {
          label: "行动引导",
          detail: isContentLoading ? "正在规划商业承接卡点..." : "",
        },
      ].filter((item) => item.detail);
    },
    [isContentLoading, assetAdaptation, contentExecutionCards, topMonetization, platformContent, platformDashboard],
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
  const immersiveRotatingCards = useMemo(() => {
    const trendLayers = snapshot?.trendLayers ?? [];
    const competitionZh = (level: string) =>
      level === "low" ? "低" : level === "medium" ? "中" : level === "high" ? "高" : String(level);

    const platformCards = primaryPlatforms.slice(0, 4).map((item) => {
      const topicLines = (item.sampleTopics || []).map((t) => String(t).trim()).filter(Boolean);
      const layerLines = trendLayers
        .filter((l) => l.platform === item.platform)
        .flatMap((l) => (Array.isArray(l.items) ? l.items : []).map((i) => String(i).trim()))
        .filter(Boolean);
      const libraryLines = (snapshot?.topicLibrary ?? [])
        .filter((row) => row.platform === item.platform)
        .map((row) => String(row.title || "").trim())
        .filter(Boolean);
      const activityLines = (snapshot?.platformActivities ?? [])
        .filter((a) => a.platform === item.platform)
        .flatMap((a) =>
          [...(a.hotTopics ?? []), ...(a.suggestedTopics ?? [])].map((s) => String(s).trim()).filter(Boolean),
        );
      const merged = Array.from(new Set([...topicLines, ...libraryLines, ...activityLines, ...layerLines])).slice(0, 5);
      const summary =
        merged.length > 0
          ? merged.map((line, i) => `${i + 1}. ${line}`).join("\n")
          : "本平台在当前快照里还没有可用的样本标题或趋势层条目。请先完成一次上方「平台趋势分析」（会按次扣减积分），采集回传后再查看具体热点。";

      return {
        title: `${item.displayName} 当前信号`,
        summary,
        detail: `动量 ${item.momentumScore} · 适配 ${item.audienceFitScore} · 竞争 ${competitionZh(item.competitionLevel)}`,
        tone: "platform" as const,
        purchaseCta: {
          href: "/pricing",
          label: "购买积分 · 用于平台趋势分析与续报",
        },
      };
    });
    const topicCards = topTopics.slice(0, 3).map((item) => ({
      title: item.title,
      summary: item.whyHot,
      detail: item.howToUse,
      tone: "topic",
    }));
    const actionCards = actionSteps.slice(0, 3).map((item) => ({
      title: item.title,
      summary: item.action,
      detail: `第 ${item.day} 步先做这个。`,
      tone: "action",
    }));
    const fallback = [
      {
        title: "平台优先级正在整理",
        summary: "先把近窗口里的平台动量和适配度压成一页看板。",
        detail: "你最终看到的是“先做哪里、为什么、先验证什么”。",
        tone: "platform",
      },
      {
        title: "热点赛道正在筛选",
        summary: "不是泛热点，而是与你当前方向更接近的切口。",
        detail: "会直接翻成可执行题目和表达方式。",
        tone: "topic",
      },
      {
        title: "商业化建议正在整理",
        summary: "重点不是平台介绍，而是怎么形成真实承接。",
        detail: "会优先告诉你先做什么、别做什么、怎么验证。",
        tone: "action",
      },
    ];
    return [...platformCards, ...topicCards, ...actionCards].length
      ? ([...platformCards, ...topicCards, ...actionCards] as PlatformSignalsCarouselItem[])
      : (fallback as PlatformSignalsCarouselItem[]);
  }, [actionSteps, primaryPlatforms, topTopics, snapshot]);

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

  useEffect(() => {
    if (immersiveRotatingCards.length <= 1 || !hasAnalyzed) return;
    const shouldRotate = isAnalyzing || Boolean(snapshot);
    if (!shouldRotate) return;
    const timer = window.setInterval(() => {
      setRotatingCardIndex((value) => (value + 1) % immersiveRotatingCards.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [immersiveRotatingCards.length, isAnalyzing, hasAnalyzed, snapshot]);

  const handleAnalyze = async () => {
    // ── B 端拦截：必须先注入 IP 基因库（行业身份 / 优势 / 受众 / 旗舰交付）
    if (!isIpProfileReady(ipProfile)) {
      setShowIpModal(true);
      toast.message("启动战略推演前，请先载入企业专属 IP 基因");
      return;
    }

    const cost = CREDIT_COSTS.platformStage2Copywriting;
    if (
      !window.confirm(
        `【平台全案分析】將基於四平台實時樣本與你的 IP 背景，一次性交付：戰略優先級看板 + 專屬選題與可拍攝長文案／分鏡級內容（結構化落地稿，而非 ChatGPT 式泛泛建議）。\n\n` +
          `專屬文案任務入隊時扣除 ${cost} 積分；全程約數分鐘，請勿關閉頁面。是否開始？`,
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
    setPlatformContent(null);
    setContentDebug(null);
    setIsContentLoading(false);
    setStage2Failed(false);
    setContentJobError(null);
    setContentJobPollTrace(null);
    setElapsedTime(0);
    setRotatingCardIndex(0);
    setPlatformImageMap({});
    setPlatformStoryboardSheetMap({});
    setPlatformXhsNoteMap({});
    setSceneJobIds({});
    setPendingCompositeSheet(null);
    compositeSheetLivePollCtxRef.current = null;
    setPlatformImageGenFlowSnapshots([]);
    setRegeneratingCoverSceneId(null);
    setCoverWaitCarouselEngaged(false);
    setCoverLoadRetriedIds(() => new Set());
    setCompositeLoadRetriedKeys(() => new Set());
    setCoverSilentRetryIds(() => new Set());
    setBatchGeneratingCoverIds(() => new Set());
    setIsSequentialCoverBatchGenerating(false);
    topicImagePollFlowLogCursorRef.current = 0;
    setTopicImageJobPollTrace(null);
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
    toast.success("快照已就緒，正在生成戰略看板與專屬文案…");

    const snap = result.data.snapshot;
    const snapSummary = snap as Record<string, unknown>;
    setIsDashboardLoading(true);
    try {
      const dashResult = await getPlatformDashboardMutation.mutateAsync({
        context: focusPrompt || undefined,
        windowDays: selectedWindowDays,
        snapshotSummary: snap as any,
      });

      if (!dashResult.platformDashboard) {
        console.warn("[PlatformPage] Stage 1 AI 解析失敗:", dashResult.debug?.error);
        toast.error(
          `戰略看板生成失敗：AI 數據格式異常，請重試 (${String((dashResult.debug as { error?: unknown })?.error ?? "未知")})`,
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

      await enqueueAndPollExclusiveContent(dash, snapSummary, selectedWindowDays);
    } catch (e) {
      console.warn("[PlatformPage] handleAnalyze chain error:", e);
      const msg = e instanceof Error ? e.message : String(e);
      if (!String(msg).includes("文案生成失敗")) {
        toast.error(`分析中斷：${msg}`);
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
    // Dispatch async QA Job — Vertex 3.1 Pro Preview answers in background
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
      });
    }
  };

  const scrollToPaidDecisionIntel = useCallback(() => {
    const el = document.getElementById(PLATFORM_SECTION_DECISION_INTEL_ID);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    toast.message("请先完成全案分析：右侧「开始全案分析」入队后，待专属文案写入即可在本页解锁决策智库视图。");
    document.getElementById(PLATFORM_SECTION_TREND_RUN_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToPaidDeepQa = useCallback(() => {
    const el = document.getElementById(PLATFORM_SECTION_DEEP_QA_ID);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    toast.message("深度追问在报告区下方：请先生成战略看板与报告内容。");
    document.getElementById(PLATFORM_SECTION_TREND_RUN_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const scrollToPaidPlatformTrends = useCallback(() => {
    if (snapshot) {
      document.getElementById(PLATFORM_SECTION_TREND_SIGNALS_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    toast.message("平台趋势来自当前窗口快照：请在右侧选择天数与判断焦点，并点击「开始全案分析」。");
    document.getElementById(PLATFORM_SECTION_TREND_RUN_ID)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [snapshot]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0b0620] text-white">
        <Loader2 className="h-8 w-8 animate-spin text-[#49e6ff]" />
      </div>
    );
  }

  if (!isAuthenticated && !supervisorAccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[linear-gradient(180deg,#080618_0%,#13092e_48%,#090715_100%)] px-6 text-white">
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
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(82,32,165,0.34),transparent_26%),radial-gradient(circle_at_top_right,rgba(25,121,166,0.22),transparent_20%),linear-gradient(180deg,#06030f_0%,#0d0820_24%,#140b2e_100%)] text-[#f7f2ff]">
      <style>{`@keyframes pulseHighlight{0%,95%,100%{box-shadow:none}96%{box-shadow:0 0 0 2px rgba(73,230,255,0.7),0 0 24px rgba(73,230,255,0.3)}98%{box-shadow:0 0 0 3px rgba(127,103,255,0.8),0 0 32px rgba(127,103,255,0.4)}}@keyframes mvspPlatformOrb{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(12px,-10px) scale(1.07)}}@keyframes coverGenWaitCarouselProgress{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes platformCarouselProg{from{transform:scaleX(0)}to{transform:scaleX(1)}}@keyframes platformCarouselGlow{0%,100%{opacity:0.4}50%{opacity:0.92}}`}</style>

      {/* B 端 IP 基因库 · 靛青色拦截弹窗（共享组件 IpProfileModal） */}
      <IpProfileModal
        open={showIpModal}
        value={ipProfile}
        onChange={setIpProfile}
        onClose={() => setShowIpModal(false)}
      />

      <div className="mx-auto max-w-[min(1920px,100%)] px-4 py-6 md:px-6 md:py-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={() => window.history.back()}
            className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
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
                          {CREDIT_COSTS.platformStage2Copywriting} 积分起
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-snug text-[#c4b8e8] md:text-[15px]">全案入队读取窗口样本、热点与平台信号</p>
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void scrollToPaidDecisionIntel()}
                    className="group flex min-w-0 flex-1 items-center gap-4 rounded-2xl border-2 border-white/15 bg-[rgba(255,255,255,0.07)] px-5 py-4 text-left transition hover:border-[#ff4fb8]/45 hover:bg-[rgba(255,79,184,0.12)] md:min-w-[15rem] md:px-6 md:py-5 sm:flex-none"
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-[#ff4fb8]/35 bg-[#ff4fb8]/15 text-[#ffc6e8] md:h-14 md:w-14">
                      <Map className="h-6 w-6 md:h-7 md:w-7" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-base font-bold text-white md:text-lg">个人战略全景</span>
                        <span className="rounded-full border border-[#f472b6]/45 bg-[rgba(244,114,182,0.15)] px-2.5 py-0.5 text-xs font-semibold text-[#fbcfe8]">
                          智库加购
                        </span>
                      </div>
                      <p className="mt-1 text-sm leading-snug text-[#c4b8e8] md:text-[15px]">专属文案就绪后可解锁一页可视化决策地图</p>
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

              <div className="rounded-[26px] border border-[#2a1c55] bg-[rgba(11,7,26,0.94)] p-5">
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Target className="h-4 w-4 text-[#ffdd44]" />
                  你这轮最想判断什么
                </div>
                <div className="relative mt-4">
                  <textarea
                    value={focusPrompt}
                    onChange={(event) => setFocusPrompt(event.target.value)}
                    placeholder="例如：我现在是做女性健康/本地服务，想知道先做小红书还是抖音；应该先做图文、短视频，还是先验证某个商业化切口。"
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
                    title="已含專屬選題與長文案／分鏡稿；任務入隊時扣除右側積分（與通用聊天不同，結合當前窗口樣本與 IP 基因）"
                  >
                    {CREDIT_COSTS.platformStage2Copywriting} 積分
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
                  點擊後會<strong className="text-white/80">自動接續</strong>生成專屬選題與長文案／分鏡稿；扣款在<strong className="text-[#fef08a]">後台任務入隊時</strong>，金額即右側標示。
                  {hasAnalyzed ? (
                    <>
                      {" "}
                      <a
                        href="#platform-stage2-copy"
                        className="font-semibold text-[#93c5fd] underline underline-offset-2 hover:text-white"
                      >
                        跳至生成區
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

            <PlatformSignalsCarouselPanel
              eyebrow="轮播看板"
              items={immersiveRotatingCards}
              activeIndex={rotatingCardIndex}
              onPickIndex={setRotatingCardIndex}
              subtitle="在报告生成阶段，用大卡轮换播放当前窗口里最关键的平台脉搏、热点切口与可先执行的动作，避免干等。"
            />
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
              <div className="mt-4 grid gap-4 xl:grid-cols-3">
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">前端状态</div>
                  <div className="mt-3 space-y-2 text-xs leading-6 text-[#d7d0ef]">
                    <div>windowDays: {selectedWindowDays}</div>
                    <div>focusPrompt: {focusPrompt || "-"}</div>
                    <div>query.status: {growthSnapshotQuery.status}</div>
                    <div>query.isFetching: {String(growthSnapshotQuery.isFetching)}</div>
                    <div>hasSnapshot: {String(Boolean(snapshot))}</div>
                    <div>hasPlatformDashboard: {String(Boolean(platformDashboard))}</div>
                    <div>isDashboardLoading: {String(isDashboardLoading)}</div>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">分析步骤 · 模型使用明细</div>
                  <div className="mt-3 space-y-1 text-xs leading-6 text-[#d7d0ef]">
                    <div className="text-[#8cefff] font-semibold">── Call 1: 快照 ──</div>
                    <div>1. 快照分析 (getGrowthSnapshot — 同步 tRPC query)</div>
                    <div>1a. 状态: {growthSnapshotQuery.isFetched ? `✅ 已返回 (${snapshotDebug?.baseSource})` : growthSnapshotQuery.isFetching ? "⏳ 进行中" : "⏸ 未开始"}</div>
                    <div>1b. 真实采集: {String(snapshotDebug?.hasAnyLiveCollection ?? "?")} / 平台数: {(snapshotDebug as any)?.stalePlatforms !== undefined ? `${(snapshotDebug as any)?.platformCount ?? 4}` : "?"}</div>
                    <div>1c. storeMs: {String((snapshotDebug?.timing as any)?.storeMs ?? "?")}</div>
                    <div className="text-[#8cefff] font-semibold mt-1">── Stage 1: 看板先行 ──</div>
                    <div>2. 平台优先级看板（getPlatformDashboard）</div>
                    <div>2a. 状态: <span>{isDashboardLoading ? "⏳ 正在推演戰略看板..." : platformDashboard ? "✅ 已完成" : "⏸ 等待"}</span></div>
                    <div>2b. headline: {(platformDashboard as any)?.headline?.slice(0, 60) || "-"}</div>
                    <div>2c. hotTopics: {(platformDashboard as any)?.hotTopics?.length ?? "-"} 条</div>
                    <div className="text-[#8cefff] font-semibold mt-1">── Stage 2: 文案与选题跟进 ──</div>
                    <div>3. 專屬文案（enqueuePlatformContentJob · 需登入，入隊時扣 {CREDIT_COSTS.platformStage2Copywriting} 積分 → Fly worker，GET /api/jobs 轮询）</div>
                    <div>
                      3a. 状态:{" "}
                      <span>
                        {isContentLoading
                          ? "⏳ 正在生成原创文案..."
                          : platformContent && !stage2EmptyPayload
                            ? "✅ 已完成"
                            : platformContent && stage2EmptyPayload
                              ? "⚠️ 接口成功但內容為空"
                            : contentJobError
                              ? "❌ 解析失败"
                              : "⏸ 等待 Stage 1"}
                      </span>
                    </div>
                    <div>3b. contentBlueprints: {(platformContent as any)?.contentBlueprints?.length ?? "-"} 条</div>
                    <div>3c. monetizationLanes: {(platformContent as any)?.monetizationLanes?.length ?? "-"} 条</div>
                    <div>
                      3d. jobId:{" "}
                      <span className="font-mono text-[#ffdd44]">{contentJobPollTrace?.jobId ?? "—"}</span>
                    </div>
                    <div>
                      3e. 流水更新次数: {contentJobPollTrace != null ? String(contentJobPollTrace.pollCount) : "—"}
                      {contentJobPollTrace?.terminalStatus
                        ? ` · 终态 ${contentJobPollTrace.terminalStatus}`
                        : ""}
                      <span className="text-gray-500">
                        （前段約每 2.5s；第 37 次起間隔拉長至最多 8s；worker 默认最长約 20min）
                      </span>
                    </div>
                    <div>
                      3f. Stage2 請求輸出上限 max_tokens/maxOutput:{" "}
                      <span className="font-mono text-[#ffdd44]">
                        {String(
                          (contentDebug?.buildPlatformContent as { stage2MaxOutputTokens?: number } | undefined)
                            ?.stage2MaxOutputTokens ?? "—",
                        )}
                      </span>
                      <span className="text-gray-500">
                        （`PLATFORM_STAGE2_LLM`=openai 或 vertex/gemini 皆共用 env `PLATFORM_STAGE2_MAX_OUTPUT_TOKENS`，與線路標籤無關）
                      </span>
                    </div>
                    <div className="break-words">
                      3g. GPT‑5 reasoning 診斷（OpenAI 路徑生效）:{" "}
                      <span className="font-mono text-[10px] text-[#d7d0ef]">
                        {(() => {
                          const r = (contentDebug?.buildPlatformContent as { openaiGpt5ReasoningEffort?: unknown } | undefined)
                            ?.openaiGpt5ReasoningEffort;
                          return r != null ? JSON.stringify(r) : "—（任務完成後由後端寫入）";
                        })()}
                      </span>
                    </div>
                    <div className="break-words">
                      3h. Stage 2 步驟概要{" "}
                      <span className="text-gray-500">
                        （OpenAI：單次呼叫推理並輸出 JSON；Vertex：`gemini-3.1-pro-preview` 單階。見 JSON `stage2SubSteps`）
                      </span>:
                      <div className="mt-1 space-y-0.5 pl-1 font-mono text-[10px] text-[#d7d0ef]">
                        {(() => {
                          const bp = contentDebug?.buildPlatformContent as
                            | {
                                stage2SubSteps?: { id: string; title: string; model?: string; status: string }[];
                              }
                            | undefined;
                          const sub = bp?.stage2SubSteps;
                          if (!Array.isArray(sub) || sub.length === 0) {
                            return <div>— 完成任務後顯示；若皆無請展開下方 Stage 2 · debug。</div>;
                          }
                          return sub.map((s) => (
                            <div key={s.id}>
                              <span className="text-[#ffdd44]">{s.id}</span> {s.title}
                              {s.model ? <span className="text-gray-500"> · model={s.model}</span> : null} · {s.status}
                            </div>
                          ));
                        })()}
                      </div>
                    </div>
                    <div className="text-[#8cefff] font-semibold mt-1">── QA 答疑 Job ──</div>
                    <div>4. 纯文本对话分析（支持 fileUri 多模态）</div>
                    <div>4a. QA Job ID: <span className="font-mono text-[#ffdd44]">{qaJobId || "未创建"}</span></div>
                    <div>4b. 状态: {isQaLoading ? "⏳ 运行中，轮询每 3 秒" : qaJobId ? "✅ job 已完成" : "⏸ 等待提问"}</div>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">错误</div>
                  <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[#d7d0ef]">
                    {(
                      [
                        growthSnapshotQuery.error?.message,
                        getPlatformDashboardMutation.error?.message,
                        contentJobError,
                        typeof dashboardDebug?.error === "string" ? dashboardDebug.error : null,
                        typeof contentDebug?.stage2Error === "string" ? contentDebug.stage2Error : null,
                        stage2EmptyPayload
                          ? "Stage 2 返回空選題：請查看下方 Stage 2.debug（如 buildPlatformContent / jsonParseStrategy / rawContentEmpty）。"
                          : null,
                      ]
                        .filter(Boolean)
                        .join("\n\n") || "-"
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-4 xl:grid-cols-2">
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">getGrowthSnapshot.debug</div>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                    {JSON.stringify(snapshotDebug || null, null, 2)}
                  </pre>
                </div>
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">getPlatformDashboard.debug</div>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                    {JSON.stringify(dashboardDebug || null, null, 2)}
                  </pre>
                </div>
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4 xl:col-span-2">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">Stage 2 · debug</div>
                  <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                    {JSON.stringify(contentDebug || null, null, 2)}
                  </pre>
                </div>
              </div>
              <div className="mt-4 rounded-2xl border border-[#49e6ff]/30 bg-[rgba(73,230,255,0.06)] p-4">
                <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#49e6ff]">
                  Fly Jobs · 客户端轮询（GET /api/jobs/:id）
                </div>
                <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                  任务状态落在 Neon；前端按间隔拉取终态（前段 2.5s，第 37 次起加倍至最多 8s）。下面为每次入队 jobId、轮询序号与 HTTP 结果摘要。
                </p>
                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                    <div className="text-[11px] font-semibold text-[#ffdd44]">Stage 2 文案 · platform_build_content + 轮询</div>
                    <div className="mt-1 space-y-1 text-[10px] text-gray-400">
                      <div>
                        jobId:{" "}
                        <span className="break-all font-mono text-[#d7d0ef]">{contentJobPollTrace?.jobId ?? "—"}</span>
                      </div>
                      <div>
                        流水更新次数: {contentJobPollTrace != null ? String(contentJobPollTrace.pollCount) : "—"}
                        {contentJobPollTrace?.terminalStatus
                          ? ` · 终态 ${contentJobPollTrace.terminalStatus}`
                          : ""}
                      </div>
                    </div>
                    <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-[#c9c0e6]">
                      {(contentJobPollTrace?.lines ?? []).length > 0
                        ? (contentJobPollTrace?.lines ?? []).join("\n")
                        : "尚无记录。Stage 1 完成后会入队 platform_build_content 并轮询 GET /api/jobs。"}
                    </pre>
                  </div>
                  <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                    <div className="text-[11px] font-semibold text-[#ff7fd5]">封面单帧 · platform_topic_image（最近一条）</div>
                    <div className="mt-1 space-y-1 text-[10px] text-gray-400">
                      <div>来源: {topicImageJobPollTrace?.label ?? "—"}</div>
                      <div>
                        jobId:{" "}
                        <span className="break-all font-mono text-[#d7d0ef]">{topicImageJobPollTrace?.jobId ?? "—"}</span>
                      </div>
                      <div>
                        末次轮询序号: {topicImageJobPollTrace != null ? String(topicImageJobPollTrace.pollCount) : "—"}
                        {topicImageJobPollTrace?.terminalStatus
                          ? ` · 终态 ${topicImageJobPollTrace.terminalStatus}`
                          : ""}
                      </div>
                    </div>
                    <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-[#c9c0e6]">
                      {(topicImageJobPollTrace?.lines ?? []).length > 0
                        ? (topicImageJobPollTrace?.lines ?? []).join("\n")
                        : "尚无记录。Enqueue 封面任务后写入（手动 / 批量 / 静默补发）。"}
                    </pre>
                  </div>
                </div>
              </div>
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
                    通常 30–90 秒。看板就绪后将<strong className="text-[#d4d4ff]">自动接续</strong>專屬選題與長文案／分鏡稿（結合實時樣本與你的 IP，非泛泛建議），全程請勿關閉頁面。
                  </div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {snapshot && platformDashboard ? (
          <section id="platform-report" className="mt-8 space-y-6">
            <div
              className="scroll-mt-24 rounded-2xl border-2 border-[#f59e0b]/55 bg-[linear-gradient(135deg,rgba(245,158,11,0.14),rgba(120,50,20,0.12))] px-4 py-4 shadow-[0_0_32px_rgba(245,158,11,0.12)] md:px-5"
              role="region"
              aria-label="全案分析扣費說明"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:gap-4">
                <div className="flex shrink-0 items-center gap-2 text-[#ffedd5]">
                  <CircleDollarSign className="h-6 w-6 shrink-0 text-[#fbbf24]" aria-hidden />
                  <span className="text-base font-black tracking-tight text-white sm:text-lg">全案分析 · 扣費說明</span>
                </div>
                <div className="min-w-0 flex-1 text-sm leading-7 text-[#ffe4c4]">
                  首次「开始全案分析」確認後，系統會接續入隊專屬文案；任務<strong className="text-white">入隊時</strong>扣除{" "}
                  <strong className="text-[#fef08a]">{CREDIT_COSTS.platformStage2Copywriting} 積分</strong>
                  並由後台結合當前窗口樣本與你的背景寫入<strong className="text-white">可執行長稿／分鏡</strong>
                  。任務失敗、逾時或結果不滿意，
                  <strong className="text-red-200">積分不予退還</strong>。若之後點「重新生成」，
                  <strong className="text-[#fef08a]">再扣 {CREDIT_COSTS.platformStage2Copywriting} 積分</strong>。
                </div>
              </div>
            </div>

            <div
              id={PLATFORM_SECTION_DECISION_INTEL_ID}
              className="scroll-mt-20 rounded-2xl border border-[#49e6ff]/25 bg-[rgba(10,15,35,0.75)] p-4 md:p-5"
            >
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[#49e6ff]/35 bg-[#49e6ff]/10">
                    <Lock className="h-5 w-5 text-[#8cefff]" aria-hidden />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-white md:text-lg">个性化战略地图（决策智库视图）</h3>
                    <p className="mt-1 max-w-3xl text-xs leading-relaxed text-[#b7add8]">
                      在<strong className="text-white">全案专属文案已成功写入</strong>后，将本页战略看板与长稿要点<strong className="text-white">收敛成一页可视化报告</strong>
                      （雷达、执行向建议与阅读用排行条；均为<strong className="text-white">辅助决策的模型推演</strong>，不构成效果承诺）。解锁为
                      <strong className="text-white"> 加购模块</strong>
                      ，与全案入队扣点分开计：首次体验{" "}
                      <strong className="text-[#fde047]">{CREDIT_COSTS.decisionIntelligenceReportFirst} 积分</strong>，之后每次{" "}
                      <strong className="text-[#fde047]">{CREDIT_COSTS.decisionIntelligenceReport} 积分</strong>。
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
                        {isContentLoading
                          ? "专属文案生成中，完成后才可扣点解锁（价格已标示于上）。"
                          : stage2Failed || contentJobError
                            ? "专属文案未完成，请重试全案文案后再解锁本模块。"
                            : stage2EmptyPayload
                              ? "后台未返回有效选题请重试；完成后再解锁。"
                              : platformDashboard && !platformContent
                                ? "请先完成专属文案入队结果，再解锁本报告。"
                                : "请完成全案专属文案后再解锁。"}
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
                            `将扣除 ${next} 积分，基于当前「战略看板 + 已写入的专属文案」与「近 ${selectedWindowDays} 天」窗口生成决策智库报告并存档。\n\n报告为模型辅助阅读与推演，非效果保证；成功出货后恕不因主观不满意退点（与全案说明一致）。是否继续？`,
                          );
                          if (!ok) return;
                        }
                        generateDecisionIntelMutation.mutate({
                          topic: strategicMapTopic,
                          contentBlueprint: strategicMapBlueprint,
                          platformHint: decisionIntelPlatformHint,
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
                          點）
                        </>
                      ) : (
                        <>付費解鎖戰略地圖</>
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
                            導出中…
                          </>
                        ) : (
                          <>
                            <Download className="h-4 w-4 shrink-0" />
                            導出報告圖（PNG）
                          </>
                        )}
                      </button>
                    ) : null}
                  </div>
                ) : (
                  <p className="text-xs text-amber-200/90">登入後可解鎖此增值模組。</p>
                )}
              </div>

              <div className="relative mt-5 overflow-hidden rounded-xl border border-white/10 bg-black/40">
                {unlockedStrategicReport ? (
                  <div className="w-full overflow-x-auto overflow-y-visible">
                    <div ref={strategicReportDashboardRef} className="inline-block align-top">
                      <PlatformReportDashboard data={unlockedStrategicReport} className="!min-h-0" />
                    </div>
                  </div>
                ) : (
                  <>
                    <DecisionIntelLockedDemoPreview
                      footnote={
                        strategicMapPreviewReport
                          ? "上為匿名化演示樣張（英文與品牌區已打碼）。解鎖後將依您當前戰略看板與專屬文案生成清晰專屬版並存檔。"
                          : "上為匿名化演示樣張（英文與品牌區已打碼）。完成專屬文案後即可付費解鎖，獲取基於您數據的完整報告。"
                      }
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3 md:p-4">
                      <div className="flex max-w-lg flex-col items-center gap-2 rounded-2xl border border-[#49e6ff]/25 bg-[#070a12]/90 px-4 py-3 text-center shadow-[0_8px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
                        <Lock className="h-7 w-7 text-[#8cefff]/90" aria-hidden />
                        <p className="text-sm font-semibold text-white">
                          {strategicMapPreviewReport ? "試讀樣張 · 解鎖拿專屬高清版" : "試讀樣張 · 完成文案後可解鎖"}
                        </p>
                        <p className="text-[11px] leading-relaxed text-[#d7d0ef]">
                          {strategicMapPreviewReport ? (
                            <>
                              解鎖後版式與演示一致，但數字與建議均來自<strong className="text-[#fde047]">您的全案結果</strong>
                              ，非示意樣張。
                            </>
                          ) : (
                            <>
                              請先完成本頁<strong className="text-[#fde047]">專屬文案</strong>
                              ；解鎖價格已列於上方。
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
                  Debug Flow
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-3">
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">前端状态</div>
                    <div className="mt-3 space-y-2 text-xs leading-6 text-[#d7d0ef]">
                      <div>auth: {supervisorAccess ? "supervisor" : isAuthenticated ? "user" : "guest"}</div>
                      <div>windowDays: {selectedWindowDays}</div>
                      <div>focusPrompt: {focusPrompt || "-"}</div>
                      <div>query.status: {growthSnapshotQuery.status}</div>
                      <div>query.fetchStatus: {growthSnapshotQuery.fetchStatus}</div>
                      <div>query.isFetching: {String(growthSnapshotQuery.isFetching)}</div>
                      <div>ask.isPending: {String(askPlatformFollowUpMutation.isPending)}</div>
                      <div>hasSnapshot: {String(Boolean(snapshot))}</div>
                      <div>hasPlatformDashboard: {String(Boolean(platformDashboard))}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">分析步骤</div>
                    <div className="mt-3 space-y-2 text-xs leading-6 text-[#d7d0ef]">
                      <div>1. getGrowthSnapshot 请求: {growthSnapshotQuery.isFetched ? "已返回" : growthSnapshotQuery.isFetching ? "进行中" : "未开始"}</div>
                      <div>2. snapshot 构建: {snapshotDebug?.baseSource ? `已完成 (${snapshotDebug.baseSource})` : "未知"}</div>
                      <div>3. personalization: {String(snapshotDebug?.personalizedApplied ?? false)}</div>
                      <div>4. Stage1(dashboard): {isDashboardLoading ? "⏳" : platformDashboard ? "✅" : "⏸"} / Stage2(content): {isContentLoading ? "⏳" : platformContent ? "✅" : "⏸"}</div>
                      <div>5. hasPlatformDashboard: {String(Boolean(platformDashboard))} / hasPlatformContent: {String(Boolean(platformContent))}</div>
                      <div>6. 继续追问: {askPlatformFollowUpMutation.isSuccess ? "已返回" : askPlatformFollowUpMutation.isPending ? "进行中" : "未开始"}</div>
                      <div>
                        7. Stage2 追踪 id:{" "}
                        <span className="font-mono text-[#ffdd44]">{contentJobPollTrace?.jobId ?? "—"}</span> · 流水更新{" "}
                        {contentJobPollTrace != null ? contentJobPollTrace.pollCount : "—"}
                      </div>
                      <div>
                        8. 封面 job:{" "}
                        <span className="font-mono text-[#ff7fd5]">{topicImageJobPollTrace?.jobId ?? "—"}</span> ·{" "}
                        {topicImageJobPollTrace?.label ?? "—"}
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">错误</div>
                    <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[#d7d0ef]">
                      {String(growthSnapshotQuery.error?.message || askPlatformFollowUpMutation.error?.message || "-")}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">getGrowthSnapshot.debug</div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                      {JSON.stringify(snapshotDebug || null, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">getPlatformDashboard.debug</div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                      {JSON.stringify(dashboardDebug || null, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-[#8cefff]">askPlatformFollowUp.debug</div>
                    <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[11px] leading-6 text-[#d7d0ef]">
                      {JSON.stringify(askDebug || null, null, 2)}
                    </pre>
                  </div>
                </div>
                <div className="mt-4 rounded-2xl border border-[#10B981]/35 bg-[rgba(16,185,129,0.06)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#10B981]">
                      分镜单帧 / 封面参考 / 2×4 合成 · 服务端逐步日志（imageGenFlowLog）
                    </div>
                    {platformImageGenFlowSnapshots.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setPlatformImageGenFlowSnapshots([])}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[10px] text-gray-400 hover:bg-white/10"
                      >
                        清空
                      </button>
                    ) : null}
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                    位置：本卡片在 <span className="text-gray-400">askPlatformFollowUp.debug</span>{" "}
                    三块 JSON <strong className="text-gray-400">正下方</strong>。
                    成功时追加服务端 <code className="text-[#8cefff]">imageGenFlowLog</code>（含 GPT-IMAGE-2 失败原因、重试与计费提示）；<strong className="text-rose-400/90">失败</strong>
                    时 TRPC 错误正文也会附带最近若干行 <code className="text-[#8cefff]">imageGenFlowLog</code> 摘要（2×4 与空 URL 类错误）。
                  </p>
                  {platformImageGenFlowSnapshots.length === 0 ? (
                    <div className="mt-3 rounded-xl border border-dashed border-white/15 bg-black/30 px-3 py-6 text-center text-[11px] leading-relaxed text-gray-500">
                      尚无记录。请往下翻到选题卡片区跑一次批量参考图或 2×4 合成；若失败，此处也应出现红色失败流水。
                    </div>
                  ) : (
                    <div className="mt-3 max-h-[min(70vh,520px)] space-y-4 overflow-y-auto">
                      {platformImageGenFlowSnapshots.map((snap, i) => (
                        <div
                          key={`${snap.at}-${snap.kind}-${i}`}
                          className={`rounded-xl border bg-black/40 p-3 ${
                            snap.kind === "batch_topic_frames_failed" || snap.kind === "composite_2x4_failed"
                              ? "border-rose-500/40"
                              : "border-white/10"
                          }`}
                        >
                          <div
                            className={`font-mono text-[10px] ${
                              snap.kind === "batch_topic_frames_failed" || snap.kind === "composite_2x4_failed"
                                ? "text-rose-300"
                                : "text-[#8cefff]"
                            }`}
                          >
                            {snap.at} ·{" "}
                            {snap.kind === "batch_topic_frames"
                              ? "批量单帧"
                              : snap.kind === "batch_topic_frames_failed"
                                ? "批量单帧 · 失败（客户端捕获）"
                                : snap.kind === "composite_2x4_failed"
                                  ? "2×4 合成 · 失败（客户端捕获）"
                                  : "2×4 合成"}
                            {snap.meta ? ` · ${JSON.stringify(snap.meta)}` : ""}
                          </div>
                          {snap.kind === "batch_topic_frames_failed" || snap.kind === "composite_2x4_failed" ? (
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
                          ) : null}
                          <pre className="mt-2 max-h-[min(85vh,920px)] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-[#d7d0ef]">
                            {snap.lines.join("\n")}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="mt-4 rounded-2xl border border-[#49e6ff]/30 bg-[rgba(73,230,255,0.06)] p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.14em] text-[#49e6ff]">
                    Fly Jobs · 客户端轮询（GET /api/jobs/:id）
                  </div>
                  <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
                    与上方「快照区」Debug 相同数据源：Stage 2 为 platform_build_content；前段約每 2.5s 拉取，第 37 次起間隔加倍（最多 8s）；封面单帧仍为 job 入队与 GET /api/jobs 轮询。
                  </p>
                  <div className="mt-3 grid gap-4 lg:grid-cols-2">
                    <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                      <div className="text-[11px] font-semibold text-[#ffdd44]">Stage 2 文案 · platform_build_content + 轮询</div>
                      <div className="mt-1 space-y-1 text-[10px] text-gray-400">
                        <div>
                          jobId:{" "}
                          <span className="break-all font-mono text-[#d7d0ef]">{contentJobPollTrace?.jobId ?? "—"}</span>
                        </div>
                        <div>
                          流水更新次数: {contentJobPollTrace != null ? String(contentJobPollTrace.pollCount) : "—"}
                          {contentJobPollTrace?.terminalStatus
                            ? ` · 终态 ${contentJobPollTrace.terminalStatus}`
                            : ""}
                        </div>
                      </div>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-[#c9c0e6]">
                        {(contentJobPollTrace?.lines ?? []).length > 0
                          ? (contentJobPollTrace?.lines ?? []).join("\n")
                          : "尚无记录。完成 Stage 1 后将出现轮询流水。"}
                      </pre>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-black/35 p-3">
                      <div className="text-[11px] font-semibold text-[#ff7fd5]">封面单帧 · platform_topic_image（最近一条）</div>
                      <div className="mt-1 space-y-1 text-[10px] text-gray-400">
                        <div>来源: {topicImageJobPollTrace?.label ?? "—"}</div>
                        <div>
                          jobId:{" "}
                          <span className="break-all font-mono text-[#d7d0ef]">{topicImageJobPollTrace?.jobId ?? "—"}</span>
                        </div>
                        <div>
                          末次轮询序号: {topicImageJobPollTrace != null ? String(topicImageJobPollTrace.pollCount) : "—"}
                          {topicImageJobPollTrace?.terminalStatus
                            ? ` · 终态 ${topicImageJobPollTrace.terminalStatus}`
                            : ""}
                        </div>
                      </div>
                      <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words text-[10px] leading-5 text-[#c9c0e6]">
                        {(topicImageJobPollTrace?.lines ?? []).length > 0
                          ? (topicImageJobPollTrace?.lines ?? []).join("\n")
                          : "尚无记录。"}
                      </pre>
                    </div>
                  </div>
                </div>
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

            <div className="grid gap-4">
              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <TrendingUp className="h-4 w-4 text-[#49e6ff]" />
                  平台优先级与切入方式
                </div>
                <div className="mt-5 grid gap-4">
                  {platformDecisionRows.map((item, index) => (
                    <div key={item.id} className="rounded-[24px] border border-white/10 bg-[rgba(255,255,255,0.04)] p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-3">
                            <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">
                              Priority {index + 1}
                            </div>
                            <div className="text-xl font-bold text-white">{item.name}</div>
                          </div>
                          <div className="mt-3 text-sm leading-7 text-[#b9afd9]">{renderSafeText(item.trend)}</div>
                            </div>
                            <div className="rounded-full border border-white/10 bg-[rgba(255,255,255,0.04)] px-3 py-2 text-xs text-[#d6cdf0]">
                              {renderSafeText(item.lane)}
                            </div>
                          </div>
                          {Array.isArray((item as any).trafficBoosters) && (item as any).trafficBoosters.length > 0 ? (
                            <div className="mt-3 flex flex-wrap gap-2">
                              {(item as any).trafficBoosters.map((b: any, bi: number) => (
                                <span key={bi} className="inline-flex items-center gap-1 rounded-full border border-[#ff6b2b]/40 bg-[rgba(255,100,30,0.12)] px-3 py-1 text-[11px] font-medium text-[#ff9966] animate-pulse">
                                  <Flame className="h-3 w-3" />
                                  {renderSafeText(b)}
                                </span>
                              ))}
                            </div>
                          ) : null}
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-4">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff]">为什么现在做</div>
                          <div className="mt-2 text-sm leading-7 text-white whitespace-pre-wrap">{renderSafeText(item.whyNow)}</div>
                        </div>
                        <div className="rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-4">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[#ffdd44]">建议动作</div>
                          <div className="mt-2 text-sm leading-7 text-white whitespace-pre-wrap">{renderSafeText(item.nextMove)}</div>
                        </div>
                      </div>
                      {(item.hook || item.monetization) ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {item.hook ? (
                            <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">开头怎么说</div>
                              <div className="mt-2 text-sm leading-7 text-[#d3caef] whitespace-pre-wrap">{renderSafeText(item.hook)}</div>
                            </div>
                          ) : null}
                          {item.monetization ? (
                            <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-[#ffdd44]">更适合的承接</div>
                              <div className="mt-2 text-sm leading-7 text-[#d3caef] whitespace-pre-wrap">{renderSafeText(item.monetization)}</div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {((item as any).primaryTrack || (item as any).estimatedTraffic || (item as any).ipUniqueness || (item as any).commercialConversion) ? (
                        <div className="mt-3 grid grid-cols-2 gap-2">
                          {(item as any).primaryTrack ? (<div className="rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><Target className="h-3 w-3" />赛道</div><div className="mt-1 text-xs leading-6 text-white">{renderSafeText((item as any).primaryTrack, '分析中...')}</div></div>) : null}
                          {(item as any).estimatedTraffic ? (<div className="rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><BarChart3 className="h-3 w-3" />预估流量</div><div className="mt-1 text-xs leading-6 text-white">{renderSafeText((item as any).estimatedTraffic, '分析中...')}</div></div>) : null}
                          {(item as any).ipUniqueness ? (<div className="rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><Star className="h-3 w-3" />IP稀缺度</div><div className="mt-1 text-xs leading-6 text-white">{renderSafeText((item as any).ipUniqueness, '分析中...')}</div></div>) : null}
                          {(item as any).commercialConversion ? (<div className="rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3"><div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><DollarSign className="h-3 w-3" />商业转化</div><div className="mt-1 text-xs leading-6 text-white">{renderSafeText((item as any).commercialConversion, '分析中...')}</div></div>) : null}
                        </div>
                      ) : null}
                      {/* Fix #3: 对标账号 — show 用户画像 when accounts are objects or absent */}
                      {Array.isArray((item as any).referenceAccounts) && (item as any).referenceAccounts.length > 0 ? (
                        <div className="mt-3 rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.9)] p-3">
                          <div className="flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#9ddcff]"><Users className="h-3 w-3" />目标受众 &amp; 对标账号</div>
                          <div className="mt-2 space-y-2">
                            {(item as any).referenceAccounts.map((acc: any, ai: number) => {
                              // Support: string | {account, reason} | {name, reason} — never show [object Object]
                              const accountText = typeof acc === "string"
                                ? acc
                                : typeof acc === "object" && acc !== null
                                  ? String(acc?.account || acc?.name || acc?.title || acc?.用户画像 || acc?.portrait || JSON.stringify(acc) || "")
                                  : "";
                              const reasonText = typeof acc === "object" && acc !== null
                                ? String(acc?.reason || acc?.description || acc?.desc || acc?.为什么 || "")
                                : "";
                              // Skip entirely if both are empty (malformed entry)
                              if (!accountText && !reasonText && accountText !== "{}") return null;
                              return (
                                <div key={ai} className="rounded-lg border border-[#3a2b6a] bg-[#170d35] px-3 py-2">
                                  {accountText ? <div className="text-[11px] font-semibold text-[#c9c0e6]">{accountText}</div> : null}
                                  {reasonText ? <div className="mt-1 text-[11px] leading-5 text-[#9080b8]">{reasonText}</div> : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <section id="platform-stage2-copy" className="mt-2 scroll-mt-28 px-1" aria-label="專屬選題與文案狀態">
              <div className="mb-6 flex flex-col gap-3 rounded-2xl border border-white/10 bg-[rgba(18,13,43,0.65)] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 flex-1">
                  <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold tracking-tight text-white sm:text-xl">
                    <Sparkles className="h-5 w-5 shrink-0 text-[#c4b5fd]" />
                    專屬選題與文案
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
                      補跑專屬文案（全案未自動入隊時 · {CREDIT_COSTS.platformStage2Copywriting} 積分）
                    </button>
                  ) : null}
                  {(stage2Failed || stage2EmptyPayload) && platformDashboard && !isContentLoading ? (
                    <button
                      type="button"
                      onClick={() => void retryStage2Content()}
                      className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border border-red-500/35 bg-red-500/10 px-4 py-2 text-sm font-semibold text-red-300 transition hover:bg-red-500/20"
                    >
                      <RefreshCw className="h-4 w-4" />
                      重新生成（再扣 {CREDIT_COSTS.platformStage2Copywriting} 積分）
                    </button>
                  ) : null}
                </div>
              </div>
            </section>

            <div className="space-y-4">
              <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(300px,420px)] xl:items-start xl:gap-8">
                <aside className="order-1 w-full xl:sticky xl:top-28 xl:z-[8] xl:order-2 xl:self-start xl:overflow-y-auto xl:max-h-[calc(100dvh-7rem)]">
                  {immersiveRotatingCards.length > 0 ? (
                    <PlatformSignalsCarouselPanel
                      eyebrow="与分镜并排 · 信号轮播"
                      items={immersiveRotatingCards}
                      activeIndex={rotatingCardIndex}
                      onPickIndex={setRotatingCardIndex}
                      subtitle="热点文案来自当前快照里的样本题与趋势层，非顾问套话。需要更大采集窗口或续报，请先购买积分（套餐页）后再跑趋势分析。"
                    />
                  ) : null}
                </aside>
                <div className="order-2 min-w-0 xl:order-1">
              <div className={shellCardClasses("p-6")}>
                <div className="mb-8 border-b border-white/10 pb-6">
                  <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                    <div className="min-w-0 flex-1">
                      <h3 className="flex items-center gap-2 text-xl font-bold text-white">
                        <Sparkles className="h-5 w-5 shrink-0 text-[#ff4fb8]" />
                        视频图文分镜表
                      </h3>
                      <p className="mt-1 text-xs text-gray-500">
                        一键生成的封面单图已放置于下方选题卡片内。此处仅展示高定 2×4 分镜与小红书 2×4 八格图文参考。
                      </p>
                    </div>
                    <div className="flex w-full flex-shrink-0 flex-col gap-3 md:w-auto md:max-w-md md:items-end">
                      <div className="w-full rounded-2xl border border-[#6366f1]/45 bg-[linear-gradient(135deg,rgba(99,102,241,0.14),rgba(15,10,35,0.95))] p-4 shadow-[0_0_0_1px_rgba(139,92,255,0.12)]">
                        {canConfigureCompositeImageTranslator ? (
                          <>
                            <div className="flex items-center gap-2 text-xs font-bold tracking-wide text-[#c4b5fd]">
                              <Zap className="h-3.5 w-3.5 shrink-0 text-cyan-300" />
                              2×4 合成 · 英文化引擎
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => setPlatformImagePromptTranslator("gpt54")}
                                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                                  platformImagePromptTranslator === "gpt54"
                                    ? "bg-[#6366f1] text-white shadow-md"
                                    : "border border-white/15 bg-black/30 text-gray-400 hover:border-white/25 hover:text-white"
                                }`}
                              >
                                GPT 5.4（默认）
                              </button>
                              <button
                                type="button"
                                onClick={() => setPlatformImagePromptTranslator("vertex_gemini_3_flash_preview")}
                                className={`rounded-lg px-3 py-1.5 text-[11px] font-semibold transition ${
                                  platformImagePromptTranslator === "vertex_gemini_3_flash_preview"
                                    ? "bg-[#0d9488] text-white shadow-md"
                                    : "border border-white/15 bg-black/30 text-gray-400 hover:border-white/25 hover:text-white"
                                }`}
                              >
                                Gemini 3 Flash（Vertex）
                              </button>
                            </div>
                            <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                              选题<strong className="text-gray-400">竖版封面单帧</strong>
                              （一键封面、单卡生成、批量逐张）由{" "}
                              <strong className="text-gray-300">GPT-IMAGE-2</strong> 生成。仅{" "}
                              <strong className="text-gray-300">2×4 分镜主表</strong>与
                              <strong className="text-gray-300">小红书 2×4 八格图文</strong>{" "}
                              宽幅合成可依此开关选择英文化引擎；选择已保存在本机浏览器。
                            </p>
                            <p className="mt-2 text-[11px] leading-relaxed text-gray-400">
                              {platformImagePromptTranslator === "gpt54" ? (
                                <>
                                  <strong className="text-gray-300">2×4 / 小红书</strong>：默认{" "}
                                  <strong className="text-gray-300">GPT 5.4</strong>
                                  英文化（长 prompt 更稳）。OpenAI 多次无效时服务端仍可自动走 Vertex Flash 兜底。
                                </>
                              ) : (
                                <>
                                  <strong className="text-gray-300">2×4 / 小红书</strong>：英文化直走{" "}
                                  <strong className="text-[#5eead4]">Vertex · gemini-3-flash-preview</strong>
                                  ：預設較高 <strong className="text-gray-300">temperature</strong>
                                  ，英文更有創意與畫面表現力；仍鎖定{" "}
                                  <strong className="text-gray-300">JSON · prompt 單欄</strong>；服務端預設思考層級{" "}
                                  <strong className="text-gray-300">HIGH</strong>、輸出 token 預算偏高（可用{" "}
                                  <code className="text-[#8cefff]">VERTEX_FLASH_TRANSLATION_THINKING_LEVEL</code> 與{" "}
                                  <code className="text-[#8cefff]">VERTEX_FLASH_TRANSLATION_MAX_TOKENS</code>{" "}
                                  覆寫）。若 Flash 配額/區域異常請切回 GPT 5.4。
                                </>
                              )}
                            </p>
                          </>
                        ) : (
                          <p className="text-[11px] leading-relaxed text-gray-400">
                            选题<strong className="text-gray-400">竖版封面单帧</strong>
                            （一键封面、单卡生成、批量逐张）由 <strong className="text-gray-300">GPT-IMAGE-2</strong>{" "}
                            生成。<strong className="text-gray-300">2×4 分镜主表</strong>与
                            <strong className="text-gray-300">小红书 2×4 八格图文</strong>
                            宽幅合成走平台默认流程。
                          </p>
                        )}
                      </div>
                      {canConfigureCompositeImageTranslator ? (
                        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-400/35 bg-amber-950/30 px-3 py-2.5 text-left text-[11px] leading-snug text-amber-50/95 shadow-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 rounded border-amber-400/60 accent-amber-400"
                            checked={platformCoverNanoBananaPro}
                            onChange={(e) => setPlatformCoverNanoBananaPro(e.target.checked)}
                          />
                          <span>
                            <span className="font-bold text-amber-200">监管专用 · 单帧封面主生图</span>
                            ：启用后走 Vertex{" "}
                            <code className="rounded bg-black/40 px-1 text-[10px] text-cyan-200/90">gemini-3-pro-image-preview</code>（
                            <strong className="text-amber-100/90">global</strong>，叠 Pro 级光影语彙）；失败自动回退 GPT-IMAGE-2。一般用户无此选项。
                          </span>
                        </label>
                      ) : null}
                      {platformTopicCount > 0 ? (
                        <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
                          <button
                            type="button"
                            onClick={() => setCoverDecisionTrialReadOpen(true)}
                            className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full border border-[#49e6ff]/50 bg-[#49e6ff]/12 px-6 py-2.5 text-sm font-semibold text-[#a5f3fc] shadow-[0_6px_24px_rgba(72,212,240,0.15)] transition hover:bg-[#49e6ff]/22 sm:w-auto"
                          >
                            <Eye className="h-4 w-4 shrink-0 opacity-90" aria-hidden />
                            点击试读 · 决策智库样张
                          </button>
                          <button
                            type="button"
                            disabled={
                              isSequentialCoverBatchGenerating ||
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
                              const scenes = contentExecutionCards.map((row) => ({
                                id: row.id,
                                title: row.title,
                                text: buildPlatformSceneText({
                                  title: row.title,
                                  hook: row.hook,
                                  copywriting: row.copywriting,
                                  executionDetails: (row as { executionDetails?: { environmentAndWardrobe?: string; lightingAndCamera?: string } })
                                    .executionDetails,
                                }),
                              }));
                              const discountNote = supervisorAccess
                                ? ""
                                : `将为您一次性生成 ${platformTopicCount} 个选题的图文封面，共消耗 ${platformBulkGraphicCost} 积分，是否继续？`;
                              if (!supervisorAccess && !window.confirm(discountNote)) return;
                              void runSequentialCoverBatchGeneration(
                                scenes,
                                buildCoverPersonaContextForImageGen(personaSummary, ipProfile),
                              );
                            }}
                            className="inline-flex w-full shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-r from-[#ff4fb8] to-[#6a5cff] px-8 py-2.5 font-bold text-white shadow-lg transition hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100 sm:w-auto"
                          >
                            {isSequentialCoverBatchGenerating ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Sparkles className="h-4 w-4" />
                            )}
                            {isSequentialCoverBatchGenerating
                              ? "正在生成图文封面单帧…"
                              : `一键生成封面 (共消耗 ${platformBulkGraphicCost} 积分)`}
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
                  </div>
                </div>

                {contentExecutionCards.length > 0 ? (
                  <div
                    id={PLATFORM_REFERENCE_GALLERY_ID}
                    className="mb-10 rounded-3xl border border-white/5 bg-[#0a0a0a]/50 p-6"
                  >
                    <div className="mb-6 flex flex-wrap items-center gap-3 border-b border-white/10 pb-4">
                      <div className="h-6 w-1.5 shrink-0 rounded-full bg-[#10B981]" />
                      <h3 className="text-xl font-bold tracking-tight text-white">2×4 分镜 · 小红书 2×4 八格图文 画廊</h3>
                    </div>
                    {referenceStoryboardGraphicStrip.length === 0 ? (
                      <div className="flex min-h-[160px] w-full items-center justify-center text-center text-sm italic text-gray-600">
                        尚未生成 2×4 分镜或小红书 2×4 八格图文（请在下方选题卡片中点击生成）
                      </div>
                    ) : (
                      <div className="grid gap-6 md:grid-cols-2">
                        {referenceStoryboardGraphicStrip.map((ref) => {
                          const isXhs = ref.key.includes("xhs-sheet");
                          const compositeRetryKey = `${ref.sceneId}::${isXhs ? "xhs" : "storyboard"}`;
                          const sourceRow = contentExecutionCards.find((row) => row.id === ref.sceneId);
                          const queueSilentCompositeRetry = () => {
                            if (!sourceRow || compositeLoadRetriedKeys.has(compositeRetryKey)) return;
                            const compositeKind = isXhs ? "xiaohongshu_dual_note" : "storyboard_sheet_portrait";
                            setCompositeLoadRetriedKeys((prev) => new Set(prev).add(compositeRetryKey));
                            if (isXhs) {
                              setPlatformXhsNoteMap((prev) => {
                                const next = { ...prev };
                                delete next[ref.sceneId];
                                return next;
                              });
                            } else {
                              setPlatformStoryboardSheetMap((prev) => {
                                const next = { ...prev };
                                delete next[ref.sceneId];
                                return next;
                              });
                            }
                            generatePlatformCompositeSheetMutation.mutate({
                              sceneId: sourceRow.id,
                              title: sourceRow.title,
                              scriptContext: buildPlatformSheetScriptContext(sourceRow as any),
                              kind: compositeKind,
                              executionDetails: buildPlatformExecutionDetailsPayload(sourceRow as any),
                              creationRecordId: readOptionalReportBindingCreationId(),
                              imagePromptTranslator: effectiveCompositeImagePromptTranslator,
                              progressJobId: newPlatformCompositeProgressJobId(),
                            });
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
                                        `${ref.sceneId}::${isXhs ? "xiaohongshu_dual_note" : "storyboard_sheet_portrait"}`
                                      ] ?? "正在绘制高定画面 · 合计常需约 3～5 分钟，请勿中途刷新"}
                                    </span>
                                  </div>
                                ) : null}
                              </div>

                              {ref.url ? (
                                <div className="border-t border-white/5 bg-[rgba(14,9,32,0.88)] p-3">
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

                {/* 3A：選題卡片 Grid 上方 — IP 維度引導（含底部提示） */}
                {platformDashboard ? <PlatformIpDimensionGuide /> : null}

                {contentExecutionCards.length > 0 ? (
                  <div
                    className="mt-4 rounded-xl border border-[#49e6ff]/20 bg-[rgba(73,230,255,0.06)] px-4 py-3 text-sm leading-relaxed text-[#c8eef9]"
                    role="status"
                  >
                    已启用<strong className="text-white">选题与封面一体化优化</strong>
                    ：后台会为每条方案<strong className="text-white">择优主标题</strong>
                    并与出图主句对齐（正文与分镜不改编），竖版封面强调
                    <strong className="text-white">信息流缩略图可读</strong>。您只需一键生成封面即可。
                  </div>
                ) : null}

                <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {contentExecutionCards.length > 0 &&
                  coverWaitCarouselEngaged &&
                  !allTopicCoverImagesReady &&
                  coverGenWaitCarouselItems.some((row) => row.title || row.excerpt.trim()) ? (
                    <CoverGenerationWaitCarousel items={coverGenWaitCarouselItems} itemsKey={coverGenWaitCarouselItemsKey} />
                  ) : null}
                  {contentExecutionCards.length === 0 && (isDashboardLoading || isContentLoading) ? (
                    <div className="col-span-full flex h-32 w-full animate-pulse flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#ff4fb8]/70">
                      <Loader2 className="mb-2 h-6 w-6 animate-spin" />
                      正在生成专属选题与配套文案...
                    </div>
                  ) : contentExecutionCards.length === 0 && platformDashboard ? (
                    <div className="col-span-full flex h-32 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#c9c0e6]/70">
                      无对应的选题方向数据
                    </div>
                  ) : (
                    contentExecutionCards.map((item) => {
                      const copyFlat = (item.copywriting || "").replace(/\s+/g, " ").trim();
                      const headlineTitle = item.title;
                      const isGraphicFormat = item.format === "图文" || item.format === "小红书";
                      const compositeKind = isGraphicFormat ? "xiaohongshu_dual_note" : "storyboard_sheet_portrait";
                      const compositeCost = isGraphicFormat
                        ? CREDIT_COSTS.platformXhsDualNote
                        : CREDIT_COSTS.platformStoryboardSheet;
                      const compositeLabel = isGraphicFormat ? "小红书 2×4 八格图文" : "2×4 高定分镜表";
                      const CompositeIcon = isGraphicFormat ? Heart : Film;
                      const compositeColorClass = isGraphicFormat
                        ? "text-[#ff9fe0] bg-[#ff4fb8]/10 border-[#ff4fb8]/40 hover:bg-[#ff4fb8]/20"
                        : "text-[#8cefff] bg-[#49e6ff]/10 border-[#49e6ff]/40 hover:bg-[#49e6ff]/20";
                      const compositeRingClass = isGraphicFormat ? "ring-[#ff4fb8]/35" : "ring-[#49e6ff]/35";
                      const compositeMutationBusy = generatePlatformCompositeSheetMutation.isPending;
                      const isThisCompositeLoading =
                        compositeMutationBusy &&
                        pendingCompositeSheet?.sceneId === item.id &&
                        pendingCompositeSheet?.kind === compositeKind;
                      const compositePhaseHint =
                        compositePendingUxHints[`${item.id}::${compositeKind}`] ??
                        "英文 prompt → GPT-IMAGE-2 · 合计常需 3～5 分钟，请勿中途刷新";
                      const currentImageUrl = platformImageMap[item.id] || "";
                      const isBlackImageOrTimeout =
                        currentImageUrl.includes("timeout") || currentImageUrl.includes("error");
                      const isGraphicCover = item.format === "图文" || item.format === "小红书";
                      /** 單張豎版封面統一按「圖文封面」定價扣點（與後端 generateTopicImage 一致），與選題是短視頻還是圖文無關 */
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
                        const topicHook = String(item.hook || headlineTitle || "").trim().slice(0, 500);
                        if (!topicHook) {
                          toast.error("选题缺少标题或钩子，无法生成");
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
                            confirmNote = `将为本选题生成竖版封面（单帧 GPT-IMAGE-2），消耗 ${normalCoverCost} 积分，是否继续？`;
                          } else {
                            confirmNote = `将为该选题重新生成竖版封面，消耗 ${normalCoverCost} 积分（沿用当前选题文案与人设锚点），是否继续？`;
                          }
                          if (!window.confirm(confirmNote)) return;
                        }
                        setRegeneratingCoverSceneId(item.id);
                        void runThrottledPlatformImageRequest(`single-cover:${item.id}`, () =>
                          runEnqueueTopicImageAndPoll({
                            topicHook,
                            format: isGraphicCover ? "图文" : "短视频",
                            context: buildPlatformSceneText({
                              title: headlineTitle,
                              hook: item.hook ?? "",
                              copywriting: item.copywriting ?? "",
                              executionDetails: (
                                item as {
                                  executionDetails?: {
                                    environmentAndWardrobe?: string;
                                    lightingAndCamera?: string;
                                  };
                                }
                              ).executionDetails,
                            }),
                            coverPersonaContext:
                              buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim() || undefined,
                            failedJobId: isEligibleFreeRetry ? sceneJobIds[item.id] : undefined,
                            sceneId: item.id,
                            pollDebugLabel: `单张选题封面 · ${item.id}`,
                          }),
                        )
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
                              toast.error("单帧生图失败，可稍后在本卡重试或联系支持。");
                            }
                            setRegeneratingCoverSceneId(null);
                          })
                          .catch((err) => {
                            setRegeneratingCoverSceneId(null);
                            toast.error(err.message || "操作失败");
                          });
                      };
                      const handleManualRegenerateCover = () => {
                        if (!isAuthenticated) {
                          toast.error("请先登录");
                          return;
                        }
                        const topicHook = String(item.hook || headlineTitle || "").trim().slice(0, 500);
                        if (!topicHook) {
                          toast.error("选题缺少标题或钩子，无法生成");
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
                        setRegeneratingCoverSceneId(item.id);
                        void runThrottledPlatformImageRequest(`manual-cover:${item.id}`, () =>
                          runEnqueueTopicImageAndPoll({
                            topicHook,
                            format: isGraphicCover ? "图文" : "短视频",
                            context: buildPlatformSceneText({
                              title: headlineTitle,
                              hook: item.hook ?? "",
                              copywriting: item.copywriting ?? "",
                              executionDetails: (
                                item as {
                                  executionDetails?: {
                                    environmentAndWardrobe?: string;
                                    lightingAndCamera?: string;
                                  };
                                }
                              ).executionDetails,
                            }),
                            coverPersonaContext:
                              buildCoverPersonaContextForImageGen(personaSummary, ipProfile).trim() || undefined,
                            failedJobId: isEligibleFreeRetry ? sceneJobIds[item.id] : undefined,
                            sceneId: item.id,
                            pollDebugLabel: `手动重生成 · ${item.id}`,
                          }),
                        )
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
                                "单帧生图失败，已记录任务。可再次尝试免费或付费补发。",
                              );
                            }
                            setRegeneratingCoverSceneId(null);
                          })
                          .catch((err) => {
                            setRegeneratingCoverSceneId(null);
                            toast.error(err.message || "操作失败");
                          });
                      };
                      const queueSilentImageLoadRetry = () => {
                        if (coverSilentRetryIds.has(item.id) || coverLoadRetriedIds.has(item.id)) return;
                        const topicHook = String(item.hook || headlineTitle || "").trim().slice(0, 500);
                        if (!topicHook) return;

                        /**
                         * 服务端免扣补发要求 failedJobId 对应行 status ∈ {failed,timeout}。
                         * 批量成功写入的 creationId 多为 completed — 不能当 failedJobId 传，否则 BAD_REQUEST
                         * 且客户端已清图 → 卡片空白（见 topic-1：Nano 成功但封面不显示）。
                         */
                        const rawUrl = platformImageMap[item.id] || "";
                        const urlLooksLikeServerRetryPayload =
                          rawUrl.toLowerCase().includes("timeout") || rawUrl.toLowerCase().includes("error");
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

                        const ctxBody = buildPlatformSceneText({
                          title: headlineTitle,
                          hook: item.hook ?? "",
                          copywriting: item.copywriting ?? "",
                          executionDetails: (
                            item as {
                              executionDetails?: {
                                environmentAndWardrobe?: string;
                                lightingAndCamera?: string;
                              };
                            }
                          ).executionDetails,
                        });
                        setCoverLoadRetriedIds((prev) => new Set(prev).add(item.id));
                        setPlatformImageMap((prev) => {
                          const next = { ...prev };
                          delete next[item.id];
                          return next;
                        });
                        setCoverSilentRetryIds((prev) => new Set(prev).add(item.id));
                        void runThrottledPlatformImageRequest(`silent-cover:${item.id}`, () =>
                          runEnqueueTopicImageAndPoll({
                            topicHook,
                            format: isGraphicCover ? "图文" : "短视频",
                            context: ctxBody,
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
                      return (
                      <div
                        key={item.id}
                        id={executionCardDomId(item.id)}
                        className="group scroll-mt-28 flex flex-col rounded-2xl border border-white/10 bg-white/5 p-5"
                      >
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
                          <p className="mt-3 whitespace-normal break-words text-sm leading-relaxed text-gray-400">
                            {copyFlat}
                          </p>
                        ) : null}
                        <details className="mb-4 mt-3 cursor-pointer text-xs text-gray-500">
                          <summary className="cursor-pointer select-none text-[15px] font-black text-[#ff9900] animate-pulse transition-colors hover:text-[#ffb84d]">
                            ▶ 执行细项、分镜与发布（点击展开查看详细步骤）
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
                                <strong className="text-[#9ddcff]">灯光 &amp; 机位：</strong>
                                {(item as any).executionDetails.lightingAndCamera}
                              </p>
                            ) : null}
                            {Array.isArray((item as any).executionDetails?.stepByStepScript) &&
                            (item as any).executionDetails.stepByStepScript.length > 0 ? (
                              <div>
                                <strong className="text-[#9ddcff]">逐步执行脚本：</strong>
                                <div className="mt-1 space-y-1">
                                  {(item as any).executionDetails.stepByStepScript.map((step: string, si: number) => (
                                    <div key={si}>{step}</div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {Array.isArray((item as any).actionableSteps) && (item as any).actionableSteps.length > 0 ? (
                              <div>
                                <strong className="text-[#9ddcff]">落地三步曲：</strong>
                                <div className="mt-1 space-y-1">
                                  {(item as any).actionableSteps.map((step: string, si: number) => (
                                    <div key={si}>
                                      {si + 1}. {step}
                                    </div>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                            {(item as any).publishingAdvice ? (
                              <p>
                                <strong className="text-[#9ddcff]">发布建议：</strong>
                                {(item as any).publishingAdvice}
                              </p>
                            ) : null}
                            {(item as any).detailedScript ? (
                              <div>
                                <strong className="text-[#9ddcff]">详细脚本与大纲：</strong>
                                <div className="mt-1 whitespace-pre-wrap text-sm">{(item as any).detailedScript}</div>
                              </div>
                            ) : null}
                            {item.hook || item.copywriting ? (
                              <div className="border-t border-white/10 pt-2.5">
                                <strong className="text-[#9ddcff]">钩子与完整文案</strong>
                                {item.hook ? (
                                  <div className="mt-1 text-sm leading-7 text-[#8cefff]">{item.hook}</div>
                                ) : null}
                                <div className="mt-1 whitespace-pre-wrap text-sm">{renderHighlightText(item.copywriting || "")}</div>
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
                              <div className="flex items-center justify-between border-t border-white/10 bg-[rgba(14,9,32,0.88)] p-2 px-3">
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
                                      regeneratingCoverSceneId !== null ||
                                      compositeMutationBusy ||
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
                                        regeneratingCoverSceneId === item.id
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
                          ) : (regeneratingCoverSceneId === item.id ||
                              isSequentialCoverBatchGenerating ||
                              batchGeneratingCoverIds.has(item.id) ||
                              coverSilentRetryIds.has(item.id)) &&
                            !platformImageMap[item.id] ? (
                            <div className="flex w-full aspect-[9/16] flex-col items-center justify-center gap-3 rounded-xl border border-white/5 bg-[#0a0a0a]/60 animate-pulse">
                              <Loader2 className="h-7 w-7 animate-spin text-[#ff4fb8]/70" />
                              <span className="text-xs font-medium tracking-widest text-gray-400 px-3 text-center">
                                {regeneratingCoverSceneId === item.id ? "单帧重新绘制中..." : coverSilentRetryIds.has(item.id) ? "检测到异常，正在自动重试补救..." : batchGeneratingCoverIds.has(item.id) ? "异步逐张生成中..." : "高定视觉绘制中..."}
                              </span>
                            </div>
                          ) : null}
                        </div>

                        <div className="mt-4 space-y-3 rounded-xl border border-[#2b1f52] bg-[rgba(18,13,43,0.55)] p-3">
                          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-[11px] tracking-[0.08em]">
                            <span className="uppercase text-[#9ddcff]">原生 2×4</span>
                            <span className="text-gray-500">·</span>
                            <span className="text-[#9ddcff]">生图采用</span>{" "}
                            <span
                              className="font-black uppercase tracking-[0.14em] text-[#49e6ff] [text-shadow:0_0_14px_rgba(73,230,255,0.55)]"
                              title="GPT-IMAGE-2"
                            >
                              GPT-IMAGE-2
                            </span>
                            <span className="normal-case tracking-normal text-[10px] leading-none text-gray-500">
                              · 依选题自动匹配 · 视频 {CREDIT_COSTS.platformStoryboardSheet} 点 · 图文/小红书{" "}
                              {CREDIT_COSTS.platformXhsDualNote} 点
                            </span>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              disabled={!isAuthenticated || compositeMutationBusy || isDashboardLoading || isContentLoading}
                              onClick={() => {
                                if (!isAuthenticated) {
                                  toast.error("请先登录");
                                  return;
                                }
                                const note = supervisorAccess
                                  ? ""
                                  : `将消耗 ${compositeCost} 积分，主路径 GPT-IMAGE-2，生成${compositeLabel}，是否继续？`;
                                if (!supervisorAccess && !window.confirm(note)) return;
                                void runThrottledPlatformImageRequest(`composite:${item.id}:${compositeKind}`, () =>
                                  generatePlatformCompositeSheetMutation.mutateAsync({
                                    sceneId: item.id,
                                    title: headlineTitle,
                                    scriptContext: buildPlatformSheetScriptContext(item as any),
                                    kind: compositeKind,
                                    executionDetails: buildPlatformExecutionDetailsPayload(item as any),
                                    creationRecordId: readOptionalReportBindingCreationId(),
                                    imagePromptTranslator: effectiveCompositeImagePromptTranslator,
                                    progressJobId: newPlatformCompositeProgressJobId(),
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
                                compositeMutationBusy ||
                                isSequentialCoverBatchGenerating ||
                                regeneratingCoverSceneId !== null ||
                                batchGeneratingCoverIds.has(item.id) ||
                                coverSilentRetryIds.has(item.id) ||
                                isDashboardLoading ||
                                isContentLoading
                              }
                              onClick={handleGenerateSingleCoverFooter}
                              className={`inline-flex min-h-[2.25rem] items-center gap-1.5 rounded-lg border border-[#ff4fb8]/45 bg-[#ff4fb8]/12 px-3 py-2 text-xs font-bold text-[#ff9fe0] transition hover:bg-[#ff4fb8]/22 ${
                                compositeMutationBusy && !isThisCompositeLoading ? "opacity-45" : ""
                              } ${regeneratingCoverSceneId === item.id ? "cursor-wait ring-2 ring-[#ff4fb8]/35 opacity-95 [&:disabled]:opacity-95" : ""}`}
                              title={
                                isEligibleFreeRetry
                                  ? "检测到黑图，本次可走免费补救链路（免扣积分）"
                                  : `仅此选题生成竖版封面单帧 · ${normalCoverCost} 点`
                              }
                            >
                              {regeneratingCoverSceneId === item.id ? (
                                <span className="inline-flex items-center gap-1.5">
                                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                                  封面生成中…
                                </span>
                              ) : (
                                <>
                                  <Image className="h-3.5 w-3.5 shrink-0 opacity-95" aria-hidden />
                                  {`生成单张封面 · ${singleCoverFooterPointsLabel}`}
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
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Rocket className="h-4 w-4 text-[#49e6ff]" />
                  视频怎么拍 / 图文怎么写
                </div>
                <div className="mt-5 space-y-3">
                  {/* Show loading skeleton while Call 3 is running */}
                  {isContentLoading && executionBlueprint.length === 0 ? (
                    <div className="flex h-24 w-full animate-pulse flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#8cefff]/60">
                      <Loader2 className="mb-2 h-5 w-5 animate-spin" />
                      <span className="text-sm">正在重构开场三秒钩子、搭建高留存内容骨架...</span>
                    </div>
                  ) : executionBlueprint.length === 0 ? (
                    <div className="flex h-24 w-full flex-col items-center justify-center rounded-2xl border border-white/5 bg-[rgba(255,255,255,0.02)] text-center text-[#c9c0e6]/60 text-sm">
                      完成平台分析后将显示专属执行细节
                    </div>
                  ) : (
                    executionBlueprint.map((item) => (
                      <div key={item.label} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                        <div className="text-sm font-semibold text-white">{item.label}</div>
                        <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.detail}</div>
                      </div>
                    ))
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
            </div>

            <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
              <div className={shellCardClasses("p-6")}>
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
            {/* Feature #6c: Trend Report Generator — supervisor bypass credits */}
            <div className="grid gap-4">
              <ReportGeneratorPanel supervisorAccess={supervisorAccess} />
            </div>
            {/* PDF Download — captures current rendered page via Cloud Run Puppeteer */}
            {hasAnalyzed && (
              <div className="mt-4 space-y-3">
                {/* 时效性提醒 */}
                <div className="flex items-start gap-3 rounded-xl border border-amber-400/30 bg-amber-400/10 px-4 py-3 text-sm text-amber-300">
                  <span className="text-lg leading-none mt-0.5">⚡</span>
                  <div>
                    <div className="font-semibold mb-0.5">分析结果具有时效性</div>
                    <div className="text-xs text-amber-200/80">平台数据每日更新，本次分析基于当前时间点快照。建议立即下载 PDF 保存，下载后快照记录将同步保存至「我的作品」。</div>
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

        {/* 邀请码管理已迁移至 /admin 页面 */}
      </div>
    </div>
  );
}
