import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let server: Server;
let origin: string;
let bundle: string;
beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `
    import {saveEpubSource,loadEpubSource,convertEpubPdfParts} from './client/src/lib/epubPdfParts';
    import JSZip from 'jszip';
    Object.assign(globalThis,{saveEpubSource,loadEpubSource,convertEpubPdfParts,JSZip});
    globalThis.parts=[1,2,3].map(chapter=>({html:'<html><body>chapter-'+chapter+'</body></html>',chapterStart:chapter,chapterEnd:chapter}));
    globalThis.calls=[]; globalThis.progress=[];
    globalThis.pdf=(label)=>{
      let pdf='%PDF-1.4\\n'; const offsets=[0];
      const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] /Contents 4 0 R >>','<< /Length 0 >>\\nstream\\n\\nendstream'];
      objects.forEach((body,i)=>{offsets.push(pdf.length);pdf+=(i+1)+' 0 obj\\n'+body+'\\nendobj\\n';});
      const start=pdf.length; pdf+='xref\\n0 5\\n0000000000 65535 f \\n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \\n').join('');
      pdf+='trailer\\n<< /Size 5 /Root 1 0 R >>\\nstartxref\\n'+start+'\\n%%EOF\\n%'+label+'\\n';
      return btoa(pdf);
    };
  `,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  bundle = built.outputFiles[0].text;
  server = createServer((_req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>电子书离线检查点测试</title>");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("测试服务未启动");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});
async function open() {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on(
    "request",
    request =>
      void (request.url().startsWith(origin)
        ? request.continue()
        : request.abort())
  );
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  return page;
}
async function reload(page: Page) {
  await page.reload();
  await page.addScriptTag({ content: bundle });
}

describe("电子书分片真实离线 IndexedDB", () => {
  it("三片中第三片失败，刷新恢复仅转换第三片，ZIP依次包含三个有效PDF", async () => {
    const page = await open();
    try {
      const first = await page.evaluate(async () => {
        const api = globalThis as any;
        const scope = "test-resume";
        const sourceId = await api.saveEpubSource(
          new File(["test-original-epub-A"], "原电子书.epub", {
            type: "application/epub+zip",
            lastModified: 1234,
          }),
          scope
        );
        let error = "";
        try {
          await api.convertEpubPdfParts({
            sourceId,
            scope,
            title: "三章电子书",
            parts: api.parts,
            renderPart: async (html: string) => {
              api.calls.push(html);
              if (html.includes("chapter-3")) throw Error("测试第三片中断");
              return api.pdf(html);
            },
            onProgress: (progress: unknown) => api.progress.push(progress),
          });
        } catch (failure) {
          error = String(failure);
        }
        return { sourceId, error, calls: api.calls, progress: api.progress };
      });
      expect(first.error).toContain("第三片中断");
      expect(first.calls).toHaveLength(3);
      expect(first.progress.at(-1)).toEqual({ done: 2, total: 3 });
      await reload(page);
      const restored = await page.evaluate(async () => {
        const api = globalThis as any;
        const source = await api.loadEpubSource("test-resume");
        const result = await api.convertEpubPdfParts({
          sourceId: source.sourceId,
          scope: "test-resume",
          title: "三章电子书",
          parts: api.parts,
          renderPart: async (html: string) => {
            api.calls.push(html);
            return api.pdf(html);
          },
          onProgress: (progress: unknown) => api.progress.push(progress),
        });
        const zip = await api.JSZip.loadAsync(await result.blob.arrayBuffer());
        const entries = [];
        for (const file of Object.values(zip.files) as any[])
          if (!file.dir)
            entries.push({
              name: file.name,
              text: await file.async("string"),
              compression: Array.from(file._data.compression.magic).map(
                (c: any) => c.charCodeAt(0)
              ),
            });
        return {
          sourceId: source.sourceId,
          sourceName: source.file.name,
          sourceText: await source.file.text(),
          calls: api.calls,
          progress: api.progress,
          name: result.name,
          type: result.blob.type,
          count: result.partCount,
          entries,
        };
      });
      expect(restored.sourceId).toBe(first.sourceId);
      expect(restored.sourceName).toBe("原电子书.epub");
      expect(restored.sourceText).toBe("test-original-epub-A");
      expect(restored.calls).toEqual(["<html><body>chapter-3</body></html>"]);
      expect(restored.name).toBe("三章电子书-分片PDF.zip");
      expect(restored.type).toBe("application/zip");
      expect(restored.count).toBe(3);
      expect(restored.entries.map(entry => entry.name)).toEqual([
        "0001-第1至1章.pdf",
        "0002-第2至2章.pdf",
        "0003-第3至3章.pdf",
      ]);
      expect(
        restored.entries.every(
          entry =>
            entry.text.startsWith("%PDF-") &&
            entry.text.includes("%%EOF") &&
            entry.compression.join() === "0,0"
        )
      ).toBe(true);
      expect(restored.progress.at(-1)).toEqual({ done: 3, total: 3 });
    } finally {
      await page.close();
    }
  });

  it("来源变化隔离完成片；旧源仍可恢复，同字节另账号不共享来源和缓存", async () => {
    const page = await open();
    try {
      const result = await page.evaluate(async () => {
        const api = globalThis as any;
        const scope = "test-isolation";
        const first = await api.saveEpubSource(
          new File(["source-one"], "第一本.epub"),
          scope
        );
        const parts = api.parts.slice(0, 1);
        const renderer = async (html: string) => {
          api.calls.push(html);
          return api.pdf(html);
        };
        await api.convertEpubPdfParts({
          sourceId: first,
          scope,
          title: "第一本",
          parts,
          renderPart: renderer,
        });
        const second = await api.saveEpubSource(
          new File(["source-two"], "第二本.epub"),
          scope
        );
        await api.convertEpubPdfParts({
          sourceId: second,
          scope,
          title: "第二本",
          parts,
          renderPart: renderer,
        });
        await api.convertEpubPdfParts({
          sourceId: first,
          scope,
          title: "第一本",
          parts,
          renderPart: renderer,
        });
        const other = await api.saveEpubSource(
          new File(["source-one"], "其他账号.epub"),
          "test-other-user"
        );
        await api.convertEpubPdfParts({
          sourceId: other,
          scope: "test-other-user",
          title: "其他账号",
          parts,
          renderPart: renderer,
        });
        let crossError = "";
        try {
          await api.convertEpubPdfParts({
            sourceId: first,
            scope: "test-other-user",
            title: "不允许跨账号",
            parts,
            renderPart: renderer,
          });
        } catch (failure) {
          crossError = String(failure);
        }
        return {
          first,
          second,
          other,
          calls: api.calls,
          latest: (await api.loadEpubSource(scope)).file.name,
          otherLatest: (await api.loadEpubSource("test-other-user")).file.name,
          empty: await api.loadEpubSource("test-unused-user"),
          crossError,
        };
      });
      expect(new Set([result.first, result.second, result.other]).size).toBe(3);
      expect(result.calls).toHaveLength(3);
      expect(result.latest).toBe("第二本.epub");
      expect(result.otherLatest).toBe("其他账号.epub");
      expect(result.empty).toBeNull();
      expect(result.crossError).toContain("当前账号");
    } finally {
      await page.close();
    }
  });

  it("坏PDF不保存也不报告完成，再试必须重新转换，单片直接下载PDF", async () => {
    const page = await open();
    try {
      const result = await page.evaluate(async () => {
        const api = globalThis as any;
        const scope = "test-invalid-pdf";
        const sourceId = await api.saveEpubSource(
          new File(["test-book"], "原稿.epub"),
          scope
        );
        let error = "";
        try {
          await api.convertEpubPdfParts({
            sourceId,
            scope,
            title: "单章",
            parts: api.parts.slice(0, 1),
            renderPart: async () => {
              api.calls.push("bad");
              return btoa("<html>not a PDF</html>");
            },
            onProgress: (item: unknown) => api.progress.push(item),
          });
        } catch (failure) {
          error = String(failure);
        }
        const progress = [...api.progress];
        const output = await api.convertEpubPdfParts({
          sourceId,
          scope,
          title: "单章",
          parts: api.parts.slice(0, 1),
          renderPart: async () => {
            api.calls.push("good");
            return api.pdf("valid");
          },
        });
        await api.convertEpubPdfParts({
          sourceId,
          scope,
          title: "单章",
          parts: api.parts.slice(0, 1),
          renderPart: async () => {
            throw Error("完成片不能重跑");
          },
        });
        return {
          error,
          progress,
          calls: api.calls,
          name: output.name,
          type: output.blob.type,
          text: await output.blob.text(),
          partCount: output.partCount,
        };
      });
      expect(result.error).toContain("有效 PDF");
      expect(result.progress).toEqual([{ done: 0, total: 1 }]);
      expect(result.calls).toEqual(["bad", "good"]);
      expect(result.name).toBe("单章.pdf");
      expect(result.type).toBe("application/pdf");
      expect(result.text).toContain("%PDF-1.4");
      expect(result.partCount).toBe(1);
    } finally {
      await page.close();
    }
  });

  it("保存原书事务失败不切latest，分片存储失败不伪报检查点", async () => {
    const page = await open();
    try {
      const result = await page.evaluate(async () => {
        const api = globalThis as any;
        const scope = "test-quota";
        const original = await api.saveEpubSource(
          new File(["source-original"], "保留原书.epub"),
          scope
        );
        const nativeAdd = IDBObjectStore.prototype.add;
        let blockedStore = "sources";
        IDBObjectStore.prototype.add = function (
          ...args: Parameters<IDBObjectStore["add"]>
        ) {
          if (this.name === blockedStore)
            throw new DOMException("测试存储已满", "QuotaExceededError");
          return nativeAdd.apply(this, args);
        };
        let sourceError = "";
        let partError = "";
        try {
          try {
            await api.saveEpubSource(
              new File(["source-new"], "新书.epub"),
              scope
            );
          } catch (failure) {
            sourceError = String(failure);
          }
          blockedStore = "parts";
          try {
            await api.convertEpubPdfParts({
              sourceId: original,
              scope,
              title: "检查点",
              parts: api.parts.slice(0, 1),
              renderPart: async () => {
                api.calls.push("not-saved");
                return api.pdf("valid");
              },
              onProgress: (item: unknown) => api.progress.push(item),
            });
          } catch (failure) {
            partError = String(failure);
          }
        } finally {
          IDBObjectStore.prototype.add = nativeAdd;
        }
        const beforeRetry = [...api.progress];
        await api.convertEpubPdfParts({
          sourceId: original,
          scope,
          title: "检查点",
          parts: api.parts.slice(0, 1),
          renderPart: async () => {
            api.calls.push("retried");
            return api.pdf("valid");
          },
        });
        return {
          latest: (await api.loadEpubSource(scope)).sourceId,
          original,
          sourceError,
          partError,
          beforeRetry,
          calls: api.calls,
        };
      });
      expect(result.latest).toBe(result.original);
      expect(result.sourceError).toContain("存储不可用或空间不足");
      expect(result.partError).toContain("存储不可用或空间不足");
      expect(result.beforeRetry).toEqual([{ done: 0, total: 1 }]);
      expect(result.calls).toEqual(["not-saved", "retried"]);
    } finally {
      await page.close();
    }
  });

  it("同源HTML改变仅转换新版，旧完成片保留，同字节原书ID稳定", async () => {
    const page = await open();
    try {
      const result = await page.evaluate(async () => {
        const api = globalThis as any;
        const scope = "test-html-version";
        const sourceId = await api.saveEpubSource(
          new File(["same-book"], "旧名称.epub"),
          scope
        );
        const renderer = async (html: string) => {
          api.calls.push(html);
          return api.pdf(html);
        };
        const original = [
          { html: "<html>original</html>", chapterStart: 1, chapterEnd: 1 },
        ];
        const changed = [{ ...original[0], html: "<html>revised</html>" }];
        await api.convertEpubPdfParts({
          sourceId,
          scope,
          title: "原书",
          parts: original,
          renderPart: renderer,
        });
        await api.convertEpubPdfParts({
          sourceId,
          scope,
          title: "原书",
          parts: changed,
          renderPart: renderer,
        });
        await api.convertEpubPdfParts({
          sourceId,
          scope,
          title: "原书",
          parts: original,
          renderPart: renderer,
        });
        const renamedId = await api.saveEpubSource(
          new File(["same-book"], "新名称.epub"),
          scope
        );
        return {
          sourceId,
          renamedId,
          latestName: (await api.loadEpubSource(scope)).file.name,
          calls: api.calls,
        };
      });
      expect(result.calls).toEqual([
        "<html>original</html>",
        "<html>revised</html>",
      ]);
      expect(result.renamedId).toBe(result.sourceId);
      expect(result.latestName).toBe("新名称.epub");
    } finally {
      await page.close();
    }
  });

  it("IndexedDB不可用时明确失败，不能调用转换服务", async () => {
    const page = await open();
    try {
      const result = await page.evaluate(async () => {
        const api = globalThis as any;
        Object.defineProperty(globalThis, "indexedDB", {
          configurable: true,
          value: undefined,
        });
        let error = "";
        try {
          await api.loadEpubSource("test-disabled");
        } catch (failure) {
          error = String(failure);
        }
        return { error, calls: api.calls };
      });
      expect(result.error).toContain("存储不可用");
      expect(result.calls).toEqual([]);
    } finally {
      await page.close();
    }
  });
});
