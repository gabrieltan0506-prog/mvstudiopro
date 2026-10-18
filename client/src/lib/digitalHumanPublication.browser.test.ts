/** 开发用真实React面板测试；RPC回执为离线夹具，不是线上验收。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("云保存失败不提交，网络未知恢复原编号，建议仅保存标题标签且不改文稿", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{DigitalHumanPublicationPanel}from'./client/src/components/DigitalHumanPublicationPanel';
    import{newDigitalHumanDraft,loadDigitalHumanDraft}from'./shared/digitalHumanStudio';
    const initial=newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000001');initial.script='用AI整理工作资料。';
    globalThis.saved=initial;globalThis.requests=[];globalThis.cloudFail=true;globalThis.networkFail=true;globalThis.cloudWrites=0;
    function App(){const[draft,setDraft]=React.useState(initial),[key,setKey]=React.useState(0);globalThis.restore=()=>{setDraft(loadDigitalHumanDraft(JSON.stringify(globalThis.saved),'7'));setKey(v=>v+1);};globalThis.changeScript=()=>setDraft(d=>{const next={...d,script:'改为安排工作时间。'};globalThis.saved=next;return next;});return <DigitalHumanPublicationPanel key={key} draft={draft} disabled={false} save={fn=>setDraft(d=>{const next=fn(d);globalThis.saved=next;return next;})} beforeSubmit={async()=>{if(globalThis.cloudFail)throw Error('云保存暂不可用');globalThis.cloudWrites++;}} acquireWork={()=>()=>{}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "offline", setup(b) {
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "rpc", namespace: "offline" }));
    b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: `export const trpc={mvAnalysis:{askPlatformSkillQa:{useMutation:()=>({mutateAsync:async input=>{globalThis.requests.push(input);if(globalThis.networkFail)throw Error('网络中断，结果未知');return{answer:JSON.stringify({kind:'digital_human_publication_v1',targetId:input.manhuaContext.digitalHumanPublication.id,platforms:['douyin','xiaohongshu','weixin_channels'].map(platform=>({platform,titles:['整理资料的方法','资料变得清晰','试试这样整理'],tags:['AI工具','工作方法','资料整理']}))})}}})},getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:12},refetch:async()=>({data:{remaining:5,price:12}})})}}};`, loader: "js" }));
  } }], logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true); page.on("request", r => { void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }); });
    await page.goto("https://example.test"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = (label: string) => page.evaluate(text => { const button = Array.from(document.querySelectorAll("button")).find(b => b.textContent === text); if (!button || button.disabled) throw Error("按钮不可用:" + text); button.click(); }, label);
    await click("推荐标题与标签"); await page.waitForFunction(() => document.body.textContent?.includes("云保存暂不可用"));
    const first = await page.evaluate(() => ({ pending: (globalThis as any).saved.advisorStorage["publication-pending"], calls: (globalThis as any).requests.length }));
    expect(first.calls).toBe(0); const requestId = JSON.parse(first.pending).id;
    await page.evaluate(() => (globalThis as any).changeScript());
    await page.waitForFunction(() => document.body.textContent?.includes("正在恢复上一版文稿的原请求"));
    expect(await page.$eval("details p", e => e.textContent)).toBe("用AI整理工作资料。");
    await page.evaluate(() => { (globalThis as any).cloudFail = false; (globalThis as any).restore(); });
    await click("恢复原发布建议请求"); await page.waitForFunction(() => document.body.textContent?.includes("网络中断"));
    await page.evaluate(() => { (globalThis as any).networkFail = false; (globalThis as any).restore(); });
    await click("恢复原发布建议请求"); await page.waitForFunction(() => document.querySelectorAll("li").length === 9);
    const final = await page.evaluate(() => ({ saved: (globalThis as any).saved, requests: (globalThis as any).requests, writes: (globalThis as any).cloudWrites }));
    expect(final.requests.map((r: any) => r.requestId)).toEqual([requestId, requestId]);
    expect(final.requests[0]).toEqual(final.requests[1]); expect(final.saved.script).toBe("改为安排工作时间。");
    expect(final.saved.advisorStorage["publication-pending"]).toBeUndefined(); expect(final.saved.advisorStorage[`publication-response:${requestId}`]).toBeTruthy();
    expect(final.writes).toBe(3); expect(await page.$eval("section", e => e.textContent)).not.toMatch(/来源|引用|Growth/);
    await page.evaluate(() => (globalThis as any).restore()); await page.waitForFunction(() => document.querySelectorAll("li").length === 9);
    await page.evaluate(() => (globalThis as any).changeScript()); await page.waitForFunction(() => document.body.textContent?.includes("上一版建议"));
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
