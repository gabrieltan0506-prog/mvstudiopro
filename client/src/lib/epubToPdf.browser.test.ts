import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "esbuild";
import puppeteer, { type Browser } from "puppeteer";
import JSZip from "jszip";
import { epubPath, epubPdfBlob } from "./epubToPdf";

let browser: Browser;
let bundle: string;
beforeAll(async () => {
  const output = await build({
    stdin: {
      resolveDir: process.cwd(),
      contents: `import { parseEpub } from './client/src/lib/epubToPdf'; import JSZip from 'jszip'; globalThis.parseEpub = parseEpub; globalThis.TestZip = JSZip;`,
    },
    bundle: true,
    write: false,
    format: "iife",
    platform: "browser",
  });
  bundle = output.outputFiles[0]!.text;
  browser = await puppeteer.launch({ headless: true });
}, 30000);
afterAll(async () => {
  await browser?.close();
});

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC";
function book() {
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip");
  zip.file(
    "META-INF/container.xml",
    '<container><rootfiles><rootfile full-path="OEBPS/book.opf"/></rootfiles></container>'
  );
  zip.file(
    "OEBPS/book.opf",
    '<package><metadata><title>中文电子书</title></metadata><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/><item id="b" href="b.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="b"/><itemref idref="a"/></spine></package>'
  );
  zip.file(
    "OEBPS/a.xhtml",
    '<html><body><h1>第二章</h1><p>尾章正文</p><ul><li>条目</li></ul><table><tr><td>表格内容</td></tr></table><img src="img.png"/></body></html>'
  );
  zip.file(
    "OEBPS/b.xhtml",
    "<html><body><h1>第一章</h1><p>开篇正文</p></body></html>"
  );
  zip.file("OEBPS/img.png", png, { base64: true });
  return zip;
}
async function run(zip: JSZip | Uint8Array, options?: { partBytes?: number }) {
  const bytes =
    zip instanceof JSZip
      ? await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" })
      : zip;
  const page = await browser.newPage();
  await page.setRequestInterception(true);
  page.on("request", request => void request.abort());
  await page.addScriptTag({ content: bundle });
  try {
    return await page.evaluate(
      async ({ bytes, options }) => {
        try {
          return {
            result: await (globalThis as any).parseEpub(
              new Uint8Array(bytes),
              "测试",
              options
            ),
            error: "",
          };
        } catch (error) {
          return { result: null, error: (error as Error).message };
        }
      },
      { bytes: Array.from(bytes), options }
    );
  } finally {
    await page.close();
  }
}

