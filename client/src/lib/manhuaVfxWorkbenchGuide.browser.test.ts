/** New guide/fullscreen paths only; no production network or paid request. */
import {expect,it} from "vitest";
import {build} from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {compile as compileTailwind} from "tailwindcss";
import {manhuaVfxPositionAtTime,makeManhuaVfxEffect} from "./manhuaVfxWorkflow";
it("position guide agrees with the fixed Python renderer before, within and after keyframes",()=>{
 const effect={...makeManhuaVfxEffect("sword_trail","sword"),anchor:{space:"screen" as const,position:[.5,.5] as [number,number],trajectory:[{timeSec:.5,x:.1,y:.2},{timeSec:2,x:.8,y:.6},{timeSec:4,x:.3,y:.9}]}};
 const times=[0,.5,1.25,2,3,4,5];
 const actual=JSON.parse(execFileSync("python3",["-c","import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_math import position_at;p=json.load(sys.stdin);print(json.dumps([position_at(p['effect'],t) for t in p['times']]))"],{input:JSON.stringify({effect,times}),encoding:"utf8"}));
 times.forEach((time,i)=>{const point=manhuaVfxPositionAtTime(effect,time);expect(point[0]).toBeCloseTo(actual[i][0],12);expect(point[1]).toBeCloseTo(actual[i][1],12);});
});
it("shows actual trajectory, records interpolated position, expands and opens the real advisor callback",async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{ManhuaVfxEditor}from'./client/src/components/canvas/ManhuaVfxEditor';import{makeManhuaVfxEffect,manhuaVfxSourceKey}from'./client/src/lib/manhuaVfxWorkflow';
 const clip={id:'clip',url:'gs://offline/source.mp4',label:'原片'};const composition={version:1,seed:1,effects:[{...makeManhuaVfxEffect('sword_trail','sword'),anchor:{space:'screen',position:[.5,.5],trajectory:[{timeSec:0,x:.1,y:.2},{timeSec:4,x:.9,y:.8}]}}]};
 const state={version:1,scopeKey:'scope',draft:{sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition},requests:{}};globalThis.saves=[];globalThis.advisorOpens=0;globalThis.generations=0;
 createRoot(document.getElementById('root')).render(<ManhuaVfxEditor scopeKey="scope" state={state} clips={[clip]} jobs={[]} busy={false} onOpenAdvisor={()=>globalThis.advisorOpens++} onStateChange={async next=>{globalThis.saves.push(next);return next;}} onSourceChange={()=>{}} onPreview={()=>{}} onSubmit={async()=>{globalThis.generations++;return'job'}}/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});try{
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,body:''}));await page.goto('http://localhost/');await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('video');
 await page.$eval('video',v=>{for(const[k,value]of Object.entries({duration:5,videoWidth:480,videoHeight:360}))Object.defineProperty(v,k,{configurable:true,value});v.dispatchEvent(new Event('loadedmetadata'));v.currentTime=1;v.dispatchEvent(new Event('timeupdate'));});await page.waitForSelector('[data-vfx-trajectory-path]');
 expect(await page.$eval('[data-vfx-trajectory-path]',p=>p.getAttribute('points'))).toBe('0.1,0.2 0.9,0.8');
 const click=async(text:string)=>{const buttons=await page.$$('button');for(const b of buttons){if(await b.evaluate((el,label)=>el.textContent===label,text)){await b.click();return;}}throw new Error('Button missing '+text)};
 await click('用当前秒位添加轨迹点');await click('保存方案');await page.waitForFunction(()=>(globalThis as any).saves.length===1);
 const point=await page.evaluate(()=>(globalThis as any).saves[0].draft.composition.effects[0].anchor.trajectory[1]);expect(point.timeSec).toBe(1);expect(point.x).toBeCloseTo(.3);expect(point.y).toBeCloseTo(.35);
 await click('展开工作台');await page.waitForFunction(()=>document.fullscreenElement?.getAttribute('aria-label')==='漫剧特效工作台');await click('创作顾问');await page.waitForFunction(()=>!document.fullscreenElement&&(globalThis as any).advisorOpens===1);
 expect(await page.evaluate(()=>(globalThis as any).generations)).toBe(0);expect(errors).toEqual([]);
 }finally{await browser.close();}
},60_000);

it("leaves fullscreen before opening the existing candidate viewer and shows save receipts inside the workbench",async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from'react';import{createRoot}from'react-dom/client';import{ManhuaVfxEditor}from'./client/src/components/canvas/ManhuaVfxEditor';import{makeManhuaVfxEffect,manhuaVfxSourceKey}from'./client/src/lib/manhuaVfxWorkflow';
 const clip={id:'clip',url:'gs://offline/source.mp4',label:'原片'},composition={version:1,seed:1,effects:[makeManhuaVfxEffect('shield','shield')]};const draft={sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition};const id='c1007000-1234-4234-8234-123456789abc';
 const state={version:1,scopeKey:'scope',draft,requests:{[id]:{...draft,requestId:id,createdAt:1,status:'succeeded',output:{gcsUri:'gs://offline/candidate.mp4',requestId:id,sourceKey:draft.sourceKey,composition}}}};globalThis.preview=[];
 createRoot(document.getElementById('root')).render(<ManhuaVfxEditor scopeKey="scope" state={state} clips={[clip]} jobs={[]} busy={false} onStateChange={async next=>next} onSourceChange={()=>{}} onPreview={(url)=>globalThis.preview.push({url,fullscreen:Boolean(document.fullscreenElement)})} onSubmit={async()=>{throw new Error('Must not generate')}}/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},logLevel:"silent"});
 const require=createRequire(import.meta.url);
 const compiler=await compileTailwind(readFileSync(require.resolve("tailwindcss/theme.css"),"utf8")+"\n@tailwind utilities;");
 const controls=["ManhuaVfxEditor","ManhuaVfxTimeline","ManhuaVfxComparison"].map(name=>readFileSync("client/src/components/canvas/"+name+".tsx","utf8")).join("\n");
 const css=compiler.build(controls.split(/[\s"'`]+/));
 const browser=await puppeteer.launch({headless:true});try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,body:''}));await page.goto('http://localhost/');await page.setContent('<div id="root"></div>');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('video');await page.$eval('video',v=>{for(const[k,value]of Object.entries({duration:5,videoWidth:480,videoHeight:360}))Object.defineProperty(v,k,{configurable:true,value});v.dispatchEvent(new Event('loadedmetadata'));});
 const click=async(label:string)=>{for(const b of await page.$$('button'))if(await b.evaluate((el,text)=>el.textContent===text,label)){await b.click();return;}throw new Error('Missing '+label);};
 await click('展开工作台');await page.waitForFunction(()=>Boolean(document.fullscreenElement));await click('保存方案');await page.waitForSelector('[aria-label="漫剧特效工作台"] [role="status"]');expect(await page.$eval('[role="status"]',n=>n.textContent)).toContain('方案已保存');await click('预览候选');await page.waitForFunction(()=>(globalThis as any).preview.length===1);expect(await page.evaluate(()=>(globalThis as any).preview[0])).toEqual({url:'gs://offline/candidate.mp4',fullscreen:false});
 }finally{await browser.close();}
},60_000);
