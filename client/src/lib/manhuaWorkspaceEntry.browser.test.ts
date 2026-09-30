/** 真实整页入口与生产样式的组合检查；网络隔离，不是正式线上验收。 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import { build as viteBuild } from "vite";
import tailwindcss from "@tailwindcss/vite";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { writeFileSync } from "node:fs";
let browser: Browser;
let bundle: string;
let css: string;
beforeAll(async () => {
  const result = await build({ entryPoints: ["client/src/lib/manhuaFinalLayout.fixture.tsx"], bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic", alias: {
    "@": path.resolve("client/src"), "@shared": path.resolve("shared"),
    "@/components/canvas/FreeformCanvas": path.resolve("client/src/lib/__browserfixtures__/freeformCanvasProbe.tsx"),
    "@/components/ManhuaScriptWorkbench": path.resolve("client/src/lib/__browserfixtures__/manhuaWorkbenchProbe.tsx"),
  }, loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".css": "text" }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "__VITE_ENV__" }, banner: { js: 'var __VITE_ENV__={DEV:false,PROD:true,MODE:"production",SSR:false};' }, logLevel: "silent" });
  bundle = result.outputFiles[0]!.text;
  const built = await viteBuild({ configFile: false, plugins: [tailwindcss()], build: { write: false, rollupOptions: { input: path.resolve("client/src/index.css") } } });
  const outputs = Array.isArray(built) ? built.flatMap(o => o.output) : "output" in built ? built.output : [];
  css = outputs.filter(o => o.type === "asset" && o.fileName.endsWith(".css")).map(o => o.type === "asset" ? String(o.source) : "").join("\n");
  if (!css) throw new Error("未编译真实样式");
  browser = await puppeteer.launch({ headless: true, ...(process.getuid?.() === 0 ? { args: ["--no-sandbox"] } : {}) });
}, 60000);
afterAll(async () => { await browser?.close(); });
it("品牌与工作区同一行；短窗口展开两组工具后顶栏不长高、核心按钮不被覆盖", async () => {
  const context = await browser.createBrowserContext(); const page = await context.newPage(); page.setDefaultTimeout(10000);
  await page.setRequestInterception(true); page.on("request", request => request.url().startsWith("data:") ? void request.continue() : void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
  try {
    await page.setViewport({ width: 1280, height: 720 }); await page.goto("http://localhost:41836/"); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
    await page.waitForFunction(() => Array.from(document.querySelectorAll("*")).some(e => !e.children.length && e.textContent?.includes("进入引导式漫剧")));
    await page.evaluate(() => (Array.from(document.querySelectorAll("*")).find(e => !e.children.length && e.textContent?.includes("进入引导式漫剧")) as HTMLElement).click());
    await page.waitForSelector('[data-navbar-workspace-navigation]');
    for (const width of [1280, 1000, 760, 390]) {
      await page.setViewport({ width, height: 600 });
      const before = await page.evaluate(() => {
        const header = document.querySelector('[data-manhua-product-header]')!.getBoundingClientRect();
        const navbar = document.querySelector('[data-navbar-workspace-navigation]')!.closest('nav')!;
        const brand = navbar.querySelector('a')!.getBoundingClientRect();
        const workspace = navbar.querySelector('[aria-label="漫剧工厂工作区"]')!.getBoundingClientRect();
        return { headerHeight: header.height, brand: [brand.top,brand.bottom], workspace: [workspace.top,workspace.bottom], viewport: innerWidth, page: document.documentElement.scrollWidth };
      });
      expect(before.brand[0]).toBeLessThan(before.workspace[1]); expect(before.workspace[0]).toBeLessThan(before.brand[1]); expect(before.page).toBeLessThanOrEqual(width + 1);
      await page.click('[data-canvas-workspace-tools] > summary');
      await page.click('[data-manhua-workspace-tools] > summary');
      const expanded = await page.evaluate(() => {
        const header = document.querySelector('[data-manhua-product-header]')!.getBoundingClientRect();
        const tools = document.querySelector('[data-manhua-toolbar-cluster]')!.getBoundingClientRect();
        const button = document.querySelector('[data-manhua-action="open-video-prompts"]')!;const r = button.getBoundingClientRect();
        const hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
        return { headerHeight: header.height, toolsBottom: tools.bottom, promptVisible: r.top>=0 && r.bottom<=innerHeight && Boolean(hit && button.contains(hit)) };
      });
      writeFileSync(`/tmp/0930-workspace-geometry-${width}.json`,JSON.stringify({before,expanded},null,2));await page.screenshot({path:`/tmp/0930-workspace-expanded-${width}.png`});
      expect(expanded.headerHeight).toBeCloseTo(before.headerHeight, 0); expect(expanded.toolsBottom).toBeLessThanOrEqual(601); expect(expanded.promptVisible).toBe(true);
      await page.click('[data-manhua-workspace-tools] > summary'); await page.click('[data-canvas-workspace-tools] > summary');
    }
    await page.screenshot({ path: "/tmp/0930-workspace-header-760.png" });
  } finally { await context.close(); }
}, 60000);
it("白模展开时直接打开当前段提示词，真实编译检查说明过期原因且不建视频任务", async () => {
  const context = await browser.createBrowserContext();const page = await context.newPage();page.setDefaultTimeout(10000);
  await page.setRequestInterception(true);page.on("request", r => r.url().startsWith("data:") ? void r.continue() : void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
  try {
    await page.setViewport({ width: 1280, height: 620 });await page.goto("http://localhost:41836/");await page.addStyleTag({content:css});await page.addScriptTag({content:bundle});
    await page.waitForFunction(() => Array.from(document.querySelectorAll("*")).some(e=>!e.children.length&&e.textContent?.includes("进入引导式漫剧")));
    await page.evaluate(()=> (Array.from(document.querySelectorAll("*")).find(e=>!e.children.length&&e.textContent?.includes("进入引导式漫剧")) as HTMLElement).click());
    await page.waitForSelector('[data-manhua-workspace-tools]');await page.click('[data-manhua-workspace-tools] > summary');await page.click('[data-manhua-action="open-secondary-tools"]');
    await page.waitForSelector('[data-manhua-secondary-studio]');
    const postsBefore=await page.evaluate(()=>JSON.stringify((window as any).__posts));
    await page.click('[data-manhua-action="open-video-prompts"]');await page.waitForSelector('[aria-label="视频提示词"]');
    await page.waitForFunction(()=>{const node=document.querySelector('[data-manhua-clip-outbound]');return Boolean(node?.querySelector('pre') || node?.textContent?.includes('重新核对'));});
    writeFileSync('/tmp/0930-prompt-entry-content.txt',await page.$eval('[aria-label="视频提示词"]',e=>e.textContent||''));
    const content=await page.$eval('[aria-label="视频提示词"]',e=>({text:e.textContent,rect:e.getBoundingClientRect().toJSON(),display:getComputedStyle(e).display,editedText:Array.from(e.querySelectorAll('textarea')).map(t=>t.value)}));
    expect(content.display).not.toBe('none');expect(content.rect.bottom).toBeLessThanOrEqual(620);expect(content.text).toContain('实际发送内容');expect(content.text).toContain('【第1段·30s】');expect(content.text).toContain('本段原稿或造型已变更');
    expect(await page.$eval('#manhua-workbench-shell',e=>e.getAttribute('data-manhua-secondary-active'))).toBe('false');
    expect(await page.evaluate(()=>JSON.stringify((window as any).__posts))).toBe(postsBefore);
    await page.screenshot({path:'/tmp/0930-video-prompts-entry.png'});
  } finally {await context.close();}
},120000);
