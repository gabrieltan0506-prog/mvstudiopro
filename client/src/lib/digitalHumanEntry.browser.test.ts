/** 离线浏览器验证真实首页链接及地址恢复，不连接生产页面。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
it("首页数字人入口直达，工具切换可以后退且刷新保持选择", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import HomeHero from './client/src/components/HomeHero';
    import {resolvePlatformCreationTool,syncPlatformCreationToolToUrl} from './client/src/lib/platformWorkbenchMode';
    globalThis.readTool=resolvePlatformCreationTool;globalThis.switchTool=syncPlatformCreationToolToUrl;
    createRoot(document.getElementById('root')).render(<HomeHero/>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src") }, define: { "process.env.NODE_ENV": '"production"' } });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", r => { void r.respond({ status: 200, contentType: "text/html", body: '<html><body><div id="root"></div></body></html>' }); });
    await page.goto("https://example.test/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForSelector('a[href="/platform?mode=create&createTool=digital-human"]');
    await page.click('a[href="/platform?mode=create&createTool=digital-human"]');
    expect(new URL(page.url()).searchParams.get("createTool")).toBe("digital-human");
    expect(await page.evaluate(() => (globalThis as any).readTool())).toBe("digital-human");
    await page.evaluate(() => (globalThis as any).switchTool("knowledge"));
    expect(await page.evaluate(() => (globalThis as any).readTool())).toBe("knowledge");
    await page.goBack();
    expect(await page.evaluate(() => (globalThis as any).readTool())).toBe("digital-human");
    await page.reload();await page.addScriptTag({content:bundle.outputFiles[0].text});
    expect(await page.evaluate(() => (globalThis as any).readTool())).toBe("digital-human");
  } finally { await browser.close(); }
}, 60_000);
