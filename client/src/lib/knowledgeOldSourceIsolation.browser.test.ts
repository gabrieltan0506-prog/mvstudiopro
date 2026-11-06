import {it,expect} from "vitest";
import {build} from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("旧稿即使本机和云端都有activeId也不自动带入，只有明确恢复才打开；新读档清选择不删旧稿",async()=>{
 const bundled=await build({stdin:{resolveDir:process.cwd(),sourcefile:"old-source.tsx",loader:"tsx",contents:`
 import React,{useRef}from'react';import{createRoot}from'react-dom/client';import Studio from'./client/src/components/platform/EditableLayoutStudio';import{layoutFromSource}from'./shared/editableLayout';
 const old=layoutFromSource({owner:'7',sourceId:'old-book',kind:'knowledge-publication',title:'旧稿不可自动引用',body:'',pages:[{pageIndex:1,headline:'旧章节',body:'上一份书的完整原文'}]});window.old=old;window.calls=[];window.saved={library:{version:1,owner:'7',documents:[old]},generation:'1',dirty:false,activeId:old.id};localStorage.setItem('mvstudiopro.editableLayout.v1.7',JSON.stringify(window.saved));
 function App(){const ref=useRef();window.newReading=()=>ref.current.beginNewSource();return <Studio ref={ref} owner='7' source={null} compact/>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},plugins:[{name:'only-network',setup(b){b.onResolve({filter:/^@\/lib\/(trpc|manhuaAdvisorStream)$/},a=>({path:a.path,namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},a=>({loader:'js',contents:a.path.endsWith('/trpc')?`export const trpc={useUtils:()=>({editableLayout:{get:{fetch:async()=>window.saved},publicationQuote:{fetch:async()=>({maxCredits:0})}}}),editableLayout:{save:{useMutation:()=>({mutateAsync:async()=>({generation:'2'})})},exportPublication:{useMutation:()=>({})},exportPublicationPptx:{useMutation:()=>({})}}};`:`export const streamManhuaAdvisor=async input=>{window.calls.push(input);throw Error('不应自动提交旧稿');};`}));}}]});
 const browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
 try {const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await page.setRequestInterception(true);page.on('request',r=>void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}));await page.goto('https://fixture.invalid');await page.addScriptTag({content:bundled.outputFiles[0].text});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('打开稿件库（1）')));
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('打开稿件库'))!.click());
 expect(await page.$('[aria-label="图文知识手册自动审校与排版"]')).toBeNull();expect(await page.$eval('select[aria-label="选择排版稿件"]',e=>(e as HTMLSelectElement).value)).toBe('');
 const id=await page.evaluate(()=>(window as any).old.id);await page.select('select[aria-label="选择排版稿件"]',id);await page.waitForSelector('[aria-label="图文知识手册自动审校与排版"]');
 await page.evaluate(()=>(window as any).newReading());await page.waitForFunction(()=>!document.querySelector('[aria-label="图文知识手册自动审校与排版"]'));
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mvstudiopro.editableLayout.v1.7')!).library.documents.length)).toBe(1);
 expect(await page.evaluate(()=>(window as any).calls)).toEqual([]);expect(errors).toEqual([]);
 }finally{await browser.close();}
},15000);
