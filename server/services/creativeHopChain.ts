/**
 * 创作顾问三跳 fallback 链（GLM@EvoLink → GLM@OpenRouter → DeepSeek 1017@OpenRouter），自 musicMvAdvisor 抽出复用（1109 逐窗节拍阶段同链）。
 * 每跳 调用 → JSON 解析 → accept（修复 + 校验）；解析或校验失败先带具体原因重写一次，仍失败切下一跳；通道异常直接切下一跳；
 * 三跳全败抛 CreativeProposalError（含每跳原因）。证据：`<stage>-hop-<n>-<model>[-rewrite]-*` 与 `<stage>-hop-used`。
 */
import { CreativeHopTransportError, creativeHopSlug, type CreativeLlmHop } from "./creativeLlmHops";
import { extractJsonString } from "../_core/llm";
import { describeValidationErrorZh } from "../../shared/creativeProposalRepair";
import { CreativeProposalError } from "./creativeProposalFailure";

export type HopSave = (name: string, value: unknown) => Promise<unknown>;
type Save = HopSave;

export const runCreativeHopChain=async<T>(hops:readonly CreativeLlmHop[],stage:"compose"|"refine"|"beats",chainSave:Save,call:(hop:CreativeLlmHop,hopSave:Save,repair?:{attempt:number;reasonZh:string})=>Promise<{text:string;model:string;inputSha256?:string;elapsedMs?:number}>,accept:(decoded:unknown,hopSave:Save,stageName:string,model:string,inputSha256?:string)=>Promise<T>)=>{
  const failures:string[]=[];
  const attemptsLog:Array<Record<string,unknown>>=[];
  const startedAt=Date.now();
  for(let index=0;index<hops.length;index+=1){
    const hop=hops[index];
    let reasonZh:string|undefined;
    for(let attempt=1;attempt<=2;attempt+=1){
      const stageName=`${stage}-hop-${index+1}-${creativeHopSlug(hop)}${attempt>1?"-rewrite":""}`;
      const hopSave=(name:string,value:unknown)=>chainSave(`${stageName}-${name}`,value);
      const t0=Date.now();
      let text:string,model:string,inputSha256:string|undefined;
      try{
        const result=await call(hop,hopSave,reasonZh?{attempt,reasonZh}:undefined);
        text=result.text;model=result.model;inputSha256=result.inputSha256;
      }catch(error){
        const message=error instanceof Error?error.message:String(error);
        const reason=`第${index+1}跳 ${hop.label}${attempt>1?"（重写）":""}：${error instanceof CreativeHopTransportError?message:`通道异常：${message}`}`;
        failures.push(reason);
        attemptsLog.push({hop:index+1,model:hop.modelName,gateway:hop.gateway,attempt,outcome:"transport_error",reasonZh:reason,elapsedMs:Date.now()-t0});
        break; // 通道挂/超时/429/截断：不重写，直接切下一跳
      }
      let decoded:unknown;
      try{
        decoded=JSON.parse(extractJsonString(text));
      }catch(error){
        reasonZh=`模型输出不是合法 JSON（${(error instanceof Error?error.message:String(error)).slice(0,160)}）`;
        await hopSave("rejected",{stage:stageName,phase:"json_parse",reasonZh,model,textLength:text.length,textHead:text.slice(0,400),textTail:text.slice(-400)});
        failures.push(`第${index+1}跳 ${hop.label}${attempt>1?"（重写）":""}：${reasonZh}`);
        attemptsLog.push({hop:index+1,model,gateway:hop.gateway,attempt,outcome:"invalid_json",reasonZh,elapsedMs:Date.now()-t0});
        continue;
      }
      await hopSave("decoded",decoded);
      try{
        const value=await accept(decoded,hopSave,stageName,model,inputSha256);
        const used={stage,hop:index+1,label:hop.label,model,gateway:hop.gateway,attempt,rewritten:attempt>1,elapsedMs:Date.now()-t0,totalElapsedMs:Date.now()-startedAt,failuresZh:failures,attempts:[...attemptsLog,{hop:index+1,model,gateway:hop.gateway,attempt,outcome:"accepted",elapsedMs:Date.now()-t0}]};
        await chainSave(`${stage}-hop-used`,used);
        return {value,model,hop,inputSha256,used};
      }catch(error){
        reasonZh=describeValidationErrorZh(error);
        await hopSave("rejected",{stage:stageName,phase:"validate",reasonZh,error:error instanceof Error?error.message:String(error),model});
        failures.push(`第${index+1}跳 ${hop.label}${attempt>1?"（重写）":""}：${reasonZh}`);
        attemptsLog.push({hop:index+1,model,gateway:hop.gateway,attempt,outcome:"rejected",reasonZh,elapsedMs:Date.now()-t0});
      }
    }
  }
  await chainSave(`${stage}-hop-exhausted`,{stage,failuresZh:failures,attempts:attemptsLog,totalElapsedMs:Date.now()-startedAt});
  throw new CreativeProposalError(stage,failures.join("；"),attemptsLog.length,failures);
};
