/** 复用真实 OmniCanvas 夹具，验证独立 MV 进入、保存、刷新、云恢复与切换。 */
import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";

it("真实MV工作区直接打开音乐步骤，保存/切换/云端恢复保持作品类型且无媒体提交", async () => {
  const fixturePath = path.resolve("client/src/lib/manhuaFinalLayout.fixture.tsx");
  const network = `
    const originalFetch=window.fetch;
    window.__cloudWrites=[]; window.__musicRequests=[];
    window.fetch=async(input,init)=>{
      const url=String(typeof input==='string'?input:input.url||input);
      if(!url.includes('/api/trpc/'))return originalFetch(input,init);
      const parsed=new URL(url,location.origin),names=decodeURIComponent(parsed.pathname.split('/api/trpc/')[1]).split(',');
      const inputs=JSON.parse(init?.body||parsed.searchParams.get('input')||'{}');
      return new Response(JSON.stringify(names.map((name,index)=>{
        let value=null;
        if(name==='mvAnalysis.queueManhuaBgm'){window.__musicRequests.push(inputs[index].json);return {error:{json:{message:'离线夹具：已捕获请求，不生产媒体',code:-32600,data:{code:'BAD_REQUEST',httpStatus:400}}}};}
        if(name==='mvAnalysis.getManhuaBgmJob')value={status:'failed',error:'离线夹具不建单',variants:[]};
        if(name==='manhuaCloudDraft.get')value={draft:window.__remoteDraft||null,generation:window.__remoteDraft?'22':'0',serverUpdatedAt:new Date().toISOString()};
        if(name==='manhuaCloudDraft.upsert'){window.__cloudWrites.push(inputs[index].json);value={generation:String(30+window.__cloudWrites.length)};}
        return {result:{data:{json:value}}};
      })),{headers:{'content-type':'application/json'}});
    };
  `;
  const built=await build({entryPoints:[fixturePath],bundle:true,write:false,format:"iife",platform:"browser",jsx:"automatic",alias:{"@":path.resolve("client/src"),"@shared":path.resolve("shared"),"@/components/canvas/FreeformCanvas":path.resolve("client/src/lib/__browserfixtures__/freeformCanvasProbe.tsx")},plugins:[{name:"offline-entry",setup(b){
    b.onLoad({filter:/manhuaFinalLayout\.fixture\.tsx$/},()=>({contents:readFileSync(fixturePath,"utf8").replace('createRoot(document.getElementById("root")!).render(',network+'\ncreateRoot(document.getElementById("root")!).render('),loader:"tsx",resolveDir:path.dirname(fixturePath)}));
    b.onResolve({filter:/^@\/_core\/hooks\/useAuth$/},()=>({path:"auth",namespace:"fixture"}));
    b.onLoad({filter:/.*/,namespace:"fixture"},()=>({contents:'export const useAuth=()=>({user:{id:1,role:"admin"},loading:false,isAuthenticated:true,logout:()=>{}});',loader:"js"}));
  }}],loader:{".png":"dataurl",".svg":"dataurl",".jpg":"dataurl",".css":"text"},define:{"process.env.NODE_ENV":'"production"',"import.meta.env":"__VITE_ENV__"},banner:{js:'var __VITE_ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};'},logLevel:"silent"});
  const seed=await build({stdin:{resolveDir:process.cwd(),loader:"ts",contents:`
    import{createEmptyManhuaProject}from'./client/src/lib/novelFactoryProject';import{parseManhuaProjectScope,scopedManhuaStorage}from'./shared/manhuaProjectScope';import{buildManhuaCloudDraftPayload}from'./shared/manhuaCloudDraft';
    window.seedMv=title=>createEmptyManhuaProject(localStorage,'1',title,'mv');
    window.readMv=href=>{const scope=parseManhuaProjectScope(href.slice(href.indexOf('?'))),store=scopedManhuaStorage(localStorage,scope);return {writer:JSON.parse(store.getItem('mv-manhua-writer-session-v1')),canvas:JSON.parse(store.getItem('mv-freeform-canvas-v1'))}};
    window.makeCloudMv=href=>{const row=window.readMv(href);const payload=buildManhuaCloudDraftPayload({writerSession:row.writer,blocks:row.canvas.blocks,edges:[],clientUpdatedAt:new Date().toISOString()});const scope=parseManhuaProjectScope(href.slice(href.indexOf('?')));scopedManhuaStorage(localStorage,scope).clear();return payload};
  `},bundle:true,write:false,format:"iife",platform:"browser"});
  const css=readdirSync("client/dist/assets").filter(f=>f.endsWith('.css')).map(f=>readFileSync('client/dist/assets/'+f,'utf8')).join('\n');
  const browser=await puppeteer.launch({headless:true,args:["--no-sandbox"]});
  const evidence=process.env.PROJECT_UI_EVIDENCE;if(evidence)mkdirSync(evidence,{recursive:true});
  try{
    const page=await browser.newPage(),errors:string[]=[];page.setDefaultTimeout(15_000);
    page.on('pageerror',e=>errors.push(String(e)));
    await page.setViewport({width:1440,height:1000});
    await page.setRequestInterception(true);page.on('request',r=>void(r.isNavigationRequest()?r.respond({status:200,contentType:'text/html',body:`<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style><div id="root"></div>`}):r.abort()));
    await page.goto('http://localhost:41929/blank');
    await page.evaluate(()=>{localStorage.setItem('mv-manhua-writer-session-v1','{"topic":"原稿保留"}');localStorage.setItem('mv-freeform-canvas-v1','原画布保留');});
    await page.addScriptTag({content:seed.outputFiles[0].text});
    const hrefs=await page.evaluate(()=>[(window as any).seedMv('晚星'),(window as any).seedMv('南风')]);
    const open=async(href:string,remote?:unknown)=>{
      await page.goto('http://localhost:41929'+href);if(remote)await page.evaluate(payload=>(window as any).__remoteDraft=payload,remote);
      await page.addScriptTag({content:built.outputFiles[0].text});
      await page.waitForSelector('[data-mv-workflow-header]').catch(async e=>{console.error('MV_OPEN_FAILED',href,await page.evaluate(()=>document.body.innerText),errors);throw e;});await page.waitForSelector('[data-mv-studio]');expect(await page.$$('[data-mv-studio]')).toHaveLength(1);
    };
    await open(hrefs[0]);
    expect(await page.$eval('[aria-label="MV音乐类型"]',e=>(e as HTMLSelectElement).value)).toBe('song');
    expect(await page.$eval('[aria-label="排除风格"]',e=>(e as HTMLInputElement).value)).toBe('');
    await page.select('[aria-label="MV音乐类型"]','instrumental');
    expect(await page.$eval('[aria-label="排除风格"]',e=>(e as HTMLInputElement).value)).toContain('vocals');
    await page.select('[aria-label="MV音乐类型"]','song');
    expect(await page.$eval('[aria-label="排除风格"]',e=>(e as HTMLInputElement).value)).toBe('');
    expect(await page.$eval('[data-mv-workflow-header] h1',e=>e.textContent)).toBe('晚星');
    expect(await page.$eval('[aria-label="MV交付类型"]',e=>(e as HTMLSelectElement).value)).toBe('song');
    expect(await page.$$('[data-mv-step="concept"]')).toHaveLength(0);
    expect(await page.$$eval('[aria-label="MV 制作步骤"] button',els=>els.map(e=>e.textContent?.trim()))).toEqual(['1. 歌词与歌曲','2. 歌曲与封面']);
    expect(await page.evaluate(()=>document.body.innerText)).toContain('正方形1:1');
    expect(await page.$eval('[data-mv-studio]',e=>e.textContent)).not.toMatch(/gemini|glm|astra|suno|flare|ttapi|evolink|wavespeed/i);
    if(evidence)await page.screenshot({path:`${evidence}/歌曲与封面-1440.png`,fullPage:true});
    await page.select('[aria-label="MV交付类型"]','highlight');
    expect(await page.$$('[aria-label="高光区间"]')).toHaveLength(1);
    expect(await page.$eval('[data-mv-studio]',e=>e.textContent)).not.toMatch(/gemini|glm|astra|suno|flare|ttapi|evolink|wavespeed/i);
    expect(await page.$$eval('[aria-label="MV 制作步骤"] button',els=>els.map(e=>e.textContent?.trim()))).toEqual(['1. 选定歌曲','2. 视觉方案','3. 确认分镜','4. 制作镜头','5. 剪辑','6. 合成成片']);
    await page.type('[placeholder="MV 画面创意、主角与场景、节奏安排"]','雨夜行走，副歌转向明亮海岸');
    await page.$eval('[data-mv-workflow-header] button',e=>(e as HTMLButtonElement).click());
    await page.waitForFunction(()=>(window as any).__cloudWrites.length>0);
    const saved=await page.evaluate(()=>JSON.parse((window as any).__cloudWrites.at(-1).payloadJson));
    expect(saved.canvas.blocks[0].musicMv.deliveryMode).toBe('highlight');
    expect(saved.writerSession.workspaceKind).toBe('mv');expect(saved.canvas.blocks[0].kind).toBe('music');expect(saved.canvas.blocks[0].musicMv.creativePrompt).toBe('雨夜行走，副歌转向明亮海岸');
    expect(await page.evaluate(()=>(window as any).__posts)).toEqual([]);
    if(evidence)await page.screenshot({path:`${evidence}/MV工作区-1440.png`,fullPage:true});
    await page.$eval('[data-mv-workflow-header] a',e=>(e as HTMLAnchorElement).click());await page.waitForFunction(()=>location.pathname==='/mv-projects');
    await open(hrefs[1]);expect(await page.$eval('[data-mv-workflow-header] h1',e=>e.textContent)).toBe('南风');
    await open(hrefs[0]);expect(await page.$eval('[data-mv-workflow-header] h1',e=>e.textContent)).toBe('晚星');
    await page.addScriptTag({content:seed.outputFiles[0].text});
    const remote=await page.evaluate(href=>(window as any).makeCloudMv(href),hrefs[1]);
    await open(hrefs[1],remote);expect(await page.$eval('[data-mv-workflow-header] h1',e=>e.textContent)).toBe('南风');
    await page.setViewport({width:390,height:844});
    expect(await page.$eval('[data-mv-studio]',e=>e.getBoundingClientRect().width)).toBeGreaterThan(300);
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    if(evidence)await page.screenshot({path:`${evidence}/MV工作区-390.png`,fullPage:true});
    await page.addScriptTag({content:seed.outputFiles[0].text});
    expect((await page.evaluate(href=>(window as any).readMv(href),hrefs[1])).writer.workspaceKind).toBe('mv');
    expect(await page.evaluate(()=>[localStorage.getItem('mv-manhua-writer-session-v1'),localStorage.getItem('mv-freeform-canvas-v1')])).toEqual(['{"topic":"原稿保留"}','原画布保留']);
    expect(await page.evaluate(()=>(window as any).__posts)).toEqual([]);
    await page.type('[aria-label="音乐风格与编曲"]','中文流行，温暖自然的男声主唱');
    await page.type('[aria-label="歌曲歌词或段落结构"]','[Verse]\n风吹过熟悉的街角');
    await page.evaluate(()=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent?.includes('生成音乐与封面'))?.click());
    await page.waitForFunction(()=>(window as any).__musicRequests.length===1);
    const submitted=await page.evaluate(()=>(window as any).__musicRequests[0]);
    expect(submitted.brief).toMatchObject({instrumental:false,prompt:'[Verse]\n风吹过熟悉的街角',negative_tags:''});
    expect(submitted.brief.style).toContain('男声主唱');
    expect(errors).toEqual([]);
  }finally{await browser.close();}
},60_000);
