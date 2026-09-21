import { beforeAll, afterAll, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { compile } from "tailwindcss";
import { PREVIS_ACTION_PREVIEW_SAMPLES as samples } from "../components/canvas/ManhuaPrevisActionPreview.samples";
import { PREVIS_ACTION_LABELS } from "@shared/manhuaPrevis";
let browser: Browser;
let bundle: string;
let css: string;
beforeAll(async () => {
  const require = createRequire(import.meta.url);
  const tailwind = path.dirname(require.resolve("tailwindcss/package.json"));
  const source = (
    await Promise.all(
      ["ManhuaPrevisActionLibrary", "ManhuaPrevisActionPreview"].map(name =>
        readFile(`client/src/components/canvas/${name}.tsx`, "utf8")
      )
    )
  ).join("\n");
  const compiler = await compile(
    (await readFile(path.join(tailwind, "theme.css"), "utf8")) +
      "\n" +
      (await readFile(path.join(tailwind, "preflight.css"), "utf8")) +
      "\n@tailwind utilities;"
  );
  css = compiler.build(
    Array.from(source.matchAll(/className="([^"]+)"/g)).flatMap(m => m[1].split(" "))
  );

  const result = await build({
    stdin: {
      resolveDir: process.cwd(),
      loader: "tsx",
      contents: `import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{ManhuaPrevisActionLibrary}from'./client/src/components/canvas/ManhuaPrevisActionLibrary';import{createManhuaPrevisStudio}from'./shared/manhuaPrevis';const f=window.fixture={calls:0,reject:false};function App(){const[spec,setSpec]=useState(createManhuaPrevisStudio(10,'11111111-1111-4111-8111-111111111111').spec);f.spec=spec;return <ManhuaPrevisActionLibrary spec={spec} disabled={false} onChange={next=>{f.calls++;if(f.reject)return false;setSpec(next);return true}}/>}createRoot(document.getElementById('root')).render(<App/>);`,
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
    define: { "process.env.NODE_ENV": '"development"' },
  });
  bundle = result.outputFiles[0].text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
});
it.each(["idle", "guard", "strike", "bow", "cough"] as const)(
  "真实动作库 %s 播放暂停、48帧投影与添加保存拒绝契约",
  async kind => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(String(e)));
    await page.setRequestInterception(true);
    page.on("request", r => void r.abort());
    await page.setViewport({ width: 1280, height: 900 });
    await page.setContent(
      '<html><body style="background:#111827;color:white"><div id="root" style="max-width:640px"></div></body></html>'
    );
    await page.addStyleTag({ content: css });
    await page.addScriptTag({ content: bundle });
    await page.waitForSelector("[data-previs-action-preview]");
    const click = async (label: string) =>
      page.evaluate(label => {
        const b = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === label
        );
        if (!b) throw Error(label);
        b.click();
      }, label);
    await click("播放动作预览");
    await page.waitForFunction(
      () =>
        Number(
          document
            .querySelector("[data-previs-action-preview]")
            ?.getAttribute("data-frame")
        ) >= 5
    );
    await click("暂停动作预览");
    const stopped = await page.$eval("[data-previs-action-preview]", e =>
      e.getAttribute("data-frame")
    );
    await new Promise(r => setTimeout(r, 150));
    expect(
      await page.$eval("[data-previs-action-preview]", e =>
        e.getAttribute("data-frame")
      )
    ).toBe(stopped);
    expect(await page.evaluate(() => (window as any).fixture.calls)).toBe(0);
    const out = process.env.PREVIS_PREVIEW_EVIDENCE_DIR;
    {
      await click(PREVIS_ACTION_LABELS[kind]);
      await page.waitForFunction(
        k =>
          document
            .querySelector("[data-previs-action-preview]")
            ?.getAttribute("data-kind") === k,
        {},
        kind
      );
      if (out) await mkdir(path.join(out, kind), { recursive: true });
      for (let frame = 0; frame < 48; frame++) {
        await page.$eval(
          "input[type=range]",
          (input, frame) => {
            Object.getOwnPropertyDescriptor(
              HTMLInputElement.prototype,
              "value"
            )!.set!.call(input, String(frame));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          },
          frame
        );
        await page.waitForFunction(
          f =>
            Number(
              document
                .querySelector("[data-previs-action-preview]")
                ?.getAttribute("data-frame")
            ) === f,
          {},
          frame
        );
        const points = await page.$$eval("line[data-bone]", lines =>
          lines.map(l =>
            ["x1", "y1", "x2", "y2"].map(k => Number(l.getAttribute(k)))
          )
        );
        expect(points).toEqual(samples.clips[kind].frames[frame]);
        if (out) {
          const png = await page.$eval("svg", async svg => {
            const copy = svg.cloneNode(true) as SVGElement;
            copy.setAttribute("width", "320");
            copy.setAttribute("height", "180");
            const url = URL.createObjectURL(
              new Blob([new XMLSerializer().serializeToString(copy)], {
                type: "image/svg+xml",
              })
            );
            const img = new Image();
            img.src = url;
            await img.decode();
            const canvas = document.createElement("canvas");
            canvas.width = 320;
            canvas.height = 180;
            canvas.getContext("2d")!.drawImage(img, 0, 0, 320, 180);
            URL.revokeObjectURL(url);
            return canvas.toDataURL("image/png").split(",")[1];
          });
          await writeFile(
            path.join(out, kind, `${String(frame).padStart(3, "0")}.png`),
            Buffer.from(png, "base64")
          );
        }
      }
    }
    if (out && kind === "bow") {
      await page.screenshot({
        path: path.join(out, "desktop-1280.png"),
        fullPage: true,
      });
      await page.setViewport({ width: 390, height: 900 });
      await page.screenshot({
        path: path.join(out, "narrow-390.png"),
        fullPage: true,
      });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= 390)
      ).toBe(true);
    }
    await page.evaluate(() => ((window as any).fixture.reject = true));
    await click("添加所选动作");
    await page.waitForFunction(() =>
      document.querySelector("[role=status]")?.textContent?.includes("未保存")
    );
    expect(
      await page.evaluate(
        () => (window as any).fixture.spec.actors[0].actions.length
      )
    ).toBe(0);
    await page.evaluate(() => ((window as any).fixture.reject = false));
    await click("添加所选动作");
    await page.waitForFunction(
      () => (window as any).fixture.spec.actors[0].actions.length === 1
    );
    expect(
      await page.evaluate(
        () => (window as any).fixture.spec.actors[0].actions[0].kind
      )
    ).toBe(kind);
    expect(errors).toEqual([]);
    await page.close();
  },
  20000
);
