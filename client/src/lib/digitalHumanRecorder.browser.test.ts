/** 独立无头浏览器操作真实录音组件；模拟麦克风信号，不使用用户设备或云服务。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("完整旁白显示全文、真实浏览器编码试听后采用，声线模式仍显示样本提示", async () => {
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';
 import {DigitalHumanRecorder} from './client/src/components/DigitalHumanRecorder';
 const ctx=new AudioContext({sampleRate:48000});const dest=ctx.createMediaStreamDestination();const osc=ctx.createOscillator();osc.frequency.value=440;osc.connect(dest);osc.start();
 const track=dest.stream.getAudioTracks()[0];Object.defineProperty(track,'label',{value:'Built-in Mic Test'});track.getSettings=()=>({deviceId:'test-mic',channelCount:2,sampleRate:48000});
 Object.defineProperty(navigator,'mediaDevices',{value:{enumerateDevices:async()=>[{kind:'audioinput',deviceId:'test-mic',label:'Built-in Mic Test'}],getUserMedia:async()=>{await ctx.resume();return dest.stream;}}});
 const root=createRoot(document.getElementById('root'));globalThis.used=null;globalThis.closed=false;
 globalThis.mount=mode=>root.render(<DigitalHumanRecorder key={mode} mode={mode} script={'第一句完整旁白。\\n第二句自然停顿。'} onClose={()=>{globalThis.closed=true;}} onUse={async file=>{const buf=await file.arrayBuffer();const view=new DataView(buf);globalThis.used={bytes:file.size,channels:view.getUint16(22,true),sampleRate:view.getUint32(24,true),duration:view.getUint32(40,true)/view.getUint32(28,true)};}}/>);
 globalThis.mount('narration');
 `},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'},logLevel:"silent"});
 const browser=await puppeteer.launch({headless:true,args:["--autoplay-policy=no-user-gesture-required"]});
 try {
 const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 await page.setContent('<html><body><div id="root"></div></body></html>');await page.addScriptTag({content:bundle.outputFiles[0].text});
 await page.waitForFunction(()=>document.body.textContent?.includes('第二句自然停顿。'));
 expect(await page.evaluate(()=>document.body.textContent)).toContain('最多5分钟');
 const click=async(text:string)=>page.evaluate(t=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent===t);if(!b)throw Error('缺少按钮'+t);b.click();},text);
 await click('开始录音');await page.waitForFunction(()=>/正在录音 · [4-9]/.test(document.body.textContent||''));await click('停止录音');
 await page.waitForFunction(()=>Boolean(document.querySelector('audio')||document.querySelector('[role=alert]')));
 expect(await page.evaluate(()=>document.querySelector('[role=alert]')?.textContent||'')).toBe('');
 await page.waitForSelector('audio');
 expect(await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用为完整旁白')?.disabled)).toBe(true);
 await page.evaluate(()=>{document.querySelector('audio')!.dispatchEvent(new Event('ended'));(document.querySelector('input[type=checkbox]') as HTMLInputElement).click();});
 await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='采用为完整旁白')?.disabled);
 await click('采用为完整旁白');await page.waitForFunction(()=>Boolean((globalThis as any).used));
 const used=await page.evaluate(()=>(globalThis as any).used);expect(used.duration).toBeGreaterThanOrEqual(3);expect(used.bytes).toBeGreaterThan(10000);expect([1,2]).toContain(used.channels);expect(used.sampleRate).toBe(48000);
 await page.evaluate(()=>(globalThis as any).mount('sample'));await page.waitForFunction(()=>document.body.textContent?.includes('建议15–20秒'));
 expect(await page.evaluate(()=>document.body.textContent)).toContain('声线样本');
 expect(errors).toEqual([]);
 }finally{await browser.close();}
},60_000);
