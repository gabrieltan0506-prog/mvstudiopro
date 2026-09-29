import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
import{createManhuaPrevisStudio}from'./shared/manhuaPrevis';
import{makeAdvisorPrevisTarget,prepareAdvisorPrevisTrial}from'./shared/manhuaAdvisorPrevisEdit';
const f=globalThis.fixture={asks:[],renders:[],writes:[]};const studio=createManhuaPrevisStudio(5);f.studio=studio;
function App(){const[open,setOpen]=useState(true);f.setOpen=setOpen;return <Panel open={open} userId='1' confirmedProjectVersion='iteration-test' onClose={()=>setOpen(false)} templates={[]} onRequestTrial={()=>{}} previsTarget={makeAdvisorPrevisTarget('clip-1',studio)} onPreparePrevis={c=>prepareAdvisorPrevisTrial('clip-1',studio,c)} onApplyPrevis={t=>{f.writes.push(t);return true;}} project={{context:{seriesTitle:'墨菁传',episodeIndex:1,episodeTitle:'入市',stage:'storyboard',videoModel:'未选择',writerConfirmed:true,episodeBody:'曹三逼近，阿菁挡在马前。',assetSummary:'',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'第1段'}}/>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "多轮顾问离线边界", setup(b) {
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" }));
    b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: `export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:8,exempt:false},isError:false,refetch:async()=>({})})},askPlatformSkillQa:{useMutation:()=>({isPending:false,mutateAsync:async input=>{const f=globalThis.fixture;f.asks.push(input);if(f.requirePaid&&!input.confirmPaid)throw new Error("今日标准顾问免费5次已用完。继续将扣除8积分/次，请确认后重试。");const spec=JSON.parse(input.manhuaContext.previsEdit.specJson);return{answer:JSON.stringify({kind:'previs_edit_v1',summaryZh:f.asks.length===1?'先缓推强化威胁，再看阿菁反应':'保留缓推，减小推近幅度',unsupportedZh:[],cameras:spec.cameras.map(c=>({...c,endLens:f.asks.length===1?60:50}))}),remainingFreeToday:5-f.asks.length,paidUnitCredits:8};}})}},manhuaPrevis:{submit:{useMutation:()=>({isPending:false,mutateAsync:async r=>{const f=globalThis.fixture;f.renders.push(r);return{jobId:'test-render',status:'queued',params:r,output:null};}})}},useUtils:()=>({manhuaPrevis:{get:{fetch:async()=>null}}})};` }));
  } }], define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" } });
  bundle = result.outputFiles[0]!.text; browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
it("先提案不自动渲染，追问继承上版，用户选定后才渲染，收起重开不重建任务", async () => {
  const page = await browser.newPage(); await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41829/"); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('textarea[aria-label="向创作顾问提问"]');
  expect(await page.$eval('[aria-label="今日咨询额度"]', e => e.textContent)).toContain("今日咨询免费剩余 5/5 次");
  await page.type('textarea', '曹三逼近时加强压迫感'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.textContent?.includes('先缓推强化威胁'));
  expect(await page.evaluate(() => (globalThis as any).fixture.renders.length)).toBe(0);
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '继续修改这版方案')?.click());
  await page.type('textarea', '镜头不要推得太近'); await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.body.textContent?.includes('保留缓推，减小推近幅度'));
  expect(await page.evaluate(() => JSON.parse((globalThis as any).fixture.asks[1].manhuaContext.previsEdit.previousPreviewSpecJson).cameras[0].endLens)).toBe(60);
  expect(await page.evaluate(() => (globalThis as any).fixture.renders.length)).toBe(0);
  await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent === '按这个方案生成试看')?.click());
  await page.waitForFunction(() => (globalThis as any).fixture.renders.length === 1);
  expect(await page.evaluate(() => (globalThis as any).fixture.renders[0].spec.cameras[0].endLens)).toBe(50);
  expect(await page.evaluate(() => (globalThis as any).fixture.writes)).toEqual([]);
  await page.evaluate(() => (globalThis as any).fixture.setOpen(false));
  await page.waitForFunction(() => !document.querySelector('[data-manhua-creative-advisor]'));
  await page.evaluate(() => (globalThis as any).fixture.setOpen(true));
  await page.waitForSelector('[data-manhua-creative-advisor]');
  expect(await page.evaluate(() => (globalThis as any).fixture.renders.length)).toBe(1);
  await page.close();
}, 20000);

it("付费提示必须先展示明确积分，用户确认才带同额授权，取消不再次提交", async () => {
  const page = await browser.newPage(); await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41829/"); await page.addScriptTag({ content: bundle });
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
