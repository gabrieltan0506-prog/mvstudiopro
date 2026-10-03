import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

it("字幕字号选择只改变烧录样式，默认放大50%，保持原素材与已确认SRT",async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`import React from'react';import{createRoot}from'react-dom/client';import{PostProdSubtitleCard}from'./client/src/components/canvas/PostProdSubtitleCard';window.sent=[];createRoot(document.getElementById('root')).render(<PostProdSubtitleCard clips={[{id:'original',url:'https://test.invalid/original.mp4',label:'原片'}]} busy={false} storageKey="test-subtitle" onSubmit={async p=>{window.sent.push(p)}}/>);`},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',tsconfig:'tsconfig.json',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'offline-trpc',setup(b){b.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'stub',namespace:'offline'}));b.onLoad({filter:/.*/,namespace:'offline'},()=>({contents:'export const trpc={mvAnalysis:{askPlatformSkillQa:{useMutation:()=>({mutateAsync:()=>{throw Error("unexpected model call")}})},getManhuaAdvisorQuota:{useQuery:()=>({})}}}',loader:'js'}));}}]});
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:built.outputFiles[0].text});
  await page.select('[aria-label="字幕成片"]','https://test.invalid/original.mp4');
  await page.$eval('[aria-label="对白字幕 SRT"]',e=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(e,'1\n00:00:01,000 --> 00:00:03,000\n已确认对白\n');e.dispatchEvent(new Event('input',{bubbles:true}));});
  expect(await page.$eval('[aria-label="字幕字号"]',e=>(e as HTMLSelectElement).value)).toBe('12');
  for(const [i,size] of Array.from([12,16,8].entries())){
   await page.select('[aria-label="字幕字号"]',String(size));
   await page.evaluate(()=>{const b=Array.from(document.querySelectorAll('button')).find(b=>b.textContent?.includes('添加字幕'))!;b.click();});
   await page.waitForFunction(n=>(window as any).sent.length===n,{},i+1);
  }
  const sent=await page.evaluate(()=>(window as any).sent);
  expect(sent.map((p:any)=>p.styleOverride.fontSize)).toEqual([12,16,8]);
  expect(new Set(sent.map((p:any)=>p.videoUri))).toEqual(new Set(['https://test.invalid/original.mp4']));
  expect(new Set(sent.map((p:any)=>p.subtitleSrt)).size).toBe(1);expect(sent[0].subtitleSrt).toContain('00:00:01,000 --> 00:00:03,000');expect(sent[0].subtitleSrt).toContain('已确认对白');
 }finally{await browser.close()}
},30000);
