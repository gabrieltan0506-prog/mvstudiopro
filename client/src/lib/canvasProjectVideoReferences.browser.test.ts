import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

// 独立离线浏览器，使用真实选择组件、选择逻辑及云草稿转换；禁止外部请求。
const ORIGIN = "http://localhost:41803";
let browser: Browser;
let bundle: string;

beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { CanvasProjectVideoReferencePicker } from './client/src/components/canvas/CanvasProjectVideoReferencePicker';
        import { toggleProjectVideoReference, projectVideoReferenceUrls } from './client/src/lib/canvasProjectVideoReferences';
        import { defaultCanvasBlock } from './client/src/lib/canvasTypes';
        import { blocksForCloudDraftSync, cloudDraftBlocksToCanvas } from './client/src/lib/manhuaCloudDraftSync';
        import { buildManhuaCloudDraftPayload } from './shared/manhuaCloudDraft';
        const f = globalThis.fixture = { clicks: [], failures: [], network: 0 };
        window.fetch = async () => { f.network++; throw Error('禁止真实网络'); };
        const initialRefs = [1,2,3,4].map(id => ({
          id: 'test-' + id, role: 'character', labelZh: '测试图' + id,
          url: 'https://storage.googleapis.com/test-bucket/generated/offline/' + id + '.png?signature=test-old',
          gcsUri: 'gs://test-bucket/generated/offline/' + id + '.png',
          ...(id === 4 ? {reviewStatus: 'needs_review'} : {})
        }));
        function App() {
          const [refs, setRefs] = useState(initialRefs);
          const [block, setBlock] = useState({...defaultCanvasBlock('video',0,0), id:'video-offline', videoModel:'seedance-2.0-mini'});
          const [disabled, setDisabled] = useState(false);
          f.urls = projectVideoReferenceUrls(block);
          f.block = block;
          f.configure = patch => setBlock(previous => ({...previous, ...patch}));
          f.disable = setDisabled;
          f.clearRefs = () => setRefs([]);
          f.restore = () => {
            const draft = buildManhuaCloudDraftPayload({clientUpdatedAt:'2026-09-08T00:00:00Z',writerSession:{},blocks:blocksForCloudDraftSync([block]),edges:[]});
            setBlock(cloudDraftBlocksToCanvas(draft.canvas.blocks)[0]);
          };
          return <CanvasProjectVideoReferencePicker block={block} refs={refs} disabled={disabled || block.status === 'running'} onToggle={ref => {
            f.clicks.push(ref.id);
            setBlock(previous => {
              try { return toggleProjectVideoReference(previous, ref); }
              catch(error) { f.failures.push(error.message); return previous; }
            });
          }} />;
        }
        createRoot(document.getElementById('root')).render(<App />);
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);

afterAll(async () => {
  await browser?.close();
});

async function fixture() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const unexpected: string[] = [];
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.isNavigationRequest() && request.url() === `${ORIGIN}/`) {
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><html><head><link rel="icon" href="data:,"></head><body><div id="root"></div></body></html>',
      });
    } else if (
      request.resourceType() === "image" &&
      request
        .url()
        .startsWith(
          "https://storage.googleapis.com/test-bucket/generated/offline/"
        )
    ) {
      // 虚构图片由内存响应，不向 GCS 发请求。
      void request.respond({
        status: 200,
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="white"/></svg>',
      });
    } else {
      unexpected.push(request.url());
      void request.abort();
    }
  });
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("summary");
  await page.click("summary");
  return { page, context, unexpected };
}

const add = (id: number) => `[aria-label="引用资产 测试图${id}"]`;
const remove = (id: number) => `[aria-label="移除资产 测试图${id}"]`;

