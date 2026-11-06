import type {EditableLayout,LayoutLibrary} from '../../shared/editableLayout';
import {KNOWLEDGE_INTERIOR_BILLING_VERSION,knowledgeInteriorPrice} from '../../shared/knowledgePublicationPricing';
import {deductCreditsAmount} from '../credits';

/** 新稿必须保留计费条款；历史稿不因恢复/下载被追溯收费。 */
export function validateKnowledgeBillingTransition(before:LayoutLibrary|undefined,after:LayoutLibrary){
 for(const doc of after.documents){
  if(!doc.publication)continue;
  const old=before?.documents.find(d=>d.id===doc.id)?.publication;
  if(!old&&!doc.publication.billing)throw Error('新手册缺少内文计费条款，请刷新后确认生成');
  if(old?.billing&&(!doc.publication.billing||old.billing.confirmed&&!doc.publication.billing.confirmed))throw Error('已保存的内文计费条款不能删除或撤回');
 }
}
export function assertKnowledgeInteriorConsent(doc:EditableLayout){
 if(doc.publication?.billing&&!doc.publication.billing.confirmed)throw Error('请先确认内文按实际页数计费，未扣费');
}
/** 只在有效PDF永久保存、真实计页成功后调用；失败不预扣，同稿并发由原账本唯一键兜底。 */
export async function settleKnowledgeInterior(owner:number,doc:EditableLayout,totalPages:number,imagePages:number,deduct=deductCreditsAmount){
 const terms=doc.publication?.billing;
 if(!terms)return undefined;
 assertKnowledgeInteriorConsent(doc);
 const quote=knowledgeInteriorPrice(totalPages,imagePages);
 const chargeKey=`knowledge-interior/${owner}/${doc.publication!.supplementOf?.documentId||doc.id}`;
 const receipt=await deduct(owner,quote.credits,'knowledgeInterior',`图文手册内文 ${quote.readingPages} 页 × ${quote.unitCredits} 积分；顾问不另收`,{chargeKey});
 if(!receipt.success)throw Error('内文积分结算未完成，成品已保存，请恢复同一稿件');
 return {version:KNOWLEDGE_INTERIOR_BILLING_VERSION,...quote,chargedCredits:receipt.cost,alreadyCharged:'alreadyCharged' in receipt&&receipt.alreadyCharged===true};
}
