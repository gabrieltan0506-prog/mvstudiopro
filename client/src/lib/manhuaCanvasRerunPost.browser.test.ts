/**
 * 0914 收口要求：浏览器里的**真实重跑 POST 对照**。
 *
 * 流程完全按审查给的：改变设置 → 重新确认 → 点真实画布重跑 → POST 与本次确认一致。
 * 夹具预置「已铺段、静帧就绪」的离线画布（纯本地计算），
 * 不跑反推、不生成、不付费；所有 fetch 被接管。
 *
 * 预览与确认调的是**真实页面**的 onPreviewClipOutbound / onConfirmClipOutbound
 * （通过 probe 壳从真实 OmniCanvas 的 props 拿到），不是测试自己重写一遍。
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let bundle: string;

beforeAll(async () => {
  const result = await build({
    entryPoints: ["client/src/lib/manhuaCanvasRerunPost.fixture.tsx"],
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@": `${process.cwd()}/client/src`,
      "@shared": `${process.cwd()}/shared`,
      "@/components/canvas/FreeformCanvas": `${process.cwd()}/client/src/lib/__browserfixtures__/freeformCanvasProbe.tsx`,
      "@/components/ManhuaScriptWorkbench": `${process.cwd()}/client/src/lib/__browserfixtures__/manhuaWorkbenchProbe.tsx`,
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
  await p.waitForFunction(() => /进入引导式漫剧/.test(document.body.innerText), { timeout: 30_000 });
  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find(
      (e) => /进入引导式漫剧/.test(e.textContent || "") && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await p.waitForFunction(
    () => Boolean((window as never as { __ffcProps?: unknown }).__ffcProps),
    { timeout: 30_000 },
  );
  return p;
}

describe("浏览器真实链路：确认 → 点真实画布重跑 → POST 与确认一致", () => {
  it("预置画布里确实有已铺好的 clip 段节点", async () => {
    const page = await mount();
    const clipIds = await page.evaluate(() => {
      const props = (window as never as { __ffcProps?: { blocks: Array<{ id: string }> } }).__ffcProps!;
      return props.blocks.filter((b) => b.id.startsWith("clip-")).map((b) => b.id);
    });
    expect(clipIds.length, "夹具没铺出 clip 节点，后面的对照不作数").toBeGreaterThan(0);
    await page.close();
  }, 180_000);

  /**
   * ⚠️ 未完成，如实记录，不当成通过。
   *
   * 目标是审查要的那条：改设置 → 重新确认 → 点真实画布重跑 → POST 与确认一致。
   * 卡在夹具保真度上：**页面在载入时会自己重铺 clip 节点**
   * （实测节点 id 变成 `clip-e01-g01-auto-...`，videoModel 被改写成会话档，
   * 种进去的 seedance25WorkMode / refVideoUrl 一并丢失）。
   * 于是：
   *  - 预置成「原片编辑」的段会被normalize成普通生成，测不到编辑路径；
   *  - 普通生成路径下，页面用自己的口径重算关键静帧 required，
   *    种进去的 look 回执变成「已变更」，预览被静帧门禁拦住。
   *
   * 也就是说，光靠 localStorage 预置画布还不够，需要让页面**按它自己的口径**
   * 产出一份静帧就绪的段表。下一步方案见交审说明；在那之前
   * 请求体逐字段对照仍由 manhuaCanvasRerunParity.test.ts 承担
   * （vm 抽真实 runBlock + 拦 fetch）。
   */
  it("【实测记录】页面载入会自己重铺 clip 节点，种进去的段级状态不会原样留存", async () => {
    const page = await mount();
    const seen = await page.evaluate(() => {
      const props = (window as never as {
        __ffcProps?: { blocks: Array<Record<string, unknown>> };
      }).__ffcProps!;
      const clips = props.blocks.filter((b) => String(b.id).startsWith("clip-"));
      return {
        count: clips.length,
        anyAutoRelaid: clips.some((b) => /-auto-/.test(String(b.id))),
        keptEditOp: clips.some((b) => b.seedance25WorkMode === "video_edit"),
      };
    });
    expect(seen.count).toBeGreaterThan(0);
    // 这两条就是挡住浏览器 POST 对照的原因，钉下来免得下一手重复踩
    expect(seen.anyAutoRelaid, "页面没有重铺——若此处转绿，说明可以直接种段级状态了").toBe(true);
    expect(seen.keptEditOp, "编辑身份没留住（当前已知行为）").toBe(false);
    await page.close();
  }, 180_000);
});
