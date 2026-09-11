/**
 * 真实组件回归（终审 P1）：渲染真的 PlatformPage，走真的「粘贴长文 → 提炼 → 切成稿档 → 派生」。
 *
 * 钉两件事：
 * 1) 派生没结束之前不许出图——此刻文本框里还是完整版，按完整版页数计费、出的也是另一档；
 *    生成按钮、文本框、上传、档位下拉都必须锁住，且 handler 内也拦（不只是禁按钮）。
 * 2) 派生结束后正文与报价一起更新；派生失败要退回高级版并保住完整版。
 *
 * 全离线：tRPC 与 job 轮询都被拦成本地桩回包。
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let context: Awaited<ReturnType<Browser["createBrowserContext"]>>;
let page: Page;
let bundle: string;

const TA = 'textarea[placeholder*="粘贴中文正文"]';
const LEVEL = '[aria-label="成稿档"]';
const SOURCE_TEXT = "这是一段足够长的原始文案，讲现金流、负债与投资比例。".repeat(1200);

beforeAll(async () => {
  const result = await build({
    entryPoints: ["client/src/lib/knowledgeCardDeriveInterlock.fixture.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: { "@": `${process.cwd()}/client/src`, "@shared": `${process.cwd()}/shared` },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".css": "text" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "__VITE_ENV__" },
    banner: { js: 'var __VITE_ENV__ = {DEV:false,PROD:true,MODE:"production",SSR:false};' },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
}, 180_000);

afterAll(async () => {
  await context?.close().catch(() => {});
  await browser?.close();
});

afterEach(async () => {
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
});

/** 每个用例一个全新浏览器上下文：localStorage（含成稿档偏好）不串味 */
async function mount(): Promise<Page> {
  context = await browser.createBrowserContext();
  const p = await context.newPage();
  await p.setRequestInterception(true);
  p.on("request", (q) => (q.url().startsWith("data:") ? q.continue() : q.respond({ status: 200, body: "" })));
  await p.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.setContent("<div id=root></div>");
  await p.evaluate(bundle);
  await p.waitForSelector(TA, { timeout: 30_000 });
  return p;
}

const genButton = () =>
  page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) =>
      /生成图文笔记|提炼中|生成中/.test(x.textContent || ""),
    ) as HTMLButtonElement | undefined;
    return b ? { text: (b.textContent || "").trim(), disabled: b.disabled } : null;
  });

const taValue = () => page.evaluate((sel) => (document.querySelector(sel) as HTMLTextAreaElement | null)?.value || "", TA);

/** 粘贴长文并点生成：确认框选「先提炼」，出图确认选「取消」，停在提炼稿上 */
async function distillOnly() {
  await page.evaluate(
    (sel, v) => {
      const el = document.querySelector(sel) as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    TA,
    SOURCE_TEXT,
  );
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /生成图文笔记/.test(x.textContent || ""));
    (b as HTMLButtonElement | undefined)?.click();
  });
  await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLTextAreaElement | null)?.value?.startsWith("# 财务自由完整版"), { timeout: 30_000 }, TA);
  // 0911 起出图前有确认弹窗：这里只要提炼稿，点「返回修改」停在稿子上（等同旧的「出图确认选取消」）
  await page.waitForFunction(() => Boolean(document.querySelector('[aria-label="出图前确认"]')), { timeout: 30_000 });
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "返回修改");
    (b as HTMLButtonElement | undefined)?.click();
  });
  // 等按钮回到空闲态再读报价，否则读到的是「提炼中…」
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).some(
        (b) => /生成图文笔记（约 \d+ 页/.test(b.textContent || "") && !(b as HTMLButtonElement).disabled,
      ),
    { timeout: 30_000 },
  );
}

async function switchLevel(v: string) {
  await page.evaluate(
    (sel, val) => {
      const el = document.querySelector(sel) as HTMLSelectElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(el, val);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    LEVEL,
    v,
  );
  await new Promise((r) => setTimeout(r, 900));
}

/** 让页面进入「有错误结果」态，清除按钮才渲染 */
async function distillThenFailedImageGen() {
  await page.evaluate(() => ((globalThis as never as { fixture: { acceptImageGen: boolean } }).fixture.acceptImageGen = true));
  await distillOnly();
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => /生成图文笔记/.test(x.textContent || ""));
    (b as HTMLButtonElement | undefined)?.click();
  });
  // 0911 起出图前有确认弹窗（版式 / 成稿档 / 模板类型），走真实路径：点「确认出图」
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "确认出图"),
    { timeout: 30_000 },
  );
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "确认出图");
    (b as HTMLButtonElement | undefined)?.click();
  });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "清除"),
    { timeout: 30_000 },
  );
}

