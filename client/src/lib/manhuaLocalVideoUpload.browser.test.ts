import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser;
let bundle = "";
beforeAll(async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React, {useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import {ManhuaLocalVideoUploadPanel} from './client/src/components/platform/ManhuaLocalVideoUploadPanel';
      const id='12345678-1234-4123-8123-123456789abc';
      const sha='a'.repeat(64);
      const f=globalThis.fixture={calls:[],ready:null,blocked:false,row:null};
      globalThis.fetch=async(url,init)=>{
        f.calls.push({url,method:init.method,credentials:init.credentials,header:new Headers(init.headers).get('X-Manhua-Upload')});
        if(init.method==='POST'&&!url.endsWith('/complete')){
          const body=JSON.parse(init.body);
          f.row={uploadId:id,status:'uploading',fileName:body.fileName,bytes:body.bytes,offset:0};
        }
        if(init.method==='PUT'){
          f.row={...f.row,offset:f.row.offset+init.body.size};
          if(f.blocked)await new Promise((resolve,reject)=>{
            init.signal.addEventListener('abort',()=>reject(init.signal.reason),{once:true});
          });
        }
        if(url.endsWith('/complete'))f.row={...f.row,status:'completed',sha256:sha,durationSec:11.5,sourceRef:'manhua-upload://u7/'+id+'/'+sha};
        return new Response(JSON.stringify(f.row),{status:200});
      };
      function App(){
        const [file,setFile]=useState(new File(['abcdefghij'],'原片.mp4',{lastModified:1}));
        const [ready,setReady]=useState(null);
        f.ready=ready;
        f.choose=()=>setFile(new File(['0123456789'],'原片.mp4',{lastModified:1}));
        return <><ManhuaLocalVideoUploadPanel userKey="7" selectedFile={file}
          onReady={setReady} onSourceReset={()=>setReady(null)}/>
          {ready&&<p id="ready-source">已准备：{ready.fileName}</p>}</>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"test"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); });

async function open() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.isNavigationRequest()) void request.respond({ status: 200, contentType: "text/html",
      body: '<html><link rel="icon" href="data:,"><div id="root"></div></html>' });
    else void request.abort();
  });
  await page.goto("http://localhost:41811");
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('section[aria-label="本地视频上传"]');
  const click = async (label: string) => page.evaluate(text => {
    const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === text);
    if (!button) throw Error("未找到按钮：" + text);
    button.click();
  }, label);
  return { context, page, click };
}

describe("本地上传真实React面板（离线接口）", () => {
  it("选择不上传，上传完成只准备来源；再选同名不同内容即清空旧ready", async () => {
    const { context, page, click } = await open();
    try {
      expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([]);
      await click("上传视频");
      await page.waitForSelector("#ready-source");
      const calls = await page.evaluate(() => (window as any).fixture.calls);
      expect(calls.map((call: any) => call.method)).toEqual(["POST", "PUT", "POST"]);
      expect(calls.every((call: any) => call.url.startsWith("/api/manhua/local-video-uploads")
        && call.credentials === "same-origin" && call.header === "1")).toBe(true);
      expect(await page.evaluate(() => document.body.innerText)).toContain("点击学节奏");
      await page.evaluate(() => (window as any).fixture.choose());
      await page.waitForFunction(() => !(window as any).fixture.ready);
      expect(await page.$("#ready-source")).toBeNull();
      expect(await page.evaluate(() => (window as any).fixture.calls.length)).toBe(3);
      expect(await page.evaluate(() => document.body.innerText)).not.toContain("/data/");
    } finally { await context.close(); }
  });

  it("暂停已接收但未回包分块后，继续同ID先查询，未重复创建或传输", async () => {
    const { context, page, click } = await open();
    try {
      await page.evaluate(() => { (window as any).fixture.blocked = true; });
      await click("上传视频");
      await page.waitForFunction(() => (window as any).fixture.calls.some((call: any) => call.method === "PUT"));
      await click("暂停上传");
      await page.waitForFunction(() => document.body.innerText.includes("已暂停上传"));
      expect(await page.evaluate(() => (window as any).fixture.ready)).toBeNull();
      await page.evaluate(() => { (window as any).fixture.blocked = false; });
      await click("继续上传");
      await page.waitForSelector("#ready-source");
      const methods = await page.evaluate(() => (window as any).fixture.calls.map((call: any) => call.method));
      expect(methods).toEqual(["POST", "PUT", "GET", "POST"]);
    } finally { await context.close(); }
  });
});
