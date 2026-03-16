import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { trpc } from "@/lib/trpc";
import { UsageQuotaBanner } from "@/components/UsageQuotaBanner";
import { StudentUpgradePrompt } from "@/components/StudentUpgradePrompt";
import { TrialCountdownBanner } from "@/components/TrialCountdownBanner";
import { QuotaExhaustedModal } from "@/components/QuotaExhaustedModal";
import { saveGrowthHandoff } from "@/lib/growthHandoff";
import type {
  GrowthBusinessInsight,
  GrowthHandoff,
  GrowthIndustryTemplate,
  GrowthPlanStep,
  GrowthPlatformRecommendation,
  GrowthSnapshot,
  GrowthTopicLibraryItem,
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

type TrendTableRow = {
  platform: string;
  topic: string;
  reason: string;
  action: string;
  highlight?: string;
};

const SUPERVISOR_ACCESS_KEY = "mvs-supervisor-access";
const FULL_PLATFORM_ORDER = ["douyin", "kuaishou", "bilibili", "xiaohongshu"] as const;
const PLATFORM_LABELS: Record<string, string> = {
  douyin: "抖音",
  xiaohongshu: "小红书",
  bilibili: "B站",
  kuaishou: "快手",
  weixin_channels: "视频号",
};

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

function getScoreTone(score: number) {
  if (score >= 80) return { label: "强", color: "text-emerald-300", chip: "border-emerald-300/20 bg-emerald-400/10 text-emerald-200" };
  if (score >= 65) return { label: "可放大", color: "text-amber-200", chip: "border-amber-300/20 bg-amber-400/10 text-amber-100" };
  return { label: "需重构", color: "text-rose-200", chip: "border-rose-300/20 bg-rose-400/10 text-rose-100" };
}

function formatPercent(value: number) {
  return `${Math.max(0, Math.min(100, Math.round(value)))}%`;
}

function compactText(text: string, maxLength = 72) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  const segments = normalized
    .split(/(?<=[。！？!?.])/)
    .map((item) => item.trim())
    .filter(Boolean);
  const concise = segments.slice(0, 2).join("");
  const basis = concise || normalized;
  return basis.length > maxLength ? `${basis.slice(0, maxLength - 1)}…` : basis;
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
      label: "综合成熟度",
      value: `${averageScore}%`,
      note: "基于五个独立维度的平均值，只用于快速判断当前整体成熟度。",
      tone: "from-[#ff8a3d]/30 via-[#ff8a3d]/10 to-transparent",
    },
    {
      id: "monetization",
      label: "高匹配商业方向",
      value: `${highConfidenceTracks.length}`,
      note: "只统计匹配度达到 80% 以上的方向，避免给用户空泛结论。",
      tone: "from-[#f5b7ff]/30 via-[#f5b7ff]/10 to-transparent",
    },
    {
      id: "positioning",
      label: "内容角色",
      value: averageScore >= 80 ? "可放大" : averageScore >= 65 ? "可优化" : "需重构",
      note: "先判断当前内容该直接放大、重剪，还是需要先重写定位与钩子。",
      tone: "from-[#9df6c0]/30 via-[#9df6c0]/10 to-transparent",
    },
    {
      id: "platforms",
      label: "首发建议",
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
  platforms: GrowthPlatformRecommendation[],
  industryTemplate?: GrowthIndustryTemplate | null,
): InsightTableRow[] {
  const audience = normalizeText(
    industryTemplate?.audience || context || "当前没有明确写出受众与成交目标，建议后续补全。",
  );
  const bestTrack = tracks.find((track) => track.fit >= 60);
  const primaryDirection = bestTrack?.name || "先不主打变现";
  const roleFixPlan = industryTemplate?.positioningHint
    ? `先把内容角色改成「${industryTemplate.positioningHint}」，再统一脚本、封面和结尾动作。`
    : "先把这条内容定义成引流内容、信任内容或成交内容中的一个，再写脚本和结尾动作。";
  return [
    {
      label: "🎯 受众痛点",
      insight: compactText(audience, 42),
      action: compactText(industryTemplate?.painPoint || "先写清楚用户卡在哪里，再决定这条内容是引流、信任还是成交。", 38),
      highlight: "先锁定一个痛点，不要一条内容想解决所有问题。",
    },
    {
      label: "🧭 内容角色",
      insight: compactText(
        industryTemplate?.positioningHint || analysis.summary || "这条内容当前更像素材，不是可以直接成交的完整内容。",
        50,
      ),
      action: compactText(roleFixPlan, 40),
      highlight: "先定角色，再定脚本和平台。",
    },
    {
      label: "💼 主商业方向",
      insight: primaryDirection === "先不主打变现"
        ? "当前先把入口内容做成熟，不要急着同时写品牌合作、带货和社群。"
        : `当前优先验证「${primaryDirection}」这一条路径。`,
      action: primaryDirection === "先不主打变现"
        ? "先把受众痛点、角色表达、案例证明和结尾动作做顺，再谈商业承接。"
        : compactText(industryTemplate?.primaryConversion || "结尾只保留一个明确承接动作，避免同时推多个变现方向。", 40),
      highlight: primaryDirection === "先不主打变现"
        ? "先跑通内容入口，再谈后续商业化。"
        : "单一路径比多方向堆叠更容易转化。",
    },
  ];
}

function buildContentAnalysisRows(analysis: AnalysisResult, industryTemplate?: GrowthIndustryTemplate | null): InsightTableRow[] {
  return [
    {
      label: "✅ 当前优势",
      insight: compactText(analysis.strengths[0] || industryTemplate?.trustAsset || "素材真实、有可延展的内容基础。", 40),
      action: compactText(analysis.strengths[1] || "把现有优势固定成可复用的标题、封面或镜头模板。", 36),
      highlight: "先固定可复用优势，不要每条都重来。",
    },
    {
      label: "⚠️ 优先优化点",
      insight: compactText(analysis.improvements[0] || "开头抓力不足，信息进入过慢。", 40),
      action: compactText(analysis.improvements[1] || industryTemplate?.analysisHint || "先重写前 2 到 3 秒，再处理字幕、节奏和转场。", 36),
      highlight: "先修最影响停留的问题。",
    },
    {
      label: "🧩 表达问题",
      insight: compactText(analysis.improvements[2] || industryTemplate?.painPoint || "信息顺序和视觉重点不够集中，用户很难快速理解卖点。", 40),
      action: compactText(industryTemplate?.positioningHint || "把一句核心结论放到最前面，剩下内容只服务这一句。", 36),
    },
    {
      label: "🚀 建议方向",
      insight: compactText(industryTemplate?.commercialFocus || analysis.summary || "当前内容有基础，但需要更强的结构和承接动作。", 40),
      action: compactText(industryTemplate?.analysisHint || "按“痛点 -> 方案 -> 行动”三段重写，不再堆砌过程描述。", 36),
      highlight: "结论更短，方案更具体，用户才知道下一步怎么做。",
    },
  ];
}

