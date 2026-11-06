import type {LayoutLibrary} from "../../shared/editableLayout";
import {knowledgeSupplementPlan} from "../../shared/knowledgeSupplement";
import {readKnowledgePublicationReview} from "./knowledgePublicationAdvisor";
import {downloadGcsObjectVersioned,getGcsBucketName} from "./gcs";
const real={review:readKnowledgePublicationReview,conversation:async(owner:number,id:string,requestId:string)=>JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/knowledge-publications/user-${owner}/${id}/conversation/${requestId}/report.json`})).buffer.toString())};
/** 双向绑定和总量在云稿CAS前核实；不重新生成原图，也不允许补充稿无限递归。 */
export async function validateKnowledgeSupplements(owner:number,before:LayoutLibrary|undefined,after:LayoutLibrary,deps=real){
 for(const old of before?.documents||[]){
  if(!old.publication?.supplementOf&&!old.publication?.supplementDocumentId)continue;
  const next=after.documents.find(d=>d.id===old.id);
  if(!next||JSON.stringify(old.publication.supplementOf)!==JSON.stringify(next.publication?.supplementOf)||old.publication.supplementDocumentId!==next.publication?.supplementDocumentId)throw Error("已关联补充稿不能删除或改绑，请恢复原任务");
 }
 for(const child of after.documents){
  const selection=child.publication?.supplementOf;if(!selection)continue;
  const parent=after.documents.find(d=>d.id===selection.documentId);
  if(!parent?.publication||parent.id===child.id||child.publication?.supplementDocumentId)throw Error("补充稿归属无效，禁止递归扩充");
  const plan=knowledgeSupplementPlan(parent,selection);
  const imagePages=child.publication!.source.pages.filter(p=>p.imageJobId);
  const textPages=child.publication!.source.pages.filter(p=>!p.imageJobId);
  if(imagePages.length!==plan.pages.length||imagePages.some((p,i)=>p.body!==plan.pages[i])||textPages.length!==plan.pages.length||textPages.some((p,i)=>p.body!==plan.pages[i]))throw Error("补充稿必须保留选定建议及实际分页，不得超过8张新图");
  if(child.publication!.synchronizedStarted!==false&&parent.publication.supplementDocumentId!==child.id)throw Error("请先关联原手册后再启动补图");
  const old=before?.documents.find(d=>d.id===child.id);
  if(!old){
   const report=await deps.review(owner,parent.id,parent.publication.requestId);
   if(JSON.stringify(report.report)!==JSON.stringify(parent.publication.review))throw Error("原手册全册审校回执不一致");
   const answer=await deps.conversation(owner,parent.id,selection.conversationId);
   const turn=parent.publication.conversation?.find(t=>t.request.id===selection.conversationId);
   if(JSON.stringify(answer.answer)!==JSON.stringify(turn?.response))throw Error("补图建议与永久回执不一致");
  }
 }
 for(const parent of after.documents){
  const id=parent.publication?.supplementDocumentId;if(!id)continue;
  const child=after.documents.find(d=>d.id===id);
  if(child?.publication?.supplementOf?.documentId!==parent.id||child.publication.synchronizedStarted!==true)throw Error("原手册与补充稿必须双向关联");
 }
}
