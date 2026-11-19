import {bestKnowledgeTextMatch} from '../../shared/knowledgeTextAttachment';
import {createHash} from 'node:crypto';
import {knowledgeReadingMarkdown} from '../../shared/knowledgePublicationLayout';
import {validateKnowledgeReview,type KnowledgeReview,type KnowledgeSource} from '../../shared/knowledgePublication';
import {invokeKnowledgePublicationRoutes,type KnowledgeRouteEvidence,type KnowledgeModelRequest,KNOWLEDGE_PUBLICATION_ROUTE_VERSION,knowledgeReasoningEffort,type KnowledgeReasoningEffort} from './knowledgePublicationRoutes';
import {parseKnowledgeModelJson} from './knowledgeModelJson';
import {KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST,KNOWLEDGE_PUBLICATION_ALL_ROUTES} from './knowledgeModelCapabilities';

type Page=KnowledgeReview['pages'][number];

/**
 * 程序归属（2026-11-19，先程序后模型）：章节标题 → 唯一原句片段 → 相似度（领先幅度门槛）→ 仍不确定才问模型。
 * 任一步出现互相矛盾或并列的依据即判「不确定」交模型，不落到下一步去猜；文字无依据（相似度低于下限）同样交模型。
 */
export const KNOWLEDGE_CAUTION_TITLE_MIN_CHARS=4;
export const KNOWLEDGE_CAUTION_FRAGMENT_MIN_CHARS=8;
/**
 * 相似度归属门槛。余弦分数随章节长度缩小，不宜用绝对下限，故另算「覆盖率」= 疑点证据的二字片段（按同一 IDF 权重）在该章出现的比例，与章长无关：
 * - 依据下限：第一名覆盖率 < COVERAGE_MIN 视为文字无依据（no_basis）；
 * - 领先门槛：第一名覆盖率须比第二名高出 COVERAGE_LEAD，且余弦分数不少于第二名的 RATIO 倍，余弦与覆盖率的第一名须是同一章，否则按并列交模型。
 */
