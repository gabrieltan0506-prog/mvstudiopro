/** 真实网页副本解码与横竖切换；不调用生成服务。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import express from "express";
import puppeteer from "puppeteer";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

it("口播首屏完整竖片，实播有声且横片切换恢复比例", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import{createRoot}from'react-dom/client';import Hero from './client/src/components/HomeHero';createRoot(document.getElementById('root')).render(<Hero/>);` }, bundle: true, write: false, jsx: "automatic", alias: { "@": path.resolve("client/src") }, define: { "process.env.NODE_ENV": '"production"' } });
  const css = readdirSync("client/dist/assets").filter(f => f.endsWith(".css")).map(f => readFileSync("client/dist/assets/" + f, "utf8")).join("\n");
  const app = express(); app.get("/", (_, res) => res.send(`<style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script>`)); app.use(express.static("client/public"));
  const server = app.listen(0, "127.0.0.1"); await new Promise<void>(resolve => server.once("listening", resolve));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", e => errors.push(String(e)));
    await page.setViewport({ width: 1440, height: 1000 });
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    await page.waitForFunction(() => (document.querySelector("video")?.readyState || 0) >= 1);
    expect(await page.$eval("video", v => ({ width: v.videoWidth, height: v.videoHeight, duration: v.duration, muted: v.muted, paused: v.paused }))).toMatchObject({ width: 1080, height: 1920, muted: false, paused: true });
    const click = async (name: string) => page.evaluate(name => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.trim() === name); if (!b) throw new Error(name); b.click(); }, name);
    await click("数字人口播"); await page.waitForFunction(() => (document.querySelector("video")?.currentTime || 0) > 0.2);
    expect(await page.$eval("video", v => v.duration)).toBeCloseTo(80.199, 1);
    expect(await page.$eval("video", v => getComputedStyle(v).objectFit)).toBe("contain");
    for (const width of [1440, 390]) {
      await page.setViewport({ width, height: width === 1440 ? 1000 : 844 });
      const rect = await page.$eval(".home-product-screen", el => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; });
      expect(rect.w / rect.h).toBeCloseTo(9 / 16, 2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `/Users/tangenjie/Downloads/2026Oct20/漫剧出海验证记录/首页口播-${width}.png` });
    }
    await click("战船"); await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 2560);
    const ratio = await page.$eval(".home-product-screen", el => { const r = el.getBoundingClientRect(); return r.width / r.height; });
    expect(ratio).toBeCloseTo(16 / 9, 2);
    await click("数字人口播"); await page.waitForFunction(() => document.querySelector("video")?.videoWidth === 1080);
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 60_000);
