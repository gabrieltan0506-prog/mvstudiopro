import { manhuaProjectStorage as localStorage } from "@shared/manhuaProjectScope";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import type { ManhuaCreativeAdvisorContext } from "@shared/manhuaCreativeAdvisor";
import { advisorBgmMixPlanSchema, parseAdvisorBgmMixPlan, type AdvisorBgmMixPlan, type AdvisorBgmMixTarget } from "@shared/manhuaAdvisorBgmMix";

/** 配乐咨询复用现有创作顾问的鉴权、额度、操作编号和退款事务。 */
export function BgmCreativeAdvisor({context,target,storageKey,onApply}: {
  context?: ManhuaCreativeAdvisorContext; target?: AdvisorBgmMixTarget;
  storageKey:string; onApply:(plan:AdvisorBgmMixPlan)=>void;
}) {
  const mutation=trpc.mvAnalysis.askPlatformSkillQa.useMutation({retry:false});
  const quota=trpc.mvAnalysis.getManhuaAdvisorQuota.useQuery(undefined,{enabled:Boolean(target&&context),retry:false});
  const [candidate,setCandidate]=useState<AdvisorBgmMixPlan|null>(null);
  const [question,setQuestion]=useState("结合本段真实画面、对白和已采用BGM，判断音乐如何配合剧情张力、眼神与表演，给出强弱与留白安排。音乐可以补充对白，不要统一压低。");
  const [error,setError]=useState("");
  const [storageBlocked,setStorageBlocked]=useState(false);
  const [paid,setPaid]=useState(false);
  const active=useRef(target); active.current=target;
  const pending=useRef<Parameters<typeof mutation.mutateAsync>[0]|null>(null);
  const lock=useRef(false);
  const candidateKey=`${storageKey}:candidate`;
  const pendingKey=`${storageKey}:pending`;
  useEffect(()=>{
    try {
      setStorageBlocked(false);
      const saved=localStorage.getItem(candidateKey);
      setCandidate(saved?advisorBgmMixPlanSchema.parse(JSON.parse(saved)):null);
      const recovery=localStorage.getItem(pendingKey);
      pending.current=recovery?JSON.parse(recovery):null;
      setError(recovery?"上次咨询尚未收到回执；继续会使用原操作编号恢复。":"");
      setPaid(false);
    } catch {setStorageBlocked(true);setError("配乐咨询恢复记录无法读取，停止新咨询以保护原记录");pending.current=null;}
  },[candidateKey,pendingKey]);
  const ask=async(confirmPaid=false)=>{
    if (!target||!context||lock.current||storageBlocked) return;
    lock.current=true;setError("");
    try {
      const request=pending.current??{requestId:crypto.randomUUID(),question,rawQuestion:question,manhuaContext:{...context,bgmMix:target}};
      if (JSON.stringify(request.manhuaContext?.bgmMix)!==JSON.stringify(target)) throw new Error("恢复中的咨询属于另一素材版本，请返回原版本核对回执");
      localStorage.setItem(pendingKey,JSON.stringify(request));pending.current=request;
      const result=await mutation.mutateAsync({...request, ...(confirmPaid?{confirmPaid:true,confirmedCredits:quota.data?.price}:{})});
      const plan=parseAdvisorBgmMixPlan(result.answer,target);
      localStorage.setItem(candidateKey,JSON.stringify(plan));
      localStorage.removeItem(pendingKey);pending.current=null;
      if (active.current?.sourceKey===target.sourceKey) {setCandidate(plan);setPaid(false);}
    } catch(err) {
      const message=err instanceof Error?err.message:"配乐顾问未返回建议";
      setError(message);
      if (/PAYMENT_REQUIRED|免费.*用完|请确认后重试/.test(message)) setPaid(true);
    } finally {lock.current=false;}
  };
  const matches=Boolean(candidate&&target&&candidate.sourceKey===target.sourceKey);
  return <section aria-label="创作顾问配乐判断" className="space-y-2 rounded border border-cyan-300/30 p-2 text-xs">
    <strong>创作顾问 · 配乐判断</strong>
    <p className="text-white/65">顾问读取所选成片的画面与原声，以及已采用配乐；建议强弱、留白与表演呼应。建议不会自动混音或替换原曲。</p>
    <textarea aria-label="配乐顾问要求" value={question} maxLength={2000} onChange={event=>setQuestion(event.target.value)} className="w-full rounded bg-black/30 p-2" />
    <button type="button" disabled={!target||!context||mutation.isPending||paid||storageBlocked} onClick={()=>void ask()} className="rounded border border-cyan-300/40 p-2 disabled:opacity-40">{mutation.isPending?"正在分析音画…":"让创作顾问判断配乐"}</button>
    {!target&&<p>先选择真实成片及已采用的BGM，再咨询；不会用文字冒充音画分析。</p>}
    {paid&&<button type="button" disabled={!quota.data||mutation.isPending} onClick={()=>void ask(true)} className="ml-2 rounded border p-2">确认本次咨询扣除 {quota.data?.price??"待核"} 积分</button>}
    {error&&<p role="alert" className="text-amber-200">{error}</p>}
    {/ADVISOR_OPERATION_FAILED/.test(error)&&<button type="button" disabled={mutation.isPending} onClick={()=>{
      try {
        const previous=localStorage.getItem(pendingKey);
        if (previous) localStorage.setItem(`${pendingKey}:failed:${Date.now()}`,previous);
        localStorage.removeItem(pendingKey);pending.current=null;setPaid(false);setError("");
      } catch {setError("失败咨询记录无法保全，尚未建立新咨询");}
    }} className="rounded border p-2">保留失败记录，准备新咨询</button>}
    {candidate&&<div className="space-y-1"><p>{candidate.summaryZh}</p>
      {candidate.narrativeMix.map((cue,i)=><p key={i}>{cue.startSec}–{cue.endSec}秒 · {cue.role} · {cue.gainStart}→{cue.gainEnd} · {cue.noteZh}</p>)}
      {candidate.uncertaintiesZh.map((text,i)=><p key={i} className="text-amber-200">待核：{text}</p>)}
      <button type="button" disabled={!matches||mutation.isPending} onClick={()=>{
        if (!candidate||!matches) {toast.error("建议已过期，请重新咨询");return;}
        onApply(candidate);
      }} className="rounded border border-cyan-300/40 p-2 disabled:opacity-40">采用到混音时间表</button>
      {!matches&&<p>原建议保留，但不属于当前音画版本。</p>}
    </div>}
  </section>;
}