export const KNOWLEDGE_CAUTION_COVERAGE_MIN=0.3;
export const KNOWLEDGE_CAUTION_COVERAGE_LEAD=0.15;
export const KNOWLEDGE_CAUTION_SIMILARITY_RATIO=1.5;
/** 与 shared/knowledgeTextAttachment 的 bestKnowledgeTextMatch 同一套二字片段 TF-IDF 余弦（该处未导出分数，此处逐行同构以取第一、第二名分差）。 */
const similarityClean=(text:string)=>text.replace(/<!--[\s\S]*?-->/g,'').replace(/〔参考原页[^〕]*〕/g,'').replace(/[#>*|`\-:：，。、；！？（）()［］\[\]「」“”"'·\s\d]/g,'');
function similarityBigrams(text:string){const s=similarityClean(text),out=new Map<string,number>();for(let i=0;i<s.length-1;i++){const g=s.slice(i,i+2);out.set(g,(out.get(g)||0)+1);}return out;}
function similarityMeasures(candidates:readonly string[],query:string){
 const grams=candidates.map(similarityBigrams),q=similarityBigrams(query),df=new Map<string,number>();
 for(const g of [...grams,q])for(const key of Array.from(g.keys()))df.set(key,(df.get(key)||0)+1);
 const docs=grams.length+1,w=(g:string)=>Math.log(1+docs/(1+(df.get(g)||0)));
 let total=0;for(const [g,c] of Array.from(q))total+=c*w(g);
 return grams.map(b=>{
  let dot=0,na=0,nb=0,covered=0;
  for(const [g,c] of Array.from(q)){const x=c*w(g);na+=x*x;const y=(b.get(g)||0)*w(g);dot+=x*y;if(b.has(g))covered+=x;}
  for(const [g,c] of Array.from(b)){const y=c*w(g);nb+=y*y;}
  return {cosine:na&&nb?dot/Math.sqrt(na*nb):0,coverage:total?covered/total:0};
 });
}
export function knowledgeCautionSimilarityScores(candidates:readonly string[],query:string):number[]{return similarityMeasures(candidates,query).map(m=>m.cosine);}
export function knowledgeCautionCoverage(candidates:readonly string[],query:string):number[]{return similarityMeasures(candidates,query).map(m=>m.coverage);}
export type KnowledgeCautionProgramResult={targets:number[];method:'heading'|'quotation'|'similarity'}|{targets:[];method:'ambiguous';reason:'multiple_headings'|'heading_quote_conflict'|'quotation_ambiguous'|'similarity_near_tie'|'no_basis'};
/** 单条疑点的程序归属；chapters 的 index 为章节在正文中的块序号。只有唯一且无矛盾的依据才返回目标。 */
export function knowledgeCautionProgramBinding(chapters:readonly {index:number;title?:string;text:string}[],evidence:string):KnowledgeCautionProgramResult{
 const clean=(text:string)=>text.replace(new RegExp('[\\s\\p{P}\\p{S}]','gu'),'');
 const ev=clean(evidence);
 // 1. 章节标题：证据逐字含某章标题（去空白标点后 ≥4 字）；被另一个命中标题包含的短标题不单独算。
 let heading=chapters.filter(c=>{const t=clean(c.title||'');return t.length>=KNOWLEDGE_CAUTION_TITLE_MIN_CHARS&&ev.includes(t);});
 heading=heading.filter(c=>!heading.some(o=>o!==c&&clean(o.title||'')!==clean(c.title||'')&&clean(o.title||'').includes(clean(c.title||''))));
 if(heading.length>1)return {targets:[],method:'ambiguous',reason:'multiple_headings'};
 // 2. 原句片段：按引号与标点切开，去空白标点后 ≥8 字且逐字出现在某章的片段。
 const fragments=Array.from(new Set(evidence.split(/[「」“”"『』‘’'，。；;：:！？!?、,\n（）()【】\[\]]/).map(clean).filter(f=>f.length>=KNOWLEDGE_CAUTION_FRAGMENT_MIN_CHARS)));
 const texts=chapters.map(c=>clean(c.text));
 const found=fragments.map(f=>chapters.filter((_,i)=>texts[i].includes(f)).map(c=>c.index)).filter(set=>set.length);
 if(found.length){
  if(heading.length===1)return found.every(set=>set.includes(heading[0].index))?{targets:[heading[0].index],method:'heading'}:{targets:[],method:'ambiguous',reason:'heading_quote_conflict'};
  const common=found.reduce((acc,set)=>acc.filter(i=>set.includes(i)));
  return common.length===1?{targets:[common[0]],method:'quotation'}:{targets:[],method:'ambiguous',reason:'quotation_ambiguous'};
 }
 if(heading.length===1)return {targets:[heading[0].index],method:'heading'};
 // 3. 相似度：第一名须过下限且明显领先，否则不猜。
 const measures=similarityMeasures(chapters.map(c=>c.text),evidence);
 const byCosine=measures.map((m,i)=>({...m,i})).sort((a,b)=>b.cosine-a.cosine),byCoverage=measures.map((m,i)=>({...m,i})).sort((a,b)=>b.coverage-a.coverage);
 const top=byCoverage[0],second=byCoverage[1];
 if(!top||top.coverage<KNOWLEDGE_CAUTION_COVERAGE_MIN)return {targets:[],method:'ambiguous',reason:'no_basis'};
 if(byCosine[0].i!==top.i||top.coverage-(second?.coverage??0)<KNOWLEDGE_CAUTION_COVERAGE_LEAD||byCosine[0].cosine<KNOWLEDGE_CAUTION_SIMILARITY_RATIO*(byCosine[1]?.cosine??0))
  return {targets:[],method:'ambiguous',reason:'similarity_near_tie'};
 return {targets:[chapters[top.i].index],method:'similarity'};
}
/** 只确定疑点所在章节；正文与疑点原句始终由程序取原值，模型不能改写。 */
export async function bindKnowledgeDistillCautions(page:Page,options:{evidence:KnowledgeRouteEvidence;invoke?:typeof invokeKnowledgePublicationRoutes;family:'glm'|'deepseek';channel:'openrouter'|'evolink';abortSignal?:AbortSignal;
 /** 读档任务共享的通道健康/并发闸/日志标签：某通道已判不可用（如余额不足 402）时直接从另一通道起步，不逐个先撞。 */
 routeOverrides?:Pick<NonNullable<Parameters<typeof invokeKnowledgePublicationRoutes>[2]>,'gates'|'channelHealth'|'logLabel'|'signal'>;
 /** 本请求思考档位；缺省按 knowledgeReasoningEffort('caution_binding')（high，env 可调）。不进入归属身份 digest。 */
 reasoningEffort?:KnowledgeReasoningEffort}) {
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
 const identityOf=(missing:{index:number}[])=>({version:1,pageId:page.id,chapters:chapters.map(c=>({label:`章节${c.index}｜${c.title}`,body:c.text})),questions:missing.map(({index})=>({id:`疑点${index}`,evidence:cautions[index].evidence,message:cautions[index].message}))});
 const digestOf=(identity:unknown)=>createHash('sha256').update(JSON.stringify(identity)).digest('hex');
 // 续做兼容：按原规则（仅「」原句）未能确定的疑点集合即旧归属身份；该身份目录已有 request.json（已发出或即将发出的归属请求、
 // 已付回执、已收回包）时整页沿旧流程，不做程序归属，旧回执原样复用、不另买；没有时才先程序归属，只把仍不确定的交模型。
 const legacyMissing=associations.map((targets,index)=>({targets,index})).filter(x=>!x.targets.length);
 const programBindings:({index:number}&KnowledgeCautionProgramResult)[]=[];
 let legacyDigest='';
 if(legacyMissing.length){
  legacyDigest=digestOf(identityOf(legacyMissing));
  if(!await options.evidence.read(`${options.evidence.prefix}/caution-binding-${legacyDigest}/request.json`)){
   for(const {index} of legacyMissing){
    const result=knowledgeCautionProgramBinding(chapters,cautions[index].evidence);
    programBindings.push({index,...result});
    if(result.targets.length)associations[index]=[...result.targets];
   }
  }
 }
 const missing=associations.map((targets,index)=>({targets,index})).filter(x=>!x.targets.length);
 if(!missing.length&&programBindings.length)
  await options.evidence.save(`${options.evidence.prefix}/caution-program-${legacyDigest}.json`,{digest:legacyDigest,associations,programBindings});
 if(missing.length){
  const identity=identityOf(missing);
  const digest=digestOf(identity);
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
      raw=await (options.invoke||invokeKnowledgePublicationRoutes)(old?.request||request,guardedEvidence,{...options.routeOverrides,reasoningEffort:options.reasoningEffort??knowledgeReasoningEffort('caution_binding'),...(options.abortSignal?{signal:options.abortSignal}:{}),fetch:async(url,init)=>{
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
  await evidence.save(`${evidence.prefix}/bindings.json`,{digest,associations,similarityFallback:fallback,skippedBlocks:skipped,...(modelError?{modelError}:{}),...(programBindings.length?{programBindings}:{})});
 }
 for(const [index,caution] of Array.from(cautions.entries())){
  const note=`<!-- 待核：${caution.evidence.replace(/-->/g,'—')}；${caution.message.replace(/-->/g,'—')} -->`;
  for(const target of associations[index])chunks[target]=chunks[target].trimEnd()+'\n\n'+note+'\n\n';
 }
 return chunks.join('').trimEnd();
}
