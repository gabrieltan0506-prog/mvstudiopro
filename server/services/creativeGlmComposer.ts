import { invokeLLM, extractFirstChoicePlainText } from "../_core/llm";
import { MANHUA_ADVISOR_HOPS, MANHUA_ADVISOR_MAX_OUTPUT_TOKENS, manhuaAdvisorReasoningEffort } from "./openrouterDeepSeekV41Flash";
type Save = (name: string, value: unknown) => Promise<unknown>;
const real={invoke:invokeLLM,sleep:(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms))};
/** 创意生成使用GLM；不把文本创作交回Gemini，也不静默换成其他模型。 */
export async function composeCreativeJson(instructions:string,input:unknown,save:Save,deps=real) {
  const serialized=JSON.stringify(input);
  if(Buffer.byteLength(serialized)>2*1024*1024)throw Error("完整创作上下文超过容量，未截断或调用模型");
  const hops=MANHUA_ADVISOR_HOPS.filter(h=>h.modelName.includes("glm-5.3-flashx"));
  await save("glm-request",{instructions,input,hops});
  for(let index=0;index<hops.length;index++){
    const hop=hops[index];
    let raw:Awaited<ReturnType<typeof invokeLLM>>;
    try{
      raw=await deps.invoke({provider:"openai",modelName:hop.modelName,openAiGateway:hop.gateway,reasoningEffort:manhuaAdvisorReasoningEffort(hop.modelName),max_tokens:MANHUA_ADVISOR_MAX_OUTPUT_TOKENS,abortSignal:AbortSignal.timeout(180000),response_format:{type:"json_object"},openRouterProviderPreferences:{require_parameters:true},messages:[{role:"system",content:instructions},{role:"user",content:serialized}]});
    }catch(error){
      const e=error as {status?:number;statusCode?:number;name?:string};
      const status=e.status??e.statusCode;
      await save(`glm-attempt-${index+1}-error`,{model:hop.modelName,gateway:hop.gateway,status,name:e.name,usage:null});
      if(index===hops.length-1)throw Error("GLM创作通道暂不可用，媒体读取证据保留");
      if(status===429||status===503)await deps.sleep(18000);
      continue;
    }
    await save(`glm-attempt-${index+1}-raw`,raw);
    if(raw.choices?.[0]?.finish_reason!=="stop")throw Error("GLM创作输出未完整结束，原回包已保留");
    const decoded:unknown=JSON.parse(extractFirstChoicePlainText(raw));
    await save("glm-decoded",decoded);
    return {decoded,model:raw.model||hop.modelName};
  }
  throw Error("缺少GLM创作通道");
}
