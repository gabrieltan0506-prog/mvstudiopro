import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import { createServer, type Server } from "node:http";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let server: Server;
let origin: string;
let bundle: string;
beforeAll(async () => {
  const output = await build({
    stdin: { resolveDir: process.cwd(), contents: `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { KnowledgeCardMaterialBatches } from './client/src/components/platform/KnowledgeCardMaterialBatches';
      globalThis.mountBatches = (source, saved, readOnly = false) => {
        localStorage.clear();
        if (saved) localStorage.setItem('batch-browser-test', JSON.stringify(saved));
        globalThis.calls = {distill:0, generate:[], positions:[], resume:[], busy:[], images:[]};
        window.confirm = () => true;
        createRoot(document.getElementById('root')).render(React.createElement(KnowledgeCardMaterialBatches, {
          initialSource: source, storageKey:'batch-browser-test', model:'gpt-5.6-sol', fromDocument:true, disabled:false, readOnly,
          onBusyChange: busy => calls.busy.push(busy),
          onDistill: async (source, model, onJob) => { calls.distill++; onJob('distill-new'); return '# 提炼稿\\n\\n## 内容\\n已保留原文重点与具体步骤。'; },
          onGenerate: async (draft,index,total,model,onJob,position) => { calls.generate.push(index); calls.positions.push(position); onJob('image-'+index); return 'https://example.com/card-'+index+'.png'; },
          onResume: async (jobId,kind) => { calls.resume.push({jobId,kind}); return 'https://example.com/recovered.png'; },
          onImagesChange: urls => { calls.images = urls; },
        }));
      };
    ` },
    bundle: true, write: false, format: "iife", platform: "browser", jsx: "automatic",
  });
  bundle = output.outputFiles[0]!.text;
  server = createServer((_request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end('<!doctype html><div id="root"></div>');
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("本地服务未启动");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
  if (server) await new Promise<void>(resolve => server.close(() => resolve()));
});

async function open(source: string, saved?: unknown, readOnly = false) {
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => { void (request.url().startsWith(origin + "/") ? request.continue() : request.abort()); });
  await page.goto(origin);
  await page.addScriptTag({ content: bundle });
  await page.evaluate(({ source, saved, readOnly }) => (globalThis as any).mountBatches(source, saved, readOnly), { source, saved, readOnly });
  await page.waitForSelector("article");
  return page;
}
async function edit(page: Page, index: number, value: string) {
  await page.evaluate(({ index, value }) => {
    const textarea = document.querySelectorAll("textarea")[index];
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, { index, value });
}
async function clickText(page: Page, text: string) {
  await page.evaluate(text => {
    const button = Array.from(document.querySelectorAll("button")).find(b => b.textContent?.includes(text));
    if (!button || button.disabled) throw new Error(`按钮不可用：${text}`);
    button.click();
  }, text);
}

const draft = "# 工作方法\n\n" + "确认读者与材料范围，保留准确的信息和具体操作步骤。".repeat(70);
function saved(pending = true) {
  return { version: 1, batches: [{
    id: "existing", source: "原始材料", draft, draftModel: "gpt-5.6-sol", images: [],
    generation: { draft, model: "gpt-5.6-sol", pageTotal: 4, completed: [] },
    ...(pending ? { pending: { kind: "image", model: "gpt-5.6-sol", pageIndex: 1, jobId: "original-job" } } : {}),
  }] };
}

it("历史只读模式仍可查询原任务，恢复后禁止再次购买", async () => {
  const saved = { version: 1, batches: [{ id: "old-batch", source: "原始材料", draft: "历史正文", generation: { draft: "历史正文", model: "gpt-5.6-sol", pageTotal: 4, completed: [], subjectPosition: "left" }, images: [], subjectPosition: "left", pending: { kind: "image", jobId: "existing-only", pageIndex: 1, model: "gpt-5.6-sol", subjectPosition: "left" } }] };
  const page = await open("原始材料", saved, true);
  try {
    await page.evaluate(() => { const button = Array.from(document.querySelectorAll("button")).find(button => button.textContent?.includes("查询已有任务")); if (!button || button.disabled) throw Error("原任务查询被锁住"); button.click(); });
    await page.waitForFunction(() => (globalThis as any).calls.resume.length === 1);
    expect(await page.evaluate(() => (globalThis as any).calls.resume)).toEqual([{ jobId: "existing-only", kind: "image" }]);
    expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
    expect(await page.evaluate(() => Array.from(document.querySelectorAll("button")).filter(button => /提炼这一份|生成这一份/.test(button.textContent || "")).every(button => button.disabled))).toBe(true);
  } finally { await page.close(); }
});

describe("知识卡分框组件真实离线DOM（仅合成回调）", () => {
  it("100001字符显示3框，编辑超长继续拆，超长稿禁止生成", async () => {
    const page = await open("文".repeat(100001));
    try {
      expect(await page.$$eval("article", nodes => nodes.length)).toBe(3);
      await edit(page, 0, "新".repeat(50001));
      await page.waitForFunction(() => document.querySelectorAll("article").length === 4);
      await edit(page, 1, "稿".repeat(50001));
      await page.waitForFunction(() => document.body.textContent?.includes("超过50,000"));
      expect(await page.$eval("article", node => Array.from(node.querySelectorAll("button")).find(b => b.textContent?.includes("生成这一份"))!.disabled)).toBe(true);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("batch-browser-test")!).batches[0].draft.length)).toBe(50001);
    } finally { await page.close(); }
  });

  it("恢复只查原任务，成功后只生成剩余页，旧图片保留", async () => {
    const page = await open("", saved());
    try {
      await clickText(page, "查询已有任务");
      await page.waitForFunction(() => document.querySelectorAll("article img").length === 1);
      expect(await page.evaluate(() => (globalThis as any).calls.resume)).toEqual([{ jobId: "original-job", kind: "image" }]);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
      await clickText(page, "生成这一份");
      await page.waitForFunction(() => (globalThis as any).calls.busy.at(-1) === false && (globalThis as any).calls.generate.length > 0);
      const calls = await page.evaluate(() => (globalThis as any).calls);
      expect(calls.generate).toEqual([2, 3, 4]);
      expect(calls.images).toContain("https://example.com/recovered.png");
      expect(calls.images).toHaveLength(4);
    } finally { await page.close(); }
  });

  it("未知提交无任务ID保持锁定，畸形存储不覆盖不发请求", async () => {
    const unknown = saved();
    delete (unknown.batches[0].pending as { jobId?: string }).jobId;
    const page = await open("", unknown);
    try {
      expect(await page.$eval("article", node => Array.from(node.querySelectorAll("button")).every(b => b.disabled))).toBe(true);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
    } finally { await page.close(); }
    const malformed = { version: 1, batches: [{ ...saved().batches[0], images: [null] }] };
    const broken = await open("保留原文", malformed);
    try {
      await broken.waitForFunction(() => document.body.textContent?.includes("原草稿读取失败"));
      expect(await broken.evaluate(() => JSON.parse(localStorage.getItem("batch-browser-test")!))).toEqual(malformed);
      expect(await broken.evaluate(() => (globalThis as any).calls.distill)).toBe(0);
    } finally { await broken.close(); }
  });

  it("分页变化保留旧记录并禁止按新页码继续生成", async () => {
    const changed = saved(false);
    changed.batches[0].generation.pageTotal = 2;
    const page = await open("", changed);
    try {
      await page.waitForFunction(() => document.body.textContent?.includes("当前分页为4页"));
      expect(await page.$eval("article", node => Array.from(node.querySelectorAll("button")).find(b => b.textContent?.includes("生成这一份"))!.disabled)).toBe(true);
      expect(await page.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
      expect(await page.evaluate(() => JSON.parse(localStorage.getItem("batch-browser-test")!).batches[0].generation.pageTotal)).toBe(2);
    } finally { await page.close(); }
  });

  it("居中选择随请求和恢复记录保存，画幅控件固定横版", async () => {
    const page = await open("", saved(false));
    try {
      await page.select("select", "center");
      await clickText(page, "生成这一份");
      await page.waitForFunction(() => (globalThis as any).calls.generate.length === 4 && (globalThis as any).calls.busy.at(-1) === false);
      expect(await page.evaluate(() => (globalThis as any).calls.positions)).toEqual(["center", "center", "center", "center"]);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("batch-browser-test")!));
      expect(stored.batches[0].subjectPosition).toBe("center");
      expect(stored.batches[0].generation.subjectPosition).toBe("center");
      const restored = await open("", stored);
      try {
        expect(await restored.$eval("select", el => (el as HTMLSelectElement).value)).toBe("center");
        expect(await restored.evaluate(() => document.body.textContent)).toContain("横版16:9");
        expect(await restored.evaluate(() => (globalThis as any).calls.generate)).toEqual([]);
      } finally { await restored.close(); }
    } finally { await page.close(); }
  });

  it("左中生成后切回左侧不再购买已经完成的页", async () => {
    const page = await open("", saved(false));
    try {
      await clickText(page, "生成这一份");
      await page.waitForFunction(() => (globalThis as any).calls.generate.length === 4 && (globalThis as any).calls.busy.at(-1) === false);
      await page.select("select", "center");
      await clickText(page, "生成这一份");
      await page.waitForFunction(() => (globalThis as any).calls.generate.length === 8 && (globalThis as any).calls.busy.at(-1) === false);
      await page.select("select", "left");
      await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some(b => b.textContent?.includes("剩余0/4页") && b.disabled));
      expect(await page.evaluate(() => (globalThis as any).calls.generate.length)).toBe(8);
      const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("batch-browser-test")!));
      const restored = await open("", stored);
      try { expect(await restored.$eval("article", node => Array.from(node.querySelectorAll("button")).find(b => b.textContent?.includes("生成这一份"))!.disabled)).toBe(true); }
      finally { await restored.close(); }
    } finally { await page.close(); }
  });

  it("本地存储失败在付费回调前停止", async () => {
    const page = await open("需要提炼的资料");
    try {
      await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error("模拟存储空间不足"); }; });
      await clickText(page, "提炼这一份");
      await page.waitForFunction(() => document.body.textContent?.includes("任务记录保存失败"));
      expect(await page.evaluate(() => (globalThis as any).calls.distill)).toBe(0);
    } finally { await page.close(); }
  });
});
