import {KNOWLEDGE_MODEL_CHANNEL_MAX,type KnowledgeModelChannel} from '../../shared/knowledgeConcurrency';
import {createHash} from 'node:crypto';
import {buildKnowledgeConsistencyRequest,buildKnowledgeFinalRevisionRequest} from './knowledgePublicationAdvisor';
import {knowledgeVerificationTriggers,knowledgePendingResearchNotes} from './knowledgeVerificationPolicy';
import {invokeKnowledgePublicationRoutes,type KnowledgeRouteEvidence} from './knowledgePublicationRoutes';
import {knowledgeModulesFromMarkdown} from '../../shared/knowledgeCardEdition';
import {hasKnowledgeBody,markKnowledgeEditionGap,type KnowledgeEditionIssue} from '../../shared/knowledgeEditionIssues';
import {guardKnowledgeEditionEvidence,rethrowKnowledgeEditionInvariant,knowledgeEditionErrorMessage,isKnowledgeReceiptUnknown,isTransientEditionCheckpointError} from './knowledgeEditionRecovery';

/**
 * 单章检查点瞬态失败（存取层已原位重试四次仍失败）后放回队尾的等待：每章最多再试三次、间隔递增。
 * 超过次数才整单抛出，由 runner 按既有规则延迟重排。
 */
export const KNOWLEDGE_VERIFICATION_CHECKPOINT_REQUEUE_MS = [5000, 15000, 30000] as const;

type PendingNote={pageIndex:number;message:string};
export type KnowledgeEditionVerificationResult={bodies:string[];issues:KnowledgeEditionIssue[];pendingVerification:PendingNote[];complete:boolean};
export type KnowledgeEditionVerificationOptions={
 /** 测试用：每通道在途章节上限，缺省 KNOWLEDGE_MODEL_CHANNEL_MAX（16，未改）。 */
 channelMax?:number;
 checkpointRequeueMs?:readonly number[];
 sleep?:(ms:number)=>Promise<void>;
};
type ProgressFn=(p:{doneBatches:number;totalBatches:number;pass:number})=>void|Promise<void>;

/** 正式末段：仅处理疑点、空正文和已记录失败；每页独立保存，局部失败保留原稿继续。只返回正文（旧调用方与测试沿用）。 */
export async function verifyKnowledgeEditionManuscripts(bodies:string[],storage:KnowledgeRouteEvidence,invoke=invokeKnowledgePublicationRoutes,onProgress?:ProgressFn,options:KnowledgeEditionVerificationOptions={}){
 return (await verifyKnowledgeEditionManuscriptsDetailed(bodies,storage,invoke,onProgress,options)).bodies;
}

/**
 * 同上，但直接返回 verified.json 中的问题、待验证与完成标记，调用方不必把几十 MB 的 verified.json 再读回来。
 * verified.json 的写入内容与格式不变（其他读者照旧）。
 */
