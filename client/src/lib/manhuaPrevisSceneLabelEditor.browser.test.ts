/** Only the newly added label controls; previous cloth/material UI cases are not repeated. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("骨骼跟随标注保存中文文字、跟随部位和偏移，空文字不落盘", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ManhuaPrevisSceneEffectsEditor} from './client/src/components/canvas/ManhuaPrevisSceneEffectsEditor';
    import {createManhuaPrevisStudio} from './shared/manhuaPrevis';
    globalThis.saved=[];
    function App(){const [spec,setSpec]=React.useState(createManhuaPrevisStudio(5).spec);return <ManhuaPrevisSceneEffectsEditor spec={spec} onApply={next=>{globalThis.saved.push(next);setSpec(next);return true;}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.click('[data-previs-scene-effects] > summary');
    const click = async (label: string) => page.evaluate(text => { const button = Array.from(document.querySelectorAll("button")).find(item => item.textContent?.trim() === text); if (!button) throw new Error(text); button.click(); }, label);
    await click("骨骼跟随标注");
    await page.select('[aria-label="标注跟随骨骼"]', "hand1");
    await page.click('[aria-label="骨骼标注文字"]', { clickCount: 3 }); await page.keyboard.press("Backspace"); await page.type('[aria-label="骨骼标注文字"]', "右手能量核心");
    await page.click('[aria-label="骨骼标注横向 X偏移"]', { clickCount: 3 }); await page.keyboard.press("Backspace"); await page.type('[aria-label="骨骼标注横向 X偏移"]', "0.35");
    await click("保存场景特效配置");
    await page.waitForFunction(() => (globalThis as any).saved.length === 1);
    expect(await page.evaluate(() => (globalThis as any).saved[0].sceneEffects[0])).toMatchObject({ kind: "label", actorId: "actor-1", bone: "hand1", text: "右手能量核心", offset: [0.35, 0, 0.6], fontSize: 0.12 });
    await page.click('[aria-label="骨骼标注文字"]', { clickCount: 3 }); await page.keyboard.press("Backspace");
    await click("保存场景特效配置");
    await page.waitForSelector('[role="alert"]');
    expect(await page.evaluate(() => (globalThis as any).saved.length)).toBe(1);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
