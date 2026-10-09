import { MANHUA_VFX_PRESET_LABELS, type ManhuaVfxEffect } from "@shared/manhuaVfx";

/** Edits the same effect values submitted to the renderer; contains no simulated render. */
export function ManhuaVfxTimeline({ effects, selectedId, duration, time, disabled, onSelect, onSeek, onChange, compact = false }: {
  compact?: boolean;
  effects: ManhuaVfxEffect[]; selectedId?: string; duration: number; time: number; disabled: boolean;
  onSelect: (id: string) => void; onSeek: (time: number) => void;
  onChange: (id: string, update: Partial<ManhuaVfxEffect>) => void;
}) {
  const ready = Number.isFinite(duration) && duration > 0;
  const extent = ready ? duration : Math.max(1, ...effects.map(effect => effect.startSec + effect.durationSec).filter(Number.isFinite));
  const percent = (value: number) => Math.max(0, Math.min(100, value / extent * 100));
  const selected = effects.find(effect => effect.id === selectedId);
  return <div className={`shrink-0 rounded-xl border border-white/10 bg-slate-950/70 p-3 ${compact ? "space-y-2" : "space-y-3"}`} aria-label="特效时间轴">
    <div className="flex items-center justify-between text-xs"><h5 className="font-semibold text-white">效果时间轴</h5><span className="tabular-nums text-cyan-100">{time.toFixed(2)} / {ready ? duration.toFixed(2) : "待读取"} 秒</span></div>
    <label className="block text-[11px] text-white/60">拖动播放位置
      <input aria-label="时间轴播放位置" type="range" min={0} max={extent} step={0.01} value={Math.min(time, extent)} disabled={disabled || !ready} className="mt-2 w-full accent-cyan-300" onChange={event => onSeek(Number(event.target.value))} />
    </label>
    <div className="ml-24 flex justify-between text-[10px] tabular-nums text-white/40">{[0, .25, .5, .75, 1].map(fraction => <span key={fraction}>{(extent * fraction).toFixed(1)}s</span>)}</div>
    <div className={compact ? "max-h-24 overflow-y-auto" : "space-y-1"}>{effects.map((effect, index) => <div key={effect.id} className="grid grid-cols-[88px_1fr] items-center gap-2">
      <button type="button" disabled={disabled} aria-pressed={selectedId === effect.id} onClick={() => onSelect(effect.id)} className={`truncate rounded px-1 py-2 text-left text-[11px] ${selectedId === effect.id ? "bg-cyan-300/15 text-cyan-100" : "text-white/65"}`}>{index + 1}. {MANHUA_VFX_PRESET_LABELS[effect.kind]}</button>
      <button type="button" data-vfx-track={effect.id} aria-label={`选择第${index + 1}个特效时间段`} aria-pressed={selectedId === effect.id} disabled={disabled} onClick={() => { onSelect(effect.id); if (ready) onSeek(Math.min(duration, effect.startSec)); }} className="relative h-9 overflow-hidden rounded border border-white/10 bg-white/5">
        <span className={`absolute inset-y-1 rounded border ${selectedId === effect.id ? "border-cyan-200 bg-cyan-300/30" : "border-white/25 bg-white/15"}`} style={{ left: `${percent(effect.startSec)}%`, width: `${Math.max(0, percent(effect.startSec + effect.durationSec) - percent(effect.startSec))}%` }} />
        <span aria-hidden className="absolute inset-y-0 w-px bg-white/80" style={{ left: `${percent(time)}%` }} />
      </button>
    </div>)}</div>
    {selected ? <div className="grid grid-cols-2 gap-3 border-t border-white/10 pt-3">
      <label className="text-[11px] text-white/65">开始 {selected.startSec.toFixed(2)} 秒<input aria-label="所选特效开始时间" type="range" min={0} max={Math.max(0, extent - selected.durationSec)} step={0.01} value={selected.startSec} disabled={disabled || !ready || selected.durationSec > extent} className="mt-2 w-full accent-cyan-300" onChange={event => onChange(selected.id, { startSec: Number(event.target.value) })} /></label>
      <label className="text-[11px] text-white/65">结束 {(selected.startSec + selected.durationSec).toFixed(2)} 秒<input aria-label="所选特效结束时间" type="range" min={Math.min(extent, selected.startSec + .05)} max={extent} step={0.01} value={selected.startSec + selected.durationSec} disabled={disabled || !ready || selected.startSec + .05 > extent} className="mt-2 w-full accent-cyan-300" onChange={event => onChange(selected.id, { durationSec: Number((Number(event.target.value) - selected.startSec).toFixed(3)) })} /></label>
    </div> : null}
    <p hidden={compact} className="text-[11px] leading-relaxed text-white/40">时间段直接对应渲染参数；调整后保存或生成候选查看实际效果。</p>
  </div>;
}
