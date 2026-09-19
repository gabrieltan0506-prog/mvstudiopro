/**
 * 通过透明组件探针调用真实 OmniCanvas 父级：
 * 选镜与后台铺段保留媒体预览，用户主动审阅时才打开高级画布。
 * 网络边界隔离，不提交生成任务；不以此替代正式页面验收。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let bundle: string;

beforeAll(async () => {
  const result = await build({
    entryPoints: ["client/src/lib/manhuaCanvasRerunPost.fixture.tsx"],
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
  await browser?.close();
});

/** 每个用例一个全新 BrowserContext：localStorage 隔离，第二条不沿用第一条的状态 */
async function mount(): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setRequestInterception(true);
  p.on("request", (req) =>
    req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
  );
  await p.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.setContent("<div id=root></div>");
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


it("真实Omni父级选镜和后台铺段不展开高级画布，主动审阅可展开", async () => {
  const {page,close}=await mount();
  const errors:string[]=[];
  page.on("pageerror",e=>errors.push(String(e)));
  try {
    await page.evaluate(()=>(window as any).__wbProps.onWorkflowPhaseChange('storyboard'));
    await page.waitForSelector('[data-manhua-action="open-canvas-dock"]');
    const id=await page.evaluate(()=>(window as any).__wbProps.blocks.find((b:any)=>b.id.startsWith('keyart-'))?.id);
    expect(id).toBeTruthy();
    await page.evaluate(() => {
      const observed = window as any;
      let props = observed.__ffcProps;
      observed.__observedFocusIds = [];
      Object.defineProperty(window, '__ffcProps', {
        configurable: true,
        get: () => props,
        set: value => {
          props = value;
          observed.__observedFocusIds.push(value.focusBlockId);
        },
      });
    });
    await page.evaluate((id)=>(window as any).__wbProps.onFocusBlock(id),id);
    await page.waitForFunction((id)=>(window as any).__observedFocusIds.includes(id),{},id);
    expect(await page.$eval('#freeform-canvas-zone',e=>e.getAttribute('aria-hidden'))).toBe('true');
    await page.evaluate(()=>(window as any).__wbProps.onReviewClipPromptsOnCanvas({segmentIndex:1,revealCanvas:false}));
    // 执行父级120ms延迟之后再检查，覆盖自动点击打开按钮的旧副作用。
    await page.evaluate(()=>new Promise(r=>setTimeout(r,180)));
    expect(await page.$eval('#freeform-canvas-zone',e=>e.getAttribute('aria-hidden'))).toBe('true');
    await page.evaluate(()=>(window as any).__wbProps.onReviewClipPromptsOnCanvas({segmentIndex:1}));
    await page.waitForFunction(()=>document.querySelector('#freeform-canvas-zone')?.getAttribute('aria-hidden')==='false');
    expect(errors).toEqual([]);
  } finally {await close();}
},180000);
