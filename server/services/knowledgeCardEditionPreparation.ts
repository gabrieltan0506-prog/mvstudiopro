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

const EDITION_COMPOSITION_VERSION='original-sections-json-selection-v4';
/** 原章仍宣称有疑点时，不能仅凭历史成功状态认定内容已经闭合。 */
function unfinishedEditionQuestions(markdown:string) {
  return (knowledgeEditionParts(markdown)?.modules||[]).filter(module=>
    /已列(?:入)?(?:待核)?疑点/.test(module.body) && !/待验证[：:]/.test(module.body)
  ).map(module=>({kind:'unresolved',message:`“${module.headline}”仍保留明确疑点，尚未对应到该章修订或待验证标记`}));
}

function auditEditionResult<T extends {fullEditionMarkdown:string;markdown:string;editionIssues?:{kind:string;message:string}[];verificationProcessed:boolean}>(result:T):T {
  const outstanding=unfinishedEditionQuestions(result.fullEditionMarkdown);
  if(!outstanding.length)return result;
  const issues=[...(result.editionIssues||[])];
  for(const issue of outstanding)if(!issues.some(old=>old.kind===issue.kind&&old.message===issue.message))issues.push(issue);
  return {...result,editionIssues:issues,verificationProcessed:false};
}
export const KNOWLEDGE_EDITION_INSTRUCTIONS = `只从完整稿挑选已有重点章节，原文逐字保留，不改写、不归并、不再次浓缩。沿用knowledge_publication_v1 JSON合同，只选择已有章节身份，正文由程序取回原文。\n${KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION}`;

