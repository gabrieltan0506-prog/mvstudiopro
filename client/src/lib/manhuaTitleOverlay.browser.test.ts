/** Local component fixture only; media metadata and job callback are synthetic. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("标题取得原片时长后传入烧字参数，待回执防双点，换源清空草案", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ManhuaTitleOverlayEditor} from './client/src/components/canvas/ManhuaTitleOverlayEditor';
    globalThis.calls=[];function App(){const[source,setSource]=React.useState('gs://offline/first.mp4');globalThis.switchSource=()=>setSource('gs://offline/second.mp4');return <ManhuaTitleOverlayEditor key={source} source={source} busy={false} onSubmit={params=>{globalThis.calls.push(params);return new Promise(resolve=>globalThis.finishTitle=resolve);}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.click('[data-manhua-title-editor] > summary');
    await page.type('[aria-label="片内标题文字"]', "剑出无声");
    expect(await page.$eval("button", button => (button as HTMLButtonElement).disabled)).toBe(true);
    await page.$eval("video", video => { Object.defineProperty(video, "duration", { value: 5, configurable: true }); video.dispatchEvent(new Event("loadedmetadata")); });
    await page.select('[aria-label="标题位置"]', "8");
    await page.click("button"); await page.click("button");
    const calls = await page.evaluate(() => (globalThis as any).calls);
    expect(calls).toHaveLength(1); expect(calls[0].styleOverride.alignment).toBe(8); expect(calls[0].subtitleSrt).toContain("剑出无声");
    await page.evaluate(() => (globalThis as any).finishTitle()); await page.waitForSelector('[role="status"]');
    await page.evaluate(() => (globalThis as any).switchSource());
    await page.waitForFunction(() => (document.querySelector('[aria-label="片内标题文字"]') as HTMLTextAreaElement).value === "");
    expect(await page.$eval("button", button => (button as HTMLButtonElement).disabled)).toBe(true); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