describe("确认弹窗互锁与快照（真实 PlatformPage · 0911 复审 P1）", () => {
  it("等确认期间：正文与档位被锁住，键盘改不动，也点不了第二次生成", async () => {
    page = await mount();
    await page.evaluate(() => ((globalThis as never as { fixture: { acceptImageGen: boolean } }).fixture.acceptImageGen = true));
    await distillOnly();
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => /生成图文笔记/.test(x.textContent || ""));
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "确认出图"),
      { timeout: 30_000 },
    );
    const locked = await page.evaluate(
      (ta, lv) => ({
        taDisabled: (document.querySelector(ta) as HTMLTextAreaElement | null)?.disabled,
        levelDisabled: (document.querySelector(lv) as HTMLSelectElement | null)?.disabled,
        genDisabled: Array.from(document.querySelectorAll("button"))
          .filter((b) => /生成图文笔记|生成中/.test(b.textContent || ""))
          .every((b) => (b as HTMLButtonElement).disabled),
      }),
      TA,
      LEVEL,
    );
    expect(locked.taDisabled).toBe(true);
    expect(locked.levelDisabled).toBe(true);
    expect(locked.genDisabled).toBe(true);

    // 键盘绕行：直接往底层输入框塞字也不会改掉稿子（受控 + disabled）
    const before = await taValue();
    await page.evaluate((sel) => {
      const el = document.querySelector(sel) as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(el, "【偷改的稿子】");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }, TA);
    await new Promise((r) => setTimeout(r, 200));
    expect(await taValue()).toBe(before);

    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "返回修改");
      (b as HTMLButtonElement | undefined)?.click();
    });
  }, 120_000);

  it("「返回修改」零出图请求，提炼稿与旧产物都在", async () => {
    page = await mount();
    await page.evaluate(() => {
      const fx = (globalThis as never as { fixture: { acceptImageGen: boolean; imageJobCalls: number } }).fixture;
      fx.acceptImageGen = true;
      fx.imageJobCalls = 0;
    });
    await distillOnly();
    const calls = await page.evaluate(
      () => (globalThis as never as { fixture: { imageJobCalls: number } }).fixture.imageJobCalls,
    );
    expect(calls).toBe(0);
    expect(await taValue()).toContain("完整版第 1 节");
  }, 120_000);
});

describe("出图前确认弹窗（真实 PlatformPage · 0911 用户令）", () => {
  it("弹窗列出成稿档 / 版式 / 模板类型；「返回修改」不出图，稿子还在", async () => {
    page = await mount();
    await page.evaluate(() => ((globalThis as never as { fixture: { acceptImageGen: boolean } }).fixture.acceptImageGen = true));
    await distillOnly();
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => /生成图文笔记/.test(x.textContent || ""));
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "确认出图"),
      { timeout: 30_000 },
    );
    const dialogText = await page.evaluate(
      () => (document.querySelector('[aria-label="出图前确认"]') as HTMLElement | null)?.innerText || "",
    );
    expect(dialogText).toContain("成稿档");
    expect(dialogText).toContain("版式");
    expect(dialogText).toContain("模板类型");
    expect(dialogText).toContain("页");
    // 完整版是 fixture 的默认档，弹窗要如实显示，不能写死
    expect(dialogText).toContain("完整版");

    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "返回修改");
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(
      () => !document.querySelector('[aria-label="出图前确认"]'),
      { timeout: 10_000 },
    );
    // 没有出图：不会出现失败态的「清除」按钮；提炼稿仍在文本框
    const after = await page.evaluate((sel) => ({
      hasClear: Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "清除"),
      text: (document.querySelector(sel) as HTMLTextAreaElement | null)?.value || "",
    }), TA);
    expect(after.hasClear).toBe(false);
    expect(after.text).toContain("完整版第 1 节");
  }, 120_000);
});

