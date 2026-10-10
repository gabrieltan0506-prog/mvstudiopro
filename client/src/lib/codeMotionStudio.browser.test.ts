import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import path from "node:path";
import { build as buildStyles } from "vite";
import tailwindcss from "@tailwindcss/vite";

it("映刻真实页面保留资料，先展示再确认；断线恢复沿用同一个请求", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
import React from'react';import{createRoot}from'react-dom/client';import Studio from './client/src/pages/CodeMotionStudio';
globalThis.fixture={asks:[],submits:[],saved:null,fail:true};createRoot(document.getElementById('root')).render(<Studio/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    loader: { ".css": "empty" },
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: {
      "process.env.NODE_ENV": '"development"',
      "import.meta.env": "{}",
    },
    plugins: [
      {
        name: "不访问真实服务或媒体",
        setup(b) {
          b.onResolve({ filter: /^@\/_core\/hooks\/useAuth$/ }, () => ({
            path: "auth",
            namespace: "fixture",
          }));
          b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
            path: "trpc",
            namespace: "fixture",
          }));
          b.onResolve(
            {
              filter:
                /^@\/components\/(PlatformHtmlPptPanel|CodeMotionVideoPptx|code-motion\/CodeMotionPreview)$/,
            },
            a => ({ path: a.path, namespace: "component-fixture" })
          );
          b.onLoad({ filter: /.*/, namespace: "component-fixture" }, a => ({
            loader: "tsx",
            resolveDir: process.cwd(),
            contents: a.path.includes("PlatformHtmlPptPanel")
              ? `import React,{useState}from'react';export default function Panel({initialContent}){const[v,set]=useState('');return <div><p>演示材料：{initialContent.text}</p><p data-testid='ppt-data'>{JSON.stringify(initialContent.data)}</p><input aria-label='演示备注' value={v} onChange={e=>set(e.target.value)}/></div>}`
              : `export default function BlockedMedia(){throw Error('不得加载真实媒体')}`,
          }));
          b.onLoad({ filter: /^auth$/, namespace: "fixture" }, () => ({
            loader: "js",
            contents: `export const useAuth=()=>({user:{id:7,role:'user'}});`,
          }));
          b.onLoad({ filter: /^trpc$/, namespace: "fixture" }, () => ({
            loader: "js",
            contents: `
const query=data=>({useQuery:()=>({data,refetch:async()=>({data})})});
const f=()=>globalThis.fixture;
export const trpc={useUtils:()=>({codeMotion:{prepare:{fetch:async()=>({generation:'1',fingerprint:'a'.repeat(64),freeEligibility:{eligible:true,reason:'available',remainingAccounts:10},audios:[],images:[],scenes:f().saved.project.plan.scenes.map(s=>({...s,movement:'文字进入'})),credits:0,spec:{},requestId:'test'})},get:{fetch:async()=>f().saved}}}),codeMotion:{resolveAudios:query([]),importAudio:{useMutation:()=>({mutateAsync:async()=>{throw Error("本夹具不上传录音")}})},quote:query({remainingFreeToday:3,credits:0}),list:query([]),history:query([]),status:query(null),importFile:{useMutation:()=>({mutateAsync:async()=>f().importReturn})},save:{useMutation:()=>({mutateAsync:async x=>{f().saved={project:x.project,generation:'1'};return f().saved}})},submit:{useMutation:()=>({mutateAsync:async x=>{f().submits.push(x);return{}}})}},mvAnalysis:{getVideoUploadSignedUrl:{useMutation:()=>({mutateAsync:async()=>({uploadUrl:'http://localhost:41943/test-upload',gcsUri:'gs://test/uploads/u7/test.csv',requiredHeaders:{}})})},askPlatformSkillQa:{useMutation:()=>({mutateAsync:async x=>{f().asks.push(x);if(f().fail)throw Error('连接中断');return {answer:JSON.stringify({...JSON.parse(localStorage.getItem('yingke:draft:7')).project.plan,summary:'原请求结果'}),creditsCharged:0}}})}}};`,
          }));
        },
      },
    ],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(6000);
    await page.setRequestInterception(true);
    page.on("request", r =>
      r.isNavigationRequest()
        ? void r.respond({
            status: 200,
            contentType: "text/html",
            body: '<div id="root"></div>',
          })
        : r.method() === "PUT"
          ? void r.respond({ status: 200, body: "" })
          : void r.abort()
    );
    await page.goto("http://localhost:41943/");
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    // 使用正式构建样式，防止DOM有文字却因白底白字不可见。
    const styles = await buildStyles({
      configFile: false,
      root: path.resolve("client"),
      logLevel: "silent",
      plugins: [tailwindcss()],
      build: {
        write: false,
        rollupOptions: { input: path.resolve("client/src/index.css") },
      },
    });
    if (Array.isArray(styles) || !("output" in styles))
      throw Error("样式构建未返回产物");
    const cssFiles = styles.output.filter(
      asset => asset.type === "asset" && asset.fileName.endsWith(".css")
    );
    expect(cssFiles.length).toBeGreaterThan(0);
    for (const asset of cssFiles)
      if (asset.type === "asset")
        await page.addStyleTag({ content: String(asset.source) });
    const checkReadable = async (text: string) => {
      const contrast = await page.evaluate(t => {
        const el = Array.from(document.querySelectorAll("button")).find(
          e => e.textContent?.trim() === t
        )!;
        const style = getComputedStyle(el);
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const ctx = canvas.getContext("2d")!;
        const luminance = (color: string) => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 1, 1);
          const rgb = Array.from(ctx.getImageData(0, 0, 1, 1).data)
            .slice(0, 3)
            .map(v => {
              const n = v / 255;
              return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
            });
          return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
        };
        const a = luminance(style.color),
          b = luminance(style.backgroundColor);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }, text);
      expect(contrast, text + "文字与底色对比度").toBeGreaterThanOrEqual(4.5);
    };
    const click = async (text: string) =>
      page.evaluate(t => {
        const el = Array.from(document.querySelectorAll("button")).find(
          e => e.textContent?.trim() === t
        );
        if (!el || el.disabled) throw Error("按钮不可用：" + t);
        el.click();
      }, text);
    await page.waitForSelector("textarea");
    const openingText = await page.$eval(
      "body",
      node => node.textContent || ""
    );
    expect(openingText).toContain("本次免费整理");
    expect(openingText).toContain("今日还可免费整理 3 次");
    expect(openingText).not.toMatch(
      /主用 GLM|DeepSeek|沿用创作顾问额度|用现有Gemini/
    );

    await checkReadable("请顾问整理安排");
    await page.type("textarea", "温暖介绍门店");
    await page.type(
      'textarea[placeholder="粘贴已有文案。自己安排时，每段一行。"]',
      "欢迎光临\n招牌饮品"
    );
    const mode = 'select:has(option[value="words"])';
    expect(
      await page.$eval(mode, element => (element as HTMLSelectElement).value)
    ).toBe("scenes");
    await page.select(mode, "words");
    await page.waitForFunction(() =>
      document.body.innerText.includes("当前只制作动态文字")
    );
    await click("改为场景动画");
    expect(
      await page.$eval(mode, element => (element as HTMLSelectElement).value)
    ).toBe("scenes");
    expect(
      await page.$eval(
        'textarea[placeholder="粘贴已有文案。自己安排时，每段一行。"]',
        element => (element as HTMLTextAreaElement).value
      )
    ).toBe("欢迎光临\n招牌饮品");
    expect(await page.evaluate(() => (globalThis as any).fixture.asks)).toEqual(
      []
    );
    await click("PPT 演示");
    await page.waitForSelector('[aria-label="演示备注"]');
    await page.type('[aria-label="演示备注"]', "保留我的演示草稿");
    await click("MP4 视频");
    await click("PPT 演示");
    expect(
      await page.$eval(
        '[aria-label="演示备注"]',
        e => (e as HTMLInputElement).value
      )
    ).toBe("保留我的演示草稿");
    await click("MP4 视频");
    await click("自己按段落安排");
    await page.waitForFunction(() =>
      document.body.innerText.includes("第 2 个画面")
    );
    expect(
      await page.evaluate(() => (globalThis as any).fixture.submits)
    ).toEqual([]);
    await click("保存并查看本次视频内容");
    await page.waitForFunction(() =>
      document.body.innerText.includes("这次要做的视频")
    );
    expect(
      await page.evaluate(() => (globalThis as any).fixture.submits)
    ).toEqual([]);
    await checkReadable("确认内容，播放预览");
    await checkReadable("确认内容，导出视频");
    await click("确认内容，导出视频");
    await page.waitForFunction(
      () => (globalThis as any).fixture.submits.length === 1
    );
    expect(
      await page.evaluate(() => (globalThis as any).fixture.submits[0])
    ).toMatchObject({
      expectedGeneration: "1",
      confirmedFingerprint: "a".repeat(64),
      confirmedCredits: 0,
    });
    await page.waitForFunction(
      () =>
        !Array.from(document.querySelectorAll("button")).find(
          e => e.textContent?.trim() === "请顾问整理安排"
        )?.disabled
    );
    await click("请顾问整理安排");
    await page.waitForFunction(() =>
      document.body.innerText.includes("连接中断")
    );
    const first = await page.evaluate(
      () => (globalThis as any).fixture.asks[0]
    );
    expect(
      await page.$eval(
        "textarea",
        e =>
          (e as HTMLTextAreaElement).disabled ||
          !!e.closest("fieldset")?.disabled
      )
    ).toBe(true);
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() =>
      document.body.innerText.includes("取回这次整理结果")
    );
    await page.evaluate(() => ((globalThis as any).fixture.fail = false));
    await click("取回这次整理结果");
    await page.waitForFunction(() =>
      document.body.innerText.includes("原请求结果")
    );
    expect(
      await page.evaluate(() => (globalThis as any).fixture.asks[0])
    ).toEqual(first);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("yingke:draft:7")!).pending
      )
    ).toBeNull();
    await click("PPT 演示");
    await page.evaluate(() => {
      (globalThis as any).fixture.importReturn = {
        kind: "spreadsheet",
        name: "销售.csv",
        message: "已读取表格",
        workbook: {
          sheets: [
            {
              name: "CSV",
              rows: [
                {
                  index: 1,
                  cells: [
                    { kind: "text", text: "月份" },
                    { kind: "text", text: "收入" },
                  ],
                },
                ...Array.from({ length: 20 }, (_, i) => ({
                  index: i + 2,
                  cells: [
                    { kind: "text", text: `第${i + 1}月` },
                    { kind: "number", text: String(i), value: i },
                  ],
                })),
              ],
            },
          ],
          warnings: [],
        },
      };
      const input = document.querySelector(
        'input[aria-label="导入图片、文档或表格"]'
      ) as HTMLInputElement;
      const dt = new DataTransfer();
      dt.items.add(new File(["月份,收入"], "销售.csv", { type: "text/csv" }));
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForSelector('[aria-label="选择导入工作表"]');
    expect(await page.$$("tbody tr")).toHaveLength(21);
    await click("使用所选数据");
    await page.waitForFunction(() =>
      document.body.innerText.includes("已为PPT保留全部20项")
    );
    expect(
      await page.$eval('[data-testid="ppt-data"]', e =>
        JSON.parse(e.textContent || "[]")
      )
    ).toHaveLength(20);
    await page.reload();
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.waitForFunction(() =>
      document.body.innerText.includes("PPT已选择 20 项")
    );
    await click("PPT 演示");
    await page.waitForSelector('[data-testid="ppt-data"]');
    expect(
      await page.$eval('[data-testid="ppt-data"]', e =>
        JSON.parse(e.textContent || "[]")
      )
    ).toHaveLength(20);
  } finally {
    await browser.close();
  }
}, 30_000);
