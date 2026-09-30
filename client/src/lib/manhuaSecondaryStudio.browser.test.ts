import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
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
      import {resolveShotsForEpisodeKeyarts} from './client/src/lib/canvasDramaStudio';
      import {groupShotsIntoSegments} from '@shared/manhuaScriptWorkbench';
      import {buildManhuaAutoSegmentBinding} from '@shared/manhuaAutoSegment';
      const f=globalThis.fixture={updates:[],focus:[],review:0,calls:[],advisor:0};
      f.currentBinding=blocks=>buildManhuaAutoSegmentBinding(1,groupShotsIntoSegments(resolveShotsForEpisodeKeyarts(blocks,1),{videoModel:'seedance-2.5'})[0],'seedance-2.5');
      function App(){const [canRun,setCanRun]=useState(true);f.setCanRun=setCanRun;const [phase,setPhase]=useState("storyboard");const [ep,setEp]=useState(1);f.setPhase=setPhase;f.episode=ep;const [blocks,setBlocks]=useState([1,2].map(n=>({...defaultCanvasBlock('image',0,0),id:'keyart-e01-s0'+n+'-preview',episodeIndex:1,outputUrl:n===1?'https://test.invalid/shot-1.png':undefined,prompt:'第'+n+'镜，医馆对话'})).concat([{...defaultCanvasBlock('video',0,0),id:'clip-e01-g01-audio',episodeIndex:1,videoModel:'seedance-2.5',prompt:'【第1段·15s】墨屠守护阿菁'}]));f.blocks=blocks;f.setBlocks=setBlocks;return <TooltipProvider><ManhuaScriptWorkbench canRun={canRun} blocks={blocks} videoModel='seedance-2.5' topic='墨屠守护阿菁' episodeCount={13} focusEpisode={ep} onFocusEpisode={setEp} outlineEpisodes={Array.from({length:13},(_,i)=>({index:i+1,title:'集卡'+(i+1),body:'原文剧情'+(i+1),endHook:'片尾悬念'+(i+1)}))} characterIds={[]} propIds={[]} outlineConfirmed={true} workflowPhase={phase} onWorkflowPhaseChange={setPhase} onGenerateAllEpisodeKeyarts={()=>f.calls.push("generate-keyarts")} onOpenAdvisorTemplates={()=>f.advisor++} rewriteWorkspace={<div data-test-rewrite-workspace>剧本页独立模板工作区</div>} compactUi={true} previewCanvas={<div data-test-canvas>原节点画布</div>} finalVideoUrl='https://test.invalid/old-final.mp4' onFocusBlock={id=>f.focus.push(id)} onReviewClipPromptsOnCanvas={()=>f.review++} onGenerateAsset3d={()=>f.calls.push("model")} onGenerateSceneWorld={()=>f.calls.push("world")} onChangeManhuaActionPlan={()=>f.calls.push("plan")} onUpdateClipPrevisStudio={()=>f.calls.push("previs")} onUpdateClipAudioStudio={(id,studio)=>{f.updates.push(id);setBlocks(rows=>rows.map(b=>b.id===id?{...b,audioStudio:studio}:b));}} /></TooltipProvider>;}
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

