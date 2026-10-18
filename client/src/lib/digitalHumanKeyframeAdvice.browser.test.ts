/** 真实React组件+离线RPC回执；不读取生产视频，不冒充线上审片验收。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("无白模禁用，原请求恢复保留同视频与编号，只保存补图候选", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{DigitalHumanKeyframeAdvicePanel}from'./client/src/components/DigitalHumanKeyframeAdvicePanel';
    import{keyframeAdviceDraftFixture,keyframeAdvicePlanFixture}from'./shared/digitalHumanKeyframeAdvice.fixtures';
    import{loadDigitalHumanDraft}from'./shared/digitalHumanStudio';
    const initial=keyframeAdviceDraftFixture();initial.previsStudio.history=[];
    globalThis.saved=initial;globalThis.requests=[];globalThis.networkFail=true;globalThis.cloudWrites=0;globalThis.reply=keyframeAdvicePlanFixture;
    function App(){const[draft,setDraft]=React.useState(initial),[key,setKey]=React.useState(0);
      globalThis.restore=()=>{setDraft(loadDigitalHumanDraft(JSON.stringify(globalThis.saved),'7'));setKey(v=>v+1);};
      globalThis.videoReady=()=>{const next=keyframeAdviceDraftFixture();globalThis.saved=next;setDraft(next);};
      globalThis.changeSpec=()=>setDraft(d=>{const next=structuredClone(d);next.previsStudio.spec.cameras[0].lens+=1;globalThis.saved=next;return next;});
      return <DigitalHumanKeyframeAdvicePanel key={key} draft={draft} disabled={false} save={fn=>setDraft(d=>{const next=fn(d);globalThis.saved=next;return next;})} beforeSubmit={async()=>{globalThis.cloudWrites++;}} acquireWork={()=>()=>{}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "offline", setup(b) {
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "rpc", namespace: "offline" }));
    b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: `export const trpc={mvAnalysis:{askPlatformSkillQa:{useMutation:()=>({mutateAsync:async input=>{globalThis.requests.push(input);if(globalThis.networkFail)throw Error('网络中断，保留原请求');return{answer:JSON.stringify(globalThis.reply(input.manhuaContext.digitalHumanKeyframeAdvice))}}})},getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:12},refetch:async()=>({data:{remaining:5,price:12}})})}}};`, loader: "js" }));
  } }], logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true); page.on("request", r => { void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }); });
    await page.goto("https://example.test"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = (label: string) => page.evaluate(text => { const button = Array.from(document.querySelectorAll("button")).find(b => b.textContent === text); if (!button || button.disabled) throw Error("按钮不可用:" + text); button.click(); }, label);
    expect(await page.$eval("button", e => (e as HTMLButtonElement).disabled)).toBe(true);
    expect(await page.evaluate(() => (globalThis as any).requests.length)).toBe(0);
    await page.evaluate(() => (globalThis as any).videoReady()); await page.waitForFunction(() => !(document.querySelector("button") as HTMLButtonElement).disabled);
    const before = await page.evaluate(() => JSON.stringify((globalThis as any).saved.previsStudio));
    await click("审白模并建议补图"); await page.waitForFunction(() => document.body.textContent?.includes("网络中断"));
    const pending = await page.evaluate(() => JSON.parse((globalThis as any).saved.advisorStorage["keyframe-advice-pending"]));
    await page.evaluate(() => { (globalThis as any).networkFail = false; (globalThis as any).restore(); });
    await click("恢复原白模审片请求"); await page.waitForFunction(() => document.body.textContent?.includes("资料展开"));
    await click("带入关键分镜生成");
    await page.waitForFunction(() => Boolean((globalThis as any).saved.keyframeImageDraft));
    const carried = await page.evaluate(() => (globalThis as any).saved.keyframeImageDraft);
    expect(carried.label).toContain("资料展开");
    expect(carried.description).toContain("动作：");
    expect(carried.adviceRevision).toBe(pending.target.revision);
    expect(carried.endSec).toBeGreaterThan(carried.startSec);
    const final = await page.evaluate(() => ({ saved: (globalThis as any).saved, requests: (globalThis as any).requests }));
    expect(final.requests.map((r: any) => r.requestId)).toEqual([pending.id, pending.id]); expect(final.requests[0]).toEqual(final.requests[1]);
    expect(final.saved.script).toBe("整理工作资料。"); expect(final.saved.keyframes || []).toEqual([]); expect(final.saved.previsStudio).toEqual(JSON.parse(before));
    expect(final.saved.advisorStorage["keyframe-advice-pending"]).toBeUndefined(); expect(final.saved.advisorStorage[`keyframe-advice-response:${pending.id}`]).toBeTruthy();
    expect(await page.$eval("section", e => e.textContent)).toContain("11–13 秒");
    expect(await page.$$eval("button", buttons => buttons.map(b => b.textContent))).not.toContain("采用到对应片段");
    await page.evaluate(() => (globalThis as any).restore()); await page.waitForFunction(() => document.body.textContent?.includes("资料展开"));
    await page.evaluate(() => (globalThis as any).changeSpec()); await page.waitForFunction(() => document.body.textContent?.includes("上一版白模的建议"));
    expect(await page.$eval("button", e => (e as HTMLButtonElement).disabled)).toBe(true); await page.evaluate(() => { const stored = JSON.parse((globalThis as any).saved.advisorStorage["keyframe-advice-result"]); stored.plan.revision = "other"; (globalThis as any).saved.advisorStorage["keyframe-advice-result"] = JSON.stringify(stored); (globalThis as any).restore(); });
    await page.waitForFunction(() => document.body.textContent?.includes("历史补图建议无法读取"));
    expect(await page.$$eval("button", buttons => buttons.map(b => b.textContent))).not.toContain("复制补图要求"); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
