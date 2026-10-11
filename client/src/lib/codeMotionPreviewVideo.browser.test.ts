import { codeMotionCompositionSchema } from "../../../shared/codeMotionComposition";
import { afterAll, beforeAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
let browser: Browser, bundle: string, bytes: Buffer;
beforeAll(async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "ink-preview-video-"));
  const file = path.join(dir, "clip.mp4");
  execFileSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc2=size=160x90:rate=24:duration=4",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    file,
  ]);
  bytes = await readFile(file);
  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Preview from './client/src/components/code-motion/CodeMotionPreview';createRoot(document.getElementById('root')).render(<Preview spec={globalThis.testSpec} videoSources={[{id:'clip',url:'/clip.mp4'}]}/>);`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
});
afterAll(async () => {
  await browser?.close();
});
it("actual HTML video follows timeline seek/play, stays muted, and ends at the exclusive clip boundary", async () => {
  const page = await browser.newPage();
  page.setDefaultTimeout(15000);
  await page.setRequestInterception(true);
  page.on("request", async r => {
    const pathname = new URL(r.url()).pathname;
    if (pathname === "/")
      void r.respond({
        status: 200,
        contentType: "text/html",
        body: '<div id="root"></div>',
      });
    else if (pathname === "/art-motion/engine/studio.html")
      void r.respond({
        status: 200,
        contentType: "text/html",
        body: await readFile(
          path.resolve("client/public/art-motion/engine/studio.html")
        ),
      });
    else if (pathname === "/clip.mp4") {
      const match = r.headers().range?.match(/bytes=(\d+)-(\d*)/);
      const start = match ? Number(match[1]) : 0;
      const end = match?.[2] ? Number(match[2]) : bytes.length - 1;
      void r.respond({
        status: match ? 206 : 200,
        contentType: "video/mp4",
        headers: {
          "Accept-Ranges": "bytes",
          "Content-Length": String(end - start + 1),
          ...(match
            ? { "Content-Range": `bytes ${start}-${end}/${bytes.length}` }
            : {}),
        },
        body: bytes.subarray(start, end + 1),
      });
    } else if (pathname.startsWith("/art-motion/engine/")) {
      const file = path.resolve("client/public", pathname.slice(1));
      try {
        void r.respond({
          status: 200,
          contentType: file.endsWith(".js")
            ? "application/javascript"
            : file.endsWith(".woff2")
              ? "font/woff2"
              : "application/octet-stream",
          body: await readFile(file),
        });
      } catch {
        void r.abort();
      }
    } else void r.abort();
  });
  try {
    await page.goto("http://localhost:41884/");
    await page.evaluate(
      composition => {
        (globalThis as any).testSpec = {
          version: 1,
          mode: "animation",
          grammar: "y5_kinetic_type",
          width: 1280,
          height: 720,
          fps: 24,
          duration: 6,
          cues: [],
          background: "#112233",
          composition,
          codeVideo: {
            version: 1,
            assets: [
              {
                id: "clip",
                videoUri: "gs://fixture/clip.mp4",
                sha256: "a".repeat(64),
                durationSec: 4,
              },
            ],
            clips: [
              {
                assetId: "clip",
                at: 1,
                duration: 4,
                sourceStartSec: 0,
                fit: "cover",
              },
            ],
          },
        };
      },
      codeMotionCompositionSchema.parse({
        version: 1,
        scenes: [
          {
            id: "scene",
            duration: 6,
            elements: [
              { id: "base", type: "shape", shape: "rect", width: 1, height: 1 },
              {
                id: "timing-word-test",
                type: "text",
                text: "JUMP",
                start: 2.13,
                end: 2.73,
                transform: { x: 0.5, y: 0.84, fill: "#ffffff" },
                fontSize: 0.075,
                layer: 95,
              },
            ],
          },
        ],
      })
    );
    await page.addScriptTag({ content: bundle });
    await page.waitForFunction(
      () => !(document.querySelector("button") as HTMLButtonElement)?.disabled
    );
    const seek = async (time: number) =>
      page.$eval(
        'input[type="range"]',
        (element, value) => {
          Object.getOwnPropertyDescriptor(
            HTMLInputElement.prototype,
            "value"
          )!.set!.call(element, String(value));
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        },
        time
      );
    await seek(2.5);
    await page.waitForFunction(() => {
      const v = document.querySelector("video");
      return v && v.readyState >= 2 && Math.abs(v.currentTime - 1.5) < 0.06;
    });
    expect(
      await page.$eval("video", v => ({
        muted: v.muted,
        paused: v.paused,
        duration: v.duration,
      }))
    ).toEqual({ muted: true, paused: true, duration: 4 });
    const iframe = page.frames().find(f => f.url().includes("studio.html"))!;
    const pixels = await iframe.evaluate(() => {
      const c = (window as any).__canvas as HTMLCanvasElement;
      const ctx = c.getContext("2d")!;
      const bytes = ctx.getImageData(0, 0, c.width, c.height).data;
      let opaque = 0;
      for (let i = 3; i < bytes.length; i += 4) if (bytes[i] > 200) opaque++;
      return {
        cornerAlpha: bytes[3],
        opaque,
        htmlBackground: document.documentElement.style.background,
      };
    });
    expect(pixels.cornerAlpha).toBe(0);
    expect(pixels.opaque).toBeGreaterThan(300);
    expect(pixels.htmlBackground).toBe("transparent");
    expect(
      await page.$eval("iframe", frame => getComputedStyle(frame).zIndex)
    ).toBe("2");
    await page.screenshot({
      path: "docs/evidence/ink-1011-video-consumer/preview-video-word.png",
    });
    await page.click("button");
    await page.waitForFunction(
      () => (document.querySelector("video")?.currentTime || 0) > 1.65
    );
    await seek(5);
    await page.waitForFunction(() => !document.querySelector("video"));
    expect(await page.$('[role="alert"]')).toBeNull();
  } catch (error) {
    console.log(
      "preview failure state",
      await page.evaluate(() => ({
        text: document.body.innerText,
        slider: (document.querySelector("input") as HTMLInputElement)?.value,
        video: document.querySelector("video") && {
          readyState: document.querySelector("video")!.readyState,
          time: document.querySelector("video")!.currentTime,
          error: document.querySelector("video")!.error?.message,
        },
      }))
    );
    throw error;
  } finally {
    await page.close();
  }
}, 45000);
