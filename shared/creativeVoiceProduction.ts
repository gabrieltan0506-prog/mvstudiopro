import { z } from "zod";
import { manhuaAdvisorWorkflowVariants } from "./manhuaAdvisorWorkflow";
export const creativeVoiceProductionSchema = z.discriminatedUnion("action", [
  ...manhuaAdvisorWorkflowVariants,
  z.object({action:z.literal("inspect")}).strict(),
  z.object({action:z.literal("prepareStoryboard"),episode:z.number().int().positive(),question:z.string().trim().min(2).max(1200)}).strict(),
  z.object({action:z.literal("applyStoryboard"),episode:z.number().int().positive()}).strict(),
  z.object({action:z.literal("restoreBackup")}).strict(),
  z.object({action:z.literal("media"),operation:z.enum(["inspect","previewImage","finishImage","resumeMedia","applyImage","editVideo","applyVideo"])}).strict(),
  z.object({action:z.literal("bgm"),operation:z.enum(["inspect","prepare","generate"]),clipId:z.string().min(1).max(200),question:z.string().trim().min(1).max(1200).optional()}).strict(),
  z.object({action:z.literal("applyEpisode"),episode:z.number().int().positive()}).strict(),
  z.object({action:z.literal("prepareEpisode"),episode:z.number().int().positive(),question:z.string().trim().min(2).max(1100)}).strict(),
  z.object({action:z.literal("applyPrevis")}).strict(),
  z.object({action:z.literal("retryPrevis")}).strict(),
  z.object({action:z.literal("world"),assetId:z.string().min(1).max(200),question:z.string().trim().min(2).max(1200).optional()}).strict(),
  z.object({action:z.literal("generateWorld")}).strict(),
  z.object({action:z.literal("retryWorld"),assetId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("assets")}).strict(),
  z.object({action:z.literal("image2d"),anchorId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("model3d"),assetId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("previs"),clipId:z.string().min(1).max(200)}).strict(),
  z.object({action:z.literal("renderPrevis"),question:z.string().trim().min(2).max(1200)}).strict(),
]).superRefine((value,ctx)=>{
  const rules: Record<string, Record<string, {required?:string[];allowed?:string[]}>> = {
    writer:{inspect:{},configure:{allowed:["topic","brief","templateId","episodeCount"]},trial:{},expand:{},confirm:{}},
    asset:{inspect:{},regenerate:{required:["anchorId","question"]},select:{required:["anchorId","libraryId"]},adopt:{},configure:{required:["assetId","metadata"]},claim:{required:["assetId","anchorIds"]},primary:{required:["assetId","anchorId","duty"]},acceptReview:{required:["assetId"]}},
    modelControl:{inspect:{required:["assetId"]},multiviewSubmit:{required:["assetId"]},multiview:{required:["assetId"]},rigInspect:{required:["assetId"],allowed:["requestId"]},rigSubmit:{required:["assetId"],allowed:["requestId"]},rigAdopt:{required:["assetId"],allowed:["requestId"]},rigRestore:{required:["assetId"],allowed:["requestId"]}},
    worldControl:{inspect:{allowed:["clipId"]},exportFrame:{required:["assetId","clipId"],allowed:["camera"]},adoptFrame:{required:["clipId","frameId","shotId"]},clearFrame:{required:["clipId","frameId","shotId"]}},
    generate:{keyart:{required:["episode"],allowed:["blockId"]},clip:{required:["episode","blockId"]},retake:{required:["episode","blockId","variable"]},selectVersion:{required:["episode","blockId","versionIndex"]}},
    audio:{inspect:{required:["clipId"]},addCue:{required:["clipId","kind"],allowed:["patch"]},configureCue:{required:["clipId","cueId","patch"]},generateDialogue:{required:["clipId","cueId"]},adoptTake:{required:["clipId","cueId","takeId"]},selectMusic:{required:["clipId","cueId","jobId","variantIndex"]},selectSource:{required:["clipId","cueId","sourceId"]},trim:{required:["clipId","cueId"]},premix:{required:["clipId"]},previewMix:{required:["clipId"]},resume:{required:["clipId","jobId"]}},
    scoring:{inspect:{},configure:{required:["clipId","musicId"]},analyze:{allowed:["question"]},applyAdvice:{},submit:{}},
    edit:{inspect:{required:["episode"]},reorder:{required:["episode","order"]},trim:{required:["episode","shotIndex","inSec","outSec"]},transition:{required:["episode","transition"]}},
    deliver:{inspect:{required:["episode"]},assemble:{required:["episode"],allowed:["clipIds"]},subtitle:{required:["episode"]},selectVersion:{required:["episode","versionIndex"]},export:{required:["episode"]}},
    storyboardRecovery:{inspect:{required:["episode"]},recover:{required:["episode"]},archive:{required:["episode"]}},
  };
  if(!("operation" in value)||!rules[value.action])return;
  const rule=rules[value.action][value.operation];
  const fields=new Set(["action","operation",...(rule.required||[]),...(rule.allowed||[])]);
  for(const field of rule.required||[])if((value as Record<string,unknown>)[field]===undefined)ctx.addIssue({code:"custom",path:[field],message:"本操作缺少必需参数"});
  for(const field of Object.keys(value))if(!fields.has(field))ctx.addIssue({code:"custom",path:[field],message:"该参数不属于本操作，请分步保存后再执行"});
  if(value.action==="edit"&&value.operation==="trim"&&value.outSec!<=value.inSec!)ctx.addIssue({code:"custom",message:"出点必须大于进点"});
  if(value.action==="edit"&&value.order&&new Set(value.order).size!==value.order.length)ctx.addIssue({code:"custom",path:["order"],message:"镜头顺序不得重复"});
  if(value.action==="writer"&&value.operation==="configure"&&Object.keys(value).length===2)ctx.addIssue({code:"custom",message:"配置操作没有任何修改"});
  if(value.action==="asset"&&value.metadata&&Object.keys(value.metadata).length===0)ctx.addIssue({code:"custom",path:["metadata"],message:"资产修改为空"});
  if(value.action==="audio"&&value.patch&&Object.keys(value.patch).length===0)ctx.addIssue({code:"custom",path:["patch"],message:"音轨修改为空"});
});
export type CreativeVoiceProductionAction = z.infer<typeof creativeVoiceProductionSchema>;

/** 工具参数由同一验证契约生成，避免语音能力描述与执行层脱节。 */
export function creativeVoiceProductionToolParameters() {
  const properties: Record<string, any> = {};
  const convert = (value: any): any => {
    if(Array.isArray(value))return value.map(convert);
    if(!value || typeof value!=="object")return value;
    const result:Record<string,any>={};
    for(const [key,item] of Object.entries(value)) {
      if(["$schema","additionalProperties"].includes(key))continue;
      if(key==="prefixItems"){const items=item as any[];result.items=convert(items[0]);result.minItems=items.length;result.maxItems=items.length;continue;}
      if(key==="items" && item===false)continue;
      if(key==="const"){result.enum=[item];continue;}
      if(key==="type"){result.type=String(item).toUpperCase();continue;}
      result[key]=convert(item);
    }
    return result;
  };
  for(const variant of creativeVoiceProductionSchema.options) {
    const json=z.toJSONSchema(variant);
    for(const [key,value] of Object.entries(json.properties||{})) {
      const field=convert(value);
      if(properties[key]?.enum && field.enum)properties[key].enum=Array.from(new Set([...properties[key].enum,...field.enum]));
      else if(!properties[key])properties[key]=field;
    }
  }
  return {type:"OBJECT",properties,required:["action"]};
}
