import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { novelMockTransport as mock } from "./novelWorkspace.browser.fixture";

it("浏览器完整走原创→顾问→分章→单独/组合比较→重开恢复，墨菁传保持不变", async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{NovelAdaptationWorkspace}from'./client/src/pages/NovelAdaptation';createRoot(document.getElementById('root')).render(<NovelAdaptationWorkspace userId="1"/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    tsconfig: "tsconfig.json",
    external: ["pdfjs-dist", "tesseract.js"],
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "mock-transport",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "mock",
          }));
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({
            contents:
              args.path === "trpc"
                ? mock
                : 'export const useAuth=()=>({user:{id:1,role:"admin"},loading:false});',
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  let css = "";
  try {
    const dir = "client/dist/assets";
    css = readdirSync(dir)
      .filter(f => f.endsWith(".css"))
      .map(f => readFileSync(dir + "/" + f, "utf8"))
      .join("\n");
  } catch {}
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<meta charset="utf-8"><style>' +
        css +
        '</style><div id="root"></div><script>' +
        built.outputFiles[0].text.replace(/<\/script/g, "<\\/script") +
        "</script>"
    );
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as any).port;
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1000 });
    page.on("dialog", d => d.accept());
    const errors: string[] = [];
    page.on("pageerror", e => {
      errors.push(String(e));
      console.error("BROWSER", String(e));
    });
    await page.goto("http://127.0.0.1:" + port);
    await page.waitForSelector("h1", { timeout: 5000 }).catch(async e => {
      console.error((await page.content()).slice(0, 1000), errors);
      throw e;
    });
    await page.evaluate(async () =>
      localStorage.setItem(
        "mv-manhua-writer-session-v1",
        JSON.stringify({ seriesTitle: "墨菁传", asset: "原资产" })
      )
    );
    const click = async (label: string) => {
      await page.waitForFunction(
        label =>
          Array.from(document.querySelectorAll("button")).some(
            b => b.textContent === label && !b.matches(":disabled")
          ),
        {},
        label
      );
      await page.evaluate(label => {
        const b = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === label
        );
        if (!b || b.matches(":disabled"))
          throw new Error("unavailable " + label);
        b.click();
      }, label);
    };
    // Both initial source mode and returning from original mode open the native chooser.
    for (const fromOriginal of [false, true]) {
      if (fromOriginal) await click("原创新方向");
      const chooserPromise = page.waitForFileChooser();
      await click("上传底本改编");
      const chooser = await chooserPromise;
      await chooser.cancel();
      expect(
        await page.$eval("[data-manhua-novel-source]", el => el.tagName)
      ).toBe("SECTION");
      expect(
        await page.$eval(
          "[data-manhua-novel-source]",
          el => el.getBoundingClientRect().top
        )
      ).toBeLessThan(
        await page.$eval(
          '[aria-label="作品名称"]',
          el => el.getBoundingClientRect().top
        )
      );
    }
    await click("请创作顾问建议方向与模板");
    expect(
      await page.$eval("[data-advisor-feedback]", el => el.textContent)
    ).toContain("请先填写作品名称");
    expect(
      await page.evaluate(async () => (globalThis as any).calls.length)
    ).toBe(0);
    await page.select('[aria-label="创作环节"]', "sound");
    expect(
      await page.$$eval('[aria-label="选择故事模板"] > div', els => els.length)
    ).toBe(3);
    await page.click('[aria-label="比较模板 0000"]');
    await page.click('[aria-label="比较模板 0002"]');
    expect(await page.$('[aria-label="模板手法对照"]')).toBeTruthy();
    await page.select('[aria-label="创作环节"]', "");
    expect(await page.$('[aria-label="表现形式"]')).toBeNull();
    await click("原创新方向");
    await page.type('[aria-label="作品名称"]', "女娲补天");
    await page.type('[aria-label="创作方向"]', "以守火人视角写牺牲与救赎。");
    await click("请创作顾问建议方向与模板");
    await page.waitForFunction(() =>
      document.body.textContent!.includes("强化角色抉择")
    );
    await click("加入本轮候选");
    await page.evaluate(async () => {
      const buttons = Array.from(document.querySelectorAll("button")).filter(
        b => b.textContent === "加入本轮候选" && !b.matches(":disabled")
      );
      buttons[0].click();
    });
    await page.$eval('[aria-label="模板占比 mt_0000"]', el => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "75");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("请创作顾问建议方向与模板");
    expect(
      await page.$eval("[data-advisor-feedback]", el => el.textContent)
    ).toContain("调整为100%");
    expect(
      await page.evaluate(async () => (globalThis as any).calls.length)
    ).toBe(1);
    await page.$eval('[aria-label="模板占比 mt_0001"]', el => {
      const input = el as HTMLInputElement;
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(input, "25");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.select('[aria-label="创作模型"]', "deepseek");
    await page.type(
      '[aria-label="回复顾问"]',
      "保留未来武器，两个模板分别负责破局与对白，请解释怎么组合。"
    );
    await click("发送给顾问");
    await page.waitForFunction(
      async () =>
        (globalThis as any).calls.filter((c: any) => c.stage === "advice")
          .length === 2 &&
        !(
          document.querySelector(
            '[aria-label="回复顾问"]'
          ) as HTMLTextAreaElement
        ).disabled
    );
    const followup = await page.evaluate(async () =>
      (globalThis as any).calls.at(-1)
    );
    expect(followup.advisorMessage).toContain("保留未来武器");
    expect(followup.advisorHistory).toHaveLength(1);
    expect(followup.advisorHistory[0].assistant).toContain("强化角色抉择");
    expect(followup.templates.map((t: any) => t.weight)).toEqual([75, 25]);
    expect(followup.modelPreference).toBe("deepseek");
    expect(
      await page.$eval('[aria-label="顾问对话记录"]', e => e.textContent)
    ).toContain("保留未来武器");
    await page.type('[aria-label="回复顾问"]', "尚未发送的想法");
    await page.reload();
    await page.waitForSelector('[aria-label="回复顾问"]');
    expect(
      await page.$eval(
        '[aria-label="回复顾问"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toBe("尚未发送的想法");
    expect(
      await page.$eval('[aria-label="顾问对话记录"]', e => e.textContent)
    ).toContain("保留未来武器");
    expect(
      await page.evaluate(async () => (globalThis as any).calls.length)
    ).toBe(0);
    expect(
      await page.$eval(
        '[aria-label="创作模型"]',
        el => (el as HTMLSelectElement).value
      )
    ).toBe("deepseek");
    expect(
      await page.$eval('[aria-label="顾问对话记录"]', el => el.textContent)
    ).toContain("DeepSeek V4.1 Flash");
    await click("生成3个故事方案");
    await page.waitForSelector('[aria-label="故事线方案"]');
    expect(
      await page.$eval(
        '[aria-label="提案与大纲"]',
        el => (el as HTMLTextAreaElement).value
      )
    ).toBe("");
    await click("采用这条故事线");
    await page.waitForFunction(() =>
      (
        document.querySelector(
          '[aria-label="提案与大纲"]'
        ) as HTMLTextAreaElement
      )?.value.includes("补天需要代价")
    );
    expect(
      await page.evaluate(
        async () => (globalThis as any).calls[0].advisorHistory.length
      )
    ).toBe(2);
    await click("确认大纲，开始分集写作");
    await page.evaluate(async () => {
      (globalThis as any).deferChapter = true;
    });
    for (let i = 1; i <= 3; i++) {
      await page.evaluate(i => {
        const heading = Array.from(document.querySelectorAll("h3")).find(
          e => e.textContent === "第" + i + "集"
        );
        (
          heading?.parentElement?.querySelector("button") as HTMLButtonElement
        ).click();
      }, i);
      if (i === 2) {
        await page.waitForFunction(
          () => typeof (globalThis as any).releaseChapter === "function"
        );
        expect(
          await page.$eval(
            '[aria-label="第1集小说稿"]',
            el => (el as HTMLTextAreaElement).disabled
          )
        ).toBe(false);
        expect(
          await page.$eval(
            '[aria-label="第2集小说稿"]',
            el => (el as HTMLTextAreaElement).disabled
          )
        ).toBe(false);
        await page.$eval('[aria-label="第1集小说稿"]', el => {
          const field = el as HTMLTextAreaElement;
          Object.getOwnPropertyDescriptor(
            HTMLTextAreaElement.prototype,
            "value"
          )!.set!.call(field, field.value + "\n手动修改第一章动机");
          field.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await page.evaluate(async () => (globalThis as any).releaseChapter());
        await page.waitForFunction(() =>
          document.body.textContent!.includes("前文在生成期间有修改")
        );
        expect(
          await page.$eval(
            '[aria-label="第1集小说稿"]',
            el => (el as HTMLTextAreaElement).value
          )
        ).toContain("手动修改第一章动机");
      }

      await page.waitForFunction(
        i =>
          (
            document.querySelector(
              '[aria-label="第' + i + '集小说稿"]'
            ) as HTMLTextAreaElement
          )?.value.length > 500,
        {},
        i
      );
    }
    await click("确认这版小说，进入模板比较");
    await click("单独生成 · 模板1");
    await page.waitForFunction(
      async () =>
        document.querySelectorAll('[aria-label="模板比较"] thead th').length ===
        2
    );
    await click("单独生成 · 模板2");
    await page.waitForFunction(
      async () =>
        document.querySelectorAll('[aria-label="模板比较"] thead th').length ===
        3
    );
    await click("按分工组合生成");
    await page.waitForFunction(
      async () =>
        document.querySelectorAll('[aria-label="模板比较"] thead th').length ===
        4
    );
    const calls = await page.evaluate(async () => (window as any).calls);
    expect(
      calls
        .filter((c: any) => c.stage === "chapter")
        .map((c: any) => c.chapterIndex)
    ).toEqual([1, 2, 3]);
    expect(
      calls
        .filter((c: any) => c.stage === "script")
        .map((c: any) => c.templates.length)
    ).toEqual([1, 1, 1, 1, 1, 1, 2, 2, 2]);
    expect(
      calls
        .filter((c: any) => c.stage === "script" && c.templates.length === 1)
        .every((c: any) => c.templates[0].weight === 100)
    ).toBe(true);
    expect(
      new Set(
        calls.filter((c: any) => c.stage === "script").map((c: any) => c.novel)
      ).size
    ).toBe(3);
    expect(
      await page.$eval('[aria-label="模板比较"]', e => e.textContent)
    ).toContain("共同场景。");
    await page.emulateMediaFeatures([
      { name: "prefers-reduced-motion", value: "reduce" },
    ]);
    expect(
      await page.$eval(
        ".novel-difference",
        e => getComputedStyle(e).animationName
      )
    ).toBe("none");
    mkdirSync("../backend-work/novel-workspace", { recursive: true });
    await page.screenshot({
      path: "../backend-work/novel-workspace/desktop.png",
      fullPage: true,
    });
    await page.reload();
    await page.waitForSelector('[aria-label="模板比较"] table');
    expect(await page.evaluate(async () => (window as any).calls.length)).toBe(
      0
    );
    expect(
      await page.evaluate(
        async () =>
          JSON.parse(localStorage.getItem("mv-manhua-writer-session-v1")!)
            .seriesTitle
      )
    ).toBe("墨菁传");
    await page.setViewport({ width: 390, height: 844 });
    expect(
      await page.evaluate(async () => document.documentElement.scrollWidth)
    ).toBeLessThanOrEqual(391);
    await page.screenshot({
      path: "../backend-work/novel-workspace/mobile.png",
      fullPage: true,
    });
    const beforeReselect = await page.evaluate(
      async () => await (globalThis as any).readDraft()
    );
    await click("刷新模板库");
    expect(
      await page.evaluate(async () => (globalThis as any).templateRefreshes)
    ).toBe(1);
    await page.$eval('[aria-label="回复顾问"]', el => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(el, "这条故事线不满意，减少朝堂，改为江湖追查。");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("按新方向生成3个故事方案");
    await page.waitForFunction(
      async () =>
        !(
          document.querySelector(
            '[aria-label="回复顾问"]'
          ) as HTMLTextAreaElement
        ).disabled
    );
    const reselect = await page.evaluate(async () =>
      (globalThis as any).calls.at(-1)
    );
    expect(reselect.advisorIntent).toBe("story_variants");
    expect(reselect.advisorMessage).toContain("江湖追查");
    expect(reselect.outline).toBe(beforeReselect.outline);
    expect(reselect.novel).toContain(beforeReselect.chapters[2]);
    const afterReselect = await page.evaluate(
      async () => await (globalThis as any).readDraft()
    );
    expect(afterReselect.templates).toEqual(beforeReselect.templates);
    expect(afterReselect.chapters).toEqual(beforeReselect.chapters);
    expect(afterReselect.outline).toBe(beforeReselect.outline);
    const callCountBeforeAdopt = await page.evaluate(
      async () => (globalThis as any).calls.length
    );
    await click("采用这条故事线");
    const adopted = await page.evaluate(
      async () => await (globalThis as any).readDraft()
    );
    expect(adopted.chapters).toEqual(beforeReselect.chapters);
    expect(adopted.outlineApproved).toBe("");
    expect(adopted.storyVersions.at(-1).chapters).toEqual(
      beforeReselect.chapters
    );
    expect(
      await page.evaluate(async () => (globalThis as any).calls.length)
    ).toBe(callCountBeforeAdopt);
    // Restore the version with generated chapters, without another model call.
    await page.evaluate(async () => {
      const articles = Array.from(document.querySelectorAll("article"));
      const saved = articles.find(a =>
        a.querySelector("pre")?.textContent?.includes("女娲望着破裂的天空")
      );
      const button = Array.from(saved!.querySelectorAll("button")).find(
        b => b.textContent === "恢复此版本"
      );
      button!.click();
    });
    await page.waitForFunction(
      async () => (await (globalThis as any).readDraft()).chapters.length === 3
    );
    await page.select('[aria-label="创作模型"]', "glm");
    await click("请创作顾问建议方向与模板");
    await page.waitForFunction(
      async () =>
        !(
          document.querySelector('[aria-label="创作模型"]') as HTMLSelectElement
        ).disabled
    );
    const comparisonInput = await page.evaluate(async () =>
      (globalThis as any).calls.at(-1)
    );
    expect(comparisonInput.modelPreference).toBe("glm");
    expect(comparisonInput.advisorHistory).toBeUndefined();
    expect(comparisonInput.outline).toBe("");
    expect(comparisonInput.novel).toBe("");
    expect(comparisonInput.templates.map((t: any) => t.weight)).toEqual([
      75, 25,
    ]);
    await click("以这版继续讨论与创作");
    await page.type('[aria-label="回复顾问"]', "沿用这版继续讨论");
    await click("发送给顾问");
    await page.waitForFunction(
      () =>
        (globalThis as any).calls.at(-1)?.advisorMessage === "沿用这版继续讨论"
    );
    await page.waitForFunction(
      async () =>
        !(
          document.querySelector('[aria-label="创作模型"]') as HTMLSelectElement
        ).disabled
    );
    expect(
      await page.evaluate(
        async () => (globalThis as any).calls.at(-1).advisorHistory.length
      )
    ).toBe(1);
    // Refresh a pending request: poll the same receipt, show actual progress, never generate again.
    const pendingId = await page.evaluate(async () => {
      const key = "mv-novel-lab-v2:1",
        state = await (globalThis as any).readDraft();
      state.pending = {
        ...state.runs.find((r: any) => r.input.stage === "advice").input,
        requestId: crypto.randomUUID(),
        advisorMessage: "继续讨论人物动机",
      };
      await (globalThis as any).writeDraft(state);
      return state.pending.requestId;
    });
    await page.reload();
    await page.waitForSelector("[data-advisor-feedback]");
    await page.evaluate(async id => {
      (globalThis as any).receipts[id] = {
        status: "running",
        phase: "receiving",
        updatedAt: new Date().toISOString(),
      };
    }, pendingId);
    await page.waitForFunction(() =>
      document
        .querySelector("[data-advisor-feedback]")
        ?.textContent?.includes("正在接收创作回复")
    );
    await page.evaluate(async id => {
      const state = await (globalThis as any).readDraft();
      (globalThis as any).receipts[id] = {
        status: "succeeded",
        result: {
          ...state.runs[0].result,
          requestId: id,
          text: JSON.stringify({
            assessment: "已恢复这次讨论",
            recommendations: [],
          }),
        },
      };
    }, pendingId);
    await page.waitForFunction(() =>
      document
        .querySelector('[aria-label="顾问对话记录"]')
        ?.textContent?.includes("已恢复这次讨论")
    );
    expect(
      await page.evaluate(async () => (globalThis as any).calls.length)
    ).toBe(0);
    expect(
      await page.evaluate(
        async () => (await (globalThis as any).readDraft()).pending
      )
    ).toBeUndefined();
    expect(
      await page.$$eval(
        '[aria-label="顾问对话记录"] p',
        els => els.filter(e => e.textContent?.includes("已恢复这次讨论")).length
      )
    ).toBe(1);
    await click("放弃本轮，重新开始");
    await page.waitForFunction(
      async () =>
        (document.querySelector('[aria-label="作品名称"]') as HTMLInputElement)
          .value === ""
    );
    expect(
      await page.evaluate(async () => await (globalThis as any).archives())
    ).toBe(true);
    await page.evaluate(async () => {
      const key = "mv-novel-lab-v2:1",
        state = await (globalThis as any).readDraft();
      state.mode = "original";
      state.topic = "六模板测试";
      state.direction = "合并手法";
      state.templates = Array.from({ length: 5 }, (_, i) => ({
        publicId: "mt_000" + i,
        role: "分工" + i,
        weight: i === 0 ? 100 : 0,
      }));
      await (globalThis as any).writeDraft(state);
    });
    await page.reload();
    await page.waitForSelector('[aria-label="选择故事模板"]');
    await page.evaluate(async () => {
      const b = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          '[aria-label="选择故事模板"] button'
        )
      ).find(b => b.textContent?.includes("模板6"));
      b!.click();
    });
    await page.waitForFunction(
      async () => (await (globalThis as any).readDraft()).templates.length === 6
    );
    await click("生成3个故事方案");
    await page.waitForSelector('[aria-label="故事线方案"]');
    expect(
      await page.evaluate(
        async () => (globalThis as any).calls[0].templates.length
      )
    ).toBe(6);
    expect(
      await page.evaluate(
        async () => (globalThis as any).calls[0].selectedTemplateIds.length
      )
    ).toBe(6);
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.close();
  }
}, 60000);
