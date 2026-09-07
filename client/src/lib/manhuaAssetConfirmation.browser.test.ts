import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";

// 独立离线浏览器；真实输入组件和确认 hook，所有请求拦截，绝不连接生产。
const ORIGIN = "http://localhost:41802";
let browser: Browser;
let bundle: string;
const CONFIRM = '[data-confirmation="true"]';

beforeAll(async () => {
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import { ManhuaAssetEditInput } from './client/src/components/ManhuaAssetEditInput';
        import { useManhuaAssetConfirmation } from './client/src/components/useManhuaAssetConfirmation';
        const root = createRoot(document.getElementById('root'));
        const f = globalThis.fixture = { submitted: [], generated: [], results: [], native: 0 };
        window.confirm = window.prompt = () => { f.native++; throw Error('禁止原生弹窗'); };
        const options = title => ({ title, description: '3 积分/张；原图保留。', details: '保留黑翼，恰好四条尾巴。' });
        function App({scope}) {
          const {confirmAssetAction, assetConfirmationDialog} = useManhuaAssetConfirmation(scope);
          f.ask = title => confirmAssetAction(options(title)).then(value => { f.results.push([title, value]); return value; });
          return <><ManhuaAssetEditInput labelZh="墨屠·原图" disabled={false} busy={false}
            onSubmit={async text => {
              f.submitted.push(text);
              if (!await confirmAssetAction(options('确认图片编辑费用'))) return false;
              f.generated.push(text);
              return true;
            }} />{assetConfirmationDialog}</>;
        }
        f.render = scope => root.render(<App scope={scope} />);
        f.unmount = () => root.unmount();
        f.render('原工作区');
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
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30_000);
afterAll(async () => {
  await browser?.close();
});

async function fixture() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  let blockedRequests = 0;
  await page.setRequestInterception(true);
  page.on("request", request => {
    if (request.isNavigationRequest() && request.url() === `${ORIGIN}/`) {
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<!doctype html><html lang="zh-CN"><head><link rel="icon" href="data:,"></head><body><div id="root"></div></body></html>',
      });
    } else {
      blockedRequests++;
      void request.abort();
    }
  });
  await page.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  // 几何夹具只复现现有定位/z-index类，不提供新的确认层级；无外部样式请求。
  await page.addStyleTag({
    content: `
    [data-slot="dialog-overlay"] { position:fixed; inset:0; z-index:50; background:#0008; }
    [data-slot="dialog-content"] { position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); width:480px; padding:24px; background:#141418; color:white; }
    [class~="z-[90]"] { z-index:90; } [class~="z-[100]"] { z-index:100; }
    textarea { display:block; width:420px; } button { padding:12px; margin:4px; }
  `,
  });
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("#root button");
  return { page, context, blockedRequests: () => blockedRequests };
}

async function markConfirmation(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[role="dialog"]')).some(
      el => !el.querySelector("textarea")
    )
  );
  await page.evaluate(() => {
    const dialog = Array.from(
      document.querySelectorAll('[role="dialog"]')
    ).find(el => !el.querySelector("textarea"))!;
    dialog.setAttribute("data-confirmation", "true");
  });
}
async function startEdit(
  page: Page,
  text = "保留黑翼。\n恰好四条尾巴，护住阿菁。"
) {
  await page.click("#root button");
  await page.waitForSelector("textarea");
  await page.type("textarea", text);
  await page.click('[role="dialog"] button:last-child');
  await markConfirmation(page);
  return text;
}

