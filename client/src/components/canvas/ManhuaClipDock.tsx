import React, { useMemo, useState } from "react";
import { Clapperboard, Download, Focus, Loader2 } from "lucide-react";
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
  /** 合成长片（含配乐）；由父组件扣点并调 jobs */
  assembleBusy?: boolean;
  finalVideoUrl?: string | null;
  onAssembleFinal?: (clips: ReturnType<typeof collectManhuaAssembleClipsFromDock>) => void;
};

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
    <div className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.06] to-transparent p-3 md:p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <div className="text-sm font-semibold text-white/90">成片坞 · 多集导出</div>
          <p className="mt-0.5 text-[11px] leading-5 text-white/45">
            勾选可作工厂运行范围；导出含故事/角色卡/节拍/反推/静帧/成片 + README/playlist。有成片后可一键合成长片（含配乐）。
            {summary.episodeCount ? (
              <span className="text-white/55">
                {" "}
                · {summary.episodeCount} 集 · 可导出 {summary.exportableCount} · 待跑{" "}
                {summary.pendingCount}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={assembleBusy || exportBusy || !canAssemble}
            onClick={() => onAssembleFinal?.(assembleClips)}
            className="inline-flex items-center gap-1 rounded-md border border-emerald-400/40 bg-emerald-500/20 px-2.5 py-1 text-[10px] font-semibold text-emerald-50 hover:bg-emerald-500/30 disabled:opacity-40"
            title={
              canAssemble
                ? `将用 ${assembleClips.length} 集成片合成长片并自动配乐`
                : "需至少一集有微动成片"
            }
          >
            {assembleBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Clapperboard className="h-3 w-3" />}
            合成长片（含配乐）
          </button>
          <button
            type="button"
            disabled={!items.length}
            onClick={selectAll}
            className="rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40"
          >
            全选全部
          </button>
          <button
            type="button"
            disabled={!summary.exportableCount}
            onClick={selectExportable}
            className="rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40"
          >
            仅选有产物
          </button>
          <button
            type="button"
            disabled={!selectedIds.size}
            onClick={clearAll}
            className="rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40"
          >
            清空
          </button>
          <button
            type="button"
            disabled={exportBusy || !summary.exportableCount}
            onClick={() => void handleExportAllReady()}
            className="inline-flex items-center gap-1 rounded-md border border-sky-400/35 bg-sky-500/15 px-2.5 py-1 text-[10px] font-semibold text-sky-50 hover:bg-sky-500/25 disabled:opacity-40"
          >
            {exportBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            一键导出全部有产物
          </button>
          <button
            type="button"
            disabled={exportBusy || !selectedIds.size}
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400/35 bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-40"
          >
            {exportBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            导出勾选
          </button>
        </div>
      </div>

      {finalVideoUrl ? (
        <div className="mt-3 overflow-hidden rounded-xl border border-emerald-400/25 bg-black/40">
          <div className="border-b border-white/10 px-2.5 py-1.5 text-[10px] font-semibold text-emerald-100/85">
            长片预览（已合成）
          </div>
          <video src={finalVideoUrl} controls className="max-h-56 w-full object-contain" />
        </div>
      ) : null}

      {!items.length ? (
        <p className="mt-3 text-[11px] text-white/40">
          画布尚无工厂链。请先「按集铺板」或「铺节点」；铺好后即可勾选集号跑工厂。
        </p>
      ) : (
        <div className="mt-3 max-h-72 space-y-3 overflow-y-auto pr-1">
          {byEpisode.map(([ep, list]) => {
            const title = list.find((x) => x.episodeTitle)?.episodeTitle;
            const epAllOn = list.every((it) => selectedIds.has(it.blockId));
            const epSomeOn = !epAllOn && list.some((it) => selectedIds.has(it.blockId));
            const ready = list.filter(manhuaClipDockItemHasExportableOutput).length;
            return (
              <div key={ep} className="rounded-xl border border-white/8 bg-black/25 p-2.5">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1.5">
                  <label className="inline-flex min-w-0 cursor-pointer items-center gap-2 text-[11px] font-medium text-white/85">
                    <input
                      type="checkbox"
                      checked={epAllOn}
                      ref={(el) => {
                        if (el) el.indeterminate = epSomeOn;
                      }}
                      onChange={() => toggleEpisode(ep)}
                      className="h-3.5 w-3.5 accent-amber-400"
                      title="勾选本集作工厂运行范围"
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
                        className="flex items-center gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.04]"
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(it.blockId)}
                          className="h-3.5 w-3.5 accent-amber-400"
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
