import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import JSZip from "jszip";
import { documentImportAssets } from "../../../scripts/vite-document-import-assets";

it("imports PDF pages, DOC/DOCX/plain text and optional real scanned OCR without replacing a draft on failure", async()=>{
 const dir=await mkdtemp(path.join(tmpdir(),"manhua-docs-"));
 const built=await build({stdin:{resolveDir:process.cwd(),loader:"tsx",contents:`
 import React,{useState} from 'react';import{createRoot}from'react-dom/client';
 import {ManhuaNovelSourcePanel} from './client/src/components/canvas/ManhuaNovelSourcePanel';
 import {parseNovelDraft} from './shared/manhuaNovelSource';
 function App(){const[value,setValue]=useState(null);globalThis.fixture={draft:value,restored:parseNovelDraft(JSON.parse(JSON.stringify(value)))};return <ManhuaNovelSourcePanel value={value} onChange={setValue}/>};createRoot(document.getElementById('root')).render(<App/>);
 `},bundle:true,write:false,format:"esm",platform:"browser",jsx:"automatic",tsconfig:"tsconfig.json",define:{"process.env.NODE_ENV":'"test"'}});
 let assets:any; const plugin=documentImportAssets(); (plugin.configureServer as Function)({middlewares:{use(fn:any){assets=fn}}});
 const server=createServer((req,res)=>{if(req.url?.includes("document-import"))console.log("ASSET",req.url);return assets(req,res,()=>{res.setHeader("Content-Type",req.url==="/app.js"?"text/javascript":"text/html");res.end(req.url==="/app.js"?built.outputFiles[0].text:'<div id="root"></div><script type="module" src="/app.js"></script>')})});
 await new Promise<void>(r=>server.listen(0,"127.0.0.1",r));
 const browser=await puppeteer.launch({headless:true,protocolTimeout:900000});
 try {
  const page=await browser.newPage();const errors:string[]=[];page.on("console",m=>console.log("BROWSER",m.text()));page.on("requestfailed",r=>console.log("REQUEST_FAILED",r.url(),r.failure()));page.on("pageerror",e=>{errors.push(String(e));console.log("PAGE_ERROR",String(e));});
  await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);await page.waitForSelector('[data-manhua-novel-source] > summary');await page.click('[data-manhua-novel-source] > summary');await page.evaluate(()=>new MutationObserver(()=>console.log("STATUS",Array.from(document.querySelectorAll('[role="status"], [role="alert"]')).map(e=>e.textContent).join(" | "))).observe(document.getElementById("root")!,{subtree:true,childList:true,characterData:true}));
  const upload=async(name:string,data:Uint8Array|string)=>{await page.bringToFront();console.log("IMPORT_START",name);const dest=path.join(dir,name);await writeFile(dest,data);await (await page.$('input[type="file"]'))!.uploadFile(dest);await page.waitForFunction(()=>!(document.querySelector('input[type="file"]') as HTMLInputElement).disabled,{timeout:180000});console.log("IMPORT_DONE",name);return page.evaluate(()=>(globalThis as any).fixture);}
  for(const ext of ['txt','md']){const f=await upload(`story.${ext}`,'第一章 风雨\n阿菁带着娘来到医馆，墨屠在门口等待消息。'.repeat(5));expect(f.draft.text).toContain('第一章 风雨');expect(f.restored).toEqual(f.draft);}
  const zip=new JSZip();zip.file('word/document.xml','<w:document xmlns:w="urn:test"><w:body><w:p><w:r><w:t>第一章 医馆</w:t></w:r></w:p><w:p><w:r><w:t>阿菁救娘</w:t></w:r><w:del><w:r><w:t>已删除</w:t></w:r></w:del><w:r><w:footnoteReference w:id="1"/></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>表格正文</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>');zip.file('word/footnotes.xml','<w:footnotes xmlns:w="urn:test"><w:footnote w:id="1"><w:p><w:r><w:t>脚注说明</w:t></w:r></w:p></w:footnote></w:footnotes>');
  const word=await upload('story.docx',await zip.generateAsync({type:'uint8array'}));expect(word.draft.text).toContain('脚注说明');expect(word.draft.text).toContain('表格正文');expect(word.draft.text).not.toContain('已删除');expect(word.restored).toEqual(word.draft);
  const print=await browser.newPage();await print.setContent('<p>Chapter One: The story starts with a family entering the village. Every source paragraph should stay in the imported document.</p><div style="break-before:page">Chapter Two: The family arrives at the house and waits for a messenger. The second page is preserved independently.</div>');
  const digital=await upload('digital.pdf',await print.pdf({format:'A4'}));expect(digital.draft.chapters).toHaveLength(2);expect(digital.draft.importInfo.ocrPages).toEqual([]);expect(digital.draft.text).toContain('Chapter One');expect(digital.draft.text).toContain('Chapter Two');expect(digital.restored).toEqual(digital.draft);
  const invalid=await upload('invalid.doc','not a word file');expect(invalid.draft).toEqual(digital.draft);expect(await page.$eval('[role="alert"]',e=>e.textContent)).toContain('DOC');
  if(process.env.DOC_FIXTURE){await (await page.$('input[type="file"]'))!.uploadFile(process.env.DOC_FIXTURE);await page.waitForFunction(()=>(globalThis as any).fixture.draft?.importInfo?.format==='doc');const d=await page.evaluate(()=>(globalThis as any).fixture);expect(d.draft.text).toContain('测试');expect(d.restored).toEqual(d.draft);}
  if(process.env.RUN_OCR_TEST==='1'){
   await print.setViewport({width:1200,height:800,deviceScaleFactor:1});await print.setContent('<div style="font:40px Arial;padding:50px;background:white;color:black"><p>第一章 医馆</p><p>阿菁背着娘来到医馆，墨屠守在门口。</p><p>Chapter one. A family arrives at the village.</p></div>');const png=await print.screenshot({encoding:'base64'});await print.setContent(`<img style="width:100%" src="data:image/png;base64,${png}">`);const scan=await print.pdf({width:'1200px',height:'850px'});
   const ocr=await upload('scanned.pdf',scan);expect(ocr.draft.importInfo.ocrPages).toEqual([1]);expect(ocr.draft.text).toContain('Chapter one');expect(ocr.draft.text).toMatch(/[医醫][馆館]/);expect(ocr.restored).toEqual(ocr.draft);console.log('REAL_OCR',JSON.stringify({chars:ocr.draft.text.length,metadata:ocr.draft.importInfo,text:ocr.draft.text}));
   // Cancellation is a UI action, not a mocked parser response.
   const dest=path.join(dir,'cancel.pdf');await writeFile(dest,scan);await (await page.$('input[type="file"]'))!.uploadFile(dest);await page.waitForFunction(()=>Array.from(document.querySelectorAll('button')).some(e=>e.textContent==='取消导入'));await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='取消导入')!.click());await page.waitForFunction(()=>!(document.querySelector('input[type="file"]') as HTMLInputElement).disabled);expect(await page.evaluate(()=>(globalThis as any).fixture.draft)).toEqual(ocr.draft);
  }
  if(process.env.PDF_FIXTURE){
   await page.bringToFront();await (await page.$('input[type="file"]'))!.uploadFile(process.env.PDF_FIXTURE);
   await page.waitForFunction(()=>!(document.querySelector('input[type="file"]') as HTMLInputElement).disabled,{timeout:900000,polling:100});
   const real=await page.evaluate(()=>(globalThis as any).fixture);expect(real.draft.importInfo.format).toBe('pdf');expect(real.draft.chapters.length).toBe(14);expect(real.restored).toEqual(real.draft);
   console.log('USER_PDF_RESULT',JSON.stringify({name:real.draft.name,chars:real.draft.text.length,metadata:real.draft.importInfo}));
  }
  expect(errors).toEqual([]);
 } finally {await browser.close();await new Promise<void>(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}
},1000000);
