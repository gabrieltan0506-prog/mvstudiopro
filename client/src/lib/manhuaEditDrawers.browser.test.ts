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

it('沉浸顶栏只保留四个去处，创作顾问仍可从工具打开', async () => {
 const {page,close}=await mount();
 const errors:string[]=[];page.on('pageerror',error=>errors.push(String(error)));
 try {
  const labels=await page.$$eval('[aria-label="漫剧工厂工作区"] > button',buttons=>buttons.map(button=>button.textContent?.trim()));
  expect(labels).toEqual(['工作台','编剧','成片坞','自由画布']);
  const tools='[data-canvas-workspace-tools]';
  expect(await page.$eval(tools,el=>(el as HTMLDetailsElement).open)).toBe(false);
  await page.click(`${tools} > summary`);
  expect(await page.$eval(tools,el=>(el as HTMLDetailsElement).open)).toBe(true);
  expect(await page.$$('[data-manhua-advisor-open]')).toHaveLength(1);
  expect(await page.$eval(tools,el=>el.textContent)).not.toContain('切换模式');
  await page.click(`${tools} [data-manhua-advisor-open]`);
  await page.waitForFunction(()=>document.querySelector('[data-manhua-advisor-open]')?.getAttribute('aria-expanded')==='true');
  expect(errors).toEqual([]);
 } finally {await close();}
}, 120_000);



