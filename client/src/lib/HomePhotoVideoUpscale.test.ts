import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: vi.fn() }));
vi.mock("@/lib/trpc", () => ({ trpc: {} }));
vi.mock("@/lib/canvasUpload", () => ({
  inferCanvasAssetKind: vi.fn(),
  uploadOneCanvasAsset: vi.fn(),
}));
vi.mock("@/lib/videoUpscaleApi", () => ({
  fetchVideoUpscaleStatus: vi.fn(),
  startVideoUpscale: vi.fn(),
  VideoUpscaleSubmitError: class extends Error {},
}));

import {
  blocksUpscaleSubmit,
  metadataForUpscale,
  probeUpscaleMetadata,
  restoreUpscaleRecords,
  type UpscaleRecord,
} from "../components/HomePhotoVideoUpscale";
import { canvasVideoUpscaleCredits } from "@shared/canvasGenerationPricing";
import { canWavespeedUpscale } from "@shared/wavespeedVideoUpscaleModels";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("照片视频超分元数据与恢复边界", () => {
  it("真实生日视频 1112×834 / 10.08s 不冒充720p，费用与服务端round对齐", () => {
    const m = metadataForUpscale(1112, 834, 10.08);
    expect(m).toEqual({
      width: 1112,
      height: 834,
      durationSec: 10,
      sourceResolution: "1080p",
    });
    expect(
      canvasVideoUpscaleCredits("2k", m.durationSec, { freeform: true })
    ).toBe(
      canvasVideoUpscaleCredits("2k", Math.round(10.08), { freeform: true })
    );
    expect(metadataForUpscale(834, 1112, 10.51).durationSec).toBe(11);
  });
  it.each([0, -1, NaN, Infinity, 601])("拒绝无效或超上限时长 %s", duration => {
    expect(() => metadataForUpscale(1280, 720, duration)).toThrow();
  });
  it("2K/4K原片不降报，保守遵守当前服务端档位限制", () => {
    const m = metadataForUpscale(2560, 1440, 15);
    expect(m.sourceResolution).toBe("2k");
    expect(canWavespeedUpscale(m.sourceResolution, "2k")).toBe(false);
    expect(
      canWavespeedUpscale(
        metadataForUpscale(2160, 3840, 15).sourceResolution,
        "4k"
      )
    ).toBe(false);
  });
  it("提交中刷新恢复为回执未知，不允许再次付费；对账态保留同ID", () => {
    const rows = restoreUpscaleRecords(
      JSON.stringify([
        {
          id: "a",
          sourceUrl: "https://example.com/source.mp4",
          target: "2k",
          status: "submitting",
        },
        {
          id: "b",
          sourceUrl: "https://example.com/source.mp4",
          target: "4k",
          status: "timed_out_pending_reconcile",
          taskId: "same-task",
        },
      ])
    );
    expect(rows[0].status).toBe("submission_unknown");
    expect(rows[1].taskId).toBe("same-task");
    expect(blocksUpscaleSubmit(rows, rows[0].sourceUrl, "2k")).toBe(true);
    expect(blocksUpscaleSubmit(rows, rows[0].sourceUrl, "4k")).toBe(true);
    expect(
      blocksUpscaleSubmit(rows, "https://example.com/another.mp4", "2k")
    ).toBe(false);
  });
  it("分别恢复原片和两档结果，拒绝损坏记录与非HTTP视频地址", () => {
    const rows: UpscaleRecord[] = ["2k", "4k"].map(target => ({
      id: target,
      target: target as "2k" | "4k",
      sourceUrl: "https://example.com/original.mp4",
      videoUrl: `https://example.com/${target}.mp4`,
      status: "succeeded",
    }));
    expect(restoreUpscaleRecords(JSON.stringify(rows))).toEqual(rows);
    expect(restoreUpscaleRecords("broken")).toEqual([]);
    expect(
      restoreUpscaleRecords(
        JSON.stringify([{ ...rows[0], sourceUrl: "javascript:alert(1)" }])
      )
    ).toEqual([]);
  });
  it("实际读取video元数据并释放元素；超时明确失败", async () => {
    vi.useFakeTimers();
    const video = {
      width: 0,
      videoWidth: 1920,
      videoHeight: 1080,
      duration: 9.7,
      onloadedmetadata: null as null | (() => void),
      onerror: null,
      removeAttribute: vi.fn(),
      load: vi.fn(),
      src: "",
      preload: "",
    };
    vi.stubGlobal("document", { createElement: vi.fn(() => video) });
    const success = probeUpscaleMetadata("https://example.com/video.mp4");
    video.onloadedmetadata?.();
    await expect(success).resolves.toMatchObject({
      width: 1920,
      height: 1080,
      durationSec: 10,
    });
    expect(video.removeAttribute).toHaveBeenCalledWith("src");
    const timeout = probeUpscaleMetadata("https://example.com/video.mp4");
    const rejected = expect(timeout).rejects.toThrow("超时");
    await vi.advanceTimersByTimeAsync(15000);
    await rejected;
  });
});

