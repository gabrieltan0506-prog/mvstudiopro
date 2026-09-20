import { manhuaPresentationDurationSec, manhuaSourceToPresentationSec, type ManhuaShotTimeMap } from './manhuaActionPlanTiming';
import type { ManhuaPrevisSpec } from './manhuaPrevis';

/** 视频按24fps落盘；源动作与呈现时长不混用。 */
export function previsPlaybackFrames(spec: { durationSec: number; timeMap?: ManhuaShotTimeMap }) {
  return Math.round((spec.timeMap ? manhuaPresentationDurationSec(spec.timeMap) : spec.durationSec) * 24);
}
export function previsPlaybackDuration(spec: { durationSec: number; timeMap?: ManhuaShotTimeMap }) {
  return previsPlaybackFrames(spec) / 24;
}
/** 保持本段总时长，慢看选中区间，其他部分明确加速补偿。 */
export function previsFocusTimeMap(duration: number, start: number, end: number, rate: number): ManhuaShotTimeMap | null {
  if (![duration,start,end,rate].every(Number.isFinite) || start < 0 || end <= start || end > duration || rate <= 0 || rate > 8) return null;
  const span = end-start, remaining = duration-span/rate;
  if (remaining <= 0 || duration <= span) return null;
  const outsideRate = (duration-span)/remaining;
  if (outsideRate < .05 || outsideRate > 8) return null;
  return {sourceDurationSec:duration, spans:[
    ...(start > 0 ? [{sourceStartSec:0,sourceEndSec:start,rate:outsideRate}] : []),
    {sourceStartSec:start,sourceEndSec:end,rate},
    ...(end < duration ? [{sourceStartSec:end,sourceEndSec:duration,rate:outsideRate}] : []),
  ]};
}
/** 仅用于秒位文案：所有事件/机位共用已保存的时间映射。 */
export function previsPresentationGuideSpec(spec: ManhuaPrevisSpec): ManhuaPrevisSpec {
  if (!spec.timeMap) return spec;
  const t = (value: number) => Math.round(manhuaSourceToPresentationSec(spec.timeMap!, value)*100)/100;
  const {timeMap, ...rest} = spec;
  return {...rest, durationSec:previsPlaybackDuration(spec),
    actors:spec.actors.map(a=>({...a,moveStartSec:t(a.moveStartSec),moveEndSec:t(a.moveEndSec),
      actions:a.actions.map(x=>({...x,startSec:t(x.startSec),endSec:t(x.endSec)})),
      ...(a.motionRoute?{motionRoute:a.motionRoute.map(n=>({...n,timeSec:t(n.timeSec)}))}:{}),
      ...(a.creature?{creature:{...a.creature,transformStartSec:t(a.creature.transformStartSec),transformEndSec:t(a.creature.transformEndSec)}}:{}),
    })),
    cameras:spec.cameras.map(c=>({...c,startSec:t(c.startSec),endSec:t(c.endSec)})),
    ...(spec.interactions?{interactions:spec.interactions.map(e=>({...e,startSec:t(e.startSec),contactSec:t(e.contactSec),endSec:t(e.endSec)}))}:{}),
    ...(spec.effects?{effects:spec.effects.map(e=>({...e,startSec:t(e.startSec),durationSec:t(e.startSec+e.durationSec)-t(e.startSec)}))}:{}),
    ...(spec.waterEmergence?{waterEmergence:{...spec.waterEmergence,events:spec.waterEmergence.events.map(e=>({...e,crossSec:t(e.crossSec),riseSec:t(e.crossSec+e.riseSec)-t(e.crossSec),waveDurationSec:t(e.crossSec+e.waveDurationSec)-t(e.crossSec)}))}}:{}),
  };
}
/** 先提高时间戳精度再统一变速，避免24fps时间基提前截断快速区间；定帧后补足尾长。 */
export function previsPlaybackFilter(spec: {durationSec:number;timeMap?:ManhuaShotTimeMap}): string | undefined {
  if (!spec.timeMap?.spans.length) return;
  let offset=0;
  const rows=spec.timeMap.spans.map(s=>{
    const row={...s,offset}; offset+=(s.sourceEndSec-s.sourceStartSec)/s.rate; return row;
  });
  let expression=String(offset);
  for (const s of [...rows].reverse()) expression=`if(lt(PTS*TB\\,${s.sourceEndSec})\\,(${s.offset}+(PTS*TB-${s.sourceStartSec})/${s.rate})\\,${expression})`;
  return `settb=AVTB,setpts=(${expression})/TB,fps=24,tpad=stop_mode=clone:stop_duration=2,trim=end_frame=${previsPlaybackFrames(spec)},setpts=N/(24*TB)`;
}
