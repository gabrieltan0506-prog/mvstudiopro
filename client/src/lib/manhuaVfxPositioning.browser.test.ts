/** Development-only fixture: real React controls with synthetic media metadata, no real workflow claims. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("视频画面定位排除黑边并按播放秒位记录手动轨迹", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ManhuaVfxEditor} from './client/src/components/canvas/ManhuaVfxEditor';
    import {makeManhuaVfxEffect,manhuaVfxSourceKey} from './client/src/lib/manhuaVfxWorkflow';
    const clip={id:'clip-1',url:'gs://offline-vfx/source.mp4',label:'离线原片'};
    const state={version:1,scopeKey:'manhua:offline',requests:{},draft:{sourceId:clip.id,sourceKey:manhuaVfxSourceKey(clip),videoUri:clip.url,composition:{version:1,seed:1,effects:[makeManhuaVfxEffect('shield','effect-1')]}}};
    const noop=()=>{};
    createRoot(document.getElementById('root')).render(<ManhuaVfxEditor scopeKey='manhua:offline' state={state} clips={[clip]} jobs={[]} busy={false} onStateChange={async next=>next} onSubmit={async()=>{throw new Error('no submissions authorized in fixture')}} onSourceChange={noop} onPreview={noop}/>);
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
    await page.setContent('<div id="root"></div><style>[data-vfx-position-frame]{position:relative;width:300px;height:300px}[data-vfx-position-frame] video{width:300px;height:300px;object-fit:contain}[aria-label="在原片上定位特效"]{position:absolute;inset:0;width:100%;height:100%;background:transparent}</style>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForSelector("video");
    await page.$eval("video", video => {
      for (const [key, value] of Object.entries({ duration: 5, videoWidth: 1600, videoHeight: 900, currentTime: 1 })) Object.defineProperty(video, key, { configurable: true, writable: true, value });
      video.dispatchEvent(new Event("loadedmetadata"));
    });
    const click = async (label: string) => page.evaluate(text => {
      const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === text);
      if (!button) throw new Error(`Missing button: ${text}`); button.click();
    }, label);
    await click("点击画面定位");
    await page.waitForSelector('[aria-label="在原片上定位特效"]');
    const box = await page.$eval("video", video => { const rect = video.getBoundingClientRect(); return { x: rect.x, y: rect.y }; });
    await page.mouse.click(box.x + 150, box.y + 20);
    await page.waitForFunction(() => document.body.textContent?.includes("留黑区域不属于原片"));
    await page.mouse.click(box.x + 75, box.y + 107.8125);
    await click("用当前秒位添加轨迹点");
    const points = async () => (await page.$eval('textarea[aria-label="第1个特效轨迹"]', input => (input as HTMLTextAreaElement).value)).split("\n").map(line => line.split(" ").map(Number));
    expect((await points())[0].slice(0, 2)).toEqual([1, 0.25]);
    expect((await points())[0][2]).toBeCloseTo(0.25, 2); // Browser pointer events round to physical pixels.
    await page.$eval("video", video => { video.currentTime = 2; video.dispatchEvent(new Event("timeupdate")); });
    await page.mouse.click(box.x + 225, box.y + 192.1875);
    await click("用当前秒位添加轨迹点");
    expect(await points()).toHaveLength(2);
    expect((await points())[1].slice(0, 2)).toEqual([2, 0.75]);
    expect((await points())[1][2]).toBeCloseTo(0.75, 2);
    await page.mouse.click(box.x + 150, box.y + 150);
    await click("用当前秒位添加轨迹点");
    expect(await points()).toHaveLength(2);
    expect((await points())[1].slice(0, 2)).toEqual([2, 0.5]);
    expect((await points())[1][2]).toBeCloseTo(0.5, 2);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
