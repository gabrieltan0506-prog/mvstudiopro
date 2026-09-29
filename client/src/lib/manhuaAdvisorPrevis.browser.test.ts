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
const candidate={target:makeAdvisorPrevisTarget('clip-1',studio),patch:{kind:'previs_edit_v1',summaryZh:'缓推到人物近景',unsupportedZh:[],cameras:studio.spec.cameras.map(c=>({...c,endLens:60}))}};
f.studio=studio;f.original=JSON.stringify(studio);f.videoSources=[];
f.response=request=>({jobId:'previs-test-job',status:f.ready?'succeeded':'queued',params:request,output:f.ready?{requestId:request.requestId,clipId:request.clipId,gcsUri:'gs://test/preview.mp4',url:'/api/manhua-previs-media/test/preview',durationSec:5}:null});
createRoot(document.getElementById('root')).render(<ManhuaAdvisorPrevisComparison candidate={candidate} onPreviewReady={source=>f.videoSources.push(source)} storageKey='test:trial' previewHost={document.getElementById('preview')} autoStart onPrepare={c=>prepareAdvisorPrevisTrial('clip-1',f.studio,c)} onApply={(trial,res)=>{f.studio=adoptAdvisorPrevisTrial('clip-1',f.studio,trial,res);f.writes.push(trial.request.requestId);return true;}}/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "离线白模确认门", setup(b) {
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" }));
    b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: `export const trpc={manhuaPrevis:{submit:{useMutation:()=>({isPending:false,mutateAsync:async r=>{const f=globalThis.fixture;f.submits.push(r);return f.response(r);}})}},useUtils:()=>({manhuaPrevis:{get:{fetch:async({requestId})=>{const f=globalThis.fixture;f.queries.push(requestId);const r=JSON.parse(localStorage.getItem('test:trial:'+requestId)).request;return f.response(r);}}}})};` }));
  } }], define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" } });
  bundle = result.outputFiles[0]!.text; browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
it("独立渲染和刷新不写原场景；观看并确认后才允许应用真实回执", async () => {
  const page = await browser.newPage(); await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<main id="preview" data-clip-id="clip-1"></main><div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41828/"); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => (globalThis as any).fixture.submits.length === 1);
  expect(await page.evaluate(() => (globalThis as any).fixture.writes)).toEqual([]);
  expect(await page.evaluate(() => JSON.stringify((globalThis as any).fixture.studio) === (globalThis as any).fixture.original)).toBe(true);
  const id = await page.evaluate(() => (globalThis as any).fixture.submits[0].requestId);
  await page.reload(); await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => (globalThis as any).fixture.queries.length > 0);
  expect(await page.evaluate(() => (globalThis as any).fixture.submits)).toEqual([]);
  expect(await page.evaluate(() => (globalThis as any).fixture.queries)).toEqual([id]);
  await page.evaluate(() => { (globalThis as any).fixture.ready = true; const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent === '确认原试看请求（不新建）'); b?.click(); });
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
  expect(await page.evaluate(() => (globalThis as any).fixture.studio.specHistory[0].reasonZh)).toContain(id);
  await page.close();
}, 20000);
