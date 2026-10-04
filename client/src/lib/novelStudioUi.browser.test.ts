import { it, expect } from "vitest";
import puppeteer from "puppeteer";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { buildNovelStudioUiPreview } from "./novelStudioUi.browser.fixture";

// New UI interactions only. Providers and cloud remain mocked; no paid calls.
it("新工作台：分集编辑保留、模板滑杆、比较转编辑、备份与窄屏", async () => {
  const { html, artifactDir } = await buildNovelStudioUiPreview();
  const server = createServer((_, res) => {
    res.setHeader("Content-Type", "text/html;charset=utf-8");
    res.end(html);
  });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 1024, deviceScaleFactor: 1 });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    page.on("dialog", d => void d.accept());
    const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    await page.goto(url);
    await page.waitForSelector(
      '[data-novel-step="novel"][aria-current="step"]'
    );
    const step = async (id: string) => {
      await page.click(`[data-novel-step="${id}"]`);
    };
    const click = async (label: string) => {
      await page.evaluate(label => {
        const el = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent?.trim() === label
        );
        if (!el || el.disabled) throw Error("Unavailable " + label);
        el.click();
      }, label);
    };
    const input = async (label: string, value: string) => {
      await page.$eval(
        `[aria-label="${label}"]`,
        (el, value) => {
          const proto =
            el instanceof HTMLTextAreaElement
              ? HTMLTextAreaElement.prototype
              : HTMLInputElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(el, value);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        },
        value
      );
    };
    await page.click('[aria-label="编辑第2集"]');
    expect(await page.$('[aria-label="第1集小说稿"]')).toBeNull();
    await click("模板方法");
    await page.screenshot({ path: `${artifactDir}/novel-desktop.png` });
    await input("第2集小说稿", "拿命换的筹码\n\n用户保留的第二集。".repeat(35));
    await page.click('[aria-label="编辑第1集"]');
    await input(
      "第1集小说稿",
      "文书库里的先知\n\n用户修改第一集，后续生成不得覆盖。".repeat(25)
    );
    await page.click('[aria-label="编辑第2集"]');
    expect(
      await page.$eval(
        '[aria-label="第2集小说稿"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toContain("用户保留的第二集");
    await step("templates");
    await page.waitForSelector('[aria-label="模板滑杆 mt_0000"]');
    await input("模板滑杆 mt_0000", "60");
    expect(
      await page.$eval(
        '[aria-label="模板占比 mt_0000"]',
        e => (e as HTMLInputElement).value
      )
    ).toBe("60");
    expect(
      await page.$eval('[aria-label="模板创作配比"]', e => e.textContent)
    ).toContain("110%");
    await input("模板占比 mt_0001", "20");
    await page.screenshot({ path: `${artifactDir}/templates-desktop.png` });
    await step("scripts");
    await page.waitForSelector('[aria-label="候选剧本 B"]');
    await click("第2集");
    expect(
      await page.$eval('[aria-label="候选剧本 A"]', e => e.textContent)
    ).toContain("暖灯只照亮卷宗");
    expect(
      await page.$eval('[aria-label="候选剧本 B"]', e => e.textContent)
    ).toContain("冷蓝月光");
    await page.screenshot({ path: `${artifactDir}/comparison-desktop.png` });
    await page.$eval('[aria-label="候选剧本 B"] button', b =>
      (b as HTMLButtonElement).click()
    );
    await page.waitForSelector('[aria-label="剧本编辑集数"]');
    await page.evaluate(() => {
      const b = Array.from(
        document.querySelectorAll('[aria-label="剧本编辑集数"] button')
      ).find(b => b.textContent?.startsWith("第2集"));
      (b as HTMLButtonElement).click();
    });
    await input("第2集 E2-S1 灯光", "用户编辑：窗外冷光，桌上保留一盏暖灯。");
    await click("比较版本");
    await click("第2集");
    expect(
      await page.$eval('[aria-label="候选剧本 B"]', e => e.textContent)
    ).toContain("用户编辑：窗外冷光");
    await click("备份与设置");
    await click("云端备份");
    await page.waitForFunction(() =>
      document.body.textContent!.includes("云端备份已保存")
    );
    await click("收起");
    await page.reload();
    await page.waitForSelector('[aria-label="第1集小说稿"]');
    expect(
      await page.$eval(
        '[aria-label="第1集小说稿"]',
        e => (e as HTMLTextAreaElement).value
      )
    ).toContain("用户修改第一集");
    await step("scripts");
    await click("第2集");
    expect(
      await page.$eval('[aria-label="候选剧本 B"]', e => e.textContent)
    ).toContain("用户编辑：窗外冷光");
    await page.setViewport({ width: 390, height: 844 });
    for (const id of ["prepare", "templates", "novel", "scripts"]) {
      await step(id);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        ),
        id + " has overflow"
      ).toBe(true);
      await page.screenshot({ path: `${artifactDir}/${id}-mobile.png` });
    }
    const proof = await page.evaluate(() => ({
      calls: (globalThis as any).calls.length,
      backups: (globalThis as any).backups.length,
      protectedDraft: localStorage.getItem("mv-manhua-writer-session-v1"),
    }));
    expect(proof.calls).toBe(0);
    expect(proof.protectedDraft).toBe("墨菁传保护样本");
    expect(errors).toEqual([]);
    writeFileSync(
      `${artifactDir}/evidence.json`,
      JSON.stringify(
        {
          proof,
          errors,
          viewport: [1440, 1024],
          mobile: [390, 844],
          scope: "New UI only; offline mock",
        },
        null,
        2
      )
    );
  } finally {
    await browser.close();
    server.close();
  }
}, 90000);