function buildTrendRows(
  growthSnapshot: GrowthSnapshot | null,
  _context: string,
  _platforms: GrowthPlatformRecommendation[],
): TrendTableRow[] {
  return (growthSnapshot?.topicLibrary || []).slice(0, 6).map((item: GrowthTopicLibraryItem) => ({
    platform: item.platformLabel,
    topic: normalizeText(item.title),
    reason: normalizeText(item.rationale),
    action: normalizeText(item.executionHint),
    highlight: normalizeText(item.commercialAngle),
  }));
}

function buildPlatformRecommendationRows(
  recommendations: GrowthPlatformRecommendation[],
  growthSnapshot: GrowthSnapshot | null,
): InsightTableRow[] {
  return recommendations.map((platform) => {
    const snapshot = growthSnapshot?.platformSnapshots.find((item) => item.displayName === platform.name);
    const publishAction = platform.name === "小红书"
      ? "先发一版可收藏笔记：封面只讲结果，正文按“场景痛点 -> 做法拆解 -> 收藏理由 -> 下一步动作”排。首发后立刻把这版拆成分镜，延展出 30 到 60 秒短视频。"
      : platform.name === "抖音"
        ? "做一版 9:16 结果前置短视频：开头 2 秒先给结论，中段只保留 2 到 3 个关键画面，结尾只留一个动作。需要放量时先小预算测标题和前 2 秒停留，再决定投流。"
        : platform.name === "快手"
          ? "改成更生活化、更结果导向的直给版：先说这件事值不值、适不适合、怎么做更省事。不要讲平台分析，只讲用户能立刻拿走的做法。"
          : "做一版 60 到 120 秒的案例拆解或复盘：先讲结果，再讲步骤和误区，最后告诉用户下一版还能看什么。需要建立信任时，优先放长尾搜索和案例页承接。";
    return {
      label: platform.name,
      insight: compactText(platform.reason, 56),
      action: publishAction,
      highlight: snapshot?.watchouts?.[0] ? `避免：${normalizeText(snapshot.watchouts[0])}` : undefined,
    };
  });
}

function buildBusinessTrackRows(tracks: CommercialTrack[], context: string, industryTemplate?: GrowthIndustryTemplate | null): InsightTableRow[] {
  const viableTracks = tracks.filter((track) => track.fit >= 45).slice(0, 3);
  if (!viableTracks.length) {
    return [{
      label: "当前阶段",
      insight: "这条内容现在还不适合直接讲品牌合作、带货或社群。先把入口、角色、案例表达和结尾动作跑通。",
      action: "先用 7 天计划把小红书首发版本做出来，验证收藏、停留、评论关键词，再决定后续承接方式。",
      highlight: "中长期商业化先放后面，短期先把内容入口做成熟。",
    }];
  }
  return viableTracks.map((track) => {
    if (track.name === "知识付费") {
      return {
        label: `${track.name} ${track.fit}%`,
        insight: "适合做「案例拆解 + 方法复盘 + 工具模板」的内容包，不适合只讲观点。先把一个可重复的结果方法讲清楚，再沉淀成训练营、陪跑或模板库。",
        action: "平台先用 B站做完整案例版，再把核心结论拆成小红书收藏笔记和抖音短视频。前期不建议重投流，先用自然流量验证收藏率、完播率和咨询率；只有转化入口清楚后，再小预算放大高完播版本。",
        highlight: "内容题型优先：诊断框架、复盘案例、三步方法、常见误区、模板演示。",
      };
    }
    if (track.name === "品牌合作") {
      return {
        label: `${track.name} ${track.fit}%`,
        insight: /美妆|穿搭|形象|妆|护肤|造型/.test(context)
          ? "不是泛写“可接品牌合作”，而是要围绕场景问题、解决方案和合作品类展开。先让品牌看懂你能替它卖什么场景。"
          : "品牌合作只在表达统一、案例清楚、服务结果讲透时才成立。没有案例页和结果说明时，不要把品牌合作写成主卖点。",
        action: /美妆|穿搭|形象|妆|护肤|造型/.test(context)
          ? "先补一版“场景问题 -> 解决方案 -> 可合作品类”的案例页，优先看运动美妆、防晒、功能护肤、运动服饰、造型工具和生活方式品牌。"
          : "先做一页行业案例说明：你解决什么问题、做出过什么结果、适合哪类品牌合作，再把内容里所有动作统一到这条承接页。",
        highlight: "只在合作类别、服务结果、承接页三件事都清楚时，品牌合作才值得主打。",
      };
    }
    if (track.name === "电商带货") {
      return {
        label: `${track.name} ${track.fit}%`,
        insight: "适合做结果前置、利益点直接、动作明确的转化型表达。先讲“这东西值不值、解决什么、怎么买”，再讲过程。",
        action: "先做一版强 CTA 的短视频或图文，验证点击和咨询。前期只小额测试 1 到 2 个结果前置版本，不先烧大预算投流。",
        highlight: "优先做单品转化，不要一上来混多个商品和多个动作。",
      };
    }
    return {
      label: `${track.name} ${track.fit}%`,
      insight: compactText(replaceTerms(track.reason), 72),
      action: compactText(replaceTerms(track.nextStep), 96),
      highlight: track.name === "社群会员"
        ? "只有固定主题、固定更新和固定权益三件事都成立，社群才值得做。"
        : industryTemplate?.offerExamples?.[0]
          ? `优先验证：${industryTemplate.offerExamples.slice(0, 2).join("、")}`
          : undefined,
    };
  });
}

