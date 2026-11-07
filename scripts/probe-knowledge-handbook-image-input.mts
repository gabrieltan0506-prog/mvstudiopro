/** 只读预检：从本次已核实新稿编译原生成器的实际输入，不提交图片或写业务任务。 */
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {getJobByIdStrict} from '../server/jobs/repository';
import {quoteKnowledgeCard} from '../server/services/knowledgeCardPricing';
import {buildSinglePageKnowledgeCardImagePrompt,resolveKnowledgeCardPageSource} from '../server/services/geminiPlatformCompositeTranslation';
import {resolveKnowledgeCardReferencePageUrls} from '../server/services/knowledgeCardDocumentPages';
import {planKnowledgeCardPages,KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS} from '../shared/knowledgeCardPagination';
import {knowledgeEditionParts} from '../shared/knowledgeCardEdition';
import {assertWorkerProbeLease} from '../server/services/workerProbeLease';

if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('仅本次隔离工作机');
await assertWorkerProbeLease();
const config=JSON.parse(await readFile(process.argv[2],'utf8'));
const job=await getJobByIdStrict(config.sourceJobId);
if(!job||String(job.userId)!==String(config.owner)||job.status!=='succeeded')throw Error('新稿所有者不符');
const result=JSON.parse(await readFile(join(config.resultRoot,'result.json'),'utf8'));
if(!result.verificationProcessed||result.editionIssues?.length)throw Error('本次新稿未通过末稿门禁，禁止编译付费输入');
const status=JSON.parse(await readFile(join(config.resultRoot,'status.json'),'utf8'));
if(status.status!=='returned'||status.newRequests!==config.expectedNewRequests)throw Error('本次恢复状态或实际请求数不符');
await mkdir(config.outputRoot,{recursive:true});
const editions:Record<string,unknown>={};
for(const level of ['full','concise'] as const){
 const markdown=level==='full'?result.fullEditionMarkdown:result.markdown;
 if(!markdown||markdown.length>KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS)throw Error('全文超出接口容量，不能截断');
 const parts=knowledgeEditionParts(markdown);if(!parts||parts.level!==level)throw Error('两档身份不符');
 const plan=planKnowledgeCardPages(markdown,'glm-5.3-flashx'),quote=await quoteKnowledgeCard(Number(config.owner),markdown,'glm-5.3-flashx');
 if(quote.pageCount!==plan.pageCount||plan.pages.some(p=>!p.trim()||p.length>1200))throw Error('真实分页与报价不一致');
 const pages:any[]=new Array(plan.pageCount);let next=0;
 await Promise.all(Array.from({length:4},async()=>{while(next<plan.pageCount){const index=next++;
  const paging={notePageIndex:index+1,notePageTotal:plan.pageCount,subjectPosition:'center',infographicTemplateId:'fusion_ink_mountains'};
  const slice=resolveKnowledgeCardPageSource(markdown,paging).source;
  const refs=await resolveKnowledgeCardReferencePageUrls({userId:Number(config.owner),pageText:slice,fullMarkdown:markdown});
  const prompt=buildSinglePageKnowledgeCardImagePrompt(markdown,{...paging,referencePageCount:refs.length});
  if(!prompt.includes('水墨山峦融合')||prompt.includes('〔参考原页'))throw Error('模板或参考标记消费异常');
  pages[index]={pageIndex:index+1,chars:slice.length,body:slice,referencePages:refs.map(({docKey,pageNumber})=>({docKey,pageNumber})),prompt,sha256:createHash('sha256').update(prompt).digest('hex')};
 }}));
 const input={level,title:parts.title,manuscriptSha256:createHash('sha256').update(markdown).digest('hex'),manuscriptChars:markdown.length,model:'gpt-image-2.6-sunburst',variant:'sunburst',quality:'high',resolution:'4K',size:'3840x2160',subjectPosition:'center',infographicTemplateId:'fusion_ink_mountains',quote,pages};
 editions[level]={...input,pages:pages.map(({prompt,body,...page})=>page)};
 await writeFile(join(config.outputRoot,level+'-image-input.json'),JSON.stringify(input,null,2));
 await writeFile(join(config.outputRoot,level+'-prompts.md'),`# ${level==='full'?'完整版':'精华版'}逐页生图输入\n\nSunburst 2.6 / 4K / high / 水墨山峦融合 / 主体居中\n\n${plan.pageCount}张，产品报价${quote.credits}积分，实际供应商费用另按回执记录。\n\n`+pages.map(p=>`## 第${p.pageIndex}页 · ${p.chars}字符 · ${p.referencePages.length}张原页参考\n\n${p.prompt}`).join('\n\n'));
}
await writeFile(join(config.outputRoot,'preflight.json'),JSON.stringify({at:new Date().toISOString(),sourceJobId:job.id,resultRoot:config.resultRoot,editions},null,2));
console.log(JSON.stringify({status:'prepared',editions:Object.fromEntries(Object.entries(editions).map(([k,v]:[string,any])=>[k,{pageCount:v.quote.pageCount,credits:v.quote.credits,manuscriptChars:v.manuscriptChars,referenceCounts:v.pages.map((p:any)=>p.referencePages.length)}]))}));
