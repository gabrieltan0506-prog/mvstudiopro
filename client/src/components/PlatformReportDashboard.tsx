/**
 * B 端智庫「爆款決策與增長管線」儀表板 — 供閱讀模式或 Puppeteer 截 PDF。
 * 橫向寬幅排布，避免區塊內上下捲動；指標為決策輔助／模擬用。
 */

import type { AdvancedAIReportData } from "@shared/advancedAIReport";
import { DEMO_ADVANCED_AI_REPORT_DATA } from "@shared/advancedAIReportDemoData";
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
    { subject: "預期播放量", A: r.views, fullMark: 100 },
    { subject: "轉化率", A: r.conversion, fullMark: 100 },
    { subject: "品牌契合度", A: r.brandFit, fullMark: 100 },
    { subject: "平台爆款潛力", A: r.platformPotential, fullMark: 100 },
    { subject: "賽馬效能", A: r.mabEfficiency, fullMark: 100 },
  ];
}

export function PlatformReportDashboard({
  data = DEMO_ADVANCED_AI_REPORT_DATA,
  className = "",
}: PlatformReportDashboardProps): ReactElement {
  const g = data.globalPredictions;
  const radarData = buildRadarRows(g.hitPotentialRadar);
  const subRadar = buildRadarRows({
    views: Math.round(g.hitPotentialRadar.views * 0.88),
    conversion: Math.round(g.hitPotentialRadar.conversion * 0.92),
    brandFit: Math.round(g.hitPotentialRadar.brandFit * 0.9),
    platformPotential: Math.round(g.hitPotentialRadar.platformPotential * 0.91),
    mabEfficiency: Math.round(g.hitPotentialRadar.mabEfficiency * 0.87),
  });

  const chartH = 168;

  return (
    <div
      className={`box-border w-[min(1680px,100vw)] max-w-[1680px] shrink-0 overflow-hidden border border-gray-800 bg-[#0B0F19] px-5 pb-4 pt-4 font-sans text-white md:w-[1680px] ${className}`.trim()}
    >
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2 border-b border-gray-800 pb-3">
        <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-wide md:text-2xl">
          <span className="text-purple-500">M</span>
          <span>MV Studio Pro AI 決策智庫報告</span>
          <span className="text-xs font-normal text-gray-400 md:text-sm">（{data.topic}）</span>
        </h1>
        <div className="text-xs text-gray-400 md:text-sm">{data.dateRange}</div>
      </header>

      {/* 橫向第一帶：全局 / 平台雷達 / 戰略對照 */}
      <div className="mb-3 grid grid-cols-1 gap-3 lg:grid-cols-3">
        <section className="flex flex-col rounded-lg border border-gray-800/50 bg-[#131B2B] p-3">
          <h2 className="mb-1 text-sm font-semibold text-gray-100">全局 AI 決策面板</h2>
          <div className="flex min-h-0 flex-1 flex-row gap-2">
            <div className="min-h-[168px] min-w-0 flex-1" style={{ height: chartH }}>
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="72%" data={radarData}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: "#9CA3AF", fontSize: 9 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="潛力" dataKey="A" stroke="#10B981" fill="#10B981" fillOpacity={0.2} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex w-[42%] min-w-[7.5rem] flex-col justify-center gap-2 border-l border-gray-800/60 pl-2">
              <div>
                <div className="flex items-center gap-1 text-[10px] text-gray-400">
                  <BarChart3 size={12} className="text-emerald-400" />
                  總播放量預測
                </div>
                <div className="text-xl font-bold leading-tight text-white md:text-2xl">
                  {formatInt(g.totalViewsPredicted)}
                </div>
              </div>
              <div>
                <div className="flex items-center gap-1 text-[10px] text-gray-400">
                  <RefreshCcw size={12} className="text-blue-400" />
                  平均轉化率
                </div>
                <div className="text-lg font-bold text-white md:text-xl">{g.averageConversionRate.toFixed(1)}%</div>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-800/50 bg-[#131B2B] p-3">
          <h2 className="mb-1 text-sm font-semibold text-gray-100">平台雷達圖譜</h2>
          <div className="flex min-h-[168px] flex-row gap-2" style={{ minHeight: chartH }}>
            <div className="min-h-[168px] min-w-0 flex-[1.1] rounded-md border border-gray-800/40 bg-[#0B0F19]/60 p-1">
              <ResponsiveContainer width="100%" height="100%" minHeight={chartH}>
                <RadarChart cx="50%" cy="50%" outerRadius="76%" data={subRadar}>
                  <PolarGrid stroke="#374151" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: "#9CA3AF", fontSize: 9 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                  <Radar name="子盤" dataKey="A" stroke="#38BDF8" fill="#38BDF8" fillOpacity={0.22} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex min-w-[7rem] flex-[0.85] flex-col justify-center rounded-md border border-gray-800/40 bg-[#0B0F19]/60 p-2 text-[10px] leading-snug text-gray-400">
              <p className="font-semibold text-gray-200">熱榜 + 品牌契合</p>
              <p className="mt-1 line-clamp-6">
                {typeof data.platformDetailedData.summary === "string"
                  ? data.platformDetailedData.summary
                  : "此區可掛載多平台熱榜與帳號基因匹配摘要。"}
              </p>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-gray-800/50 bg-[#131B2B] p-3">
          <h2 className="mb-1 text-sm font-semibold text-gray-100">戰略升級 · 多版本對照</h2>
          <p className="mb-2 line-clamp-2 text-[10px] leading-snug text-gray-500">
            動態測試對照敘事主線；「利用」加量驗證成熟句型，「探索」保留新組合試錯。
          </p>
          <div className="grid grid-cols-2 gap-2">
            {data.executionSuggestions.mabVariants.map((variant, idx) => (
              <div key={variant.id} className="relative rounded-md border border-gray-700 bg-[#0B0F19] px-2 pb-2 pt-3">
                <div
                  className={`absolute left-2 top-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${
                    variant.type === "utilize"
                      ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                      : "border-blue-500/30 bg-blue-500/20 text-blue-400"
                  }`}
                >
                  {mabBadgeLabel(variant.type)}
                </div>
                <div className="mt-3 text-center">
                  <span className="mr-1 text-[10px] font-bold text-gray-500">版本{idx + 1}</span>
                  <span className="text-[11px] font-bold leading-tight text-white">{variant.title}</span>
                </div>
                <div className="mt-1.5 flex flex-wrap justify-center gap-1">
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[9px]">
                    播放 {formatInt(variant.viewsPredicted)}
                  </span>
                  <span className="rounded bg-gray-800 px-1.5 py-0.5 text-[9px]">
                    轉化 {variant.conversionRatePredicted.toFixed(1)}%
                  </span>
                  {variant.ucbScore != null ? (
                    <span className="rounded bg-gray-800/80 px-1.5 py-0.5 text-[9px] text-gray-400">
                      加權 {variant.ucbScore}
                    </span>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* 橫向第二帶：洞察 + 選題實例 + IP */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-12 lg:items-stretch">
        <div className="lg:col-span-5">
          <section className="grid h-full grid-cols-2 gap-2 rounded-lg border border-gray-800/50 bg-[#131B2B]/80 p-2.5">
            {data.coreInsights.map((ins) => (
              <article key={ins.id} className="rounded-md border border-gray-800/40 bg-[#131B2B] p-2">
                <h3 className="mb-0.5 text-[11px] font-semibold text-gray-300">{ins.title}</h3>
                <p className="line-clamp-4 text-[10px] leading-snug text-gray-400">{ins.content}</p>
                {ins.metricsText ? (
                  <p className="mt-1 line-clamp-2 text-[9px] leading-snug text-emerald-400/90">{ins.metricsText}</p>
                ) : null}
              </article>
            ))}
          </section>
        </div>

        <div className="lg:col-span-4">
          <section className="h-full rounded-lg border border-gray-800/50 bg-[#131B2B] p-2.5">
            <h2 className="mb-1.5 text-xs font-semibold text-gray-200">選題結構實例</h2>
            <div className="grid grid-cols-2 gap-1.5">
              {data.topicStructureExamples.map((ex) => (
                <div
                  key={ex.title}
                  className="rounded-md border border-gray-800/40 bg-[#0B0F19]/80 p-1.5 text-left"
                >
                  <div className="line-clamp-2 text-[11px] font-semibold leading-tight text-white">{ex.title}</div>
                  <p className="mt-0.5 line-clamp-2 text-[9px] leading-snug text-gray-500">{ex.structure}</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[8px] font-medium text-amber-200/95">
                      <Zap size={8} className="shrink-0" />
                      封面 {ex.predictedCtr}%
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-500/15 px-1.5 py-0.5 text-[8px] font-medium text-sky-200/95">
                      轉化 {ex.predictedConversion}%
                    </span>
                    <span className="inline-flex items-center gap-0.5 rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[8px] font-medium text-emerald-200/95">
                      契合 {ex.brandMatchFit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="lg:col-span-3">
          <section className="flex h-full flex-col rounded-lg border border-gray-800/50 bg-[#131B2B] p-2.5">
            <h2 className="mb-1 flex items-center gap-1.5 text-xs font-semibold">
              <Target size={14} className="text-red-400" />
              IP 契合與推薦
            </h2>
            <div className="min-h-0 flex-1 space-y-1">
              <div className="flex border-b border-gray-800 pb-1 text-[9px] text-gray-500">
                <div className="w-[46%]">選題方向</div>
                <div className="w-[27%] text-center">契合</div>
                <div className="w-[27%] text-right">播放</div>
              </div>
              {data.executionSuggestions.personalization.map((item) => (
                <div key={item.topicDirection} className="flex items-center py-0.5 text-[11px]">
                  <div className="w-[46%] truncate pr-1 font-medium text-gray-300" title={item.topicDirection}>
                    {item.topicDirection}
                  </div>
                  <div className="flex w-[27%] justify-center">
                    <div className="h-1 w-14 overflow-hidden rounded-full bg-gray-800">
                      <div
                        className={`h-full ${
                          item.brandMatchScore > 90
                            ? "bg-emerald-500"
                            : item.brandMatchScore > 70
                              ? "bg-blue-500"
                              : "bg-orange-500"
                        }`}
                        style={{ width: `${item.brandMatchScore}%` }}
                      />
                    </div>
                  </div>
                  <div className="w-[27%] text-right font-mono text-[10px] text-gray-400">
                    {formatInt(item.viewsPredicted)}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <p className="mt-3 text-center text-[9px] text-gray-600">
        B 端智庫專用視圖 · 數值為模型模擬或內部演算結果 · 不宜直接作為對一般用戶的承諾指標
      </p>
    </div>
  );
}

export default PlatformReportDashboard;