it('真实四抽屉裁切进入当前版本合成与持久化，旧版本保留',async()=>{
 const {page,close}=await mount();const errors:string[]=[];const consoles:string[]=[];page.on('pageerror',e=>errors.push(String(e)));page.on('console',e=>consoles.push(e.text()));
 try{
 await page.setViewport({width:1280,height:900});
 const cssDir=process.env.MANHUA_LAYOUT_CSS_DIR;
 if(cssDir)for(const file of readdirSync(cssDir).filter(n=>n.endsWith('.css')))await page.addStyleTag({content:readFileSync(join(cssDir,file),'utf8')});
 await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('edit'));
 await page.waitForSelector('[data-manhua-edit-generate-current]');
 const layout=await page.$eval('[data-manhua-panel="edit-multitrack"]',panel=>{
  const shell=document.querySelector<HTMLElement>('#manhua-workbench-shell')!;
  const timeline=panel.querySelector<HTMLElement>('[data-manhua-edit-timeline]')!;
  const nav=document.querySelector<HTMLElement>('[data-manhua-workspace-topbar]')!;
  const siteNav=document.querySelector<HTMLElement>('nav.fixed')!;
  const current=panel.querySelector<HTMLElement>('[data-manhua-edit-current-segment]')!;
  const primary=panel.querySelector<HTMLElement>('[data-manhua-edit-generate-current]')!;
  return {timelineTop:timeline.getBoundingClientRect().top,timelineBottom:timeline.getBoundingClientRect().bottom,currentTop:current.getBoundingClientRect().top,currentBottom:current.getBoundingClientRect().bottom,primaryBottom:primary.getBoundingClientRect().bottom,panelBottom:panel.getBoundingClientRect().bottom,viewportHeight:innerHeight,shellOverflow:shell.scrollHeight-shell.clientHeight,navText:nav.innerText,siteNavHeight:siteNav.getBoundingClientRect().height,siteNavText:siteNav.innerText};
 });
 expect(layout.navText).toContain('工作台');
 expect(layout.navText).toContain('编剧');
 expect(layout.navText).not.toContain('改题材');
 expect(layout.siteNavHeight).toBeLessThanOrEqual(50);
 expect(layout.siteNavText).not.toContain('平台创作');
 expect(layout.currentTop).toBeLessThan(layout.viewportHeight/2);
 expect(layout.currentBottom).toBeLessThan(layout.viewportHeight);
 expect(layout.timelineBottom).toBeLessThan(layout.viewportHeight);
 expect(layout.primaryBottom).toBeLessThan(layout.viewportHeight);
 expect(layout.panelBottom).toBeGreaterThan(layout.viewportHeight-110);
 expect(layout.shellOverflow).toBeLessThanOrEqual(2);
 await page.screenshot({path:join(evidenceDir,'workbench-edit-focused-1280.png')});
 const editStructure=await page.$eval('[data-manhua-panel="edit-multitrack"]',el=>Array.from(el.children).map(child=>child.getAttribute('data-manhua-edit-overview')!==null?'overview':child.getAttribute('data-manhua-edit-timeline')!==null?'timeline':child.getAttribute('data-manhua-edit-current-segment')!==null?'current':child.getAttribute('data-manhua-edit-tools')!==null?'tools':child.getAttribute('data-manhua-edit-full-tracks')!==null?'tracks':'other'));
 expect(editStructure.slice(0,5)).toEqual(['overview','current','timeline','tools','tracks']);
 const currentWorkArea=await page.$eval('[data-manhua-edit-current-segment]',el=>({height:el.getBoundingClientRect().height,visible:el.getBoundingClientRect().top<innerHeight}));
 expect(currentWorkArea.height).toBeGreaterThanOrEqual(280);
 expect(currentWorkArea.visible).toBe(true);
 await page.setViewport({width:1232,height:769});
 const compactScreen=await page.evaluate(()=>{
  const current=document.querySelector<HTMLElement>('[data-manhua-edit-current-segment]')!;
  const timeline=document.querySelector<HTMLElement>('[data-manhua-edit-timeline]')!;
  const primary=document.querySelector<HTMLElement>('[data-manhua-edit-generate-current]')!;
  return {currentTop:current.getBoundingClientRect().top,currentBottom:current.getBoundingClientRect().bottom,timelineBottom:timeline.getBoundingClientRect().bottom,primaryBottom:primary.getBoundingClientRect().bottom,viewport:innerHeight};
 });
 expect(compactScreen.currentTop).toBeLessThan(compactScreen.viewport/2);
 expect(compactScreen.currentBottom).toBeLessThan(compactScreen.viewport);
 expect(compactScreen.timelineBottom).toBeLessThan(compactScreen.viewport);
 expect(compactScreen.primaryBottom).toBeLessThan(compactScreen.viewport);
 await page.screenshot({path:join(evidenceDir,'workbench-edit-focused-1232x769.png')});
 await page.setViewport({width:1280,height:900});
 const segmentCards=await page.$$('[data-manhua-edit-segment-card]');
 expect(segmentCards.length).toBeGreaterThan(0);
 expect(segmentCards.length).toBeLessThan((await page.$$('[data-manhua-edit-clip-card]')).length);
 expect(await page.$$('[data-manhua-edit-timeline] [data-manhua-edit-clip-card]')).toHaveLength(0);
 await segmentCards[1]!.click();
 expect(await segmentCards[1]!.evaluate(el=>el.getAttribute('data-manhua-edit-segment-active'))).toBe('true');
 expect(await page.$eval('[data-manhua-edit-current-segment]',el=>el.textContent)).toContain('来源第 2 段');
 await page.click('[data-manhua-edit-drawer-toggle="cut"]');
 const clipCards=await page.$$('[data-manhua-edit-clip-card]');
 expect(clipCards.length).toBeGreaterThan(1);
 const secondShot=Number(await clipCards[1]!.evaluate(el=>el.getAttribute('data-manhua-edit-clip-card')));
 await clipCards[1]!.click();
 await page.waitForFunction(shot=>document.querySelector(`[data-manhua-edit-clip-card="${shot}"]`)?.getAttribute('data-manhua-edit-clip-active')==='true',{},secondShot);
 expect(await page.$eval('[data-manhua-edit-section="fine-cut"]',el=>el.textContent)).toContain(`镜 ${String(secondShot).padStart(2,'0')}`);
 expect(await page.$$('[data-manhua-edit-drawer]')).toHaveLength(4);
 const old=await page.evaluate(()=>(window as any).__ffcProps.blocks.find((b:any)=>b.id==='final-e01').outputUrl);
 const beforeTrim=await page.$eval('[data-manhua-edit-section="fine-cut"]',el=>{const label=Array.from(el.querySelectorAll('label')).find(e=>e.textContent?.includes('入点'))!;return Number(label.querySelector('span')?.textContent)});
 expect(Number.isFinite(beforeTrim)).toBe(true);
 await page.$eval('[data-manhua-edit-section="fine-cut"]',el=>{const label=Array.from(el.querySelectorAll('label')).find(e=>e.textContent?.includes('入点'))!;(Array.from(label.querySelectorAll('button')).find(e=>e.textContent?.trim()==='+') as HTMLButtonElement).click();});
 await page.waitForFunction(({shot,before})=>{const label=Array.from(document.querySelectorAll('[data-manhua-edit-section="fine-cut"] label')).find(e=>e.textContent?.includes('入点'));return Number(label?.querySelector('span')?.textContent)===before+0.5&&(window as any).__ffcProps.blocks.some((b:any)=>b.manhuaEditTrim?.shotPieces?.some((p:any)=>p.shotIndex===shot&&p.trimInSec>0));},{}, {shot:secondShot,before:beforeTrim});
 const savedTrim=await page.evaluate(shot=>(window as any).__ffcProps.blocks.flatMap((b:any)=>b.manhuaEditTrim?.shotPieces||[]).find((piece:any)=>piece.shotIndex===shot)?.trimInSec,secondShot);
 const originalOrder=await page.$$eval('[data-manhua-edit-clip-card]',rows=>rows.map(row=>Number(row.getAttribute('data-manhua-edit-clip-card'))));
 await page.click(`[aria-label="将第 ${originalOrder[0]} 镜下移"]`);
 await page.waitForFunction(([first,second])=>{const cards=Array.from(document.querySelectorAll('[data-manhua-edit-clip-card]'));return Number(cards[0]?.getAttribute('data-manhua-edit-clip-card'))===second&&Number(cards[1]?.getAttribute('data-manhua-edit-clip-card'))===first;},{},originalOrder.slice(0,2));
 const savedOrder=await page.evaluate(()=>(window as any).__ffcProps.blocks.flatMap((b:any)=>b.manhuaEditTrim?.shotPieces||[]).filter((p:any)=>p.timelineOrder!==undefined).sort((a:any,b:any)=>a.timelineOrder-b.timelineOrder).map((p:any)=>p.shotIndex));
 expect(savedOrder.slice(0,2)).toEqual([originalOrder[1],originalOrder[0]]);
 const firstSegmentShotCount=Number((await page.$eval('[data-manhua-edit-segment-card="1"]',el=>el.textContent))?.match(/(\d+) 镜/)?.[1]);
 expect(firstSegmentShotCount).toBeGreaterThan(1);
 const boundaryShot=originalOrder[firstSegmentShotCount-1]!;
 await page.click(`[aria-label="将第 ${boundaryShot} 镜下移"]`);
 await page.waitForFunction(() => document.querySelectorAll('[data-manhua-edit-segment-card]').length > 3);
 const sourceOrder=await page.$$eval('[data-manhua-edit-segment-card]',rows=>rows.map(row=>Number(row.getAttribute('data-manhua-edit-source-segment'))));
 expect(sourceOrder.slice(0,4)).toEqual([1,2,1,2]);
 await page.click('[data-manhua-edit-drawer-toggle="effects"]');
 expect(await page.$eval('[data-manhua-edit-drawer="effects"]',e=>e.textContent)).toContain('尚未接通');
 expect(await page.$$('[data-manhua-effect-preview] video')).toHaveLength(2);
 await page.$eval('[data-manhua-edit-drawer="effects"]',el=>el.scrollIntoView({block:'start'}));
 await page.screenshot({path:join(evidenceDir,'effects-compare-1280.png'),fullPage:false});
 await page.click('[data-manhua-edit-drawer-toggle="subtitles"]');expect(await page.$eval('[data-manhua-edit-drawer="subtitles"]',e=>e.textContent)).toContain('转场应用于本集片段之间');
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
 expect(input.params.clips.some((c:any)=>c.shotPieces?.some((p:any)=>p.shotIndex===secondShot&&p.trimInSec===savedTrim))).toBe(true);
 expect(input.params.transition).toBe('fade');
 const final=receipt.blocks.find((b:any)=>b.id==='final-e01');expect(final.outputUrls).toContain(old);expect(final.manhuaFinalVersions.some((v:any)=>v.url===final.outputUrl && v.sourceKey)).toBe(true);
 expect(JSON.stringify(receipt.storage)).toContain(final.outputUrl);
 let reopened=false;
 for(const button of await page.$$('button')){if(await button.evaluate(el=>el.textContent?.trim()==='工作台' && el.closest('[data-manhua-workspace-topbar]') && el.checkVisibility())){await button.click();reopened=true;break;}}
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

it('剪辑界面可读性：窄屏只滚动时间线，工具正文不少于14像素', async () => {
 const {page,close}=await mount();
 try {
  const cssDir=process.env.MANHUA_LAYOUT_CSS_DIR;
  if(!cssDir)throw Error('布局验收需要本次构建CSS');
  for(const file of readdirSync(cssDir).filter(n=>n.endsWith('.css')))await page.addStyleTag({content:readFileSync(join(cssDir,file),'utf8')});
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('edit'));
  await page.waitForSelector('[data-manhua-panel="edit-multitrack"]');
  for(const width of [1280,390]) {
   await page.setViewport({width,height:900});
   for(const drawer of ['cut','effects','subtitles','export']) {
    await page.evaluate(id=>{const b=document.querySelector(`[data-manhua-edit-drawer-toggle="${id}"]`) as HTMLButtonElement;if(b.getAttribute('aria-expanded')!=='true')b.click();},drawer);
    const layout=await page.evaluate(id=>{
     const panel=document.querySelector('[data-manhua-panel="edit-multitrack"]') as HTMLElement;
     const scroller=document.querySelector('[data-manhua-edit-timeline-scroll]') as HTMLElement;
     const content=document.querySelector(`[data-manhua-edit-drawer="${id}"]`) as HTMLElement;
     const labels=Array.from(content.querySelectorAll('p,label,button,input,select,summary')).filter(e=>(e as HTMLElement).offsetHeight>0&&(e.textContent?.trim()||e.matches('input,select')));
     return {panelWidth:panel.getBoundingClientRect().width,viewport:innerWidth,scroll:scroller.scrollWidth>scroller.clientWidth,fonts:labels.map(e=>parseFloat(getComputedStyle(e).fontSize))};
    },drawer);
    expect(layout.panelWidth).toBeLessThanOrEqual(width);
    expect(layout.fonts.length).toBeGreaterThan(0);
    expect(Math.min(...layout.fonts)).toBeGreaterThanOrEqual(14);
    if(width===390)expect(layout.scroll).toBe(true);
    await page.evaluate(id=>document.querySelector(`[data-manhua-edit-drawer="${id}"]`)?.scrollIntoView({block:"start"}),drawer);
    const reachable=await page.evaluate(id=>{
     const panel=document.querySelector('[data-manhua-panel="edit-multitrack"]') as HTMLElement;
     const drawerEl=document.querySelector(`[data-manhua-edit-drawer="${id}"]`) as HTMLElement;
     const control=drawerEl.querySelector('input,select,button') as HTMLElement | null;
     if(!control)return {visible:false,hit:false};
     control.scrollIntoView({block:'center'});
     const rect=control.getBoundingClientRect();
     const panelRect=panel.getBoundingClientRect();
     const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);
     return {visible:rect.top>=panelRect.top&&rect.bottom<=panelRect.bottom&&rect.bottom<=innerHeight,hit:hit===control||control.contains(hit)};
    },drawer);
    expect(reachable.visible,`${width}px ${drawer} 编辑控件被遮挡`).toBe(true);
    expect(reachable.hit,`${width}px ${drawer} 编辑控件无法点选`).toBe(true);
    await page.screenshot({path:join(evidenceDir,`readable-${width}-${drawer}.png`),fullPage:false});
   }
  }
 } finally {await close();}
},120000);

