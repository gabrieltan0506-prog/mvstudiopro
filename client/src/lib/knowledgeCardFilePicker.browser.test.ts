import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

it("不同类型可分批追加，选文件不提交；去重/移除/失败保留/单次提交", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "knowledge-picker-"));
  const paths = ["资料.pdf", "演示.pptx", "照片.png", "不支持.exe"].map(n => path.join(dir, n));
  for (const file of paths) await writeFile(file, "test-only");
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `import React from 'react';import{createRoot}from'react-dom/client';import{KnowledgeCardFilePicker}from'./client/src/components/platform/KnowledgeCardFilePicker';globalThis.calls=[];globalThis.ok=false;createRoot(document.getElementById('root')).render(<KnowledgeCardFilePicker disabled={false} onProcess={async files=>{globalThis.calls.push(files.map(f=>f.name));await new Promise(r=>setTimeout(r,50));return globalThis.ok;}}/>);` }, bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const input = await page.waitForSelector('input[type=file]');
    await input!.uploadFile(paths[0]);
    await page.waitForFunction(() => document.querySelectorAll('li').length === 1);
    await input!.uploadFile(paths[1], paths[2], paths[0]);
    await page.waitForFunction(() => document.querySelectorAll('li').length === 3);
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    await input!.uploadFile(paths[3]);
    await page.waitForSelector('[role=alert]');
    expect(await page.$$eval('li', els => els.length)).toBe(3);
    await page.click('[aria-label="移除 照片.png"]');
    await page.waitForFunction(() => document.querySelectorAll('li').length === 2);
    const submit = async () => page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find(b => b.textContent?.includes('开始精炼'))!; b.click(); b.click(); });
    await submit();
    await page.waitForFunction(() => document.body.textContent?.includes('开始精炼（2 个文件）'));
    expect(await page.evaluate(() => (globalThis as any).calls)).toEqual([["资料.pdf", "演示.pptx"]]);
    expect(await page.$$eval('li', els => els.length)).toBe(2);
    await page.evaluate(() => { (globalThis as any).ok = true; }); await submit();
    await page.waitForFunction(() => document.querySelectorAll('li').length === 0);
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(2);
  } finally { await browser.close(); await rm(dir, { recursive: true, force: true }); }
}, 20000);
