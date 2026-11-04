import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("数字人共用入口传真实文案，方案可审、整句字幕入队及刷新恢复", async () => {
  const plan = {
    sourceDurationSec: 10,
    summary: "先问后答",
    sourceSrt: "1\n00:00:02,100 --> 00:00:04,500\n完整口播正文\n",
    uncertainties: [],
    plans: ["预告", "短版"].map(title => ({
      title,
      kind: "short",
      rationale: "保留因果",
      cuts: [
        {
          startSec: 2,
          endSec: 5,
          reason: "保留回答",
          evidence: "回答之后停顿",
        },
      ],
    })),
    creativeDirections: ["听者", "回访"].map(title => ({
      title,
      evidence: "原片回答",
      difference: "改变叙述角度",
    })),
  };
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import Workshop from './client/src/components/canvas/PostProdWorkshopCard';
    globalThis.calls=[];globalThis.answer=${JSON.stringify(JSON.stringify(plan))};globalThis.mode='success';
    const map=new Map();globalThis.saved=map;
    const store={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k),clear:()=>map.clear(),key:i=>[...map.keys()][i],get length(){return map.size;}};
    function App(){const[v,setV]=React.useState(0);globalThis.remount=()=>setV(v=>v+1);return <Workshop key={v} blocks={[]} userId='7' projectScopeKey='digital-human:project:one' vfxScopeKey='digital-human:project:one' mediaInput={{clips:[{id:'source',url:'gs://test-only/source.mp4',label:'口播原片'}],audio:[],story:'完整口播正文'}} storage={store} advisorContext={{projectId:'one',episodeBody:'完整口播正文',shotSummary:''}}/>;}
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
    plugins: [
      {
        name: "offline",
        setup(b) {
          b.onResolve({ filter: /(?:^@\/lib\/trpc$|\/trpc$)/ }, () => ({
            path: "trpc",
            namespace: "offline",
          }));
          b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: `
      const query={data:undefined,isLoading:false,isFetching:false,error:null};
      const mutation={isPending:false,mutate:()=>{},mutateAsync:async input=>{globalThis.calls.push(input);if(input.question){if(globalThis.mode!=='success')throw Object.assign(new Error(globalThis.mode),{data:{code:'PRECONDITION_FAILED'}});return {answer:globalThis.answer};}return {jobId:'job-'+globalThis.calls.length,status:'queued'};}};
      const utils=new Proxy({}, {get:()=>new Proxy({}, {get:()=>({invalidate:async()=>{},fetch:async()=>null})})});
      const leaf=new Proxy({}, {get:(_,key)=>key==='useQuery'?()=>query:key==='useMutation'?()=>mutation:()=>{}});
      export const trpc=new Proxy({}, {get:(_,key)=>key==='useUtils'?()=>utils:new Proxy({}, {get:()=>leaf})});
    `,
          }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" },
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", r =>
      r.respond({ status: 200, contentType: "application/json", body: "[]" })
    );
    await page.goto("http://localhost/");
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('[aria-label="剪辑方案原片"]');
    await page.select('[aria-label="剪辑方案原片"]', "source");
    const click = (text: string) =>
      page.$$eval(
        '[aria-label="剪辑方案工坊"] button',
        (nodes, text) => {
          const n = nodes.find(
            n => n.textContent?.trim() === text
          ) as HTMLButtonElement;
          if (!n || n.disabled) throw new Error("按钮不可用：" + text);
          n.click();
        },
        text
      );
    await click("分析原片并提出方案");
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="剪辑方案工坊"]')
        ?.textContent?.includes("先问后答")
    );
    const request = await page.evaluate(() => (globalThis as any).calls[0]);
    expect(request.manhuaContext.subtitleReview.dialogue).toBe("完整口播正文");
    expect(request.manhuaContext.subtitleReview.montageTargetSec).toBe(30);
    await page.evaluate(() => (globalThis as any).remount());
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="剪辑方案工坊"]')
        ?.textContent?.includes("先问后答")
    );
    await click("采用并生成此版");
    await page.waitForFunction(() => (globalThis as any).calls.length === 2);
    const job = await page.evaluate(() => (globalThis as any).calls[1]);
    expect(job).toMatchObject({
      action: "concat",
      scopeKey: "digital-human:project:one",
      params: {
        clips: ["gs://test-only/source.mp4"],
        trims: [{ startSec: 2, endSec: 5 }],
        width: 720,
        height: 1280,
      },
    });
    expect(job.params.subtitleSrt).toContain("00:00:00,100 --> 00:00:02,500");
    // 换一个挂载实例并清理虚构任务缓存，验证服务端失败/退款待核的不同行为。
    await page.evaluate(() => {
      for (const k of [...(globalThis as any).saved.keys()])
        if (k.startsWith("postProd.jobs") && !k.includes(":"))
          (globalThis as any).saved.delete(k);
      (globalThis as any).mode = "ADVISOR_OPERATION_FAILED：已退款";
      (globalThis as any).remount();
    });
    await page.waitForFunction(() =>
      [...document.querySelectorAll('[aria-label="剪辑方案工坊"] button')].some(
        n =>
          n.textContent === "分析原片并提出方案" &&
          !(n as HTMLButtonElement).disabled
      )
    );
    await click("分析原片并提出方案");
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="剪辑方案工坊"] [role="alert"]')
        ?.textContent?.includes("已退款")
    );
    expect(
      await page.$eval(
        '[aria-label="剪辑方案原片"]',
        n => (n as HTMLSelectElement).disabled
      )
    ).toBe(false);
    await page.evaluate(() => {
      (globalThis as any).mode = "ADVISOR_OPERATION_REFUND_PENDING：对账中";
    });
    await click("分析原片并提出方案");
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="剪辑方案工坊"] [role="alert"]')
        ?.textContent?.includes("对账中")
    );
    expect(
      await page.$eval(
        '[aria-label="剪辑方案原片"]',
        n => (n as HTMLSelectElement).disabled
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
