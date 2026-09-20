import {useEffect, useState} from 'react';
import type {ManhuaPrevisSpec} from '@shared/manhuaPrevis';
import {previsFocusTimeMap, previsPlaybackDuration} from '@shared/manhuaPrevisPlayback';

export function ManhuaPrevisTempoControls({spec,disabled,onChange}:{spec:ManhuaPrevisSpec;disabled?:boolean;onChange:(spec:ManhuaPrevisSpec)=>boolean}) {
  const [start,setStart]=useState(+(spec.durationSec*.2).toFixed(2));
  const [end,setEnd]=useState(+(spec.durationSec*.4).toFixed(2));
  const [rate,setRate]=useState(.5);
  const savedStart=spec.timeMap?.spans.find(s=>s.rate<1)?.sourceStartSec;
  const savedEnd=spec.timeMap?.spans.find(s=>s.rate<1)?.sourceEndSec;
  const savedRate=spec.timeMap?.spans.find(s=>s.rate<1)?.rate;
  useEffect(()=>{
    setStart(savedStart ?? +(spec.durationSec*.2).toFixed(2));
    setEnd(savedEnd ?? +(spec.durationSec*.4).toFixed(2));
    setRate(savedRate ?? .5);
  },[spec.durationSec,savedStart,savedEnd,savedRate]);
  const map=previsFocusTimeMap(spec.durationSec,start,end,rate);
  const field='w-16 rounded border border-white/20 bg-slate-900 px-1';
  return <fieldset disabled={disabled} className="space-y-2 rounded border border-white/15 p-2 text-xs" data-previs-tempo>
    <legend>快慢节奏</legend>
    <p>选择动作原时间中的重点区间慢看，其余动作加速，保持本段总时长。人物、特效和镜头一起变速；这不是人物静止而摄影机继续运动的子弹时间。</p>
    <div className="flex flex-wrap items-center gap-2">
      <label>从 <input aria-label="慢动作起点" type="number" min={0} max={spec.durationSec} step={1/24} value={start} onChange={e=>setStart(Number(e.target.value))} className={field}/></label>
      <label>到 <input aria-label="慢动作终点" type="number" min={0} max={spec.durationSec} step={1/24} value={end} onChange={e=>setEnd(Number(e.target.value))} className={field}/> 秒</label>
      <select aria-label="重点动作速度" value={rate} onChange={e=>setRate(Number(e.target.value))} className="bg-slate-900">{![.25,.5,.75].includes(rate)&&<option value={rate}>已保存 {rate.toFixed(2)} 倍速</option>}<option value={.5}>半速</option><option value={.25}>四分之一速</option><option value={.75}>四分之三速</option></select>
      <button type="button" disabled={disabled||!map} onClick={()=>map&&onChange({...spec,timeMap:map})}>应用快慢节奏</button>
      <button type="button" disabled={disabled||!spec.timeMap} onClick={()=>{const {timeMap,...rest}=spec;onChange(rest);}}>恢复常速</button>
    </div>
    {!map&&<p role="status">慢动作区间过长或超出本段，请缩短区间；不能为保留总时长而无限加速其他动作。</p>}
    {spec.timeMap&&<p>已保存：{spec.timeMap.spans.map(s=>`${s.sourceStartSec.toFixed(2)}—${s.sourceEndSec.toFixed(2)}秒 ×${s.rate.toFixed(2)}`).join('；')}。预演视频 {previsPlaybackDuration(spec).toFixed(2)} 秒；重新渲染后采用。</p>}
  </fieldset>;
}