it('画面版本并排预览后采用另一版，旧版保留且质检失效', async () => {
 const {page,close}=await mount();
 try {
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('edit'));
  await page.waitForSelector('[data-manhua-edit-drawer-toggle="effects"]');
  await page.click('[data-manhua-edit-drawer-toggle="effects"]');
  await page.waitForSelector('[data-manhua-effect-adopt-version]');
  const urls=await page.$$eval('[data-manhua-effect-preview] video',videos=>videos.map(video=>video.getAttribute('src')));
  expect(urls).toHaveLength(2);
  expect(urls[0]).not.toBe(urls[1]);
  const clipId=await page.evaluate(url=>(window as any).__ffcProps.blocks.find((block:any)=>block.outputUrl===url)?.id,urls[0]);
  expect(clipId).toBeTruthy();
  await page.click('[data-manhua-effect-adopt-version]');
  await page.waitForFunction(({clipId,url})=>(window as any).__ffcProps.blocks.some((block:any)=>block.id===clipId&&block.outputUrl===url&&block.manhuaClipQuality==null),{}, {clipId,url:urls[1]});
  const stored=await page.evaluate(id=>(window as any).__ffcProps.blocks.find((block:any)=>block.id===id),clipId);
  expect(stored.outputUrls).toContain(urls[0]);
  expect(stored.outputUrls).toContain(urls[1]);
 } finally {await close();}
},120000);

