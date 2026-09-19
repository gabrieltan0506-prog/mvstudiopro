/** 真实 OmniCanvas + Workbench 四抽屉与当前集合成入口。
 * 所有网络由离线夹具截获；证明请求范围及恢复，不代表线上计费验收。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let bundle: string;
const evidenceDir = join(tmpdir(), "mvs-edit-drawers-probe");

beforeAll(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  const result = await build({
    plugins: [{name:"probe-callback-stages",setup(build){build.onLoad({filter:/pages\/OmniCanvas\.tsx$/},args=>({loader:"tsx",contents:readFileSync(args.path,"utf8").replace("onGenerateCurrentVersion={(episodeIndex) => {", "onGenerateCurrentVersion={(episodeIndex) => { console.log(\"probe:current-version\", episodeIndex);").replace("const ready = clips.filter((c) => c.clipUrl);", "console.log(\"probe:assemble-enter\", JSON.stringify(clips)); const ready = clips.filter((c) => c.clipUrl);")}));}}],
    entryPoints: ["client/src/lib/manhuaEditDrawers.fixture.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@": `${process.cwd()}/client/src`,
      "@shared": `${process.cwd()}/shared`,
      "@/components/canvas/FreeformCanvas": `${process.cwd()}/client/src/lib/__browserfixtures__/freeformCanvasProbe.tsx`,
      "@/components/ManhuaScriptWorkbench": `${process.cwd()}/client/src/lib/__browserfixtures__/manhuaWorkbenchProbe.tsx`,
    },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".css": "text" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "__VITE_ENV__" },
    banner: { js: 'var __VITE_ENV__ = {DEV:false,PROD:true,MODE:"production",SSR:false};' },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
}, 180_000);

afterAll(async () => {
  if (!browser) return;
  const ownedProcess = browser.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = await Promise.race([
    browser.close().then(() => true),
    new Promise<false>(resolve => { timer = setTimeout(() => resolve(false), 5000); }),
  ]);
  if (timer) clearTimeout(timer);
  if (!closed) {
    // 仅清理本夹具启动的独立 headless 子进程，绝不查找或终止用户 Chrome。
    console.warn("离线夹具 browser.close 超时，清理本夹具持有的 headless 子进程");
    if (!ownedProcess) throw new Error("独立 headless 进程句柄缺失，不能安全清理");
    const exited = new Promise<void>((resolve, reject) => {
      if (ownedProcess.exitCode !== null || ownedProcess.signalCode !== null) return resolve();
      const deadline = setTimeout(() => reject(new Error(`夹具进程 ${ownedProcess.pid} 清理后仍未退出`)), 5000);
      ownedProcess.once("exit", () => { clearTimeout(deadline); resolve(); });
    });
    ownedProcess.kill("SIGKILL");
    browser.disconnect();
    await exited;
    console.warn(`已核本夹具 headless PID ${ownedProcess.pid} 退出`);
  }
});

/** 每个用例一个全新 BrowserContext：localStorage 隔离，第二条不沿用第一条的状态 */
async function mount(first = false, both = false): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setRequestInterception(true);
  p.on("request", (req) =>
    req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
  );
  await p.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.setContent("<div id=root></div>");
  await p.evaluate(({first,both}) => { (window as any).__firstShot = first; localStorage.setItem("mv.openaiImageVariant",both?"both":"flare"); }, {first,both});
  await p.evaluate(()=>{(window as any).__stale=true;});
  await p.evaluate(bundle);
  await p.waitForFunction(() => /进入引导式漫剧/.test(document.body.innerText), { timeout: 30_000 });
  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find(
      (e) => /进入引导式漫剧/.test(e.textContent || "") && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await p.waitForFunction(
    () => Boolean((window as never as { __ffcProps?: unknown }).__ffcProps),
    { timeout: 30_000 },
  );
  return { page: p, close: async () => { await ctx.close().catch(() => {}); } };
}