export async function verifyKnowledgeEditionManuscriptsDetailed(bodies:string[],storage:KnowledgeRouteEvidence,invoke=invokeKnowledgePublicationRoutes,onProgress?:ProgressFn,options:KnowledgeEditionVerificationOptions={}):Promise<KnowledgeEditionVerificationResult>{
 const evidence=guardKnowledgeEditionEvidence(storage);
 const manifest=await evidence.read(`${evidence.prefix}/input.json`);
 if(manifest){
  if(!Array.isArray(manifest.bodies)||JSON.stringify([...manifest.bodies].sort())!==JSON.stringify([...bodies].sort()))
   throw Error('最终核实原稿变化，保留旧回执');
  // 并发回包顺序不能改变已派发章节的身份；只接受逐字相同的多重集合。
  bodies=manifest.bodies;
 }
 const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
 if(manifest&&manifest.digest!==digest)throw Error('最终核实输入清单损坏，保留旧回执');
 if(!manifest)await evidence.save(`${evidence.prefix}/input.json`,{digest,bodies});
 const prior=await evidence.read(`${evidence.prefix}/verified.json`);
 if(prior){
  if(prior.digest!==digest)throw Error('最终核实原稿变化，保留旧回执');
  return {bodies:prior.bodies as string[],issues:prior.issues||[],pendingVerification:prior.pendingVerification||[],complete:prior.complete!==false};
 }
 const prepared=bodies.map(body=>{
  const empty=knowledgeModulesFromMarkdown(body).modules.filter(m=>!hasKnowledgeBody(m.body));
  return empty.length?markKnowledgeEditionGap(body,`以下章节只有标题或正文为空，请围绕原章节及原稿上下文联网补齐，不删除章节：${empty.map(m=>m.headline).join('；')}`):body;
 });
 const factsByBody=prepared.map((body,i)=>[{pageId:`section-${i}`,headline:'章节待补齐与疑点',term:'知识及图片说明',statement:body}]);
 const required=factsByBody.map(facts=>knowledgeVerificationTriggers(facts).length>0);
 const total=required.filter(Boolean).length;
 const result:string[]=new Array(bodies.length),verifications:unknown[]=new Array(bodies.length);
 const pageIssues:KnowledgeEditionIssue[][]=bodies.map(()=>[]);
 const pagePending:{pageIndex:number;message:string}[][]=bodies.map(()=>[]);
 // 完成目录只存已落盘的结果。对象名即批次清单，并发写不同编号无需覆盖共享文件。
 const completedPrefix=`${evidence.prefix}/completed/${digest}/`;
 const indexed=new Set<number>();
 if(manifest && evidence.listKeys){
   for(const key of await evidence.listKeys(completedPrefix)){
     const name=key.slice(completedPrefix.length);
     const index=Number(name.split('.')[0]);
     if(!key.startsWith(completedPrefix)||!Number.isSafeInteger(index)||index<0||index>=bodies.length||name!==`${index}.json`)
       throw Error('已完成批次清单与原稿不符');
     indexed.add(index);
   }
 }
 let done=Array.from(indexed).filter(i=>required[i]).length;
 let progress=Promise.resolve();
 const completed=async()=>{
  const count=++done;
  progress=progress.then(async()=>{await onProgress?.({doneBatches:count,totalBatches:total,pass:3});});
  await progress;
 };
 if(total)await onProgress?.({doneBatches:done,totalBatches:total,pass:3});
 // 无需核实的章节（required=false）由原文确定性得出：不经模型、不读写逐章检查点。
 // 等价性：prepared 只对含空正文模块的章节追加「待核」注释，而该注释必使 required=true，故此类章节 prepared[i]===bodies[i]
 // 且无空正文模块；原流程对它们的结果恒为 body=原文、verification=null、无问题、无待验证（触发器与标题/术语字段无关，
 // 末尾「仍有待核疑点」同款判定对原文为空）。旧任务已存的这类 completed/pages 对象保留不读不删；其对象名仍经上面的清单校验。
 for(let i=0;i<bodies.length;i++)if(!required[i]){result[i]=bodies[i];verifications[i]=null;}
 const processPage=async(i:number,channel:KnowledgeModelChannel,invoke:typeof invokeKnowledgePublicationRoutes)=>{
  // 原页在任何请求之前保存，已经完成的页在恢复时零调用复用。
  const pageKey=`${evidence.prefix}/pages/${i}.json`;
  const completedKey=evidence.listKeys ? `${completedPrefix}${i}.json` : pageKey;
  const alreadyIndexed=indexed.has(i);
  const checkpoint=alreadyIndexed ? await evidence.read(completedKey)
    : (manifest || !evidence.listKeys) ? await evidence.read(pageKey) : null;
  if(alreadyIndexed && (checkpoint?.status!=='saved'||checkpoint.pageIndex!==i||typeof checkpoint.body!=='string'))
    throw Error('已完成批次回执缺失或损坏，保留原任务');

  if(checkpoint&&checkpoint.digest!==digest)throw Error('章节输入变化，保留原回执');
  if(checkpoint?.status==='saved'){
   result[i]=checkpoint.body;verifications[i]=checkpoint.verification||null;pageIssues[i]=checkpoint.issues||[];pagePending[i]=checkpoint.pendingVerification||[];
   if(!alreadyIndexed){
     if(evidence.listKeys)await evidence.save(completedKey,{...checkpoint,pageIndex:i});
     if(required[i])await completed();
   }
   return;
  }
  await evidence.save(pageKey,{digest,pageIndex:i,original:bodies[i],body:bodies[i],status:'pending'});
  let body=bodies[i],verification:any=null;
  const localIssues:KnowledgeEditionIssue[]=[];
  const localPending:{pageIndex:number;message:string}[]=[];
  if(required[i]){
   try{
    // 未知回执不另买替代请求；其他页继续，问题留在清单。
    if(/<!-- 回执待确认：/.test(body))throw Error('原请求回执尚未闭合，保留原页，不新增请求');
    const facts=factsByBody[i],prefix=`${evidence.prefix}/search-${i}`;
    await evidence.save(`${evidence.prefix}/candidates-${i}.json`,{digest,facts,triggers:knowledgeVerificationTriggers(facts)});
    verification=await evidence.read(`${prefix}/report.json`);
    if(!verification){
     const request=buildKnowledgeConsistencyRequest('图文知识手册',digest,facts);request.executionChannel=channel;
     request.systemInstruction.parts.push({text:'对只有标题、空正文或已标记失败的章节，围绕原章主题与已有上下文检索可用资料。保留原有内容，只补缺口、解决具体疑点；找不到依据就保留问题，不编造正文。'});
     const old=await evidence.read(`${prefix}/request.json`);
     if(old&&old.digest!==digest)throw Error('核实输入变化，不能重新购买');
     if(!old)await evidence.save(`${prefix}/request.json`,{digest,request});
     const envelope=JSON.parse((await invoke(old?.request||request,{...evidence,prefix})).text);
     verification=JSON.parse(envelope.candidates[0].content.parts[0].text);
     await evidence.save(`${prefix}/report.json`,verification);
    }
    const noEvidence=verification.evidenceState==='missing'||(Array.isArray(verification.sources)&&verification.sources.length===0);
    if(noEvidence){
     // 已完成检索但无可用资料：保留原稿标待验证，不再购买一次无依据的改写。
     body=prepared[i];
    }else{
    const revisionPrefix=`${evidence.prefix}/revision-${i}`;
    const saved=await evidence.read(`${revisionPrefix}/report.json`);
    if(saved){if(saved.digest!==digest)throw Error('修订输入变化，不能复用');body=saved.body;}
    else{
     const hash=createHash('sha256').update(`${digest}/${i}`).digest('hex');
     const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
     const source={title:'图文知识手册',pages:[{id,headline:'章节补齐与疑点修订',body:prepared[i],imageUrl:''}]};
     const request=buildKnowledgeFinalRevisionRequest(source,digest,[verification],channel);
     // 修订走 GLM 首发链：GLM@本页通道 → GLM@另一通道 → DeepSeek v4.1 Flash 1017（未设模型族时路由表默认 DeepSeek 先发）。
     // 只影响新建请求；已存 request.json 的页按原请求回放，回执身份不变。
     request.executionFamily='glm';
     request.systemInstruction.parts.push({text:'保留原有内容、章节标题、主要/次要标记及图说明；只补齐本页缺失正文并处理实际疑点。不得删除空章节来伪装补齐，不虚构原书内容或来源。不能补齐的章节保留原样并保留待核注释。'});
     const old=await evidence.read(`${revisionPrefix}/request.json`);
     if(old&&old.digest!==digest)throw Error('修订输入变化，不能重新购买');
     if(!old)await evidence.save(`${revisionPrefix}/request.json`,{digest,request});
     const envelope=JSON.parse((await invoke(old?.request||request,{...evidence,prefix:revisionPrefix})).text);
     const revisedPage=JSON.parse(envelope.candidates[0].content.parts[0].text).pages?.[0];
     body=String(revisedPage?.body||'');
     // 每个请求对应一个原章；JSON正文的###块是章内结构，不能当作原章消失。
     const originalChapter=knowledgeModulesFromMarkdown(bodies[i]);
     if(revisedPage?.reading && originalChapter.modules.length===1 && /^##[ \t]+/m.test(bodies[i])){
      const chapter=originalChapter.modules[0];
      body=`# ${originalChapter.title}\n\n## ${chapter.priority==='primary'?'主要重点':'次要重点'}｜${chapter.headline}\n\n${body.replace(/^#{1,2}[ \t]+/gm,'### ')}`;
     }
     // 正式Markdown解析器把待核注释转入cautions；必须还原后再判定是否解决。
     const pending=(revisedPage?.cautions||[]).filter((c:any)=>c.kind==='uncertain'&&c.message==='已标注疑点，等待全册整理后统一联网核实。');
     for(const caution of pending)body+=`\n\n<!-- 待核：${String(caution.evidence).replace(/-->/g,'—')} -->`;
     if(!hasKnowledgeBody(body))throw Error('补齐结果仍无正文，保留原章节');
     // 模型漏掉原章时恢复该章，不能以删空章冒充补齐。
     const original=knowledgeModulesFromMarkdown(bodies[i]);
     const revised=knowledgeModulesFromMarkdown(body);
     for(const module of original.modules){
      if(/^##[ \t]+/m.test(bodies[i])&&!revised.modules.some(m=>m.headline===module.headline)){
       body+=`\n\n## ${module.priority==='primary'?'主要重点':'次要重点'}｜${module.headline}\n\n${module.body}`;
       localIssues.push({pageIndex:i,kind:'unresolved',message:`修订遗漏章节“${module.headline}”，已保留原章`});
      }
     }
     await evidence.save(`${revisionPrefix}/report.json`,{body,digest});
    }
    }
   }catch(error){
    rethrowKnowledgeEditionInvariant(error);
    body=bodies[i];
    localIssues.push({pageIndex:i,kind:isKnowledgeReceiptUnknown(error)?'unknown_receipt':'content_error',message:knowledgeEditionErrorMessage(error)});
   }
  }
  // 搜索已得到正常回执；未解决项按用户要求显式待验证并放行，异常回执不冒充无结果。
  if(required[i]&&verification&&!localIssues.length){
   // 检索逐项结论优先于修订模型省略的标记；只能保留本章实际输入的疑点。
   const originalNotes=knowledgePendingResearchNotes(bodies[i]);
   for(const question of verification.unresolvedQuestions||[]){
    if(typeof question!=='string'||!originalNotes.includes(question))throw Error('检索未解决项不属于本章原始疑点');
    if(!body.includes(`待验证：${question}`))body+=`\n\n待验证：${question}`;
    localPending.push({pageIndex:i,message:question});
   }
   const outstanding=knowledgeVerificationTriggers([{pageId:`section-${i}`,headline:'疑点',term:'正文',statement:body}]);
   for(const item of outstanding)if(!localPending.some(p=>p.message===item.quote))localPending.push({pageIndex:i,message:item.quote});
   body=body.replace(/<!--\s*待核[：:]([\s\S]*?)-->/g,(_,note:string)=>`待验证：${note.trim()}`);
   if(outstanding.length&&!body.includes('待验证：'))body+='\n\n'+outstanding.map(item=>`待验证：${item.quote}`).join('\n\n');
  }
  const empty=knowledgeModulesFromMarkdown(body).modules.filter(m=>!hasKnowledgeBody(m.body));
  for(const module of empty)localIssues.push({pageIndex:i,kind:'empty_body',message:`“${module.headline}”正文仍待补齐，原章保留`});
  if(knowledgeVerificationTriggers([{pageId:`section-${i}`,headline:'疑点',term:'正文',statement:body}]).length&&!localIssues.length&&!localPending.length)
   localIssues.push({pageIndex:i,kind:'unresolved',message:'仍有待核疑点，原文及回执保留'});
  // 同页原文与结果一起落盘；失败不会回滚之前已保存页。
  await evidence.save(completedKey,{digest,pageIndex:i,original:bodies[i],body,status:'saved',verification,issues:localIssues,pendingVerification:localPending});
  result[i]=body;verifications[i]=verification;pageIssues[i]=localIssues;pagePending[i]=localPending;
  if(required[i])await completed();
 };
 // 章与章之间可独立检索/修订；同章仍须先拿到检索结果。
 // 两通道共用一个待办池：每章按交替顺序标记首选通道（首个待核章从 EvoLink 起，GLM@EvoLink 首发），首选通道先领；
 // 某通道在途已满、另一通道有空位时，空位可领它名下尚未开始的章节（慢通道不再拖住快通道）。
 // 领取只决定新建请求用哪个通道：已存 request.json 的章节仍按原请求回放（processPage 内 old?.request||request）。
 const channels=['evolink','openrouter'] as const;
 const otherChannel=(c:KnowledgeModelChannel):KnowledgeModelChannel=>c==='evolink'?'openrouter':'evolink';
 type Item={index:number;preferred:KnowledgeModelChannel;requeues:number};
 const queues:Record<KnowledgeModelChannel,Item[]>={evolink:[],openrouter:[]};
 let questionIndex=0;
 for(let i=0;i<bodies.length;i++)if(required[i]){
  const preferred=channels[questionIndex++%2]!;
  queues[preferred].push({index:i,preferred,requeues:0});
 }
 // 先补缺项；已完成的批次只为最终合稿取正文，不计进度、不经过模型（稳定排序，保留原交替顺序）。
 for(const channel of channels)queues[channel].sort((a,b)=>Number(indexed.has(a.index))-Number(indexed.has(b.index)));
 const sleep=options.sleep??((ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms)));
 const requeueMs=options.checkpointRequeueMs??KNOWLEDGE_VERIFICATION_CHECKPOINT_REQUEUE_MS;
 // 每通道在途章节上限维持原值（16），本次不改并发。
 const limit=(channel:KnowledgeModelChannel)=>Math.max(1,Math.floor(options.channelMax??KNOWLEDGE_MODEL_CHANNEL_MAX[channel]));
 const inFlight:Record<KnowledgeModelChannel,number>={evolink:0,openrouter:0};
 let listeners:(()=>void)[]=[];
 const changed=()=>{const wake=listeners;listeners=[];for(const resolve of wake)resolve();};
 const nextChange=()=>new Promise<void>(resolve=>listeners.push(resolve));
 let running=0,delayed=0,stopped=false,failure:{error:unknown}|null=null;
 const runs:Promise<void>[]=[];
 const queued=()=>queues.evolink.length+queues.openrouter.length;
 const take=(channel:KnowledgeModelChannel)=>{
  if(queues[channel].length)return queues[channel].shift();
  const other=otherChannel(channel);
  // 对方仍有空位时由对方自己领，避免两边抢同一批首发；对方满载才接手。
  if(queues[other].length&&inFlight[other]>=limit(other))return queues[other].shift();
  return undefined;
 };
 const run=async(item:Item,channel:KnowledgeModelChannel)=>{
  try{await processPage(item.index,channel,invoke);}
  catch(error){
   // 检查点存取瞬态失败：本章放回队尾稍后重试，其他章继续。重试时已存 request.json 原样回放、
   // 路由回执按对象名复用，未闭合回执仍由路由层拦住，不会多买。不变量错误（原稿变化、身份不一致、取消）立即整单停。
   const delay=isTransientEditionCheckpointError(error)?requeueMs[item.requeues]:undefined;
   if(delay!==undefined&&!stopped){
    item.requeues++;delayed++;
    void sleep(delay).then(()=>{delayed--;if(!stopped)queues[item.preferred].push(item);changed();});
   }else{
    if(!failure)failure={error};
    stopped=true;
   }
  }finally{
   inFlight[channel]--;running--;changed();
  }
 };
 const dispatch=async(channel:KnowledgeModelChannel)=>{
  for(;;){
   if(stopped)return;
   if(!queued()){if(!delayed&&!running)return;await nextChange();continue;}
   if(inFlight[channel]>=limit(channel)){await nextChange();continue;}
   const item=take(channel);
   if(!item){await nextChange();continue;}
   inFlight[channel]++;running++;
   runs.push(run(item,channel));
   changed();
  }
 };
 await Promise.all(channels.map(dispatch));
 await Promise.allSettled(runs);
 if(failure)throw (failure as {error:unknown}).error;
 const issues=pageIssues.flat(),pendingVerification=pagePending.flat();
 if(total)await onProgress?.({doneBatches:total,totalBatches:total,pass:4});
 await evidence.save(`${evidence.prefix}/verified.json`,{digest,bodies:result,verifications,issues,pendingVerification,complete:issues.length===0,skipped:total===0});
 return {bodies:result,issues,pendingVerification,complete:issues.length===0};
}
