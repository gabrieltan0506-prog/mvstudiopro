import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, {
  type Browser,
  type HTTPRequest,
  type Page,
} from "puppeteer";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

let browser: Browser, bundle: string, media: Buffer, directory: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "film-review-test-"));
  // 只用于验证浏览器媒体事件的六秒测试片，不作为作品或实片质量证据。
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=navy:s=160x90:r=10:d=6",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    path.join(directory, "test.mp4"),
  ]);
  media = await readFile(path.join(directory, "test.mp4"));
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';import {ManhuaAdvisorFilmReview} from './client/src/components/canvas/ManhuaAdvisorFilmReview';
    const report={kind:'film_review_v1',summary:'测试片音画记录',findings:[{atSec:3,endSec:4,category:'声音',observation:'音效出现',suggestion:'保留声音变化',confidence:'需人工核对'}],limitations:'仅测试',nativeEvidence:{sourceGeneration:'1',audioTokens:2,analysis:{shots:[{startSec:0,endSec:3,actionZh:'建立场景'},{startSec:3,endSec:6,actionZh:'举起灯',lightingZh:'暖光出现'}],audioResolution:[{chunkIndex:0,analysis:{audioTrack:[{fromSec:0,toSec:3,bgmZh:'低音铺底',cues:[]},{fromSec:3,toSec:6,bgmZh:'弦乐升起',cues:[{atSec:4,detailZh:'金属声'}]}]}}],keyMoments:[{atSec:3,kindZh:'灯光',noteZh:'暖光出现'}]}}};
    const f=window.fixture={edits:[]};function App(){const [target,set]=React.useState({blockId:'one',revision:'1',videoUri:'gs://test-only/one.mp4',label:'测试原片'});f.change=id=>set({blockId:id,revision:id,videoUri:'gs://test-only/'+id+'.mp4',label:id});return <ManhuaAdvisorFilmReview report={report} target={target} onEdit={text=>f.edits.push(text)}/>;}createRoot(document.getElementById('root')).render(<App/>);
  `,
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    jsx: "automatic",
    alias: {
      "@": path.resolve("client/src"),
      "@shared": path.resolve("shared"),
    },
    define: { "process.env.NODE_ENV": '"test"', "import.meta.env": "{}" },
    logLevel: "silent",
  });
  bundle = result.outputFiles[0].text;
  browser = await puppeteer.launch({
    headless: true,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      ...(process.getuid?.() === 0 ? ["--no-sandbox"] : []),
    ],
  });
}, 30_000);
afterAll(async () => {
  await browser?.close();
  if (directory) await rm(directory, { recursive: true, force: true });
});

async function fixture(resolve: (request: HTTPRequest) => void) {
  const page = await browser.newPage(),
    errors: string[] = [],
    requests: string[] = [];
  page.setDefaultTimeout(5000);
  page.on("pageerror", error => errors.push(String(error)));
  await page.setRequestInterception(true);
  page.on("request", request => {
    requests.push(`${request.method()} ${request.url()}`);
    if (request.url().includes("op=materialReadUrl")) {
      resolve(request);
      return;
    }
    if (request.url().startsWith("https://media.test/")) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers().range || "");
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : media.length - 1;
      void request.respond({
        status: match ? 206 : 200,
        contentType: "video/mp4",
        headers: {
          "Accept-Ranges": "bytes",
          ...(match
            ? { "Content-Range": `bytes ${start}-${end}/${media.length}` }
            : {}),
        },
        body: media.subarray(start, end + 1),
      });
      return;
    }
    void request.respond({
      status: 200,
      contentType: "text/html",
      body: '<div id="root"></div>',
    });
  });
  await page.goto("http://localhost/");
  await page.addScriptTag({ content: bundle });
  return { page, errors, requests };
}
const sign = (request: HTTPRequest, name = "one") =>
  request.respond({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ ok: true, url: `https://media.test/${name}.mp4` }),
  });
async function click(page: Page, label: string) {
  await page.$$eval(
    "button",
    (nodes, text) => {
      const button = nodes.find(n => n.textContent?.includes(text));
      if (!button) throw Error(`找不到按钮：${text}`);
      (button as HTMLButtonElement).click();
    },
    label
  );
}

it("真实播放器跳转、声音对应、播放同步和原建议入口闭合", async () => {
  const { page, errors, requests } = await fixture(r => {
    void sign(r);
  });
  try {
    await page.waitForFunction(
      () => document.querySelector("video")?.readyState! >= 1
    );
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(
        n => n.textContent?.includes("3.0–4.0秒") && !n.disabled
      )
    );
    await click(page, "镜头 2");
    await page.waitForFunction(
      () => Math.abs(document.querySelector("video")!.currentTime - 3) < 0.1
    );
    expect(
      await page.$eval('[aria-label="当前镜头声音"]', n => n.textContent)
    ).toContain("弦乐升起");
    expect(
      await page.$eval('[aria-label="当前镜头画面"]', n => n.textContent)
    ).toContain("暖光出现");
    await page.evaluate(async () => {
      const v = document.querySelector("video")!;
      v.currentTime = 2.8;
      await v.play();
    });
    await page.waitForFunction(
      () => document.querySelector("video")!.currentTime > 3.1
    );
    await page.evaluate(() => document.querySelector("video")!.pause());
    expect(
      await page.$eval('[aria-label="当前镜头画面"]', n => n.textContent)
    ).toContain("镜头 2");
    await page.$$eval("summary", nodes =>
      (
        nodes.find(n => n.textContent?.includes("全部声音")) as HTMLElement
      ).click()
    );
    await click(page, "4.0秒 · 声音变化");
    await page.waitForFunction(
      () => Math.abs(document.querySelector("video")!.currentTime - 4) < 0.1
    );
    await click(page, "让顾问准备视频修改方案");
    expect(await page.evaluate(() => (window as any).fixture.edits)).toEqual([
      "只修改3.0–4.0秒，其余保持原样。保留声音变化",
    ]);
    expect(requests.some(r => r.startsWith("POST"))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30_000);

it("切换素材后旧签名回包不能覆盖新影片；播放失败可只重取原片", async () => {
  let first: HTTPRequest | undefined,
    signCount = 0;
  const { page, errors, requests } = await fixture(r => {
    signCount++;
    if (!first) first = r;
    else void sign(r, "two");
  });
  try {
    await page.waitForSelector('[role="status"]');
    await expect.poll(() => first).toBeDefined();
    await page.waitForFunction(() => (window as any).fixture?.change);
    await page.evaluate(() => (window as any).fixture.change("two"));
    await page.waitForFunction(
      () =>
        document.querySelector("video")?.src.includes("two.mp4") &&
        document.querySelector("video")!.readyState >= 1
    );
    await sign(first!, "old");
    await page.evaluate(
      () =>
        new Promise(resolve =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    );
    expect(
      await page.$eval("video", n => (n as HTMLVideoElement).src)
    ).toContain("two.mp4");
    await page.$eval("video", n => n.dispatchEvent(new Event("error")));
    await page.waitForSelector('[role="alert"]');
    await click(page, "重新读取原片");
    await page.waitForFunction(
      () =>
        !document.querySelector('[role="alert"]') &&
        document.querySelector("video")?.readyState! >= 1
    );
    expect(signCount).toBe(3);
    expect(requests.filter(r => r.includes("op=materialReadUrl"))).toHaveLength(
      3
    );
    expect(requests.some(r => r.startsWith("POST"))).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
  }
}, 30_000);
