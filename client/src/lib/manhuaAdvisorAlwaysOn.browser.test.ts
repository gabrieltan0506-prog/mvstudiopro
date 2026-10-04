import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
let browser: Browser, bundle: string, css: string;
beforeAll(async () => {
  const result = await build({ loader: { ".css": "empty" }, stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React from 'react';import{createRoot}from'react-dom/client';
import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
import {useManhuaAdvisorPreference}from'./client/src/hooks/useManhuaAdvisorPreference';
const f=globalThis.fixture={asks:[],quota:{remaining:Number(localStorage.getItem('test-quota')??5),price:12,exempt:false},errors:[]};
const projectId='6f9619ff-8b86-4d01-b42d-00cf4fc964ff';
function App(){const pref=useManhuaAdvisorPreference('7');return <div data-manhua-theme='cream' data-advisor-sidebar={pref.open?'open':undefined}><main style={{padding:40}}>原有工作区<button id='reopen' onClick={()=>pref.choose(true)}>创作顾问</button></main><Panel projectId={projectId} automaticMonitoring={pref.enabled} open={pref.open} userId='7' confirmedProjectVersion={localStorage.getItem('test-confirmed-version')||'test'} onClose={()=>pref.choose(false)} templates={[]} onRequestTrial={()=>{}} project={{context:{seriesTitle:'测试作品',episodeIndex:1,episodeTitle:'入局',stage:'storyboard',videoModel:'未选择',writerConfirmed:true,episodeBody:'两人在医馆走廊对峙。',assetSummary:'已有医馆3DGS',shotSummary:'先全景后近景',blockers:[]},issues:[],contextNotes:[],selectionLabel:'镜1'}}/></div>}
createRoot(document.getElementById('root')).render(<App/>);` }, jsx: "automatic", bundle: true, write: false, format: "iife", platform: "browser", target: "es2022", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "offline-advisor", setup(b) {
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "mock" }));
    b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({ loader: "js", contents: `export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:localStorage.getItem("test-quota-error")?undefined:globalThis.fixture.quota,isError:!!localStorage.getItem("test-quota-error"),refetch:async()=>({data:globalThis.fixture.quota})})}}};` }));
    b.onResolve({ filter: /manhuaAdvisorStream$/ }, () => ({ path: "stream", namespace: "stream" }));
    b.onLoad({ filter: /.*/, namespace: "stream" }, () => ({ loader: "js", contents: `export async function streamManhuaAdvisor(input,onText){const f=globalThis.fixture;f.asks.push(input);onText('正在检查');return{answer:'## 场景建议\\n\\n**医馆走廊**复用已有3DGS，先固定人物与门的位置。',remainingFreeToday:Math.max(0,f.quota.remaining-1),paidUnitCredits:12,creditsCharged:input.confirmPaid?12:0,paidThisTurn:!!input.confirmPaid};}` }));
  }}], define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" } });
  bundle = result.outputFiles[0]!.text;
  const assets = path.resolve('client/dist/assets');
  css = readdirSync(assets).filter(f=>/^(index|OmniCanvas)-.*\.css$/.test(f)).map(f=>readFileSync(path.join(assets,f),'utf8')).join('\n');
  browser = await puppeteer.launch({ headless:true });
}, 60000);
afterAll(async()=>{await browser?.close();});

it('默认常驻、自动建议一次、Markdown可读、用户收起可记忆；免费耗尽先确认12分',async()=>{
 const page=await browser.newPage(); page.setDefaultTimeout(5000);page.on('pageerror',e=>console.error('BROWSER',e));await page.setViewport({width:1440,height:1000});
 await page.setRequestInterception(true); page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
 const load=async()=>{await page.goto('http://localhost:41839/');await page.evaluate(()=>{const original=window.setTimeout;window.setTimeout=((fn:any,ms:number,...args:any[])=>original(fn,ms===8000?80:ms,...args)) as any;});await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});};
 await page.goto('http://localhost:41839/');await page.evaluate(()=>localStorage.clear());
 await load();await page.waitForFunction(()=>(globalThis as any).fixture.asks.length===1).catch(async e=>{console.error(await page.evaluate(()=>({body:document.body.innerText,fixture:(globalThis as any).fixture})));throw e;});
 await page.waitForSelector('[data-manhua-creative-advisor] h2');
 expect(await page.$eval('[data-advisor-composer]',e=>e.textContent)).toContain('12 积分/次');
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('[data-manhua-creative-advisor] h2')).some(e=>e.textContent==='场景建议'));
 expect(await page.$eval('[data-manhua-creative-advisor]',e=>e.textContent)).not.toContain('**医馆走廊**');
 const geometry=await page.evaluate(()=>{const a=document.querySelector('[data-manhua-creative-advisor]')!.getBoundingClientRect(),m=document.querySelector('main')!.getBoundingClientRect(),t=document.querySelector('textarea')!.getBoundingClientRect();return {overlap:m.right>a.left+1,inputVisible:t.bottom<=innerHeight&&t.top>=a.top};});
 expect(geometry).toEqual({overlap:false,inputVisible:true});
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='收起')!.click());
 await load();await page.waitForFunction(()=>!!(globalThis as any).fixture);await new Promise(r=>setTimeout(r,200));
 expect(await page.evaluate(()=>(globalThis as any).fixture.asks.length)).toBe(0);
 expect(await page.$('[data-manhua-creative-advisor]')).toBeNull();
 await page.click('#reopen');await page.waitForSelector('textarea');await new Promise(r=>setTimeout(r,200));
 expect(await page.evaluate(()=>(globalThis as any).fixture.asks.length)).toBe(0);
 await page.evaluate(()=>{localStorage.clear();localStorage.setItem('test-quota','0');});
 await load();await page.waitForFunction(()=>document.body.textContent?.includes('确认支付 12 积分并继续'));
 expect(await page.evaluate(()=>(globalThis as any).fixture.asks.length)).toBe(0);
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='确认支付 12 积分并继续')!.click());
 await page.waitForFunction(()=>(globalThis as any).fixture.asks.length===1);
 expect(await page.evaluate(()=>(globalThis as any).fixture.asks[0])).toMatchObject({confirmPaid:true,confirmedCredits:12,manhuaContext:{projectId:'6f9619ff-8b86-4d01-b42d-00cf4fc964ff'}});
 await page.screenshot({path:'../backend-work/advisor-project-1004-desktop.png'});
 await page.close();
},30000);


it('额度暂不可读仍可取回原问答；已确认稿继续读取原有历史键',async()=>{
 const page=await browser.newPage();page.setDefaultTimeout(5000);
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
 await page.goto('http://localhost:41839/');
 await page.evaluate(()=>{
  localStorage.clear();localStorage.setItem('test-quota-error','1');
  const request={requestId:'7f9619ff-8b86-4d01-b42d-00cf4fc964ff',question:'恢复之前的顾问建议',rawQuestion:'恢复之前的顾问建议',label:'原问题',manhuaContext:{seriesTitle:'测试作品',episodeIndex:1,episodeTitle:'入局',stage:'storyboard',videoModel:'未选择',writerConfirmed:true,episodeBody:'两人在医馆走廊对峙。',assetSummary:'已有医馆3DGS',shotSummary:'先全景后近景',blockers:[],projectId:'6f9619ff-8b86-4d01-b42d-00cf4fc964ff'}};
  localStorage.setItem('mvs:manhua-advisor:v2:7:test',JSON.stringify([{id:'old-answer',role:'advisor',text:'历史对话保留'}]));
  localStorage.setItem('mvs:manhua-advisor:v2:7:test:pending',JSON.stringify({format:'manhua-advisor-pending-v1',request,confirmPaid:true,confirmedCredits:12}));
 });
 await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});
 await page.waitForFunction(()=>document.body.textContent?.includes('历史对话保留'));
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复原问题（沿用原请求编号）')!.click());
 await page.waitForFunction(()=>(globalThis as any).fixture.asks.length===1);
 expect(await page.evaluate(()=>(globalThis as any).fixture.asks[0])).toMatchObject({requestId:'7f9619ff-8b86-4d01-b42d-00cf4fc964ff',confirmPaid:true,confirmedCredits:12});
 await page.waitForFunction(()=>!localStorage.getItem('mvs:manhua-advisor:v2:7:test:pending'));
 expect(await page.evaluate(()=>localStorage.getItem('mvs:manhua-advisor:v2:7:test'))).toContain('历史对话保留');
 await page.close();
},15000);


it('草稿恢复编号只迁移一次，已完成问题重开不复活且来源保留',async()=>{
 const page=await browser.newPage();page.setDefaultTimeout(5000);
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
 await page.goto('http://localhost:41839/');
 await page.evaluate(()=>{
  localStorage.clear();localStorage.setItem('test-quota-error','1');
  const source='mvs:manhua-advisor:v2:7:draft%3A6f9619ff-8b86-4d01-b42d-00cf4fc964ff';
  const request={requestId:'7f9619ff-8b86-4d01-b42d-00cf4fc964ff',question:'恢复草稿顾问建议',rawQuestion:'恢复草稿顾问建议',label:'草稿问题',manhuaContext:{seriesTitle:'测试作品',episodeIndex:1,episodeTitle:'入局',stage:'storyboard',videoModel:'未选择',writerConfirmed:true,episodeBody:'两人在医馆走廊对峙。',assetSummary:'已有医馆3DGS',shotSummary:'先全景后近景',blockers:[],projectId:'6f9619ff-8b86-4d01-b42d-00cf4fc964ff'}};
  localStorage.setItem(source,JSON.stringify([{id:'draft-answer',role:'advisor',text:'草稿历史保留'}]));
  localStorage.setItem(source+':pending',JSON.stringify({format:'manhua-advisor-pending-v1',request,confirmPaid:true,confirmedCredits:12}));
 });
 await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});
 await page.waitForFunction(()=>document.body.textContent?.includes('草稿历史保留'));
 await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='恢复原问题（沿用原请求编号）')!.click());
 await page.waitForFunction(()=>(globalThis as any).fixture.asks.length===1&&!localStorage.getItem('mvs:manhua-advisor:v2:7:test:pending'));
 expect(await page.evaluate(()=>localStorage.getItem('mvs:manhua-advisor:v2:7:draft%3A6f9619ff-8b86-4d01-b42d-00cf4fc964ff:pending'))).toContain('7f9619ff');
 expect(await page.evaluate(()=>localStorage.getItem('mvs:manhua-advisor:v2:7:test:pending:draft-inherited'))).toContain('draft%3A');
 await page.reload();await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});
 await page.waitForFunction(()=>document.body.textContent?.includes('草稿历史保留'));
 expect(await page.evaluate(()=>document.body.textContent)).not.toContain('恢复原问题（沿用原请求编号）');
 expect(await page.evaluate(()=>(globalThis as any).fixture.asks.length)).toBe(0);
 expect(await page.evaluate(()=>localStorage.getItem('mvs:manhua-advisor:v2:7:test:pending'))).toBeNull();
 await page.evaluate(()=>localStorage.setItem('test-confirmed-version','test-next-version'));
 await page.reload();await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});
 await page.waitForFunction(()=>document.body.textContent?.includes('草稿历史保留'));
 expect(await page.evaluate(()=>document.body.textContent)).not.toContain('恢复原问题（沿用原请求编号）');
 expect(await page.evaluate(()=>localStorage.getItem('mvs:manhua-advisor:v2:7:test-next-version:pending'))).toBeNull();
 expect(await page.evaluate(()=>(globalThis as any).fixture.asks.length)).toBe(0);
 await page.close();
},15000);
