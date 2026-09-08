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
describe("最终简洁知识卡面板", () => {
  it("只展示真实进度和三档页数，不显示输入框或技术说明", async () => {
    const page = await open({plan:plan(),phase:"ready"});
    try {
      expect(await page.$$eval('[aria-label="选择方案"] button', es => es.map(e=>e.textContent?.trim()))).toEqual(["精简 4页","均衡 6页","完整 8页"]);
      expect(await page.$$("input,textarea,details")).toHaveLength(0);
      const text=await page.$eval("section", e=>e.textContent);
      expect(text).not.toMatch(/读取单元|原页|分片|转换|心跳|保留：|省略：|暂无页数/);
      expect(text).toContain("读取成功 · 100%");
      expect(await page.evaluate(()=>(globalThis as any).calls.generate)).toEqual([]);
    } finally {await page.close();}
  });
  it("切换页数不购买，确认价格后只生成选中方案", async () => {
    const page=await open({plan:plan(),phase:"ready"});
    try {
      await click(page,"均衡 6页"); await click(page,"生成 ·");
      await page.waitForSelector('[aria-label="确认生成方案"]');
      expect(await page.$eval('[aria-label="确认生成方案"]', e=>e.textContent)).toContain("全部6页");
      expect(await page.evaluate(()=>(globalThis as any).calls.generate)).toEqual([]);
      await click(page,"确认生成 ·");
      await page.waitForFunction(()=>(globalThis as any).calls.generate.length===1);
      expect(await page.evaluate(()=>(globalThis as any).calls.generate)).toEqual(["balanced"]);
    } finally {await page.close();}
  });
  it("切换方案撤销旧确认，完整四页只显示真实的一档", async()=>{
    const page=await open({plan:plan(),phase:"ready"});
    try {
      await click(page,"生成 ·"); await page.waitForSelector('[aria-label="确认生成方案"]');
      await click(page,"完整 8页"); await page.waitForFunction(()=>!document.querySelector('[aria-label="确认生成方案"]'));
      await page.evaluate(p=>(globalThis as any).mount({plan:p,phase:"ready"}),plan(true));
      await page.waitForFunction(()=>document.querySelectorAll('[aria-label="选择方案"] button').length===1);
      expect(await page.$eval('[aria-label="选择方案"] button',e=>e.textContent?.trim())).toBe("完整 4页");
    } finally {await page.close();}
  });
  it("失败只显示一次失败状态与保留的百分比，可查询原任务",async()=>{
    const page=await open({phase:"failed",error:"阅读超时",progress:{done:100,total:275}});
    try {
      expect(await page.$$('[role="alert"]')).toHaveLength(1);
      expect(await page.$eval('[role="alert"]',e=>e.textContent)).toContain("停在36%");
      await click(page,"查询已有任务");
      expect(await page.evaluate(()=>(globalThis as any).calls.resume)).toBe(1);
      expect(await page.evaluate(()=>(globalThis as any).calls.generate)).toEqual([]);
    } finally {await page.close();}
  });
  it("提交结果未知时锁住生成，查询后才允许操作",async()=>{
    const page=await open({plan:plan(),phase:"ready"});
    try {
      await page.evaluate(p=>(globalThis as any).mount({plan:p,phase:"ready",onGenerate:()=>{throw Error("测试断线")}}),plan());
      await click(page,"生成 ·"); await page.waitForSelector('[aria-label="确认生成方案"]');await click(page,"确认生成 ·");
      await page.waitForFunction(()=>document.body.textContent?.includes("不要重复提交"));
      expect(await page.$eval("article button",b=>b.disabled)).toBe(true);
      await click(page,"查询已有任务");await page.waitForFunction(()=>!(document.querySelector("article button") as HTMLButtonElement).disabled);
    }finally{await page.close();}
  });
  it("300页保持整套报价，旧预算不符可重新获取方案",async()=>{
    const p={...plan(),options:[option("concise",4),option("balanced",81),option("complete",300)]};
    const page=await open({plan:p,phase:"ready",selectedMode:"complete"});
    try{
      expect(await page.$eval('[aria-label="选择方案"] button:last-child',e=>e.textContent)).toContain("完整 300页");
      expect(await page.$eval("article button",e=>e.textContent)).toContain("7248积分");
      await page.evaluate(p=>(globalThis as any).mount({plan:p,phase:"ready",constraints:{budgetCredits:1}}),p);
      await page.waitForSelector('[role="alert"]');
      expect(await page.$eval("article button",b=>b.disabled)).toBe(true);
      await click(page,"重新获取方案");
      expect(await page.evaluate(()=>(globalThis as any).calls.analyze)).toEqual([{}]);
    }finally{await page.close();}
  });
});
