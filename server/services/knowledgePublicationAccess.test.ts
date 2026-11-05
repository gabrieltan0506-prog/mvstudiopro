import {describe,it,expect,vi,beforeEach} from "vitest";
import {layoutFromSource} from "../../shared/editableLayout";
import {knowledgeBatchRequestId} from "../../shared/knowledgePublication";
const state=vi.hoisted(()=>({doc:null as any,previous:null as any}));
vi.mock("./editableLayoutStore",()=>({readCanonicalLayoutLibrary:vi.fn(async(owner:number)=>({library:owner===7?{documents:[state.doc]}:{documents:[]}}))}));
vi.mock("../jobs/repository",()=>({getJobByIdStrict:vi.fn(async()=>state.previous)}));
vi.mock("./postProdMediaSource",()=>({loadSucceededJobOutputSources:vi.fn(async()=>({objects:new Set(),urls:new Set()})),resolveRegisteredPostProdMediaSource:vi.fn(async()=>{throw new Error("配图不属于本人");})}));
import {validateKnowledgePublicationAccess} from "./knowledgePublicationAdvisor";
describe("审校归属与重试扣费门禁",()=>{
 beforeEach(()=>{state.doc=layoutFromSource({kind:"knowledge-publication",owner:"7",sourceId:"test",title:"知识",body:"事实说明"});state.previous=null;});
 it("其他账号及超范围批次不得访问",async()=>{
  const context={documentId:state.doc.id,batchIndex:0,attempt:0};
  await expect(validateKnowledgePublicationAccess(8,context,state.doc.publication.requestId)).rejects.toThrow("不属于");
  const request=knowledgeBatchRequestId(state.doc.publication.requestId,2);
  await expect(validateKnowledgePublicationAccess(7,{...context,batchIndex:2},request)).rejects.toThrow("超出");
 });
 it("运行中、缺失及退款未闭合不可新开重试，失败已退款才可",async()=>{
  state.doc.publication.attempts={0:1};
  const context={documentId:state.doc.id,batchIndex:0,attempt:1},request=knowledgeBatchRequestId(state.doc.publication.requestId,0,1);
  for(const previous of [null,{status:"running"},{status:"failed",output:{action:"manhua_advisor_qa_refund_pending"}}]){
   state.previous=previous;await expect(validateKnowledgePublicationAccess(7,context,request)).rejects.toThrow("退款未闭合");
  }
  state.previous={status:"failed",output:{action:"manhua_advisor_qa_refund_reconciled"}};
  expect((await validateKnowledgePublicationAccess(7,context,request,undefined,async()=>null)).id).toBe(state.doc.id);
 });
 it("上游结果不明即使事务已退款也不能新开付费请求",async()=>{
  state.doc.publication.attempts={0:1};state.previous={status:"failed",output:{action:"manhua_advisor_qa_refund_reconciled"}};
  const context={documentId:state.doc.id,batchIndex:0,attempt:1};
  await expect(validateKnowledgePublicationAccess(7,context,knowledgeBatchRequestId(state.doc.publication.requestId,0,1),undefined,async()=>({state:"unknown"}))).rejects.toThrow("结果尚待核实");
 });
 it("任意客户图片URL不能跳过本人素材登记",async()=>{
  state.doc.publication.source.pages[0].imageUrl="gs://test/other.png";
  await expect(validateKnowledgePublicationAccess(7,{documentId:state.doc.id,batchIndex:0,attempt:0},state.doc.publication.requestId)).rejects.toThrow("不属于本人");
 });
});
