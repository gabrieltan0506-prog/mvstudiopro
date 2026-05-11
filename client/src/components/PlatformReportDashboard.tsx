/**
 * B 端智库「爆款决策与增长管线」仪表盘 — 供阅读模式或 Puppeteer 截 PDF。
 * 横向宽幅排布，避免区块内上下滚动；指标为决策辅助口径，参考历史数据与当前窗口样本。
 */

import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import { DEMO_ADVANCED_AI_REPORT_DATA } from "@shared/advancedAIReportDemoData";
import { sanitizeDecisionIntelMetricsText } from "@shared/decisionIntelSanitize";
import { fallbackPlatformHitPotentialRadar } from "@shared/advancedPredictionEngine";
import { cn } from "@/lib/utils";
import {
  BarChart3,
  BookOpen,
  Brain,
  Compass,
  GitCompare,
  HeartHandshake,
  LayoutDashboard,
  Lightbulb,
  Radio,
  RefreshCcw,
  ScanLine,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { useLayoutEffect, useRef } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";

export interface PlatformReportDashboardProps {
  data?: AdvancedAIReportData;
  className?: string;
  /** 试读：图表与指标保留形态，选题与正文类文案模糊脱敏 */
  presentation?: "default" | "trialRead";
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

/** 預設展開；使用者可收起。React 19 的 defaultOpen 在 @types/react 尚未收錄，故用 ref 初始化。 */
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

export function PlatformReportDashboard({
  data = DEMO_ADVANCED_AI_REPORT_DATA,
  className = "",
  presentation = "default",
}: PlatformReportDashboardProps): ReactElement {
  const trial = presentation === "trialRead";
  const g = data.globalPredictions;
  const radarData = buildRadarRows(g.hitPotentialRadar);
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

  return (
    <div
      data-platform-report-dashboard="true"
      className={`box-border w-[min(1680px,100vw)] max-w-[1680px] shrink-0 overflow-hidden border border-gray-800 bg-[#0B0F19] px-5 pb-5 pt-5 text-[15px] leading-relaxed font-sans text-white md:w-[1680px] ${className}`.trim()}
    >
      {trial ? (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/40 bg-[linear-gradient(90deg,rgba(245,158,11,0.18),rgba(15,23,42,0.92))] px-3 py-2.5 text-[11px] font-semibold leading-snug text-amber-50 shadow-[0_6px_24px_rgba(245,158,11,0.12)]">
          <ScanLine className="h-3.5 w-3.5 shrink-0 text-amber-200" aria-hidden />
          <span>
            对外试读样张：选题标题、结构正文、洞察与推荐用语已脱敏；版式与付费解锁后的决策智库报告一致，数值仅为演示形态。
          </span>
        </div>
      ) : null}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-gray-800/60 bg-[linear-gradient(125deg,rgba(99,102,241,0.08),rgba(15,23,42,0.95)_40%,rgba(16,185,129,0.06))] px-4 py-3 shadow-[0_12px_40px_rgba(0,0,0,0.25)]">
        <div>
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
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-purple-500/40 to-emerald-500/30 text-sm font-black text-white shadow-inner">
              M
            </span>
            <span>MV Studio Pro AI 决策智库报告</span>
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
          className="inline-flex items-center gap-2 rounded-lg border border-amber-500/45 bg-[linear-gradient(135deg,rgba(245,158,11,0.18),rgba(15,23,42,0.9))] px-3 py-2 text-sm font-semibold tabular-nums text-amber-50 shadow-[0_0_28px_rgba(245,158,11,0.15)] md:text-base"
          title="分析窗口"
        >
          <Compass size={18} className="shrink-0 text-amber-300" aria-hidden />
          {data.dateRange}
        </div>
      </header>

      {/* 横向第一带：全局 / 平台雷达 / 战略对照 */}
      <div className="mb-4 grid grid-cols-1 gap-3.5 lg:grid-cols-3">
        <section className="flex flex-col overflow-hidden rounded-xl border border-emerald-500/30 bg-[linear-gradient(180deg,rgba(16,185,129,0.14)_0%,rgba(17,24,39,0.97)_42%)] shadow-[0_8px_32px_rgba(16,185,129,0.08)]">
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
              <div className="rounded-lg border border-emerald-400/25 bg-emerald-950/40 px-2.5 py-2 shadow-sm">
                <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-200/90">
                  <BarChart3 size={15} className="text-emerald-400" aria-hidden />
                  总播放量预测
                </div>
                <div className="mt-0.5 text-2xl font-bold leading-tight text-emerald-100 tabular-nums md:text-3xl">
                  {formatInt(g.totalViewsPredicted)}
                </div>
              </div>
              <div className="rounded-lg border border-teal-400/25 bg-teal-950/35 px-2.5 py-2 shadow-sm">
                <div className="flex items-center gap-1.5 text-xs font-medium text-teal-200/90">
                  <RefreshCcw size={15} className="text-teal-400" aria-hidden />
                  平均转化率
                </div>
                <div className="mt-0.5 text-xl font-bold text-teal-100 tabular-nums md:text-2xl">
                  {g.averageConversionRate.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-cyan-500/30 bg-[linear-gradient(180deg,rgba(34,211,238,0.12)_0%,rgba(17,24,39,0.97)_40%)] shadow-[0_8px_32px_rgba(34,211,238,0.08)]">
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
                  <span className="ml-0.5 rounded-md bg-cyan-400/25 px-1.5 py-0.5 text-xs font-extrabold text-cyan-50">
                    {matchedLabel}
                  </span>
                ) : null}
              </p>
              <p className="mt-1.5 line-clamp-6 text-[13px] text-gray-200">
                {trial ? <TrialReadSensitive>{platformAside}</TrialReadSensitive> : platformAside}
              </p>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-xl border border-violet-500/30 bg-[linear-gradient(180deg,rgba(139,92,246,0.14)_0%,rgba(17,24,39,0.97)_38%)] shadow-[0_8px_32px_rgba(139,92,246,0.1)]">
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

      {/* 横向第二带：洞察 + 选题实例 + IP */}
      <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12 lg:items-stretch">
        <div className="lg:col-span-5">
          <section className="grid h-full grid-rows-[auto_1fr] gap-0 overflow-hidden rounded-xl border border-indigo-500/25 bg-[linear-gradient(180deg,rgba(99,102,241,0.1)_0%,rgba(17,24,39,0.96)_28%)] shadow-[0_8px_28px_rgba(99,102,241,0.08)]">
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
                    <h3 className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-white">
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md ${acc.badge}`}>
                        <CardIcon size={13} strokeWidth={2.25} aria-hidden />
                      </span>
                      <span className="line-clamp-2 leading-snug">
                        {trial ? <TrialReadSensitive>{ins.title}</TrialReadSensitive> : ins.title}
                      </span>
                    </h3>
                    <p className="line-clamp-4 text-xs leading-relaxed text-gray-200/90">
                      {trial ? <TrialReadSensitive>{ins.content}</TrialReadSensitive> : ins.content}
                    </p>
                    {ins.metricsText ? (
                      <p className="mt-1.5 line-clamp-2 rounded-md border border-emerald-400/35 bg-emerald-950/45 px-2 py-1 text-xs font-medium leading-snug text-emerald-100">
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
          <section className="flex h-full flex-col overflow-hidden rounded-xl border border-amber-500/28 bg-[linear-gradient(180deg,rgba(245,158,11,0.11)_0%,rgba(17,24,39,0.96)_32%)] shadow-[0_8px_28px_rgba(245,158,11,0.07)]">
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
                    <div className="min-w-0 flex-1 whitespace-normal break-words text-sm font-semibold leading-snug text-white">
                      {trial ? <TrialReadSensitive className="w-full">{ex.title}</TrialReadSensitive> : ex.title}
                    </div>
                  </div>
                  <TopicStructureDetails
                    className="mt-2 pl-7"
                    summaryClassName="cursor-pointer select-none text-[11px] font-bold text-amber-200/95 [-webkit-tap-highlight-color:transparent] list-none [&::-webkit-details-marker]:hidden"
                    summary={
                      <span className="rounded-md border border-amber-500/25 bg-amber-950/30 px-2 py-1 text-amber-100/95">
                        完整结构文案
                        <span className="ml-1 font-normal text-white/45">（点击可收起 / 展开）</span>
                      </span>
                    }
                  >
                    <p className="mt-2 whitespace-pre-wrap break-words border-l-2 border-amber-400/35 pl-2 text-[13px] leading-relaxed text-gray-200">
                      {trial ? <TrialReadSensitive className="w-full">{ex.structure}</TrialReadSensitive> : ex.structure}
                    </p>
                  </TopicStructureDetails>
                  <div className="mt-2 flex flex-wrap gap-1 pl-7">
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-400/30 bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-50">
                      <Zap size={10} className="shrink-0 text-amber-300" aria-hidden />
                      封面 {ex.predictedCtr}%
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-50">
                      <RefreshCcw size={10} className="shrink-0 text-sky-300" aria-hidden />
                      转化 {ex.predictedConversion}%
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-400/30 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-50">
                      <Target size={10} className="shrink-0 text-emerald-300" aria-hidden />
                      契合 {ex.brandMatchFit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="lg:col-span-3">
          <section className="flex h-full flex-col overflow-hidden rounded-xl border border-rose-500/28 bg-[linear-gradient(180deg,rgba(244,63,94,0.1)_0%,rgba(17,24,39,0.96)_30%)] shadow-[0_8px_28px_rgba(244,63,94,0.08)]">
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
                <div className="w-[4.5rem] shrink-0 text-center">
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
              {data.executionSuggestions.personalization.map((item) => (
                <div
                  key={item.topicDirection}
                  className="rounded-lg border border-rose-500/15 bg-[linear-gradient(90deg,rgba(244,63,94,0.06),transparent)] py-2 pl-2 pr-1 text-sm last:mb-0"
                >
                  <div className="whitespace-normal break-words font-medium leading-snug text-gray-100 [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden">
                    {trial ? (
                      <TrialReadSensitive className="w-full">{item.topicDirection}</TrialReadSensitive>
                    ) : (
                      item.topicDirection
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-amber-400/25 bg-amber-500/15 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-amber-100">
                        <Zap size={10} className="text-amber-300" aria-hidden />
                        {item.brandMatchScore}
                      </span>
                      <div className="h-2 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-gray-800/90 ring-1 ring-rose-500/20">
                        <div
                          className={`h-full ${
                            item.brandMatchScore > 90
                              ? "bg-emerald-400"
                              : item.brandMatchScore > 70
                                ? "bg-sky-400"
                                : "bg-orange-400"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, item.brandMatchScore))}%` }}
                        />
                      </div>
                    </div>
                    <div className="inline-flex shrink-0 items-center gap-0.5 text-right font-mono text-xs font-semibold text-emerald-100/95 tabular-nums">
                      <TrendingUp size={12} className="text-emerald-400/80" aria-hidden />
                      {formatInt(item.viewsPredicted)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="m-3 mt-2 rounded-lg border-l-4 border-amber-400/70 bg-gradient-to-r from-amber-950/55 to-amber-950/25 px-2.5 py-2 text-[11px] leading-relaxed text-amber-50/95 shadow-inner">
              <span className="inline-flex items-center gap-1 font-semibold text-amber-200">
                <Sparkles size={12} aria-hidden />
                参照说明：
              </span>
              {trial ? (
                <TrialReadSensitive className="mt-1 block w-full">
                  <span className="text-[11px] leading-relaxed text-amber-50/95">
                    契合度 0–100 以「内容蓝图全文」对「IP／品牌基因关键词」的覆盖与加权命中计算（引擎{" "}
                    <code className="rounded bg-black/35 px-1 text-[10px] text-amber-200/90">calculateIPFit</code>
                    ）；数值越高表示选题用语与您人设越一致。非平台官方指标，仅供内部决策参考。
                  </span>
                </TrialReadSensitive>
              ) : (
                <>
                  契合度 0–100 以「内容蓝图全文」对「IP／品牌基因关键词」的覆盖与加权命中计算（引擎{" "}
                  <code className="rounded bg-black/35 px-1 text-[10px] text-amber-200/90">calculateIPFit</code>
                  ）；数值越高表示选题用语与您人设越一致。非平台官方指标，仅供内部决策参考。
                </>
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
