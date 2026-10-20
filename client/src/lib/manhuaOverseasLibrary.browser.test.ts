/** 离线真实组件验证：目录选择与模型提交分离，现有特效草稿保留。 */
import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";

it("工作流入口可打开32片、分类检索并准备指定问题；特效追加后才显式采用", async () => {
  const bundle = await build({ stdin: { resolveDir: process.cwd(), loader: "tsx", contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {ManhuaOverseasLibraryButton} from './client/src/components/canvas/ManhuaOverseasLibrary';
    import {ManhuaVfxPicker} from './client/src/components/canvas/ManhuaVfxPicker';
    import {buildManhuaCraftReference} from './shared/manhuaCraftKnowledge';
    globalThis.fixture={questions:[],references:[],applied:[]};
    createRoot(document.getElementById('root')).render(<><ManhuaOverseasLibraryButton enabled onPrepareQuestion={q=>{fixture.questions.push(q);fixture.references.push(buildManhuaCraftReference(q));}}/><ManhuaVfxPicker shotIndex={1} disabled={false} initialDirection="保留原镜头的蓝色光线。" onApply={text=>fixture.applied.push(text)}/></>);
  ` }, bundle: true, write: false, platform: "browser", format: "iife", jsx: "automatic", alias: { "@": path.resolve("client/src"), "@shared": path.resolve("shared") }, define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "{}" }, logLevel: "silent" });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(); const errors: string[] = []; page.on("pageerror", error => errors.push(String(error)));
    await page.setRequestInterception(true); page.on("request", request => request.respond({ status: 200, body: "" }));
    await page.goto("http://localhost/"); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = async (label: string) => page.evaluate(label => { const button = Array.from(document.querySelectorAll("button")).find(row => row.textContent === label); if (!button || button.disabled) throw new Error("按钮不可用：" + label); button.click(); }, label);
    await click("漫剧出海"); await page.waitForSelector('[role="dialog"]');
    expect(await page.$$eval('[aria-label="漫剧出海素材库"] article', rows => rows.length)).toBe(33);
    await click("运镜"); await page.waitForFunction(() => document.querySelectorAll('[aria-label="漫剧出海素材库"] article').length === 4);
    await click("故事素材");
    await page.type('[aria-label="搜索漫剧出海素材"]', "博物馆夜班");
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="漫剧出海素材库"] article').length === 1);
    await click("围绕这个故事准备顾问问题"); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    const first = await page.evaluate(() => (globalThis as any).fixture);
    expect(first.questions).toHaveLength(1); expect(first.questions[0]).toContain("overseas-film-32"); expect(first.references[0]).toContain("近空桶底"); expect(first.applied).toEqual([]);
    await click("漫剧出海"); await click("声音剪辑");
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="漫剧出海素材库"] article').length === 2);
    expect(await page.$eval('[aria-label="漫剧出海素材库"]', el => el.textContent)).toContain("未人工试听");
    await page.keyboard.press("Escape"); await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
    await page.$eval('[data-manhua-vfx-picker]', el => (el as HTMLDetailsElement).open = true);
    await page.$$eval('[data-manhua-vfx-picker] details', rows => rows.forEach(row => (row as HTMLDetailsElement).open = true));
    await click("补入本镜待编辑描述");
    await page.waitForFunction(() => (document.querySelector('[aria-label="本镜特效描述"]') as HTMLTextAreaElement).value.includes("告别型消散"));
    expect(await page.evaluate(() => (globalThis as any).fixture.applied)).toEqual([]);
    await click("采用到当前镜头");
    const applied = await page.evaluate(() => (globalThis as any).fixture.applied);
    expect(applied).toHaveLength(1); expect(applied[0]).toContain("保留原镜头的蓝色光线。"); expect(applied[0]).toContain("告别型消散");
    expect(errors).toEqual([]);
  } finally { await browser.close(); }
}, 60_000);