it("五项二级工具同页切换，保留旧面板且不触发生成或跳页", async () => {
  const page = await browser.newPage();
  const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", r => r.isNavigationRequest() ? void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void r.abort());
  try {
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto("http://localhost:41833"); await page.addScriptTag({ content: bundle });
    const captureDir = process.env.MVS_UI_SCREENSHOT_DIR;
    if (captureDir) {
      const cssDir = path.resolve("client/dist/assets");
      const cssName = readdirSync(cssDir).find(name => name.startsWith("index-") && name.endsWith(".css"));
      if (!cssName) throw new Error("请先构建正式CSS再进行开发截图核对");
      await page.addStyleTag({ content: readFileSync(path.join(cssDir, cssName), "utf8") });
    }
    await page.waitForSelector('[data-manhua-action="open-secondary-tools"]');
    await page.click('[data-manhua-action="open-secondary-tools"]');
    await page.waitForSelector('[data-manhua-secondary-studio]');
    expect(await page.$$('[role="tablist"][aria-label="二级工具"] [role="tab"]')).toHaveLength(5);
    for (const tool of ["model3d", "world3d", "previs", "actionTimeline", "audio"]) {
      await page.click(`#manhua-tool-tab-${tool}`);
      await page.waitForFunction(tool => document.getElementById(`manhua-tool-panel-${tool}`)?.hidden === false, {}, tool);
      expect(await page.$$('[data-manhua-secondary-studio]')).toHaveLength(1);
      expect(await page.$$('[data-manhua-secondary-studio-overlay]')).toHaveLength(0);
      expect(await page.$$eval('[data-manhua-secondary-studio] [role="tabpanel"]', els => els.filter(e => !(e as HTMLElement).hidden).length)).toBe(1);
    }
    await page.evaluate(() => { (window as any).audioPanel = document.querySelector('#manhua-tool-panel-audio'); });
    await page.click('#manhua-tool-tab-model3d'); await page.click('#manhua-tool-tab-audio');
    expect(await page.evaluate(() => document.querySelector('#manhua-tool-panel-audio') === (window as any).audioPanel)).toBe(true);
    await page.focus('#manhua-tool-tab-audio'); await page.keyboard.press('ArrowRight');
    expect(await page.$eval('#manhua-tool-tab-model3d', e => e.getAttribute('aria-selected'))).toBe('true');
    expect(page.url()).toBe('http://localhost:41833/');
    expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([]);
    expect(errors).toEqual([]);
    if (captureDir) {
      mkdirSync(captureDir, { recursive: true });
      const layout = await page.evaluate(() => {
        const header = document.querySelector('[data-manhua-product-header]')!.getBoundingClientRect();
        const studio = document.querySelector('[data-manhua-secondary-studio]')!.getBoundingClientRect();
        return { headerBottom: header.bottom, studioTop: studio.top, studioBottom: studio.bottom, viewportHeight: innerHeight };
      });
      expect(layout.studioTop).toBeGreaterThanOrEqual(layout.headerBottom);
      expect(layout.studioBottom).toBeLessThanOrEqual(layout.viewportHeight);
      await page.screenshot({ path: path.join(captureDir, "五标签同页-开发辅助.png"), fullPage: true });
    }
  } finally { await page.close(); }
}, 30000);


it("真实声音面板在桌面和窄屏都留在标签内容区，不遮挡收起按钮", async () => {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => request.isNavigationRequest()
    ? void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' })
    : void request.abort());
  try {
    const cssDir = path.resolve("client/dist/assets");
    const cssNames = readdirSync(cssDir).filter(name => /^(index|OmniCanvas)-.*\.css$/.test(name));
    if (!cssNames.length) throw new Error("请先构建正式CSS后验证声音布局");
    await page.goto("http://localhost:41833");
    await page.addStyleTag({ content: cssNames.map(name => readFileSync(path.join(cssDir, name), "utf8")).join("\n") });
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector('[data-manhua-action="open-secondary-tools"]');
    for (const width of [1440, 900, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.click('[data-manhua-action="open-secondary-tools"]');
      await page.click('#manhua-tool-tab-audio');
      await page.waitForSelector('[data-manhua-audio-studio]', { visible: true });
      const layout = await page.evaluate(() => {
        const audio = document.querySelector('[data-manhua-audio-studio]')!;
        const content = document.querySelector('[data-manhua-studio-content]')!.getBoundingClientRect();
        const tabs = document.querySelector('[role="tablist"][aria-label="二级工具"]')!.getBoundingClientRect();
        const rect = audio.getBoundingClientRect();
        const close = document.querySelector('[aria-label="收起二级工具"]')!;
        const closeRect = close.getBoundingClientRect();
        return { position: getComputedStyle(audio).position, audioTop: rect.top, tabsBottom: tabs.bottom,
          audioLeft: rect.left, audioRight: rect.right, contentLeft: content.left, contentRight: content.right,
          closeReachable: close.contains(document.elementFromPoint(closeRect.x + closeRect.width / 2, closeRect.y + closeRect.height / 2)) };
      });
      expect(layout.position).toBe("static");
      expect(layout.audioTop).toBeGreaterThanOrEqual(layout.tabsBottom);
      expect(layout.audioLeft).toBeGreaterThanOrEqual(layout.contentLeft);
      expect(layout.audioRight).toBeLessThanOrEqual(layout.contentRight);
      expect(layout.closeReachable).toBe(true);
      await page.click('[aria-label="收起二级工具"]');
      await page.waitForFunction(() => !document.querySelector('[data-manhua-secondary-studio]'));
    }
    expect(await page.evaluate(() => (window as any).fixture.calls)).toEqual([]);
  } finally { await page.close(); }
}, 30000);
