import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import {ManhuaAdvisorPrevisComparison} from './client/src/components/canvas/ManhuaAdvisorPrevisComparison';
import{createManhuaPrevisStudio}from'./shared/manhuaPrevis';
import{makeAdvisorPrevisTarget,prepareAdvisorPrevisTrial,adoptAdvisorPrevisTrial}from'./shared/manhuaAdvisorPrevisEdit';
const f=globalThis.fixture={submits:[],queries:[],writes:[],ready:false};
const studio=createManhuaPrevisStudio(5,'11111111-1111-4111-8111-111111111111');
studio.spec.actors.push({...structuredClone(studio.spec.actors[0]),id:'mother',nameZh:'娘',start:[-1,.65],end:[-1,.65]});
const candidate={target:makeAdvisorPrevisTarget('clip-1',studio),patch:{kind:'previs_edit_v1',summaryZh:'缓推到人物近景',unsupportedZh:[],interactions:[{id:'support',kind:'support_walk',actorId:'actor-1',targetActorId:'mother',startSec:0,contactSec:1,endSec:5}],cameras:studio.spec.cameras.map(c=>({...c,endLens:60}))}};
if(globalThis.unsupportedSourceFixture){studio.advisorShotSource={version:1,clipId:'clip-1',shots:[{index:8,startSec:0,endSec:5,actionZh:'先生取血入碗'}]};candidate.target=makeAdvisorPrevisTarget('clip-1',studio);candidate.patch.shotCoverage=[{index:8,status:'unsupported',actorIds:['actor-1'],reasonZh:'刀刃伤肩与陶碗接触尚不支持'}];}
f.voice={current:null};f.allow=true;window.confirm=()=>f.allow;f.studio=studio;f.original=JSON.stringify(studio);f.videoSources=[];
f.response=request=>({jobId:'previs-test-job',status:f.failed?'failed':f.ready?'succeeded':'queued',params:request,output:f.ready?{requestId:request.requestId,clipId:request.clipId,gcsUri:'gs://test/preview.mp4',url:'/api/manhua-previs-media/test/preview',durationSec:5}:null});
createRoot(document.getElementById('root')).render(<ManhuaAdvisorPrevisComparison voiceControl={f.voice} candidate={candidate} onPreviewReady={source=>f.videoSources.push(source)} storageKey='test:trial' previewHost={document.getElementById('preview')} autoStart onPrepare={c=>prepareAdvisorPrevisTrial('clip-1',f.studio,c)} onApply={(trial,res)=>{f.studio=adoptAdvisorPrevisTrial('clip-1',f.studio,trial,res);f.writes.push(trial.request.requestId);return true;}}/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "离线白模确认门", setup(b) {
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" }));
    b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: `export const trpc={manhuaPrevis:{submit:{useMutation:()=>({isPending:false,mutateAsync:async r=>{const f=globalThis.fixture;f.submits.push(r);return f.response(r);}})}},useUtils:()=>({manhuaPrevis:{get:{fetch:async({requestId})=>{const f=globalThis.fixture;f.queries.push(requestId);const r=JSON.parse(localStorage.getItem('test:trial:'+requestId)).request;return f.response(r);}}}})};` }));
  } }], define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" } });
  bundle = result.outputFiles[0]!.text; browser = await puppeteer.launch({ headless: true, ...(process.getuid?.() === 0 ? { args: ["--no-sandbox"] } : {}) });
}, 30000);
afterAll(async () => { await browser?.close(); });
it("独立渲染和刷新不写原场景；观看并确认后才允许应用真实回执", async () => {
  const page = await browser.newPage(); await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<main id="preview" data-clip-id="clip-1"></main><div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41828/"); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => (globalThis as any).fixture.submits.length === 1);
  expect(await page.evaluate(() => (globalThis as any).fixture.writes)).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify((globalThis as any).fixture.studio) === (globalThis as any).fixture.original)).toBe(true);
  expect(await page.evaluate(() => (globalThis as any).fixture.submits[0].spec.interactions[0].kind)).toBe("support_walk");
  const id = await page.evaluate(() => (globalThis as any).fixture.submits[0].requestId);
  await page.reload(); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => (globalThis as any).fixture.queries.length > 0);
  expect(await page.evaluate(() => (globalThis as any).fixture.submits)).toEqual([]);
  expect(await page.evaluate(() => (globalThis as any).fixture.queries)).toEqual([id]);
  await page.evaluate(() => { (globalThis as any).fixture.ready = true; const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '查询／恢复这次白模试看'); b?.click(); });
  await page.waitForSelector('video[aria-label="顾问独立白模试看"]');
  expect(await page.evaluate(() => (globalThis as any).fixture.submits[0].requestId)).toBe(id);
  expect(await page.evaluate(() => (globalThis as any).fixture.videoSources.at(-1))).toMatchObject({ requestId: id, target: { clipId: "clip-1" } });
  expect(await page.evaluate(() => JSON.parse((globalThis as any).fixture.videoSources.at(-1).specJson).cameras[0].endLens)).toBe(60);
  expect(await page.evaluate(() => (globalThis as any).fixture.writes)).toEqual([]);
  expect(await page.$('#preview video')).not.toBeNull();
  expect(await page.$('#root video')).toBeNull();
  expect(await page.$('a[target="_blank"]')).toBeNull();
  expect(await page.$eval('input[type="checkbox"]', e => (e as HTMLInputElement).disabled)).toBe(true);
  // 开发夹具仅派发播放事件测试确认门；不宣称真实视频已播放或审片。
  await page.$eval('video', e => e.dispatchEvent(new Event('play', { bubbles: true })));
  await page.waitForFunction(() => !(document.querySelector('input[type="checkbox"]') as HTMLInputElement).disabled);
  await page.click('input[type="checkbox"]');
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '应用这版到工作流')?.click());
  await page.waitForFunction(() => (globalThis as any).fixture.writes.length === 1);
  expect(await page.evaluate(() => (globalThis as any).fixture.studio.history[0].requestId)).toBe(id);
  expect(await page.evaluate(() => (globalThis as any).fixture.studio.spec.interactions[0].kind)).toBe("support_walk");
  expect(await page.evaluate(() => (globalThis as any).fixture.studio.specHistory[0].reasonZh)).toContain(id);
  await page.close();
}, 20000);

