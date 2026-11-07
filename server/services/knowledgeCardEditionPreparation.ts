import {buildKnowledgeBookletHtml} from '../../shared/knowledgeBooklet';
import {measureKnowledgeBookletFromWorker} from './pdfWorkerClient';
import {guardKnowledgeEditionEvidence,rethrowKnowledgeEditionInvariant,knowledgeEditionErrorMessage,isKnowledgeReceiptUnknown} from './knowledgeEditionRecovery';
import {hasKnowledgeBody,markKnowledgeEditionGap} from '../../shared/knowledgeEditionIssues';
import {knowledgeEditionParts} from '../../shared/knowledgeCardEdition';
import {planKnowledgeCardPages} from '../../shared/knowledgeCardPagination';
import {KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST} from './knowledgeModelCapabilities';
import {verifyKnowledgeEditionManuscripts} from './knowledgeEditionFinalVerification';
import {knowledgeVerificationTriggers} from './knowledgeVerificationPolicy';
import {KNOWLEDGE_MODULE_PRESENTATION_GUIDANCE} from '../../shared/knowledgeDesignInspiration';
import {createHash} from 'node:crypto';
import {compileKnowledgeEditions,knowledgeModulesFromMarkdown} from '../../shared/knowledgeCardEdition';
import {KNOWLEDGE_NARRATIVE_STYLE} from '../../shared/knowledgeNarrativeStyle';
import {invokeKnowledgePublicationRoutes,type KnowledgeRouteEvidence,type KnowledgeModelRequest} from './knowledgePublicationRoutes';

export const KNOWLEDGE_EDITION_INSTRUCTIONS = `你是图文知识手册编辑。只输出简体中文Markdown，不输出JSON、装饰配置、处理过程或页号。
将主要与次要的有用知识去重、浓缩为主题模块，再确定知识优先级。完整是知识覆盖完整，不是原文逐句详写；删除铺垫、重复案例、广告和无意义复述，重要限定与风险不丢。几个相关知识点合在一个模块，用短句、对照表、流程链承载，禁止每个食材、每个动作都拆成一页。优先讲清可操作结论，不靠塞满原文字数增加图片。
标题为# 总标题；每个模块以## 主要重点｜有信息量的标题 或 ## 次要重点｜有信息量的标题 开始。主要重点是全书核心框架、关键行动和决定性判断；次要重点是分类细项、补充方法、例子、边界和支撑知识。不是全部标为主要，也不能只留主要而丢掉有用次要内容。程序将主要做成两版共用图片；次要在精华版用文字/表格呈现，在完整版浓缩成图。每个模块内容必须独立可读，适合被组合到同主题图卡，图示建议用“图：”单行说明。
一般把冗长底稿压实为约四分之一到三分之一的表达量，这是编辑参考而非字数硬门槛；短稿不必强压。医学条件、数值单位和必要解释优先于篇幅。不要为了凑页数丢知识，也不要把完整等同于逐字保留。保留真实参考页标记与来源，不造事实。仅在发现实际疑点、前后矛盾或含义不明确时，在对应段落后写<!-- 待核：具体原句与疑问 -->；没有疑点不添加标注、不强制联网。已有尚未解决的待核标注在合并时保留，不假装已查证。
${KNOWLEDGE_MODULE_PRESENTATION_GUIDANCE}
${KNOWLEDGE_NARRATIVE_STYLE}`;

function batches(markdown:string) {
  const out:string[]=[];let rest=markdown;
  while(rest.length>24000){
    const cut=rest.lastIndexOf('\n\n',24000);
    const end=cut>12000?cut:24000;
    out.push(rest.slice(0,end));rest=rest.slice(end);
  }
  if(rest.trim())out.push(rest);
  return out;
}

