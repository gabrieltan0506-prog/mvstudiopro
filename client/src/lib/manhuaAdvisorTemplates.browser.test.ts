import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
 const result = await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import Panel from './client/src/components/canvas/ManhuaCreativeAdvisorPanel';
 const f=globalThis.fixture={requests:[],applied:[],answer:''};
 const templates=['a','b','c'].map(publicId=>({publicId,nameZh:'模板'+publicId,featureZh:'冲突升级',introZh:''}));
 f.plans=templates.map(t=>({publicId:t.publicId,reason:'适合当前故事',changes:['提前冲突','保留反转'],preserve:'人物身份'}));
 f.newBody='主角走入船舱，看见敌人手中熟悉的信物。她藏起惊讶，压低声音询问来意；对方没有回答，却将剑指向门外。';
 function App(){const[body,setBody]=useState('原稿：主角登船寻找信物。');f.setBody=setBody;return <Panel open userId='1' confirmedProjectVersion='version-test' onClose={()=>{}} templates={templates} onRequestTrial={()=>{}} onApplyRewrite={c=>{f.applied.push(c);setBody(c.rewrittenBody);return true;}} project={{context:{seriesTitle:'船战',episodeIndex:1,episodeTitle:'登船',stage:'outline',videoModel:'未选择',writerConfirmed:true,episodeBody:body,assetSummary:'',shotSummary:'',blockers:[]},issues:[],contextNotes:[],selectionLabel:'本集'}}/>}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},plugins:[{name:"离线问答边界",setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:"trpc",namespace:"offline"}));b.onLoad({filter:/.*/,namespace:"offline"},()=>({loader:"js",contents:`export const trpc={mvAnalysis:{askPlatformSkillQa:{useMutation:()=>({isPending:false,mutateAsync:async input=>{const f=globalThis.fixture;f.requests.push(input);return {answer:JSON.stringify(input.rawQuestion.startsWith('【模板改写建议】')?{kind:'template-rewrite',body:f.newBody,changes:['前置冲突']}:{kind:'template-plans',plans:f.plans}),remainingFreeToday:2,paidUnitCredits:1};}})}}};`}));}}],define:{"process.env.NODE_ENV":'"development"',"import.meta.env":"{}"}});
 bundle=result.outputFiles[0]!.text;browser=await puppeteer.launch({headless:true});
},30000);
afterAll(async()=>{await browser?.close();});
it("生产面板推荐→选择改写→对比→采用只在用户点击后执行，并保留原稿及冲突保护",async()=>{
 const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
 await page.goto('http://localhost:41827/');await page.addScriptTag({content:bundle});
 const click=async(text:string)=>page.evaluate(text=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===text);if(!b)throw Error(text);b.click();},text);
 await page.waitForSelector('[aria-label="剧本模板优化"]');await click('推荐3—4个剧本模板方案');
 await page.waitForFunction(()=>document.body.textContent?.includes('选此方案，改写当前集'));
 await click('选此方案，改写当前集');await page.waitForSelector('[aria-label="改写原稿对比"]');
 expect(await page.$eval('[aria-label="逐句差异对比"]', e => e.textContent)).toContain('套用前 · 完整原稿');
 expect(await page.$eval('[aria-label="逐句差异对比"]', e => e.textContent)).toContain('套用后 · 完整改写');
 expect(await page.$$eval('[data-diff-text="before"]', els => els.map(e=>e.textContent).join(''))).toBe('原稿：主角登船寻找信物。');
 expect(await page.$('[data-diff-kind="changed"]')).not.toBeNull();

 expect(await page.evaluate(()=> (globalThis as any).fixture.applied.length)).toBe(0);
 expect(await page.evaluate(()=> (globalThis as any).fixture.requests.map((r:any)=>[Boolean(r.confirmPaid),r.manhuaContext.episodeBody]))).toEqual([[false,'原稿：主角登船寻找信物。'],[false,'原稿：主角登船寻找信物。']]);
 await click('采用这版改写');
 await page.waitForFunction(()=>document.body.textContent?.includes('已停止覆盖'));
 expect(await page.evaluate(()=> (globalThis as any).fixture.applied[0].originalBody)).toBe('原稿：主角登船寻找信物。');
 expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('mvs:manhua-advisor:v2:1:version-test:rewrite')!).originalBody)).toBe('原稿：主角登船寻找信物。');
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用这版改写')?.disabled)).toBe(true);
 await page.evaluate(()=>{const f=(globalThis as any).fixture;localStorage.setItem('manhua-advisor-rewrite-backup:1:test',JSON.stringify({createdAt:'2026-09-20T05:22:00.000Z',episodeIndex:1,changes:['前置冲突'],writerPack:{seriesTitle:'船战',episodes:[{index:1,body:'原稿：主角登船寻找信物。'}]},projectBible:{confirmedAt:'version-test'}}));URL.createObjectURL=(blob:Blob)=>{blob.text().then(text=>f.download=text);return 'blob:offline';};HTMLAnchorElement.prototype.click=function(){};});
 await click('查找当前项目旧稿备份');await page.waitForFunction(()=>document.body.textContent?.includes('下载旧稿JSON'));await click('下载旧稿JSON');
 await page.waitForFunction(()=>Boolean((globalThis as any).fixture.download));
 expect(await page.evaluate(()=>JSON.parse((globalThis as any).fixture.download).writerPack.episodes[0].body)).toBe('原稿：主角登船寻找信物。');
 await page.reload();await page.addScriptTag({content:bundle});await page.waitForSelector('[aria-label="改写原稿对比"]');
 expect(await page.evaluate(()=> (globalThis as any).fixture.requests.length)).toBe(0);
 await page.evaluate(()=>localStorage.setItem('mvs:manhua-advisor:v2:1:version-test:rewrite','broken'));
 await page.reload();await page.addScriptTag({content:bundle});await page.waitForFunction(()=>document.body.textContent?.includes('原稿对比记录无法读取'));
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='推荐3—4个剧本模板方案')?.disabled)).toBe(true);
 expect(await page.evaluate(()=>localStorage.getItem('mvs:manhua-advisor:v2:1:version-test:rewrite'))).toBe('broken');
 await page.close();
},20000);
