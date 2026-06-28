/**
 * B 端智库「爆款决策与增长管线」仪表盘 — 供阅读模式或 Puppeteer 截 PDF。
 * 横向宽幅排布，避免区块内上下滚动；指标为决策辅助口径，参考历史数据与当前窗口样本。
 */

import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import { DEMO_ADVANCED_AI_REPORT_DATA } from "@shared/advancedAIReportDemoData";
import {
  normalizeDecisionIntelTopicTitleKey,
  type DecisionIntelTopicPick,
} from "@shared/decisionIntelTopicPicks";
import { sanitizeDecisionIntelMetricsText } from "@shared/decisionIntelSanitize";
import { fallbackPlatformHitPotentialRadar } from "@shared/advancedPredictionEngine";
import { cn } from "@/lib/utils";
import {
  ArrowDown,
  BarChart3,
  BookOpen,
  Brain,
  Coins,
  Compass,
  FilePenLine,
  GitCompare,
  HeartHandshake,
  LayoutDashboard,
  Lightbulb,
  Loader2,
  Megaphone,
  Radio,
  RefreshCcw,
  Rocket,
  ScanLine,
  ShieldAlert,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  Legend,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type { DecisionIntelTopicPick };

export interface PlatformReportDashboardProps {
  data?: AdvancedAIReportData;
  className?: string;
  /** 试读：图表与指标保留形态，选题与正文类文案模糊脱敏 */
  presentation?: "default" | "trialRead";
  /** 已自动赠送至下方执行区的选题结构标题（通常 2 条） */
  giftedStructureTitles?: string[];
  /** 下方执行区已存在的选题标题（用于显示「已在执行区」） */
  existingExecutionTitleKeys?: string[];
  /** 点击「生成完整文案」：扩写并追加至下方执行区 */
  onGenerateTopicCopy?: (pick: DecisionIntelTopicPick) => void;
  /** 已在执行区 / 已赠送：防护性「重新生成文案」（首免、同选题再次扣点） */
  onRegenerateTopicCopy?: (pick: DecisionIntelTopicPick) => void;
  /** 正在扩写或重生成的选题标题 key（normalizeDecisionIntelTopicTitleKey） */
  generatingTopicCopyKey?: string | null;
}

function TopicExecutionCopyActions({
  pick,
  onGenerate,
  onRegenerate,
  trial,
  variant = "structure",
  loading = false,
  alreadyInExecution = false,
  isGifted = false,
}: {
  pick: DecisionIntelTopicPick;
  onGenerate?: (pick: DecisionIntelTopicPick) => void;
  onRegenerate?: (pick: DecisionIntelTopicPick) => void;
  trial: boolean;
  variant?: "structure" | "personalization";
  loading?: boolean;
  alreadyInExecution?: boolean;
  isGifted?: boolean;
}): ReactElement {
  if (trial) return <></>;

  const showRegenerate = (alreadyInExecution || isGifted) && Boolean(onRegenerate);
  const showGenerate = !alreadyInExecution && !isGifted && Boolean(onGenerate);

  if (!showRegenerate && !showGenerate) return <></>;

  const primaryClass =
    variant === "personalization"
      ? "border-[#f472b6]/55 bg-[linear-gradient(135deg,rgba(244,114,182,0.35),rgba(190,24,93,0.2))] text-[#ffe4f0] hover:bg-[rgba(244,114,182,0.45)]"
      : "border-[#fbbf24]/55 bg-[linear-gradient(135deg,rgba(251,191,36,0.35),rgba(217,119,6,0.22))] text-[#fff7ed] hover:bg-[rgba(251,191,36,0.45)]";

  const regenClass = "border-sky-400/45 bg-sky-500/12 text-sky-50 hover:bg-sky-500/22";

  return (
    <div className="mt-2 space-y-1.5 pl-7">
      {isGifted ? (
        <div className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-emerald-400/35 bg-emerald-500/15 px-2 py-1.5 text-[10px] font-bold text-emerald-100">
          ✓ 已赠送至下方执行区
        </div>
      ) : alreadyInExecution ? (
        <div className="inline-flex w-full items-center justify-center gap-1 rounded-lg border border-sky-400/35 bg-sky-500/15 px-2 py-1.5 text-[10px] font-bold text-sky-100">
          ✓ 已在下方执行区
        </div>
      ) : null}
      {showGenerate ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => onGenerate?.(pick)}
          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border-2 px-2.5 py-2 text-[11px] font-bold shadow-md transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 ${primaryClass}`}
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin shrink-0" aria-hidden />
          ) : (
            <FilePenLine size={13} strokeWidth={2.25} aria-hidden />
          )}
          {loading ? "文案生成中…" : "生成完整文案"}
          {!loading ? <ArrowDown size={12} className="opacity-85" aria-hidden /> : null}
        </button>
      ) : null}
      {showRegenerate ? (
        <button
          type="button"
          disabled={loading}
          onClick={() => onRegenerate?.(pick)}
          className={`inline-flex w-full items-center justify-center gap-1.5 rounded-lg border-2 px-2.5 py-2 text-[11px] font-bold shadow-md transition hover:brightness-110 disabled:cursor-wait disabled:opacity-60 ${regenClass}`}
          title="若刷新或关页导致未看到文案，可重新生成；同选题首次重生成免费，再次扣 20 积分"
        >
          {loading ? (
            <Loader2 size={13} className="animate-spin shrink-0" aria-hidden />
          ) : (
            <RefreshCcw size={13} strokeWidth={2.25} aria-hidden />
          )}
          {loading ? "重新生成中…" : "重新生成文案"}
        </button>
      ) : null}
    </div>
  );
}


/** 试读打码：模糊 + 轻度渐变遮蔽（不涉及真实用户数据时亦用于对外样张） */
function TrialReadSensitive({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}): ReactElement {
  return (
    <span className={cn("relative isolate inline-block max-w-full align-top", className)}>
      <span className="block select-none blur-[2.5px]">{children}</span>
      <span
        className="pointer-events-none absolute inset-0 block bg-gradient-to-b from-transparent via-[#0B0F19]/30 to-[#0B0F19]/55"
        aria-hidden
      />
    </span>
  );
}

/** 预设展开；使用者可收起。React 19 的 defaultOpen 在 @types/react 尚未收录，故用 ref 初始化。 */
function TopicStructureDetails({
  className,
  summaryClassName,
  summary,
  children,
}: {
  className?: string;
  summaryClassName?: string;
  summary: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) el.open = true;
  }, []);
  return (
    <details ref={ref} className={className}>
      <summary className={summaryClassName}>{summary}</summary>
      {children}
    </details>
  );
}

function formatInt(n: number): string {
  return n.toLocaleString("zh-CN");
}

function insightCardAccent(index: number): { ring: string; badge: string; icon: typeof Brain } {
  const presets = [
    { ring: "border-emerald-500/35 bg-[linear-gradient(145deg,rgba(16,185,129,0.14),rgba(15,23,42,0.92))]", badge: "bg-emerald-500/20 text-emerald-200", icon: TrendingUp },
    { ring: "border-sky-500/35 bg-[linear-gradient(145deg,rgba(56,189,248,0.12),rgba(15,23,42,0.92))]", badge: "bg-sky-500/20 text-sky-200", icon: RefreshCcw },
    { ring: "border-violet-500/35 bg-[linear-gradient(145deg,rgba(139,92,246,0.12),rgba(15,23,42,0.92))]", badge: "bg-violet-500/20 text-violet-200", icon: Zap },
    { ring: "border-amber-500/35 bg-[linear-gradient(145deg,rgba(245,158,11,0.12),rgba(15,23,42,0.92))]", badge: "bg-amber-500/20 text-amber-100", icon: Brain },
  ] as const;
  return presets[index % presets.length];
}

function mabBadgeLabel(mode: "utilize" | "explore"): string {
  return mode === "utilize" ? "利用" : "探索";
}

function buildRadarRows(r: AdvancedAIReportData["globalPredictions"]["hitPotentialRadar"]) {
  return [
    { subject: "预期播放量", A: r.views, fullMark: 100 },
    { subject: "转化率", A: r.conversion, fullMark: 100 },
    { subject: "品牌契合度", A: r.brandFit, fullMark: 100 },
    { subject: "平台爆款潜力", A: r.platformPotential, fullMark: 100 },
    { subject: "赛马效能", A: r.mabEfficiency, fullMark: 100 },
  ];
}

const VIEWS_BAR_COLORS = ["#34d399", "#22d3ee", "#a78bfa", "#fbbf24", "#fb7185", "#60a5fa"] as const;

/** 选题预估播放量横向对比（取个性化推荐方向，最多 6 条） */
function buildTopicViewsBars(
  personalization: AdvancedAIReportData["executionSuggestions"]["personalization"],
) {
  return personalization.slice(0, 6).map((it, i) => ({
    name: `选题${i + 1}`,
    fullName: String(it.topicDirection || "").trim(),
    views: Math.max(0, Math.round(Number(it.viewsPredicted) || 0)),
    color: VIEWS_BAR_COLORS[i % VIEWS_BAR_COLORS.length],
  }));
}

/** 封面 / 转化 / IP 契合 三维分组对比（取选题结构实例，最多 5 条） */
function buildStructureMetricBars(structures: AdvancedAIReportData["topicStructureExamples"]) {
  return structures.slice(0, 5).map((it, i) => ({
    name: `结构${i + 1}`,
    fullName: String(it.title || "").trim(),
    封面: Math.min(100, Math.max(0, Math.round(Number(it.predictedCtr) || 0))),
    转化: Math.min(100, Math.max(0, Math.round(Number(it.predictedConversion) || 0))),
    契合: Math.min(100, Math.max(0, Math.round(Number(it.brandMatchFit) || 0))),
  }));
}

/** 各平台付费投流产品矩阵（投流策略用） */
const PLATFORM_PAID_CHANNELS: Record<
  string,
  { label: string; channels: string[]; note: string }
> = {
  douyin: {
    label: "抖音",
    channels: ["DOU+", "巨量千川", "小店随心推"],
    note: "先 DOU+ 测完播与互动，达标素材切千川承接转化",
  },
  xiaohongshu: {
    label: "小红书",
    channels: ["薯条", "聚光平台"],
    note: "薯条测点击与收藏，跑通后用聚光放大种草人群",
  },
  bilibili: {
    label: "B站",
    channels: ["花火商单", "UP主起飞"],
    note: "中长视频以完播/三连为核心，起飞放大优质稿件",
  },
  kuaishou: {
    label: "快手",
    channels: ["粉条", "磁力金牛"],
    note: "强信任带货，磁力金牛承接成交与复购",
  },
};

/** 三段式投流预算配比方法论（与具体金额无关，按比例与观测指标推进） */
const PAID_TRAFFIC_PHASES = [
  {
    key: "test",
    label: "冷启测试",
    ratio: 20,
    accent: "border-sky-400/40 bg-sky-500/10 text-sky-50",
    bar: "bg-sky-400",
    watch: "多素材小额赛马，盯 3 秒完播 / 点击率 / 互动率",
  },
  {
    key: "calibrate",
    label: "模型校准",
    ratio: 30,
    accent: "border-amber-400/40 bg-amber-500/10 text-amber-50",
    bar: "bg-amber-400",
    watch: "保留达标素材，定向放量至 ROI 接近 1，校准人群包",
  },
  {
    key: "scale",
    label: "规模放大",
    ratio: 50,
    accent: "border-emerald-400/40 bg-emerald-500/10 text-emerald-50",
    bar: "bg-emerald-400",
    watch: "跑通素材阶梯加价，控 CPA / 守 ROI 下限，持续换新",
  },
] as const;

/** 优先投流选题：CTR×0.4 + 转化×0.4 + IP契合×0.2 综合分排序 */
function buildPaidTrafficPriorityTopics(structures: AdvancedAIReportData["topicStructureExamples"]) {
  return structures
    .map((it) => {
      const ctr = Math.min(100, Math.max(0, Math.round(Number(it.predictedCtr) || 0)));
      const conv = Math.min(100, Math.max(0, Math.round(Number(it.predictedConversion) || 0)));
      const fit = Math.min(100, Math.max(0, Math.round(Number(it.brandMatchFit) || 0)));
      return {
        title: String(it.title || "").trim(),
        ctr,
        conv,
        fit,
        score: Math.round(ctr * 0.4 + conv * 0.4 + fit * 0.2),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 2);
}

function BarTooltipDark({
  active,
  payload,
  unit = "",
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: { fullName?: string } }>;
  unit?: string;
}): ReactElement | null {
  if (!active || !payload || payload.length === 0) return null;
  const full = payload[0]?.payload?.fullName;
  return (
    <div className="max-w-[16rem] rounded-lg border border-white/15 bg-[#0B0F19]/95 px-2.5 py-1.5 text-xs shadow-xl">
      {full ? <div className="mb-1 line-clamp-2 font-semibold text-white">{full}</div> : null}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-1.5 tabular-nums text-gray-200">
          <span className="inline-block h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden />
          {p.name}：<span className="font-bold text-white">{formatInt(Number(p.value) || 0)}{unit}</span>
        </div>
      ))}
    </div>
  );
}

export function PlatformReportDashboard({
  data = DEMO_ADVANCED_AI_REPORT_DATA,
  className = "",
  presentation = "default",
  giftedStructureTitles = [],
  existingExecutionTitleKeys = [],
  onGenerateTopicCopy,
  onRegenerateTopicCopy,
  generatingTopicCopyKey = null,
}: PlatformReportDashboardProps): ReactElement {
  const trial = presentation === "trialRead";
  const giftedKeys = new Set(giftedStructureTitles.map(normalizeDecisionIntelTopicTitleKey));
  const existingKeys = new Set(existingExecutionTitleKeys.map(normalizeDecisionIntelTopicTitleKey));
  const structureCount = data.topicStructureExamples.length;
  const personalizationCount = data.executionSuggestions.personalization.length;
  const totalDirections = structureCount + personalizationCount;
  const giftedCount = giftedKeys.size;
  const manualCopyCount = Math.max(0, totalDirections - giftedCount);
  const g = data.globalPredictions;
  const radarData = buildRadarRows(g.hitPotentialRadar);
  const topicViewsBars = buildTopicViewsBars(data.executionSuggestions.personalization);
  const structureMetricBars = buildStructureMetricBars(data.topicStructureExamples);
  const paidPriorityTopics = buildPaidTrafficPriorityTopics(data.topicStructureExamples);
  const platformKey =
    typeof data.platformDetailedData.matchedPlatform === "string"
      ? data.platformDetailedData.matchedPlatform
      : "douyin";
  const platformR =
    g.platformHitPotentialRadar ??
    fallbackPlatformHitPotentialRadar(platformKey, `${data.topic}|${data.dateRange}`);
  const subRadar = buildRadarRows(platformR);

  const platformAside =
    typeof data.platformDetailedData.autoMatchExplanation === "string"
      ? data.platformDetailedData.autoMatchExplanation
      : typeof data.platformDetailedData.summary === "string"
        ? data.platformDetailedData.summary
        : "此区显示依您增长看板自动匹配的主战场平台摘要，无需手动选择账号。";

  const matchedLabel =
    typeof data.platformDetailedData.matchedPlatformLabel === "string"
      ? data.platformDetailedData.matchedPlatformLabel
      : null;

  const chartH = 184;

  const ipFitExplainBody = (
    <span className="block text-[11px] leading-relaxed text-amber-50/95">
      <span className="mt-0.5 block font-semibold text-amber-100/95">IP 契合度（0–100）表示什么</span>
      <span className="mt-1 block">
        将每条选题对应的「内容蓝图全文」与您在基因库里配置的「IP／品牌关键词」做覆盖与加权命中，由引擎{" "}
        <code className="rounded bg-black/35 px-1 text-[10px] text-amber-200/90">calculateIPFit</code>{" "}
        输出分数。分数越高，选题标题、场景与用语越贴近您的人设与品牌叙事。
      </span>
      <span className="mt-2 block font-semibold text-amber-100/95">参考用法</span>
      <span className="mt-1 block">
        · <strong className="text-amber-50/95">排序与取舍</strong>：预估播放量相近时，可优先试拍契合度更高的方向；明显低于全表均值或长期低于 30 时，建议重写钩子或补强人设词后再跑一版。
      </span>
      <span className="mt-1 block">
        · <strong className="text-amber-50/95">非平台官方流量</strong>：该分不反映任何平台官方流量分配或推荐承诺，不可外引为「平台保证」。
      </span>
      <span className="mt-1 block">
        · <strong className="text-amber-50/95">迭代复盘</strong>：调整脚本或关键词前后对比分数，可快速判断本轮是否更贴近品牌基因。
      </span>
    </span>
  );

  return (
    <div
      data-platform-report-dashboard="true"
      className={`box-border w-[min(1680px,100vw)] max-w-[1680px] shrink-0 overflow-hidden border border-gray-800 bg-[#0B0F19] px-5 pb-5 pt-5 text-[15px] leading-relaxed font-sans text-white md:w-[1680px] ${className}`.trim()}
    >
      <style>{`
        @keyframes dashboardKeyFlash { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
        .dashboard-flash-key { animation: dashboardKeyFlash 1.5s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .dashboard-flash-key { animation: none; } }
      `}</style>
      {trial ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-[linear-gradient(90deg,rgba(245,158,11,0.18),rgba(15,23,42,0.92))] px-3 py-2.5 text-[11px] font-semibold leading-snug text-amber-50 shadow-[0_6px_24px_rgba(245,158,11,0.12)]">
          <ScanLine className="h-3.5 w-3.5 shrink-0 text-amber-200" aria-hidden />
          <span>
            对外试读样张：选题标题、结构正文、洞察与推荐用语已脱敏；版式与付费解锁后的决策智库报告一致，数值仅为演示形态。
          </span>
        </div>
      ) : null}
      <header className="relative mb-5 flex flex-wrap items-end justify-between gap-3 overflow-hidden rounded-xl border border-indigo-500/30 bg-[linear-gradient(125deg,rgba(139,92,246,0.16),rgba(15,23,42,0.96)_42%,rgba(16,185,129,0.1))] px-4 py-3 shadow-[0_16px_48px_rgba(99,102,241,0.18)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-fuchsia-500 via-cyan-400 to-emerald-400" aria-hidden />
        <div className="pointer-events-none absolute -left-16 -top-16 h-40 w-40 rounded-full bg-fuchsia-500/20 blur-3xl" aria-hidden />
        <div className="pointer-events-none absolute -right-10 -bottom-16 h-40 w-40 rounded-full bg-emerald-500/15 blur-3xl" aria-hidden />
        <div className="relative">
          <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-500">
            <span className="inline-flex items-center gap-1 rounded-full border border-purple-500/25 bg-purple-500/10 px-2 py-0.5 text-purple-200/90">
              <Sparkles size={12} className="text-purple-300" aria-hidden />
              战略决策视图
            </span>
            <span className="inline-flex items-center gap-1 text-gray-600">
              <LayoutDashboard size={12} aria-hidden />
              六板块同级展开
            </span>
          </div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-wide md:text-3xl">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-fuchsia-500 via-violet-500 to-cyan-400 text-sm font-black text-white shadow-[0_0_18px_rgba(168,85,247,0.5)]">
              M
            </span>
            <span className="bg-gradient-to-r from-white via-violet-100 to-cyan-200 bg-clip-text text-transparent">
              MV Studio Pro AI 决策智库报告
            </span>
            <span className="text-sm font-normal text-gray-300 md:text-base">
              {trial ? (
                <span className="inline-flex items-center gap-1">
                  （
                  <TrialReadSensitive className="max-w-[min(24rem,70vw)]">{data.topic}</TrialReadSensitive>
                  ）
                </span>
              ) : (
                <>（{data.topic}）</>
              )}
            </span>
          </h1>
        </div>
        <div
          className="relative inline-flex items-center gap-2 rounded-lg border border-amber-500/55 bg-[linear-gradient(135deg,rgba(245,158,11,0.24),rgba(15,23,42,0.9))] px-3 py-2 text-sm font-semibold tabular-nums text-amber-50 shadow-[0_0_32px_rgba(245,158,11,0.22)] md:text-base"
          title="分析窗口"
        >
          <Compass size={18} className="shrink-0 text-amber-300" aria-hidden />
          {data.dateRange}
        </div>
      </header>

      {/* 横向第一带：全局 / 平台雷达 / 战略对照 */}
      <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <section className="flex flex-col overflow-hidden rounded-xl border border-emerald-500/40 bg-[linear-gradient(180deg,rgba(16,185,129,0.16)_0%,rgba(17,24,39,0.97)_42%)] shadow-[0_10px_36px_rgba(16,185,129,0.14)]">
          <div className="h-1 w-full bg-gradient-to-r from-emerald-400 via-teal-400 to-transparent" aria-hidden />
          <div className="flex items-center gap-2.5 border-b border-emerald-500/25 bg-emerald-500/10 px-3.5 py-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/25 text-emerald-200 shadow-sm">
              <LayoutDashboard size={18} strokeWidth={2.25} aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-bold leading-tight text-emerald-50">全局 AI 决策面板</h2>
              <p className="text-[11px] font-medium text-emerald-200/70">五维潜力 · 总盘子预测</p>
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-row gap-2 p-3.5 pt-3">
            <div className="min-h-[184px] min-w-0 flex-1" style={{ height: chartH }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="72%" data={radarData}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: "#D1D5DB", fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="潜力" dataKey="A" stroke="#10B981" fill="#10B981" fillOpacity={0.2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex w-[42%] min-w-[8rem] flex-col justify-center gap-2.5 border-l border-emerald-500/20 pl-3">
              <div className="rounded-lg border border-emerald-400/40 bg-emerald-950/40 px-2.5 py-2.5 shadow-[0_0_24px_rgba(16,185,129,0.18)] ring-1 ring-emerald-400/20">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-200/90">
                  <BarChart3 size={16} className="text-emerald-400" aria-hidden />
                  总播放量预测
                </div>
                <div className="dashboard-flash-key mt-0.5 text-3xl font-black leading-tight text-emerald-50 tabular-nums md:text-4xl [text-shadow:0_0_20px_rgba(16,185,129,0.7)]">
                  {formatInt(g.totalViewsPredicted)}
                </div>
              </div>
              <div className="rounded-lg border border-teal-400/40 bg-teal-950/35 px-2.5 py-2.5 shadow-[0_0_24px_rgba(20,184,166,0.18)] ring-1 ring-teal-400/20">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-teal-200/90">
                  <RefreshCcw size={16} className="text-teal-400" aria-hidden />
                  平均转化率
                </div>
                <div className="dashboard-flash-key mt-0.5 text-2xl font-black text-teal-50 tabular-nums md:text-3xl [text-shadow:0_0_18px_rgba(20,184,166,0.7)]">
                  {g.averageConversionRate.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-cyan-500/40 bg-[linear-gradient(180deg,rgba(34,211,238,0.14)_0%,rgba(17,24,39,0.97)_40%)] shadow-[0_10px_36px_rgba(34,211,238,0.14)]">
          <div className="h-1 w-full bg-gradient-to-r from-cyan-400 via-sky-400 to-transparent" aria-hidden />
          <div className="flex items-center gap-2.5 border-b border-cyan-500/25 bg-cyan-500/10 px-3.5 py-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-500/25 text-cyan-100 shadow-sm">
              <ScanLine size={18} strokeWidth={2.25} aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-bold leading-tight text-cyan-50">平台雷达图谱</h2>
              <p className="text-[11px] font-medium text-cyan-200/75">主战场切片 · 与全局不同源</p>
            </div>
          </div>
          <p className="px-3.5 pb-0 pt-2 text-[11px] leading-snug text-cyan-100/55">
            主战场切片视角（依自动匹配平台轮廓演算）· 与左栏<strong className="font-semibold text-cyan-200/80">全局</strong>
            五维不同源，非缩放复制
          </p>
          <div className="flex min-h-[184px] flex-row gap-2 px-3.5 pb-3.5 pt-2" style={{ minHeight: chartH }}>
            <div className="min-h-[184px] min-w-0 flex-[1.1] rounded-lg border border-cyan-500/20 bg-[#0B0F19]/70 p-1 shadow-inner">
              <ResponsiveContainer width="100%" height="100%" minHeight={chartH}>
                <RadarChart cx="50%" cy="50%" outerRadius="76%" data={subRadar}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: "#D1D5DB", fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="子盘" dataKey="A" stroke="#38BDF8" fill="#38BDF8" fillOpacity={0.22} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex min-w-[8.5rem] flex-[0.85] flex-col justify-center rounded-lg border border-cyan-400/30 bg-[linear-gradient(155deg,rgba(34,211,238,0.12),rgba(15,23,42,0.96))] p-2.5 text-xs leading-relaxed shadow-sm">
              <p className="flex items-center gap-1.5 text-sm font-bold text-cyan-50">
                <Radio size={15} className="shrink-0 text-cyan-300" aria-hidden />
                主战场自动匹配
                {matchedLabel ? (
                  <span className="dashboard-flash-key ml-0.5 rounded-md bg-cyan-400/30 px-2 py-0.5 text-sm font-black text-cyan-50 ring-1 ring-cyan-300/40 [text-shadow:0_0_14px_rgba(34,211,238,0.7)]">
                    {matchedLabel}
                  </span>
                ) : null}
              </p>
              <p className="mt-1.5 line-clamp-6 text-sm text-gray-100/95">
                {trial ? <TrialReadSensitive>{platformAside}</TrialReadSensitive> : platformAside}
              </p>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-violet-500/40 bg-[linear-gradient(180deg,rgba(139,92,246,0.16)_0%,rgba(17,24,39,0.97)_38%)] shadow-[0_10px_36px_rgba(139,92,246,0.16)]">
          <div className="h-1 w-full bg-gradient-to-r from-violet-400 via-fuchsia-400 to-transparent" aria-hidden />
          <div className="flex items-center gap-2.5 border-b border-violet-500/25 bg-violet-500/10 px-3.5 py-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-500/30 text-violet-100 shadow-sm">
              <GitCompare size={18} strokeWidth={2.25} aria-hidden />
            </span>
            <div>
              <h2 className="text-base font-bold leading-tight text-violet-50">战略升级 · 多版本对照</h2>
              <p className="text-[11px] font-medium text-violet-200/75">赛马 · 利用 / 探索</p>
            </div>
          </div>
          <div className="p-3.5 pt-3">
            <p className="mb-2.5 line-clamp-2 rounded-lg border border-violet-400/25 bg-violet-950/40 px-2.5 py-2 text-xs leading-snug text-violet-100/95">
              {trial ? (
                <TrialReadSensitive>
                  动态测试对照叙事主线；「利用」加量验证成熟句型，「探索」保留新组合试错。
                </TrialReadSensitive>
              ) : (
                <>动态测试对照叙事主线；「利用」加量验证成熟句型，「探索」保留新组合试错。</>
              )}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {data.executionSuggestions.mabVariants.map((variant, idx) => (
                <div
                  key={variant.id}
                  className={`relative rounded-lg border px-2.5 pb-2.5 pt-3.5 shadow-sm ${
                    variant.type === "utilize"
                      ? "border-emerald-500/30 bg-[linear-gradient(160deg,rgba(16,185,129,0.12),rgba(15,23,42,0.95))]"
                      : "border-blue-500/30 bg-[linear-gradient(160deg,rgba(59,130,246,0.12),rgba(15,23,42,0.95))]"
                  }`}
                >
                  <div className="absolute right-2 top-2 rounded-md bg-black/25 p-1 text-emerald-200/90">
                    {variant.type === "utilize" ? (
                      <TrendingUp size={14} aria-hidden />
                    ) : (
                      <Compass size={14} className="text-blue-300" aria-hidden />
                    )}
                  </div>
                  <div
                    className={`absolute left-2 top-2 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                      variant.type === "utilize"
                        ? "border-emerald-400/40 bg-emerald-500/25 text-emerald-200"
                        : "border-blue-400/40 bg-blue-500/25 text-blue-200"
                    }`}
                  >
                    {mabBadgeLabel(variant.type)}
                  </div>
                  <div className="mt-5 text-center">
                    <span className="mr-1 text-xs font-bold text-gray-400">版本{idx + 1}</span>
                    <span className="block text-sm font-bold leading-snug text-white">
                      {trial ? <TrialReadSensitive className="w-full">{variant.title}</TrialReadSensitive> : variant.title}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap justify-center gap-1">
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-black/30 px-2 py-0.5 text-[10px] font-medium text-gray-100">
                      <BarChart3 size={10} className="text-emerald-400 opacity-80" aria-hidden />
                      播放 {formatInt(variant.viewsPredicted)}
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-black/30 px-2 py-0.5 text-[10px] font-medium text-gray-100">
                      <Target size={10} className="text-sky-400 opacity-80" aria-hidden />
                      转化 {variant.conversionRatePredicted.toFixed(1)}%
                    </span>
                    {variant.ucbScore != null ? (
                      <span className="rounded-md bg-violet-900/40 px-2 py-0.5 text-[10px] text-violet-200/90">
                        加权 {variant.ucbScore}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* 横向对比带：量化柱形图基准 */}
      {topicViewsBars.length > 0 || structureMetricBars.length > 0 ? (
        <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-2">
          <section className="overflow-hidden rounded-xl border border-sky-500/40 bg-[linear-gradient(180deg,rgba(56,189,248,0.14)_0%,rgba(17,24,39,0.97)_42%)] shadow-[0_10px_36px_rgba(56,189,248,0.14)]">
            <div className="h-1 w-full bg-gradient-to-r from-sky-400 via-cyan-400 to-transparent" aria-hidden />
            <div className="flex items-center gap-2.5 border-b border-sky-500/25 bg-sky-500/10 px-3.5 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/25 text-sky-100 shadow-sm">
                <BarChart3 size={18} strokeWidth={2.25} aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-bold leading-tight text-sky-50 md:text-lg">选题预估播放量对比</h2>
                <p className="text-[11px] font-medium text-sky-200/75">横向柱状 · 序号对应「IP 契合与推荐」</p>
              </div>
            </div>
            <div className="min-h-[224px] px-2.5 pb-3 pt-3" style={{ height: 244 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={topicViewsBars}
                  layout="vertical"
                  margin={{ top: 4, right: 56, bottom: 4, left: 8 }}
                  barCategoryGap="22%"
                >
                  <CartesianGrid horizontal={false} stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fill: "#9CA3AF", fontSize: 11 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={56}
                    tick={{ fill: "#D1D5DB", fontSize: 12, fontWeight: 700 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip cursor={{ fill: "rgba(56,189,248,0.08)" }} content={<BarTooltipDark />} />
                  <Bar dataKey="views" radius={[0, 6, 6, 0]} maxBarSize={26}>
                    {topicViewsBars.map((row) => (
                      <Cell key={row.name} fill={row.color} />
                    ))}
                    <LabelList
                      dataKey="views"
                      position="right"
                      formatter={(v: number) => formatInt(Number(v) || 0)}
                      style={{ fill: "#E5E7EB", fontSize: 11, fontWeight: 700 }}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-fuchsia-500/40 bg-[linear-gradient(180deg,rgba(217,70,239,0.13)_0%,rgba(17,24,39,0.97)_42%)] shadow-[0_10px_36px_rgba(217,70,239,0.14)]">
            <div className="h-1 w-full bg-gradient-to-r from-fuchsia-400 via-purple-400 to-transparent" aria-hidden />
            <div className="flex items-center gap-2.5 border-b border-fuchsia-500/25 bg-fuchsia-500/10 px-3.5 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-fuchsia-500/25 text-fuchsia-100 shadow-sm">
                <BarChart3 size={18} strokeWidth={2.25} aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-bold leading-tight text-fuchsia-50 md:text-lg">封面 / 转化 / 契合 三维对比</h2>
                <p className="text-[11px] font-medium text-fuchsia-200/75">分组柱状 · 序号对应「选题结构实例」</p>
              </div>
            </div>
            <div className="min-h-[224px] px-2.5 pb-3 pt-3" style={{ height: 244 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={structureMetricBars} margin={{ top: 8, right: 8, bottom: 4, left: -12 }} barCategoryGap="18%">
                  <CartesianGrid vertical={false} stroke="#1f2937" strokeDasharray="3 3" />
                  <XAxis dataKey="name" tick={{ fill: "#D1D5DB", fontSize: 12, fontWeight: 700 }} axisLine={{ stroke: "#374151" }} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#9CA3AF", fontSize: 11 }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: "rgba(217,70,239,0.08)" }} content={<BarTooltipDark />} />
                  <Legend wrapperStyle={{ fontSize: 12, paddingTop: 2 }} iconType="circle" />
                  <Bar dataKey="封面" fill="#fbbf24" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="转化" fill="#38bdf8" radius={[4, 4, 0, 0]} maxBarSize={22} />
                  <Bar dataKey="契合" fill="#34d399" radius={[4, 4, 0, 0]} maxBarSize={22} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        </div>
      ) : null}

      {/* 投流策略：付费放大路线（数据驱动 · 测试→校准→放大） */}
      {(() => {
        const paid = PLATFORM_PAID_CHANNELS[platformKey] ?? PLATFORM_PAID_CHANNELS.douyin!;
        return (
          <section className="mb-4 overflow-hidden rounded-xl border border-amber-500/40 bg-[linear-gradient(180deg,rgba(245,158,11,0.13)_0%,rgba(17,24,39,0.97)_30%)] shadow-[0_10px_36px_rgba(245,158,11,0.14)]">
            <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400" aria-hidden />
            <div className="flex flex-wrap items-center gap-2.5 border-b border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/25 text-amber-100 shadow-sm">
                <Megaphone size={18} strokeWidth={2.25} aria-hidden />
              </span>
              <div className="min-w-0">
                <h2 className="text-base font-bold leading-tight text-amber-50 md:text-lg">投流策略 · 付费放大路线</h2>
                <p className="text-[11px] font-medium text-amber-200/75">测试 → 校准 → 放大 三段式 · 配比与止损线</p>
              </div>
              {matchedLabel ? (
                <span className="ml-auto rounded-md border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-50">
                  主战场：{matchedLabel}
                </span>
              ) : null}
            </div>

            <div className="grid grid-cols-1 gap-2.5 p-3 lg:grid-cols-12">
              {/* 平台付费矩阵 */}
              <div className="lg:col-span-3 flex flex-col rounded-lg border border-orange-400/30 bg-[linear-gradient(160deg,rgba(251,146,60,0.12),rgba(15,23,42,0.95))] p-3">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-orange-100">
                  <Rocket size={15} className="text-orange-300" aria-hidden />
                  平台付费矩阵
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {paid.channels.map((c) => (
                    <span
                      key={c}
                      className="inline-flex items-center rounded-full border border-orange-400/40 bg-orange-500/20 px-2 py-0.5 text-[11px] font-semibold text-orange-50"
                    >
                      {c}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[12px] leading-relaxed text-orange-50/90">{paid.note}</p>
              </div>

              {/* 三段式预算配比 */}
              <div className="lg:col-span-4 rounded-lg border border-amber-400/30 bg-[linear-gradient(160deg,rgba(245,158,11,0.1),rgba(15,23,42,0.95))] p-3">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-amber-100">
                  <Coins size={15} className="text-amber-300" aria-hidden />
                  预算三段式配比
                </h3>
                <div className="mt-2 space-y-2">
                  {PAID_TRAFFIC_PHASES.map((ph, i) => (
                    <div key={ph.key} className={`rounded-md border px-2 py-1.5 ${ph.accent}`}>
                      <div className="flex items-center justify-between text-[12px] font-bold">
                        <span className="inline-flex items-center gap-1">
                          <span className="opacity-70">{i + 1}.</span>
                          {ph.label}
                        </span>
                        <span className="tabular-nums">{ph.ratio}%</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/30" aria-hidden>
                        <div className={`h-full ${ph.bar}`} style={{ width: `${ph.ratio}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] leading-snug opacity-90">{ph.watch}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* 优先投流选题 */}
              <div className="lg:col-span-3 rounded-lg border border-emerald-400/30 bg-[linear-gradient(160deg,rgba(16,185,129,0.1),rgba(15,23,42,0.95))] p-3">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-emerald-100">
                  <Target size={15} className="text-emerald-300" aria-hidden />
                  优先投流选题
                </h3>
                <p className="mt-1 text-[10px] text-emerald-200/70">综合分 = 封面×0.4 + 转化×0.4 + 契合×0.2</p>
                <div className="mt-2 space-y-2">
                  {paidPriorityTopics.length > 0 ? (
                    paidPriorityTopics.map((t, i) => (
                      <div key={`${t.title}-${i}`} className="rounded-md border border-emerald-400/25 bg-emerald-950/40 px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 text-[11px] font-black text-emerald-50">
                            {i + 1}
                          </span>
                          <span className="line-clamp-2 text-[12px] font-semibold leading-snug text-white">
                            {trial ? <TrialReadSensitive className="w-full">{t.title}</TrialReadSensitive> : t.title}
                          </span>
                          <span className="ml-auto rounded bg-emerald-500/25 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-emerald-50">
                            {t.score}
                          </span>
                        </div>
                        <div className="mt-1 flex gap-1 pl-[1.75rem] text-[10px] tabular-nums text-emerald-100/80">
                          <span>封面 {t.ctr}%</span>
                          <span>· 转化 {t.conv}%</span>
                          <span>· 契合 {t.fit}</span>
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="text-[11px] text-emerald-100/60">暂无可排序选题。</p>
                  )}
                </div>
              </div>

              {/* 止损与放量纪律 */}
              <div className="lg:col-span-2 rounded-lg border border-rose-400/30 bg-[linear-gradient(160deg,rgba(244,63,94,0.1),rgba(15,23,42,0.95))] p-3">
                <h3 className="flex items-center gap-1.5 text-sm font-bold text-rose-100">
                  <ShieldAlert size={15} className="text-rose-300" aria-hidden />
                  止损纪律
                </h3>
                <ul className="mt-2 space-y-1.5 text-[11px] leading-snug text-rose-50/90">
                  <li>· 单素材设测试预算上限，未达点击/互动阈值即止损</li>
                  <li>· ROI 连续低于盈亏线即降价或停投</li>
                  <li>· 每日补新素材赛马，替换衰退条目</li>
                </ul>
              </div>
            </div>

            <p className="mx-3 mb-3 rounded-lg border-l-4 border-amber-400/70 bg-gradient-to-r from-amber-950/55 to-amber-950/20 px-2.5 py-2 text-[11px] leading-relaxed text-amber-50/90">
              <span className="font-semibold text-amber-200">参照说明：</span>
              以上为投流方法论与配比建议（依主战场与本报告选题分推演），具体金额与出价请结合账户实测数据与平台后台口径，分阶段小步放量；指标为决策辅助，非平台官方流量承诺。
            </p>
          </section>
        );
      })()}

      {!trial && onGenerateTopicCopy && totalDirections > 0 ? (
        <div className="mb-3.5 rounded-xl border-2 border-[#fde047]/40 bg-[linear-gradient(135deg,rgba(253,224,71,0.14),rgba(17,24,39,0.92))] px-3.5 py-3 shadow-[0_8px_28px_rgba(253,224,71,0.12)]">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold text-[#fde047]">
            <Sparkles size={16} className="shrink-0" aria-hidden />
            战略地图共 {totalDirections} 个选题方向
            <span className="rounded-full border border-emerald-400/40 bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-100">
              已赠送 {giftedCount} 条至下方执行区
            </span>
            <span className="rounded-full border border-amber-400/40 bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-50">
              其余 {manualCopyCount} 条可点「生成完整文案」
            </span>
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed text-amber-100/85">
            赠送选题仅本次浏览可见。未赠送方向请点击各卡按钮即时扩写至下方执行区，有文案即可与分镜一致批量生成封面。
          </p>
        </div>
      ) : null}

      {/* 横向第二带：洞察 + 选题实例 + IP */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12 lg:items-stretch">
        <div className="lg:col-span-5">
          <section className="grid h-full grid-rows-[auto_auto_1fr] gap-0 overflow-hidden rounded-xl border border-indigo-500/40 bg-[linear-gradient(180deg,rgba(99,102,241,0.13)_0%,rgba(17,24,39,0.96)_28%)] shadow-[0_10px_32px_rgba(99,102,241,0.14)]">
            <div className="h-1 w-full bg-gradient-to-r from-indigo-400 via-blue-400 to-transparent" aria-hidden />
            <div className="flex items-center gap-2.5 border-b border-indigo-500/20 bg-indigo-500/10 px-3 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-500/25 text-indigo-100">
                <Lightbulb size={18} strokeWidth={2.25} aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-bold text-indigo-50">核心洞察</h2>
                <p className="text-[11px] font-medium text-indigo-200/70">四条并列 · 结论 + 指标附注</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2.5 p-3">
              {data.coreInsights.map((ins, idx) => {
                const acc = insightCardAccent(idx);
                const CardIcon = acc.icon;
                return (
                  <article
                    key={ins.id}
                    className={`rounded-lg border p-2.5 shadow-sm ${acc.ring}`}
                  >
                    <h3 className="mb-1 flex items-center gap-1.5 text-base font-bold text-white">
                      <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${acc.badge}`}>
                        <CardIcon size={15} strokeWidth={2.25} aria-hidden />
                      </span>
                      <span className="line-clamp-2 leading-snug">
                        {trial ? <TrialReadSensitive>{ins.title}</TrialReadSensitive> : ins.title}
                      </span>
                    </h3>
                    <p className="line-clamp-4 text-[13px] leading-relaxed text-gray-100/95">
                      {trial ? <TrialReadSensitive>{ins.content}</TrialReadSensitive> : ins.content}
                    </p>
                    {ins.metricsText ? (
                      <p className="mt-1.5 line-clamp-2 rounded-md border border-emerald-400/45 bg-emerald-950/55 px-2 py-1 text-[13px] font-semibold leading-snug text-emerald-50">
                        {trial ? (
                          <TrialReadSensitive>{sanitizeDecisionIntelMetricsText(ins.metricsText)}</TrialReadSensitive>
                        ) : (
                          sanitizeDecisionIntelMetricsText(ins.metricsText)
                        )}
                      </p>
                    ) : null}
                  </article>
                );
              })}
            </div>
          </section>
        </div>

        <div className="lg:col-span-4">
          <section className="flex h-full flex-col overflow-hidden rounded-xl border border-amber-500/40 bg-[linear-gradient(180deg,rgba(245,158,11,0.13)_0%,rgba(17,24,39,0.96)_32%)] shadow-[0_10px_32px_rgba(245,158,11,0.13)]">
            <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-transparent" aria-hidden />
            <div className="flex items-center gap-2.5 border-b border-amber-500/25 bg-amber-500/10 px-3 py-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/25 text-amber-100">
                <BookOpen size={18} strokeWidth={2.25} aria-hidden />
              </span>
              <div>
                <h2 className="text-base font-bold text-amber-50">选题结构实例</h2>
                <p className="text-[11px] font-medium text-amber-200/75">可拍结构 · 封面 / 转化 / 契合</p>
              </div>
            </div>
            <div className="grid flex-1 grid-cols-2 gap-2 p-3">
              {data.topicStructureExamples.map((ex, idx) => (
                <div
                  key={ex.title}
                  className={`rounded-lg border p-2 text-left shadow-sm ${
                    idx % 2 === 0
                      ? "border-orange-500/25 bg-[linear-gradient(145deg,rgba(251,146,60,0.1),rgba(15,23,42,0.92))]"
                      : "border-rose-500/25 bg-[linear-gradient(145deg,rgba(244,63,94,0.08),rgba(15,23,42,0.92))]"
                  }`}
                >
                  <div className="flex items-start gap-1.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-black/25 text-amber-200">
                      <Sparkles size={12} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1 whitespace-normal break-words text-base font-bold leading-snug text-white">
                      {trial ? <TrialReadSensitive className="w-full">{ex.title}</TrialReadSensitive> : ex.title}
                    </div>
                  </div>
                  <TopicStructureDetails
                    className="mt-2 pl-7"
                    summaryClassName="cursor-pointer select-none text-xs font-bold text-amber-200/95 [-webkit-tap-highlight-color:transparent] list-none [&::-webkit-details-marker]:hidden"
                    summary={
                      <span className="rounded-md border border-amber-500/25 bg-amber-950/30 px-2 py-1 text-amber-100/95">
                        完整结构文案
                        <span className="ml-1 font-normal text-white/45">（点击可收起 / 展开）</span>
                      </span>
                    }
                  >
                    <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-amber-400/35 pl-2 text-sm leading-relaxed text-gray-100/95">
                      {trial ? <TrialReadSensitive className="w-full">{ex.structure}</TrialReadSensitive> : ex.structure}
                    </p>
                  </TopicStructureDetails>
                  <div className="mt-2 flex flex-wrap gap-1 pl-7">
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-[11px] font-semibold text-amber-50">
                      <Zap size={11} className="shrink-0 text-amber-300" aria-hidden />
                      封面 {ex.predictedCtr}%
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-sky-400/40 bg-sky-500/20 px-2 py-0.5 text-[11px] font-semibold text-sky-50">
                      <RefreshCcw size={11} className="shrink-0 text-sky-300" aria-hidden />
                      转化 {ex.predictedConversion}%
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-400/40 bg-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-50">
                      <Target size={11} className="shrink-0 text-emerald-300" aria-hidden />
                      契合 {ex.brandMatchFit}
                    </span>
                  </div>
                  <TopicExecutionCopyActions
                        pick={{
                          title: ex.title,
                          structure: ex.structure,
                          predictedCtr: ex.predictedCtr,
                          predictedConversion: ex.predictedConversion,
                          brandMatchFit: ex.brandMatchFit,
                          source: "structure",
                        }}
                        onGenerate={onGenerateTopicCopy}
                        onRegenerate={onRegenerateTopicCopy}
                        trial={trial}
                        variant="structure"
                        loading={generatingTopicCopyKey === normalizeDecisionIntelTopicTitleKey(ex.title)}
                        alreadyInExecution={existingKeys.has(normalizeDecisionIntelTopicTitleKey(ex.title))}
                        isGifted={giftedKeys.has(normalizeDecisionIntelTopicTitleKey(ex.title))}
                      />
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="lg:col-span-3">
          <section className="flex h-full flex-col overflow-hidden rounded-xl border border-rose-500/40 bg-[linear-gradient(180deg,rgba(244,63,94,0.12)_0%,rgba(17,24,39,0.96)_30%)] shadow-[0_10px_32px_rgba(244,63,94,0.14)]">
            <div className="h-1 w-full bg-gradient-to-r from-rose-400 via-pink-400 to-transparent" aria-hidden />
            <h2 className="flex items-center gap-2.5 border-b border-rose-500/25 bg-rose-500/10 px-3 py-2.5 text-base font-bold text-rose-50">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-rose-500/25 text-rose-100">
                <HeartHandshake size={18} strokeWidth={2.25} aria-hidden />
              </span>
              <span className="flex flex-col leading-tight">
                IP 契合与推荐
                <span className="mt-0.5 text-[11px] font-medium text-rose-200/75">人设对齐 · 播放量预估</span>
              </span>
            </h2>
            <div className="min-h-0 flex-1 space-y-1 p-3 pb-0">
              <div className="flex rounded-md border border-rose-500/15 bg-black/20 px-2 py-1.5 text-xs font-semibold text-rose-100/80">
                <div className="min-w-0 flex-[1.1] pr-1">
                  <span className="inline-flex items-center gap-1">
                    <BookOpen size={12} className="text-rose-300/90" aria-hidden />
                    选题方向
                  </span>
                </div>
                <div className="w-[4.75rem] shrink-0 text-center">
                  <span className="inline-flex items-center gap-0.5 justify-center">
                    <Target size={12} className="text-amber-300" aria-hidden />
                    契合度
                  </span>
                </div>
                <div className="w-[5.5rem] shrink-0 text-right">
                  <span className="inline-flex items-center gap-0.5 justify-end">
                    <BarChart3 size={12} className="text-emerald-300" aria-hidden />
                    预估播放量
                  </span>
                </div>
              </div>
              {data.executionSuggestions.personalization.map((item) => {
                const fit = Math.min(100, Math.max(0, Math.round(Number(item.brandMatchScore) || 0)));
                return (
                <div
                  key={item.topicDirection}
                  className="rounded-lg border border-rose-500/15 bg-[linear-gradient(90deg,rgba(244,63,94,0.06),transparent)] px-2 py-2 text-sm last:mb-0"
                >
                  <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-2">
                    <div className="min-w-0 flex-1 md:pr-1 md:min-w-0 md:flex-[1.1]">
                      <div className="whitespace-normal break-words font-medium leading-snug text-gray-100 [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden">
                        {trial ? (
                          <TrialReadSensitive className="w-full">{item.topicDirection}</TrialReadSensitive>
                        ) : (
                          item.topicDirection
                        )}
                      </div>
                    </div>
                    <div
                      className="flex items-center gap-2 md:w-[4.75rem] md:shrink-0 md:flex-col md:justify-center md:gap-1 md:py-0.5"
                      title={`IP 契合度 ${fit} / 100（分值愈高，用语与人设愈一致）`}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2 md:w-full md:flex-col md:items-center md:gap-1">
                        <span className="whitespace-nowrap font-mono text-sm font-black tabular-nums text-amber-100 md:text-center">
                          <span aria-hidden="true" className="md:hidden text-[11px] font-semibold text-rose-200/80">
                            契合{" "}
                          </span>
                          {fit}
                          <span className="text-[11px] font-bold text-amber-200/55">/100</span>
                        </span>
                        <div
                          className="h-2 min-w-[3.5rem] flex-1 overflow-hidden rounded-full bg-gray-800/90 ring-1 ring-rose-500/20 md:h-1.5 md:w-full md:max-w-[4.25rem] md:flex-none"
                          aria-hidden
                        >
                          <div
                            className={`h-full ${
                              fit > 90 ? "bg-emerald-400" : fit > 70 ? "bg-sky-400" : "bg-orange-400"
                            }`}
                            style={{ width: `${fit}%` }}
                          />
                        </div>
                      </div>
                      <span className="sr-only">IP 契合度 {fit} 分，满分为 100</span>
                    </div>
                    <div className="flex shrink-0 items-center justify-end gap-1 md:w-[5.5rem] md:flex-col md:items-end md:justify-center md:gap-0">
                      <span className="inline-flex items-center gap-0.5 font-mono text-xs font-semibold tabular-nums text-emerald-100/95">
                        <TrendingUp size={12} className="text-emerald-400/80" aria-hidden />
                        {formatInt(item.viewsPredicted)}
                      </span>
                      <span className="hidden text-[10px] text-emerald-200/65 md:block">预估播放</span>
                    </div>
                  </div>
                  <TopicExecutionCopyActions
                    pick={{
                      title: item.topicDirection,
                      structure:
                        "痛点切入 → IP 人设强化 → 专业解读 → 行动号召（战略地图 IP 推荐方向，须贴合账号人设与主战场平台）",
                      brandMatchFit: fit,
                      source: "personalization",
                    }}
                    onGenerate={onGenerateTopicCopy}
                    onRegenerate={onRegenerateTopicCopy}
                    trial={trial}
                    variant="personalization"
                    loading={generatingTopicCopyKey === normalizeDecisionIntelTopicTitleKey(item.topicDirection)}
                    alreadyInExecution={existingKeys.has(normalizeDecisionIntelTopicTitleKey(item.topicDirection))}
                  />
                </div>
                );
              })}
            </div>
            <p className="m-3 mt-2 rounded-lg border-l-4 border-amber-400/70 bg-gradient-to-r from-amber-950/55 to-amber-950/25 px-2.5 py-2 text-[11px] leading-relaxed text-amber-50/95 shadow-inner">
              <span className="inline-flex items-center gap-1 font-semibold text-amber-200">
                <Sparkles size={12} aria-hidden />
                参照说明：
              </span>
              {trial ? (
                <TrialReadSensitive className="mt-1 block w-full">{ipFitExplainBody}</TrialReadSensitive>
              ) : (
                ipFitExplainBody
              )}
            </p>
          </section>
        </div>
      </div>

      <p className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-gray-700/80 bg-[linear-gradient(90deg,rgba(55,65,81,0.35),rgba(17,24,39,0.85))] px-3 py-2.5 text-center text-xs leading-relaxed text-gray-400">
        <ScanLine size={14} className="shrink-0 text-gray-500" aria-hidden />
        <span>
          B 端智库专用视图 · 数值参考历史数据与内部模型演算 ·{" "}
          <span className="font-semibold text-gray-300">不宜直接作为对一般用户的承诺指标</span>
        </span>
      </p>
    </div>
  );
}

export default PlatformReportDashboard;
