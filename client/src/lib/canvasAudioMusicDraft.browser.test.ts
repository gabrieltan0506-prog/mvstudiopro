import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("配乐草稿经过真实云草稿清洗，切段及卸载恢复，修改清确认并保留音频",async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
 import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
 import {emptyCanvasAudioStudio,createCanvasAudioCue} from './shared/canvasAudioStudio';
 import {sanitizeManhuaCloudDraftBlock} from './shared/manhuaCloudDraft';
 const f=globalThis.fixture={paid:0,drafts:[]};
 const bgm={...createCanvasAudioCue('bgm','music-a'),takes:[{id:'old-take',gcsUri:'gs://test/old.wav',previewUrl:'https://test.invalid/old.wav',durationSec:5,createdAt:'today',inputKey:'old'}]};
 const services={generateDialogue:async()=>{f.paid++;return {};},getDialogue:async()=>null,draftMusic:async input=>{f.drafts.push(input);return {brief:{model:input.model,custom_mode:true,instrumental:true,style:'弦乐',prompt:'[Intro] '+input.moodArcZh,title:'配乐',duration:input.durationSec,negative_tags:'vocals',style_weight:.7,weirdness_constraint:.2}};},generateMusic:async()=>{f.paid++;return {};},getMusic:async()=>null,listMusic:async()=>[],queuePost:async()=>{f.paid++;return {};},getPost:async()=>null};
 function App(){const [rows,setRows]=useState([1,2].map(ep=>({...defaultCanvasBlock('video',0,0),id:'clip-e0'+ep+'-g01',episodeIndex:ep,videoModel:'seedance-2.5',prompt:'目标时长：15秒',audioStudio:{...emptyCanvasAudioStudio(),cues:[bgm]}})));const [index,setIndex]=useState(0);const [show,setShow]=useState(true);f.rows=rows;f.switch=setIndex;f.show=setShow;return show?<CanvasAudioStudioView block={rows[index]} services={services} bgmModels={[{model:'suno-v6',labelZh:'V6'},{model:'suno-v6-mini',labelZh:'Mini'}]} onChange={audioStudio=>setRows(previous=>previous.map((row,i)=>i===index?sanitizeManhuaCloudDraftBlock(JSON.parse(JSON.stringify({...row,audioStudio}))):row))}/>:null;}
 createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},plugins:[{name:"离线服务",setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"offline",namespace:"offline"}));b.onLoad({filter:/.*/,namespace:"offline"},()=>({contents:"export const trpc={};",loader:"js"}));}}],define:{"process.env.NODE_ENV":'"test"',"import.meta.env":"{}"}});
 const browser=await puppeteer.launch({headless:true});const page=await browser.newPage();
 const clickText=async(text:string)=>page.evaluate(text=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes(text));if(!b)throw Error(text);b.click();},text);
 const open=async()=>page.evaluate(()=>{document.querySelectorAll('details').forEach(d=>d.open=true);});
 try{
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());await page.goto('http://localhost:41821');await page.addScriptTag({content:built.outputFiles[0]!.text});await page.waitForSelector('[aria-label="配乐剧情与情绪推进"]');await open();
 await page.type('[aria-label="配乐剧情与情绪推进"]','追逐转为释然');await page.select('[aria-label="配乐方式"]','suno-v6-mini');
 await page.click('[aria-label="配乐原曲目标时长"]',{clickCount:3});await page.keyboard.type('45');
 await clickText('整理配乐要求');await page.waitForFunction(()=>Boolean((globalThis as any).fixture.rows[0].audioStudio.musicDraft?.brief));
 await clickText('生成这版配乐');expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='确认生成'))).toBe(true);
 await page.type('[aria-label="配乐剧情与情绪推进"]','，保留悬念');
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.trim()==='确认生成'))).toBe(false);
 await clickText('整理配乐要求');await page.waitForFunction(()=>Boolean((globalThis as any).fixture.rows[0].audioStudio.musicDraft?.brief));
 await page.type('[aria-label="配乐生成提示词"]',' [End]');await page.type('[aria-label="配乐音乐风格"]','，低音鼓');
 await page.evaluate(()=>(globalThis as any).fixture.switch(1));await page.waitForFunction(()=>(document.querySelector('[aria-label="配乐剧情与情绪推进"]') as HTMLTextAreaElement)?.value==='');await open();await page.type('[aria-label="配乐剧情与情绪推进"]','第二段独立配乐');
 await page.evaluate(()=>(globalThis as any).fixture.switch(0));await page.waitForFunction(()=>(document.querySelector('[aria-label="配乐剧情与情绪推进"]') as HTMLTextAreaElement)?.value==='追逐转为释然，保留悬念');
 await page.evaluate(()=>(globalThis as any).fixture.show(false));await page.waitForFunction(()=>!document.querySelector('[aria-label="配乐剧情与情绪推进"]'));await page.evaluate(()=>(globalThis as any).fixture.show(true));await page.waitForSelector('[aria-label="配乐剧情与情绪推进"]');
 expect(await page.$eval('[aria-label="配乐剧情与情绪推进"]',e=>(e as HTMLTextAreaElement).value)).toBe('追逐转为释然，保留悬念');expect(await page.$eval('[aria-label="配乐方式"]',e=>(e as HTMLSelectElement).value)).toBe('suno-v6-mini');
 const result=await page.evaluate(()=>(globalThis as any).fixture);expect(result.rows[0].audioStudio.musicDraft.durationSec).toBe(45);expect(result.rows[0].audioStudio.musicDraft.brief.prompt).toContain('[End]');expect(result.rows[0].audioStudio.musicDraft.brief.style).toContain('低音鼓');expect(result.rows[1].audioStudio.musicDraft.prompt).toBe('第二段独立配乐');expect(result.rows[0].audioStudio.cues[0].takes[0].id).toBe('old-take');expect(result.paid).toBe(0);
 }finally{await browser.close();}
},60000);