it('正式工作流分镜的看图、编辑和主操作同屏', async () => {
 const {page,close}=await mount();
 try {
  await page.setViewport({width:1280,height:900});
  const cssDir=process.env.MANHUA_LAYOUT_CSS_DIR;
  if(cssDir)for(const file of readdirSync(cssDir).filter(n=>n.endsWith('.css')))await page.addStyleTag({content:readFileSync(join(cssDir,file),'utf8')});
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('storyboard'));
  await page.waitForSelector('[data-manhua-storyboard-workspace]');
  const result=await page.evaluate(()=>{
   const preview=document.querySelector<HTMLElement>('[data-manhua-shot-pair-preview]')!;
   const params=document.querySelector<HTMLElement>('[data-manhua-column="params"]')!;
   const action=params.querySelector<HTMLElement>('[data-manhua-action="generate-current-keyart"]')!;
   const editor=params.querySelector<HTMLElement>('[data-manhua-shot-description]')!;
   const nav=document.querySelector<HTMLElement>('[data-manhua-product-header] [data-manhua-workflow-rail]')!;
   const rect=(el:HTMLElement)=>el.getBoundingClientRect();
   const actionBox=rect(action), editorBox=rect(editor), previewBox=rect(preview), navBox=rect(nav);
   const hit=document.elementFromPoint(actionBox.left+actionBox.width/2,actionBox.top+actionBox.height/2);
   const shell=document.querySelector<HTMLElement>('#manhua-workbench-shell')!;
   return {previewTop:previewBox.top,previewBottom:previewBox.bottom,previewHeight:previewBox.height,actionBottom:actionBox.bottom,actionClickable:hit===action||action.contains(hit),editorBottom:editorBox.bottom,navBottom:navBox.bottom,shellOverflow:shell.scrollHeight-shell.clientHeight,phaseLinks:nav.querySelectorAll('[data-manhua-phase]').length,viewport:innerHeight};
  });
  expect(result.phaseLinks).toBe(5);
  expect(result.navBottom).toBeLessThan(result.previewTop);
  expect(result.previewHeight).toBeGreaterThan(320);
  expect(result.previewBottom).toBeLessThan(result.viewport);
  expect(result.actionBottom).toBeLessThan(result.viewport);
  expect(result.actionClickable).toBe(true);
  expect(result.editorBottom).toBeLessThan(result.viewport);
  expect(result.shellOverflow).toBeLessThanOrEqual(2);
  await page.screenshot({path:join(evidenceDir,'workbench-storyboard-focused-1280.png')});
  await page.setViewport({width:1232,height:769});
  const compact=await page.evaluate(()=>{
   const preview=document.querySelector<HTMLElement>('[data-manhua-shot-pair-preview]')!;
   const params=document.querySelector<HTMLElement>('[data-manhua-column="params"]')!;
   const action=params.querySelector<HTMLElement>('[data-manhua-action="generate-current-keyart"]')!;
   const editor=params.querySelector<HTMLElement>('[data-manhua-shot-description]')!;
   const final=document.querySelector<HTMLElement>('[data-manhua-product-header] [data-manhua-phase="final"]')!;
   const finalBox=final.getBoundingClientRect();
   const hit=document.elementFromPoint(finalBox.left+finalBox.width/2,finalBox.top+finalBox.height/2);
   return {previewBottom:preview.getBoundingClientRect().bottom,previewHeight:preview.getBoundingClientRect().height,actionBottom:action.getBoundingClientRect().bottom,editorBottom:editor.getBoundingClientRect().bottom,finalClickable:hit===final||final.contains(hit),finalBox:{left:finalBox.left,right:finalBox.right,top:finalBox.top,bottom:finalBox.bottom},hitText:hit?.textContent?.slice(0,80),hitTag:hit?.tagName,viewport:innerHeight};
  });
  await page.screenshot({path:join(evidenceDir,'workbench-storyboard-focused-1232x769.png')});
  expect(compact.previewHeight).toBeGreaterThan(260);
  expect(compact.previewBottom).toBeLessThan(compact.viewport);
  expect(compact.actionBottom).toBeLessThan(compact.viewport);
  expect(compact.editorBottom).toBeLessThan(compact.viewport);
  expect(compact.finalClickable,JSON.stringify(compact)).toBe(true);
  await page.setViewport({width:3840,height:900});
  const wide=await page.evaluate(()=>{
   const workspace=document.querySelector<HTMLElement>('[data-manhua-storyboard-workspace]')!;
   const preview=document.querySelector<HTMLElement>('[data-manhua-shot-pair-preview]')!;
   const params=document.querySelector<HTMLElement>('[data-manhua-column="params"]')!;
   const shell=document.querySelector<HTMLElement>('#manhua-workbench-shell')!;
   return {workspaceWidth:workspace.getBoundingClientRect().width,previewHeight:preview.getBoundingClientRect().height,paramsRight:params.getBoundingClientRect().right,shellOverflow:shell.scrollWidth-shell.clientWidth,viewport:innerWidth};
  });
  expect(wide.workspaceWidth).toBeGreaterThan(wide.viewport*0.9);
  expect(wide.previewHeight).toBeGreaterThan(320);
  expect(wide.paramsRight).toBeLessThan(wide.viewport);
  expect(wide.shellOverflow).toBeLessThanOrEqual(2);
  await page.screenshot({path:join(evidenceDir,'workbench-storyboard-focused-3840.png')});
 } finally {await close();}
},120000);

