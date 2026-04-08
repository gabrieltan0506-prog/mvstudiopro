import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { createJob, getJob } from "@/lib/jobs";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import { saveGrowthHandoff } from "@/lib/growthHandoff";
import type {
  GrowthBusinessInsight,
  GrowthCampModel,
  GrowthHandoff,
  GrowthPlanStep,
  GrowthPlatformRecommendation,
  GrowthReferenceExample,
  GrowthSnapshot,
} from "@shared/growth";
import {
  ArrowLeft,
  BriefcaseBusiness,
  CircleDollarSign,
  Compass,
  FileUp,
  Film,
  LayoutDashboard,
  LineChart as LineChartIcon,
  Loader2,
  Orbit,
  PanelsTopLeft,
  Rocket,
  ScanSearch,
  Send,
  Sparkles,
  Target,
  TrendingUp,
  Upload,
  Workflow,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";

type AnalysisResult = {
  composition: number;
  color: number;
  lighting: number;
  impact: number;
  viralPotential: number;
  strengths: string[];
  improvements: string[];
  platforms: string[];
  summary: string;
  titleSuggestions?: string[];
  creatorCenterSignals?: string[];
  timestampSuggestions?: Array<{
    timestamp: string;
    issue: string;
    fix: string;
    opportunity?: string;
  }>;
  weakFrameReferences?: Array<{
    timestamp: string;
    reason: string;
    fix: string;
  }>;
  commercialAngles?: Array<{
    title: string;
    scenario: string;
    whyItFits: string;
    brands: string[];
    execution: string;
    hook: string;
    veoPrompt?: string;
  }>;
  followUpPrompt?: string;
};

type UploadStage = "idle" | "reading" | "uploading" | "analyzing" | "done" | "error";
type InputKind = "document" | "video";
type DebugInfo = Record<string, unknown> | null;

type CommercialTrack = {
  name: string;
  fit: number;
  reason: string;
  nextStep: string;
};

type ExecutionBriefRow = {
  label: string;
  content: string;
};

type DashboardMetric = {
  id: string;
  label: string;
  value: string;
  note: string;
  tone: string;
};

type DashboardPanel = {
  id: string;
  eyebrow: string;
  title: string;
  summary: string;
  detail: string;
  action: string;
  accent: string;
  glow: string;
};

type InsightTableRow = {
  label: string;
  insight: string;
  action: string;
  highlight?: string;
};

type ProcessingStepCard = {
  id: string;
  label: string;
  detail: string;
  status: "done" | "active" | "pending";
};

type TrendTableRow = {
  platform: string;
  topic: string;
  reason: string;
  action: string;
  highlight?: string;
};

type PlatformCompareRow = {
  metric: string;
  primaryValue: string;
  compareValue: string;
  verdict: string;
};

type ReferenceExampleCard = GrowthReferenceExample;
type PersonalizedDirectionCard = {
  title: string;
  scenario: string;
  why: string;
  action: string;
  badge: string;
};

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";
const FULL_PLATFORM_ORDER = ["douyin", "kuaishou", "bilibili", "xiaohongshu"] as const;
const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
  toutiao: "头条",
};

const PLATFORM_DEBUG_DESCRIPTIONS: Record<string, string> = {
  douyin: "短视频主阵地，优先看热点和爆发趋势。",
  xiaohongshu: "种草与搜索场景，优先看内容沉淀和转化线索。",
  bilibili: "中长视频社区，优先看深度内容和长期沉淀。",
  kuaishou: "高频更新场景，优先看稳定增量和直播相关表现。",
  toutiao: "资讯分发场景，适合单独看补齐情况和历史恢复状态。",
};

function getPlatformLabel(platform?: string) {
  const key = String(platform || "").trim();
  return PLATFORM_LABELS[key] || key || "-";
}

function getPlatformDescription(platform?: string) {
  const key = String(platform || "").trim();
  return PLATFORM_DEBUG_DESCRIPTIONS[key] || "平台说明暂未配置。";
}

function formatPlatformList(platforms: unknown) {
  return Array.isArray(platforms)
    ? platforms.map((platform) => getPlatformLabel(String(platform))).join("、") || "-"
    : "-";
}

function formatTruthSource(source?: string) {
  if (source === "platform-current") return "平台真值档";
  if (source === "derived-platforms") return "平台派生档";
  if (source === "current-json") return "单一 current.json";
  return String(source || "-");
}

