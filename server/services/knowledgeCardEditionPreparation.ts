import { knowledgeEditionBudgetCheck } from "../../shared/knowledgeEditionBudget";
import { KNOWLEDGE_PENDING_RESEARCH_INSTRUCTION, knowledgePendingResearchNotes } from './knowledgeVerificationPolicy';
import type {measureKnowledgeBookletFromWorker} from './pdfWorkerClient';
import {guardKnowledgeEditionEvidence,rethrowKnowledgeEditionInvariant,knowledgeEditionErrorMessage} from './knowledgeEditionRecovery';
import {hasKnowledgeBody} from '../../shared/knowledgeEditionIssues';
import {knowledgeEditionParts} from '../../shared/knowledgeCardEdition';
import {knowledgeEditionImageChars,knowledgeEditionImagePlan,planKnowledgeCardPages} from '../../shared/knowledgeCardPagination';
import {KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST} from './knowledgeModelCapabilities';
import {verifyKnowledgeEditionManuscriptsDetailed} from './knowledgeEditionFinalVerification';
import {nameKnowledgeEditionTopics} from './knowledgeTopicTitles';

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

/** 逐页回执写入并发上限（每条一次对象存储上传），每档各自生效。 */
export const KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY=16;
/** 一批回执按块落完成标记：块内全部写完才记，续作只补未记块。单块整批时只记整批标记。 */
export const KNOWLEDGE_EDITION_RECEIPT_CHUNK=256;
/** 每完成这么多次写入让出一次事件循环（setImmediate），替身存储同步完成时也不会长时间占住心跳与取消轮询。 */
const RECEIPT_YIELD_EVERY=64;
const yieldEventLoop=()=>new Promise<void>(resolve=>setImmediate(resolve));

/** 每档一个写入闸门（各自 ≤ 上限，与原串行时每批上限相同）；置停标记两档共用，一档失败两档同时停止领取。 */
type ReceiptGate={inflight:number;waiters:(()=>void)[];completed:number;stop:{halted:boolean}};
const receiptGate=(stop:{halted:boolean}):ReceiptGate=>({inflight:0,waiters:[],completed:0,stop});
async function gated<T>(gate:ReceiptGate,task:()=>Promise<T>):Promise<T>{
  // 先到先得：名额释放时直接交给排队最久的一方（不先减再抢），块完成标记不会被后续回执饿住。
  if(gate.inflight<KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY&&!gate.waiters.length)gate.inflight++;
  else await new Promise<void>(resolve=>gate.waiters.push(resolve));
  try{return await task();}
  finally{
    const waiter=gate.waiters.shift();
    if(waiter)waiter();else gate.inflight--;
    if(++gate.completed%RECEIPT_YIELD_EVERY===0)await yieldEventLoop();
  }
}

/**
 * 一批逐页回执（某档的章节或分页）有界并发写入，带完成标记：
 * - `${marker}.done.json` 命中（同 inputDigest、同稿件摘要、同条数）即整批跳过，零上传；
 * - 未命中时按 KNOWLEDGE_EDITION_RECEIPT_CHUNK 分块，块标记 `${marker}.part-{k}.json` 命中的块跳过，只补其余块；
 * - 键与内容与原先逐条写入完全相同（每键只写一次、互不依赖，无读者依赖写入先后）。
 * 任一条失败即在共享闸门上置停（两档同时停止领取新条目），等在途收口后抛出本批序号最小的错误；
 * 已写完的块已落标记，续作不重传；重跑按同键同内容覆盖写，幂等。
 */
