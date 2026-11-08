/**
 * 隔离探针（2026-11-08 用户授权）：沿用既有成功配图任务，新建云稿，只用本分支正式代码
 * 完成审校 → 整册核对 → 排版 → 导出。探针本身不调用模型、不生图、不补回执、不改状态；
 * 所有模型调用都由正式出版组件经正式路由发出，失败即如实记录退出，由修正式代码后重跑。
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
import {users} from '../drizzle/schema';
import {getJobByIdStrict} from '../server/jobs/repository';
import {assertWorkerProbeLease} from '../server/services/workerProbeLease';
import {synchronizedKnowledgeCardSource} from '../shared/knowledgeCardEditableLayout';
import {layoutFromSource,layoutLibrarySchema} from '../shared/editableLayout';
import {planKnowledgeCardPages} from '../shared/knowledgeCardPagination';
import {knowledgeEditionPageBudget} from '../shared/knowledgeEditionBudget';
import {COOKIE_NAME} from '../shared/const';

if(process.env.FLY_PROCESS_GROUP!=='rig')throw Error('只能在已授权工作机执行');
await assertWorkerProbeLease();
const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const root=path.dirname(process.argv[2]);
const write=(name:string,value:unknown)=>fs.writeFile(path.join(root,name),JSON.stringify({at:new Date().toISOString(),...(value as object)}));
const scrub=(s:unknown)=>String(s).replace(/(?:https?|gs):\/\/[^\s"']+/g,'[地址]').slice(0,600);
if(!['full','concise'].includes(config.level))throw Error('档位无效');
if(!/^[0-9a-f-]{36}$/.test(config.previousDocumentId||config.resumeDocumentId||''))throw Error('缺少原云稿ID');

// 原云稿只用于取已成功的配图任务及生图前核实任务身份；不复用其审校、排版或导出结果。
const db=await getDb();if(!db)throw Error('数据库不可用');
const ownerJob=await getJobByIdStrict(config.ownerJobId);
if(!ownerJob)throw Error('缺少所有者证据任务');
const [user]=await db.select().from(users).where(eq(users.id,Number(ownerJob.userId))).limit(1);
if(!user)throw Error('所有者不存在');
const caller=appRouter.createCaller({req:{headers:{}},res:{},user,clientDisconnected:new AbortController().signal} as any);
const statePath=path.join(root,'state.json');
let state:any=existsSync(statePath)?JSON.parse(await fs.readFile(statePath,'utf8')):null;
if(!state&&config.resumeDocumentId){
  // 续跑同一正式云稿：只重新挂载正式出版组件，由正式恢复入口按原回执继续；不新建云稿、不改状态。
  const saved=await caller.editableLayout.get();
  const doc=saved.library?.documents.find(d=>d.id===config.resumeDocumentId);
  if(!doc?.publication)throw Error('续跑云稿不存在');
  state={level:doc.publication.source.detailLevel||config.level,imageJobIds:doc.publication.source.pages.filter(p=>p.imageJobId).map(p=>p.imageJobId),documentId:doc.id,resumed:true,createdAt:new Date().toISOString()};
  await fs.writeFile(statePath,JSON.stringify(state));
}
if(!state){
  const saved=await caller.editableLayout.get();
  const previous=saved.library?.documents.find(d=>d.id===config.previousDocumentId);
  const source=previous?.publication?.source;
  if(!source?.verificationJobId)throw Error('原云稿缺少生图前核实任务');
  const imageJobIds=source.pages.filter(p=>p.imageJobId).map(p=>p.imageJobId!);
  const edition=await getJobByIdStrict(source.verificationJobId),out:any=edition?.output;
  if(!edition||String(edition.userId)!==String(user.id)||edition.status!=='succeeded'||!out?.verificationProcessed||!out.fullEditionMarkdown)throw Error('生图前核实任务不可用');
  const markdown=String(config.level==='full'?out.fullEditionMarkdown:out.distilledMarkdown);
  const plan=planKnowledgeCardPages(markdown,out.distillModel);
  if(plan.pages.length!==imageJobIds.length)throw Error(`当前分页${plan.pages.length}页与原配图${imageJobIds.length}张不一致，未复用`);
  // 逐张核对：配图任务属于本人、成功、且正是本稿同一页（同稿指纹+同页号），否则不复用。
  const digest=createHash('sha256').update(markdown).digest('hex');
  for(const [i,id] of imageJobIds.entries()){
    const job=await getJobByIdStrict(id),params:any=(job?.input as any)?.params;
    if(!job||String(job.userId)!==String(user.id)||job.status!=='succeeded'||params?.kind!=='single_page_knowledge_card')throw Error(`第${i+1}张原图任务不可复用`);
    if(Number(params.notePageIndex)!==i+1||createHash('sha256').update(String(params.scriptContext||'')).digest('hex')!==digest)throw Error(`第${i+1}张原图与本稿页不对应，未复用`);
  }
  state={edition:edition.id,level:config.level,digest,imageJobIds,template:source.pages.length?previous!.publication!.infographicTemplateId:undefined,createdAt:new Date().toISOString()};
  const fresh=synchronizedKnowledgeCardSource({owner:String(user.id),sourceId:`knowledge-card:${edition.id}:${config.level}:relayout-${Date.now()}`,fullMarkdown:out.fullEditionMarkdown,illustrationMarkdown:markdown,detailLevel:config.level,distillModel:out.distillModel,infographicTemplateId:state.template,imageJobIds});
  fresh.verificationJobId=edition.id;
  const doc=layoutFromSource(fresh);
  doc.title=`${doc.title}（图文比例重排）`;
  doc.publication!.synchronizedStarted=true;
  if(doc.publication!.billing)doc.publication!.billing.confirmed=true;
  doc.publication!.automaticLayout={requestId:randomUUID(),maxCredits:0};
  const latest=await caller.editableLayout.get();
  const library=latest.library||{version:1,owner:String(user.id),documents:[]};
  await caller.editableLayout.save({library:layoutLibrarySchema.parse({...library,documents:[...library.documents,doc]}),expectedGeneration:latest.generation});
  state.documentId=doc.id;
  await fs.writeFile(statePath,JSON.stringify(state));
}
const budget=knowledgeEditionPageBudget(state.level,state.imageJobIds.length);
await write('live.json',{stage:'prepared',documentId:state.documentId,imagePages:state.imageJobIds.length,budget});
if(process.argv[3]==='prepare')process.exit(0);
if(existsSync(path.join(root,'started.json')))throw Error('本次已启动，只查询，禁止重复提交');
await write('started.json',{documentId:state.documentId});

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
await page.setCookie({name:COOKIE_NAME,value:await sdk.createSessionToken(user.openId,{expiresInMs:6*3600000}),url:base,httpOnly:true});
page.on('response',async response=>{if(response.url().includes('editableLayout.exportPublication')){try{await fs.writeFile(path.join(root,'export-response.json'),await response.text());}catch{}}});
page.on('dialog',d=>{void d.accept();});
page.on('console',m=>{const t=m.text();if(t.includes('[knowledgePublication]'))void fs.appendFile(path.join(root,'ui-errors.log'),new Date().toISOString()+' '+t.slice(0,1200)+'\n');});
page.on('pageerror',e=>{void fs.appendFile(path.join(root,'ui-errors.log'),scrub(e)+'\n');});
await page.goto(base,{waitUntil:'domcontentloaded'});
await write('live.json',{stage:'interior_layout_pdf',documentId:state.documentId,imagePages:state.imageJobIds.length,budget});
let final:any;
for(;;){
  const progress=await page.evaluate(()=>({finished:(window as any).__handbookFinished,error:(window as any).__handbookError}));
  if(progress.finished){final={stage:'pdf_returned',result:progress.finished};break;}
  if(progress.error){final={stage:'publication_failed',error:scrub(progress.error)};break;}
  await new Promise(r=>setTimeout(r,10000));
}
await page.screenshot({path:path.join(root,'ui-final.png'),fullPage:true}).catch(()=>{});
await browser.close();server.close();
const totalPages=Number(final.result?.totalPages)||null,imagePages=Number(final.result?.imagePages)||null;
await write('live.json',{...final,documentId:state.documentId,budget,summary:totalPages?{totalPages,imagePages,readingPages:totalPages-(imagePages||0),withinBudget:totalPages<=budget.totalPages.max}:null});
if(final.stage!=='pdf_returned')process.exitCode=1;
