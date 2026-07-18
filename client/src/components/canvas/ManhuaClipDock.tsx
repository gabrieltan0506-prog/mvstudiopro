import React, { useMemo, useState } from "react";
import { Download, Focus, Loader2 } from "lucide-react";
import type { CanvasBlock } from "@/lib/canvasTypes";
import {
  collectManhuaClipDockItems,
  downloadManhuaProjectZip,
  type ManhuaClipDockItem,
} from "@/lib/manhuaProjectExport";

type Props = {
  blocks: CanvasBlock[];
  topic?: string;
  seriesTitle?: string;
  characterIds?: string[];
  artStyleId?: string;
  selectedIds: Set<string>;
  onSelectedIdsChange: (next: Set<string>) => void;
  onFocusBlock?: (blockId: string) => void;
};

export default function ManhuaClipDock({
  blocks,
  topic,
  seriesTitle,
  characterIds,
  artStyleId,
  selectedIds,
  onSelectedIdsChange,
  onFocusBlock,
}: Props) {
  const [exportBusy, setExportBusy] = useState(false);
  const items = useMemo(() => collectManhuaClipDockItems(blocks), [blocks]);

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
  const clearAll = () => onSelectedIdsChange(new Set());
  const selectEpisode = (ep: number) => {
    const next = new Set(selectedIds);
    for (const it of items) {
      if (it.episodeIndex === ep) next.add(it.blockId);
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
      });
      if (result.failCount > 0) {
        window.alert(
          `已导出 ${result.filename}：成功 ${result.okCount}，失败 ${result.failCount}（见 manifest.failed）`,
        );
      }
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
          <div className="text-sm font-semibold text-white/90">成片坞</div>
          <p className="mt-0.5 text-[11px] leading-5 text-white/45">
            勾选本集可作工厂「运行范围」；有静帧/成片时可导出工程包（不含长片拼接）。
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
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
            disabled={!selectedIds.size}
            onClick={clearAll}
            className="rounded-md border border-white/15 px-2 py-1 text-[10px] text-white/70 hover:bg-white/10 disabled:opacity-40"
          >
            清空
          </button>
          <button
            type="button"
            disabled={exportBusy || !selectedIds.size}
            onClick={() => void handleExport()}
            className="inline-flex items-center gap-1 rounded-md border border-amber-400/35 bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-50 hover:bg-amber-500/25 disabled:opacity-40"
          >
            {exportBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
            导出工程包
          </button>
        </div>
      </div>

      {!items.length ? (
        <p className="mt-3 text-[11px] text-white/40">
          画布尚无工厂链。请先「按集铺板」或「铺节点」；铺好后即可勾选集号跑工厂。
        </p>
      ) : (
        <div className="mt-3 max-h-64 space-y-3 overflow-y-auto pr-1">
          {byEpisode.map(([ep, list]) => {
            const title = list.find((x) => x.episodeTitle)?.episodeTitle;
            const epAllOn = list.every((it) => selectedIds.has(it.blockId));
            const epSomeOn = !epAllOn && list.some((it) => selectedIds.has(it.blockId));
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
                      <span className="ml-1.5 text-white/35">{list.length} 项</span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => selectEpisode(ep)}
                    className="rounded border border-white/12 px-1.5 py-0.5 text-[10px] text-white/55 hover:bg-white/8"
                  >
                    全选本集
                  </button>
                </div>
                <ul className="space-y-1">
                  {list.map((it) => {
                    const checked = selectedIds.has(it.blockId);
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
                        <span className="min-w-0 flex-1 truncate text-[11px] text-white/75">
                          {it.label}
                          {it.outputUrl || it.outputText?.trim()
                            ? it.kind === "text"
                              ? " · md"
                              : ""
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
