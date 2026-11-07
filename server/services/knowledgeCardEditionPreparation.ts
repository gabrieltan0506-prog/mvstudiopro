import { KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION, knowledgePendingResearchNotes } from './knowledgeVerificationPolicy';
import {buildKnowledgeBookletHtml} from '../../shared/knowledgeBooklet';
import {measureKnowledgeBookletFromWorker} from './pdfWorkerClient';
import {guardKnowledgeEditionEvidence,rethrowKnowledgeEditionInvariant,knowledgeEditionErrorMessage} from './knowledgeEditionRecovery';
import {hasKnowledgeBody} from '../../shared/knowledgeEditionIssues';
import {knowledgeEditionParts} from '../../shared/knowledgeCardEdition';
import {planKnowledgeCardPages} from '../../shared/knowledgeCardPagination';
import {KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST} from './knowledgeModelCapabilities';
import {verifyKnowledgeEditionManuscripts} from './knowledgeEditionFinalVerification';

import {deriveKnowledgeCardCompact} from './knowledgeCardLevelDerive';
import {createHash} from 'node:crypto';
import {compileKnowledgeEditions,knowledgeModulesFromMarkdown} from '../../shared/knowledgeCardEdition';

import {invokeKnowledgePublicationRoutes,type KnowledgeRouteEvidence,type KnowledgeModelRequest} from './knowledgePublicationRoutes';

const EDITION_COMPOSITION_VERSION='original-sections-pending-release-v3';
export const KNOWLEDGE_EDITION_INSTRUCTIONS = `只从完整稿挑选已有重点章节，原文逐字保留，不改写、不归并、不再次浓缩。只输出简体中文Markdown，不输出JSON。\n${KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION}`;

