import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
let browser: Browser;
let bundle: string;
let layoutCss = "";
const audioEvidenceDir = "/tmp/mvs-audio-layout-probe";
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
      function App(){const [phase,setPhase]=useState("storyboard");f.setPhase=setPhase;const [blocks,setBlocks]=useState([1,2].map(n=>({...defaultCanvasBlock('video',0,0),id:'clip-e01-g0'+n+'-audio',episodeIndex:1,videoModel:'seedance-2.5',prompt:'【第'+n+'段·30s】墨屠第'+n+'段对白与动作。'})));f.blocks=blocks;return <TooltipProvider><ManhuaScriptWorkbench blocks={blocks} videoModel='seedance-2.5' topic='墨屠守护阿菁' episodeCount={1} focusEpisode={1} onFocusEpisode={()=>{}} characterIds={[]} propIds={[]} outlineConfirmed={true} workflowPhase={phase} compactUi={true} onFocusBlock={id=>f.focus.push(id)} onReviewClipPromptsOnCanvas={()=>f.review++} onUpdateClipAudioStudio={(id,studio)=>{f.updates.push(id);setBlocks(rows=>rows.map(b=>b.id===id?{...b,audioStudio:studio}:b));}} /></TooltipProvider>;}
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
  const cssDir = process.env.MANHUA_LAYOUT_CSS_DIR;
  if (cssDir) {
    const cssFiles = (await readdir(cssDir)).filter(name => /^(index|OmniCanvas)-.*\.css$/.test(name)).sort((a, b) => Number(b.startsWith("index-")) - Number(a.startsWith("index-")));
    if (cssFiles.length !== 2) throw new Error(`缺少主样式或工厂主题样式：${cssDir}`);
    layoutCss = (await Promise.all(cssFiles.map(file => readFile(path.join(cssDir, file), "utf8")))).join("\n");
    await mkdir(audioEvidenceDir, { recursive: true });
  }
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
        body: '<html><link rel="icon" href="data:,"><div id="root" data-manhua-theme="cream"></div></html>',
      });
    else void request.abort();
  });
  try {
    await page.goto("http://localhost:41812");
    if (layoutCss) await page.addStyleTag({ content: layoutCss });
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector('[data-manhua-action="open-audio-studio"]', {
      timeout: 10000,
    });
    await page.click('[data-manhua-action="open-audio-studio"]');
    await page.waitForSelector('section[aria-label="逐句配音、配乐与事件音效"]');
    expect(await page.$eval('[data-manhua-audio-editor]', element => (element as HTMLDetailsElement).open)).toBe(true);
    expect(await page.$$('[data-manhua-sound-summary] > section')).toHaveLength(3);
    if (layoutCss) {
      await page.setViewport({ width: 1280, height: 900 });
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow).toBeLessThanOrEqual(2);
      const bottomDock = await page.evaluate(() => {
        const shell = document.querySelector('[data-manhua-product-header]')!.getBoundingClientRect();
        const panel = document.querySelector('[data-manhua-audio-studio]')!.getBoundingClientRect();
        const storyboard = document.querySelector('[data-manhua-phase-panel="storyboard"]')!.getBoundingClientRect();
        return { left: panel.left - shell.left, widthRatio: panel.width / shell.width, gap: panel.top - storyboard.bottom, storyboardHeight: storyboard.height };
      });
      await page.screenshot({ path: path.join(audioEvidenceDir, "factory-audio-1280.png"), fullPage: false });
      expect(bottomDock.left).toBeLessThan(40);
      expect(bottomDock.widthRatio).toBeGreaterThan(0.9);
      expect(bottomDock.gap).toBeGreaterThanOrEqual(-2);
      expect(bottomDock.storyboardHeight).toBeGreaterThan(180);
      await page.setViewport({ width: 1800, height: 1000 });
      const sideDock = await page.evaluate(() => {
        const panel = document.querySelector('[data-manhua-audio-studio]')!.getBoundingClientRect();
        const storyboard = document.querySelector('[data-manhua-phase-panel="storyboard"]')!.getBoundingClientRect();
        return { gap: panel.left - storyboard.right, storyboardWidth: storyboard.width, panelHeight: panel.height };
      });
      expect(sideDock.gap).toBeGreaterThanOrEqual(-2);
      expect(sideDock.storyboardWidth).toBeGreaterThan(840);
      expect(sideDock.panelHeight).toBeGreaterThan(400);
      await page.screenshot({ path: path.join(audioEvidenceDir, "factory-audio-1800.png"), fullPage: false });
    }
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
it('资产阶段通过更多操作打开声音工作台，不生成或改动成片',async()=>{
 const page=await browser.newPage();page.setDefaultTimeout(5000);await page.setRequestInterception(true);page.on('request',r=>r.isNavigationRequest()?void r.respond({status:200,contentType:'text/html',body:'<div id="root"></div>'}):void r.abort());
 try{await page.setViewport({width:1800,height:1000});await page.goto('http://localhost:41812');if(layoutCss)await page.addStyleTag({content:layoutCss});await page.addScriptTag({content:bundle});await page.waitForFunction(()=>Boolean((globalThis as any).fixture.setPhase));await page.evaluate(()=>(globalThis as any).fixture.setPhase('assets'));
 await page.waitForSelector('[data-manhua-action="open-more-tools"]');await page.click('[data-manhua-action="open-more-tools"]');
 await page.waitForSelector('[data-manhua-secondary-tool="audio"]');await page.click('[data-manhua-secondary-tool="audio"]');
 await page.waitForSelector('section[aria-label="逐句配音、配乐与事件音效"]');
 if(layoutCss){const layout=await page.evaluate(()=>{const panel=document.querySelector('[data-manhua-audio-studio]')!.getBoundingClientRect();const assets=document.querySelector('[data-manhua-phase-panel="assets"]')!.getBoundingClientRect();return{gap:panel.left-assets.right,assetsWidth:assets.width};});expect(layout.gap).toBeGreaterThanOrEqual(-2);expect(layout.assetsWidth).toBeGreaterThan(840);}
 expect(await page.evaluate(()=>(globalThis as any).fixture.calls)).toEqual([]);expect(await page.evaluate(()=>(globalThis as any).fixture.updates)).toEqual([]);
 }finally{await page.close();}
},20000);
