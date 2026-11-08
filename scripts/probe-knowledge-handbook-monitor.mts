/**
 * 只读监看（2026-11-08 用户要求“能监看每一个步骤”）：读取正式云稿的出版状态，输出逐章计数，
 * 不调用模型、不写业务数据。只输出数字与序号，不输出正文（公开仓库日志）。
 * 发现不合理（超预算、重打图中内容、预估页数超上限）时给出 flags，供修正式代码后重跑。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import {eq} from 'drizzle-orm';
import {appRouter} from '../server/routers';
import {getDb} from '../server/db';
import {users} from '../drizzle/schema';
import {getJobByIdStrict} from '../server/jobs/repository';
import {knowledgeReviewBatches} from '../shared/knowledgePublication';
import {knowledgeReadingMarkdown} from '../shared/knowledgePublicationLayout';
import {knowledgeReadingCharBudgets,KNOWLEDGE_LEAD_PAGE_CHARS,KNOWLEDGE_READING_PAGE_CHARS} from '../shared/knowledgeEditionBudget';

const config=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const root=path.dirname(process.argv[2]);
const db=await getDb();if(!db)throw Error('数据库不可用');
const ownerJob=await getJobByIdStrict(config.ownerJobId);if(!ownerJob)throw Error('缺少所有者证据任务');
const [user]=await db.select().from(users).where(eq(users.id,Number(ownerJob.userId))).limit(1);
if(!user)throw Error('所有者不存在');
const caller=appRouter.createCaller({req:{headers:{}},res:{},user,clientDisconnected:new AbortController().signal} as any);
const chars=(s:string)=>s.replace(/\s+/g,'').length;
/** 4字片段重合率：reading 中有多少片段原样出现在图内文字里，用来发现“重打图中内容”。 */
const overlap=(reading:string,image:string)=>{
  const clean=(s:string)=>s.replace(/[\s#|*\-:：，。、；（）()]/g,'');
  const a=clean(reading),b=clean(image);if(a.length<8)return 0;
  const grams=new Set<string>();for(let i=0;i<b.length-3;i++)grams.add(b.slice(i,i+4));
  let hit=0,total=0;for(let i=0;i<a.length-3;i+=2){total++;if(grams.has(a.slice(i,i+4)))hit++;}
  return total?Math.round(hit/total*100)/100:0;
};

async function snapshot(){
  const saved=await caller.editableLayout.get();
  const doc=saved.library?.documents.find(d=>d.id===config.documentId);
  const pub=doc?.publication;
  if(!doc||!pub)return {stage:'missing_document'};
  const source=pub.source,level=source.detailLevel||'full';
  const budgets=new Map(knowledgeReadingCharBudgets(level,source.pages).pages.map(p=>[p.id,p.maxChars]));
  const reviews=pub.chapterReviews||{};
  const layoutTurns=(pub.conversation||[]).filter(t=>t.request.action==='layout');
  const selected=pub.layoutConversationId&&layoutTurns.find(t=>t.request.id===pub.layoutConversationId);
  const plan=selected?.response?.layoutPlan;
  const presented=new Map((plan?.chapters||[]).filter(c=>c.presentation).map(c=>[c.pageId,knowledgeReadingMarkdown(c.presentation!.reading)]));
  const chapters=source.pages.map((page,i)=>{
    const review=reviews[page.id];
    const body=presented.get(page.id)??(review?.reading?knowledgeReadingMarkdown(review.reading):review?.body);
    if(!body)return {n:i+1,done:false};
    const c=chars(body),max=budgets.get(page.id)||KNOWLEDGE_LEAD_PAGE_CHARS;
    const pages=1+Math.max(0,Math.ceil((c-KNOWLEDGE_LEAD_PAGE_CHARS)/KNOWLEDGE_READING_PAGE_CHARS));
    return {n:i+1,done:true,chars:c,max,ratio:Math.round(c/max*100)/100,tables:(body.match(/^\|.*\|$/gm)||[]).length,imageOverlap:overlap(body,page.body),supplementChars:chars(page.supplement||''),estPages:pages,stage:presented.has(page.id)?'layout':'review'};
  });
  const done=chapters.filter((c:any)=>c.done) as any[];
  const estTotal=done.reduce((n,c)=>n+c.estPages,0)+(chapters.length-done.length);
  const flags=[
    ...done.filter(c=>c.ratio>1.3).map(c=>`第${c.n}章内文${c.chars}字，超预算${c.max}的${c.ratio}倍`),
    ...done.filter(c=>c.imageOverlap>0.45).map(c=>`第${c.n}章内文与图中文字重合${Math.round(c.imageOverlap*100)}%，疑似重打图中内容`),
  ];
  return {
    stage:pub.review?(selected?'layout_selected':layoutTurns.length?'layout_running':'reviewed'):'reviewing',
    batches:{done:pub.completedBatches||0,total:knowledgeReviewBatches(source).length},
    chapters:{done:done.length,total:chapters.length},
    layout:{turns:layoutTurns.length,answered:layoutTurns.filter(t=>t.response).length,selected:Boolean(selected),presented:presented.size},
    chars:{total:done.reduce((n,c)=>n+c.chars,0),budget:done.reduce((n,c)=>n+c.max,0)},
    estimatedTotalPages:estTotal,
    flags,
    chapterStats:done.map(c=>[c.n,c.chars,c.max,c.tables,c.imageOverlap,c.estPages]),
  };
}

const rounds=Math.max(1,Number(config.rounds)||1),interval=Math.max(30,Number(config.intervalSeconds)||120);
for(let r=0;r<rounds;r++){
  const value=await snapshot();
  await fs.writeFile(path.join(root,'monitor.json'),JSON.stringify({at:new Date().toISOString(),round:r+1,...value}));
  console.log('MONITOR '+JSON.stringify({at:new Date().toISOString(),...value,chapterStats:undefined}));
  if(r<rounds-1)await new Promise(res=>setTimeout(res,interval*1000));
}
process.exit(0);
