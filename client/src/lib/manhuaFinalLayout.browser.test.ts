/** 真实 OmniCanvas + Workbench 当前镜按钮交互，真实工厂与 runCanvasBlock。
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
const evidenceDir = join(tmpdir(), "mvs-final-layout-probe");

beforeAll(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  const result = await build({
    entryPoints: ["client/src/lib/manhuaFinalLayout.fixture.tsx"],
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
async function mount(first = false, both = false, mixedTiming = false): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setRequestInterception(true);
  p.on("request", (req) =>
    req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
  );
  await p.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.setContent("<div id=root></div>");
  await p.evaluate(({first,both,mixedTiming}) => { (window as any).__mixedTiming = mixedTiming; (window as any).__firstShot = first; localStorage.setItem("mv.openaiImageVariant",both?"both":"flare"); }, {first,both,mixedTiming});
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


it('真实终审三块、裁切回流、原Dock范围保留与未知失效',async()=>{
 const {page,close}=await mount(); const errors:string[]=[];page.on('pageerror',e=>errors.push(String(e)));
 try{
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('final'));
  await page.waitForSelector('#manhua-final-delivery-host [data-manhua-delivery-primary]').catch(async error=>{writeFileSync(join(evidenceDir,'mount-failure.json'),JSON.stringify(await page.evaluate(()=>({phase:(window as any).__wbProps.workflowPhase,host:document.getElementById('manhua-final-delivery-host')?.outerHTML,fallback:document.querySelector('[data-manhua-delivery-fallback]')?.outerHTML,body:document.body.innerText})),null,2));throw error;});
  expect(await page.$$('[data-manhua-final-section]')).toHaveLength(3);
  expect(await page.$$('[data-manhua-delivery-primary]')).toHaveLength(1);
  expect(await page.$eval('[data-manhua-final-ready]',e=>e.getAttribute('data-manhua-final-ready'))).toBe('0');
  expect(await page.$$eval('[data-manhua-final-stage-state]',nodes=>nodes.map(node=>node.getAttribute('data-manhua-final-stage-state')))).toEqual(['current','pending','pending','pending','pending']);
  expect(await page.$$eval('[data-manhua-final-timeline-state]',nodes=>nodes.map(node=>node.getAttribute('data-manhua-final-timeline-state')))).toEqual(['current','pending','pending','pending','pending']);
  expect(await page.$eval('[data-manhua-final-stage-line]',e=>e.textContent)).not.toContain('✓');
  expect(await page.$$eval('[data-manhua-final-stage-line] button',nodes=>nodes.slice(2).every(node=>(node as HTMLButtonElement).disabled))).toBe(true);
  expect(await page.$eval('[data-manhua-final-media-shots]',e=>e.textContent)).toMatch(/\d+\/\d+ 镜有成片/);
  expect(await page.$eval('[data-manhua-final-section="timeline"]',e=>e.textContent)).toContain('当前成片来源已核对');
  expect(await page.$$('[data-manhua-final-check-state="unknown"]')).not.toHaveLength(0);
  await page.select('[aria-label="交付包导出范围"]','selected');
  await page.click('[aria-label="交付第1集"]');
  const duration=await page.$eval('[data-manhua-review-shot="1"]',e=>Number(e.getAttribute('data-review-duration')));
  await page.click('[data-manhua-review-timeline] > summary');
  await page.click('[data-manhua-review-shot="1"]');
  await page.waitForSelector('[data-manhua-edit-section="fine-cut"]');
  await page.$eval('[data-manhua-edit-section="fine-cut"]',el=>{const label=Array.from(el.querySelectorAll('label')).find(e=>e.textContent?.includes('入点'))!;(Array.from(label.querySelectorAll('button')).find(e=>e.textContent?.trim()==='+') as HTMLButtonElement).click();});
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('final'));
  await page.waitForSelector('#manhua-final-delivery-host [data-manhua-delivery-primary]');
  expect(await page.$eval('[data-manhua-review-shot="1"]',e=>Number(e.getAttribute('data-review-duration')))).toBe(duration-0.5);
  expect(await page.$eval('[data-manhua-final-section="timeline"]',e=>e.textContent)).toContain('旧成片已失效');
  expect(await page.$eval('[aria-label="交付包导出范围"]',e=>(e as HTMLSelectElement).value)).toBe('selected');
  expect(await page.$eval('[aria-label="交付第1集"]',e=>(e as HTMLInputElement).checked)).toBe(true);
  const cssDir=process.env.MANHUA_LAYOUT_CSS_DIR;
  if(cssDir){for(const file of readdirSync(cssDir).filter(f=>f.endsWith('.css')))await page.addStyleTag({content:readFileSync(cssDir+'/'+file,'utf8')});}
  if(cssDir) { const videos=await page.evaluate(()=>Array.from(document.querySelectorAll("video")).map(video=>({src:video.src,visible:video.checkVisibility()})));writeFileSync(join(evidenceDir,"videos.json"),JSON.stringify(videos));expect(videos.filter(v=>v.visible)).toHaveLength(1); }
  expect(await page.$eval("[data-manhua-ashuo-step-title]",e=>e.textContent)).toBe("终审与交付");
  expect(await page.$eval("[data-manhua-action=ashuo-step-generate]",e=>e.textContent)).toBe("返回精剪");
  const geometry=[];
  for(const width of [3840,1280,390]){
   await page.setViewport({width,height:900});
   await page.$eval('[data-manhua-phase-panel="final"]',e=>e.scrollIntoView());
   const rects=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-manhua-final-dashboard],[data-manhua-final-section],[data-manhua-delivery-primary],[aria-label="交付包导出范围"]')).map(e=>{const r=e.getBoundingClientRect();return {tag:e.hasAttribute('data-manhua-final-dashboard')?'dashboard':e.getAttribute('data-manhua-final-section')||e.getAttribute('aria-label')||'delivery',x:r.x,width:r.width,height:r.height};}));geometry.push({width,rects});
   if(cssDir){expect(rects.every(r=>r.width>0&&r.x>=0&&r.x+r.width<=width+1)).toBe(true);expect(rects.filter(r=>r.tag==='delivery'||r.tag==='交付包导出范围').every(r=>r.height>=44)).toBe(true);}
   if(cssDir&&width===3840)expect(rects.find(r=>r.tag==='dashboard')!.width).toBeGreaterThan(width*0.9);
   await page.screenshot({path:join(evidenceDir,'final-layout-'+width+'.png'),fullPage:false});
   for(const section of ['quality','delivery']){await page.$eval('[data-manhua-final-section="'+section+'"]',e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:join(evidenceDir,'final-'+section+'-'+width+'.png'),fullPage:false});}
  }
  expect(await page.$eval('[aria-label="交付音轨格式"]',e=>(e as HTMLSelectElement).value)).toBe('m4a');
  await page.select('[aria-label="交付音轨格式"]','wav');
  await page.click('[data-manhua-delivery-primary]');
  await page.waitForFunction(()=>(window as any).__delivery.queue.length===1);
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('edit'));
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('final'));
  await page.waitForSelector('#manhua-final-delivery-host [data-manhua-delivery-primary]');
  await page.waitForFunction(()=>(window as any).__delivery.packs.length===1,{timeout:30000});
  let delivery=await page.evaluate(()=>(window as any).__delivery);
  expect(delivery.queue).toHaveLength(1);
  expect(delivery.queue[0]['0'].json.params.format).toBe('wav');
  expect(delivery.files[0].some((name:string)=>name.endsWith('音轨.wav'))).toBe(true);
  await page.waitForFunction(()=>!(document.querySelector('[data-manhua-delivery-primary]') as HTMLButtonElement)?.disabled);
  await page.select('[aria-label="交付音轨格式"]','m4a');
  expect(await page.$eval('[aria-label="交付音轨格式"]',e=>(e as HTMLSelectElement).value)).toBe('m4a');
  expect(delivery.packs[0].deliveryEpisodeIndexes).toEqual([1]);
  await page.click('[data-manhua-delivery-primary]');
  await page.waitForFunction(()=>(window as any).__delivery.packs.length===2,{timeout:30000});
  delivery=await page.evaluate(()=>(window as any).__delivery);
  expect(delivery.queue).toHaveLength(2);
  expect(delivery.queue[1]['0'].json.params.format).toBe('m4a');
  expect(delivery.files[1].some((name:string)=>name.endsWith('音轨.m4a'))).toBe(true);
  writeFileSync(join(evidenceDir,'delivery.json'),JSON.stringify(delivery,null,2));
  writeFileSync(join(evidenceDir,'receipt.json'),JSON.stringify({geometry,errors,posts:await page.evaluate(()=>(window as any).__posts)},null,2));
  expect(errors).toEqual([]);
 }finally{await close();}
},180000);

it('终审问题按剧本秒位定位指定段且不触发生成', async () => {
  const { page, close } = await mount();
  try {
    await page.evaluate(() => (window as any).__wbProps.onWorkflowPhaseChange('final'));
    await page.waitForSelector('[data-manhua-review-issue="2"]');
    expect(await page.$eval('[data-manhua-review-issue="2"]', element => element.textContent)).toContain('剧本时间');
    const before = await page.evaluate(() => JSON.stringify((window as any).__posts));
    await page.click('[data-manhua-review-issue="2"]');
    await page.waitForFunction(() => (window as any).__wbProps.workflowPhase === 'storyboard');
    await page.waitForSelector('[data-manhua-filmstrip-segment="2"][data-manhua-active="true"]');
    expect(await page.evaluate(() => JSON.stringify((window as any).__posts))).toBe(before);
    await page.evaluate(() => (window as any).__wbProps.onWorkflowPhaseChange('final'));
    await page.waitForSelector('[data-manhua-review-issue="2"]');
    expect(await page.$eval('[data-manhua-review-issue="2"]', element => element.textContent)).toContain('尚无可用成片');
  } finally { await close(); }
}, 180000);

it('终审优先显示问题且逐镜计划默认收起，展开不产生请求', async () => {
 const {page,close}=await mount();
 try {
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('final'));
  await page.waitForSelector('[data-manhua-final-issues]');
  const before=await page.evaluate(()=>JSON.stringify((window as any).__posts));
  expect(await page.$eval('[data-manhua-review-timeline]',e=>(e as HTMLDetailsElement).open)).toBe(false);
  expect(await page.$eval('[data-manhua-final-issues]',e=>Boolean(e.compareDocumentPosition(document.querySelector('[data-manhua-final-section="quality"]')!)&Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await page.click('[data-manhua-review-timeline] > summary');
  expect(await page.$eval('[data-manhua-review-timeline]',e=>(e as HTMLDetailsElement).open)).toBe(true);
  expect(await page.evaluate(()=>JSON.stringify((window as any).__posts))).toBe(before);
 }finally{await close();}
},180000);

it('终审新布局桌面与手机可读且无横向溢出',async()=>{
 const {page,close}=await mount();
 try {
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('final'));
  await page.waitForSelector('[data-manhua-final-issues]');
  const cssDir='client/dist/assets';
  for(const file of readdirSync(cssDir).filter(f=>f.endsWith('.css'))) await page.addStyleTag({content:readFileSync(cssDir+'/'+file,'utf8')});
  const rows=[];
  for(const width of [1280,390]) {
   await page.setViewport({width,height:900});
   await page.$eval('[data-manhua-final-issues]',e=>e.scrollIntoView({block:'start'}));
   const geometry=await page.evaluate(()=>Array.from(document.querySelectorAll('[data-manhua-final-section],[data-manhua-final-issues]')).map(e=>{const r=e.getBoundingClientRect();return {x:r.x,width:r.width};}));
   expect(geometry.every(r=>r.width>0&&r.x>=0&&r.x+r.width<=width+1)).toBe(true);
   rows.push({width,geometry});await page.screenshot({path:join(evidenceDir,`priority-${width}.png`)});
  }
  writeFileSync(join(evidenceDir,'priority-layout.json'),JSON.stringify(rows,null,2));
 }finally{await close();}
},60000);

it('真实镜长按钮同步原稿与新分段，旧产物保留且无生成',async()=>{
 const {page,close}=await mount();
 try {
  const timed='## 分镜表\n| 镜号 | 秒位 | 景别/运镜 | 画面 | 对白 |\n|---|---|---|---|---|\n| 1 | 0–4秒 | 中景横移 | 扶住同伴 | 沈砚舟：「慢点。」 |\n| 2 | 4–7秒 | 近景 | 点头 | 云疏冷：「快到了。」 |\n| 3 | 7–12秒 | 特写 | 看向门口 | 无 |';
  await page.evaluate(timed=>{
   const p=(window as any).__ffcProps;
   p.onBlocksChange(p.blocks.map((b:any)=>b.episodeIndex===1&&/^(reverse|beats)-/.test(b.id)?{...b,outputText:timed}:b));
   (window as any).__wbProps.onWorkflowPhaseChange('storyboard');
  },timed);
  await page.waitForSelector('[data-manhua-shot-timing]');
  const before=await page.evaluate(()=>({posts:JSON.stringify((window as any).__posts),media:(window as any).__ffcProps.blocks.filter((b:any)=>b.outputUrl).map((b:any)=>[b.id,b.outputUrl])}));
  await page.click('[data-manhua-shot-timing] summary');
  await page.$eval('[aria-label="当前镜头时长"]',el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'4.944');el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('[data-manhua-shot-timing] button');
  await page.waitForFunction(()=>JSON.parse(localStorage.getItem('mv-manhua-writer-session-v1')||'{}').writerPack?.episodes[0].body.includes('4.944'));
  const after=await page.evaluate(()=>({posts:JSON.stringify((window as any).__posts),media:(window as any).__ffcProps.blocks.filter((b:any)=>b.outputUrl).map((b:any)=>[b.id,b.outputUrl]),writer:JSON.parse(localStorage.getItem('mv-manhua-writer-session-v1')||'{}'),nodes:(window as any).__ffcProps.blocks.filter((b:any)=>b.episodeIndex===1&&/^(reverse|beats)-/.test(b.id)).map((b:any)=>b.outputText)}));
  expect(after.media).toEqual(before.media);expect(after.posts).toBe(before.posts);expect(after.writer.writerConfirmed).toBe(false);expect(after.writer.directorUnlocked).toBe(false);
  expect(after.nodes.every((s:string)=>s.includes('4.944–7.944秒'))).toBe(true);
  expect(after.writer.writerPack.episodes[0].body).toContain('7.944–12.944秒');
 }finally{await close();}
},60000);

it('镜长保存遇到剧本配额失败时不改变画布和确认态',async()=>{
 const {page,close}=await mount();
 try {
  const timed='## 分镜表\n| 镜号 | 秒位 | 景别/运镜 | 画面 | 对白 |\n|---|---|---|---|---|\n| 1 | 0–4秒 | 中景横移 | 扶住同伴 | 无 |\n| 2 | 4–7秒 | 近景 | 点头 | 无 |';
  await page.evaluate(timed=>{const p=(window as any).__ffcProps;p.onBlocksChange(p.blocks.map((b:any)=>b.episodeIndex===1&&/^(reverse|beats)-/.test(b.id)?{...b,outputText:timed}:b));(window as any).__wbProps.onWorkflowPhaseChange('storyboard');},timed);
  await page.waitForSelector('[data-manhua-shot-timing]');
  const before=await page.evaluate(()=>({blocks:JSON.stringify((window as any).__ffcProps.blocks),writer:localStorage.getItem('mv-manhua-writer-session-v1')}));
  await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='mv-manhua-writer-session-v1')throw new DOMException('Full','QuotaExceededError');return set.call(this,k,v);};});
  await page.click('[data-manhua-shot-timing] summary');
  await page.$eval('[aria-label="当前镜头时长"]',el=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(el,'4.944');el.dispatchEvent(new Event('input',{bubbles:true}));});
  await page.click('[data-manhua-shot-timing] button');
  await page.waitForFunction(()=>document.querySelector('[data-manhua-shot-timing] [role="alert"]')?.textContent?.includes('时长未应用'));
  expect(await page.evaluate(()=>({blocks:JSON.stringify((window as any).__ffcProps.blocks),writer:localStorage.getItem('mv-manhua-writer-session-v1')}))).toEqual(before);
 }finally{await close();}
},60000);

it('大纲页修复混合镜头稿，保留时长原文且不提交生成', async()=>{
 const {page,close}=await mount(false,false,true);
 try {
 await page.waitForSelector('[data-manhua-timing-recovery]');
  await page.click('[data-manhua-outline-details] > summary');
  const before=await page.evaluate(()=>({posts:JSON.stringify((window as any).__posts),writer:JSON.parse(localStorage.getItem('mv-manhua-writer-session-v1')!)}));
  await page.click('[data-manhua-timing-recovery] button');
  await page.waitForFunction(()=>!document.querySelector('[data-manhua-timing-recovery]'));
  const after=await page.evaluate(()=>({posts:JSON.stringify((window as any).__posts),writer:JSON.parse(localStorage.getItem('mv-manhua-writer-session-v1')!),text:document.body.innerText}));
  expect(after.posts).toBe(before.posts);
  expect(after.writer.writerPack.episodes[1]).toEqual(before.writer.writerPack.episodes[1]);
  expect(after.writer.writerPack.episodes[0].body).toContain('0–5秒');
  expect(after.writer.writerPack.episodes[0].body).toContain('原分段参考');
  expect(after.writer.writerPack.rawMarkdown).toContain(after.writer.writerPack.episodes[0].body);
  expect(after.text).not.toContain('同时含秒位分镜表与段表');
 } finally {await close();}
},60000);

it('混合稿恢复保存失败时可见报错，原稿与修复入口保留', async()=>{
 const {page,close}=await mount(false,false,true);
 try {
 await page.waitForSelector('[data-manhua-timing-recovery]');
  await page.click('[data-manhua-outline-details] > summary');
  // 挂载后图片会异步转存本机；先等该独立迁移结束，再比较恢复按钮前后数据。
  await page.waitForFunction(()=>{
    const blocks=JSON.parse(localStorage.getItem('mv-freeform-canvas-v1')||'{}').blocks||[];
    const images=blocks.filter((b:any)=>b.id.startsWith('keyart-')&&b.outputUrl);
    return images.length>0&&images.every((b:any)=>b.outputUrl.startsWith('local-media:'));
  },{timeout:30000});
  // 转存回调与 localStorage 持久化不是同一个微任务；高负载并行浏览器套件里，
  // 图片都已变成 local-media 后，最后一次画布保存仍可能晚几十到数百毫秒。
  // 连续 500ms 未变化才取回滚基线，避免把后台转存误报成恢复按钮改写画布。
  await page.waitForFunction(()=>{
    const current=localStorage.getItem('mv-freeform-canvas-v1')||'';
    const now=Date.now();
    const state=(globalThis as any).__canvasStorageStability as {value:string;since:number}|undefined;
    if(state?.value===current)return now-state.since>=500;
    (globalThis as any).__canvasStorageStability={value:current,since:now};
    return false;
  },{polling:100,timeout:30000});
  const before=await page.evaluate(()=>({writer:localStorage.getItem('mv-manhua-writer-session-v1'),canvas:localStorage.getItem('mv-freeform-canvas-v1')}));
  await page.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(k,v){if(k==='mv-manhua-writer-session-v1')throw new DOMException('Full','QuotaExceededError');return set.call(this,k,v);};});
  await page.click('[data-manhua-timing-recovery] button');
  await page.waitForFunction(()=>document.querySelector('[data-manhua-timing-recovery] [role="alert"]')?.textContent?.includes('时长未应用'));
  expect(await page.evaluate(()=>({writer:localStorage.getItem('mv-manhua-writer-session-v1'),canvas:localStorage.getItem('mv-freeform-canvas-v1')}))).toEqual(before);
  expect(await page.$eval('[data-manhua-timing-recovery] button',(b:any)=>b.disabled)).toBe(false);
 }finally{await close();}
},60000);
