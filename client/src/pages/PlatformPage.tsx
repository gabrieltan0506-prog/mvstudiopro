import React, { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import type {
  GrowthAnalysisScores,
  GrowthMonetizationStrategy,
  GrowthPlatformActivity,
  GrowthPlatformRecommendation,
  GrowthSnapshot,
  GrowthTitleExecution,
} from "@shared/growth";
import {
  ArrowLeft,
  Bot,
  CalendarRange,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Loader2,
  MessageSquareText,
  Rocket,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";

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
  topSignals: Array<{ title: string; detail: string; badge?: string }>;
  platformMenu: Array<{
    platform: string;
    label: string;
    trend: string;
    lane: string;
    whyNow: string;
    recommendedFormat?: string;
    titleExample?: string;
    contentHook?: string;
    nextMove: string;
    monetizationPath?: string;
  }>;
  hotTopics: Array<{ title: string; whyHot: string; howToUse: string }>;
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
  conversationStarters: string[];
};

type ProcessingStepCard = {
  id: string;
  label: string;
  detail: string;
  status: "done" | "active" | "pending";
};

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

export default function PlatformPage() {
  const [supervisorAccess] = useState(() => hasSupervisorAccess());
  const [debugMode, setDebugMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return hasSupervisorAccess() && new URLSearchParams(window.location.search).get("debug") === "1";
  });
  const { isAuthenticated, loading } = useAuth({
    autoFetch: !supervisorAccess,
    redirectOnUnauthenticated: !supervisorAccess,
    redirectPath: getLoginUrl(),
  });
  const [selectedWindowDays, setSelectedWindowDays] = useState<15 | 30 | 45>(15);
  const [focusPrompt, setFocusPrompt] = useState("");
  const [hasAnalyzed, setHasAnalyzed] = useState(false);
  const [question, setQuestion] = useState("");
  const [askResult, setAskResult] = useState<AskResult | null>(null);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [rotatingCardIndex, setRotatingCardIndex] = useState(0);
  // Separate state for dashboard — populated by the second call after snapshot loads
  const [platformDashboard, setPlatformDashboard] = useState<PlatformDashboard | null>(null);
  const [dashboardDebug, setDashboardDebug] = useState<Record<string, unknown> | null>(null);
  const [isDashboardLoading, setIsDashboardLoading] = useState(false);
  // Call 3 state — content blueprints and monetization
  const [platformContent, setPlatformContent] = useState<{ contentBlueprints: PlatformDashboard["contentBlueprints"]; monetizationLanes: PlatformDashboard["monetizationLanes"] } | null>(null);
  const [contentDebug, setContentDebug] = useState<Record<string, unknown> | null>(null);
  const [isContentLoading, setIsContentLoading] = useState(false);

  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: focusPrompt || undefined,
      modelName: "gemini-2.5-pro",
      requestedPlatforms: ["douyin", "xiaohongshu", "bilibili", "kuaishou"],
      analysis: EMPTY_ANALYSIS,
      windowDays: selectedWindowDays,
      interactivePlatform: true,
    },
    {
      enabled: false,
      staleTime: 300_000,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      refetchOnMount: false,
      retry: false,
    },
  );

  const getPlatformDashboardMutation = trpc.mvAnalysis.getPlatformDashboard.useMutation({
    onSuccess: (result) => {
      if (result.platformDashboard) {
        setPlatformDashboard(result.platformDashboard as PlatformDashboard);
        // Chain Call 3 immediately after Call 2 succeeds
        setIsContentLoading(true);
        getPlatformContentMutation.mutate({
          context: focusPrompt || undefined,
          windowDays: selectedWindowDays,
          platformMenu: (result.platformDashboard as PlatformDashboard).platformMenu,
          snapshotSummary: (getPlatformDashboardMutation.variables as any)?.snapshotSummary || {},
        });
      }
      setDashboardDebug(result.debug as Record<string, unknown>);
      setIsDashboardLoading(false);
    },
    onError: (error) => {
      console.warn("[PlatformPage] dashboard mutation error:", error.message);
      setIsDashboardLoading(false);
    },
  });

  const getPlatformContentMutation = trpc.mvAnalysis.getPlatformContent.useMutation({
    onSuccess: (result) => {
      if (result.platformContent) {
        setPlatformContent(result.platformContent as any);
      }
      setContentDebug(result.debug as Record<string, unknown>);
      setIsContentLoading(false);
    },
    onError: (error) => {
      console.warn("[PlatformPage] content mutation error:", error.message);
      setIsContentLoading(false);
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
  const recommendedPlatforms = useMemo(() => snapshot?.platformRecommendations.slice(0, 4) ?? [], [snapshot]);
  const actionSteps = useMemo(
    () => {
      if (validationPlan.length) {
        return validationPlan.slice(0, 4).map((item, index) => ({
          day: index + 1,
          title: cleanUserCopy(item.label, `第 ${index + 1} 步`),
          action: cleanUserCopy(item.nextMove || item.successSignal, "先做一轮小样本验证。"),
        }));
      }
      return platformDashboard?.actionCards.length
        ? platformDashboard.actionCards.map((item, index) => ({
            day: index + 1,
            title: cleanUserCopy(item.title, `第 ${index + 1} 步`),
            action: cleanUserCopy(item.detail, "先做一个可以快速拿到反馈的动作。"),
          }))
        : (snapshot?.growthPlan.slice(0, 4) ?? []).map((item, index) => ({
            day: index + 1,
            title: cleanUserCopy(item.title, `第 ${index + 1} 步`),
            action: cleanUserCopy(item.action, "先做一轮小样本验证。"),
          }));
    },
    [platformDashboard, snapshot, validationPlan],
  );
  const keyInsights = useMemo(
    () =>
      platformDashboard?.topSignals.length
        ? platformDashboard.topSignals.map((item: any) => typeof item === "string"
            ? { title: item, detail: "", badge: "" }
            : { title: item.title || "", detail: item.detail || item.desc || item.description || "", badge: item.badge || "" })
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
    if (mainPath?.title) return cleanUserCopy(mainPath.title, mainPath.title);
    if (platformDashboard?.headline) return platformDashboard.headline;
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
        value: cleanUserCopy(topMonetization?.primaryTrack || snapshot.businessInsights[0]?.title || "先收口一个可承接方向", "先收口一个可承接方向"),
        detail: cleanUserCopy(topMonetization?.strategy || snapshot.businessInsights[0]?.detail || "把内容先做成有人愿意继续咨询或收藏的版本。", "把内容先做成有人愿意继续咨询或收藏的版本。"),
      },
      {
        label: "首发动作",
        value: cleanUserCopy(assetAdaptation?.firstHook || titleExecutions[0]?.openingHook || validationPlan[0]?.label || "先写出第一条内容", "先写出第一条内容"),
        detail: cleanUserCopy(validationPlan[0]?.nextMove || assetAdaptation?.structure || "先做一轮小样本验证，再决定是否放大。", "先做一轮小样本验证，再决定是否放大。"),
      },
    ];
  }, [assetAdaptation, businessTranslation, mainPath, recommendationHeadline, snapshot, titleExecutions, topMonetization, topRecommendation, validationPlan]);

  const platformDecisionRows = useMemo(
    () => {
      if (platformDashboard?.platformMenu.length) {
        return platformDashboard.platformMenu.slice(0, 4).map((item: any, index: number) => ({
          id: `${item.platform || item.name || index}-${item.label || index}`,
          name: item.label || item.name || item.platform || `平台 ${index + 1}`,
          lane: cleanUserCopy(item.lane || item.contentAngle || "", item.label || `平台 ${index + 1}`),
          trend: cleanUserCopy(item.recommendedFormat || item.trend || item.format || "", "先从更顺手的表达方式切入"),
          whyNow: cleanUserCopy(item.whyNow || item.reason || item.summary || "", "当前窗口里，这个平台更容易拿到第一轮反馈。"),
          nextMove: cleanUserCopy(item.titleExample || item.nextMove || item.action || "", "先发一版内容拿反馈。"),
          hook: cleanUserCopy(item.contentHook || item.hook || item.nextMove || "", "先把第一句判断说出来。"),
          monetization: cleanUserCopy(item.monetizationPath || item.monetization || "", ""),
        }));
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
          nextMove: cleanUserCopy(item.action || activity?.optimizationPlan || validationPlan[index]?.nextMove || "先拿一版首发内容验证反馈。", "先拿一版首发内容验证反馈。"),
          hook: cleanUserCopy(titleExecutions[index]?.openingHook || titleExecutions[index]?.copywriting || "", ""),
          monetization: cleanUserCopy(monetizationStrategies[index]?.primaryTrack || "", ""),
        };
      });
    },
    [monetizationStrategies, platformActivities, platformDashboard, primaryPlatforms, recommendedPlatforms, snapshot, titleExecutions, validationPlan],
  );

  const monetizationCards = useMemo(() => {
    try {
      // Prefer Call 3 result, fall back to Call 2, then snapshot
      const rawSource = platformContent?.monetizationLanes?.length
        ? platformContent.monetizationLanes
        : platformDashboard?.monetizationLanes?.length ? platformDashboard.monetizationLanes : null;
      // Normalize each item: ensure revenueModes is always an array
      const monetizationSource = Array.isArray(rawSource)
        ? rawSource.map((it: any) => ({ ...it, revenueModes: Array.isArray(it?.revenueModes) ? it.revenueModes : [] }))
        : null;
      if (monetizationSource?.length) {
        return monetizationSource.slice(0, 2).map((item: any, index: number) => ({
          id: `${item.title || index}-${index}`,
          title: cleanUserCopy(item.title || "", `变现路径 ${index + 1}`),
          summary: cleanUserCopy(item.fitReason || item.summary || "", "这条变现方式更符合你当前内容和身份。"),
          action: cleanUserCopy([item.offerShape, ...item.revenueModes, item.firstValidation].filter(Boolean).join(" / "), "先做一轮轻量验证。"),
        }));
      }
      if (monetizationStrategies.length) {
        return monetizationStrategies.slice(0, 2).map((item: GrowthMonetizationStrategy, index) => ({
          id: `${item.platform}-${index}`,
          title: `${item.platformLabel}：${cleanUserCopy(item.primaryTrack, item.primaryTrack)}`,
          summary: cleanUserCopy(item.reason || item.strategy, "先把内容承接到一个更容易转化的服务或产品形态。"),
          action: cleanUserCopy(item.callToAction || item.offerType || actionSteps[index]?.action || "先用轻量服务承接第一波需求。", "先用轻量服务承接第一波需求。"),
        }));
      }
      const businessInsights = snapshot?.businessInsights.slice(0, 2) ?? [];
      return businessInsights.map((item, index) => ({
        id: `${item.title}-${index}`,
        title: cleanUserCopy(item.title, `商业化切口 ${index + 1}`),
        summary: cleanUserCopy(item.detail, "先把内容方向和承接方式收成一条清晰路径。"),
        action: cleanUserCopy(actionSteps[index]?.action || platformDecisionRows[index]?.nextMove || "先做一个最容易拿到反馈的轻量承接。", "先做一个最容易拿到反馈的轻量承接。"),
      }));
    } catch (err) {
      console.error("[monetizationCards] render error:", err);
      return [];
    }
  }, [actionSteps, monetizationStrategies, platformDecisionRows, snapshot, platformContent, platformDashboard]);

  const contentExecutionCards = useMemo(() => {
    // Prefer Call 3 result, fall back to Call 2, then snapshot
    const blueprintsSource = platformContent?.contentBlueprints?.length
      ? platformContent.contentBlueprints
      : platformDashboard?.contentBlueprints?.length ? platformDashboard.contentBlueprints : null;
    if (blueprintsSource?.length) {
      return blueprintsSource.slice(0, 4).map((item: any, index: number) => ({
        id: `${item.title || index}-${index}`,
        title: cleanUserCopy(item.title || "", `内容方案 ${index + 1}`),
        hook: cleanUserCopy(item.hook || item.openingHook || "", "先用一句明确判断开头。"),
        copywriting: cleanUserCopy(item.copywriting || item.body || "", "把这条内容写成用户一看就知道你在解决什么问题的版本。"),
        production: cleanUserCopy(
          (item.format || "") === "图文" ? (item.graphicPlan || item.videoPlan || "") : (item.videoPlan || item.graphicPlan || ""),
          (item.format || "") === "图文" ? "图文先给判断，再补案例和行动。" : "视频开头先给判断，中段给例子，结尾给行动引导。",
        ),
        format: item.format,
      }));
    }
    if (titleExecutions.length) {
      return titleExecutions.slice(0, 4).map((item: GrowthTitleExecution, index) => ({
        id: `${item.title}-${index}`,
        title: cleanUserCopy(item.title, `内容方案 ${index + 1}`),
        hook: cleanUserCopy(item.openingHook || item.copywriting, "先用一句明确判断开头。"),
        copywriting: cleanUserCopy(item.copywriting, "把这条内容写成用户一看就知道你在解决什么问题的版本。"),
        production: cleanUserCopy(
          item.presentationMode === "图文" ? item.graphicPlan || item.videoPlan : item.videoPlan || item.graphicPlan,
          item.presentationMode === "图文" ? "图文先给判断，再补案例和行动。" : "视频开头先给判断，中段给例子，结尾给行动引导。",
        ),
        format: item.presentationMode,
      }));
    }

    return topTopics.slice(0, 4).map((item, index) => ({
      id: `${item.title}-${index}`,
      title: cleanUserCopy(item.title, `内容方案 ${index + 1}`),
      hook: cleanUserCopy(item.howToUse, "先把用户最关心的问题直接说出来。"),
      copywriting: cleanUserCopy(item.whyHot, "围绕这个切口写成用户能立刻代入的内容。"),
      production: cleanUserCopy(actionSteps[index]?.action || "先做一个短平快版本看反馈。", "先做一个短平快版本看反馈。"),
      format: recommendedPlatforms[index]?.topicIdeas?.[0] ? "短视频" : "图文",
    }));
  }, [actionSteps, platformDashboard, platformContent, recommendedPlatforms, titleExecutions, topTopics]);

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
    () => cleanUserCopy(platformDashboard?.personaSummary || "", "把专业身份和中国文化审美结合成一个更容易建立信任的IP入口。"),
    [platformDashboard],
  );

  const executionBlueprint = useMemo(
    () => [
      {
        label: "内容开头",
        detail: cleanUserCopy(assetAdaptation?.firstHook || contentExecutionCards[0]?.hook || "", "开头 3 秒先讲你适合谁、解决什么、为什么值得看。"),
      },
      {
        label: "内容结构",
        detail: cleanUserCopy(assetAdaptation?.structure || contentExecutionCards[0]?.copywriting || "", "先给判断，再给案例，再给用户可执行动作。"),
      },
      {
        label: "行动引导",
        detail: cleanUserCopy(assetAdaptation?.callToAction || topMonetization?.callToAction || "", "结尾只留一个最直接的动作，让用户愿意继续问或收藏。"),
      },
    ].filter((item) => item.detail),
    [assetAdaptation, contentExecutionCards, topMonetization],
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
    const platformCards = primaryPlatforms.slice(0, 3).map((item) => ({
      title: `${item.displayName} 当前信号`,
      summary: item.summary,
      detail: `动量 ${item.momentumScore} / 适配 ${item.audienceFitScore} / 竞争 ${item.competitionLevel}`,
      tone: "platform",
    }));
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
    return [...platformCards, ...topicCards, ...actionCards].length ? [...platformCards, ...topicCards, ...actionCards] : fallback;
  }, [actionSteps, primaryPlatforms, topTopics]);
  const activeRotatingCard = immersiveRotatingCards[rotatingCardIndex % immersiveRotatingCards.length] || null;

  useEffect(() => {
    if (!isAnalyzing) {
      setElapsedTime(0);
      setRotatingCardIndex(0);
      return;
    }
    const timer = window.setInterval(() => {
      setElapsedTime((value) => value + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isAnalyzing]);

  useEffect(() => {
    if (!isAnalyzing || immersiveRotatingCards.length <= 1) return;
    const timer = window.setInterval(() => {
      setRotatingCardIndex((value) => (value + 1) % immersiveRotatingCards.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [immersiveRotatingCards.length, isAnalyzing]);

  const handleAnalyze = async () => {
    setAskResult(null);
    setPlatformDashboard(null);
    setDashboardDebug(null);
    setIsDashboardLoading(false);
    setPlatformContent(null);
    setContentDebug(null);
    setIsContentLoading(false);
    setElapsedTime(0);
    setRotatingCardIndex(0);

    // Call 1: fast snapshot (skips dashboard)
    const result = await growthSnapshotQuery.refetch();
    if (!result.data?.snapshot) {
      toast.error("平台分析暂时没有返回结果");
      return;
    }
    setHasAnalyzed(true);
    toast.success(`快照已生成，正在进行深度分析...`);

    // Call 2: dashboard LLM (separate mutation, 120s budget)
    // Send slim snapshotSummary to avoid 503 on large POST body
    const snap = result.data.snapshot;
    setIsDashboardLoading(true);
    getPlatformDashboardMutation.mutate({
      context: focusPrompt || undefined,
      windowDays: selectedWindowDays,
      requestedPlatforms: ["douyin", "xiaohongshu", "bilibili", "kuaishou"],
      snapshotSummary: {
        overview: snap.overview,
        platformSnapshots: snap.platformSnapshots.slice(0, 4).map((item) => ({
          platform: item.platform,
          displayName: item.displayName,
          audienceFitScore: item.audienceFitScore,
          momentumScore: item.momentumScore,
          summary: item.summary,
          fitLabel: item.fitLabel,
          sampleTopics: item.sampleTopics?.slice(0, 4),
        })),
        platformRecommendations: snap.platformRecommendations.slice(0, 3).map((item) => ({
          name: item.name,
          reason: item.reason,
          action: item.action,
        })),
        topicLibrary: snap.topicLibrary.slice(0, 5).map((item) => ({
          title: item.title,
          rationale: item.rationale,
          executionHint: item.executionHint,
        })),
        monetizationStrategies: snap.monetizationStrategies.slice(0, 2).map((item) => ({
          platformLabel: item.platformLabel,
          primaryTrack: item.primaryTrack,
          offerType: item.offerType,
        })),
        mainPath: {
          title: snap.decisionFramework.mainPath.title,
          summary: snap.decisionFramework.mainPath.summary,
          whyNow: snap.decisionFramework.mainPath.whyNow,
        },
      },
    });
  };

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
    await askPlatformFollowUpMutation.mutateAsync({
      question: finalQuestion,
      context: focusPrompt || undefined,
      windowDays: selectedWindowDays,
      snapshot,
    });
  };

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
      <div className="mx-auto max-w-[1500px] px-4 py-6 md:px-6 md:py-8">
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

        {supervisorAccess ? (
          <div className="mb-6 flex items-center justify-end">
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

        <section className={shellCardClasses("overflow-hidden p-6 md:p-8")}>
          <div className="absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(73,230,255,0.55),transparent)]" />
          <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#362561] bg-[rgba(23,13,53,0.9)] px-3 py-1 text-xs uppercase tracking-[0.22em] text-[#aa95dc]">
                <TrendingUp className="h-3.5 w-3.5" />
                平台顾问台
              </div>
              <h1 className="mt-5 max-w-5xl text-[40px] font-black leading-[0.92] text-white md:text-[64px] xl:text-[76px]">
                不是告诉你“平台都能做”
                <span className="mt-2 block bg-[linear-gradient(135deg,#5af2ff,#7d73ff_45%,#ff75bd_85%)] bg-clip-text text-transparent">
                  而是告诉你 {personalizedSubject} 现在该先打哪里
                </span>
              </h1>
              <p className="mt-5 max-w-3xl text-sm leading-8 text-[#d3caef] md:text-base">
                {personaSummary}
              </p>
              <p className="mt-3 max-w-3xl text-sm leading-8 text-[#b8afd9] md:text-[15px]">
                {platformDashboard?.subheadline
                  || "这个页面不做视频上传，不做二创，不讲空泛平台画像。它只解决三件事：当前时间窗口里，哪个平台值得优先做；热点赛道该怎么切；以及你怎样把这轮内容机会变成真实商业承接。"}
              </p>

              <div className="mt-6 grid gap-3 md:grid-cols-3">
                {heroTrustPoints.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">{item.label}</div>
                    <div className="mt-2 text-sm leading-7 text-white">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="grid gap-4">
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
                <textarea
                  value={focusPrompt}
                  onChange={(event) => setFocusPrompt(event.target.value)}
                  placeholder="例如：我现在是做女性健康/本地服务，想知道先做小红书还是抖音；应该先做图文、短视频，还是先验证某个商业化切口。"
                  className="mt-4 min-h-[136px] w-full rounded-2xl border border-white/10 bg-[#0c061e] px-4 py-3 text-sm leading-7 text-white outline-none transition focus:border-[#49e6ff]/35"
                />
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={() => void handleAnalyze()}
                    disabled={growthSnapshotQuery.isFetching}
                    className="inline-flex items-center gap-2 rounded-full border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#15c8ff,#6a5cff,#b25cff)] px-5 py-3 text-sm font-semibold text-white shadow-[0_12px_40px_rgba(73,230,255,0.18)] transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {growthSnapshotQuery.isFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    开始平台分析
                  </button>
                  <div className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-xs text-[#c8bfe7]">
                    分析模型：Gemini 2.5 Pro
                  </div>
                  {hasAnalyzed ? (
                    <div className="rounded-full border border-[#2f2260] bg-[#130b31] px-4 py-2 text-xs text-[#8cefff]">
                      当前窗口：近 {selectedWindowDays} 天
                    </div>
                  ) : null}
                </div>
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

            <div className={shellCardClasses("p-6")}>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Sparkles className="h-4 w-4 text-[#ffdd44]" />
                    轮播看板
                  </div>
                  <div className="mt-2 text-sm leading-7 text-[#c8bfe7]">
                    在报告生成过程中，先把当前窗口里最关键的平台、热点和承接线索轮播出来，避免用户空等。
                  </div>
                </div>
                <div className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-[#b7add8]">
                  每 4.5 秒轮播
                </div>
              </div>
              {activeRotatingCard ? (
                <div className="mt-5 rounded-[28px] border border-[#2f2558] bg-[linear-gradient(135deg,rgba(73,230,255,0.10),rgba(125,115,255,0.08),rgba(255,117,189,0.08))] p-6">
                  <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">
                    {activeRotatingCard.tone === "platform" ? "平台信号" : activeRotatingCard.tone === "topic" ? "热点切口" : "动作建议"}
                  </div>
                  <div className="mt-3 text-2xl font-bold text-white">{activeRotatingCard.title}</div>
                  <div className="mt-4 text-sm leading-8 text-[#eef5ff]">{activeRotatingCard.summary}</div>
                  <div className="mt-4 rounded-2xl border border-white/10 bg-[rgba(9,6,24,0.36)] p-4 text-sm leading-7 text-[#d3caef]">
                    {activeRotatingCard.detail}
                  </div>
                </div>
              ) : null}
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                {immersiveRotatingCards.slice(0, 3).map((item, index) => (
                  <div key={`${item.title}-${index}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                    <div className="text-sm font-semibold text-white">{item.title}</div>
                    <div className="mt-2 text-sm leading-7 text-[#c8bfe7]">{item.summary}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          {resultSummaryCards.map((item, index) => (
            <div key={`${item.label}-${index}`} className={shellCardClasses("p-5")}>
              <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff]">{item.label}</div>
              <div className="mt-3 text-xl font-bold leading-8 text-white">{item.value}</div>
              <div className="mt-3 text-sm leading-7 text-[#c9c0e6]">{item.detail}</div>
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
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ffdd44]">分析步骤</div>
                  <div className="mt-3 space-y-2 text-xs leading-6 text-[#d7d0ef]">
                    <div>1. getGrowthSnapshot: {growthSnapshotQuery.isFetched ? `已返回 (${snapshotDebug?.baseSource})` : growthSnapshotQuery.isFetching ? "进行中" : "未开始"}</div>
                    <div>2. hasAnyLiveCollection: {String(snapshotDebug?.hasAnyLiveCollection ?? "?")}</div>
                    <div>3. storeMs: {String((snapshotDebug?.timing as any)?.storeMs ?? "?")}</div>
                    <div>4. getPlatformDashboard (Call 2): {isDashboardLoading ? "进行中" : getPlatformDashboardMutation.isSuccess ? (platformDashboard ? `已返回 (${dashboardDebug?.totalMs ?? "?"}ms)` : `返回null${dashboardDebug?.error ? ` — 错误: ${dashboardDebug.error}` : ""}`) : getPlatformDashboardMutation.isError ? `错误: ${getPlatformDashboardMutation.error?.message}` : "未开始"}</div>
                    <div>5. getPlatformContent (Call 3): {isContentLoading ? "进行中" : getPlatformContentMutation.isSuccess ? (platformContent ? `已返回 (${contentDebug?.totalMs ?? "?"}ms)` : "返回null") : getPlatformContentMutation.isError ? `错误: ${getPlatformContentMutation.error?.message}` : "未开始"}</div>
                  </div>
                </div>
                <div className="rounded-2xl border border-[#2b1f52] bg-[#140b31] p-4">
                  <div className="text-xs uppercase tracking-[0.16em] text-[#ff7fd5]">错误</div>
                  <div className="mt-3 whitespace-pre-wrap text-xs leading-6 text-[#d7d0ef]">
                    {String(growthSnapshotQuery.error?.message || getPlatformDashboardMutation.error?.message || dashboardDebug?.error || "-")}
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
              </div>
            </div>
          </section>
        ) : null}

        {/* Show loading state while waiting for dashboard (Call 2) */}
        {snapshot && !platformDashboard && isDashboardLoading ? (
          <section className="mt-6">
            <div className={shellCardClasses("p-6")}>
              <div className="flex items-center gap-3">
                <Loader2 className="h-5 w-5 animate-spin text-[#49e6ff]" />
                <div>
                  <div className="text-sm font-semibold text-white">平台数据已就绪，正在生成个性化分析...</div>
                  <div className="mt-1 text-xs text-[#b7add8]">Gemini 2.5 Pro 正在根据你的背景生成专属平台策略与选题文案，通常需要 30–90 秒。</div>
                </div>
              </div>
            </div>
          </section>
        ) : null}

        {snapshot && platformDashboard ? (
          <section className="mt-8 space-y-6">
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
                      <div>4. getPlatformDashboard: {isDashboardLoading ? "进行中" : getPlatformDashboardMutation.isSuccess ? (platformDashboard ? "已返回结果" : "返回null(LLM超时)") : getPlatformDashboardMutation.isError ? `错误: ${getPlatformDashboardMutation.error?.message}` : "未开始"}</div>
                      <div>5. hasPlatformDashboard: {String(Boolean(platformDashboard))}</div>
                      <div>6. 继续追问: {askPlatformFollowUpMutation.isSuccess ? "已返回" : askPlatformFollowUpMutation.isPending ? "进行中" : "未开始"}</div>
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
              </div>
            ) : null}

            <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
              <div className={shellCardClasses("p-6")}>
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

                <div className="mt-6 grid gap-3 md:grid-cols-3">
                  {keyInsights.slice(0, 3).map((item, index) => (
                    <div key={`${item.title}-${index}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        {item.badge ? (
                          <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-[11px] text-[#8cefff]">
                            {item.badge}
                          </div>
                        ) : null}
                      </div>
                      <div className="mt-3 text-sm leading-7 text-[#c9c0e6]">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Clock3 className="h-4 w-4 text-[#ffdd44]" />
                  这页会帮你直接判断
                </div>
                <div className="mt-4 space-y-3">
                  {evidenceNotes.map((item, index) => (
                    <div key={`${item}-${index}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4 text-sm leading-7 text-[#d3caef]">
                      {item}
                    </div>
                  ))}
                </div>
                <div className="mt-4 rounded-2xl border border-[#2f2558] bg-[linear-gradient(135deg,rgba(73,230,255,0.08),rgba(255,117,189,0.06))] p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-[#8cefff]">顾问结论风格</div>
                  <div className="mt-2 text-sm leading-7 text-white">
                    先给判断，再给原因，再给动作建议；不讲“可能都可以”，而是明确告诉你先从哪里试，哪里暂时别浪费时间。
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.15fr_0.85fr]">
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
                          <div className="mt-3 text-sm leading-7 text-[#b9afd9]">{item.trend}</div>
                        </div>
                        <div className="rounded-full border border-white/10 bg-[rgba(255,255,255,0.04)] px-3 py-2 text-xs text-[#d6cdf0]">
                          {item.lane}
                        </div>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        <div className="rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-4">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[#9ddcff]">为什么现在做</div>
                          <div className="mt-2 text-sm leading-7 text-white">{item.whyNow}</div>
                        </div>
                        <div className="rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-4">
                          <div className="text-[11px] uppercase tracking-[0.18em] text-[#ffdd44]">建议动作</div>
                          <div className="mt-2 text-sm leading-7 text-white">{item.nextMove}</div>
                        </div>
                      </div>
                      {(item.hook || item.monetization) ? (
                        <div className="mt-3 grid gap-3 md:grid-cols-2">
                          {item.hook ? (
                            <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-[#8cefff]">开头怎么说</div>
                              <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.hook}</div>
                            </div>
                          ) : null}
                          {item.monetization ? (
                            <div className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                              <div className="text-[11px] uppercase tracking-[0.18em] text-[#ffdd44]">更适合的承接</div>
                              <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.monetization}</div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4">
                <div className={shellCardClasses("p-6")}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Target className="h-4 w-4 text-[#6fffb0]" />
                    平台适配度
                  </div>
                  <div className="mt-4 space-y-4">
                    {primaryPlatforms.map((item) => (
                      <div key={`fit-${item.platform}`}>
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                          <div className="font-semibold text-white">{item.displayName}</div>
                          <div className="text-[#8cefff]">{item.audienceFitScore} / 100</div>
                        </div>
                        <div className="h-3 rounded-full bg-[#1a103d]">
                          <div
                            className="h-3 rounded-full bg-[linear-gradient(90deg,#2ef0ff,#7f67ff,#ff4fb8)]"
                            style={{ width: `${getRelativeBar(item.audienceFitScore, maxFit)}%` }}
                          />
                        </div>
                        <div className="mt-2 text-xs leading-6 text-[#b7add8]">{item.summary}</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={shellCardClasses("p-6")}>
                  <div className="flex items-center gap-2 text-sm font-semibold text-white">
                    <Rocket className="h-4 w-4 text-[#ff7fd5]" />
                    动量与竞争
                  </div>
                  <div className="mt-4 space-y-4">
                    {primaryPlatforms.map((item) => (
                      <div key={`momentum-${item.platform}`}>
                        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
                          <div className="font-semibold text-white">{item.displayName}</div>
                          <div className="text-[#ffe27b]">动量 {item.momentumScore}</div>
                        </div>
                        <div className="h-3 rounded-full bg-[#1a103d]">
                          <div
                            className="h-3 rounded-full bg-[linear-gradient(90deg,#ffdd44,#ff9944,#ff4fb8)]"
                            style={{ width: `${getRelativeBar(item.momentumScore, maxMomentum)}%` }}
                          />
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-[#b7add8]">
                          <span className="rounded-full border border-[#3a2b6a] bg-[#170d35] px-2 py-1">竞争：{item.competitionLevel}</span>
                          <span className="rounded-full border border-[#3a2b6a] bg-[#170d35] px-2 py-1">互动率中位数：{item.last30d.engagementRateMedian}</span>
                          <span className="rounded-full border border-[#3a2b6a] bg-[#170d35] px-2 py-1">样本：{item.last30d.sampleSizeLabel}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.05fr_0.95fr]">
              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="h-4 w-4 text-[#ff4fb8]" />
                  选题方向与文案内容
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-2">
                  {contentExecutionCards.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-sm font-semibold text-white">{item.title}</div>
                        <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-2 py-1 text-[11px] text-[#8cefff]">
                          {item.format}
                        </div>
                      </div>
                      <div className="mt-3 rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-3 text-sm leading-7 text-[#8cefff]">
                        {item.hook}
                      </div>
                      <div className="mt-3 text-sm leading-7 text-[#d3caef]">{item.copywriting}</div>
                      <div className="mt-3 rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-3 text-sm leading-7 text-white">
                        {item.production}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <CircleDollarSign className="h-4 w-4 text-[#ffdd44]" />
                  商业化建议先磨到可落地
                </div>
                <div className="mt-5 space-y-3">
                  {monetizationCards.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                      <div className="text-sm font-semibold text-white">{item.title}</div>
                      <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.summary}</div>
                      <div className="mt-3 rounded-2xl border border-[#2f2558] bg-[rgba(18,13,43,0.9)] p-3 text-sm leading-7 text-[#ffdd44]">
                        {item.action}
                      </div>
                    </div>
                  ))}
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
                  {executionBlueprint.map((item) => (
                    <div key={item.label} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                      <div className="text-sm font-semibold text-white">{item.label}</div>
                      <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.detail}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Target className="h-4 w-4 text-[#6fffb0]" />
                  为什么这条路更适合你
                </div>
                <div className="mt-5 space-y-3">
                  {[...businessTranslation.slice(0, 2), ...audienceTriggers.slice(0, 2).map((item) => ({ title: item.label, detail: item.reason }))].map((item, index) => (
                    <div key={`${item.title}-${index}`} className="rounded-2xl border border-white/10 bg-[rgba(255,255,255,0.04)] p-4">
                      <div className="text-sm font-semibold text-white">{cleanUserCopy(item.title, `理由 ${index + 1}`)}</div>
                      <div className="mt-2 text-sm leading-7 text-[#d3caef]">{cleanUserCopy(item.detail, "这条内容路径更容易让用户理解你是谁，以及为什么值得继续看。")}</div>
                    </div>
                  ))}
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
                        <div className="font-semibold text-white">{item.title}</div>
                        <div className="rounded-full border border-[#2f2558] bg-[rgba(255,255,255,0.04)] px-3 py-1 text-[11px] text-[#8cefff]">
                          第 {item.day} 步
                        </div>
                      </div>
                      <div className="mt-2 text-sm leading-7 text-[#d3caef]">{item.action}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div className={shellCardClasses("p-6")}>
                <div className="flex items-center gap-2 text-sm font-semibold text-white">
                  <ShieldCheck className="h-4 w-4 text-[#8cefff]" />
                  你还想继续追问什么
                </div>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-[#c8bfe7]">
                  这一轮追问会继续锁定在近 {selectedWindowDays} 天和你当前关注的“{personalizedSubject}”，不是重新输出一份平台基础课，而是把结论继续往“选题、形式、节奏、承接动作”推进。
                </p>

                <div className="mt-5 flex flex-wrap gap-2">
                  {hotQuestionSuggestions.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => {
                        setQuestion(item);
                        void handleAsk(item);
                      }}
                      className="rounded-full border border-[#3a2b6a] bg-[#140b31] px-3 py-2 text-sm text-[#d7d0ef] transition hover:border-[#49e6ff]/25 hover:bg-[rgba(73,230,255,0.08)]"
                    >
                      {item}
                    </button>
                  ))}
                </div>

                <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_auto]">
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="例如：如果我现在先做小红书，应该先做图文还是视频？为什么？"
                    className="min-h-[128px] w-full rounded-2xl border border-white/10 bg-[#0c061e] px-4 py-3 text-sm leading-7 text-white outline-none transition focus:border-[#49e6ff]/35"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAsk()}
                    disabled={askPlatformFollowUpMutation.isPending}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#49e6ff]/25 bg-[linear-gradient(135deg,#14d6ff,#5f6bff)] px-5 py-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {askPlatformFollowUpMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                    继续追问
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
                          <p key={`${paragraph.slice(0, 24)}-${index}`}>{paragraph}</p>
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
          </section>
        ) : null}
      </div>
    </div>
  );
}
