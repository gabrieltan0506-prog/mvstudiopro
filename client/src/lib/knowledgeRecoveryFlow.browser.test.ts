import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

it("真实HTTP断线→原任务恢复→顾问仅一次提交→原报告正文进入页面", async () => {
 const link={jobId:"kc_browser",documentId:"11111111-1111-4111-a111-111111111111",batches:1};
 const text="恢复后的原稿正文，末句不能丢失。";
 let reads=0,posts=0,reportReads=0;
 const requests:Array<{method:string;url:string}>=[];
 let script="";
 const server=createServer((req,res)=>{
  const url=req.url!;requests.push({method:req.method!,url});
  const json=(value:unknown)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));};
  if(url==='/'){res.setHeader('Content-Type','text/html');res.end('<div id="root"></div><script src="/app.js"></script>');return;}
  if(url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(script);return;}
  if(url==='/api/health'){res.end('ok');return;}
  if(url==='/api/jobs/kc_browser'){
   reads++;if(reads===1){res.setHeader('Content-Type','text/html');res.end('<!DOCTYPE html>gateway');return;}
   json({status:reads<4?'running':'succeeded',output:{readingPreparation:{...link,ready:[0]},distilledMarkdown:reads>=4?text:undefined}});return;
  }
  if(url==='/reading'){
   reportReads++;if(reportReads===2){res.writeHead(503);res.end('暂不可用');return;}
   const saved=posts>0 && reportReads>=3;
   json({...link,status:'running',ready:[0],completed:saved?[0]:[],failed:[],paidUnit:0,maxCredits:0,estimatedCredits:0,drafts:saved?[{index:0,pages:[{headline:'故障恢复验收',body:text}]}]:[]});return;
  }
  if(url==='/api/manhua-advisor/stream'){
   posts++;res.writeHead(200,{'Content-Type':'text/event-stream'});res.end(': heartbeat\n\n');return;
  }
  if(url==='/api/jobs/manhua_advisor_original'){json({status:'succeeded',output:{result:{success:true,creditsCharged:0}}});return;}
  res.writeHead(404);res.end('not found');
 });
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const origin=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 const bundled=await build({stdin:{resolveDir:process.cwd(),sourcefile:'connection.tsx',loader:'tsx',contents:`
 import React,{useEffect,useState}from'react';import{createRoot}from'react-dom/client';
 import{pollJobUntilTerminal,getJob}from'./client/src/lib/jobs';
 import{createKnowledgeReadingController}from'./client/src/lib/knowledgeReadingPreparation';
 import{streamManhuaAdvisor}from'./client/src/lib/manhuaAdvisorStream';
 import{KnowledgeReadingLive}from'./client/src/components/platform/KnowledgeReadingLive';
 import{KnowledgeCardProgress}from'./client/src/components/platform/KnowledgeCardProgress';
 function App(){const[progress,setProgress]=useState({status:'running',percent:3,label:'读档'}),[drafts,setDrafts]=useState([]),[message,setMessage]=useState('');useEffect(()=>{
 const control=createKnowledgeReadingController({state:async()=>{const r=await fetch('/reading');if(!r.ok)throw Error('GET暂不可用');return r.json();},confirm:async()=>true,content:setDrafts,progress:setMessage,execute:(link,index,requestId)=>streamManhuaAdvisor({requestId,question:'整理',knowledgePublicationContext:{documentId:link.documentId,readingJobId:link.jobId,purpose:'reading',batchIndex:index,attempt:0}},()=>{}),recover:async()=>{const j=await getJob('manhua_advisor_original');return j.status==='succeeded'?{...j.output.result,replayed:true}:undefined;}});
 pollJobUntilTerminal('kc_browser',{intervalMs:100,maxIntervalMs:100,maxWaitMs:30000,onUnavailable:()=>setProgress(p=>({...p,label:'连接恢复中'})),onPoll:({output})=>{if(output?.readingPreparation)void control.update(output.readingPreparation).catch(()=>{});}}).then(j=>{window.originalResult=j.output.distilledMarkdown;setProgress({status:'running',percent:60,label:'原稿已读取，等待整理正文'});}).catch(e=>window.failure=e.message);
 return()=>control.stop();},[]);return <><KnowledgeCardProgress state={progress}/><KnowledgeReadingLive status={message} drafts={drafts}/></>};createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"','import.meta.env.VITE_FLY_API_ORIGIN':JSON.stringify(origin)}});
 script=bundled.outputFiles[0].text;
 const browser=await puppeteer.launch({headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(e instanceof Error ? e.message : String(e)));
  await page.goto(origin);await page.waitForFunction(value=>document.querySelector('article')?.textContent?.includes(value),{timeout:20000},text);
  expect(await page.evaluate(()=>(window as any).originalResult)).toBe(text);
  expect(await page.evaluate(()=>(window as any).failure)).toBeUndefined();expect(errors).toEqual([]);
  expect(await page.$eval('[aria-label="知识卡进度"]',e=>e.textContent)).not.toContain('失败');
  expect(posts).toBe(1);expect(requests.filter(r=>r.method==='POST')).toHaveLength(1);
  expect(requests.some(r=>r.url==='/api/jobs/kc_browser')).toBe(true);
 }finally{await browser.close();await new Promise<void>((r,e)=>server.close(err=>err?e(err):r()));}
},30000);
