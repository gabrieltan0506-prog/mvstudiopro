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
  manhuaClipDockItemHasExportableOutput,
  selectExportableDockIds,
  summarizeManhuaDockExport,
  type ManhuaClipDockItem,
} from "@/lib/manhuaProjectExport";
import { MANHUA_DRAFT_EXPORT_HINT_ZH } from "@shared/manhuaCloudDraft";

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
};

function episodeClipReady(list: ManhuaClipDockItem[]): boolean {
  return list.some(
    (it) =>
      it.stage === "clip" &&
      Boolean(it.outputUrl) &&
      it.clipQuality?.status === "passed",
  );
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
      if (it.stage === "clip" && it.outputUrl && it.clipQuality?.status === "passed") {
        eps.add(it.episodeIndex);
      }
    }
    return eps.size;
  }, [items]);
  const qualityFailedEpCount = useMemo(() => {
    const eps = new Set<number>();
    for (const it of items) {
      if (it.stage === "clip" && it.clipQuality?.status === "failed") eps.add(it.episodeIndex);
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
                仅质检通过可合成
              </span>
            </div>
            <p className="mt-1 max-w-xl text-[11px] leading-relaxed text-white/45">
              各集微动就绪后，一键拼成长片并自动配乐。勾选集号可同时作为工厂运行范围。
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
            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]">
              <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-white/60">
                {summary.episodeCount || 0} 集
              </span>
              <span className="rounded-md border border-emerald-400/25 bg-emerald-500/10 px-2 py-0.5 text-emerald-100/85">
                质检通过 {clipReadyEpCount}
              </span>
              {qualityFailedEpCount ? (
                <span className="inline-flex items-center gap-1 rounded-md border border-rose-400/30 bg-rose-500/10 px-2 py-0.5 text-rose-100/85">
                  <AlertTriangle className="h-3 w-3" />
                  已拦截 {qualityFailedEpCount}
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
              在工作台点「生成本集成片」，或勾选集后全自动跑完。成片出现在下方胶片条后，再回这里一键合成。
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
                (it) => it.stage === "clip" && it.clipQuality?.status === "failed",
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
                          ? "border-rose-400/35 bg-rose-500/8"
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
                        ready
                          ? "bg-emerald-500/85 text-white"
                          : qualityFailed
                            ? "bg-rose-500/90 text-white"
                            : "bg-black/65 text-white/70"
                      }`}
                    >
                      {ready ? "质检通过" : qualityFailed ? "已拦截" : "待成片"}
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
                    return (
                      <li
                        key={it.blockId}
                        className={`flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.04] ${
                          it.stage === "clip" && it.clipQuality?.status === "failed"
                            ? "bg-rose-500/[0.07]"
                            : ""
                        }`}
                        title={
                          it.stage === "clip" && it.clipQuality?.status === "failed"
                            ? it.clipQuality.summary
                            : undefined
                        }
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(it.blockId)}
                          className="h-3.5 w-3.5 accent-cyan-400"
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
                            : " · 待跑"}
                        </span>
                        {it.stage === "clip" && it.clipQuality?.status === "passed" ? (
                          <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] text-emerald-100">
                            <CheckCircle2 className="h-2.5 w-2.5" />
                            通过
                          </span>
                        ) : it.stage === "clip" && it.clipQuality?.status === "failed" ? (
                          <span className="inline-flex items-center gap-0.5 rounded bg-rose-500/15 px-1.5 py-0.5 text-[9px] text-rose-100">
                            <AlertTriangle className="h-2.5 w-2.5" />
                            拦截
                          </span>
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
