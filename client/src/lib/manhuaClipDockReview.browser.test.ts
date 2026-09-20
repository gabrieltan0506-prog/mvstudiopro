import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("终审真实缺口、范围门禁、去处理定位与高级导出折叠",async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import Dock from './client/src/components/canvas/ManhuaClipDock';
 import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
 const f=globalThis.fixture={episodes:[],workbench:0,paid:0};
 const blocks=[{...defaultCanvasBlock('video',0,0),id:'clip-e01-g01',episodeIndex:1},
 {...defaultCanvasBlock('video',0,0),id:'clip-e01-g02',episodeIndex:1,outputUrl:'https://test.invalid/clip.mp4',manhuaClipQuality:{status:'unverified'}},
 {...defaultCanvasBlock('video',0,0),id:'clip-e02-g01',episodeIndex:2,archivedFromPreviousScript:true},
 {...defaultCanvasBlock('video',0,0),id:'final-e03',episodeIndex:3,outputUrl:'https://test.invalid/final.mp4'}];
 createRoot(document.getElementById('root')).render(<Dock reviewMode blocks={blocks} currentEpisodeIndex={1} selectedIds={new Set()} onSelectedIdsChange={()=>{}} onSelectEpisode={ep=>f.episodes.push(ep)} onGoWorkbench={()=>f.workbench++} onAssembleFinal={()=>f.paid++}/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"test"',"import.meta.env":"{}"}});
 const browser=await puppeteer.launch({headless:true}); const page=await browser.newPage();
 try {
 await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
 await page.goto('http://localhost:41819');await page.addScriptTag({content:built.outputFiles[0]!.text});await page.waitForSelector('[data-manhua-delivery-gaps]');
 const text=await page.$eval('[data-manhua-delivery-gaps]',e=>e.textContent);
 expect(text).toContain('1段尚无成片');expect(text).toContain('1段待质检或采用决定');expect(text).not.toContain('第2集');expect(text).toContain('第3集');expect(text).toContain('声音仍需播放确认');
 expect(await page.$$('[data-manhua-delivery-primary]')).toHaveLength(1);
 expect(await page.$eval('[data-manhua-delivery-primary]',e=>(e as HTMLButtonElement).disabled)).toBe(false);
 expect(await page.$eval('details',e=>e.hasAttribute('open'))).toBe(false);
 await page.click('[aria-label="去处理第1集"]');expect(await page.evaluate(()=>(globalThis as any).fixture)).toEqual({episodes:[1],workbench:1,paid:0});
 await page.select('[aria-label="交付包导出范围"]','current');
 expect(await page.$eval('[data-manhua-delivery-primary]',e=>(e as HTMLButtonElement).disabled)).toBe(true);
 await page.select('[aria-label="交付包导出范围"]','selected');expect(await page.$eval('[data-manhua-delivery-gaps]',e=>e.textContent)).toContain('请选择要交付的集');
 await page.click('[aria-label="交付第3集"]');expect(await page.$eval('[data-manhua-delivery-primary]',e=>(e as HTMLButtonElement).disabled)).toBe(false);
 expect(await page.$eval('[data-manhua-delivery-gaps]',e=>e.textContent)).not.toContain('第1集');
 } finally {await browser.close();}
},60000);
