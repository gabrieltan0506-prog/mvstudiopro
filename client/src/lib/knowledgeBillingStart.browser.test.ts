import {it,expect}from'vitest';import{build}from'esbuild';import puppeteer from'puppeteer';import path from'node:path';
it('实际Studio先保存未确认费率，用户开始生成才确认；准备阶段不启动顾问',async()=>{
const bundle=await build({stdin:{resolveDir:process.cwd(),sourcefile:'billing-start.tsx',loader:'tsx',contents:`
import React,{useRef}from'react';import{createRoot}from'react-dom/client';import Studio from'./client/src/components/platform/EditableLayoutStudio';
window.saved={library:{version:1,owner:'7',documents:[]},generation:'0'};window.calls=[];window.quotes=[];
function App(){const ref=useRef();window.prepare=()=>ref.current.prepare({kind:'knowledge-publication',owner:'7',sourceId:'billing',title:'新手册',body:'完整资料'},async()=>{},undefined,{preparePresentation:true});window.start=(id,credits)=>ref.current.start(id,credits);return <Studio ref={ref} owner='7' source={null} compact/>};createRoot(document.getElementById('root')).render(<App/>);
`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env':'{}'},plugins:[{name:'only-boundaries',setup(b){b.onResolve({filter:/^@\/lib\/(trpc|manhuaAdvisorStream)$/},a=>({path:a.path,namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.endsWith('/trpc')?`
export const trpc={useUtils:()=>({editableLayout:{get:{fetch:async()=>window.saved},publicationQuote:{fetch:async input=>{window.quotes.push(input);return {maxCredits:0,estimatedCredits:0,paidUnit:8,batches:2,consistencyKnown:true}}}}}),editableLayout:{save:{useMutation:()=>({mutateAsync:async input=>{window.saved={library:structuredClone(input.library),generation:String(Number(window.saved.generation)+1)};return {generation:window.saved.generation}}})},exportPublication:{useMutation:()=>({})},exportPublicationPptx:{useMutation:()=>({})}}};
`:`export const streamManhuaAdvisor=input=>{window.calls.push(input);return new Promise(()=>{});};`}));}}]});
const browser=await puppeteer.launch({headless:true});try{const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://fixture.invalid');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('打开稿件库')));
const quote=await page.evaluate(()=>(window as any).prepare());expect(quote.maxCredits).toBe(0);
expect(await page.evaluate(()=>(window as any).saved.library.documents[0].publication.billing)).toEqual({version:'interior-pages-v1',confirmed:false});expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);
expect(await page.evaluate(()=>(window as any).quotes.map((q:any)=>q.purpose||'review'))).toEqual(['review','presentation','conversation']);
await page.evaluate(q=>(window as any).start(q.documentId,q.maxCredits),quote);await page.waitForFunction(()=>(window as any).calls.length>0);
expect(await page.evaluate(()=>(window as any).saved.library.documents[0].publication.billing.confirmed)).toBe(true);expect(errors).toEqual([]);
}finally{await browser.close();}
},20000);
