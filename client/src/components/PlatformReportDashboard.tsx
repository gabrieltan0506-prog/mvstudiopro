/**
 * B 端智庫「爆款決策與增長管線」儀表板 — 供閱讀模式或 Puppeteer 截 PDF。
 * 指標為決策輔助／模擬用，請勿與一般用戶端「不暴露 CTR/MAB」產品面混淆路由。
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
  /** 外層可套 min-h / print 樣式 */
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

  return (
    <div
      className={`box-border w-[1280px] min-h-[720px] overflow-hidden border border-gray-800 bg-[#0B0F19] p-6 font-sans text-white ${className}`.trim()}
    >
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-gray-800 pb-4">
        <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-wide">
          <span className="text-purple-500">M</span>
          <span>MV Studio Pro AI 決策智庫報告</span>
          <span className="text-sm font-normal text-gray-400">（{data.topic}）</span>
        </h1>
        <div className="text-sm text-gray-400">{data.dateRange}</div>
      </header>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-12 flex flex-col gap-6 lg:col-span-5">
          <section className="flex flex-1 flex-col rounded-lg border border-gray-800/50 bg-[#131B2B] p-5">
            <h2 className="mb-2 text-lg font-semibold">全局 AI 決策面板</h2>
            <div className="flex min-h-[12rem] flex-col gap-4 sm:flex-row">
              <div className="h-48 w-full sm:w-1/2">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                    <PolarGrid stroke="#374151" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#9CA3AF", fontSize: 10 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar name="潛力" dataKey="A" stroke="#10B981" fill="#10B981" fillOpacity={0.2} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex w-full flex-col justify-center gap-4 sm:w-1/2 sm:pl-4">
                <div>
                  <div className="flex items-center gap-1 text-sm text-gray-400">
                    <BarChart3 size={14} className="text-emerald-400" />
                    全局總播放量預測
                  </div>
                  <div className="mt-1 text-3xl font-bold text-white">{formatInt(g.totalViewsPredicted)}</div>
                </div>
                <div>
                  <div className="flex items-center gap-1 text-sm text-gray-400">
                    <RefreshCcw size={14} className="text-blue-400" />
                    平均轉化率
                  </div>
                  <div className="mt-1 text-2xl font-bold text-white">{g.averageConversionRate.toFixed(1)}%</div>
                </div>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {data.coreInsights.map((ins) => (
              <article key={ins.id} className="rounded-lg border border-gray-800/50 bg-[#131B2B] p-4">
                <h3 className="mb-2 text-sm font-semibold text-gray-300">{ins.title}</h3>
                <p className="text-xs leading-relaxed text-gray-400">{ins.content}</p>
                {ins.metricsText ? (
                  <p className="mt-2 text-[11px] leading-snug text-emerald-400/90">{ins.metricsText}</p>
                ) : null}
              </article>
            ))}
          </section>

          <section className="rounded-lg border border-gray-800/50 bg-[#131B2B] p-4">
            <h2 className="mb-3 text-sm font-semibold text-gray-200">選題結構實例</h2>
            <div className="space-y-3">
              {data.topicStructureExamples.map((ex) => (
                <div
                  key={ex.title}
                  className="rounded-lg border border-gray-800/40 bg-[#0B0F19]/80 p-3 text-left"
                >
                  <div className="text-sm font-semibold text-white">{ex.title}</div>
                  <p className="mt-1 text-[11px] leading-relaxed text-gray-500">{ex.structure}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-200/95">
                      <Zap size={10} className="shrink-0" />
                      預期 CTR {ex.predictedCtr}%
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-medium text-sky-200/95">
                      <RefreshCcw size={10} className="shrink-0" />
                      轉化 {ex.predictedConversion}%
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200/95">
                      <Target size={10} className="shrink-0" />
                      品牌契合 {ex.brandMatchFit}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="col-span-12 flex flex-col gap-6 lg:col-span-7">
          <section className="rounded-lg border border-gray-800/50 bg-[#131B2B] p-5">
            <h2 className="mb-4 text-lg font-semibold">執行建議：AI 動態賽馬（UCB1）</h2>
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {data.executionSuggestions.mabVariants.map((variant, idx) => (
                <div
                  key={variant.id}
                  className="relative rounded-lg border border-gray-700 bg-[#0B0F19] p-4"
                >
                  <div
                    className={`absolute -top-3 left-4 rounded-full border px-3 py-1 text-xs font-bold ${
                      variant.type === "utilize"
                        ? "border-emerald-500/30 bg-emerald-500/20 text-emerald-400"
                        : "border-blue-500/30 bg-blue-500/20 text-blue-400"
                    }`}
                  >
                    {mabBadgeLabel(variant.type)}
                  </div>
                  <div className="mb-2 mt-3 text-center">
                    <span className="mr-2 text-sm font-bold text-gray-500">V{idx + 1}</span>
                    <span className="font-bold text-white">{variant.title}</span>
                  </div>
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-[10px]">
                      <BarChart3 size={10} className="text-emerald-400" />
                      預測播放量 {formatInt(variant.viewsPredicted)}
                    </span>
                    <span className="inline-flex items-center gap-1 rounded bg-gray-800 px-2 py-1 text-[10px]">
                      <RefreshCcw size={10} className="text-blue-400" />
                      轉化率 {variant.conversionRatePredicted.toFixed(1)}%
                    </span>
                    {variant.ucbScore != null ? (
                      <span className="inline-flex items-center gap-1 rounded bg-gray-800/80 px-2 py-1 text-[10px] text-gray-400">
                        UCB {variant.ucbScore}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-1 flex-col rounded-lg border border-gray-800/50 bg-[#131B2B] p-5">
            <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
              <Target size={18} className="text-red-400" />
              IP 契合度 & 個性化推薦
            </h2>
            <div className="space-y-4">
              <div className="flex border-b border-gray-800 pb-2 text-xs text-gray-500">
                <div className="w-1/2">選題方向</div>
                <div className="w-1/4 text-center">品牌契合度</div>
                <div className="w-1/4 text-right">播放量預測</div>
              </div>
              {data.executionSuggestions.personalization.map((item) => (
                <div key={item.topicDirection} className="flex items-center text-sm">
                  <div className="w-1/2 font-medium text-gray-300">{item.topicDirection}</div>
                  <div className="flex w-1/4 justify-center">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-gray-800">
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
                  <div className="w-1/4 text-right font-mono text-gray-400">{formatInt(item.viewsPredicted)}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-lg border border-gray-800/50 bg-[#131B2B] p-5">
            <h2 className="mb-3 text-lg font-semibold">平台詳細數據</h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="h-40 rounded-md border border-gray-800/40 bg-[#0B0F19]/60 p-2">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="65%" data={subRadar}>
                    <PolarGrid stroke="#374151" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#6B7280", fontSize: 9 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Radar name="子盤" dataKey="A" stroke="#38BDF8" fill="#38BDF8" fillOpacity={0.18} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-col justify-center rounded-md border border-gray-800/40 bg-[#0B0F19]/60 p-4 text-xs text-gray-400">
                <p className="font-semibold text-gray-300">熱榜 + 品牌契合</p>
                <p className="mt-2 leading-relaxed">
                  {typeof data.platformDetailedData.summary === "string"
                    ? data.platformDetailedData.summary
                    : "此區可掛載多平台熱榜與帳號基因匹配摘要。"}
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <p className="mt-6 text-center text-[10px] text-gray-600">
        B 端智庫專用視圖 · 數值為模型模擬或內部演算結果 · 不宜直接作為對一般用戶的承諾指標
      </p>
    </div>
  );
}

export default PlatformReportDashboard;
