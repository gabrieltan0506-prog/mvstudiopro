import type {KnowledgeSource} from '../../shared/knowledgePublication';
import {knowledgeEditionParts} from '../../shared/knowledgeCardEdition';
import {planKnowledgeCardPages} from '../../shared/knowledgeCardPagination';
import {getJobByIdStrict} from '../jobs/repository';
/** 只能复用本人已完成、逐页吻合的末段核实记录，不能凭客户端布尔值跳过。 */
export async function validateKnowledgeEditionVerificationReceipt(owner:number,source:KnowledgeSource,load=getJobByIdStrict){
 if(!source.verificationJobId)return;
 const job=await load(source.verificationJobId),input=job?.input as any,out=job?.output as any;
 if(!job||String(job.userId)!==String(owner)||job.status!=='succeeded'||input?.action!=='knowledge_card_derive_level'||out?.verificationProcessed!==true)throw Error('生图前核实回执不存在、未完成或不属于本人');
 const markdown=source.detailLevel==='full'?out.fullEditionMarkdown:out.distilledMarkdown;
 const parts=knowledgeEditionParts(String(markdown||''));if(!parts||parts.level!==source.detailLevel)throw Error('核实回执的档位与稿件不符');
 const expected=[...(parts.reading?planKnowledgeCardPages(parts.reading,out.distillModel).pages:[]).map(body=>({body,role:'reading'})),...planKnowledgeCardPages(markdown,out.distillModel).pages.map(body=>({body,role:'illustration'}))];
 if(JSON.stringify(expected)!==JSON.stringify(source.pages.map(p=>({body:p.body,role:p.role}))))throw Error('正文已变化，不能复用旧的联网核实回执');
}
