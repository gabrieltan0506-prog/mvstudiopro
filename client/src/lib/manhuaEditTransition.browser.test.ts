/** 真实 OmniCanvas + Workbench 按集转场、刷新恢复与合成入口。
 * 所有网络由离线夹具截获；证明请求范围及恢复，不代表线上计费验收。
 */
import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";

let browser: Browser;
let bundle: string;
const evidenceDir = join(tmpdir(), "mvs-edit-transition-probe");

beforeAll(async () => {
  mkdirSync(evidenceDir, { recursive: true });
  const result = await build({
    plugins: [
      {
        name: "probe-callback-stages",
        setup(build) {
          build.onLoad({ filter: /pages\/OmniCanvas\.tsx$/ }, args => ({
            loader: "tsx",
            contents: readFileSync(args.path, "utf8")
              .replace(
                "onGenerateCurrentVersion={(episodeIndex) => {",
                'onGenerateCurrentVersion={(episodeIndex) => { console.log("probe:current-version", episodeIndex);'
              )
              .replace(
                "const ready = clips.filter((c) => c.clipUrl);",
                'console.log("probe:assemble-enter", JSON.stringify(clips)); const ready = clips.filter((c) => c.clipUrl);'
              ),
          }));
        },
      },
    ],
    entryPoints: ["client/src/lib/manhuaEditDrawers.fixture.tsx"],
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
    loader: {
      ".png": "dataurl",
      ".svg": "dataurl",
      ".jpg": "dataurl",
      ".css": "text",
    },
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env": "__VITE_ENV__",
    },
    banner: {
      js: 'var __VITE_ENV__ = {DEV:false,PROD:true,MODE:"production",SSR:false};',
    },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0]!.text;
  browser = await puppeteer.launch({ args: ["--no-sandbox"] });
}, 180_000);

