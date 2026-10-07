/** New workbench controls against real React components; storage/media transport are offline fixtures. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("timeline edits reach saved/submitted recipes; comparison and adoption use real receipts and reject a changed source", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ManhuaVfxEditor} from './client/src/components/canvas/ManhuaVfxEditor';
    import {makeManhuaVfxEffect,manhuaVfxSourceKey} from './client/src/lib/manhuaVfxWorkflow';
    const clip={id:'clip',url:'gs://offline/source.mp4',label:'原片'},other={id:'other',url:'gs://offline/other.mp4',label:'另一原片'};
    const composition={version:1,seed:1,effects:[makeManhuaVfxEffect('shield','shield')]};
    const draft={sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition};
    const id='c1007000-1234-4234-8234-123456789abc';
    const state={version:1,scopeKey:'scope',draft,requests:{[id]:{...draft,requestId:id,createdAt:1,status:'succeeded',output:{gcsUri:'gs://offline/candidate.mp4',requestId:id,sourceKey:draft.sourceKey,composition}}}};
    globalThis.saves=[];globalThis.submitted=[];globalThis.plays=[];
    HTMLMediaElement.prototype.play=function(){globalThis.plays.push(this.src);return Promise.resolve();};HTMLMediaElement.prototype.pause=function(){};
    createRoot(document.getElementById('root')).render(<ManhuaVfxEditor scopeKey="scope" state={state} clips={[clip,other]} jobs={[]} busy={false}
      onStateChange={async next=>{globalThis.saves.push(JSON.parse(JSON.stringify(next)));return next;}}
      onSubmit={async input=>{globalThis.submitted.push(input);return 'new-real-intent-job';}}
      onSourceChange={()=>{}} onPreview={()=>{}}/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();const errors:string[]=[];page.on('pageerror', error=>errors.push(String(error)));
    await page.setRequestInterception(true);page.on('request', request=>request.respond({status:200,body:''}));await page.goto('http://localhost/');await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('video');
    const metadata=async()=>page.$$eval('video', videos=>videos.forEach(video=>{for(const[key,value]of Object.entries({duration:5,videoWidth:480,videoHeight:360}))Object.defineProperty(video,key,{configurable:true,value});video.dispatchEvent(new Event('loadedmetadata'));}));
    const click=async(label:string)=>page.evaluate(label=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label);if(!b||b.disabled)throw new Error('Unavailable button '+label);b.click();},label);
    const range=async(label:string,value:string)=>{await page.$eval('input[aria-label="'+label+'"]',(input,value)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,value);input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));},value);};
    await metadata();await range('所选特效开始时间','1.5');await range('所选特效结束时间','3.25');await click('保存方案');await page.waitForFunction(()=>(globalThis as any).saves.length===1);
    expect(await page.evaluate(()=>(globalThis as any).saves[0].draft.composition.effects[0])).toMatchObject({startSec:1.5,durationSec:1.75});
    await click('与原片比较');await page.waitForSelector('[aria-label="原片与候选比较"]');await metadata();
    expect(await page.$$eval('[aria-label="原片与候选比较"] video',videos=>videos.map(v=>v.src))).toHaveLength(2);
    await click('从头一起播放');await page.waitForFunction(()=>(globalThis as any).plays.length===2);
    expect(await page.$$eval('[aria-label="原片与候选比较"] video',videos=>videos.map(v=>v.muted))).toEqual([false,true]);
    await page.select('[aria-label="比较时播放哪一路声音"]','candidate');expect(await page.$$eval('[aria-label="原片与候选比较"] video',videos=>videos.map(v=>v.muted))).toEqual([true,false]);
    expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用此候选')!.disabled)).toBe(true);
    await click('恢复此方案');await click('采用此候选');await page.waitForFunction(()=>(globalThis as any).saves.some((s: { adoptedRequestId?: string })=>s.adoptedRequestId));
    expect(await page.evaluate(()=>(globalThis as any).submitted.length)).toBe(0);
    await range('所选特效开始时间','2');await range('所选特效结束时间','4');await click('渲染特效候选');await page.waitForFunction(()=>(globalThis as any).submitted.length===1);
    expect(await page.evaluate(()=>(globalThis as any).submitted[0].params.composition.effects[0])).toMatchObject({startSec:2,durationSec:2});
    await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='保存方案'&&!b.disabled));
    await page.select('select:not([aria-label])','other');await page.waitForFunction(()=>!document.querySelector('[aria-label="原片与候选比较"]'));
    expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='与原片比较'))).toBe(false);
    expect(errors).toEqual([]);
  } finally {await browser.close();}
},60_000);