it('浏览器放大后分镜与成片编辑仍在可见视口', async () => {
 const {page,close}=await mount();
 const client=await page.createCDPSession();
 try {
  await page.setViewport({width:1232,height:648,deviceScaleFactor:2});
  const cssDir=process.env.MANHUA_LAYOUT_CSS_DIR;
  if(cssDir)for(const file of readdirSync(cssDir).filter(n=>n.endsWith('.css')))await page.addStyleTag({content:readFileSync(join(cssDir,file),'utf8')});
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('storyboard'));
  await page.waitForSelector('[data-manhua-storyboard-workspace]');
  await client.send('Emulation.setPageScaleFactor',{pageScaleFactor:1.167611});
  await page.waitForFunction(()=>Boolean(window.visualViewport && window.visualViewport.width < innerWidth-100));
  await page.waitForFunction(()=>document.querySelector<HTMLElement>('#manhua-workbench-shell')!.getBoundingClientRect().right <= window.visualViewport!.offsetLeft+window.visualViewport!.width);
  const result=await page.evaluate(()=>{
   const rect=(selector:string)=>document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
   const visibleRight=window.visualViewport!.offsetLeft+window.visualViewport!.width;
   const preview=rect('[data-manhua-shot-pair-preview]');
   const editor=rect('[data-manhua-column="params"] [data-manhua-shot-description]');
   const action=rect('[data-manhua-column="params"] [data-manhua-action="generate-current-keyart"]');
   const qc=document.querySelector<HTMLDetailsElement>('[data-manhua-clip-quality]')!;
   return {visibleRight,previewHeight:preview.height,previewRight:preview.right,editorRight:editor.right,actionRight:action.right,actionBottom:action.bottom,qcOpen:qc.open,scale:window.visualViewport!.scale};
  });
  expect(result.scale).toBeGreaterThan(1.1);
  expect(result.previewRight).toBeLessThan(result.visibleRight);
  expect(result.editorRight).toBeLessThan(result.visibleRight);
  expect(result.actionRight).toBeLessThan(result.visibleRight);
  expect(result.actionBottom).toBeLessThan(648);
  expect(result.previewHeight).toBeGreaterThan(210);
  expect(result.qcOpen).toBe(false);
  await page.screenshot({path:join(evidenceDir,'workbench-storyboard-zoomed-1232x648.png')});
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('edit'));
  await page.waitForSelector('[data-manhua-edit-current-segment]');
  const edit=await page.evaluate(()=>{
   const visibleRight=window.visualViewport!.offsetLeft+window.visualViewport!.width;
   const rect=(selector:string)=>document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
   return {visibleRight,segmentRight:rect('[data-manhua-edit-current-segment]').right,timelineRight:rect('[data-manhua-edit-timeline]').right,generateRight:rect('[data-manhua-edit-generate-current]').right,segmentCount:document.querySelectorAll('[data-manhua-edit-segment-card]').length};
  });
  expect(edit.segmentCount).toBeGreaterThan(0);
  expect(edit.segmentRight).toBeLessThan(edit.visibleRight);
  expect(edit.timelineRight).toBeLessThan(edit.visibleRight);
  expect(edit.generateRight).toBeLessThan(edit.visibleRight);
 } finally {
  await client.detach();
  await close();
 }
},120000);
