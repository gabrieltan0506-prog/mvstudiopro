import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { build as viteBuild } from "vite";
import tailwindcss from "@tailwindcss/vite";
let browser: Browser;
let bundle: string;
let productionCss: string;
beforeAll(async () => {
  const result = await build({ loader: { ".css": "empty" }, stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
import {ManhuaPrevisAudioControls} from './client/src/components/canvas/ManhuaPrevisAudioControls';
import {checkManhuaAdvisorPrevisLaunch} from './client/src/lib/manhuaAdvisorPrevisLaunch';
import {buildManhuaPrevisAudio} from './shared/manhuaPrevisAudio';
import {createCanvasAudioCue,canvasAudioCueInputKey,emptyCanvasAudioStudio} from './shared/canvasAudioStudio';
import {ManhuaSecondaryStudioSurface as Surface} from './client/src/components/canvas/ManhuaSecondaryStudioSurface';
import{createManhuaPrevisStudio}from'./shared/manhuaPrevis';
import{makeAdvisorPrevisTarget,prepareAdvisorPrevisTrial}from'./shared/manhuaAdvisorPrevisEdit';
const f=globalThis.fixture={asks:[],renders:[],writes:[]};const studio=createManhuaPrevisStudio(5);f.studio=studio;
function App(){const[open,setOpen]=useState(true);const[host,setHost]=useState(null);const[previewHost,setPreviewHost]=useState(null);f.setOpen=setOpen;const[live,setLive]=useState({id:'clip-1',previsStudio:studio});f.live=live;f.bindAudio=()=>{const bgm={...createCanvasAudioCue('bgm','bgm-test'),endSec:5,approved:true,selectedTakeId:'chosen',shotZh:'人物对视'};bgm.takes=[{id:'chosen',gcsUri:'gs://test/selected.wav',previewUrl:'https://example.test/selected.wav',durationSec:5,createdAt:'test',inputKey:canvasAudioCueInputKey(bgm)}];setLive(b=>({...b,audioStudio:{...emptyCanvasAudioStudio(),cues:[bgm]}}))};return <><Surface immersive clipId='clip-1' title='本段动作白模' advisorOpen={open} onAdvisorDockChange={setHost} onPreviewHostChange={setPreviewHost} onOpenAdvisor={()=>setOpen(true)} onClose={()=>{}}><div data-scene-view>原有3D场景与白模预览</div></Surface><Panel dockHost={host} previewHost={previewHost} open={open} userId='1' confirmedProjectVersion='iteration-test' onClose={()=>setOpen(false)} templates={[]} onRequestTrial={()=>{}} previsTarget={makeAdvisorPrevisTarget('clip-1',live.previsStudio)} previsLabel='第1集 · 第1段 · 5秒' previsLaunchIssue={checkManhuaAdvisorPrevisLaunch(live)} onCheckPrevisReady={c=>checkManhuaAdvisorPrevisLaunch(live,c)} previsAudioControls={<ManhuaPrevisAudioControls compact block={live} onChange={previsStudio=>setLive(b=>({...b,previsStudio}))}/>} onPreparePrevis={c=>{const t=prepareAdvisorPrevisTrial('clip-1',live.previsStudio,c);if(live.previsStudio.audioEnabled===true)t.request.audio=buildManhuaPrevisAudio(live.audioStudio,t.request.spec);return t;}} onApplyPrevis={t=>{f.writes.push(t);return true;}} project={{context:{seriesTitle:'墨菁传',episodeIndex:1,episodeTitle:'入市',stage:'storyboard',videoModel:'未选择',writerConfirmed:true,episodeBody:'曹三逼近，阿菁挡在马前。',assetSummary:'',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'第1段'}}/></>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "多轮顾问离线边界", setup(b) {
    b.onResolve({ filter: /^@\/lib\/manhuaAdvisorStream$/ }, () => ({ path: "stream", namespace: "stream-test" }));
    b.onLoad({ filter: /.*/, namespace: "stream-test" }, () => ({ loader: "js", contents: `import {trpc} from '@/lib/trpc';export async function streamManhuaAdvisor(input,onText,onModel){onModel?.('DeepSeek V4.1 Flash · OpenRouter');onText('正在逐步输出调度建议');await new Promise(r=>setTimeout(r,30));return trpc.mvAnalysis.askPlatformSkillQa.useMutation().mutateAsync(input);}` }));
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" }));
    b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: `export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:8,exempt:false},isError:false,refetch:async()=>({})})},askPlatformSkillQa:{useMutation:()=>({isPending:false,mutateAsync:async input=>{const f=globalThis.fixture;f.asks.push(input);if(f.requirePaid&&!input.confirmPaid)throw new Error("今日标准顾问免费5次已用完。继续将扣除8积分/次，请确认后重试。");const spec=JSON.parse(input.manhuaContext.previsEdit.specJson);return{answer:JSON.stringify({kind:'previs_edit_v1',summaryZh:f.asks.length===1?'先缓推强化威胁，再看阿菁反应':'保留缓推，减小推近幅度',unsupportedZh:[],cameras:spec.cameras.map(c=>({...c,endLens:f.asks.length===1?60:50}))}),remainingFreeToday:5-f.asks.length,paidUnitCredits:8};}})}},manhuaPrevis:{submit:{useMutation:()=>({isPending:false,mutateAsync:async r=>{const f=globalThis.fixture;f.renders.push(r);return{jobId:'test-render',status:f.ready?'succeeded':'queued',params:r,output:f.ready?{requestId:r.requestId,clipId:r.clipId,gcsUri:'gs://test/preview.mp4',url:'/api/manhua-previs-media/test/preview',durationSec:r.spec.durationSec}:null};}})}},useUtils:()=>({manhuaPrevis:{get:{fetch:async()=>null}}})};` }));
  } }], define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" } });
  const cssBuild = await viteBuild({ configFile: false, plugins: [tailwindcss()], build: { write: false, rollupOptions: { input: path.resolve("client/src/index.css") } } });
  const outputs = Array.isArray(cssBuild) ? cssBuild.flatMap(o => o.output) : "output" in cssBuild ? cssBuild.output : [];
  productionCss = outputs.filter(o => o.type === "asset" && o.fileName.endsWith(".css")).map(o => o.type === "asset" ? String(o.source) : "").join("\n");
  if (!productionCss) throw new Error("实际样式未编译，无法验证短窗口布局");
  bundle = result.outputFiles[0]!.text; browser = await puppeteer.launch({ headless: true, ...(process.getuid?.() === 0 ? { args: ["--no-sandbox"] } : {}) });
}, 30000);
afterAll(async () => { await browser?.close(); });
it("先提案不自动渲染，追问继承上版，用户选定后才渲染，收起重开不重建任务", async () => {
  const page = await browser.newPage(); page.setDefaultTimeout(5000); await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41829/"); await page.evaluate(() => localStorage.clear()); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('textarea[aria-label="向创作顾问提问"]');
  expect(await page.$eval('[data-manhua-creative-advisor]', e => Boolean(e.closest('[role=region][aria-label="本段动作白模"]')))).toBe(true);
  expect(await page.$('[data-scene-view]')).not.toBeNull();
  expect(await page.$eval('[aria-label="本作品咨询额度"]', e => e.textContent)).toContain("本作品免费剩余 5/5 次");
  await page.type('textarea', '曹三逼近时加强压迫感'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.textContent?.includes('先缓推强化威胁'));
  expect(await page.$('[data-scene-view]')).not.toBeNull();
  expect(await page.$eval('[data-manhua-creative-advisor]', e => e.textContent)).not.toMatch(/DeepSeek|OpenRouter|EvoLink|GLM/);
  expect(await page.evaluate(() => (globalThis as any).fixture.renders.length)).toBe(0);
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '继续修改这版方案')?.click());
  await page.type('textarea', '镜头不要推得太近'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.textContent?.includes('保留缓推，减小推近幅度'));
  expect(await page.evaluate(() => JSON.parse((globalThis as any).fixture.asks[1].manhuaContext.previsEdit.previousPreviewSpecJson).cameras[0].endLens)).toBe(60);
  expect(await page.evaluate(() => (globalThis as any).fixture.renders.length)).toBe(0);
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '生成白模视频试看')?.click());
  await page.waitForFunction(() => (globalThis as any).fixture.renders.length === 1);
  expect(await page.evaluate(() => (globalThis as any).fixture.renders[0].spec.cameras[0].endLens)).toBe(50);
  expect(await page.evaluate(() => (globalThis as any).fixture.writes)).toEqual([]);
  await page.evaluate(() => (globalThis as any).fixture.setOpen(false));
  await page.waitForFunction(() => { const panel = document.querySelector('[data-manhua-creative-advisor]') as HTMLElement | null; return !panel || panel.hidden; });
  await page.evaluate(() => (globalThis as any).fixture.setOpen(true));
  await page.waitForSelector('[data-manhua-creative-advisor]');
  expect(await page.evaluate(() => (globalThis as any).fixture.renders.length)).toBe(1);
  await page.close();
}, 20000);

