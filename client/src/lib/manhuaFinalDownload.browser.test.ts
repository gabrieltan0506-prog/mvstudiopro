import { expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
it('成片预览直接下载：不触发合成或抽轨，失败后可重试',async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import Dock from './client/src/components/canvas/ManhuaClipDock';
 const f=globalThis.fixture={fetches:[],downloads:[],generated:0,fail:true};
 fetch=async url=>{f.fetches.push(String(url));return new Response(new Uint8Array([0,0,0,24,102,116,121,112]),{status:f.fail?403:200});};
 URL.createObjectURL=blob=>{f.bytes=blob.size;return 'blob:verified';};URL.revokeObjectURL=()=>{};
 HTMLAnchorElement.prototype.click=function(){f.downloads.push(this.download);};
 createRoot(document.getElementById('root')).render(<Dock blocks={[]} selectedIds={new Set()} onSelectedIdsChange={()=>{}} seriesTitle='墨菁传' finalVideoUrl='https://test.invalid/final.mp4' onAssembleFinal={()=>f.generated++} onPrepareDeliveryAudio={async()=>{f.generated++;return {};}}/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"test"','import.meta.env':'{}'}});
 const browser=await puppeteer.launch({headless:true});const page=await browser.newPage();
 try{await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
 await page.goto('http://localhost:41817');await page.addScriptTag({content:built.outputFiles[0]!.text});
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('下载成片 MP4')));
 const click=()=>page.evaluate(()=>{(Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('下载成片 MP4')) as HTMLButtonElement).click();});
 await click();await page.waitForSelector('[role="alert"]');expect(await page.$eval('[role="alert"]',e=>e.textContent)).toContain('HTTP 403');expect(await page.$eval('video',e=>e.getAttribute('src'))).toBe('https://test.invalid/final.mp4');
 await page.evaluate(()=>(globalThis as any).fixture.fail=false);await click();await page.waitForFunction(()=>(globalThis as any).fixture.downloads.length===1);
 const result=await page.evaluate(()=>(globalThis as any).fixture);expect(result.downloads).toEqual(['墨菁传.mp4']);expect(result.bytes).toBe(8);expect(result.generated).toBe(0);expect(result.fetches).toHaveLength(2);
 }finally{await browser.close();}
},60000);
