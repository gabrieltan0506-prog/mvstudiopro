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
describe("知识卡真实进展展示", () => {
  it("原页整理100%只表示本阶段，不宣称全文读完", async () => {
    const page = await open({ progress: { done: 276, total: 276, stage: "prepared" }, phase: "reading" });
    try {
      const text = await page.$eval("body", el => el.textContent);
      expect(text).toContain("原页整理完成"); expect(text).toContain("本阶段进度 100%");
      expect(text).not.toContain("读取单元已读完"); expect(text).not.toContain("材料读取 100%");
    } finally { await page.close(); }
  });
  it("按读取计数显示百分比与阶段，不因时间推移增加进度", async () => {
    const page = await open({ progress: { done: 1, total: 3, stage: "reading:1/2" }, phase: "reading" });
    try {
      expect(await page.$eval('[role="progressbar"]', el => el.getAttribute("aria-valuenow"))).toBe("33");
      expect(await page.$eval("body", el => el.textContent)).toContain("阅读图文（第1/2份材料）");
      await page.evaluate(() => { (globalThis as any).testNow += 600_000; (globalThis as any).mount({ progress: { done: 1, total: 3 }, phase: "reading" }); });
      expect(await page.$eval('[role="progressbar"]', el => el.getAttribute("aria-valuenow"))).toBe("33");
    } finally { await page.close(); }
  });
  it("总量未知时没有伪造百分比，无心跳不声称运行", async () => {
    const page = await open({ progress: { done: 0, total: 0 }, phase: "reading" });
    try {
      expect(await page.$eval('[role="progressbar"]', el => el.getAttribute("aria-valuenow"))).toBeNull();
      const text = await page.$eval("body", el => el.textContent);
      expect(text).toContain("确认总量中"); expect(text).toContain("最近后端心跳：未提供");
      expect(text).not.toMatch(/仍在运行|0%|卡死/);
    } finally { await page.close(); }
  });
  it("读取100%时保留规划阶段，不能冒充整个任务完成", async () => {
    const page = await open({ progress: { done: 276, total: 276, stage: "planning" }, phase: "reading" });
    try {
      const text = await page.$eval("body", el => el.textContent);
      expect(text).toContain("材料读取 100%"); expect(text).toContain("当前阶段：整理方案");
      expect(text).toContain("方案整理与正文编写进度以当前阶段为准"); expect(text).not.toContain("任务已完成");
    } finally { await page.close(); }
  });
  it("分别展示真实内容时间与心跳，心跳更新不掩盖内容久无进展", async () => {
    const page = await open({ progress: { done: 12, total: 276, stage: "reading", updatedAt: "2026-09-08T04:57:00Z", heartbeatAt: "2026-09-08T04:59:59Z" }, phase: "reading" });
    try {
      const times = await page.$$eval("[data-progress-time]", els => els.map(el => el.textContent?.split("：").slice(1).join("：")));
      expect(times[0]).not.toBe(times[1]); expect(times.every(time => time && !time.includes("未提供"))).toBe(true);
      expect(await page.$eval('[role="status"]', el => el.textContent)).toBe("暂未收到新进展，可查询原任务。");
      expect(await page.$eval("body", el => el.textContent)).toContain("心跳仅表示后端活动");
    } finally { await page.close(); }
  });
  it("无效时间安全显示缺失，终态不显示停滞提示", async () => {
    const page = await open({ progress: { done: 1, total: 2, updatedAt: "bad-date", heartbeatAt: "" }, phase: "reading" });
    try {
      expect(await page.$$eval("[data-progress-time]", els => els.every(el => el.textContent?.includes("未提供")))).toBe(true);
      expect(await page.$('[role="status"]')).toBeNull();
      await page.evaluate(() => (globalThis as any).mount({ progress: { done: 1, total: 2, updatedAt: "2026-09-08T04:00:00Z" }, jobStatus: "failed" }));
      await page.waitForFunction(() => !document.querySelector('[data-progress-time="content"]')?.textContent?.includes("未提供"));
      expect(await page.$('[role="status"]')).toBeNull();
    } finally { await page.close(); }
  });
});
