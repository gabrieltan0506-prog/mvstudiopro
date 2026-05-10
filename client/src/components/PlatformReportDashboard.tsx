/**
 * B 端智库「爆款决策与增长管线」仪表盘 — 供阅读模式或 Puppeteer 截 PDF。
 * 横向宽幅排布，避免区块内上下滚动；指标为决策辅助口径，参考历史数据与当前窗口样本。
 */

import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import { DEMO_ADVANCED_AI_REPORT_DATA } from "@shared/advancedAIReportDemoData";
import { sanitizeDecisionIntelMetricsText } from "@shared/decisionIntelSanitize";
import { fallbackPlatformHitPotentialRadar } from "@shared/advancedPredictionEngine";
import { BarChart3, RefreshCcw, Target, Zap } from "lucide-react";
import type { ReactElement } from "react";
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
}

function formatInt(n: number): string {
  return n.toLocaleString("zh-CN");
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
}: PlatformReportDashboardProps): ReactElement {
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
      className={`box-border w-[min(1680px,100vw)] max-w-[1680px] shrink-0 overflow-hidden border border-gray-800 bg-[#0B0F19] px-5 pb-5 pt-5 text-[15px] leading-relaxed font-sans text-white md:w-[1680px] ${className}`.trim()}
    >
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3 border-b border-gray-800 pb-4">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-wide md:text-3xl">
          <span className="text-purple-400">M</span>
          <span>MV Studio Pro AI 决策智库报告</span>
          <span className="text-sm font-normal text-gray-300 md:text-base">（{data.topic}）</span>
        </h1>
        <div
          className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-1.5 text-sm font-semibold tabular-nums text-amber-100 shadow-[0_0_24px_rgba(245,158,11,0.12)] md:text-base"
          title="分析窗口"
        >
          {data.dateRange}
        </div>
      </header>

      {/* 横向第一带：全局 / 平台雷达 / 战略对照 */}
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="flex flex-col rounded-lg border border-gray-800/50 bg-[#131B2B] p-3.5">
          <h2 className="mb-1.5 text-base font-semibold text-gray-100">全局 AI 决策面板</h2>
          <div className="flex min-h-0 flex-1 flex-row gap-2">
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
            <div className="flex w-[42%] min-w-[8rem] flex-col justify-center gap-2.5 border-l border-gray-800/60 pl-3">
              <div className="rounded-md border border-emerald-500/20 bg-emerald-500/5 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                  <BarChart3 size={14} className="text-emerald-400" />
                  总播放量预测
                </div>
                <div className="mt-0.5 text-2xl font-bold leading-tight text-emerald-100 tabular-nums md:text-3xl">
                  {formatInt(g.totalViewsPredicted)}
                </div>
              </div>
              <div className="rounded-md border border-sky-500/20 bg-sky-500/5 px-2 py-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-gray-300">
                  <RefreshCcw size={14} className="text-sky-400" />
                  平均转化率
                </div>
                <div className="mt-0.5 text-xl font-bold text-sky-100 tabular-nums md:text-2xl">
                  {g.averageConversionRate.toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-800/50 bg-[#131B2B] p-3.5">
          <h2 className="mb-0.5 text-base font-semibold text-gray-100">平台雷达图谱</h2>
          <p className="mb-1.5 text-[11px] leading-snug text-gray-500">
            主战场切片视角（依自动匹配平台轮廓演算）· 与左栏<strong className="font-semibold text-gray-400">全局</strong>
            五维不同源，非缩放复制
          </p>
          <div className="flex min-h-[184px] flex-row gap-2" style={{ minHeight: chartH }}>
            <div className="min-h-[184px] min-w-0 flex-[1.1] rounded-md border border-gray-800/40 bg-[#0B0F19]/60 p-1">
              <ResponsiveContainer width="100%" height="100%" minHeight={chartH}>
                <RadarChart cx="50%" cy="50%" outerRadius="76%" data={subRadar}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: "#D1D5DB", fontSize: 11 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="子盘" dataKey="A" stroke="#38BDF8" fill="#38BDF8" fillOpacity={0.22} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex min-w-[8.5rem] flex-[0.85] flex-col justify-center rounded-md border border-cyan-500/25 bg-[linear-gradient(145deg,rgba(56,189,248,0.08),rgba(15,23,42,0.92))] p-2.5 text-xs leading-relaxed text-gray-300">
              <p className="text-sm font-bold text-cyan-100">
                主战场自动匹配
                {matchedLabel ? (
                  <span className="ml-1 rounded bg-cyan-400/20 px-1.5 py-0.5 text-xs font-extrabold text-cyan-50">
                    {matchedLabel}
                  </span>
                ) : null}
              </p>
              <p className="mt-1.5 line-clamp-6 text-[13px] text-gray-200">{platformAside}</p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-800/50 bg-[#131B2B] p-3.5">
          <h2 className="mb-1.5 text-base font-semibold text-gray-100">战略升级 · 多版本对照</h2>
          <p className="mb-2 line-clamp-2 rounded-md border border-violet-500/20 bg-violet-500/5 px-2 py-1.5 text-xs leading-snug text-violet-100/95">
            动态测试对照叙事主线；「利用」加量验证成熟句型，「探索」保留新组合试错。
          </p>
          <div className="grid grid-cols-2 gap-2">
            {data.executionSuggestions.mabVariants.map((variant, idx) => (
              <div key={variant.id} className="relative rounded-md border border-gray-700 bg-[#0B0F19] px-2.5 pb-2.5 pt-3.5">
                <div
                  className={`absolute left-2 top-1 rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                    variant.type === "utilize"
                      ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                      : "border-blue-500/30 bg-blue-500/20 text-blue-400"
                  }`}
                >
                  {mabBadgeLabel(variant.type)}
                </div>
                <div className="mt-3 text-center">
                  <span className="mr-1 text-xs font-bold text-gray-400">版本{idx + 1}</span>
                  <span className="text-sm font-bold leading-snug text-white">{variant.title}</span>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-1">
                  <span className="rounded-md bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-200">
                    播放 {formatInt(variant.viewsPredicted)}
                  </span>
                  <span className="rounded-md bg-gray-800 px-2 py-0.5 text-[10px] font-medium text-gray-200">
                    转化 {variant.conversionRatePredicted.toFixed(1)}%
                  </span>
                  {variant.ucbScore != null ? (
                    <span className="rounded-md bg-gray-800/80 px-2 py-0.5 text-[10px] text-gray-400">
                      加权 {variant.ucbScore}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 横向第二带：洞察 + 选题实例 + IP */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-stretch">
        <div className="lg:col-span-5">
          <section className="grid h-full grid-cols-2 gap-2.5 rounded-lg border border-gray-800/50 bg-[#131B2B]/80 p-3">
            {data.coreInsights.map((ins) => (
              <article key={ins.id} className="rounded-md border border-gray-800/40 bg-[#131B2B] p-2.5">
                <h3 className="mb-1 text-sm font-semibold text-gray-200">{ins.title}</h3>
                <p className="line-clamp-4 text-xs leading-relaxed text-gray-300">{ins.content}</p>
                {ins.metricsText ? (
                  <p className="mt-1.5 line-clamp-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-xs font-medium leading-snug text-emerald-200">
                    {sanitizeDecisionIntelMetricsText(ins.metricsText)}
                  </p>
                ) : null}
              </article>
            ))}
          </section>
        </div>

        <div className="lg:col-span-4">
          <section className="h-full rounded-lg border border-gray-800/50 bg-[#131B2B] p-3">
            <h2 className="mb-2 text-sm font-semibold text-gray-200">选题结构实例</h2>
            <div className="grid grid-cols-2 gap-2">
              {data.topicStructureExamples.map((ex) => (
                <div
                  key={ex.title}
                  className="rounded-md border border-gray-800/40 bg-[#0B0F19]/80 p-2 text-left"
                >
                  <div className="line-clamp-2 text-sm font-semibold leading-snug text-white">{ex.title}</div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-gray-400">{ex.structure}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-100">
                      <Zap size={10} className="shrink-0" />
                      封面 {ex.predictedCtr}%
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-100">
                      转化 {ex.predictedConversion}%
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-100">
                      契合 {ex.brandMatchFit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="lg:col-span-3">
          <section className="flex h-full flex-col rounded-lg border border-gray-800/50 bg-[#131B2B] p-3">
            <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-100">
              <Target size={16} className="text-red-400" />
              IP 契合与推荐
            </h2>
            <div className="min-h-0 flex-1 space-y-1">
              <div className="flex border-b border-gray-800 pb-1.5 text-xs font-medium text-gray-400">
                <div className="min-w-0 flex-[1.1] pr-1">选题方向</div>
                <div className="w-[4.5rem] shrink-0 text-center">契合度</div>
                <div className="w-[5.5rem] shrink-0 text-right">预估播放量</div>
              </div>
              {data.executionSuggestions.personalization.map((item) => (
                <div
                  key={item.topicDirection}
                  className="border-b border-gray-800/40 py-2 text-sm last:border-b-0"
                >
                  <div className="whitespace-normal break-words font-medium leading-snug text-gray-100 [display:-webkit-box] [-webkit-line-clamp:3] [-webkit-box-orient:vertical] overflow-hidden">
                    {item.topicDirection}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
                    <div className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-amber-100">
                        {item.brandMatchScore}
                      </span>
                      <div className="h-1.5 min-w-[3rem] flex-1 overflow-hidden rounded-full bg-gray-800">
                        <div
                          className={`h-full ${
                            item.brandMatchScore > 90
                              ? "bg-emerald-500"
                              : item.brandMatchScore > 70
                                ? "bg-blue-500"
                                : "bg-orange-500"
                          }`}
                          style={{ width: `${Math.min(100, Math.max(0, item.brandMatchScore))}%` }}
                        />
                      </div>
                    </div>
                    <div className="shrink-0 text-right font-mono text-xs font-semibold text-gray-100 tabular-nums">
                      {formatInt(item.viewsPredicted)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-3 rounded-md border-l-4 border-amber-500/60 bg-amber-950/35 px-2.5 py-2 text-[11px] leading-relaxed text-amber-50/95">
              <span className="font-semibold text-amber-200">参照说明：</span>
              契合度 0–100 以「内容蓝图全文」对「IP／品牌基因关键词」的覆盖与加权命中计算（引擎{" "}
              <code className="rounded bg-black/30 px-1 text-[10px] text-amber-200/90">calculateIPFit</code>
              ）；数值越高表示选题用语与您人设越一致。非平台官方指标，仅供内部决策参考。
            </p>
          </section>
        </div>
      </div>

      <p className="mt-4 rounded-lg border border-gray-700/80 bg-gray-900/40 px-3 py-2 text-center text-xs leading-relaxed text-gray-400">
        B 端智库专用视图 · 数值参考历史数据与内部模型演算 ·{" "}
        <span className="font-semibold text-gray-300">不宜直接作为对一般用户的承诺指标</span>
      </p>
    </div>
  );
}

export default PlatformReportDashboard;
