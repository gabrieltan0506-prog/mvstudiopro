import { webcrypto } from "node:crypto";
import { describe,expect,it,vi } from "vitest";
import { createKnowledgeReadingPreparation,knowledgeReadingPreparationState,validateKnowledgeReadingAccess,reviewKnowledgeReading,loadVerifiedKnowledgeReadingNotes } from "./knowledgeReadingPreparation";
import { knowledgeBatchRequestId } from "../../shared/knowledgePublication";
import { synchronizedKnowledgeCardSource } from "../../shared/knowledgeCardEditableLayout";
import { layoutFromSource } from "../../shared/editableLayout";
import { planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";
vi.stubGlobal("crypto",webcrypto);
function fixture(){
 const data=new Map<string,any>(),job:any={userId:"7",status:"running",input:{action:"knowledge_card_distill"},output:{}};
 const deps:any={read:vi.fn(async(k:string)=>data.get(k)||null),save:vi.fn(async(k:string,v:any)=>{data.set(k,structuredClone(v));}),job:vi.fn(async()=>job),post:vi.fn(async(req:any)=>{
  const {source,sourceDigest}=JSON.parse(req.contents[0].parts[0].text);
  return {text:JSON.stringify({candidates:[{content:{parts:[{text:JSON.stringify({kind:"knowledge_publication_v1",title:source.title,sourceDigest,pages:source.pages.map((p:any)=>({...p,imageUrl:undefined,role:undefined,body:p.body,imageDescription:"未生成图片，仅整理原文",imageStatus:"absent",facts:[{term:"知识",statement:p.body}],cautions:[]}))})}]}}],modelVersion:"test-model"})};
 })};
 return{data,deps,job};
}
describe("读档稳定分段与原顾问回执",()=>{
 it("乱序段只在一组全部到齐后可审，固定原文不被后续段覆盖",async()=>{
  const f=fixture(),p=createKnowledgeReadingPreparation(7,"kc_test",f.deps);await p.onPlan(5);
  for(const index of [2,0,1])await p.onChunk({index,total:5,markdown:`## 段${index}\n完整说明${index}`});
  expect(p.progress()?.ready).toEqual([]);
  await p.onChunk({index:4,total:5,markdown:"## 最末段\n尾部证据"});expect(p.progress()?.ready).toEqual([1]);
  await p.onChunk({index:3,total:5,markdown:"## 第四段\n独立说明"});expect(p.progress()?.ready).toEqual([0,1]);
  expect(f.data.get("knowledge-reading/user-7/kc_test/batch-0/input.json").source.pages.map((v:any)=>v.headline)).toEqual(["原稿第 1 段","原稿第 2 段","原稿第 3 段","原稿第 4 段"]);
  await expect(p.onChunk({index:0,total:5,markdown:"偷换内容"})).rejects.toThrow("不能覆盖");
 });
 it("成功回执复用不再次调用模型，跨账号与错误请求拒绝",async()=>{
  const f=fixture(),p=createKnowledgeReadingPreparation(7,"kc_test",f.deps);await p.onPlan(1);await p.onChunk({index:0,total:1,markdown:"## 原文\n完整说明。"});
  const link=p.progress()!,ctx:any={documentId:link.documentId,readingJobId:link.jobId,purpose:"reading",batchIndex:0,attempt:0};
  const id=knowledgeBatchRequestId(ctx.documentId,0);
  await validateKnowledgeReadingAccess(7,ctx,id,f.deps);
  await expect(validateKnowledgeReadingAccess(8,ctx,id,f.deps)).rejects.toThrow("不属于");
  await expect(validateKnowledgeReadingAccess(7,ctx,"wrong",f.deps)).rejects.toThrow("不符");
  const a=await reviewKnowledgeReading(7,ctx,f.deps),b=await reviewKnowledgeReading(7,ctx,f.deps);
  expect(b).toEqual(a);expect(f.deps.post).toHaveBeenCalledTimes(1);
  expect((await knowledgeReadingPreparationState(7,link.jobId,f.deps)).completed).toEqual([0]);
 });
 it("最终顾问只复用同一完整稿，未配图末章仍在",async()=>{
  const f=fixture(),p=createKnowledgeReadingPreparation(7,"kc_test",f.deps),full="## 原文\n未配图的最后一句。";
  await p.onPlan(1);await p.onChunk({index:0,total:1,markdown:full});await p.finish(full);
  const link=p.progress()!,ctx:any={documentId:link.documentId,readingJobId:link.jobId,purpose:"reading",batchIndex:0,attempt:0};await reviewKnowledgeReading(7,ctx,f.deps);
  f.job.status="succeeded";f.job.output={distilledMarkdown:full};
  const source:any={title:"全文",detailLevel:"concise",pages:planKnowledgeCardPages(full).pages.map((body,i)=>({id:webcrypto.randomUUID(),headline:"正文",body,imageUrl:"",role:"reading"}))};
  expect((await loadVerifiedKnowledgeReadingNotes(7,link,source,f.deps))[0].pages[0].body).toContain("最后一句");
  const fullSource=synchronizedKnowledgeCardSource({owner:"7",sourceId:"same",fullMarkdown:full,illustrationMarkdown:full,detailLevel:"full",imageJobIds:planKnowledgeCardPages(full).pages.map((_,i)=>`image-${i}`)});
  expect((await loadVerifiedKnowledgeReadingNotes(7,link,layoutFromSource(fullSource).publication!.source,f.deps))[0].pages[0].body).toContain("最后一句");
  source.pages[0].body="另一份文件";await expect(loadVerifiedKnowledgeReadingNotes(7,link,source,f.deps)).rejects.toThrow("不一致");
 });
});