describe("停止出图与派生终止（真实 PlatformPage · 0911 复审 P2）", () => {
  it("7 页批次中途停止：只收尾在途页，显示「已停止 · 出图 n/7 页」，不写 100%", async () => {
    page = await mount();
    await page.evaluate(() => {
      const fx = (globalThis as never as { fixture: { acceptImageGen: boolean; imageJobsSucceed: boolean; imageJobCalls: number } }).fixture;
      fx.acceptImageGen = true;
      fx.imageJobsSucceed = true;
      fx.imageJobCalls = 0;
    });
    await distillOnly();
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => /生成图文笔记/.test(x.textContent || ""));
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "确认出图"),
      { timeout: 30_000 },
    );
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "确认出图");
      (b as HTMLButtonElement | undefined)?.click();
    });
    // 出图跑起来后点「终止」
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "终止"),
      { timeout: 30_000 },
    );
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "终止");
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(
      () => /已停止/.test((document.querySelector('[aria-label="知识卡进度"]') as HTMLElement | null)?.innerText || ""),
      { timeout: 60_000 },
    );
    const state = await page.evaluate(() => {
      const box = document.querySelector('[aria-label="知识卡进度"]') as HTMLElement | null;
      const bar = document.querySelector('[role="progressbar"]') as HTMLElement | null;
      return {
        text: box?.innerText || "",
        valueNow: Number(bar?.getAttribute("aria-valuenow") || "0"),
        valueText: bar?.getAttribute("aria-valuetext") || "",
        pagesRequested: (globalThis as never as { fixture: { imageJobCalls: number } }).fixture.imageJobCalls,
      };
    });
    // 不许冒充成功：文字、aria 值、进度都要如实
    expect(state.text).toContain("已停止");
    expect(state.text).not.toContain("成功 · 100%");
    expect(state.valueNow).toBeLessThan(100);
    expect(state.valueText).toContain("已停止");
    // 停止后不再领新页：实际请求数小于总页数
    expect(state.pagesRequested).toBeGreaterThan(0);
    expect(state.pagesRequested).toBeLessThan(7);
    // 已出的页保留，缺页的补出入口照常开着
    const kept = await page.evaluate(() => ({
      images: document.querySelectorAll('img[src*="storage.googleapis.com/test/page-"]').length,
      refill: Array.from(document.querySelectorAll("button")).filter((b) => /补出/.test(b.textContent || "")).length,
    }));
    expect(kept.images).toBeGreaterThan(0);
    expect(kept.refill).toBeGreaterThan(0);
  }, 180_000);

  it("派生精华版跑起来时也有终止按钮，且打到派生那一单", async () => {
    page = await mount();
    await page.evaluate(() => {
      const fx = (globalThis as never as { fixture: { deriveStatus: string; cancelCalls: string[] } }).fixture;
      fx.deriveStatus = "running";
      fx.cancelCalls = [];
    });
    await distillOnly();
    await switchLevel("concise");
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll("button")).some((b) => (b.textContent || "").trim() === "终止"),
      { timeout: 30_000 },
    );
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "终止");
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(
      () => (globalThis as never as { fixture: { cancelCalls: string[] } }).fixture.cancelCalls.length > 0,
      { timeout: 30_000 },
    );
    const calls = await page.evaluate(
      () => (globalThis as never as { fixture: { cancelCalls: string[] } }).fixture.cancelCalls,
    );
    expect(calls).toEqual(["derive-1"]);
  }, 180_000);
});

