import { expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Page } from "puppeteer";
import path from "node:path";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import JSZip from "jszip";
import {
  readLayoutLibrary,
  writeLayoutLibrary,
} from "../../../server/services/editableLayoutStore";

it(
  process.env.LAYOUT_RECOVERY_ONLY
    ? "本机损坏稿先保留原文副本再读取云端"
    : process.env.LAYOUT_PREVIEW_ONLY
    ? "选中页面预览与实际编辑内容一致，不产生独立未保存修改"
    : "真实编辑器改字重排、云稿跨会话恢复、冲突保留、完整三格式导出",
  async () => {
    const out = process.env.LAYOUT_EVIDENCE_DIR;
    const css = process.env.LAYOUT_CSS
      ? await readFile(process.env.LAYOUT_CSS, "utf8")
      : "";
    const artifact = await build({
      stdin: {
        resolveDir: process.cwd(),
        sourcefile: "layout-fixture.tsx",
        loader: "tsx",
        contents: `
 import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
 import Studio from './client/src/components/platform/EditableLayoutStudio';
 import {exportEditableLayout} from './client/src/lib/editableLayoutExport';
 import {layoutFromSource} from './shared/editableLayout';
 function App(){const[owner,setOwner]=useState('7');const[source,setSource]=useState(null);window.importSource=()=>setSource({owner:'7',sourceId:'source-real',title:'会议表达手册',body:'原始正文保留',pages:[{pageIndex:1,headline:'先说结论',body:'第一句说结论。\\n第二句给依据。'},{pageIndex:2,headline:'说清请求',body:'末尾完整内容。'}],images:{2:'https://fixture.invalid/image.png'}});window.owner=setOwner;return <Studio key={owner} owner={owner} source={source}/>};
 window.exportFile=async(format)=>{const cache=JSON.parse(localStorage.getItem('mvstudiopro.editableLayout.v1.7'));const blob=await exportEditableLayout(cache.library.documents[0],format);return [...new Uint8Array(await blob.arrayBuffer())]};
 createRoot(document.getElementById('root')).render(<App/>);
 `,
      },
      bundle: true,
      write: false,
      format: "iife",
      platform: "browser",
      jsx: "automatic",
      alias: {
        "@": path.resolve("client/src"),
        "@shared": path.resolve("shared"),
      },
      plugins: [
        {
          name: "network-only",
          setup(b) {
            b.onResolve({ filter: /^@\/lib\/trpc$/ }, () => ({
              path: "trpc",
              namespace: "fixture",
            }));
            b.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
              loader: "js",
              contents: `export const trpc={useUtils:()=>({editableLayout:{get:{fetch:()=>window.cloudRead()}}}),editableLayout:{save:{useMutation:()=>({mutateAsync:input=>window.cloudSave(input)})}}};`,
            }));
          },
        },
      ],
      define: {
        "process.env.NODE_ENV": '"production"',
        "import.meta.env": "{}",
      },
      logLevel: "silent",
    });
    const objects = new Map<string, { buffer: Buffer; generation: string }>();
    let saves = 0;
    let failRead = false;
    let missingImage = false;
    const deps = {
      read: async (i: any) => {
        if (failRead) throw Error("offline");
        const value = objects.get(i.gcsUri.match(/editable-layouts\/.*$/)[0]);
        if (!value) throw Error("gcs_stat_failed:404");
        return value;
      },
      write: async (i: any) => {
        saves++;
        const old = objects.get(i.objectName);
        if (i.ifGenerationMatch !== (old?.generation || "0"))
          throw Error("gcs_upload_failed:412:{}");
        const value = {
          buffer: i.buffer,
          generation: String(Number(old?.generation || 0) + 1),
        };
        objects.set(i.objectName, value);
        return value;
      },
    } as any;
    const browser = await puppeteer.launch({ headless: true, args: process.platform === "linux" ? ["--no-sandbox", "--disable-setuid-sandbox"] : [] });
    const errors: string[] = [];
    const pixel = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAPAAAAB4CAIAAABD1OhwAAACtklEQVR4nO3dvVFcQRCF0UVFBgqDiUE2GeARgQxCkaEklIZimDSUAwYFhSEhJN789H3n2Auvu+rbYVhnr27uby+Q4tPqAeBIgiaKoIkiaKIImiiCJoqgiSJoogiaKIImiqCJImiiCJoogiaKoIkiaKIImiiCJoqgiXL9kR/+eff5EufLj1+rR+D/OaGJImiiCJoogibKh/4pJEP//u2vr2lfHy4VCPqk+jsi/tPrd45b0OfS/7Hjt3/JhmUL+hT6ER2XKFvQ4fqYlH/7lB2yFnSsPiXl3bL2sV2mPr3mHR4t6Ex9aVJrB3DliNJXp7z8+uHKkaNvU/PCkQQdYsOalwwm6ATb1jx/PEGXt3nNk4cUdG0lap45qqALK1TztIEFTRRBV1XueJ4ztqBLKlrzhOEFXU/pmkevIGiiCLqYgON56CKCJoqgK4k5nsetI2iiCJoogi4j7L4xaClBE0XQRBF0DZH3jRGrCZoogiaKoIki6AKCL9CHLyhoogiaKIImiqCJImiiCJoogiaKoIkiaKIImiiCJoqgC9jh+/+qLChoogiaKIImiqBrCL5Gt0NXEzRRBE0UQZcReetoRy8laKIImiiCriTs1tEGrCNoogi6mJhDuo1ZRNBEEXQ9AYd0G7aCoEsq3XQbObygqyradBs8tqCJIujCyh3SbfzAgq6tUNNtyqiCLq9E023WkIJOsHnTbeJ4gg6xbdNt7mCCztH2a3r+SNeTn8eEgPoG38my6t3lhA7UVh/VCwcQdKa2Lqm1bydXjlht+vVj+V8GQedrU7LeIeUnTuhTaM/BHVv2Ph2/EPS5tCPK3rDjF4I+qfYqyvfEvXPEr13d3N+ungEO42M7ogiaKIImiqCJImiiCJoogiaKoIkiaKIImiiCJoqgiSJoogiaKIImiqCJImiiCJpLkkcjSZ6t/GNQtAAAAABJRU5ErkJggg==",
      "base64"
    );
    const setup = async (page: Page) => {
      page.on("pageerror", e => errors.push(String(e)));
      await page.exposeFunction("cloudRead", () => readLayoutLibrary(7, deps));
      await page.exposeFunction("cloudSave", (i: any) =>
        writeLayoutLibrary(7, i.library, i.expectedGeneration, deps)
      );
      await page.setRequestInterception(true);
      page.on("request", r => {
        if (r.isNavigationRequest() && r.url() === "http://127.0.0.1/")
          void r.respond({
            status: 200,
            contentType: "text/html",
            body: '<html><body><div id="root"></div></body></html>',
          });
        else if (
          r.url().includes("image.png") ||
          r.url().includes("manhua-media-download")
        )
          void r.respond({
            status: missingImage ? 503 : 200,
            contentType: "image/png",
            headers: { "cache-control": "no-store" },
            body: pixel,
          });
        else if (r.url().startsWith("data:") || r.url() === "about:srcdoc")
          void r.continue();
        else void r.abort();
      });
      await page.goto("http://127.0.0.1/");
      if (process.env.LAYOUT_RECOVERY_ONLY) await page.evaluate(() => localStorage.setItem("mvstudiopro.editableLayout.v1.7", "{broken-original"));
    await page.addScriptTag({ content: artifact.outputFiles[0].text });
      if (css) await page.addStyleTag({ content: css });
    };
    const click = async (page: Page, text: string) => {
      await page.evaluate(t => {
        const b = Array.from(document.querySelectorAll("button")).find(
          b => b.textContent === t
        );
        if (!b || b.disabled) throw Error("button unavailable: " + t);
        b.click();
      }, text);
    };
    const setText = async (page: Page, label: string, value: string) => {
      await page.focus(`[aria-label="${label}"]`);
      await page.$eval(`[aria-label="${label}"]`, e =>
        (e as HTMLTextAreaElement).select()
      );
      await page.keyboard.type(value);
    };
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 950 });
      await setup(page);
      if (process.env.LAYOUT_RECOVERY_ONLY) {
      await page.waitForFunction(() => Object.keys(localStorage).some(k => k.includes(".unreadable.")));
      expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.includes(".unreadable.")).map(k => localStorage.getItem(k)))).toEqual(["{broken-original"]);
      expect(JSON.parse(await page.evaluate(() => localStorage.getItem("mvstudiopro.editableLayout.v1.7")!)).library.owner).toBe("7");
      expect(errors).toEqual([]); return;
    }
    await page.evaluate(() => (window as any).importSource());
      await page.waitForSelector('[aria-label="本页正文"]');
      await setText(page, "本页正文", "修改后的完整正文。保留末句。");
      await click(page, "下移本页");
      await page.waitForFunction(() => {
        const f = document.querySelector(
          'iframe[title="排版预览"]'
        ) as HTMLIFrameElement;
        const d = f?.contentDocument;
        return (
          d?.querySelector(".page:nth-of-type(2) .body")?.textContent?.trim() ===
            "修改后的完整正文。保留末句。" &&
          f.contentWindow?.getComputedStyle(
            d.querySelector(".page:nth-of-type(1)")!
          ).display === "none"
        );
      });
      expect(
        await page.evaluate(
          () =>
            (
              document.querySelector(
                'iframe[title="排版预览"]'
              ) as HTMLIFrameElement
            ).contentDocument!.querySelectorAll('[contenteditable="true"]')
              .length
        )
      ).toBe(0);
      expect(await page.evaluate(() => {
      const f=document.querySelector('iframe[title="排版预览"]') as HTMLIFrameElement;
      const rect=f.contentDocument!.querySelector('.page:nth-of-type(2)')!.getBoundingClientRect();
      return rect.height >= rect.width * 4 / 3 - 1;
    })).toBe(true);
    if (process.env.LAYOUT_PREVIEW_ONLY) {
        if (out) {
          await mkdir(out, { recursive: true });
          await page.screenshot({
            path: path.join(out, "编辑器桌面.png"),
            fullPage: true,
          });
          await page.setViewport({ width: 390, height: 844 });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          ).toBe(true);
          await page.screenshot({
            path: path.join(out, "编辑器手机.png"),
            fullPage: true,
          });
        }
        expect(errors).toEqual([]);
        return;
      }
      await click(page, "保存云端");
      await page.waitForFunction(() =>
        document.body.innerText.includes("云端已保存")
      );
      expect(saves).toBe(1);
      const stored = (await readLayoutLibrary(7, deps)).library!;
      expect(stored.documents[0].pages[1].body).toBe(
        "修改后的完整正文。保留末句。"
      );
      expect(stored.documents[0].pages[0].imageUrl).toBe(
        "https://fixture.invalid/image.png"
      );
      const html = Buffer.from(
        await page.evaluate(() => (window as any).exportFile("html"))
      );
      expect(html.toString()).toContain("修改后的完整正文。保留末句。");
      expect(html.toString()).toContain("data:image/png;base64,");
      expect(html.toString()).not.toContain("https://fixture.invalid");
      const png = Buffer.from(
        await page.evaluate(() => (window as any).exportFile("png"))
      );
      const zip = await JSZip.loadAsync(png);
      expect(Object.keys(zip.files).sort()).toEqual(
        ["01.png", "02.png", "可编辑稿.html"].sort()
      );
      const first = await zip.file("01.png")!.async("nodebuffer");
      expect(first.subarray(1, 4).toString()).toBe("PNG");
      expect(png.readUInt16LE(8)).toBe(8); // ZIP实际使用DEFLATE。
      const pdf = Buffer.from(
        await page.evaluate(() => (window as any).exportFile("pdf"))
      );
      expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
      expect(pdf.toString("latin1")).toContain("/FlateDecode");
      expect(pdf.toString("latin1").match(/\/Type \/Page\b/g)).toHaveLength(2);
      if (out) {
        await mkdir(out, { recursive: true });
        await writeFile(path.join(out, "编辑后成稿.html"), html);
        await writeFile(path.join(out, "编辑后成稿.zip"), png);
        await writeFile(path.join(out, "编辑后成稿.pdf"), pdf);
        await writeFile(path.join(out, "01.png"), first);
        await page.screenshot({
          path: path.join(out, "编辑器桌面.png"),
          fullPage: true,
        });
      }
      const context = await browser.createBrowserContext();
      const restored = await context.newPage();
      await setup(restored);
      await restored.waitForFunction(() =>
        document.body.innerText.includes("打开稿件库（1）")
      );
      await click(restored, "打开稿件库（1）");
      await restored.waitForSelector('[aria-label="本页正文"]');
      expect(
        await restored.$eval(
          '[aria-label="本页正文"]',
          e => (e as HTMLTextAreaElement).value
        )
      ).toBe("末尾完整内容。");
      await click(restored, "第2页");
      expect(
        await restored.$eval(
          '[aria-label="本页正文"]',
          e => (e as HTMLTextAreaElement).value
        )
      ).toBe("修改后的完整正文。保留末句。");
      await setText(restored, "本页正文", "另一个会话更新。");
      await click(restored, "保存云端");
      await restored.waitForFunction(() =>
        document.body.innerText.includes("云端已保存")
      );
      await setText(page, "本页正文", "旧会话不能覆盖云端。");
      await click(page, "保存云端");
      await page.waitForFunction(() =>
        document.body.innerText.includes("云端排版稿已变化")
      );
      expect(
        (await readLayoutLibrary(7, deps)).library!.documents[0].pages[1].body
      ).toBe("另一个会话更新。");
      expect(
        await page.$eval(
          '[aria-label="本页正文"]',
          e => (e as HTMLTextAreaElement).value
        )
      ).toBe("旧会话不能覆盖云端。");
      // 同浏览器刷新保留冲突中的本机改动；未重新导入原稿或发起生成。
      page.once("dialog", d => void d.accept());
      await page.reload();
      await page.addScriptTag({ content: artifact.outputFiles[0].text });
      if (css) await page.addStyleTag({ content: css });
      await page.waitForFunction(() =>
        document.body.innerText.includes("打开稿件库（1）")
      );
      await click(page, "打开稿件库（1）");
      await click(page, "第2页");
      expect(
        await page.$eval(
          '[aria-label="本页正文"]',
          e => (e as HTMLTextAreaElement).value
        )
      ).toBe("旧会话不能覆盖云端。");
      await page.setViewport({ width: 390, height: 844 });
      if (out)
        await page.screenshot({
          path: path.join(out, "编辑器手机.png"),
          fullPage: true,
        });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      missingImage = true;
      await expect(
        page.evaluate(() => (window as any).exportFile("html"))
      ).rejects.toThrow("配图下载失败");
      missingImage = false;
      await page.evaluate(() => {
        (window as any).importSource();
      });
      await page.waitForFunction(
        () =>
          document.querySelectorAll('[aria-label="选择排版稿件"] option')
            .length === 2
      );
      await page.evaluate(() => {
        (window as any).owner("8");
      });
      await page.waitForFunction(() =>
        document.body.innerText.includes("打开稿件库（0）")
      );
      await click(page, "打开稿件库（0）");
      await page.waitForFunction(() =>
        document.body.innerText.includes("云端稿件账号不匹配")
      );
      expect(await page.$('[aria-label="本页正文"]')).toBeNull();
      failRead = true;
      const offlineContext = await browser.createBrowserContext();
      const offline = await offlineContext.newPage();
      await setup(offline);
      await offline.evaluate(() => (window as any).importSource());
      await offline.waitForSelector('[aria-label="本页正文"]');
      expect(
        await offline.evaluate(
          () =>
            Array.from(document.querySelectorAll("button")).find(
              b => b.textContent === "保存云端"
            )?.disabled
        )
      ).toBe(true);
      expect(
        await offline.$eval(
          '[aria-label="本页正文"]',
          e => (e as HTMLTextAreaElement).value
        )
      ).toContain("第一句");
      await offlineContext.close();
      expect(errors).toEqual([]);
      await context.close();
    } finally {
      await browser.close();
    }
  },
  180000
);