describe("资产费用确认真实组件（离线）", () => {
  it("嵌套确认实际鼠标可点、焦点可达；取消保留中文输入且零生成", async () => {
    const s = await fixture();
    try {
      const text = await startEdit(s.page);
      expect(
        await s.page.$eval(CONFIRM, el => getComputedStyle(el).zIndex)
      ).toBe("100");
      expect(
        await s.page.$eval(CONFIRM, el => el.contains(document.activeElement))
      ).toBe(true);
      await s.page.keyboard.press("Tab");
      expect(
        await s.page.$eval(CONFIRM, el => el.contains(document.activeElement))
      ).toBe(true);
      await s.page.click(`${CONFIRM} button:first-child`);
      await s.page.waitForSelector(CONFIRM, { hidden: true });
      await s.page.waitForFunction(
        "!document.querySelector('textarea').disabled"
      );
      expect(
        await s.page.$eval("textarea", el => (el as HTMLTextAreaElement).value)
      ).toBe(text);
      expect(await s.page.evaluate("fixture.generated")).toEqual([]);
      expect(await s.page.evaluate("fixture.native")).toBe(0);
      expect(s.blockedRequests()).toBe(0);
    } finally {
      await s.context.close();
    }
  });

  it("费用确认前零生成；同帧重复确认只生成一次", async () => {
    const s = await fixture();
    try {
      const text = await startEdit(s.page);
      expect(await s.page.evaluate("fixture.generated")).toEqual([]);
      // 同一帧连续派发，确保 React 尚未卸载时同一请求也不能二次结算。
      await s.page.$eval(`${CONFIRM} button:last-child`, el => {
        const button = el as HTMLButtonElement;
        button.click();
        button.click();
        button.click();
      });
      await s.page.waitForFunction("fixture.generated.length === 1");
      await s.page.waitForSelector('[role="dialog"]', { hidden: true });
      expect(await s.page.evaluate("fixture.generated")).toEqual([text]);
      expect(await s.page.evaluate("fixture.submitted")).toEqual([text]);
    } finally {
      await s.context.close();
    }
  });

  it("Escape 只取消费用确认，返回仍有中文输入的编辑框", async () => {
    const s = await fixture();
    try {
      const text = await startEdit(s.page);
      await s.page.keyboard.press("Escape");
      await s.page.waitForSelector(CONFIRM, { hidden: true });
      await s.page.waitForFunction(
        "!document.querySelector('textarea').disabled"
      );
      expect(
        await s.page.$eval("textarea", el => (el as HTMLTextAreaElement).value)
      ).toBe(text);
      expect(await s.page.evaluate("fixture.generated")).toEqual([]);
    } finally {
      await s.context.close();
    }
  });

  it("卸载会拒绝待确认请求，旧回调卸载后也不能再打开", async () => {
    const s = await fixture();
    try {
      await s.page.evaluate("void fixture.ask('卸载前')");
      await markConfirmation(s.page);
      await s.page.evaluate("fixture.unmount()");
      await s.page.waitForFunction("fixture.results.length === 1");
      await s.page.evaluate("fixture.ask('卸载后')");
      expect(await s.page.evaluate("fixture.results")).toEqual([
        ["卸载前", false],
        ["卸载后", false],
      ]);
      expect(await s.page.$('[role="dialog"]')).toBeNull();
    } finally {
      await s.context.close();
    }
  });

  it("scope 变化取消旧请求，新工作区能够重新确认", async () => {
    const s = await fixture();
    try {
      await s.page.evaluate("void fixture.ask('旧工作区费用')");
      await markConfirmation(s.page);
      await s.page.evaluate("fixture.render('新工作区')");
      await s.page.waitForFunction("fixture.results.length === 1");
      expect(await s.page.evaluate("fixture.results")).toEqual([
        ["旧工作区费用", false],
      ]);
      await s.page.evaluate("void fixture.ask('新工作区费用')");
      await markConfirmation(s.page);
      await s.page.click(`${CONFIRM} button:last-child`);
      await s.page.waitForFunction("fixture.results.length === 2");
      expect(await s.page.evaluate("fixture.results")).toEqual([
        ["旧工作区费用", false],
        ["新工作区费用", true],
      ]);
    } finally {
      await s.context.close();
    }
  });

  it("并发确认拒绝第二项，不覆盖第一项目标或结果", async () => {
    const s = await fixture();
    try {
      await s.page.evaluate(
        "void fixture.ask('第一项'); void fixture.ask('第二项')"
      );
      await markConfirmation(s.page);
      expect(await s.page.$eval(`${CONFIRM} h2`, el => el.textContent)).toBe(
        "第一项"
      );
      expect(await s.page.evaluate("fixture.results")).toEqual([
        ["第二项", false],
      ]);
      await s.page.click(`${CONFIRM} button:last-child`);
      await s.page.waitForFunction("fixture.results.length === 2");
      expect(await s.page.evaluate("fixture.results")).toEqual([
        ["第二项", false],
        ["第一项", true],
      ]);
      expect(await s.page.evaluate("fixture.generated")).toEqual([]);
    } finally {
      await s.context.close();
    }
  });
});
