/**
 * 真实组件回归（终审 P1）：渲染真的 OmniCanvas，用真的「导演包」下拉选卡、真的确认按钮，
 * 断言冻结进 Bible 的、写进已铺节点标记的、以及最终 clip 提示词里的，是**界面上最后选的那张卡**。
 *
 * 为什么必须是组件级：缺陷是 useCallback 捕获旧闭包（依赖数组漏项），
 * 类型检查与纯函数单测都测不出来——去掉依赖后本文件立刻转红（已验证：冻结值变成 null）。
 *
 * 全离线：所有 fetch 被拦成空 tRPC 回包，绝不连生产。
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let context: Awaited<ReturnType<Browser["createBrowserContext"]>>;
let page: Page;
let bundle: string;

const DROPDOWN = '[aria-label="导演包主卡"]';
const SUB_ACTION = '[aria-label="场次副卡·打戏"]';

beforeAll(async () => {
  const result = await build({
    entryPoints: ["client/src/lib/omniCanvasDirectionConfirm.fixture.tsx"],
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

/** 每个用例一个全新浏览器上下文：localStorage 隔离，不串味；同上下文再挂一次＝刷新 */
async function mount(): Promise<Page> {
  const p = await context.newPage();
  await p.setRequestInterception(true);
  p.on("request", (req) => (req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" })));
  await p.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.setContent("<div id=root></div>");
  await p.evaluate(bundle);
  await p.waitForFunction(() => /进入引导式漫剧/.test(document.body.innerText), { timeout: 30_000 });
  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find(
      (e) => /进入引导式漫剧/.test(e.textContent || "") && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await p.waitForSelector(DROPDOWN, { timeout: 30_000 });
  return p;
}

async function selectCard(selector: string, value: string) {
  await page.evaluate(
    (sel, v) => {
      const el = document.querySelector(sel) as HTMLSelectElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!;
      setter.call(el, v);
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    selector,
    value,
  );
  await new Promise((r) => setTimeout(r, 350));
}

async function confirmOutline() {
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => /生成本步内容/.test(b.textContent || ""));
    (btn as HTMLButtonElement | undefined)?.click();
  });
  await page.waitForFunction(
    () => {
      const raw = localStorage.getItem("mv-manhua-writer-session-v1");
      return Boolean(raw && JSON.parse(raw)?.writerConfirmed);
    },
    { timeout: 20_000 },
  );
  await new Promise((r) => setTimeout(r, 800));
}

/** 冻结进 Bible 的法典 */
const readBible = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem("mv-manhua-writer-session-v1");
    const s = raw ? JSON.parse(raw) : null;
    return s?.projectBible?.directionCanon ?? null;
  });

/** 已铺节点里的法典块与选卡标记 */
const readNodes = () =>
  page.evaluate(() => {
    const raw = localStorage.getItem("mv-freeform-canvas-v1");
    const blocks = raw ? JSON.parse(raw)?.blocks || [] : [];
    const prompts: string[] = blocks.map((b: { prompt?: string }) => String(b?.prompt || ""));
    return {
      markers: prompts.flatMap((p) => p.match(/【导演法典·v1·[a-z0-9_]+/g) || []),
      selections: prompts.flatMap((p) => p.match(/【导演法典选卡·v1·[^】]*】/g) || []),
    };
  });

const cardOptions = () =>
  page.evaluate(
    (sel) => Array.from(document.querySelectorAll(`${sel} option`)).map((o) => (o as HTMLOptionElement).value).filter(Boolean),
    DROPDOWN,
  );

beforeEach(async () => {
  await page?.close().catch(() => {});
  await context?.close().catch(() => {});
  context = await browser.createBrowserContext();
  page = await mount();
});

describe("导演包选卡 → 确认冻结（真实 OmniCanvas）", () => {
  it("只换主卡：连改两次后确认，冻结与铺板用的是最后选的那张，不是旧卡也不是 null", async () => {
    const options = await cardOptions();
    expect(options.length).toBeGreaterThanOrEqual(2);
    const [first, second] = options;
    await selectCard(DROPDOWN, first!);
    await selectCard(DROPDOWN, second!);
    await confirmOutline();

    const bible = await readBible();
    expect(bible?.mainCardId).toBe(second);
    expect(bible?.mainCardId).not.toBe(first);

    const nodes = await readNodes();
    expect(nodes.markers.length).toBeGreaterThan(0);
    for (const m of nodes.markers) expect(m).toContain(second!);
    for (const m of nodes.markers) expect(m).not.toContain(first!);
    expect(nodes.selections.join("|")).toContain(`【导演法典选卡·v1·${second}`);
    expect(nodes.selections.join("|")).not.toContain(first!);
  }, 120_000);

  it("只换副卡：主卡不动、给打戏挂一张副卡，确认后 Bible 与节点标记都带这张副卡", async () => {
    const options = await cardOptions();
    const [main, sub] = options;
    await selectCard(DROPDOWN, main!);
    await page.waitForSelector(SUB_ACTION, { timeout: 15_000 });
    await selectCard(SUB_ACTION, sub!);
    await confirmOutline();

    const bible = await readBible();
    expect(bible?.mainCardId).toBe(main);
    expect(bible?.sceneOverrides?.action?.cardId).toBe(sub);

    const nodes = await readNodes();
    expect(nodes.selections.join("|")).toContain(`action=${sub}`);
  }, 120_000);

  it("先选卡再取消：确认后 Bible 无法典，节点零注入", async () => {
    const options = await cardOptions();
    await selectCard(DROPDOWN, options[0]!);
    await selectCard(DROPDOWN, "");
    await confirmOutline();

    expect(await readBible()).toBeNull();
    const nodes = await readNodes();
    expect(nodes.markers).toEqual([]);
    expect(nodes.selections).toEqual([]);
  }, 120_000);

  it("只改导演卡不确认，刷新后主卡与副卡都还在（终审 P2：保存 effect 漏依赖会丢选择）", async () => {
    const options = await cardOptions();
    const [main, sub] = options;
    await selectCard(DROPDOWN, main!);
    await page.waitForSelector(SUB_ACTION, { timeout: 15_000 });
    await selectCard(SUB_ACTION, sub!);
    // 给本机保存的防抖留出时间，再「刷新」（同上下文重新挂载）
    await new Promise((r) => setTimeout(r, 1200));
    await page.close();
    page = await mount();
    const restored = await page.evaluate(
      (a, b) => ({
        main: (document.querySelector(a) as HTMLSelectElement | null)?.value ?? null,
        sub: (document.querySelector(b) as HTMLSelectElement | null)?.value ?? null,
      }),
      DROPDOWN,
      SUB_ACTION,
    );
    expect(restored.main).toBe(main);
    expect(restored.sub).toBe(sub);
  }, 120_000);

  it("取消选卡后刷新，不会把旧卡复活", async () => {
    const options = await cardOptions();
    await selectCard(DROPDOWN, options[0]!);
    await new Promise((r) => setTimeout(r, 1200));
    await selectCard(DROPDOWN, "");
    await new Promise((r) => setTimeout(r, 1200));
    await page.close();
    page = await mount();
    const restored = await page.evaluate(
      (sel) => (document.querySelector(sel) as HTMLSelectElement | null)?.value ?? null,
      DROPDOWN,
    );
    expect(restored).toBe("");
  }, 120_000);

  it("全程未选卡：确认后同样零注入（不给默认风格）", async () => {
    await confirmOutline();
    expect(await readBible()).toBeNull();
    const nodes = await readNodes();
    expect(nodes.markers).toEqual([]);
    expect(nodes.selections).toEqual([]);
  }, 120_000);
});
