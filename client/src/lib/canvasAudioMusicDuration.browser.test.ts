import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("显式原曲21秒覆盖剧情策略余量，真实确认提交仍为21秒",async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
 import {defaultCanvasBlock} from './client/src/lib/canvasTypes';import {emptyCanvasAudioStudio} from './shared/canvasAudioStudio';
 import {buildManhuaBgmBrief} from './shared/manhuaBgmBrief';
 const f=globalThis.fixture={submissions:[]};
 const services={generateDialogue:async()=>({}),getDialogue:async()=>null,draftMusic:async input=>{const brief=buildManhuaBgmBrief(input);f.strategyDuration=brief.duration;return {brief};},generateMusic:async input=>{f.submissions.push(input);return {};},getMusic:async()=>null,listMusic:async()=>[],queuePost:async()=>({}),getPost:async()=>null};
 function App(){const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'clip-e01-g01',videoModel:'seedance-2.5',prompt:'目标时长：21秒',audioStudio:{...emptyCanvasAudioStudio(),musicDraft:{prompt:'追逐后渐弱',durationSec:21,model:'suno-v6',brief:null}}});f.state=block.audioStudio;f.restoreLegacy=()=>setBlock(b=>({...b,audioStudio:{...b.audioStudio,musicDraft:{...b.audioStudio.musicDraft,brief:{...b.audioStudio.musicDraft.brief,duration:24}}}}));return <CanvasAudioStudioView block={block} services={services} onChange={audioStudio=>setBlock(b=>({...b,audioStudio}))}/>;}
 createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},plugins:[{name:"离线服务",setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"offline",namespace:"offline"}));b.onLoad({filter:/.*/,namespace:"offline"},()=>({contents:"export const trpc={};",loader:"js"}));}}],define:{"process.env.NODE_ENV":'"test"',"import.meta.env":"{}"}});
 const browser=await puppeteer.launch({headless:true});const page=await browser.newPage();
 const click=async(text:string)=>page.evaluate(text=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes(text));if(!b)throw Error(text);b.click();},text);
 try{
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await page.goto('http://localhost:41823');await page.addScriptTag({content:built.outputFiles[0]!.text});await page.waitForSelector('[aria-label="配乐原曲目标时长"]');
 expect(await page.$eval('[aria-label="配乐原曲目标时长"]',e=>[e.getAttribute('min'),e.getAttribute('max'),e.getAttribute('step')])).toEqual(['10','360','1']);
 await click('整理配乐要求');await page.waitForFunction(()=>Boolean((globalThis as any).fixture.state.musicDraft.brief));
 expect(await page.evaluate(()=>(globalThis as any).fixture.strategyDuration)).toBe(24);
 expect(await page.evaluate(()=>(globalThis as any).fixture.state.musicDraft.brief.duration)).toBe(21);
 await page.evaluate(()=>(globalThis as any).fixture.restoreLegacy());await page.waitForFunction(()=>(globalThis as any).fixture.state.musicDraft.brief.duration===24);
 await click('生成这版配乐');expect(await page.evaluate(()=>(globalThis as any).fixture.submissions.length)).toBe(0);
 await click('确认生成');await page.waitForFunction(()=>(globalThis as any).fixture.submissions.length===1);
 expect(await page.evaluate(()=>(globalThis as any).fixture.submissions[0].brief.duration)).toBe(21);
 }finally{await browser.close();}
},60000);
