import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser, bundle: string;
beforeAll(async () => {
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState}from'react';import{createRoot}from'react-dom/client';
import Editor from './client/src/components/canvas/ManhuaStoryboardImportEditor';
const f=globalThis.fixture={calls:[],fail:false};window.confirm=()=>true;
function App(){const[index,setIndex]=useState(2),[scope,setScope]=useState('7:project-a'),[body,setBody]=useState('针光入穴。'),[busy,setBusy]=useState(''),[capacityMode,setCapacityMode]=useState('block_when_over');Object.assign(f,{setIndex,setScope,setBody,setBusy});return <Editor scopeKey={scope} episode={{index,body}} busyReason={busy} capacityMode={capacityMode} onChangeCapacityMode={mode=>{f.capacity=mode;setCapacityMode(mode);}} onPrepare={text=>{f.calls.push(text);if(f.fail)throw new Error('秒位缺失，草稿保留');}}/>;}createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") } });
  bundle = built.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function pageFixture() {
  const context = await browser.createBrowserContext(), page = await context.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => request.isNavigationRequest() ? void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void request.abort());
  await page.goto("http://localhost:41830/canvas?owner=7&project=20000000-0000-4000-8000-000000000001");
  const mount = async () => { await page.addScriptTag({ content: bundle }); await page.waitForSelector("textarea"); await page.click("summary"); };
  await mount();
  const edit = async (text: string) => { await page.$eval("textarea", (node, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }, text); };
  return { context, page, mount, edit };
}

it("真实导入文本框分集/项目隔离并刷新恢复，编辑和忙状态不提交", async () => {
  const { context, page, mount, edit } = await pageFixture();
  try {
    await edit("已审34镜原文，不得截断。".repeat(300));
    await page.evaluate(() => (globalThis as any).fixture.setIndex(1));
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
    await page.evaluate(() => (globalThis as any).fixture.setIndex(2));
    await page.waitForFunction(() => document.querySelector("textarea")?.value.startsWith("已审34镜"));
    await page.reload(); await mount();
    expect(await page.$eval("textarea", node => (node as HTMLTextAreaElement).value)).toHaveLength("已审34镜原文，不得截断。".repeat(300).length);
    await page.evaluate(() => (globalThis as any).fixture.setBusy("原任务执行中"));
    await page.waitForFunction(() => document.body.textContent?.includes("原任务执行中"));
    expect(await page.$eval("button", node => (node as HTMLButtonElement).disabled)).toBe(true);
    await page.evaluate(() => (globalThis as any).fixture.setScope("7:project-b"));
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "");
    expect(await page.evaluate(() => (globalThis as any).fixture.calls)).toEqual([]);
  } finally { await context.close(); }
});

it("导入失败保留原文；正文变化后禁止提交，明确核对后才可展示候选", async () => {
  const { context, page, edit } = await pageFixture();
  try {
    await edit("分镜原文");
    await page.evaluate(() => { (globalThis as any).fixture.fail = true; });
    await page.click("button");
    await page.waitForFunction(() => document.body.textContent?.includes("秒位缺失"));
    expect(await page.$eval("textarea", node => (node as HTMLTextAreaElement).value)).toBe("分镜原文");
    await page.evaluate(() => (globalThis as any).fixture.setBody("正文换稿。"));
    await page.waitForFunction(() => document.body.textContent?.includes("正文已改变"));
    expect(await page.$eval("details > button", node => (node as HTMLButtonElement).disabled)).toBe(true);
    await page.evaluate(() => { (globalThis as any).fixture.fail = false; });
    await page.$eval("button", node => (node as HTMLButtonElement).click());
    await page.waitForFunction(() => !document.body.textContent?.includes("正文已改变"));
    await page.click("button");
    await page.waitForFunction(() => (globalThis as any).fixture.calls.length === 2);
  } finally { await context.close(); }
});

 it("容量须由用户明确选择，忙状态禁止改动，不触发生成或候选", async () => {
  const { context, page } = await pageFixture();
  try {
    expect(await page.$eval("select", node => (node as HTMLSelectElement).value)).toBe("block_when_over");
    await page.select("select", "auto_by_source");
    await page.waitForFunction(() => (globalThis as any).fixture.capacity === "auto_by_source");
    expect(await page.evaluate(() => (globalThis as any).fixture.calls)).toEqual([]);
    await page.evaluate(() => (globalThis as any).fixture.setBusy("制作任务执行中"));
    await page.waitForFunction(() => (document.querySelector("select") as HTMLSelectElement)?.disabled);
  } finally { await context.close(); }
});
