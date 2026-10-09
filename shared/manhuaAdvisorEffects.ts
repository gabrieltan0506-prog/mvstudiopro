import { validateManhuaVfxEffectParameters, validateManhuaVfxLayerOrder } from "./manhuaVfx";
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
 for(const effect of value.vfxRecipe?.effects || [])validateManhuaVfxEffectParameters(effect,bad);
 if(value.vfxRecipe)validateManhuaVfxLayerOrder(value.vfxRecipe.effects,bad);
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
export const MANHUA_ADVISOR_VFX_WORKBENCH_HELP = "mirror_corridor使用roi和mirror(layers整数2–8、shrink .45–.85、drift 0–.08)，递归缩小与交替镜像原片，不重建三维镜廊。floating_paper使用paper(count整数6–64、size .015–.12、drift 0–.6、flutter 0–4、spread .1–1.5)，程序纸页叠加，不改变角色重力或遮挡；纸页颜色与种子、两个效果的挂点/强度/时间窗实际参与渲染。两个效果在重叠叠加层前处理。流动字符层(digital_rain)可在数字雨与咒语符号墙之间切换：rain.glyphSet=hex/ritual/custom，自定义须填characters(1–64个无空白字符)，layout=rain/wall，direction=down/up/left/right，glyphRate=0–20次/秒。字形使用实际几何与可验证字体，无字形时明确失败。rain可设columns整数8–36、speed每秒画面高度0.05–1、trail整数4–16；省略rain时为24列、0.28速度、12字符。颜色、强度、大小、时间窗、种子和手动轨迹沿同一方案保存，不支持人物遮挡或自动跟踪。特效工作台实际操作：选择当前作品原片，添加效果；同一原片的同一方案最多12层效果，每层单独设置时窗与轨迹，点击一次渲染特效候选会合成该方案全部效果，不应把剑气和护盾等多层效果拆成多次付费渲染；参数时间轴修改效果开始和结束秒位，播放秒位只定位原片。暂停原片后手动定位挂点，用当前秒位添加轨迹点；至少两个时刻形成手动轨迹，关键秒位按钮可定位，挂点按相邻点线性移动。原片上的挂点和轨迹线只是位置参考，不是完整特效画面；完整特效必须渲染特效候选后才能预览。候选预览播放的是已经渲染出的真实结果文件，采用只是选用并保存该候选，不会再渲染一个更完整版本；应先看实际候选再决定采用，不能说采用后才能验看特效。展开工作台使用页面内全屏，不依赖浏览器全屏许可；创作顾问和候选预览保留在工作台内，收起回原位置并保留本次草稿。候选完成后可预览候选、与原片比较，两路可一起从头播放并选择单路声音，但不保证逐帧同步。比较不触发生成也不代表采用；明确采用且来源/方案门禁通过后才进入后续工序，原片保留。修改后须点击保存方案并收到保存成功回执，才能说方案已入当前作品；未保存编辑不能承诺刷新后保留。已有任务/候选沿当前项目保存和恢复，未知提交只续查原请求，不重新渲染。bullet_wave须填wave参数，挂点是弹道起点，angleDeg角度0向右90向下，reach按画面高度设置前进距离，radius/rings/trailSec/refraction/glow控制真实原片折射环；手动轨迹平移弹道。directed_blast须填blast参数，angleDeg/spreadDeg/reach/particles/gravity/smoke/ignitionSec控制定向火团、火花、实体碎片和烟尘，不自动炸毁原片物体。liquid_mirror/ motion_ghost须填roi，分别填liquid/ghost参数；wall_fracture使用程序碎片墙体wall参数。bullet_time必须选择当前作品已成功的三维预演场景sceneJobId/sceneScopeId/clipId，冻结真实姿态后用透视相机环绕；绝不从二维原片做平面视差冒充。三维窗须与其他效果分开，像素效果与叠加层重叠时排在前面。当前不支持自动人物跟踪、前后遮挡或原片环境重照明；没有实际观看候选，不能声称画质或工作流已验收。面向用户按按钮名称说明，不堆砌内部操作名或指纹字段；执行工具仍须遵守下述字段合同。";
export const MANHUA_ADVISOR_EFFECTS_HELP=MANHUA_ADVISOR_VFX_WORKBENCH_HELP+"\n"+"effects工具：tool=vfx屏幕特效与图片叠加/scene白模布料分件材质骨骼标注/title片内标题/transition转场拼接/generative生成式视频修改。先operation=inspect取得实时素材ID、表单、候选、sourceKey；configure填写对应vfxRecipe、sceneEffects、titleSettings、transitionSettings或generativeSettings。图片叠加只填inspect的imageId，视频只填sourceIds或clipId，不接外部URL。每次修改后重新inspect，submit/adopt/resume必须原样携带本次sourceKey；adopt/resume用原requestId。生成和采用保留原确认、计费、保存与恢复门禁；候选成功不等于已采用或验收，未知回执只续查原号。";
