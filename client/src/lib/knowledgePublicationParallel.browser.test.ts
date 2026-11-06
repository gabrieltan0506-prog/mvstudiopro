import { expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
it('真实组件双路重叠、空闲补位、乱序保存及失败后原编号恢复',async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'parallel-fixture.tsx',loader:'tsx',contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import Panel from './client/src/components/platform/KnowledgePublicationPanel';
 import {layoutFromSource} from './shared/editableLayout';import{knowledgeReviewBatches}from'./shared/knowledgePublication';
 window.saved=layoutFromSource({owner:'7',sourceId:'parallel',kind:'knowledge-publication',title:'并发原稿',body:'',pages:Array.from({length:13},(_,i)=>({pageIndex:i+1,headline:'章节'+i,body:'原始正文'+i}))});
 window.calls=[];window.pending={};window.saves=[];window.activeSaves=0;window.maxSaves=0;
 window.stream=input=>{const i=input.knowledgePublicationContext.batchIndex;window.calls.push({i,id:input.requestId,channel:window.saved.publication.parallel.channels[i]});return new Promise((resolve,reject)=>{window.pending[i]={resolve:()=>{const s=window.saved.publication.source,b=knowledgeReviewBatches(s);resolve({success:true,creditsCharged:0,answer:JSON.stringify({kind:'knowledge_publication_batch_v1',batchIndex:i,batchCount:b.length,sourceDigest:'a'.repeat(64),reviewedPages:b[i].map(n=>s.pages[n].id)})});},reject:()=>reject(Error('网络断线，恢复原请求'))};});};
 function App(){const[doc,setDoc]=useState(window.saved);return <Panel doc={doc} onBusy={()=>{}} onChange={setDoc} commit={async next=>{window.activeSaves++;window.maxSaves=Math.max(window.maxSaves,window.activeSaves);await new Promise(r=>setTimeout(r,10));window.saved=structuredClone(next);window.saves.push(structuredClone(next.publication));setDoc(next);window.activeSaves--;return {generation:String(window.saves.length)}}}/>};const root=createRoot(document.getElementById('root'));window.remount=()=>root.render(<App key={Date.now()}/>);root.render(<App/>);
 `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/^@\/lib\/(trpc|manhuaAdvisorStream|gcsTransfer)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/trpc')?`export const trpc={useUtils:()=>({editableLayout:{publicationQuote:{fetch:async()=>({batches:5,remaining:5,consistencyKnown:false,paidUnit:1,maxCredits:0,estimatedCredits:0})}}}),editableLayout:{exportPublication:{useMutation:()=>({})},exportPublicationPptx:{useMutation:()=>({})}}};`:a.path.endsWith('/manhuaAdvisorStream')?`export const streamManhuaAdvisor=input=>window.stream(input);`:`export const flyDownloadUrl=u=>u;`}));}}]});
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://fixture.invalid');await page.addScriptTag({content:bundle.outputFiles[0].text});
 const click=()=>page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>/开始自动审校|继续自动审校/.test(b.textContent||''));if(!b)throw Error('没有继续入口');b.click();});
 await click();await page.waitForFunction(()=>(window as any).calls.length===2);
 expect(await page.evaluate(()=>(window as any).calls.map((c:any)=>[c.i,c.channel]))).toEqual([[0,'openrouter'],[1,'evolink']]);
 await page.evaluate(()=>(window as any).pending[1].resolve());await page.waitForFunction(()=>(window as any).calls.length===3);
 expect(await page.evaluate(()=>(window as any).calls[2])).toMatchObject({i:2,channel:'evolink'});
 await page.evaluate(()=>(window as any).pending[2].resolve());await page.waitForFunction(()=>(window as any).calls.length===4);
 await page.evaluate(()=>(window as any).pending[3].resolve());await page.waitForFunction(()=>(window as any).saved.publication.parallel.completed.length===3);
 expect(await page.evaluate(()=>(window as any).saved.publication.completedBatches)).toBe(0);
 expect(await page.$eval("section",e=>e.textContent)).toContain("已完成 9/13 章");
 await page.evaluate(()=>(window as any).pending[0].reject());await page.waitForFunction(()=>document.querySelector('[role="alert"]'));
 const firstId=await page.evaluate(()=>(window as any).calls[0].id);await page.evaluate(()=>(window as any).remount());await click();await page.waitForFunction(()=>(window as any).calls.length===5);
 expect(await page.evaluate(()=>(window as any).calls[4])).toEqual({i:0,channel:'openrouter',id:firstId});
 expect(await page.evaluate(()=>(window as any).maxSaves)).toBe(1);expect(errors).toEqual([]);
 }finally{await browser.close();}
},30000);
it('真实组件后图先就绪即读图，文字等待读档顾问且不阻塞图片',async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'ready-fixture.tsx',loader:'tsx',contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import Panel from './client/src/components/platform/KnowledgePublicationPanel';
 import {layoutFromSource} from './shared/editableLayout';import{knowledgeReviewBatches}from'./shared/knowledgePublication';
 window.saved=layoutFromSource({owner:'7',sourceId:'ready',kind:'knowledge-publication',title:'完整底稿',body:'',pages:Array.from({length:4},(_,i)=>({pageIndex:i+1,headline:'章节'+i,body:'完整正文'+i}))});
 window.saved.publication.source.pages.forEach((p,i)=>{if(i%2){p.imageJobId=i===1?'slow':'fast';p.role='illustration';}else p.role='reading';});
 window.saved.publication.synchronizedStarted=false;
 window.calls=[];window.gates={};window.resolve={};window.waited=[];
 for(const key of ['slow','fast','reading'])window.gates[key]=new Promise(resolve=>window.resolve[key]=resolve);
 window.stream=async input=>{const i=input.knowledgePublicationContext.batchIndex;window.calls.push(i);const s=window.saved.publication.source,b=knowledgeReviewBatches(s);return {success:true,creditsCharged:0,answer:JSON.stringify({kind:'knowledge_publication_batch_v1',batchIndex:i,batchCount:b.length,sourceDigest:'a'.repeat(64),reviewedPages:b[i].map(n=>s.pages[n].id)})};};
 function App(){const[doc,setDoc]=useState(window.saved);return <Panel doc={doc} autoStart preauthorizedCredits={0} waitForReading={()=>{window.waited.push('reading');return window.gates.reading;}} waitForImages={ids=>{window.waited.push(...ids);return Promise.all(ids.map(id=>window.gates[id]));}} onBusy={()=>{}} onChange={setDoc} commit={async next=>{window.saved=structuredClone(next);setDoc(next);return {generation:'1'}}}/>};createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'ready-boundaries',setup(b){b.onResolve({filter:/^@\/lib\/(trpc|manhuaAdvisorStream|gcsTransfer)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/trpc')?`export const trpc={useUtils:()=>({editableLayout:{publicationQuote:{fetch:async()=>({batches:5,remaining:5,consistencyKnown:false,paidUnit:1,maxCredits:0,estimatedCredits:0})}}}),editableLayout:{exportPublication:{useMutation:()=>({})},exportPublicationPptx:{useMutation:()=>({})}}};`:a.path.endsWith('/manhuaAdvisorStream')?`export const streamManhuaAdvisor=input=>window.stream(input);`:`export const flyDownloadUrl=u=>u;`}));}}]});
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://fixture.invalid');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.waitForFunction(()=>(window as any).waited.length===4);
 expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
 await page.evaluate(()=>(window as any).resolve.fast());
 await page.waitForFunction(()=>(window as any).saved.publication.parallel.completed.length===1);
 expect(await page.evaluate(()=>(window as any).calls)).toEqual([3]);
 expect(await page.evaluate(()=>(window as any).saved.publication.parallel.channels[1])).toBeUndefined();
 await page.evaluate(()=>(window as any).resolve.reading());
 await page.waitForFunction(()=>(window as any).saved.publication.parallel.completed.length===3);
 expect(await page.evaluate(()=>(window as any).calls.slice().sort())).toEqual([0,2,3]);
 expect(await page.evaluate(()=>(window as any).saved.publication.source.pages.map((p:any)=>p.body))).toEqual(['完整正文0','完整正文1','完整正文2','完整正文3']);
 expect(errors).toEqual([]);expect(await page.$('[role="alert"]')).toBeNull();
 }finally{await browser.close();}
},30000);