/** 只移动内部疑点注释时，已有章节选择仍能以逐字知识身份复用。 */
export function knowledgeEditionSelectionDigest(sourceMarkdown:string,targetSections?:number) {
  const parsed=knowledgeModulesFromMarkdown(sourceMarkdown);
  return createHash('sha256').update(JSON.stringify({title:parsed.title,targetSections:targetSections??null,
    modules:parsed.modules.map(m=>({headline:m.headline,body:m.body.replace(/<!--\s*待核[：:][\s\S]*?-->/g,'').replace(/\s+/g,' ').trim()}))})).digest('hex');
}

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
    const result=auditEditionResult(prior.result);
    // 缓存正文不重购；图片计数由当前共用分页器重算，文字物理页保持原实测值。
    if(!result.editionPageCounts)return result;
    return {...result,editionPageCounts:Object.fromEntries((['full','concise'] as const).map(level=>[level,{
      ...result.editionPageCounts[level],imagePages:planKnowledgeCardPages(level==='full'?result.fullEditionMarkdown:result.markdown,params.model).pageCount,
    }]))};
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
      executionFamily:String(params.model||'').includes('glm')?'glm':'deepseek',
      systemInstruction:{parts:[{text:`从本批已有章节选择最能代表主线、对读者最有用的${call.selectionKeep||3}节。不改章节标题、不合并、不新增章节。只输出JSON：{kind:"knowledge_publication_v1",sourceDigest:原值,title:"重点章节选择",pages:[{id:原id,headline:"重点章节选择",body:"选择理由",imageDescription:"",imageStatus:"absent",facts:[{term:"重点",statement:"具体选择理由"}],cautions:[],reading:{version:1,subtitle:"",accent:"jade",blocks:[{type:"prose",title:"逐字照抄一个被选章节的标题，不带##",note:"",text:"该章值得配图的具体理由"}]}}]}。每个块对应一个被选原章，blocks最多${call.selectionKeep||3}项。正文不用重抄，程序会取回原章全部内容。若发现实际疑点，cautions用{kind:"uncertain",evidence:"原句与具体问题",message:"已标注疑点，等待全册整理后统一联网核实。"}逐条记录，无疑点为空。
${KNOWLEDGE_EDITION_INSTRUCTIONS}`}]},
      contents:[{role:'user',parts:[{text:JSON.stringify({sourceDigest:hash,source:{title:'精华重点选择',pages:[{id,headline:'完整稿原节选择',body:call.user,imageUrl:''}]}})}]}],
      generationConfig:{temperature:0.2,maxOutputTokens:KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST,responseMimeType:'application/json'}};
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
    const candidates=knowledgeModulesFromMarkdown(call.user).modules;
    const blocks=report.pages?.[0]?.reading?.blocks;
    if(!Array.isArray(blocks)||!blocks.length)throw Error('精华JSON选择未返回章节，完整稿已保留');
    const seen=new Set<string>();
    const chosen=blocks.map((block:any)=>{
      const matches=candidates.filter(module=>module.headline===block.title);
      if(matches.length!==1||seen.has(block.title))throw Error('精华JSON选择包含未知、重复或歧义章节');
      seen.add(block.title);return matches[0];
    });
    const body=chosen.map(module=>`## ${module.headline}\n\n${module.body}`).join('\n\n');
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
    const selectionDigest=knowledgeEditionSelectionDigest(sourceMarkdown,params.targetSections);
    const savedSelection=await evidence.read(`${evidence.prefix}/selected-sections.json`);
    const selectedIndices=new Set<number>();
    if(savedSelection){
      if(savedSelection.knowledgeDigest!==selectionDigest||!Array.isArray(savedSelection.selectedIndices)||
        savedSelection.selectedIndices.some((i:unknown)=>!Number.isInteger(i)||Number(i)<0||Number(i)>=modules.length)||
        new Set(savedSelection.selectedIndices).size!==savedSelection.selectedIndices.length)
        throw Error('原稿版本变化或章节选择身份不一致，保留旧回执');
      for(const index of savedSelection.selectedIndices)selectedIndices.add(index);
      for(const note of savedSelection.pendingResearch||[])selectionQuestions.add(String(note));
      selection={markdown:'# '+original.title+'\n\n'+modules.filter((_,i)=>selectedIndices.has(i)).map(m=>`## ${m.headline}\n\n${m.body}`).join('\n\n'),
        sections:selectedIndices.size,targetSections:savedSelection.targetSections,passes:savedSelection.passes};
    }else{
      selection=await deriveKnowledgeCardCompact({fullMarkdown:fullSource,model:params.model,targetSections:params.targetSections,
        abortSignal:params.abortSignal,onProgress:params.onProgress,chat:selectChat});
      const selected=knowledgeModulesFromMarkdown(selection.markdown).modules;
      for(const choice of selected){
        const candidates=modules.map((m,i)=>({m,i})).filter(({m,i})=>m.headline===choice.headline&&!selectedIndices.has(i));
        const exact=candidates.find(({m})=>m.body===choice.body);
        const matched=exact||(candidates.length===1?candidates[0]:null);
        if(!matched)throw Error('精华选择无法唯一对应原稿章节，完整稿已保存，不能据此出图');
        selectedIndices.add(matched.i);
      }
      await evidence.save(`${evidence.prefix}/selected-sections.json`,{knowledgeDigest:selectionDigest,selectedIndices:Array.from(selectedIndices),
        targetSections:selection.targetSections,passes:selection.passes,pendingResearch:Array.from(selectionQuestions).sort()});
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
  for (const note of Array.from(selectionQuestions).sort()) {
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
  const result=auditEditionResult({markdown:editions.concise,fullEditionMarkdown:editions.full,sections:verifiedModules.length,
    targetSections:selection.targetSections,passes:selection.passes,editionVersion:2,verificationProcessed:verification?.complete!==false&&issues.length===0,editionIssues:issues,editionPendingVerification:verification?.pendingVerification||[],editionPageCounts,
    unclassifiedModules:verifiedModules.filter(m=>m.priority==='secondary').length});
  await evidence.save(`${evidence.prefix}/editions.json`,{inputDigest,compositionVersion:EDITION_COMPOSITION_VERSION,original:sourceMarkdown,modules:verifiedModules,result});
  return result;
}
