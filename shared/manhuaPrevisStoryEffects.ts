import { z } from "zod";
import type { PrevisStoryProp } from "./manhuaPrevisStoryProps";

const identity = { id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), actorId: z.string().min(1).max(100) };
const window = { startSec: z.number().finite().min(0).max(30), endSec: z.number().finite().positive().max(30) };
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
export const STORY_SCENE_EFFECT_KINDS = ["needle_trail", "acupoint_smoke", "complexion"] as const;
export const previsStorySceneEffectOptions = [
  z.object({ ...identity, ...window, kind: z.literal("needle_trail"), propId: z.string().min(1).max(80), color,
    radius: z.number().finite().min(.001).max(.02), trailSec: z.number().finite().min(1/24).max(.5) }).strict(),
  z.object({ ...identity, ...window, kind: z.literal("acupoint_smoke"), propId: z.string().min(1).max(80), color,
    radius: z.number().finite().min(.01).max(.12), rise: z.number().finite().min(.05).max(.6),
    density: z.number().finite().min(1).max(30),
    offset: z.tuple([z.number().finite().min(-.3).max(.3), z.number().finite().min(-.3).max(.3), z.number().finite().min(-.3).max(.3)]) }).strict(),
  z.object({ ...identity, ...window, kind: z.literal("complexion"), color,
    strength: z.number().finite().min(.01).max(.35) }).strict(),
] as const;
export const previsStorySceneEffectSchema = z.discriminatedUnion("kind", previsStorySceneEffectOptions);
export type PrevisStorySceneEffect = z.infer<typeof previsStorySceneEffectSchema>;
export function isStorySceneEffect(effect: {kind:string}): effect is PrevisStorySceneEffect {
  return (STORY_SCENE_EFFECT_KINDS as readonly string[]).includes(effect.kind);
}
export function storySceneEffectIssue(effect: PrevisStorySceneEffect, spec: {
  durationSec: number; actors: { id: string; shape: string; riggedModel?: unknown; visibleRanges?: {startSec:number;endSec:number}[] }[]; storyProps?: PrevisStoryProp[];
}): string | null {
  if (effect.startSec >= effect.endSec || effect.endSec > (spec.durationSec*24-1)/24 + 1e-8 ||
      [effect.startSec,effect.endSec].some(t => Math.abs(t*24-Math.round(t*24))>1e-6)) return "剧情特效须使用片内24帧对齐且有长度的时间窗，结束不晚于最后一帧";
  if(effect.kind==="acupoint_smoke" && effect.endSec-effect.startSec<.25-1e-8) return "针位黑气至少保留四分之一秒以呈现消散";
  if(effect.kind==="complexion" && effect.endSec-effect.startSec<.5-1e-8) return "气色渐变至少保留半秒，不能瞬间换色";
  const actor=spec.actors.find(a=>a.id===effect.actorId);
  if (!actor) return "剧情特效引用了不存在的角色";
  if (effect.kind === "complexion") return actor.shape!=="human" || !actor.riggedModel ? "气色渐变需要当前已绑定的人形模型与真实头颈权重" : null;
  const prop=spec.storyProps?.find(p=>p.id===effect.propId);
  if (!prop || prop.kind!=="needle") return "飞针特效须选择本段已存在的针，不能用名称或外部素材替代";
  const spans=prop.keyframes.slice(0,-1).map((left,i)=>({left,right:prop.keyframes[i+1]}))
    .filter(({left,right})=>left.timeSec<=effect.endSec && right.timeSec>effect.startSec);
  if (spans.some(({left,right})=>!left.visible || !right.visible)) return "飞针特效窗口不能覆盖隐藏的针";
  if (effect.kind === "acupoint_smoke" && spans.some(({left,right})=>
    [left,right].some(f=>f.anchor.type!=="bone" || f.anchor.actorId!==effect.actorId)))
    return "穴位黑气须在针已经落到该角色骨锚后开始，并保持同一角色落点";
  return null;
}
export const PREVIS_STORY_EFFECTS_HELP = "剧情特效同样放入sceneEffects：needle_trail{propId,startSec,endSec,color,radius(.001–.02米),trailSec(1/24–.5秒)}跟随本段已存在的needle道具形成连续短光尾；acupoint_smoke{propId,startSec,endSec,color,radius(.01–.12米),rise(.05–.6米),density(1–30),offset:[x,y,z]}在已落到actorId骨锚的针位发出有界体积黑气，offset为世界米制偏移±.3，用于贴近衣物表面，不能放在脸前遮挡表情；complexion{startSec,endSec,color,strength(.01–.35)}只在已绑骨人形模型的头颈权重区域逐渐叠加暖色并保持到片尾，保留原贴图和身份，不代替微表情或医疗真实性。每项仍须id、actorId；针尾和黑气必须引用本段真实propId，不能凭空创造针；同一针同种效果只能一项，不同针允许各自效果。剧情效果最多8项、片长沿原30秒/角色预算；旧披风/分件/全身材质/标注仍限4项、3人、8秒，不混用以绕过旧预算。全部起止须24帧对齐，结束不晚于(durationSec*24-1)/24；针尾窗只覆盖飞行，黑气窗从骨锚落针后开始，先冒黑气再渐暖，不以整个人变色或大黑球冒充。只提供预演参考，逐帧与常速实际审片后才能采用。";