describe("知识卡精华版派生（真实 PlatformPage）", () => {
  it("派生中：生成按钮锁住、点它也不出图，文本框与档位下拉都锁住", async () => {
    page = await mount();
    await distillOnly();
    const fullQuote = await genButton();
    expect(fullQuote?.disabled).toBe(false);

    await switchLevel("concise");
    const during = await page.evaluate(
      (ta, lv) => ({
        taDisabled: (document.querySelector(ta) as HTMLTextAreaElement | null)?.disabled,
        levelDisabled: (document.querySelector(lv) as HTMLSelectElement | null)?.disabled,
        uploadDisabled: (document.querySelector('input[type="file"][accept*="epub"]') as HTMLInputElement | null)?.disabled,
      }),
      TA,
      LEVEL,
    );
    const btn = await genButton();
    expect(btn?.disabled).toBe(true);
    expect(during.taDisabled).toBe(true);
    expect(during.levelDisabled).toBe(true);
    expect(during.uploadDisabled).toBe(true);

    // 文本框此刻仍是完整版：这正是「此时出图会按完整版计费」的现场
    expect(await taValue()).toContain("# 财务自由完整版");

    // 强行点生成（绕过 disabled）：handler 必须自己拦住，不发起任何出图
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => /生成图文笔记|提炼中|生成中/.test(x.textContent || ""));
      (b as HTMLButtonElement | undefined)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 600));
    expect(await taValue()).toContain("# 财务自由完整版");
  }, 180_000);

  it("派生成功：正文换成精华版，报价按精华版重算（页数与积分都变小）", async () => {
    page = await mount();
    await distillOnly();
    const before = await genButton();
    const beforePages = Number(/约 (\d+) 页/.exec(before?.text || "")?.[1]);
    const beforeCredits = Number(/· (\d+) 积分/.exec(before?.text || "")?.[1]);

    await switchLevel("concise");
    await page.evaluate(() => ((globalThis as never as { fixture: { deriveStatus: string } }).fixture.deriveStatus = "succeeded"));
    await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLTextAreaElement | null)?.value?.startsWith("# 财务自由精华版"), { timeout: 30_000 }, TA);

    const after = await genButton();
    const afterPages = Number(/约 (\d+) 页/.exec(after?.text || "")?.[1]);
    const afterCredits = Number(/· (\d+) 积分/.exec(after?.text || "")?.[1]);
    expect(after?.disabled).toBe(false);
    expect(afterPages).toBeLessThan(beforePages);
    expect(afterCredits).toBeLessThan(beforeCredits);
    // 报价与正文同一份：按钮上的页数必须是精华版算出来的
    expect(await taValue()).toContain("# 财务自由精华版");
  }, 180_000);

  it("派生中：清除按钮被锁；即便绕过 disabled 强行点，handler 也拒绝，稿子不被清空", async () => {
    page = await mount();
    await distillThenFailedImageGen();
    // 有错误态 → 清除按钮已渲染，且此刻可用
    expect(
      await page.evaluate(() => {
        const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "清除") as HTMLButtonElement | undefined;
        return b ? b.disabled : null;
      }),
    ).toBe(false);

    await switchLevel("concise");
    const disabledDuring = await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "清除") as HTMLButtonElement | undefined;
      return b ? b.disabled : null;
    });
    expect(disabledDuring).toBe(true);

    // 绕过按钮层的锁：把 disabled 摘掉再点，handler 内的拦截必须仍然生效
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "清除") as HTMLButtonElement | undefined;
      if (b) {
        b.disabled = false;
        b.click();
      }
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(await taValue()).toContain("# 财务自由完整版");

    // 派生结束后清除才生效，且此时清的是当前稿
    await page.evaluate(() => ((globalThis as never as { fixture: { deriveStatus: string } }).fixture.deriveStatus = "succeeded"));
    await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLTextAreaElement | null)?.value?.startsWith("# 财务自由精华版"), { timeout: 30_000 }, TA);
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => (x.textContent || "").trim() === "清除") as HTMLButtonElement | undefined;
      b?.click();
    });
    await new Promise((r) => setTimeout(r, 500));
    expect(await taValue()).toBe("");
  }, 180_000);

  it("提炼在途：摘掉 disabled 强行切档，handler 也拒绝——档位不变、不派生", async () => {
    page = await mount();
    // 让提炼慢下来，制造「提炼中」窗口
    await page.evaluate(() => ((globalThis as never as { fixture: { prepareDelayMs: number } }).fixture.prepareDelayMs = 2500));
    await page.evaluate(
      (sel, v) => {
        const el = document.querySelector(sel) as HTMLTextAreaElement;
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
        setter.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      },
      TA,
      SOURCE_TEXT,
    );
    await page.evaluate(() => {
      const b = Array.from(document.querySelectorAll("button")).find((x) => /生成图文笔记/.test(x.textContent || ""));
      (b as HTMLButtonElement | undefined)?.click();
    });
    await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((b) => /提炼中/.test(b.textContent || "")), { timeout: 15_000 });
    await page.evaluate((lv) => {
      const el = document.querySelector(lv) as HTMLSelectElement;
      el.disabled = false;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(el, "concise");
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, LEVEL);
    await page.waitForFunction((sel) => (document.querySelector(sel) as HTMLTextAreaElement | null)?.value?.startsWith("# 财务自由完整版"), { timeout: 30_000 }, TA);
    await new Promise((r) => setTimeout(r, 600));
    const after = await page.evaluate(
      (lv) => ({ level: (document.querySelector(lv) as HTMLSelectElement | null)?.value, enqueues: (globalThis as never as { fixture: { deriveCalls: number } }).fixture.deriveCalls }),
      LEVEL,
    );
    expect(after.level).toBe("full");
    expect(after.enqueues).toBe(0);
  }, 180_000);

  it("派生失败：档位退回高级版，完整版留在文本框，不留半截状态", async () => {
    page = await mount();
    await distillOnly();
    await page.evaluate(() => ((globalThis as never as { fixture: { deriveStatus: string } }).fixture.deriveStatus = "failed"));
    await switchLevel("concise");
    await page.waitForFunction(
      (lv) => (document.querySelector(lv) as HTMLSelectElement | null)?.value === "full",
      { timeout: 30_000 },
      LEVEL,
    );
    expect(await taValue()).toContain("# 财务自由完整版");
    const btn = await genButton();
    expect(btn?.disabled).toBe(false);
  }, 180_000);
});
