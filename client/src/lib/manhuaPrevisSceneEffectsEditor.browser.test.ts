/** Offline UI integration only: no render or paid requests are made. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("场景特效经原白模publish保存历史，保留已采用参考，拒绝冲突与旧方案覆盖", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ManhuaPrevisStudioView} from './client/src/components/canvas/ManhuaPrevisStudio';
    import {createManhuaPrevisStudio} from './shared/manhuaPrevis';
    const original={url:'https://offline.invalid/old.mp4',gcsUri:'gs://test/old.mp4',updatedAt:'2026-09-01T00:00:00Z'};
    const initial={id:'clip-e01-g01',previsStudio:createManhuaPrevisStudio(5,'11111111-1111-4111-8111-111111111111'),manhuaSegmentRefs:{previs:original}};
    globalThis.submits=0; globalThis.updates=[];
    const services={submit:async()=>{globalThis.submits++;throw Error('No render authorized')},get:async()=>null,list:async()=>({items:[],nextCursor:null})};
    function App(){const [block,setBlock]=React.useState(initial);globalThis.block=block;globalThis.changeCurrent=()=>setBlock(previous=>({...previous,previsStudio:{...previous.previsStudio,spec:{...previous.previsStudio.spec,actors:previous.previsStudio.spec.actors.map(actor=>({...actor,nameZh:'新角色'}))}}}));return <ManhuaPrevisStudioView block={block} characters={[]} services={services} onChange={(studio,reference)=>{globalThis.updates.push(studio);setBlock(previous=>({...previous,previsStudio:studio,manhuaSegmentRefs:reference?{previs:reference}:previous.manhuaSegmentRefs}));return true;}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [{ name: "offline-trpc", setup(builder) { builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" })); builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: "export const trpc={};" })); } }],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10_000);
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true);
    page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/");
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForSelector("[data-previs-scene-effects]");
    await page.click("[data-previs-scene-effects] > summary");
    const click = async (label: string) => page.evaluate(text => {
      const button = Array.from(document.querySelectorAll("[data-previs-scene-effects] button")).find(item => item.textContent?.trim() === text) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button: ${text}`); button.click();
    }, label);
    await click("披风布料");
    await click("保存场景特效配置");
    await page.waitForFunction(() => (globalThis as any).updates.length === 1);
    expect(await page.evaluate(() => (globalThis as any).block.previsStudio.spec.sceneEffects[0].kind)).toBe("cape");
    expect(await page.evaluate(() => (globalThis as any).block.previsStudio.specHistory[0].spec.sceneEffects)).toBeUndefined();
    expect(await page.evaluate(() => (globalThis as any).block.manhuaSegmentRefs.previs.gcsUri)).toBe("gs://test/old.mp4");
    await click("模型分件展开");
    await click("保存场景特效配置");
    await page.waitForFunction(() => document.body.textContent?.includes("披风碰撞与模型分件展开需要分开预演"));
    expect(await page.evaluate(() => (globalThis as any).updates.length)).toBe(1);
    await page.click('[aria-label="移除模型分件展开"]');
    await click("灵体材质");
    await click("保存场景特效配置");
    await page.waitForFunction(() => (globalThis as any).updates.length === 2);
    expect(await page.evaluate(() => (globalThis as any).block.previsStudio.specHistory.length)).toBe(2);
    await page.evaluate(() => (globalThis as any).changeCurrent());
    await page.waitForFunction(() => document.body.textContent?.includes("当前白模方案已更新"));
    expect(await page.evaluate(() => (Array.from(document.querySelectorAll("[data-previs-scene-effects] button")).find(item => item.textContent?.trim() === "保存场景特效配置") as HTMLButtonElement).disabled)).toBe(true);
    await click("载入当前白模配置");
    expect(await page.$eval("[data-previs-scene-effects] select", select => select.textContent)).toContain("新角色");
    expect(await page.evaluate(() => (globalThis as any).submits)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
