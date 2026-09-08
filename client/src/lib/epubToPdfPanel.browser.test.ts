import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer";
import JSZip from "jszip";
import PDFDocument from "pdfkit";

let browser: Browser;
let server: Server;
let origin: string;
let bundle: string;
let directory: string;
let largePath: string;
let smallPath: string;
let largeBytes: number;
const pdfs: Record<number, Buffer> = {};
async function fixturePdf(chapter: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const document = new PDFDocument({ size: "A4", margin: 30 });
    const buffers: Buffer[] = [];
    document.on("data", chunk => buffers.push(Buffer.from(chunk)));
    document.on("error", reject);
    document.on("end", () => resolve(Buffer.concat(buffers)));
    document.text(`Offline fixture chapter ${chapter}`);
    document.end();
  });
}
async function fixtureBook(large: boolean) {
  const zip = new JSZip();
  const chapters = large ? 3 : 1;
  zip.file("mimetype", "application/epub+zip");
  zip.file("META-INF/container.xml", '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>');
  zip.file("OEBPS/book.opf", `<package><metadata><title>${large ? "Panel Big Book" : "Panel Small Book"}</title></metadata><manifest>${Array.from({ length: chapters }, (_, i) => `<item id="chapter-${i + 1}" href="chapter-${i + 1}.xhtml" media-type="application/xhtml+xml"/>`).join("")}</manifest><spine>${Array.from({ length: chapters }, (_, i) => `<itemref idref="chapter-${i + 1}"/>`).join("")}</spine></package>`);
  for (let chapter = 1; chapter <= chapters; chapter++) zip.file(`OEBPS/chapter-${chapter}.xhtml`, `<html><body><h1>Chapter ${chapter}</h1><p>${large ? `chapter-${chapter}-text `.repeat(75_000) : "正文异步导入需要等待结果"}</p></body></html>`);
  // 未压缩的真实归档超过旧20MB门槛；正文自身也超过2MB，并真实经过解析器分片。
  if (large) zip.file("OEBPS/embedded-data.bin", new Uint8Array(21 * 1024 * 1024));
  return zip.generateAsync({ type: "nodebuffer", compression: "STORE" });
}
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "epub-panel-browser-"));
  largePath = join(directory, "over-20mb.epub");
  smallPath = join(directory, "small.epub");
  const large = await fixtureBook(true);
  largeBytes = large.byteLength;
  await writeFile(largePath, large);
  await writeFile(smallPath, await fixtureBook(false));
  for (const chapter of [1, 2, 3]) pdfs[chapter] = await fixturePdf(chapter);
  const output = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import {EpubToPdfPanel} from './client/src/components/platform/EpubToPdfPanel';
      globalThis.pdfCalls=[];globalThis.importCalls=[];globalThis.failAt=3;globalThis.rejectImport=false;
      globalThis.fixturePdfs=${JSON.stringify(Object.fromEntries(Object.entries(pdfs).map(([key, value]) => [key, value.toString("base64")])))};
      globalThis.fakePdf=async input=>{
        const chapter=Number(input.html.match(/<h1>Chapter ([0-9]+)<\\/h1>/)?.[1]);
        if(!chapter)throw Error('真实分片缺少章节标题');
        pdfCalls.push({chapter,htmlBytes:new TextEncoder().encode(input.html).length,token:input.token});
        if(chapter===failAt)throw Error('测试第三片远程转换失败');
        return {pdfBase64:fixturePdfs[chapter]};
      };
      const root=createRoot(document.getElementById('root'));
      globalThis.mount=(userId)=>root.render(React.createElement(EpubToPdfPanel,{userId,onImportText:async(text,title)=>{
        importCalls.push({text,title});
        await new Promise(resolve=>setTimeout(resolve,30));
        if(rejectImport)throw Error('测试正文异步导入失败');
      }}));
    ` },
    plugins: [{ name: "only-pdf-remote-stub", setup(build) {
      build.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({ path: "pdf-remote", namespace: "offline-remote" }));
      build.onLoad({ filter: /.*/, namespace: "offline-remote" }, () => ({ contents: "export const trpc={mvAnalysis:{downloadPlatformPdf:{useMutation:()=>({mutateAsync:input=>globalThis.fakePdf(input)})}}};", loader: "js" }));
    } }],
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  });
  bundle = output.outputFiles[0].text;
  server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end('<!doctype html><div id="root"></div>'); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("本地测试服务未启动");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true });
}, 60000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});
async function mount(page: Page, userId: number) {
  await page.addScriptTag({ content: bundle });
  await page.evaluate(userId => (globalThis as any).mount(userId), userId);
  await page.waitForFunction(() => { const input = document.querySelector('input[type="file"]') as HTMLInputElement | null; return input && !input.disabled; });
}
async function open(userId: number) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => void (request.url().startsWith(origin) || request.url().startsWith("blob:") ? request.continue() : request.abort()));
  const cdp = await page.createCDPSession();
  await cdp.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: directory });
  await page.goto(origin); await mount(page, userId);
  return page;
}
async function click(page: Page, text: string) {
  await page.evaluate(text => { const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes(text)); if (!button || button.disabled) throw Error(`按钮当前不可用：${text}`); button.click(); }, text);
}
async function upload(page: Page, path: string) {
  const input = await page.$('input[type="file"]');
  if (!input) throw Error("真实文件上传入口不存在");
  await input.uploadFile(path);
  await page.waitForFunction(() => document.body.textContent?.includes("当前素材：") && !(document.querySelector('input[type="file"]') as HTMLInputElement).disabled, { timeout: 45000 });
}

describe("EPUB真实面板与解析器/IndexedDB集成（仅替换PDF远程函数）", () => {
  it("真实上传超过20MB且正文超过2MB，失败刷新仅补缺片并下载有序真实PDF ZIP", async () => {
    expect(largeBytes).toBeGreaterThan(20 * 1024 * 1024);
    const page = await open(92001);
    try {
      await upload(page, largePath);
      expect(await page.$eval("section", section => section.textContent)).toContain("3 章");
      await click(page, "转换并下载 PDF");
      await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("测试第三片远程转换失败"), { timeout: 45000 });
      const firstCalls = await page.evaluate(() => (globalThis as any).pdfCalls as Array<{ chapter: number; htmlBytes: number; token: string }>);
      expect(firstCalls.map(call => call.chapter)).toEqual([1, 2, 3]);
      expect(firstCalls.reduce((sum, call) => sum + call.htmlBytes, 0)).toBeGreaterThan(2 * 1024 * 1024);
      expect(firstCalls.every(call => call.htmlBytes <= 2 * 1024 * 1024 && call.token === "epub-convert")).toBe(true);
      expect(await readdir(directory)).not.toContain("Panel Big Book-分片PDF.zip");
      await page.reload(); await mount(page, 92001);
      await page.waitForFunction(() => document.body.textContent?.includes("已恢复上次电子书") && !(document.querySelector('input[type="file"]') as HTMLInputElement).disabled, { timeout: 45000 });
      expect(await page.$eval("section", section => section.textContent)).toContain("over-20mb.epub");
      await page.evaluate(() => { (globalThis as any).failAt = 0; });
      await click(page, "转换并下载 PDF");
      await page.waitForFunction(() => document.body.textContent?.includes("全部 3 个分片已转换"), { timeout: 45000 });
      const resumedCalls = await page.evaluate(() => (globalThis as any).pdfCalls);
      expect(resumedCalls.map((call: { chapter: number }) => call.chapter)).toEqual([3]);
      await expect.poll(async () => readdir(directory), { timeout: 10000 }).toContain("Panel Big Book-分片PDF.zip");
      const zip = await JSZip.loadAsync(await readFile(join(directory, "Panel Big Book-分片PDF.zip")));
      const names = Object.values(zip.files).filter(file => !file.dir).map(file => file.name);
      expect(names).toEqual(["0001-第1至1章.pdf", "0002-第2至2章.pdf", "0003-第3至3章.pdf"]);
      for (let index = 0; index < names.length; index++) {
        const name = names[index];
        const bytes = await zip.file(name)!.async("nodebuffer");
        expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
        expect(bytes).toEqual(pdfs[index + 1]);
      }
    } finally { await page.close(); }
  }, 90000);

  it("异步导入正文拒绝时显示失败，保留原书且不误报导入成功", async () => {
    const page = await open(92002);
    try {
      await upload(page, smallPath);
      await page.evaluate(() => { (globalThis as any).rejectImport = true; });
      await click(page, "正文送入图文笔记");
      await page.waitForFunction(() => document.querySelector('[role="alert"]')?.textContent?.includes("测试正文异步导入失败"));
      const text = await page.$eval("section", section => section.textContent || "");
      expect(text).toContain("当前素材：small.epub");
      expect(text).not.toContain("正文阅读已结束");
      expect(text).not.toContain("已导入");
      expect(await page.evaluate(() => (globalThis as any).importCalls)).toEqual([{ text: expect.stringContaining("正文异步导入需要等待结果"), title: "Panel Small Book" }]);
      expect(await page.evaluate(() => (globalThis as any).pdfCalls)).toEqual([]);
      expect(await page.$eval('input[type="file"]', input => (input as HTMLInputElement).disabled)).toBe(false);
    } finally { await page.close(); }
  }, 30000);
});
