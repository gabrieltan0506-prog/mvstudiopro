/** New overlay controls only; no render, upload or paid task is called. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("叠图选择规范化持久图片，沿原方案保存，图片移出本项目时不提交", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ManhuaVfxEditor} from './client/src/components/canvas/ManhuaVfxEditor';
    import {makeManhuaVfxEffect,manhuaVfxSourceKey} from './client/src/lib/manhuaVfxWorkflow';
    const clip={id:'clip-e01-g01',url:'gs://offline/source.mp4',label:'原片'};const state={version:1,scopeKey:'project:overlay',requests:{},draft:{sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition:{version:1,seed:1,effects:[makeManhuaVfxEffect('shield','shield-1')]}}};
    globalThis.saved=[];globalThis.calls=[];const noop=()=>{};
    function App(){const[images,setImages]=React.useState([{id:'image-1',url:'https://storage.googleapis.com/owner/stamp.png?X-Goog-Signature=synthetic',label:'当前标志'}]);globalThis.removeImage=()=>setImages([]);return <ManhuaVfxEditor scopeKey='project:overlay' state={state} clips={[clip]} imageOptions={images} jobs={[]} busy={false} onStateChange={async next=>{globalThis.saved.push(next);return next;}} onSubmit={async params=>{globalThis.calls.push(params);return 'job';}} onSourceChange={noop} onPreview={noop}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForSelector("video");
    await page.$eval("video", video => { for (const [key, value] of Object.entries({ duration: 5, videoWidth: 1280, videoHeight: 720 })) Object.defineProperty(video, key, { value, configurable: true }); video.dispatchEvent(new Event("loadedmetadata")); });
    const click = async (label: string) => page.evaluate(text => { const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === text); if (!button) throw new Error(text); button.click(); }, label);
    await page.select('[aria-label="添加特效"]', "image_overlay");
    await click("保存方案"); await page.waitForSelector('[role="alert"]');
    expect(await page.evaluate(() => (globalThis as any).saved.length)).toBe(0);
    await page.select('[aria-label="第2个特效叠加图片"]', "gs://owner/stamp.png");
    expect(await page.$$("fieldset:nth-child(2) input[type=color]")).toHaveLength(0);
    await click("保存方案"); await page.waitForFunction(() => (globalThis as any).saved.length === 1);
    const effect = await page.evaluate(() => (globalThis as any).saved[0].draft.composition.effects[1]);
    expect(effect).toMatchObject({ kind: "image_overlay", imageUri: "gs://owner/stamp.png", scale: 0.25, intensity: 1, anchor: { position: [0.5, 0.5] } });
    await page.evaluate(() => (globalThis as any).removeImage()); await page.waitForFunction(() => document.body.textContent?.includes("当前没有可用图片"));
    await click("渲染特效候选"); await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("不在当前作品"));
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
