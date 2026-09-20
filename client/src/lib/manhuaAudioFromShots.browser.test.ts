import { expect, it } from 'vitest';
import { build } from 'esbuild';
import puppeteer from 'puppeteer';
import path from 'node:path';
it('真实面板首次带入对白、保存恢复及手动清空不复活，全程不调用生成', async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {CanvasAudioStudioView} from './client/src/components/canvas/CanvasAudioStudio';
 import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
 const f=globalThis.fixture={calls:[],updates:0};
 const shots=[{index:2,durationSec:4,cameraZh:'中景',actionZh:'娘看着阿菁',dialogueZh:'娘：「别怕，我在这里。」'}];
 const services=new Proxy({}, {get:(_,k)=>k==='listMusic'?async()=>[]:async()=>{f.calls.push(k);throw Error('禁止付费');}});
 function App(){const [block,setBlock]=useState({...defaultCanvasBlock('video',0,0),id:'clip-e01-g01-seed',prompt:'目标时长：4秒',videoModel:'seedance-2.5'});const [revision,setRevision]=useState(0);f.block=block;f.clear=()=>setBlock(b=>({...b,audioStudio:{...b.audioStudio,cues:[]}}));f.remount=()=>setRevision(n=>n+1);return <CanvasAudioStudioView key={revision} block={block} sourceShots={shots} services={services} onChange={audioStudio=>{f.updates++;setBlock(b=>({...b,audioStudio}));}}/>;}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')}});
 const browser=await puppeteer.launch({headless:true});
 try {const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));await page.setRequestInterception(true);page.on('request',r=>void r.abort());await page.setContent('<div id="root"></div>');await page.addScriptTag({content:built.outputFiles[0].text});
 await page.waitForFunction(()=>Boolean((window as any).fixture.block.audioStudio?.cues.length));
 expect(await page.evaluate(()=>(window as any).fixture.block.audioStudio.cues.map((c:any)=>[c.speakerZh,c.textZh]))).toEqual([['娘','别怕，我在这里。']]);
 expect(await page.$eval('[aria-label="1 音色"]',el=>(el as HTMLSelectElement).value)).toBe('');
 await page.evaluate(()=>(window as any).fixture.remount());await page.waitForFunction(()=>(window as any).fixture.updates===1);
 await page.evaluate(()=>{(window as any).fixture.clear();});await page.waitForFunction(()=>(window as any).fixture.block.audioStudio.cues.length===0);
 await page.evaluate(()=>(window as any).fixture.remount());await page.waitForSelector('[aria-label="角色配音摘要"]');
 expect(await page.evaluate(()=>(window as any).fixture.block.audioStudio.cues)).toEqual([]);
 expect(await page.evaluate(()=>(window as any).fixture.calls)).toEqual([]);expect(errors).toEqual([]);
 } finally {await browser.close();}
},120000);
