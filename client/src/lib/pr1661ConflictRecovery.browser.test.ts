import {beforeAll, afterAll, it, expect} from "vitest";
import {build} from "esbuild";
import puppeteer, {type Browser} from "puppeteer";
import path from "node:path";
import {buildManhuaCloudDraftPayload} from "@shared/manhuaCloudDraft";
let bundle: string; let browser: Browser;
const prefix="mv-manhua-project:1:11111111-1111-4111-8111-111111111111:";
const cloud=buildManhuaCloudDraftPayload({clientUpdatedAt:"2026-10-04T00:00:00Z",writerSession:{topic:"云端原稿"},blocks:[],edges:[]});
beforeAll(async()=>{
  const result = await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `
import React from 'react';import{createRoot}from'react-dom/client';import{QueryClient,QueryClientProvider}from'@tanstack/react-query';import{httpBatchLink}from'@trpc/client';import superjson from'superjson';import{trpc}from'@/lib/trpc';import OmniCanvas from'@/pages/OmniCanvas';
const cloud=${JSON.stringify(cloud)};window.writes=[];window.reads=[];window.resolved=false;
const interval=window.setInterval.bind(window);window.setInterval=(fn,ms,...args)=>interval(fn,ms===5000?80:ms,...args);
URL.createObjectURL=blob=>{window.exportedBlob=blob;return 'blob:test'};URL.revokeObjectURL=()=>{};document.addEventListener('click',e=>{if(e.target.tagName==='A'&&e.target.download)e.preventDefault()});
globalThis.fetch=async(url,init)=>{if(init?.method==='PUT')return new Response('',{status:200});const names=String(url).split('/api/trpc/')[1]?.split('?')[0].split(',')||[];const request=JSON.parse(String(init?.body||'{}'));
return new Response(JSON.stringify(names.map((name,i)=>{window.reads.push(name);let data=null;const error=code=>({error:{json:{message:'test '+code,code:-32009,data:{code,httpStatus:code==='CONFLICT'?409:503,path:name}}}});
if(name==='manhuaCloudDraft.get'){if(window.testMode==='offline')return error('SERVICE_UNAVAILABLE');data={draft:cloud,generation:window.resolved?'20':'10',serverUpdatedAt:cloud.clientUpdatedAt};}
if(name==='manhuaCloudDraft.prepareDirectUpload')data=window.testMode==='fallback'?null:{uploadUrl:'https://storage.googleapis.com/test/stage',uploadId:'22222222-2222-4222-8222-222222222222'};
if(name==='manhuaCloudDraft.commitDirectUpload'||name==='manhuaCloudDraft.upsert'){window.writes.push({name,input:request[String(i)]?.json});if(!window.resolved)return error('CONFLICT');data={ok:true,generation:'21'};}
if(name==='stripe.getSubscription')data={plan:'free'};return{result:{data:{json:data}}};})),{headers:{'content-type':'application/json'}});};
const q=new QueryClient({defaultOptions:{queries:{retry:false}}});const c=trpc.createClient({links:[httpBatchLink({url:'/api/trpc',transformer:superjson})]});createRoot(document.getElementById('root')).render(<trpc.Provider client={c} queryClient={q}><QueryClientProvider client={q}><OmniCanvas/></QueryClientProvider></trpc.Provider>);
`,
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      alias: {
        "@": path.resolve("client/src"),
        "@shared": path.resolve("shared"),
      },
      plugins: [
        {
          name: "auth",
          setup(b) {
            b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
              path: "auth",
              namespace: "offline",
            }));
            b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
              loader: "js",
              contents:
                'export const useAuth=()=>({user:{id:1,role:"admin"},loading:false,isAuthenticated:true,logout:()=>{}});',
            }));
          },
        },
      ],
      loader: {
        ".png": "dataurl",
        ".svg": "dataurl",
        ".jpg": "dataurl",
        ".css": "text",
      },
      define: {
        "process.env.NODE_ENV": '"production"',
        "import.meta.env": "__ENV__",
      },
      banner: {
        js: 'var __ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};',
      },
      logLevel: "silent",
    });
  bundle=result.outputFiles[0].text;
  browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
},180000);
afterAll(async()=>{await browser?.close();});
it.each(["offline","direct","fallback","opening"])("新增云稿保护实际页面：%s",async(mode)=>{
  const page=await browser.newPage(); const errors:string[]=[];
  page.on("pageerror",e=>errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request",r=>void r.respond({status:200,contentType:"text/html",body:'<div id="root"></div>'}));
  try {
    await page.goto("http://localhost:41859/canvas?project=11111111-1111-4111-8111-111111111111&owner=1");
    await page.evaluate(({mode,prefix})=>{
      localStorage.clear();
      (window as any).testMode=mode;
      if(mode==="offline"||mode==="opening"){
        localStorage.setItem(prefix+"mv-manhua-writer-session-v1",mode==="offline"?'{broken precious source':JSON.stringify({format:"mv-manhua-writer-session-v1",topic:"本机未同步原稿"}));
        localStorage.setItem(prefix+"novel-origin-v1",'{"imports":[{"requestId":"source-original"}]}');
        localStorage.setItem(prefix+"mv-manhua-cloud-draft-local-at-v1","2026-10-03T00:00:00Z");
        localStorage.setItem(prefix+"mv-manhua-cloud-draft-base-generation-v1","5");
      }
    },{mode,prefix});
    await page.addScriptTag({content:bundle});
    if(mode==="offline"){
      await page.waitForSelector('[data-testid="manhua-local-recovery"]');
      expect(await page.evaluate(()=>document.querySelectorAll('textarea,[contenteditable=true]').length)).toBe(0);
      await page.click('[data-testid="manhua-local-recovery"] summary');
      await page.click('[data-testid="manhua-local-export"]');
      const recovery=await page.evaluate(async()=>JSON.parse(await (window as any).exportedBlob.text()));
      expect(recovery.raw['mv-manhua-writer-session-v1']).toBe('{broken precious source');
      expect(recovery.raw['novel-origin-v1']).toContain('source-original');
      expect(await page.evaluate(()=>window.writes.length)).toBe(0);
      expect(await page.evaluate(prefix=>localStorage.getItem(prefix+'mv-manhua-writer-session-v1'),prefix)).toBe('{broken precious source');
      await page.evaluate(()=>{(window as any).testMode='direct';window.confirm=()=>false;});
      await page.click('[data-testid="manhua-cloud-retry"]');
      await page.waitForSelector('[data-testid="manhua-confirm-recovery"]');
      expect(await page.evaluate(prefix=>localStorage.getItem(prefix+'mv-manhua-writer-session-v1'),prefix)).toBe('{broken precious source');
      expect(await page.evaluate(()=>window.writes.length)).toBe(0);
      await page.click('[data-testid="manhua-confirm-recovery"]');
      expect(await page.$('[data-testid="manhua-confirm-recovery"]')).not.toBeNull();
      await page.evaluate(()=>{window.confirm=()=>true;});
      await page.click('[data-testid="manhua-confirm-recovery"]');
      await page.waitForFunction(prefix=>JSON.parse(localStorage.getItem(prefix+'mv-manhua-writer-session-v1')!).topic==='云端原稿',{},prefix);

    } else {
      await page.waitForSelector('[data-testid="manhua-cloud-conflict"]');
      const count=await page.evaluate(()=>window.writes.length);
      expect(count).toBe(mode==="opening"?0:1);
      await new Promise(resolve=>setTimeout(resolve,350));
      expect(await page.evaluate(()=>window.writes.length)).toBe(count);
      if(mode!=="opening"){
        const written=await page.evaluate(()=>(window.writes as any[])[0]);
        expect(written.input.expectedGeneration).toBe('10');
        expect(written.name).toBe(mode==='direct'?'manhuaCloudDraft.commitDirectUpload':'manhuaCloudDraft.upsert');
        if(mode==='direct')expect(written.input.uploadId).toBe('22222222-2222-4222-8222-222222222222');
      } else {
        expect(await page.evaluate(prefix=>JSON.parse(localStorage.getItem(prefix+'mv-manhua-writer-session-v1')!).topic,prefix)).toBe('本机未同步原稿');
      }
      if(mode==='direct'){
        await page.evaluate(()=>{(window as any).resolved=true;window.confirm=()=>false;});
        await page.click('[data-testid="manhua-conflict-restore"]');
        await new Promise(resolve=>setTimeout(resolve,250));
        expect(await page.$('[data-testid="manhua-cloud-conflict"]')).not.toBeNull();
        await page.evaluate(()=>{window.confirm=()=>true;});
        await page.click('[data-testid="manhua-conflict-restore"]');
        await page.waitForFunction(()=>!(document.querySelector('[data-testid="manhua-cloud-conflict"]')));
        await page.waitForFunction(()=>window.writes.length>1);
        expect(await page.evaluate(()=>(window.writes as any[])[1].input.expectedGeneration)).toBe('20');
      }
    }
    expect(errors).toEqual([]);
  }finally{await page.close();}
},60000);
