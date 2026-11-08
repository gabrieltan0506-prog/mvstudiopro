/** 本次已授权接续：只调用正式路由及正式出版组件，不调用上游媒体服务。 */
import fs from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';
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
import {users} from '../drizzle/schema';
import {getJobByIdStrict} from '../server/jobs/repository';
import {knowledgeCardPageJobId} from '../server/jobs/knowledgeCardPageTask';
import {assertWorkerProbeLease} from '../server/services/workerProbeLease';
import {synchronizedKnowledgeCardSource} from '../shared/knowledgeCardEditableLayout';
import {layoutFromSource,layoutLibrarySchema} from '../shared/editableLayout';
import {knowledgeCardCreditsForPageIndex,planKnowledgeCardPages} from '../shared/knowledgeCardPagination';
import {COOKIE_NAME} from '../shared/const';

if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('只能在已授权工作机执行');
await assertWorkerProbeLease();
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const root=config.outputRoot,mode=process.argv[3]||'prepare';
const sourceId=config.sourceJobId;
if(!['full','concise'].includes(config.level)||config.variant!=='sunburst'||config.template!=='fusion_ink_mountains')throw Error('本次明确批准的档位/模型/模板不符');
const original=await getJobByIdStrict(sourceId),out:any=original?.output;
if(!original||original.status!=='succeeded'||!out?.verificationProcessed||!out.fullEditionMarkdown)throw Error('正式完整版回执尚未就绪');
const db=await getDb();if(!db)throw Error('数据库不可用');
const [user]=await db.select().from(users).where(eq(users.id,Number(original.userId))).limit(1);
if(!user)throw Error('原任务所有者不存在');
const ctx:any={req:{headers:{}},res:{},user,clientDisconnected:new AbortController().signal};
const caller=appRouter.createCaller(ctx);
const markdown=String(config.level==='full'?out.fullEditionMarkdown:out.distilledMarkdown),digest=createHash('sha256').update(markdown).digest('hex');
const quote=await caller.mvAnalysis.quoteKnowledgeCardForGeneration({markdown,distillModel:out.distillModel});
const total=quote.pageCount;
if(total!==config.confirmedPageCount||digest!==config.confirmedManuscriptSha256)throw Error('当前稿件与已展示生图输入不符');
if(mode!=='prepare'&&quote.credits!==config.confirmedCredits)throw Error('报价与本次确认范围不符');
if(mode!=='prepare'&&config.confirmed!==true)throw Error('尚未确认本次具体输入范围，禁止提交');
await fs.mkdir(root,{recursive:true});
const file=path.join(root,'continuation.json');
let state:any=existsSync(file)?JSON.parse(await fs.readFile(file,'utf8')):null;
if(state&&(state.sourceJobId!==sourceId||state.digest!==digest))throw Error('续接稿件指纹不符');
if(state&&state.variant!=='sunburst')throw Error('本次仅允许用户指定的Sunburst，拒绝默认或旧Flare配置');
if(!state){
 const requestIds=Array.from({length:total},()=>randomUUID());
 state={sourceJobId:sourceId,digest,requestIds,imageJobIds:requestIds.map(id=>knowledgeCardPageJobId(String(user.id),'platform_composite_sheet_progress',id)),variant:'sunburst',level:config.level,quote,createdAt:new Date().toISOString()};
 await fs.writeFile(file,JSON.stringify(state));
}
if(!state.documentId){
 const source=synchronizedKnowledgeCardSource({owner:String(user.id),sourceId:`knowledge-card:${sourceId}:${config.level}`,fullMarkdown:out.fullEditionMarkdown,illustrationMarkdown:markdown,detailLevel:config.level,distillModel:out.distillModel,infographicTemplateId:config.template,imageJobIds:state.imageJobIds});source.verificationJobId=sourceId;
 const doc=layoutFromSource(source);doc.publication!.synchronizedStarted=false;
 doc.publication!.automaticLayout={requestId:randomUUID(),maxCredits:0};
 const saved=await caller.editableLayout.get();
 const library=saved.library||{version:1,owner:String(user.id),documents:[]};
 const next=layoutLibrarySchema.parse({...library,documents:[...library.documents,doc]});
 await caller.editableLayout.save({library:next,expectedGeneration:saved.generation});
 state.documentId=doc.id;await fs.writeFile(file,JSON.stringify(state));
}
const publicationQuote=await caller.editableLayout.publicationQuote({documentId:state.documentId});
const layoutQuote=await caller.editableLayout.publicationQuote({documentId:state.documentId,purpose:'conversation'});
if(publicationQuote.maxCredits!==0||layoutQuote.maxCredits!==0)throw Error('顾问报价非现行零额外收费，未生成');
await fs.writeFile(path.join(root,'preflight.json'),JSON.stringify({at:new Date().toISOString(),sourceJobId:sourceId,documentId:state.documentId,digest,pageCount:total,newImageCount:total,reusedImageCount:0,quote,variant:state.variant,quality:'high',resolution:'4K',subjectPosition:'center',template:config.template,concurrency:4,pptx:false,publicationQuote,layoutQuote}));
if(mode==='prepare'){console.log(JSON.stringify({status:'prepared',pageCount:total,credits:quote.credits,variant:state.variant,documentId:state.documentId}));process.exit(0);}
if(mode!=='run')throw Error('无效模式');
if(existsSync(path.join(root,'started.json')))throw Error('本次已启动，只查询原任务，禁止重复提交');
await fs.writeFile(path.join(root,'started.json'),JSON.stringify({at:new Date().toISOString(),digest}));
let failed=false;
const status=async(stage:string,extra:any={})=>fs.writeFile(path.join(root,'live.json'),JSON.stringify({at:new Date().toISOString(),stage,sourceJobId:sourceId,documentId:state.documentId,imageJobIds:state.imageJobIds,...extra}));
const app=express();app.use(express.json({limit:'30mb'}));
app.get('/api/health',(_q,r)=>r.json({ok:true}));
app.use('/api/trpc',createExpressMiddleware({router:appRouter,createContext}));
registerManhuaAdvisorStream(app);
app.get('/api/jobs/:id',async(req,res)=>{const c=await createContext({req,res,info:undefined as never});const job=await getJobByIdStrict(req.params.id);if(!c.user||!job||String(job.userId)!==String(c.user.id)){res.status(404).json({message:'任务不可用'});return;}res.json(job);});
app.get('/bootstrap',async(req,res)=>{const c=await createContext({req,res,info:undefined as never});if(c.user?.id!==user.id){res.sendStatus(401);return;}res.json({documentId:state.documentId});});
app.post('/client-progress',async(req,res)=>{await fs.writeFile(path.join(root,'client-progress.json'),JSON.stringify({at:new Date().toISOString(),...req.body}));res.json({ok:true});});
app.get('/panel.js',(_q,r)=>r.sendFile(path.join(root,'panel.js')));
app.get('/',(_q,r)=>r.type('html').send('<html><body><div id="root"></div><script src="/panel.js"></script></body></html>'));
const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
const address=server.address() as any,base=`http://127.0.0.1:${address.port}`;
const browser=await puppeteer.launch({headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage();await page.setViewport({width:1440,height:1000});
await page.setCookie({name:COOKIE_NAME,value:await sdk.createSessionToken(user.openId,{expiresInMs:4*3600000}),url:base,httpOnly:true});
page.on('response',async response=>{if(response.url().includes('editableLayout.exportPublication')){try{await fs.writeFile(path.join(root,'export-response.json'),await response.text());}catch{}}});
page.on('dialog',d=>{void d.accept();});
page.on('pageerror',e=>{void fs.appendFile(path.join(root,'ui-errors.log'),String(e)+'\n');});
// 和正式页面一致：先保存全部图任务，再标记开始，章节组件按真实就绪图并发启动。
const loaded=await caller.editableLayout.get();const doc=loaded.library!.documents.find(d=>d.id===state.documentId)!;
doc.publication!.synchronizedStarted=true;
if(doc.publication!.billing)doc.publication!.billing.confirmed=true;
await caller.editableLayout.save({library:loaded.library!,expectedGeneration:loaded.generation});
// 正式组件随就绪图片并发审校；每页ID先保存，重启只查询同一身份。
await page.goto(base,{waitUntil:'domcontentloaded'});
let next=0,done=0;const errors:any[]=[];
await status('images_and_interior',{done,total});
process.on('SIGUSR1',()=>{failed=true;errors.push({message:'用户停止后续提交，在途仅收回执'});});
const workers=Array.from({length:4},(_,lane)=>(async()=>{
 while(!failed&&!existsSync(path.join(root,'stop-scheduling.json'))&&next<total){const i=next++;const id=state.imageJobIds[i];
  try{
   const existing=await getJobByIdStrict(id);
   if(!existing)await caller.mvAnalysis.generatePlatformCompositeSheet({sceneId:`handbook-${config.level}-${state.requestIds[i]}`,pageRequestId:state.requestIds[i],progressJobId:id,title:doc.title,scriptContext:markdown,kind:'single_page_knowledge_card',notePageIndex:i+1,notePageTotal:total,distillModel:out.distillModel,confirmedPageCredits:knowledgeCardCreditsForPageIndex(i+1,quote.billingModel),subjectPosition:'center',infographicTemplateId:config.template,imageProvider:lane%2===0?'openai':'evolink',openaiImageVariant:state.variant,imagePromptTranslator:'gpt54',enabledSkillIds:[],allowBloggerTitle:false});
   for(;;){const job=await getJobByIdStrict(id);if(job?.status==='succeeded')break;if(job?.status==='failed')throw Error(job.error||'图片任务失败');await new Promise(r=>setTimeout(r,3000));}
   done++;await status('images_and_interior',{done,total});
  }catch(error){failed=true;errors.push({page:i+1,message:String((error as Error).message).replace(/https?:\/\/[^\s]+/g,'[地址]')});await status('image_failed',{done,total,errors});}
 }
})());
await Promise.allSettled(workers);
await fs.writeFile(path.join(root,'image-result.json'),JSON.stringify({at:new Date().toISOString(),done,total,errors}));
if(failed){await status('failed',{done,total,errors});await page.screenshot({path:path.join(root,'ui-final.png'),fullPage:true});await browser.close();server.close();process.exitCode=1;}
else{
 await status('interior_layout_pdf',{done,total});
 for(;;){
  const progress=await page.evaluate(()=>({text:document.body.innerText,finished:(window as any).__handbookFinished,error:(window as any).__handbookError}));
  await fs.writeFile(path.join(root,'ui-state.json'),JSON.stringify({at:new Date().toISOString(),...progress}));
  if(progress.finished){await status('pdf_returned',{done,total,result:progress.finished});break;}
  if(progress.error){await status('publication_failed',{done,total,error:progress.error});break;}
  await new Promise(r=>setTimeout(r,5000));
 }
 await page.screenshot({path:path.join(root,'ui-final.png'),fullPage:true});await browser.close();server.close();
}
