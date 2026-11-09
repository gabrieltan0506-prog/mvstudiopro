/**
 * 新书隔离探针（2026-11-08 用户授权）：只用本分支正式代码从原 EPUB 走完整产品链。
 * prepare：原档入本人上传区 → 正式读档/两档任务（本机持有，避免线上旧版本领走）→ 用正式生成器编译逐页生图输入与报价，
 *          停在“等待用户确认生图输入与费用”，不提交任何图片。
 * run：仅在 config.confirmed=true 且页数/报价/稿件指纹与已展示输入一致时，经正式路由生图并挂载正式出版组件审校、排版、导出。
 * 探针不改写正文、不补回执、不改任务状态；失败如实记录，由修正式代码后重跑。
 */
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
const path_join=path.join;
import {randomUUID,createHash} from 'node:crypto';
import express from 'express';
import {createExpressMiddleware} from '@trpc/server/adapters/express';
import puppeteer from 'puppeteer';
import {eq} from 'drizzle-orm';
import {appRouter} from '../server/routers';
import {createContext} from '../server/_core/context';
import {sdk} from '../server/_core/sdk';
import {registerManhuaAdvisorStream} from '../server/routers/manhuaAdvisorStream';
import {getDb} from '../server/db';
import {users,jobs} from '../drizzle/schema';
import {runClaimedJob} from '../server/jobs/runner';
import {getJobByIdStrict} from '../server/jobs/repository';
import {knowledgeCardPageJobId} from '../server/jobs/knowledgeCardPageTask';
import {assertWorkerProbeLease} from '../server/services/workerProbeLease';
import {downloadGcsObjectVersioned,getGcsBucketName,uploadBufferToGcs} from '../server/services/gcs';
import {nameKnowledgeEditionTopics} from '../server/services/knowledgeTopicTitles';
import {quoteKnowledgeCard} from '../server/services/knowledgeCardPricing';
import {buildSinglePageKnowledgeCardImagePrompt,resolveKnowledgeCardPageSource} from '../server/services/geminiPlatformCompositeTranslation';
import {resolveKnowledgeCardReferencePageUrls} from '../server/services/knowledgeCardDocumentPages';
import {synchronizedKnowledgeCardSource} from '../shared/knowledgeCardEditableLayout';
import {layoutFromSource,layoutLibrarySchema} from '../shared/editableLayout';
import {knowledgeCardCreditsForPageIndex,knowledgeEditionImageChars,knowledgeEditionImagePlan,planKnowledgeCardPages} from '../shared/knowledgeCardPagination';
import {auditKnowledgeTopicTitles,readKnowledgeTopicTitles} from '../shared/knowledgeTopicImagePlan';
import {KNOWLEDGE_IMAGE_CHANNEL_MAX,knowledgeStageConcurrency} from '../shared/knowledgeConcurrency';
import {knowledgeEditionParts} from '../shared/knowledgeCardEdition';
import {knowledgeEditionBudgetCheck,KNOWLEDGE_LEAD_PAGE_CHARS} from '../shared/knowledgeEditionBudget';
import {getGraphicNoteFusionTemplate} from '../shared/graphicNoteFusionTemplates';
import {KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS} from '../shared/knowledgeCardDistillModels';
import {COOKIE_NAME} from '../shared/const';

