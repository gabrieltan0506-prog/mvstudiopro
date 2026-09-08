import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import path from "node:path";
let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const output = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react'; import {createRoot} from 'react-dom/client'; import {KnowledgeCardTextReviewPanel} from './client/src/components/platform/KnowledgeCardTextReviewPanel';
 const f=globalThis.fixture={text:'原文199元😀',calls:[],resumes:[],applied:[],mode:'success',key:'review'}; const root=createRoot(document.getElementById('root'));
 f.result=()=>({issues:[{id:'model-a',start:0,end:2,original:'原文',suggestion:'正文',kind:'ocr',reason:'请核对原页',source:'model',confidence:'medium'}],summary:'请确认疑点',checkedChars:8});
 f.render=()=>root.render(<KnowledgeCardTextReviewPanel sourceText={f.text} storageKey={f.key} onApply={text=>{f.applied.push(text);f.text=text;f.render()}} onReview={f.rulesOnly ? undefined : async(text,id)=>{f.calls.push({text,id});if(f.mode==='unknown')throw Error('未知');if(f.mode==='terminal')throw Object.assign(Error('失败'),{terminal:true});return f.result()}} onResume={async id=>{f.resumes.push(id);return f.result()}} />);f.render();`,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: { "@shared": path.resolve("shared") },
    define: { "process.env.NODE_ENV": '"test"' },
  });
  bundle = output.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
});
async function fixture() {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setRequestInterception(true);
  page.on(
    "request",
    request =>
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<html><body><div id="root"></div></body></html>',
      })
  );
  await page.goto("http://localhost:41815");
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("button");
  return { page, context };
}
async function click(page: Page, label: string) {
  await page.evaluate(label => {
    const button = Array.from(document.querySelectorAll("button")).find(
      b => b.textContent === label
    );
    if (!button || button.disabled) throw Error(`按钮不可用：${label}`);
    button.click();
  }, label);
}
async function disabled(page: Page, label: string) {
  return page.evaluate(
    label =>
      Array.from(document.querySelectorAll("button")).find(
        b => b.textContent === label
      )?.disabled,
    label
  );
}

describe("校对面板真实离线 DOM", () => {
  it("建议默认不选，精确应用且保留数字emoji，可撤回", async () => {
    const { page, context } = await fixture();
    try {
      await click(page, "检查文本");
      await page.waitForSelector('input[aria-label="选择建议 model-a"]');
      expect(await disabled(page, "应用勾选建议")).toBe(true);
      await page.click('input[aria-label="选择建议 model-a"]');
      await click(page, "应用勾选建议");
      await page.waitForFunction(
        () => (globalThis as any).fixture.text === "正文199元😀"
      );
      await click(page, "撤回上次应用");
      expect(await page.evaluate(() => (globalThis as any).fixture.text)).toBe(
        "原文199元😀"
      );
    } finally {
      await context.close();
    }
  });
  it("正文改变后禁止应用旧建议，规则疑点无自动替换", async () => {
    const { page, context } = await fixture();
    try {
      await click(page, "检查文本");
      await page.waitForSelector("input");
      await page.click("input");
      await page.evaluate(() => {
        const f = (globalThis as any).fixture;
        f.text += "新";
        f.render();
      });
      await page.waitForFunction(() =>
        document.body.textContent?.includes("结果已过期")
      );
      expect(await disabled(page, "应用勾选建议")).toBe(true);
      expect(
        await page.evaluate(() => (globalThis as any).fixture.applied)
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
  it("未知结果保留原ID，重新挂载不重发，查询只用原ID", async () => {
    const { page, context } = await fixture();
    try {
      await page.evaluate(() => {
        (globalThis as any).fixture.mode = "unknown";
      });
      await click(page, "检查文本");
      await page.waitForSelector('[role="alert"]');
      const id = await page.evaluate(
        () => (globalThis as any).fixture.calls[0].id
      );
      await page.evaluate(() => {
        const f = (globalThis as any).fixture;
        f.key = "other";
        f.render();
      });
      await page.waitForFunction(
        () => !document.body.textContent?.includes("查询原检查任务")
      );
      await page.evaluate(() => {
        const f = (globalThis as any).fixture;
        f.key = "review";
        f.render();
      });
      await page.waitForFunction(() =>
        document.body.textContent?.includes("查询原检查任务")
      );
      await click(page, "查询原检查任务");
      await page.waitForSelector('input[aria-label="选择建议 model-a"]');
      expect(
        await page.evaluate(() => (globalThis as any).fixture.calls.length)
      ).toBe(1);
      expect(
        await page.evaluate(() => (globalThis as any).fixture.resumes)
      ).toEqual([id]);
    } finally {
      await context.close();
    }
  });
  it("存储失败零检查请求，坏草稿不覆盖", async () => {
    const { page, context } = await fixture();
    try {
      await page.evaluate(() => {
        Storage.prototype.setItem = () => {
          throw Error("quota");
        };
      });
      await click(page, "检查文本");
      await page.waitForSelector('[role="alert"]');
      expect(
        await page.evaluate(() => (globalThis as any).fixture.calls)
      ).toEqual([]);
      expect(
        await page.evaluate(() => (globalThis as any).fixture.applied)
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
  it("明确失败解锁但原文不变，结果保存失败保留pending且不应用", async () => {
    const { page, context } = await fixture();
    try {
      await page.evaluate(() => {
        (globalThis as any).fixture.mode = "terminal";
      });
      await click(page, "检查文本");
      await page.waitForSelector('[role="alert"]');
      expect(await disabled(page, "检查文本")).toBe(false);
      expect(await page.evaluate(() => (globalThis as any).fixture.text)).toBe(
        "原文199元😀"
      );
    } finally {
      await context.close();
    }
  });
  it("规则初筛仅标识乱码，不自动替换或调用模型", async () => {
    const { page, context } = await fixture();
    try {
      await page.evaluate(() => {
        const f = (globalThis as any).fixture;
        f.rulesOnly = true;
        f.text = "甲�字";
        f.render();
      });
      await page.waitForFunction(() =>
        document.body.textContent?.includes("规则初筛")
      );
      await click(page, "规则初筛");
      await page.waitForSelector("input[type=checkbox]");
      expect(
        await page.$eval("input", input => (input as HTMLInputElement).disabled)
      ).toBe(true);
      expect(
        await page.evaluate(() => (globalThis as any).fixture.calls)
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
  it("坏草稿保持原字节，禁止检查和应用", async () => {
    const { page, context } = await fixture();
    try {
      await page.evaluate(() => {
        localStorage.setItem("broken", "{broken");
        const f = (globalThis as any).fixture;
        f.key = "broken";
        f.render();
      });
      await page.waitForSelector('[role="alert"]');
      expect(await disabled(page, "检查文本")).toBe(true);
      expect(await page.evaluate(() => localStorage.getItem("broken"))).toBe(
        "{broken"
      );
    } finally {
      await context.close();
    }
  });
  it("结果或确认稿保存失败时保留原任务与原文", async () => {
    const { page, context } = await fixture();
    try {
      await page.evaluate(() => {
        const write = Storage.prototype.setItem;
        let n = 0;
        Storage.prototype.setItem = function (k, v) {
          if (++n > 1) throw Error("quota");
          return write.call(this, k, v);
        };
      });
      await click(page, "检查文本");
      await page.waitForSelector('[role="alert"]');
      expect(await disabled(page, "检查文本")).toBe(true);
      expect(
        await page.evaluate(
          () => JSON.parse(localStorage.getItem("review")!).pendingId
        )
      ).toBeTruthy();
      expect(
        await page.evaluate(() => (globalThis as any).fixture.applied)
      ).toEqual([]);
    } finally {
      await context.close();
    }
  });
  it("确认稿存储失败不回调修改正文", async () => {
    const { page, context } = await fixture();
    try {
      await click(page, "检查文本");
      await page.waitForSelector('input[aria-label="选择建议 model-a"]');
      await page.click('input[aria-label="选择建议 model-a"]');
      await page.evaluate(() => {
        Storage.prototype.setItem = () => {
          throw Error("quota");
        };
      });
      await click(page, "应用勾选建议");
      await page.waitForSelector('[role="alert"]');
      expect(
        await page.evaluate(() => (globalThis as any).fixture.applied)
      ).toEqual([]);
      expect(await page.evaluate(() => (globalThis as any).fixture.text)).toBe(
        "原文199元😀"
      );
    } finally {
      await context.close();
    }
  });
});
