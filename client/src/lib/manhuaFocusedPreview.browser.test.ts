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
      import {resolveShotsForEpisodeKeyarts} from './client/src/lib/canvasDramaStudio';
      import {groupShotsIntoSegments} from '@shared/manhuaScriptWorkbench';
      import {buildManhuaAutoSegmentBinding} from '@shared/manhuaAutoSegment';
      const f=globalThis.fixture={updates:[],focus:[],review:0,calls:[]};
      f.currentBinding=blocks=>buildManhuaAutoSegmentBinding(1,groupShotsIntoSegments(resolveShotsForEpisodeKeyarts(blocks,1),{videoModel:'seedance-2.5'})[0],'seedance-2.5');
      function App(){const [phase,setPhase]=useState("storyboard");const [ep,setEp]=useState(1);f.setPhase=setPhase;f.episode=ep;const [blocks,setBlocks]=useState([1,2].map(n=>({...defaultCanvasBlock('image',0,0),id:'keyart-e01-s0'+n+'-preview',episodeIndex:1,outputUrl:n===1?'https://test.invalid/shot-1.png':undefined,prompt:'第'+n+'镜，医馆对话'})));f.blocks=blocks;f.setBlocks=setBlocks;return <TooltipProvider><ManhuaScriptWorkbench blocks={blocks} videoModel='seedance-2.5' topic='墨屠守护阿菁' episodeCount={13} focusEpisode={ep} onFocusEpisode={setEp} outlineEpisodes={Array.from({length:13},(_,i)=>({index:i+1,title:'集卡'+(i+1),body:'原文剧情'+(i+1),endHook:'片尾悬念'+(i+1)}))} characterIds={[]} propIds={[]} outlineConfirmed={true} workflowPhase={phase} compactUi={true} previewCanvas={<div data-test-canvas>原节点画布</div>} finalVideoUrl='https://test.invalid/old-final.mp4' onFocusBlock={id=>f.focus.push(id)} onReviewClipPromptsOnCanvas={()=>f.review++} onUpdateClipAudioStudio={(id,studio)=>{f.updates.push(id);setBlocks(rows=>rows.map(b=>b.id===id?{...b,audioStudio:studio}:b));}} /></TooltipProvider>;}
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

it("分镜默认显示当前镜，选镜不打开高级画布且不借旧片旧图，手动切换保留节点", async () => {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", r => { if(r.isNavigationRequest()) void r.respond({status:200,contentType:"text/html",body:'<div id="root"></div>'}); else void r.abort(); });
  try {
    await page.goto("http://localhost:41813");
    await page.addScriptTag({content:bundle});
    await page.waitForSelector('[data-manhua-column="preview"]');
    expect(await page.$eval('[data-manhua-column="preview"]',e=>e.getAttribute('data-manhua-preview-url'))).toBe('https://test.invalid/shot-1.png');
    expect(await page.$eval('#freeform-canvas-zone',e=>e.getAttribute('aria-hidden'))).toBe('true');
    await page.click('[data-manhua-shot="2"] > button');
    await page.waitForFunction(()=>document.querySelector('[data-manhua-shot="2"]')?.getAttribute('data-manhua-active')==='true');
    expect(await page.$eval('[data-manhua-column="preview"]',e=>e.getAttribute('data-manhua-preview-url'))).toBe('');
    expect(await page.$eval('#freeform-canvas-zone',e=>e.getAttribute('aria-hidden'))).toBe('true');
    await page.click('[data-manhua-action="open-canvas-dock"]');
    await page.waitForFunction(()=>document.querySelector('#freeform-canvas-zone')?.getAttribute('aria-hidden')==='false');
    expect(await page.$$('[data-test-canvas]')).toHaveLength(1);
    await page.click('[data-manhua-action="close-canvas-dock"]');
    await page.waitForFunction(()=>document.querySelector('#freeform-canvas-zone')?.getAttribute('aria-hidden')==='true');
    expect(await page.$$('[data-test-canvas]')).toHaveLength(1);
    expect(await page.evaluate(()=>(window as any).fixture.calls)).toEqual([]);
    await page.click('[data-manhua-shot="1"] > button');
    await page.evaluate(()=>{const f=(window as any).fixture;f.setBlocks(f.blocks.filter((b:any)=>!b.id.includes('-s01-')).map((b:any)=>({...b,outputUrl:'https://test.invalid/only-shot-2.png'})));});
    await page.waitForFunction(()=>!(window as any).fixture.blocks.some((b:any)=>b.id.includes('-s01-')));
    expect(await page.$eval('[data-manhua-column="preview"]',e=>e.getAttribute('data-manhua-preview-url'))).toBe('');
    // 当前段缺片时，其他段已产出的片子也不能冒充当前段。
    await page.evaluate(()=>{const f=(window as any).fixture;f.setBlocks([...f.blocks,{...f.blocks[0],kind:'video',id:'clip-e01-g02-preview',episodeIndex:1,videoModel:'seedance-2.5',prompt:'【第2段·10s】第二段',outputUrl:'https://test.invalid/segment-2.mp4'}]);});
    await page.waitForFunction(()=>(window as any).fixture.blocks.some((b:any)=>b.id==='clip-e01-g02-preview'));
    expect(await page.$eval('[data-manhua-column="preview"]',e=>e.getAttribute('data-manhua-preview-url'))).toBe('');
    await page.evaluate(()=>{const f=(window as any).fixture;f.setBlocks([...f.blocks,{...f.blocks[0],kind:'video',id:'clip-e01-g01-preview',episodeIndex:1,videoModel:'seedance-2.5',prompt:'【第1段·10s】第一段',manhuaAutoSegment:f.currentBinding(f.blocks),outputUrl:'https://test.invalid/segment-1.mp4'}]);});
    await page.waitForFunction(()=>document.querySelector('[data-manhua-column="preview"]')?.getAttribute('data-manhua-preview-url')==='https://test.invalid/segment-1.mp4',{timeout:5000});
    await page.evaluate(()=>(window as any).fixture.setPhase('outline'));
    await page.waitForSelector('[data-manhua-episode-card="13"]');
    expect(await page.$$('[data-manhua-episode-card]')).toHaveLength(13);
    await page.click('[data-manhua-episode-card="13"]');
    await page.waitForFunction(()=>(window as any).fixture.episode===13);
    expect(await page.$eval('[data-manhua-episode-story]',e=>e.textContent)).toContain('原文剧情13');
    expect(await page.$eval('[data-manhua-episode-story]',e=>e.textContent)).toContain('片尾悬念13');
    expect(errors).toEqual([]);
  } catch (error) {
    console.error('预览失败现场', await page.evaluate(() => ({preview: document.querySelector('[data-manhua-column="preview"]')?.outerHTML.slice(0,1500),blocks:(window as any).fixture?.blocks,errors:document.body.innerText.slice(-1600)})));
    throw error;
  } finally { await page.close(); }
}, 30000);