/** 同一底稿只整理一次；两版由同一份模块确定性编译，恢复读取原回执。 */
export async function prepareKnowledgeCardEditions(params:{
  sourceMarkdown:string;evidence:KnowledgeRouteEvidence;abortSignal?:AbortSignal;
  onProgress?:(p:{doneBatches:number;totalBatches:number;pass:number})=>void|Promise<void>;
  invoke?:typeof invokeKnowledgePublicationRoutes;
  measure?:typeof measureKnowledgeBookletFromWorker;
}) {
  const {sourceMarkdown}=params;
  const evidence=guardKnowledgeEditionEvidence(params.evidence);
  if(!sourceMarkdown.trim())throw Error('缺少知识底稿，未启动整理');
  const inputDigest=createHash('sha256').update(sourceMarkdown).digest('hex');
  const prior=await evidence.read(`${evidence.prefix}/editions.json`);
  if(prior){if(prior.inputDigest!==inputDigest)throw Error('原稿版本变化，保留原回执');return prior.result;}
  const invoke=params.invoke||invokeKnowledgePublicationRoutes;
  const requestOne=async(body:string,index:number,stage:'modules'|'merge')=>{
    params.abortSignal?.throwIfAborted();
    const hash=createHash('sha256').update(`${inputDigest}/${stage}/${index}`).digest('hex');
    const id=`${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-8${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const request:KnowledgeModelRequest={executionChannel:index%2?'evolink':'openrouter',
      systemInstruction:{parts:[{text:KNOWLEDGE_EDITION_INSTRUCTIONS+(stage==='merge'?'\n本次输入已经分批提炼。只做跨批去重与主题归并，保留主要/次要知识的覆盖、条件与来源，不再次大幅删减。':'')}]},
      contents:[{role:'user',parts:[{text:JSON.stringify({sourceDigest:hash,source:{title:'图文知识手册',pages:[{id,headline:'知识模块整理',body,imageUrl:''}]}})}]}],
      generationConfig:{temperature:0.2,maxOutputTokens:KNOWLEDGE_UNCAPPED_OUTPUT_REQUEST,responseMimeType:'text/markdown'}};
    const prefix=`${evidence.prefix}/${stage}-${index}`;
    const old=await evidence.read(`${prefix}/request.json`);
    if(!old)await evidence.save(`${prefix}/request.json`,{request,inputDigest});
    if(old&&old.inputDigest!==inputDigest)throw Error('原稿版本变化，保留原任务');
    const response=await invoke(old?.request||request,{...evidence,prefix},params.abortSignal?{
      fetch:(url,init)=>fetch(url,{...init,signal:init?.signal?AbortSignal.any([init.signal,params.abortSignal!]):params.abortSignal}),
    }:{});
    params.abortSignal?.throwIfAborted();
    const report=JSON.parse(JSON.parse(response.text).candidates[0].content.parts[0].text);
    const result=String(report.pages?.[0]?.body||'').trim();
    if(!result)throw Error('本批没有返回知识模块，原稿和回执已保留');
    await evidence.save(`${prefix}/verification-candidates.json`,{inputDigest,triggers:knowledgeVerificationTriggers([{pageId:id,headline:"知识模块",term:"原文疑点",statement:result}]),stage:"等待全册整理后联网"});
    // Markdown解析已把待核注释移入cautions，向后续合并传递时还原内部标注。
    const questions=(report.pages?.[0]?.cautions||[]).filter((c:any)=>c.kind==='uncertain'&&c.message==='已标注疑点，等待全册整理后统一联网核实。').map((c:any)=>String(c.evidence).replace(/-->/g,'—'));
    return [result,...Array.from(new Set<string>(questions)).map(q=>`<!-- 待核：${q} -->`)].join('\n');
  };
  const safeRequest=async(body:string,index:number,stage:'modules'|'merge')=>{
    const key=`${evidence.prefix}/${stage}-${index}/page.json`;
    const saved=await evidence.read(key);
    if(saved&&saved.inputDigest!==inputDigest)throw Error('章节输入变化，保留原回执');
    if(saved?.status==='saved')return String(saved.body);
    await evidence.save(key,{inputDigest,original:body,body,status:'pending'});
    let output:string,issue:string|null=null;
    try{output=await requestOne(body,index,stage);}
    catch(error){
      params.abortSignal?.throwIfAborted();rethrowKnowledgeEditionInvariant(error);
      issue=knowledgeEditionErrorMessage(error);
      output=markKnowledgeEditionGap(body,`本段整理失败，保留原文，在末段依据原文补齐：${issue}`);
      if(isKnowledgeReceiptUnknown(error))output+='\n<!-- 回执待确认：原请求未闭合，不新增同内容请求 -->';
    }
    await evidence.save(key,{inputDigest,original:body,body:output,status:'saved',issue});
    return output;
  };
  const chunks=batches(sourceMarkdown),outputs:string[]=new Array(chunks.length);let done=0;
  const settled=await Promise.allSettled(Array.from({length:Math.min(10,chunks.length)},async(_,worker)=>{
    for(let i=worker;i<chunks.length;i+=Math.min(10,chunks.length)){
      outputs[i]=await safeRequest(chunks[i],i,'modules');
      await params.onProgress?.({doneBatches:++done,totalBatches:chunks.length,pass:1});
    }
  }));
  const failed=settled.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failed)throw failed.reason;
  // 合并容量以内统一去重；超大书按有界组归并，不无限串行缩稿、不强制固定页数。
  const combined=outputs.join('\n\n'),groups=batches(combined);
  const merged:string[]=new Array(groups.length);
  if(chunks.length===1)merged[0]=outputs[0];
  else {
    let mergedDone=0;
    const results=await Promise.allSettled(Array.from({length:Math.min(10,groups.length)},async(_,worker)=>{
      for(let i=worker;i<groups.length;i+=Math.min(10,groups.length)){
        merged[i]=await safeRequest(groups[i],i,'merge');
        await params.onProgress?.({doneBatches:++mergedDone,totalBatches:groups.length,pass:2});
      }
    }));
    const failure=results.find((r):r is PromiseRejectedResult=>r.status==='rejected');if(failure)throw failure.reason;
  }
  const finalInvoke:typeof invokeKnowledgePublicationRoutes=async(request,scope)=>{
    params.abortSignal?.throwIfAborted();
    const result=await invoke(request,scope,params.abortSignal?{fetch:(url,init)=>fetch(url,{...init,signal:init?.signal?AbortSignal.any([init.signal,params.abortSignal!]):params.abortSignal})}:{});
    params.abortSignal?.throwIfAborted();return result;
  };
  const finalPages=merged.flatMap(body=>{
    const parsed=knowledgeModulesFromMarkdown(body);
    const unknown=/<!-- 回执待确认：/.test(body)?'\n<!-- 回执待确认：原请求未闭合，不新增同内容请求 -->':'';
    return parsed.modules.map(module=>`# ${parsed.title}\n\n## ${module.priority==='primary'?'主要重点':'次要重点'}｜${module.headline}\n\n${module.body}${unknown}`);
  });
  const verified=await verifyKnowledgeEditionManuscripts(finalPages,{...evidence,prefix:`${evidence.prefix}/final-verification`},finalInvoke,params.onProgress);
  const parsed=verified.map(knowledgeModulesFromMarkdown);
  // 只去除逐字相同的模块，不能用模糊标题匹配吞掉不同条件。
  const modules=Array.from(new Map(parsed.flatMap(p=>p.modules).map(m=>[JSON.stringify(m),m])).values());
  const editions=compileKnowledgeEditions(parsed[0]?.title||'图文知识手册',modules);
  // 正式分页检查点：两档原稿先保存，再逐个实际图片页及文字章节保存。
  // 这里的图片页是实际出图分页；文字物理页仍由正式Booklet/PDF渲染器测量。
  const verification=await evidence.read(`${evidence.prefix}/final-verification/verified.json`);
  const issues=[...(verification?.issues||[])];
  const editionPageCounts:Record<string,{imagePages:number|null;readingPages:number|null}>={};
  for(const [level,markdown] of [['full',editions.full],['concise',editions.concise]] as const){
    await evidence.save(`${evidence.prefix}/pages/${level}/manuscript.json`,{inputDigest,markdown});
    const parts=knowledgeEditionParts(markdown)!;
    editionPageCounts[level]={imagePages:null,readingPages:null};
    for(const [index,module] of Array.from(parts.modules.entries()))
      await evidence.save(`${evidence.prefix}/pages/${level}/chapters/${index}.json`,{inputDigest,...module,status:hasKnowledgeBody(module.body)?'saved':'pending_content'});
    try{
      const plan=planKnowledgeCardPages(markdown,'deepseek-v4.1-flash-1017');
      editionPageCounts[level].imagePages=plan.pageCount;
      for(const [index,body] of Array.from(plan.pages.entries()))await evidence.save(`${evidence.prefix}/pages/${level}/images/${index}.json`,{inputDigest,pageIndex:index,body,status:'saved'});
    }catch(error){rethrowKnowledgeEditionInvariant(error);issues.push({kind:'pagination',message:knowledgeEditionErrorMessage(error),level});}
    try{
      const text=parts.modules.filter(m=>m.medium==='text');
      const html=text.length?buildKnowledgeBookletHtml({title:parts.title,pages:text.map(m=>({...m,imageUrl:''}))}):'';
      await evidence.save(`${evidence.prefix}/pages/${level}/reading-layout.json`,{inputDigest,html});
      const readingPages=html?await (params.measure||measureKnowledgeBookletFromWorker)(html):0;
      editionPageCounts[level].readingPages=readingPages;
      await evidence.save(`${evidence.prefix}/pages/${level}/counts.json`,{inputDigest,...editionPageCounts[level]});
    }catch(error){rethrowKnowledgeEditionInvariant(error);issues.push({kind:'pagination',message:knowledgeEditionErrorMessage(error),level});}
  }
  const result={markdown:editions.concise,fullEditionMarkdown:editions.full,sections:modules.length,
    targetSections:modules.length,passes:chunks.length>1?2:1,editionVersion:2,verificationProcessed:verification?.complete!==false&&issues.length===0,editionIssues:issues,editionPageCounts,
    unclassifiedModules:modules.filter(m=>m.priority==='secondary').length};
  await evidence.save(`${evidence.prefix}/editions.json`,{inputDigest,original:sourceMarkdown,modules,result});
  return result;
}
