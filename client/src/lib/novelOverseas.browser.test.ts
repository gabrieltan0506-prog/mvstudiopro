/** 真实小说页面：选择仅存草稿；发送仍走原有确认与服务入口。 */
import { it, expect } from "vitest";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { buildNovelStudioUiPreview } from "./novelStudioUi.browser.fixture";

it("小说素材预填保留旧问题和正文，刷新可恢复，首次讨论也能发送", async () => {
  const { html } = await buildNovelStudioUiPreview();
  const server = createServer((_, res) => { res.setHeader("Content-Type", "text/html;charset=utf-8"); res.end(html); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage(); const errors: string[] = [];
    page.on("pageerror", error => { errors.push(String(error)); console.error(error); });
    page.on("dialog", dialog => void dialog.accept());
    const url = `http://127.0.0.1:${(server.address() as any).port}`;
    await page.goto(url); await page.waitForSelector('[aria-label="回复顾问"]').catch(async e => { console.error(await page.$eval('body', el => el.innerText)); throw e; });
    const before = await page.evaluate(() => (globalThis as any).readDraft());
    await page.type('[aria-label="回复顾问"]', "保留原人物动机。");
    const click = async (text: string) => page.evaluate(text => {
      const button = Array.from(document.querySelectorAll("button")).find(el => el.textContent?.trim() === text);
      if (!button || button.disabled) throw new Error("按钮不可用：" + text); button.click();
    }, text);
    await click("漫剧出海"); await page.waitForSelector('[role="dialog"]');
    await page.type('[aria-label="搜索漫剧出海素材"]', "博物馆夜班");
    await click("围绕这个故事准备顾问问题");
    await page.waitForFunction(() => (document.querySelector('[aria-label="回复顾问"]') as HTMLTextAreaElement)?.value.includes("overseas-film-32"));
    expect(await page.$eval('[aria-label="回复顾问"]', el => (el as HTMLTextAreaElement).value)).toMatch(/^保留原人物动机。\n\n请结合当前小说/);
    await page.waitForFunction(async () => (await (globalThis as any).readDraft()).advisorDraft?.includes("overseas-film-32"));
    expect((await page.evaluate(() => (globalThis as any).readDraft())).chapters).toEqual(before.chapters);
    expect(await page.evaluate(() => (globalThis as any).calls)).toEqual([]);
    await page.reload(); await page.waitForSelector('[aria-label="回复顾问"]');
    expect(await page.$eval('[aria-label="回复顾问"]', el => (el as HTMLTextAreaElement).value)).toContain("overseas-film-32");
    await page.setViewport({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: "/Users/tangenjie/Downloads/2026Oct20/漫剧出海验证记录/小说出海-390.png" });
    // 清除夹具里的旧建议，验证没有首轮回复时仍能承接素材问题。
    await page.evaluate(async () => { const d = await (globalThis as any).readDraft(); d.runs = []; d.advisorAnchor = undefined; d.continuity = "小吏已取得密件，人物身份与未解伏笔保留。"; d.continuityThrough = 1; d.continuityBase = d.chapters[0]; await (globalThis as any).writeDraft(d); });
    await page.reload(); await page.waitForSelector('[aria-label="回复顾问"]');
    await click("发送给顾问");
    await page.waitForFunction(() => (globalThis as any).calls.length === 1).catch(async e => { console.error(await page.$eval("body", el => el.innerText)); throw e; });
    const call = await page.evaluate(() => (globalThis as any).calls[0]);
    expect(call.stage).toBe("advice"); expect(call.advisorMessage).toContain("overseas-film-32");
    expect(call.advisorMessage).toContain("不改写正文");
    expect((await page.evaluate(() => (globalThis as any).readDraft())).chapters).toEqual(before.chapters);
    expect(errors).toEqual([]);
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}, 60_000);
