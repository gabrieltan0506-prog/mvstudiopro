import { it, expect } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { novelMockTransport } from "./novelWorkspace.browser.fixture";
it("browser: one batch keeps episode 1, writes 2/3, reviews 10/20 batches through 60, resizes plans and preserves season 1", async () => {
  const built = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import{createRoot}from'react-dom/client';import{NovelAdaptationWorkspace}from'./client/src/pages/NovelAdaptation';import{emptyNovelWorkspace}from'./client/src/lib/novelWorkspace';
 if(!localStorage.getItem('seeded')){const d=emptyNovelWorkspace();d.mode='original';d.topic='沈昀';d.direction='宫廷权谋';d.targetEpisodeCount=80;d.templates=[{publicId:'mt_0000',role:'权谋',weight:100}];d.outline='前三集大纲';d.outlineApproved=d.outline;d.chapters=['第一集已读原文。'.repeat(80)];localStorage.setItem('mv-novel-lab-v2:1',JSON.stringify(d));localStorage.setItem('seeded','1');}createRoot(document.getElementById('root')).render(<NovelAdaptationWorkspace userId="1"/>);`,
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
        name: "mock",
        setup(b) {
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "mock",
          }));
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "mock",
          }));
          b.onLoad({ filter: /.*/, namespace: "mock" }, a => ({
            contents:
              a.path === "trpc"
                ? novelMockTransport
                : 'export const useAuth=()=>({user:{id:1,role:"admin"},loading:false})',
            loader: "js",
          }));
        },
      },
    ],
  });
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(
      `<div id="root"></div><script>${built.outputFiles[0].text.replace(/<\/script/g, "<\\/script")}</script>`
    );
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    page.on("dialog", d => void d.accept());
    await page.goto(`http://127.0.0.1:${(server.address() as any).port}`);
    const click = async (label: string) => {
      await page.waitForFunction(
        label =>
          Array.from(document.querySelectorAll("button")).some(
            b => b.textContent?.trim() === label && !b.matches(":disabled")
          ),
        {},
        label
      );
      await page.evaluate(label => {
        Array.from(document.querySelectorAll("button"))
          .find(b => b.textContent?.trim() === label)!
          .click();
      }, label);
    };
    const input = async (label: string, value: string) => {
      await page.$eval(
        `[aria-label="${label}"]`,
        (el, value) => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          )!.set!.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        },
        value
      );
    };
    await page.waitForSelector('[aria-label="全剧计划集数"]');
    const first = await page.$eval(
      '[aria-label="第1集小说稿"]',
      e => (e as HTMLTextAreaElement).value
    );
    await click("生成本批未写集数（逐集保存）");
    await page.waitForFunction(async () => {
      const d = await (globalThis as any).readDraft();
      return d.chapters.length === 3 && !d.pending && !d.generationQueue;
    });
    expect(
      await page.evaluate(() =>
        (globalThis as any).calls
          .filter((c: any) => c.stage === "chapter")
          .map((c: any) => c.chapterIndex)
      )
    ).toEqual([2, 3]);
    expect(
      await page.$eval(
        '[aria-label="第1集小说稿"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toBe(first);
    // Follow the actual candidate-adoption click in a separate page, then verify its project storage.
    await click("确认这版小说，进入模板比较");
    await click("单独生成 · 模板1");
    await page.waitForSelector('[aria-label="模板比较"] table');
    await page.waitForFunction(
      async () => !(await (globalThis as any).readDraft()).pending
    );
    const adoptedPage = await browser.newPage();
    adoptedPage.on("dialog", d => void d.accept());
    await adoptedPage.goto(page.url());
    await adoptedPage.waitForSelector('[aria-label="模板比较"] table');
    await adoptedPage.evaluate(() =>
      Array.from(document.querySelectorAll("button"))
        .find(b => b.textContent?.includes("采用这版剧本，进入漫剧工厂"))!
        .click()
    );
    await adoptedPage.waitForFunction(() => location.pathname === "/canvas");
    const imported = await adoptedPage.evaluate(() => {
      const project = new URLSearchParams(location.search).get("project");
      return JSON.parse(
        localStorage.getItem(
          `mv-manhua-project:1:${project}:mv-manhua-writer-session-v1`
        )!
      );
    });
    expect(imported.writerPack.episodes).toHaveLength(3);
    expect(imported.writerConfirmed).toBe(false);
    await adoptedPage.close();
    await input("全剧计划集数", "70");
    await input("全剧计划集数", "60");
    for (const [count, end] of [
      [10, 13],
      [20, 33],
      [20, 53],
      [20, 60],
    ]) {
      await click("确认这版小说，进入模板比较");
      await click(`审阅通过，准备续写${count}集`);
      await click("请创作顾问建议方向与模板");
      await page.waitForFunction(
        () =>
          !(
            document.querySelector(
              '[aria-label="创作模型"]'
            ) as HTMLSelectElement
          ).disabled
      );
      await click("生成本批续写提案");
      await page.waitForFunction(() =>
        (
          document.querySelector(
            '[aria-label="提案与大纲"]'
          ) as HTMLTextAreaElement
        ).value.includes("补天需要代价")
      );
      await click("确认大纲，开始分集写作");
      if (end === 13)
        await page.evaluate(() => {
          (globalThis as any).failChapter = 8;
        });
      await click("生成本批未写集数（逐集保存）");
      if (end === 13) {
        await page.waitForFunction(async () => {
          const d = await (globalThis as any).readDraft();
          return d.failedRequest?.chapterIndex === 8 && !d.pending;
        });
        const stopped = await page.evaluate(() =>
          (globalThis as any).readDraft()
        );
        expect(stopped.chapters).toHaveLength(7);
        expect(stopped.chapters[0]).toBe(first);
        expect(stopped.generationQueue.next).toBe(8);
        await click("查看保留原文");
        await page.waitForSelector('[aria-label="保留的模型原文"]');
        expect(
          await page.$eval(
            '[aria-label="保留的模型原文"]',
            el => (el as HTMLTextAreaElement).value
          )
        ).toContain("女娲");
        await click("恢复已收到的第8集（不重新生成）");
        await page.waitForFunction(async () => {
          const d = await (globalThis as any).readDraft();
          return d.chapters.length === 8 && !d.pending;
        });
        expect(
          await page.evaluate(
            () =>
              (globalThis as any).calls.filter(
                (c: any) => c.stage === "chapter" && c.chapterIndex === 8
              ).length
          )
        ).toBe(1);
        await click("继续本批");
      }

      await page.waitForFunction(
        async end => {
          const d = await (globalThis as any).readDraft();
          return d.chapters.length === end && !d.pending && !d.generationQueue;
        },
        { timeout: 45000 },
        end
      );
      expect(
        await page.evaluate(
          () =>
            (globalThis as any).calls
              .filter((c: any) => c.stage === "chapter")
              .at(-1).chapterIndex
        )
      ).toBe(end);
    }
    const full = await page.evaluate(() => (globalThis as any).readDraft());
    expect(full.chapters).toHaveLength(60);
    expect(full.chapters[0]).toBe(first);
    // Backup restores the chosen exact snapshot and first preserves the edited current draft.
    await click("云端备份");
    await page.waitForFunction(() =>
      document.body.textContent?.includes("云端备份已保存")
    );
    await page.$eval('[aria-label="第1集小说稿"]', el => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(el, "手动改动，回填前必须保留。".repeat(50));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("回填备份");
    await click("回填这一份");
    await page.waitForFunction(() =>
      document.body.textContent?.includes("回填成功")
    );
    expect(
      (await page.evaluate(() => (globalThis as any).readDraft())).chapters[0]
    ).toBe(first);
    expect(
      await page.evaluate(
        () =>
          JSON.parse((globalThis as any).backups[1].workspaceJson).chapters[0]
      )
    ).toContain("手动改动");
    await input("全剧计划集数", "50");
    expect(
      (await page.evaluate(() => (globalThis as any).readDraft())).chapters
    ).toHaveLength(60);
    await page.reload();
    await page.waitForSelector('[aria-label="第60集小说稿"]');
    expect(await page.evaluate(() => (globalThis as any).calls.length)).toBe(0);
    await click("开始下一季");
    await page.waitForFunction(
      async () => (await (globalThis as any).readDraft()).season === 2
    );
    const next = await page.evaluate(() => (globalThis as any).readDraft());
    expect(next.chapters).toEqual([]);
    expect(JSON.parse(next.seasons[0].workspace).chapters).toHaveLength(60);
    expect(next.continuity).toBe(full.continuity);
    await page.evaluate(() => {
      const summary = Array.from(document.querySelectorAll("summary")).find(s =>
        s.textContent?.startsWith("保留的季稿")
      );
      summary?.click();
    });
    await click("切回此季");
    await page.waitForFunction(
      async () => (await (globalThis as any).readDraft()).chapters.length === 60
    );
    const other = await browser.newPage();
    await other.goto(page.url());
    await other.waitForSelector('[aria-label="作品名称"]');
    await other.$eval('[aria-label="作品名称"]', el => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(el, "另一页面的最新作品名");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await other.waitForFunction(
      async () =>
        (await (globalThis as any).readDraft()).topic === "另一页面的最新作品名"
    );
    await page.$eval('[aria-label="第1集小说稿"]', el => {
      Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value"
      )!.set!.call(el, "冲突页面手稿保留");
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.bringToFront();
    await page.waitForFunction(() =>
      document.body.textContent?.includes("另一页面已更新")
    );
    expect(
      (await page.evaluate(() => (globalThis as any).readDraft())).topic
    ).toBe("另一页面的最新作品名");
    expect(
      (await page.evaluate(() => (globalThis as any).readDraft())).chapters[0]
    ).toBe(first);
    await click("云端备份");
    await page.waitForFunction(() =>
      document.body.textContent?.includes("云端备份已保存")
    );
    expect(
      await page.evaluate(
        () =>
          JSON.parse((globalThis as any).backups.at(-1).workspaceJson)
            .chapters[0]
      )
    ).toBe("冲突页面手稿保留");
    await other.close();
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
    server.close();
  }
}, 90000);
