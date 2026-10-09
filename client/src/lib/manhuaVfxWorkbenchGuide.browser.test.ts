/** New guide/fullscreen paths only; no production network or paid request. */
import {expect,it} from "vitest";
import {build} from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {readFileSync,mkdirSync} from "node:fs";
import {createRequire} from "node:module";
import {compile as compileTailwind} from "tailwindcss";
import {manhuaVfxPositionAtTime,makeManhuaVfxEffect} from "./manhuaVfxWorkflow";
it("position guide agrees with the fixed Python renderer before, within and after keyframes",()=>{
 const effect={...makeManhuaVfxEffect("sword_trail","sword"),anchor:{space:"screen" as const,position:[.5,.5] as [number,number],trajectory:[{timeSec:.5,x:.1,y:.2},{timeSec:2,x:.8,y:.6},{timeSec:4,x:.3,y:.9}]}};
 const times=[0,.5,1.25,2,3,4,5];
 const actual=JSON.parse(execFileSync("python3",["-c","import sys,json;sys.path.insert(0,'server/scripts');from manhua_vfx_math import position_at;p=json.load(sys.stdin);print(json.dumps([position_at(p['effect'],t) for t in p['times']]))"],{input:JSON.stringify({effect,times}),encoding:"utf8"}));
 times.forEach((time,i)=>{const point=manhuaVfxPositionAtTime(effect,time);expect(point[0]).toBeCloseTo(actual[i][0],12);expect(point[1]).toBeCloseTo(actual[i][1],12);});
});
async function workbenchCss() {
 const require=createRequire(import.meta.url);
 const compiler=await compileTailwind(readFileSync(require.resolve("tailwindcss/theme.css"),"utf8")+readFileSync(require.resolve("tailwindcss/preflight.css"),"utf8")+"\n@tailwind utilities;");
 const source=["ManhuaVfxEditor","ManhuaVfxSurface","ManhuaVfxTimeline","ManhuaVfxComparison"].map(name=>readFileSync("client/src/components/canvas/"+name+".tsx","utf8")).join("\n");
 return "*{box-sizing:border-box}body{margin:0}"+compiler.build(source.split(/[\s"'`]+/));
}
it("页面全屏不依赖浏览器许可，保留视频与草稿，顾问留在工作台",async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React,{useState} from 'react';import{createPortal}from'react-dom';import{createRoot}from'react-dom/client';import{ManhuaVfxEditor}from'./client/src/components/canvas/ManhuaVfxEditor';import{makeManhuaVfxEffect,manhuaVfxSourceKey}from'./client/src/lib/manhuaVfxWorkflow';
 const clip={id:'clip',url:'gs://offline/source.mp4',label:'原片'};const composition={version:1,seed:1,effects:[{...makeManhuaVfxEffect('sword_trail','sword'),anchor:{space:'screen',position:[.5,.5],trajectory:[{timeSec:0,x:.1,y:.2},{timeSec:4,x:.9,y:.8}]}}]};
 const state={version:1,scopeKey:'scope',draft:{sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition},requests:{}};globalThis.saves=[];globalThis.advisorOpens=0;globalThis.generations=0;
 function Harness(){const[open,setOpen]=useState(false),[dock,setDock]=useState(null),[savedState,setSavedState]=useState(state);return <><ManhuaVfxEditor advisorOpen={open} onAdvisorDockChange={setDock} scopeKey="scope" state={savedState} clips={[clip]} jobs={[]} busy={false} onOpenAdvisor={()=>{globalThis.advisorOpens++;setOpen(true)}} onStateChange={async next=>{globalThis.saves.push(next);setSavedState(next);return next;}} onSourceChange={()=>{}} onPreview={()=>{}} onSubmit={async()=>{globalThis.generations++;return'job'}}/>{dock&&createPortal(<textarea aria-label="测试顾问输入"/>,dock)}</>}createRoot(document.getElementById('root')).render(<Harness/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true});try{
 const page=await browser.newPage();await page.setViewport({width:1440,height:900});const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,body:''}));await page.goto('http://localhost/');await page.setContent('<div id="root" style="width:380px;transform:translateZ(0);overflow:hidden"></div>');await page.addStyleTag({content:await workbenchCss()});await page.evaluate(()=>{Element.prototype.requestFullscreen=async()=>{throw new Error('not granted')};});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('video');
 await page.$eval('video',v=>{for(const[k,value]of Object.entries({duration:5,videoWidth:480,videoHeight:360}))Object.defineProperty(v,k,{configurable:true,value});v.dispatchEvent(new Event('loadedmetadata'));v.currentTime=1;v.dispatchEvent(new Event('timeupdate'));});await page.waitForSelector('[data-vfx-trajectory-path]',{timeout:5000}).catch(async error=>{console.error('trajectory diagnostics',errors,await page.$eval('video',v=>({rect:v.getBoundingClientRect().toJSON(),width:v.videoWidth,height:v.videoHeight,duration:v.duration})),await page.$eval('[aria-label="漫剧特效工作台"]',el=>el.innerHTML.slice(0,5000)));throw error;});
 expect(await page.$eval('[data-vfx-trajectory-path]',p=>p.getAttribute('points'))).toBe('0.1,0.2 0.9,0.8');
 const click=async(text:string)=>{const buttons=await page.$$('button');for(const b of buttons){if(await b.evaluate((el,label)=>el.textContent===label,text)){await b.click();return;}}throw new Error('Button missing '+text)};
 await click('用当前秒位添加轨迹点');await click('保存方案');await page.waitForFunction(()=>(globalThis as any).saves.length===1);
 const point=await page.evaluate(()=>(globalThis as any).saves[0].draft.composition.effects[0].anchor.trajectory[1]);expect(point.timeSec).toBe(1);expect(point.x).toBeCloseTo(.3);expect(point.y).toBeCloseTo(.35);
 await page.evaluate(()=>{(globalThis as any).originalVideo=document.querySelector('video')});
 await click('展开工作台');await page.waitForSelector('[data-vfx-expanded="true"]');
 expect(await page.$eval('[data-vfx-expanded="true"]',el=>{const r=el.getBoundingClientRect();return [r.x,r.y,r.width,r.height]})).toEqual([0,0,1440,900]);
 expect(await page.evaluate(()=>document.fullscreenElement)).toBeNull();
 await click('创作顾问');await page.waitForSelector('[aria-label="特效创作顾问"] [aria-label="测试顾问输入"]');
 expect(await page.evaluate(()=>(globalThis as any).advisorOpens)).toBe(1);
 expect(await page.$eval('[data-vfx-preview-column]',el=>el.getBoundingClientRect().width)).toBeGreaterThan(600);
 expect(await page.$eval('[aria-label="特效时间轴"]',el=>el.getBoundingClientRect().bottom)).toBeLessThan(850);
 mkdirSync('/tmp/matrix-vfx-ui',{recursive:true});await page.screenshot({path:'/tmp/matrix-vfx-ui/fullscreen-advisor.png'});
 await page.keyboard.press('Escape');await page.waitForSelector('[data-vfx-expanded="false"]');
 expect(await page.evaluate(()=>document.querySelector('video')===(globalThis as any).originalVideo)).toBe(true);
 expect(await page.$eval('video',v=>v.currentTime)).toBe(1);
 expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');
 await click('保存方案');await page.waitForFunction(()=>(globalThis as any).saves.length===2);
 expect(await page.evaluate(()=>(globalThis as any).saves[1].draft)).toEqual(await page.evaluate(()=>(globalThis as any).saves[0].draft));
 expect(await page.evaluate(()=>(globalThis as any).generations)).toBe(0);expect(errors).toEqual([]);
 }finally{await browser.close();}
},60_000);