it("实际样式下343像素顾问栏始终显示输入和生成按钮，长说明只在历史区滚动", async () => {
  const page = await browser.newPage(); await page.setViewport({ width: 1280, height: 720 });
  await page.setRequestInterception(true); page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41829/"); await page.evaluate(() => localStorage.clear());
  await page.addStyleTag({ content: productionCss + "\n[data-manhua-advisor-dock]{height:343px !important;}" });
  await page.addScriptTag({ content: bundle });
  try {
    await page.waitForSelector('[data-advisor-composer] textarea');
    await page.type('textarea', '先只讨论镜头，不生成视频'); await page.keyboard.press('Enter');
    await page.waitForSelector('[aria-label="白模调度修改对比"]');
    const geometry = await page.evaluate(() => {
      const panel=document.querySelector('[data-manhua-creative-advisor]')!.getBoundingClientRect();
      const input=document.querySelector('textarea')!.getBoundingClientRect();
      const button=document.querySelector('[data-advisor-previs-actions] button')!.getBoundingClientRect();
      const footer=document.querySelector('[data-advisor-composer]') as HTMLElement;
      return { height:panel.height,inputVisible:input.top>=panel.top&&input.bottom<=panel.bottom,buttonVisible:button.top>=input.bottom&&button.bottom<=panel.bottom,footerOverflow:footer.scrollHeight-footer.clientHeight };
    });
    expect(geometry).toMatchObject({ height:343,inputVisible:true,buttonVisible:true }); expect(geometry.footerOverflow).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => (globalThis as any).fixture.renders)).toEqual([]);
  } finally { await page.close(); }
}, 20000);

