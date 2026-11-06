import {knowledgeSupplementPlan,type KnowledgeSupplementSelection} from "@shared/knowledgeSupplement";
import { useState } from "react";
import type { EditableLayout } from "@shared/editableLayout";
import { knowledgeConversationAnswerSchema, knowledgeConversationRequestSchema } from "@shared/knowledgeConversation";
import { streamManhuaAdvisor } from "@/lib/manhuaAdvisorStream";
import { trpc } from "@/lib/trpc";
import { knowledgePublicationPublicError } from "@shared/knowledgePublicationPublic";

export default function KnowledgeConversationPanel({doc,busy,save,lock,onSupplement}:{onSupplement?:(selection:KnowledgeSupplementSelection,markdown:string)=>Promise<void>;doc:EditableLayout;busy:boolean;save:(doc:EditableLayout)=>Promise<unknown>;lock:(value:boolean)=>void}) {
  const utils=trpc.useUtils(),[question,setQuestion]=useState(""),[images,setImages]=useState<string[]>([]),[error,setError]=useState("");
  const [selected,setSelected]=useState<Record<string,number[]>>({});
  const turns=doc.publication?.conversation||[],pending=turns.at(-1)?.response?null:turns.at(-1);
  const send=async(retry=false)=>{
    if(busy || (!pending&&!question.trim()))return;
    // 与问答入口保持同一最低长度，避免先保存一个永远无法提交的待回复问题。
    if (!pending && !knowledgeConversationRequestSchema.shape.question.safeParse(question).success) {
      setError("请输入 2 至 8000 个字的问题，再发送给顾问。");
      return;
    }
    lock(true);setError("");
    try {
      const quote=await utils.editableLayout.publicationQuote.fetch({documentId:doc.id,purpose:"conversation"});
      if(quote.maxCredits>0&&!window.confirm(`本次交流最多 ${quote.maxCredits} 积分，是否继续？`))return;
      const retryId=retry&&pending?(await utils.editableLayout.conversationRetry.fetch({documentId:doc.id,failedRequestId:pending.request.id})).requestId:null;
      const turn=retryId&&pending?{request:{...pending.request,id:retryId,retryOf:pending.request.id}}:pending||{request:{id:crypto.randomUUID(),question:question.trim(),imagePageIds:images,manuscript:doc.publication!.manuscript}};
      const history=pending&&!retryId?turns:[...turns,turn];
      let next:EditableLayout={...doc,publication:{...doc.publication!,conversation:history},updatedAt:new Date().toISOString()};
      await save(next);
      const response=await streamManhuaAdvisor({question:turn.request.question,rawQuestion:turn.request.question,requestId:turn.request.id,knowledgePublicationContext:{documentId:doc.id,batchIndex:history.length-1,attempt:0,purpose:"conversation"},confirmPaid:quote.maxCredits>0,confirmedCredits:quote.paidUnit},()=>undefined);
      const answer=knowledgeConversationAnswerSchema.parse(JSON.parse(response.answer));
      if(answer.requestId!==turn.request.id)throw Error("对话请求编号不符");
      next={...next,publication:{...next.publication!,conversation:[...history.slice(0,-1),{...turn,response:answer}]},updatedAt:new Date().toISOString()};
      await save(next);setQuestion("");setImages([]);
    }catch(e){setError(knowledgePublicationPublicError(e).message);}finally{lock(false);}
  };
  const supplement=async(conversationId:string)=>{
    try{setError("");const selection={documentId:doc.id,conversationId,indexes:selected[conversationId]||[]};const plan=knowledgeSupplementPlan(doc,selection);if(!onSupplement)throw Error("当前入口不支持新增图卡");await onSupplement(selection,plan.markdown);}
    catch(e){setError(e instanceof Error?e.message:"补图准备失败");}
  };
  return <section className="space-y-3 rounded-xl border border-[#b9c4ad]/40 p-4" aria-label="手册创作顾问">
    <h3 className="font-semibold">与手册创作顾问交流</h3>
    <p className="text-sm text-[#c0cabb]">围绕当前手册讨论内容、审图、版式和配色，需要时联网核对。整册整理后可评估额外 0–8 页图卡，保留已有图片和完整文字。</p>
    <div className="max-h-96 space-y-4 overflow-y-auto" aria-live="polite">{turns.map(t=><article key={t.request.id} className="space-y-2 border-b border-[#b9c4ad]/20 pb-3">
      <p className="whitespace-pre-wrap"><strong>你：</strong>{t.request.question}</p>
      {t.response?<><p className="whitespace-pre-wrap"><strong>顾问：</strong>{t.response.answer}</p>
        {t.response.sources.length>0&&<ul>{t.response.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.title}</a></li>)}</ul>}
        {t.response.supplementalImages.length>0&&<div><p>建议新增 {t.response.supplementalImages.length} 页图卡（尚未生成）</p>{t.response.supplementalImages.map((p,i)=><details key={i}><summary>{i+1}. {p.title}</summary><label><input type="checkbox" disabled={busy||!!doc.publication?.supplementDocumentId||!!doc.publication?.supplementOf} checked={(selected[t.request.id]||[]).includes(i)} onChange={e=>setSelected(v=>({...v,[t.request.id]:e.target.checked?[...(v[t.request.id]||[]),i]:(v[t.request.id]||[]).filter(n=>n!==i)}))}/>选择本项图解</label><p>{p.reason}</p><p className="whitespace-pre-wrap">{p.content}</p></details>)}{onSupplement&&!doc.publication?.supplementOf&&<button type="button" disabled={busy||!!doc.publication?.supplementDocumentId||!(selected[t.request.id]?.length)} onClick={()=>void supplement(t.request.id)} className="mt-2 rounded border px-3 py-2 disabled:opacity-40">查看实际页数与报价，再确认生成</button>}{doc.publication?.supplementDocumentId&&<p>本册已关联补充稿；在稿件列表中恢复，审校完成后从原册导出合册。</p>}</div>}
      </>:<p>已保存原问题，等待回复；中断后可恢复同一请求。</p>}
    </article>)}</div>
    <label className="block text-sm">本次审看的图片（最多 4 张）<select aria-label="对话参考图片" multiple value={images} disabled={busy||!!pending} onChange={e=>{const ids=Array.from(e.target.selectedOptions,o=>o.value);if(ids.length<=4)setImages(ids);}} className="mt-1 block w-full rounded bg-[#f9f6ee] p-2 text-[#243a35]">{doc.pages.filter(p=>p.imageUrl).map(p=><option key={p.id} value={p.id}>{p.headline}</option>)}</select></label>
    <textarea aria-label="向手册顾问提问" rows={3} maxLength={8000} value={pending?.request.question??question} disabled={busy||!!pending} onChange={e=>setQuestion(e.target.value)} placeholder="例如：这册还缺哪些值得用图解呈现的内容？请说明理由和新增页数。" className="w-full rounded bg-[#f9f6ee] p-3 text-[#243a35]" />
    {error&&<p role="alert" className="text-rose-200">{error}</p>}
    {pending&&<button type="button" disabled={busy} onClick={()=>void send(true)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40">核对失败与退款后重试</button>}
    <button type="button" disabled={busy||(!pending&&!question.trim())} onClick={()=>void send()} className="rounded-lg border border-[#b9c4ad] px-4 py-2 text-sm disabled:opacity-40">{busy?"正在处理…":pending?"恢复本次交流":"发送给顾问"}</button>
  </section>;
}
