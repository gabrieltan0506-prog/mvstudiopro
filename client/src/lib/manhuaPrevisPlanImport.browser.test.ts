/** 离线交互验证：不提交任何渲染或付费请求。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("已审方案经对照确认和原publish保存，保留原稿参考，拒绝过期覆盖", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {ManhuaPrevisStudioView} from './client/src/components/canvas/ManhuaPrevisStudio';
    import {createManhuaPrevisStudio} from './shared/manhuaPrevis';
    const original={url:'https://offline.invalid/old.mp4',gcsUri:'gs://test/old.mp4',updatedAt:'2026-09-01T00:00:00Z'};
    const initial={id:'clip-e01-g01',previsStudio:createManhuaPrevisStudio(5,'11111111-1111-4111-8111-111111111111'),manhuaSegmentRefs:{previs:original}};
    globalThis.submits=0; globalThis.updates=[];
    const services={submit:async()=>{globalThis.submits++;throw Error('No render authorized')},get:async()=>null,list:async()=>({items:[],nextCursor:null})};
    function App(){const [sourceShots,setSourceShots]=React.useState([{index:1,durationSec:5,actionZh:'阿菁原地观察',cameraZh:'中景',dialogueZh:'无对白'}]);globalThis.clearSource=()=>setSourceShots([]);globalThis.changeSource=()=>setSourceShots(rows=>rows.map(row=>({...row,actionZh:'阿菁退后一步'})));const [block,setBlock]=React.useState(initial);globalThis.block=block;globalThis.changeCurrent=()=>setBlock(previous=>({...previous,previsStudio:{...previous.previsStudio,spec:{...previous.previsStudio.spec,actors:previous.previsStudio.spec.actors.map(actor=>({...actor,nameZh:'新角色'}))}}}));return <ManhuaPrevisStudioView block={block} sourceShots={sourceShots} characters={[]} services={services} onChange={(studio,reference)=>{globalThis.updates.push(studio);setBlock(previous=>({...previous,previsStudio:studio,manhuaSegmentRefs:reference?{previs:reference}:previous.manhuaSegmentRefs}));return true;}}/>;}
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
    await page.waitForSelector("[data-previs-plan-import]");
    await page.click("[data-previs-plan-import] > summary");
    const click = async (label: string) => page.evaluate(text => {
      const button = Array.from(document.querySelectorAll("[data-previs-plan-import] button")).find(item => item.textContent?.trim() === text) as HTMLButtonElement | undefined;
      if (!button) throw new Error(`Missing button: ${text}`); button.click();
    }, label);
    const patch = await page.evaluate(() => ({kind:"previs_edit_v1",summaryZh:"镜头收紧，保留所有角色",unsupportedZh:[],shotCoverage:[{index:1,status:"covered",actorIds:[],reasonZh:"保留现有动作，仅调整机位；不代表画面验收"}],cameras:(globalThis as any).block.previsStudio.spec.cameras.map((c:any)=>({...c,endLens:60}))}));
    await page.type('[aria-label="已审动作方案 JSON"]', JSON.stringify(patch));
    await click("检查并对照方案");
    await page.waitForFunction(() => document.body.textContent?.includes("拟采用动作方案"));
    expect(await page.evaluate(() => (globalThis as any).updates.length)).toBe(0);
    await click("确认保存这份动作方案");
    await page.waitForFunction(() => (globalThis as any).updates.length === 1);
    expect(await page.evaluate(() => (globalThis as any).block.previsStudio.spec.cameras[0].endLens)).toBe(60);
    expect(await page.evaluate(() => (globalThis as any).block.previsStudio.specHistory.length)).toBe(1);
    expect(await page.evaluate(() => (globalThis as any).block.manhuaSegmentRefs.previs.gcsUri)).toBe("gs://test/old.mp4");
    patch.cameras[0].endLens=50;
    await page.type('[aria-label="已审动作方案 JSON"]', JSON.stringify(patch));
    await click("检查并对照方案");
    await page.evaluate(() => (globalThis as any).changeCurrent());
    await page.waitForFunction(() => document.body.textContent?.includes("新角色"));
    await click("确认保存这份动作方案");
    await page.waitForFunction(() => document.body.textContent?.includes("本段配置已变化"));
    expect(await page.evaluate(() => (globalThis as any).updates.length)).toBe(1);
    await click("检查并对照方案");
    await page.evaluate(() => (globalThis as any).changeSource());
    await click("确认保存这份动作方案");
    await page.waitForFunction(() => document.body.textContent?.includes("本段分镜来源已变化"));
    expect(await page.evaluate(() => (globalThis as any).updates.length)).toBe(1);
    await click("检查并对照方案");
    await page.evaluate(() => (globalThis as any).clearSource());
    await click("确认保存这份动作方案");
    await page.waitForFunction(() => document.body.textContent?.includes("当前分镜来源已移除"));
    expect(await page.evaluate(() => (globalThis as any).updates.length)).toBe(1);
    expect(await page.evaluate(() => (globalThis as any).submits)).toBe(0);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
