import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
it("知识更新按钮只显式刷新目录，显示数量与失败保留状态，不自动调用模型",async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`import React from 'react';import{createRoot}from'react-dom/client';import{ManhuaAdvisorKnowledgePanel}from'./client/src/components/canvas/ManhuaAdvisorKnowledgePanel';globalThis.calls=[];globalThis.fail=false;createRoot(document.getElementById('root')).render(<ManhuaAdvisorKnowledgePanel enabled/>);`},bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",plugins:[{name:"offline-knowledge",setup(b){
  b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"trpc",namespace:"fixture"}));
  b.onLoad({filter:/.*/,namespace:"fixture"},()=>({loader:"jsx",resolveDir:process.cwd(),contents:`import{useState}from'react';let state={status:'not_scanned',refreshing:false};let update=()=>{};const setData=(_,next)=>{state=next;update(next);};export const trpc={useUtils:()=>({mvAnalysis:{inspectAdvisorKnowledge:{setData}}}),mvAnalysis:{inspectAdvisorKnowledge:{useQuery:()=>{const[data,set]=useState(state);update=set;return{data,isError:false};}},refreshAdvisorKnowledge:{useMutation:options=>({isPending:false,mutate:()=>{globalThis.calls.push('refresh');options.onSuccess(globalThis.fail?{...state,status:'stale',error:'目录读取失败',changes:undefined}:{status:'ready',refreshing:false,snapshot:{scannedAt:'2026-10-07T07:00:00Z',templates:[{}],directors:[{},{}]},changes:{added:['mt_a123'],updated:[],deleted:[],unchangedCount:0}});}})}}};`}));
 }}]});
 const browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
 try{const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  await page.waitForSelector('[aria-label="顾问知识目录"]');expect(await page.evaluate(()=>(globalThis as any).calls)).toEqual([]);
  await page.click('button');await page.waitForFunction(()=>document.body.innerText.includes('1 个模板 · 2 个导演包'));expect(await page.evaluate(()=>(globalThis as any).calls)).toEqual(['refresh']);
  await page.evaluate(()=>{(globalThis as any).fail=true;});await page.click('button');await page.waitForFunction(()=>document.body.innerText.includes('旧快照'));
  expect(await page.$eval('[aria-label="顾问知识目录"]',el=>el.textContent)).toContain('1 个模板 · 2 个导演包');
 }finally{await browser.close();}
},60_000);