it("默认无声；勾选空音轨在请求前阻断，取消后点击生成按钮直接提交无声试看", async () => {
  const page=await browser.newPage(); await page.setRequestInterception(true);
  page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
  await page.goto('http://localhost:41829/');await page.evaluate(()=>localStorage.clear());await page.addScriptTag({content:bundle});
  try {
    await page.waitForSelector('[aria-label="白模带上已采用的对白与BGM"]');
    expect(await page.$eval('[aria-label="白模带上已采用的对白与BGM"]',e=>(e as HTMLInputElement).checked)).toBe(false);
    await page.click('[aria-label="白模带上已采用的对白与BGM"]');
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成白模视频试看')?.disabled===true);
    expect(await page.$eval('[aria-label="白模生成步骤"]',e=>e.textContent)).toContain('本段尚未配置音轨');
    expect(await page.evaluate(()=>(globalThis as any).fixture.asks)).toEqual([]);
    expect(await page.evaluate(()=>(globalThis as any).fixture.renders)).toEqual([]);
    await page.click('[aria-label="白模带上已采用的对白与BGM"]');
    await page.type('textarea','先只讨论镜头');
    await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成白模视频试看')?.click());
    await page.waitForFunction(()=>(globalThis as any).fixture.renders.length===1);
    expect(await page.evaluate(()=>(globalThis as any).fixture.renders[0].audio)).toBeUndefined();
    expect(await page.evaluate(()=>(globalThis as any).fixture.writes)).toEqual([]);
  } finally { await page.close(); }
},20000);

