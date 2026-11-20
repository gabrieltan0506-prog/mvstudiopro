import {it,expect} from "vitest";
import {build} from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("60%待出图同时比较真实两档张数，切换不改完整稿",async()=>{
 const bundled=await build({stdin:{resolveDir:process.cwd(),sourcefile:"edition.tsx",loader:"tsx",contents:`
 import React,{useState}from'react';import{createRoot}from'react-dom/client';import Choice from'./client/src/components/platform/KnowledgeCardEditionChoice';import{planKnowledgeCardPages}from'./shared/knowledgeCardPagination';import{compileKnowledgeEditions}from'./shared/knowledgeCardEdition';
 // 1120 L8：张数只对两档稿显示（无两档标记的原稿显示中性提示，另有单测）
 const ed=compileKnowledgeEditions('全文',Array.from({length:24},(_,i)=>({headline:'章节'+i,body:'完整知识与详细依据。'.repeat(120),priority:i%4===0?'primary':'secondary'})));const full=ed.full;const concise=ed.concise;window.expected=[planKnowledgeCardPages(concise).pageCount,planKnowledgeCardPages(full).pageCount];window.full=full;
 function App(){const[level,set]=useState('concise');return <><p>60% · 请比较两档后选择出图</p><textarea readOnly value={full}/><Choice full={full} concise={concise} model='deepseek-v4.1-flash-1017' selected={level} disabled={false} onSelect={set}/></>};createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:"browser",format:"iife",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared")},define:{"process.env.NODE_ENV":'"production"'}});
 const browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
 try {const page=await browser.newPage();await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundled.outputFiles[0].text});await page.waitForSelector('fieldset');
 const expected=await page.evaluate(()=>(window as any).expected);const text=await page.$eval('fieldset',e=>e.textContent);expect(text).toContain(`精华版 · ${expected[0]} 张图片`);expect(text).toContain(`完整版 · ${expected[1]} 张图片`);expect(expected[1]).toBeGreaterThan(expected[0]);
 await page.evaluate(()=>document.querySelectorAll('fieldset button')[1].dispatchEvent(new MouseEvent('click',{bubbles:true})));await page.waitForFunction(()=>document.querySelectorAll('fieldset button')[1].getAttribute('aria-pressed')==='true');
 expect(await page.$eval('textarea',e=>(e as HTMLTextAreaElement).value)).toBe(await page.evaluate(()=>(window as any).full));
 }finally{await browser.close();}
},15000);
