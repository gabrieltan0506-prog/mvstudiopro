import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { readFileSync } from "node:fs";
import { compile } from "tailwindcss";

let browser: Browser;
let bundle: string;
let stylesheet: string;
beforeAll(async () => {
 const result = await build({
  stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
   import React,{useState} from 'react';
   import {createRoot} from 'react-dom/client';
   import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
   import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
   import {emptyCanvasAudioStudio,createCanvasAudioCue,canvasAudioCueInputKey,canvasAudioMixSource,compileCanvasAudioBindings,assertCanvasAudioMasterCurrent} from './shared/canvasAudioStudio';
   const f=globalThis.fixture={calls:[],state:null};
   const dialogue={...createCanvasAudioCue('dialogue','line-ajing'),speakerZh:'阿菁',textZh:'门外是谁？',voice:'longanlufeng',shotZh:'门外反应',startSec:0,endSec:3,approved:true,selectedTakeId:'take-a'};
   dialogue.takes=[{id:'take-a',previewUrl:'https://audio.test/line.mp3',gcsUri:'gs://test/line.mp3',durationSec:2,createdAt:'2026-09-20',inputKey:canvasAudioCueInputKey(dialogue)}];
   const bgm={...createCanvasAudioCue('bgm','music-a'),shotZh:'进入门厅'};
   const sfx={...createCanvasAudioCue('sfx','door-a'),shotZh:'推门声'};
   for(const cue of [bgm,sfx]){cue.source={gcsUri:'gs://test/'+cue.id+'-source.mp3',previewUrl:'https://audio.test/'+cue.id+'-source.mp3',durationSec:10,labelZh:'已上传原音'};cue.sourceStartSec=0;cue.sourceEndSec=2;cue.approved=true;cue.selectedTakeId=cue.id+'-take-1';cue.takes=[1,2].map(index=>({id:cue.id+'-take-'+index,gcsUri:'gs://test/'+cue.id+'-'+index+'.mp3',previewUrl:'https://audio.test/'+cue.id+'-'+index+'.mp3',durationSec:2,createdAt:'2026-09-20',inputKey:canvasAudioCueInputKey(cue)}));}
   const oldMaster={gcsUri:'gs://test/master.wav',audioStudioSource:canvasAudioMixSource([bgm,dialogue,sfx],15)};
   f.compile=()=>{let masterError='';try{assertCanvasAudioMasterCurrent(oldMaster,f.state,15);}catch(e){masterError=e.message;}return {bindings:compileCanvasAudioBindings({studio:f.state,existingAudioUrls:[],durationSec:15}),masterError};};
   const services={generateDialogue:async input=>{f.calls.push(input);return {};},getDialogue:async()=>null,draftMusic:async input=>{f.calls.push(input);return {};},generateMusic:async input=>{f.calls.push(input);return {};},getMusic:async()=>null,listMusic:async()=>[],queuePost:async input=>{f.calls.push(input);return {};},getPost:async()=>null};
   function App(){const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'clip-e01-s01-layout',episodeIndex:1,videoModel:'seedance-2.5',prompt:'目标时长：15秒。阿菁推开门，门外传来脚步。',outputUrl:'https://video.test/current.mp4',manhuaSegmentRefs:{master:oldMaster},audioStudio:{...emptyCanvasAudioStudio(),cues:[bgm,dialogue,sfx]}});f.state=block.audioStudio;return <CanvasAudioStudioView block={block} services={services} onChange={audioStudio=>setBlock(b=>({...b,audioStudio}))}/>;}
   createRoot(document.getElementById('root')).render(<App/>);
  ` },
  bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",
  alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},
  plugins:[{name:"离线请求边界",setup(builder){builder.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"offline-trpc",namespace:"offline"}));builder.onLoad({filter:/.*/,namespace:"offline"},()=>({contents:"export const trpc = {};",loader:"js"}));}}],
  define:{"process.env.NODE_ENV":'"test"',"import.meta.env":"{}"},
 });
 bundle=result.outputFiles[0]!.text;
 const layoutSources = ["client/src/components/canvas/CanvasAudioStudio.tsx", "client/src/components/canvas/CanvasAudioMixControls.tsx"].map(file => readFileSync(file, "utf8")).join("\n");
 const candidates = Array.from(layoutSources.matchAll(/"([^"\n]*)"/g)).flatMap(match => match[1].split(/\s+/));
 const compiler = await compile(readFileSync("node_modules/tailwindcss/theme.css", "utf8") + "\n" + readFileSync("node_modules/tailwindcss/preflight.css", "utf8") + "\n@tailwind utilities;");
 stylesheet = compiler.build(candidates);

 browser=await puppeteer.launch({headless:true});
},180_000);
afterAll(async()=>{await browser?.close();});

it("配音与背景音乐界面不展示模型名称且查看设置不会生成", async () => {
 const context = await browser.createBrowserContext();
 const page = await context.newPage();
 try {
  await page.setRequestInterception(true);
  page.on("request", request => void request.abort());
  await page.setContent('<div id="root"></div>');
  await page.addStyleTag({ content: stylesheet });
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[data-manhua-audio-editor]');
  expect(await page.$eval('body', el => el.textContent)).toContain("配音与背景音乐");
  expect(await page.$eval('body', el => el.textContent)).not.toMatch(/TTS|Suno|Qwen|TTAPI|Seedance|Mureka|WaveSpeed|EvoLink/i);
  expect(await page.$('[aria-label="配乐来源"]')).toBeNull();
  expect(await page.$$eval('[aria-label="配乐方式"] option', options => options.map(option => [(option as HTMLOptionElement).value, option.textContent]))).toEqual([
    ["suno-v6", "标准配乐"], ["suno-v6-wild", "探索配乐（实验）"], ["suno-v6-mini", "快速配乐"],
  ]);
  await page.click('[aria-label="声音制作快捷入口"] button:nth-child(2)');
  expect(await page.$eval('[data-audio-group="bgm"]', el => el.getBoundingClientRect().top)).toBeLessThan(100);
  expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([]);
  await page.click('[aria-label="生成第2句配音"]');
  await page.waitForSelector('[aria-label="确认音频费用"]');
  expect(await page.$eval('[aria-label="确认音频费用"]', el => el.textContent)).toContain("阿菁：门外是谁？");
  expect(await page.$eval('[aria-label="确认音频费用"]', el => el.getBoundingClientRect().bottom)).toBeLessThanOrEqual(601);
  expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([]);
 } finally { await context.close(); }
}, 20_000);

it("真实声音面板按种类分组、采用状态随原handler变化，不更换cue身份或额外付费",async()=>{
 const context=await browser.createBrowserContext();const page=await context.newPage();const errors:string[]=[];page.on("pageerror",e=>errors.push(String(e)));
 try {
  await page.setRequestInterception(true);
  page.on("request",request=>{if(request.isNavigationRequest())void request.respond({status:200,contentType:"text/html",body:'<html><link rel="icon" href="data:,"><div id="root"></div></html>'});else void request.abort();});
  await page.goto("http://localhost:41812");await page.addStyleTag({content:stylesheet});await page.addScriptTag({content:bundle});await page.waitForSelector('[data-audio-group="dialogue"] [data-cue-id="line-ajing"]');
  expect(await page.$eval('video[aria-label="当前片段画面"]',el=>el.getAttribute("src"))).toBe("https://video.test/current.mp4");
  expect(await page.$$eval('[data-audio-group]',els=>els.map(el=>[el.getAttribute("data-audio-group"),Array.from(el.querySelectorAll('[data-cue-id]')).map(row=>row.getAttribute("data-cue-id"))]))).toEqual([["dialogue",["line-ajing"]],["bgm",["music-a"]],["sfx",["door-a"]]]);
  expect(await page.$eval('[aria-label="角色配音摘要"]',el=>el.textContent)).toContain("已采用 1 句");
  expect(await page.$eval('[data-cue-id="line-ajing"]',el=>el.textContent)).toContain("已采用");
  expect(await page.$eval('[data-audio-group="bgm"]',el=>el.textContent)).toContain("生成配乐原曲");
  const originalDialogue = await page.evaluate(() => (window as any).fixture.state.cues[1]);
  await page.click('[aria-label="1 镜头与动作"]', { clickCount: 3 });
  await page.type('[aria-label="1 镜头与动作"]', "门厅停步后配乐进入");
  await page.$$eval('[data-cue-id="music-a"] button', elements => { const buttons = elements.filter(element => element.textContent?.includes("试听后确认本段")); (buttons[1] as HTMLButtonElement).click(); });
  await page.click('[aria-label="3 片内开始秒"]', { clickCount: 3 });
  await page.type('[aria-label="3 片内开始秒"]', "3");
  await page.$$eval('[data-cue-id="door-a"] button', elements => { const button = elements.find(element => element.textContent?.includes("试听后确认本段")); (button as HTMLButtonElement).click(); });
  await page.waitForFunction(() => (window as any).fixture.state.cues[2].approved);
  expect(await page.evaluate(() => (window as any).fixture.state.cues[1])).toEqual(originalDialogue);
  const consumed = await page.evaluate(() => (window as any).fixture.compile());
  expect(consumed.bindings.audioUrls).toContain("gs://test/music-a-2.mp3");
  expect(consumed.bindings.audioUrls).toContain("gs://test/door-a-1.mp3");
  expect(consumed.bindings.promptAppendix).toContain("门厅停步后配乐进入");
  expect(consumed.bindings.promptAppendix).toContain("3.000秒触发");
  expect(consumed.bindings.promptAppendix).toContain("阿菁");
  expect(consumed.masterError).toContain("预混母轨仍为旧版");
  expect(await page.$eval('[aria-label="逐句配音、配乐与事件音效"]', el => el.textContent)).toContain("当前母轨与声音配置不一致");
  for (const width of [1280, 390]) {
   await page.setViewport({ width, height: 900 });
   const geometry = await page.$eval('[data-manhua-sound-summary]', el => ({ columns: getComputedStyle(el).gridTemplateColumns.split(" ").length, viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
   expect(geometry.columns).toBe(width >= 1024 ? 3 : 1);
   expect(geometry.page).toBeLessThanOrEqual(geometry.viewport + 1);
   await page.screenshot({ path: `/tmp/0920-audio-layout-${width}.png`, fullPage: true });
  }
  await page.click('[aria-label="2 说话角色"]',{clickCount:3});await page.type('[aria-label="2 说话角色"]',"墨屠");
  await page.waitForFunction(()=>document.querySelector('[aria-label="角色配音摘要"]')?.textContent?.includes("已采用 0 句"));
  expect(await page.evaluate(()=>(window as any).fixture.state.cues.map((cue:any)=>[cue.id,cue.speakerZh]))).toContainEqual(["line-ajing","墨屠"]);
  await page.$eval('[data-audio-group="sfx"] header button',el=>(el as HTMLButtonElement).click());
  await page.waitForFunction(()=>(window as any).fixture.state.cues.length===4);
  expect(await page.evaluate(()=>(window as any).fixture.state.cues[3].kind)).toBe("sfx");
  expect(await page.$$('[data-audio-group="sfx"] [data-cue-id]')).toHaveLength(2);
  expect(await page.evaluate(()=>(window as any).fixture.calls)).toEqual([]);
  expect(errors).toEqual([]);
 }finally{await context.close();}
},60_000);
