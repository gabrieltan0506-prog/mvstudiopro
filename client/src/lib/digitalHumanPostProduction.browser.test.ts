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
    map.set("postProd.jobs.v2.u7", JSON.stringify([{jobId:"old-edit",action:"concat",label:"已剪辑成片",scopeKey:"digital-human:test",status:"succeeded",createdAt:1,output:{url:"https://example.test/edited.mp4",gcsUri:"gs://test-only/edited.mp4"}}]));
    globalThis.saved=map;const media={clips:[1,2,3].map(i=>({id:'clip'+i,url:'gs://test-only/clip'+i+'.mp4',label:'口播片段'+i})),audio:[],story:'完整口播正文'};
    function App(){const[version,setVersion]=React.useState(0);globalThis.remount=()=>setVersion(v=>v+1);return <Workshop key={version} blocks={[]} userId='7' projectScopeKey='digital-human:test' vfxScopeKey='digital-human:test' mediaInput={media} storage={store} beforeSubmit={async()=>{globalThis.barriers++;if(globalThis.failSave)throw new Error('云保存冲突');}}/>;}
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
    await click("口播片段1", "#manhua-post-concat button"); await click("口播片段2", "#manhua-post-concat button");
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="剪辑时间线"] article').length === 2);
    await click("后移", '[aria-label="剪辑时间线"] article:first-of-type button');
    await page.waitForFunction(() => document.querySelector('[aria-label="剪辑时间线"] article')?.textContent?.includes("口播片段2"));
    const fill = async (label: string, value: string) => page.$eval(`[aria-label="${label}"]`, (node, value) => { const input = node as HTMLInputElement; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value); input.dispatchEvent(new Event("input",{bubbles:true})); }, value);
    await fill("第1段起点", "1"); await fill("第1段终点", "4");
    await click("拼接 2 段");
    await page.waitForFunction(() => (globalThis as any).calls.length === 1);
    const queued = await page.evaluate(() => (globalThis as any).calls[0]);
    expect(queued.action).toBe("concat"); expect(queued.scopeKey).toBe("digital-human:test");
    expect(queued.params.clips).toEqual(["gs://test-only/clip2.mp4", "gs://test-only/clip1.mp4"]);
    expect(queued.params.trims).toEqual([{startSec:1,endSec:4},{startSec:0}]);
    expect(await page.evaluate(() => (globalThis as any).barriers)).toBe(2);
    await page.evaluate(() => (globalThis as any).remount());
    await page.waitForFunction(() => (document.querySelector('[aria-label="第1段起点"]') as HTMLInputElement)?.value === "1");
    expect(await page.$eval('[aria-label="第1段终点"]', n => (n as HTMLInputElement).value)).toBe("4");
    await page.evaluate(() => { (globalThis as any).failSave = true; }); await click("拼接 2 段");
    await page.waitForFunction(() => (globalThis as any).barriers === 3);
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(1);
    expect(await page.$$eval('[aria-label="后期任务"] button', n => n.map(v => v.textContent))).not.toContain("漫剧特效");
    await page.evaluate(() => { (globalThis as any).failSave = false; });
    await click("继续字幕");
    await page.waitForFunction(() => (document.querySelector('[aria-label="字幕成片"]') as HTMLSelectElement)?.value === "gs://test-only/edited.mp4");
    await page.$eval('[aria-label="对白字幕 SRT"]', node => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(node,"1\n00:00:00,000 --> 00:00:01,000\n保留原文"); node.dispatchEvent(new Event("input",{bubbles:true})); });
    await page.evaluate(() => (globalThis as any).remount());
    await page.waitForFunction(() => (document.querySelector('[aria-label="对白字幕 SRT"]') as HTMLTextAreaElement)?.value.includes("保留原文"));
    expect(await page.$eval('[aria-label="字幕成片"]', node => (node as HTMLSelectElement).value)).toBe("gs://test-only/edited.mp4");
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
