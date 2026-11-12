import { expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
// 1113 站长令：手册排版内容框与进度展示分开；进度区块在内容上方，当前进度在前，历史进度最新在上。
it('进度区块独立于排版内容框、位于其上方，历史进度最新在上',async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'progress-layout-fixture.tsx',loader:'tsx',contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import Panel from './client/src/components/platform/KnowledgePublicationPanel';
 import {layoutFromSource} from './shared/editableLayout';import{knowledgeReviewBatches}from'./shared/knowledgePublication';
 window.saved=layoutFromSource({owner:'7',sourceId:'progress',kind:'knowledge-publication',title:'进度原稿',body:'',pages:Array.from({length:13},(_,i)=>({pageIndex:i+1,headline:'章节'+i,body:'原始正文'+i}))});
 window.label=i=>knowledgeReviewBatches(window.saved.publication.source)[i].map(n=>n+1).join('、');
 window.calls=[];window.pending={};
 window.stream=input=>{const i=input.knowledgePublicationContext.batchIndex;window.calls.push(i);return new Promise(resolve=>{window.pending[i]=()=>{const s=window.saved.publication.source,b=knowledgeReviewBatches(s);resolve({success:true,creditsCharged:0,answer:JSON.stringify({kind:'knowledge_publication_batch_v1',batchIndex:i,batchCount:b.length,sourceDigest:'a'.repeat(64),reviewedPages:b[i].map(n=>s.pages[n].id),pages:b[i].map(n=>({id:s.pages[n].id,headline:'已整理'+n,body:'已整理正文'+n,imageDescription:'',imageStatus:'absent',facts:[{term:'要点',statement:'说明'}],cautions:[]}))})});};});};
 function App(){const[doc,setDoc]=useState(window.saved);return <Panel doc={doc} onBusy={()=>{}} onChange={setDoc} commit={async next=>{window.saved=structuredClone(next);setDoc(next);return {generation:'1'}}}/>};createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'progress-boundaries',setup(b){b.onResolve({filter:/^@\/lib\/(trpc|manhuaAdvisorStream|gcsTransfer)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/trpc')?`export const trpc={useUtils:()=>({editableLayout:{publicationQuote:{fetch:async()=>({batches:5,remaining:5,consistencyKnown:false,paidUnit:1,maxCredits:0,estimatedCredits:0})}}}),editableLayout:{startExportPublication:{useMutation:()=>({})},exportPublicationPptx:{useMutation:()=>({})}}};`:a.path.endsWith('/manhuaAdvisorStream')?`export const streamManhuaAdvisor=input=>window.stream(input);`:`export const flyDownloadUrl=u=>u;`}));}}]});
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://fixture.invalid');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>/开始自动审校/.test(b.textContent||''));if(!b)throw Error('没有开始入口');b.click();});
 await page.waitForFunction(()=>(window as any).calls.length===2);
 await page.evaluate(()=>(window as any).pending[1]());await page.waitForFunction(()=>(window as any).calls.length===3);
 const third=await page.evaluate(()=>(window as any).label((window as any).calls[2]));
 await page.waitForFunction(t=>document.querySelector('[aria-label="手册处理进度"] [role="status"]')?.textContent?.includes(`第 ${t} 章`),{},third);
 await page.waitForFunction(()=>document.querySelectorAll('[aria-label="已整理章节"] article').length>0);
 const layout=await page.evaluate(()=>{
  const progress=document.querySelector('[aria-label="手册处理进度"]')!,chapters=document.querySelector('[aria-label="已整理章节"]')!,pptx=document.querySelector('[aria-label="PPTX课件规划"]')!;
  return {
   separate:!progress.contains(chapters)&&!chapters.contains(progress)&&!progress.contains(pptx),
   beforeChapters:Boolean(progress.compareDocumentPosition(chapters)&Node.DOCUMENT_POSITION_FOLLOWING),
   beforePptx:Boolean(progress.compareDocumentPosition(pptx)&Node.DOCUMENT_POSITION_FOLLOWING),
   progressText:progress.textContent||'',chapterText:chapters.textContent||'',
   statusOutside:Array.from(document.querySelectorAll('[role="status"],[aria-label="手册处理阶段"]')).every(e=>progress.contains(e)),
  };
 });
 expect(layout).toMatchObject({separate:true,beforeChapters:true,beforePptx:true,statusOutside:true});
 expect(layout.progressText).toContain('正文整理');expect(layout.progressText).toContain('逐章整理');
 expect(layout.chapterText).not.toContain('正文整理');expect(layout.chapterText).toContain('已整理正文');
 // 再推进一批：上一条进度进入历史区且排在最前（最新在上）。
 await page.evaluate(()=>(window as any).pending[(window as any).calls[2]]());await page.waitForFunction(()=>(window as any).calls.length===4);
 const fourth=await page.evaluate(()=>(window as any).label((window as any).calls[3]));
 await page.waitForFunction(t=>document.querySelector('[aria-label="手册处理进度"] [role="status"]')?.textContent?.includes(`第 ${t} 章`),{},fourth);
 const history=await page.$$eval('[aria-label="历史进度"] li',items=>items.map(e=>e.textContent||''));
 expect(history.length).toBeGreaterThanOrEqual(2);
 expect(history[0]).toContain(`第 ${third} 章`);
 expect(history.some(text=>text.includes(`第 ${fourth} 章`))).toBe(false);
 expect(errors).toEqual([]);
 }finally{await browser.close();}
},30000);
