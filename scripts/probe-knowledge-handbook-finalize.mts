/** 将真实已恢复的成稿交回原worker结算链；新身份保留旧任务，禁止新增模型。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {runClaimedJob} from '../server/jobs/runner';
import {getJobByIdStrict} from '../server/jobs/repository';
import {knowledgeCardPageJobId} from '../server/jobs/knowledgeCardPageTask';
import {getDb} from '../server/db';
import {jobs} from '../drizzle/schema';
import {downloadGcsObjectVersioned,getGcsBucketName,uploadBufferToGcs} from '../server/services/gcs';
import {lookupKnowledgeCardDistillReceiptModel,recordKnowledgeCardDistillReceipt} from '../server/services/knowledgeCardDistillReceipt';
import {knowledgeEditionSelectionDigest} from '../server/services/knowledgeCardEditionPreparation';
import {synchronizedKnowledgeCardSource} from '../shared/knowledgeCardEditableLayout';
import {layoutFromSource} from '../shared/editableLayout';
import {planKnowledgeCardPages} from '../shared/knowledgeCardPagination';
import {validateKnowledgeEditionVerificationReceipt} from '../server/services/knowledgeEditionVerificationReceipt';
import {assertWorkerProbeLease} from '../server/services/workerProbeLease';

if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('只能在本次工作机执行');
await assertWorkerProbeLease();
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const get=async(key:string)=>JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${key}`})).buffer.toString());
const original=await getJobByIdStrict(config.distillJobId),derive=await getJobByIdStrict(config.deriveJobId);
if(!original||!derive||original.status!=='succeeded'||derive.status!=='succeeded'||original.userId!==derive.userId)throw Error('原真实任务身份不符');
const owner=Number(original.userId),originalBody=String((original.output as any)?.distilledMarkdown||'');
const recovered=await get(config.recoveryPrefix+'/editions.json');
const bound=recovered.original;
const result=recovered.result;
if(!bound||!result?.verificationProcessed||result.editionIssues?.length)throw Error('原恢复成稿未过门禁');
if(createHash('sha256').update(bound).digest('hex')!==recovered.inputDigest||knowledgeEditionSelectionDigest(bound)!==knowledgeEditionSelectionDigest(originalBody))throw Error('绑定稿与原真实生产者不一致');
const receiptModel=await lookupKnowledgeCardDistillReceiptModel(owner,originalBody);
if(!receiptModel||receiptModel!==(original.output as any).distillModel)throw Error('原收费档位回执不符');
const id=knowledgeCardPageJobId(String(owner),'knowledge_card_derive_level',config.requestId);
const prefix=`knowledge-editions/user-${owner}/${id}`;
await mkdir(config.outputRoot,{recursive:true});
const existing=await getJobByIdStrict(id);
if(existing&&existing.status!=='succeeded')throw Error('同ID已有在途或失败任务，只查询，不重新派发');
let blockedModelRequests=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(...args)=>{
 const url=String(args[0] instanceof Request?args[0].url:args[0]);
 if(/api\.openai\.com|openrouter\.ai|api\.evolink\.ai|generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com/.test(url)){
  blockedModelRequests++;throw Error('成稿回写只准消费原缓存，禁止新模型请求');
 }
 return originalFetch(...args);
};
try{
 if(!existing){
  // 真实原提炼已支付同一模型；此处只恢复移动内部注释后的同内容计费身份。
  await recordKnowledgeCardDistillReceipt(owner,receiptModel,bound);
  await uploadBufferToGcs({objectName:prefix+'/editions.json',buffer:Buffer.from(JSON.stringify({...recovered,recoveredFrom:config.recoveryPrefix,producerJobId:original.id})),contentType:'application/json'});
  await uploadBufferToGcs({objectName:prefix+'/recovery-provenance.json',buffer:Buffer.from(JSON.stringify({originalDistillJobId:original.id,originalDeriveJobId:derive.id,recoveredFrom:config.recoveryPrefix,originalKnowledgeDigest:knowledgeEditionSelectionDigest(originalBody),boundDigest:recovered.inputDigest,receiptModel})),contentType:'application/json'});
  const db=await getDb();if(!db)throw Error('数据库不可用');
  await db.insert(jobs).values({id,userId:String(owner),type:'platform',provider:'evolink',status:'running',attempts:2,input:{action:'knowledge_card_derive_level',params:{fullMarkdown:bound,distillModel:receiptModel,editionVersion:2,targetSections:result.targetSections}}});
  const job=await getJobByIdStrict(id);if(!job)throw Error('恢复任务未持久化');
  await runClaimedJob(job);
 }
 const finished=await getJobByIdStrict(id),out:any=finished?.output;
 if(finished?.status!=='succeeded'||!out?.verificationProcessed||out.distilledMarkdown!==result.markdown||out.fullEditionMarkdown!==result.fullEditionMarkdown||blockedModelRequests)throw Error('原worker未闭合真实成稿回写');
 for(const level of ['full','concise'] as const){
  const markdown=level==='full'?out.fullEditionMarkdown:out.distilledMarkdown;
  const ids=planKnowledgeCardPages(markdown,out.distillModel).pages.map((_,i)=>'preflight-'+level+'-'+i);
  const source=synchronizedKnowledgeCardSource({owner:String(owner),sourceId:`knowledge-card:${id}:${level}`,fullMarkdown:out.fullEditionMarkdown,illustrationMarkdown:markdown,detailLevel:level,distillModel:out.distillModel,infographicTemplateId:'fusion_ink_mountains',imageJobIds:ids});
  source.verificationJobId=id;
  const document=layoutFromSource(source);
  await validateKnowledgeEditionVerificationReceipt(owner,document.publication!.source);
 }
 await writeFile(join(config.outputRoot,'finalized.json'),JSON.stringify({at:new Date().toISOString(),status:'succeeded',owner,jobId:id,producerJobId:original.id,recoveryPrefix:config.recoveryPrefix,blockedModelRequests,output:out},null,2));
 console.log(JSON.stringify({status:'succeeded',jobId:id,owner,blockedModelRequests,verificationProcessed:out.verificationProcessed,counts:out.editionPageCounts}));
}finally{globalThis.fetch=originalFetch;}
