import type {EditableLayout} from '@shared/editableLayout';
import {knowledgeConversationAnswerSchema} from '@shared/knowledgeConversation';
import {KNOWLEDGE_SUPPLEMENT_REFINEMENT_QUESTION} from '@shared/knowledgeSupplementRefinement';
import {knowledgeSupplementPlan} from '@shared/knowledgeSupplement';
/** 直接动作复用追加回执；中断恢复原ID，不打开聊天窗口或购买原图。 */
export async function refineKnowledgeSupplement(doc:EditableLayout,deps:{
 save:(doc:EditableLayout)=>Promise<unknown>;current:()=>EditableLayout;
 quote:()=>Promise<{maxCredits:number}>;send:(requestId:string,question:string,batchIndex:number)=>Promise<string>;
}){
 const pub=doc.publication;
 if(!pub?.review||pub.source.detailLevel!=='concise'||pub.supplementOf||pub.supplementDocumentId)throw Error('请先完成原精华版；已关联补充稿时请恢复该稿，不重复生成');
 if(!doc.pages.some(p=>p.imageUrl))throw Error('原精华图片尚未就绪，未开始补充');
 if(pub.source.pages.some(p=>p.imageJobId&&!doc.pages.find(x=>x.id===p.id)?.imageUrl))throw Error('原精华图片尚未全部就绪，请保留原任务等待');
 const original=pub.manuscript;
 const current=()=>{const d=deps.current();if(d.id!==doc.id||d.publication?.manuscript!==original)throw Error('已切换稿件，结果保留在原请求');return d;};
 let turn=pub.conversation?.find(t=>t.request.action==='supplement');
 if(!turn){
  if(pub.conversation?.some(t=>!t.response))throw Error('原整理请求尚未结束，请先恢复原任务');
  turn={request:{id:crypto.randomUUID(),action:'supplement',question:KNOWLEDGE_SUPPLEMENT_REFINEMENT_QUESTION,imagePageIds:[],manuscript:original}};
  const next=current();await deps.save({...next,publication:{...next.publication!,conversation:[...(next.publication!.conversation||[]),turn]},updatedAt:new Date().toISOString()});
 }
 let answer=turn.response;
 if(!answer){
  const quote=await deps.quote();if(quote.maxCredits!==0)throw Error('当前服务尚未应用整理不另收费规则，请恢复原请求');
  const next=current();await deps.save(next);
  const index=next.publication!.conversation!.findIndex(t=>t.request.id===turn!.request.id);
  const text=await deps.send(turn.request.id,turn.request.question,index);
  answer=knowledgeConversationAnswerSchema.parse(JSON.parse(text));
  if(answer.requestId!==turn.request.id||answer.layoutPlan)throw Error('补充提炼回执不符，未采用');
  const fresh=current();await deps.save({...fresh,publication:{...fresh.publication!,conversation:fresh.publication!.conversation!.map(t=>t.request.id===turn!.request.id?{...t,response:answer}:t)},updatedAt:new Date().toISOString()});
 }
 const selection={documentId:doc.id,conversationId:turn.request.id,indexes:answer.supplementalImages.map((_,i)=>i)};
 return {selection,markdown:knowledgeSupplementPlan(current(),selection).markdown};
}
