import React, { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Film, Image as ImageIcon, Loader2 } from "lucide-react";
import { GROWTH_ASSET_ANALYSIS_STATUS_MESSAGES } from "@/lib/growthCampImagePipeline";

export type AssetAnalysisPreviewItem = {
  id: string;
  previewUrl: string | null;
  fileName: string;
  kind: "image" | "video";
};

type AssetAnalysisWaitPanelProps = {
  percent: number;
  label: string;
  detail?: string;
  assets: AssetAnalysisPreviewItem[];
};

export default function AssetAnalysisWaitPanel({ percent, label, detail, assets }: AssetAnalysisWaitPanelProps) {
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

  useEffect(() => {
    const id = window.setInterval(
      () => setMessageIndex((i) => (i + 1) % GROWTH_ASSET_ANALYSIS_STATUS_MESSAGES.length),
      5500,
    );
    return () => window.clearInterval(id);
  }, []);

  const safePercent = Math.max(0, Math.min(100, Math.round(percent)));
  const activePreview = previewItems[assetIndex] ?? previewItems[0];
  const statusMessage = GROWTH_ASSET_ANALYSIS_STATUS_MESSAGES[messageIndex] ?? GROWTH_ASSET_ANALYSIS_STATUS_MESSAGES[0];

  return (
    <div className="mt-5 grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(280px,420px)]">
      <div className="rounded-2xl border border-[#6ee7b7]/20 bg-[rgba(52,211,153,0.05)] p-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-[#6ee7b7]">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          素材视觉分析进行中
        </div>
        <p className="mt-2 text-sm leading-7 text-white/88">{label}</p>
        {detail ? <p className="mt-1 text-xs text-[#c9c0e6]/70">{detail}</p> : null}
        <p className="mt-3 text-xs leading-relaxed text-[#8cefff]/85">{statusMessage}</p>

        <div className="mt-5">
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

        <p className="mt-4 text-[11px] leading-relaxed text-[#c9c0e6]/55">
          视频与图片会并行分析；任一份完成即会在下方展示结果，无需等全部结束。
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
  );
}
