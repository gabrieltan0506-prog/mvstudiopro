import { afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const evidenceDir = "/private/tmp/mvs-template-trial-probe";
it("免费试写两稿完整可见，只有模板改动文字高亮", async () => {
  mkdirSync(evidenceDir, { recursive: true });
  const output = await build({
    stdin: {
      resolveDir: process.cwd(), loader: "tsx", contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import ManhuaTemplateTrialCompare from './client/src/components/canvas/ManhuaTemplateTrialCompare';
        const base = {logline:'阿菁带着娘走进医馆。',beats:['先生端来药碗。','墨屠抬起眼睛。','阿菁发现血被藏起。'],openingHook:'他推门而入。'};
        const enhanced = {...base,beats:['先生颤抖着端来药碗。','墨屠抬起眼睛。','阿菁发现血被藏起。'],openingHook:'他猛地推门而入。'};
        const root = createRoot(document.getElementById('root'));
        globalThis.renderTrial = (same, stale) => root.render(<ManhuaTemplateTrialCompare result={{control:base,withTemplate:same?base:enhanced,appliedTemplate:{publicId:'A349',nameZh:'悲愤模板'},templateFingerprint:'a'.repeat(64),trialsLeftToday:2}} applying={false} stale={stale} onApply={()=>{}} onClose={()=>{}} />);
        globalThis.renderTrial(false);
      `,
    },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": join(process.cwd(), "client/src") },
    define: { "process.env.NODE_ENV": '"production"' },
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.setContent('<body style="background:#0a1015"><div id="root" style="max-width:1100px;margin:20px auto"></div></body>');
    const cssDir = process.env.MANHUA_LAYOUT_CSS_DIR;
    if (cssDir) for (const file of readdirSync(cssDir).filter((name) => name.endsWith(".css"))) {
      await page.addStyleTag({ content: readFileSync(join(cssDir, file), "utf8") });
    }
    await page.evaluate(output.outputFiles[0]!.text);
    await page.waitForSelector('[data-manhua-template-trial-compare]');
    expect(await page.$eval('[data-manhua-template-trial-compare]', (element) => element.textContent)).toContain('阿菁带着娘走进医馆。');
    expect(await page.$eval('[data-manhua-template-trial-compare]', (element) => element.textContent)).toContain('他猛地推门而入。');
    expect(await page.$$eval('[data-manhua-template-change="after"]', (items) => items.map((item) => item.textContent))).toEqual(['颤抖着', '猛地']);
    expect(await page.$$eval('[data-manhua-template-change="before"]', (items) => items.map((item) => item.textContent))).toEqual([]);
    await page.screenshot({ path: join(evidenceDir, 'two-column-1280.png') });
    await page.evaluate(() => (window as any).renderTrial(true));
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('没有带来可见改动'));
    expect(await page.$eval('[data-manhua-template-trial-compare]', (element) => Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.includes('套用到全集'))?.disabled)).toBe(true);
    await page.evaluate(() => (window as any).renderTrial(false, true));
    await page.waitForFunction(() => document.querySelector('[role="status"]')?.textContent?.includes('模板方案已更新'));
    expect(await page.$eval('[data-manhua-template-trial-compare]', (element) => Array.from(element.querySelectorAll('button')).find((button) => button.textContent?.includes('套用到全集'))?.disabled)).toBe(true);
  } finally {
    await browser.close();
  }
}, 90_000);

afterAll(() => {});
