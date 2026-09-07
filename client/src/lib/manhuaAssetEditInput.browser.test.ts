import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";

// 独立离线浏览器执行真实组件；所有网络拦截，不连接用户窗口或生产服务。
const ORIGIN = "http://localhost:41801";
let browser: Browser;
let bundle: string;

beforeAll(async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { ManhuaAssetEditInput } from './client/src/components/ManhuaAssetEditInput';
        const root = createRoot(document.getElementById('root'));
        const f = globalThis.fixture = { calls: [], nativePrompts: 0 };
        window.prompt = () => { f.nativePrompts++; throw Error('禁止原生输入框'); };
        f.render = (disabled = false, busy = false) => root.render(
          <ManhuaAssetEditInput labelZh="墨屠·原黑翼" disabled={disabled} busy={busy}
            onSubmit={text => { f.calls.push(text); return new Promise((resolve, reject) => {
              f.resolve = resolve; f.reject = reject;
            }); }} />);
        f.render();
      `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
  });
  bundle = built.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);

afterAll(async () => {
  await browser?.close();
});

async function fixture() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (new URL(request.url()).origin === ORIGIN) {
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><html lang="zh-CN"><body><div id="root"></div></body></html>',
      });
    } else void request.abort();
  });
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("#root button");
  return { page, context };
}

async function open(page: Page) {
  await page.click("#root button");
  await page.waitForSelector('[role="dialog"] textarea');
}

async function clickAction(page: Page, text: string) {
  await page.evaluate(label => {
    const button = Array.from(
      document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')
    ).find(item => item.textContent?.trim() === label);
    if (!button) throw new Error(`找不到按钮：${label}`);
    button.click();
  }, text);
}

describe("资产编辑输入真实浏览器（离线）", () => {
  it("父回调取消或已处理失败返回 false 时保留文字，不自动重提", async () => {
    const { page, context } = await fixture();
    try {
      await open(page);
      const text = "保留黑翼和四条尾巴";
      await page.type("textarea", text);
      await clickAction(page, "继续确认费用");
      await page.waitForFunction("fixture.calls.length === 1");
      await page.evaluate("fixture.resolve(false)");
      await page.waitForFunction(
        "!document.querySelector('[role=dialog] textarea').disabled"
      );
      expect(
        await page.$eval("textarea", el => (el as HTMLTextAreaElement).value)
      ).toBe(text);
      expect(await page.evaluate("fixture.calls")).toEqual([text]);
    } finally {
      await context.close();
    }
  }, 20_000);
  it("空白禁用，取消零提交，不调用原生 prompt", async () => {
    const { page, context } = await fixture();
    try {
      await open(page);
      expect(await page.$eval('[role="dialog"] h2', el => el.textContent)).toBe(
        "编辑图片 · 墨屠·原黑翼"
      );
      expect(
        await page.$eval(
          '[role="dialog"] button:last-child',
          el => (el as HTMLButtonElement).disabled
        )
      ).toBe(true);
      await page.type("textarea", "  \n  ");
      expect(
        await page.$eval(
          '[role="dialog"] button:last-child',
          el => (el as HTMLButtonElement).disabled
        )
      ).toBe(true);
      await clickAction(page, "继续确认费用");
      await clickAction(page, "取消");
      await page.waitForSelector('[role="dialog"]', { hidden: true });
      expect(await page.evaluate("fixture.calls")).toEqual([]);
      expect(await page.evaluate("fixture.nativePrompts")).toBe(0);
    } finally {
      await context.close();
    }
  });

  it("中文多行准确传递，同帧连续点击只提交一次，等待期间不可关闭", async () => {
    const { page, context } = await fixture();
    try {
      await open(page);
      const text = "保留黑色羽翼与金色独角。\n恰好四条尾巴，护住阿菁。";
      await page.type("textarea", text);
      await page.evaluate(() => {
        const button = document.querySelector<HTMLButtonElement>(
          '[role="dialog"] button:last-child'
        )!;
        button.click();
        button.click();
        button.click();
      });
      await page.waitForFunction("fixture.calls.length === 1");
      expect(await page.evaluate("fixture.calls")).toEqual([text]);
      expect(
        await page.$eval("textarea", el => (el as HTMLTextAreaElement).disabled)
      ).toBe(true);
      expect(
        await page.$$eval('[role="dialog"] button', els =>
          els.every(el => (el as HTMLButtonElement).disabled)
        )
      ).toBe(true);
      await page.keyboard.press("Escape");
      expect(await page.$('[role="dialog"]')).not.toBeNull();
      await page.evaluate("fixture.resolve()");
      await page.waitForSelector('[role="dialog"]', { hidden: true });
      expect(await page.evaluate("fixture.calls")).toHaveLength(1);
    } finally {
      await context.close();
    }
  });

  it("拒绝保留输入和错误，释放锁后只能手动再次提交", async () => {
    const { page, context } = await fixture();
    try {
      await open(page);
      const text = "四肢完整，原图保持不变";
      await page.type("textarea", text);
      await clickAction(page, "继续确认费用");
      await page.waitForFunction("fixture.calls.length === 1");
      await page.evaluate("fixture.reject(new Error('测试提交失败'))");
      await page.waitForSelector('[role="alert"]');
      expect(await page.$eval('[role="alert"]', el => el.textContent)).toBe(
        "测试提交失败"
      );
      expect(
        await page.$eval("textarea", el => (el as HTMLTextAreaElement).value)
      ).toBe(text);
      expect(await page.evaluate("fixture.calls")).toEqual([text]);
      await clickAction(page, "继续确认费用");
      await page.waitForFunction("fixture.calls.length === 2");
      await page.evaluate("fixture.resolve()");
      await page.waitForSelector('[role="dialog"]', { hidden: true });
      expect(await page.evaluate("fixture.calls")).toEqual([text, text]);
    } finally {
      await context.close();
    }
  });

  it("disabled 禁止打开，打开后外部禁用也禁止提交，busy 显示真实状态", async () => {
    const { page, context } = await fixture();
    try {
      await page.evaluate("fixture.render(true, true)");
      await page.waitForFunction(
        "document.querySelector('#root button').disabled"
      );
      expect(await page.$eval("#root button", el => el.textContent)).toBe(
        "编辑中…"
      );
      await page.$eval("#root button", el => (el as HTMLButtonElement).click());
      expect(await page.$('[role="dialog"]')).toBeNull();
      await page.evaluate("fixture.render(false, false)");
      await page.waitForFunction(
        "!document.querySelector('#root button').disabled"
      );
      await open(page);
      await page.type("textarea", "完整保留羽翼");
      await page.evaluate("fixture.render(true, true)");
      await page.waitForFunction(
        "document.querySelector('[role=dialog] button:last-child').disabled"
      );
      await clickAction(page, "继续确认费用");
      expect(await page.evaluate("fixture.calls")).toEqual([]);
    } finally {
      await context.close();
    }
  });
});
