/** 离线真实组件链：网络与媒体响应仅用明确虚构值，不作为正式工作流验收。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("数字人带完整旁白提交、保存屏障、回执播放和重新挂载不重复建单", async () => {
 const bundle = await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {ManhuaPrevisStudioView} from './client/src/components/canvas/ManhuaPrevisStudio';
 import {createManhuaPrevisStudio} from './shared/manhuaPrevis';
 import {newDigitalHumanDraft} from './shared/digitalHumanStudio';
 import {buildDigitalHumanPrevisAudio} from './shared/digitalHumanPrevisAudio';
 const d=newDigitalHumanDraft('test-user','00000000-0000-4000-8000-000000000001');d.script='完整旁白';d.approvedAudioRequestId=d.id;
 d.audios=[{origin:'recording',status:'succeeded',source:'gs://test-only/whole.wav',durationSec:2.4,request:{billingRequestId:d.id,input:d.script,voice:'recorded-narration',speakerZh:'本人',speakerId:'test',voiceStateZh:'实际录音'}}];
 const f=globalThis.f={draft:d,calls:[],failSave:true,receipts:new Map(),saved:null};
 const services={submit:async input=>{f.calls.push(structuredClone(input));const r={jobId:'test-job',status:'succeeded',params:input,output:{...input,gcsUri:'gs://test-only/preview.mp4',url:'https://example.invalid/preview.mp4',durationSec:2.4166666666666665}};f.receipts.set(input.requestId,r);return r;},get:async id=>f.receipts.get(id)||null,list:async()=>({items:[...f.receipts.values()],nextCursor:null})};
 function App(){const [version,setVersion]=React.useState(0);const [block,setBlock]=React.useState({id:'test-clip',prompt:'目标时长：2.4秒',previsStudio:{...createManhuaPrevisStudio(2.4),audioEnabled:true}});f.saved=block;f.remount=()=>setVersion(v=>v+1);return <ManhuaPrevisStudioView key={version} creatorMode block={block} characters={[]} services={services} resolveAudio={spec=>buildDigitalHumanPrevisAudio(f.draft,spec)} beforeSubmit={async()=>{if(f.failSave)throw Error('test-only-cloud-save-failure');}} onChange={studio=>{setBlock(p=>({...p,previsStudio:studio}));return true;}}/>;}
 createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},plugins:[{name:"offline",setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"trpc",namespace:"offline"}));b.onLoad({filter:/.*/,namespace:"offline"},()=>({contents:"export const trpc={};",loader:"js"}));}}],define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,body:''}));
  await page.goto('http://localhost/');await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
  const click=async(text:string)=>page.$$eval('button',(buttons,text)=>{const b=buttons.find(b=>b.textContent?.trim()===text);if(!b)throw Error('未找到'+text);b.click();},text);
  await click('确认生成动作白模');
  await page.waitForFunction(()=>document.body.textContent?.includes('提交结果尚未确认'));
  expect(await page.evaluate(()=>(globalThis as any).f.calls.length)).toBe(0);
  const pending=await page.evaluate(()=>{const f=(globalThis as any).f;f.failSave=false;return f.saved.previsStudio.pending.requestId;});
  await click('确认原请求（不新建编号）');await page.waitForSelector('video');
  expect(await page.evaluate(()=>{const f=(globalThis as any).f;return {count:f.calls.length,id:f.calls[0].requestId,audio:f.calls[0].audio.clips[0],history:f.saved.previsStudio.history.length};})).toEqual({count:1,id:pending,audio:{audioUri:'gs://test-only/whole.wav',sourceStartSec:0,sourceEndSec:2.4,startSec:0,volume:1,fadeInSec:0,fadeOutSec:0},history:1});
  await page.evaluate(()=>(globalThis as any).f.remount());await page.waitForSelector('video');
  expect(await page.evaluate(()=>(globalThis as any).f.calls.length)).toBe(1);
  expect(errors).toEqual([]);
 } finally {await browser.close();}
},30000);
