import { createHash } from "node:crypto";
import { z } from "zod";
import { getJobByIdStrict } from "../jobs/repository";
import { downloadGcsObjectVersioned, getGcsBucketName, uploadBufferToGcs } from "./gcs";
import { knowledgeBatchRequestId, knowledgeSourceSchema, validateKnowledgeReview, type KnowledgePublicationContext, type KnowledgeReview, type KnowledgeSource } from "../../shared/knowledgePublication";
import { knowledgeReadingPreparationSchema, type KnowledgeReadingChunk, type KnowledgeReadingPreparation, type KnowledgeReadingProgress } from "../../shared/knowledgeReadingPreparation";
import { planKnowledgeCardPages } from "../../shared/knowledgeCardPagination";

const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function stableId(text: string) { const h = hash(text); return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`; }
const prefix = (owner: number, jobId: string) => {
  if (!Number.isSafeInteger(owner) || owner < 1 || !/^kc_[a-zA-Z0-9_-]+$/.test(jobId)) throw Error("读档任务身份无效");
  return `knowledge-reading/user-${owner}/${jobId}`;
};
const store = {
  async read(name: string): Promise<any> {
    try { return JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${name}`})).buffer.toString("utf8")); }
    catch (e) { if (e instanceof Error && e.message === "gcs_stat_failed:404") return null; throw e; }
  },
  async save(name: string, value: unknown) {
    await uploadBufferToGcs({objectName:name, buffer:Buffer.from(JSON.stringify(value)), contentType:"application/json"});
  },
};
const planSchema = knowledgeReadingPreparationSchema.extend({ totalChunks: z.number().int().min(1), rawSources: z.array(z.object({key:z.string(),digest:z.string()}).strict()).optional() }).strict();
const batchSchema = z.object({ index:z.number().int().min(0), source:knowledgeSourceSchema, sourceDigest:z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export function createKnowledgeReadingPreparation(owner: number, jobId: string, deps = store) {
  const root = prefix(owner, jobId), chunks = new Map<number, KnowledgeReadingChunk>(), pending = new Map<number, Promise<void>>(), ready = new Set<number>();
  let plan: z.infer<typeof planSchema> | undefined;
  const progress = (): KnowledgeReadingProgress | undefined => plan && ({jobId,documentId:plan.documentId,batches:plan.batches,ready:Array.from(ready).sort((a,b)=>a-b)});
  return {
    progress,
    async onSource(key: string, parts: string[]) {
      if (!parts.length || parts.some(p => !p.trim() || p.length > 6000)) throw Error("原文分段为空或超出容量");
      const digest = hash(JSON.stringify(parts));
      const prior = plan || await deps.read(`${root}/plan.json`);
      if (prior && !prior.rawSources) throw Error("已有提炼顾问计划，不能覆盖为另一份原稿");
      if (prior) plan = planSchema.parse(prior);
      const previous = plan?.rawSources?.find(item => item.key === key);
      if (previous) {
        if (previous.digest !== digest) throw Error("原读档内容已改变，禁止重复购买");
        for (let i=0;i<plan!.batches;i++) ready.add(i);
        return;
      }
      const start = plan?.batches || 0;
      for (let offset=0;offset<parts.length;offset+=4) {
        const index=start+Math.floor(offset/4);
        const source=knowledgeSourceSchema.parse({title:"读档中的知识整理",pages:parts.slice(offset,offset+4).map((body,i)=>({id:stableId(`${jobId}:${key}:${offset+i}`),headline:body.split(/\r?\n/).find(line=>line.trim())!.replace(/^#+\s*/, "").slice(0,100),body,imageUrl:"",role:"reading"}))});
        const value=batchSchema.parse({index,source,sourceDigest:hash(JSON.stringify(source))});
        const old=await deps.read(`${root}/batch-${index}/input.json`);
        if(old && JSON.stringify(old)!==JSON.stringify(value))throw Error("原顾问分段内容已改变，未重复提交");
        if(!old)await deps.save(`${root}/batch-${index}/input.json`,value);
        ready.add(index);
      }
      plan=planSchema.parse({jobId,documentId:stableId(jobId),totalChunks:(plan?.totalChunks||0)+parts.length,batches:start+Math.ceil(parts.length/4),rawSources:[...(plan?.rawSources||[]),{key,digest}]});
      await deps.save(`${root}/plan.json`,plan);
    },
    async onPlan(total: number) {
      if (plan?.rawSources) return;
      plan = planSchema.parse({jobId,documentId:stableId(jobId),totalChunks:total,batches:Math.ceil(total/4)});
      const prior = await deps.read(`${root}/plan.json`);
      if (prior && JSON.stringify(prior) !== JSON.stringify(plan)) throw Error("原读档分段计划已改变，禁止覆盖已有顾问任务");
      if (!prior) await deps.save(`${root}/plan.json`,plan);
    },
    async onChunk(chunk: KnowledgeReadingChunk) {
      if (plan?.rawSources) return;
      if (!plan || chunk.total !== plan.totalChunks || chunk.index < 0 || chunk.index >= plan.totalChunks) throw Error("读档分段与顾问计划不一致");
      const old = chunks.get(chunk.index);
      if (old && JSON.stringify(old) !== JSON.stringify(chunk)) throw Error("已读取分段不能覆盖");
      chunks.set(chunk.index,chunk);
      const index = Math.floor(chunk.index/4), start=index*4, end=Math.min(start+4,plan.totalChunks);
      if (pending.has(index)) return pending.get(index);
      if (Array.from({length:end-start},(_,i)=>start+i).some(i=>!chunks.has(i))) return;
      const work = (async()=>{
        const selected = Array.from({length:end-start},(_,i)=>chunks.get(start+i)!);
        if (selected.some(c=>c.error || !c.markdown.trim())) {
          await deps.save(`${root}/batch-${index}/failure.json`,{message:"本组有未读取成功的原文，未提交顾问",indices:selected.filter(c=>c.error||!c.markdown.trim()).map(c=>c.index)});
          return;
        }
        const source = knowledgeSourceSchema.parse({title:"读档中的知识整理",pages:selected.map(c=>({id:stableId(`${jobId}:${c.index}`),headline:`原稿第 ${c.index+1} 段`,body:c.markdown,imageUrl:"",role:"reading"}))});
        const value=batchSchema.parse({index,source,sourceDigest:hash(JSON.stringify(source))});
        const old=await deps.read(`${root}/batch-${index}/input.json`);
        if(old&&JSON.stringify(old)!==JSON.stringify(value))throw Error("原顾问分段内容已改变，未重复提交");
        if(!old)await deps.save(`${root}/batch-${index}/input.json`,value);
        ready.add(index);
      })();
      pending.set(index,work); await work;
    },
    async finish(fullMarkdown: string) {
      await Promise.all(pending.values());
      if (!plan) return undefined;
      await deps.save(`${root}/final.json`,{fullSha256:hash(fullMarkdown.trim()),ready:Array.from(ready).sort((a,b)=>a-b)});
      return progress();
    },
  };
}
const real = {...store, job:getJobByIdStrict,post:async(...args:Parameters<typeof import("./knowledgePublicationRoutes").invokeKnowledgePublicationRoutes>) => (await import("./knowledgePublicationRoutes")).invokeKnowledgePublicationRoutes(...args)};
export async function loadKnowledgeReadingPreparation(owner:number,jobId:string,deps=real) {
  const job=await deps.job(jobId);
  if(!job || Number(job.userId)!==owner || (job.input as any)?.action!=="knowledge_card_distill")throw Error("读档任务不存在或不属于当前账号");
  const plan=planSchema.parse(await deps.read(`${prefix(owner,jobId)}/plan.json`));
  if(plan.jobId!==jobId || plan.documentId!==stableId(jobId))throw Error("读档顾问计划身份不一致");
  return {job,plan};
}
export async function knowledgeReadingPreparationState(owner:number,jobId:string,deps=real) {
  const {job,plan}=await loadKnowledgeReadingPreparation(owner,jobId,deps),root=prefix(owner,jobId);
  const entries=await Promise.all(Array.from({length:plan.batches},async(_,i)=>{
    const [input,report,failure]=await Promise.all([deps.read(`${root}/batch-${i}/input.json`),deps.read(`${root}/batch-${i}/report.json`),deps.read(`${root}/batch-${i}/failure.json`)]);
    const draft = input && report ? validateKnowledgeReview(report.report, batchSchema.parse(input).source, input.sourceDigest) : undefined;
    return {index:i,ready:Boolean(input),complete:Boolean(draft),failed:Boolean(failure),draft};
  }));
  return {...plan,status:(job.input as any)?.cancelRequestedAt && job.status!=="succeeded" ? "cancelled" : job.status,ready:entries.filter(e=>e.ready).map(e=>e.index),completed:entries.filter(e=>e.complete).map(e=>e.index),failed:entries.filter(e=>e.failed).map(e=>e.index),drafts:entries.filter(e=>e.draft).map(e=>({index:e.index,pages:e.draft!.pages.map(p=>({headline:p.headline,body:p.body}))}))};
}
export async function validateKnowledgeReadingAccess(owner:number,context:KnowledgePublicationContext,requestId:string,deps=real) {
  if(context.purpose!=="reading"||!context.readingJobId||context.attempt!==0)throw Error("读档顾问请求无效，请恢复原任务");
  const {job,plan}=await loadKnowledgeReadingPreparation(owner,context.readingJobId,deps);
  if(job.status==="failed"||job.status==="cancelled"||(job.input as any)?.cancelRequestedAt)throw Error("读档已停止，未发起后续顾问请求");
  if(plan.documentId!==context.documentId||context.batchIndex>=plan.batches||knowledgeBatchRequestId(plan.documentId,context.batchIndex,0)!==requestId)throw Error("读档顾问请求与原分段不符");
  const batch=batchSchema.parse(await deps.read(`${prefix(owner,plan.jobId)}/batch-${context.batchIndex}/input.json`));
  if(batch.index!==context.batchIndex||batch.sourceDigest!==hash(JSON.stringify(batch.source)))throw Error("读档分段内容校验失败");
  return {id:plan.documentId,plan,batch};
}
export async function reviewKnowledgeReading(owner:number,context:KnowledgePublicationContext,overrides:Partial<typeof real>={}) {
  const deps={...real,...overrides};
  const {plan,batch}=await validateKnowledgeReadingAccess(owner,context,knowledgeBatchRequestId(context.documentId,context.batchIndex,0),deps);
  const path=`${prefix(owner,plan.jobId)}/batch-${context.batchIndex}`;
  const old=await deps.read(`${path}/report.json`);
  if(old)return validateKnowledgeReview(old.report,batch.source,batch.sourceDigest);
  const {buildKnowledgeReviewRequest}=await import("./knowledgePublicationAdvisor");
  const request=buildKnowledgeReviewRequest(batch.source,batch.sourceDigest,new Map());
  request.systemInstruction.parts.push({text:"当前是读档同步预整理，最终统稿尚未完成。先理清本段知识、因果、证据和可读的页面结构；不要假装看过尚未生成的图片。该记录随后交给正式图文顾问复用，未确认任何最终页数或档位。"});
  const raw=await deps.post(request,{prefix:path,read:deps.read,save:deps.save});
  const envelope=JSON.parse(raw.text),report=validateKnowledgeReview(JSON.parse(envelope.candidates[0].content.parts[0].text),batch.source,batch.sourceDigest);
  await deps.save(`${path}/verification-candidates.json`,{sourceDigest:batch.sourceDigest,pages:report.pages.map(p=>({id:p.id,cautions:p.cautions})),stage:"等待全册整理后统一联网"});
  await deps.save(`${path}/report.json`,{report,model:envelope.modelVersion,usage:envelope.usageMetadata,research:envelope.research,supplementation:envelope.supplementation,adjustments:envelope.adjustments});
  return report;
}
/** 后续顾问只能读取同一本、已成功统稿、真实保存的预整理，不信客户端提供的摘要。 */
export async function loadVerifiedKnowledgeReadingNotes(owner:number,link:KnowledgeReadingPreparation,source:KnowledgeSource,deps=real,requireComplete=true):Promise<KnowledgeReview[]> {
  const {job,plan}=await loadKnowledgeReadingPreparation(owner,link.jobId,deps);
  if(plan.documentId!==link.documentId||plan.batches!==link.batches||job.status!=="succeeded")throw Error("原读档尚未成功，预整理不能当最终稿使用");
  const output=job.output as any,full=String(output?.distilledMarkdown||"").trim();
  const expected=planKnowledgeCardPages(full,output?.distillModel).pages;
  const reading=source.pages.filter(p=>p.role==="reading" || source.detailLevel==="full").map(p=>p.body);
  if(!full||JSON.stringify(expected)!==JSON.stringify(reading))throw Error("预整理与当前完整文字稿不一致，禁止复用另一份稿件");
  const final=await deps.read(`${prefix(owner,link.jobId)}/final.json`);
  if(final?.fullSha256!==hash(full))throw Error("读档最终稿回执不完整");
  const notes = await Promise.all(Array.from({length:plan.batches},async(_,i)=>{
    const path=`${prefix(owner,link.jobId)}/batch-${i}`;
    const saved=await deps.read(`${path}/report.json`);
    if(!saved) { if(!requireComplete)return null; throw Error("读档同步顾问尚未完成，请保留原任务等待或恢复；未重复购买"); }
    const input=batchSchema.parse(await deps.read(`${path}/input.json`));
    return validateKnowledgeReview(saved.report,input.source,input.sourceDigest);
  }));
  return notes.filter((note):note is KnowledgeReview=>Boolean(note));
}
