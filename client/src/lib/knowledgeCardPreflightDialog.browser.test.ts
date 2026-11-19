/**
 * 1119 C1/C2：真实 KnowledgeCardPreflight 渲染断言。
 * 普通用户：只见档名、图片页数与文字页数，不见任何模型/供应商名、不再提 PPTX；debug：显示精确模型名。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";

let browser: Browser; let bundle: string;
beforeAll(async () => {
  const out = await build({
    stdin: { resolveDir: process.cwd(), sourcefile: "preflight.tsx", loader: "tsx", contents: `
import React from'react';import{createRoot}from'react-dom/client';import{KnowledgeCardPreflight}from'./client/src/components/platform/KnowledgeCardPreflight';
import{HANDBOOK_IMAGE_MODEL,HANDBOOK_IMAGE_TIER_LABEL_ZH}from'./shared/openaiImageVariant';import{knowledgeCardRecordedModelLabel}from'./shared/knowledgeCardDistillModels';
const p=new URLSearchParams(location.search);
const summary={levelZh:'精华版',layoutZh:'主体居中',templateZh:'未选（按正文自动）',distillModelZh:knowledgeCardRecordedModelLabel(p.get('model')||'deepseek-v4.1-flash-1017'),pageCount:12,textPageCount:p.get('text')==='null'?null:Number(p.get('text')||30),cardsOnly:p.get('cards')==='1',qualityZh:'4K',credits:360,imageTierZh:HANDBOOK_IMAGE_TIER_LABEL_ZH,imageModelDebug:HANDBOOK_IMAGE_MODEL};
createRoot(document.getElementById('root')).render(<KnowledgeCardPreflight summary={summary} debug={p.get('debug')==='1'} onConfirm={()=>{}} onCancel={()=>{}}/>);
` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
    alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, loader: { ".css": "text" },
  });
  bundle = out.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
}, 180_000);
afterAll(async () => { await browser?.close(); });
async function dialogText(query: string) {
  const page = await browser.newPage(); const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  await page.setRequestInterception(true);
  page.on("request", r => void r.respond({ status: 200, contentType: "text/html", body: '<div id="root"></div>' }));
  await page.goto(`https://fixture.invalid/?${query}`);
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector('[role="dialog"]', { timeout: 15_000 });
  const text = await page.evaluate(() => document.body.innerText);
  await page.close();
  expect(errors).toEqual([]);
  return text;
}
const VENDOR = /gpt|image[- ]?2|sunburst|flare|openai|evolink|wavespeed|openrouter|deepseek|claude|gemini|pptx/i;
it("普通用户：无模型/供应商名，显示图片页数、文字页数与档名", async () => {
  const text = await dialogText("debug=0&text=30");
  expect(text).not.toMatch(VENDOR);
  expect(text).toContain("图片页数");
  expect(text).toContain("12 张");
  expect(text).toContain("文字页数");
  expect(text).toContain("约 30 页");
  expect(text).toContain("高精度档");
});
it("debug 模式：显示精确出图模型名", async () => {
  const text = await dialogText("debug=1&text=0");
  expect(text).toContain("gpt-image-2.6-sunburst");
  expect(text).toContain("DeepSeek V4.1 Flash");
  expect(text).toContain("0 页（图文同页）");
});
it("只出卡片：文字页数显示不排版，无顾问排版行", async () => {
  const text = await dialogText("debug=0&cards=1");
  expect(text).toContain("不排版（只出卡片）");
  expect(text).not.toContain("顾问整理与排版");
  expect(text).not.toMatch(VENDOR);
});
it("普通用户：历史读档模型 id 也不外露", async () => {
  const text = await dialogText("debug=0&model=claude-opus-5");
  expect(text).not.toMatch(VENDOR);
  expect(text).toContain("历史档位");
});