it("语音采用白模使用真实回执和观看确认，取消不写，重复采用不重写", async()=>{
 const context=await browser.createBrowserContext();const page=await context.newPage();await page.setRequestInterception(true);
 page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<main id="preview" data-clip-id="clip-1"></main><div id="root"></div>'}):void r.abort());
 await page.goto('http://localhost:41828/');await page.addScriptTag({content:bundle});await page.waitForFunction(()=>(globalThis as any).fixture.submits.length===1);
 expect(await page.evaluate(()=>(globalThis as any).fixture.voice.current.apply())).toContain('先在本页观看');
 await page.evaluate(()=>{(globalThis as any).fixture.ready=true;Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='查询／恢复这次白模试看')?.click()});await page.waitForSelector('video');
 await page.$eval('video',e=>e.dispatchEvent(new Event('play',{bubbles:true})));await page.waitForFunction(()=>(globalThis as any).fixture.voice.current.inspect().watched);
 await page.evaluate(()=>(globalThis as any).fixture.allow=false);expect(await page.evaluate(()=>(globalThis as any).fixture.voice.current.apply())).toContain('取消');expect(await page.evaluate(()=>(globalThis as any).fixture.writes.length)).toBe(0);
 await page.evaluate(()=>(globalThis as any).fixture.allow=true);expect(await page.evaluate(()=>(globalThis as any).fixture.voice.current.apply())).toContain('已应用');await page.waitForFunction(()=>(globalThis as any).fixture.voice.current.inspect().applied);
 expect(await page.evaluate(()=>(globalThis as any).fixture.voice.current.apply())).toContain('不重复');expect(await page.evaluate(()=>(globalThis as any).fixture.writes.length)).toBe(1);expect(await page.evaluate(()=>(globalThis as any).fixture.studio.specHistory.length)).toBeGreaterThan(0);
 await context.close();
},20000);

it("明确失败的白模可确认重试，原任务保留，取消和运行中不重提",async()=>{
 const context=await browser.createBrowserContext();const page=await context.newPage();await page.setRequestInterception(true);
 page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<main id="preview" data-clip-id="clip-1"></main><div id="root"></div>'}):void r.abort());
 try{await page.goto('http://localhost:41828/');await page.addScriptTag({content:bundle});await page.waitForFunction(()=>(globalThis as any).fixture.submits.length===1);
 expect(await page.evaluate(()=>(globalThis as any).fixture.voice.current.retry())).toContain('只有已明确失败');
 await page.evaluate(()=>{const f=(globalThis as any).fixture;f.failed=true;Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='查询／恢复这次白模试看')?.click()});
 await page.waitForFunction(()=>(globalThis as any).fixture.voice.current.inspect().failed);
 const before=await page.evaluate(()=>(globalThis as any).fixture.submits.map((r:any)=>r.requestId));
 await page.evaluate(()=>(globalThis as any).fixture.allow=false);expect(await page.evaluate(()=>(globalThis as any).fixture.voice.current.retry())).toContain('取消');
 expect(await page.evaluate(()=>(globalThis as any).fixture.submits.length)).toBe(before.length);
 await page.evaluate(()=>{const f=(globalThis as any).fixture;f.allow=true;const original=f.response;f.response=(r:any)=>({...original(r),status:r.requestId===f.submits[0].requestId?'failed':'queued'})});
 await page.evaluate(()=>(globalThis as any).fixture.voice.current.retry());await page.waitForFunction(()=>(globalThis as any).fixture.voice.current.inspect().failed===false);
 const after=await page.evaluate(()=>(globalThis as any).fixture.submits.map((r:any)=>r.requestId));expect(after.length).toBe(before.length+1);expect(after.at(-1)).not.toBe(before[0]);
 expect(await page.evaluate((id)=>Boolean(localStorage.getItem('test:trial:'+id)),before[0])).toBe(true);expect(await page.evaluate(()=>(globalThis as any).fixture.writes)).toEqual([]);
 }finally{await context.close()}
},20000);


it("逐镜能力不足直接显示原因并阻止自动试看，原场景不变", async () => {
 const context = await browser.createBrowserContext(); const page = await context.newPage(); await page.setRequestInterception(true);
 page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<main id="preview" data-clip-id="clip-1"></main><div id="root"></div>' }) : void r.abort());
 try {
  await page.goto("http://localhost:41828/");
  await page.evaluate(() => { (globalThis as any).unsupportedSourceFixture = true; });
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => document.body.textContent?.includes("镜8：刀刃伤肩与陶碗接触尚不支持"));
  expect(await page.evaluate(() => (globalThis as any).fixture.submits)).toEqual([]);
  expect(await page.evaluate(() => (globalThis as any).fixture.writes)).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify((globalThis as any).fixture.studio) === (globalThis as any).fixture.original)).toBe(true);
 } finally { await context.close(); }
}, 20000);
