import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, {
  type Browser,
  type BrowserContext,
  type Page,
} from "puppeteer";
import path from "node:path";

// 完全离线的独立无头浏览器；不连接用户窗口、生产站点或供应商。
const ORIGIN = "http://localhost:41799";
const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==";
let browser: Browser;
let fixture: string;

beforeAll(async () => {
  const bundled = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { ManhuaAssetImage } from './client/src/components/ManhuaAssetImage';
        import { assertManhuaBackupImage } from './client/src/lib/manhuaBackupImageValidation';
        import { importLocalMediaRecords, getLocalMediaRecordBySource,
          MANHUA_LOCAL_MEDIA_DB, MANHUA_LOCAL_MEDIA_STORE } from './client/src/lib/manhuaLocalMediaStore';
        const root = createRoot(document.getElementById('root'));
        const f = globalThis.fixture = { loads: [], errors: [], created: [], revoked: [] };
        const createUrl = URL.createObjectURL.bind(URL);
        const revokeUrl = URL.revokeObjectURL.bind(URL);
        URL.createObjectURL = blob => { const url = createUrl(blob); f.created.push(url); return url; };
        URL.revokeObjectURL = url => { f.revoked.push(url); revokeUrl(url); };
        f.png = (type = 'image/png') => new Blob([
          Uint8Array.from(atob(${JSON.stringify(PNG_BASE64)}), c => c.charCodeAt(0))
        ], {type});
        f.importRecords = importLocalMediaRecords;
        f.validate = assertManhuaBackupImage;
        f.read = getLocalMediaRecordBySource;
        f.renderSource = source => {
          f.reference = Object.freeze({ id: 'test-asset', url: source });
          root.render(<ManhuaAssetImage src={f.reference.url} alt="恢复的墨屠参考"
            onLoad={event => f.loads.push({ width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight, src: event.currentTarget.getAttribute('src') })}
            onError={event => f.errors.push({ src: event.currentTarget.getAttribute('src') })}/>);
        };
        f.unmountImage = () => root.render(null);
        f.readAll = async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open(MANHUA_LOCAL_MEDIA_DB, 1);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          try {
            const records = await new Promise((resolve, reject) => {
              const request = db.transaction(MANHUA_LOCAL_MEDIA_STORE, 'readonly')
                .objectStore(MANHUA_LOCAL_MEDIA_STORE).getAll();
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            });
            return Promise.all(records.map(async record => ({ id: record.id, sourceUrl: record.sourceUrl,
              mime: record.mime, updatedAt: record.updatedAt, bytes: Array.from(new Uint8Array(await record.blob.arrayBuffer())) })));
          } finally { db.close(); }
        };
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@shared": path.resolve("shared"),
      "@": path.resolve("client/src"),
    },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  fixture = bundled.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);

afterAll(async () => {
  await browser?.close();
});

async function openFixture(
  renewImages = false
): Promise<{ page: Page; context: BrowserContext; signRequests: string[] }> {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  const signRequests: string[] = [];
  await page.setRequestInterception(true);
  page.on("request", request => {
    const url = request.url();
    if (renewImages && url.includes("op=materialReadUrl")) {
      const uri = new URL(url).searchParams.get("gcsUri")!;
      signRequests.push(uri);
      void request.respond({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          url: `https://storage.googleapis.com/${uri.slice(5)}?renewed=yes`,
        }),
      });
    } else if (
      renewImages &&
      url.startsWith("https://storage.googleapis.com/")
    ) {
      void request.respond(
        url.includes("renewed=yes")
          ? {
              status: 200,
              contentType: "image/png",
              body: Buffer.from(PNG_BASE64, "base64"),
            }
          : { status: 403, body: "expired" }
      );
    } else if (url.startsWith("blob:") || url.startsWith("data:")) {
      void request.continue();
    } else if (new URL(url).origin === ORIGIN) {
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>',
      });
    } else {
      void request.abort();
    }
  });
  await page.goto(`${ORIGIN}/backup-test`, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: fixture });
  return { page, context, signRequests };
}

