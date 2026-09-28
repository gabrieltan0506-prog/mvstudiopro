import { useState } from 'react';

export function ManhuaShotTimingEditor({ shotIndex, durationSec, segmentBreakBefore = false, disabled, onApply }: {
  shotIndex: number; durationSec: number; segmentBreakBefore?: boolean; disabled?: boolean;
  onApply: (shotIndex: number, durationSec: number, segmentBreakBefore: boolean) => void;
}) {
  const [value, setValue] = useState(String(durationSec));
  const [breakBefore, setBreakBefore] = useState(segmentBreakBefore);
  const [error, setError] = useState('');
  return <details className="mt-3 rounded-lg border border-white/15 p-3" data-manhua-shot-timing>
    <summary className="cursor-pointer text-sm">调整本镜时长</summary>
    <label className="mt-3 block text-xs">第{shotIndex}镜 · 秒
      <input aria-label="当前镜头时长" type="number" min="0.1" max="3600" step="0.001" value={value} disabled={disabled}
        className="mt-1 w-full rounded border border-white/20 bg-black/20 p-2 text-sm" onChange={event => setValue(event.target.value)} />
    </label>
    {shotIndex > 1 && <label className="mt-3 flex items-center gap-2 text-xs">
      <input aria-label="从本镜开始新制作片段" type="checkbox" checked={breakBefore} disabled={disabled}
        onChange={event => setBreakBefore(event.target.checked)} />从本镜开始新制作片段
    </label>}
    <p className="my-2 text-xs text-white/60">后续镜头顺延，保留原台词。保存后须重新确认剧本和分段；旧片段及其音轨保留为历史版本，新片段需重新核对音轨绑定。不会自动生成。</p>
    {error && <p role="alert" className="text-xs text-rose-200">{error}</p>}
    <button type="button" disabled={disabled || (Number(value) === durationSec && breakBefore === segmentBreakBefore)} className="min-h-11 rounded border border-cyan-300/30 px-3 text-sm disabled:opacity-40" onClick={() => {
      const seconds=Number(value);
      if (!value.trim() || !Number.isFinite(seconds) || seconds<0.1 || seconds>3600) { setError('请输入0.1–3600秒。'); return; }
      try { onApply(shotIndex,seconds,breakBefore);setError(''); } catch(error) {setError(error instanceof Error?error.message:'保存失败，原稿仍保留。');}
    }}>保存时长与制作片段切点</button>
  </details>;
}
