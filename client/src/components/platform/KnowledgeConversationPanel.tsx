import {KNOWLEDGE_INTERIOR_PRICE_COPY} from "@shared/knowledgePublicationPricing";
import {knowledgeSupplementPlan,type KnowledgeSupplementSelection} from "@shared/knowledgeSupplement";
import { useRef, useState } from "react";
import type { EditableLayout } from "@shared/editableLayout";
import { knowledgeConversationAnswerSchema, knowledgeConversationRequestSchema } from "@shared/knowledgeConversation";
import { streamManhuaAdvisor } from "@/lib/manhuaAdvisorStream";
import { trpc } from "@/lib/trpc";
import { knowledgePublicationPublicError } from "@shared/knowledgePublicationPublic";

export default function KnowledgeConversationPanel({doc,busy,save,lock,onSupplement,onLayout}:{onLayout?:(doc:EditableLayout,saved:{generation:string})=>Promise<void>;onSupplement?:(selection:KnowledgeSupplementSelection,markdown:string)=>Promise<void>;doc:EditableLayout;busy:boolean;save:(doc:EditableLayout)=>Promise<{generation:string}>;lock:(value:boolean)=>void}) {
  const utils=trpc.useUtils(),[question,setQuestion]=useState(""),[images,setImages]=useState<string[]>([]),[error,setError]=useState("");
  const inFlight=useRef(false);
  const [selected,setSelected]=useState<Record<string,number[]>>({});
  const turns=doc.publication?.conversation||[],pending=turns.at(-1)?.response?null:turns.at(-1);
  const send=async(retry=false,action?:"layout")=>{
    if(busy || inFlight.current || (!pending&&!action&&!question.trim()))return;
    const prompt=action === "layout" ? question.trim() || "请根据完整正文和现有全部图卡重新安排整册顺序与设计，将补充图放到相关内容附近，保留每段文字和每张图片。" : question;

    // 与问答入口保持同一最低长度，避免先保存一个永远无法提交的待回复问题。
    if (!pending && !knowledgeConversationRequestSchema.shape.question.safeParse(prompt).success) {
      setError("请输入 2 至 8000 个字的问题，再发送给顾问。");
      return;
    }
    inFlight.current=true;lock(true);setError("");
    try {
      let base=doc;
      if((action==="layout"||pending?.request.action==="layout")&&doc.publication?.billing&&!doc.publication.billing.confirmed){
        if(!window.confirm(KNOWLEDGE_INTERIOR_PRICE_COPY+" 是否确认排版后自动结算？"))return;
        base={...doc,publication:{...doc.publication,billing:{...doc.publication.billing,confirmed:true}}};
      }
      let layoutInput:{sourceDigest:string;chapters:number;images:number}|undefined;
      if(action === "layout" && !pending){
        // 先保存用户眼前的完整稿件，服务端按同一版父子稿件生成摘要。
        await save(base);
        layoutInput=await utils.editableLayout.bookLayoutInput.fetch({documentId:doc.id});
      }
      const quote=await utils.editableLayout.publicationQuote.fetch({documentId:doc.id,purpose:"conversation"});
      if(quote.maxCredits!==0)throw Error("当前服务尚未应用顾问不另收费规则，请刷新后恢复原任务");
      const retryId=retry&&pending?(await utils.editableLayout.conversationRetry.fetch({documentId:doc.id,failedRequestId:pending.request.id})).requestId:null;
      const turn=retryId&&pending?{request:{...pending.request,id:retryId,retryOf:pending.request.id}}:pending||{request:{id:crypto.randomUUID(),question:prompt.trim(),imagePageIds:action === "layout" ? [] : images,manuscript:doc.publication!.manuscript,...(layoutInput?{action:"layout" as const,layoutSourceDigest:layoutInput.sourceDigest}:{})}};
      const history=pending&&!retryId?turns:[...turns,turn];
      let next:EditableLayout={...base,publication:{...base.publication!,conversation:history},updatedAt:new Date().toISOString()};
      await save(next);
      const response=await streamManhuaAdvisor({question:turn.request.question,rawQuestion:turn.request.question,requestId:turn.request.id,knowledgePublicationContext:{documentId:doc.id,batchIndex:history.length-1,attempt:0,purpose:"conversation"},confirmPaid:quote.maxCredits>0,confirmedCredits:quote.paidUnit},()=>undefined);
      const answer=knowledgeConversationAnswerSchema.parse(JSON.parse(response.answer));
      if(answer.requestId!==turn.request.id)throw Error("对话请求编号不符");
      if(turn.request.action === "layout" && (!answer.layoutPlan || answer.layoutPlan.sourceDigest!==turn.request.layoutSourceDigest))throw Error("顾问排版方案与本次稿件不符");
      next={...next,publication:{...next.publication!,...(turn.request.action === "layout"?{layoutConversationId:turn.request.id}:{}),conversation:[...history.slice(0,-1),{...turn,response:answer}]},updatedAt:new Date().toISOString()};
      const saved=await save(next);setQuestion("");setImages([]);
      if(turn.request.action === "layout"){
        if(!onLayout)throw Error("排版方案已保存，请从手册入口导出PDF");
        await onLayout(next,saved);
      }
    }catch(e){setError(knowledgePublicationPublicError(e).message);}finally{inFlight.current=false;lock(false);}
  };
  const applyLayout=async(id:string)=>{
    if(busy||inFlight.current||!onLayout)return;
    inFlight.current=true;lock(true);setError("");
    try{
      const next={...doc,publication:{...doc.publication!,layoutConversationId:id},updatedAt:new Date().toISOString()};
      const saved=await save(next);
      await onLayout(next,saved);
    }catch(e){setError(knowledgePublicationPublicError(e).message);}finally{inFlight.current=false;lock(false);}
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
        {t.response.layoutPlan&&<div className="space-y-2"><p>顾问排版方案覆盖 {t.response.layoutPlan.chapters.length} 个图文章节，保留全部原文和图卡。</p><button type="button" disabled={busy||!!pending||!onLayout} onClick={()=>void applyLayout(t.request.id)} className="rounded border px-3 py-2 disabled:opacity-40">{doc.publication?.layoutConversationId===t.request.id?"导出当前顾问排版（不重新规划）":"采用此方案并导出 PDF"}</button></div>}
        {t.response.sources.length>0&&<ul>{t.response.sources.map(s=><li key={s.url}><a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">{s.title}</a></li>)}</ul>}
        {t.response.supplementalImages.length>0&&<div><p>建议新增 {t.response.supplementalImages.length} 页图卡（尚未生成）</p>{t.response.supplementalImages.map((p,i)=><details key={i}><summary>{i+1}. {p.title}</summary><label><input type="checkbox" disabled={busy||!!doc.publication?.supplementDocumentId||!!doc.publication?.supplementOf} checked={(selected[t.request.id]||[]).includes(i)} onChange={e=>setSelected(v=>({...v,[t.request.id]:e.target.checked?[...(v[t.request.id]||[]),i]:(v[t.request.id]||[]).filter(n=>n!==i)}))}/>选择本项图解</label><p>{p.reason}</p><p className="whitespace-pre-wrap">{p.content}</p></details>)}{onSupplement&&!doc.publication?.supplementOf&&<button type="button" disabled={busy||!!doc.publication?.supplementDocumentId||!(selected[t.request.id]?.length)} onClick={()=>void supplement(t.request.id)} className="mt-2 rounded border px-3 py-2 disabled:opacity-40">查看实际页数与报价，再确认生成</button>}{doc.publication?.supplementDocumentId&&<p>本册已关联补充稿；在稿件列表中恢复，审校完成后从原册导出合册。</p>}</div>}
      </>:<p>已保存原问题，等待回复；中断后可恢复同一请求。</p>}
    </article>)}</div>
    <label className="block text-sm">本次审看的图片（最多 4 张）<select aria-label="对话参考图片" multiple value={images} disabled={busy||!!pending} onChange={e=>{const ids=Array.from(e.target.selectedOptions,o=>o.value);if(ids.length<=4)setImages(ids);}} className="mt-1 block w-full rounded bg-[#f9f6ee] p-2 text-[#243a35]">{doc.pages.filter(p=>p.imageUrl).map(p=><option key={p.id} value={p.id}>{p.headline}</option>)}</select></label>
    <textarea aria-label="向手册顾问提问" rows={3} maxLength={8000} value={pending?.request.question??question} disabled={busy||!!pending} onChange={e=>setQuestion(e.target.value)} placeholder="例如：这册还缺哪些值得用图解呈现的内容？请说明理由和新增页数。" className="w-full rounded bg-[#f9f6ee] p-3 text-[#243a35]" />
    {error&&<p role="alert" className="text-rose-200">{error}</p>}
    {!pending&&doc.publication?.review&&!doc.publication.supplementOf&&<button type="button" disabled={busy||!onLayout} onClick={()=>void send(false,"layout")} className="rounded-lg border border-[#b9c4ad] px-4 py-2 text-sm disabled:opacity-40">让顾问重新排版并导出 PDF</button>}
    {pending&&<button type="button" disabled={busy} onClick={()=>void send(true)} className="rounded-lg border px-4 py-2 text-sm disabled:opacity-40">核对失败与退款后重试</button>}
    <button type="button" disabled={busy||(!pending&&!question.trim())} onClick={()=>void send()} className="rounded-lg border border-[#b9c4ad] px-4 py-2 text-sm disabled:opacity-40">{busy?"正在处理…":pending?"恢复本次交流":"发送给顾问"}</button>
  </section>;
}
