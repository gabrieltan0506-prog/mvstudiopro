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
    import {prepareKnowledgeCardEpubFiles} from './client/src/lib/knowledgeCardEpubSource';
    import {parseEpub} from './client/src/lib/epubToPdf';
    Object.assign(globalThis,{saveEpubSource,loadEpubSource,convertEpubPdfParts,JSZip,prepareKnowledgeCardEpubFiles,parseEpub});
    globalThis.makeBook=async (large)=>{
      const zip=new JSZip(); zip.file("mimetype","application/epub+zip");
      zip.file("META-INF/container.xml",'<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>');
      zip.file("book.opf",'<package><metadata><title>书内标题</title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>');
      zip.file("b.xhtml","<html><body><h1>第一章</h1>"+(large?Array.from({length:24},(_,i)=>"<p>正文"+i+"-"+"汉".repeat(50000)+"</p>").join(""):"<p>短正文</p>")+"</body></html>");
      zip.file("a.xhtml","<html><body><h1>第二章</h1><p>全书终点</p></body></html>");
      return new File([await zip.generateAsync({type:"blob",compression:"DEFLATE"})],"原书名称.epub",{type:"application/epub+zip",lastModified:1234});
    };
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

describe("知识卡 EPUB 自动准备上传文件", () => {
  it("超过2MB的完整正文分片按序返回PDF，刷新复用旧面板账号缓存且不下载", async () => {
    const page = await open();
    try {
      const first = await page.evaluate(async () => {
        const api = globalThis as any;
        const file = await api.makeBook(true);
        const parsed = await api.parseEpub(await file.arrayBuffer());
        const sourceId = await api.saveEpubSource(file, "u9101");
        await api.convertEpubPdfParts({
          sourceId,
          scope: "u9101",
          title: parsed.title,
          parts: parsed.parts,
          renderPart: async (html: string) => {
            api.calls.push(html);
            return api.pdf("part-" + api.calls.length);
          },
        });
        return {
          calls: api.calls.length,
          total: parsed.parts.length,
          text: parsed.text.length,
        };
      });
      expect(first.total).toBeGreaterThan(1);
      expect(first.text).toBeGreaterThan(1200000);
      await reload(page);
      const result = await page.evaluate(async () => {
        const api = globalThis as any;
        HTMLAnchorElement.prototype.click = () => {
          throw Error("禁止下载");
        };
        const saved = await api.loadEpubSource("u9101");
        const files = await api.prepareKnowledgeCardEpubFiles({
          file: saved.file,
          userId: 9101,
          renderPart: async () => {
            throw Error("禁止重跑完成分片");
          },
          onProgress: (value: unknown) => api.progress.push(value),
        });
        return {
          files: await Promise.all(
            files.map(async (f: File) => ({
              name: f.name,
              type: f.type,
              lastModified: f.lastModified,
              text: await f.text(),
            }))
          ),
          progress: api.progress,
        };
      });
      expect(result.files).toHaveLength(first.total);
      expect(
        result.files.every(
          (
            file: {
              name: string;
              type: string;
              lastModified: number;
              text: string;
            },
            index: number
          ) =>
            file.name.startsWith(
              `原书名称-${String(index + 1).padStart(4, "0")}-第`
            ) &&
            file.type === "application/pdf" &&
            file.lastModified === 1234 &&
            file.text.includes(`%part-${index + 1}`)
        )
      ).toBe(true);
      expect(result.progress.at(-1)).toEqual({
        done: first.total,
        total: first.total,
      });
    } finally {
      await page.close();
    }
  });

  it("转换中断后保留原书和完成片，重试只转换缺失片", async () => {
    const page = await open();
    try {
      const result = await page.evaluate(async () => {
        const api = globalThis as any;
        const file = await api.makeBook(true);
        let calls = 0;
        let error = "";
        try {
          await api.prepareKnowledgeCardEpubFiles({
            file,
            userId: 9102,
            renderPart: async () => {
              calls++;
              if (calls === 2) throw Error("分片中断");
              return api.pdf("cached-first");
            },
          });
        } catch (e) {
          error = String(e);
        }
        const saved = await api.loadEpubSource("u9102");
        let retries = 0;
        const files = await api.prepareKnowledgeCardEpubFiles({
          file: saved.file,
          userId: 9102,
          renderPart: async () => {
            retries++;
            return api.pdf("remaining");
          },
        });
        return {
          error,
          calls,
          retries,
          count: files.length,
          first: await files[0].text(),
          source: saved.file.name,
        };
      });
      expect(result.error).toContain("分片中断");
      expect(result.calls).toBe(2);
      expect(result.retries).toBe(result.count - 1);
      expect(result.first).toContain("cached-first");
      expect(result.source).toBe("原书名称.epub");
    } finally {
      await page.close();
    }
  });

  it("单片返回原书名PDF；不完整PDF不得落完成缓存；账号分离", async () => {
    const page = await open();
    try {
      const result = await page.evaluate(async () => {
        const api = globalThis as any;
        const file = await api.makeBook(false);
        let error = "";
        let calls = 0;
        try {
          await api.prepareKnowledgeCardEpubFiles({
            file,
            userId: 9103,
            renderPart: async () => btoa("%PDF-1.4 incomplete document"),
          });
        } catch (e) {
          error = String(e);
        }
        const renderPart = async () => {
          calls++;
          return api.pdf("valid");
        };
        const files = await api.prepareKnowledgeCardEpubFiles({
          file,
          userId: 9103,
          renderPart,
        });
        await api.prepareKnowledgeCardEpubFiles({
          file,
          userId: 9104,
          renderPart,
        });
        let invalid = "";
        try {
          await api.prepareKnowledgeCardEpubFiles({
            file,
            userId: 0,
            renderPart,
          });
        } catch (e) {
          invalid = String(e);
        }
        return {
          error,
          calls,
          invalid,
          count: files.length,
          name: files[0].name,
          type: files[0].type,
        };
      });
      expect(result.error).toContain("PDF 不完整");
      expect(result.calls).toBe(2);
      expect(result.invalid).toContain("登录");
      expect(result.count).toBe(1);
      expect(result.name).toBe("原书名称.pdf");
      expect(result.type).toBe("application/pdf");
    } finally {
      await page.close();
    }
  });
});
