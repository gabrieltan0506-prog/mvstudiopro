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
      import FreeformCanvas from './client/src/components/canvas/FreeformCanvas';
      import {TooltipProvider} from './client/src/components/ui/tooltip';
      import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
      const f=globalThis.fixture={calls:[]};
      function App(){const [blocks,setBlocks]=useState([{...defaultCanvasBlock('video',0),id:'video-test',videoModel:'seedance-2.0',videoResolution:'4K',prompt:'原台词与5秒动作',outputUrl:'',seedance25WorkMode:'video_edit',uploadedAssets:[]}]);f.blocks=blocks;return <TooltipProvider><FreeformCanvas blocks={blocks} edges={[]} onBlocksChange={setBlocks} onEdgesChange={()=>{}} runDeps={{}} /></TooltipProvider>;}
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
          builder.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:'auth',namespace:'auth-probe'}));
          builder.onLoad({filter:/.*/,namespace:'auth-probe'},()=>({loader:'js',contents:'export const useAuth=()=>({user:{id:7,role:"admin"},loading:false});'}));
          builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "offline",
          }));
          builder.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: `
        const proxy=new Proxy(()=>{}, {get:(_,key)=>key==='useUtils'?()=>proxy:key==='fetch'?async()=>[]:key==='useMutation'?()=>({mutateAsync:async input=>{globalThis.fixture.calls.push(input);throw Error('本测试禁止生成');},isPending:false}):key==='useQuery'?()=>({data:{plan:'pro',status:'active'},isLoading:false}):proxy}); export const trpc=proxy;
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

it("切模型同步合法画质和参考模式，保留原稿且零生成", async()=>{
 const page=await browser.newPage();
 try {
  await page.setRequestInterception(true);
  page.on('request',r=>r.url().startsWith('http')?r.abort():r.continue());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({content:bundle});
  await page.waitForSelector('select[aria-label="成片模型"]');
  expect(await page.$$eval('select[aria-label="成片画质"] option',els=>els.map(e=>e.value))).toEqual(['720p','1080p','4K']);
  await page.select('select[aria-label="成片模型"]','seedance-2.5');
  await page.waitForFunction(()=>(window as any).fixture.blocks[0].videoModel==='seedance-2.5');
  expect(await page.evaluate(()=>{const b=(window as any).fixture.blocks[0];return [b.videoResolution,b.seedance25WorkMode,b.prompt];})).toEqual(['720p','reference_to_video','原台词与5秒动作']);
  await page.select('select[aria-label="成片模型"]','minimax-hailuo-3');
  await page.waitForSelector('select[aria-label="成片画质"]');
  expect(await page.$$eval('select[aria-label="成片画质"] option',els=>els.map(e=>e.value))).toEqual(['720p','2K']);
  expect(await page.evaluate(()=>(window as any).fixture.calls)).toEqual([]);
 } finally {await page.close();}
},30000);