it('真实四抽屉裁切进入当前版本合成与持久化，旧版本保留',async()=>{
 const {page,close}=await mount();const errors:string[]=[];const consoles:string[]=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>consoles.push(e.text()));
 try{
 await page.setViewport({width:1280,height:900});
 const cssDir=process.env.MANHUA_LAYOUT_CSS_DIR;
 if(cssDir)for(const file of readdirSync(cssDir).filter(n=>n.endsWith('.css')))await page.addStyleTag({content:readFileSync(join(cssDir,file),'utf8')});
 await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('edit'));
 await page.waitForSelector('[data-manhua-edit-generate-current]');
 expect(await page.$$('[data-manhua-edit-drawer]')).toHaveLength(4);
 const old=await page.evaluate(()=>(window as any).__ffcProps.blocks.find((b:any)=>b.id==='final-e01').outputUrl);
 await page.$eval('[data-manhua-edit-section="fine-cut"]',el=>{const label=Array.from(el.querySelectorAll('label')).find(e=>e.textContent?.includes('入点'))!;(Array.from(label.querySelectorAll('button')).find(e=>e.textContent?.trim()==='+') as HTMLButtonElement).click();});
 await page.waitForFunction(()=>(window as any).__ffcProps.blocks.some((b:any)=>b.manhuaEditTrim?.inSec===0.5 || b.manhuaEditTrim?.shotPieces?.some((p:any)=>p.trimInSec===0.5)));
 await page.click('[data-manhua-edit-drawer-toggle="effects"]');expect(await page.$eval('[data-manhua-edit-drawer="effects"]',e=>e.textContent)).toContain('尚未接通');
 await page.click('[data-manhua-edit-drawer-toggle="subtitles"]');expect(await page.$eval('[data-manhua-edit-drawer="subtitles"]',e=>e.textContent)).toContain('默认使用淡化');
 await page.click('[data-manhua-edit-drawer-toggle="export"]');
 await page.$eval('[data-manhua-edit-generate-current]',el=>el.scrollIntoView({block:'center'}));
 const pointer=await page.$eval('[data-manhua-edit-generate-current]',el=>{const r=el.getBoundingClientRect();return {rect:{x:r.x,y:r.y,width:r.width,height:r.height},hit:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.outerHTML};});
 writeFileSync(join(evidenceDir,'pointer.json'),JSON.stringify(pointer,null,2));
 expect(pointer.hit).toContain('data-manhua-edit-generate-current');
 await page.click('[data-manhua-edit-generate-current]');
 await page.waitForFunction(()=>(window as any).__posts.length===1,{timeout:30000});
 await page.waitForFunction((old)=>(window as any).__ffcProps.blocks.find((b:any)=>b.id==='final-e01').outputUrl!==old,{timeout:30000},old);
 const receipt=await page.evaluate(()=>({posts:(window as any).__posts,blocks:(window as any).__ffcProps.blocks,storage:Object.fromEntries(Object.entries(localStorage))}));
 writeFileSync(join(evidenceDir,'receipt.json'),JSON.stringify(receipt,null,2));
 expect(receipt.posts).toHaveLength(1);
 const input=receipt.posts[0].body.input;
 expect(input.action).toBe('manhua_assemble_final');
 expect(input.params.clips).toHaveLength(3);
 expect(input.params.clips.every((c:any)=>c.episodeIndex===1)).toBe(true);
 expect(input.params.clips.some((c:any)=>c.shotPieces?.some((p:any)=>p.trimInSec===0.5))).toBe(true);
 expect(input.params.transition).toBe('fade');
 const final=receipt.blocks.find((b:any)=>b.id==='final-e01');expect(final.outputUrls).toContain(old);expect(final.manhuaFinalVersions.some((v:any)=>v.url===final.outputUrl && v.sourceKey)).toBe(true);
 expect(JSON.stringify(receipt.storage)).toContain(final.outputUrl);
 let reopened=false;
 for(const button of await page.$$('button')){if(await button.evaluate(el=>el.textContent?.trim()==='剧本工作室' && el.checkVisibility())){await button.click();reopened=true;break;}}
 expect(reopened).toBe(true);
 await page.waitForSelector('[data-manhua-edit-generate-current]');
 expect(await page.evaluate(()=>(window as any).__wbProps.finalCutVerified)).toBe(true);
 await page.$eval('[data-manhua-edit-section="fine-cut"]',el=>{const label=Array.from(el.querySelectorAll('label')).find(e=>e.textContent?.includes('入点'))!;(Array.from(label.querySelectorAll('button')).find(e=>e.textContent?.trim()==='+') as HTMLButtonElement).click();});
 await page.waitForFunction(()=>(window as any).__wbProps.finalCutStale===true);
 expect(errors).toEqual([]);
 for(const width of [1280,390]){
  await page.setViewport({width,height:900});
  for(const button of await page.$$('[data-manhua-edit-drawer-toggle]')){if(await button.evaluate(e=>e.getAttribute('aria-expanded')==='true')){await button.click();break;}}
  await page.$eval('[data-manhua-panel="edit-multitrack"]',e=>e.scrollTop=0);
  await page.screenshot({path:join(evidenceDir,'drawers-'+width+'.png')});
  const geom=await page.$eval('[data-manhua-panel="edit-multitrack"]',e=>({width:e.clientWidth,scroll:e.scrollWidth}));
  expect(geom.scroll).toBeLessThanOrEqual(geom.width+1);
 }
 await page.evaluate(()=>(window as any).__assembleFailure=true);
 await page.$eval('[data-manhua-edit-generate-current]',el=>el.scrollIntoView({block:'center'}));
 await page.click('[data-manhua-edit-generate-current]');
 await page.waitForFunction(()=>(window as any).__posts.length===2 && (window as any).__toastHistory().some((t:any)=>t.title==='offline-render-failure'));
 expect(await page.evaluate(()=>(window as any).__ffcProps.blocks.find((b:any)=>b.id==='final-e01').outputUrl)).toBe(final.outputUrl);
 expect(await page.evaluate(()=>(window as any).__wbProps.finalCutStale)).toBe(true);
 writeFileSync(join(evidenceDir,'failure-preserved.json'),JSON.stringify(await page.evaluate(()=>({toasts:(window as any).__toastHistory(),posts:(window as any).__posts,final:(window as any).__ffcProps.blocks.find((b:any)=>b.id==='final-e01')})),null,2));
 }catch(error){writeFileSync(join(evidenceDir,'console.json'),JSON.stringify({errors,consoles},null,2));writeFileSync(join(evidenceDir,'failure.json'),JSON.stringify(await page.evaluate(()=>({toasts:(window as any).__toastHistory(),fetches:(window as any).__fetches,body:document.body.innerText,phase:(window as any).__wbProps?.workflowPhase,button:document.querySelector("[data-manhua-edit-generate-current]")?.outerHTML,posts:(window as any).__posts,blocks:(window as any).__ffcProps?.blocks})),null,2));throw error;}finally{await close();}
},120000);