async function saveKnowledgeEditionReceipts(evidence:KnowledgeRouteEvidence,gate:ReceiptGate,marker:string,
  identity:{inputDigest:string;markdownDigest:string},entries:readonly (readonly [string,unknown])[],onCount:(added:number)=>Promise<void>){
  const total=entries.length;
  if(!total)return;
  const matches=(saved:any,start:number,end:number)=>Boolean(saved&&saved.inputDigest===identity.inputDigest&&
    saved.markdownDigest===identity.markdownDigest&&saved.count===total&&saved.start===start&&saved.end===end);
  const doneKey=`${marker}.done.json`;
  if(matches(await evidence.read(doneKey),0,total)){await onCount(total);return;}
  const chunks=Math.ceil(total/KNOWLEDGE_EDITION_RECEIPT_CHUNK);
  const bounds=(k:number)=>[k*KNOWLEDGE_EDITION_RECEIPT_CHUNK,Math.min(total,(k+1)*KNOWLEDGE_EDITION_RECEIPT_CHUNK)] as const;
  const partKey=(k:number)=>`${marker}.part-${k}.json`;
  const chunkDone=chunks>1?await Promise.all(Array.from({length:chunks},async(_,k)=>matches(await evidence.read(partKey(k)),...bounds(k)))):[false];
  const remaining=Array.from({length:chunks},(_,k)=>chunkDone[k]?0:bounds(k)[1]-bounds(k)[0]);
  const skipped=chunkDone.reduce((sum,done,k)=>sum+(done?bounds(k)[1]-bounds(k)[0]:0),0);
  if(skipped)await onCount(skipped);
  const pending=Array.from({length:total},(_,i)=>i).filter(i=>!chunkDone[Math.floor(i/KNOWLEDGE_EDITION_RECEIPT_CHUNK)]);
  let next=0;const state:{failure?:{index:number;error:unknown}}={};
  const record=(index:number,error:unknown)=>{gate.stop.halted=true;const prior=state.failure as {index:number;error:unknown}|undefined;if(!prior||index<prior.index)state.failure={index,error};};
  await Promise.all(Array.from({length:Math.min(KNOWLEDGE_EDITION_RECEIPT_WRITE_CONCURRENCY,pending.length)},async()=>{
    while(!gate.stop.halted&&next<pending.length){
      const index=pending[next++]!;
      try{
        // 排队拿到写入名额时再查一次置停：别处已失败就不再发起新上传。
        const written=await gated(gate,async()=>{if(gate.stop.halted)return false;await evidence.save(entries[index]![0],entries[index]![1]);return true;});
        if(!written)break;
        await onCount(1);
        const k=Math.floor(index/KNOWLEDGE_EDITION_RECEIPT_CHUNK);
        if(--remaining[k]===0&&chunks>1&&!gate.stop.halted)
          await gated(gate,()=>evidence.save(partKey(k),{...identity,count:total,start:bounds(k)[0],end:bounds(k)[1]}));
      }
      catch(error){record(index,error);}
    }
  }));
  if(state.failure)throw state.failure.error;
  if(gate.stop.halted)return;
  await evidence.save(doneKey,{...identity,count:total,start:0,end:total});
}

/**
 * 收尾段进度：多路并行的子任务共用一条串行上报链，上报时读取最新的合计计数与阶段，
 * 因此 doneBatches 与阶段只增不减；常规进度按 3 秒节流，子步骤起止强制上报。
 */
function editionProgressReporter(send:(step:string,done:number,total:number)=>Promise<void>,snapshot:()=>{step:string;done:number;total:number}){
  let chain:Promise<void>=Promise.resolve();let last=0;
  return (force=false)=>{
    if(!force&&Date.now()-last<3000)return chain;
    last=Date.now();
    chain=chain.then(()=>{const s=snapshot();return send(s.step,s.done,s.total);});
    return chain;
  };
}

