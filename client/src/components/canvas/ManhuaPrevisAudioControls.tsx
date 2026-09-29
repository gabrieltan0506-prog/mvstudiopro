import type { CanvasBlock } from "@/lib/canvasTypes";
import type { ManhuaPrevisStudio } from "@shared/manhuaPrevis";
import { buildManhuaPrevisAudio } from "@shared/manhuaPrevisAudio";
import { manhuaPrevisSpecSchema } from "@shared/manhuaPrevis";

export function ManhuaPrevisAudioControls({ block, disabled, onChange }: { block: CanvasBlock; disabled?: boolean; onChange: (studio: ManhuaPrevisStudio) => void }) {
  const studio = block.previsStudio;
  if (!studio) return null;
  let summary = "本次选择无声动作试看";
  if (studio.audioEnabled !== false) {
    try {
      const plan = buildManhuaPrevisAudio(block.audioStudio, manhuaPrevisSpecSchema.parse(studio.spec), studio.audioStartSec ?? 0, studio.loopBgm ?? false);
      summary = `本次对白 ${plan.dialogueCount} 句 · BGM ${plan.bgmCount} 条 · 取本段 ${plan.startSec}—${plan.startSec + plan.durationSec} 秒`;
    } catch (error) { summary = error instanceof Error ? error.message : "请核对本段音轨"; }
  }
  return <section aria-label="白模音画设置" className="my-3 space-y-2 rounded border border-cyan-300/25 p-3 text-xs text-cyan-50">
    <label className="flex gap-2"><input type="checkbox" checked={studio.audioEnabled !== false} disabled={disabled || Boolean(studio.pending)} onChange={e => onChange({ ...studio, audioEnabled: e.target.checked })} />白模带上已采用的对白与BGM</label>
    <label className="flex items-center gap-2">音轨从本段第<input aria-label="白模音轨起始秒" type="number" min={0} max={3600} step={.001} value={studio.audioStartSec ?? 0} disabled={disabled || Boolean(studio.pending)} onChange={e => { const value = e.currentTarget.valueAsNumber; if (Number.isFinite(value) && value >= 0 && value <= 3600) onChange({ ...studio, audioStartSec: value }); }} className="w-20 rounded border border-white/20 bg-slate-900 p-1" />秒开始</label>
    <label className="flex gap-2"><input type="checkbox" checked={studio.loopBgm ?? false} disabled={disabled || Boolean(studio.pending)} onChange={e => onChange({ ...studio, loopBgm: e.target.checked })} />BGM不足设定秒窗时循环衔接（对白不循环）</label>
    <p role="status">{summary}</p>
    <p className="text-white/60">试看使用较低清晰度，保留24帧、运镜和动作时序。修改音轨后需重新试看；不会自动生成新配音。</p>
  </section>;
}
