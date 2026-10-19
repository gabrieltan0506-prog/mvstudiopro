import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { mkdir } from "node:fs/promises";
it("Cinema真实卡片交互、采用和重载恢复；移动版无横向溢出", async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
 import React from 'react';import {createRoot} from 'react-dom/client';import {DigitalHumanCinemaPanel} from './client/src/components/DigitalHumanCinemaPanel';import {newDigitalHumanDraft,digitalHumanDraftSchema} from './shared/digitalHumanStudio';
 function App(){const[d,set]=React.useState(()=>newDigitalHumanDraft('7','00000000-0000-4000-8000-000000000001'));globalThis.draft=d;globalThis.reload=()=>set(digitalHumanDraftSchema.parse(JSON.parse(localStorage.getItem('draft'))));return <DigitalHumanCinemaPanel draft={d} disabled={false} canUseOmni={true} onChange={p=>set(v=>{const next=digitalHumanDraftSchema.parse({...v,...p});localStorage.setItem('draft',JSON.stringify(next));return next;})}/>;}createRoot(document.getElementById('root')).render(<App/>);
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
    plugins: [
      {
        name: "media-only",
        setup(b) {
          b.onResolve({ filter: /^\.\/DigitalHumanStudio$/ }, args =>
            args.importer.endsWith("DigitalHumanCinemaPanel.tsx")
              ? { path: "media", namespace: "offline" }
              : null
          );
          b.onLoad({ filter: /.*/, namespace: "offline" }, () => ({
            loader: "js",
            contents: "export function DigitalHumanMedia(){return null}",
          }));
        },
      },
    ],
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
    await page.waitForSelector('[aria-label="Cinema导演工作台"]');
    await page.$$eval("summary", nodes =>
      (
        nodes.find(n => n.textContent?.includes("摄影机")) as HTMLElement
      ).click()
    );
    await page.select('[aria-label="Cinema运镜"]', "缓推");
    expect(
      await page.evaluate(() => (globalThis as any).draft.direction)
    ).not.toContain("运镜：缓推");
    await page.$$eval("button", nodes =>
      (
        nodes.find(n => n.textContent === "采用到完整导演要求") as HTMLElement
      ).click()
    );
    await page.waitForFunction(() =>
      (globalThis as any).draft.direction.includes("运镜：缓推")
    );
    await page.evaluate(() => (globalThis as any).reload());
    expect(
      await page.$eval(
        '[aria-label="Cinema运镜"]',
        n => (n as HTMLSelectElement).value
      )
    ).toBe("缓推");
    await mkdir("/tmp/dh-cinema-ui", { recursive: true });
    await page.screenshot({
      path: "/tmp/dh-cinema-ui/desktop.png",
      fullPage: true,
    });
    await page.$$eval("button", nodes =>
      (
        nodes.find(n => n.textContent?.startsWith("照片口播")) as HTMLElement
      ).click()
    );
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="Cinema运镜"]')
    );
    expect(await page.$eval(".dh-cinema-prompt", n => n.textContent)).toContain(
      "照片口播"
    );
    await page.setViewport({ width: 390, height: 844 });
    await page.screenshot({
      path: "/tmp/dh-cinema-ui/mobile.png",
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