afterAll(async () => {
  if (!browser) return;
  const ownedProcess = browser.process();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closed = await Promise.race([
    browser.close().then(() => true),
    new Promise<false>(resolve => {
      timer = setTimeout(() => resolve(false), 5000);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (!closed) {
    // 仅清理本夹具启动的独立 headless 子进程，绝不查找或终止用户 Chrome。
    console.warn(
      "离线夹具 browser.close 超时，清理本夹具持有的 headless 子进程"
    );
    if (!ownedProcess)
      throw new Error("独立 headless 进程句柄缺失，不能安全清理");
    const exited = new Promise<void>((resolve, reject) => {
      if (ownedProcess.exitCode !== null || ownedProcess.signalCode !== null)
        return resolve();
      const deadline = setTimeout(
        () => reject(new Error(`夹具进程 ${ownedProcess.pid} 清理后仍未退出`)),
        5000
      );
      ownedProcess.once("exit", () => {
        clearTimeout(deadline);
        resolve();
      });
    });
    ownedProcess.kill("SIGKILL");
    browser.disconnect();
    await exited;
    console.warn(`已核本夹具 headless PID ${ownedProcess.pid} 退出`);
  }
});

/** 每个用例一个全新 BrowserContext：localStorage 隔离，第二条不沿用第一条的状态 */
async function mount(
  first = false,
  both = false
): Promise<{ page: Page; close: () => Promise<void> }> {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  await p.setRequestInterception(true);
  p.on("request", req =>
    req.url().startsWith("data:")
      ? req.continue()
      : req.respond({ status: 200, body: "" })
  );
  await p
    .goto("http://localhost/", { waitUntil: "domcontentloaded" })
    .catch(() => {});
  await p.setContent("<div id=root></div>");
  await p.evaluate(
    ({ first, both }) => {
      (window as any).__firstShot = first;
      localStorage.setItem("mv.openaiImageVariant", both ? "both" : "flare");
    },
    { first, both }
  );
  await p.evaluate(() => {
    (window as any).__stale = true;
  });
  await p.evaluate(bundle);
  await p.waitForFunction(
    () => /进入引导式漫剧/.test(document.body.innerText),
    { timeout: 30_000 }
  );
  await p.evaluate(() => {
    const el = Array.from(document.querySelectorAll("*")).find(
      e => /进入引导式漫剧/.test(e.textContent || "") && e.children.length === 0
    );
    (el as HTMLElement | undefined)?.click();
  });
  await p.waitForFunction(
    () => Boolean((window as never as { __ffcProps?: unknown }).__ffcProps),
    { timeout: 30_000 }
  );
  return {
    page: p,
    close: async () => {
      await ctx.close().catch(() => {});
    },
  };
}

it("真实父页面转场坐标选择、旧版失效及当前集请求闭合", async () => {
  const { page, close } = await mount();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(String(e)));
  try {
    await page.setViewport({ width: 1280, height: 900 });
    const cssDir = process.env.MANHUA_LAYOUT_CSS_DIR;
    if (cssDir)
      for (const file of readdirSync(cssDir).filter(n => n.endsWith(".css")))
        await page.addStyleTag({
          content: readFileSync(join(cssDir, file), "utf8"),
        });
    await page.evaluate(() =>
      (window as any).__wbProps.onWorkflowPhaseChange("edit")
    );
    await page.waitForSelector("[data-manhua-edit-generate-current]");
    expect(
      await page.evaluate(() => (window as any).__wbProps.finalCutVerified)
    ).toBe(true);
    await page.click('[data-manhua-edit-drawer-toggle="subtitles"]');
    await page.$eval("[data-manhua-edit-transition]", e =>
      e.scrollIntoView({ block: "center" })
    );
    const hit = await page.$eval("[data-manhua-edit-transition]", e => {
      const r = e.getBoundingClientRect();
      return document
        .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
        ?.hasAttribute("data-manhua-edit-transition");
    });
    expect(hit).toBe(true);
    await page.click("[data-manhua-edit-transition]");
    await page.keyboard.press("Escape");
    await page.select("[data-manhua-edit-transition]", "cut");
    console.log(
      "选择后值",
      await page.$eval(
        "[data-manhua-edit-transition]",
        e => (e as HTMLSelectElement).value
      )
    );
    await page.waitForFunction(
      () =>
        (
          document.querySelector(
            "[data-manhua-edit-transition]"
          ) as HTMLSelectElement
        )?.value === "cut"
    );
    await page.waitForFunction(
      () => (window as any).__wbProps.finalCutStale === true
    );
    await page.waitForFunction(
      () =>
        JSON.parse(localStorage.getItem("mv-manhua-writer-session-v1") || "{}")
          .editTransitionByEpisode?.["1"] === "cut"
    );
    const saved = await page.evaluate(() =>
      localStorage.getItem("mv-manhua-writer-session-v1")
    );
    expect(JSON.parse(saved!).editTransitionByEpisode).toEqual({ "1": "cut" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.setContent("<div id=root></div>");
    await page.evaluate(bundle);
    await page.waitForFunction(() =>
      /进入引导式漫剧/.test(document.body.innerText)
    );
    await page.evaluate(() => {
      const e = Array.from(document.querySelectorAll("*")).find(
        e =>
          /进入引导式漫剧/.test(e.textContent || "") && e.children.length === 0
      );
      (e as HTMLElement)?.click();
    });
    await page.waitForSelector("[data-manhua-edit-generate-current]");
    if (cssDir)
      for (const file of readdirSync(cssDir).filter(n => n.endsWith(".css")))
        await page.addStyleTag({
          content: readFileSync(join(cssDir, file), "utf8"),
        });
    await page.click('[data-manhua-edit-drawer-toggle="subtitles"]');
    expect(
      await page.$eval(
        "[data-manhua-edit-transition]",
        e => (e as HTMLSelectElement).value
      )
    ).toBe("cut");
    expect(
      await page.evaluate(() => (window as any).__wbProps.finalCutStale)
    ).toBe(true);
    for (const width of [1280, 390]) {
      await page.setViewport({ width, height: 900 });
      await page.$eval("[data-manhua-edit-transition]", e =>
        e.scrollIntoView({ block: "center" })
      );
      expect(
        await page.$eval("[data-manhua-edit-transition]", e => {
          const r = e.getBoundingClientRect();
          return document
            .elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
            ?.hasAttribute("data-manhua-edit-transition");
        })
      ).toBe(true);
      await page.screenshot({
        path: join(evidenceDir, "transition-cut-" + width + ".png"),
      });
    }
    await page.setViewport({ width: 1280, height: 900 });
    await page.$eval("[data-manhua-edit-generate-current]", e =>
      e.scrollIntoView({ block: "center" })
    );
    await page.click("[data-manhua-edit-generate-current]");
    await page.waitForFunction(() => (window as any).__posts.length === 1);
    await page.waitForFunction(
      () =>
        (window as any).__ffcProps.blocks.find((b: any) => b.id === "final-e01")
          .outputUrl !== "https://example.com/final.mp4"
    );
    const receipt = await page.evaluate(() => ({
      posts: (window as any).__posts,
      blocks: (window as any).__ffcProps.blocks,
      storage: Object.fromEntries(Object.entries(localStorage)),
    }));
    expect(receipt.posts[0].body.input.params.transition).toBe("cut");
    expect(
      receipt.posts[0].body.input.params.clips.every(
        (c: any) => c.episodeIndex === 1
      )
    ).toBe(true);
    const final = receipt.blocks.find((b: any) => b.id === "final-e01");
    expect(final.outputUrls).toContain("https://example.com/final.mp4");
    expect(
      final.manhuaFinalVersions.some(
        (v: any) =>
          v.url === final.outputUrl && v.sourceKey.endsWith("|transition=cut")
      )
    ).toBe(true);
    writeFileSync(
      join(evidenceDir, "receipt.json"),
      JSON.stringify(receipt, null, 2)
    );
    for (const b of await page.$$("button")) {
      if (
        await b.evaluate(
          e => e.textContent?.trim() === "剧本工作室" && e.checkVisibility()
        )
      ) {
        await b.click();
        break;
      }
    }
    await page.waitForSelector("[data-manhua-edit-generate-current]");
    expect(
      await page.evaluate(() => (window as any).__wbProps.finalCutVerified)
    ).toBe(true);
    await page.click('[data-manhua-edit-drawer-toggle="subtitles"]');
    await page.$eval("[data-manhua-edit-transition]", e =>
      e.scrollIntoView({ block: "center" })
    );
    await page.click("[data-manhua-edit-transition]");
    await page.keyboard.press("Escape");
    await page.select("[data-manhua-edit-transition]", "fade");
    await page.waitForFunction(
      () => (window as any).__wbProps.finalCutStale === true
    );
    expect(errors).toEqual([]);
  } catch (e) {
    console.error("原始探针异常", e);
    writeFileSync(
      join(evidenceDir, "failure.json"),
      JSON.stringify(
        await page.evaluate(() => ({
          body: document.body.innerText,
          phase: (window as any).__wbProps?.workflowPhase,
          transition: (window as any).__wbProps?.editTransitionByEpisode,
          stale: (window as any).__wbProps?.finalCutStale,
          posts: (window as any).__posts,
        })),
        null,
        2
      )
    );
    throw e;
  } finally {
    await close();
  }
}, 120000);
