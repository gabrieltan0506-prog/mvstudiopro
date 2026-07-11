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
  Calculator,
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
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { PaidTrafficReviewPanel } from "./PaidTrafficReviewPanel";

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

/** 静态百分比环：PDF / HTML 均可见中心数值，不依赖 hover */
function StaticPctRing(props: { label: string; value: number; color: string }) {
  const v = Math.min(100, Math.max(0, Math.round(props.value)));
  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        className="relative h-[4.25rem] w-[4.25rem] shrink-0 rounded-full"
        style={{
          background: `conic-gradient(${props.color} ${v * 3.6}deg, rgba(255,255,255,0.08) 0deg)`,
        }}
        aria-label={`${props.label} ${v}%`}
      >
        <div className="absolute inset-[0.55rem] flex items-center justify-center rounded-full bg-[#0b1220] text-[13px] font-black tabular-nums text-white">
          {v}%
        </div>
      </div>
      <span className="text-[11px] font-bold tracking-wide text-white/75">{props.label}</span>
    </div>
  );
}

function truncateTitle(s: string, max = 36): string {
  const t = String(s || "").trim();
  if (!t) return "（未命名选题）";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** 各平台付费投流产品矩阵 + 渠道预算权重（投流策略用，weight 合计≈100） */
interface PaidChannelPlan {
  name: string;
  weight: number;
  role: string;
}
interface PlatformPaidPlan {
  label: string;
  kpiFocus: string;
  note: string;
  channels: PaidChannelPlan[];
}
const PLATFORM_PAID_PLANS: Record<string, PlatformPaidPlan> = {
  douyin: {
    label: "抖音",
    kpiFocus: "3 秒完播 · 点击率 · 转化成本 CPA",
    note: "先 DOU+ 测完播与互动，达标素材切千川承接转化",
    channels: [
      { name: "DOU+", weight: 25, role: "冷启测试 · 测完播/互动" },
      { name: "巨量千川", weight: 65, role: "放大承接 · 控 CPA / ROI" },
      { name: "小店随心推", weight: 10, role: "日常稳量 · 加热自然流" },
    ],
  },
  xiaohongshu: {
    label: "小红书",
    kpiFocus: "点击率 · 收藏率 · 互动成本",
    note: "薯条测点击与收藏，跑通后用聚光放大种草人群",
    channels: [
      { name: "薯条", weight: 35, role: "低价测试 · 测点击/收藏" },
      { name: "聚光平台", weight: 55, role: "精准放大 · 搜索/信息流种草" },
      { name: "蒲公英", weight: 10, role: "达人合作 · 内容信任背书" },
    ],
  },
  kuaishou: {
    label: "快手",
    kpiFocus: "完播 · 互动 · 成交 ROI",
    note: "强信任带货，磁力金牛承接成交与复购",
    channels: [
      { name: "粉条", weight: 30, role: "作品加热 · 测互动" },
      { name: "磁力金牛", weight: 60, role: "电商放大 · 承接成交/复购" },
      { name: "小店通", weight: 10, role: "直播间引流 · 稳成交" },
    ],
  },
  bilibili: {
    label: "B站",
    kpiFocus: "完播率 · 三连率 · 涨粉成本",
    note: "中长视频以完播/三连为核心，起飞放大优质稿件",
    channels: [
      { name: "UP主起飞", weight: 60, role: "放大优质稿件 · 拉播放与粉丝" },
      { name: "花火商单", weight: 40, role: "商业合作 · 品牌承接" },
    ],
  },
};
const PAID_PLATFORM_ORDER = ["douyin", "xiaohongshu", "kuaishou", "bilibili"] as const;

/** 各平台信息流投流经验基准 CPM（元/千次曝光），用于把选题的预估 CTR/转化率换算成预估 CPA。仅经验值，非平台报价。 */
const PLATFORM_REFERENCE_CPM: Record<string, number> = {
  douyin: 32,
  xiaohongshu: 42,
  kuaishou: 26,
  bilibili: 36,
};
const PLATFORM_REFERENCE_CPM_DEFAULT = 35;
/** 预估单次成交成本 CPA = (CPM/1000) / (点击率 × 转化率)；ctr/conv 为 0~100 的百分数 */
function estimateTopicCpa(cpm: number, ctrPct: number, convPct: number): number | null {
  const ctr = Math.max(0, ctrPct) / 100;
  const conv = Math.max(0, convPct) / 100;
  const denom = ctr * conv;
  if (denom <= 0) return null;
  return cpm / 1000 / denom;
}

/** 投流预算快捷档（元） */
const PAID_BUDGET_PRESETS = [1000, 3000, 8000, 20000] as const;
const PAID_BUDGET_DEFAULT = 3000;
const PAID_BUDGET_MAX = 10_000_000;
/** 冷启测试段建议铺设的素材条数（用于反推单条测试预算上限） */
const PAID_TEST_CREATIVE_COUNT = 6;

function formatCny(n: number): string {
  return `¥${formatInt(Math.max(0, Math.round(n)))}`;
}

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

  // 投流策略：可交互预算算钱 + 平台切换
  const [selectedPaidPlatform, setSelectedPaidPlatform] = useState<string>(
    PLATFORM_PAID_PLANS[platformKey] ? platformKey : "douyin",
  );
  const [paidBudgetInput, setPaidBudgetInput] = useState<string>(String(PAID_BUDGET_DEFAULT));
  const paidBudget = useMemo(() => {
    const n = Math.floor(Number(String(paidBudgetInput).replace(/[^\d]/g, "")) || 0);
    return Math.min(PAID_BUDGET_MAX, Math.max(0, n));
  }, [paidBudgetInput]);
  const paidPhaseAmounts = useMemo(
    () => PAID_TRAFFIC_PHASES.map((p) => ({ ...p, amount: Math.round((paidBudget * p.ratio) / 100) })),
    [paidBudget],
  );
  const perCreativeTestCap = Math.round((paidBudget * 0.2) / PAID_TEST_CREATIVE_COUNT);
  const activePaidPlan = PLATFORM_PAID_PLANS[selectedPaidPlatform] ?? PLATFORM_PAID_PLANS.douyin!;

  // 回本自测：用户输入客单价/毛利率/转化率 → 算盈亏平衡 CPA / ROAS / 可接受 CPC / 止损线（不依赖任何投放数据）
  const [aovInput, setAovInput] = useState<string>("199");
  const [marginInput, setMarginInput] = useState<string>("50");
  const [convInput, setConvInput] = useState<string>("3");
  const breakeven = useMemo(() => {
    const aov = Math.max(0, Math.floor(Number(String(aovInput).replace(/[^\d.]/g, "")) || 0));
    const marginPct = Math.min(100, Math.max(0, Number(String(marginInput).replace(/[^\d.]/g, "")) || 0));
    const convPct = Math.min(100, Math.max(0, Number(String(convInput).replace(/[^\d.]/g, "")) || 0));
    const margin = marginPct / 100;
    const conv = convPct / 100;
    const grossPerOrder = aov * margin; // 单笔毛利 = 可接受单次成交成本上限(盈亏平衡 CPA)
    const breakevenCpa = grossPerOrder;
    const breakevenRoas = margin > 0 ? 1 / margin : 0;
    const maxCpc = breakevenCpa * conv; // CPA = CPC / 转化率 → CPC = CPA × 转化率
    const stopLoss = Math.round(breakevenCpa * 2); // 单素材止损 = 盈亏平衡CPA × 2（学习期容错）
    const testAmount = Math.round((paidBudget * 20) / 100);
    const ordersToBreakeven = breakevenCpa > 0 ? testAmount / breakevenCpa : 0; // 测试期回本所需成交数
    // 经验判定：毛利空间决定投流可行性（content-commerce 经验阈值）
    let verdict: { tone: "go" | "caution" | "stop"; label: string; note: string };
    if (aov <= 0 || marginPct <= 0) {
      verdict = { tone: "caution", label: "先填客单价与毛利率", note: "填入真实数据后即可判断投流是否回得了本。" };
    } else if (breakevenCpa < 15) {
      verdict = {
        tone: "stop",
        label: "投流难回本",
        note: "单笔毛利过薄，付费获客成本极易吃掉利润；建议先靠自然流/提客单价/做复购，再考虑投流。",
      };
    } else if (breakevenCpa < 50) {
      verdict = {
        tone: "caution",
        label: "有机会但要精打细算",
        note: "需把单次成交成本压在盈亏线内，严控转化率与出价，小步测试达标再放量。",
      };
    } else {
      verdict = {
        tone: "go",
        label: "毛利充足，适合放量",
        note: "单笔毛利能覆盖较高获客成本，跑通达标素材后可加大投流放大规模。",
      };
    }
    return { aov, marginPct, convPct, breakevenCpa, breakevenRoas, maxCpc, stopLoss, ordersToBreakeven, verdict };
  }, [aovInput, marginInput, convInput, paidBudget]);

  // 优先投流选题：用回本自测的盈亏 CPA + 平台基准 CPM 估算每条选题的预估 CPA，筛出「投得起」的
  const breakevenActive = breakeven.aov > 0 && breakeven.marginPct > 0;
  const paidTopicsWithCpa = useMemo(() => {
    const cpm = PLATFORM_REFERENCE_CPM[selectedPaidPlatform] ?? PLATFORM_REFERENCE_CPM_DEFAULT;
    return paidPriorityTopics.map((t) => {
      const estCpa = estimateTopicCpa(cpm, t.ctr, t.conv);
      const affordable = breakevenActive && estCpa != null ? estCpa <= breakeven.breakevenCpa : true;
      return { ...t, estCpa, affordable };
    });
  }, [paidPriorityTopics, selectedPaidPlatform, breakevenActive, breakeven.breakevenCpa]);
  const affordableTopics = breakevenActive
    ? paidTopicsWithCpa.filter((t) => t.affordable)
    : paidTopicsWithCpa;
  const unaffordableCount = breakevenActive ? paidTopicsWithCpa.length - affordableTopics.length : 0;

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

      {/* 横向对比带：静态可读（PDF / HTML 均显示标题与数值，不依赖 hover） */}
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
                <p className="text-[11px] font-medium text-sky-200/75">
                  排名条形 · 标题与播放量常显 · 对应「IP 契合与推荐」
                </p>
              </div>
            </div>
            <div className="space-y-3 px-3.5 py-3.5">
              {(() => {
                const maxViews = Math.max(1, ...topicViewsBars.map((r) => r.views));
                return topicViewsBars.map((row) => {
                  const pct = Math.round((row.views / maxViews) * 100);
                  return (
                    <div
                      key={row.name}
                      className="rounded-lg border border-sky-500/20 bg-black/25 px-3 py-2.5"
                    >
                      <div className="mb-1.5 flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold uppercase tracking-wide text-sky-300/80">
                            {row.name}
                          </div>
                          <div
                            className="mt-0.5 text-sm font-semibold leading-snug text-sky-50"
                            title={row.fullName}
                          >
                            {truncateTitle(row.fullName, 42)}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div className="text-lg font-black tabular-nums leading-none text-cyan-200">
                            {formatInt(row.views)}
                          </div>
                          <div className="mt-0.5 text-[10px] font-medium text-sky-200/60">预估播放</div>
                        </div>
                      </div>
                      <div className="h-2.5 overflow-hidden rounded-full bg-white/10">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{ width: `${pct}%`, background: row.color }}
                        />
                      </div>
                    </div>
                  );
                });
              })()}
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
                <p className="text-[11px] font-medium text-fuchsia-200/75">
                  环形百分比常显 · 对应「选题结构实例」
                </p>
              </div>
            </div>
            <div className="space-y-3 px-3.5 py-3.5">
              {structureMetricBars.map((row) => (
                <div
                  key={row.name}
                  className="rounded-lg border border-fuchsia-500/20 bg-black/25 px-3 py-3"
                >
                  <div className="mb-2.5">
                    <div className="text-[11px] font-bold uppercase tracking-wide text-fuchsia-300/80">
                      {row.name}
                    </div>
                    <div
                      className="mt-0.5 text-sm font-semibold leading-snug text-fuchsia-50"
                      title={row.fullName}
                    >
                      {truncateTitle(row.fullName, 42)}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-around gap-3">
                    <StaticPctRing label="封面" value={row.封面} color="#fbbf24" />
                    <StaticPctRing label="转化" value={row.转化} color="#38bdf8" />
                    <StaticPctRing label="契合" value={row.契合} color="#34d399" />
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {/* 投流策略：付费放大路线（可交互算钱 · 四平台可切换） */}
      <section className="mb-4 overflow-hidden rounded-xl border border-amber-500/40 bg-[linear-gradient(180deg,rgba(245,158,11,0.13)_0%,rgba(17,24,39,0.97)_26%)] shadow-[0_10px_36px_rgba(245,158,11,0.14)]">
        <div className="h-1 w-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400" aria-hidden />
        <div className="flex flex-wrap items-center gap-2.5 border-b border-amber-500/25 bg-amber-500/10 px-3.5 py-2.5">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/25 text-amber-100 shadow-sm">
            <Megaphone size={18} strokeWidth={2.25} aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-bold leading-tight text-amber-50 md:text-lg">投流策略 · 付费放大路线</h2>
            <p className="text-[11px] font-medium text-amber-200/75">输入预算自动算钱 · 测试→校准→放大 · 四平台可切换</p>
          </div>
          {matchedLabel ? (
            <span className="ml-auto rounded-md border border-amber-400/40 bg-amber-500/20 px-2 py-0.5 text-xs font-bold text-amber-50">
              主战场：{matchedLabel}
            </span>
          ) : null}
        </div>

        {/* 预算输入条 + 三段式金额 */}
        <div className="border-b border-amber-500/15 bg-black/20 px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-100">
              <Coins size={15} className="text-amber-300" aria-hidden />
              投流总预算
            </label>
            <div className="inline-flex items-center overflow-hidden rounded-lg border border-amber-400/45 bg-[#0B0F19]/80">
              <span className="px-2 text-sm font-bold text-amber-200/80">¥</span>
              <input
                type="text"
                inputMode="numeric"
                value={paidBudgetInput}
                onChange={(e) => setPaidBudgetInput(e.target.value.replace(/[^\d]/g, "").slice(0, 9))}
                className="w-28 bg-transparent py-1.5 pr-2 text-base font-black tabular-nums text-white outline-none placeholder:text-white/30"
                placeholder="预算金额"
                aria-label="投流总预算（元）"
              />
            </div>
            <div className="flex flex-wrap gap-1.5">
              {PAID_BUDGET_PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setPaidBudgetInput(String(p))}
                  className={`rounded-md border px-2 py-1 text-[11px] font-bold tabular-nums transition ${
                    paidBudget === p
                      ? "border-amber-400/70 bg-amber-500/30 text-amber-50"
                      : "border-white/15 bg-white/5 text-amber-100/80 hover:bg-white/10"
                  }`}
                >
                  {formatInt(p)}
                </button>
              ))}
            </div>
            <span className="ml-auto rounded-md border border-rose-400/35 bg-rose-500/10 px-2 py-1 text-[11px] font-semibold text-rose-100">
              建议单条测试上限 ≈ {formatCny(perCreativeTestCap)}
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {paidPhaseAmounts.map((ph, i) => (
              <div key={ph.key} className={`rounded-lg border px-2.5 py-2 ${ph.accent}`}>
                <div className="flex items-center justify-between text-[12px] font-bold">
                  <span className="inline-flex items-center gap-1">
                    <span className="opacity-70">{i + 1}.</span>
                    {ph.label}
                    <span className="opacity-70">· {ph.ratio}%</span>
                  </span>
                  <span className="text-base font-black tabular-nums [text-shadow:0_0_12px_rgba(255,255,255,0.25)]">
                    {formatCny(ph.amount)}
                  </span>
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/30" aria-hidden>
                  <div className={`h-full ${ph.bar}`} style={{ width: `${ph.ratio}%` }} />
                </div>
                <p className="mt-1 text-[11px] leading-snug opacity-90">{ph.watch}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 回本自测：能不能投得起 */}
        <div className="border-b border-amber-500/15 bg-[linear-gradient(160deg,rgba(16,185,129,0.06),rgba(15,23,42,0))] px-3 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="inline-flex items-center gap-1.5 text-sm font-bold text-emerald-100">
              <Calculator size={15} className="text-emerald-300" aria-hidden />
              回本自测 · 这条赛道投不投得起
            </h3>
            <span className="rounded-md border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-100/80">
              只需 3 个真实数据，立即算盈亏线（不接广告后台）
            </span>
          </div>
          <div className="mt-2.5 grid grid-cols-1 gap-2.5 lg:grid-cols-12">
            {/* 输入区 */}
            <div className="lg:col-span-4 grid grid-cols-3 gap-2">
              {[
                { label: "客单价", unit: "¥", value: aovInput, set: setAovInput, hint: "成交一单的价格" },
                { label: "毛利率", unit: "%", value: marginInput, set: setMarginInput, hint: "扣成本后利润占比" },
                { label: "转化率", unit: "%", value: convInput, set: setConvInput, hint: "看了→下单比例" },
              ].map((f) => (
                <label key={f.label} className="flex flex-col rounded-lg border border-emerald-400/25 bg-[#0B0F19]/70 px-2 py-1.5">
                  <span className="text-[10px] font-semibold text-emerald-200/80">{f.label}</span>
                  <span className="flex items-baseline gap-0.5">
                    <span className="text-[11px] font-bold text-emerald-300/70">{f.unit === "¥" ? "¥" : ""}</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={f.value}
                      onChange={(e) => f.set(e.target.value.replace(/[^\d.]/g, "").slice(0, 7))}
                      className="w-full bg-transparent text-base font-black tabular-nums text-white outline-none"
                      aria-label={f.label}
                    />
                    <span className="text-[11px] font-bold text-emerald-300/70">{f.unit === "%" ? "%" : ""}</span>
                  </span>
                  <span className="text-[9px] leading-tight text-emerald-100/45">{f.hint}</span>
                </label>
              ))}
            </div>
            {/* 结果四块 */}
            <div className="lg:col-span-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { k: "盈亏平衡CPA", v: formatCny(Math.round(breakeven.breakevenCpa)), sub: "单次成交成本须低于此", cls: "text-amber-50" },
                { k: "盈亏平衡ROAS", v: breakeven.breakevenRoas > 0 ? `${breakeven.breakevenRoas.toFixed(1)}x` : "—", sub: "投产比须高于此", cls: "text-cyan-50" },
                { k: "可接受最高CPC", v: formatCny(Math.round(breakeven.maxCpc)), sub: "单次点击出价上限", cls: "text-sky-50" },
                { k: "单素材止损线", v: formatCny(breakeven.stopLoss), sub: "花到此仍无成交即停", cls: "text-rose-50" },
              ].map((r) => (
                <div key={r.k} className="rounded-lg border border-white/10 bg-black/30 px-2 py-1.5">
                  <p className="text-[10px] font-medium text-gray-300/80">{r.k}</p>
                  <p className={`text-lg font-black tabular-nums ${r.cls} [text-shadow:0_0_12px_rgba(255,255,255,0.18)]`}>{r.v}</p>
                  <p className="text-[9px] leading-tight text-gray-400/70">{r.sub}</p>
                </div>
              ))}
            </div>
            {/* 结论 */}
            <div
              className={`lg:col-span-3 flex flex-col justify-center rounded-lg border px-2.5 py-2 ${
                breakeven.verdict.tone === "go"
                  ? "border-emerald-400/45 bg-[linear-gradient(150deg,rgba(16,185,129,0.18),rgba(15,23,42,0.9))]"
                  : breakeven.verdict.tone === "stop"
                    ? "border-rose-400/45 bg-[linear-gradient(150deg,rgba(244,63,94,0.18),rgba(15,23,42,0.9))]"
                    : "border-amber-400/45 bg-[linear-gradient(150deg,rgba(245,158,11,0.16),rgba(15,23,42,0.9))]"
              }`}
            >
              <p className="flex items-center gap-1.5 text-sm font-black">
                <span
                  className={`inline-flex h-5 w-5 items-center justify-center rounded-full text-[11px] ${
                    breakeven.verdict.tone === "go"
                      ? "bg-emerald-500/30 text-emerald-100"
                      : breakeven.verdict.tone === "stop"
                        ? "bg-rose-500/30 text-rose-100"
                        : "bg-amber-500/30 text-amber-100"
                  }`}
                >
                  {breakeven.verdict.tone === "go" ? "✓" : breakeven.verdict.tone === "stop" ? "✕" : "!"}
                </span>
                <span
                  className={
                    breakeven.verdict.tone === "go"
                      ? "text-emerald-50"
                      : breakeven.verdict.tone === "stop"
                        ? "text-rose-50"
                        : "text-amber-50"
                  }
                >
                  {breakeven.verdict.label}
                </span>
              </p>
              <p className="mt-1 text-[11px] leading-snug text-gray-200/85">{breakeven.verdict.note}</p>
              {breakeven.ordersToBreakeven > 0 ? (
                <p className="mt-1 text-[10px] text-gray-300/70">
                  测试期约需 <span className="font-bold text-white">{breakeven.ordersToBreakeven.toFixed(1)}</span> 单回本
                  （测试预算 {formatCny(Math.round((paidBudget * 20) / 100))} ÷ 盈亏CPA）
                </p>
              ) : null}
            </div>
          </div>
        </div>

        {/* 平台切换 tabs */}
        <div className="flex flex-wrap gap-1.5 px-3 pt-3">
          {PAID_PLATFORM_ORDER.map((pk) => {
            const plan = PLATFORM_PAID_PLANS[pk]!;
            const active = selectedPaidPlatform === pk;
            const isMatched = pk === platformKey;
            return (
              <button
                key={pk}
                type="button"
                onClick={() => setSelectedPaidPlatform(pk)}
                className={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                  active
                    ? "border-amber-400/70 bg-amber-500/25 text-amber-50 shadow-[0_0_16px_rgba(245,158,11,0.25)]"
                    : "border-white/12 bg-white/5 text-amber-100/70 hover:bg-white/10"
                }`}
              >
                {plan.label}
                {isMatched ? (
                  <span className="rounded-full bg-cyan-400/25 px-1.5 text-[9px] font-black text-cyan-100">主战场</span>
                ) : null}
              </button>
            );
          })}
        </div>

        <div className="grid grid-cols-1 gap-2.5 p-3 lg:grid-cols-12">
          {/* 渠道预算分配（按所选平台） */}
          <div className="lg:col-span-5 flex flex-col rounded-lg border border-orange-400/30 bg-[linear-gradient(160deg,rgba(251,146,60,0.12),rgba(15,23,42,0.95))] p-3">
            <h3 className="flex flex-wrap items-center gap-1.5 text-sm font-bold text-orange-100">
              <Rocket size={15} className="text-orange-300" aria-hidden />
              {activePaidPlan.label} · 渠道预算分配
              <span className="ml-auto rounded bg-orange-500/20 px-1.5 py-0.5 text-[10px] font-semibold text-orange-100/90">
                KPI：{activePaidPlan.kpiFocus}
              </span>
            </h3>
            <div className="mt-2 space-y-1.5">
              {activePaidPlan.channels.map((ch) => {
                const amt = Math.round((paidBudget * ch.weight) / 100);
                return (
                  <div key={ch.name} className="rounded-md border border-orange-400/20 bg-black/25 px-2.5 py-1.5">
                    <div className="flex items-center justify-between">
                      <span className="inline-flex items-center gap-1.5 text-[13px] font-bold text-orange-50">
                        <span className="rounded border border-orange-400/40 bg-orange-500/20 px-1.5 py-0.5 text-[11px]">
                          {ch.name}
                        </span>
                        <span className="text-[11px] font-medium text-orange-100/70">{ch.weight}%</span>
                      </span>
                      <span className="text-sm font-black tabular-nums text-amber-50">{formatCny(amt)}</span>
                    </div>
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-black/30" aria-hidden>
                      <div className="h-full bg-gradient-to-r from-orange-400 to-amber-300" style={{ width: `${ch.weight}%` }} />
                    </div>
                    <p className="mt-1 text-[11px] leading-snug text-orange-50/85">{ch.role}</p>
                  </div>
                );
              })}
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-orange-100/80">{activePaidPlan.note}</p>
          </div>

          {/* 优先投流选题（盈亏线过滤：只列「投得起」的） */}
          <div className="lg:col-span-4 rounded-lg border border-emerald-400/30 bg-[linear-gradient(160deg,rgba(16,185,129,0.1),rgba(15,23,42,0.95))] p-3">
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-emerald-100">
              <Target size={15} className="text-emerald-300" aria-hidden />
              {breakevenActive ? "投得起的优先选题" : "优先投流选题"}
            </h3>
            <p className="mt-1 text-[10px] text-emerald-200/70">
              {breakevenActive
                ? `预估CPA = (${activePaidPlan.label}基准CPM ÷ 1000) ÷ (点击率×转化率)，≤ 盈亏线 ${formatCny(Math.round(breakeven.breakevenCpa))} 即投得起`
                : "综合分 = 封面×0.4 + 转化×0.4 + 契合×0.2（填写上方「回本自测」可按盈亏线过滤）"}
            </p>
            <div className="mt-2 space-y-2">
              {affordableTopics.length > 0 ? (
                affordableTopics.map((t, i) => (
                  <div key={`${t.title}-${i}`} className="rounded-md border border-emerald-400/25 bg-emerald-950/40 px-2 py-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500/30 text-[11px] font-black text-emerald-50">
                        {i + 1}
                      </span>
                      <span className="line-clamp-2 text-[12px] font-semibold leading-snug text-white">
                        {trial ? <TrialReadSensitive className="w-full">{t.title}</TrialReadSensitive> : t.title}
                      </span>
                      {breakevenActive && t.estCpa != null ? (
                        <span className="ml-auto rounded bg-emerald-500/25 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-emerald-50">
                          CPA≈{formatCny(Math.round(t.estCpa))}
                        </span>
                      ) : (
                        <span className="ml-auto rounded bg-emerald-500/25 px-1.5 py-0.5 text-[11px] font-black tabular-nums text-emerald-50">
                          {t.score}
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex gap-1 pl-[1.75rem] text-[10px] tabular-nums text-emerald-100/80">
                      <span>封面 {t.ctr}%</span>
                      <span>· 转化 {t.conv}%</span>
                      <span>· 契合 {t.fit}</span>
                      {breakevenActive ? <span className="text-emerald-300">· 综合 {t.score}</span> : null}
                    </div>
                  </div>
                ))
              ) : breakevenActive ? (
                <p className="rounded-md border border-rose-400/25 bg-rose-950/30 px-2 py-1.5 text-[11px] leading-snug text-rose-100/85">
                  按当前盈亏线 {formatCny(Math.round(breakeven.breakevenCpa))}，暂无选题预估 CPA 能回本。建议提高客单价/毛利，或优化封面点击与转化率后再投。
                </p>
              ) : (
                <p className="text-[11px] text-emerald-100/60">暂无可排序选题。</p>
              )}
            </div>
            {breakevenActive && unaffordableCount > 0 ? (
              <p className="mt-2 rounded-md border border-amber-400/25 bg-amber-950/30 px-2 py-1 text-[10px] leading-snug text-amber-100/80">
                另有 {unaffordableCount} 条预估 CPA 超盈亏线，已折叠（获客成本可能吃掉利润，优先做自然流或优化转化）。
              </p>
            ) : null}
          </div>

          {/* 止损与放量纪律 */}
          <div className="lg:col-span-3 rounded-lg border border-rose-400/30 bg-[linear-gradient(160deg,rgba(244,63,94,0.1),rgba(15,23,42,0.95))] p-3">
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
          金额按你填写的总预算与各渠道权重自动换算，仅为分配建议；具体出价请结合账户实测数据与平台后台口径，分阶段小步放量。指标为决策辅助，非平台官方流量承诺。
        </p>
      </section>

      {!trial ? (
        <PaidTrafficReviewPanel breakevenCpa={breakeven.breakevenCpa} platformKey={selectedPaidPlatform} />
      ) : null}

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
