import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Film, Image as ImageIcon, Loader2, Sparkles } from "lucide-react";
import { GROWTH_ASSET_ANALYSIS_ANALYZE_MESSAGES, GROWTH_ASSET_ANALYSIS_STATUS_MESSAGES, type AssetAnalysisTrackProgress } from "@/lib/growthCampImagePipeline";
import AssetAnalysisRollingBlock from "@/components/platform/AssetAnalysisRollingBlock";
import type { GrowthAnalysisScores } from "@shared/growth";

export type AssetAnalysisPreviewItem = {
  id: string;
  previewUrl: string | null;
  fileName: string;
  kind: "image" | "video";
};

export type AssetAnalysisLivePartial = {
  id: string;
  title: string;
  badge?: string;
  status?: "pending" | "ready";
  contextHint?: string;
  stageLabel?: string;
  partialAnalysis?: Partial<GrowthAnalysisScores>;
  analysis?: GrowthAnalysisScores;
};

type AssetAnalysisWaitPanelProps = {
  percent: number;
  label: string;
  detail?: string;
  phase?: "upload" | "analyze";
  tracks?: AssetAnalysisTrackProgress[];
  assets: AssetAnalysisPreviewItem[];
  livePartials?: AssetAnalysisLivePartial[];
  mergePending?: boolean;
  revealingFull?: boolean;
};

