import { useState } from "react";
import { trpc } from "@/lib/trpc";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../server/routers";
export type RecoveredKnowledgeCard = inferRouterOutputs<AppRouter>["mvAnalysis"]["getKnowledgeCardRecovery"];
type Listing = inferRouterOutputs<AppRouter>["mvAnalysis"]["listKnowledgeCardRecovery"];
export function KnowledgeCardRecovery({disabled,onApply}:{disabled:boolean;onApply:(value:RecoveredKnowledgeCard)=>boolean}) {
  const utils=trpc.useUtils();const [open,setOpen]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [items,setItems]=useState<Listing["items"]>([]),[cursor,setCursor]=useState<Listing["nextCursor"]>(null);
  const [candidate,setCandidate]=useState<RecoveredKnowledgeCard|null>(null);
  async function load(more=false) {setBusy(true);setError("");try{const r=await utils.mvAnalysis.listKnowledgeCardRecovery.fetch({cursor:more?cursor??undefined:undefined});setItems(old=>Array.from(new Map([...(more?old:[]),...r.items].map(x=>[x.key,x])).values()));setCursor(r.nextCursor);}catch(e){setError(e instanceof Error?e.message:"读取失败，请重试");}finally{setBusy(false);}}
  async function select(jobId:string){setBusy(true);setError("");setCandidate(null);try{setCandidate(await utils.mvAnalysis.getKnowledgeCardRecovery.fetch({jobId},{staleTime:0}));}catch(e){setError(e instanceof Error?e.message:"读取失败，请重试");}finally{setBusy(false);}}
  return <div className="mt-3 text-sm" data-knowledge-card-recovery>
    <button type="button" disabled={disabled||busy} className="rounded-lg border border-cyan-300/40 px-3 py-2 text-cyan-100 disabled:opacity-50" onClick={()=>{setOpen(!open);if(!open)void load();}}>恢复云端备份</button>
    {open&&<div className="mt-2 space-y-3 rounded-xl border border-white/15 bg-black/25 p-4">
      <p className="text-xs text-white/60">选择已完成的正文或图文成品。恢复不会重新生成或扣费。</p>
      {error&&<p role="alert" className="text-rose-300">{error}</p>}
      {busy&&<p role="status">正在读取云端备份…</p>}
      {!busy&&!items.length&&!error&&<p>暂无已完成的云端备份。</p>}
      <div className="max-h-64 space-y-2 overflow-auto">{items.map(item=><button key={item.key} type="button" disabled={busy||disabled} onClick={()=>void select(item.jobId)} className="block w-full rounded-lg border border-white/15 p-3 text-left disabled:opacity-50">
        <strong>{item.title}</strong><span className="block text-xs text-white/60">{item.kind}{item.total?` · ${item.total} 页`:""} · {new Date(item.createdAt).toLocaleString("zh-CN")}</span>
      </button>)}</div>
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