if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('只能在已授权工作机执行');
await assertWorkerProbeLease();
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const mode=process.argv[3]||'prepare';
const root=path.dirname(process.argv[2]);
const write=(name:string,value:unknown)=>fs.writeFile(path.join(root,name),JSON.stringify({at:new Date().toISOString(),...(value as object)}));
const scrub=(s:unknown)=>String(s).replace(/(?:https?|gs):\/\/[^\s"']+/g,'[地址]').slice(0,600);
const level=config.level as 'full'|'concise';
if(!['full','concise'].includes(level))throw Error('档位无效');
const template=getGraphicNoteFusionTemplate(config.template);
if(!template)throw Error('模板不存在');
const distillModel=KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS.find(o=>o.id===config.distillModel)?.id;
if(!distillModel)throw Error('必须显式选择读档模型');
for(const key of ['distillRequestId','deriveRequestId'])if(!/^[0-9a-f-]{36}$/.test(config[key]||''))throw Error(`缺少${key}`);

const db=await getDb();if(!db)throw Error('数据库不可用');
const ownerJob=await getJobByIdStrict(config.ownerJobId);if(!ownerJob)throw Error('缺少所有者证据任务');
const [user]=await db.select().from(users).where(eq(users.id,Number(ownerJob.userId))).limit(1);
if(!user)throw Error('所有者不存在');
const owner=String(user.id);
const caller=appRouter.createCaller({req:{headers:{}},res:{},user,clientDisconnected:new AbortController().signal} as any);
const ids={distill:knowledgeCardPageJobId(owner,'knowledge_card_distill',config.distillRequestId),derive:knowledgeCardPageJobId(owner,'knowledge_card_derive_level',config.deriveRequestId)};

/** 与线上一致的任务行与 runner；由本机直接持有执行，失败不让线上旧版本领走重跑。 */
async function execute(id:string,action:string,params:Record<string,unknown>){
  const existing=await getJobByIdStrict(id);
  if(existing){
    if(existing.status==='succeeded')return existing.output as Record<string,any>;
    throw Error(`原任务${id}状态${existing.status}，只查询，不重新提交`);
  }
  await db!.insert(jobs).values({id,userId:owner,type:'platform',provider:'evolink',status:'running',attempts:1,input:{action,params}});
  const job=await getJobByIdStrict(id);if(!job)throw Error('任务未持久化');
  await runClaimedJob({...job,attempts:Math.max(2,job.attempts||0)});
  const done=await getJobByIdStrict(id);
  if(done?.status!=='succeeded')throw Error(`正式任务未成功：${scrub(done?.error||done?.status)}`);
  return done.output as Record<string,any>;
}

/**
 * 主题命题补缺：派生任务回执一经成功即固定，命题若有批次失败（1108g2：GLM 截断只回 6/16 页）不会随任务重跑。
 * 这里用与派生任务相同的证据前缀再调一次命题服务：已成功批次零调用回放，只对失败批次重试（有上限），
 * 原始/解析回包永久保存在原前缀下。prepare 与 run 都走同一函数，稿件指纹由此保持一致。
 */
async function retitle(markdown:string,model:string|undefined){
  const prefix=`knowledge-editions/user-${owner}/${ids.derive}`;
  const result=await nameKnowledgeEditionTopics({markdown,model,evidence:{prefix,
    read:async key=>{try{return JSON.parse((await downloadGcsObjectVersioned({gcsUri:`gs://${getGcsBucketName()}/${key}`})).buffer.toString());}catch(error){if((error as Error).message==='gcs_stat_failed:404')return null;throw error;}},
    save:async(key,value)=>{await uploadBufferToGcs({objectName:key,buffer:Buffer.from(JSON.stringify(value)),contentType:'application/json'});}}});
  await fs.appendFile(path.join(root,'titles.log'),JSON.stringify({at:new Date().toISOString(),status:result.status,message:result.message?scrub(result.message):undefined})+'\n');
  return result;
}

async function prepare(){
  // 与网站直传相同的本人上传前缀；内容寻址，重复上传同一对象。
  // 原档已在本人上传区时（1108g2 已上传），只核对云端对象指纹，不再要求本机密文输入。
  const objectName=`uploads/u${owner}/knowledge-card/${config.sourceSha256}.epub`;
  const gcsUri=`gs://${getGcsBucketName()}/${objectName}`;
  let buffer:Buffer;
  if(existsSync(path.join(root,config.localSource))){
    buffer=await fs.readFile(path.join(root,config.localSource));
    if(createHash('sha256').update(buffer).digest('hex')!==config.sourceSha256)throw Error('原档指纹不符');
    await uploadBufferToGcs({objectName,buffer,contentType:'application/epub+zip'});
  }else{
    buffer=(await downloadGcsObjectVersioned({gcsUri})).buffer;
    if(createHash('sha256').update(buffer).digest('hex')!==config.sourceSha256)throw Error('云端原档指纹不符');
  }
  await write('live.json',{stage:'distilling',ids,sourceBytes:buffer.length});
  const extracted=await execute(ids.distill,'knowledge_card_distill',{files:[{gcsUri,mimeType:'application/epub+zip',fileName:config.fileName}],distillModel,detailLevel:'full',billingPolicy:'interior-pages-v1',chargeDistillFee:false});
  await write('live.json',{stage:'editions',ids});
  const derived=await execute(ids.derive,'knowledge_card_derive_level',{fullMarkdown:extracted.distilledMarkdown,distillModel:extracted.distillModel||distillModel,editionVersion:2});
  if(!derived.verificationProcessed)throw Error(`两档末稿门禁未通过：${scrub(JSON.stringify(derived.editionIssues||[]))}`);
  const titled=await retitle(String(level==='full'?derived.fullEditionMarkdown:derived.distilledMarkdown),derived.distillModel||distillModel);
  const markdown=titled.markdown;
  const parts=knowledgeEditionParts(markdown);if(!parts||parts.level!==level)throw Error('档位身份不符');
  const plan=planKnowledgeCardPages(markdown,distillModel),quote=await quoteKnowledgeCard(Number(owner),markdown,distillModel);
  if(quote.pageCount!==plan.pageCount)throw Error('分页与报价不一致');
  const topics=knowledgeEditionImagePlan(markdown)!;
  const budget=knowledgeEditionBudgetCheck(level,plan.pageCount,topics.readingChars,knowledgeEditionImageChars(topics));
  // 正式生成器逐页编译实际输入（并发），供用户确认；不提交图片。
  const pages:any[]=new Array(plan.pageCount);let next=0;
  await Promise.all(Array.from({length:6},async()=>{while(next<plan.pageCount){const index=next++;
    const paging={notePageIndex:index+1,notePageTotal:plan.pageCount,subjectPosition:'center' as const,infographicTemplateId:template!.id};
    const slice=resolveKnowledgeCardPageSource(markdown,paging).source;
    const refs=await resolveKnowledgeCardReferencePageUrls({userId:Number(owner),pageText:slice,fullMarkdown:markdown});
    const prompt=buildSinglePageKnowledgeCardImagePrompt(markdown,{...paging,referencePageCount:refs.length});
    if(!prompt.includes(template!.labelZh)||prompt.includes('〔参考原页')){
      const marker=prompt.match(/〔参考原页[^〕\n]{0,80}〕?/)?.[0]||'';
      await fs.appendFile(path.join(root,'preview-issues.log'),JSON.stringify({page:index+1,hasTemplate:prompt.includes(template!.labelZh),marker,sliceMarker:slice.match(/〔参考原页[^〕\n]{0,80}〕?/)?.[0]||''})+'\n');
      throw Error(`第${index+1}页生图输入异常：${prompt.includes(template!.labelZh)?'参考原页标记未剥离':'模板未注入'}`);
    }
    const topic=topics.images[index]!;
    if(topic.body!==slice)throw Error(`第${index+1}页主题图切片与规划不一致`);
    pages[index]={pageIndex:index+1,chars:slice.length,visibleChars:slice.replace(/\s+/g,'').length,sections:topic.headlines.length,imageTitle:topic.title,readingTitle:topic.readingTitle,overflowChars:topic.overflow.replace(/\s+/g,'').length,body:slice,referencePages:refs.length,prompt};
  }}));
  const manuscriptSha256=createHash('sha256').update(markdown).digest('hex');
  await fs.writeFile(path.join(root,'image-preview.md'),`# ${parts.title} · ${level==='full'?'完整版':'精华版'}逐页生图输入\n\n模板：${template.labelZh}；主体居中；${plan.pageCount}张，产品报价${quote.credits}积分。\n\n出图规则：每张图为一个主题的核心图解，图内≤1200字；图数按主题定（完整版≤16、精华版≤8）。${level==='full'?`完整版图文同页：每图一页、图下带该图内文（每图≤${KNOWLEDGE_LEAD_PAGE_CHARS}字），不排独立内文页，总页数=图数；内文装不下时在准备阶段压缩，不排续页。`:'精华版图外细节全部进内文（图在上、内文在下及续页）。'}\n\n页数预算：图文同页${budget.budget.imagePages}页 · 独立内文${budget.plannedTextPages}页 · 合计${budget.plannedTotalPages}页；内文资料约${topics.readingChars}字${budget.compression?`；图下合计可容${budget.compression.readingCapacityChars}字，需压缩到${budget.compression.targetReadingChars}字（${Math.round(budget.compression.ratio*100)}%）；不压缩需${budget.compression.imagesForNoLoss}张图（上限${budget.compression.imageCap}）`:''}\n${budget.warnings.map(w=>`- ${w}`).join('\n')}\n\n`+pages.map(p=>`## 第${p.pageIndex}页 · ${p.chars}字（不含空白${p.visibleChars}字）· 含${p.sections}节 · 图外细节${p.overflowChars}字进内文 · 参考原页${p.referencePages}张\n\n图片标题：${p.imageTitle}；图下内文标题：${p.readingTitle}\n\n### 图内文字\n\n${p.body}\n\n### 实际生图指令\n\n\`\`\`\n${p.prompt}\n\`\`\``).join('\n\n'));
  await fs.writeFile(path.join(root,'editions.json'),JSON.stringify({full:derived.fullEditionMarkdown,concise:derived.distilledMarkdown,counts:derived.editionPageCounts,issues:derived.editionIssues,pending:derived.editionPendingVerification}));
  const titleAudit=auditKnowledgeTopicTitles(topics.images,readKnowledgeTopicTitles(markdown));
  const prepared={ids,title:parts.title,level,template:template.id,pageCount:plan.pageCount,credits:quote.credits,manuscriptSha256,readingChars:topics.readingChars,imageChars:pages.map(p=>p.chars),budget:{plannedTextPages:budget.plannedTextPages,estimatedTextPages:budget.estimatedTextPages,textPages:budget.budget.textPages,totalPages:budget.budget.totalPages,plannedTotalPages:budget.plannedTotalPages,compression:budget.compression,warnings:budget.warnings},sections:pages.map(p=>p.sections),overflowChars:pages.map(p=>p.overflowChars),titleAudit,titles:{status:titled.status,message:titled.message?scrub(titled.message):undefined}};
  // 开发者自用 autoConfirm：只在本探针内把准备与出图接成一步（应用内计费与用户确认不变）；命题核查不通过则停在出图前，不提交图片。
  if(config.autoConfirm===true){
    if(!titleAudit.ok){await write('live.json',{...prepared,stage:'failed',mode:'prepare',error:'主题命题核查未通过，未出图'});process.exitCode=1;return;}
    Object.assign(config,{confirmed:true,confirmedPageCount:plan.pageCount,confirmedCredits:quote.credits,confirmedManuscriptSha256:manuscriptSha256});
    await write('live.json',{...prepared,stage:'auto_confirmed'});
    await write('prepared.json',prepared);
    return run();
  }
  await write('live.json',{...prepared,stage:'awaiting_image_confirmation'});
}

async function run(){
  const derived=await getJobByIdStrict(ids.derive),out:any=derived?.output;
  if(!derived||derived.status!=='succeeded'||!out?.verificationProcessed)throw Error('两档任务尚未成功');
  // 与 prepare 同一命题补缺（已存回执零调用回放）；若稿件指纹变化由下方核对拦下，需重新 prepare 确认。
  const markdown=(await retitle(String(level==='full'?out.fullEditionMarkdown:out.distilledMarkdown),out.distillModel)).markdown;
  const digest=createHash('sha256').update(markdown).digest('hex');
  const quote=await caller.mvAnalysis.quoteKnowledgeCardForGeneration({markdown,distillModel:out.distillModel});
  if(config.confirmed!==true)throw Error('用户尚未确认本次生图输入与费用');
  if(quote.pageCount!==config.confirmedPageCount||quote.credits!==config.confirmedCredits||digest!==config.confirmedManuscriptSha256)throw Error('当前稿件/页数/报价与已确认输入不符');
  const statePath=path.join(root,'state.json');
  let state:any=existsSync(statePath)?JSON.parse(await fs.readFile(statePath,'utf8')):null;
  if(state&&state.digest!==digest)throw Error('续接稿件指纹不符');
  if(!state){
    const requestIds=Array.from({length:quote.pageCount},()=>randomUUID());
    state={digest,requestIds,imageJobIds:requestIds.map(id=>knowledgeCardPageJobId(owner,'platform_composite_sheet_progress',id)),createdAt:new Date().toISOString()};
    await fs.writeFile(statePath,JSON.stringify(state));
  }
  if(!state.documentId){
    const source=synchronizedKnowledgeCardSource({owner,sourceId:`knowledge-card:${ids.derive}:${level}`,fullMarkdown:level==='full'?markdown:out.fullEditionMarkdown,illustrationMarkdown:markdown,detailLevel:level,distillModel:out.distillModel,infographicTemplateId:template!.id,imageJobIds:state.imageJobIds});
    source.verificationJobId=ids.derive;
    const doc=layoutFromSource(source);
    doc.publication!.synchronizedStarted=true;
    if(doc.publication!.billing)doc.publication!.billing.confirmed=true;
    doc.publication!.automaticLayout={requestId:randomUUID(),maxCredits:0};
    const latest=await caller.editableLayout.get();
    const library=latest.library||{version:1,owner,documents:[]};
    await caller.editableLayout.save({library:layoutLibrarySchema.parse({...library,documents:[...library.documents,doc]}),expectedGeneration:latest.generation});
    state.documentId=doc.id;await fs.writeFile(statePath,JSON.stringify(state));
  }
  // run：首次启动；resume：工作机重启/部署打断后接续同一 state.json——已成功的图直接复用（不重付）、在途的只轮询、
  // 已失败的只报不重购、从未提交的（无任务记录）才提交；请求号与任务号不变，服务端预留按同号幂等。
  const started=existsSync(path.join(root,'started.json'));
  if(started&&mode!=='resume')throw Error('本次已启动，只查询，禁止重复提交；接续请用 resume 模式');
  if(!started)await write('started.json',{documentId:state.documentId});
  else{
    const resumes=existsSync(path.join(root,'resumed.json'))?JSON.parse(await fs.readFile(path.join(root,'resumed.json'),'utf8')).count||0:0;
    const jobs=await Promise.all(state.imageJobIds.map(async(id:string)=>({id,status:(await getJobByIdStrict(id))?.status||'missing'})));
    await write('resumed.json',{count:resumes+1,documentId:state.documentId,jobs});
    if(jobs.some(j=>j.status==='failed'))throw Error(`接续前发现${jobs.filter(j=>j.status==='failed').length}张图已失败，不自动重购；请按补图流程处理：${jobs.filter(j=>j.status==='failed').map(j=>j.id).join(',')}`);
  }
  const total=quote.pageCount;
  const app=express();app.use(express.json({limit:'30mb'}));
  app.use('/api/trpc',createExpressMiddleware({router:appRouter,createContext,onError:({path,error})=>{void fs.appendFile(path_join(root,'server-errors.log'),`${new Date().toISOString()} ${path} ${error.code} ${String(error.message).slice(0,500)}${error.cause?` ← ${String((error.cause as Error).message||error.cause).slice(0,500)}`:''}\n`);}}));
  registerManhuaAdvisorStream(app);
  app.get('/api/jobs/:id',async(req,res)=>{const c=await createContext({req,res,info:undefined as never});const job=await getJobByIdStrict(req.params.id);if(!c.user||!job||String(job.userId)!==String(c.user.id)){res.status(404).json({message:'任务不可用'});return;}res.json(job);});
  app.get('/bootstrap',async(req,res)=>{const c=await createContext({req,res,info:undefined as never});if(c.user?.id!==user.id){res.sendStatus(401);return;}res.json({documentId:state.documentId});});
  app.post('/client-progress',async(req,res)=>{await write('client-progress.json',req.body);res.json({ok:true});});
  app.get('/panel.js',(_q,r)=>r.sendFile(path.join(root,'panel.js')));
  app.get('/',(_q,r)=>r.type('html').send('<html><body><div id="root"></div><script src="/panel.js"></script></body></html>'));
  const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
  const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
  await page.setCookie({name:COOKIE_NAME,value:await sdk.createSessionToken(user.openId,{expiresInMs:8*3600000}),url:base,httpOnly:true});
  page.on('response',async response=>{if(response.url().includes('editableLayout.exportPublication')){try{await fs.writeFile(path.join(root,'export-response.json'),await response.text());}catch{}}});
  page.on('dialog',d=>{void d.accept();});
page.on('console',m=>{const t=m.text();if(t.includes('[knowledgePublication]'))void fs.appendFile(path.join(root,'ui-errors.log'),new Date().toISOString()+' '+t.slice(0,1200)+'\n');});
  page.on('pageerror',e=>{void fs.appendFile(path.join(root,'ui-errors.log'),scrub(e)+'\n');});
  // 与正式页面一致：图片任务与章节审校并发，就绪的图先进入审校。
  await page.goto(base,{waitUntil:'domcontentloaded'});
  let next=0,done=0,failed=false;const errors:any[]=[];
  await write('live.json',{stage:'images_and_interior',documentId:state.documentId,done,total});
  // 与正式页面一致：全部页同时在途（官方/EvoLink 按路序交替），不再固定 4 路。
  const workers=Array.from({length:knowledgeStageConcurrency(total,{max:KNOWLEDGE_IMAGE_CHANNEL_MAX.openai+KNOWLEDGE_IMAGE_CHANNEL_MAX.evolink})},(_,lane)=>(async()=>{
    while(!failed&&next<total){const i=next++;const id=state.imageJobIds[i];
      try{
        if(!await getJobByIdStrict(id))await caller.mvAnalysis.generatePlatformCompositeSheet({sceneId:`handbook-${level}-${state.requestIds[i]}`,pageRequestId:state.requestIds[i],progressJobId:id,title:'图文知识手册',scriptContext:markdown,kind:'single_page_knowledge_card',notePageIndex:i+1,notePageTotal:total,distillModel:out.distillModel,confirmedPageCredits:knowledgeCardCreditsForPageIndex(i+1,quote.billingModel),subjectPosition:'center',infographicTemplateId:template!.id,imageProvider:lane%2===0?'openai':'evolink',openaiImageVariant:'sunburst',imagePromptTranslator:'gpt54',enabledSkillIds:[],allowBloggerTitle:false} as any);
        for(;;){const job=await getJobByIdStrict(id);if(job?.status==='succeeded')break;if(job?.status==='failed')throw Error(job.error||'图片任务失败');await new Promise(r=>setTimeout(r,5000));}
        done++;await write('live.json',{stage:'images_and_interior',documentId:state.documentId,done,total});
      }catch(error){failed=true;errors.push({page:i+1,message:scrub((error as Error).message)});}
    }
  })());
  await Promise.allSettled(workers);
  let final:any;
  if(failed)final={stage:'image_failed',errors};
  else for(let reloads=0;;){
    let progress:any;
    try{progress=await page.evaluate(()=>({finished:(window as any).__handbookFinished,error:(window as any).__handbookError}));}
    catch(error){
      // 页面框架被拆（重载/部署）时重新打开同一文档的正式面板，由正式代码按回执续接；最多三次，不另起新单。
      if(reloads>=3||!/detached Frame|Execution context was destroyed|Target closed|Session closed/i.test(String((error as Error).message)))throw error;
      reloads++;await fs.appendFile(path.join(root,'ui-errors.log'),`${new Date().toISOString()} 页面重开第${reloads}次：${scrub((error as Error).message)}\n`);
      await page.goto(base,{waitUntil:'domcontentloaded'}).catch(()=>{});await new Promise(r=>setTimeout(r,5000));continue;
    }
    if(progress.finished){final={stage:'pdf_returned',result:progress.finished};break;}
    if(progress.error){final={stage:'publication_failed',error:scrub(progress.error)};break;}
    await write('live.json',{stage:'interior_layout_pdf',documentId:state.documentId,done,total});
    await new Promise(r=>setTimeout(r,10000));
  }
  await page.screenshot({path:path.join(root,'ui-final.png'),fullPage:true}).catch(()=>{});
  await browser.close();server.close();
  const totalPages=Number(final.result?.totalPages)||null,imagePages=Number(final.result?.imagePages)||null;
  await write('live.json',{...final,documentId:state.documentId,summary:totalPages?{totalPages,imagePages,readingPages:totalPages-(imagePages||0)}:null});
  if(final.stage!=='pdf_returned')process.exitCode=1;
}

try{ if(mode==='prepare')await prepare(); else if(mode==='run'||mode==='resume')await run(); else throw Error('模式无效'); }
catch(error){ await write('live.json',{stage:'failed',mode,error:scrub((error as Error).message)}); process.exitCode=1; }
