import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("手机安装入口只对已确认监管身份显示，访客/普通/管理员及未确认身份均隐藏", async () => {
  const result = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React from 'react';import {createRoot} from 'react-dom/client';import {PWAInstallButton} from './client/src/components/PWAInstallButton';
      const root=createRoot(document.getElementById('root'));globalThis.renderInstall=()=>root.render(<PWAInstallButton/>);globalThis.renderInstall();
    ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent",
    plugins: [{ name: "verified-auth-boundary", setup(b) {
      b.onLoad({ filter: /[/\\]trpc\.ts$/ }, () => ({ loader: "js", contents: "export const trpc={auth:{me:{useQuery:()=>globalThis.identity}}};" }));
    } }],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148");
    await page.setContent('<html><body><div id="root"></div></body></html>');
    await page.evaluate(() => { (globalThis as any).identity = { isSuccess: true, isFetching: false, data: { role: "user" } }; });
    await page.addScriptTag({ content: result.outputFiles[0].text });
    for (const identity of [
      { isSuccess: true, isFetching: false, data: null },
      { isSuccess: true, isFetching: false, data: { role: "user" } },
      { isSuccess: true, isFetching: false, data: { role: "admin" } },
      { isSuccess: false, isFetching: false, data: { role: "supervisor" } },
      { isSuccess: true, isFetching: true, data: { role: "supervisor" } },
    ]) {
      await page.evaluate(identity => { const g = globalThis as any; g.identity = identity; g.renderInstall(); }, identity);
      await page.evaluate(() => new Promise(requestAnimationFrame));
      expect(await page.$("[data-pwa-install-button]")).toBe(null);
      expect(await page.evaluate(() => { const event = new Event("beforeinstallprompt", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
    }
    await page.evaluate(() => { const g = globalThis as any; g.identity = { isSuccess: true, isFetching: false, data: { role: "supervisor" } }; g.renderInstall(); });
    await page.waitForSelector('[aria-label="新增到手机桌面"]');
    expect(await page.evaluate(() => { const event = new Event("beforeinstallprompt", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(true);
    await page.evaluate(() => { const g = globalThis as any; g.identity = { isSuccess: true, isFetching: false, data: { role: "user" } }; g.renderInstall(); });
    await page.waitForFunction(() => !document.querySelector("[data-pwa-install-button]"));
    expect(await page.evaluate(() => { const event = new Event("beforeinstallprompt", { cancelable: true }); window.dispatchEvent(event); return event.defaultPrevented; })).toBe(false);
    await page.close();
  } finally { await browser.close(); }
}, 60_000);
