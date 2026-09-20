import { expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
it('真实面板首次带入对白、保存恢复及手动清空不复活，全程不调用生成', async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
 import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
 import {canvasAudioCueInputKey} from './shared/canvasAudioStudio';
 const f=globalThis.fixture={calls:[],updates:0};
 const shots=[{index:2,durationSec:4,cameraZh:'中景',actionZh:'娘看着阿菁',dialogueZh:'娘：「别怕，我在这里。」'}];
 const services=new Proxy({}, {get:(_,k)=>k==='listMusic'?async()=>[]:async()=>{f.calls.push(k);throw Error('禁止付费');}});
 function App(){const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'clip-e01-g01-seed',prompt:'目标时长：4秒',videoModel:'seedance-2.5'});const [revision,setRevision]=useState(0);f.block=block;f.addTake=()=>setBlock(b=>({...b,prompt:'目标时长：8秒',manhuaAutoSegment:{durationSec:4},audioStudio:{...b.audioStudio,cues:b.audioStudio.cues.map(c=>{const q={...c,startSec:0,endSec:4};return {...q,takes:[{id:'fit-original',durationSec:4.944,gcsUri:'gs://test-bucket/original.wav',previewUrl:'https://test.invalid/original.wav',createdAt:'2026-09-20',inputKey:canvasAudioCueInputKey(q)}]};})}}));f.addCollision=(duration)=>setBlock(b=>({...b,prompt:'目标时长：'+duration+'秒',audioStudio:{...b.audioStudio,cues:[{...b.audioStudio.cues[0],startSec:0,endSec:4},...[[4,7],[7,12]].map(([startSec,endSec],i)=>({...b.audioStudio.cues[0],id:'following-'+i,speakerZh:'后句'+i,startSec,endSec,takes:[],approved:true}))]}}));f.clear=()=>setBlock(b=>({...b,audioStudio:{...b.audioStudio,cues:[]}}));f.remount=()=>setRevision(n=>n+1);return <CanvasAudioStudioView key={revision} block={block} sourceShots={shots} services={services} onChange={audioStudio=>{f.updates++;setBlock(b=>({...b,audioStudio}));}}/>;}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')}});
 const browser=await puppeteer.launch({headless:true});
 try {const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await page.setRequestInterception(true);page.on('request',r=>void r.abort());await page.setContent('<div id="root"></div>');await page.addScriptTag({content:built.outputFiles[0].text});
 await page.waitForFunction(()=>Boolean((window as any).fixture.block.audioStudio?.cues.length));
 expect(await page.evaluate(()=>(window as any).fixture.block.audioStudio.cues.map((c:any)=>[c.speakerZh,c.textZh]))).toEqual([['娘','别怕，我在这里。']]);
 expect(await page.$eval('[aria-label="1 音色"]',el=>(el as HTMLSelectElement).value)).toBe('');
 await page.evaluate(()=>(window as any).fixture.remount());await page.waitForFunction(()=>(window as any).fixture.updates===1);
 await page.evaluate(()=>(window as any).fixture.addTake());
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('将本句窗口延长至')));
 await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('将本句窗口延长至'));b!.click();});
 await page.waitForFunction(()=>(window as any).fixture.block.audioStudio.cues[0].endSec===4.944);
 expect(await page.evaluate(()=>(window as any).fixture.block.audioStudio.cues[0].takes[0].id)).toBe('fit-original');
 expect(await page.evaluate(()=>(window as any).fixture.block.audioStudio.cues[0].approved)).toBe(false);
 await page.evaluate(()=>(window as any).fixture.addCollision(12));
 await page.waitForFunction(()=>document.body.textContent?.includes('12.944'));
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('应用对白时间')))).toBe(false);
 await page.evaluate(()=>(window as any).fixture.addCollision(13));
 await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(b=>b.textContent?.includes('应用对白时间')));
 await page.evaluate(()=>{Array.from(document.querySelectorAll('summary')).find(b=>b.textContent?.includes('预览后续对白顺延'))!.click();});
 await page.evaluate(()=>{Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('应用对白时间'))!.click();});
 await page.waitForFunction(()=>(window as any).fixture.block.audioStudio.cues[2].endSec===12.944);
 expect(await page.evaluate(()=>(window as any).fixture.block.audioStudio.cues.map((c:any)=>[c.startSec,c.endSec,c.approved]))).toEqual([[0,4.944,false],[4.944,7.944,false],[7.944,12.944,false]]);
 expect(await page.evaluate(()=>(window as any).fixture.block.audioStudio.cues[0].takes[0].id)).toBe('fit-original');
 await page.evaluate(()=>(window as any).fixture.remount());
 await page.waitForFunction(()=>(document.querySelector('[aria-label="3 片内结束秒"]') as HTMLInputElement)?.value==='12.944');
 await page.evaluate(()=>{(window as any).fixture.clear();});await page.waitForFunction(()=>(window as any).fixture.block.audioStudio.cues.length===0);
 await page.evaluate(()=>(window as any).fixture.remount());await page.waitForSelector('[aria-label="角色配音摘要"]');
 expect(await page.evaluate(()=>(window as any).fixture.block.audioStudio.cues)).toEqual([]);
 expect(await page.evaluate(()=>(window as any).fixture.calls)).toEqual([]);expect(errors).toEqual([]);
 } finally {await browser.close();}
},120000);
