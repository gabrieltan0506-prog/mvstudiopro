import {createHash} from 'node:crypto';
import {buildKnowledgeConsistencyRequest,buildKnowledgeFinalRevisionRequest} from './knowledgePublicationAdvisor';
import {knowledgeVerificationTriggers} from './knowledgeVerificationPolicy';
import {invokeKnowledgePublicationRoutes,type KnowledgeRouteEvidence} from './knowledgePublicationRoutes';

/** 全部模块就绪后集中校验；前期没有联网副作用，最终正文确认后才编译两档张数。 */
export async function verifyKnowledgeEditionManuscripts(bodies:string[],evidence:KnowledgeRouteEvidence,invoke=invokeKnowledgePublicationRoutes,onProgress?:(p:{doneBatches:number;totalBatches:number;pass:number})=>void|Promise<void>){
 const digest=createHash('sha256').update(JSON.stringify(bodies)).digest('hex');
 const prior=await evidence.read(`${evidence.prefix}/verified.json`);
 if(prior){if(prior.digest!==digest)throw Error('最终核实原稿变化，保留旧回执');return prior.bodies as string[];}
 const verifications:unknown[]=[];
 await onProgress?.({doneBatches:0,totalBatches:bodies.length,pass:3});
 for(let i=0;i<bodies.length;i++){
  const facts=[{pageId:`section-${i}`,headline:'全册统稿前核实',term:'知识及图片说明',statement:bodies[i]}];
  await evidence.save(`${evidence.prefix}/candidates-${i}.json`,{digest,facts,triggers:knowledgeVerificationTriggers(facts)});
  const prefix=`${evidence.prefix}/search-${i}`;
  let saved=await evidence.read(`${prefix}/report.json`);
  if(!saved){
   const request=buildKnowledgeConsistencyRequest('图文知识手册',digest,facts);request.executionChannel='evolink';
   const old=await evidence.read(`${prefix}/request.json`);
   if(!old)await evidence.save(`${prefix}/request.json`,{digest,request});
   else if(old.digest!==digest)throw Error('核实输入变化，不能重新购买');
   const envelope=JSON.parse((await invoke(old?.request||request,{...evidence,prefix})).text);
   saved=JSON.parse(envelope.candidates[0].content.parts[0].text);
   await evidence.save(`${prefix}/report.json`,saved);
  }
  verifications.push(saved);await onProgress?.({doneBatches:i+1,totalBatches:bodies.length,pass:3});
 }
 const result:string[]=[];
 await onProgress?.({doneBatches:0,totalBatches:bodies.length,pass:4});
 for(let i=0;i<bodies.length;i++){
  const prefix=`${evidence.prefix}/revision-${i}`;
  const saved=await evidence.read(`${prefix}/report.json`);
  if(saved)result.push(saved.body);
  else{
   const hash=createHash('sha256').update(`${digest}/${i}`).digest('hex');
   const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
   const source={title:'图文知识手册',pages:[{id,headline:'统稿与图片说明修订',body:bodies[i],imageUrl:''}]};
   const request=buildKnowledgeFinalRevisionRequest(source,digest,verifications,i%2?'evolink':'openrouter');
   request.systemInstruction.parts.push({text:'保留所有## 主要重点｜标题、## 次要重点｜标题。此处是生图前统稿，保留并优化每段“图：”说明，不声称看过未生成图片。核实标注已处理后不进入读者正文。'});
   const old=await evidence.read(`${prefix}/request.json`);
   if(!old)await evidence.save(`${prefix}/request.json`,{digest,request});else if(old.digest!==digest)throw Error('修订输入变化，不能重新购买');
   const envelope=JSON.parse((await invoke(old?.request||request,{...evidence,prefix})).text);
   const body=String(JSON.parse(envelope.candidates[0].content.parts[0].text).pages?.[0]?.body||'');
   if(!body.trim())throw Error('核实修订正文为空，原稿保留');
   await evidence.save(`${prefix}/report.json`,{body,digest});result.push(body);
  }
  await onProgress?.({doneBatches:i+1,totalBatches:bodies.length,pass:4});
 }
 await evidence.save(`${evidence.prefix}/verified.json`,{digest,bodies:result,verifications});return result;
}
