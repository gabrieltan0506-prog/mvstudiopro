import { ART_MOTION_GRAMMARS, ART_MOTION_STYLES } from "./artMotionCatalog";
import { MANHUA_VFX_KINDS, MANHUA_VFX_PRESET_LABELS } from "./manhuaVfx";
import { PREVIS_SCENE_EFFECT_LABELS } from "./manhuaPrevisSceneEffects";
import { MANHUA_ADVISOR_WORKFLOW_HELP } from "./manhuaAdvisorWorkflow";
/** Executable contracts, not provider marketing names. Change revision with supported operations. */
export const MANHUA_ADVISOR_CAPABILITIES = {
 revision:"2026-10-07-creative-studios-v3",
 workflowHelp:MANHUA_ADVISOR_WORKFLOW_HELP,
 creativeStudios:{artMotion:{grammars:ART_MOTION_GRAMMARS,styles:ART_MOTION_STYLES,standalone:true},imageWorld:{steps:["分析可见场景与独立物件","核对并保存方案","物件图与空场景底图","建立三维资产","查询候选并明确采用"]}},
 effects:{
  screen:MANHUA_VFX_KINDS.map(id=>({id,label:MANHUA_VFX_PRESET_LABELS[id]})),
  scene:Object.entries(PREVIS_SCENE_EFFECT_LABELS).map(([id,label])=>({id,label})),
  title:{positions:["顶部","居中","底部"],plainText:true},
  transition:["直接切换","交叉淡化","溶解","向左擦除"],
  generative:["自定义修改","角色变身","灵体与材质","环境重构","风格化冲击"],
  boundaries:["屏幕特效与叠图按手工轨迹，未实现实拍自动追踪或人物遮挡","布料、分件、材质与标注属于三维白模场景参考，正式生成结果需审片","分件只展开已有独立部件，不补造内部结构","生成式修改沿原视频编辑模型、确认、费用、任务与候选，不提供精准视频遮罩","inspect只读，configure填参，submit提交候选；只有明确adopt且原门禁通过才采用"],
 },
} as const;
