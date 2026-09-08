import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import puppeteer, { type Browser } from "puppeteer";

let browser: Browser;
let server: Server;
let origin: string;
let bundle: string;
beforeAll(async () => {
  const output = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {KnowledgeCardReadingProgress} from './client/src/components/platform/KnowledgeCardReadingProgress';
    const root=createRoot(document.getElementById('root'));
    globalThis.testNow=Date.parse('2026-09-08T05:00:00Z'); Date.now=()=>globalThis.testNow;
    globalThis.mount=props=>root.render(React.createElement(KnowledgeCardReadingProgress,props));
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic" });
  bundle = output.outputFiles[0].text;
  server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end('<div id="root"></div>'); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("测试服务未启动");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); });
async function open(props: unknown) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => void (request.url().startsWith(origin) ? request.continue() : request.abort()));
  await page.goto(origin); await page.addScriptTag({ content: bundle });
  await page.evaluate(props => (globalThis as any).mount(props), props);
  await page.waitForSelector('[role="progressbar"]'); return page;
}
describe("简洁进度与真实终态", () => {
  it("运行中只显示状态与真实百分比，不展示后台技术信息", async () => {
    const page = await open({ progress: { done: 100, total: 275, stage: "reading", updatedAt: "2026-09-08T04:59:59Z", heartbeatAt: "2026-09-08T05:00:00Z" }, phase: "reading" });
    try {
      expect(await page.$eval('[role="status"]', el => el.textContent)).toBe("处理中 · 36%（100/275）");
      expect(await page.$eval('[role="progressbar"]', el => el.getAttribute("aria-valuenow"))).toBe("36");
      expect(await page.$("details")).toBeNull();
      expect(await page.$eval("body", el => el.innerText)).not.toMatch(/心跳|原页|转换|分片|最后内容进展/);
    } finally { await page.close(); }
  });
  it("失败优先于旧阶段和成功状态，停在真实36%并显示原因", async () => {
    const page = await open({ progress: { done: 100, total: 275, stage: "reading" }, phase: "failed", jobStatus: "succeeded", error: "阅读服务超时" });
    try {
      expect(await page.$eval('[role="alert"]', el => el.textContent)).toBe("处理失败 · 停在36%（100/275）");
      expect(await page.$eval('[role="alert"]', el => el.getAttribute("title"))).toBe("阅读服务超时");
      expect(await page.$eval('[role="progressbar"]', el => el.getAttribute("aria-valuenow"))).toBe("36");
      expect(await page.$eval("body", el => el.innerText)).not.toContain("100%");
    } finally { await page.close(); }
  });
  it("成功终态显示100%，方案就绪与全部生成成功分开", async () => {
    const page = await open({ progress: { done: 0, total: 0 }, phase: "ready" });
    try {
      expect(await page.$eval('[role="status"]', el => el.textContent)).toBe("读取成功 · 100%");
      await page.evaluate(() => (globalThis as any).mount({ progress: { done: 4, total: 4 }, phase: "ready", successLabel: "生成完成" }));
      await page.waitForFunction(() => document.body.innerText.includes("生成完成 · 100%（4/4）"));
    } finally { await page.close(); }
  });
  it("分阶段100%仍在整理方案，不冒充终态成功", async () => {
    const page = await open({ progress: { done: 276, total: 276, stage: "planning" }, phase: "planning", jobStatus: "running" });
    try {
      const text = await page.$eval('[role="status"]', el => el.textContent);
      expect(text).toBe("处理中 · 100%（276/276）");
      expect(text).not.toMatch(/成功|就绪|已完成|生成完成/);
    } finally { await page.close(); }
  });
  it("总量未知不捏造百分比，失败仍明确显示", async () => {
    const page = await open({ progress: { done: 0, total: 0 }, phase: "reading" });
    try {
      expect(await page.$eval('[role="progressbar"]', el => el.getAttribute("aria-valuenow"))).toBeNull();
      expect(await page.$eval("body", el => el.innerText)).not.toContain("0%");
      expect(await page.$("details")).toBeNull();
      await page.evaluate(() => (globalThis as any).mount({ progress: { done: 0, total: 0 }, phase: "failed", error: "文件读取失败" }));
      await page.waitForSelector('[role="alert"]');
      expect(await page.$eval('[role="alert"]', el => el.getAttribute("title"))).toBe("文件读取失败");
    } finally { await page.close(); }
  });
});