describe("EPUB 转换真实浏览器解析（离线，无生产调用）", () => {
  it("按 spine 顺序保留完整正文、列表表格和内嵌图片，输出可离线渲染", async () => {
    const { result, error } = await run(book());
    expect(error).toBe("");
    expect(result.title).toBe("中文电子书");
    expect(result.chapterCount).toBe(2);
    expect(result.imageCount).toBe(1);
    expect(result.text.indexOf("开篇正文")).toBeLessThan(
      result.text.indexOf("尾章正文")
    );
    expect(result.text).toContain("表格内容");
    expect(result.html).toContain("<ul>");
    expect(result.html).toContain("data:image/png;base64,");
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    const remote: string[] = [];
    page.on("request", req => {
      if (!req.url().startsWith("data:")) remote.push(req.url());
      void req.continue();
    });
    try {
      await page.setContent(result.html);
      expect(
        await page.$eval(
          "img",
          image => (image as HTMLImageElement).naturalWidth
        )
      ).toBe(1);
      expect(remote).toEqual([]);
    } finally {
      await page.close();
    }
  });
  it("清理脚本、事件、原 CSS、外链和远程图片，不执行原书代码", async () => {
    const zip = book();
    zip.file(
      "OEBPS/b.xhtml",
      '<html><body><script>window.hacked=1</script><style>body{background:url(https://bad.test)}</style><p onclick="bad()">保留正文</p><a href="https://bad.test">链接文字</a><img src="https://bad.test/a.png"/><iframe src="https://bad.test"/></body></html>'
    );
    const { result, error } = await run(zip);
    expect(error).toBe("");
    expect(result.html).not.toContain("bad.test");
    expect(result.html).not.toContain("onclick");
    expect(result.html).not.toContain("hacked");
    expect(result.text).toContain("链接文字");
    expect(result.warnings.length).toBeGreaterThan(0);
  });
  it("拒绝加密、损坏压缩包与损坏章节", async () => {
    const encrypted = book().file("META-INF/encryption.xml", "<encryption/>");
    expect((await run(encrypted)).error).toContain("加密");
    expect((await run(new Uint8Array([1, 2, 3]))).error).toContain("损坏");
    expect(
      (await run(book().file("OEBPS/b.xhtml", "<html><body>未闭合"))).error
    ).toContain("格式损坏");
  });
  it("移除容量上限后仍拒绝 CRC 不一致的资源", async () => {
    const bytes = await book().generateAsync({
      type: "uint8array",
      compression: "STORE",
    });
    const offset = Buffer.from(bytes).indexOf(Buffer.from("开篇正文", "utf8"));
    expect(offset).toBeGreaterThan(0);
    bytes[offset] = bytes[offset]! ^ 1;
    expect((await run(bytes)).error).toContain("校验失败");
  });
  it("拒绝空章节、缺失图片和不支持的公式，不能充成功", async () => {
    expect(
      (await run(book().file("OEBPS/b.xhtml", "<html><body/></html>"))).error
    ).toContain("空章节");
    expect(
      (
        await run(
          book().file(
            "OEBPS/img.png",
            new Uint8Array([137, 80, 78, 71, 13, 10])
          )
        )
      ).error
    ).toContain("无法解码");
    const missing = book();
    missing.remove("OEBPS/img.png");
    expect((await run(missing)).error).toContain("缺少资源");
    expect(
      (
        await run(
          book().file(
            "OEBPS/b.xhtml",
            "<html><body><math>formula</math></body></html>"
          )
        )
      ).error
    ).toContain("公式");
  });
  it("大单章按嵌套结构分片，完整文字顺序、代理对与表格行保持", async () => {
    const zip = book();
    const content = `章首😀${"前文<&>😀".repeat(2000)}段尾`;
    const escaped = content
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;");
    zip.file(
      "OEBPS/b.xhtml",
      `<html><body><article><h1>第一章</h1><div><p><strong>${escaped}</strong></p></div><table><tbody>${Array.from({ length: 30 }, (_, i) => `<tr><td>行${i}</td><td>${"表格值".repeat(20)}</td></tr>`).join("")}</tbody></table><p>章节结束</p></article></body></html>`
    );
    const { result, error } = await run(zip, { partBytes: 4096 });
    expect(error).toBe("");
    expect(result.html).toBe("");
    expect(result.parts.length).toBeGreaterThan(5);
    const page = await browser.newPage();
    try {
      const restored = await page.evaluate((parts: Array<{ html: string }>) => {
        const docs: Document[] = parts.map(part =>
          new DOMParser().parseFromString(part.html, "text/html")
        );
        return {
          body: docs.map(doc => doc.body.textContent).join(""),
          strong: docs
            .flatMap(doc => Array.from(doc.querySelectorAll("strong")))
            .map(node => node.textContent)
            .join(""),
          rows: docs
            .flatMap(doc => Array.from(doc.querySelectorAll("tr")))
            .map(row =>
              Array.from(row.querySelectorAll("td")).map(
                cell => cell.textContent
              )
            ),
          imageCount: docs.reduce((sum, doc) => sum + doc.images.length, 0),
        };
      }, result.parts);
      expect(restored.strong).toBe(content);
      expect(restored.body.indexOf("章节结束")).toBeLessThan(
        restored.body.indexOf("尾章正文")
      );
      expect(restored.rows.slice(0, 30)).toEqual(
        Array.from({ length: 30 }, (_, i) => [`行${i}`, "表格值".repeat(20)])
      );
      expect(restored.imageCount).toBe(1);
      expect(result.parts[0].chapterStart).toBe(1);
      expect(result.parts.at(-1).chapterEnd).toBe(2);
    } finally {
      await page.close();
    }
  });
  it("有序列表跨片保留 start/value 与倒序编号，超长条目续片不增加步骤", async () => {
    const longStep = `步骤首😀${"保留这个步骤的连续说明😀".repeat(1600)}步骤尾`;
    const zip = book().file(
      "OEBPS/b.xhtml",
      `<html><body><h1>顺序步骤</h1><ol start="7"><li>${longStep}</li><li value="20">显式第二步</li><li>自动下一步</li></ol><ol reversed="reversed" start="5"><li>倒序第一步</li><li value="10">倒序重设</li><li>倒序下一步</li></ol></body></html>`
    );
    const { result, error } = await run(zip, { partBytes: 4096 });
    expect(error).toBe("");
    expect(result.parts.length).toBeGreaterThan(3);
    const page = await browser.newPage();
    const rows: Array<{
      number: number;
      text: string;
      continuation: boolean;
      marker: string;
      role: string | null;
    }> = [];
    try {
      for (const part of result.parts) {
        await page.setContent(part.html);
        rows.push(
          ...(await page.$$eval("ol", lists =>
            lists.flatMap(list => {
              const ol = list as HTMLOListElement;
              let next = ol.hasAttribute("start")
                ? ol.start
                : ol.reversed
                  ? ol.children.length
                  : 1;
              return Array.from(ol.children)
                .filter(child => child.tagName === "LI")
                .map(child => {
                  const li = child as HTMLLIElement;
                  const number = li.hasAttribute("value") ? li.value : next;
                  next = number + (ol.reversed ? -1 : 1);
                  return {
                    number,
                    text: li.textContent || "",
                    continuation: li.dataset.epubListContinuation === "true",
                    marker: getComputedStyle(li).listStyleType,
                    role: li.getAttribute("role"),
                  };
                });
            })
          ))
        );
      }
      expect(
        rows.filter(row => !row.continuation).map(row => row.number)
      ).toEqual([7, 20, 21, 5, 10, 9]);
      expect(
        rows
          .filter(row => row.number === 7)
          .map(row => row.text)
          .join("")
      ).toBe(longStep);
      const continuations = rows.filter(row => row.continuation);
      expect(continuations.length).toBeGreaterThan(1);
      expect(
        continuations.every(
          row =>
            row.number === 7 &&
            row.marker === "none" &&
            row.role === "presentation"
        )
      ).toBe(true);
      expect(rows.map(row => row.text).join("")).toBe(
        `${longStep}显式第二步自动下一步倒序第一步倒序重设倒序下一步`
      );
    } finally {
      await page.close();
    }
  });
  it("目标是分片大小，不是整书限制；原子图片独立超目标仍完整可解码", async () => {
    const page = await browser.newPage();
    await page.addScriptTag({ content: bundle });
    try {
      const result = await page.evaluate(
        async ({ png }) => {
          const zip = new (globalThis as any).TestZip();
          zip.file(
            "META-INF/container.xml",
            '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'
          );
          zip.file(
            "book.opf",
            '<package><manifest><item id="a" href="a.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>'
          );
          const canvas = document.createElement("canvas");
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext("2d")!;
          const image = ctx.createImageData(256, 256);
          for (let i = 0; i < image.data.length; i++)
            image.data[i] = (i * 17 + (i >>> 4)) % 256;
          ctx.putImageData(image, 0, 0);
          const data = canvas.toDataURL("image/png").split(",")[1];
          zip.file("image.png", data || png, { base64: true });
          zip.file(
            "a.xhtml",
            '<html><body><p>前文</p><img src="image.png"/><p>后文</p></body></html>'
          );
          const book = await (globalThis as any).parseEpub(
            await zip.generateAsync({ type: "uint8array" }),
            "图片",
            { partBytes: 3000 }
          );
          const part = book.parts.find((part: any) =>
            part.html.includes("data:image/png")
          );
          const doc = new DOMParser().parseFromString(part.html, "text/html");
          const img = new Image();
          img.src = doc.images[0].src;
          await img.decode();
          return {
            count: book.imageCount,
            bytes: new TextEncoder().encode(part.html).length,
            width: img.naturalWidth,
            parts: book.parts.length,
            text: book.text,
          };
        },
        { png }
      );
      expect(result.bytes).toBeGreaterThan(3000);
      expect(result.width).toBe(256);
      expect(result.count).toBe(1);
      expect(result.parts).toBe(3);
      expect(result.text).toBe("前文\n后文");
    } finally {
      await page.close();
    }
  });
  it.each(["stored-large-entry", "deflated-large-book"])(
    "真实浏览器读取 %s：超过旧文件/解压/HTML限制仍按片完整还原",
    async mode => {
      const page = await browser.newPage();
      await page.addScriptTag({ content: bundle });
      try {
        const result = await page.evaluate(
          async ({ mode, png }) => {
            const zip = new (globalThis as any).TestZip();
            const chapterCount = mode === "stored-large-entry" ? 1 : 6;
            const blocksPerChapter = mode === "stored-large-entry" ? 22 : 15;
            const payload = "x".repeat(1024 * 1024);
            const expected: string[] = [];
            let items = "";
            let refs = "";
            let expandedBytes = 0;
            zip.file(
              "META-INF/container.xml",
              '<container><rootfiles><rootfile full-path="book.opf"/></rootfiles></container>'
            );
            for (let chapter = 1; chapter <= chapterCount; chapter++) {
              let blocks = `<h1>第${chapter}章头😀</h1>`;
              let text = `第${chapter}章头😀`;
              for (let block = 0; block < blocksPerChapter; block++) {
                const value = `块${chapter}-${block}头${payload}块${chapter}-${block}尾`;
                blocks += `<p>${value}</p>`;
                text += value;
              }
              blocks += `<img src="img.png"/><p>第${chapter}章尾😀</p>`;
              text += `第${chapter}章尾😀`;
              const source = `<html><body><article>${blocks}</article></body></html>`;
              expandedBytes += new TextEncoder().encode(source).length;
              zip.file(`chapter-${chapter}.xhtml`, source);
              expected.push(text);
              items += `<item id="c${chapter}" href="chapter-${chapter}.xhtml" media-type="application/xhtml+xml"/>`;
              refs += `<itemref idref="c${chapter}"/>`;
            }
            zip.file(
              "book.opf",
              `<package><metadata><title>大书验证</title></metadata><manifest>${items}</manifest><spine>${refs}</spine></package>`
            );
            zip.file("img.png", png, { base64: true });
            // 文件数超过旧2000阈值；小资源不制造巨量数组或跨协议传输整书。
            for (let index = 0; index < 2001; index++)
              zip.file(`extras/${index}.txt`, "保留包内资源");
            const bytes = await zip.generateAsync({
              type: "uint8array",
              compression: mode === "stored-large-entry" ? "STORE" : "DEFLATE",
              compressionOptions: { level: 1 },
            });
            const progress: { done: number; total: number }[] = [];
            const parsed = await (globalThis as any).parseEpub(bytes, "大书", {
              onProgress: (value: { done: number; total: number }) =>
                progress.push(value),
            });
            const restored: string[] = new Array(chapterCount).fill("");
            let outputBytes = 0;
            let images = 0;
            let imagesValid = true;
            let rangesValid = true;
            for (const part of parsed.parts) {
              outputBytes += new TextEncoder().encode(part.html).length;
              const doc = new DOMParser().parseFromString(
                part.html,
                "text/html"
              );
              for (const section of Array.from(
                doc.querySelectorAll("body > section[data-chapter]")
              )) {
                const chapter = Number(section.getAttribute("data-chapter"));
                rangesValid &&=
                  chapter >= part.chapterStart && chapter <= part.chapterEnd;
                restored[chapter - 1] += section.textContent || "";
              }
              for (const element of Array.from(doc.images)) {
                const image = new Image();
                image.src = element.src;
                await image.decode();
                images++;
                imagesValid &&= image.naturalWidth === 1;
              }
            }
            return {
              archiveBytes: bytes.byteLength,
              expandedBytes,
              outputBytes,
              parts: parsed.parts.length,
              chapters: parsed.chapterCount,
              images,
              imagesValid,
              rangesValid,
              html: parsed.html,
              exact: restored.every((text, index) => text === expected[index]),
              head: restored[0].slice(0, 8),
              tail: restored.at(-1)!.slice(-9),
              textHead: parsed.text.startsWith("第1章头😀"),
              textTail: parsed.text.endsWith(`第${chapterCount}章尾😀`),
              progress,
            };
          },
          { mode, png }
        );
        if (mode === "stored-large-entry")
          expect(result.archiveBytes).toBeGreaterThan(20 * 1024 * 1024);
        else {
          expect(result.expandedBytes).toBeGreaterThan(64 * 1024 * 1024);
          expect(result.outputBytes).toBeGreaterThan(80 * 1024 * 1024);
        }
        expect(result.exact).toBe(true);
        expect(result.textHead).toBe(true);
        expect(result.textTail).toBe(true);
        expect(result.images).toBe(result.chapters);
        expect(result.imagesValid).toBe(true);
        expect(result.rangesValid).toBe(true);
        expect(result.parts).toBeGreaterThan(result.chapters);
        expect(result.html).toBe("");
        expect(result.progress).toEqual(
          Array.from({ length: result.chapters + 1 }, (_, done) => ({
            done,
            total: result.chapters,
          }))
        );
      } finally {
        await page.close();
      }
    },
    180000
  );
  it("拒绝压缩包原始越界路径，允许包内正常相对引用", async () => {
    expect(epubPath("OEBPS/chapters/one.xhtml", "../img.png")).toBe(
      "OEBPS/img.png"
    );
    expect(() => epubPath("", "../outside")).toThrow("越界");
    expect((await run(book().file("../escape.txt", "unsafe"))).error).toContain(
      "越界"
    );
  });
  it("下载前验证 PDF 魔数，拒绝错误页或损坏 base64", async () => {
    expect(() => epubPdfBlob(btoa("<html>错误页面</html>"))).toThrow();
    expect(() => epubPdfBlob("%%%invalid")).toThrow();
    const blob = epubPdfBlob(
      btoa("%PDF-1.7\n内容用测试代替\n%%EOF".replace(/[^\x00-\x7F]/g, "x"))
    );
    expect(blob.type).toBe("application/pdf");
    expect(blob.size).toBeGreaterThan(20);
  });
});
