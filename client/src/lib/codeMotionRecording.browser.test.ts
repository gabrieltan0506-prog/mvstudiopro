import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";

let browser: Browser, bundle: string;
beforeAll(async () => {
  const output = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `
import React from 'react'; import {createRoot} from 'react-dom/client';
import VoiceInputButton from './client/src/components/VoiceInputButton';
const root=createRoot(document.getElementById('root'));
globalThis.recordFixture.unmount=()=>root.unmount();
root.render(<VoiceInputButton maxSeconds={globalThis.recordFixture.maxSeconds} onRecording={async file=>{
  globalThis.recordFixture.files.push({name:file.name,type:file.type,size:file.size,text:await file.text()});
}}/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  bundle = output.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});

async function pageFixture(
  options: {
    mime?: string;
    maxSeconds?: number;
    pendingPermission?: boolean;
    failStart?: boolean;
  } = {}
) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.setContent('<div id="root"></div>');
  await page.evaluate(config => {
    const f = ((globalThis as any).recordFixture = {
      ...config,
      maxSeconds: config.maxSeconds ?? 180,
      mime: config.mime || "audio/webm;codecs=opus",
      files: [] as unknown[],
      fetches: [] as unknown[][],
      stops: 0,
      started: 0,
      stopped: 0,
      alerts: [] as string[],
      releasePermission: undefined as (() => void) | undefined,
    });
    (globalThis as any).fetch = async (...args: unknown[]) => {
      f.fetches.push(args);
      throw Error("本夹具禁止转写或网络请求");
    };
    (globalThis as any).alert = (message: string) => {
      f.alerts.push(message);
    };
    const stream = {
      getTracks: () => [
        {
          stop: () => {
            f.stops++;
          },
        },
      ],
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          if (config.pendingPermission)
            return await new Promise(resolve => {
              f.releasePermission = () => resolve(stream);
            });
          return stream;
        },
      },
    });
    class Recorder {
      mimeType = f.mime;
      state = "inactive";
      onstop: (() => unknown) | null = null;
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      static isTypeSupported(type: string) {
        return f.mime.startsWith(type.split(";")[0]);
      }
      start() {
        if (config.failStart) throw Error("虚构录音设备启动失败");
        this.state = "recording";
        f.started++;
      }
      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        f.stopped++;
        this.ondataavailable?.({
          data: new Blob(["仅测试原声回调的虚构字节"], { type: this.mimeType }),
        });
        queueMicrotask(() => {
          void this.onstop?.();
        });
      }
    }
    (globalThis as any).MediaRecorder = Recorder;
  }, options);
  await page.addScriptTag({ content: bundle });
  await page.waitForSelector("button");
  return page;
}

for (const [mime, extension] of [
  ["audio/webm;codecs=opus", ".webm"],
  ["audio/mp4", ".m4a"],
]) {
  it(`保留真实 ${mime} 格式，手动停止释放麦克风且不转写`, async () => {
    const page = await pageFixture({ mime });
    try {
      await page.click("button");
      await page.waitForSelector('button[title="停止录音并保留原声"]');
      await page.click("button");
      await page.waitForFunction(
        () => (globalThis as any).recordFixture.files.length === 1
      );
      const f = await page.evaluate(() => (globalThis as any).recordFixture);
      expect(f.files[0].type).toBe(mime);
      expect(f.files[0].name.endsWith(extension)).toBe(true);
      expect(f.files[0].size).toBeGreaterThan(0);
      expect(f.stops).toBeGreaterThanOrEqual(1);
      expect(f.fetches).toEqual([]);
    } finally {
      await page.close();
    }
  });
}
it("达到时限自动停止，只保留一次原声并释放麦克风", async () => {
  const page = await pageFixture({ maxSeconds: 1 });
  try {
    await page.click("button");
    await page.waitForFunction(
      () => (globalThis as any).recordFixture.files.length === 1
    );
    const f = await page.evaluate(() => (globalThis as any).recordFixture);
    expect(f.started).toBe(1);
    expect(f.stopped).toBe(1);
    expect(f.stops).toBeGreaterThanOrEqual(1);
    expect(f.fetches).toEqual([]);
  } finally {
    await page.close();
  }
});
it("组件卸载会停止录音，停止事件不上传原声", async () => {
  const page = await pageFixture();
  try {
    await page.click("button");
    await page.waitForSelector('button[title="停止录音并保留原声"]');
    await page.evaluate(async () => {
      (globalThis as any).recordFixture.unmount();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const f = await page.evaluate(() => (globalThis as any).recordFixture);
    expect(f.stopped).toBe(1);
    expect(f.stops).toBeGreaterThanOrEqual(1);
    expect(f.files).toEqual([]);
    expect(f.fetches).toEqual([]);
  } finally {
    await page.close();
  }
});
it("卸载后麦克风授权才返回时立即释放，不启动录音或上传", async () => {
  const page = await pageFixture({ pendingPermission: true });
  try {
    await page.click("button");
    await page.waitForFunction(
      () =>
        typeof (globalThis as any).recordFixture.releasePermission ===
        "function"
    );
    await page.evaluate(async () => {
      const f = (globalThis as any).recordFixture;
      f.unmount();
      f.releasePermission();
      await new Promise(resolve => setTimeout(resolve, 0));
    });
    const f = await page.evaluate(() => (globalThis as any).recordFixture);
    expect(f.stops).toBeGreaterThanOrEqual(1);
    expect(f.started).toBe(0);
    expect(f.files).toEqual([]);
    expect(f.fetches).toEqual([]);
  } finally {
    await page.close();
  }
});
it("录音设备启动失败也释放已获取的麦克风", async () => {
  const page = await pageFixture({ failStart: true });
  try {
    await page.click("button");
    await page.waitForFunction(
      () => (globalThis as any).recordFixture.alerts.length > 0
    );
    const f = await page.evaluate(() => (globalThis as any).recordFixture);
    expect(f.stops).toBeGreaterThanOrEqual(1);
    expect(f.files).toEqual([]);
    expect(f.fetches).toEqual([]);
  } finally {
    await page.close();
  }
});
