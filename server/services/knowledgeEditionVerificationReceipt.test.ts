import {it,expect} from 'vitest';
import {validateKnowledgeEditionVerificationReceipt} from './knowledgeEditionVerificationReceipt';
import {compileKnowledgeEditions} from '../../shared/knowledgeCardEdition';
import {synchronizedKnowledgeCardSource} from '../../shared/knowledgeCardEditableLayout';
import {layoutFromSource} from '../../shared/editableLayout';
import {planKnowledgeCardPages} from '../../shared/knowledgeCardPagination';
import {buildKnowledgePostImageConsistencyRequest} from './knowledgePublicationAdvisor';
it('核实回执必须属于本人成功原稿；成图后对照不再次联网',async()=>{
 const edition=compileKnowledgeEditions('主题',[{headline:'重点',body:'主要知识。'.repeat(120),priority:'primary'},{headline:'细项',body:'次要知识。',priority:'secondary'}]);
 const src=synchronizedKnowledgeCardSource({owner:'7',sourceId:'source',fullMarkdown:edition.full,illustrationMarkdown:edition.concise,detailLevel:'concise',imageJobIds:planKnowledgeCardPages(edition.concise).pages.map((_,i)=>`image-${i}`)});src.verificationJobId='kc_test';
 const source=layoutFromSource(src).publication!.source;
 const job:any={userId:'7',status:'succeeded',input:{action:'knowledge_card_derive_level'},output:{distilledMarkdown:edition.concise,fullEditionMarkdown:edition.full,verificationProcessed:true}};
 await expect(validateKnowledgeEditionVerificationReceipt(7,source,async()=>job)).resolves.toBeUndefined();
 await expect(validateKnowledgeEditionVerificationReceipt(8,source,async()=>job)).rejects.toThrow('本人');
 await expect(validateKnowledgeEditionVerificationReceipt(7,{...source,pages:source.pages.map((p,i)=>i? p:{...p,body:p.body+'改稿'})},async()=>job)).rejects.toThrow('正文已变化');
 await expect(validateKnowledgeEditionVerificationReceipt(7,source,async()=>({...job,output:{...job.output,verificationProcessed:false}}))).rejects.toThrow('未完成');
 const request=buildKnowledgePostImageConsistencyRequest('主题','a'.repeat(64),[]);
 expect(request.researchOnly).toBeUndefined();expect(JSON.stringify(request)).not.toContain('【联网知识补充】');expect(request.systemInstruction.parts[0].text).toContain('不再次联网');
});

// 直接串接正式恢复与成品来源生产函数，不给下游手工补回执或正文。
it('已核实两档从正式恢复入口接入生图云稿，保留原稿与同一核实身份',async()=>{
 const {assembleRecovery}=await import('./knowledgeCardRecovery');
 const editions=compileKnowledgeEditions('恢复接续',[{headline:'主要重点',body:'保留主要知识。'.repeat(80),priority:'primary'},{headline:'次要知识',body:'保留次要知识和说明。'.repeat(30),priority:'secondary'}]);
 const job={id:'kc_recovery_test',userId:'7',status:'succeeded',createdAt:new Date(),input:{action:'knowledge_card_derive_level',params:{distillModel:'glm-5.3-flashx'}},output:{distilledMarkdown:editions.concise,fullEditionMarkdown:editions.full,verificationProcessed:true,distillModel:'glm-5.3-flashx'}};
 const recovered=assembleRecovery('7',job,[job]);
 expect(recovered.fullMarkdown).toBe(editions.full);expect(recovered.conciseMarkdown).toBe(editions.concise);expect(recovered.verificationJobId).toBe(job.id);expect(recovered.images).toEqual([]);
 for(const detailLevel of ['full','concise'] as const){
  const markdown=(detailLevel==='full'?recovered.fullMarkdown:recovered.conciseMarkdown)!;
  const imageJobIds=planKnowledgeCardPages(markdown,recovered.distillModel).pages.map((_,i)=>`image-${detailLevel}-${i}`);
  const src=synchronizedKnowledgeCardSource({owner:'7',sourceId:`resume-${detailLevel}`,fullMarkdown:recovered.fullMarkdown!,illustrationMarkdown:markdown,detailLevel,distillModel:recovered.distillModel,imageJobIds});
  src.verificationJobId=recovered.verificationJobId!;
  const document=layoutFromSource(src);
  await expect(validateKnowledgeEditionVerificationReceipt(7,document.publication!.source,async()=>job as any)).resolves.toBeUndefined();
  expect(document.publication!.source.pages.filter(p=>p.imageJobId).map(p=>p.imageJobId)).toEqual(imageJobIds);
 }
});
