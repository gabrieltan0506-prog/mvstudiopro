import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("关闭Debug时记录错误，打开后显示原因和状态；可清空且不提交请求", async () => {
  const bundle=await build({stdin:{resolveDir:process.cwd(),loader:'tsx',contents:`
    import React from 'react';import{createRoot}from'react-dom/client';
    import{ApiErrorDebugPanel}from'./client/src/components/platform/ApiErrorDebugPanel';
    import{withApiDebugFetch}from'./client/src/lib/apiDebugErrors';
    const root=createRoot(document.getElementById('root'));globalThis.calls=0;
    globalThis.fail=()=>withApiDebugFetch('/api/trpc/manhuaViralTemplate.approve?input=private-data',async()=>{globalThis.calls++;return new Response('<html><title>Gateway Timeout</title><input value="secret-body"></html>',{status:504,headers:{'content-type':'text/html'}})});
    globalThis.show=()=>root.render(<ApiErrorDebugPanel/>);
  `},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.resolve('client/src')}});
  const browser=await puppeteer.launch({headless:true});
  try{
    const page=await browser.newPage();page.setDefaultTimeout(5000);
    await page.setContent('<div id="root"></div>');await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.evaluate(async()=>{await (globalThis as any).fail();});
    expect(await page.$('[aria-label="接口错误 Debug"]')).toBeNull();
    await page.evaluate(()=>(globalThis as any).show());
    await page.waitForFunction(()=>document.body.innerText.includes('Gateway Timeout'));
    const text=await page.$eval('body',x=>x.innerText);
    expect(text).toContain('manhuaViralTemplate.approve');expect(text).toContain('504');
    expect(text).not.toMatch(/secret-body|private-data|算力紧张/);
    await page.click('button');await page.waitForFunction(()=>document.body.innerText.includes('本页尚无错误记录'));
    expect(await page.evaluate(()=>(globalThis as any).calls)).toBe(1);
  }finally{await browser.close();}
},20000);