export default function AssetAnalysisWaitPanel({
  percent,
  label,
  detail,
  phase = "analyze",
  tracks = [],
  assets,
  livePartials = [],
  mergePending = false,
  revealingFull = false,
}: AssetAnalysisWaitPanelProps) {
  const liveStreamRef = useRef<HTMLDivElement>(null);
  const prevPartialCountRef = useRef(0);
  const [assetIndex, setAssetIndex] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  const previewItems = useMemo(
    () => assets.filter((a) => a.previewUrl),
    [assets],
  );

  useEffect(() => {
    setAssetIndex(0);
    setMessageIndex(0);
  }, [assets.length, label]);

  useEffect(() => {
    if (previewItems.length <= 1) return;
    const id = window.setInterval(() => setAssetIndex((i) => (i + 1) % previewItems.length), 4500);
    return () => window.clearInterval(id);
  }, [previewItems.length]);

  const statusMessages =
    phase === "upload" ? GROWTH_ASSET_ANALYSIS_STATUS_MESSAGES : GROWTH_ASSET_ANALYSIS_ANALYZE_MESSAGES;

  useEffect(() => {
    const id = window.setInterval(
      () => setMessageIndex((i) => (i + 1) % statusMessages.length),
      5500,
    );
    return () => window.clearInterval(id);
  }, [statusMessages.length]);

  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  const activePreview = previewItems[assetIndex] ?? previewItems[0];
  const statusMessage = statusMessages[messageIndex] ?? statusMessages[0];
  const hasLivePartials = livePartials.length > 0;

  useEffect(() => {
    if (livePartials.length > prevPartialCountRef.current) {
      prevPartialCountRef.current = livePartials.length;
      liveStreamRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [livePartials.length]);

  const hasDualTracks = tracks.length >= 2;

  function TrackBar({ track }: { track: AssetAnalysisTrackProgress }) {
    const pct = Math.max(0, Math.min(100, Math.round(track.percent)));
    const isVideo = track.kind === "video";
    const statusLabel =
      track.done ? "已完成" : track.jobStatus === "queued" ? "排队中" : track.jobStatus === "running" ? "分析中" : "进行中";
    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span className="flex items-center gap-1.5 font-medium text-white/85">
            {isVideo ? <Film className="h-3.5 w-3.5 text-[#8cefff]" /> : <ImageIcon className="h-3.5 w-3.5 text-[#6ee7b7]" />}
            {isVideo ? "参考视频" : "封面 / 图片"}
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${track.done ? "bg-[#6ee7b7]/15 text-[#6ee7b7]" : "bg-white/8 text-[#c9c0e6]/70"}`}>
              {statusLabel}
            </span>
          </span>
          <span className="font-bold tabular-nums text-[#6ee7b7]">{pct}%</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/[0.08]">
          <div
            className={`h-full rounded-full transition-[width] duration-500 ease-out ${track.done ? "bg-[#6ee7b7]" : isVideo ? "bg-gradient-to-r from-[#49e6ff] to-[#8cefff]" : "bg-gradient-to-r from-[#34d399] to-[#6ee7b7]"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        {track.detail ? <p className="text-[10px] text-[#c9c0e6]/55 truncate">{track.detail}</p> : null}
      </div>
    );
  }

  return (
    <div className="mt-5 space-y-4">
      <div
        ref={liveStreamRef}
        className={`rounded-2xl border p-4 md:p-5 transition-colors ${
          hasLivePartials
            ? "border-[#49e6ff]/35 bg-[linear-gradient(180deg,rgba(73,230,255,0.12),rgba(52,211,153,0.06))] shadow-[0_0_40px_rgba(73,230,255,0.08)]"
            : "border-white/10 bg-black/20"
        }`}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Sparkles className={`h-4 w-4 ${hasLivePartials ? "text-[#49e6ff]" : "text-[#c9c0e6]/40"}`} />
          <div className="text-sm font-bold text-white">
            {hasLivePartials ? "实时结果 · 边分析边展示" : "实时结果区"}
          </div>
          {hasLivePartials ? (
            <span className="rounded-full border border-[#6ee7b7]/40 bg-[rgba(52,211,153,0.12)] px-2.5 py-0.5 text-[10px] font-semibold text-[#6ee7b7] animate-pulse">
              已出 {livePartials.length} 份
            </span>
          ) : (
            <span className="text-[11px] text-[#c9c0e6]/50">首个分镜完成后立即显示于此</span>
          )}
        </div>

        <AnimatePresence initial={false}>
          {hasLivePartials ? (
            <div className="space-y-4">
              {livePartials.map((partial) => (
                <motion.div
                  key={partial.id}
                  initial={{ opacity: 0, y: 16, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.45, ease: "easeOut" }}
                >
                  <AssetAnalysisRollingBlock
                    title={partial.title}
                    badge={partial.badge ?? (partial.status === "ready" ? "刚完成 · 可先阅读" : "分析中")}
                    partialAnalysis={
                      partial.status === "ready" && partial.analysis
                        ? partial.analysis
                        : partial.partialAnalysis
                    }
                    stageLabel={partial.stageLabel}
                    isComplete={partial.status === "ready"}
                    contextHint={partial.contextHint}
                  />
                </motion.div>
              ))}
            </div>
          ) : (
            <motion.div
              key="live-placeholder"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[#49e6ff]/20 bg-[rgba(73,230,255,0.04)] px-4 py-8 text-center"
            >
              <Loader2 className="h-6 w-6 animate-spin text-[#49e6ff]/60" />
              <p className="text-sm text-white/75">云端分析进行中…</p>
              <p className="max-w-md text-xs leading-relaxed text-[#c9c0e6]/55">
                封面 / 图片<strong className="text-[#8cefff]">传完立即开分析</strong>；解读会<strong className="text-[#6ee7b7]">逐段滚入</strong>上方实时区，无需等整份报告。
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {mergePending ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#49e6ff]/25 bg-[#49e6ff]/8 px-4 py-3 text-sm text-[#8cefff]">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            分段结果已就绪，正在汇总完整综合报告…
          </div>
        ) : revealingFull ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#6ee7b7]/25 bg-[rgba(52,211,153,0.08)] px-4 py-3 text-sm text-[#6ee7b7]">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            先行摘要已展示，正在展开完整报告…
          </div>
        ) : hasLivePartials ? (
          <div className="mt-4 flex items-center gap-2 rounded-xl border border-[#6ee7b7]/15 bg-[rgba(52,211,153,0.05)] px-4 py-3 text-sm text-[#6ee7b7]/85">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
            其余素材仍在分析，完整报告随后自动展开
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
      <div className="rounded-2xl border border-[#6ee7b7]/20 bg-[rgba(52,211,153,0.05)] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#6ee7b7]">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          素材视觉分析进行中
        </div>
        <p className="mt-2 text-sm leading-7 text-white/88">{label}</p>
        {detail ? <p className="mt-1 text-xs text-[#c9c0e6]/70">{detail}</p> : null}
        <p className="mt-3 text-xs leading-relaxed text-[#8cefff]/85">{statusMessage}</p>

        <div className="mt-5 space-y-4">
          {hasDualTracks ? (
            tracks.map((track) => <TrackBar key={track.kind} track={track} />)
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between text-[11px] text-[#c9c0e6]/70">
                <span>整体进度</span>
                <span className="font-bold tabular-nums text-[#6ee7b7]">{safePercent}%</span>
              </div>
              <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.08]" role="progressbar" aria-valuenow={safePercent} aria-valuemin={0} aria-valuemax={100}>
                <div
                  className="h-full rounded-full bg-gradient-to-r from-[#34d399] via-[#6ee7b7] to-[#49e6ff] transition-[width] duration-500 ease-out"
                  style={{ width: `${safePercent}%` }}
                />
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-[11px] leading-relaxed text-[#c9c0e6]/55">
          上方「实时结果区」会在每份素材分析完成时立即更新；完整报告在所有分段就绪后展开。
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-black/25 p-4 md:p-5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8cefff]/80">素材画面轮播</div>
          {previewItems.length > 1 ? (
            <span className="text-[10px] text-white/45">
              {assetIndex + 1}/{previewItems.length} · 每 4.5 秒切换
            </span>
          ) : null}
        </div>

        {activePreview?.previewUrl ? (
          <div className="relative overflow-hidden rounded-2xl border border-white/10 bg-black/40">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={`${activePreview.id}-${assetIndex}`}
                initial={{ opacity: 0, scale: 1.02 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.35 }}
                className="relative flex min-h-[200px] max-h-[320px] items-center justify-center p-2"
              >
                <img
                  src={activePreview.previewUrl}
                  alt={activePreview.fileName}
                  className="max-h-[300px] w-full object-contain"
                />
                {activePreview.kind === "video" ? (
                  <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                    <div className="rounded-full border border-[#8cefff]/30 bg-black/50 p-3">
                      <Film className="h-8 w-8 text-[#8cefff]/80" />
                    </div>
                  </div>
                ) : null}
              </motion.div>
            </AnimatePresence>
            <div className="border-t border-white/8 px-3 py-2">
              <div className="truncate text-xs font-medium text-white/85">{activePreview.fileName}</div>
              <div className="text-[10px] text-[#c9c0e6]/55">
                {activePreview.kind === "video" ? "参考视频 · 封面帧" : "图片素材"}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex min-h-[200px] flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-black/20 px-4 py-10 text-[#c9c0e6]/45">
            <ImageIcon className="h-8 w-8 opacity-40" />
            <span className="text-xs">等待素材预览…</span>
          </div>
        )}

        {previewItems.length > 1 ? (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {previewItems.map((item, idx) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setAssetIndex(idx)}
                className={`h-14 w-14 shrink-0 overflow-hidden rounded-xl border transition ${
                  idx === assetIndex ? "border-[#49e6ff]/50 ring-2 ring-[#49e6ff]/25" : "border-white/10 opacity-70 hover:opacity-100"
                }`}
              >
                {item.previewUrl ? (
                  <img src={item.previewUrl} alt="" className="h-full w-full object-cover" />
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      </div>
    </div>
  );
}
