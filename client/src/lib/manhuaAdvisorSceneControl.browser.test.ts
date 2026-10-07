/** Newly changed scene controller only: fake services, no rendering/model calls. */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("场景顾问读取不改音轨，拒绝旧指纹/错误回执/迟到跨项目，采用与提交错误不假报成功", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ManhuaPrevisStudioView} from './client/src/components/canvas/ManhuaPrevisStudio';
    import {createManhuaPrevisStudio} from './shared/manhuaPrevis';
    const base=createManhuaPrevisStudio(5,'11111111-1111-4111-8111-111111111111');const requestId='22222222-2222-4222-8222-222222222222';
    const take={requestId,jobId:'old-job',spec:base.spec,gcsUri:'gs://offline/old.mp4',url:'https://offline.invalid/old.mp4',durationSec:5,createdAt:'2026-10-01T00:00:00Z'};
    const initial={id:'clip-e01-g01',previsStudio:{...base,audioEnabled:true,history:[take],selectedJobId:take.jobId}};
    globalThis.updates=[];globalThis.failSave=false;globalThis.getMode='none';globalThis.submits=0;window.confirm=()=>true;
    const params={requestId,scopeId:base.scopeId,clipId:initial.id,spec:base.spec,quality:'draft'};
    const services={submit:async()=>{globalThis.submits++;throw Error('offline service failed');},get:async id=>globalThis.getMode==='deferred'?new Promise(resolve=>globalThis.resolveQuery=resolve):globalThis.getMode==='wrong'?{params:{...params,requestId:'33333333-3333-4333-8333-333333333333'},jobId:'wrong',status:'queued'}:null,list:async()=>({items:[],nextCursor:null})};
    const register=(_,__,control)=>globalThis.control=control;
    function App(){const[block,setBlock]=React.useState(initial);const[scope,setScope]=React.useState('project-a');globalThis.block=block;globalThis.changeProject=()=>setScope('project-b');globalThis.prepareSilentProbe=()=>setBlock(previous=>({...previous,previsStudio:{...previous.previsStudio,audioEnabled:false}}));globalThis.changeSpec=()=>setBlock(previous=>({...previous,previsStudio:{...previous.previsStudio,spec:{...previous.previsStudio.spec,actors:previous.previsStudio.spec.actors.map(actor=>({...actor,nameZh:'变更角色'}))}}}));return <ManhuaPrevisStudioView effectsScopeKey={scope} onAdvisorEffectsControl={register} block={block} characters={[]} services={services} onChange={studio=>{if(globalThis.failSave)return false;globalThis.updates.push(studio);setBlock(previous=>({...previous,previsStudio:studio}));return true;}}/>;}
    globalThis.originalResponse={params,jobId:'old-job',status:'queued'};createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, plugins: [{ name: "offline-trpc", setup(builder) { builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "offline" })); builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ loader: "js", contents: "export const trpc={};" })); } }], define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(10_000);
    const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0]!.text });
    await page.waitForFunction(() => Boolean((globalThis as any).control));
    const inspect = () => page.evaluate(async () => JSON.parse(await (globalThis as any).control({ action: "effects", tool: "scene", operation: "inspect" }, new AbortController().signal)));
    const act = (action: Record<string, unknown>) => page.evaluate(async action => { try { return { receipt: await (globalThis as any).control(action, new AbortController().signal) }; } catch (error) { return { error: String(error) }; } }, action);
    let current = await inspect(); const requestId = current.candidates[0].requestId;
    expect(await page.evaluate(() => (globalThis as any).block.previsStudio.audioEnabled)).toBe(true); expect(await page.evaluate(() => (globalThis as any).updates.length)).toBe(0);
    expect((await act({ action: "effects", tool: "scene", operation: "adopt", clipId: current.clipId, sourceKey: current.sourceKey, requestId })).error).toContain("尚未通过");
    await page.evaluate(() => (globalThis as any).changeSpec());
    expect((await act({ action: "effects", tool: "scene", operation: "configure", clipId: current.clipId, sourceKey: current.sourceKey, sceneEffects: [] })).error).toContain("已变化");
    current = await inspect(); await page.evaluate(() => { (globalThis as any).failSave = true; });
    expect((await act({ action: "effects", tool: "scene", operation: "configure", clipId: current.clipId, sourceKey: current.sourceKey, sceneEffects: [] })).error).toContain("未保存");
    await page.evaluate(() => { (globalThis as any).failSave = false; (globalThis as any).getMode = "wrong"; });
    expect((await act({ action: "effects", tool: "scene", operation: "resume", clipId: current.clipId, sourceKey: current.sourceKey, requestId })).error).toContain("身份不一致");
    await page.evaluate(({ current, requestId }) => {
      (globalThis as any).getMode = "deferred";
      (globalThis as any).pendingResult = (globalThis as any).control({ action: "effects", tool: "scene", operation: "resume", clipId: current.clipId, sourceKey: current.sourceKey, requestId }, new AbortController().signal).then((receipt: string) => ({ receipt }), (error: unknown) => ({ error: String(error) }));
    }, { current, requestId });
    await page.waitForFunction(() => Boolean((globalThis as any).resolveQuery)); await page.evaluate(() => (globalThis as any).changeProject());
    await page.evaluate(() => (globalThis as any).resolveQuery((globalThis as any).originalResponse));
    expect((await page.evaluate(() => (globalThis as any).pendingResult)).error).toContain("作品已变化");
    expect(await page.evaluate(() => (globalThis as any).updates.length)).toBe(0);
    await page.evaluate(() => { (globalThis as any).getMode = "none"; (globalThis as any).prepareSilentProbe(); }); current = await inspect();
    expect((await act({ action: "effects", tool: "scene", operation: "submit", clipId: current.clipId, sourceKey: current.sourceKey })).error).toContain("offline service failed");
    expect(await page.evaluate(() => (globalThis as any).submits)).toBe(1);
    expect(await page.evaluate(() => Boolean((globalThis as any).block.previsStudio.pending?.requestId))).toBe(true);
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
