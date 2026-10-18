/** 发布建议串稿与坏记录保护，使用真实组件及离线RPC。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("坏pending与坏结果拒绝，保存请求及结果时阻止切换制作稿串写", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import{createRoot}from'react-dom/client';
    import{DigitalHumanPublicationPanel}from'./client/src/components/DigitalHumanPublicationPanel';
    import{newDigitalHumanDraft}from'./shared/digitalHumanStudio';
    const id1='00000000-0000-4000-8000-000000000001',id2='00000000-0000-4000-8000-000000000002';
    const base=(id=id1)=>({...newDigitalHumanDraft('7',id),script:'整理工作资料。'});
    const target=id=>({id,script:'整理工作资料。'});
    const context=id=>({seriesTitle:'数字人',episodeIndex:1,episodeTitle:'当前稿件',stage:'final',videoModel:'未选择',writerConfirmed:true,episodeBody:'整理工作资料。',assetSummary:'',shotSummary:'',blockers:[],digitalHumanPublication:target(id)});
    const plan=id=>({kind:'digital_human_publication_v1',targetId:id,platforms:['douyin','xiaohongshu','weixin_channels'].map(platform=>({platform,titles:['标题一','标题二','标题三'],tags:['资料','整理','工作']}))});
    globalThis.reply=plan;globalThis.saved=base();globalThis.requests=[];globalThis.persisted={};
    function App(){const[draft,setDraft]=React.useState(globalThis.saved),[epoch,setEpoch]=React.useState(0);
      const switchOther=()=>{globalThis.saved=base(id2);setDraft(globalThis.saved);};
      globalThis.reset=mode=>{const d=base();globalThis.quotaHook=undefined;globalThis.networkHook=undefined;
        if(mode==='wrong-pending'||mode==='mismatch')d.advisorStorage['publication-pending']=JSON.stringify({id:'00000000-0000-4000-8000-000000000003',target:target(mode==='mismatch'?id1:id2),context:context(id2),paid:false,credits:12});
        if(mode==='bad-result')d.advisorStorage['publication-result']=JSON.stringify({target:target(id1),plan:plan(id2)});
        if(mode==='switch-before-save')globalThis.quotaHook=switchOther;if(mode==='switch-result')globalThis.networkHook=switchOther;
        globalThis.saved=d;setDraft(d);setEpoch(n=>n+1);};
      return <DigitalHumanPublicationPanel key={epoch} draft={draft} disabled={false} save={fn=>{const next=fn(globalThis.saved);globalThis.saved=next;globalThis.persisted[next.id]=next;setDraft(next);}} beforeSubmit={async()=>{}} acquireWork={()=>()=>{}}/>;}
    createRoot(document.getElementById('root')).render(<App/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"' }, plugins: [{ name: "offline", setup(b) {
    b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "rpc", namespace: "offline" }));
    b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({ contents: `export const trpc={mvAnalysis:{askPlatformSkillQa:{useMutation:()=>({mutateAsync:async input=>{globalThis.requests.push(input);globalThis.networkHook?.();return{answer:JSON.stringify(globalThis.reply(input.manhuaContext.digitalHumanPublication.id))}}})},getManhuaAdvisorQuota:{useQuery:()=>({data:{remaining:5,price:12},refetch:async()=>{globalThis.quotaHook?.();return{data:{remaining:5,price:12}}}})}}};`, loader: "js" }));
  } }], logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true); page.on("request", r => { void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }); });
    await page.goto("https://example.test"); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const reset = async (mode: string) => { await page.evaluate(m => (globalThis as any).reset(m), mode); await page.waitForFunction(() => !document.querySelector('[role="alert"]')); };
    const click = () => page.evaluate(() => { const b = document.querySelector("button")!; if (b.disabled) throw Error("按钮禁用"); b.click(); });
    await reset("wrong-pending"); await click(); await page.waitForFunction(() => document.body.textContent?.includes("原发布请求属于其他制作稿"));
    await reset("mismatch"); await click(); await page.waitForFunction(() => document.body.textContent?.includes("原发布请求与文稿目标不一致"));
    expect(await page.evaluate(() => (globalThis as any).requests.length)).toBe(0);
    await page.evaluate(() => (globalThis as any).reset("bad-result")); await page.waitForFunction(() => document.body.textContent?.includes("历史发布建议无法读取")); expect(await page.$$("li")).toHaveLength(0);
    await reset("switch-before-save"); await click(); await page.waitForFunction(() => document.body.textContent?.includes("未保存或提交其他作品的发布请求"));
    expect(await page.evaluate(() => (globalThis as any).saved.advisorStorage)).toEqual({}); expect(await page.evaluate(() => (globalThis as any).requests.length)).toBe(0);
    await reset("switch-result"); await click(); await page.waitForFunction(() => document.body.textContent?.includes("原发布结果未绑定到其他作品"));
    const result = await page.evaluate(() => ({ requests: (globalThis as any).requests, saved: (globalThis as any).saved, original: (globalThis as any).persisted['00000000-0000-4000-8000-000000000001'] }));
    expect(result.requests).toHaveLength(1); expect(result.saved.advisorStorage).toEqual({}); expect(result.original.advisorStorage['publication-pending']).toBeTruthy(); expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