it("浏览器挂载：确认后单次提交、刷新只查原ID、用户隔离、双档保留", async () => {
  const { build } = await import("esbuild");
  const { default: puppeteer } = await import("puppeteer");
  const path = await import("node:path");
  const mocks: Record<string, string> = {
    "@/_core/hooks/useAuth":
      "export const useAuth=()=>({user:{id:globalThis.fixture.user},isAuthenticated:true});",
    "@/lib/trpc":
      "export const trpc={mvAnalysis:{getVideoUploadSignedUrl:{useMutation:()=>({mutateAsync:async()=>({})})}}};",
    "@/lib/photoTemporaryMedia":
      "export const uploadPhotoTemporaryMedia=async()=>({url:'https://test.invalid/upload.mp4'});export const cachePhotoTemporaryMedia=async url=>url;",
    "@/lib/canvasUpload":
      "export const inferCanvasAssetKind=()=> 'video'; export const uploadOneCanvasAsset=async()=>({url:'https://test.invalid/upload.mp4'});",
    "@/lib/videoUpscaleApi": `export class VideoUpscaleSubmitError extends Error {constructor(message){super(message);this.definitelyNotStarted=true;}};export const startVideoUpscale=async input=>{fixture.posts.push(input);if(fixture.denied)throw new VideoUpscaleSubmitError("积分不足");if(fixture.fail)throw new Error('离线断线');return {taskId:'task-'+input.target,status:'running',creditsUsed:1}};
    export const fetchVideoUpscaleStatus=async id=>{fixture.queries.push(id);return {taskId:id,status:fixture.status,...(fixture.status==='succeeded'?{videoUrl:'https://test.invalid/'+id+'.mp4'}:{})}};`,
  };
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
      import React from 'react'; import {createRoot} from 'react-dom/client';
      import Component from './client/src/components/HomePhotoVideoUpscale';
      window.fixture={user:7,posts:[],queries:[],status:'running'};
      window.fetch=async()=>({ok:true,json:async()=>({id:fixture.user})});
      window.confirm=()=>true;
      const orig=document.createElement.bind(document);
      document.createElement=(tag,...rest)=>{const el=orig(tag,...rest);if(tag==='video'){
        Object.defineProperties(el,{videoWidth:{value:1112},videoHeight:{value:834},duration:{value:10.08},src:{set(){queueMicrotask(()=>el.onloadedmetadata?.());}}});el.load=()=>{};
      }return el;};
      const root=createRoot(document.getElementById('root')); let version=0;
      fixture.render=()=>root.render(<Component key={++version} generatedVideoUrl='https://test.invalid/generated.mp4'/>);
      fixture.render();`,
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
    define: { "process.env.NODE_ENV": '"test"' },
    plugins: [
      {
        name: "离线服务",
        setup(b) {
          b.onResolve({ filter: /^@\// }, args =>
            mocks[args.path]
              ? { path: args.path, namespace: "mock" }
              : undefined
          );
          b.onLoad({ filter: /.*/, namespace: "mock" }, args => ({
            contents: mocks[args.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", req => {
      if (req.isNavigationRequest())
        void req.respond({
          status: 200,
          contentType: "text/html",
          body: '<div id="root"></div>',
        });
      else void req.abort();
    });
    await page.goto("http://localhost:41812");
    await page.addScriptTag({ content: result.outputFiles[0].text });
    await page.waitForSelector('select[aria-label="视频来源"]');
    await page.select('select[aria-label="视频来源"]', "generated");
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("button")).some(b => !b.disabled)
    );
    await page.evaluate(() =>
      (document.querySelector("button") as HTMLButtonElement).click()
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("task-2k")
    );
    const post = await page.evaluate(() => (window as any).fixture.posts);
    expect(post).toEqual([
      {
        videoUrl: "https://test.invalid/generated.mp4",
        target: "2k",
        durationSec: 10,
        sourceResolution: "1080p",
      },
    ]);
    await page.evaluate(() => {
      (window as any).fixture.status = "timed_out_pending_reconcile";
      (window as any).fixture.render();
    });
    await page.waitForFunction(() =>
      document.body.innerText.includes("超时对账中")
    );
    expect(
      await page.evaluate(() => (window as any).fixture.posts.length)
    ).toBe(1);
    await page.evaluate(() => {
      (window as any).fixture.status = "succeeded";
      (window as any).fixture.render();
    });
    await page.waitForFunction(() =>
      document.body.innerText.includes("下载 2K 成片")
    );
    await page.select('select[aria-label="视频来源"]', "generated");
    await page.waitForFunction(
      () =>
        !!document.querySelectorAll("button")[1] &&
        !(document.querySelectorAll("button")[1] as HTMLButtonElement).disabled
    );
    await page.evaluate(() =>
      (document.querySelectorAll("button")[1] as HTMLButtonElement).click()
    );
    await page.waitForFunction(() =>
      document.body.innerText.includes("task-4k")
    );
    await page.evaluate(() => (window as any).fixture.render());
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("下载 4K 成片") &&
        document.body.innerText.includes("下载 2K 成片")
    );
    await page.evaluate(() => {
      (window as any).fixture.user = 8;
      (window as any).fixture.render();
    });
    await page.waitForFunction(
      () =>
        !!document.querySelector("select") &&
        !document.body.innerText.includes("task-2k")
    );
    expect(
      await page.evaluate(() =>
        localStorage.getItem("home-photo-video-upscale:v1:8")
      )
    ).toBeNull();
    expect(
      await page.evaluate(() => (window as any).fixture.posts.length)
    ).toBe(2);
    await page.select('select[aria-label="视频来源"]', "generated");
    await page.waitForFunction(
      () => !(document.querySelector("button") as HTMLButtonElement).disabled
    );
    await page.evaluate(() => {
      (window as any).fixture.denied = true;
      (document.querySelector("button") as HTMLButtonElement).click();
    });
    await page.waitForFunction(
      () =>
        document.body.innerText.includes("积分不足") &&
        !(document.querySelector("button") as HTMLButtonElement).disabled
    );
    await page.evaluate(() => {
      (window as any).fixture.denied = false;
      (window as any).fixture.render();
    });
    await page.waitForSelector('select[aria-label="视频来源"]');
    await page.select('select[aria-label="视频来源"]', "generated");
    await page.waitForFunction(
      () => !(document.querySelector("button") as HTMLButtonElement).disabled
    );
    await page.evaluate(() => {
      (window as any).fixture.fail = true;
      (document.querySelector("button") as HTMLButtonElement).click();
    });
    await page.waitForFunction(() =>
      document.body.innerText.includes("提交回执未确认")
    );
    await page.evaluate(() => (window as any).fixture.render());
    await page.waitForFunction(() =>
      document.body.innerText.includes("提交回执未确认")
    );
    await page.select('select[aria-label="视频来源"]', "generated");
    expect(
      await page.evaluate(
        () => (document.querySelector("button") as HTMLButtonElement).disabled
      )
    ).toBe(true);
    expect(
      await page.evaluate(() => (window as any).fixture.posts.length)
    ).toBe(4);
  } finally {
    await browser.close();
  }
}, 30000);
