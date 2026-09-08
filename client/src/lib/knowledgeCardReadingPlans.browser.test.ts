import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import puppeteer, { type Browser, type Page } from "puppeteer";
import type { KnowledgeCardReadingPlan } from "@shared/knowledgeCardReadingPlan";

let browser: Browser;
let server: Server;
let origin: string;
let bundle: string;
beforeAll(async () => {
  const output = await build({ stdin: { resolveDir: process.cwd(), contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {KnowledgeCardReadingPlans} from './client/src/components/platform/KnowledgeCardReadingPlans';
    const root=createRoot(document.getElementById('root'));
    globalThis.calls={analyze:[],select:[],generate:[],resume:0};
    globalThis.mount=(props)=>root.render(React.createElement(KnowledgeCardReadingPlans,{
      onAnalyze:value=>calls.analyze.push(value),onSelect:value=>calls.select.push(value),
      onGenerate:value=>calls.generate.push(value),onResume:()=>{calls.resume++},...props
    }));
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
const option = (mode: "concise" | "balanced" | "complete", count: number) => ({
  mode, reason: "按来源内容组织", kept: ["具体关系与步骤"], omitted: mode === "complete" ? [] : ["重复例子"],
  sourceExclusions: [{ sourcePageId: "原页-9", reason: "重复目录" }],
  pages: Array.from({ length: count }, (_, i) => ({ pageId: `card-${i}`, title: `主题${i + 1}`, brief: "本页具体内容", sourcePageIds: [`原页-${i + 1}`], visualDirections: "左侧定位图与右侧编号说明对应" })),
});
const plan = (single = false): KnowledgeCardReadingPlan => ({ version: 1, sourceDigest: "a".repeat(64), model: "gpt-5.6-sol", presentation: single ? "single" : "options", reason: "全文阅读结果", options: single ? [option("complete", 4)] : [option("complete", 8), option("balanced", 6), option("concise", 4)] });
async function open(props: unknown) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => void (request.url().startsWith(origin) ? request.continue() : request.abort()));
  await page.goto(origin); await page.addScriptTag({ content: bundle });
  await page.evaluate(props => (globalThis as any).mount(props), props);
  await page.waitForSelector("section"); return page;
}
async function click(page: Page, text: string) {
  await page.evaluate(text => { const b = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes(text)); if (!b || b.disabled) throw Error(`按钮不可用：${text}`); b.click(); }, text);
}
async function input(page: Page, label: string, value: string) {
  await page.evaluate(({ label, value }) => { const el = document.querySelector(`input[aria-label="${label}"]`)!; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value); el.dispatchEvent(new Event("input", { bubbles: true })); }, { label, value });
}
describe("知识卡方案真实离线浏览器事件", () => {
  it("提交结果未知时阻止重复生成，查询成功后才恢复操作", async () => {
    const page = await open({ plan: plan(), phase: "ready" });
    try {
      await page.evaluate(plan => (globalThis as any).mount({ plan, phase: "ready", onGenerate: () => { (globalThis as any).calls.generate.push("concise"); throw Error("测试断线"); } }), plan());
      await click(page, "生成此方案"); await page.waitForSelector('[aria-label="确认生成方案"]');
      await click(page, "确认生成 ·");
      await page.waitForFunction(() => document.body.textContent?.includes("不要重复提交生成"));
      expect(await page.$eval("article button", b => b.disabled)).toBe(true);
      expect(await page.$eval('[aria-label="选择方案"] button', b => b.disabled)).toBe(true);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual(["concise"]);
      await click(page, "查询已有任务");
      await page.waitForFunction(() => !(document.querySelector("article button") as HTMLButtonElement).disabled);
      expect(await page.evaluate(() => (globalThis as any).calls.resume)).toBe(1);
    } finally { await page.close(); }
  });
  it("切换方案撤销旧确认且不生成，报价不一致阻止提交", async () => {
    const page = await open({ plan: plan(), phase: "ready" });
    try {
      await click(page, "生成此方案"); await page.waitForSelector('[aria-label="确认生成方案"]');
      await click(page, "均衡 ·");
      await page.waitForFunction(() => document.querySelector("h3")?.textContent?.includes("均衡方案"));
      expect(await page.$('[aria-label="确认生成方案"]')).toBeNull();
      expect(await page.evaluate(() => (globalThis as any).calls.select)).toEqual(["balanced"]);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
      await page.evaluate(plan => (globalThis as any).mount({ plan, phase: "ready", quote: { options: [] } }), plan());
      await page.waitForFunction(() => document.body.textContent?.includes("方案或报价无法核对"));
      expect(await page.$("article")).toBeNull();
    } finally { await page.close(); }
  });
  it("三方案按精简优先，来源内容可展开，必须明确二次确认", async () => {
    const page = await open({ plan: plan(), phase: "ready" });
    try {
      expect(await page.$eval('[aria-label="选择方案"] button', b => b.textContent)).toContain("精简");
      expect(await page.$eval("h3", b => b.textContent)).toContain("精简方案 · 4页");
      await page.click("article details summary");
      expect(await page.$eval("article", b => b.textContent)).toContain("原页-9：重复目录");
      expect(await page.$eval("article", b => b.textContent)).toContain("左侧定位图与右侧编号说明对应");
      await click(page, "生成此方案"); await page.waitForSelector('[aria-label="确认生成方案"]');
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
      await click(page, "确认生成 ·");
      await page.waitForFunction(() => (globalThis as any).calls.generate.length === 1);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual(["concise"]);
      expect(await page.$eval("section", b => b.textContent)).not.toMatch(/gpt|qwen|供应商/i);
    } finally { await page.close(); }
  });
  it("完整四页只显示一个方案，选择不触发购买", async () => {
    const page = await open({ plan: plan(true), phase: "ready" });
    try {
      expect(await page.$('[aria-label="选择方案"]')).toBeNull();
      expect(await page.$eval("h3", b => b.textContent)).toContain("完整四页方案");
      await click(page, "生成此方案"); await page.waitForSelector('[aria-label="确认生成方案"]');
      await click(page, "取消");
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
    } finally { await page.close(); }
  });
  it("最低预算不可达时标明真实最低价，不能减成三页", async () => {
    const page = await open({ plan: plan(), phase: "ready", constraints: { budgetCredits: 1 } });
    try {
      expect(await page.$eval("section", b => b.textContent)).toContain("预算不足以生成最少4页");
      expect(await page.$eval("article button", b => b.disabled)).toBe(true);
      await input(page, "目标页数", "3"); await click(page, "按要求重新规划");
      await page.waitForFunction(() => document.body.textContent?.includes("不少于4的安全整数"));
      expect(await page.evaluate(() => (globalThis as any).calls.analyze)).toEqual([]);
    } finally { await page.close(); }
  });
  it("输入变化撤销旧确认，重新规划透传约束，读中恢复不购买", async () => {
    const page = await open({ plan: plan(), phase: "ready" });
    try {
      await click(page, "生成此方案"); await page.waitForSelector('[aria-label="确认生成方案"]');
      await input(page, "预算上限", "300"); await input(page, "目标页数", "6");
      expect(await page.$('[aria-label="确认生成方案"]')).toBeNull();
      await click(page, "按要求重新规划");
      await page.waitForFunction(() => (globalThis as any).calls.analyze.length === 1);
      expect(await page.evaluate(() => (globalThis as any).calls.analyze)).toEqual([{ budgetCredits: 300, targetPages: 6 }]);
      await page.evaluate(() => (globalThis as any).mount({ phase: "reading", progress: { done: 17, total: 276 } }));
      await page.waitForFunction(() => document.body.textContent?.includes("17/276个读取单元"));
      expect(await page.$eval("section", element => element.textContent)).toContain("纯文字按段");
      await click(page, "查询已有任务");
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
      expect(await page.$("article")).toBeNull();
      await page.evaluate(() => (globalThis as any).mount({ phase: "generating", readingFeeCharged: 50 }));
      await page.waitForFunction(() => document.body.textContent?.includes("已收50积分"));
      await click(page, "查询已有任务");
      expect(await page.evaluate(() => (globalThis as any).calls.resume)).toBe(2);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
    } finally { await page.close(); }
  });
  it.each([81, 300])("目标%s页可提交，无80上限；非法目标仍拒绝", async count => {
    const page = await open({ plan: plan(), phase: "ready" });
    try {
      expect(await page.$eval('[aria-label="目标页数"]', element => element.getAttribute("max"))).toBeNull();
      for (const value of ["3", "4.5", "9007199254740992"]) {
        await input(page, "目标页数", value); await click(page, "按要求重新规划");
        await page.waitForFunction(() => document.body.textContent?.includes("不少于4的安全整数"));
        expect(await page.evaluate(() => (globalThis as any).calls.analyze)).toEqual([]);
      }
      await input(page, "目标页数", String(count)); await click(page, "按要求重新规划");
      await page.waitForFunction(() => (globalThis as any).calls.analyze.length === 1);
      expect(await page.evaluate(() => (globalThis as any).calls.analyze)).toEqual([{ targetPages: count }]);
    } finally { await page.close(); }
  });
  it("完整300页方案展示头尾与全部300页，按整书阶梯价确认而不截断", async () => {
    const value = { ...plan(), options: [option("concise", 4), option("balanced", 81), option("complete", 300)] };
    const page = await open({ plan: value, phase: "ready", selectedMode: "complete", constraints: { targetPages: 300, budgetCredits: 7248 } });
    try {
      expect(await page.$eval("h3", element => element.textContent)).toContain("完整方案 · 300页 · 7248积分");
      const summaries = await page.$$eval("article > details > summary", elements => elements.map(element => element.textContent || "").filter(text => /^第\d+页/.test(text)));
      expect(summaries).toHaveLength(300);
      expect(summaries[0]).toContain("第1页 · 主题1");
      expect(summaries.at(-1)).toContain("第300页 · 主题300");
      await click(page, "生成此方案"); await page.waitForSelector('[aria-label="确认生成方案"]');
      expect(await page.$eval('[aria-label="确认生成方案"]', element => element.textContent)).toContain("全部300页4K知识卡，报价共7248积分");
      await click(page, "确认生成 ·");
      await page.waitForFunction(() => (globalThis as any).calls.generate.length === 1);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual(["complete"]);
    } finally { await page.close(); }
  });

});
