import { z } from "zod";

const vec3 = z.tuple([z.number().finite().min(-10).max(10), z.number().finite().min(-10).max(10), z.number().finite().min(-10).max(10)]);
const id = z.string().min(1).max(80);
/** offset 使用米为单位的骨局部方向；落针后保持同一锚点，不朝施术者重算落点。 */
export const storyPropAnchorSchema = z.discriminatedUnion("type", [
  z.object({ type:z.literal("bone"), actorId:id, bone:z.enum(["body","spine","head","neck","hand-1","hand1","lower_leg-1","lower_leg1","lower_leg0","lower_leg2","lower_leg3"]), along:z.number().finite().min(0).max(1).default(1), offset:vec3.default([0,0,0]) }).strict(),
  z.object({ type:z.literal("prop"), propId:id, offset:vec3.default([0,0,0]) }).strict(),
  z.object({ type:z.literal("world"), position:vec3 }).strict(),
]);
export const storyPropKeyframeSchema = z.object({
  timeSec:z.number().finite().nonnegative(), anchor:storyPropAnchorSchema,
  visible:z.boolean().default(true), scale:z.number().finite().min(.05).max(3).default(1),
  rotation:vec3.default([0,0,0]),
  fill:z.number().finite().min(0).max(1).default(0),
}).strict();
export const previsStoryPropSchema = z.object({
  id, kind:z.enum(["needle","blood_drop","bowl","sleeve_glow","knife","jar"]),
  keyframes:z.array(storyPropKeyframeSchema).min(2).max(100),
  grip:z.object({actorId:id,hand:z.enum(["hand-1","hand1"]),offset:vec3.default([0,0,-.02]),startSec:z.number().finite().nonnegative().optional(),endSec:z.number().finite().nonnegative().optional()}).strict().optional(),
}).strict();
export const previsStoryPropsSchema = z.array(previsStoryPropSchema).max(32);
export type PrevisStoryProp = z.infer<typeof previsStoryPropSchema>;
export type StoryPropAnchor = z.infer<typeof storyPropAnchorSchema>;
export function storyPropsIssue(props:PrevisStoryProp[] | undefined, actors:{id:string;shape:string}[], durationSec:number):string|null {
  const preceding = new Set<string>();
  const occupiedHands: {id:string;start:number;end:number}[] = [];
  for (const prop of props ?? []) {
    if (preceding.has(prop.id)) return `剧情道具 ID 重复：${prop.id}`;
    if(prop.grip){
      const holder=actors.find(a=>a.id===prop.grip!.actorId);
      const handId=prop.grip.actorId+"/"+prop.grip.hand;
      if(!["bowl","jar","knife"].includes(prop.kind) || !holder || holder.shape!=="human")return "道具握持只允许绑定真实存在的人形演员";
      const start=prop.grip.startSec??0,end=prop.grip.endSec??durationSec;
      if((prop.grip.startSec===undefined)!==(prop.grip.endSec===undefined) || start>=end || end>durationSec || [start,end].some(t=>Math.abs(t*24-Math.round(t*24))>1e-6))return "道具握持须成对提供片内24帧对齐的起止秒位";
      if(occupiedHands.some(h=>h.id===handId && h.start<end && h.end>start))return "同一只手的道具握持窗口不能重叠";
      occupiedHands.push({id:handId,start,end});
    }
    const frames=prop.keyframes;
    if(frames[0].timeSec!==0 || Math.abs(frames[frames.length-1].timeSec-durationSec)>1e-6) return `道具 ${prop.id} 必须明确整段首尾状态`;
    for(let i=0;i<frames.length;i++) {
      const f=frames[i];
      if(f.timeSec>durationSec || Math.abs(f.timeSec*24-Math.round(f.timeSec*24))>1e-6 || (i>0 && f.timeSec<=frames[i-1].timeSec)) return `道具 ${prop.id} 的关键帧须按24帧严格递增且不超片长`;
      const a=f.anchor;
      if(a.type==="prop") {
        if(!preceding.has(a.propId)) return `道具 ${prop.id} 只能绑定已声明的道具，禁止自引用或循环`;
      } else if(a.type==="bone") {
        const actor=actors.find(row=>row.id===a.actorId);
        if(!actor) return `道具 ${prop.id} 绑定不存在的演员 ${a.actorId}`;
        const horseBones=["body","head","neck","lower_leg0","lower_leg1","lower_leg2","lower_leg3"];
        const humanBones=["spine","neck","head","hand-1","hand1","lower_leg-1","lower_leg1"];
        if(!(actor.shape==="horse"?horseBones:humanBones).includes(a.bone)) return `道具 ${prop.id} 的骨名不适用于演员 ${a.actorId}`;
      }
    }
    preceding.add(prop.id);
  }
  return null;
}
