/**
 * 0914 复审要求的页面行为验收：重新渲染之后，画布拿到的必须是**最新**的
 * 准备／确认回调；且测试要调**真实页面准备函数**，不是手写的同形实现。
 *
 * 做法：esbuild alias 把 FreeformCanvas 顶替成 probe 壳（页面行为不变），
 * 于是能从 window 拿到真实 OmniCanvas 传下来的那两个回调本体。
 *
 * 为什么必须是组件级：这是 useCallback 捕获旧闭包的问题——
 * 依赖数组漏项时类型检查与纯函数单测都测不出来
 * （同 omniCanvasDirectionConfirm.browser.test.ts 的理由）。
 *
 * 全离线：所有 fetch 拦成空 tRPC 回包，绝不连生产、不付费。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let page: Page;
let bundle: string;

beforeAll(async () => {
  const result = await build({
    entryPoints: ["client/src/lib/manhuaClipPrepareLatest.fixture.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@": `${process.cwd()}/client/src`,
      "@shared": `${process.cwd()}/shared`,
      // 顶替成 probe 壳：内部仍渲染真实组件
      "@/components/canvas/FreeformCanvas": `${process.cwd()}/client/src/lib/__browserfixtures__/freeformCanvasProbe.tsx`,
    },
    loader: { ".png": "dataurl", ".svg": "dataurl", ".jpg": "dataurl", ".css": "text" },
    define: { "process.env.NODE_ENV": '"production"', "import.meta.env": "__VITE_ENV__" },
    banner: { js: 'var __VITE_ENV__ = {DEV:false,PROD:true,MODE:"production",SSR:false};' },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
}, 180_000);

afterAll(async () => {
  await browser?.close();
});

async function mount(): Promise<Page> {
  const p = await browser.newPage();
  await p.setRequestInterception(true);
  p.on("request", (req) =>
    req.url().startsWith("data:") ? req.continue() : req.respond({ status: 200, body: "" }),
  );
  await p.goto("http://localhost/", { waitUntil: "domcontentloaded" }).catch(() => {});
  await p.setContent("<div id=root></div>");
  await p.evaluate(bundle);
  await p.waitForFunction(() => /进入引导式漫剧/.test(document.body.innerText), {
    timeout: 30_000,
  });
  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find(
      (e) => /进入引导式漫剧/.test(e.textContent || "") && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  // 等「第N集」切集按钮渲染出来（writerFocusEpisode 是准备函数的真实依赖）
  await p.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).some((b) =>
        /^第\s*2\s*集$/.test((b.textContent || "").trim()),
      ),
    { timeout: 30_000 },
  );
  // 等真实 OmniCanvas 把 props 传给（被顶替的）FreeformCanvas
  await p.waitForFunction(() => Boolean((window as never as { __ffcProps?: unknown }).__ffcProps), {
    timeout: 30_000,
  });
  return p;
}

describe("页面行为：画布拿到的准备／确认回调必须是最新的", () => {
  it("真实页面确实把 prepareManhuaClipRun 与 resolveManhuaOutboundGate 传给了画布", async () => {
    page = await mount();
    const shape = await page.evaluate(() => {
      const props = (window as never as { __ffcProps?: Record<string, unknown> }).__ffcProps!;
      return {
        hasPrepare: typeof props.prepareManhuaClipRun === "function",
        hasGate: typeof props.resolveManhuaOutboundGate === "function",
      };
    });
    expect(shape).toEqual({ hasPrepare: true, hasGate: true });
    await page.close();
  }, 180_000);

  it("调用**真实页面**的确认闸：拿到完整 scope 身份（不是手写同形实现）", async () => {
    page = await mount();
    const scope = await page.evaluate(() => {
      const props = (window as never as {
        __ffcProps?: { resolveManhuaOutboundGate: (id: string) => { currentScope: Record<string, unknown> } };
      }).__ffcProps!;
      const gate = props.resolveManhuaOutboundGate("clip-e01-g01");
      return gate.currentScope;
    });
    expect(Object.keys(scope).sort()).toEqual(
      ["blockId", "epoch", "projectVersion", "userId", "workspaceId"].sort(),
    );
    expect(scope.blockId).toBe("clip-e01-g01");
    await page.close();
  }, 180_000);

  it("切集（writerFocusEpisode 是准备函数的真实依赖）后，画布收到的是新一版准备函数", async () => {
    // 复审 P2 说的就是这种情况：仅准备函数的依赖变化、其它 props 不变时，
    // 旧写法的 runBlock 仍捕获旧准备函数——工作台按新口径确认，画布却用旧口径。
    //
    // 先等页面静默再取基线，否则「点击之后函数变了」可能只是挂载期的异步 settle，
    // 那样这条测试会因为错误的原因通过。
    page = await mount();
    const result = await page.evaluate(async () => {
      type Props = { prepareManhuaClipRun?: unknown };
      const w = window as never as { __ffcProps?: Props };
      const settle = () => new Promise((r) => setTimeout(r, 900));

      await settle();
      let baseline = w.__ffcProps!.prepareManhuaClipRun;
      await settle();
      // 静默判定：连续两次取样相同才算稳定，否则本条不作数
      const quiet = baseline === w.__ffcProps!.prepareManhuaClipRun;
      baseline = w.__ffcProps!.prepareManhuaClipRun;

      const btn = Array.from(document.querySelectorAll("button")).find((b) =>
        /^第\s*2\s*集$/.test((b.textContent || "").trim()),
      ) as HTMLButtonElement | undefined;
      if (!btn) return { quiet, foundControl: false, changed: false };
      btn.click();
      await settle();
      return {
        quiet,
        foundControl: true,
        changed: baseline !== w.__ffcProps!.prepareManhuaClipRun,
      };
    });

    expect(result.foundControl, "界面上没找到切集按钮，这条用例未真正验到").toBe(true);
    expect(result.quiet, "取基线时页面还在异步 settle，这条用例不作数").toBe(true);
    expect(result.changed, "切集之后画布拿到的还是同一个准备函数（旧闭包）").toBe(true);
    await page.close();
  }, 180_000);
});
