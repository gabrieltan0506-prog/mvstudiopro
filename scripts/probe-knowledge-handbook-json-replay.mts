/** 仅复用本次原始回执，重新执行正式两档消费；任何新模型HTTP调用均拒绝。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {getJobByIdStrict} from '../server/jobs/repository';
import {prepareKnowledgeCardEditions} from '../server/services/knowledgeCardEditionPreparation';
import {invokeKnowledgePublicationRoutes} from '../server/services/knowledgePublicationRoutes';
import {getGcsBucketName,downloadGcsObjectVersioned,uploadBufferToGcs} from '../server/services/gcs';
import {assertWorkerProbeLease} from '../server/services/workerProbeLease';
if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('仅工作机隔离恢复');
await assertWorkerProbeLease();
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const distill=await getJobByIdStrict(config.distillJobId),derive=await getJobByIdStrict(config.deriveJobId);
if(!distill||!derive||distill.status!=='succeeded'||!['failed','succeeded'].includes(derive.status)||distill.userId!==derive.userId)throw Error('原任务未收口或身份不符，禁止并行重组');
const source=String((distill.output as any).distilledMarkdown||'');if(!source)throw Error('原任务没有底稿');
const prefix=`knowledge-editions/user-${distill.userId}/${derive.id}`,recovery=`${prefix}/${config.recoveryName}`;
const root=config.outputDirectory;await mkdir(root,{recursive:true});
let blockedNewModelCalls=0;
const get=async(key:string)=>{try{return JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${key}`})).buffer.toString());}catch(error){if((error as Error).message==='gcs_stat_failed:404')return null;throw error;}};
const priorFinal=await get(`${prefix}/final-verification/verified.json`);
if(!priorFinal?.bodies?.length)throw Error('缺少完整末稿检查点，不能推测原章节顺序');
const originalBodies:string[]=[];
for(let start=0;start<priorFinal.bodies.length;start+=10){
 const rows=await Promise.all(Array.from({length:Math.min(10,priorFinal.bodies.length-start)},(_,i)=>get(`${prefix}/final-verification/pages/${start+i}.json`)));
 for(const row of rows){if(typeof row?.original!=='string')throw Error('缺少原章输入');originalBodies.push(row.original);}
}
const originalManifest={bodies:originalBodies,digest:createHash('sha256').update(JSON.stringify(originalBodies)).digest('hex')};
if(originalManifest.digest!==priorFinal.digest)throw Error('原章输入摘要不符');
const target=(key:string)=>{if(!key.startsWith(prefix+'/'))throw Error('恢复读写超出原任务');return recovery+key.slice(prefix.length);};
const evidence={prefix,read:async(key:string)=>{
 const fresh=await get(target(key));if(fresh)return fresh;
 const suffix=key.slice(prefix.length);
 if(suffix==='/final-verification/input.json')return originalManifest;
 const previous=config.priorRecoveryName?await get(`${prefix}/${config.priorRecoveryName}${suffix}`):null;
 if(/^\/final-verification\/pages\/\d+\.json$/.test(suffix)&&previous?.status==='saved'&&!previous.issues?.length)return previous;
 // 这些是派生结果；原始请求、上游回执与已成功选节仍逐字复用。
 if(suffix==='/editions.json'||suffix==='/final-verification/verified.json'||/^\/final-verification\/pages\/\d+\.json$/.test(suffix)||/^\/final-verification\/revision-\d+\/report\.json$/.test(suffix)||suffix.startsWith('/pages/'))return null;
 return previous||get(key);
},save:async(key:string,value:unknown)=>{await uploadBufferToGcs({objectName:target(key),buffer:Buffer.from(JSON.stringify(value)),contentType:'application/json'});}};
const status=async(value:unknown)=>writeFile(join(root,'status.json'),JSON.stringify(value,null,2));
await status({status:'running',sourceJobId:distill.id,deriveJobId:derive.id,recovery,newModelRequests:0});
try{
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:source,model:(distill.output as any).distillModel,evidence,
  invoke:(request,scope)=>invokeKnowledgePublicationRoutes(request,scope,{fetch:async()=>{blockedNewModelCalls++;throw Error('零调用恢复禁止提交新模型请求');}}),
  onProgress:async p=>status({status:'running',...p,recovery,newModelRequests:0,blockedNewModelCalls}),
 });
 for(const [name,value]of Object.entries({'full.md':result.fullEditionMarkdown,'concise.md':result.markdown,'result.json':JSON.stringify(result,null,2)})){
  await writeFile(join(root,name),value);await uploadBufferToGcs({objectName:`${recovery}/artifacts/${name}`,buffer:Buffer.from(value),contentType:name.endsWith('.json')?'application/json':'text/markdown; charset=utf-8'});
 }
 await status({status:result.verificationProcessed?'returned':'partial',recovery,newModelRequests:0,blockedNewModelCalls,counts:result.editionPageCounts,issues:result.editionIssues,pendingVerification:result.editionPendingVerification});
}catch(error){await status({status:'failed',newModelRequests:0,blockedNewModelCalls,error:String((error as Error).message).replace(/(?:https?|gs):\/\/\S+/g,'[地址]')});process.exitCode=1;}
