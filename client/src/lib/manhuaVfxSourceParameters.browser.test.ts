import { build } from "esbuild";
import path from "node:path";
import puppeteer from "puppeteer";
import { expect, it } from "vitest";

it.each([
  ["liquid_mirror", "liquid-amplitude", "0.04", "liquid", "amplitude", .04],
  ["motion_ghost", "ghost-copies", "5", "ghost", "copies", 5],
  ["wall_fracture", "wall-spread", "2.3", "wall", "spread", 2.3],
  ["bullet_time", "bullet-radius", "6", "bullet", "radius", 6],
] as const)("%s真实控件可调，保存恢复后提交同一参数", async (kind, field, value, group, key, expected) => {
  const sceneId = `prv_${"a".repeat(48)}`;
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ManhuaVfxEditor} from './client/src/components/canvas/ManhuaVfxEditor';
    const clip={id:'source',url:'gs://offline/source.mp4',label:'原片'};
    const scenes=[{jobId:'${sceneId}',scopeId:'10090000-1234-4234-8234-123456789abc',clipId:'clip',label:'真实三维版本',durationSec:2}];
    globalThis.saved=undefined;globalThis.submitted=[];HTMLMediaElement.prototype.pause=function(){};
    let root=createRoot(document.getElementById('root'));
    function App(){const[state,setState]=React.useState(globalThis.saved);return <ManhuaVfxEditor scopeKey="parameters" state={state} clips={[clip]} scenes={scenes} jobs={[]} busy={false}
      onStateChange={async next=>{globalThis.saved=JSON.parse(JSON.stringify(next));setState(next);return next;}}
      onSubmit={async input=>{globalThis.submitted.push(input);return 'offline-job';}} onSourceChange={()=>{}} onPreview={()=>{}}/>;}
    globalThis.remount=()=>{root.unmount();root=createRoot(document.getElementById('root'));root.render(<App/>);};root.render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const metadata = async () => { await page.waitForSelector("video"); await page.$eval("video", video => { for (const [key, value] of Object.entries({ duration: 5, videoWidth: 640, videoHeight: 360 })) Object.defineProperty(video, key, { configurable: true, value }); video.dispatchEvent(new Event("loadedmetadata")); }); };
    const click = async (label: string) => page.evaluate(label => { const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent === label); if (!button || button.disabled) throw Error(label + " unavailable"); button.click(); }, label);
    await page.waitForSelector("select"); await page.select("select:not([aria-label])", "source"); await metadata(); await page.select('[aria-label="添加特效"]', kind);
    if (kind === "bullet_time") { await page.select('[aria-label="bullet-scene"]', sceneId); expect(await page.evaluate(() => Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "用当前秒位添加轨迹点")?.disabled)).toBe(true); }
    await page.$eval(`[aria-label="${field}"]`, (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value); input.dispatchEvent(new Event("input", { bubbles: true })); }, value);
    await click("保存方案"); await page.waitForFunction(() => Boolean((globalThis as any).saved?.draft));
    const saved = await page.evaluate(kind => (globalThis as any).saved.draft.composition.effects.find((effect: any) => effect.kind === kind), kind);
    expect(saved[group][key]).toBe(expected);
    if (kind === "bullet_time") { expect(saved.bullet.sceneJobId).toBe(sceneId); expect(saved.bullet.sweepDeg).toBe(360); expect(saved.bullet.yawDeg).toBeUndefined(); }
    await page.evaluate(() => (globalThis as any).remount()); await metadata();
    await page.evaluate(kind => { const button = Array.from(document.querySelectorAll<HTMLButtonElement>('[aria-label="特效图层"] button')).find(button => button.textContent?.includes(kind === "liquid_mirror" ? "液态" : kind === "motion_ghost" ? "残影" : kind === "wall_fracture" ? "幕墙" : "子弹时间")); button!.click(); }, kind);
    expect(await page.$eval(`[aria-label="${field}"]`, input => (input as HTMLInputElement).value)).toBe(value);
    await click("渲染特效候选"); await page.waitForFunction(() => (globalThis as any).submitted.length === 1);
    expect(await page.evaluate(kind => (globalThis as any).submitted[0].params.composition.effects.find((effect: any) => effect.kind === kind), kind)).toEqual(saved); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
