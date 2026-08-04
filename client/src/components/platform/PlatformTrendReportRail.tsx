import React from "react";
import { Download, RefreshCw } from "lucide-react";
import type { VisualReportData } from "@/components/VisualReportTemplate";

type Props = {
  data: VisualReportData;
  onScrollToFull: () => void;
  onDownload: () => void;
  onRerun: () => void;
  downloading?: boolean;
};

const BAR_COLORS = ["#0ea5b7", "#db2777", "#ca8a04", "#7c3aed", "#059669", "#2563eb"];

/**
 * 趋势模式右侧浅色报表卡（对齐参考图右侧「平台热门赛道 / 蓝海词」栏）。
 * 完整长图仍在主栏 VisualReportTemplate。
 */
export function PlatformTrendReportRail({
  data,
  onScrollToFull,
  onDownload,
  onRerun,
  downloading,
}: Props) {
  const pl = data.platformDetails?.[0];
  const topics = (pl?.hotTopics || []).map(String).filter(Boolean).slice(0, 6);
  const blue = (pl?.blueOceanWords || data.globalBlueOceanWords || []).slice(0, 4);

  return (
    <aside className="sticky top-4 z-20 overflow-hidden rounded-2xl border border-[#d6c4b4] bg-[linear-gradient(180deg,#f4f1ec_0%,#ebe4dc_100%)] text-[#3f342c] shadow-[0_12px_40px_rgba(0,0,0,0.22)]">
      <div className="flex items-center justify-between gap-2 border-b border-[#d6c4b4]/80 bg-[#e8f4fb] px-3 py-2.5">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-black text-[#1f4e79]">
            {pl?.displayName || "趋势报表"}
          </div>
          <div className="truncate text-[10px] text-[#5b6b7a]">{data.dateRange}</div>
        </div>
        <button
          type="button"
          onClick={onRerun}
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-[#7eb8e0] bg-white px-2.5 py-1 text-[10px] font-semibold text-[#1f6fad] hover:bg-[#f0f8ff]"
        >
          <RefreshCw className="h-3 w-3" />
          更新分析
        </button>
      </div>

      <div className="space-y-3 px-3 py-3">
        <div>
          <div className="mb-1.5 text-[11px] font-bold text-[#1f4e79]">话题趋势</div>
          <p className="line-clamp-4 text-[10px] leading-relaxed text-[#5a4f45]">
            {typeof data.insightSummary?.[0] === "string"
              ? data.insightSummary[0]
              : data.insightSummary?.[0]?.description ||
                data.insightSummary?.[0]?.title ||
                data.reportTitle}
          </p>
        </div>

        {topics.length ? (
          <div>
            <div className="mb-1.5 text-[11px] font-bold text-[#1f4e79]">热门搜索榜</div>
            <div className="space-y-1.5">
              {topics.map((topic, i) => {
                const pct = Math.max(92 - i * 12, 28);
                const color = BAR_COLORS[i % BAR_COLORS.length]!;
                return (
                  <div key={`${topic}-${i}`}>
                    <div className="mb-0.5 truncate text-[10px] font-semibold text-[#3f342c]">
                      {topic}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[#ddd4cb]">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${pct}%`, background: color }}
                        />
                      </div>
                      <span className="w-5 text-right text-[9px] font-bold tabular-nums" style={{ color }}>
                        #{i + 1}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {blue.length ? (
          <div>
            <div className="mb-1.5 text-[11px] font-bold text-[#1f4e79]">蓝海词</div>
            <div className="flex flex-wrap gap-1">
              {blue.flatMap((b, i) => {
                const tags = [b.primary, ...(b.secondary || []).slice(0, 2)].filter(Boolean);
                return tags.map((t, j) => (
                  <span
                    key={`${t}-${i}-${j}`}
                    className="rounded-full border border-[#c9b8a8] bg-white px-2 py-0.5 text-[9px] font-semibold text-[#5a4f45]"
                  >
                    {t}
                  </span>
                ));
              })}
            </div>
          </div>
        ) : null}

        <div className="flex flex-col gap-1.5 pt-1">
          <button
            type="button"
            onClick={onScrollToFull}
            className="w-full rounded-full border border-[#1f6fad]/35 bg-[#1f6fad] px-3 py-2 text-[11px] font-bold text-white hover:brightness-110"
          >
            查看完整浅色报表
          </button>
          <button
            type="button"
            onClick={onDownload}
            disabled={downloading}
            className="inline-flex w-full items-center justify-center gap-1.5 rounded-full border border-[#c9b8a8] bg-white px-3 py-2 text-[11px] font-semibold text-[#3f342c] hover:bg-[#f7f3ee] disabled:opacity-60"
          >
            <Download className="h-3.5 w-3.5" />
            {downloading ? "导出中…" : "下载 PNG"}
          </button>
        </div>
      </div>
    </aside>
  );
}
