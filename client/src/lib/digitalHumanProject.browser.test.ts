import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer from "puppeteer";
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";

it("总览新增17段、编辑排序搜索与刷新恢复；选片按项目顺序传入后期", async () => {
  const bundle = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {DigitalHumanProjectPanel} from './client/src/components/DigitalHumanProjectPanel';
    import {newDigitalHumanDraft,loadDigitalHumanDraft} from './shared/digitalHumanStudio';
    import {addDigitalHumanSegment,switchDigitalHumanSegment} from './shared/digitalHumanProject';
    let count=1;const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
    globalThis.saved=newDigitalHumanDraft('7',id(1));
    function App(){const[draft,setDraft]=React.useState(globalThis.saved),[view,setView]=React.useState('overview');
      const save=fn=>{globalThis.saved=fn(globalThis.saved);setDraft(globalThis.saved)};
      globalThis.restore=()=>{globalThis.saved=loadDigitalHumanDraft(JSON.stringify(globalThis.saved),'7');setDraft(globalThis.saved)};
      globalThis.seedOutput=()=>save(d=>({...d,productions:[{request:{requestId:id(88),input:{action:'digital_human_final',params:{audioUri:'gs://test-only/voice',audioRequestId:id(89),clips:[{videoUri:'gs://test-only/clip',startSec:0,endSec:5}],voice:{pan:0,room:'dry',volume:1},tracks:[],aspectRatio:'9:16'}}},fingerprint:'test-only',status:'succeeded',source:'gs://test-only/final'}]}));
      return <main className="dh-studio"><DigitalHumanProjectPanel draft={draft} view={view} setView={setView} save={save} select={async id=>{save(d=>switchDigitalHumanSegment(d,id));setView('segment')}} add={async chapter=>{save(d=>addDigitalHumanSegment(d,id(++count),chapter));setView('segment')}} disabled={false} beforeSubmit={async()=>{}} acquireWork={()=>()=>{}} role="user"/></main>;
    }createRoot(document.getElementById('root')).render(<App/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    alias: {
      "@shared": path.resolve("shared"),
      "@": path.resolve("client/src"),
    },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [
      {
        name: "observe-existing-workshop-boundary",
        setup(b) {
          b.onResolve({ filter: /\/PostProdWorkshopCard$/ }, () => ({
            path: "workshop",
            namespace: "boundary",
          }));
          b.onLoad({ filter: /.*/, namespace: "boundary" }, () => ({
            contents: `import React from 'react';export default function Workshop(p){globalThis.workshopInput=p.mediaInput;globalThis.workshopOrder=p.orderedClipIds;return <p>既有后期边界：本用例只验证真实选片输入，不提交云端任务</p>}`,
            loader: "tsx",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
    logLevel: "silent",
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(),
      errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on(
      "request",
      r =>
        void r.respond({
          status: 200,
          contentType: "text/html",
          body: '<div id="root"></div>',
        })
    );
    await page.goto("https://test.invalid");
    await page.setViewport({ width: 1440, height: 1000 });
    await page.addStyleTag({
      content: await readFile(
        "client/src/components/DigitalHumanStudio.css",
        "utf8"
      ),
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const click = async (text: string) => {
      await page.evaluate(text => {
        const b = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent?.trim() === text
        );
        if (!b) throw new Error("缺少按钮 " + text);
        b.click();
      }, text);
    };
    await page.waitForSelector('[aria-label="影片名称"]');
    for (let i = 2; i <= 17; i++) {
      await click("＋ 新增段落");
      await page.waitForFunction(
        n => (globalThis as any).saved.project.segments.length === n,
        {},
        i
      );
    }
    await click("整片总览");
    expect(await page.$$eval("tbody tr", rows => rows.length)).toBe(10);
    await click("下一页");
    expect(await page.$$eval("tbody tr", rows => rows.length)).toBe(7);
    await page.focus('[aria-label="搜索段落"]');
    await page.$eval('[aria-label="搜索段落"]', e => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(e, "段落 17");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(
      () => document.querySelectorAll("tbody tr").length === 1,
      { timeout: 5000 }
    );
    expect(await page.$$eval("tbody tr", rows => rows.length)).toBe(1);
    await page.click('[aria-label="上移段落 17"]');
    expect(
      await page.evaluate(
        () => (globalThis as any).saved.project.segments[15].title
      )
    ).toBe("段落 17");
    await page.evaluate(() => (globalThis as any).restore());
    expect(
      await page.evaluate(
        () => (globalThis as any).saved.project.segments.length
      )
    ).toBe(17);
    await page.evaluate(() => (globalThis as any).seedOutput());
    await click("合成与输出");
    await page.select('[aria-label="段落 17成片版本"]', "gs://test-only/final");
    await page.waitForFunction(
      () => (globalThis as any).workshopInput.clips.length === 1
    );
    expect(
      await page.evaluate(() => (globalThis as any).workshopInput.clips[0].url)
    ).toBe("gs://test-only/final");
    expect(
      await page.evaluate(
        () => (globalThis as any).workshopInput.clips[0].label
      )
    ).toContain("16. 段落 17");
    expect(
      await page.evaluate(() => (globalThis as any).workshopOrder.length)
    ).toBe(1);
    await click("整片总览");
    await page.$eval('[aria-label="搜索段落"]', e => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(e, "");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.$eval('[aria-label="新章节名称"]', e => {
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!.call(e, "方法与演示");
      e.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("建立章节并新增段落");
    await page.waitForFunction(
      () => (globalThis as any).saved.project.segments.length === 18
    );
    expect(
      await page.evaluate(
        () => (globalThis as any).saved.project.segments[17].chapter
      )
    ).toBe("方法与演示");
    await click("整片总览");
    await click("方法与演示 · 1");
    expect(await page.$$eval("tbody tr", rows => rows.length)).toBe(1);
    await click("全部段落 · 18");
    if (process.env.DH_PROJECT_SCREENSHOT_DIR) {
      await mkdir(process.env.DH_PROJECT_SCREENSHOT_DIR, { recursive: true });
      await page.screenshot({
        path: path.join(
          process.env.DH_PROJECT_SCREENSHOT_DIR,
          "多段总览-本地实际界面.png"
        ),
        fullPage: true,
      });
      await page.setViewport({ width: 390, height: 844 });
      await page.screenshot({
        path: path.join(
          process.env.DH_PROJECT_SCREENSHOT_DIR,
          "多段总览-窄屏.png"
        ),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
  } finally {
    await browser.close();
  }
}, 60000);
