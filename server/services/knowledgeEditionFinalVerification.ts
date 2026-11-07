import {createHash} from 'node:crypto';
import {buildKnowledgeConsistencyRequest,buildKnowledgeFinalRevisionRequest} from './knowledgePublicationAdvisor';
import {knowledgeVerificationTriggers} from './knowledgeVerificationPolicy';
import {invokeKnowledgePublicationRoutes,type KnowledgeRouteEvidence} from './knowledgePublicationRoutes';
import {knowledgeModulesFromMarkdown} from '../../shared/knowledgeCardEdition';
import {hasKnowledgeBody,markKnowledgeEditionGap,type KnowledgeEditionIssue} from '../../shared/knowledgeEditionIssues';
import {guardKnowledgeEditionEvidence,rethrowKnowledgeEditionInvariant,knowledgeEditionErrorMessage,isKnowledgeReceiptUnknown} from './knowledgeEditionRecovery';

/** 正式末段：仅处理疑点、空正文和已记录失败；每页独立保存，局部失败保留原稿继续。 */
export async function verifyKnowledgeEditionManuscripts(bodies:string[],storage:KnowledgeRouteEvidence,invoke=invokeKnowledgePublicationRoutes,onProgress?:(p:{doneBatches:number;totalBatches:number;pass:number})=>void|Promise<void>){
 const evidence=guardKnowledgeEditionEvidence(storage);
 const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
 const prior=await evidence.read(`${evidence.prefix}/verified.json`);
 if(prior){if(prior.digest!==digest)throw Error('最终核实原稿变化，保留旧回执');return prior.bodies as string[];}
 const prepared=bodies.map(body=>{
  const empty=knowledgeModulesFromMarkdown(body).modules.filter(m=>!hasKnowledgeBody(m.body));
  return empty.length?markKnowledgeEditionGap(body,`以下章节只有标题或正文为空，请围绕原章节及原稿上下文联网补齐，不删除章节：${empty.map(m=>m.headline).join('；')}`):body;
 });
 const factsByBody=prepared.map((body,i)=>[{pageId:`section-${i}`,headline:'章节待补齐与疑点',term:'知识及图片说明',statement:body}]);
 const required=factsByBody.map(facts=>knowledgeVerificationTriggers(facts).length>0);
 const total=required.filter(Boolean).length;
 const result:string[]=[],verifications:unknown[]=[],issues:KnowledgeEditionIssue[]=[],pendingVerification:{pageIndex:number;message:string}[]=[];
 let done=0;
 if(total)await onProgress?.({doneBatches:0,totalBatches:total,pass:3});
 for(let i=0;i<bodies.length;i++){
  // 原页在任何请求之前保存，已经完成的页在恢复时零调用复用。
  const pageKey=`${evidence.prefix}/pages/${i}.json`;
  const checkpoint=await evidence.read(pageKey);
  if(checkpoint&&checkpoint.digest!==digest)throw Error('章节输入变化，保留原回执');
  if(checkpoint?.status==='saved'){
   result.push(checkpoint.body);verifications.push(checkpoint.verification||null);issues.push(...(checkpoint.issues||[]));pendingVerification.push(...(checkpoint.pendingVerification||[]));
   if(required[i])await onProgress?.({doneBatches:++done,totalBatches:total,pass:3});
   continue;
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
     const request=buildKnowledgeConsistencyRequest('图文知识手册',digest,facts);request.executionChannel='evolink';
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
    await onProgress?.({doneBatches:done,totalBatches:total,pass:4});
    const revisionPrefix=`${evidence.prefix}/revision-${i}`;
    const saved=await evidence.read(`${revisionPrefix}/report.json`);
    if(saved){if(saved.digest!==digest)throw Error('修订输入变化，不能复用');body=saved.body;}
    else{
     const hash=createHash('sha256').update(`${digest}/${i}`).digest('hex');
     const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
     const source={title:'图文知识手册',pages:[{id,headline:'章节补齐与疑点修订',body:prepared[i],imageUrl:''}]};
     const request=buildKnowledgeFinalRevisionRequest(source,digest,[verification],i%2?'evolink':'openrouter');
     request.systemInstruction.parts.push({text:'保留原有内容、章节标题、主要/次要标记及图说明；只补齐本页缺失正文并处理实际疑点。不得删除空章节来伪装补齐，不虚构原书内容或来源。不能补齐的章节保留原样并保留待核注释。'});
     const old=await evidence.read(`${revisionPrefix}/request.json`);
     if(old&&old.digest!==digest)throw Error('修订输入变化，不能重新购买');
     if(!old)await evidence.save(`${revisionPrefix}/request.json`,{digest,request});
     const envelope=JSON.parse((await invoke(old?.request||request,{...evidence,prefix:revisionPrefix})).text);
     const revisedPage=JSON.parse(envelope.candidates[0].content.parts[0].text).pages?.[0];
     body=String(revisedPage?.body||'');
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
   const outstanding=knowledgeVerificationTriggers([{pageId:`section-${i}`,headline:'疑点',term:'正文',statement:body}]);
   for(const item of outstanding)localPending.push({pageIndex:i,message:item.quote});
   body=body.replace(/<!--\s*待核[：:]([\s\S]*?)-->/g,(_,note:string)=>`待验证：${note.trim()}`);
   if(outstanding.length&&!body.includes('待验证：'))body+='\n\n'+outstanding.map(item=>`待验证：${item.quote}`).join('\n\n');
  }
  const empty=knowledgeModulesFromMarkdown(body).modules.filter(m=>!hasKnowledgeBody(m.body));
  for(const module of empty)localIssues.push({pageIndex:i,kind:'empty_body',message:`“${module.headline}”正文仍待补齐，原章保留`});
  if(knowledgeVerificationTriggers([{pageId:`section-${i}`,headline:'疑点',term:'正文',statement:body}]).length&&!localIssues.length&&!localPending.length)
   localIssues.push({pageIndex:i,kind:'unresolved',message:'仍有待核疑点，原文及回执保留'});
  // 同页原文与结果一起落盘；失败不会回滚之前已保存页。
  await evidence.save(pageKey,{digest,pageIndex:i,original:bodies[i],body,status:'saved',verification,issues:localIssues,pendingVerification:localPending});
  result.push(body);verifications.push(verification);issues.push(...localIssues);pendingVerification.push(...localPending);
  if(required[i])await onProgress?.({doneBatches:++done,totalBatches:total,pass:3});
 }
 await evidence.save(`${evidence.prefix}/verified.json`,{digest,bodies:result,verifications,issues,pendingVerification,complete:issues.length===0,skipped:total===0});
 return result;
}
