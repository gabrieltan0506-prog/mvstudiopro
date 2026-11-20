import path from "node:path";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { expect, it } from "vitest";

it("恢复后连续翻页，读失败按原游标重试，切换任务忽略迟到响应", async () => {
  const bundle = await build({
    stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
      import { createRoot } from "react-dom/client";
      import { KnowledgeDistillPreview } from "./client/src/components/platform/KnowledgeDistillPreview";
      const root = createRoot(document.getElementById("app"));
      window.show = (jobId, readyBatches) => root.render(<KnowledgeDistillPreview live={{jobId, readyBatches}}/>);
    ` },
    write: false, bundle: true, format: "iife", jsx: "automatic",
    alias: { "@": path.resolve("client/src") },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "offline-preview", setup(builder) {
      builder.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "trpc", namespace: "fixture" }));
      builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({ contents: `
        const utils = { editableLayout: { distillPreview: { fetch: args => window.previewFetch(args) } } };
        export const trpc = { useUtils: () => utils };
      ` }));
    } }],
  });
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="app"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.evaluate(() => {
      const fixture = window as any;
      fixture.calls = [];
      fixture.previewFetch = async ({ jobId, fromBatch }: { jobId: string; fromBatch: number }) => {
        fixture.calls.push([jobId, fromBatch]);
        if (jobId === "old") await new Promise(resolve => { fixture.release = resolve; });
        if (jobId === "book" && fromBatch === 0 && !fixture.retried) {
          fixture.retried = true;
          throw Error("离线");
        }
        const segments = Array.from({ length: 8 }, (_, i) => ({
          index: fromBatch + i, pages: [{ headline: jobId + (fromBatch + i), body: "正文" }],
        }));
        return { nextBatch: fromBatch + 8, kind: "source", segments };
      };
      fixture.show("old", 8);
    });
    await page.waitForFunction(() => Boolean((window as any).release));
    await page.evaluate(() => (window as any).show("book", 24));
    await page.waitForFunction(() => document.body.textContent?.includes("正在重试"));
    await page.evaluate(() => (window as any).release());
    await page.waitForFunction(() => document.querySelectorAll("article").length === 24, { polling: 100, timeout: 15000 }).catch(async error => {
      const state = await page.evaluate(() => ({ calls: (window as any).calls, text: document.body.textContent?.slice(0, 120) }));
      throw new Error(`未加载全部预览 ${JSON.stringify(state)}`, { cause: error });
    });
    expect(await page.evaluate(() => (window as any).calls)).toEqual([["old",0],["book",0],["book",0],["book",8],["book",16]]);
    expect(await page.evaluate(() => [...document.querySelectorAll("article strong")].map(n => n.textContent)))
      .toEqual(Array.from({ length: 24 }, (_, i) => "book" + i));
  } finally { await browser.close(); }
}, 120_000);