/** 同一底稿只整理一次；两版由同一份模块确定性编译，恢复读取原回执。 */
export async function prepareKnowledgeCardEditions(params:{
  sourceMarkdown:string;model?:string;targetSections?:number;evidence:KnowledgeRouteEvidence;abortSignal?:AbortSignal;
  onProgress?:(p:{doneBatches:number;totalBatches:number;pass:number})=>void|Promise<void>;
  invoke?:typeof invokeKnowledgePublicationRoutes;
  measure?:typeof measureKnowledgeBookletFromWorker;
}) {
  const {sourceMarkdown}=params;
  const evidence=guardKnowledgeEditionEvidence(params.evidence);
  if(!sourceMarkdown.trim())throw Error('缺少知识底稿，未启动整理');
  const inputDigest=createHash('sha256').update(sourceMarkdown).digest('hex');
  const prior=await evidence.read(`${evidence.prefix}/editions.json`);
  if(prior){
    if(prior.inputDigest!==inputDigest)throw Error('原稿版本变化，保留原回执');
    if(prior.compositionVersion!==EDITION_COMPOSITION_VERSION)throw Error('此任务保存的是旧版浓缩结果，已保留原回执；不能当作原逻辑恢复结果或自动重新购买');
    return prior.result;
  }
  const invoke=params.invoke||invokeKnowledgePublicationRoutes;
  // 完整底稿先保存；精华只选择原节，不能用选择结果覆盖完整版。
  const previousSource = await evidence.read(`${evidence.prefix}/source.json`);
  if (previousSource && previousSource.compositionVersion !== EDITION_COMPOSITION_VERSION)
    throw Error('旧任务缺少疑点识别版本证据，保留原回执，不自动复用或重新购买');
  await evidence.save(`${evidence.prefix}/source.json`,{inputDigest,markdown:sourceMarkdown,compositionVersion:EDITION_COMPOSITION_VERSION});
  const selectionQuestions = new Set<string>();
  const selectChat:NonNullable<Parameters<typeof deriveKnowledgeCardCompact>[0]['chat']>=async call=>{
    params.abortSignal?.throwIfAborted();
    const hash=createHash('sha256').update(`${inputDigest}/selection/${call.selectionKey}/${call.executionChannel}/${call.system}/${call.user}`).digest('hex');
    const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const request:KnowledgeModelRequest={executionChannel:call.executionChannel||'openrouter',
      systemInstruction:{parts:[{text:call.system+'\n'+KNOWLEDGE_EDITION_INSTRUCTIONS}]},
      contents:[{role:'user',parts:[{text:JSON.stringify({sourceDigest:hash,source:{title:'精华重点选择',pages:[{id,headline:'完整稿原节选择',body:call.user,imageUrl:''}]}})}]}],
      generationConfig:{temperature:0.2,maxOutputTokens:KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST,responseMimeType:'text/markdown'}};
    const scope={...evidence,prefix:`${evidence.prefix}/selection-${hash}`};
    const completed=await scope.read(`${scope.prefix}/result.json`);
    if(completed){
      if(completed.inputDigest!==inputDigest)throw Error('原稿版本变化，保留原回执');
      for (const note of completed.pendingResearch || []) selectionQuestions.add(String(note));
      return String(completed.body);
    }
    const old=await scope.read(`${scope.prefix}/request.json`);
    if(old&&old.inputDigest!==inputDigest)throw Error('原稿版本变化，保留原回执');
    if(!old)await scope.save(`${scope.prefix}/request.json`,{inputDigest,request});
    const response=await invoke(old?.request||request,scope,params.abortSignal?{fetch:(url,init)=>fetch(url,{...init,signal:init?.signal?AbortSignal.any([init.signal,params.abortSignal!]):params.abortSignal})}:{});
    params.abortSignal?.throwIfAborted();
    const report=JSON.parse(JSON.parse(response.text).candidates[0].content.parts[0].text);
    const body=String(report.pages?.[0]?.body||'').trim();
    if(!body)throw Error('精华选择返回空内容，完整稿已保留');
    const pendingResearch = Array.from(new Set([
      ...knowledgePendingResearchNotes(body),
      ...(report.pages?.[0]?.cautions || []).filter((c: any) => c.kind === 'uncertain' && c.message === '已标注疑点，等待全册整理后统一联网核实。').map((c: any) => String(c.evidence).replace(/-->/g, '—')),
    ]));
    for (const note of pendingResearch) selectionQuestions.add(note);
    await scope.save(`${scope.prefix}/result.json`,{inputDigest,body,pendingResearch});
    return body;
  };
  const finalInvoke:typeof invokeKnowledgePublicationRoutes=async(request,scope)=>{
    params.abortSignal?.throwIfAborted();
    const result=await invoke(request,scope,params.abortSignal?{fetch:(url,init)=>fetch(url,{...init,signal:init?.signal?AbortSignal.any([init.signal,params.abortSignal!]):params.abortSignal})}:{});
    params.abortSignal?.throwIfAborted();return result;
  };
  const original=knowledgeModulesFromMarkdown(sourceMarkdown);
  const modules=original.modules;
  const fullSource=`# ${original.title}\n\n`+modules.map(m=>`## ${m.headline}\n\n${m.body}`).join('\n\n');
  let selection={markdown:'',sections:0,targetSections:0,passes:0};
  const selectionIssues:{kind:string;message:string}[]=[];
  try{
    selection=await deriveKnowledgeCardCompact({fullMarkdown:fullSource,model:params.model,targetSections:params.targetSections,
      abortSignal:params.abortSignal,onProgress:params.onProgress,chat:selectChat});
    const selected=knowledgeModulesFromMarkdown(selection.markdown).modules;
    const selectedIndices=new Set<number>();
    for(const choice of selected){
      const candidates=modules.map((m,i)=>({m,i})).filter(({m,i})=>m.headline===choice.headline&&!selectedIndices.has(i));
      const exact=candidates.find(({m})=>m.body===choice.body);
      const matched=exact||(candidates.length===1?candidates[0]:null);
      if(!matched)throw Error('精华选择无法唯一对应原稿章节，完整稿已保存，不能据此出图');
      selectedIndices.add(matched.i);
    }
    // 只采纳章节选择；即使模型改写了段落，也使用原章正文。
    modules.forEach((module,index)=>{module.priority=selectedIndices.has(index)?'primary':'secondary';});
  }catch(error){
    params.abortSignal?.throwIfAborted();rethrowKnowledgeEditionInvariant(error);
    for(const module of modules)module.priority='secondary';
    selectionIssues.push({kind:'selection',message:knowledgeEditionErrorMessage(error)});
  }
  // 选节不改写知识；内容整理结束后，再统一处理真正的疑点与空章。
  const finalPages=modules.map(module=>`# ${original.title}\n\n## ${module.priority==='primary'?'主要重点':'次要重点'}｜${module.headline}\n\n${module.body}`);
  // 选节只采用原章身份，另传疑点，不能因舍弃模型改写正文而吞掉标注。
  const existingNotes = new Set(knowledgePendingResearchNotes(finalPages.join('\n')));
  for (const note of Array.from(selectionQuestions)) {
    if (existingNotes.has(note)) continue;
    const quote = note.match(/原句[：:]?\s*[「“]([^」”]+)[」”]/)?.[1];
    const matched = quote ? modules.findIndex(module => module.body.includes(quote)) : -1;
    if (matched < 0) finalPages.push(`# ${original.title}\n\n## 次要重点｜说明：原文待核补充\n\n原文核对：${quote || note}\n\n<!-- 待核：${note} -->`);
    else finalPages[matched] += `\n\n<!-- 待核：${note} -->`;
    existingNotes.add(note);
  }
  const verified=await verifyKnowledgeEditionManuscripts(finalPages,{...evidence,prefix:`${evidence.prefix}/final-verification`},finalInvoke,params.onProgress);
  const verifiedModules=verified.flatMap((body,index)=>knowledgeModulesFromMarkdown(body).modules.map(module=>({...module,priority:modules[index]?.priority||'secondary'})));
  const editions=compileKnowledgeEditions(original.title,verifiedModules);
  // 正式分页检查点：两档原稿先保存，再逐个实际图片页及文字章节保存。
  // 这里的图片页是实际出图分页；文字物理页仍由正式Booklet/PDF渲染器测量。
  const verification=await evidence.read(`${evidence.prefix}/final-verification/verified.json`);
  const issues=[...(verification?.issues||[]),...selectionIssues];
  const editionPageCounts:Record<string,{imagePages:number|null;readingPages:number|null}>={};
  for(const [level,markdown] of [['full',editions.full],['concise',editions.concise]] as const){
    await evidence.save(`${evidence.prefix}/pages/${level}/manuscript.json`,{inputDigest,markdown});
    const parts=knowledgeEditionParts(markdown)!;
    editionPageCounts[level]={imagePages:null,readingPages:null};
    for(const [index,module] of Array.from(parts.modules.entries()))
      await evidence.save(`${evidence.prefix}/pages/${level}/chapters/${index}.json`,{inputDigest,...module,status:hasKnowledgeBody(module.body)?'saved':'pending_content'});
    try{
      const plan=planKnowledgeCardPages(markdown,params.model);
      editionPageCounts[level].imagePages=plan.pageCount;
      for(const [index,body] of Array.from(plan.pages.entries()))await evidence.save(`${evidence.prefix}/pages/${level}/images/${index}.json`,{inputDigest,pageIndex:index,body,status:'saved'});
    }catch(error){rethrowKnowledgeEditionInvariant(error);issues.push({kind:'pagination',message:knowledgeEditionErrorMessage(error),level});}
    try{
      const text=parts.modules.filter(m=>m.medium==='text');
      if(level==='full'&&!text.some(m=>hasKnowledgeBody(m.body)))issues.push({kind:'missing_reading',message:'完整版尚无独立文字说明，原稿已保存，不能视为两档整理完成',level});
      const html=text.length?buildKnowledgeBookletHtml({title:parts.title,pages:text.map(m=>({...m,imageUrl:''}))}):'';
      await evidence.save(`${evidence.prefix}/pages/${level}/reading-layout.json`,{inputDigest,html});
      const readingPages=html?await (params.measure||measureKnowledgeBookletFromWorker)(html):0;
      editionPageCounts[level].readingPages=readingPages;
      await evidence.save(`${evidence.prefix}/pages/${level}/counts.json`,{inputDigest,...editionPageCounts[level]});
    }catch(error){rethrowKnowledgeEditionInvariant(error);issues.push({kind:'pagination',message:knowledgeEditionErrorMessage(error),level});}
  }
  const result={markdown:editions.concise,fullEditionMarkdown:editions.full,sections:verifiedModules.length,
    targetSections:selection.targetSections,passes:selection.passes,editionVersion:2,verificationProcessed:verification?.complete!==false&&issues.length===0,editionIssues:issues,editionPendingVerification:verification?.pendingVerification||[],editionPageCounts,
    unclassifiedModules:verifiedModules.filter(m=>m.priority==='secondary').length};
  await evidence.save(`${evidence.prefix}/editions.json`,{inputDigest,compositionVersion:EDITION_COMPOSITION_VERSION,original:sourceMarkdown,modules:verifiedModules,result});
  return result;
}
