import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import puppeteer, { type Browser } from "puppeteer";
import { knowledgeCardStageCounts, knowledgeCardProgressFromDistill, knowledgeCardProgressFromRender } from "../components/platform/KnowledgeCardProgress";

let browser: Browser;
let server: Server;
let origin: string;
let bundle: string;
beforeAll(async () => {
  const output = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {KnowledgeCardProgress} from './client/src/components/platform/KnowledgeCardProgress';
    const root=createRoot(document.getElementById('root'));
    globalThis.mount=(state)=>root.render(React.createElement(KnowledgeCardProgress,{state}));
  ` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic" });
  bundle = output.outputFiles[0]!.text;
  server = createServer((_req, res) => { res.setHeader("Content-Type", "text/html"); res.end('<div id="root"></div>'); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试服务未启动");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>((resolve) => server.close(() => resolve())); });

async function render(state: unknown) {
  const page = await browser.newPage();
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  await page.evaluate((s) => (globalThis as unknown as { mount: (v: unknown) => void }).mount(s), state);
  const text = await page.evaluate(() => document.body.innerText);
  const now = await page.evaluate(() => document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"));
  const role = await page.evaluate(() => document.querySelector('[aria-label="知识卡进度"] p')?.getAttribute("role"));
  await page.close();
  return { text, now, role };
}

describe("KnowledgeCardProgress（真实浏览器）", () => {
  it("idle renders nothing", async () => {
    const r = await render({ status: "idle", percent: 0 });
    expect(r.text.trim()).toBe("");
  });
  it("running shows percent + stage label", async () => {
    const r = await render({ status: "running", percent: 37, label: "读原稿 120/276 页" });
    expect(r.text).toContain("37%");
    expect(r.text).toContain("读原稿 120/276 页");
    expect(r.now).toBe("37");
    expect(r.role).toBe("status");
  });
  it("failed keeps the percentage where it stopped and shows the reason as an alert", async () => {
    const r = await render({ status: "failed", percent: 62, error: "算力紧张，请稍后再试" });
    expect(r.text).toContain("失败 · 停在 62%");
    expect(r.text).toContain("算力紧张");
    expect(r.role).toBe("alert");
  });
  it("succeeded is always 100%", async () => {
    const r = await render({ status: "succeeded", percent: 80 });
    expect(r.text).toContain("成功 · 100%");
    expect(r.now).toBe("100");
  });
  it("总体权重与当前阶段计数分列显示", async () => {
    const r = await render({ status: "running", percent: 73, label: "联网核实与修订", stageDone: 3, stageTotal: 18 });
    expect(r.text).toContain("总体完成度");
    expect(r.text).toContain("当前阶段");
    expect(r.text).toContain("73%");
    expect(r.text).toContain("3/18 · 16.7%");
    expect(r.now).toBe("73");
  });
  it("缺少计数时不借总体百分比伪造阶段进度", async () => {
    const r = await render({ status: "running", percent: 90, label: "统稿合并…" });
    expect(r.text).toContain("暂无阶段计数");
    expect(r.text).not.toContain("undefined");
  });
  it("旧任务阶段切换不读取残留的参考页计数", () => {
    const saved = { distillStageDone: 21, distillStageTotal: 21, distillDoneChunks: 2, distillTotalChunks: 6 };
    expect(knowledgeCardStageCounts({ ...saved, distillStage: "distilling" })).toEqual({stageDone: 2, stageTotal: 6});
    expect(knowledgeCardStageCounts({ ...saved, distillStage: "refining" })).toEqual({});
    expect(knowledgeCardStageCounts({ ...saved, distillStage: "verifying" })).toEqual({stageDone: 21, stageTotal: 21});
  });
  it("mapping: distill occupies 0–60, rendering 60–100", () => {
    expect(knowledgeCardProgressFromDistill(0)).toBe(0);
    expect(knowledgeCardProgressFromDistill(98)).toBe(59);
    expect(knowledgeCardProgressFromRender(0, 5)).toBe(60);
    expect(knowledgeCardProgressFromRender(5, 5)).toBe(100);
    expect(knowledgeCardProgressFromRender(2, 0)).toBe(60);
  });
});
