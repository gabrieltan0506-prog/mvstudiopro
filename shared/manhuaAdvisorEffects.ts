import { z } from "zod";
import { manhuaVfxEffectSchema } from "./manhuaVfx";
import { previsSceneEffectsSchema } from "./manhuaPrevisSceneEffects";
export const ADVISOR_EFFECTS_TOOLS = ["vfx", "scene", "title", "transition", "generative"] as const;
export type AdvisorEffectsTool = typeof ADVISOR_EFFECTS_TOOLS[number];
const sourceId=z.string().trim().min(1).max(512);
export const advisorVfxRecipeSchema=z.object({version:z.literal(1),seed:z.number().int().min(0).max(2147483647),effects:z.array(manhuaVfxEffectSchema.omit({imageUri:true}).extend({imageId:sourceId.optional()}).strict()).min(1).max(12)}).strict();
export const advisorEffectsActionSchema=z.object({
 action:z.literal("effects"),tool:z.enum(ADVISOR_EFFECTS_TOOLS),operation:z.enum(["inspect","configure","submit","adopt","resume"]),
 sourceKey:z.string().min(1).max(160).optional(),clipId:sourceId.optional(),sourceIds:z.array(sourceId).min(1).max(6).optional(),requestId:z.string().uuid().optional(),
 vfxRecipe:advisorVfxRecipeSchema.optional(),sceneEffects:previsSceneEffectsSchema.optional(),
 titleSettings:z.object({text:z.string().trim().min(1).max(120),startSec:z.number().finite().min(0),endSec:z.number().finite().positive(),fontSize:z.number().int().min(8).max(96),alignment:z.union([z.literal(2),z.literal(5),z.literal(8)])}).strict().optional(),
 transitionSettings:z.object({kind:z.enum(["none","fade","dissolve","wipeleft"]),durationSec:z.number().finite().min(.1).max(2),resolution:z.enum(["720p","1080p"]),aspect:z.enum(["9:16","16:9"])}).strict().optional(),
 generativeSettings:z.object({presetId:z.enum(["custom","transformation","spirit","environment","stylized"]),target:z.string().max(60),instruction:z.string().trim().min(1).max(240),startSec:z.number().finite().min(0).optional(),endSec:z.number().finite().positive().optional()}).strict().optional(),
}).strict();
export type AdvisorEffectsAction=z.infer<typeof advisorEffectsActionSchema>;
export type AdvisorEffectsControl=(action:AdvisorEffectsAction,signal:AbortSignal)=>Promise<string>;
export type AdvisorEffectsRegistration=(scopeKey:string,tool:AdvisorEffectsTool,control:AdvisorEffectsControl|null)=>void;
export function validateAdvisorEffectsAction(value:AdvisorEffectsAction,ctx:z.RefinementCtx){
 const bad=(message:string)=>ctx.addIssue({code:"custom",message});
 const allowed=new Set<string>(["action","tool","operation","sourceKey",...(["scene","generative"].includes(value.tool)?["clipId"]:[])]);
 if(value.operation==="configure"){
  allowed.add({vfx:"vfxRecipe",scene:"sceneEffects",title:"titleSettings",transition:"transitionSettings",generative:"generativeSettings"}[value.tool]);
  if(["vfx","title","transition"].includes(value.tool))allowed.add("sourceIds");
 }
 if(["adopt","resume"].includes(value.operation))allowed.add("requestId");
 for(const field of Object.keys(value))if(!allowed.has(field))bad("该字段不属于本次操作，请先配置再单独提交");
 if(value.titleSettings&&value.titleSettings.endSec<=value.titleSettings.startSec)bad("标题结束时间必须晚于开始时间");
 if(value.generativeSettings){const g=value.generativeSettings;if((g.startSec===undefined)!==(g.endSec===undefined)||(g.startSec!==undefined&&g.endSec!<=g.startSec))bad("生成式时窗须成对且结束晚于开始");}

 if(value.operation!=="inspect"&&!value.sourceKey)bad("修改前须先读取本工具当前sourceKey");
 if(value.operation==="configure"){
  const field={vfx:"vfxRecipe",scene:"sceneEffects",title:"titleSettings",transition:"transitionSettings",generative:"generativeSettings"}[value.tool];
  if(!(value as Record<string,unknown>)[field])bad("配置缺少本工具参数");
  if(["vfx","title"].includes(value.tool)&&value.sourceIds?.length!==1)bad("请选择一个当前来源编号");
  if(value.tool==="transition"&&(!value.sourceIds||value.sourceIds.length<2))bad("转场至少选择两个当前来源编号");
 }
 if(["scene","generative"].includes(value.tool)&&value.operation!=="inspect"&&!value.clipId)bad("请选择当前片段编号");
 if(["adopt","resume"].includes(value.operation)&&!value.requestId)bad("采用或续查须携带原请求编号");
 if(["adopt","resume"].includes(value.operation)&&!["vfx","scene"].includes(value.tool))bad("本工具沿已有候选入口采用或续查");
 for(const field of ["vfxRecipe","sceneEffects","titleSettings","transitionSettings","generativeSettings"] as const){
  const expected={vfxRecipe:"vfx",sceneEffects:"scene",titleSettings:"title",transitionSettings:"transition",generativeSettings:"generative"}[field];
  if(value[field]!==undefined&&(value.operation!=="configure"||value.tool!==expected))bad("参数与本次工具操作不一致");
 }
}
export const MANHUA_ADVISOR_EFFECTS_HELP="effects工具：tool=vfx屏幕特效与图片叠加/scene白模布料分件材质骨骼标注/title片内标题/transition转场拼接/generative生成式视频修改。先operation=inspect取得实时素材ID、表单、候选、sourceKey；configure填写对应vfxRecipe、sceneEffects、titleSettings、transitionSettings或generativeSettings。图片叠加只填inspect的imageId，视频只填sourceIds或clipId，不接外部URL。每次修改后重新inspect，submit/adopt/resume必须原样携带本次sourceKey；adopt/resume用原requestId。生成和采用保留原确认、计费、保存与恢复门禁；候选成功不等于已采用或验收，未知回执只续查原号。";
