/** 本机独立浏览器验证真实组件操作；传输使用虚构回执，不是生产验收。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("数字人共用剪辑支持选片、排序、取段、保存恢复和云失败阻断", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import Workshop from './client/src/components/canvas/PostProdWorkshopCard';
    globalThis.calls=[];globalThis.barriers=0;globalThis.failSave=false;globalThis.remount=()=>{};
    const map=new Map();const store={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),clear:()=>map.clear(),key:i=>[...map.keys()][i],get length(){return map.size;}};
    map.set("postProd.jobs.v2.u7", JSON.stringify([{jobId:"old-edit",action:"concat",label:"已剪辑成片",scopeKey:"digital-human:project:test",status:"succeeded",createdAt:1,output:{url:"https://example.test/edited.mp4",gcsUri:"gs://test-only/edited.mp4"}}]));
    globalThis.saved=map;const media={clips:[1,2,3].map(i=>({id:'clip'+i,url:'gs://test-only/clip'+i+'.mp4',label:'口播片段'+i})),audio:[],story:'完整口播正文'};
    function App(){const[version,setVersion]=React.useState(0);globalThis.remount=()=>setVersion(v=>v+1);return <Workshop key={version} orderedClipIds={['clip1','clip2']} initialAspect='16:9' subtitleDefaultMarginV={50} blocks={[]} userId='7' projectScopeKey='digital-human:project:test' vfxScopeKey='digital-human:project:test' mediaInput={media} storage={store} beforeSubmit={async()=>{globalThis.barriers++;if(globalThis.failSave)throw new Error('云保存冲突');}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [{ name: "offline-trpc", setup(b) {
      b.onResolve({ filter: /(?:^@\/lib\/trpc$|\/trpc$)/ }, () => ({ path: "trpc", namespace: "offline" }));
      b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: `
        const query={data:undefined,isLoading:false,isFetching:false,error:null};
        const mutation={isPending:false,mutate:()=>{},mutateAsync:async input=>{globalThis.calls.push(input);return {jobId:'job-'+globalThis.calls.length,status:'queued'};}};
        const utils=new Proxy({}, {get:()=>new Proxy({}, {get:()=>({invalidate:async()=>{},fetch:async()=>null})})});
        const leaf=new Proxy({}, {get:(_,key)=>key==='useQuery'?()=>query:key==='useMutation'?()=>mutation:()=>{}});
        export const trpc=new Proxy({}, {get:(_,key)=>key==='useUtils'?()=>utils:new Proxy({}, {get:()=>leaf})});
      ` }));
    } }], define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true); page.on("request", r => r.respond({ status: 200, contentType: "application/json", body: "[]" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('[aria-label="剪辑时间线"]');
    const click = (text: string, selector = "button") => page.$$eval(selector, (nodes, text) => { const node = nodes.find(n => n.textContent?.trim() === text) as HTMLButtonElement | undefined; if (!node) throw new Error(`未找到${text}`); node.click(); }, text);
    await click("按项目顺序载入已选版本", "#manhua-post-concat button");
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="剪辑时间线"] article').length === 2);
    await click("后移", '[aria-label="剪辑时间线"] article:first-of-type button');
    await page.waitForFunction(() => document.querySelector('[aria-label="剪辑时间线"] article')?.textContent?.includes("口播片段2"));
    const fill = async (label: string, value: string) => page.$eval(`[aria-label="${label}"]`, (node, value) => { const input = node as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value); input.dispatchEvent(new Event("input",{bubbles:true})); }, value);
    await fill("第1段起点", "1"); await fill("第1段终点", "4");
    await click("拼接 2 段");
    await page.waitForFunction(() => (globalThis as any).calls.length === 1);
    const queued = await page.evaluate(() => (globalThis as any).calls[0]);
    expect(queued.params.width).toBe(1280); expect(queued.params.height).toBe(720);
    expect(queued.action).toBe("concat"); expect(queued.scopeKey).toBe("digital-human:project:test");
    expect(queued.params.clips).toEqual(["gs://test-only/clip2.mp4", "gs://test-only/clip1.mp4"]);
    expect(queued.params.trims).toEqual([{startSec:1,endSec:4},{startSec:0}]);
    expect(await page.evaluate(() => (globalThis as any).barriers)).toBe(2);
    await page.evaluate(() => (globalThis as any).remount());
    await page.waitForFunction(() => (document.querySelector('[aria-label="第1段起点"]') as HTMLInputElement)?.value === "1");
    expect(await page.$eval('[aria-label="第1段终点"]', n => (n as HTMLInputElement).value)).toBe("4");
    await page.evaluate(() => { (globalThis as any).failSave = true; }); await click("拼接 2 段");
    await page.waitForFunction(() => (globalThis as any).barriers === 3);
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(1);
    expect(await page.$$eval('[aria-label="后期任务"] button', n => n.map(v => v.textContent))).toContain("漫剧特效");
    await page.evaluate(() => { (globalThis as any).failSave = false; });
    await click("继续字幕");
    await page.waitForFunction(() => (document.querySelector('[aria-label="字幕成片"]') as HTMLSelectElement)?.value === "gs://test-only/edited.mp4");
    await page.$eval('[aria-label="对白字幕 SRT"]', node => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(node,"1\n00:00:00,000 --> 00:00:01,000\n保留原文"); node.dispatchEvent(new Event("input",{bubbles:true})); });
    await click("添加重点字幕");
    await page.evaluate(() => (globalThis as any).remount());
    await page.waitForSelector('[aria-label="重点文字1"]');
    expect(await page.$eval('[aria-label="重点文字1"]', n => (n as HTMLInputElement).value)).toBe("");
    await fill("重点文字1", "最终决定");
    await page.select('[aria-label="重点效果1"]', "spiral");
    await fill("重点字号1", "12");
    await fill("结束秒1", "1");
    await page.select('[aria-label="字幕预览画幅"]', "16:9");
    expect(await page.$eval('[aria-label="当前字幕叠加"]', n => n.getAttribute("viewBox"))).toBe("0 0 512 288");
    await page.select('[aria-label="字幕预览画幅"]', "9:16");
    expect(await page.$eval('[aria-label="当前字幕叠加"]', n => n.getAttribute("viewBox"))).toBe("0 0 162 288");
    await page.evaluate(() => (globalThis as any).remount());
    await page.waitForFunction(() => (document.querySelector('[aria-label="对白字幕 SRT"]') as HTMLTextAreaElement)?.value.includes("保留原文"));
    expect(await page.$eval('[aria-label="字幕成片"]', node => (node as HTMLSelectElement).value)).toBe("gs://test-only/edited.mp4");
    expect(await page.$eval('[aria-label="重点文字1"]', n => (n as HTMLInputElement).value)).toBe("最终决定");
    expect(await page.$eval('[aria-label="普通字幕底部距离"]', n => (n as HTMLInputElement).value)).toBe("50");
    await click("添加字幕 · 0积分");
    await page.waitForFunction(() => (globalThis as any).calls.length === 2);
    const subtitle = await page.evaluate(() => (globalThis as any).calls[1]);
    expect(subtitle.action).toBe("burn_subtitle");
    expect(subtitle.params.videoUri).toBe("gs://test-only/edited.mp4");
    expect(subtitle.params.highlights[0]).toMatchObject({ text: "最终决定", fontSize: 12, effect: "spiral", startSec: 0, endSec: 1 });
    expect(subtitle.params.styleOverride).toMatchObject({ fontSize: 16, marginV: 50 });
    expect(subtitle.scopeKey).toBe("digital-human:project:test");
    await page.evaluate(() => { const map=(globalThis as any).saved; const key=[...map.keys()].find((k:string)=>k.endsWith(':subtitle:edit')); (globalThis as any).badDraftKey=key; map.set(key,'null'); (globalThis as any).remount(); });
    await page.waitForFunction(() => document.querySelector('[aria-label="成片字幕"]')?.textContent?.includes('字幕草稿无法读取'));
    expect(await page.evaluate(() => (globalThis as any).saved.get((globalThis as any).badDraftKey))).toBe('null');
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
