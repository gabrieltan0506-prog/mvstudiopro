import { z } from "zod";
import { storyPropAnchorSchema, type PrevisStoryProp } from "../../shared/manhuaPrevisStoryProps";
const n=z.number().finite();
export const storyPropsReportSchema=z.array(z.object({
  id:z.string().min(1),kind:z.enum(["needle","blood_drop","bowl","sleeve_glow","knife","jar"]),
  samples:z.array(z.object({frame:z.number().int().min(1).max(720),position:z.tuple([n,n,n]),visible:z.boolean(),fromAnchor:storyPropAnchorSchema,toAnchor:storyPropAnchorSchema,progress:n.min(0).max(1),gripResidual:n.min(0).max(.005).optional(),fillLevel:n.min(0).max(1).optional()}).strict()).min(48).max(720),
}).strict()).max(32);
function segment(keys:PrevisStoryProp["keyframes"],t:number) {
 if(t<=keys[0].timeSec)return {left:keys[0],right:keys[0],u:0};
 for(let i=0;i<keys.length-1;i++)if(t<keys[i+1].timeSec-1e-8)return {left:keys[i],right:keys[i+1],u:(t-keys[i].timeSec)/(keys[i+1].timeSec-keys[i].timeSec)};
 return {left:keys[keys.length-1],right:keys[keys.length-1],u:0};
}
export function validateStoryPropsReport(raw:z.infer<typeof storyPropsReportSchema>|undefined,spec:{durationSec:number;storyProps?:PrevisStoryProp[];actors:{id:string;visibleRanges?:{startSec:number;endSec:number}[]}[]}) {
 const props=spec.storyProps??[];
 if((raw?.length??0)!==props.length || new Set(raw?.map(r=>r.id)).size!==(raw?.length??0))throw Error("剧情道具逐帧回执数量或身份不一致");
 for(const prop of props){
  const row=raw!.find(r=>r.id===prop.id);
  if(!row || row.kind!==prop.kind || row.samples.length!==spec.durationSec*24)throw Error("剧情道具逐帧回执缺失或类型不一致");
  row.samples.forEach((sample,i)=>{
   const {left,right,u}=segment(prop.keyframes,i/24);
   if(sample.frame!==i+1 || sample.position.some(v=>!Number.isFinite(v)) || Math.abs(sample.progress-u)>1e-6 || JSON.stringify(sample.fromAnchor)!==JSON.stringify(left.anchor) || JSON.stringify(sample.toAnchor)!==JSON.stringify(right.anchor))throw Error("剧情道具回执时间或骨锚点不一致");
   if(left.anchor.type==="world" && right.anchor.type==="world"){const a=left.anchor.position,b=right.anchor.position;if(sample.position.some((v,j)=>Math.abs(v-(a[j]*(1-u)+b[j]*u))>1e-5))throw Error("台面道具位置与固定世界锚点不一致");}
   if(["bowl","jar"].includes(prop.kind) && (sample.fillLevel===undefined || Math.abs(sample.fillLevel-(left.fill*(1-u)+right.fill*u))>1e-6))throw Error("碗内血液量与本次状态不一致");
   if(prop.grip && i/24>=(prop.grip.startSec??0) && i/24<(prop.grip.endSec??spec.durationSec) && sample.visible && sample.gripResidual===undefined)throw Error("端碗缺少真实手腕接触回执");
   const anchorVisible=(anchor:typeof left.anchor)=>{
    if(anchor.type==="world")return true;
    if(anchor.type==="prop")return raw!.find(r=>r.id===anchor.propId)?.samples[i]?.visible??false;
    const actor=spec.actors.find(a=>a.id===anchor.actorId);
    if(!actor)throw Error("剧情道具回执引用不存在的演员");
    return !actor.visibleRanges || actor.visibleRanges.some(range=>Math.round(range.startSec*24)<sample.frame && sample.frame<=Math.round(range.endSec*24));
   };
   const expectedVisible=left.visible && anchorVisible(left.anchor) && (u===0 || anchorVisible(right.anchor));
   if(sample.visible!==expectedVisible)throw Error("剧情道具显隐与本次秒窗不一致，存在提前显现或应显示却消失");
  });
 }
}
