/** 真实工作台阶段条的窄屏几何与坐标点击。
 * 需要显式传入构建CSS；网络由离线夹具截获，不代表线上账号验收。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let bundle: string;
const evidenceDir = join(tmpdir(), "mvs-phase-rail-probe");

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




it.skipIf(!process.env.MANHUA_LAYOUT_CSS_DIR)('阶段条390与1280按钮标签不相互覆盖且横向可达',async()=>{
 const {page,close}=await mount();
 try{
  const cssDir=process.env.MANHUA_LAYOUT_CSS_DIR!;
  for(const f of readdirSync(cssDir).filter(n=>n.endsWith('.css')))await page.addStyleTag({content:readFileSync(join(cssDir,f),'utf8')});
  // 尚未重新构建：仅在指定时注入本次 Tailwind 工具类的等价规则。正式构建复验时关闭此开关。
  if(process.env.PROBE_INJECT_RULE==='1')await page.addStyleTag({content:'@media (width < 40rem) { .max-sm\\:flex-none { flex: none; } }'});
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('edit'));
  await page.waitForSelector('[data-manhua-workflow-rail]');
  const results=[];
  for(const width of [390,1280]){
   await page.setViewport({width,height:900});
   await page.$eval('[data-manhua-workflow-rail]',el=>el.scrollLeft=0);
   const metrics=await page.$eval('[data-manhua-workflow-rail]',rail=>({rail:{width:rail.clientWidth,scrollWidth:rail.scrollWidth},buttons:Array.from(rail.querySelectorAll('[data-manhua-phase]')).map(el=>{const r=el.getBoundingClientRect();const icon=el.children[0].getBoundingClientRect();const label=el.children[1].children[0] as HTMLElement;const lr=label.getBoundingClientRect();const st=getComputedStyle(el);return {id:el.getAttribute('data-manhua-phase'),x:r.x,right:r.right,width:r.width,minWidth:st.minWidth,shrink:st.flexShrink,labelWidth:label.clientWidth,labelScroll:label.scrollWidth,iconRight:icon.right,labelX:lr.x};})}));
   results.push({width,...metrics});
   await page.screenshot({path:join(evidenceDir,(process.env.PROBE_TAG||'probe')+'-'+width+'.png')});
  }
  writeFileSync(join(evidenceDir,(process.env.PROBE_TAG||'probe')+'-metrics.json'),JSON.stringify(results,null,2));
  for(const r of results)for(let i=1;i<r.buttons.length;i++)expect(r.buttons[i].x).toBeGreaterThanOrEqual(r.buttons[i-1].right);
  for(const r of results)for(const b of r.buttons){expect(b.width).toBeGreaterThanOrEqual(132);expect(b.labelWidth).toBeGreaterThanOrEqual(b.labelScroll);expect(b.labelX).toBeGreaterThanOrEqual(b.iconRight);}
  if(process.env.PROBE_BASELINE_METRICS){
   const baseline=JSON.parse(readFileSync(process.env.PROBE_BASELINE_METRICS,'utf8'));
   expect(results.find(r=>r.width===1280)).toEqual(baseline.find((r:any)=>r.width===1280));
  }
  await page.evaluate(()=>{(window as any).__phaseClicks=[];document.addEventListener('click',event=>{const button=(event.target as Element)?.closest('[data-manhua-phase]');if(button)(window as any).__phaseClicks.push(button.getAttribute('data-manhua-phase'));},true);});
  const hits=[];
  for(const width of [390,1280]){
   await page.setViewport({width,height:900});
   for(const phase of ['outline','assets','storyboard','edit','final']){
    const selector='[data-manhua-phase="'+phase+'"]';
    await page.$eval(selector,el=>el.scrollIntoView({block:'nearest',inline:'center'}));
    const hit=await page.$eval(selector,el=>{const r=el.getBoundingClientRect();return {id:document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest('[data-manhua-phase]')?.getAttribute('data-manhua-phase'),scrollLeft:el.closest('[data-manhua-workflow-rail]')!.scrollLeft};});
    expect(hit.id).toBe(phase);
    await page.click(selector);
    hits.push({width,phase,...hit});
   }
  }
  expect(await page.evaluate(()=>(window as any).__phaseClicks)).toEqual(['outline','assets','storyboard','edit','final','outline','assets','storyboard','edit','final']);
  writeFileSync(join(evidenceDir,(process.env.PROBE_TAG||'probe')+'-hits.json'),JSON.stringify(hits,null,2));
 }finally{await close();}
},120000);
