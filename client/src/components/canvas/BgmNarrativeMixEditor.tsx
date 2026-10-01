import { BGM_NARRATIVE_ROLES, type BgmNarrativeCue } from "@shared/manhuaBgmNarrativeMix";

/** 创作者给出音乐意图，工作台保存明确秒位和增益，不自动声称听审通过。 */
export function BgmNarrativeMixEditor({ value, onChange, entrySec, durationSec, baseGain }: {
  value: BgmNarrativeCue[]; onChange: (value: BgmNarrativeCue[]) => void;
  entrySec: number; durationSec?: number; baseGain: number;
}) {
  const patch = (index: number, update: Partial<BgmNarrativeCue>) =>
    onChange(value.map((cue, i) => i === index ? {...cue,...update} : cue));
  const field = (index: number, label: string, key: "startSec"|"endSec"|"gainStart"|"gainEnd") => <label className="text-xs text-white/70">{label}
    <input aria-label={`音乐段${index+1} ${label}`} type="number" step={key.includes("gain") ? 0.05 : 0.1}
      min={0} max={key.includes("gain") ? 1 : 3600} value={value[index][key]}
      onChange={event => patch(index,{[key]:Number(event.target.value)})} className="ml-1 w-20 rounded bg-black/30 p-1" />
  </label>;
  return <section aria-label="音乐叙事与强弱时间表" className="space-y-2 rounded border border-white/10 p-2">
    <p className="text-xs text-white/65">按剧情、眼神和表演安排音乐。每段可渐强、渐弱或留白；未设置段沿用原音量。速度沿用原曲，不整体变速。秒位与听感须对照完整视频确认。</p>
    {value.map((cue,index) => <div key={index} className="space-y-1 border-b border-white/10 pb-2">
      <div className="flex flex-wrap gap-2">{field(index,"开始秒","startSec")}{field(index,"结束秒","endSec")}{field(index,"起始强度","gainStart")}{field(index,"结束强度","gainEnd")}</div>
      <select aria-label={`音乐段${index+1} 叙事作用`} value={cue.role} className="rounded bg-black/30 p-1 text-xs"
        onChange={event => patch(index,{role:event.target.value as BgmNarrativeCue["role"], ...(event.target.value === "留白" ? {gainStart:0,gainEnd:0} : {})})}>
        {BGM_NARRATIVE_ROLES.map(role=><option key={role}>{role}</option>)}
      </select>
      <input aria-label={`音乐段${index+1} 剧情与表演依据`} value={cue.noteZh} maxLength={500}
        placeholder="如：娘望向伤马，音乐补充她的不忍" className="ml-2 rounded bg-black/30 p-1 text-xs"
        onChange={event=>patch(index,{noteZh:event.target.value})} />
      <button type="button" onClick={()=>onChange(value.filter((_,i)=>i!==index))} className="ml-2 text-xs text-white/60">移除此音乐段</button>
    </div>)}
    <button type="button" disabled={value.length>=20} className="text-xs text-cyan-300" onClick={()=>{
      const startSec = value.length ? Math.max(...value.map(cue=>cue.endSec)) : entrySec;
      onChange([...value,{startSec,endSec:Math.min(startSec+3,entrySec+(durationSec??3600)),gainStart:baseGain,gainEnd:baseGain,role:"支持表演",noteZh:""}]);
    }}>添加音乐强弱段</button>
  </section>;
}
