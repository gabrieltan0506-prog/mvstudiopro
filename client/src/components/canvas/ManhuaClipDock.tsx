import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Download,
  Film,
  Focus,
  Loader2,
  Music2,
  ShieldCheck,
} from "lucide-react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  collectManhuaAssembleClipsFromDock,
  collectManhuaClipDockItems,
  downloadManhuaProjectZip,
  manhuaClipDockItemAllowsAssemble,
  manhuaClipDockItemHasExportableOutput,
  selectExportableDockIds,
  summarizeManhuaDockExport,
  type ManhuaClipDockItem,
} from "@/lib/manhuaProjectExport";
import { MANHUA_DRAFT_EXPORT_HINT_ZH } from "@shared/manhuaCloudDraft";
import {
  defaultManhuaDeliveryPackage,
  formatManhuaDeliveryPackageMarkdown,
  summarizeManhuaDeliveryPackageProgress,
  type ManhuaDeliveryPackage,
} from "@shared/manhuaDeliveryPackage";
import { formatCineVocabMultilingualTable } from "@shared/manhuaCineVocabBank";
import type { ManhuaRetakeVariable } from "@shared/manhuaDirectingWorkflow";
import {
  formatManhuaRetakeHintZh,
  suggestManhuaRetakeVariable,
  MANHUA_RETAKE_VARIABLE_LABEL_ZH,
} from "@shared/manhuaDirectingWorkflow";

type Props = {
  blocks: CanvasBlock[];
  topic?: string;
  seriesTitle?: string;
  characterIds?: string[];
  artStyleId?: string;
  sceneId?: string;
  demoAssetIds?: string[];
  writerPackMarkdown?: string;
  selectedIds: Set<string>;
  onSelectedIdsChange: (next: Set<string>) => void;
  onFocusBlock?: (blockId: string) => void;
  assembleBusy?: boolean;
  finalVideoUrl?: string | null;
  onAssembleFinal?: (clips: ReturnType<typeof collectManhuaAssembleClipsFromDock>) => void;
  /** 尚无可合成成片时，引导回工作台 */
  onGoWorkbench?: () => void;
  /** 点胶片条集卡时切换焦点集 */
  onSelectEpisode?: (episodeIndex: number) => void;
  /** 与剪辑台同源的交付包（非默认壳） */
  deliveryPackage?: ManhuaDeliveryPackage | null;
  cineVocabIds?: string[];
  onAcceptClipDespiteQc?: (clipBlockId: string) => void;
  onRetakeClip?: (clipBlockId: string, variable: ManhuaRetakeVariable) => void;
  factoryBusy?: boolean;
};

function episodeClipReady(list: ManhuaClipDockItem[]): boolean {
  return list.some((it) => it.stage === "clip" && manhuaClipDockItemAllowsAssemble(it));
}

function episodeKeyartUrl(list: ManhuaClipDockItem[]): string | undefined {
  return list.find((it) => it.stage === "keyart" && it.outputUrl)?.outputUrl;
}