it("无声试看后用户绑定音轨，再次生成的新请求带真实已采用音轨且保留原试看",async()=>{
  const page=await browser.newPage();await page.setRequestInterception(true);
  page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
  await page.goto('http://localhost:41829/');await page.evaluate(()=>localStorage.clear());await page.addScriptTag({content:bundle});
  try{
    await page.waitForSelector('textarea');await page.evaluate(()=>{(globalThis as any).fixture.ready=true;Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成白模视频试看')?.click()});
    await page.waitForSelector('video[aria-label="顾问独立白模试看"]');
    const first=await page.evaluate(()=>(globalThis as any).fixture.renders[0].requestId);
    await page.click('[aria-label="白模带上已采用的对白与BGM"]');
    expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='按当前音轨选择生成新试看')?.disabled)).toBe(true);
    await page.evaluate(()=>(globalThis as any).fixture.bindAudio());
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='按当前音轨选择生成新试看')?.disabled===false);
    await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='按当前音轨选择生成新试看')?.click());
    await page.waitForFunction(()=>(globalThis as any).fixture.renders.length===2);
    expect(await page.evaluate(()=>(globalThis as any).fixture.renders[1].requestId)).not.toBe(first);
    expect(await page.evaluate(()=>(globalThis as any).fixture.renders[1].audio)).toMatchObject({bgmCount:1,dialogueCount:0,clips:[expect.objectContaining({audioUri:'gs://test/selected.wav',startSec:0,sourceEndSec:5})]});
    expect(await page.evaluate(first=>Object.keys(localStorage).some(key=>key.endsWith(first)),first)).toBe(true);
    expect(await page.evaluate(()=>(globalThis as any).fixture.writes)).toEqual([]);
  }finally{await page.close()}
},20000);

it("白模内的摄影氛围表演咨询不会自动生成试看", async () => {
  const page = await browser.newPage(); await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41829/"); await page.evaluate(() => localStorage.clear()); await page.addScriptTag({ content: bundle });
  try {
    await page.waitForSelector('textarea');
    await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '优化摄影、氛围与表演')?.click());
    await page.waitForFunction(() => (document.querySelector('textarea') as HTMLTextAreaElement)?.value.includes('喜怒哀乐'));
    expect(await page.evaluate(() => (globalThis as any).fixture.asks)).toHaveLength(0);
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.body.textContent?.includes('先缓推强化威胁'));
    expect(await page.evaluate(() => (globalThis as any).fixture.asks[0].rawQuestion)).toContain('场景氛围');
    expect(await page.evaluate(() => (globalThis as any).fixture.asks[0].manhuaContext.previsEdit.clipId)).toBe('clip-1');
    expect(await page.evaluate(() => (globalThis as any).fixture.renders)).toHaveLength(0);
    expect(await page.evaluate(() => (globalThis as any).fixture.writes)).toEqual([]);
  } finally { await page.close(); }
}, 20000);

it("付费提示必须先展示明确积分，用户确认才带同额授权，取消不再次提交", async () => {
  const page = await browser.newPage(); await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41829/"); await page.evaluate(() => localStorage.clear()); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('textarea');
  await page.evaluate(() => { (globalThis as any).fixture.requirePaid = true; });
  await page.type('textarea', '先收紧曹三的威胁镜头'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.textContent?.includes('确认支付 8 积分并继续'));
  expect(await page.evaluate(() => (globalThis as any).fixture.asks)).toHaveLength(1);
  expect(await page.evaluate(() => (globalThis as any).fixture.asks[0].confirmPaid)).toBeUndefined();
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '取消')?.click());
  expect(await page.evaluate(() => (globalThis as any).fixture.asks)).toHaveLength(1);
  await page.type('textarea', '先收紧曹三的威胁镜头'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.textContent?.includes('确认支付 8 积分并继续'));
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '确认支付 8 积分并继续')?.click());
  await page.waitForFunction(() => (globalThis as any).fixture.asks.length === 3);
  expect(await page.evaluate(() => (globalThis as any).fixture.asks[2])).toMatchObject({ confirmPaid: true, confirmedCredits: 8 });
  expect(await page.evaluate(() => (globalThis as any).fixture.asks[2].requestId)).toBe(await page.evaluate(() => (globalThis as any).fixture.asks[1].requestId));
  expect(await page.evaluate(() => (globalThis as any).fixture.renders)).toHaveLength(0);
  await page.close();
}, 20000);
