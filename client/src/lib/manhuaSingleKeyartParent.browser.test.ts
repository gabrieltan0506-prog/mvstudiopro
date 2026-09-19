/** 真实 OmniCanvas + Workbench 当前镜按钮交互，真实工厂与 runCanvasBlock。
 * 所有网络由离线夹具截获；证明请求范围及恢复，不代表线上计费验收。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let bundle: string;
const evidenceDir = join(tmpdir(), "mvs-single-keyart-probe");

beforeAll(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  const result = await build({
    entryPoints: ["client/src/lib/manhuaSingleKeyartParent.fixture.tsx"],
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


it.each([[true,false],[false,false],[true,true]])("真实父组件当前镜首次=%s双档=%s仅请求当前镜，其他镜保留", async (first,both) => {
 const {page,close}=await mount(first,both);
 const errors:string[]=[]; page.on('pageerror',e=>errors.push(String(e)));
 try {
  await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('storyboard'));
  await page.waitForSelector('[data-manhua-action="generate-current-keyart"]');
  const before=await page.evaluate(()=>(window as any).__wbProps.blocks);
  expect(before.some((b:any)=>b.id.includes('-e02-'))).toBe(true);
  expect(before.filter((b:any)=>b.id.startsWith('keyart-')&&b.id.includes('-e01-')).length).toBe(first?0:18);
  const label=await page.$eval('[data-manhua-action="generate-current-keyart"]',e=>e.textContent);
  expect(label).toContain(first?'生成当前镜':'重出当前镜');
  await page.$eval('[data-manhua-action="generate-current-keyart"]',button=>{(button as HTMLButtonElement).click();(button as HTMLButtonElement).click();});
  await page.waitForFunction(()=>(window as any).__posts.length>0,{timeout:20000}).catch(async e=>{throw new Error(String(e)+' DOM='+await page.evaluate(()=>document.body.innerText));});
  await page.waitForFunction(()=>!(window as any).__wbProps.factoryBusy,{timeout:30000});
  const receipt=await page.evaluate(()=>({posts:(window as any).__posts,blocks:(window as any).__wbProps.blocks,confirms:(window as any).__confirms}));
  expect(receipt.posts).toHaveLength(both?2:1);
  expect(receipt.posts.every((p:any)=>String(JSON.stringify(p.body)).includes("prompt"))).toBe(true);
  const changed=receipt.blocks.filter((b:any)=>JSON.stringify(b)!==JSON.stringify(before.find((a:any)=>a.id===b.id)));
  expect(changed.filter((b:any)=>b.id.startsWith('keyart-'))).toHaveLength(1);
  expect(changed.map((b:any)=>b.id)).toEqual([changed.find((b:any)=>b.id.startsWith("keyart-"))!.id]);
  const targetId=changed[0].id;
  for(const b of before.filter((b:any)=>b.id!==targetId))expect(receipt.blocks.find((x:any)=>x.id===b.id)).toEqual(b);
  writeFileSync(join(evidenceDir, `current-shot-parent-${first}-${both}.json`),JSON.stringify({label,receipt,errors},null,2));
  await page.screenshot({path:join(evidenceDir, `current-shot-parent-${first}-${both}.png`),fullPage:false});
  expect(errors).toEqual([]);
 }finally{await close();}
},180000);
