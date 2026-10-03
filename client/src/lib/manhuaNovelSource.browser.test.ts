import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";

it("小说UI选段只改草稿，超长输入保留原文，关闭使用恢复普通扩写且保留已采用来源",async()=>{
 const built=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import {ManhuaNovelSourcePanel} from './client/src/components/canvas/ManhuaNovelSourcePanel';
 import {prepareNovelExcerpt} from './shared/manhuaNovelSource';
 const fixture=globalThis.fixture={generated:0};
 const first='第一章 医馆\\n'+'阿菁背着娘来到医馆。'.repeat(12);
 const second='第二章 风雨\\n'+'墨屠守住门口，等待消息。'.repeat(12);
 function App(){const [value,setValue]=useState({name:'测试原著',text:first+'\\n'+second,from:0,to:0,enabled:false});fixture.draft=value;fixture.excerpt=prepareNovelExcerpt(value);return <ManhuaNovelSourcePanel value={value} onChange={setValue} episodes={[{index:1,title:'已采用',body:'原稿',endHook:'钩子',sourceExcerpt:{label:'旧原著·第一章',text:first},sourceSha256:'a'.repeat(64),sourceNotes:'原文保留，改编待审'}]}/>};createRoot(document.getElementById('root')).render(<App/>);
 `},external:["pdfjs-dist","tesseract.js"],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",tsconfig:"tsconfig.json",define:{"process.env.NODE_ENV":'"test"'}});
 const browser=await puppeteer.launch({headless:true});
 try{
  const page=await browser.newPage();const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent('<div id="root"></div>');await page.addScriptTag({content:built.outputFiles[0].text});
  await page.click('[data-manhua-novel-source] > summary');
  await page.select('[aria-label="小说起始章节"]','1');
  await page.click('[aria-label="采用小说原文"]');
  const selected=await page.evaluate(()=>({draft:(window as any).fixture.draft,excerpt:(window as any).fixture.excerpt,generated:(window as any).fixture.generated}));
  expect(selected.draft.from).toBe(1);expect(selected.draft.to).toBe(1);expect(selected.excerpt.text).toContain('第二章 风雨');expect(selected.excerpt.text).not.toContain('第一章');expect(selected.generated).toBe(0);
  // Simulate a large paste via the native input setter (React's normal input event path).
  await page.$eval('[aria-label="小说原文"]',element=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value')!.set!.call(element,'大'.repeat(400001));element.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.waitForSelector('[role="alert"]');
  expect(await page.$eval('[aria-label="小说原文"]',e=>(e as HTMLTextAreaElement).value)).toBe(selected.draft.text);
  await page.click('[aria-label="采用小说原文"]');
  expect(await page.evaluate(()=>(window as any).fixture.excerpt)).toBeUndefined();
  expect(await page.$eval('[data-manhua-novel-source]',e=>e.textContent)).toContain('旧原著·第一章');
  expect(errors).toEqual([]);
 }finally{await browser.close()}
},30000);
