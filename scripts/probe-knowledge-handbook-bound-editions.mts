/** 本次新稿只修疑点章节归属，复用原选节及匹配的检索依据；修订沿正式两档消费者。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {getJobByIdStrict} from '../server/jobs/repository';
import {prepareKnowledgeCardEditions,knowledgeEditionSelectionDigest} from '../server/services/knowledgeCardEditionPreparation';
import {knowledgeEditionParts,knowledgeModulesFromMarkdown} from '../shared/knowledgeCardEdition';
import {knowledgePendingResearchNotes} from '../server/services/knowledgeVerificationPolicy';
import {invokeKnowledgePublicationRoutes} from '../server/services/knowledgePublicationRoutes';
import {getGcsBucketName,downloadGcsObjectVersioned,uploadBufferToGcs,listGcsObjectNamesByPrefix} from '../server/services/gcs';
import {assertWorkerProbeLease} from '../server/services/workerProbeLease';
if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('仅工作机隔离探针');await assertWorkerProbeLease();
const config=JSON.parse(await readFile(process.argv[2],'utf8')),root=config.outputDirectory;await mkdir(root,{recursive:true});
const job=await getJobByIdStrict(config.distillJobId),derive=await getJobByIdStrict(config.deriveJobId);
if(!job||!derive||job.status!=='succeeded'||job.userId!==derive.userId||job.userId!==config.owner)throw Error('本次新稿身份不符');
const getText=async(key:string)=>(await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${key}`})).buffer.toString();
const get=async(key:string)=>{try{return JSON.parse(await getText(key));}catch(e){if((e as Error).message==='gcs_stat_failed:404')return null;throw e;}};
const source=await getText(config.boundPrefix+'/bound-source.md'),binding=await get(config.boundPrefix+'/binding-result.json');
const original=String((job.output as any).distilledMarkdown||'');
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
if(!binding?.knowledgeUnchanged||binding.boundSha!==hash(source)||binding.sourceSha!==hash(original))throw Error('绑定输入身份不符');
if(knowledgeEditionSelectionDigest(source)!==knowledgeEditionSelectionDigest(original))throw Error('疑点位置以外的原知识变化');
const priorPrefix=`knowledge-editions/user-${job.userId}/${derive.id}`;
const priorResult=JSON.parse(await getText(priorPrefix+'/zero-call-recovery-v4/artifacts/result.json'));
const chosen=knowledgeEditionParts(priorResult.markdown)!.modules.filter(m=>m.medium==='image').map(m=>m.headline);
const modules=knowledgeModulesFromMarkdown(source).modules;
const selectedIndices=chosen.map(title=>{const indices=modules.flatMap((m,i)=>m.headline===title?[i]:[]);if(indices.length!==1)throw Error('原选节不能唯一回到本次新稿');return indices[0];});
if(new Set(selectedIndices).size!==selectedIndices.length||selectedIndices.length!==priorResult.targetSections)throw Error('原选节数量不符');
const names=await listGcsObjectNamesByPrefix({prefix:priorPrefix+'/final-verification/',allPages:true});
const pageKeys=names.filter(n=>/\/pages\/\d+\.json$/.test(n)),searchKeys=names.filter(n=>/\/search-\d+\/report\.json$/.test(n));
const pages=await Promise.all(pageKeys.map(async key=>({key,value:await get(key)}))),searches=await Promise.all(searchKeys.map(async key=>({key,value:await get(key)})));
const originalNotes=new Set(knowledgePendingResearchNotes(original));
const extraQuestions=Array.from(new Set(pages.flatMap(p=>knowledgePendingResearchNotes(p.value.original)).filter(note=>!originalNotes.has(note))));
const catalog=searches.map(row=>{const index=Number(/search-(\d+)/.exec(row.key)![1]);const page=pages.find(p=>p.key.endsWith(`/pages/${index}.json`));return {...row,notes:page?knowledgePendingResearchNotes(page.value.original):[]};});
const prefix=priorPrefix+'/'+config.recoveryName,cache=new Map<string,any>();
let newRequests=0,newSearches=0,newRevisions=0,reusedSearches=0;const usages:unknown[]=[],calls:Record<string,number>={};
const status=(extra:unknown)=>writeFile(join(root,'status.json'),JSON.stringify({at:new Date().toISOString(),newRequests,newSearches,newRevisions,reusedSearches,...extra as object},null,2));
const save=async(key:string,value:unknown)=>{cache.set(key,value);await uploadBufferToGcs({objectName:key,buffer:Buffer.from(JSON.stringify(value)),contentType:'application/json'});};
const evidence={prefix,save,read:async(key:string)=>{
 if(cache.has(key))return cache.get(key);
 const saved=await get(key);if(saved){cache.set(key,saved);return saved;}
 if(config.contentCorrections){
  const relative=key.slice(prefix.length);
  if(/^\/final-verification\/pages\/(6|12|87)\.json$/.test(relative))return null;
  const search=/^\/final-verification\/search-(6|12|87)\/report\.json$/.exec(relative);
  if(search){
   const index=Number(search[1]);
   const priorPage=await get(priorPrefix+'/bound-editions-v1/final-verification/pages/'+index+'.json');
   if(!priorPage)throw Error('原章检索回执缺失');
   let report;
   if(index===6||index===12){
    const notes=knowledgePendingResearchNotes(priorPage.original);
    if(notes.length!==1)throw Error('未取证疑点身份不唯一');
    report={...priorPage.verification,unresolvedQuestions:notes,unresolvedEvidence:{source:priorPrefix+'/final-verification/search-22/report.json',reason:'原记录明确第4和第5项检索达到12条上限，未取得有效工具资料'}};
   }else{
    const source=catalog.flatMap(row=>row.value.sources||[]).find((s:any)=>s.url==='https://www.cylyy.cn/Html/News/Articles/7345.html');
    if(!source?.content?.includes('切勿蹭破泡皮')||!source.content.includes('及时联系医护人员'))throw Error('医院原始来源证据不完整');
    report={sourceDigest:priorPage.verification.sourceDigest,evidenceState:'available',sources:[source],findings:[],verificationMarkdown:'之前媒体材料与医院患者指导相互冲突。本页水泡处理以以下已获取医院原文为依据，不把专业处置写成读者自行刺破操作。删除原修订中自行刺破、引流和自行涂抗菌药的步骤；原书操作内容其余照原稿保留，不扩大医学改写。医院要求保护泡皮、避免污染并及时联系医护人员，不能把起水泡当作疗效证据。\n\n'+source.content,reusedFrom:priorPrefix+'/final-verification/search-95/report.json'};
   }
   await save(key,report);return report;
  }
  if(relative.startsWith('/final-verification/revision-87/'))return null;
 }
 if(config.priorRecoveryName){
  const relative=key.slice(prefix.length);
  if(relative==='/selected-sections.json'||(relative.startsWith('/final-verification/')&&relative!=='/final-verification/verified.json')){
   const priorNames=[config.priorRecoveryName,...(config.priorFallbackNames||[])];
   let previous:any=null;
   for(const priorName of priorNames){previous=await get(priorPrefix+'/'+priorName+relative);if(previous)break;}
   if(previous&&(!/\/pages\/\d+\.json$/.test(relative)||!previous.issues?.length)){
    await save(key,previous);return previous;
   }
  }
 }
 if(key===prefix+'/selected-sections.json'){
  const manifest={knowledgeDigest:knowledgeEditionSelectionDigest(source),selectedIndices,targetSections:priorResult.targetSections,passes:priorResult.passes,pendingResearch:extraQuestions,origin:priorPrefix+'/zero-call-recovery-v4/artifacts/result.json'};
  await save(key,manifest);return manifest;
 }
 const pageMatch=/\/final-verification\/pages\/(\d+)\.json$/.exec(key);
 if(pageMatch){
  const manifest=cache.get(prefix+'/final-verification/input.json');
  const index=Number(pageMatch[1]),body=manifest?.bodies?.[index];
  const originalPage=typeof body==='string'?pages.find(p=>p.value.original===body):null;
  if(originalPage){
   const oldIndex=/\/pages\/(\d+)\.json$/.exec(originalPage.key)![1];
   const oldKey=`${priorPrefix}/zero-call-recovery-v4/final-verification/pages/${oldIndex}.json`;
   const old=await get(oldKey);
   if(old?.status==='saved'&&!old.issues?.length&&old.original===body){
    const migrated={...old,digest:manifest.digest,pageIndex:index,original:body,
     pendingVerification:(old.pendingVerification||[]).map((item:any)=>({...item,pageIndex:index})),reusedFrom:oldKey};
    await save(key,migrated);return migrated;
   }
  }
 }
 const match=/\/final-verification\/search-(\d+)\/report\.json$/.exec(key);
 if(match){
  const candidates=cache.get(`${prefix}/final-verification/candidates-${match[1]}.json`);
  const notes=knowledgePendingResearchNotes(candidates?.facts?.[0]?.statement||'');
  if(notes.length){
   const needed=notes.map(note=>catalog.find(item=>item.notes.includes(note)));
   if(needed.every(Boolean)){
    const used=Array.from(new Map(needed.map(item=>[item!.key,item!])).values());
    const sources=Array.from(new Map(used.flatMap(item=>item.value.sources||[]).map((s:any)=>[s.url,s])).values());
    const report={sourceDigest:candidates.digest,verificationMarkdown:used.map(item=>item.value.verificationMarkdown||'').join('\n\n'),
     findings:used.flatMap(item=>item.value.findings||[]),sources,evidenceState:sources.length?'available':'missing',
     reusedFrom:used.map(item=>({key:item.key,notes:notes.filter(note=>item.notes.includes(note))}))};
    await save(key,report);reusedSearches++;await status({status:'running',stage:'复用原疑点检索'});return report;
   }
  }
 }
 return null;
}};
await save(prefix+'/binding-input.json',{distillJobId:job.id,deriveJobId:derive.id,bindingPrefix:config.boundPrefix,boundSha:binding.boundSha,selectedIndices,extraQuestions});
await status({status:'running',stage:'按原章修订'});
try{
 const result=await prepareKnowledgeCardEditions({sourceMarkdown:source,model:'glm-5.3-flashx',evidence,
  onProgress:async p=>status({status:'running',...p}),
  invoke:async(request,scope)=>{
   const execution={...request,executionFamily:'glm' as const};
   const guardedScope={...scope,save:async(key:string,value:any)=>{
    if(calls[scope.prefix]&&value?.state==='pending'&&/\/route-[^/]+\.json$/.test(key))throw Error('本次该请求已派发，禁止自动重购');
    await scope.save(key,value);
   }};
   const response=await invokeKnowledgePublicationRoutes(execution,guardedScope,{fetch:async(url,init)=>{
    if(config.zeroNewRequests)throw Error('本轮只恢复原回执，禁止新模型请求');
    if(config.maxNewRequests!==undefined&&newRequests>=config.maxNewRequests)throw Error('本次定向修订请求上限已到，禁止扩大发送');
    const body=JSON.parse(String(init?.body||'{}'));if(!['z-ai/glm-5.3-flashx','glm-5.3-flashx'].includes(body.model))throw Error('本次仅允许GLM5.3FlashX');
    if(calls[scope.prefix])throw Error('本次该请求已派发，禁止自动重购');calls[scope.prefix]=1;
    newRequests++;if(request.researchOnly)newSearches++;else newRevisions++;
    await status({status:'running',stage:request.researchOnly?'补核未覆盖的疑点':'对应原章修订'});return fetch(url,init);
   }});
   const e=JSON.parse(response.text);usages.push({prefix:scope.prefix,model:e.modelVersion,gateway:e.gateway,usage:e.usageMetadata});return response;
  },
 });
 for(const [name,value]of Object.entries({'full.md':result.fullEditionMarkdown,'concise.md':result.markdown,'result.json':JSON.stringify(result,null,2),'usage.json':JSON.stringify(usages,null,2)})){
  await writeFile(join(root,name),value);await uploadBufferToGcs({objectName:prefix+'/artifacts/'+name,buffer:Buffer.from(value),contentType:name.endsWith('.json')?'application/json':'text/markdown; charset=utf-8'});
 }
 await status({status:result.verificationProcessed?'returned':'partial',counts:result.editionPageCounts,issues:result.editionIssues,pendingVerification:result.editionPendingVerification,usages});
}catch(error){await status({status:'failed',error:String((error as Error).message).replace(/(?:https?|gs):\/\/\S+/g,'[地址]')});process.exitCode=1;}
