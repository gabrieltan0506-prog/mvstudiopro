import {it,expect} from "vitest";
import {build} from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("已整理正文动态加入且保留手动内容，不显示内部组批计数",async()=>{
 const bundled=await build({stdin:{resolveDir:process.cwd(),sourcefile:"reading.tsx",loader:"tsx",contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import{KnowledgeReadingLive}from'./client/src/components/platform/KnowledgeReadingLive';
 function App(){const[drafts,set]=useState([]);window.show=set;return <><textarea defaultValue='用户手动整理的正文，不得清除'/><KnowledgeReadingLive status='正在整理已读取的内容' drafts={drafts}/></>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'}});
 const browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
 try {const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundled.outputFiles[0].text});await page.waitForSelector('[role="status"]');
 await page.evaluate(()=>(window as any).show([{index:1,pages:[{headline:'第二章',body:'第二章真实内容\n完整末句'}]}]));await page.waitForFunction(()=>document.body.textContent?.includes('完整末句'));
 await page.evaluate(()=>(window as any).show([{index:1,pages:[{headline:'第二章',body:'第二章真实内容\n完整末句'}]},{index:0,pages:[{headline:'第一章',body:'第一章真实内容'}]}]));await page.waitForFunction(()=>document.querySelectorAll('article').length===2);
 const text=await page.$eval('section',e=>e.textContent||'');expect(text.indexOf('第一章')).toBeLessThan(text.indexOf('第二章'));expect(text).not.toMatch(/\d+\s*[/／]\s*\d+\s*[组批]/);expect(text).toContain('完整末句');
 expect(await page.$eval('textarea',e=>(e as HTMLTextAreaElement).value)).toBe('用户手动整理的正文，不得清除');
 }finally{await browser.close();}
},15000);
