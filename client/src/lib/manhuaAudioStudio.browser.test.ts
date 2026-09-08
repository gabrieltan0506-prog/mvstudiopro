import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import ManhuaScriptWorkbench from './client/src/components/ManhuaScriptWorkbench';
      import {TooltipProvider} from './client/src/components/ui/tooltip';
      import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
      const f=globalThis.fixture={updates:[],focus:[],review:0,calls:[]};
      function App(){const [blocks,setBlocks]=useState([1,2].map(n=>({...defaultCanvasBlock('video',0,0),id:'clip-e01-g0'+n+'-audio',episodeIndex:1,videoModel:'seedance-2.5',prompt:'【第'+n+'段·30s】墨屠第'+n+'段对白与动作。'})));f.blocks=blocks;return <TooltipProvider><ManhuaScriptWorkbench blocks={blocks} videoModel='seedance-2.5' topic='墨屠守护阿菁' episodeCount={1} focusEpisode={1} onFocusEpisode={()=>{}} characterIds={[]} propIds={[]} outlineConfirmed={true} workflowPhase='storyboard' compactUi={true} onFocusBlock={id=>f.focus.push(id)} onReviewClipPromptsOnCanvas={()=>f.review++} onUpdateClipAudioStudio={(id,studio)=>{f.updates.push(id);setBlocks(rows=>rows.map(b=>b.id===id?{...b,audioStudio:studio}:b));}} /></TooltipProvider>;}
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
        name: "只模拟服务边界",
        setup(builder) {
          builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "offline",
          }));
          builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: `
        const proxy=new Proxy(()=>{}, {get:(_,key)=>key==='useUtils'?()=>proxy:key==='fetch'?async()=>[]:key==='useMutation'?()=>({mutateAsync:async input=>{globalThis.fixture.calls.push(input);throw Error('本测试禁止生成');},isPending:false}):key==='useQuery'?()=>({data:undefined,isLoading:false}):proxy}); export const trpc=proxy;
      `,
          }));
        },
      },
    ],
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  bundle = built.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});
it("工厂原工作台直接打开音轨，切段分别保存且不跳画布或生成", async () => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.isNavigationRequest())
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<html><link rel="icon" href="data:,"><div id="root"></div></html>',
      });
    else void request.abort();
  });
  try {
    await page.goto("http://localhost:41812");
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector('[data-manhua-action="open-audio-studio"]', {
      timeout: 10000,
    });
    await page.click('[data-manhua-action="open-audio-studio"]');
    await page.waitForSelector('section[aria-label="逐句配音与分段配乐"]');
    const add = () =>
      page.evaluate(() => {
        const button = Array.from(document.querySelectorAll("button")).find(b =>
          b.textContent?.includes("添加一句对白")
        );
        if (!button) throw Error("缺少逐句入口");
        button.click();
      });
    await add();
    await page.waitForFunction(
      () => (window as any).fixture.updates.length === 1
    );
    await page.select('[aria-label="音轨工作台当前段"]', "2");
    await page.waitForFunction(() =>
      document
        .querySelector("[data-manhua-audio-studio]")
        ?.textContent?.includes("第 2 段")
    );
    await add();
    await page.waitForFunction(
      () => (window as any).fixture.updates.length === 2
    );
    const actual = await page.evaluate(() => ({
      updates: (window as any).fixture.updates,
      focus: (window as any).fixture.focus,
      review: (window as any).fixture.review,
      calls: (window as any).fixture.calls,
      counts: (window as any).fixture.blocks.map(
        (b: any) => b.audioStudio?.cues.length
      ),
    }));
    expect(actual).toEqual({
      updates: ["clip-e01-g01-audio", "clip-e01-g02-audio"],
      focus: [],
      review: 0,
      calls: [],
      counts: [1, 1],
    });
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 20_000);