function buildExecutionBriefRows(analysis: AnalysisResult, context: string): ExecutionBriefRow[] {
  const normalized = `${analysis.summary}\n${context}`;
  const isMedicalSports = /医生|医学|慢性病|健康管理|网球|比赛|运动损伤|康复/.test(normalized);
  if (isMedicalSports) {
    return [
      {
        label: "A. 核心分析",
        content: [
          "画面节奏与视觉：原始素材节奏平缓，无亮点。二次创作应通过关键击球慢放、运动员表情特写、关键信息字幕和数据图表来制造节奏与视觉焦点。",
          "叙事结构与口播/字幕：核心是打造“医生看比赛”的独特视角。可以做三种结构：1. 运动损伤科普。2. 慢性病管理关联。3. 励志故事与心理健康。",
        ].join("\n"),
      },
      {
        label: "B. 商业转化潜力",
        content: [
          "潜力巨大。通过上述内容，可将抽象医学知识具象化，塑造“懂健康、懂生活”的专家形象。",
          "转化路径：吸引精准用户 -> 建立信任 -> 导流到线上咨询、付费健康管理社群、相关课程或线下门诊。",
        ].join("\n"),
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
      content: compactText(analysis.strengths[0] || analysis.summary || "视觉上已经有亮点，但表达和承接还不够完整。", 120),
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

function buildCommercialTracks(
  analysis: AnalysisResult,
  context: string,
  growthSnapshot: GrowthSnapshot | null,
): CommercialTrack[] {
  const text = context.trim();
  const xiaohongshuFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "xiaohongshu")?.audienceFitScore || 0;
  const bilibiliFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "bilibili")?.audienceFitScore || 0;
  const douyinFit = growthSnapshot?.platformSnapshots.find((item) => item.platform === "douyin")?.audienceFitScore || 0;

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
      fit: Math.min(96, Math.round((analysis.impact + analysis.viralPotential + douyinFit) / 3 + (/带货|商品|电商|转化/.test(text) ? 8 : 0))),
      reason: "冲击力和节奏更适合做转化型表达，但产品利益点和 CTA 需要足够直接。",
      nextStep: "把前三秒改成结果或利益点前置，并把行动指令明确到橱窗、评论区或私域入口。",
    },
    {
      name: "知识付费",
      fit: Math.min(96, Math.round((analysis.composition + analysis.viralPotential + bilibiliFit) / 3 + (/课程|教学|知识|教程|陪跑/.test(text) ? 10 : 0))),
      reason: "适合把内容拆成方法、结构、案例复盘，再沉淀成课程、模板或陪跑服务。",
      nextStep: "把当前内容整理成“结果 + 三步方法 + 常见误区”的结构，形成可复用的方法论入口。",
    },
    {
      name: "社群会员",
      fit: Math.min(96, Math.round((analysis.color + analysis.lighting + xiaohongshuFit) / 3 + 4)),
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
  return [
    `内容目标：把当前素材升级成更适合 ${primaryPlatform} 分发、并服务于「${primaryTrack}」转化的内容版本。`,
    `核心分析：${analysis.summary}`,
    "开场建议：前 2-3 秒先给结果、反差或利益点，不要从铺垫开始。",
    "商业动作：结尾必须补 CTA，把观众导向案例咨询、服务介绍、商品入口或私域承接。",
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
      detail: `这块不是给用户看分数本身，而是让用户先知道当前内容更像“能直接放大”，还是“需要重写一版”。${role?.value ? ` 当前判断：${role.value}。` : ""}`,
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
      eyebrow: "平台矩阵",
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
      detail: growthPlan.slice(1, 4).map((item) => `Day ${item.day} ${item.title}：${item.action}`).join(" "),
      action: "先把短期结果做出来，再把同主题延展到分镜、视频和商业承接。",
      accent: "text-[#d7ff7f]",
      glow: "from-[#8effb1]/18 via-[#d7ff7f]/10 to-transparent",
    },
  ];
}

export default function MVAnalysisPage() {
  const [, navigate] = useLocation();
  const [supervisorAccess, setSupervisorAccess] = useState(() => hasSupervisorAccess());
  const { isAuthenticated, loading } = useAuth({ autoFetch: !supervisorAccess });

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [fileBase64, setFileBase64] = useState<string | null>(null);
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
    return new URLSearchParams(window.location.search).get("debug") === "1";
  });
  const [debugInfo, setDebugInfo] = useState<DebugInfo>(null);
  const [activeDashboardPanel, setActiveDashboardPanel] = useState("readiness");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef(0);

  const analyzeDocumentMutation = trpc.mvAnalysis.analyzeDocument.useMutation();
  const analyzeVideoMutation = trpc.mvAnalysis.analyzeVideo.useMutation();
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
      enabled: Boolean(analysis && hasPaidGrowthAccess),
      staleTime: 60_000,
    },
  );
  const growthSystemStatusQuery = trpc.mvAnalysis.getGrowthSystemStatus.useQuery(undefined, {
    enabled: debugMode,
    staleTime: 30_000,
    refetchInterval: debugMode ? 10_000 : false,
  });

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
        const dataUrl = await readFileAsDataUrl(file);
        setFileBase64(dataUrl.split(",")[1] || "");

        if (isDocument) {
          setUploadStage("idle");
          setUploadProgress(100);
          return;
        }

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
    if (!fileBase64 || !inputKind) return;

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
              fileBase64,
              mimeType: fileMimeType || "application/octet-stream",
              fileName,
              context: context || undefined,
            })
          : await analyzeVideoMutation.mutateAsync({
              fileBase64,
              mimeType: fileMimeType || "video/mp4",
              fileName,
              context: context || undefined,
            });
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
  }, [fileBase64, inputKind, supervisorAccess, checkAccessMutation, fileSize, analyzeDocumentMutation, analyzeVideoMutation, fileMimeType, fileName, context, usageStatsQuery]);

  const handleReset = useCallback(() => {
    setPreviewUrl(null);
    setFileBase64(null);
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

  const handleStoreHandoff = useCallback((handoff: GrowthHandoff | null, successMessage = "handoff 已暂存") => {
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
        { label: "商业放大空间", value: analysis.viralPotential },
      ];
    }
    if (inputKind === "video") {
      return [
        { label: "叙事结构", value: analysis.composition },
        { label: "视觉包装", value: analysis.color },
        { label: "信息清晰", value: analysis.lighting },
        { label: "节奏冲击", value: analysis.impact },
        { label: "商业放大空间", value: analysis.viralPotential },
      ];
    }
    return [
      { label: "构图结构", value: analysis.composition },
      { label: "色彩识别", value: analysis.color },
      { label: "光线氛围", value: analysis.lighting },
      { label: "冲击强度", value: analysis.impact },
      { label: "商业放大空间", value: analysis.viralPotential },
    ];
  }, [analysis, inputKind]);

  const isProcessing = uploadStage === "uploading" || uploadStage === "analyzing";
  const remainingTime = Math.max(0, estimatedTime - elapsedTime);

  const growthSnapshot: GrowthSnapshot | null = growthSnapshotQuery.data?.snapshot ?? null;
  const platformRecommendations = growthSnapshot?.platformRecommendations ?? [];
  const businessInsights: GrowthBusinessInsight[] = growthSnapshot?.businessInsights ?? [];
  const growthPlan: GrowthPlanStep[] = growthSnapshot?.growthPlan ?? [];
  const commercialTracks = useMemo(
    () => {
      if (!analysis) return [];
      return growthSnapshot?.monetizationTracks?.length
        ? growthSnapshot.monetizationTracks
        : buildCommercialTracks(analysis, context, growthSnapshot);
    },
    [analysis, context, growthSnapshot],
  );
  const growthHandoff = growthSnapshot?.growthHandoff ?? null;
  const positioningRows = useMemo(
    () => analysis ? buildPositioningRows(analysis, context, commercialTracks, platformRecommendations, growthSnapshot?.industryTemplate) : [],
    [analysis, context, commercialTracks, platformRecommendations, growthSnapshot?.industryTemplate],
  );
  const contentAnalysisRows = useMemo(
    () => analysis ? buildContentAnalysisRows(analysis, growthSnapshot?.industryTemplate) : [],
    [analysis, growthSnapshot?.industryTemplate],
  );
  const trendRows = useMemo(
    () => buildTrendRows(growthSnapshot, context, platformRecommendations),
    [growthSnapshot, context, platformRecommendations],
  );
  const platformRecommendationRows = useMemo(
    () => buildPlatformRecommendationRows(platformRecommendations, growthSnapshot),
    [platformRecommendations, growthSnapshot],
  );
  const highConfidenceTracks = useMemo(
    () => commercialTracks.filter((track) => track.fit >= 80),
    [commercialTracks],
  );
  const businessTrackRows = useMemo(
    () => buildBusinessTrackRows(highConfidenceTracks.length ? highConfidenceTracks : commercialTracks, context, growthSnapshot?.industryTemplate),
    [highConfidenceTracks, commercialTracks, context, growthSnapshot?.industryTemplate],
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
  const platformDashboardCards = useMemo(
    () => platformRecommendationRows.slice(0, 4).map((row) => ({
      ...row,
      panelId: "platforms",
    })),
    [platformRecommendationRows],
  );
  const showPremiumReport = Boolean(analysis && hasPaidGrowthAccess);
  const getSectionCardClass = useCallback(
    (panelId: string, accent: string) => activeDashboardPanel === panelId
      ? `relative overflow-hidden rounded-[28px] border ${accent} bg-[#0f1a2c] p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]`
      : "rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6",
    [activeDashboardPanel],
  );

  useEffect(() => {
    if (!dashboardPanels.length) return;
    if (!dashboardPanels.some((item) => item.id === activeDashboardPanel)) {
      setActiveDashboardPanel(dashboardPanels[0].id);
    }
  }, [dashboardPanels, activeDashboardPanel]);

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
            <button
              type="button"
              onClick={() => setDebugMode((prev) => !prev)}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-sm text-white/75 transition hover:bg-white/10"
            >
              {debugMode ? "Debug ON" : "Debug OFF"}
            </button>
            {supervisorAccess ? (
              <div className="rounded-full border border-emerald-300/30 bg-emerald-400/10 px-3 py-1 text-sm text-emerald-200">
                Supervisor Mode
              </div>
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
              {!fileBase64 ? (
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
                      <div className="mt-3 text-xs text-white/55">
                        正在生成诊断中，预计还需 {remainingTime} 秒。
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

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={handleAnalyze}
                  disabled={!fileBase64 || isProcessing}
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
                <p className="mt-4 text-sm leading-7 text-white/65">
                生成后会只保留和你身份、题材与商业目标高度相关的内容方向，不把无关热点硬塞给你。
                </p>
              </div>
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#90c4ff]">
                <BriefcaseBusiness className="h-5 w-5" />
                <span className="font-semibold">商业洞察</span>
              </div>
              <p className="mt-4 text-sm leading-7 text-white/65">
                分析结果不会停在“好不好看”，而会继续判断它更适合吸粉、转化、案例展示还是服务售卖。
              </p>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
              <div className="flex items-center gap-3 text-[#9df6c0]">
                <Send className="h-5 w-5" />
                <span className="font-semibold">推荐平台</span>
              </div>
              <p className="mt-4 text-sm leading-7 text-white/65">
                报告会把推荐平台做成明确动作建议，而不是只列平台名，便于你直接发布验证。
              </p>
            </div>
          </section>
        ) : null}

        {debugMode ? (
          <section className="mt-8 space-y-6">
            <div className="rounded-[24px] border border-cyan-300/20 bg-cyan-400/10 p-5">
                <div className="text-sm font-semibold text-cyan-100">Debug 面板</div>
                <div className="mt-3 grid gap-2 text-sm text-white/75 md:grid-cols-2">
                  <div>input: {String(debugInfo?.inputKind || inputKind || "-")}</div>
                  <div>route: {String(debugInfo?.route || "-")}</div>
                  <div>provider: {String(debugInfo?.provider || "-")}</div>
                  <div>model: {String(debugInfo?.model || "-")}</div>
                  <div>fallback: {String(debugInfo?.fallback ?? "-")}</div>
                  <div>trend source: {String(growthSnapshot?.status.source || "-")}</div>
                  <div>mime: {String(debugInfo?.mimeType || fileMimeType || "-")}</div>
                  <div>file: {String(debugInfo?.fileName || fileName || "-")}</div>
                  <div>smtp configured: {String(growthSystemStatusQuery.data?.smtp?.configured ?? "-")}</div>
                  <div>mail to: {String(growthSystemStatusQuery.data?.targetEmail || "-")}</div>
                  <div>smtp from: {String(growthSystemStatusQuery.data?.smtp?.from || "-")}</div>
                  <div>smtp missing: {Array.isArray(growthSystemStatusQuery.data?.smtp?.missing) ? growthSystemStatusQuery.data?.smtp?.missing.join(", ") || "-" : "-"}</div>
                  {debugInfo?.extractionMethod ? <div>extract: {String(debugInfo.extractionMethod)}</div> : null}
                  {debugInfo?.videoDuration ? <div>video sec: {String(debugInfo.videoDuration)}</div> : null}
                  {debugInfo?.transcriptChars ? <div>transcript chars: {String(debugInfo.transcriptChars)}</div> : null}
                  {debugInfo?.failureStage ? <div>failure stage: {String(debugInfo.failureStage)}</div> : null}
                  {debugInfo?.failureReason ? <div>failure reason: {String(debugInfo.failureReason)}</div> : null}
                </div>
                {growthSystemStatusQuery.data?.scheduler?.length ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-cyan-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-cyan-100">抓取调度状态</div>
                    <div className="rounded-xl border border-cyan-200/15 bg-cyan-400/5 p-3 leading-6">
                      <div>周末 / 节假日 live：每 20 分钟抓取一次</div>
                      <div>17:00 - 22:00：每 2 小时抓取一次</div>
                      <div>22:00 - 06:00：每 3 小时抓取一次</div>
                      <div>06:00 - 17:00：每 4 小时抓取一次</div>
                      <div>数据量明显放大：立即切到每 20 分钟一次</div>
                      <div>历史回填 burst：按 30-60 秒真人节奏抖动抓取，目标步长 10，受限时回落到 5</div>
                    </div>
                    {growthSystemStatusQuery.data.scheduler.map((item) => (
                      <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                        <div>{String(item.platform)} last success: {String(item.lastSuccessAt || "-")}</div>
                        <div>{String(item.platform)} next run: {String(item.nextRunAt || "-")}</div>
                        <div>{String(item.platform)} failures: {String(item.failureCount ?? 0)}</div>
                        <div>{String(item.platform)} burst mode: {String(item.burstMode ?? false)}</div>
                        <div>{String(item.platform)} last count: {String(item.lastCollectedCount ?? 0)}</div>
                        <div>{String(item.platform)} burst since: {String(item.burstTriggeredAt || "-")}</div>
                        <div>{String(item.platform)} error: {String(item.lastError || "-")}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
                {growthSystemStatusQuery.data?.backfill ? (
                  <div className="mt-4 space-y-2 rounded-2xl border border-amber-200/15 bg-black/15 p-4 text-xs text-white/72">
                    <div className="font-semibold text-amber-100">数据仓回填进度</div>
                    <div className="grid gap-1 md:grid-cols-2">
                      <div>status: {String(growthSystemStatusQuery.data.backfill.status || "-")}</div>
                      <div>active: {String(growthSystemStatusQuery.data.backfill.active ?? false)}</div>
                      <div>round: {String(growthSystemStatusQuery.data.backfill.currentRound || 0)} / {String(growthSystemStatusQuery.data.backfill.maxRounds || 0)}</div>
                      <div>target / platform: {String(growthSystemStatusQuery.data.backfill.targetPerPlatform || 0)}</div>
                      <div>window days: {String(growthSystemStatusQuery.data.backfill.selectedWindowDays || "-")}</div>
                      <div>started: {String(growthSystemStatusQuery.data.backfill.startedAt || "-")}</div>
                      <div>updated: {String(growthSystemStatusQuery.data.backfill.updatedAt || "-")}</div>
                      <div>finished: {String(growthSystemStatusQuery.data.backfill.finishedAt || "-")}</div>
                    </div>
                    <div className="rounded-xl border border-amber-200/15 bg-amber-400/5 p-3 leading-6">
                      {String(growthSystemStatusQuery.data.backfill.note || "-")}
                    </div>
                    <div className="space-y-2">
                      {growthSystemStatusQuery.data.backfill.platforms?.map((item) => (
                        <div key={String(item.platform)} className="grid gap-1 md:grid-cols-2">
                          <div>{String(item.platform)} status: {String(item.status || "-")}</div>
                          <div>{String(item.platform)} total: {String(item.currentTotal || 0)} / {String(item.target || 0)}</div>
                          <div>{String(item.platform)} archived: {String(item.archivedTotal || 0)}</div>
                          <div>{String(item.platform)} added: {String(item.addedCount || 0)}</div>
                          <div>{String(item.platform)} merged: {String(item.mergedCount || 0)}</div>
                          <div>{String(item.platform)} plateau: {String(item.plateauCount || 0)}</div>
                          <div className="md:col-span-2">{String(item.platform)} error: {String(item.error || "-")}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : null}
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
                    <h2 className="text-2xl font-bold">商业数据仪表盘</h2>
                  </div>
                  <p className="mt-4 text-sm leading-7 text-white/62">
                    这里不是静态柱状图。上面的图块负责给你全局判断，下面对应的分析区块会同步高亮，告诉你该先动哪里、怎么改、怎么承接。
                  </p>
                  <div className="mt-6 grid gap-5 xl:grid-cols-12">
                    <div className="space-y-5 xl:col-span-7">
                      <div className="grid gap-4 sm:grid-cols-2">
                        {dashboardMetrics.map((item) => (
                          <button
                            type="button"
                            key={item.label}
                            onClick={() => setActiveDashboardPanel(item.id)}
                            className={`relative overflow-hidden rounded-[24px] border p-4 text-left transition ${
                              activeDashboardPanel === item.id
                                ? "border-white/30 bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
                                : `border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.05),rgba(255,255,255,0.02)),radial-gradient(circle_at_top_left,var(--tw-gradient-stops))] ${item.tone}`
                            }`}
                          >
                            {activeDashboardPanel === item.id ? (
                              <div className="pointer-events-none absolute inset-0">
                                <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.08)_18%,transparent_36%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)] bg-[length:24px_24px,100%_100%]" />
                              </div>
                            ) : null}
                            <div className="relative flex items-center justify-between">
                              <div className="text-xs uppercase tracking-[0.18em] text-white/45">{item.label}</div>
                              <div className={`rounded-full border px-2 py-0.5 text-xs ${getScoreTone(item.id === "readiness" ? dashboardScoreAverage : 80).chip}`}>
                                {item.id === "positioning" ? "角色判断" : "点击联动"}
                              </div>
                            </div>
                            <div className="relative mt-3 text-3xl font-black text-white">{item.value}</div>
                            <p className="relative mt-3 text-sm leading-6 text-white/62">{item.note}</p>
                          </button>
                        ))}
                      </div>

                      <div className="grid gap-4 lg:grid-cols-[0.92fr_1.08fr]">
                        <button
                          type="button"
                          onClick={() => setActiveDashboardPanel("readiness")}
                          className={`relative overflow-hidden rounded-[24px] border p-5 text-left transition ${
                            activeDashboardPanel === "readiness" ? "border-white/25 bg-white/10" : "border-white/10 bg-black/15"
                          }`}
                        >
                          {activeDashboardPanel === "readiness" ? (
                            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,207,146,0.26),transparent_55%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                          ) : null}
                          <div className="relative flex items-center gap-2 text-white">
                            <Orbit className="h-4 w-4 text-[#9df6c0]" />
                            <span className="text-sm font-semibold">成熟度分布</span>
                          </div>
                          <div className="relative mt-4 h-[240px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={dashboardDonutData}
                                  dataKey="value"
                                  innerRadius={58}
                                  outerRadius={90}
                                  paddingAngle={2}
                                  onClick={(_, index) => setActiveDashboardPanel(dashboardDonutData[index]?.panelId || "readiness")}
                                >
                                  {dashboardDonutData.map((entry) => (
                                    <Cell key={entry.name} fill={entry.fill} style={{ cursor: "pointer" }} />
                                  ))}
                                </Pie>
                                <Tooltip
                                  contentStyle={{ background: "#0b1628", border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, color: "#fff" }}
                                  formatter={(value: number) => [`${value}%`, "维度强度"]}
                                />
                              </PieChart>
                            </ResponsiveContainer>
                            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                              <div className="text-xs uppercase tracking-[0.2em] text-white/45">准备度</div>
                              <div className="mt-2 text-4xl font-black text-white">{dashboardScoreAverage}%</div>
                            </div>
                          </div>
                          <div className="relative mt-4 grid gap-2">
                            {dashboardDonutData.map((entry) => (
                              <button
                                key={entry.name}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setActiveDashboardPanel(entry.panelId || "readiness");
                                }}
                                className={`flex items-center justify-between rounded-xl border px-3 py-2 text-left text-xs transition ${
                                  activeDashboardPanel === entry.panelId
                                    ? "border-white/20 bg-white/10 text-white"
                                    : "border-white/10 bg-white/5 text-white/70"
                                }`}
                              >
                                <span className="flex items-center gap-2">
                                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.fill }} />
                                  {entry.name}
                                </span>
                                <span>{entry.value}%</span>
                              </button>
                            ))}
                          </div>
                        </button>

                        <div className="rounded-[24px] border border-white/10 bg-black/15 p-5">
                          <div className="flex items-center gap-2 text-white">
                            <PanelsTopLeft className="h-4 w-4 text-[#90c4ff]" />
                            <span className="text-sm font-semibold">平台打法矩阵</span>
                          </div>
                          <div className="mt-4 grid gap-3 sm:grid-cols-2">
                            {platformDashboardCards.map((row) => (
                              <button
                                type="button"
                                key={row.label}
                                onClick={() => setActiveDashboardPanel("platforms")}
                                className={`relative overflow-hidden rounded-2xl border p-4 text-left transition ${
                                  activeDashboardPanel === "platforms" ? "border-[#90c4ff]/35 bg-[#10233e]" : "border-white/10 bg-white/5"
                                }`}
                              >
                                {activeDashboardPanel === "platforms" ? (
                                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(144,196,255,0.18),transparent_58%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                                ) : null}
                                <div className="relative flex items-center justify-between">
                                  <span className="text-lg font-black text-white">{row.label}</span>
                                  <Send className="h-4 w-4 text-[#90c4ff]" />
                                </div>
                                <p className="relative mt-3 text-sm leading-6 text-white/75">{compactText(row.insight, 78)}</p>
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="space-y-5 xl:col-span-5">
                      <button
                        type="button"
                        onClick={() => setActiveDashboardPanel("monetization")}
                        className={`relative overflow-hidden rounded-[24px] border p-5 text-left transition ${
                          activeDashboardPanel === "monetization" ? "border-white/25 bg-white/10" : "border-white/10 bg-black/15"
                        }`}
                      >
                        {activeDashboardPanel === "monetization" ? (
                          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,183,255,0.22),transparent_58%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                        ) : null}
                        <div className="relative flex items-center gap-2 text-white">
                          <CircleDollarSign className="h-4 w-4 text-[#f5b7ff]" />
                          <span className="text-sm font-semibold">商业转化漏斗</span>
                        </div>
                        <div className="relative mt-5 space-y-3">
                          {businessFunnelSteps.map((step, index) => (
                            <div key={step.label} className="space-y-2">
                              <div className="flex items-center justify-between text-xs uppercase tracking-[0.18em] text-white/45">
                                <span>{step.label}</span>
                                <span>{step.value}%</span>
                              </div>
                              <div className="flex justify-center">
                                <div
                                  className="rounded-xl bg-[linear-gradient(90deg,#ff8cf0,#ffd68e,#7cffb2)] px-4 py-3 text-center text-sm font-semibold text-[#0b1628] shadow-[0_10px_30px_rgba(255,140,240,0.12)]"
                                  style={{ width: `${92 - index * 18}%` }}
                                >
                                  {step.detail}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </button>

                      <div className="grid gap-3 lg:grid-cols-2">
                        {dashboardPanels.map((panel) => {
                          const isActive = activeDashboardPanel === panel.id;
                          return (
                            <button
                              type="button"
                              key={panel.id}
                              onClick={() => setActiveDashboardPanel(panel.id)}
                              className={`relative overflow-hidden rounded-[24px] border p-4 text-left transition ${
                                isActive
                                  ? "border-white/25 bg-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.08)] lg:col-span-2"
                                  : "border-white/10 bg-black/15"
                              }`}
                            >
                              {isActive ? (
                                <div className="pointer-events-none absolute inset-0 opacity-100">
                                  <div className={`absolute inset-0 bg-[radial-gradient(circle_at_top_left,var(--tw-gradient-stops))] ${panel.glow}`} />
                                  <div className="absolute inset-0 animate-pulse bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.08)_18%,transparent_36%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)] bg-[length:24px_24px,100%_100%]" />
                                </div>
                              ) : null}
                              <div className={`relative text-xs uppercase tracking-[0.2em] ${panel.accent}`}>{panel.eyebrow}</div>
                              <div className="relative mt-2 text-xl font-black text-white">{panel.title}</div>
                              <p className="relative mt-3 text-sm leading-6 text-white/78">{panel.summary}</p>
                              <div className={`relative mt-4 inline-flex rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs ${panel.accent}`}>
                                {panel.action}
                              </div>
                            </button>
                          );
                        })}
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

              {showPremiumReport ? (
                <div className="rounded-[28px] border border-white/10 bg-[#0f1a2c] p-6">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 text-[#90c4ff]">
                      <TrendingUp className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">趋势洞察</h2>
                    </div>
                    <button
                      onClick={handleRefreshGrowth}
                      disabled={refreshGrowthMutation.isPending}
                      className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-semibold text-white/75 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {refreshGrowthMutation.isPending ? "刷新中..." : "刷新趋势"}
                    </button>
                  </div>
                  {growthSnapshotQuery.isLoading ? (
                    <div className="mt-5 grid gap-4 md:grid-cols-2">
                      {[0, 1].map((item) => (
                        <div key={item} className="animate-pulse rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="h-4 w-24 rounded bg-white/10" />
                          <div className="mt-4 h-20 rounded bg-white/5" />
                        </div>
                      ))}
                    </div>
                  ) : null}
                  {growthSnapshot ? (
                    <div className="mt-5 space-y-4">
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/70">
                        <div className="font-semibold text-white">趋势判断</div>
                        <p className="mt-2">{replaceTerms(growthSnapshot.overview.trendNarrative)}</p>
                      </div>
                      {trendRows.length ? (
                        <div className="overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                          <table className="w-full border-collapse text-sm leading-7 text-white/75">
                            <tbody>
                              {trendRows.map((row) => (
                                <tr key={`${row.platform}-${row.topic}`} className="border-b border-white/10 last:border-b-0">
                                  <td className="w-28 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.platform}</td>
                                  <td className="px-4 py-4 text-[#9dd0ff]">{row.topic}</td>
                                  <td className="px-4 py-4">{row.reason}</td>
                                  <td className="px-4 py-4 text-white/65">{row.action}</td>
                                  <td className="px-4 py-4 text-[#ffd08f]">{row.highlight || "-"}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="rounded-2xl border border-white/10 bg-black/15 p-4 text-sm leading-7 text-white/65">
                          当前没有足够高相关度的话题可直接展示，所以不把无关热词硬塞给用户。
                        </div>
                      )}
                    </div>
                  ) : null}
                  {growthSnapshotQuery.error ? (
                    <div className="mt-5 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-4 text-sm text-rose-100">
                      趋势数据加载失败：{growthSnapshotQuery.error.message}
                    </div>
                  ) : null}
                </div>
              ) : (
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
                <>
                  <div className={getSectionCardClass("execution", "border-[#ffd08f]/30 bg-[linear-gradient(180deg,rgba(255,138,61,0.12),rgba(255,255,255,0.03))]")}>
                    {activeDashboardPanel === "execution" ? (
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,208,143,0.18),transparent_60%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                    ) : null}
                    <div className="flex items-center gap-3 text-[#ffd08f]">
                      <Rocket className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">创作执行简报</h2>
                    </div>
                    <p className="relative mt-3 text-sm leading-7 text-white/60">先看这部分。这里是你这一条内容最该立刻执行的判断和改法。</p>
                    <div className="relative mt-4 grid gap-4 lg:grid-cols-2">
                      {executionBriefRows.map((row, index) => (
                        <div
                          key={row.label}
                          className={`rounded-2xl border p-4 ${
                            index === 0
                              ? "border-[#ffd08f]/30 bg-[linear-gradient(135deg,rgba(255,208,143,0.16),rgba(255,255,255,0.04))]"
                              : "border-white/10 bg-black/15"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-black text-white">{row.label}</div>
                            <div className="rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] uppercase tracking-[0.16em] text-[#ffd08f]">
                              {index === 0 ? "先执行" : "补充"}
                            </div>
                          </div>
                          <p className={`mt-3 text-sm leading-7 ${index === 0 ? "font-semibold text-white" : "text-white/76"}`}>
                            {row.content}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={getSectionCardClass("execution", "border-[#9df6c0]/30")}>
                    {activeDashboardPanel === "execution" ? (
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(157,246,192,0.15),transparent_60%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                    ) : null}
                    <div className="flex items-center gap-3 text-[#9df6c0]">
                      <LineChartIcon className="h-5 w-5" />
                      <div>
                        <h2 className="text-2xl font-bold">7 天增长规划</h2>
                        <div className="mt-1 text-sm text-white/55">短期执行方案，目标是在 7 天内先把第一轮结果跑出来。</div>
                      </div>
                    </div>
                    <div className="relative mt-5 overflow-hidden rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {growthPlan.map((item) => (
                            <tr key={item.day} className="border-b border-white/10 last:border-b-0">
                              <td className="w-24 bg-white/5 px-4 py-4 align-top font-semibold text-[#9df6c0]">Day {item.day}</td>
                              <td className="w-40 px-4 py-4 font-semibold text-white">{item.title}</td>
                              <td className="px-4 py-4">{item.action}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <div className="mt-4">
                      <a
                        href="/storyboard?supervisor=1"
                        onClick={() => handleStoreHandoff(growthHandoff, "handoff 已写入本地，可交给 storyboard")}
                        className="block rounded-2xl border border-[#ff8a3d]/20 bg-[#ff8a3d]/10 px-4 py-3 text-sm font-semibold text-[#ffd4b7] transition hover:bg-[#ff8a3d]/15"
                      >
                        进入分镜创作
                      </a>
                    </div>
                  </div>

                  <div className={getSectionCardClass("platforms", "border-[#90c4ff]/30")}>
                    {activeDashboardPanel === "platforms" ? (
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(144,196,255,0.16),transparent_60%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                    ) : null}
                    <div className="flex items-center gap-3 text-[#ffd08f]">
                      <Send className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">推荐发布平台</h2>
                    </div>
                    <p className="mt-3 text-sm leading-7 text-white/60">先给首发顺序，再告诉你每个平台该怎么发、怎么改，以及如何把图文继续延展成视频。</p>
                    <div className="relative mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {platformRecommendationRows.map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-28 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="w-[28%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                              <td className="w-[42%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                              <td className="w-[18%] px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              ) : null}

              {showPremiumReport ? (
                <>
                  <div className={getSectionCardClass("positioning", "border-[#ffcf92]/30")}>
                    {activeDashboardPanel === "positioning" ? (
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,207,146,0.15),transparent_60%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                    ) : null}
                    <div className="flex items-center gap-3 text-[#ffcf92]">
                      <Compass className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">内容定位</h2>
                    </div>
                    <div className="relative mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {positioningRows.filter((row) => row.label !== "首发路径").map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-32 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="w-[34%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                              <td className="w-[30%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                              <td className="w-[18%] px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className={getSectionCardClass("content", "border-[#ffb37f]/30")}>
                    {activeDashboardPanel === "content" ? (
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(255,179,127,0.14),transparent_60%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                    ) : null}
                    <div className="flex items-center gap-3 text-[#ffb37f]">
                      <Sparkles className="h-5 w-5" />
                      <h2 className="text-2xl font-bold">内容分析</h2>
                    </div>
                    <div className="relative mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {contentAnalysisRows.map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-32 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="w-[34%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                              <td className="w-[30%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                              <td className="w-[18%] px-4 py-4 align-top whitespace-normal break-words text-[#ffd08f]">{row.highlight || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  <div className={getSectionCardClass("monetization", "border-[#f5b7ff]/30")}>
                    {activeDashboardPanel === "monetization" ? (
                      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(245,183,255,0.15),transparent_60%),repeating-linear-gradient(180deg,transparent_0_10px,rgba(255,255,255,0.03)_10px_11px)]" />
                    ) : null}
                    <div className="flex items-center gap-3 text-[#f5b7ff]">
                      <BriefcaseBusiness className="h-5 w-5" />
                      <div>
                        <h2 className="text-2xl font-bold">商业洞察</h2>
                        <div className="mt-1 text-sm text-white/55">中长期发展方案，不和 7 天短期执行混在一起。</div>
                      </div>
                    </div>
                    <div className="relative mt-5 grid gap-4">
                      {businessInsights.map((item) => (
                        <div key={item.title} className="rounded-2xl border border-white/10 bg-black/15 p-4">
                          <div className="text-sm font-semibold text-white">{item.title}</div>
                          <p className="mt-2 text-sm leading-7 text-white/70">{replaceTerms(item.detail)}</p>
                        </div>
                      ))}
                    </div>
                    <div className="relative mt-5 rounded-2xl border border-white/10 bg-black/15 p-4">
                      <div className="flex items-center gap-2 text-white">
                        <Workflow className="h-4 w-4 text-[#f5b7ff]" />
                        <span className="text-sm font-semibold">业务转化漏斗</span>
                      </div>
                      <div className="mt-4 space-y-3">
                        {businessFunnelSteps.map((step, index) => (
                          <button
                            key={`business-${step.label}`}
                            type="button"
                            onClick={() => setActiveDashboardPanel("monetization")}
                            className="block w-full text-left"
                          >
                            <div className="mb-1 flex items-center justify-between text-xs uppercase tracking-[0.18em] text-white/45">
                              <span>{step.label}</span>
                              <span>{step.value}%</span>
                            </div>
                            <div className="flex justify-center">
                              <div
                                className={`rounded-xl px-4 py-3 text-center text-sm font-semibold text-[#0b1628] shadow-[0_10px_30px_rgba(255,140,240,0.12)] transition ${
                                  activeDashboardPanel === "monetization"
                                    ? "bg-[linear-gradient(90deg,#ff8cf0,#ffd68e,#7cffb2)]"
                                    : "bg-[linear-gradient(90deg,#d085ff,#ffb4df,#ffd68e)] opacity-85"
                                }`}
                                style={{ width: `${92 - index * 18}%` }}
                              >
                                {step.detail}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="relative mt-4 grid gap-4 lg:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className="flex items-center gap-2 text-white">
                          <ScanSearch className="h-4 w-4 text-[#ffd08f]" />
                          <span className="text-sm font-semibold">短期目标</span>
                        </div>
                        <div className="mt-3 text-sm leading-7 text-white/78">
                          先把用户看懂的入口做出来，再验证收藏、停留、评论和咨询。短期先用低预算试错，不先重投流。
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className="flex items-center gap-2 text-white">
                          <ScanSearch className="h-4 w-4 text-[#ffd08f]" />
                          <span className="text-sm font-semibold">中长期路径</span>
                        </div>
                        <div className="mt-3 text-sm leading-7 text-white/78">
                          把内容沉淀成案例页、方法页、训练营页或咨询页，再决定知识付费、品牌合作还是高客单服务主承接。
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-black/15 p-4">
                        <div className="flex items-center gap-2 text-white">
                          <ScanSearch className="h-4 w-4 text-[#ffd08f]" />
                          <span className="text-sm font-semibold">投放建议</span>
                        </div>
                        <div className="mt-3 text-sm leading-7 text-white/78">
                          只有当标题、前 3 秒、承接页都跑出正反馈，再用小预算放大高完播版。不要在路径没定清楚时先烧曝光。
                        </div>
                      </div>
                    </div>
                    <div className="relative mt-5 overflow-x-auto rounded-2xl border border-white/10 bg-black/15">
                      <table className="w-full border-collapse text-sm leading-7 text-white/75">
                        <tbody>
                          {businessTrackRows.map((row) => (
                            <tr key={row.label} className="border-b border-white/10 last:border-b-0">
                              <td className="w-36 bg-white/5 px-4 py-4 align-top font-semibold text-white">{row.label}</td>
                              <td className="w-[28%] px-4 py-4 align-top whitespace-normal break-words">{row.insight}</td>
                              <td className="w-[36%] px-4 py-4 align-top whitespace-normal break-words text-white/65">{row.action}</td>
                              <td className="w-[16%] px-4 py-4 align-top whitespace-normal break-words text-[#f5b7ff]">{row.highlight || "-"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
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
