/** Offline React behavior evidence only; fake receipts/media do not count as workflow acceptance. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("保存失败不提交且保留原号，重复点击与刷新恢复后显式采用才保存结果", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ManhuaVfxEditor} from './client/src/components/canvas/ManhuaVfxEditor';
    import {makeManhuaVfxEffect,manhuaVfxSourceKey} from './client/src/lib/manhuaVfxWorkflow';
    const clip={id:'clip-1',url:'gs://offline-vfx/source.mp4',label:'离线原片'};
    const initial={version:1,scopeKey:'manhua:offline',requests:{},draft:{sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition:{version:1,seed:1,effects:[makeManhuaVfxEffect('shield','effect-1')]}}};
    globalThis.events=[];globalThis.calls=[];globalThis.persisted=initial;
    let firstSave=true;
    function App(){const [state,setState]=React.useState(initial);const [jobs,setJobs]=React.useState([]);const [epoch,setEpoch]=React.useState(0);
      const save=React.useCallback(async next=>{globalThis.events.push('save');if(firstSave){firstSave=false;await new Promise((resolve,reject)=>{globalThis.releaseSave=resolve;globalThis.rejectSave=()=>reject(new Error("模拟云端保存未知"));});}globalThis.persisted=JSON.parse(JSON.stringify(next));setState(next);globalThis.events.push('saved');},[]);
      const source=React.useCallback(()=>{},[]);
      globalThis.reload=()=>{setState(globalThis.persisted);setEpoch(value=>value+1);};
      const submit=async input=>{globalThis.events.push('enqueue');globalThis.calls.push(input);if(globalThis.calls.length===1)throw new Error('模拟回执丢失');return 'offline-job';};
      globalThis.complete=()=>{const request=Object.values(globalThis.persisted.requests)[0];setJobs([{jobId:'offline-job',scopeKey:'manhua:offline',action:'manhua_vfx',status:'succeeded',label:'offline',createdAt:1,output:{gcsUri:'gs://offline-vfx/result.mp4',requestId:request.requestId,sourceKey:request.sourceKey,composition:request.composition}}]);};
      return <ManhuaVfxEditor key={epoch} scopeKey='manhua:offline' state={state} clips={[clip]} jobs={jobs} busy={false} onStateChange={save} onSubmit={submit} onSourceChange={source} onPreview={()=>{}}/>;
    }
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/");
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForSelector("video");
    const metadata = async () => page.$eval("video", video => {
      for (const [key, value] of Object.entries({ duration: 5, videoWidth: 1280, videoHeight: 720 })) Object.defineProperty(video, key, { configurable: true, value });
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    const click = async (text: string) => page.evaluate(label => {
      const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === label);
      if (!button) throw new Error(`Button not found: ${label}`); button.click();
    }, text);
    await metadata();
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent?.trim() === "渲染特效候选" && !button.disabled));
    await click("渲染特效候选");
    await click("渲染特效候选");
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    await page.evaluate(() => (globalThis as any).rejectSave());
    await page.waitForFunction(() => document.body.textContent?.includes("查询原请求"));
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    const intentId = await page.evaluate(() => Object.keys((globalThis as any).persisted.requests)[0]);
    await click("查询原请求");
    await page.waitForFunction(() => (globalThis as any).calls.length === 1 && !Array.from(document.querySelectorAll("button")).find(button => button.textContent?.trim() === "查询原请求")?.disabled);
    expect(await page.evaluate(() => (globalThis as any).events.slice(-4))).toEqual(["saved", "enqueue", "save", "saved"]);
    const requestId = await page.evaluate(() => (globalThis as any).calls[0].requestId);
    expect(requestId).toBe(intentId);
    await page.evaluate(() => (globalThis as any).reload());
    await page.waitForSelector("video");
    await metadata();
    await click("查询原请求");
    await page.waitForFunction(() => (globalThis as any).calls.length === 2 && Object.values((globalThis as any).persisted.requests).some((request: any) => request.status === "queued"));
    expect(await page.evaluate(() => (globalThis as any).calls[1].requestId)).toBe(requestId);
    await page.evaluate(() => (globalThis as any).complete());
    await page.waitForFunction(() => Object.values((globalThis as any).persisted.requests).some((request: any) => request.status === "succeeded"));
    expect(await page.evaluate(() => (globalThis as any).persisted.adoptedRequestId)).toBeUndefined();
    await click("采用此候选");
    await page.waitForFunction(() => Boolean((globalThis as any).persisted.adoptedRequestId));
    expect(await page.evaluate(() => (globalThis as any).persisted.adoptedRequestId)).toBe(requestId);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
