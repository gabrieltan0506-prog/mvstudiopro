import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
const f=globalThis.fixture={asks:[],generations:[],release:null};
function App(){const[target,setTarget]=useState({sceneRefId:'clinic',labelZh:'诊台',sourceRevision:'a'.repeat(64),hintZh:'树下的木诊台'});const[task,setTask]=useState(undefined);f.setTarget=setTarget;f.setTask=setTask;return <Panel open userId='1' confirmedProjectVersion='world-test' worldTarget={target} worldTaskState={task} studio3d={{}} onClose={()=>{}} templates={[]} onRequestTrial={()=>{}} onGenerateWorld={async c=>{f.generations.push(c);await new Promise(r=>f.release=r);setTask('queued');}} project={{context:{seriesTitle:'墨菁传',episodeIndex:1,episodeTitle:'献血',stage:'assets',videoModel:'未选择',writerConfirmed:true,episodeBody:'医生在树下诊台为娘把脉。',assetSummary:'诊台已绑定',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'诊台场景'}}/>}
createRoot(document.getElementById('root')).render(<App/>);
` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "仅模拟服务边界", setup(b) {
    b.onResolve({ filter: /^@\/lib\/manhuaAdvisorStream$/ }, () => ({ path: "stream", namespace: "offline" }));
    b.onLoad({ filter: /^stream$/, namespace: "offline" }, () => ({ loader: "js", contents: `export async function streamManhuaAdvisor(input){globalThis.fixture.asks.push(input);return {answer:JSON.stringify({kind:'world_plan_v1',sceneRefId:input.manhuaContext.worldTarget.sceneRefId,summaryZh:'诊台放在树下，留出入口通路',textPrompt:'露天药庐前的木制诊台位于大树阴影下，清晨光线从东侧照入，诊台与入口之间留出通路。'}),remainingFreeToday:4,paidUnitCredits:8};}` }));
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" }));
    b.onLoad({ filter: /^trpc$/, namespace: "offline" }, () => ({ loader: "js", contents: `export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:8,exempt:false},refetch:async()=>({})})}}};` }));
  } }], define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" } });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });
async function open(): Promise<Page> {
  const page = await browser.newPage(); page.setDefaultTimeout(5000);
  await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  await page.goto("http://localhost:41847/"); await page.addScriptTag({ content: bundle });
  await page.waitForSelector('textarea'); return page;
}
async function confirm(page: Page) { await page.evaluate(() => Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('确认方案，生成3DGS'))?.click()); }
it("顾问真实方案先展示，明确确认才走原生成回调，提交中和已有任务不重复", async () => {
  const page = await open();
  try {
    await page.type('textarea', '把诊台放在树下，入口留出通路'); await page.keyboard.press('Enter');
    await page.waitForSelector('[aria-label="3DGS场景方案"]');
    expect(await page.evaluate(() => (window as any).fixture.generations)).toEqual([]);
    expect(await page.evaluate(() => (window as any).fixture.asks[0].manhuaContext.worldTarget.sceneRefId)).toBe('clinic');
    expect(await page.$('input[type=number]')).toBeNull();
    await confirm(page); await confirm(page);
    expect(await page.evaluate(() => (window as any).fixture.generations)).toHaveLength(1);
    expect(await page.evaluate(() => (window as any).fixture.generations[0].plan.textPrompt)).toContain('木制诊台');
    await page.evaluate(() => (window as any).fixture.release());
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(b => b.textContent?.includes('确认方案，生成3DGS') && b.disabled));
    await confirm(page);
    expect(await page.evaluate(() => (window as any).fixture.generations)).toHaveLength(1);
  } finally { await page.close(); }
});
it("重新打开可恢复方案，切到另一图或源版本后阻止旧方案生成", async () => {
  const page = await open();
  try {
    await page.waitForSelector('[aria-label="3DGS场景方案"]');
    expect(await page.evaluate(() => (window as any).fixture.asks)).toEqual([]);
    await page.evaluate(() => (window as any).fixture.setTarget({sceneRefId:'other',labelZh:'另一场景',sourceRevision:'b'.repeat(64),hintZh:''}));
    await page.waitForFunction(() => document.body.textContent?.includes('另一张图或旧版本'));
    await confirm(page);
    expect(await page.evaluate(() => (window as any).fixture.generations)).toEqual([]);
  } finally { await page.close(); }
});
