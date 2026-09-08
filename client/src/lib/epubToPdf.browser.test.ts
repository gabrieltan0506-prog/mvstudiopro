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
      contents: `import { parseEpub } from './client/src/lib/epubToPdf'; globalThis.parseEpub = parseEpub;`,
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
async function run(zip: JSZip | Uint8Array, limits?: Record<string, number>) {
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
      async ({ bytes, limits }) => {
        try {
          return {
            result: await (globalThis as any).parseEpub(
              new Uint8Array(bytes),
              "测试",
              limits
                ? {
                    archiveBytes: 20971520,
                    expandedBytes: 67108864,
                    entryBytes: 16777216,
                    entries: 2000,
                    htmlBytes: 83886080,
                    ...limits,
                  }
                : undefined
            ),
            error: "",
          };
        } catch (error) {
          return { result: null, error: (error as Error).message };
        }
      },
      { bytes: Array.from(bytes), limits }
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
  it("在解压和提交前执行容量限制，不截断正文", async () => {
    expect((await run(book(), { archiveBytes: 10 })).error).toContain("20 MB");
    expect((await run(book(), { expandedBytes: 20 })).error).toContain("64 MB");
    expect((await run(book(), { entryBytes: 20 })).error).toContain("单个资源");
    expect((await run(book(), { htmlBytes: 100 })).error).toContain(
      "未截断正文"
    );
    expect((await run(book(), { entries: 1 })).error).toContain("过多文件");
  });
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