describe("已有资产选择器真实交互（离线）", () => {
  it("点击顺序写入真实字段，移除首图顺移，云恢复仍能识别和取消", async () => {
    const s = await fixture();
    try {
      await s.page.click(add(2));
      await s.page.waitForSelector(remove(2));
      await s.page.click(add(1));
      await s.page.waitForSelector(remove(1));
      expect(
        await s.page.evaluate(
          "fixture.urls.map(url => url.match(/offline\\/(\\d+)/)[1])"
        )
      ).toEqual(["2", "1"]);
      expect(await s.page.$eval(remove(1), el => el.textContent)).toContain(
        "参考图 2"
      );
      await s.page.click(remove(2));
      await s.page.waitForSelector(add(2));
      expect(await s.page.$eval(remove(1), el => el.textContent)).toContain(
        "参考图 1"
      );
      await s.page.evaluate("fixture.restore()");
      await s.page.waitForFunction(
        "fixture.block.refImageUrl.startsWith('/api/canvas-media/')"
      );
      expect(await s.page.evaluate("fixture.block.uploadedAssets")).toEqual([]);
      expect(
        await s.page.$eval(remove(1), el => el.getAttribute("aria-pressed"))
      ).toBe("true");
      await s.page.click(remove(1));
      await s.page.waitForSelector(add(1));
      expect(await s.page.evaluate("fixture.urls")).toEqual([]);
      expect(await s.page.evaluate("fixture.clicks")).toEqual([
        "test-2",
        "test-1",
        "test-2",
        "test-1",
      ]);
      expect(await s.page.evaluate("fixture.failures")).toEqual([]);
      expect(await s.page.evaluate("fixture.network")).toBe(0);
      expect(s.unexpected).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it("两图模式满额禁用新增但保留移除，文生模式不允许偷偷加图", async () => {
    const s = await fixture();
    try {
      await s.page.evaluate(
        "fixture.configure({videoModel:'seedance-2.5',seedance25WorkMode:'image_to_video'})"
      );
      await s.page.waitForFunction(
        "document.querySelector('summary').textContent.includes('/2')"
      );
      await s.page.click(add(1));
      await s.page.waitForSelector(remove(1));
      await s.page.click(add(2));
      await s.page.waitForSelector(remove(2));
      expect(
        await s.page.$eval(add(3), el => (el as HTMLButtonElement).disabled)
      ).toBe(true);
      await s.page.click(add(3));
      expect(await s.page.evaluate("fixture.clicks")).toEqual([
        "test-1",
        "test-2",
      ]);
      expect(
        await s.page.$eval(remove(1), el => (el as HTMLButtonElement).disabled)
      ).toBe(false);
      await s.page.evaluate(
        "fixture.configure({seedance25WorkMode:'text_to_video'})"
      );
      await s.page.waitForFunction(
        "document.querySelector('summary').textContent.includes('/0')"
      );
      expect(
        await s.page.$eval(add(3), el => (el as HTMLButtonElement).disabled)
      ).toBe(true);
      await s.page.click(remove(1));
      await s.page.waitForSelector(add(1));
      expect(
        await s.page.$eval(add(1), el => (el as HTMLButtonElement).disabled)
      ).toBe(true);
      expect(s.unexpected).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it("待审图片与运行态不能点击，空资产完全隐藏入口", async () => {
    const s = await fixture();
    try {
      expect(
        await s.page.$eval(add(4), el => (el as HTMLButtonElement).disabled)
      ).toBe(true);
      await s.page.click(add(4));
      expect(await s.page.evaluate("fixture.clicks")).toEqual([]);
      await s.page.evaluate("fixture.configure({status:'running'})");
      await s.page.waitForFunction(
        "Array.from(document.querySelectorAll('button')).every(button => button.disabled)"
      );
      await s.page.click(add(1));
      expect(await s.page.evaluate("fixture.clicks")).toEqual([]);
      await s.page.evaluate("fixture.clearRefs()");
      await s.page.waitForSelector("summary", { hidden: true });
      expect(await s.page.$("#root button")).toBeNull();
      expect(await s.page.evaluate("fixture.network")).toBe(0);
      expect(s.unexpected).toEqual([]);
    } finally {
      await s.context.close();
    }
  });
});