describe("工作区备份真实浏览器恢复（完全离线）", () => {
  it.each([false, true])(
    "过期图片本机坏字节=%s时续签后真实解码，原引用与IDB不改写",
    async brokenLocal => {
      const { page, context, signRequests } = await openFixture(true);
      try {
        const source =
          "https://storage.googleapis.com/test-bucket/renewal.png?X-Goog-Signature=expired";
        await page.evaluate(`fixture.read(${JSON.stringify(source)})`);
        if (brokenLocal) {
          await page.evaluate(`fixture.importRecords([{ sourceUrl:${JSON.stringify(source)},
          blob:new Blob(['not-png'], {type:'image/png'}), mime:'image/png' }])`);
        }
        const before = await page.evaluate("fixture.readAll()");
        await page.evaluate(`fixture.renderSource(${JSON.stringify(source)})`);
        await page.waitForFunction("fixture.loads.length === 1", {
          timeout: 5000,
        });
        expect(await page.evaluate("fixture.loads[0]")).toMatchObject({
          width: 1,
          height: 1,
          src: "https://storage.googleapis.com/test-bucket/renewal.png?renewed=yes",
        });
        expect(signRequests).toEqual(["gs://test-bucket/renewal.png"]);
        expect(await page.evaluate("fixture.reference.url")).toBe(source);
        expect(await page.evaluate("fixture.errors")).toEqual([]);
        expect(await page.evaluate("fixture.readAll()")).toEqual(before);
      } finally {
        await context.close();
      }
    },
    20000
  );

  it("真实IDB写入及同源刷新后，新签名和gs来源均显示原PNG，canonical引用不变", async () => {
    const { page, context } = await openFixture();
    try {
      const oldUrl =
        "https://storage.googleapis.com/test-bucket/board.png?test-signature=old";
      const freshUrl =
        "https://storage.googleapis.com/test-bucket/board.png?test-signature=new";
      expect(
        await page.evaluate(`fixture.importRecords([{ sourceUrl:${JSON.stringify(oldUrl)},
        gcsUri:'gs://test-bucket/board.png', blob:fixture.png(), mime:'image/png' }])`)
      ).toBe(1);
      const before = await page.evaluate("fixture.readAll()");
      expect(before).toHaveLength(2);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: fixture });
      expect(await page.evaluate("fixture.readAll()")).toEqual(before);
      await page.evaluate(`fixture.renderSource(${JSON.stringify(freshUrl)})`);
      await page.waitForFunction("fixture.loads.length === 1", {
        timeout: 5000,
      });
      expect(await page.evaluate("fixture.loads[0]")).toMatchObject({
        width: 1,
        height: 1,
      });
      expect(
        await page.evaluate("fixture.loads[0].src.startsWith('blob:')")
      ).toBe(true);
      expect(await page.evaluate("fixture.reference.url")).toBe(freshUrl);
      expect(await page.evaluate("fixture.errors")).toEqual([]);
      await page.evaluate("fixture.renderSource('gs://test-bucket/board.png')");
      await page.waitForFunction("fixture.loads.length === 2", {
        timeout: 5000,
      });
      expect(await page.evaluate("fixture.loads[1]")).toMatchObject({
        width: 1,
        height: 1,
      });
      expect(await page.evaluate("fixture.reference.url")).toBe(
        "gs://test-bucket/board.png"
      );
      await page.evaluate("fixture.unmountImage()");
      await page.waitForFunction(
        "fixture.created.length === fixture.revoked.length",
        { timeout: 5000 }
      );
      expect(await page.evaluate("fixture.readAll()")).toEqual(before);
    } finally {
      await context.close();
    }
  }, 15000);

  it("实际图片解码接受PNG和ZIP无类型SVG，拒绝损坏字节与HTML并回收URL", async () => {
    const { page, context } = await openFixture();
    try {
      const result = await page.evaluate(`(async () => {
        const outcomes = [];
        const inputs = [
          ['png', fixture.png(), 'image/png'],
          ['svg', new Blob(['<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>']), 'image/svg+xml'],
          ['broken', new Blob(['broken-png-bytes'], {type:'image/png'}), 'image/png'],
          ['html', new Blob(['<html>error response</html>'], {type:'text/html'}), 'image/png']
        ];
        for (const [name, blob, mime] of inputs) {
          try { await fixture.validate(blob,mime); outcomes.push({ name, ok:true }); }
          catch (error) { outcomes.push({name, ok:false, error:error.message}); }
        }
        return {outcomes, created:fixture.created.length, revoked:fixture.revoked.length};
      })()`);
      expect(result).toMatchObject({
        outcomes: [
          { name: "png", ok: true },
          { name: "svg", ok: true },
          {
            name: "broken",
            ok: false,
            error: "备份图片无法读取或已损坏，请保留原文件并检查来源",
          },
          {
            name: "html",
            ok: false,
            error: "备份文件不是图片内容，请检查是否误存了错误页面",
          },
        ],
        created: 3,
        revoked: 3,
      });
    } finally {
      await context.close();
    }
  }, 15000);

  it("第二次add触发真实IDB事务abort，零半包且已有记录字节与元数据不变", async () => {
    const { page, context } = await openFixture();
    try {
      await page.evaluate(
        "fixture.importRecords([{sourceUrl:'https://test.invalid/existing.png',blob:fixture.png(),mime:'image/png'}])"
      );
      const before = await page.evaluate("fixture.readAll()");
      expect(before).toHaveLength(1);
      const result = await page.evaluate(`(async () => {
        const original = IDBObjectStore.prototype.add;
        let calls = 0;
        IDBObjectStore.prototype.add = function(...args) {
          const request = Reflect.apply(original,this,args);
          if (++calls === 2) this.transaction.abort();
          return request;
        };
        let error = '';
        try {
          await fixture.importRecords([
            {sourceUrl:'https://test.invalid/new-a.png',blob:fixture.png(),mime:'image/png'},
            {sourceUrl:'https://test.invalid/new-b.png',blob:fixture.png(),mime:'image/png'}
          ]);
        } catch (failure) { error = failure.message; }
        finally { IDBObjectStore.prototype.add = original; }
        return {calls,error, a:await fixture.read('https://test.invalid/new-a.png'),
          b:await fixture.read('https://test.invalid/new-b.png')};
      })()`);
      expect(result).toMatchObject({ calls: 2, a: null, b: null });
      expect(result).toMatchObject({
        error: expect.stringMatching(/备份图片写入.*尚未恢复工作区/),
      });
      expect(await page.evaluate("fixture.readAll()")).toEqual(before);
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.addScriptTag({ content: fixture });
      expect(await page.evaluate("fixture.readAll()")).toEqual(before);
    } finally {
      await context.close();
    }
  }, 15000);
});
