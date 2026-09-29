import {z} from "zod";
import type {ManhuaPrevisSpec} from "../../shared/manhuaPrevis";
import {previsCameraProgress} from "../../shared/manhuaPrevisCameraTiming";
const point=z.tuple([z.number().finite(),z.number().finite(),z.number().finite()]);
export const cameraTimingReportSchema=z.array(z.object({frame:z.number().int(),shotIndex:z.number().int(),position:point,forward:point,lens:z.number().finite()}).strict()).max(720);
export function validateCameraTimingReport(raw:z.infer<typeof cameraTimingReportSchema>|undefined,spec:ManhuaPrevisSpec){
  if(!spec.cameras.some(c=>c.motionWindow||c.lensWindow)&&!raw)return;
  if(!raw||raw.length!==spec.durationSec*24)throw Error("运镜卡点逐帧回执缺失");
  for(let i=0;i<raw.length;i++){
    const frame=i+1, index=spec.cameras.findIndex(c=>frame>Math.round(c.startSec*24)&&frame<=Math.round(c.endSec*24));
    const c=spec.cameras[index],s=raw[i];if(!c||s.frame!==frame||s.shotIndex!==index)throw Error("运镜卡点帧归属错误");
    const u=previsCameraProgress(c,frame,c.motionWindow),v=previsCameraProgress(c,frame,c.lensWindow);
    const mix=(a:number[],b:number[])=>a.map((x,j)=>x+(b[j]-x)*u);
    let p=mix(c.position,c.endPosition??c.position),t=mix(c.target,c.endTarget??c.target);
    if(c.orbitDeg!==undefined){const angle=c.orbitDeg*Math.PI/180*u,x=c.position[0]-c.target[0],y=c.position[1]-c.target[1];p=[c.target[0]+x*Math.cos(angle)-y*Math.sin(angle),c.target[1]+x*Math.sin(angle)+y*Math.cos(angle),c.position[2]+(c.orbitRise??0)*u];t=c.target;}
    const d=t.map((x,j)=>x-p[j]),length=Math.hypot(...d),lens=c.lens+((c.endLens??c.lens)-c.lens)*v;
    if(s.position.some((x,j)=>Math.abs(x-p[j])>1e-4)||s.forward.some((x,j)=>Math.abs(x-d[j]/length)>1e-4)||Math.abs(s.lens-lens)>1e-3)throw Error("实际运镜或变焦未遵守卡点秒窗");
  }
}