it("全屏内预览真实候选，关闭预览后继续编辑且保存回执可见",async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from'react';import{createRoot}from'react-dom/client';import{ManhuaVfxEditor}from'./client/src/components/canvas/ManhuaVfxEditor';import{makeManhuaVfxEffect,manhuaVfxSourceKey}from'./client/src/lib/manhuaVfxWorkflow';
 const clip={id:'clip',url:'gs://offline/source.mp4',label:'原片'},composition={version:1,seed:1,effects:[makeManhuaVfxEffect('shield','shield')]};const draft={sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition};const id='c1007000-1234-4234-8234-123456789abc';
 const state={version:1,scopeKey:'scope',draft,requests:{[id]:{...draft,requestId:id,createdAt:1,status:'succeeded',output:{gcsUri:'gs://offline/candidate.mp4',requestId:id,sourceKey:draft.sourceKey,composition}}}};globalThis.preview=[];
 createRoot(document.getElementById('root')).render(<ManhuaVfxEditor scopeKey="scope" state={state} clips={[clip]} jobs={[]} busy={false} onStateChange={async next=>next} onSourceChange={()=>{}} onPreview={(url)=>globalThis.preview.push({url,fullscreen:Boolean(document.fullscreenElement)})} onSubmit={async()=>{throw new Error('Must not generate')}}/>);
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"{}"},logLevel:"silent"});
 const require=createRequire(import.meta.url);
 const compiler=await compileTailwind(readFileSync(require.resolve("tailwindcss/theme.css"),"utf8")+readFileSync(require.resolve("tailwindcss/preflight.css"),"utf8")+"\n@tailwind utilities;");
 const controls=["ManhuaVfxEditor","ManhuaVfxSurface","ManhuaVfxTimeline","ManhuaVfxComparison"].map(name=>readFileSync("client/src/components/canvas/"+name+".tsx","utf8")).join("\n");
 const css=compiler.build(controls.split(/[\s"'`]+/));
 const browser=await puppeteer.launch({headless:true});try{const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>r.respond({status:200,body:''}));await page.goto('http://localhost/');await page.setContent('<div id="root"></div>');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('video');await page.$eval('video',v=>{for(const[k,value]of Object.entries({duration:5,videoWidth:480,videoHeight:360}))Object.defineProperty(v,k,{configurable:true,value});v.dispatchEvent(new Event('loadedmetadata'));});
 const click=async(label:string)=>{for(const b of await page.$$('button'))if(await b.evaluate((el,text)=>el.textContent===text,label)){await b.click();return;}throw new Error('Missing '+label);};
 await click('展开工作台');await page.waitForSelector('[data-vfx-expanded="true"]');await click('保存方案');await page.waitForSelector('[aria-label="漫剧特效工作台"] [role="status"]');expect(await page.$eval('[role="status"]',n=>n.textContent)).toContain('方案已保存');await page.$eval('summary',()=>{for(const el of Array.from(document.querySelectorAll('details')))if(el.textContent?.includes('任务与候选'))el.open=true;});await click('预览候选');await page.waitForFunction(()=>(globalThis as any).preview.length===1);expect(await page.evaluate(()=>(globalThis as any).preview[0])).toEqual({url:'gs://offline/candidate.mp4',fullscreen:false});await page.waitForSelector('[aria-label="特效候选预览"] video');await click('关闭候选预览');expect(await page.$('[data-vfx-expanded="true"]')).not.toBeNull();
 }finally{await browser.close();}
},60_000);
