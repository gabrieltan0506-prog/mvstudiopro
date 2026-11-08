/** 本次原提炼JSON只修疑点位置；原知识正文、原任务与旧回执保持可核对。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {knowledgeReadingMarkdown} from '../shared/knowledgePublicationLayout';
import {bindKnowledgeDistillCautions} from '../server/services/knowledgeDistillCautionBinding';
import {invokeKnowledgePublicationRoutes} from '../server/services/knowledgePublicationRoutes';
import {getJobByIdStrict} from '../server/jobs/repository';
import {getGcsBucketName,downloadGcsObjectVersioned,uploadBufferToGcs} from '../server/services/gcs';
import {assertWorkerProbeLease} from '../server/services/workerProbeLease';
if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('仅工作机隔离探针');
await assertWorkerProbeLease();
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const job=await getJobByIdStrict(config.distillJobId);if(!job||job.status!=='succeeded'||job.userId!==config.owner)throw Error('原提炼身份不符');
const source=String((job.output as any).distilledMarkdown||'');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
if(hash(source)!==config.sourceSha)throw Error('原稿指纹变化');
const root=config.outputDirectory;await mkdir(root,{recursive:true});
const get=async(key:string)=>{try{return JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${key}`})).buffer.toString());}catch(e){if((e as Error).message==='gcs_stat_failed:404')return null;throw e;}};
const save=async(key:string,value:unknown)=>uploadBufferToGcs({objectName:key,buffer:Buffer.from(JSON.stringify(value)),contentType:'application/json'});
let newRequests=0,done=0;const usages:unknown[]=[];const results:{old:string;bound:string;name:string}[]=new Array(config.reportNames.length);
const status=(extra:unknown)=>writeFile(join(root,'status.json'),JSON.stringify({at:new Date().toISOString(),done,total:results.length,newRequests,...extra as object},null,2));
await status({status:'running'});
const settled=await Promise.allSettled(config.reportNames.map(async(name:string,index:number)=>{
 if(!name.startsWith(`knowledge-card-distill/user-${job.userId}/${job.id}/`)||!/\/batch-\d+\/report.json$/.test(name))throw Error('原报告路径不符');
 const saved=await get(name);if(!saved?.report?.pages?.length)throw Error('缺少原提炼报告');
 const oldParts:string[]=[],newParts:string[]=[];
 for(const page of saved.report.pages){
  const body=knowledgeReadingMarkdown(page.reading).replace(/^### /gm,'## ').replace(/^> (?!〔参考原页)/gm,'说明：');
  const notes=page.cautions.filter((c:any)=>c.kind==='uncertain').map((c:any)=>`<!-- 待核：${c.evidence.replace(/-->/g,'—')}；${c.message.replace(/-->/g,'—')} -->`).join('\n');
  const old=body+(notes?'\n\n'+notes:'');if(source.split(old).length!==2)throw Error('原分段不是唯一逐字匹配');
  const bound=await bindKnowledgeDistillCautions(page,{family:'glm',channel:index%2?'evolink':'openrouter',evidence:{prefix:name.replace(/\/report.json$/,''),read:get,save},invoke:async(request,evidence)=>{
   const response=await invokeKnowledgePublicationRoutes(request,evidence,{fetch:async(url,init)=>{
    const body=JSON.parse(String(init?.body||'{}'));if(!['z-ai/glm-5.3-flashx','glm-5.3-flashx'].includes(body.model))throw Error('本次文本探针只允许已确认GLM5.3FlashX');
    throw Error('本次仅回放已收章节关联结果，禁止新模型请求');
   }});
   const e=JSON.parse(response.text);usages.push({prefix:evidence.prefix,model:e.modelVersion,gateway:e.gateway,usage:e.usageMetadata});return response;
  }});
  oldParts.push(old);newParts.push(bound);
 }
 results[index]={old:oldParts.join('\n\n'),bound:newParts.join('\n\n'),name};done++;await status({status:'running'});
}));
const errors=settled.filter((r):r is PromiseRejectedResult=>r.status==='rejected').map(r=>String(r.reason?.message||r.reason).replace(/(?:https?|gs):\/\/\S+/g,'[地址]'));
if(errors.length){await status({status:'failed',errors,usages});process.exitCode=1;}
else{
 let bound=source;for(const item of results)bound=bound.replace(item.old,item.bound);
 const content=(text:string)=>text.replace(/<!--\s*待核[：:][\s\S]*?-->/g,'').replace(/\s+/g,' ').trim();
 if(content(source)!==content(bound))throw Error('移动疑点时改动了知识正文，拒绝采用');
 const data={sourceSha:hash(source),boundSha:hash(bound),knowledgeUnchanged:true,reports:results.map(r=>r.name),usages,newRequests};
 for(const [name,value]of Object.entries({'bound-source.md':bound,'binding-result.json':JSON.stringify(data,null,2)})){
  await writeFile(join(root,name),value);await uploadBufferToGcs({objectName:config.outputPrefix+'/'+name,buffer:Buffer.from(value),contentType:name.endsWith('.json')?'application/json':'text/markdown; charset=utf-8'});
 }
 await status({status:'returned',...data});
}
