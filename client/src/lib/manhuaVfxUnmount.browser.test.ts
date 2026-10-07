/** Real React lifecycle, injected transport; not online workflow acceptance. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it.each(["receipt", "error"])("does not save a late %s through an unmounted project's editor", async outcome => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ManhuaVfxEditor} from './client/src/components/canvas/ManhuaVfxEditor';
    import {makeManhuaVfxEffect,manhuaVfxSourceKey} from './client/src/lib/manhuaVfxWorkflow';
    const clip={id:'clip',url:'gs://offline/source.mp4',label:'原片'};globalThis.saves=[];globalThis.calls=0;const source=()=>{};
    function App(){const[scope,setScope]=React.useState('project-a');globalThis.switchProject=()=>setScope('project-b');
      const state={version:1,scopeKey:scope,requests:{},draft:{sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition:{version:1,seed:1,effects:[makeManhuaVfxEffect('shield','shield')]}}};
      return <div data-project={scope}><ManhuaVfxEditor key={scope} scopeKey={scope} state={state} clips={[clip]} jobs={[]} busy={false}
        onStateChange={async next=>{globalThis.saves.push(JSON.parse(JSON.stringify(next)));return next;}}
        onSubmit={async()=>{globalThis.calls++;return new Promise((resolve,reject)=>{globalThis.finish=()=>resolve('original-job');globalThis.fail=()=>reject(new Error('late transport failure'));});}}
        onSourceChange={source} onPreview={()=>{}}/></div>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text }); await page.waitForSelector("video");
    await page.$eval("video", video => { for (const [key, value] of Object.entries({ duration: 5, videoWidth: 480, videoHeight: 360 })) Object.defineProperty(video, key, { configurable: true, value }); video.dispatchEvent(new Event("loadedmetadata")); });
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(button => button.textContent === "渲染特效候选" && !button.disabled));
    await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(button => button.textContent === "渲染特效候选")!.click());
    await page.waitForFunction(() => (globalThis as any).calls === 1);
    await page.evaluate(() => (globalThis as any).switchProject()); await page.waitForSelector('[data-project="project-b"]');
    await page.evaluate(async outcome => { (globalThis as any)[outcome === "receipt" ? "finish" : "fail"](); await new Promise(resolve => setTimeout(resolve, 50)); }, outcome);
    const saves = await page.evaluate(() => (globalThis as any).saves);
    expect(saves).toHaveLength(1); expect(saves[0].scopeKey).toBe("project-a");
    expect(Object.values(saves[0].requests)[0]).toMatchObject({ status: "submitting" });
    expect(await page.evaluate(() => (globalThis as any).calls)).toBe(1); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
