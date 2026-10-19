import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const built = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{useState} from 'react';
      import {createRoot} from 'react-dom/client';
      import FreeformCanvas from './client/src/components/canvas/FreeformCanvas';
      import {TooltipProvider} from './client/src/components/ui/tooltip';
      import {defaultCanvasBlock} from './client/src/lib/canvasTypes';
      import {applyDigitalHumanCinema,digitalHumanCinemaSchema} from './shared/digitalHumanCinema';
      const f=globalThis.fixture={requests:[],pending:false};
      const cinema=digitalHumanCinemaSchema.parse({movement:'缓推'});
      const refs=[{id:'portrait',role:'character',labelZh:'人物',url:'https://storage.googleapis.com/test-only/person.png',gcsUri:'gs://test-only/person.png'}];
      const edges=[];
      window.fetch=async(input,options)=>{
        const url=String(input); f.requests.push({url,method:options?.method||'GET'});
        if(url.includes('op=materialReadUrl')) {
          f.pending=true;
          return new Promise(resolve=>{f.release=()=>resolve(new Response(JSON.stringify({ok:true,url:'https://storage.googleapis.com/test-only/person.png?renewed=1'}),{status:200}));});
        }
        throw Error('本测试禁止其他网络请求');
      };
      function App(){
        const [blocks,setBlocks]=useState([{...defaultCanvasBlock('video',0),id:'video-cinema-race',videoModel:'seedance-2.5',refImageUrl:refs[0].url,cinema,prompt:applyDigitalHumanCinema('目标时长：5秒。人物看书。',cinema)}]);
        f.blocks=blocks;f.changeCinema=()=>setBlocks(previous=>previous.map(b=>({...b,cinema:{...b.cinema,movement:'拉远'}})));
        return <TooltipProvider><FreeformCanvas projectAssetRefs={refs} blocks={blocks} edges={edges} onBlocksChange={setBlocks} onEdgesChange={()=>{}} runDeps={{userRole:'admin',userId:'7',optimizeCopy:async()=>''}} /></TooltipProvider>;
      }
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, outdir: "/tmp/cinema-concurrency-bundle", platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    plugins: [{ name: "只模拟登录与远程服务边界", setup(builder) {
      builder.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:'auth',namespace:'auth-probe'}));
      builder.onLoad({filter:/.*/,namespace:'auth-probe'},()=>({loader:'js',contents:'export const useAuth=()=>({user:{id:7,role:"admin"},loading:false});'}));
      builder.onResolve({filter:/^@\/lib\/trpc$/},()=>({path:'trpc',namespace:'offline'}));
      builder.onLoad({filter:/.*/,namespace:'offline'},()=>({loader:'js',contents:`const proxy=new Proxy(()=>{}, {get:(_,key)=>key==='useUtils'?()=>proxy:key==='fetch'?async()=>[]:key==='useMutation'?()=>({mutateAsync:async()=>{throw Error('禁止远程修改');},isPending:false}):key==='useQuery'?()=>({data:{plan:'pro',status:'active'},isLoading:false}):proxy}); export const trpc=proxy;`}));
    }}],
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" }, logLevel: "silent",
  });
  bundle = built.outputFiles.find(f=>f.path.endsWith('.js'))!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async()=>{await browser?.close();});

it("真实画布参考准备期间锁定Cinema；外部改稿也使旧提交失效",async()=>{
 const page=await browser.newPage();
 const errors:string[]=[];
 page.on('pageerror',e=>errors.push(String(e)));
 try {
  await page.setRequestInterception(true);
  page.on('request',r=>r.abort());
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({content:bundle});
  await page.waitForSelector('[aria-label="画布Cinema导演工作台"]');
  await page.click('[aria-label="画布Cinema导演工作台"] > summary');
  await page.$$eval('button',nodes=>(nodes.find(n=>n.textContent?.trim()==='运行') as HTMLButtonElement).click());
  await page.waitForFunction(()=>(window as any).fixture.pending);
  expect(await page.$eval('[aria-label="画布Cinema导演工作台"] fieldset',n=>(n as HTMLFieldSetElement).disabled)).toBe(true);
  expect(await page.evaluate(()=>(window as any).fixture.blocks[0].status)).toBe('idle');
  // 模拟云稿/父组件在等待期间更新；控件禁用不能替代提交快照复核。
  await page.evaluate(()=>(window as any).fixture.changeCinema());
  await page.waitForFunction(()=>(window as any).fixture.blocks[0].cinema.movement==='拉远');
  await page.evaluate(()=>(window as any).fixture.release());
  await page.waitForFunction(()=>!(document.querySelector('[aria-label="画布Cinema导演工作台"] fieldset') as HTMLFieldSetElement).disabled);
  expect(await page.evaluate(()=>(window as any).fixture.requests.filter((r:any)=>r.method==='POST'))).toEqual([]);
  expect(await page.evaluate(()=>(window as any).fixture.requests.every((r:any)=>r.url.includes('op=materialReadUrl')))).toBe(true);
  expect(await page.evaluate(()=>(window as any).fixture.blocks[0].status)).toBe('idle');
  expect(errors).toEqual([]);
 }finally{await page.close();}
},30000);
