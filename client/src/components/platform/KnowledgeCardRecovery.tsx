import { useEffect, useRef, useState } from "react";
import { KnowledgeCardProgress, knowledgeEditionStageLabel, knowledgeCardStageCounts, type KnowledgeCardProgressState } from "./KnowledgeCardProgress";
import { pollJobUntilTerminal } from "@/lib/jobs";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
export type RecoveredKnowledgeCard = inferRouterOutputs<AppRouter>["mvAnalysis"]["getKnowledgeCardRecovery"];
type Listing = inferRouterOutputs<AppRouter>["mvAnalysis"]["listKnowledgeCardRecovery"];
type ResumeDraft = inferRouterOutputs<AppRouter>["mvAnalysis"]["getLastKnowledgeVerificationDraft"];
export function KnowledgeCardRecovery({disabled,onApply,onStart,onFinish}:{
  disabled:boolean;
  onApply:(value:RecoveredKnowledgeCard)=>boolean;
  onStart:(draft:ResumeDraft)=>boolean;
  onFinish:(value:RecoveredKnowledgeCard)=>boolean;
}) {
  const actions=useRef({onStart,onApply,onFinish});
  actions.current={onStart,onApply,onFinish};
  const autoApplyJob=useRef("");
  const resume=trpc.mvAnalysis.resumeLastKnowledgeVerification.useMutation();
  const [watchVersion,setWatchVersion]=useState(0);
  const remove=trpc.mvAnalysis.deleteKnowledgeCardRecovery.useMutation();
  const utils=trpc.useUtils();const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [items,setItems]=useState<Listing["items"]>([]),[cursor,setCursor]=useState<Listing["nextCursor"]>(null);
  const [candidate,setCandidate]=useState<RecoveredKnowledgeCard|null>(null);
  const [watchInput,setWatchInput]=useState("");
  const [watched,setWatched]=useState("");
  const [watchProgress,setWatchProgress]=useState<KnowledgeCardProgressState>({status:"idle",percent:0});
  const [watchStatus,setWatchStatus]=useState("");
  useEffect(()=>{
    if(!open || !watched) return;
    const controller=new AbortController();
    setWatchProgress({status:"idle",percent:0});
    setWatchStatus("正在读取原任务…");
    void pollJobUntilTerminal(watched,{
      signal:controller.signal, intervalMs:5000, maxWaitMs:Number.MAX_SAFE_INTEGER,
      onPoll:({status,output,updatedAt})=>{
        if(controller.signal.aborted)return;
        const stage = knowledgeEditionStageLabel(output);
        if(status==="running"){
          setWatchStatus("");
          setWatchProgress({status:"running",stepNumber:Number(output?.editionStepNumber)||undefined,stepTotal:Number(output?.editionStepTotal)||undefined,lastUpdate:updatedAt,checkedAt:new Date().toISOString(),percent:Number(output?.distillPercent)||0,label:stage,...knowledgeCardStageCounts(output||{})});
        }else if(status==="queued"){
          setWatchStatus("等待后台领取");setWatchProgress({status:"idle",percent:0});
        }
      },
    }).then(job=>{
      if(controller.signal.aborted)return;
      setWatchProgress(previous=>({...previous,status:job.status==="succeeded"?"succeeded":"failed"}));
      if(job.status==="succeeded"){
        setWatchStatus("核实完成，正在读取正文备份…");
        void utils.mvAnalysis.getKnowledgeCardRecovery.fetch({jobId:watched},{staleTime:0}).then(value=>{
          if(controller.signal.aborted)return;
          if(autoApplyJob.current===watched && actions.current.onFinish(value)){
            autoApplyJob.current="";
            setWatchStatus("核实完成，成稿已回填到手册文本框。");
            return;
          }
          setCandidate(value);
          setWatchStatus("核实完成，请核对预览后恢复正文。");
        }).catch(()=>{if(!controller.signal.aborted)setWatchStatus("核实完成，可从备份列表找回正文。");});
      }else setWatchStatus(job.error || "任务失败");
    }).catch(()=>{
      if(!controller.signal.aborted)setWatchStatus("暂时无法读取，请核对账号与编号后重新查看。");
    });
    return ()=>controller.abort();
  },[open,watched,watchVersion,utils]);
  async function resumeLast(){
    setBusy(true);setOpen(true);setError("");setCandidate(null);
    try {
      const draft=await utils.mvAnalysis.getLastKnowledgeVerificationDraft.fetch(undefined,{staleTime:0});
      if(draft.finished){
        const value=await utils.mvAnalysis.getKnowledgeCardRecovery.fetch({jobId:draft.jobId},{staleTime:0});
        if(actions.current.onApply(value)){setOpen(false);setWatched("");}
        return;
      }
      if(!actions.current.onStart(draft))return;
      const {jobId}=await resume.mutateAsync({jobId:draft.jobId});
      autoApplyJob.current=jobId;
      setWatchInput(jobId);setWatched(jobId);setWatchVersion(v=>v+1);
    }catch(e){setError(e instanceof Error?e.message:"无法续作，请稍后重试");}
    finally{setBusy(false);}
  }
  async function load(more=false) {setBusy(true);setError("");try{const r=await utils.mvAnalysis.listKnowledgeCardRecovery.fetch({cursor:more?cursor??undefined:undefined},{staleTime:0});setItems(old=>Array.from(new Map([...(more?old:[]),...r.items].map(x=>[x.key,x])).values()));setCursor(r.nextCursor);}catch(e){setError(e instanceof Error?e.message:"读取失败，请重试");}finally{setBusy(false);}}
  async function select(jobId:string){setBusy(true);setError("");setCandidate(null);try{setCandidate(await utils.mvAnalysis.getKnowledgeCardRecovery.fetch({jobId},{staleTime:0}));}catch(e){setError(e instanceof Error?e.message:"读取失败，请重试");}finally{setBusy(false);}}
  async function deleteBackup(item:Listing["items"][number]){
    if(busy||disabled||!window.confirm(`删除“${item.title}”的云端恢复备份？删除后不能再从这里恢复；已生成图片、当前稿件及计费记录保留。`))return;
    setBusy(true);setError("");
    try{const result=await remove.mutateAsync({jobId:item.jobId});setItems(old=>old.filter(x=>x.key!==result.key));setCandidate(null);
      await utils.mvAnalysis.getKnowledgeCardRecovery.invalidate();await utils.mvAnalysis.listKnowledgeCardRecovery.invalidate();
    }catch(e){setError(e instanceof Error?e.message:"删除失败，备份列表已保留");}finally{setBusy(false);}
  }
  return <div className="contents text-sm" data-knowledge-card-recovery>
    <button type="button" disabled={disabled||busy} aria-expanded={open} className="inline-flex items-center rounded-full border border-cyan-300/40 px-5 py-2.5 text-sm font-semibold text-cyan-100 disabled:opacity-50" onClick={()=>{setOpen(!open);if(!open)void load();}}>恢复上次内容</button>
    <button type="button" disabled={disabled||busy} className="rounded-full border border-cyan-300/40 px-5 py-2.5 text-cyan-100 disabled:opacity-50" onClick={()=>void resumeLast()}>从上次任务续作</button>
    {open&&<div className="order-last basis-full min-w-0 space-y-3 rounded-xl border border-white/15 bg-black/25 p-4">
      <p className="text-xs text-white/60">选择已完成的正文或图文成品。恢复不会重新生成或扣费。</p>
      <label className="block">后台核实任务编号
        <input className="ml-2 rounded border bg-transparent px-2" value={watchInput} disabled={Boolean(watched)} onChange={e=>setWatchInput(e.target.value.trim())} placeholder="kc_…" />
      </label>
      {watched?<button type="button" onClick={()=>{autoApplyJob.current="";setWatched("");setWatchStatus("");}}>停止查看进度</button>:
        <button type="button" disabled={!/^kc_[a-f0-9]{56}$/.test(watchInput)} onClick={()=>setWatched(watchInput)}>查看原任务进度</button>}
      {watched&&<KnowledgeCardProgress state={watchProgress}/>}
      {watched&&watchStatus&&<p role="status">{watchStatus}</p>}
      {error&&<p role="alert" className="text-rose-300">{error}</p>}
      {busy&&<p role="status">正在读取云端备份…</p>}
      {!busy&&!items.length&&!error&&<p>暂无已完成的云端备份。</p>}
      <div className="max-h-64 space-y-2 overflow-auto">{items.map(item=><div key={item.key} className="flex items-center gap-2"><button type="button" disabled={busy||disabled} onClick={()=>void select(item.jobId)} className="block w-full rounded-lg border border-white/15 p-3 text-left disabled:opacity-50">
        <strong>{item.title}</strong><span className="block text-xs text-white/60">{item.kind}{item.total?` · ${item.total} 页`:""} · {new Date(item.createdAt).toLocaleString("zh-CN")}</span>
      </button><button type="button" disabled={busy||disabled} onClick={()=>void deleteBackup(item)} className="shrink-0 text-rose-200 disabled:opacity-50">删除备份</button></div>)}</div>
      {cursor&&<button type="button" disabled={busy||disabled} onClick={()=>void load(true)}>查看更早备份</button>}
      {candidate&&<div className="space-y-2 border-t border-white/15 pt-3"><p>{candidate.markdown.length.toLocaleString()} 字 · 已找回 {candidate.images.length}/{candidate.total} 张图片</p>
        {candidate.total>candidate.images.length&&<p className="text-amber-200">缺少的页会保留空位，不会自动补出或收费。</p>}
        <pre className="max-h-28 overflow-auto whitespace-pre-wrap text-xs text-white/70">{candidate.markdown.slice(0,700)}</pre>
        <button type="button" disabled={disabled||busy} className="rounded-lg bg-cyan-700 px-4 py-2 text-white disabled:opacity-50" onClick={()=>{if(onApply(candidate)){setOpen(false);setCandidate(null);}}}>恢复正文与已有图片</button>
      </div>}
      <button type="button" onClick={()=>setOpen(false)}>收起</button>
    </div>}
  </div>;
}
