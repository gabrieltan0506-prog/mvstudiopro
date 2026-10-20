import { MARKETING_PLAN_MODELS } from "../../shared/marketingPlan.js";
import { verifyTopicCandidates } from "../../shared/topicDigest.js";
import { topicDraftMessages, topicMergeMessages, normalizeTopicIntegration, verifyTopicIntegration, type TopicCompletion, type TopicWorkflow } from "../../shared/topicDigestWorkflow.js";
import { extractFirstChoicePlainText, extractJsonString, invokeLLM } from "../_core/llm.js";
import { registerActiveJob, heartbeatActiveJob, unregisterActiveJob } from "./paidJobLedger.js";

export async function callTopicModel(step: "deepseek" | "glm" | "integrated", workflow: Pick<TopicWorkflow,"lane"|"sources"|"previousTitles"> & Partial<TopicWorkflow>, requestId: string): Promise<TopicCompletion> {
  await registerActiveJob({jobId:requestId,taskType:"platformTopicDigest",userId:"platform",creditsBilled:0,
    action:"topicDigest",metadata:{paidBy:"platform",lane:workflow.lane,step}});
  const heartbeat=setInterval(()=>void heartbeatActiveJob(requestId,"platformTopicDigest").catch(()=>{}),30_000);
  heartbeat.unref();
  try {
    const response=await invokeLLM({provider:"openai",modelName:MARKETING_PLAN_MODELS[step],requestId,
      openAiGateway:"auto",reasoningEffort:"high",max_tokens:12000,abortSignal:AbortSignal.timeout(6*60_000),
      response_format:{type:"json_object"},messages:step==="integrated"?topicMergeMessages(workflow as TopicWorkflow):topicDraftMessages(workflow.lane,workflow.sources,workflow.previousTitles)});
    if(response.choices?.[0]?.finish_reason!=="stop") throw new Error("选题生成未正常结束");
    const expected=step==="glm"?"Z.AI":"DeepSeek";
    if(response.provider!==expected) throw new Error("模型供应商回执不符合锁定要求，未采纳结果");
    const text=extractFirstChoicePlainText(response);
    let raw:unknown;
    try {raw=JSON.parse(extractJsonString(text));} catch {raw={invalidText:text};}
    return {raw,receipt:{id:response.id,model:response.model,provider:response.provider,usage:response.usage}};
  } finally {
    clearInterval(heartbeat);
    await unregisterActiveJob(requestId,"platformTopicDigest");
  }
}

/** CAS占位后的单个付费扩展；成功原稿保留，未知步骤不自动重发，存储失败立即停止下一次调用。 */
export async function runPaidTopicPipeline(id:string, saved:TopicWorkflow, deps:{
  call:typeof callTopicModel;save:(workflow:TopicWorkflow)=>Promise<void>;
}):Promise<TopicWorkflow>{
  const result=structuredClone(saved);
  if(result.version!==2 || result.deepseek.status!=="succeeded" || result.deepseek.receipt?.provider!=="DeepSeek") throw new Error("缺少已保存的DeepSeek自营原稿，不能冒充双模型整合");
  for(const step of ["glm","integrated"] as const){
    if(result[step].status==="succeeded") continue;
    if(result[step].status!=="pending") return result;
    if(step==="integrated"&&result.glm.status!=="succeeded") return result;
    result[step]={status:"running"};
    await deps.save(result);
    let completion:TopicCompletion|undefined;
    try{
      completion=await deps.call(step,result,`${id}/${step}`);
      if(step==="glm") verifyTopicCandidates(completion.raw,result.sources);
      else verifyTopicIntegration(completion.raw,result);
      if(completion.receipt.provider!==(step==="glm"?"Z.AI":"DeepSeek")) throw new Error("供应商回执不匹配");
      result[step]={status:"succeeded",...completion,...(step==="integrated"?{repairs:normalizeTopicIntegration(completion.raw).repairs}:{})};
    }catch{
      result[step]={status:"failed",...completion,error:"本步未取得有效结果，已保存原稿保留；不会自动重发或降级为单模型。"};
    }
    await deps.save(result);
    if(result[step].status!=="succeeded") return result;
  }
  return result;
}
