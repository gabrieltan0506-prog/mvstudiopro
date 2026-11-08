import {bestKnowledgeTextMatch} from '../../shared/knowledgeTextAttachment';
import {createHash} from 'node:crypto';
import {knowledgeReadingMarkdown} from '../../shared/knowledgePublicationLayout';
import {validateKnowledgeReview,type KnowledgeReview,type KnowledgeSource} from '../../shared/knowledgePublication';
import {invokeKnowledgePublicationRoutes,type KnowledgeRouteEvidence,type KnowledgeModelRequest,KNOWLEDGE_PUBLICATION_ROUTE_VERSION} from './knowledgePublicationRoutes';
import {parseKnowledgeModelJson} from './knowledgeModelJson';
import {KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST,KNOWLEDGE_PUBLICATION_ALL_ROUTES} from './knowledgeModelCapabilities';

type Page=KnowledgeReview['pages'][number];
/** 只确定疑点所在章节；正文与疑点原句始终由程序取原值，模型不能改写。 */
export async function bindKnowledgeDistillCautions(page:Page,options:{evidence:KnowledgeRouteEvidence;invoke?:typeof invokeKnowledgePublicationRoutes;family:'glm'|'deepseek';channel:'openrouter'|'evolink';abortSignal?:AbortSignal}) {
 options.abortSignal?.throwIfAborted();
 if(!page.reading)throw Error('提炼JSON缺少章节结构');
 const body=knowledgeReadingMarkdown(page.reading).replace(/^### /gm,'## ').replace(/^> (?!〔参考原页)/gm,'说明：');
 const cautions=page.cautions.filter(c=>c.kind==='uncertain');
 if(!cautions.length)return body;
 const chunks=body.split(/(?=^##[ \t]+)/m),chapters=chunks.map((text,index)=>({text,index,title:text.match(/^##[ \t]+([^\n]+)/)?.[1]})).filter(c=>c.title);
 if(!chapters.length)throw Error('疑点缺少可绑定的原章，保留原JSON');
 const clean=(text:string)=>text.replace(new RegExp('[\\s\\p{P}]','gu'),'');
 const associations:number[][]=cautions.map(c=>{
  if(chapters.length===1)return [chapters[0].index];
  const quotes=Array.from(c.evidence.matchAll(/[「“]([^」”]+)[」”]/g),m=>clean(m[1])).filter(q=>q.length>=8);
  const matches=quotes.map(q=>chapters.filter(ch=>clean(ch.text).includes(q)));
  return matches.length&&matches.every(m=>m.length===1)?Array.from(new Set(matches.map(m=>m[0].index))):[];
 });
 const missing=associations.map((targets,index)=>({targets,index})).filter(x=>!x.targets.length);
 if(missing.length){
  const identity={version:1,pageId:page.id,chapters:chapters.map(c=>({label:`章节${c.index}｜${c.title}`,body:c.text})),questions:missing.map(({index})=>({id:`疑点${index}`,evidence:cautions[index].evidence,message:cautions[index].message}))};
  const digest=createHash('sha256').update(JSON.stringify(identity)).digest('hex');
  const id=`${digest.slice(0,8)}-${digest.slice(8,12)}-4${digest.slice(13,16)}-8${digest.slice(17,20)}-${digest.slice(20,32)}`;
  const source:KnowledgeSource={title:'已有疑点对应原章',pages:[{id,headline:'只关联，不改内容',body:JSON.stringify(identity),imageUrl:''}]};
  const evidence={...options.evidence,prefix:`${options.evidence.prefix}/caution-binding-${digest}`};
  // 模型回包的对应表按规范化标签解析：大小写/空白/全半角差异、只写章节号或只写章节标题都能对上；
  // 对不上的条目只跳过（不改正文、不臆测），漏掉的疑点稍后按内容相似度归位，不让整本读档失败。
  const norm=(text:unknown)=>String(text??'').normalize('NFKC').replace(/\s+/g,'').replace(/[|｜:：]/g,'|');
  const resolveChapter=(title:unknown)=>{
   const t=norm(title);if(!t)return undefined;
   return chapters.find(c=>norm(`章节${c.index}｜${c.title}`)===t)||chapters.find(c=>t===norm(`章节${c.index}`)||t.startsWith(norm(`章节${c.index}|`)))||chapters.find(c=>norm(c.title)===t);
  };
  const resolveQuestion=(text:unknown)=>{const m=norm(text).match(/^疑点(\d+)$/);return m?missing.find(q=>q.index===Number(m[1])):undefined;};
  const validateBlocks=(blocks:unknown)=>{
   if(!Array.isArray(blocks))throw Error('疑点关联缺少对应表');
   const pairs:{type:'prose';title:string;text:string;note:string}[]=[];
   for(const block of blocks as any[]){
    const target=resolveChapter(block?.title),question=resolveQuestion(block?.text);
    if(!target||!question)continue;
    pairs.push({type:'prose',title:`章节${target.index}｜${target.title}`,text:`疑点${question.index}`,note:''});
   }
   return pairs;
  };
  const recover=async(request:KnowledgeModelRequest)=>{
   const {researchAfterReview,...identityRequest}=request;
   const requestDigest=createHash('sha256').update(JSON.stringify([KNOWLEDGE_PUBLICATION_ROUTE_VERSION,identityRequest])).digest('hex');
   for(const route of KNOWLEDGE_PUBLICATION_ALL_ROUTES){
    const key=`${evidence.prefix}/route-${route.id}.json`,receipt=await evidence.read(key);
    if(!receipt?.response||receipt.requestDigest!==requestDigest||receipt.response.status<200||receipt.response.status>=300)continue;
    let recovered:any=null;
    try{
     const envelope=JSON.parse(receipt.response.text),choice=envelope.choices?.[0];
     if(choice?.finish_reason!=='stop'||!['glm-5.3-flashx','z-ai/glm-5.3-flashx','deepseek-v4.1-flash-1017','deepseek/deepseek-v4.1-flash-1017'].includes(envelope.model)||envelope.model!==receipt.model)continue;
     const answer:any=parseKnowledgeModelJson(choice.message.content).value;
     const emitted=answer.pages?.length===1?answer.pages[0]:answer.source?.pages?.length===1?answer.source.pages[0]:answer;
     if([answer.sourceDigest,emitted.sourceDigest].some(value=>value&&value!==digest))continue;
     if([emitted.id,emitted.pageId].some(value=>value&&value!==id&&value!==page.id))continue;
     const blocks=validateBlocks(emitted.reading?.blocks||emitted.blocks);
     // 仅恢复本定位步骤的固定外层字段；关联内容逐项来自已收回包，不补写知识正文。
     const reading={version:1,subtitle:'',accent:'jade',blocks};
     const report=validateKnowledgeReview({kind:'knowledge_publication_v1',sourceDigest:digest,title:source.title,pages:[{
      id,headline:source.pages[0].headline,body:knowledgeReadingMarkdown(reading as any),imageStatus:'absent',imageDescription:'',
      facts:[{term:'章节关联',statement:'仅定位已有疑点，不修改知识正文'}],cautions:[],reading,
     }]},source,digest);
     recovered={digest,report,recoveredFrom:key,responseSha:createHash('sha256').update(receipt.response.text).digest('hex')};
    }catch{ /* 不符合对应表/身份/覆盖的回包不采用，继续检查已收到的其他回包。 */ }
    if(recovered){await evidence.save(`${evidence.prefix}/recovered-report.json`,recovered);return recovered;}
   }
   return null;
  };
  let skipped=0,modelError='';
  try{
  let saved=await evidence.read(`${evidence.prefix}/report.json`)||await evidence.read(`${evidence.prefix}/recovered-report.json`);
  if(!saved){
   const example={kind:'knowledge_publication_v1',sourceDigest:digest,title:source.title,pages:[{id,headline:'只关联，不改内容',body:'已有疑点的章节对应关系',imageStatus:'absent',imageDescription:'',facts:[{term:'章节关联',statement:'定位已有疑点'}],cautions:[],reading:{version:1,subtitle:'',accent:'jade',blocks:[{type:'prose',title:'逐字原章节label',text:'逐字疑点id',note:''}]}}]};
   const request:KnowledgeModelRequest={executionFamily:options.family,executionChannel:options.channel,
    systemInstruction:{parts:[{text:'仅依据输入，把每条已有疑点关联到实际讨论该原句的原章节。不得选择不相关的最后一章；跨章矛盾关联所有涉及章节。不要判断医学真假，不联网、不改写正文或疑点，不增加新问题。只输出完整JSON，以下示例外层字段必须全部保留，reading.blocks每个关联是一块，title和text只能从输入选取，每条疑点至少关联一章。不能确定时不得猜测或假造关联。完整合同示例：'+JSON.stringify(example)}]},
    contents:[{role:'user',parts:[{text:JSON.stringify({sourceDigest:digest,source})}]}],generationConfig:{temperature:0,maxOutputTokens:KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST,responseMimeType:'application/json'}};
   const old=await evidence.read(`${evidence.prefix}/request.json`);
   if(old&&old.digest!==digest)throw Error('疑点章节关联身份变化');
   if(old){
    saved=await recover(old.request);
    if(!saved){
     for(const route of KNOWLEDGE_PUBLICATION_ALL_ROUTES)if(await evidence.read(`${evidence.prefix}/route-${route.id}.json`))
      throw Error('已有章节关联回执未能安全恢复，保留原结果，不自动重购');
    }
   }
   if(!saved){
    if(!old)await evidence.save(`${evidence.prefix}/request.json`,{digest,request});
    let raw=await evidence.read(`${evidence.prefix}/raw.json`),dispatched=false;
    if(!raw){
     try{
      const guardedEvidence={...evidence,save:async(key:string,value:any)=>{
       if(dispatched&&value?.state==='pending'&&/\/route-[^/]+\.json$/.test(key))throw Error('关联请求已有一次派发，禁止自动重购');
       await evidence.save(key,value);
      }};
      raw=await (options.invoke||invokeKnowledgePublicationRoutes)(old?.request||request,guardedEvidence,{fetch:async(url,init)=>{
       if(dispatched)throw Error('关联请求已有一次派发，禁止自动重购');dispatched=true;
       return fetch(url,{...init,signal:options.abortSignal?(init?.signal?AbortSignal.any([init.signal,options.abortSignal]):options.abortSignal):init?.signal});
      }});
      options.abortSignal?.throwIfAborted();await evidence.save(`${evidence.prefix}/raw.json`,raw);
     }catch(error){saved=await recover(old?.request||request);if(!saved)throw error;}
    }
    if(!saved){
     const envelope=JSON.parse(raw.text),candidate=envelope.candidates?.[0];
     if(raw.status<200||raw.status>=300||candidate?.finishReason!=='STOP')throw Error('疑点章节关联回包未完整结束，原回执保留');
     const report=validateKnowledgeReview(JSON.parse(candidate.content.parts.map((p:{text?:string})=>p.text||'').join('')),source,digest);
     validateBlocks(report.pages[0].reading?.blocks);
     saved={digest,report};await evidence.save(`${evidence.prefix}/report.json`,saved);
    }
   }
  }
  if(saved.digest!==digest)throw Error('疑点章节关联结果身份变化');
  const report=validateKnowledgeReview(saved.report,source,digest);
  for(const block of report.pages[0].reading?.blocks||[]){
   const target=block.type==='prose'?resolveChapter(block.title):undefined;
   const question=block.type==='prose'?resolveQuestion(block.text):undefined;
   if(!target||!question){skipped++;continue;}
   if(!associations[question.index].includes(target.index))associations[question.index].push(target.index);
  }
  }catch(error){
   options.abortSignal?.throwIfAborted();
   // 关联只决定疑点注释放在哪一章：回包缺失/截断/格式不符时不让整本读档失败，也不重购，全部改按内容相似度归位。
   modelError=String((error as Error)?.message||error).slice(0,200);
  }
  // 关联回包漏掉的疑点：按疑点证据原句与各原章内容的相似度确定性归位，保留全部疑点、不改正文、不重购。
  const fallback:number[]=[];
  for(const [index,targets] of Array.from(associations.entries())){
   if(targets.length)continue;
   const best=bestKnowledgeTextMatch(chapters.map(c=>c.text),`${cautions[index].evidence}\n${cautions[index].message}`);
   targets.push(chapters[best].index);fallback.push(index);
  }
  await evidence.save(`${evidence.prefix}/bindings.json`,{digest,associations,similarityFallback:fallback,skippedBlocks:skipped,...(modelError?{modelError}:{})});
 }
 for(const [index,caution] of Array.from(cautions.entries())){
  const note=`<!-- 待核：${caution.evidence.replace(/-->/g,'—')}；${caution.message.replace(/-->/g,'—')} -->`;
  for(const target of associations[index])chunks[target]=chunks[target].trimEnd()+'\n\n'+note+'\n\n';
 }
 return chunks.join('').trimEnd();
}
