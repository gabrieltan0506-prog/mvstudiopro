import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("配乐咨询原编号、候选与采用计划随数字人存储恢复，保存失败不咨询，换段不接收晚到回执", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
 import React from 'react';import{createRoot}from'react-dom/client';
 import{BgmCreativeAdvisor}from'./client/src/components/canvas/BgmCreativeAdvisor';import{useDigitalHumanStorage}from'./client/src/lib/useDigitalHumanStorage';
 globalThis.data={};globalThis.calls=[];globalThis.fail=true;globalThis.delay=false;globalThis.applied=null;
 const target={sourceKey:'original',videoUri:'gs://test-only/v.mp4',bgmUri:'gs://test-only/m.mp3',entrySec:0,durationSec:10,volume:.6,fadeInSec:0,fadeOutSec:0};
 function App(){const[data,setData]=React.useState(globalThis.data),[key,setKey]=React.useState(0),[scope,setScope]=React.useState('first');const storage=useDigitalHumanStorage(data,fn=>{globalThis.data=fn(globalThis.data);setData(globalThis.data)});globalThis.remount=()=>setKey(k=>k+1);globalThis.switch=()=>{globalThis.data={};setData({});setScope('second');setKey(k=>k+1)};
 return <div data-testid="active-bgm-scope" data-scope={scope}><BgmCreativeAdvisor key={key} context={{projectId:'00000000-0000-4000-8000-000000000001'}} target={target} storageKey={scope} storage={storage} beforeSubmit={async()=>{if(globalThis.fail)throw Error('云端保存失败')}} onApply={p=>{globalThis.applied=p;storage.setItem('adopted',JSON.stringify(p))}}/></div>;}
 createRoot(document.getElementById('root')).render(<App/>);
 `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "offline-rpc",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "rpc",
            namespace: "offline",
          }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: `
 const plan={kind:'bgm_mix_v1',sourceKey:'original',summaryZh:'在目光落下时留出空间',narrativeMix:[{startSec:1,endSec:3,gainStart:.5,gainEnd:.2,role:'支持表演',noteZh:'配合转头'}],duckUnderDialogue:false,uncertaintiesZh:[]};
 export const trpc={mvAnalysis:{getManhuaAdvisorQuota:{useQuery:()=>({data:{price:1}})},askPlatformSkillQa:{useMutation:()=>({isPending:false,mutateAsync:async input=>{globalThis.calls.push(input);if(globalThis.delay)await new Promise(r=>globalThis.finish=r);return{answer:JSON.stringify(plan)}}})}}};`,
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on(
      "request",
      r =>
        void r.respond({
          status: 200,
          contentType: "text/html",
          body: '<div id="root"></div>',
        })
    );
    await page.goto("https://test.invalid");
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = (text: string) =>
      page.evaluate(text => {
        const b = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === text
        );
        if (!b || b.disabled) throw Error("不可点击 " + text);
        b.click();
      }, text);
    await page.waitForSelector('[aria-label="创作顾问配乐判断"]');
    await click("让创作顾问判断配乐");
    await page.waitForFunction(() =>
      document.body.textContent?.includes("云端保存失败")
    );
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    const requestId = await page.evaluate(
      () => JSON.parse((globalThis as any).data["first:pending"]).requestId
    );
    await page.evaluate(() => {
      (globalThis as any).fail = false;
      (globalThis as any).remount();
    });
    await click("让创作顾问判断配乐");
    await page.waitForFunction(() =>
      Boolean((globalThis as any).data["first:candidate"])
    );
    expect(
      await page.evaluate(() => (globalThis as any).calls[0].requestId)
    ).toBe(requestId);
    await page.evaluate(() => (globalThis as any).remount());
    await page.waitForFunction(() =>
      document.body.textContent?.includes("在目光落下时留出空间")
    );
    await click("采用到混音时间表");
    expect(
      await page.evaluate(
        () => (globalThis as any).applied.narrativeMix[0].gainEnd
      )
    ).toBe(0.2);
    await page.evaluate(() => {
      (globalThis as any).delay = true;
    });
    await click("让创作顾问判断配乐");
    await page.waitForFunction(() => Boolean((globalThis as any).finish));
    await page.evaluate(() => (globalThis as any).switch());
    // 等待真实新段提交到DOM，再释放旧请求；不把调度更新当成已切段。
    await page.waitForSelector('[data-testid="active-bgm-scope"][data-scope="second"]');
    await page.evaluate(() => (globalThis as any).finish());
    await page.waitForFunction(() =>
      Boolean(document.querySelector('[aria-label="创作顾问配乐判断"]'))
    );
    expect(await page.evaluate(() => (globalThis as any).data)).toEqual({});
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
