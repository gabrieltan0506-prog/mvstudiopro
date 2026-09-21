/** 资产墙禁用态通过原生交互验证；离线拦截网络，不调用生产。 */
import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("资产墙忙碌时不可改选人物、场景或道具，解除后恢复选择", async () => {
  const built = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
      import Wall from './client/src/components/ManhuaAssetWall';
      const f=globalThis.fixture={selected:[]};
      function App(){const [disabled,setDisabled]=useState(false);f.setDisabled=setDisabled;return <Wall disabled={disabled} onSelectScene={id=>f.selected.push(id)} onSelectFemale={id=>f.selected.push(id)} onSelectMale={id=>f.selected.push(id)} onToggleProp={id=>f.selected.push(id)}/>;}
      createRoot(document.getElementById('root')).render(<App/>);
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", r => r.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/");
    await page.setContent('<div id="root"></div>');
    await page.evaluate(built.outputFiles[0]!.text);
    await page.waitForSelector("[data-manhua-asset-wall] select");
    for (const tab of ["scenes", "leads", "support"]) {
      await page.select("[data-manhua-asset-wall] select", tab);
      await page.waitForSelector("[data-manhua-asset-wall] button");
      const before = await page.evaluate(() => (globalThis as any).fixture.selected.length);
      await page.evaluate(() => (globalThis as any).fixture.setDisabled(true));
      await page.waitForSelector("[data-manhua-asset-wall] fieldset:disabled");
      expect(await page.$$eval("[data-manhua-asset-wall] button, [data-manhua-asset-wall] select", els => els.every(el => el.matches(":disabled")))).toBe(true);
      await page.click("[data-manhua-asset-wall] button");
      expect(await page.evaluate(() => (globalThis as any).fixture.selected.length)).toBe(before);
      await page.evaluate(() => (globalThis as any).fixture.setDisabled(false));
      await page.waitForSelector("[data-manhua-asset-wall] fieldset:not(:disabled)");
      await page.click("[data-manhua-asset-wall] button");
      expect(await page.evaluate(() => (globalThis as any).fixture.selected.length)).toBe(before + 1);
    }
  } finally { await browser.close(); }
}, 60_000);