function formatShanghaiDateTime(value?: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value);
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}-${map.hour}:${map.minute}:${map.second}`;
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

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(String(event.target?.result || ""));
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.readAsDataURL(file);
  });
}

async function uploadFileWithProgress(file: File, onProgress: (percent: number) => void) {
  return new Promise<{ url?: string }>((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file, file.name);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload", true);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.max(1, Math.min(100, Math.round((event.loaded / event.total) * 100)));
      onProgress(percent);
    };

    xhr.onerror = () => reject(new Error("视频上传失败，请检查网络后重试"));
    xhr.onabort = () => reject(new Error("视频上传已中断"));
    xhr.onload = () => {
      const raw = xhr.responseText || "";
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(raw || `视频上传失败 (${xhr.status})`));
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error(raw.startsWith("<!DOCTYPE") ? "上传接口返回了页面内容，不是 JSON。" : "上传完成但返回格式异常。"));
      }
    };

    xhr.send(formData);
  });
}

function getScoreTone(score: number) {
  if (score >= 80) return { label: "强", color: "text-emerald-300", chip: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" };
  if (score >= 65) return { label: "可放大", color: "text-amber-200", chip: "border-amber-300/20 bg-amber-400/10 text-amber-100" };
  return { label: "需重构", color: "text-rose-200", chip: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function formatCompactNumber(value: number) {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  return `${Math.round(value)}`;
}

function isPanelLinked(activePanel: string, panelId: string) {
  return (PANEL_SECTION_LINKS[activePanel] || [activePanel]).includes(panelId);
}

function compactText(text: string, maxLength = 72) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function normalizeText(text: string) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function mapAnalysisError(error: unknown) {
  const message = String((error as any)?.message || "");
  if (message.includes("Unexpected end of JSON input") || message.includes("Failed to fetch") || message.includes("502")) {
    return "视频预处理失败，请重试或更换文件。";
  }
  if (message.includes("frame") || message.includes("抽取")) {
    return "关键帧提取失败，已跳过视频深度分析，请重试或更换文件。";
  }
  return message || "分析失败，请稍后再试";
}

function replaceTerms(text: string) {
  return String(text || "")
    .replace(/\bCTA\b/g, "行动引导（CTA）")
    .replace(/live sample/gi, "实时样本")
    .replace(/hybrid/gi, "混合")
    .replace(/fallback/gi, "补位");
}

function normalizeAnalysisScale(result: AnalysisResult): AnalysisResult {
  const numericValues = [
    result.composition,
    result.color,
    result.lighting,
    result.impact,
    result.viralPotential,
  ];
  const shouldUpscale = numericValues.every((value) => value >= 0 && value <= 5);
  if (!shouldUpscale) return result;
  return {
    ...result,
    composition: Math.round(result.composition * 20),
    color: Math.round(result.color * 20),
    lighting: Math.round(result.lighting * 20),
    impact: Math.round(result.impact * 20),
    viralPotential: Math.round(result.viralPotential * 20),
  };
}

function buildDashboardMetrics(
  scoreItems: { label: string; value: number }[],
  highConfidenceTracks: CommercialTrack[],
  platformRecommendations: GrowthPlatformRecommendation[],
): DashboardMetric[] {
  const averageScore = scoreItems.length
    ? Math.round(scoreItems.reduce((sum, item) => sum + item.value, 0) / scoreItems.length)
    : 0;

  return [
    {
      id: "readiness",
      label: "当前能不能卖",
      value: `${averageScore}%`,
      note: "只回答一个问题：这条内容现在离“能带来成交”还有多远。",
      tone: "from-[#ff8a3d]/30 via-[#ff8a3d]/10 to-transparent",
    },
    {
      id: "monetization",
      label: "先跑哪条路",
      value: highConfidenceTracks[0]?.name || "待判断",
      note: "只保留当前真的值得先跑的主方向，不把低相关路线硬塞给你。",
      tone: "from-[#f5b7ff]/30 via-[#f5b7ff]/10 to-transparent",
    },
    {
      id: "positioning",
      label: "当前内容状态",
      value: averageScore >= 80 ? "可放大" : averageScore >= 65 ? "可优化" : "需重构",
      note: "先判断当前内容该直接放大、重剪，还是需要先重写定位与钩子。",
      tone: "from-[#9df6c0]/30 via-[#9df6c0]/10 to-transparent",
    },
    {
      id: "platforms",
      label: "先发平台",
      value: platformRecommendations[0]?.name || "待生成",
      note: "首发平台优先用于验证第一版表达，后续再做多平台拆分和分发。",
      tone: "from-[#90c4ff]/30 via-[#90c4ff]/10 to-transparent",
    },
  ];
}

function buildScoreDistributionData(scoreItems: { label: string; value: number }[]) {
  return scoreItems.map((item) => ({
    name: item.label,
    value: item.value,
  }));
}

function getScorePanelId(label: string) {
  if (/结构|叙事/.test(label)) return "positioning";
  if (/包装|色彩|光线/.test(label)) return "content";
  if (/钩子|节奏|冲击/.test(label)) return "platforms";
  return "monetization";
}

function buildPositioningRows(
  analysis: AnalysisResult,
  context: string,
  tracks: CommercialTrack[],
): InsightTableRow[] {
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单|健身器材|体育用品|运动器材|器械/.test(context);
  const audience = normalizeText(context || analysis.summary || "当前没有明确写出受众与成交目标，建议后续补全。");
  const bestTrack = tracks.find((track) => track.fit >= 60);
  const primaryDirection = bestTrack?.name || "先不主打变现";
  const roleHint = (/AIGC|开发者|平台|工具|工作流|自动化/.test(`${analysis.summary}\n${context}`)
      ? "结果导向的案例型顾问内容"
      : "先给结果、再给做法的解决方案内容");
  return [
    {
      label: "🎯 受众痛点",
      insight: audience,
      action: commerceDriven
        ? "把开头改成“这套器材适合谁、解决什么训练问题、为什么值得买”三连句，不再先拍氛围或人物状态。"
        : "先只解决一个最痛的问题，不要一条内容同时解释太多层。",
      highlight: "先锁一个痛点",
    },
    {
      label: "🧭 内容角色",
      insight: roleHint,
      action: commerceDriven
        ? "角色不是“拍得很专业的人”，而是“帮用户快速完成购买判断的人”。标题、字幕和脚本都要围绕这个角色写。"
        : "先写清角色，再统一标题和脚本。",
      highlight: "先定角色",
    },
    {
      label: "💼 当前重点",
      insight: primaryDirection === "先不主打变现" ? "先把入口做成熟。" : `先主攻「${primaryDirection}」。`,
      action: commerceDriven
        ? "只留一个成交动作，统一导向商品页、橱窗或私聊，不要一条内容同时挂多个承接方式。"
        : "只留一个承接动作。",
      highlight: "只留一个主方向",
    },
  ];
}

function buildContentAnalysisRows(analysis: AnalysisResult, context = ""): InsightTableRow[] {
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(context);
  const sportsCommerce = /健身器材|体育用品|运动器材|器械|哑铃|跑步机|壶铃|拉力器|护具|球拍/.test(context);
  return [
    {
      label: "✅ 当前优势",
      insight: analysis.strengths[0] || "素材真实、有可延展基础。",
      action: sportsCommerce
        ? "把真实训练画面固定成信任证据：字幕直接点出训练场景、适用人群和器材差异，不要只让用户看运动氛围。"
        : analysis.strengths[1] || "把优势固定成标题或封面。",
      highlight: "先固定优势",
    },
    {
      label: "⚠️ 优先优化点",
      insight: analysis.improvements[0] || "开头抓力不足，信息进入过慢。",
      action: sportsCommerce
        ? "前 2 到 3 秒直接说“适合哪类训练人群 + 解决什么问题 + 一个最关键差异”，不要先展示运动漫镜头。"
        : analysis.improvements[1] || "先重写前 2 到 3 秒。",
      highlight: "先修停留",
    },
    {
      label: "🧩 表达问题",
      insight: analysis.improvements[2] || "信息顺序和视觉重点不够集中。",
      action: sportsCommerce
        ? "表达顺序改成“适合谁 -> 训练场景 -> 核心差异 -> 为什么值得买 -> 一个动作”。这样用户才知道该不该继续看。"
        : commerceDriven ? "先讲适合谁、值不值买、为什么值得看，再补细节。" : "先给一句结论，再补细节。",
    },
    {
      label: "🚀 建议方向",
      insight: analysis.summary || "当前内容有基础，但结构和承接不够。",
      action: sportsCommerce
        ? "按“训练场景 -> 适用人群 -> 核心利益点 -> 信任证据 -> 成交动作”重写，目标是让用户能立刻判断值不值得买。"
        : commerceDriven ? "按“适用场景 -> 核心利益点 -> 信任证据 -> 一个动作”重写。" : "按“痛点 -> 做法 -> 动作”重写。",
      highlight: "方案要短、能执行",
    },
  ];
}

function buildTrendRows(
  growthSnapshot: GrowthSnapshot | null,
  _context: string,
  _platforms: GrowthPlatformRecommendation[],
): TrendTableRow[] {
  return [];
}

function buildPlatformRecommendationRows(
  recommendations: GrowthPlatformRecommendation[],
  growthSnapshot: GrowthSnapshot | null,
): InsightTableRow[] {
  return recommendations.map((platform) => {
    const snapshot = growthSnapshot?.platformSnapshots.find((item) => item.displayName === platform.name);
    return {
      label: platform.name,
      insight: platform.reason,
      action: platform.action,
      highlight: snapshot?.watchouts?.[0] ? `避免：${normalizeText(snapshot.watchouts[0])}` : undefined,
    };
  });
}

function buildPlatformCompareRows(
  growthSnapshot: GrowthSnapshot | null,
  recommendations: GrowthPlatformRecommendation[],
  comparePlatformName: string,
): PlatformCompareRow[] {
  const primaryName = recommendations[0]?.name || "";
  if (!FULL_PLATFORM_ORDER.map((platform) => PLATFORM_LABELS[platform]).includes(primaryName)) return [];
  if (!FULL_PLATFORM_ORDER.map((platform) => PLATFORM_LABELS[platform]).includes(comparePlatformName)) return [];
  const primary = growthSnapshot?.platformSnapshots.find((item) => item.displayName === primaryName);
  const compare = growthSnapshot?.platformSnapshots.find((item) => item.displayName === comparePlatformName);
  if (!primary || !compare) return [];

  const rows = [
    {
      metric: "受众匹配",
      primaryValue: `${primary.audienceFitScore}`,
      compareValue: `${compare.audienceFitScore}`,
      verdict: primary.audienceFitScore >= compare.audienceFitScore ? `${primary.displayName} 更适合先发` : `${compare.displayName} 更适合先发`,
    },
    {
      metric: "平台动能",
      primaryValue: `${primary.momentumScore}`,
      compareValue: `${compare.momentumScore}`,
      verdict: primary.momentumScore >= compare.momentumScore ? `${primary.displayName} 更容易借势` : `${compare.displayName} 当前更有势能`,
    },
    {
      metric: "互动中位",
      primaryValue: formatPercent(primary.last30d.engagementRateMedian),
      compareValue: formatPercent(compare.last30d.engagementRateMedian),
      verdict: primary.last30d.engagementRateMedian >= compare.last30d.engagementRateMedian ? `${primary.displayName} 更值得先测互动` : `${compare.displayName} 更值得先测互动`,
    },
    {
      metric: "平均播放",
      primaryValue: formatCompactNumber(primary.last30d.avgViews),
      compareValue: formatCompactNumber(compare.last30d.avgViews),
      verdict: primary.last30d.avgViews >= compare.last30d.avgViews ? `${primary.displayName} 更适合做放大版` : `${compare.displayName} 更适合做放大版`,
    },
  ];
  return rows;
}

function buildBusinessTrackRows(tracks: CommercialTrack[], context: string): InsightTableRow[] {
  const viableTracks = tracks.filter((track) => track.fit >= 45).slice(0, 3);
  if (!viableTracks.length) {
    return [{
      label: "当前阶段",
      insight: "这条内容现在还不适合直接讲品牌合作、带货或社群。先把入口、角色、案例表达和结尾动作跑通。",
      action: "先用 7 天计划把小红书首发版本做出来，验证收藏、停留、评论关键词，再决定后续承接方式。",
      highlight: "中长期商业化先放后面，短期先把内容入口做成熟。",
    }];
  }
  return viableTracks.map((track, index) => ({
    label: `${track.name} ${track.fit}%`,
    insight: replaceTerms(track.reason),
    action: replaceTerms(track.nextStep),
    highlight: index === 0
      ? "先验证一个最短可成交动作。"
      : undefined,
  }));
}

function buildExecutionBriefRows(analysis: AnalysisResult, context: string): ExecutionBriefRow[] {
  const normalized = `${analysis.summary}\n${context}`;
  const isMedicalSports = /医生|医学|慢性病|健康管理|网球|比赛|运动损伤|康复/.test(normalized);
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(normalized);
  if (isMedicalSports) {
    return [
      {
        label: "🔥 先锁主题",
        content: "先只做一个主题：运动损伤、慢病管理或医生视角解读，不要三条线一起讲。",
      },
      {
        label: "✨ 现有亮点",
        content: "比赛画面真实、专业身份可信，天然有“专业视角看热点”的差异感，适合先做专家型内容入口。",
      },
      {
        label: "🛠 立刻改法",
        content: "开头直接抛一个风险或误区，补字幕和慢放标注，把关键动作解释清楚，不要只放比赛画面。",
      },
      {
        label: "💰 承接方式",
        content: "先承接咨询、评估、专题课或健康管理服务，不先同时讲品牌、社群和多个变现方向。",
      },
    ];
  }

  if (commerceDriven) {
    return [
      {
        label: "🔥 先做什么",
        content: "先把这条视频改成“适合谁 + 解决什么 + 为什么值得买/值得问”的成交版，不再讲泛介绍。",
      },
      {
        label: "✨ 现有亮点",
        content: analysis.strengths[0] || "素材本身有真实场景和产品感，适合往结果展示和利益点表达方向改。",
      },
      {
        label: "🛠 立刻改法",
        content: "重写前三秒：先讲用户场景和结果；中段只留 2 到 3 个利益点；补一个信任证据；结尾把动作统一到橱窗、私聊或咨询。",
      },
      {
        label: "💰 商业延展",
        content: "先把单品或主服务跑通，再扩到商品页、橱窗组合、案例页和咨询承接，不要一开始同时做知识付费和社群。",
      },
    ];
  }

  return [
    {
      label: "🔥 先做什么",
      content: `先把这条内容改成“一个结果 + 一个痛点 + 一个动作”的版本，优先修：${analysis.improvements[0] || "结果前置"}。`,
    },
      {
        label: "✨ 现有亮点",
        content: analysis.strengths[0] || analysis.summary || "视觉上已经有亮点，但表达和承接还不够完整。",
    },
    {
      label: "🛠 立刻改法",
      content: `把开头前三秒改成结论前置，结尾补一个明确动作；中段只保留服务于主结论的画面和字幕。`,
    },
    {
      label: "💰 商业延展",
      content: "先跑出收藏、停留或咨询，再把同主题内容延展成图文、分镜脚本和视频版本，不要一开始同时写多个变现方向。",
    },
  ];
}

function buildPersonalizedDirectionCards(
  growthSnapshot: GrowthSnapshot | null,
  fallbackAngles: NonNullable<AnalysisResult["commercialAngles"]>,
) {
  const personalized = growthSnapshot?.dashboardConsole?.personalizedRecommendations || [];
  if (personalized.length) {
    return personalized.slice(0, 4).map((item, index) => ({
      title: item.title,
      scenario: item.audience,
      why: `${item.why} ${item.evidence}`.trim(),
      action: item.action,
      badge: index === 0 ? "主方向" : "可扩展",
    }));
  }

  return fallbackAngles.slice(0, 4).map((item, index) => ({
    title: item.title,
    scenario: item.scenario,
    why: item.whyItFits,
    action: item.execution,
    badge: index === 0 ? "备选方向" : "次选方向",
  }));
}

function buildProcessingSteps(inputKind: InputKind | null, uploadStage: UploadStage, uploadProgress: number, elapsedTime: number): ProcessingStepCard[] {
  const isVideo = inputKind === "video";
  const analyzingPhase = Math.floor(elapsedTime / 4);
  const currentAnalyzeStep = isVideo ? Math.min(3, analyzingPhase) : Math.min(2, analyzingPhase);

  if (uploadStage === "uploading") {
    return [
      {
        id: "prepare",
        label: isVideo ? "校验视频文件" : "校验文档内容",
        detail: isVideo ? "正在确认视频格式、时长与上传可用性。" : "正在确认文档格式、大小与可解析性。",
        status: uploadProgress >= 8 ? "done" : "active",
      },
      {
        id: "transfer",
        label: "上传到分析队列",
        detail: isVideo ? "正在把原始文件送入分析入口，并持续同步字节进度。" : "正在整理文档内容并送入模型分析入口。",
        status: uploadProgress >= 8 ? "active" : "pending",
      },
      {
        id: "handoff",
        label: "创建分析任务",
        detail: "文件就绪后会立即创建任务，开始进入模型工作流。",
        status: uploadProgress >= 96 ? "active" : "pending",
      },
    ];
  }

  if (uploadStage === "analyzing") {
    const videoSteps: ProcessingStepCard[] = [
      {
        id: "decode",
        label: "解读素材结构",
        detail: "正在拆解视频节奏、主线信息和可承接的商业入口。",
        status: currentAnalyzeStep > 0 ? "done" : "active",
      },
      {
        id: "multimodal",
        label: "多模态理解",
        detail: "正在结合画面、字幕、口播与上下文，判断素材真正适合服务谁。",
        status: currentAnalyzeStep === 1 ? "active" : currentAnalyzeStep > 1 ? "done" : "pending",
      },
      {
        id: "bridge",
        label: "商业桥接判断",
        detail: "正在把这条素材桥接回你的业务，而不是套默认模板。",
        status: currentAnalyzeStep === 2 ? "active" : currentAnalyzeStep > 2 ? "done" : "pending",
      },
      {
        id: "report",
        label: "生成最终报告",
        detail: "正在收束平台建议、执行版本和个性化增长方向。",
        status: currentAnalyzeStep >= 3 ? "active" : "pending",
      },
    ];

    const documentSteps: ProcessingStepCard[] = [
      {
        id: "extract",
        label: "抽取关键信息",
        detail: "正在读取文档中的核心观点、结构与可成交线索。",
        status: currentAnalyzeStep > 0 ? "done" : "active",
      },
      {
        id: "reason",
        label: "判断可执行方向",
        detail: "正在判断内容定位、平台优先级与商业承接动作。",
        status: currentAnalyzeStep === 1 ? "active" : currentAnalyzeStep > 1 ? "done" : "pending",
      },
      {
        id: "assemble",
        label: "拼装成长报告",
        detail: "正在输出可直接拿去改稿、发布和验证的结果。",
        status: currentAnalyzeStep >= 2 ? "active" : "pending",
      },
    ];

    return isVideo ? videoSteps : documentSteps;
  }

  return [];
}

function buildCommercialTracks(
  analysis: AnalysisResult,
  context: string,
  growthSnapshot: GrowthSnapshot | null,
): CommercialTrack[] {
  const text = context.trim();
  const xiaohongshuFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "xiaohongshu")?.audienceFitScore || 0;
  const bilibiliFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "bilibili")?.audienceFitScore || 0;
  const douyinFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "douyin")?.audienceFitScore || 0;
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(text);
  const educationDriven = /课程|教学|知识|教程|陪跑|训练营/.test(text);

  return [
    {
      name: "品牌合作",
      fit: Math.min(96, Math.round((analysis.color + analysis.composition + xiaohongshuFit) / 3 + (/品牌|招商|案例|客户|服务/.test(text) ? 6 : 0))),
      reason: /美妆|穿搭|形象|妆|护肤|造型/.test(text)
        ? "只有当你能把审美表达直接翻译成“适合什么场景、解决什么问题、能给品牌带来什么结果”时，品牌合作才成立。"
        : "品牌合作只适合那些表达统一、案例清楚、服务说明完整的内容，不适合泛泛谈曝光。",
      nextStep: /美妆|穿搭|形象|妆|护肤|造型/.test(text)
        ? "先补一版“场景问题 -> 解决方案 -> 可合作品类”的案例页，聚焦运动美妆、防晒、功能护肤、服饰与配件。"
        : "补一版案例导向标题和服务说明，让合作方能快速理解你擅长的商业结果。",
    },
    {
      name: "电商带货",
      fit: Math.min(96, Math.round((analysis.impact + analysis.viralPotential + douyinFit) / 3 + (commerceDriven ? 16 : 0))),
      reason: "冲击力和节奏更适合做转化型表达，但产品利益点和 CTA 需要足够直接。",
      nextStep: "把前三秒改成结果或利益点前置，并把行动指令明确到橱窗、评论区或私域入口。",
    },
    {
      name: "知识付费",
      fit: Math.min(96, Math.round((analysis.composition + analysis.viralPotential + bilibiliFit) / 3 + (educationDriven ? 10 : -22) - (commerceDriven ? 18 : 0))),
      reason: "适合把内容拆成方法、结构、案例复盘，再沉淀成课程、模板或陪跑服务。",
      nextStep: "把当前内容整理成“结果 + 三步方法 + 常见误区”的结构，形成可复用的方法论入口。",
    },
    {
      name: "社群会员",
      fit: Math.min(96, Math.round((analysis.color + analysis.lighting + xiaohongshuFit) / 3 + 4 - (commerceDriven ? 12 : 0))),
      reason: "社群不是默认答案，只有当你能稳定更新同主题内容、持续交付群内价值时，才值得做会员或长期社群。",
      nextStep: "先验证是否存在固定主题、固定更新节奏和固定权益，再决定要不要把社群作为主承接方式。",
    },
  ].sort((a, b) => b.fit - a.fit);
}

function buildCreationAssistBrief(
  analysis: AnalysisResult,
  context: string,
  platforms: GrowthPlatformRecommendation[],
  tracks: CommercialTrack[],
) {
  const primaryTrack = tracks[0]?.name || "品牌合作";
  const primaryPlatform = platforms[0]?.name || "抖音";
  const commerceDriven = /卖家|商品|电商|带货|陶瓷|瓷砖|家居|建材|橱窗|下单/.test(context);
  return [
    `内容目标：把当前素材升级成更适合 ${primaryPlatform} 分发、并服务于「${primaryTrack}」转化的内容版本。`,
    `核心分析：${analysis.summary}`,
    commerceDriven
      ? "开场建议：前 2-3 秒先讲“适合谁、解决什么、为什么值得买”，不要从产品介绍开始。"
      : "开场建议：前 2-3 秒先给结果、反差或利益点，不要从铺垫开始。",
    commerceDriven
      ? "商业动作：结尾只保留一个成交动作，统一导向橱窗、评论区关键词或私聊入口。"
      : "商业动作：结尾必须补 CTA，把观众导向案例咨询、服务介绍、商品入口或私域承接。",
    context.trim() ? `业务背景：${context.trim()}` : "业务背景：未填写，建议补充目标受众与转化目标。",
  ].join("\n");
}

function buildDashboardPanels(
  dashboardMetrics: DashboardMetric[],
  positioningRows: InsightTableRow[],
  contentAnalysisRows: InsightTableRow[],
  platformRecommendationRows: InsightTableRow[],
  businessInsights: GrowthBusinessInsight[],
  growthPlan: GrowthPlanStep[],
  commercialTracks: CommercialTrack[],
): DashboardPanel[] {
  const maturity = dashboardMetrics.find((item) => item.id === "readiness");
  const role = dashboardMetrics.find((item) => item.id === "positioning");
  const platform = dashboardMetrics.find((item) => item.id === "platforms");
  const monetization = dashboardMetrics.find((item) => item.id === "monetization");
  const topTrack = commercialTracks[0];
  const dayOne = growthPlan[0];

  return [
    {
      id: "readiness",
      eyebrow: maturity?.label || "总体准备度",
      title: maturity?.value || "待生成",
      summary: maturity?.note || "先看整体成熟度，再决定先修哪里。",
      detail: `先判断这条内容是“能直接放大”，还是“要先重写一版”。${role?.value ? ` 当前判断：${role.value}。` : ""}`,
      action: dayOne?.action || "先把单一卖点和开头 3 秒收紧，再进入平台验证。",
      accent: "text-[#ffcf92]",
      glow: "from-[#ff8a3d]/30 via-[#ffcf92]/12 to-transparent",
    },
    {
      id: "positioning",
      eyebrow: "内容定位",
      title: positioningRows[0]?.insight || "先定受众",
      summary: positioningRows[1]?.insight || "先定内容角色，再定平台和脚本。",
      detail: `${positioningRows[0]?.action || ""} ${positioningRows[1]?.action || ""}`.trim(),
      action: positioningRows[2]?.action || "先做一版首发验证稿，再拆成多平台版本。",
      accent: "text-[#9df6c0]",
      glow: "from-[#15ff9b]/20 via-[#9df6c0]/10 to-transparent",
    },
    {
      id: "content",
      eyebrow: "内容分析",
      title: contentAnalysisRows[0]?.insight || "先找可复用优势",
      summary: contentAnalysisRows[1]?.insight || "先修最影响停留的问题。",
      detail: `${contentAnalysisRows[2]?.insight || ""} ${contentAnalysisRows[3]?.action || ""}`.trim(),
      action: contentAnalysisRows[1]?.action || "先重写开头和信息顺序。",
      accent: "text-[#ffb37f]",
      glow: "from-[#ff8a3d]/25 via-[#ffb37f]/10 to-transparent",
    },
    {
      id: "platforms",
      eyebrow: "平台打法",
      title: platformRecommendationRows[0]?.label || "待生成",
      summary: platformRecommendationRows[0]?.insight || "先给首发顺序，再告诉用户每个平台怎么发。",
      detail: platformRecommendationRows.slice(0, 3).map((item) => `${item.label}：${item.action}`).join(" "),
      action: "图文先跑验证，视频再做扩量。平台不是单选题，而是按同一主题拆不同版本。",
      accent: "text-[#90c4ff]",
      glow: "from-[#2684ff]/24 via-[#90c4ff]/12 to-transparent",
    },
    {
      id: "monetization",
      eyebrow: "商业洞察",
      title: topTrack ? `${topTrack.name} ${topTrack.fit}%` : "暂不主打变现",
      summary: businessInsights[0]?.detail || "先把内容入口讲清楚，再谈商业承接。",
      detail: businessInsights.slice(1, 4).map((item) => `${item.title}：${item.detail}`).join(" "),
      action: topTrack?.nextStep || "先补一版案例或服务说明，再决定主承接方式。",
      accent: "text-[#f5b7ff]",
      glow: "from-[#f5b7ff]/24 via-[#ff8cf0]/10 to-transparent",
    },
    {
      id: "execution",
      eyebrow: "7天执行",
      title: dayOne?.title || "先跑第一轮结果",
      summary: dayOne?.action || "先做一版能验证结果的首发稿。",
      detail: growthPlan.slice(1, 4).map((item) => `第 ${item.day} 天 ${item.title}：${item.action}`).join(" "),
      action: "先把短期结果做出来，再把同主题延展到分镜、视频和商业承接。",
      accent: "text-[#d7ff7f]",
      glow: "from-[#8effb1]/18 via-[#d7ff7f]/10 to-transparent",
    },
  ];
}

const PANEL_SCROLL_TARGETS: Record<string, string> = {
  readiness: "execution",
  positioning: "positioning",
  content: "content",
  platforms: "platforms",
  monetization: "monetization",
  execution: "execution",
};

const PANEL_SECTION_LINKS: Record<string, string[]> = {
  readiness: ["positioning", "content", "monetization", "execution"],
  positioning: ["positioning", "content"],
  content: ["content", "execution", "monetization"],
  platforms: ["platforms"],
  monetization: ["monetization", "execution"],
  execution: ["execution", "content"],
};

export default function MVAnalysisPage() {
  const stripInternalJargon = (value: string) => String(value || "")
    .replace(/知识付费|社群会员|模板包|软件分销|咨询|课程|工作流案例|前后效率对比|模板|实操演示|后台分析过程|漏斗|中位数|均值|内部排序/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  const [, navigate] = useLocation();
  const [supervisorAccess, setSupervisorAccess] = useState(() => hasSupervisorAccess());
  const { isAuthenticated, loading } = useAuth({ autoFetch: !supervisorAccess });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [inputKind, setInputKind] = useState<InputKind | null>(null);
  const [fileMimeType, setFileMimeType] = useState("");
  const [uploadStage, setUploadStage] = useState<UploadStage>("idle");
  const [uploadProgress, setUploadProgress] = useState(0);
  const [estimatedTime, setEstimatedTime] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileSize, setFileSize] = useState(0);
  const [quotaModalVisible, setQuotaModalVisible] = useState(false);
  const [quotaModalInfo, setQuotaModalInfo] = useState<{ isTrial?: boolean; planName?: string }>({});
  const [debugMode, setDebugMode] = useState(() => {
    if (typeof window === "undefined") return false;
    return hasSupervisorAccess() && new URLSearchParams(window.location.search).get("debug") === "1";
  });
  const [debugInfo, setDebugInfo] = useState<DebugInfo>(null);
  const [activeDashboardPanel, setActiveDashboardPanel] = useState("readiness");
  const [selectedComparePlatform, setSelectedComparePlatform] = useState("");
  const [selectedTrendPlatform, setSelectedTrendPlatform] = useState("all");
  const [selectedBusinessTrack, setSelectedBusinessTrack] = useState("");
  const [selectedFunnelSegment, setSelectedFunnelSegment] = useState("");
  const [selectedGrowthModel, setSelectedGrowthModel] = useState<GrowthCampModel>("gemini-2.5-pro");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);
  const sectionRefs = useRef<Partial<Record<string, HTMLDivElement | null>>>({});

  const analyzeDocumentMutation = trpc.mvAnalysis.analyzeDocument.useMutation();
  const checkAccessMutation = trpc.usage.checkFeatureAccess.useMutation();
  const refreshGrowthMutation = trpc.mvAnalysis.refreshGrowthTrends.useMutation();
  const usageStatsQuery = trpc.usage.getUsageStats.useQuery(undefined, {
    enabled: isAuthenticated && !loading && !supervisorAccess,
    refetchOnMount: true,
  });
  const hasPaidGrowthAccess = Boolean(
    supervisorAccess ||
      (usageStatsQuery.data as any)?.isAdmin ||
      usageStatsQuery.data?.hasSubscription,
  );
  const growthSnapshotQuery = trpc.mvAnalysis.getGrowthSnapshot.useQuery(
    {
      context: context || undefined,
      modelName: selectedGrowthModel,
      requestedPlatforms: analysis?.platforms?.length ? analysis.platforms : [...FULL_PLATFORM_ORDER],
      analysis: analysis || {
        composition: 0,
        color: 0,
        lighting: 0,
        impact: 0,
        viralPotential: 0,
        strengths: [],
        improvements: [],
        platforms: [],
        summary: "",
      },
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
  const growthSystemStatusQuery = trpc.mvAnalysis.getGrowthSystemStatus.useQuery(undefined, {
    enabled: supervisorAccess && debugMode,
    staleTime: 30_000,
    refetchInterval: supervisorAccess && debugMode ? 10_000 : false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  });
  const setGrowthRuntimeModeMutation = trpc.mvAnalysis.setGrowthRuntimeMode.useMutation({
    onSuccess: async () => {
      await growthSystemStatusQuery.refetch();
      toast.success("运行模式已切换");
    },
    onError: (error) => {
      toast.error(error.message || "运行模式切换失败");
    },
  });
  const setGrowthBurstControlMutation = trpc.mvAnalysis.setGrowthBurstControl.useMutation({
    onSuccess: async () => {
      await growthSystemStatusQuery.refetch();
      toast.success("burst 模式已切换");
    },
    onError: (error) => {
      toast.error(error.message || "burst 模式切换失败");
    },
  });
  const growthAnomalies = growthSystemStatusQuery.data?.anomalies || [];
  const growthHealthState = growthAnomalies.length ? "异常" : "正常";
  const hasCriticalGrowthAnomaly = growthAnomalies.some((item) => item?.level === "critical");

  const trySetBurstControl = useCallback((payload: {
    burst: "auto" | "manual" | "off";
    platforms: Array<"douyin" | "xiaohongshu" | "bilibili" | "kuaishou" | "toutiao">;
  }) => {
    if (payload.burst !== "off" && hasCriticalGrowthAnomaly) {
      toast.error("当前系统状态异常，不建议执行 burst。请先恢复健康度。");
      return;
    }
    setGrowthBurstControlMutation.mutate(payload);
  }, [hasCriticalGrowthAnomaly, setGrowthBurstControlMutation]);

  useEffect(() => {
    setSupervisorAccess(hasSupervisorAccess());
  }, []);

  useEffect(() => {
    if (!loading && !isAuthenticated && !supervisorAccess) navigate("/login");
  }, [loading, isAuthenticated, supervisorAccess, navigate]);

  useEffect(() => {
    if (uploadStage === "uploading" || uploadStage === "analyzing") {
      startTimeRef.current = Date.now();
      timerRef.current = setInterval(() => {
        setElapsedTime(Math.floor((Date.now() - startTimeRef.current) / 1000));
      }, 500);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [uploadStage]);

  const handleSelectFile = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target?.files?.[0];
    if (!file) return;

    const isVideo = file.type.startsWith("video/");
    const isDocument =
      file.type === "application/pdf" ||
      file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      /\.pdf$/i.test(file.name) ||
      /\.docx$/i.test(file.name);

    if (!isVideo && !isDocument) {
      setError("请上传图文档案（Word、PDF）或 MP4 视频文件");
      return;
    }

    setFileName(file.name);
    setFileSize(file.size);
    setFileMimeType(file.type || "");
    setSelectedFile(file);
    setInputKind(isVideo ? "video" : "document");
    setUploadStage("reading");
    setUploadProgress(0);
    setError(null);
    setAnalysis(null);
    setDebugInfo(null);
    setPreviewUrl(null);

    const sizeMB = file.size / (1024 * 1024);
    setEstimatedTime(Math.max(10, Math.round(sizeMB * 2 + 15)));

    void (async () => {
      try {
        if (isDocument) {
          const dataUrl = await readFileAsDataUrl(file);
          setFileBase64(dataUrl.split(",")[1] || "");
          setUploadStage("idle");
          setUploadProgress(100);
          return;
        }

        setFileBase64(null);

        const video = document.createElement("video");
        const url = URL.createObjectURL(file);
        video.src = url;
        video.muted = true;
        video.currentTime = 1;
        video.onloadeddata = () => {
          video.currentTime = Math.min(1, video.duration / 4);
        };
        video.onseeked = () => {
          const canvas = document.createElement("canvas");
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            URL.revokeObjectURL(url);
            setError("视频读取失败，请重试");
            setUploadStage("error");
            return;
          }
          ctx.drawImage(video, 0, 0);
          setPreviewUrl(canvas.toDataURL("image/jpeg", 0.9));
          setUploadStage("idle");
          setUploadProgress(100);
          URL.revokeObjectURL(url);
        };
        video.onerror = () => {
          setError("视频读取失败，请重试");
          setUploadStage("error");
          URL.revokeObjectURL(url);
        };
      } catch (fileError: any) {
        setError(fileError.message || "文件读取失败");
        setUploadStage("error");
      }
    })();
  }, []);

  const handleAnalyze = useCallback(async () => {
    if (!inputKind) return;

    if (!supervisorAccess) {
      try {
        const accessCheck = await checkAccessMutation.mutateAsync({ featureType: "analysis" });
        if (!accessCheck.allowed) {
          setQuotaModalInfo({
            isTrial: (accessCheck as any).isTrial,
            planName: (accessCheck as any).planName,
          });
          setQuotaModalVisible(true);
          return;
        }
      } catch (accessError: any) {
        toast.error(accessError.message || "无法检查使用权限");
        return;
      }
    }

    setUploadStage("uploading");
    setUploadProgress(0);
    setError(null);
    setElapsedTime(0);
    setEstimatedTime(Math.max(12, Math.round(fileSize / (1024 * 1024) * 1.5 + 12)));

    try {
      const result = inputKind === "document"
          ? await analyzeDocumentMutation.mutateAsync({
              fileBase64: fileBase64 || "",
              mimeType: fileMimeType || "application/octet-stream",
              fileName,
              context: context || undefined,
              modelName: selectedGrowthModel,
            })
          : await (async () => {
              if (!selectedFile) {
                throw new Error("请先选择视频文件");
              }
              const uploaded = await uploadFileWithProgress(selectedFile, (percent) => {
                setUploadProgress(Math.min(55, Math.max(3, Math.round(percent * 0.55))));
              });
              if (!uploaded?.url) {
                throw new Error("视频上传完成但未返回地址");
              }

              setUploadStage("analyzing");
              setUploadProgress(60);

              const { jobId } = await createJob({
                type: "video",
                userId: "",
                input: {
                  action: "growth_analyze_video",
                  params: {
                    fileUrl: uploaded.url,
                    mimeType: fileMimeType || "video/mp4",
                    fileName,
                    context: context || undefined,
                    modelName: selectedGrowthModel,
                  },
                },
              });

              const startedAt = Date.now();
              while (Date.now() - startedAt < 12 * 60_000) {
                const job = await getJob(jobId);
                if (job.status === "succeeded") {
                  return {
                    success: true,
                    analysis: job.output?.analysis,
                    videoUrl: job.output?.videoUrl,
                    transcript: job.output?.transcript,
                    videoDuration: job.output?.videoDuration,
                    debug: job.output?.debug,
                  };
                }
                if (job.status === "failed") {
                  throw new Error(String(job.error || "视频分析失败"));
                }
                await new Promise((resolve) => setTimeout(resolve, 2500));
                setUploadProgress((value) => Math.min(95, Math.max(value + 3, 65)));
              }

              throw new Error("视频分析超时，请稍后重试");
            })();
      setAnalysis(normalizeAnalysisScale(result.analysis));
      setDebugInfo({
        inputKind,
        fileName,
        mimeType: fileMimeType || null,
        fileSize,
        ...((result as any).debug || {}),
      });
      setUploadProgress(100);
      setUploadStage("done");
      if (!supervisorAccess) {
        usageStatsQuery.refetch();
      }
    } catch (analysisError: any) {
      setError(mapAnalysisError(analysisError));
      setUploadStage("error");
    }
  }, [fileBase64, selectedFile, inputKind, supervisorAccess, checkAccessMutation, fileSize, analyzeDocumentMutation, fileMimeType, fileName, context, selectedGrowthModel, usageStatsQuery]);

  const handleReset = useCallback(() => {
    setPreviewUrl(null);
    setFileBase64(null);
    setSelectedFile(null);
    setInputKind(null);
    setFileMimeType("");
    setAnalysis(null);
    setError(null);
    setContext("");
    setDebugInfo(null);
    setUploadStage("idle");
    setUploadProgress(0);
    setElapsedTime(0);
    setFileName("");
    setFileSize(0);
  }, []);

  const handleRefreshGrowth = useCallback(async () => {
    try {
      await refreshGrowthMutation.mutateAsync({
        platforms: [...FULL_PLATFORM_ORDER],
      });
      await growthSnapshotQuery.refetch();
      toast.success("趋势数据已刷新");
    } catch (refreshError: any) {
      toast.error(refreshError.message || "趋势数据刷新失败");
    }
  }, [refreshGrowthMutation, growthSnapshotQuery]);

  const handleStoreHandoff = useCallback((handoff: GrowthHandoff | null, successMessage = "分析结果已同步到创作画布") => {
    if (!handoff) return;
    saveGrowthHandoff(handoff);
    toast.success(successMessage);
  }, []);

  const scoreItems = useMemo(() => {
    if (!analysis) return [];
    if (inputKind === "document") {
      return [
        { label: "结构质量", value: analysis.composition },
        { label: "包装潜力", value: analysis.color },
        { label: "信息清晰", value: analysis.lighting },
        { label: "表达钩子", value: analysis.impact },
        { label: "商业承接力", value: analysis.viralPotential },
      ];
    }
    if (inputKind === "video") {
      return [
        { label: "叙事结构", value: analysis.composition },
        { label: "视觉包装", value: analysis.color },
        { label: "信息清晰", value: analysis.lighting },
        { label: "节奏冲击", value: analysis.impact },
        { label: "商业承接力", value: analysis.viralPotential },
      ];
    }
    return [
      { label: "构图结构", value: analysis.composition },
      { label: "色彩识别", value: analysis.color },
      { label: "光线氛围", value: analysis.lighting },
      { label: "冲击强度", value: analysis.impact },
      { label: "商业承接力", value: analysis.viralPotential },
    ];
  }, [analysis, inputKind]);

  const isProcessing = uploadStage === "uploading" || uploadStage === "analyzing";
  const remainingTime = isProcessing ? Math.max(1, estimatedTime - elapsedTime) : 0;
  const processingStatusMessage = uploadStage === "uploading"
    ? inputKind === "video"
      ? `正在上传视频 ${Math.max(1, uploadProgress)}%`
      : "正在整理文档并创建分析任务..."
    : elapsedTime >= estimatedTime
      ? "正在整理最终报告，请稍候..."
      : `正在生成诊断中，预计还需 ${remainingTime} 秒。`;
  const processingSteps = useMemo(
    () => buildProcessingSteps(inputKind, uploadStage, uploadProgress, elapsedTime),
    [inputKind, uploadStage, uploadProgress, elapsedTime],
  );
  const activeProcessingStep = processingSteps.find((item) => item.status === "active") || processingSteps[processingSteps.length - 1] || null;
  const processingDetailMessages = useMemo(() => {
    if (!processingSteps.length) return [];
    const activeIndex = processingSteps.findIndex((item) => item.status === "active");
    const current = activeIndex >= 0 ? activeIndex : processingSteps.length - 1;
    const messages = [
      processingSteps[Math.max(0, current - 1)]?.detail,
      processingSteps[current]?.detail,
      processingSteps[Math.min(processingSteps.length - 1, current + 1)]?.detail,
    ].filter(Boolean) as string[];
    return Array.from(new Set(messages));
  }, [processingSteps]);

  const growthSnapshot: GrowthSnapshot | null = growthSnapshotQuery.data?.snapshot ?? null;
  const growthSnapshotDebug = growthSnapshotQuery.data?.debug ?? null;
  const dashboardConsole = growthSnapshot?.dashboardConsole ?? null;
  const platformRecommendations = growthSnapshot?.platformRecommendations ?? [];
  const businessInsights: GrowthBusinessInsight[] = growthSnapshot?.businessInsights ?? [];
  const growthPlan: GrowthPlanStep[] = growthSnapshot?.growthPlan ?? [];
  const commercialTracks = useMemo(
    () => growthSnapshot?.monetizationTracks ?? [],
    [growthSnapshot],
  );
  const creationAssist = growthSnapshot?.creationAssist ?? null;
  const growthHandoff = growthSnapshot?.growthHandoff ?? null;
  const positioningRows = useMemo(
    () => analysis ? buildPositioningRows(analysis, context, commercialTracks) : [],
    [analysis, context, commercialTracks],
  );
  const contentAnalysisRows = useMemo(
    () => analysis ? buildContentAnalysisRows(analysis, context) : [],
    [analysis, context],
  );
  const trendRows = useMemo(
    () => buildTrendRows(growthSnapshot, context, platformRecommendations),
    [growthSnapshot, context, platformRecommendations],
  );
  const platformRecommendationRows = useMemo(
    () => buildPlatformRecommendationRows(platformRecommendations, growthSnapshot),
    [platformRecommendations, growthSnapshot],
  );
  const referenceExamples = useMemo<ReferenceExampleCard[]>(
    () => growthSnapshot?.dashboardConsole?.referenceExamples || [],
    [growthSnapshot],
  );
  const highConfidenceTracks = useMemo(
    () => commercialTracks.filter((track) => track.fit >= 80),
    [commercialTracks],
  );
  const businessTrackRows = useMemo(
    () => buildBusinessTrackRows(highConfidenceTracks.length ? highConfidenceTracks : commercialTracks, context),
    [highConfidenceTracks, commercialTracks, context],
  );
  const executionBriefRows = useMemo(
    () => analysis ? buildExecutionBriefRows(analysis, context) : [],
    [analysis, context],
  );
  const dashboardMetrics = useMemo(
    () => buildDashboardMetrics(scoreItems, highConfidenceTracks, platformRecommendations),
    [scoreItems, highConfidenceTracks, platformRecommendations],
  );
  const dashboardPanels = useMemo(
    () => buildDashboardPanels(
      dashboardMetrics,
      positioningRows,
      contentAnalysisRows,
      platformRecommendationRows,
      businessInsights,
      growthPlan,
      commercialTracks,
    ),
    [dashboardMetrics, positioningRows, contentAnalysisRows, platformRecommendationRows, businessInsights, growthPlan, commercialTracks],
  );
  const scoreDistributionData = useMemo(
    () => buildScoreDistributionData(scoreItems),
    [scoreItems],
  );
  const dashboardScoreAverage = useMemo(
    () => scoreItems.length ? Math.round(scoreItems.reduce((sum, item) => sum + item.value, 0) / scoreItems.length) : 0,
    [scoreItems],
  );
  const dashboardDonutData = useMemo(
    () => scoreItems.map((item, index) => ({
      name: item.label,
      value: Math.max(1, item.value),
      fill: ["#7CFFB2", "#8AB8FF", "#FFD68E", "#FF9BC5", "#CFA5FF"][index % 5],
      panelId: getScorePanelId(item.label),
    })),
    [scoreItems],
  );
  const businessFunnelSteps = useMemo(() => {
    const primary = commercialTracks[0];
    const secondary = commercialTracks[1];
    return [
      {
        label: "看懂问题",
        value: Math.max(28, dashboardScoreAverage),
        detail: positioningRows[0]?.action || "先说用户现在卡在哪里。",
      },
      {
        label: "建立信任",
        value: Math.max(22, Math.round((commercialTracks[0]?.fit || dashboardScoreAverage) * 0.82)),
        detail: contentAnalysisRows[0]?.action || "先让用户愿意继续看和收藏。",
      },
      {
        label: "承接动作",
        value: Math.max(16, primary?.fit || 18),
        detail: primary?.nextStep || "先只保留一个主承接动作。",
      },
      {
        label: "放大成交",
        value: Math.max(10, secondary?.fit || Math.round((primary?.fit || 0) * 0.72)),
        detail: businessTrackRows[0]?.action || "跑出转化后再考虑投流和放大。",
      },
    ];
  }, [commercialTracks, businessTrackRows, positioningRows, contentAnalysisRows, dashboardScoreAverage]);
  const conversionFunnels = dashboardConsole?.conversionFunnels ?? [];
  const activeConversionFunnel = useMemo(
    () => conversionFunnels.find((item) => item.id === selectedFunnelSegment) || conversionFunnels[0] || null,
    [conversionFunnels, selectedFunnelSegment],
  );
  const dataEvidenceNotes = useMemo(
    () => (growthSnapshot?.status?.notes || []).filter((note) => /平台数据证据|抖音创作者中心证据|数据证据/i.test(note)),
    [growthSnapshot],
  );
  const platformDashboardCards = useMemo(
    () => platformRecommendationRows.slice(0, 4).map((row) => ({
      ...row,
      panelId: "platforms",
    })),
    [platformRecommendationRows],
  );
  const comparePlatformOptions = useMemo(
    () => platformRecommendations.map((item) => item.name).filter(Boolean),
    [platformRecommendations],
  );
  const filteredTrendRows = useMemo(
    () => selectedTrendPlatform === "all"
      ? trendRows
      : trendRows.filter((row) => row.platform === selectedTrendPlatform),
    [trendRows, selectedTrendPlatform],
  );
  const platformCompareRows = useMemo(
    () => buildPlatformCompareRows(growthSnapshot, platformRecommendations, selectedComparePlatform),
    [growthSnapshot, platformRecommendations, selectedComparePlatform],
  );
  const focusedBusinessTrack = useMemo(
    () => commercialTracks.find((item) => item.name === selectedBusinessTrack) || commercialTracks[0] || null,
    [commercialTracks, selectedBusinessTrack],
  );
  const primaryPlatformRecommendation = platformRecommendations[0] ?? null;
  const secondaryPlatformRecommendations = platformRecommendations.slice(1, 3);
  const visibleBusinessInsights = useMemo(
    () => businessInsights
      .filter((item) => item.detail.trim())
      .slice(0, 4),
    [businessInsights],
  );
  const visibleGrowthPlan = useMemo(
    () => growthPlan.slice(0, 3),
    [growthPlan],
  );
  const visibleAssetExtensions = useMemo(
    () => creationAssist?.assetExtensions.slice(0, 3) ?? [],
    [creationAssist],
  );
  const directCommercialAngles = useMemo(
    () => analysis?.commercialAngles?.slice(0, 4) ?? [],
    [analysis],
  );
  const personalizedDirectionCards = useMemo(
    () => buildPersonalizedDirectionCards(growthSnapshot, directCommercialAngles),
    [growthSnapshot, directCommercialAngles],
  );
  const primaryCommercialAngle = directCommercialAngles[0] ?? null;
  const directTitleSuggestions = useMemo(
    () => analysis?.titleSuggestions?.slice(0, 3) ?? [],
    [analysis],
  );
  const showPremiumReport = Boolean(analysis && hasPaidGrowthAccess);
  const getSectionCardClass = useCallback(
    (panelId: string, accent: string) => isPanelLinked(activeDashboardPanel, panelId)
      ? `relative overflow-hidden rounded-[28px] border ${accent} bg-[#122039] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.08),0_18px_40px_rgba(7,14,26,0.32)]`
      : "rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6",
    [activeDashboardPanel],
  );

  useEffect(() => {
    if (!dashboardPanels.length) return;
    if (!dashboardPanels.some((item) => item.id === activeDashboardPanel)) {
      setActiveDashboardPanel(dashboardPanels[0].id);
    }
  }, [dashboardPanels, activeDashboardPanel]);

  useEffect(() => {
    if (!comparePlatformOptions.length) return;
    if (!selectedComparePlatform || !comparePlatformOptions.includes(selectedComparePlatform)) {
      setSelectedComparePlatform(comparePlatformOptions[1] || comparePlatformOptions[0] || "");
    }
  }, [comparePlatformOptions, selectedComparePlatform]);

  useEffect(() => {
    if (!commercialTracks.length) return;
    if (!selectedBusinessTrack || !commercialTracks.some((item) => item.name === selectedBusinessTrack)) {
      setSelectedBusinessTrack(commercialTracks[0]?.name || "");
    }
  }, [commercialTracks, selectedBusinessTrack]);

  useEffect(() => {
    if (!conversionFunnels.length) return;
    if (!selectedFunnelSegment || !conversionFunnels.some((item) => item.id === selectedFunnelSegment)) {
      setSelectedFunnelSegment(conversionFunnels[0]?.id || "");
    }
  }, [conversionFunnels, selectedFunnelSegment]);

  const activateDashboardPanel = useCallback((panelId: string) => {
    setActiveDashboardPanel(panelId);
    if (panelId === "platforms" && comparePlatformOptions.length) {
      setSelectedComparePlatform(comparePlatformOptions[1] || comparePlatformOptions[0] || "");
    }
    if (panelId === "monetization" && commercialTracks.length) {
      setSelectedBusinessTrack(commercialTracks[0]?.name || "");
    }
    if (panelId === "positioning" || panelId === "content") {
      setSelectedTrendPlatform("all");
    }
    const target = sectionRefs.current[PANEL_SCROLL_TARGETS[panelId] || panelId];
    if (target) {
      requestAnimationFrame(() => {
        const rect = target.getBoundingClientRect();
        const withinViewport = rect.top >= 80 && rect.top <= window.innerHeight * 0.55;
        if (!withinViewport) {
          target.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      });
    }
  }, [commercialTracks, comparePlatformOptions]);

  const activePanelDetail = dashboardPanels.find((item) => item.id === activeDashboardPanel) || dashboardPanels[0];

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-[#08111f] text-[#f7f4ef]">
        <Loader2 className="h-8 w-8 animate-spin text-[#ff8a3d]" />
        <span className="mt-4 text-white/60">检查登录状态...</span>
      </div>
    );
  }

  if (!isAuthenticated && !supervisorAccess) return null;

  return (
    <div className="min-h-screen bg-[#08111f] text-[#f7f4ef]">
      <div className="mx-auto max-w-[1760px] px-4 py-8">
        <UsageQuotaBanner
          featureType="analysis"
          currentCount={usageStatsQuery.data?.features.analysis.currentCount ?? 0}
          freeLimit={usageStatsQuery.data?.features.analysis.limit ?? 2}
          loading={usageStatsQuery.isPending}
        />
        <TrialCountdownBanner
          isTrial={(usageStatsQuery.data as any)?.isTrial}
          trialEndDate={(usageStatsQuery.data as any)?.trialEndDate}
          trialExpired={(usageStatsQuery.data as any)?.trialExpired}
        />
        {usageStatsQuery.data?.studentPlan ? (
          <StudentUpgradePrompt
            studentPlan={usageStatsQuery.data.studentPlan}
            usageData={usageStatsQuery.data.features}
            isTrial={(usageStatsQuery.data as any).isTrial}
            trialEndDate={(usageStatsQuery.data as any).trialEndDate}
          />
        ) : null}

          <div className="mb-8 flex items-center justify-between">
          <button onClick={() => window.history.back()} className="rounded-full border border-white/10 bg-white/5 p-2 transition hover:bg-white/10">
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-wrap items-center gap-2">
            {supervisorAccess ? (
              <>
                <button
                  type="button"
                  onClick={() => setDebugMode((prev) => !prev)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/75 transition hover:bg-white/10"
                >
                  {debugMode ? "Debug ON" : "Debug OFF"}
                </button>
                <div className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
                  Supervisor Mode
                </div>
              </>
            ) : null}
            <div className="rounded-full border border-[#ff8a3d]/30 bg-[#ff8a3d]/10 px-3 py-1 text-sm text-[#ffb37f]">
              Creator Growth Camp
            </div>
          </div>
        </div>

        <section className="relative overflow-hidden rounded-[32px] border border-white/10 bg-[radial-gradient(circle_at_top_left,rgba(255,138,61,0.2),transparent_28%),radial-gradient(circle_at_top_right,rgba(38,132,255,0.15),transparent_24%),linear-gradient(180deg,#101d31_0%,#08111f_72%)] p-6 md:p-10">
          <div className="space-y-8">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs uppercase tracking-[0.24em] text-white/55">
                <Sparkles className="h-3.5 w-3.5" />
                创作商业成长营
              </div>
              <h1 className="mt-4 max-w-5xl text-4xl font-black leading-[0.96] text-white md:text-[86px]">
                <span className="block whitespace-nowrap">让你的图文与视频创意，发挥它们的</span>
                <span className="mt-3 inline-block rounded-[24px] border border-[#ffcf92]/45 bg-[#ffcf92]/8 px-5 py-2 text-[#fff6e7] shadow-[0_0_0_1px_rgba(255,207,146,0.12)]">
                  商业价值
                </span>
                <span className="ml-2 inline-block text-white/90">。</span>
              </h1>
              <p className="mt-5 max-w-4xl text-base leading-8 text-white/70">
                直接指出内容卡在哪里、该先修什么、先发哪里，以及怎么把流量接到可成交的商业动作。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">内容分析</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">趋势洞察</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">商业洞察</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">推荐平台</div>
                <div className="rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white/80">7 天增长规划</div>
              </div>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-black/20 p-5 backdrop-blur-sm">
              {!selectedFile ? (
                <button
                  onClick={handleSelectFile}
                  className="flex min-h-[320px] w-full flex-col items-center justify-center rounded-[24px] border border-dashed border-white/15 bg-white/5 px-6 text-center transition hover:bg-white/10"
                >
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ff8a3d] text-black">
                    <Upload className="h-7 w-7" />
                  </div>
                  <div className="mt-5 text-2xl font-bold">上传图文档案或视频素材</div>
                  <p className="mt-3 max-w-md text-sm leading-7 text-white/60">
                    支持 Word、PDF、MP4。上传后会直接帮你找出内容卖点、转化缺口与可放大的商业方向，让分析结果值得你采用。
                  </p>
                </button>
              ) : (
                <div className="space-y-4">
                  {previewUrl ? (
                    <div className="overflow-hidden rounded-[24px] border border-white/10 bg-black/30">
                      <img src={previewUrl} alt="Selected" className="max-h-[360px] w-full object-cover" />
                    </div>
                  ) : (
                    <div className="flex min-h-[220px] flex-col items-center justify-center rounded-[24px] border border-white/10 bg-black/30 px-6 text-center">
                      {inputKind === "document" ? <FileUp className="h-12 w-12 text-[#ffb37f]" /> : <Film className="h-12 w-12 text-[#ffb37f]" />}
                      <div className="mt-4 text-xl font-bold text-white">
                        {inputKind === "document" ? "文档已就绪" : "视频文件已就绪"}
                      </div>
                      <p className="mt-2 text-sm leading-7 text-white/60">
                        {inputKind === "document"
                          ? "会先提取内容，再输出定位、平台与商业建议。"
                          : "会先抽帧与理解节奏，再输出可直接执行的分析报告。"}
                      </p>
                    </div>
                  )}
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-white/70">
                    <div className="flex items-center justify-between gap-3">
                      <span className="flex items-center gap-2">
                        <FileUp className="h-4 w-4 text-[#ffb37f]" />
                        {fileName || "未命名文件"}
                      </span>
                      <span>{(fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                    </div>
                    <div className="mt-4 h-2 rounded-full bg-white/10">
                      <div className="h-2 rounded-full bg-[#ff8a3d]" style={{ width: `${uploadProgress}%` }} />
                    </div>
                    {isProcessing ? (
                      <div className="mt-3 space-y-3 text-xs text-white/55">
                        <div className="flex items-center justify-between gap-3">
                          <div className="font-medium text-white/78">{processingStatusMessage}</div>
                          <div className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-white/60">
                            {uploadProgress}%
                          </div>
                        </div>
                        {activeProcessingStep ? (
                          <div className="rounded-xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/8 px-3 py-2.5 text-white/75">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-[#ffcf92]">当前步骤</div>
                            <div className="mt-1 text-sm font-semibold text-white">{activeProcessingStep.label}</div>
                            <div className="mt-1 leading-6 text-white/68">{activeProcessingStep.detail}</div>
                          </div>
                        ) : null}
                        {processingSteps.length ? (
                          <div className="grid gap-2 md:grid-cols-3">
                            {processingSteps.map((step) => (
                              <div
                                key={step.id}
                                className={`rounded-xl border px-3 py-2.5 ${
                                  step.status === "done"
                                    ? "border-emerald-300/20 bg-emerald-400/10 text-emerald-100"
                                    : step.status === "active"
                                      ? "border-[#ff8a3d]/25 bg-white/8 text-white"
                                      : "border-white/10 bg-black/20 text-white/45"
                                }`}
                              >
                                <div className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                                  {step.status === "done" ? "已完成" : step.status === "active" ? "进行中" : "等待中"}
                                </div>
                                <div className="mt-1 text-sm font-semibold">{step.label}</div>
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {processingDetailMessages.length ? (
                          <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                            <div className="text-[11px] uppercase tracking-[0.16em] text-white/45">模型正在做的事</div>
                            <div className="mt-2 space-y-2">
                              {processingDetailMessages.map((message, index) => (
                                <div key={`${index}-${message}`} className="flex items-start gap-2 text-white/65">
                                  <span className="mt-1 inline-block h-1.5 w-1.5 rounded-full bg-[#ff8a3d]" />
                                  <span className="leading-6">{message}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </div>
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".docx,application/pdf,video/mp4"
                onChange={handleFileChange}
                className="hidden"
              />

              <div className="mt-5">
                <label className="mb-2 block text-sm font-semibold text-white/80">
                  业务背景 / 商业目标
                </label>
                <textarea
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  rows={4}
                  placeholder="例如：我是形象穿搭美妆博主，想知道这支素材能承接什么商业价值，以及该先发哪个平台。"
                  className="w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white placeholder:text-white/30"
                />
              </div>

              <div className="mt-5">
                <div className="mb-2 block text-sm font-semibold text-white/80">分析模型</div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { value: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
                    { value: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro Preview" },
                  ].map((option) => {
                    const isActive = selectedGrowthModel === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setSelectedGrowthModel(option.value as GrowthCampModel)}
                        className={`rounded-2xl border px-4 py-2 text-sm font-semibold transition ${
                          isActive
                            ? "border-[#ff8a3d] bg-[#ff8a3d]/15 text-[#ffb37f]"
                            : "border-white/10 bg-white/5 text-white/70 hover:bg-white/10"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={handleAnalyze}
                  disabled={(!selectedFile && !fileBase64) || isProcessing}
                  className="inline-flex items-center gap-2 rounded-2xl bg-[#ff8a3d] px-5 py-3 font-bold text-black transition hover:bg-[#ff9c5c] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />}
                  生成成长营报告
                </button>
                <button
                  onClick={handleReset}
                  className="rounded-2xl border border-white/10 bg-white/5 px-5 py-3 font-semibold text-white/80 transition hover:bg-white/10"
                >
                  重置
                </button>
              </div>

              {error ? <div className="mt-4 text-sm text-rose-300">{error}</div> : null}
            </div>
          </div>
            </section>

        {!analysis ? (
          <section className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                <div className="flex items-center gap-3 text-[#ffb37f]">
                  <Compass className="h-5 w-5" />
                  <span className="font-semibold">趋势洞察</span>
                </div>
              </div>
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#90c4ff]">
                <BriefcaseBusiness className="h-5 w-5" />
                <span className="font-semibold">商业洞察</span>
              </div>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#9df6c0]">
                <Send className="h-5 w-5" />
                <span className="font-semibold">推荐平台</span>
              </div>
            </div>
          </section>
        ) : null}

        {debugMode ? (
          <section className="mt-8 space-y-6">
            <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-400/10 p-5">
                <div className="text-sm font-semibold text-cyan-100">Debug 面板</div>
                <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold ${
                  growthAnomalies.length
                    ? "border-red-300/40 bg-red-500/15 text-red-100"
                    : "border-emerald-300/30 bg-emerald-500/15 text-emerald-100"
                }`}>
                  系统状态：{growthHealthState}
                </div>
                {growthAnomalies.length ? (
                  <div className="mt-3 space-y-2 rounded-2xl border border-red-300/20 bg-red-500/10 p-4 text-sm text-red-50">
                    {growthAnomalies.map((item, index) => (
                      <div key={`growth-anomaly-${index}`} className="leading-6">
                        <span className="font-semibold">{String(item.title || "异常")}</span>
                        <span>：{String(item.message || "-")}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 grid gap-2 text-sm text-white/75 md:grid-cols-2">
                  <div>输入类型：{String(debugInfo?.inputKind || inputKind || "-")}</div>
                  <div>路由：{String(debugInfo?.route || "-")}</div>
                  <div>服务提供方：{String(debugInfo?.provider || "-")}</div>
                  <div>模型：{String(debugInfo?.model || "-")}</div>
                  <div>当前选择模型：{selectedGrowthModel}</div>
                  <div>降级补位：{String(debugInfo?.fallback ?? "-")}</div>
                  <div>趋势数据来源：{String(growthSnapshot?.status.source || "-")}</div>
                  <div>真值口径：{formatTruthSource(growthSystemStatusQuery.data?.truthStore?.source)}</div>
                  <div>真值更新时间：{formatShanghaiDateTime(String(growthSystemStatusQuery.data?.truthStore?.updatedAt || ""))}</div>
                  <div>真值当前总量：{String(growthSystemStatusQuery.data?.truthStore?.currentItems ?? "-")}</div>
                  <div>真值历史总量：{String(growthSystemStatusQuery.data?.truthStore?.archivedItems ?? "-")}</div>
                  <div className={growthSystemStatusQuery.data?.storage?.lowSpace ? "font-semibold text-red-300 animate-pulse" : ""}>
                    剩余空间：{growthSystemStatusQuery.data?.storage ? `${String(growthSystemStatusQuery.data.storage.freeMb)} MB` : "-"}
                  </div>
                  <div>已用空间：{growthSystemStatusQuery.data?.storage ? `${String(growthSystemStatusQuery.data.storage.usedMb)} / ${String(growthSystemStatusQuery.data.storage.totalMb)} MB` : "-"}</div>
                  <div>服务健康度：{String(growthSystemStatusQuery.data?.serviceHealth?.label || (growthAnomalies.length ? "critical" : "passing"))}</div>
                  <div>健康检查时间：{formatShanghaiDateTime(String(growthSystemStatusQuery.data?.serviceHealth?.checkedAt || ""))}</div>
                  <div>运行模式：{String(growthSystemStatusQuery.data?.runtimeControl?.mode || "auto")}</div>
                  <div>模式更新时间：{formatShanghaiDateTime(String(growthSystemStatusQuery.data?.runtimeControl?.updatedAt || ""))}</div>
                  <div>文件类型：{String(debugInfo?.mimeType || fileMimeType || "-")}</div>
                  <div>文件名：{String(debugInfo?.fileName || fileName || "-")}</div>
                  <div>邮件配置可用：{String(growthSystemStatusQuery.data?.smtp?.configured ?? "-")}</div>
                  <div>邮件接收人：{String(growthSystemStatusQuery.data?.targetEmail || "-")}</div>
                  <div>邮件发送人：{String(growthSystemStatusQuery.data?.smtp?.from || "-")}</div>
                  <div>缺失配置：{Array.isArray(growthSystemStatusQuery.data?.smtp?.missing) ? growthSystemStatusQuery.data?.smtp?.missing.join(", ") || "-" : "-"}</div>
                  {debugInfo?.extractionMethod ? <div>提取方式：{String(debugInfo.extractionMethod)}</div> : null}
                  {debugInfo?.videoDuration ? <div>视频时长秒数：{String(debugInfo.videoDuration)}</div> : null}
                  {debugInfo?.transcriptChars ? <div>转录字数：{String(debugInfo.transcriptChars)}</div> : null}
                  {debugInfo?.failureStage ? <div>失败阶段：{String(debugInfo.failureStage)}</div> : null}
                  {debugInfo?.failureReason ? <div>失败原因：{String(debugInfo.failureReason)}</div> : null}
                </div>
                <div className="mt-4 rounded-2xl border border-fuchsia-200/15 bg-black/15 p-4 text-xs text-white/75">
                  <div className="font-semibold text-fuchsia-100">运行控制</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { mode: "auto", label: "自动" },
                      { mode: "live", label: "只跑 live" },
                      { mode: "backfill", label: "只跑回填" },
                    ].map((item) => {
                      const active = growthSystemStatusQuery.data?.runtimeControl?.mode === item.mode;
                      return (
                        <button
                          key={item.mode}
                          type="button"
                          onClick={() => setGrowthRuntimeModeMutation.mutate({ mode: item.mode as "auto" | "live" | "backfill" })}
                          disabled={setGrowthRuntimeModeMutation.isPending}
                          className={`rounded-full border px-3 py-1.5 transition ${
                            active
                              ? "border-fuchsia-300 bg-fuchsia-400/20 text-fuchsia-100"
                              : "border-white/15 bg-white/5 text-white/75 hover:border-fuchsia-200/30 hover:text-white"
                          } ${setGrowthRuntimeModeMutation.isPending ? "opacity-60" : ""}`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-4 font-semibold text-fuchsia-100">Burst 控制</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {[
                      { burst: "auto", label: "自动" },
                      { burst: "off", label: "全部关闭" },
                      { burst: "manual", label: "手动平台" },
                    ].map((item) => {
                      const active = growthSystemStatusQuery.data?.runtimeControl?.burst === item.burst;
                      return (
                        <button
                          key={item.burst}
                          type="button"
                          onClick={() => trySetBurstControl({
                            burst: item.burst as "auto" | "manual" | "off",
                            platforms: item.burst === "manual"
                              ? (((growthSystemStatusQuery.data?.runtimeControl?.burstPlatforms as Array<"douyin" | "xiaohongshu" | "bilibili" | "kuaishou" | "toutiao"> | undefined) || []))
                              : [],
                          })}
                          disabled={setGrowthBurstControlMutation.isPending}
                          className={`rounded-full border px-3 py-1.5 transition ${
                            active
                              ? "border-fuchsia-300 bg-fuchsia-400/20 text-fuchsia-100"
                              : "border-white/15 bg-white/5 text-white/75 hover:border-fuchsia-200/30 hover:text-white"
                          } ${setGrowthBurstControlMutation.isPending ? "opacity-60" : ""}`}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {(["douyin", "kuaishou", "bilibili", "xiaohongshu", "toutiao"] as const).map((platform) => {
                      const selected = ((growthSystemStatusQuery.data?.runtimeControl?.burstPlatforms as string[] | undefined) || []).includes(platform);
                      const manual = growthSystemStatusQuery.data?.runtimeControl?.burst === "manual";
                      return (
                        <button
                          key={platform}
                          type="button"
                          onClick={() => {
                            const current = new Set(((growthSystemStatusQuery.data?.runtimeControl?.burstPlatforms as string[] | undefined) || []));
                            if (current.has(platform)) current.delete(platform);
                            else current.add(platform);
                            trySetBurstControl({
                              burst: "manual",
                              platforms: Array.from(current) as Array<"douyin" | "xiaohongshu" | "bilibili" | "kuaishou" | "toutiao">,
                            });
                          }}
                          disabled={setGrowthBurstControlMutation.isPending}
                          className={`rounded-full border px-3 py-1.5 transition ${
                            manual && selected
                              ? "border-amber-300 bg-amber-400/20 text-amber-100"
                              : "border-white/15 bg-white/5 text-white/75 hover:border-amber-200/30 hover:text-white"
                          } ${setGrowthBurstControlMutation.isPending ? "opacity-60" : ""}`}
                        >
                          {getPlatformLabel(platform)}
                        </button>
                      );
                    })}
                  </div>
                  {hasCriticalGrowthAnomaly ? (
                    <div className="mt-3 text-xs font-semibold text-red-200">
                      当前系统状态异常，不建议开启 burst。
                    </div>
                  ) : null}
                </div>
                {growthSystemStatusQuery.data?.truthStore?.platforms?.length ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-sky-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-sky-100">各平台真值拆分</div>
                    <div className="space-y-2">
                      {growthSystemStatusQuery.data.truthStore.platforms.map((item) => (
                        <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} live 当前量：{String(item.currentItems || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} historical 历史量：{String(item.archivedItems || 0)}</div>
                          <div className="md:col-span-2">{String(item.platformLabel || getPlatformLabel(item.platform))} 说明：{String(item.platformDescription || getPlatformDescription(item.platform))}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
                {growthSnapshotDebug ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-emerald-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-emerald-100">Growth Snapshot Debug</div>
                    <div className="grid gap-1 md:grid-cols-2">
                      <div>快照路由：{String(growthSnapshotDebug.route || "-")}</div>
                      <div>快照模型：{String(growthSnapshotDebug.modelName || "-")}</div>
                      <div>基础来源：{String(growthSnapshotDebug.baseSource || "-")}</div>
                      <div>最终来源：{String(growthSnapshotDebug.finalSource || "-")}</div>
                      <div>分析窗口天数：{String(growthSnapshotDebug.windowDays || "-")}</div>
                      <div>是否有实时样本：{String(growthSnapshotDebug.hasAnyLiveCollection ?? "-")}</div>
                      <div>是否应用个性化：{String(growthSnapshotDebug.personalizedApplied ?? "-")}</div>
                      <div>状态备注数：{String(growthSnapshotDebug.notesCount || 0)}</div>
                      <div>请求平台：{formatPlatformList(growthSnapshotDebug.requestedPlatforms)}</div>
                      <div>过期平台：{formatPlatformList(growthSnapshotDebug.stalePlatforms)}</div>
                      <div>趋势层数量：{String(growthSnapshotDebug.trendLayerCount || 0)}</div>
                      <div>选题库数量：{String(growthSnapshotDebug.topicLibraryCount || 0)}</div>
                      <div>平台快照数：{String(growthSnapshotDebug.platformSnapshotCount || 0)}</div>
                      <div>商业化轨道数：{String(growthSnapshotDebug.monetizationTrackCount || 0)}</div>
                      <div>平台建议数：{String(growthSnapshotDebug.recommendationCount || 0)}</div>
                      <div>商业洞察数：{String(growthSnapshotDebug.businessInsightCount || 0)}</div>
                      <div>增长步骤数：{String(growthSnapshotDebug.growthPlanCount || 0)}</div>
                      <div>资产扩展数：{String(growthSnapshotDebug.creationAssetExtensionCount || 0)}</div>
                    </div>
                    {growthSnapshot?.status?.notes?.length ? (
                      <div className="space-y-1 rounded-xl border border-emerald-200/15 bg-emerald-400/5 p-3 leading-6">
                        {growthSnapshot.status.notes.slice(0, 8).map((note, index) => (
                          <div key={`snapshot-note-${index}`}>{String(note)}</div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
                {growthSystemStatusQuery.data?.scheduler?.length && growthSystemStatusQuery.data?.runtimeControl?.mode !== "backfill" ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-cyan-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-cyan-100">抓取调度状态</div>
                    <div className="rounded-xl border border-cyan-200/15 bg-cyan-400/5 p-3 leading-6">
                      <div>全部平台 live：统一每 30 分钟抓取一次</div>
                      <div>burst 控制：{String(growthSystemStatusQuery.data?.runtimeControl?.burst || "auto")}</div>
                      <div>burst 平台：{(((growthSystemStatusQuery.data?.runtimeControl?.burstPlatforms as string[] | undefined) || []).map((item) => getPlatformLabel(item)).join("、")) || "-"}</div>
                      <div>历史回填：仍按独立 backfill 节奏执行，不跟 live 共用频率</div>
                    </div>
                    {growthSystemStatusQuery.data.scheduler.map((item) => (
                      <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 最近成功：{formatShanghaiDateTime(String(item.lastSuccessAt || ""))}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 下次执行：{formatShanghaiDateTime(String(item.nextRunAt || ""))}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 失败次数：{String(item.failureCount ?? 0)}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 爆发模式：{String(item.burstMode ?? false)}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 最近抓取量：{String(item.lastCollectedCount ?? 0)}</div>
                        <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 爆发开始：{formatShanghaiDateTime(String(item.burstTriggeredAt || ""))}</div>
                        <div className="md:col-span-2">{String(item.platformLabel || getPlatformLabel(item.platform))} 说明：{String(item.platformDescription || getPlatformDescription(item.platform))}</div>
                        <div className="md:col-span-2">{String(item.platformLabel || getPlatformLabel(item.platform))} 错误：{String(item.lastError || "-")}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {[{
                  key: "live",
                  title: "近期回填进度",
                  data: growthSystemStatusQuery.data?.backfillLive,
                }, {
                  key: "history",
                  title: "历史回填进度",
                  data: growthSystemStatusQuery.data?.backfillHistory,
                }].map((section) => {
                  const sectionData = section.data;
                  return sectionData ? (
                  <div key={section.key} className="mt-4 space-y-2 rounded-2xl border border-amber-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-amber-100">{section.title}</div>
                    <div className="grid gap-1 md:grid-cols-2">
                      <div>status: {String(sectionData.status || "-")}</div>
                      <div>active: {String(sectionData.active ?? false)}</div>
                      <div>window days: {String(sectionData.selectedWindowDays || "-")}</div>
                      <div>回填模式：{section.key === "history" ? "夜间 burst / 每 15 分钟" : "夜间 live 回填 / 每 15 分钟"}</div>
                      <div>开始时间：{formatShanghaiDateTime(String(sectionData.startedAt || ""))}</div>
                      <div>下一次回填：{formatShanghaiDateTime(String(sectionData.nextRunAt || ""))}</div>
                      <div>更新时间：{formatShanghaiDateTime(String(sectionData.updatedAt || ""))}</div>
                      <div>结束时间：{formatShanghaiDateTime(String(sectionData.finishedAt || ""))}</div>
                    </div>
                    <div className="rounded-xl border border-amber-200/15 bg-amber-400/5 p-3 leading-6">
                      {String(sectionData.note || "-")}
                    </div>
                    <div className="space-y-2">
                      {sectionData.platforms?.map((item) => (
                        <div key={`${section.key}-${String(item.platform)}`} className="grid gap-1 md:grid-cols-2">
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 状态：{String(item.status || "-")}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 历史量：{String(item.archivedTotal || 0)} / {String(item.target || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 开始回填：{formatShanghaiDateTime(String(item.startedAt || sectionData.startedAt || ""))}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 下次回填：{formatShanghaiDateTime(String(item.nextRunAt || sectionData.nextRunAt || ""))}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 当前量：{String(item.currentTotal || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 新增：{String(item.addedCount || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 合并：{String(item.mergedCount || 0)}</div>
                          <div>{String(item.platformLabel || getPlatformLabel(item.platform))} 平台停滞轮数：{String(item.plateauCount || 0)}</div>
                          <div className="md:col-span-2">{String(item.platformLabel || getPlatformLabel(item.platform))} 错误：{String(item.error || "-")}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null})}
              </div>
          </section>
        ) : null}

        {analysis ? (
          <section className="mt-8 space-y-6">
            {showPremiumReport ? (
              <div className="space-y-6">
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <LayoutDashboard className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">本次个性化判断</h2>
                  </div>
                  <div className="mt-5 grid gap-4 xl:grid-cols-[1.25fr_0.95fr]">
                    <div className="rounded-[24px] border border-white/10 bg-black/15 p-5">
                      <div className="text-xs uppercase tracking-[0.18em] text-[#7ee7ff]">核心结论</div>
                      <div className="mt-2 text-2xl font-black text-white">
                        {primaryCommercialAngle?.title || dashboardConsole?.headline || primaryPlatformRecommendation?.name || "先产出一版可执行方案"}
                      </div>
                      <p className="mt-3 max-w-3xl text-sm leading-7 text-white/68">
                        {primaryCommercialAngle
                          ? stripInternalJargon(`${primaryCommercialAngle.scenario} ${primaryCommercialAngle.whyItFits}`)
                          : dashboardConsole?.summary || growthSnapshot?.overview.summary || analysis.summary}
                      </p>
                    </div>
                    <div className="grid gap-4">
                      <div className="rounded-[24px] border border-[#ffd08f]/20 bg-[linear-gradient(135deg,rgba(255,208,143,0.12),rgba(255,255,255,0.03))] p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-[#ffd08f]">马上先做</div>
                        <div className="mt-3 text-sm leading-7 text-white">
                          {stripInternalJargon(primaryCommercialAngle?.execution || growthHandoff?.brief || primaryPlatformRecommendation?.action || visibleBusinessInsights[0]?.detail || "先把首发版改成一个用户一看就懂的版本。")}
                        </div>
                      </div>
                      <div className="rounded-[24px] border border-[#f5b7ff]/20 bg-[linear-gradient(135deg,rgba(245,183,255,0.12),rgba(255,255,255,0.03))] p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-[#f5b7ff]">内容延展</div>
                        <div className="mt-3 text-sm leading-7 text-white/78">
                          保留用户真正需要的版本建议、平台打法和延展方向，直接服务下一步创作和发布。
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 xl:grid-cols-[1.05fr_1.2fr]">
                <div className="rounded-[28px] border border-[#ff8a3d]/15 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <Sparkles className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">基础内容诊断</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/65">
                    免费版只提供素材本身的基础判断，包括五维度评分、当前优势和优先问题。优化方案、商业分析、平台建议和增长规划属于付费服务，不在免费版展示范围内。
                  </p>
                  <div className="mt-5 rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/68">
                    <div className="font-semibold text-white">当前可查看</div>
                    <div className="mt-2">1. 五维度成熟度</div>
                    <div>2. 内容优点</div>
                    <div>3. 优先问题</div>
                  </div>
                  <div className="mt-4 rounded-2xl border border-amber-300/15 bg-amber-400/10 p-4 text-sm leading-7 text-amber-50">
                    升级后可解锁：趋势洞察、平台优化方案、商业分析、推荐发布平台、7 天增长规划与创作执行简报。
                  </div>
                </div>
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center justify-between">
                    <div className="text-lg font-bold text-white">五维度成熟度</div>
                    <div className="text-xs text-white/45">满分 100</div>
                  </div>
                  <div className="mt-4 h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={scoreDistributionData} margin={{ top: 12, right: 8, left: -24, bottom: 8 }}>
                        <CartesianGrid stroke="rgba(255,255,255,0.08)" vertical={false} />
                        <XAxis dataKey="name" tick={{ fill: "rgba(255,255,255,0.55)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <YAxis domain={[0, 100]} tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: "rgba(255,255,255,0.04)" }}
                          contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                        />
                        <Bar dataKey="value" radius={[10, 10, 0, 0]}>
                          {scoreDistributionData.map((entry) => (
                            <Cell
                              key={entry.name}
                              fill={entry.value >= 80 ? "#8ef0b1" : entry.value >= 65 ? "#ffd08f" : "#ff9cab"}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/60">
                    说明：以上 5 个维度是独立评分，满分均为 100 分，数值越高代表该维度越成熟，并不是综合总分。
                  </p>
                </div>
              </div>
            )}

            <div className="space-y-6">
              {!showPremiumReport ? (
              <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                <div className="flex items-center gap-3 text-[#ffb37f]">
                  <Sparkles className="h-5 w-5" />
                  <h2 className="text-2xl font-bold">内容分析</h2>
                </div>
                <div className="mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
                  <table className="w-full border-collapse text-sm leading-7 text-white/75">
                    <tbody>
                      {contentAnalysisRows.map((row) => (
                        <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                          <td className="w-32 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                          <td className="px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                          <td className="px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                          <td className="px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              ) : null}

              {showPremiumReport ? null : (
                <div className="rounded-[28px] border border-[#ff8a3d]/15 bg-[#0f1a2c] p-6">
                  <div className="flex items-center gap-3 text-[#ffcf92]">
                    <BriefcaseBusiness className="h-5 w-5" />
                    <h2 className="text-2xl font-bold">付费版可解锁内容</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/65">
                    趋势判断、平台建议、商业承接和 7 天计划都属于付费版内容，不在免费版展示范围内。
                  </p>
                </div>
              )}

              {showPremiumReport ? (
                <div className="space-y-6">
                  <div ref={(node) => { sectionRefs.current.execution = node; }} className="rounded-[28px] border border-[#ffd08f]/25 bg-[#0f1a2c] p-6">
                    <div className="flex items-center gap-3 text-[#ffd08f]">
                      <Rocket className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">现在就能执行的版本</h2>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-white/60">
                      这里只保留首发版最重要的动作，方便你直接进入改稿和发布。
                    </p>
                    <div className="mt-5 grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                      <div className="rounded-2xl border border-[#ffd08f]/20 bg-[linear-gradient(135deg,rgba(255,208,143,0.12),rgba(255,255,255,0.03))] p-5">
                        <div className="text-xs uppercase tracking-[0.18em] text-[#ffd08f]">首发版改法</div>
                        <div className="mt-3 text-base font-semibold leading-8 text-white">
                          {stripInternalJargon(primaryCommercialAngle?.execution || growthHandoff?.brief || creationAssist?.brief || primaryPlatformRecommendation?.action || visibleBusinessInsights[0]?.detail || "先把这条内容改成一个用户一看就懂、且愿意继续看的版本。")}
                        </div>
                        {primaryCommercialAngle?.hook ? (
                          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white/72">
                            开场钩子：{stripInternalJargon(primaryCommercialAngle.hook)}
                          </div>
                        ) : null}
                        {growthHandoff?.workflowPrompt ? (
                          <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm leading-7 text-white/72">
                            {growthHandoff.workflowPrompt}
                          </div>
                        ) : null}
                      </div>
                      <div className="grid gap-4">
                        <a
                          href="/workflow-nodes?supervisor=1"
                          onClick={() => handleStoreHandoff(growthHandoff, "分析结果已同步到创作画布")}
                          className="block rounded-2xl border border-[#ff8a3d]/30 bg-[linear-gradient(135deg,rgba(255,138,61,0.2),rgba(255,255,255,0.04))] px-4 py-4 text-base font-bold text-[#ffd4b7] transition hover:bg-[#ff8a3d]/20"
                        >
                          进入创作画布，直接改首发脚本和镜头
                        </a>
                        {directTitleSuggestions.length ? (
                          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-sm font-semibold text-white">先从这几个标题开始</div>
                            <div className="mt-3 space-y-3">
                              {directTitleSuggestions.map((item: string, index: number) => (
                                <div key={`${index}-${item}`} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm leading-7 text-white/76">
                                  <span className="mr-2 font-semibold text-[#9df6c0]">标题 {index + 1}</span>
                                  <span className="font-semibold text-white">{stripInternalJargon(item)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : visibleGrowthPlan.length ? (
                          <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                            <div className="text-sm font-semibold text-white">接下来三步</div>
                            <div className="mt-3 space-y-3">
                              {visibleGrowthPlan.map((item) => (
                                <div key={item.day} className="rounded-xl border border-white/10 bg-white/5 px-3 py-3 text-sm leading-7 text-white/76">
                                  <span className="mr-2 font-semibold text-[#9df6c0]">第 {item.day} 步</span>
                                  <span className="font-semibold text-white">{item.title}</span>
                                  <div className="mt-1 text-white/70">{item.action}</div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {personalizedDirectionCards.length ? (
                    <div ref={(node) => { sectionRefs.current.platforms = node; }} className="rounded-[28px] border border-[#90c4ff]/25 bg-[#0f1a2c] p-6">
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3 text-[#90c4ff]">
                          <Send className="h-5 w-5" />
                          <h2 className="text-2xl font-bold">个性化增长方向</h2>
                        </div>
                        <div className="rounded-full border border-[#90c4ff]/20 bg-[#90c4ff]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#b9dbff]">
                          数据证据优先
                        </div>
                      </div>
                      <div className="mt-5 grid gap-4 xl:grid-cols-2">
                        {personalizedDirectionCards.map((angle, index) => (
                          <div key={`${angle.title}-${index}`} className="rounded-2xl border border-white/10 bg-black/15 p-5">
                            <div className="flex items-center justify-between gap-3">
                              <div className="text-xl font-black text-white">{angle.title}</div>
                              <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/60">
                                {angle.badge}
                              </div>
                            </div>
                            <div className="mt-4 rounded-2xl border border-white/10 bg-[#111b2c] px-4 py-3 text-sm leading-7 text-white/78">
                              {stripInternalJargon(angle.scenario)}
                            </div>
                            <div className="mt-4 rounded-2xl border border-[#90c4ff]/20 bg-[#10233e] px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-[#b9dbff]">为什么这条方向对你成立</div>
                              <div className="mt-2 text-sm leading-7 text-white">{stripInternalJargon(angle.why)}</div>
                            </div>
                            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 px-4 py-3">
                              <div className="text-xs uppercase tracking-[0.16em] text-white/45">直接执行</div>
                              <div className="mt-2 text-sm leading-7 text-white/78">{stripInternalJargon(angle.action)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>

      <QuotaExhaustedModal
        isOpen={quotaModalVisible}
        onClose={() => setQuotaModalVisible(false)}
        featureType="analysis"
        isTrial={quotaModalInfo.isTrial}
        planName={quotaModalInfo.planName}
      />
    </div>
  );
}
