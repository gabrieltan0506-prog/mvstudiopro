import type { CanvasBlock } from "@/lib/canvasTypes";
import type { ManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { buildManhuaPrevisAudio } from "@shared/manhuaPrevisAudio";
import { manhuaPrevisSpecSchema } from "@shared/manhuaPrevis";

export function ManhuaPrevisAudioControls({ block, disabled, onChange, compact, onOpenAudio }: { block: CanvasBlock; disabled?: boolean; onChange: (studio: ManhuaPrevisStudio) => void; compact?: boolean; onOpenAudio?: () => void }) {
  const studio = block.previsStudio;
  if (!studio) return null;
  let summary = "本次选择无声动作试看";
  if (studio.audioEnabled === true) {
    try {
      const plan = buildManhuaPrevisAudio(block.audioStudio, manhuaPrevisSpecSchema.parse(studio.spec), studio.audioStartSec ?? 0, studio.loopBgm ?? false);
      summary = `本次对白 ${plan.dialogueCount} 句 · BGM ${plan.bgmCount} 条 · 取本段 ${plan.startSec}—${plan.startSec + plan.durationSec} 秒`;
    } catch (error) { summary = error instanceof Error ? error.message : "请核对本段音轨"; }
  }
  const choice = <label className="flex items-start gap-2"><input aria-label="白模带上已采用的对白与BGM" type="checkbox" checked={studio.audioEnabled === true} disabled={disabled || Boolean(studio.pending)} onChange={e => onChange({ ...studio, audioEnabled: e.target.checked })} />{compact ? "带上已采用的对白与BGM" : "白模带上已采用的对白与BGM"}</label>;
  if (compact) return <section aria-label="顾问白模音轨选择" className="flex flex-wrap items-center justify-between gap-2 text-xs text-cyan-50">
    {choice}{onOpenAudio && <button type="button" disabled={disabled || Boolean(studio.pending)} onClick={onOpenAudio} className="underline disabled:opacity-40">绑定音轨</button>}
  </section>;
  return <section aria-label="白模音画设置" className="my-3 space-y-2 rounded border border-cyan-300/25 p-3 text-xs text-cyan-50">
    {choice}
    <label className="flex items-center gap-2">音轨从本段第<input aria-label="白模音轨起始秒" type="number" min={0} max={3600} step={.001} value={studio.audioStartSec ?? 0} disabled={disabled || Boolean(studio.pending)} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value) && value >= 0 && value <= 3600) onChange({ ...studio, audioStartSec: value }); }} className="w-20 rounded border border-white/20 bg-slate-900 p-1" />秒开始</label>
    <label className="flex gap-2"><input type="checkbox" checked={studio.loopBgm ?? false} disabled={disabled || Boolean(studio.pending)} onChange={e => onChange({ ...studio, loopBgm: e.target.checked })} />BGM不足设定秒窗时循环衔接（对白不循环）</label>
    <p role="status">{summary}</p>
    <p className="text-white/60">默认先做无声动作试看；需要声音时勾选并采用本段音轨。保留24帧、运镜和动作时序，不会自动生成新配音。</p>
  </section>;
}
