import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { mkdir } from "node:fs/promises";
it("画布导演设置自定义、云稿恢复与窄节点无溢出", async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
 import React from 'react';import {createRoot} from 'react-dom/client';import {CanvasCinemaPanel} from './client/src/components/canvas/CanvasCinemaPanel';import {defaultCanvasBlock} from './client/src/lib/canvasTypes';import {sanitizeManhuaCloudDraftBlock} from './shared/manhuaCloudDraft';import {cloudDraftBlocksToCanvas} from './client/src/lib/manhuaCloudDraftSync';
 function App(){const[d,set]=React.useState(()=>({...defaultCanvasBlock('video',0,0),prompt:'保留人物原文'}));globalThis.draft=d;globalThis.reload=()=>set(cloudDraftBlocksToCanvas([JSON.parse(localStorage.getItem('draft'))])[0]);return <div style={{width:280}}><CanvasCinemaPanel block={d} onPatch={p=>set(v=>{const next={...v,...p};localStorage.setItem('draft',JSON.stringify(sanitizeManhuaCloudDraftBlock(next)));return next;})}/></div>;}createRoot(document.getElementById('root')).render(<App/>);
 `,
    },
    bundle: true,
    write: false,
    outdir: "/tmp/cinema-browser-bundle",
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", r =>
      r.respond({
        status: 200,
        contentType: "text/html",
        body: '<div id="root"></div>',
      })
    );
    await page.goto("http://localhost/");
    await page.setViewport({ width: 1280, height: 900 });
    await page.addStyleTag({
      content: result.outputFiles.find(f => f.path.endsWith(".css"))!.text,
    });
    await page.addScriptTag({
      content: result.outputFiles.find(f => f.path.endsWith(".js"))!.text,
    });
    await page.waitForSelector('[aria-label="画布Cinema导演工作台"]');
    await page.click('[aria-label="画布Cinema导演工作台"] > summary');
    await page.$$eval("summary", nodes =>
      (
        nodes.find(n => n.textContent?.includes("摄影机")) as HTMLElement
      ).click()
    );
    await page.select('[aria-label="Cinema运镜"]', "缓推");
    expect(
      await page.evaluate(() => (globalThis as any).draft.prompt)
    ).not.toContain("运镜：缓推");
    await page.$$eval("button", nodes =>
      (
        nodes.find(n => n.textContent === "采用到节点提示词") as HTMLElement
      ).click()
    );
    await page.waitForFunction(() =>
      (globalThis as any).draft.prompt.includes("运镜：缓推")
    );
    await page.evaluate(() => (globalThis as any).reload());
    expect(
      await page.$eval(
        '[aria-label="Cinema运镜"]',
        n => (n as HTMLSelectElement).value
      )
    ).toBe("缓推");
    await mkdir("/tmp/dh-canvas-cinema-ui", { recursive: true });
    await page.screenshot({
      path: "/tmp/dh-canvas-cinema-ui/desktop.png",
      fullPage: true,
    });
    await page.$$eval("summary", nodes =>
      (nodes.find(n => n.textContent?.includes("灯光")) as HTMLElement).click()
    );
    await page.$$eval("button", nodes =>
      (nodes.find(n => n.textContent === "添加灯光") as HTMLElement).click()
    );
    await page.select('[aria-label="灯光1方向"]', "左侧");
    await page.$$eval("button", nodes =>
      (
        nodes.find(n => n.textContent === "采用到节点提示词") as HTMLElement
      ).click()
    );
    await page.waitForFunction(() =>
      (globalThis as any).draft.prompt.includes("左侧")
    );
    await page.evaluate(() => (globalThis as any).reload());
    expect(
      await page.evaluate(
        () => (globalThis as any).draft.cinema.customLights[0].direction
      )
    ).toBe("左侧");
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/dh-canvas-cinema-ui/mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 30000);