/** 同一底稿只整理一次；两版由同一份模块确定性编译，恢复读取原回执。 */
export async function prepareKnowledgeCardEditions(params:{
  sourceMarkdown:string;model?:string;targetSections?:number;evidence:KnowledgeRouteEvidence;abortSignal?:AbortSignal;
  onProgress?:(p:{doneBatches:number;totalBatches:number;pass:number;step?:string})=>void|Promise<void>;
  invoke?:typeof invokeKnowledgePublicationRoutes;
  /** 已停用：准备阶段不再实排量文字页（readingPages 恒为 null）。仅为兼容既有调用方与测试保留形参，不会被调用。 */
  measure?:typeof measureKnowledgeBookletFromWorker;
}) {
  const reportStep = async (step:string,doneBatches=0,totalBatches=0) => {
    await params.onProgress?.({pass:4, step, doneBatches, totalBatches});
  };
  const {sourceMarkdown}=params;
  const evidence=guardKnowledgeEditionEvidence(params.evidence);
  if(!sourceMarkdown.trim())throw Error('缺少知识底稿，未启动整理');
  const inputDigest=createHash('sha256').update(sourceMarkdown).digest('hex');
  const prior=await evidence.read(`${evidence.prefix}/editions.json`);
  if(prior){
    if(prior.inputDigest!==inputDigest)throw Error('原稿版本变化，保留原回执');
    if(prior.compositionVersion!==EDITION_COMPOSITION_VERSION)throw Error('此任务保存的是旧版浓缩结果，已保留原回执；不能当作原逻辑恢复结果或自动重新购买');
    const cached=auditEditionResult(prior.result);
    // 缓存正文不重购；主题命题按已存回执回放，缺回执时只补一次廉价命题（失败回退机械标题）。
    await reportStep("读取成稿并整理标题");
    const [fullTitled,conciseTitled]=await Promise.all([cached.fullEditionMarkdown,cached.markdown].map(markdown=>
      nameKnowledgeEditionTopics({markdown,model:params.model,evidence,invoke:params.invoke,abortSignal:params.abortSignal})));
    const result={...cached,fullEditionMarkdown:fullTitled!.markdown,markdown:conciseTitled!.markdown};
    // 图片计数由当前共用分页器重算，文字物理页保持原实测值。
    if(!result.editionPageCounts)return result;
    return {...result,editionPageCounts:Object.fromEntries((['full','concise'] as const).map(level=>{
      const markdown=level==='full'?result.fullEditionMarkdown:result.markdown;
      const imagePages=planKnowledgeCardPages(markdown,params.model).pageCount;
      // 内文 = 独立文字模块 + 各主题图的图外细节（图内≤1200字，其余全部进内文）；完整版图文同页，内文须装进各图下栏。
      const topics=knowledgeEditionImagePlan(markdown);
      return [level,{...result.editionPageCounts[level],imagePages,pageBudget:knowledgeEditionBudgetCheck(level,imagePages,topics?.readingChars||0,knowledgeEditionImageChars(topics))}];
    }))};
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
    // 按规范化标题对应原章（空白/全半角/首尾标点差异都能对上）；未知与重复条目跳过并记录，同名多章按顺序取未选过的一章。
    // 只选原章、不改写；一章都对不上才报错（2026-11-08 敦煌本真实阻断：个别标题对不上即整份精华选择作废）。
    const norm=(t:unknown)=>String(t??'').normalize('NFKC').replace(/\s+/g,'').replace(/^[#\d.、:：\-—]+|[。.!！?？]+$/g,'');
    const used=new Set<number>();let skipped=0;
    const chosen=blocks.flatMap((block:any)=>{
      const index=candidates.findIndex((module,i)=>!used.has(i)&&norm(module.headline)===norm(block?.title));
      if(index<0){skipped++;return [];}
      used.add(index);return [candidates[index]!];
    });
    if(!chosen.length)throw Error('精华JSON选择包含未知、重复或歧义章节');
    if(skipped)console.warn(`[knowledgeEdition] 精华选择跳过${skipped}条无法对应原章的条目，已选${chosen.length}章`);
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
  // 核实直接返回问题/待验证/完成标记，不再把数十 MB 的 verified.json 整个读回。
  const verifiedEdition=await verifyKnowledgeEditionManuscriptsDetailed(finalPages,{...evidence,prefix:`${evidence.prefix}/final-verification`},finalInvoke,params.onProgress);
  const verified=verifiedEdition.bodies;
  await reportStep("合并已核实章节");
  const verifiedModules=verified.flatMap((body,index)=>knowledgeModulesFromMarkdown(body).modules.map(module=>({...module,priority:modules[index]?.priority||'secondary'})));
  const compiled=compileKnowledgeEditions(original.title,verifiedModules);
  // 主题图命题：两档并发各一次廉价批量调用，原始/解析回包永久保存；失败回退机械标题，不阻断。
  // 命题期间每次回执存取后按节流上报一次（大书命题要存上百个对象），两档各自完成时强制上报，避免整段沉默。
  const TITLE_STEP="整理完整版和精华版标题";
  let titledLevels=0;
  const titleProgress=editionProgressReporter(reportStep,()=>({step:TITLE_STEP,done:titledLevels,total:2}));
  await titleProgress(true);
  const titleEvidence:KnowledgeRouteEvidence={...evidence,
    read:async key=>{const value=await evidence.read(key);await titleProgress();return value;},
    save:async(key,value)=>{await evidence.save(key,value);await titleProgress();}};
  const [fullTitled,conciseTitled]=await Promise.all([compiled.full,compiled.concise].map(async markdown=>{
    const named=await nameKnowledgeEditionTopics({markdown,model:params.model,evidence:titleEvidence,invoke:finalInvoke,abortSignal:params.abortSignal});
    titledLevels++;await titleProgress(true);
    return named;
  }));
  const editions={full:fullTitled!.markdown,concise:conciseTitled!.markdown};
  // 正式分页检查点：两档原稿先保存，再逐个实际图片页及文字章节保存。
  // 这里的图片页是实际出图分页；文字物理页仍由正式Booklet/PDF渲染器测量。
  const verification=verifiedEdition;
  const issues=[...(verification?.issues||[]),...selectionIssues];
  const editionPageCounts:Record<string,{imagePages:number|null;readingPages:number|null;pageBudget?:ReturnType<typeof knowledgeEditionBudgetCheck>}>={};
  // 两档互不依赖：存稿、章节回执、分页回执并行处理（每档各自的写入闸门，失败置停共用）。
  // 文字物理页不再在准备阶段用无头浏览器实排：readingPages 全仓无读者（导出计费另行实测），
  // 今天大书在这一步整本拼 HTML 实排、无检查点，20 分钟无进度被判死；因此只保留 null 占位与 counts.json。
  const CHAPTER_STEP="保存完整版和精华版正文和章节",PAGE_STEP="计算并保存完整版和精华版图文分页";
  const levels=[['full',editions.full],['concise',editions.concise]] as const;
  const prepared:{level:'full'|'concise';markdown:string;markdownDigest:string;parts:NonNullable<ReturnType<typeof knowledgeEditionParts>>;
    imagePages:number|null;pages:readonly string[]|null;pageBudget?:ReturnType<typeof knowledgeEditionBudgetCheck>;issues:typeof issues}[]=[];
  for(const [level,markdown] of levels){
    // 两档分页先算好（同步、确定），合计总条数一次定下，进度只增不减；两档之间让出事件循环。
    await yieldEventLoop();
    const parts=knowledgeEditionParts(markdown)!;
    const levelIssues:typeof issues=[];
    // 与原串行版一致：分页成功即记图数；预检或分页任一步抛错则不写分页回执、记 pagination 问题。
    let imagePages:number|null=null,pages:readonly string[]|null=null,pageBudget:ReturnType<typeof knowledgeEditionBudgetCheck>|undefined;
    try{
      const plan=planKnowledgeCardPages(markdown,params.model);
      imagePages=plan.pageCount;
      // 生图前预检（完整版≤48张主题图、图文同页、页数=图数、内文超图下容量时报压缩目标；精华版≤30张、图:文1:2–1:3）；只提示不阻断。
      const topics=knowledgeEditionImagePlan(markdown);
      pageBudget=knowledgeEditionBudgetCheck(level,plan.pageCount,topics?.readingChars||0,knowledgeEditionImageChars(topics));
      pages=plan.pages;
    }catch(error){rethrowKnowledgeEditionInvariant(error);pageBudget=undefined;levelIssues.push({kind:'pagination',message:knowledgeEditionErrorMessage(error),level});}
    if(level==='full'&&!parts.modules.some(m=>m.medium==='text'&&hasKnowledgeBody(m.body)))
      levelIssues.push({kind:'missing_reading',message:'完整版尚无独立文字说明，原稿已保存，不能视为两档整理完成',level});
    prepared.push({level,markdown,markdownDigest:createHash('sha256').update(markdown).digest('hex'),parts,imagePages,pages,pageBudget,issues:levelIssues});
  }
  const phase:Record<string,number>={full:0,concise:0};
  let savedReceipts=0;
  const totalReceipts=prepared.reduce((sum,p)=>sum+p.parts.modules.length+(p.pages?.length||0),0);
  const finishProgress=editionProgressReporter(reportStep,()=>({step:Math.min(phase.full!,phase.concise!)>0?PAGE_STEP:CHAPTER_STEP,done:savedReceipts,total:totalReceipts}));
  const count=async(added:number)=>{savedReceipts+=added;await finishProgress();};
  const stop={halted:false};
  await finishProgress(true);
  const settled=await Promise.allSettled(prepared.map(async({level,markdown,markdownDigest,parts,pages})=>{
    const gate=receiptGate(stop);
    try{
      const identity={inputDigest,markdownDigest};
      // 正式分页检查点：两档原稿先保存（同输入同稿件已存则不重写），再逐个章节、实际图片页保存。
      const savedManuscript=await evidence.read(`${evidence.prefix}/pages/${level}/manuscript.json`);
      if(!(savedManuscript?.inputDigest===inputDigest&&savedManuscript.markdown===markdown))
        await evidence.save(`${evidence.prefix}/pages/${level}/manuscript.json`,{inputDigest,markdown});
      await finishProgress(true);
      if(gate.stop.halted)return;
      await saveKnowledgeEditionReceipts(evidence,gate,`${evidence.prefix}/pages/${level}/chapters`,identity,
        Array.from(parts.modules.entries()).map(([index,module])=>
          [`${evidence.prefix}/pages/${level}/chapters/${index}.json`,{inputDigest,...module,status:hasKnowledgeBody(module.body)?'saved':'pending_content'}] as const),count);
      if(gate.stop.halted)return;
      phase[level]=1;await finishProgress(true);
      if(pages)await saveKnowledgeEditionReceipts(evidence,gate,`${evidence.prefix}/pages/${level}/images`,identity,
        Array.from(pages.entries()).map(([index,body])=>
          [`${evidence.prefix}/pages/${level}/images/${index}.json`,{inputDigest,pageIndex:index,body,status:'saved'}] as const),count);
      if(gate.stop.halted)return;
      phase[level]=2;await finishProgress(true);
    }catch(error){stop.halted=true;throw error;}
  }));
  const failed=settled.find((r):r is PromiseRejectedResult=>r.status==='rejected');
  if(failed)throw failed.reason;
  for(const {level,imagePages,pageBudget,issues:levelIssues} of prepared){
    editionPageCounts[level]={imagePages,readingPages:null,...(pageBudget?{pageBudget}:{})};
    await evidence.save(`${evidence.prefix}/pages/${level}/counts.json`,{inputDigest,...editionPageCounts[level]});
    issues.push(...levelIssues);
  }
  await reportStep("保存两版成稿");
  const result=auditEditionResult({markdown:editions.concise,fullEditionMarkdown:editions.full,sections:verifiedModules.length,
    targetSections:selection.targetSections,passes:selection.passes,editionVersion:2,verificationProcessed:verification?.complete!==false&&issues.length===0,editionIssues:issues,editionPendingVerification:verification?.pendingVerification||[],editionPageCounts,
    unclassifiedModules:verifiedModules.filter(m=>m.priority==='secondary').length});
  await evidence.save(`${evidence.prefix}/editions.json`,{inputDigest,compositionVersion:EDITION_COMPOSITION_VERSION,original:sourceMarkdown,modules:verifiedModules,result});
  return result;
}
