import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

const ORIGIN = "http://localhost:41802";
let browser: Browser;
let bundle: string;

beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { flushSync } from 'react-dom';
        import { ManhuaWorldStagePreview } from './client/src/components/canvas/ManhuaWorldStagePreview';
        const root = createRoot(document.getElementById('root'));
        const f = globalThis.fixture = {};
        f.render = (spzUrl = 'https://assets.example/world.spz', x = 0) => flushSync(() => root.render(
          <ManhuaWorldStagePreview sceneLabelZh="临水坊市"
            world={{ spz500kUrl: spzUrl, metricScaleFactor: 2, groundPlaneOffset: 1 }}
            characters={[{ id: 'actor-a', labelZh: '阿菁', glbUrl: 'https://assets.example/a.glb', stagePoint: [x, 0] }]} />));
        f.render();
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  bundle = built.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);

afterAll(async () => {
  await browser?.close();
});

describe("3D 场景预览浏览器重载门禁", () => {
  it("同内容的新对象保留 iframe；世界文件或站位变化才新建实例", async () => {
    const context = await browser.createBrowserContext();
    try {
      const page = await context.newPage();
      await page.setRequestInterception(true);
      page.on("request", request => {
        if (new URL(request.url()).origin === ORIGIN) {
          void request.respond({ status: 200, contentType: "text/html", body: '<!doctype html><div id="root"></div>' });
        } else void request.abort();
      });
      await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: bundle });
      await page.waitForSelector("[data-manhua-world-stage] iframe");
      const first = await page.evaluate(() => {
        (window as any).firstIframe = document.querySelector("[data-manhua-world-stage] iframe");
        return document.querySelector("[data-manhua-world-stage]")?.getAttribute("data-stage-revision");
      });
      await page.evaluate(() => (window as any).fixture.render());
      expect(await page.evaluate(() => ({
        same: document.querySelector("[data-manhua-world-stage] iframe") === (window as any).firstIframe,
        revision: document.querySelector("[data-manhua-world-stage]")?.getAttribute("data-stage-revision"),
      }))).toEqual({ same: true, revision: first });
      await page.evaluate(() => (window as any).fixture.render("https://assets.example/new-world.spz"));
      expect(await page.evaluate(() => document.querySelector("[data-manhua-world-stage] iframe") === (window as any).firstIframe)).toBe(false);
      expect(await page.$eval("[data-manhua-world-stage]", el => el.getAttribute("data-stage-revision"))).not.toBe(first);
      const second = await page.evaluate(() => ((window as any).secondIframe = document.querySelector("[data-manhua-world-stage] iframe")) && document.querySelector("[data-manhua-world-stage]")?.getAttribute("data-stage-revision"));
      await page.evaluate(() => (window as any).fixture.render("https://assets.example/new-world.spz", 1));
      expect(await page.evaluate(() => document.querySelector("[data-manhua-world-stage] iframe") === (window as any).secondIframe)).toBe(false);
      expect(await page.$eval("[data-manhua-world-stage]", el => el.getAttribute("data-stage-revision"))).not.toBe(second);
    } finally {
      await context.close();
    }
  }, 20000);
});
