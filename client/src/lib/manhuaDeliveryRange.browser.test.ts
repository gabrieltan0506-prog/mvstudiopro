import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
let browser: Browser, bundle: string;
beforeAll(async () => {
 const result = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
 import React from 'react'; import {createRoot} from 'react-dom/client';
 import JSZip from 'jszip'; import Dock from './client/src/components/canvas/ManhuaClipDock';
 import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
 const f=globalThis.fixture={prepared:[],fetches:[],alerts:[],packs:[],release:null};
 window.alert=s=>f.alerts.push(s);
 globalThis.fetch=async url=>{f.fetches.push(String(url));return new Response(new Uint8Array([1,2,3]));};
 URL.createObjectURL=blob=>{JSZip.loadAsync(blob).then(async zip=>f.packs.push(JSON.parse(await zip.file('manifest.json').async('string'))));return 'blob:offline';}; URL.revokeObjectURL=()=>{}; HTMLAnchorElement.prototype.click=function(){};
 const blocks=[1,2].map(ep=>({...defaultCanvasBlock('video',0,0),id:'final-e0'+ep,episodeIndex:ep,outputUrl:'https://test.invalid/e'+ep+'.mp4',outputUrls:['https://test.invalid/e'+ep+'.mp4']}));
 createRoot(document.getElementById('root')).render(<Dock blocks={blocks} currentEpisodeIndex={2} selectedIds={new Set(['unrelated-e01-fragment'])} onSelectedIdsChange={()=>{}} onPrepareDeliveryAudio={async finals=>{f.prepared.push(finals);await new Promise(r=>f.release=r);return Object.fromEntries(finals.map(x=>[x.url,{url:x.url+'.wav',ext:'wav'}]));}}/>);
 ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" } });
 bundle=result.outputFiles[0]!.text; browser=await puppeteer.launch({headless:true});
}, 120000);
afterAll(async()=>{await browser?.close();});
it("真实交付面板将独立集选择贯通抽轨和ZIP；空选无请求，忙时锁范围", async()=>{
 const page=await browser.newPage(); const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setRequestInterception(true);page.on('request',r=>{if(r.isNavigationRequest())void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'});else void r.abort();});
 try {
  await page.goto('http://localhost:41816');await page.addScriptTag({content:bundle});await page.waitForSelector('[aria-label="交付包导出范围"]');
  const click=()=>page.evaluate(()=>{(Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='生成交付包') as HTMLButtonElement).click();});
  await page.select('[aria-label="交付包导出范围"]','selected');await click();
  expect(await page.evaluate(()=>(globalThis as any).fixture.prepared.length)).toBe(0);
  expect(await page.evaluate(()=>(globalThis as any).fixture.alerts.pop())).toContain('至少选择一集');
  await page.click('[aria-label="交付第1集"]');await click();await page.waitForFunction(()=>(globalThis as any).fixture.prepared.length===1);
  expect(await page.evaluate(()=>(globalThis as any).fixture.prepared[0].map((r:any)=>r.episodeIndex))).toEqual([1]);
  expect(await page.$eval('[aria-label="交付包导出范围"]',e=>(e as HTMLSelectElement).matches(':disabled'))).toBe(true);
  await page.evaluate(()=>(globalThis as any).fixture.release());await page.waitForFunction(()=>(globalThis as any).fixture.packs.length===1);
  expect(await page.evaluate(()=>(globalThis as any).fixture.packs[0].deliveryEpisodeIndexes)).toEqual([1]);
  await page.select('[aria-label="交付包导出范围"]','current');await click();await page.waitForFunction(()=>(globalThis as any).fixture.prepared.length===2);
  expect(await page.evaluate(()=>(globalThis as any).fixture.prepared[1].map((r:any)=>r.episodeIndex))).toEqual([2]);
  await page.evaluate(()=>(globalThis as any).fixture.release());await page.waitForFunction(()=>(globalThis as any).fixture.packs.length===2);
  expect(await page.evaluate(()=>(globalThis as any).fixture.packs[1].deliveryEpisodeIndexes)).toEqual([2]);
  expect(errors).toEqual([]);
 } finally {await page.close();}
},60000);
