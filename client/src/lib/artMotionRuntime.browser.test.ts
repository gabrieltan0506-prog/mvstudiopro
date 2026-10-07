/** Development-only real bundled Canvas probe. No model calls, production credentials or workspaces. */
import { beforeAll, afterAll, expect, it } from "vitest";
import puppeteer, { type Browser } from "puppeteer";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  ART_MOTION_STYLES,
  ART_MOTION_GRAMMARS,
} from "../../../shared/artMotionCatalog";
import {
  defaultArtMotionSpec,
  artMotionGrammarDraft,
} from "../../../shared/artMotion";
let browser: Browser, server: Server, origin: string;
beforeAll(async () => {
  const root = path.resolve("client/public/art-motion/engine");
  server = createServer(async (req, res) => {
    try {
      const name = decodeURIComponent(
          new URL(req.url || "/", "http://localhost").pathname
        ).slice(1),
        file = path.resolve(root, name);
      if (!file.startsWith(root + path.sep)) throw new Error("invalid");
      const mime: Record<string, string> = {
        ".html": "text/html",
        ".js": "application/javascript",
        ".json": "application/json",
        ".woff2": "font/woff2",
        ".woff": "font/woff",
        ".png": "image/png",
      };
      res.setHeader(
        "content-type",
        mime[path.extname(file)] || "application/octet-stream"
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const address = server.address() as { port: number };
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
  server?.closeAllConnections();
  await new Promise<void>(r => server?.close(() => r()));
});
async function probe(spec: unknown) {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on(
    "request",
    r => void (r.url().startsWith(origin + "/") ? r.continue() : r.abort())
  );
  try {
    await page.evaluateOnNewDocument(s => {
      (window as any).__ART_SPEC = s;
    }, spec);
    await page.goto(origin + "/studio.html");
    await page.waitForFunction("window.__productReady || window.__bootFailed", {
      timeout: 25000,
    });
    const result = await page.evaluate(() => {
      const w = window as any;
      if (w.__bootFailed) return { failed: w.__bootFailed };
      const signatures = [0, 1, 3].map(t => {
        w.renderFrame(t);
        const pixels = w.__canvas
          .getContext("2d")
          .getImageData(0, 0, w.__canvas.width, w.__canvas.height).data;
        let h = 0,
          visible = 0;
        for (let i = 0; i < pixels.length; i += 64) {
          h =
            (Math.imul(h, 31) + pixels[i] + pixels[i + 1] + pixels[i + 2]) >>>
            0;
          if (pixels[i + 3]) visible++;
        }
        return { h, visible };
      });
      return { width: w.__canvas.width, height: w.__canvas.height, signatures };
    });
    expect(errors).toEqual([]);
    expect(result.failed).toBeUndefined();
    expect(result.width).toBe((spec as any).width);
    expect(result.height).toBe((spec as any).height);
    expect(result.signatures!.some(s => s.visible > 0)).toBe(true);
    expect(new Set(result.signatures!.map(s => s.h)).size).toBeGreaterThan(1);
  } finally {
    await page.close();
  }
}
for (const style of ART_MOTION_STYLES)
  it(
    `bundled art ${style.id} renders changing frames`,
    async () =>
      probe({
        ...defaultArtMotionSpec(),
        mode: "art",
        duration: 4,
        scenes: [{ style: style.id, duration: 4, transition: "none" }],
      }),
    40000
  );
for (const grammar of ART_MOTION_GRAMMARS)
  it(
    `bundled grammar ${grammar.id} renders portrait text/data`,
    async () =>
      probe({
        ...artMotionGrammarDraft(defaultArtMotionSpec(), grammar.id),
        width: 720,
        height: 1280,
      }),
    40000
  );
it(
  "composed ink and pixel scenes execute transition frames",
  async () =>
    probe({
      ...defaultArtMotionSpec(),
      mode: "art",
      duration: 4,
      scenes: [
        { style: "17_ink", duration: 2, transition: "none" },
        { style: "14_8bit", duration: 2, transition: "inkBloom" },
      ],
    }),
  40000
);

it(
  "constant and zero chart values remain finite across frames",
  async () =>
    probe({
      ...artMotionGrammarDraft(defaultArtMotionSpec(), "t3_finance_chart"),
      data: {
        title: "零值",
        chart: "bar",
        series: [
          { label: "甲", value: 0 },
          { label: "乙", value: 0 },
        ],
      },
    }),
  40000
);
it(
  "hardened clip loader renders after removing demo URL loading",
  async () => probe(defaultArtMotionSpec()),
  40000
);
it("hardened clip loader refuses arbitrary grammar scripts", async () => {
  const page = await browser.newPage();
  const requests: string[] = [];
  page.on("request", r => requests.push(r.url()));
  try {
    await page.goto(origin + "/studio.html");
    await page.evaluate(async () => {
      (window as any).CLIP_SPEC = { grammar: "../../external", duration: 1 };
      await new Promise<void>((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "clip.js";
        script.onload = () => resolve();
        script.onerror = () => reject(new Error("load failed"));
        document.head.appendChild(script);
      });
    });
    await page.waitForFunction("window.__bootFailed");
    expect(await page.evaluate(() => (window as any).__bootFailed)).toBe(
      "动画样式无效"
    );
    expect(requests.some(url => url.includes("external"))).toBe(false);
  } finally {
    await page.close();
  }
}, 40000);
