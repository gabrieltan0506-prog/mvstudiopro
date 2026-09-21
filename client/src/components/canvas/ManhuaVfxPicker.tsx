import React, { useEffect, useState } from "react";
import { MANHUA_VFX_CATEGORIES, searchManhuaVfxPresets, formatManhuaVfxDirection } from "@shared/manhuaVfxCatalog";

export function ManhuaVfxPicker({ shotIndex, disabled, initialDirection = "", onApply }: {
  shotIndex: number;
  initialDirection?: string;
  disabled: boolean;
  onApply: (direction: string) => void;
}) {
  const [category, setCategory] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState(initialDirection);
  useEffect(() => setDirection(initialDirection), [initialDirection]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(0);
  const presets = searchManhuaVfxPresets(query, category || undefined);
  const pageSize = 8;
  const currentPage = Math.min(page, Math.max(0, Math.ceil(presets.length / pageSize) - 1));
  const visiblePresets = presets.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  return <details className="mt-3 rounded-lg border border-white/10 p-2" data-manhua-vfx-picker>
    <summary className="cursor-pointer text-xs text-cyan-100">为镜 {shotIndex} 添加特效</summary>
    <p className="my-2 text-[11px] text-white/50">选择后可改写，再采用到本段成片提示。不会立即生成；具体效果需出片后验收。</p>
    <select aria-label="特效分类" value={category} onChange={e => { setCategory(e.target.value); setPage(0); }} className="w-full rounded bg-slate-900 p-2 text-xs">
      <option value="">全部分类</option>{MANHUA_VFX_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.nameZh}</option>)}
    </select>
    <input aria-label="搜索特效" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }} placeholder="搜索：全息、火花、护盾…" className="my-2 w-full rounded bg-slate-900 p-2 text-xs" />
    <div role="group" aria-label="特效候选" className="max-h-36 overflow-y-auto space-y-1">{visiblePresets.map(p => <button key={p.id} type="button" aria-pressed={direction === formatManhuaVfxDirection(p.id)} onClick={() => { setDirection(formatManhuaVfxDirection(p.id)); setError(""); }} className="block w-full rounded bg-white/5 p-2 text-left text-xs aria-pressed:bg-cyan-400/20 aria-pressed:ring-1 aria-pressed:ring-cyan-300/60" title={p.descriptionZh}>{p.nameZh}</button>)}{!presets.length && <p className="text-xs text-white/50">没有匹配项，可在下方写自己的特效。</p>}</div>
    <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-white/60">
      <span role="status">{presets.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, presets.length)} / ${presets.length} 项` : "0 项"}</span>
      {presets.length > pageSize && <div className="flex gap-2">
        <button type="button" aria-label="上一页特效" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className="rounded border border-white/15 px-2 py-1 disabled:opacity-40">上一页</button>
        <button type="button" aria-label="下一页特效" disabled={(currentPage + 1) * pageSize >= presets.length} onClick={() => setPage(currentPage + 1)} className="rounded border border-white/15 px-2 py-1 disabled:opacity-40">下一页</button>
      </div>}
    </div>
    <textarea aria-label="本镜特效描述" value={direction} onChange={e => setDirection(e.target.value)} rows={5} className="my-2 w-full rounded bg-slate-900 p-2 text-xs" placeholder="写清由谁触发、向哪里运动、影响谁、接触后发生什么。" />
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
    <button type="button" disabled={disabled || !direction.trim()} onClick={() => { try { onApply(direction); setError(""); } catch (e) { setError(e instanceof Error ? e.message : "采用失败，请重试"); } }} className="rounded bg-cyan-400 px-3 py-2 text-xs font-semibold text-slate-950 disabled:opacity-40">采用到当前镜头</button>
    {disabled && <p className="mt-1 text-[11px] text-amber-100">需先建立本段成片节点，且当前没有生成任务。</p>}
  </details>;
}
