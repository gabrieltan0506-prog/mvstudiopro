import {describe,it,expect,vi} from 'vitest';
import {checkKnowledgePresentationRetry,knowledgePresentationRetryId,validateKnowledgePresentationRetryTransition} from './knowledgePresentationRetry';
import {knowledgePublicationPublicError} from '../../shared/knowledgePublicationPublic';
import {layoutFromSource} from '../../shared/editableLayout';
import {MANHUA_ADVISOR_REFUND_RECONCILED_ACTION,MANHUA_ADVISOR_FAILED_ACTION} from './manhuaAdvisorOperation';
function fixture(){
 const doc=layoutFromSource({owner:'7',sourceId:'fixture',kind:'knowledge-publication',detailLevel:'full',title:'水循环',body:'',pages:[{pageIndex:1,headline:'蒸发',body:'说明'}]});
 doc.publication!.presentationRequest={id:'11111111-1111-4111-a111-111111111111',minSlides:1,maxSlides:3,manuscript:doc.publication!.manuscript};
 const id=doc.publication!.presentationRequest.id;
 const job:any={userId:'7',status:'failed',input:{requestId:id},output:{action:MANHUA_ADVISOR_REFUND_RECONCILED_ACTION,creditsRefunded:1}};
 const records:Record<string,any>={};
 const deps={job:vi.fn(async()=>job),billing:vi.fn(async(_owner:number,_chargeKey:string,_refundKey:string)=>({charged:1,settled:true})),read:vi.fn(async(k:string)=>records[k.split('/').at(-1)!]??null)};
 return {doc,id,job,records,deps};
}
describe('KP-04 无提纲终态重试',()=>{
 it('退款与上游明确失败才返回唯一后继ID，保持原稿与原请求',async()=>{
  const f=fixture(),before=JSON.stringify(f.doc);
  f.records['route-openrouter.json']={state:'failed',response:{status:500,text:'错误'}};
  const a=await checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps),b=await checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps);
  expect(a).toEqual(b);expect(a.requestId).not.toBe(f.id);expect(JSON.stringify(f.doc)).toBe(before);
  expect(f.deps.billing.mock.calls[0][2]).toMatch(/^refund:\[refundKey:manhuaAdvisor\//);
 });
 it.each(['running','queued','succeeded'])('%s不得更换请求',async status=>{const f=fixture();f.job.status=status;await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('尚未确认失败');expect(f.deps.billing).not.toHaveBeenCalled();});
 it.each(['pending','unknown','received'])('上游%s阻止换号，即使本地已退款',async state=>{const f=fixture();f.records['route-vertex.json']={state};await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('上游请求状态尚未闭合');});
 it.each(['report.json','accepted.json','raw.json'])('%s已有结果不可重购',async key=>{const f=fixture();f.records[key]={result:'保留'};await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('原请求已有结果');});
 it('拒绝待退款、缺退款账、退款金额不足',async()=>{
  const f=fixture();f.job.output.action='manhua_advisor_qa_refund_pending';await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('仍在对账');
  f.job.output.action=MANHUA_ADVISOR_REFUND_RECONCILED_ACTION;f.deps.billing.mockResolvedValue({charged:1,settled:false});await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('退款尚未');
  f.deps.billing.mockResolvedValue({charged:2,settled:true});await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('退款尚未');
 });
 it('缺失退款金额与读取失败不能按零费用放行',async()=>{
  const f=fixture();delete f.job.output.creditsRefunded;
  await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('退款尚未确认');
  f.job.output.creditsRefunded=1;f.deps.read.mockRejectedValueOnce(Error('存储不可用'));
  await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('存储不可用');
 });
 it('重试门禁文案经过服务端和前端两次过滤仍然一致',()=>{
  for(const message of ['原请求尚未确认失败','上游请求状态尚未闭合','原请求退款尚未确认完成','原请求积分仍在对账','积分账暂不可读取','原请求已有结果','稿件或提纲已变化']){
   const once=knowledgePublicationPublicError(Error(message));
   expect(knowledgePublicationPublicError(Error(once.message))).toEqual(once);
   expect(once.message).not.toContain('上游');
  }
 });
 it('未扣款明确失败可重试，错用户与缺回执拒绝',async()=>{
  const f=fixture();f.job.output.action=MANHUA_ADVISOR_FAILED_ACTION;f.deps.billing.mockResolvedValue({charged:0,settled:true});await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).resolves.toHaveProperty('requestId');
  await expect(checkKnowledgePresentationRetry(8,f.doc,f.id,f.deps)).rejects.toThrow('尚未确认失败');f.job.userId='8';await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('尚未确认失败');
 });
 it('保存层重验并拒绝随机后继ID；同ID正常保存不调用门禁',async()=>{
  const f=fixture(),after=structuredClone(f.doc);const check=vi.fn(async()=>({requestId:knowledgePresentationRetryId(7,f.doc.id,f.id)}));
  await validateKnowledgePresentationRetryTransition(7,f.doc,after,check);expect(check).not.toHaveBeenCalled();
  after.publication!.presentationRequest!.id='22222222-2222-4222-a222-222222222222';await expect(validateKnowledgePresentationRetryTransition(7,f.doc,after,check)).rejects.toThrow('核对失败');
  after.publication!.presentationRequest!.id=knowledgePresentationRetryId(7,f.doc.id,f.id);await validateKnowledgePresentationRetryTransition(7,f.doc,after,check);expect(check).toHaveBeenCalledTimes(2);
  check.mockRejectedValueOnce(Error('退款仍在对账'));await expect(validateKnowledgePresentationRetryTransition(7,f.doc,after,check)).rejects.toThrow('退款仍在对账');
 });
});

it.each(['glm-openrouter','glm-evolink','openrouter-retry-2','glm-evolink-retry-3'])('新增%s回执未闭合时拒绝换号重购',async route=>{
 const f=fixture();f.records['route-'+route+'.json']={state:'unknown'};
 await expect(checkKnowledgePresentationRetry(7,f.doc,f.id,f.deps)).rejects.toThrow('上游请求状态尚未闭合');
});
