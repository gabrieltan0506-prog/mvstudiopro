import { createHash } from "node:crypto";
import { invokeLLM, extractFirstChoicePlainText } from "../_core/llm";
import { buildLyricReviewContext } from "../../shared/lyricCraftReview";
import { CREATIVE_EVIDENCE_REVIEW_INSTRUCTIONS, parseCreativeEvidenceReview, type CreativeEvidenceReviewInput } from "../../shared/creativeEvidenceReview";
import { z } from "zod";
const envelopeSchema=z.object({proposal:z.unknown(),review:z.unknown(),changesZh:z.array(z.string().trim().min(1)).min(1)}).strict();
const INSTRUCTIONS=`${CREATIVE_EVIDENCE_REVIEW_INSTRUCTIONS}
你同时担任第二位创作顾问。GLM已结合最新模板库完成初稿；请在完整媒体证据和用户要求边界内共同创作并审阅。
先核查证据，再改善有证据支持的歌词细节、段落推进、唱法与配器、情绪转折或MV叙事。不要为改而改；未发现可改点时明确保留初稿。原媒体观察sections、来源sourceKey、素材身份、时间范围必须保留，不能通过改写证据消除矛盾。无法确定的听音事实仍要求具体复听，不能编造修正。不得加入生成、发布、计费指令。
输出proposal须与输入candidate完全相同的JSON结构与kind，保留全部方案、模板引用和必填字段。歌曲保留3种不同曲风；不要仅改风格标签。学习报告的evidencePaths仍指向原媒体证据内部。歌词原文只有在用户要求创作/改写时才可修改；仅优化style时完整保留歌词。
最终仅输出JSON：{proposal:完整修订后的方案或原样保留初稿,review:对最终proposal的审阅对象,changesZh:[实际修改及理由或说明原稿保留]}。review遵守上文合同，其/candidate路径指向最终proposal。不得输出伪造的模型或审阅身份。`;
const real={invoke:invokeLLM};
/** Astra只走官方精确模型；任何调用/存储/解析失败均保留初稿，不静默换模型。 */
export async function refineCreativeProposal(input:CreativeEvidenceReviewInput,draftModel:string,save:(name:string,value:unknown)=>Promise<unknown>,deps=real){
 const context={...input,lyricCraft:buildLyricReviewContext(input.candidate),draftModel};
 const serialized=JSON.stringify(context);
 if(Buffer.byteLength(serialized)>2*1024*1024)throw Error("联合创作完整输入超过容量，未截断或提交");
 const inputSha256=createHash("sha256").update(INSTRUCTIONS).update(serialized).digest("hex");
 await save("astra-request",{model:"gpt-6-astra",instructions:INSTRUCTIONS,input:context,inputSha256,reasoningEffort:"medium",maxOutputTokens:32768});
 let raw:Awaited<ReturnType<typeof invokeLLM>>;
 try{
  raw=await deps.invoke({provider:"openai",modelName:"gpt-6-astra",openAiGateway:"official_only",singleAttempt:true,reasoningEffort:"medium",max_tokens:32768,abortSignal:AbortSignal.timeout(240000),response_format:{type:"json_object"},messages:[{role:"system",content:INSTRUCTIONS},{role:"user",content:serialized}],
   onRawCompletion:async response=>{await save("astra-raw-http",response);}});
 }catch(error){const e=error as {status?:number;statusCode?:number;name?:string};await save("astra-error",{status:e.status??e.statusCode,name:e.name,usage:null});throw Error("Astra联合创作审阅未成功，GLM初稿及媒体证据已保留，未自动重试");}
 await save("astra-raw",raw);
 if(raw.choices?.[0]?.finish_reason!=="stop" || !/^gpt-6-astra(?:$|-)/.test(raw.model||""))throw Error("Astra模型回执或完成状态不符，未采用结果");
 const decoded:unknown=JSON.parse(extractFirstChoicePlainText(raw));await save("astra-decoded",decoded);
 const result=envelopeSchema.parse(decoded);
 const review=parseCreativeEvidenceReview(result.review,{...input,candidate:result.proposal});
 return {proposal:result.proposal,review:{...review,model:raw.model,inputSha256,draftModel,revisionsZh:result.changesZh,draftProposal:input.candidate}};
}
