import type { PrevisHumanPosture } from "../../shared/manhuaPrevisHumanPosture";
import { z } from "zod";
import { PREVIS_MAX_ACTORS } from "../../shared/manhuaPrevisLimits";
const finite=z.number().finite();
export const humanPostureReportsSchema=z.array(z.object({actorId:z.string().min(1).max(100),frames:z.number().int().min(48).max(720),mode:z.enum(["hold","rise_to_sit"]),meshValidated:z.literal(false),normalSpeedValidated:z.literal(false),boundaryZh:z.string().max(1200),samples:z.array(z.object({frame:z.number().int().min(1).max(720),supportGap:finite,spineLeanRad:finite,maxBoneLengthError:finite,minFootZ:finite,maxFootZ:finite}).strict()).min(48).max(720)}).strict()).max(PREVIS_MAX_ACTORS);
type Actor = {id:string;humanPosture?:PrevisHumanPosture};
/** 坐卧回执必须来自每帧骨骼，不能用配置中的姿态名称充作测量。 */
export function validateHumanPostureReports(raw:unknown,actors:Actor[],durationSec:number) {
  const expected=actors.filter(a=>a.humanPosture);
  if(!expected.length){ if(raw!==undefined && (!Array.isArray(raw)||raw.length)) throw new Error("未请求坐卧却返回坐卧报告"); return []; }
  if(!Array.isArray(raw)||raw.length!==expected.length) throw new Error("坐卧报告角色不完整");
  const seen=new Set<string>();
  for(const value of raw){
    const actor=expected.find(a=>a.id===value?.actorId); const p=actor?.humanPosture;
    if(!actor||!p||seen.has(actor.id)||value.mode!==p.mode||value.frames!==durationSec*24||!Array.isArray(value.samples)||value.samples.length!==value.frames||value.meshValidated!==false||value.normalSpeedValidated!==false) throw new Error("坐卧报告身份、逐帧或验收边界错误");
    seen.add(actor.id);
    for(let i=0;i<value.samples.length;i++){
      const row=value.samples[i];
      if(row?.frame!==i+1||[row.supportGap,row.spineLeanRad,row.maxBoneLengthError,row.minFootZ,row.maxFootZ].some(v=>typeof v!=="number"||!Number.isFinite(v))) throw new Error("坐卧报告测量缺失");
      const u=p.mode==="rise_to_sit"?Math.max(0,Math.min(1,(i/24-p.startSec)/(p.endSec-p.startSec))):0;
      const lean=(p.mode==="hold"&&p.posture==="sit"?0:p.reclineDeg*Math.PI/180)*(p.mode==="rise_to_sit"?1-u*u*(3-2*u):1);
      if(Math.abs(row.supportGap)>.005||Math.abs(row.spineLeanRad-lean)>.01||row.maxBoneLengthError<0||row.maxBoneLengthError>.001||row.minFootZ<.064||row.maxFootZ>.13||row.minFootZ>row.maxFootZ) throw new Error("坐卧报告支撑、姿态、骨长或脚底不符");
    }
  }
  return raw;
}