export default function ManhuaClipDock({
  blocks,
  topic,
  seriesTitle,
  characterIds,
  artStyleId,
  sceneId,
  demoAssetIds,
  writerPackMarkdown,
  selectedIds,
  onSelectedIdsChange,
  onFocusBlock,
  assembleBusy,
  finalVideoUrl,
  onAssembleFinal,
  onGoWorkbench,
  onSelectEpisode,
  deliveryPackage: deliveryPackageProp,
  cineVocabIds = [],
  onAcceptClipDespiteQc,
  onRetakeClip,
  factoryBusy,
}: Props) {
  const [exportBusy, setExportBusy] = useState(false);
  const items = useMemo(() => collectManhuaClipDockItems(blocks), [blocks]);
  const summary = useMemo(() => summarizeManhuaDockExport(items), [items]);
  const assembleClips = useMemo(() => {
    const fromSelected = collectManhuaAssembleClipsFromDock(items, {
      selectedIds,
      onlySelectedEpisodes: selectedIds.size > 0,
    }).filter((c) => c.clipUrl);
    if (fromSelected.length) return fromSelected;
    return collectManhuaAssembleClipsFromDock(items).filter((c) => c.clipUrl);
  }, [items, selectedIds]);
  const canAssemble = assembleClips.length > 0 && Boolean(onAssembleFinal);
  const clipReadyEpCount = useMemo(() => {
    const eps = new Set<number>();
    for (const it of items) {
      if (it.stage === "clip" && manhuaClipDockItemAllowsAssemble(it)) {
        eps.add(it.episodeIndex);
      }
    }
    return eps.size;
  }, [items]);
  const qualityFailedEpCount = useMemo(() => {
    const eps = new Set<number>();
    for (const it of items) {
      if (
        it.stage === "clip" &&
        it.clipQuality?.status === "failed" &&
        !it.clipQuality.userAcceptedDespiteQc
      ) {
        eps.add(it.episodeIndex);
      }
    }
    return eps.size;
  }, [items]);

  const byEpisode = useMemo(() => {
    const map = new Map<number, ManhuaClipDockItem[]>();
    for (const it of items) {
      const list = map.get(it.episodeIndex) || [];
      list.push(it);
      map.set(it.episodeIndex, list);
    }
    return Array.from(map.entries()).sort((a, b) => a[0] - b[0]);
  }, [items]);

  const deliveryPkg = useMemo(() => {
    const episodeIndexes = byEpisode.map(([ep]) => ep);
    if (deliveryPackageProp) {
      return {
        ...deliveryPackageProp,
        seriesTitle: deliveryPackageProp.seriesTitle || seriesTitle || topic || "未命名系列",
        episodeIndexes: deliveryPackageProp.episodeIndexes.length
          ? deliveryPackageProp.episodeIndexes
          : episodeIndexes,
      };
    }
    return defaultManhuaDeliveryPackage({
      seriesTitle: seriesTitle || topic,
      episodeIndexes,
      locale: "zh",
    });
  }, [deliveryPackageProp, seriesTitle, topic, byEpisode]);
  const deliveryProgress = useMemo(
    () => summarizeManhuaDeliveryPackageProgress(deliveryPkg),
    [deliveryPkg],
  );

  const handleDownloadDeliveryPack = () => {
    const md = [
      formatManhuaDeliveryPackageMarkdown(deliveryPkg),
      "",
      formatCineVocabMultilingualTable(cineVocabIds.length ? cineVocabIds : undefined),
    ].join("\n");
    const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `交付包-${(seriesTitle || topic || "manhua").slice(0, 24)}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectedIdsChange(next);
  };

  const selectAll = () => onSelectedIdsChange(new Set(items.map((i) => i.blockId)));
  const selectExportable = () => onSelectedIdsChange(new Set(selectExportableDockIds(items)));
  const clearAll = () => onSelectedIdsChange(new Set());
  const selectEpisode = (ep: number) => {
    const next = new Set(selectedIds);
    for (const it of items) {
      if (it.episodeIndex === ep) next.add(it.blockId);
    }
    onSelectedIdsChange(next);
  };
  const selectEpisodeExportable = (ep: number) => {
    const next = new Set(selectedIds);
    for (const it of items) {
      if (it.episodeIndex === ep && manhuaClipDockItemHasExportableOutput(it)) next.add(it.blockId);
    }
    onSelectedIdsChange(next);
  };

  const toggleEpisode = (ep: number) => {
    const epItems = items.filter((it) => it.episodeIndex === ep);
    if (!epItems.length) return;
    const allOn = epItems.every((it) => selectedIds.has(it.blockId));
    const next = new Set(selectedIds);
    for (const it of epItems) {
      if (allOn) next.delete(it.blockId);
      else next.add(it.blockId);
    }
    onSelectedIdsChange(next);
  };

  const handleExport = async () => {
    if (!selectedIds.size) return;
    setExportBusy(true);
    try {
      const result = await downloadManhuaProjectZip({
        items,
        selectedIds: Array.from(selectedIds),
        topic,
        seriesTitle,
        characterIds,
        artStyleId,
        sceneId,
        demoAssetIds,
        writerPackMarkdown,
        deliveryPackageMarkdown: formatManhuaDeliveryPackageMarkdown(deliveryPkg),
        cineVocabTableMarkdown: formatCineVocabMultilingualTable(
          cineVocabIds.length ? cineVocabIds : undefined,
        ),
        finalVideoUrl: finalVideoUrl || undefined,
      });
      if (result.failCount > 0) {
        window.alert(
          `已导出 ${result.filename}：成功 ${result.okCount}，失败 ${result.failCount}（见 manifest.failed / README.md）`,
        );
      }
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExportBusy(false);
    }
  };

  const handleExportAllReady = async () => {
    const ids = selectExportableDockIds(items);
    if (!ids.length) {
      window.alert("尚无可导出产物（需至少一集有故事/节拍/静帧/成片等）");
      return;
    }
    onSelectedIdsChange(new Set(ids));
    setExportBusy(true);
    try {
      const result = await downloadManhuaProjectZip({
        items,
        selectedIds: ids,
        topic,
        seriesTitle,
        characterIds,
        artStyleId,
        sceneId,
        demoAssetIds,
        writerPackMarkdown,
        deliveryPackageMarkdown: formatManhuaDeliveryPackageMarkdown(deliveryPkg),
        cineVocabTableMarkdown: formatCineVocabMultilingualTable(
          cineVocabIds.length ? cineVocabIds : undefined,
        ),
        finalVideoUrl: finalVideoUrl || undefined,
      });
      window.alert(
        `已导出多集工程包 ${result.filename}（${result.okCount} 项${
          result.failCount ? `，失败 ${result.failCount}` : ""
        }）`,
      );
    } catch (e: unknown) {
      window.alert(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-cyan-400/20 bg-gradient-to-b from-[#0c1520] via-[#0a0e18] to-[#08070f]">
      {/* 终局出口 · 示意 A 成片段 */}
      <div className="border-b border-white/10 px-3 py-3 md:px-4 md:py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold tracking-wide text-white/92">
                <Film className="h-4 w-4 text-cyan-300" />
                成片坞
              </span>
              <span className="rounded-full border border-cyan-400/35 bg-cyan-500/12 px-2 py-0.5 text-[10px] font-medium text-cyan-100/90">
                步骤 7–8 · 终局出口
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100/85">
                <ShieldCheck className="h-3 w-3" />
                质检通过或「仍采用」可合成
              </span>
            </div>
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-white/45">
              各集微动就绪后，一键拼成长片并自动配乐。质检未过可在本坞或剪辑台点「仍采用此片」/「按建议重拍」。勾选集号可同时作为工厂运行范围。
              {canAssemble ? (
                <span className="text-cyan-100/70">
                  {" "}
                  本次将拼第{" "}
                  {assembleClips
                    .map((c) => c.episodeIndex)
                    .filter((n) => n >= 1)
                    .sort((a, b) => a - b)
                    .join("、")}{" "}
                  集。
                </span>
              ) : null}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-white/55">
                {deliveryProgress.labelZh}
              </span>
              <button
                type="button"
                onClick={handleDownloadDeliveryPack}
                className="inline-flex items-center gap-1 rounded-md border border-cyan-400/30 bg-cyan-500/10 px-2 py-0.5 text-[10px] font-medium text-cyan-50 hover:bg-cyan-500/18"
              >
                <Download className="h-3 w-3" />
                下载交付包（成色/字幕/配音 + 多语言词表）
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/60">
                {summary.episodeCount || 0} 集
              </span>
              <span className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-100/85">
                可合成 {clipReadyEpCount}
              </span>
              {qualityFailedEpCount ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-amber-400/30 bg-amber-500/10 px-2 py-0.5 text-amber-100/85">
                  <AlertTriangle className="h-3 w-3" />
                  待决定 {qualityFailedEpCount}
                </span>
              ) : null}
              <span className="rounded-md border border-amber-400/25 bg-amber-500/10 px-2 py-0.5 text-amber-100/80">
                待跑 {summary.pendingCount}
              </span>
              {finalVideoUrl ? (
                <span className="rounded-md border border-cyan-400/35 bg-cyan-500/15 px-2 py-0.5 text-cyan-100">
                  长片已合成
                </span>
              ) : null}
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-1.5 sm:items-end">
            <button
              type="button"
              disabled={assembleBusy || exportBusy || !canAssemble}
              onClick={() => onAssembleFinal?.(assembleClips)}
              className="inline-flex min-w-[9.5rem] items-center justify-center gap-2 rounded-xl border border-cyan-300/45 bg-gradient-to-b from-cyan-400/30 to-cyan-600/25 px-4 py-2.5 text-[12px] font-semibold text-cyan-50 shadow-[0_0_24px_rgba(34,211,238,0.12)] hover:from-cyan-400/40 hover:to-cyan-600/35 disabled:opacity-40"
              title={
                canAssemble
                  ? `将用 ${assembleClips.length} 集成片合成长片并自动配乐`
                  : "需至少一集有微动成片"
              }
            >
              {assembleBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clapperboard className="h-4 w-4" />}
              {assembleBusy
                ? "合成中…"
                : canAssemble
                  ? `合成长片（${assembleClips.length} 集·含配乐）`
                  : "合成长片（含配乐）"}
            </button>
            {!canAssemble && !assembleBusy && onGoWorkbench ? (
              <button
                type="button"
                onClick={onGoWorkbench}
                className="text-[10px] font-medium text-cyan-200/75 underline-offset-2 hover:text-cyan-100 hover:underline"
              >
                还没有成片 · 回工作台生成 →
              </button>
            ) : null}
          </div>
        </div>

        {!canAssemble && !finalVideoUrl && !assembleBusy ? (
          <div className="mt-3 rounded-xl border border-dashed border-cyan-400/25 bg-cyan-500/[0.06] px-3 py-2.5">
            <p className="text-[11px] font-medium text-cyan-50/90">合成前提：至少一集微动成片就绪</p>
            <p className="mt-0.5 text-[10px] leading-relaxed text-white/45">
              在工作台按段生成成片；成片出现在下方胶片条后，再回这里一键合成。
            </p>
            {onGoWorkbench ? (
              <button
                type="button"
                onClick={onGoWorkbench}
                className="mt-2 inline-flex items-center gap-1 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 hover:bg-cyan-500/25"
              >
                去工作台出片
              </button>
            ) : null}
          </div>
        ) : null}

        {assembleBusy ? (
          <div className="mt-3">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] text-cyan-100/80">
              <Music2 className="h-3 w-3" />
              配乐生成与多集拼接进行中，可离开本区稍候…
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
              <div className="h-full w-2/3 animate-pulse rounded-full bg-gradient-to-r from-cyan-400/80 via-teal-300/90 to-cyan-400/80" />
            </div>
          </div>
        ) : null}
      </div>

      {finalVideoUrl ? (
        <div className="border-b border-white/10 bg-black/35 px-3 py-3 md:px-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-[11px] font-semibold text-cyan-100/90">长片预览</div>
            <span className="text-[10px] text-white/40">多集拼接 · 已混配乐</span>
          </div>
          <div className="overflow-hidden rounded-xl border border-cyan-400/25 bg-black/60">
            <video src={finalVideoUrl} controls className="max-h-64 w-full object-contain" />
          </div>
          {/* 示意 A 成片段：波形条装饰，非真实音频编辑 */}
          <div className="mt-2 flex h-7 items-end gap-px px-0.5 opacity-70" aria-hidden>
            {Array.from({ length: 48 }, (_, i) => (
              <span
                key={i}
                className="flex-1 rounded-sm bg-emerald-400/55"
                style={{ height: `${18 + ((i * 17) % 40)}%` }}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* 集时间线胶片条 */}
      {byEpisode.length ? (
        <div className="border-b border-white/10 px-3 py-2.5 md:px-4">
          <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-white/35">
            集时间线
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {byEpisode.map(([ep, list]) => {
              const title = list.find((x) => x.episodeTitle)?.episodeTitle;
              const ready = episodeClipReady(list);
              const qualityFailed = list.some(
                (it) =>
                  it.stage === "clip" &&
                  it.clipQuality?.status === "failed" &&
                  !it.clipQuality.userAcceptedDespiteQc,
              );
              const qualityAccepted = list.some(
                (it) =>
                  it.stage === "clip" &&
                  it.clipQuality?.status === "failed" &&
                  it.clipQuality.userAcceptedDespiteQc,
              );
              const thumb = episodeKeyartUrl(list);
              const epAllOn = list.every((it) => selectedIds.has(it.blockId));
              return (
                <button
                  key={ep}
                  type="button"
                  onClick={() => {
                    onSelectEpisode?.(ep);
                    toggleEpisode(ep);
                  }}
                  className={`w-[7.25rem] shrink-0 overflow-hidden rounded-xl border text-left transition ${
                    epAllOn
                      ? "border-cyan-400/45 bg-cyan-500/12"
                      : ready
                        ? "border-emerald-400/30 bg-emerald-500/8"
                        : qualityFailed
                          ? "border-amber-400/35 bg-amber-500/8"
                        : "border-white/10 bg-white/[0.03]"
                  }`}
                  title={title || `第${ep}集`}
                >
                  <div className="relative aspect-[9/12] bg-black/50">
                    {thumb ? (
                      <img src={thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-[10px] text-white/30">待静帧</div>
                    )}
                    <span
                      className={`absolute left-1 top-1 rounded px-1 py-0.5 text-[9px] font-semibold ${
                        ready && !qualityAccepted
                          ? "bg-emerald-500/85 text-white"
                          : qualityAccepted
                            ? "bg-amber-500/90 text-black"
                          : qualityFailed
                            ? "bg-amber-500/85 text-black"
                            : "bg-black/65 text-white/70"
                      }`}
                    >
                      {ready && !qualityAccepted
                        ? "可合成"
                        : qualityAccepted
                          ? "已采用"
                          : qualityFailed
                            ? "待决定"
                            : "待成片"}
                    </span>
                  </div>
                  <div className="px-1.5 py-1.5">
                    <div className="truncate text-[11px] font-medium text-white/85">第{ep}集</div>
                    <div className="truncate text-[9px] text-white/40">{title || "未命名"}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* 次要：导出 */}
      <div className="space-y-1.5 border-b border-white/8 px-3 py-2 md:px-4">
        <p className="text-[10px] leading-relaxed text-white/40">{MANHUA_DRAFT_EXPORT_HINT_ZH}</p>
        <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          disabled={!items.length}
          onClick={selectAll}
          className="rounded-lg border border-white/12 px-2 py-1 text-[10px] text-white/55 hover:bg-white/8 disabled:opacity-40"
        >
          全选
        </button>
        <button
          type="button"
          disabled={!summary.exportableCount}
          onClick={selectExportable}
          className="rounded-lg border border-white/12 px-2 py-1 text-[10px] text-white/55 hover:bg-white/8 disabled:opacity-40"
        >
          仅选有产物
        </button>
        <button
          type="button"
          disabled={!selectedIds.size}
          onClick={clearAll}
          className="rounded-lg border border-white/12 px-2 py-1 text-[10px] text-white/55 hover:bg-white/8 disabled:opacity-40"
        >
          清空勾选
        </button>
        <button
          type="button"
          disabled={exportBusy || !summary.exportableCount}
          onClick={() => void handleExportAllReady()}
          className="inline-flex items-center gap-1 rounded-lg border border-sky-400/30 bg-sky-500/12 px-2.5 py-1 text-[10px] font-semibold text-sky-50 hover:bg-sky-500/20 disabled:opacity-40"
        >
          {exportBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          导出全部有产物
        </button>
        <button
          type="button"
          disabled={exportBusy || !selectedIds.size}
          onClick={() => void handleExport()}
          className="inline-flex items-center gap-1 rounded-lg border border-white/12 px-2.5 py-1 text-[10px] font-medium text-white/65 hover:bg-white/8 disabled:opacity-40"
        >
          {exportBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
          导出勾选
        </button>
        </div>
      </div>

      {!items.length ? (
        <div className="px-3 py-4 md:px-4">
          <p className="text-[11px] leading-relaxed text-white/45">
            画布尚无工厂链。请先确认编剧 → 工作台出片（或「按集铺板」），再回此处合成长片。
          </p>
          {onGoWorkbench ? (
            <button
              type="button"
              onClick={onGoWorkbench}
              className="mt-2 inline-flex items-center gap-1 rounded-lg border border-cyan-400/35 bg-cyan-500/15 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-50 hover:bg-cyan-500/25"
            >
              去工作台开始
            </button>
          ) : null}
        </div>
      ) : (
        <div className="max-h-64 space-y-2 overflow-y-auto px-3 py-2.5 md:px-4">
          {byEpisode.map(([ep, list]) => {
            const title = list.find((x) => x.episodeTitle)?.episodeTitle;
            const epAllOn = list.every((it) => selectedIds.has(it.blockId));
            const epSomeOn = !epAllOn && list.some((it) => selectedIds.has(it.blockId));
            const ready = list.filter(manhuaClipDockItemHasExportableOutput).length;
            return (
              <div key={ep} className="rounded-xl border border-white/8 bg-black/30 p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                  <label className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-[11px] font-medium text-white/85">
                    <input
                      type="checkbox"
                      checked={epAllOn}
                      ref={(el) => {
                        if (el) el.indeterminate = epSomeOn;
                      }}
                      onChange={() => toggleEpisode(ep)}
                      className="h-3.5 w-3.5 accent-cyan-400"
                    />
                    <span className="truncate">
                      第{ep}集{title ? ` · ${title}` : ""}
                      <span className="ml-1.5 text-white/35">
                        {list.length} 项 · 可导出 {ready}
                      </span>
                    </span>
                  </label>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => selectEpisodeExportable(ep)}
                      disabled={!ready}
                      className="rounded border border-white/12 px-1.5 py-0.5 text-[10px] text-white/55 hover:bg-white/8 disabled:opacity-35"
                    >
                      本集有产物
                    </button>
                    <button
                      type="button"
                      onClick={() => selectEpisode(ep)}
                      className="rounded border border-white/12 px-1.5 py-0.5 text-[10px] text-white/55 hover:bg-white/8"
                    >
                      全选本集
                    </button>
                  </div>
                </div>
                <ul className="space-y-1">
                  {list.map((it) => {
                    const checked = selectedIds.has(it.blockId);
                    const readyItem = manhuaClipDockItemHasExportableOutput(it);
                    const clipPendingDecision =
                      it.stage === "clip" &&
                      it.clipQuality?.status === "failed" &&
                      !it.clipQuality.userAcceptedDespiteQc;
                    const clipSoftAccepted =
                      it.stage === "clip" &&
                      it.clipQuality?.status === "failed" &&
                      Boolean(it.clipQuality.userAcceptedDespiteQc);
                    return (
                      <li
                        key={it.blockId}
                        className={`flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.04] ${
                          clipPendingDecision
                            ? "bg-amber-500/[0.07]"
                            : clipSoftAccepted
                              ? "bg-amber-500/[0.05]"
                              : ""
                        }`}
                        title={
                          clipPendingDecision
                            ? `${it.clipQuality?.summary || "质检未过"} · 可仍采用或按建议重拍`
                            : clipSoftAccepted
                              ? `质检未过·已采用：${it.clipQuality?.summary || ""}`
                              : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={clipPendingDecision}
                          onChange={() => toggle(it.blockId)}
                          className="h-3.5 w-3.5 accent-cyan-400 disabled:opacity-35"
                        />
                        {it.outputUrl && (it.stage === "keyart" || it.stage === "recap_card") ? (
                          <img
                            src={it.outputUrl}
                            alt=""
                            className="h-8 w-8 shrink-0 rounded object-cover"
                            loading="lazy"
                          />
                        ) : null}
                        <span className="min-w-0 flex-1 truncate text-[11px] text-white/75">
                          {it.label}
                          {readyItem
                            ? it.kind === "text"
                              ? " · md"
                              : it.stage === "clip" || it.stage === "omni_edit"
                                ? " · mp4"
                                : " · 图"
                            : clipPendingDecision
                              ? " · 待决定"
                              : " · 待跑"}
                        </span>
                        {it.stage === "clip" && it.clipQuality?.status === "passed" ? (
                          <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-100">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            通过
                          </span>
                        ) : clipSoftAccepted ? (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] text-amber-50">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            质检未过·已采用
                          </span>
                        ) : clipPendingDecision ? (
                          <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] text-amber-50">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            待决定
                          </span>
                        ) : null}
                        {clipPendingDecision && onRetakeClip && it.clipQuality?.summary ? (
                          <button
                            type="button"
                            disabled={factoryBusy}
                            title={formatManhuaRetakeHintZh(
                              suggestManhuaRetakeVariable(it.clipQuality.summary),
                              1,
                              3,
                            )}
                            onClick={() =>
                              onRetakeClip(
                                it.blockId,
                                suggestManhuaRetakeVariable(it.clipQuality!.summary),
                              )
                            }
                            className="rounded border border-fuchsia-400/40 bg-fuchsia-500/15 px-1.5 py-0.5 text-[9px] text-fuchsia-50 disabled:opacity-40"
                          >
                            只改
                            {
                              MANHUA_RETAKE_VARIABLE_LABEL_ZH[
                                suggestManhuaRetakeVariable(it.clipQuality.summary)
                              ]
                            }
                            重拍
                          </button>
                        ) : null}
                        {clipPendingDecision && onAcceptClipDespiteQc ? (
                          <button
                            type="button"
                            onClick={() => onAcceptClipDespiteQc(it.blockId)}
                            className="rounded border border-amber-400/45 bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold text-amber-50"
                          >
                            仍采用
                          </button>
                        ) : null}
                        {onFocusBlock ? (
                          <button
                            type="button"
                            title="定位到画布节点"
                            onClick={() => onFocusBlock(it.blockId)}
                            className="inline-flex items-center gap-0.5 rounded border border-white/12 px-1.5 py-0.5 text-[10px] text-white/50 hover:bg-white/8 hover:text-white/80"
                          >
                            <Focus className="h-3 w-3" />
                            定位
                          </button>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
