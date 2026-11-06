import {it,expect} from "vitest";
import {build} from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("60%待出图同时比较真实两档张数，切换不改完整稿",async()=>{
 const bundled=await build({stdin:{resolveDir:process.cwd(),sourcefile:"edition.tsx",loader:"tsx",contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import Choice from'./client/src/components/platform/KnowledgeCardEditionChoice';import{planKnowledgeCardPages}from'./shared/knowledgeCardPagination';
 const full='# 全文\\n\\n'+Array.from({length:24},(_,i)=>'## 章节'+i+'\\n\\n'+('完整知识与详细依据。'.repeat(120))).join('\\n\\n');const concise='## 核心重点\\n\\n要点：重点图示。';window.expected=[planKnowledgeCardPages(concise).pageCount,planKnowledgeCardPages(full).pageCount];window.full=full;
 function App(){const[level,set]=useState('concise');return <><p>60% · 请比较两档后选择出图</p><textarea readOnly value={full}/><Choice full={full} concise={concise} model='deepseek-v4.1-flash-1017' selected={level} disabled={false} onSelect={set}/></>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'}});
 const browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
 try {const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundled.outputFiles[0].text});await page.waitForSelector('fieldset');
 const expected=await page.evaluate(()=>(window as any).expected);const text=await page.$eval('fieldset',e=>e.textContent);expect(text).toContain(`精华版 · ${expected[0]} 张图片`);expect(text).toContain(`完整版 · ${expected[1]} 张图片`);expect(expected[1]).toBeGreaterThan(expected[0]);
 await page.evaluate(()=>document.querySelectorAll('fieldset button')[1].dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.waitForFunction(()=>document.querySelectorAll('fieldset button')[1].getAttribute('aria-pressed')==='true');
 expect(await page.$eval('textarea',e=>(e as HTMLTextAreaElement).value)).toBe(await page.evaluate(()=>(window as any).full));
 }finally{await browser.close();}
},15000);
