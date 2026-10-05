import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser, bundle: string;
beforeAll(async () => {
  const built = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import Editor from './client/src/components/canvas/ManhuaEpisodeTextEditor';
import{replaceManhuaEpisodeStoryText}from './shared/manhuaAdvisorRewrite';
const f=globalThis.fixture={applied:[],accept:true};window.confirm=()=>true;
function App(){const[episodes,setEpisodes]=useState([{index:1,title:'江边',body:'甲：别怕。\\n\\n### 五至六段可拍表\\n#### 段01\\n意图：揭示身份\\n对白：甲：别怕。',endHook:'有人来访。'},{index:2,title:'船上',body:'乙登船。',endHook:'船离岸。'}]);const[index,setIndex]=useState(1),[scope,setScope]=useState('7:project-a'),[busy,setBusy]=useState('');f.setIndex=setIndex;f.setScope=setScope;f.setBusy=setBusy;f.replaceSource=body=>setEpisodes(es=>es.map(e=>e.index===1?{...e,body}:e));return <Editor scopeKey={scope} episode={episodes.find(e=>e.index===index)} busyReason={busy} onApplyEdit={async edit=>{f.applied.push(edit);if(!f.accept)return false;setEpisodes(es=>es.map(e=>e.index===edit.episodeIndex?{...e,body:replaceManhuaEpisodeStoryText(e.body,edit.body),endHook:edit.endHook}:e));return true;}}/>};createRoot(document.getElementById('root')).render(<App/>);` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"development"', "import.meta.env": "{}" } });
  bundle = built.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); });

async function pageFixture() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => request.isNavigationRequest() ? void request.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }) : void request.abort());
  await page.goto("http://localhost:41830/canvas?owner=7&project=20000000-0000-4000-8000-000000000001");
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[aria-label="第1集剧情与对白"]');
  const edit = async (text: string) => { await page.$eval('textarea[aria-label$="剧情与对白"]', (node, value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  }, text); };
  return { page, context, edit };
}

it("实际文本框可编辑长正文，草稿按集和项目隔离并刷新恢复，在途任务只阻止确认", async () => {
  const { page, context, edit } = await pageFixture();
  try {
    expect(await page.$eval('textarea', node => (node as HTMLTextAreaElement).value)).toBe("甲：别怕。");
    const long = "新剧情".repeat(3500);
    await edit(long);
    await page.evaluate(() => (globalThis as any).fixture.setIndex(2));
    await page.waitForSelector('[aria-label="第2集剧情与对白"]');
    expect(await page.$eval('textarea', node => (node as HTMLTextAreaElement).value)).toBe("乙登船。");
    await page.evaluate(() => (globalThis as any).fixture.setIndex(1));
    await page.waitForSelector('[aria-label="第1集剧情与对白"]');
    expect(await page.$eval('textarea', node => (node as HTMLTextAreaElement).value)).toBe(long);
    await page.reload(); await page.addScriptTag({ content: bundle });
    await page.waitForSelector('[aria-label="第1集剧情与对白"]');
    expect(await page.$eval('textarea', node => (node as HTMLTextAreaElement).value)).toBe(long);
    await page.evaluate(() => (globalThis as any).fixture.setBusy("原视频仍在运行"));
    await page.waitForFunction(() => document.body.textContent?.includes("原视频仍在运行"));
    expect(await page.$eval('textarea', node => (node as HTMLTextAreaElement).disabled)).toBe(false);
    await edit("继续修改。");
    expect(await page.$eval('button', node => (node as HTMLButtonElement).disabled)).toBe(true);
    await page.evaluate(() => (globalThis as any).fixture.setScope("7:project-b"));
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "甲：别怕。");
    expect(await page.evaluate(() => (globalThis as any).fixture.applied)).toHaveLength(0);
  } finally { await context.close(); }
});

it("确认前不写真源，写回保留技术材料；拒绝采用保留草稿，外部新稿不能被过期草稿覆盖", async () => {
  const { page, context, edit } = await pageFixture();
  try {
    await edit("甲打开门。");
    expect(await page.evaluate(() => (globalThis as any).fixture.applied)).toHaveLength(0);
    await page.evaluate(() => { (globalThis as any).fixture.accept = false; });
    await page.click("button");
    await page.waitForFunction(() => (globalThis as any).fixture.applied.length === 1);
    expect(await page.$eval('textarea', node => (node as HTMLTextAreaElement).value)).toBe("甲打开门。");
    await page.evaluate(() => { (globalThis as any).fixture.accept = true; });
    await page.click("button");
    await page.waitForFunction(() => document.body.textContent?.includes("与已保存正文一致"));
    const applied = await page.evaluate(() => (globalThis as any).fixture.applied[1]);
    expect(applied).toMatchObject({ episodeIndex: 1, body: "甲打开门。", originalEndHook: "有人来访。" });
    expect(applied.originalBody).toContain("五至六段可拍表");
    expect(await page.$eval('details pre', node => node.textContent)).toContain("揭示身份");
    await edit("尚未确认的人工稿。");
    await page.evaluate(() => (globalThis as any).fixture.replaceSource("顾问刚采用的新稿。"));
    await page.waitForFunction(() => document.body.textContent?.includes("已保存正文在编辑期间发生变化"));
    expect(await page.$eval('textarea', node => (node as HTMLTextAreaElement).value)).toBe("尚未确认的人工稿。");
    expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(node => node.textContent?.includes("确认写回"))?.disabled)).toBe(true);
    await page.evaluate(() => Array.from(document.querySelectorAll("button")).find(node => node.textContent === "以当前已保存稿重新编辑")?.click());
    await page.waitForFunction(() => document.querySelector("textarea")?.value === "顾问刚采用的新稿。");
  } finally { await context.close(); }
});
