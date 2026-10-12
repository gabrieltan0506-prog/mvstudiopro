/** 开发内存探针：真实React预览与同源引擎，不生成文件、不调用模型或生产服务。 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  defaultArtMotionSpec,
  artMotionGrammarDraft,
} from "../../../shared/artMotion";

let server: Server, browser: Browser, origin: string, bundle: string;
let rejectFonts = false;
const requestedFonts = new Set<string>();
const permittedFonts = new Set([
  "NotoSansSC-500.woff",
  "NotoSansSC-700.woff",
  "NotoSansSC-800.woff",
  "NotoSansSC-900.woff",
  "Inter-var.woff",
  "RobotoCondensed-var.woff",
]);
beforeAll(async () => {
  bundle = (
    await build({
      stdin: {
        resolveDir: process.cwd(),
        loader: "tsx",
        contents: `import React from 'react';import{createRoot}from'react-dom/client';import Preview from './client/src/components/code-motion/CodeMotionPreview';createRoot(document.getElementById('root')).render(<Preview spec={globalThis.previewInput}/>);`,
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      define: { "process.env.NODE_ENV": '"development"' },
    })
  ).outputFiles[0].text;
  const root = path.resolve("client/public/art-motion/engine");
  server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url || "/", "http://localhost").pathname;
      if (pathname === "/") {
        res.setHeader("content-type", "text/html");
        res.end('<div id="root"></div>');
        return;
      }
      if (!pathname.startsWith("/art-motion/engine/"))
        throw Error("unknown path");
      const file = path.resolve(
        root,
        pathname.slice("/art-motion/engine/".length)
      );
      if (!file.startsWith(root + path.sep)) throw Error("invalid path");
      if (file.endsWith(".woff")) {
        requestedFonts.add(path.basename(file));
        if (rejectFonts || !permittedFonts.has(path.basename(file))) {
          res.writeHead(503).end();
          return;
        }
      }
      res.setHeader(
        "content-type",
        (
          {
            ".html": "text/html",
            ".js": "application/javascript",
            ".woff": "font/woff",
            ".json": "application/json",
          } as Record<string, string>
        )[path.extname(file)] || "application/octet-stream"
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise<void>(resolve => server?.close(() => resolve()));
});
for (const grammar of [
  "y5_kinetic_type",
  "t2_keynote_ui",
  "t3_finance_chart",
]) {
  it(`${grammar}真实预览不等待无关字体，播放时钟前进`, async () => {
    requestedFonts.clear();
    rejectFonts = false;
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    try {
      await page.evaluateOnNewDocument(
        spec => {
          (window as any).previewInput = spec;
        },
        {
          ...artMotionGrammarDraft(
            defaultArtMotionSpec(),
            grammar as Parameters<typeof artMotionGrammarDraft>[1]
          ),
          duration: 3,
          width: 1280,
          height: 720,
        }
      );
      await page.goto(origin);
      await page.addScriptTag({ content: bundle });
      await page.waitForSelector("button:not(:disabled)", { timeout: 10000 });
      expect(await page.$('[role="alert"]')).toBeNull();
      expect(Array.from(requestedFonts)).toHaveLength(3);
      expect(Array.from(requestedFonts).every(name => permittedFonts.has(name))).toBe(
        true
      );
      await page.click("button");
      await page.waitForFunction(
        () =>
          Number(
            (document.querySelector('input[type="range"]') as HTMLInputElement)
              .value
          ) > 0.15
      );
      const frame = page.frames().find(f => f.url().endsWith("studio.html"))!;
      expect(await frame.evaluate(() => (window as any).__productReady)).toBe(
        true
      );
      expect(errors).toEqual([]);
    } finally {
      await page.close();
    }
  }, 25000);
}
it("所需字体失败后显示错误，重开同一预览可恢复且不提交视频", async () => {
  rejectFonts = true;
  const page = await browser.newPage();
  try {
    await page.evaluateOnNewDocument(
      spec => {
        (window as any).previewInput = spec;
      },
      {
        ...defaultArtMotionSpec(),
        grammar: "y5_kinetic_type",
        duration: 3,
        width: 1280,
        height: 720,
      }
    );
    await page.goto(origin);
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector('[role="alert"]', { timeout: 10000 });
    const failedFrame = page
      .frames()
      .find(f => f.url().endsWith("studio.html"));
    rejectFonts = false;
    await page.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent === "重新打开预览")!
        .click()
    );
    await page.waitForSelector("button:not(:disabled) .sr-only", {
      timeout: 10000,
    });
    expect(await page.$('[role="alert"]')).toBeNull();
    expect(page.frames().find(f => f.url().endsWith("studio.html"))).not.toBe(
      failedFrame
    );
  } finally {
    rejectFonts = false;
    await page.close();
  }
}, 25000);
