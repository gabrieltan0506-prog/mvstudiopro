import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser, type Page } from "puppeteer";
import {
  artMotionSpecSchema,
  type ArtMotionSpec,
} from "../../../shared/artMotion";

let browser: Browser, bundle: string;
const sourceId = "22222222-2222-4222-8222-222222222222";
beforeAll(async () => {
  const output = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import Preview from './client/src/components/code-motion/CodeMotionPreview';
const root=createRoot(document.getElementById('root'));
globalThis.audioFixture.unmount=()=>root.unmount();
root.render(<Preview spec={globalThis.audioFixture.spec} audioSources={[{id:'${sourceId}',url:'/fixture-original-audio'}]}/>);`,
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

function spec(clip: { at: number; trimStart: number; duration: number }) {
  return artMotionSpecSchema.parse({
    version: 1,
    mode: "animation",
    grammar: "y5_kinetic_type",
    duration: 15,
    width: 1280,
    height: 720,
    fps: 30,
    cues: [{ at: 0, kind: "title", text: "只验证播放控制，不渲染媒体" }],
    codeAudio: {
      sources: [
        {
          id: sourceId,
          name: "虚构原音.wav",
          gcsUri: "gs://fixture/never-read.wav",
          duration: 20,
          mimeType: "audio/wav",
          sha256: "a".repeat(64),
          bytes: 12,
        },
      ],
      audioTimeline: [{ sourceId, role: "narration", ...clip }],
    },
  });
}

async function pageFixture(input: ArtMotionSpec, decodedDuration = 20) {
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  await page.setRequestInterception(true);
  page.on("request", request => {
    const path = new URL(request.url()).pathname;
    if (path === "/")
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    else if (path === "/art-motion/engine/studio.html")
      void request.respond({
        status: 200,
        contentType: "text/html",
        body: `<script>
addEventListener('message',e=>{parent.audioFixture.messages.push(e.data);
if(e.data.type==='art-motion-init')parent.postMessage({type:'art-motion-ready'},location.origin)});
parent.postMessage({type:'art-motion-awaiting'},location.origin);
</script>`,
      });
    else void request.abort();
  });
  await page.goto("http://localhost:41883/");
  await page.evaluate(
    ({ input, decodedDuration }) => {
      const f = ((globalThis as any).audioFixture = {
        spec: input,
        decodedDuration,
        currentTime: 100,
        starts: [] as number[][],
        stops: 0,
        disconnects: 0,
        closes: 0,
        fetches: [] as string[],
        messages: [] as { type: string; time?: number }[],
        frames: new Map<number, FrameRequestCallback>(),
        nextFrame: 0,
      });
      // rAF时间戳故意远离音频时钟，不能被实现当作原声进度。
      globalThis.requestAnimationFrame = callback => {
        const id = ++f.nextFrame;
        f.frames.set(id, callback);
        return id;
      };
      globalThis.cancelAnimationFrame = id => {
        f.frames.delete(id);
      };
      (globalThis as any).fetch = async (url: string) => {
        f.fetches.push(url);
        if (url !== "/fixture-original-audio")
          throw Error("本夹具禁止真实网络");
        return { ok: true, arrayBuffer: async () => new ArrayBuffer(12) };
      };
      class ControlledAudioContext {
        get currentTime() {
          return f.currentTime;
        }
        destination = {};
        async resume() {}
        async close() {
          f.closes++;
        }
        async decodeAudioData() {
          return { duration: f.decodedDuration, sampleRate: 48_000 };
        }
        createBufferSource() {
          return {
            buffer: null,
            connect() {},
            start: (...args: number[]) => {
              f.starts.push(args);
            },
            stop: () => {
              f.stops++;
            },
            disconnect: () => {
              f.disconnects++;
            },
          };
        }
        createGain() {
          return {
            connect() {},
            gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
          };
        }
      }
      (globalThis as any).AudioContext = ControlledAudioContext;
    },
    { input, decodedDuration }
  );
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(
    () => {
      const button = document.querySelector("button");
      return button && !button.disabled;
    },
    { polling: 20 }
  );
  return page;
}

async function seek(page: Page, time: number) {
  await page.$eval(
    'input[type="range"]',
    (element, value) => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      )!.set!;
      setter.call(element, String(value));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
    },
    time
  );
  await page.waitForFunction(
    value =>
      document.body.innerText.includes(`${Number(value).toFixed(1)} / 15 秒`),
    { polling: 20 },
    time
  );
}
async function play(page: Page) {
  await page.click("button");
  await page.waitForFunction(
    () =>
      (globalThis as any).audioFixture.frames.size > 0 ||
      !!document.querySelector('[role="alert"]'),
    { polling: 20 }
  );
}
async function tick(page: Page, currentTime: number) {
  await page.evaluate(async time => {
    const f = (globalThis as any).audioFixture;
    f.currentTime = time;
    const callbacks = Array.from(f.frames.values()) as FrameRequestCallback[];
    f.frames.clear();
    callbacks.forEach(callback => callback(900_000));
    await new Promise(resolve => setTimeout(resolve, 0));
  }, currentTime);
}
async function state(page: Page) {
  return page.evaluate(() => {
    const f = (globalThis as any).audioFixture;
    return {
      starts: f.starts,
      stops: f.stops,
      messages: f.messages,
      fetches: f.fetches,
      button: document.querySelector("button .sr-only")?.textContent,
      alert: document.querySelector('[role="alert"]')?.textContent || "",
    };
  });
}

it("真实预览使用AudioContext时钟驱动画面，不依赖rAF时间戳", async () => {
  const page = await pageFixture(spec({ at: 0, trimStart: 2, duration: 15 }));
  try {
    await play(page);
    await tick(page, 100.25);
    const f = await state(page);
    expect(f.starts).toEqual([[100, 2, 15]]);
    expect(
      f.messages
        .filter((m: { type: string }) => m.type === "art-motion-seek")
        .at(-1).time
    ).toBeCloseTo(0.25, 8);
    expect(f.button).toContain("暂停预览");
    expect(f.stops).toBe(0);
    expect(f.fetches).toEqual(["/fixture-original-audio"]);
  } finally {
    await page.close();
  }
});
it("最后0.5秒原声不在最后画面帧提前停止，完整片长才收尾", async () => {
  const page = await pageFixture(
    spec({ at: 14.5, trimStart: 2, duration: 0.5 })
  );
  try {
    await seek(page, 14.5);
    await play(page);
    expect((await state(page)).starts).toEqual([[100, 2, 0.5]]);
    await tick(page, 100.49);
    const before = await state(page);
    expect(before.stops).toBe(0);
    expect(before.button).toContain("暂停预览");
    expect(
      before.messages
        .filter((m: { type: string }) => m.type === "art-motion-seek")
        .at(-1).time
    ).toBeCloseTo(15 - 1 / 30, 8);
    await tick(page, 100.5);
    await page.waitForFunction(
      () => document.querySelector("button")?.textContent?.includes("播放预览"),
      { polling: 20 }
    );
    expect((await state(page)).stops).toBe(1);
  } finally {
    await page.close();
  }
});
it("跳转后以原音trimStart加已过时长播放，只保留片段剩余秒数", async () => {
  const page = await pageFixture(spec({ at: 2, trimStart: 3, duration: 10 }));
  try {
    await seek(page, 5);
    await play(page);
    expect((await state(page)).starts).toEqual([[100, 6, 7]]);
    await tick(page, 100.25);
    const f = await state(page);
    expect(
      f.messages
        .filter((m: { type: string }) => m.type === "art-motion-seek")
        .at(-1).time
    ).toBeCloseTo(5.25, 8);
  } finally {
    await page.close();
  }
});
for (const decodedDuration of [2.3, 2.48]) {
  it(`解码原音仅${decodedDuration}秒不足2.5秒所选秒窗时明确失败`, async () => {
    const page = await pageFixture(
      spec({ at: 14.5, trimStart: 2, duration: 0.5 }),
      decodedDuration
    );
    try {
      await seek(page, 14.5);
      await play(page);
      const f = await state(page);
      expect(f.alert).toContain("解码后不足所选秒窗");
      expect(f.starts).toEqual([]);
      expect(f.button).toContain("播放预览");
    } finally {
      await page.close();
    }
  });
}
