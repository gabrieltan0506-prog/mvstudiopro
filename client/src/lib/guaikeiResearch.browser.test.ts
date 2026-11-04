import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
let browser: Browser, bundle: string;
beforeAll(async () => {
  const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import {GuaikeiResearchPanel} from './client/src/components/GuaikeiResearchPanel';
import {readGuaikeiReportSelection,writeGuaikeiReportSelection} from './client/src/lib/guaikeiReportSelection';
window.fixture={calls:[],jobs:JSON.parse(localStorage.getItem('jobs')||'[]'),adopted:[],restoredReport:readGuaikeiReportSelection('7'),otherUserReport:readGuaikeiReportSelection('8')};
createRoot(document.getElementById('root')).render(<GuaikeiResearchPanel onAdopt={text=>{window.fixture.adopted.push(text);return true;}} onAdoptReport={(jobId,itemIds)=>writeGuaikeiReportSelection('7',[{jobId,itemIds}])}/>);
` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "隔离API替身", setup(b) {
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "test-api" }));
    b.onLoad({ filter: /.*/, namespace: "test-api" }, () => ({ loader: "js", resolveDir: process.cwd(), contents: `
import {useEffect,useState} from 'react';
import {defaultGuaikeiSettings} from '@shared/guaikei';
const update=()=>window.dispatchEvent(new Event('fixture-update'));
const hook=()=>{const[,set]=useState(0);useEffect(()=>{const f=()=>set(x=>x+1);window.addEventListener('fixture-update',f);return()=>window.removeEventListener('fixture-update',f)},[])};
const f=()=>window.fixture;
const invalidate=async()=>update();
const mutation=kind=>options=>{hook();return{isPending:false,mutate:async input=>{f().calls.push({kind,input});let job;
if(kind==='submit'){job={id:'11111111-1111-4111-8111-111111111111',input:input.request,status:'pending',items:[],rawCount:0,duplicateCount:0,rejectedCount:0,actualCents:null,message:'测试等待',updatedAt:'2026-11-04T12:00:00Z'};f().jobs=[job]}
else{job=f().jobs[0];Object.assign(job,{status:'completed',message:'已保存测试结果',rawCount:2,items:[{id:'a',platform:job.input.platform,title:'AI漫剧测试作品',author:'测试作者',url:'https://example.com/a',publishedAt:null,likes:0,comments:null},{id:'b',platform:job.input.platform,title:'另一篇测试作品',author:'另一作者',url:null,publishedAt:null,likes:2,comments:1}]})}
localStorage.setItem('jobs',JSON.stringify(f().jobs));update();await options.onSuccess(job);}}};
export const trpc={useUtils:()=>({guaikei:{list:{invalidate},get:{invalidate},quote:{invalidate},settings:{invalidate}}}),guaikei:{
settings:{useQuery:()=>({data:{settings:defaultGuaikeiSettings()}})},balance:{useQuery:()=>({data:{balanceCents:490,todaySpentCents:20,todayComplete:true,lowBalance:true,balanceConsistent:true,checkedAt:'2026-11-04T12:00:00Z'},refetch:async()=>{},isFetching:false})},saveSettings:{useMutation:options=>({mutate:async input=>{f().savedSettings=input;await options.onSuccess();},isPending:false})},
list:{useQuery:()=>{hook();return{data:f().jobs}}},
quote:{useQuery:(input,options)=>{hook();return{data:options.enabled?{input,estimatedCents:10,reservedCents:10,dailyReservedCents:0,monthlyReservedCents:0,dailyLimitCents:1000,monthlyLimitCents:10000,note:'测试估算',blockedReason:null}:undefined}}},
get:{useQuery:(input,options)=>{hook();return{data:options.enabled?f().jobs.find(j=>j.id===input.id):undefined}}},
submit:{useMutation:mutation('submit')},poll:{useMutation:mutation('poll')}}};
` }));
  } }] });
  bundle = result.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
});
afterAll(async () => { await browser?.close(); });
it("五平台切换、预览不扣费、确认/查询/筛选采用和刷新恢复", async () => {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<meta charset="utf-8"><div id="root"></div>' }) : void r.abort());
  const click = async (text: string) => page.evaluate(text => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes(text)); if (!b) throw Error(text); b.click(); }, text);
  try {
    await page.goto("https://offline.invalid/guaikei"); await page.addScriptTag({ content: bundle });
    await page.waitForSelector('select[aria-label="采集平台"]');
    expect(await page.$$eval('select[aria-label="作品时间范围"] option', all=>all.map(x=>x.textContent))).toEqual(['近3天','近7天','近15天']);
    expect(await page.$eval('details',x=>x.textContent)).toContain('余额低于 ¥5');
    await page.click('summary');
    await click('保存自动采集配置');
    expect(await page.evaluate(()=>(window as any).fixture.savedSettings.enabled)).toBe(false);
    expect(await page.evaluate(()=>(window as any).fixture.savedSettings.platforms.tiktok.mode)).toBe('hourly');
    expect(await page.$$eval('select[aria-label="采集平台"] option', all => all.map(x => x.textContent))).toEqual(["抖音", "小红书", "快手", "TikTok", "微信"]);
    await page.select('select[aria-label="采集平台"]', 'wechat');
    expect(await page.$$eval('select[aria-label="采集类型"] option', all => all.map(x => x.textContent))).toEqual(["视频号搜索"]);
    await page.select('select[aria-label="采集平台"]', 'xiaohongshu');
    await page.type('input[aria-label="采集关键词或作者"]', 'AI漫剧');
    await click('预览本次请求'); await page.waitForFunction(() => document.body.textContent?.includes('确认付费采集'));
    expect(await page.evaluate(() => (window as any).fixture.calls)).toHaveLength(0);
    await click('确认付费采集'); await page.waitForFunction(() => document.body.textContent?.includes('查询原任务结果'));
    await click('查询原任务结果'); await page.waitForFunction(() => document.body.textContent?.includes('AI漫剧测试作品'));
    await page.type('input[aria-label="筛选采集结果"]', 'AI漫剧');
    await page.evaluate(() => { const label = Array.from(document.querySelectorAll('label')).find(x => x.textContent?.includes('AI漫剧测试作品')); (label?.querySelector('input[type="checkbox"]') as HTMLInputElement).click(); });
    await click('加入本次分析');
    const adopted = await page.evaluate(() => (window as any).fixture.adopted[0]);
    expect(adopted).toContain('AI漫剧测试作品'); expect(adopted).not.toContain('另一篇测试作品'); expect(adopted).toContain('不是全平台统计');
    await click('加入趋势报告');
    expect(await page.evaluate(() => (window as any).fixture.calls.map((x: any) => x.kind))).toEqual(['submit', 'poll']);
    await page.reload(); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => Array.from(document.querySelectorAll('button')).some(x => x.textContent?.includes('已保存')));
    await click('已保存'); await page.waitForFunction(() => document.body.textContent?.includes('AI漫剧测试作品'));
    expect(await page.evaluate(() => (window as any).fixture.calls)).toHaveLength(0);
    expect(await page.evaluate(() => (window as any).fixture.restoredReport)).toEqual([{ jobId: '11111111-1111-4111-8111-111111111111', itemIds: ['a'] }]);
    expect(await page.evaluate(() => (window as any).fixture.otherUserReport)).toEqual([]);
  } finally { await page.close(); }
}, 30000);
