import { previsPanelGripAmount } from "../../shared/manhuaPrevisStoryProps";
import { PREVIS_PROXY_PROP_KINDS, isPrevisProxyProp, previsProxyColorSchema } from "../../shared/manhuaPrevisProxy";
import { z } from "zod";
import { storyPropAnchorSchema, type PrevisStoryProp } from "../../shared/manhuaPrevisStoryProps";
const n=z.number().finite();
export const storyPropsReportSchema=z.array(z.object({
  id:z.string().min(1),kind:z.enum(["needle","blood_drop","bowl","sleeve_glow","knife","jar",...PREVIS_PROXY_PROP_KINDS]),
  samples:z.array(z.object({frame:z.number().int().min(1).max(720),position:z.tuple([n,n,n]),visible:z.boolean(),fromAnchor:storyPropAnchorSchema,toAnchor:storyPropAnchorSchema,progress:n.min(0).max(1),workflowState:z.object({fragmentCount:z.literal(48),fragmentsVisible:z.number().int().min(0).max(48),chairPartsVisible:z.number().int().min(0).max(6),textVisible:z.boolean(),targetMaxError:n.nonnegative()}).strict().optional(),gripResidual:n.min(0).max(.005).optional(),gripAmount:n.min(0).max(1).optional(),fillLevel:n.min(0).max(1).optional(),proxyGeometry:z.object({meshVertices:z.number().int().positive(),meshes:z.array(z.string().min(1)).min(1).max(64),minimum:z.tuple([n,n,n]),maximum:z.tuple([n,n,n]),color:previsProxyColorSchema}).strict().optional()}).strict()).min(48).max(720),
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
  if(!row || row.kind!==prop.kind || row.samples.length!==Math.round(spec.durationSec * 24))throw Error("剧情道具逐帧回执缺失或类型不一致");
  row.samples.forEach((sample,i)=>{
   const {left,right,u}=segment(prop.keyframes,i/24);
   if(isPrevisProxyProp(prop.kind)) {
     const geometry=sample.proxyGeometry;
     if(!geometry || !prop.proxy || geometry.color.some((v,j)=>Math.abs(v-prop.proxy!.color[j])>1e-5) || geometry.minimum.some((v,j)=>v>geometry.maximum[j])) throw Error("几何剧情对象没有对应的实际网格、尺寸或颜色回执");
     if(sample.visible && geometry.minimum.every((v,j)=>Math.abs(v-geometry.maximum[j])<1e-6)) throw Error("可见几何剧情对象退化为空尺寸");
   } else if(sample.proxyGeometry) throw Error("旧剧情道具不能混入其他几何回执");
   if(sample.frame!==i+1 || sample.position.some(v=>!Number.isFinite(v)) || Math.abs(sample.progress-u)>1e-6 || JSON.stringify(sample.fromAnchor)!==JSON.stringify(left.anchor) || JSON.stringify(sample.toAnchor)!==JSON.stringify(right.anchor))throw Error("剧情道具回执时间或骨锚点不一致");
   if(left.anchor.type==="world" && right.anchor.type==="world"){const a=left.anchor.position,b=right.anchor.position;if(sample.position.some((v,j)=>Math.abs(v-(a[j]*(1-u)+b[j]*u))>1e-5))throw Error("台面道具位置与固定世界锚点不一致");}
   if(["bowl","jar"].includes(prop.kind) && (sample.fillLevel===undefined || Math.abs(sample.fillLevel-(left.fill*(1-u)+right.fill*u))>1e-6))throw Error("碗内血液量与本次状态不一致");
   if(prop.grip && i/24>=(prop.grip.startSec??0) && i/24<(prop.grip.endSec??spec.durationSec) && sample.visible && sample.gripResidual===undefined)throw Error("端碗缺少真实手腕接触回执");
   if((prop.kind==="information_panel" || prop.kind==="bullet") && prop.grip && sample.visible && i/24>=(prop.grip.startSec??0) && i/24<(prop.grip.endSec??spec.durationSec)) {
    const expected=previsPanelGripAmount(prop.grip.startSec??0,prop.grip.endSec??spec.durationSec,i/24);
    if(sample.gripAmount===undefined || Math.abs(sample.gripAmount-expected)>1e-6)throw Error("道具手部接触缺少实际渐入渐出权重");
   }
   const anchorVisible=(anchor:typeof left.anchor)=>{
    if(anchor.type==="world")return true;
    if(anchor.type==="prop")return raw!.find(r=>r.id===anchor.propId)?.samples[i]?.visible??false;
    const actor=spec.actors.find(a=>a.id===anchor.actorId);
    if(!actor)throw Error("剧情道具回执引用不存在的演员");
    return !actor.visibleRanges || actor.visibleRanges.some(range=>Math.round(range.startSec*24)<sample.frame && sample.frame<=Math.round(range.endSec*24));
   };
   if (prop.kind === "chair_burst_text") {
     const burst = prop.proxy!.burst!, state = sample.workflowState, t = i / 24;
     const fragments = sample.visible && t >= burst.startSec && t < burst.gatherEndSec;
     const chair = sample.visible && t < burst.startSec, text = sample.visible && t >= burst.gatherEndSec;
     if (!state || state.fragmentCount !== 48 || state.fragmentsVisible !== (fragments ? 48 : 0) || state.chairPartsVisible !== (chair ? 6 : 0) || state.textVisible !== text || (t >= burst.gatherEndSec && state.targetMaxError > .00001))
       throw Error("爆椅聚字缺少完整碎片、显隐或聚字落点回执");
   } else if (sample.workflowState) throw Error("非爆椅对象混入聚字回执");
   const expectedVisible=left.visible && anchorVisible(left.anchor) && (u===0 || anchorVisible(right.anchor));
   if(sample.visible!==expectedVisible)throw Error("剧情道具显隐与本次秒窗不一致，存在提前显现或应显示却消失");
  });
 }
}
