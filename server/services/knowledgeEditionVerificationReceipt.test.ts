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
