/** 检查 Portal 弹窗在浅/深背景下的真实计算颜色，避免继承白字。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import puppeteer from "puppeteer";
import path from "node:path";
it("录音弹窗独立于工作台时，浅色和深色主题按钮仍可读", async () => {
 const bundle=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React from 'react';import {createRoot}from'react-dom/client';import{DigitalHumanRecorder}from'./client/src/components/DigitalHumanRecorder';
 Object.defineProperty(navigator,'mediaDevices',{value:{enumerateDevices:async()=>[]}});
 createRoot(document.getElementById('root')).render(<DigitalHumanRecorder onClose={()=>{}} onUse={async()=>{}}/>);
 `},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',alias:{'@':path.resolve('client/src'),'@shared':path.resolve('shared')},define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
 const css=await readFile('client/src/components/DigitalHumanStudio.css','utf8');
 const browser=await puppeteer.launch({headless:true});
 try {
 const page=await browser.newPage();await page.setContent('<html><body><div id="root"></div></body></html>');await page.addStyleTag({content:'body{color:white;background:#151515}button{color:inherit;background:transparent}'+css});await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForSelector('[role="dialog"]');
 for(const theme of ['dark','light']){
 await page.evaluate(t=>{document.documentElement.className=t;document.body.style.color=t==='dark'?'white':'black';},theme);
 const colors=await page.evaluate(()=>Array.from(document.querySelectorAll('.dh-recording-dialog button')).filter(b=>b.textContent?.includes('录音')||b.textContent?.includes('使用这段声音')).map(b=>{const s=getComputedStyle(b);return {fg:s.color,bg:s.backgroundColor,opacity:s.opacity};}));
 expect(colors.length).toBe(2);
 const luminance=(rgb:string)=>{const c=rgb.match(/[\d.]+/g)!.slice(0,3).map(v=>Number(v)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return .2126*c[0]+.7152*c[1]+.0722*c[2];};
 for(const c of colors){const a=luminance(c.fg),b=luminance(c.bg);expect((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toBeGreaterThanOrEqual(4.5);expect(c.opacity).toBe('1');}
 }
 }finally{await browser.close();}
},60_000);
