import type { CanvasAudioCue } from "@shared/canvasAudioStudio";
export function CanvasAudioMixControls({ cue, disabled, onChange }: { cue: CanvasAudioCue; disabled?: boolean; onChange: (patch: Partial<CanvasAudioCue>) => void }) {
 const mix = cue.mix || { duckUnderDialogue: false, duckVolume: 0.3, silenceWindows: [] };
 const field = "w-20 rounded border border-white/20 bg-black/20 px-1 text-xs";
 return <details data-audio-mix-controls={cue.id} className="rounded border border-white/10 p-2">
  <summary className="cursor-pointer text-xs">留白与对白避让 · 合听／预混</summary>
  <label className="mt-2 block text-xs"><input type="checkbox" disabled={disabled} checked={mix.duckUnderDialogue} onChange={e=>onChange({mix:{...mix,duckUnderDialogue:e.target.checked}})}/>对白实际发声期间降低本轨音量</label>
  {mix.duckUnderDialogue && <label className="block text-xs">避让音量比例 <input aria-label="避让音量比例" className={field} type="number" step="0.05" min="0" max="1" disabled={disabled} value={mix.duckVolume} onChange={e=>onChange({mix:{...mix,duckVolume:Number(e.target.value)}})}/></label>}
  {mix.silenceWindows.map((window,i)=><div key={i} className="mt-1 flex flex-wrap items-center gap-1 text-xs">本轨留白
   {(["startSec","endSec"] as const).map(key=><label key={key}>{key==="startSec"?"起":"止"}<input aria-label={key==="startSec"?"留白开始秒":"留白结束秒"} className={field} type="number" step="0.1" min={cue.startSec} max={cue.endSec} disabled={disabled} value={window[key]} onChange={e=>onChange({mix:{...mix,silenceWindows:mix.silenceWindows.map((w,n)=>n===i?{...w,[key]:Number(e.target.value)}:w)}})}/></label>)}
   <button type="button" disabled={disabled} onClick={()=>onChange({mix:{...mix,silenceWindows:mix.silenceWindows.filter((_,n)=>n!==i)}})}>删除留白</button>
  </div>)}
  <button type="button" className="mt-1 text-xs text-sky-200" disabled={disabled||mix.silenceWindows.length>=20||cue.endSec<=cue.startSec} onClick={()=>onChange({mix:{...mix,silenceWindows:[...mix.silenceWindows,{startSec:cue.startSec,endSec:Math.min(cue.endSec,cue.startSec+0.5)}]}})}>添加本轨留白</button>
  <p className="mt-1 text-[10px] text-white/50">只处理本轨，保留对白与其他音轨。用于实际合听和预混；修改后重新采用原候选即可，不重复购买声音。</p>
 </details>;
}
