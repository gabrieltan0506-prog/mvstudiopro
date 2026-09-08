import { describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import PDFDocument from "pdfkit";
import sharp from "sharp";
import {
  withKnowledgeCardDocumentPages as read,
  iterateKnowledgeCardDocumentPages as iterate,
} from "./knowledgeCardDocumentPages";

async function pdf(encrypted = false): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      autoFirstPage: false,
      ...(encrypted
        ? { userPassword: "test-password", ownerPassword: "test-owner" }
        : {}),
    });
    const buffers: Buffer[] = [];
    doc.on("data", b => buffers.push(b));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);
    doc.addPage().text("FIRST PAGE");
    doc.addPage();
    doc.addPage().rect(30, 30, 100, 100).fill("red");
    doc.end();
  });
}
describe("知识卡文档物理页读取（本机Poppler，无模型）", () => {
  it("真实PDF在消费前依次上报0/N和每页完成，await异步进度持久化", async () => {
    const events: Array<[number, number, string]> = [];
    let progressPending = false;
    await read({ buffer: await pdf(), mimeType: "application/pdf", onProgress: async (done, total, phase) => {
      expect(progressPending).toBe(false);
      progressPending = true;
      await Promise.resolve();
      events.push([done, total, phase]);
      progressPending = false;
    } }, async manifest => {
      expect(progressPending).toBe(false);
      expect(manifest.totalPages).toBe(3);
      expect(events).toEqual([[0, 3, "rendering"], [1, 3, "rendering"], [2, 3, "rendering"], [3, 3, "rendering"]]);
    });
  }, 60000);
  it("进度写入失败或回调中止时停止，不继续消费或虚报剩余页完成", async () => {
    const consume = vi.fn();
    const controller = new AbortController();
    const progress = vi.fn(async (done: number) => { if (done === 1) controller.abort(new Error("进度任务已中止")); });
    await expect(read({ buffer: await pdf(), mimeType: "application/pdf", signal: controller.signal, onProgress: progress }, consume)).rejects.toThrow("进度任务已中止");
    expect(progress.mock.calls.map(call => call[0])).toEqual([0, 1]);
    expect(consume).not.toHaveBeenCalled();
    await expect(read({ buffer: await pdf(), mimeType: "application/pdf", onProgress: async () => { throw new Error("进度写入失败"); } }, consume)).rejects.toThrow("进度写入失败");
    expect(consume).not.toHaveBeenCalled();
  }, 60000);
  it("完整文字清单就绪才上报prepared真实段数，正文和段数一致", async () => {
    const progress = vi.fn();
    const text = "正文😀".repeat(8000);
    await read({ buffer: Buffer.from(text), mimeType: "text/plain", onProgress: progress }, async manifest => {
      expect(manifest.pages.map(page => page.text).join("")).toBe(text);
      expect(progress).toHaveBeenCalledTimes(1);
      expect(progress).toHaveBeenCalledWith(manifest.totalPages, manifest.totalPages, "prepared");
    });
  });
  it("PDF全部物理页按序渲染，空白及纯图页保留，回调后清理", async () => {
    let firstPath = "";
    await read(
      {
        buffer: await pdf(),
        mimeType: "application/pdf",
        fileName: "来源.pdf",
      },
      async manifest => {
        expect(manifest.totalPages).toBe(3);
        expect(manifest.pages.map(p => p.pageNumber)).toEqual([1, 2, 3]);
        expect(manifest.pages[0]!.text).toContain("FIRST PAGE");
        expect(manifest.pages[1]!.text.trim()).toBe("");
        expect(manifest.pages[2]!.text.trim()).toBe("");
        expect(manifest.sourceDigest).toMatch(/^[a-f0-9]{64}$/);
        firstPath = manifest.pages[0]!.imagePath!;
        let count = 0;
        const blankCandidates: boolean[] = [];
        for await (const page of iterate(manifest)) {
          count++;
          blankCandidates.push(page.isBlankCandidate);
          expect(page.width).toBe(1920);
          expect(page.imageBuffer!.length).toBeGreaterThan(1000);
          const { width, height } = await sharp(page.imageBuffer).metadata();
          expect(width).toBe(1920);
          expect(height).toBeGreaterThan(0);
        }
        expect(count).toBe(3);
        expect(blankCandidates).toEqual([false, true, false]);
      }
    );
    await expect(fs.stat(firstPath)).rejects.toThrow();
  }, 60000);
  it("不接受加密、损坏PDF，也不退成strings提取", async () => {
    await expect(
      read(
        { buffer: await pdf(true), mimeType: "application/pdf" },
        async () => true
      )
    ).rejects.toThrow(/加密/);
    await expect(
      read(
        { buffer: Buffer.from("%PDF-broken"), mimeType: "application/pdf" },
        async () => true
      )
    ).rejects.toThrow(/损坏/);
    await expect(
      read(
        { buffer: Buffer.from("not pdf"), mimeType: "application/pdf" },
        async () => true
      )
    ).rejects.toThrow(/文件头/);
  });
  it("回调失败仍清理临时图；图被修改后迭代验真失败", async () => {
    let imagePath = "";
    const image = await sharp({
      create: { width: 80, height: 50, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    await expect(
      read({ buffer: image, mimeType: "image/png" }, async manifest => {
        imagePath = manifest.pages[0]!.imagePath!;
        expect(manifest.sourceFormat).toBe("image");
        expect(manifest.totalPages).toBe(1);
        expect(manifest.pages[0]!.isBlankCandidate).toBe(false);
        expect((await iterate(manifest).next()).value?.isBlankCandidate).toBe(
          false
        );
        await fs.writeFile(imagePath, "corrupted");
        await expect(iterate(manifest).next()).rejects.toThrow("损坏");
        throw Error("consumer failure");
      })
    ).rejects.toThrow("consumer failure");
    await expect(fs.stat(imagePath)).rejects.toThrow();
  });
  it("长文字按逻辑段保留全部空白与emoji，不截断或切坏代理对", async () => {
    const text = "\n标题😀\n\n" + "正文 ".repeat(20000) + "\n尾段";
    await read(
      {
        buffer: Buffer.from(text),
        mimeType: "text/markdown",
        fileName: "材料.md",
      },
      async manifest => {
        expect(manifest.sourceFormat).toBe("text");
        expect(manifest.pages.map(page => page.text).join("")).toBe(text);
        expect(manifest.pages.every(page => page.text.length <= 12000)).toBe(true);
        expect(manifest.pages[0]!.imagePath).toBeUndefined();
        expect(manifest.totalPages).toBeGreaterThan(1);
        expect(manifest.pages.map(page => page.pageNumber)).toEqual(Array.from({ length: manifest.totalPages }, (_, index) => index + 1));
      }
    );
    await read({ buffer: Buffer.from("a".repeat(11999) + "😀尾"), mimeType: "text/plain" }, async manifest => {
      expect(manifest.pages.map(page => page.text)).toEqual(["a".repeat(11999), "😀尾"]);
    });
    await expect(
      read(
        { buffer: Buffer.from([255, 255]), mimeType: "text/plain" },
        async () => true
      )
    ).rejects.toThrow("UTF-8");
  });
  it("Office和EPUB明确要求转PDF；无效输入不运行消费回调", async () => {
    let calls = 0;
    for (const name of ["file.docx", "file.pptx", "file.epub"])
      await expect(
        read(
          {
            buffer: Buffer.from("test"),
            mimeType: "application/octet-stream",
            fileName: name,
          },
          async () => calls++
        )
      ).rejects.toThrow("转换成PDF");
    await expect(
      read(
        { buffer: Buffer.alloc(0), mimeType: "application/pdf" },
        async () => calls++
      )
    ).rejects.toThrow("为空");
    expect(calls).toBe(0);
  });
  it("调用已取消时不创建页面或进入消费回调", async () => {
    const controller = new AbortController();
    controller.abort(new Error("test-cancelled"));
    let calls = 0;
    await expect(
      read(
        {
          buffer: Buffer.from("正文"),
          mimeType: "text/plain",
          signal: controller.signal,
        },
        async () => calls++
      )
    ).rejects.toThrow("test-cancelled");
    expect(calls).toBe(0);
  });
  it("仅空白文本是真正空白候选，不把无图片的正文当空白", async () => {
    await read(
      { buffer: Buffer.from(" \n\t\r\n"), mimeType: "text/plain" },
      async manifest => {
        expect(manifest.pages[0].isBlankCandidate).toBe(true);
        expect((await iterate(manifest).next()).value?.isBlankCandidate).toBe(
          true
        );
      }
    );
  });
  it("实际白色、近白与全透明图片可确认为空白候选", async () => {
    for (const background of [
      "white",
      "#fefefe",
      { r: 0, g: 0, b: 0, alpha: 0 },
    ]) {
      const buffer = await sharp({
        create: { width: 128, height: 96, channels: 4, background },
      })
        .png()
        .toBuffer();
      await read({ buffer, mimeType: "image/png" }, async manifest => {
        // 未检查像素前清单不先宣称空白。
        expect(manifest.pages[0].isBlankCandidate).toBe(false);
        const page = (await iterate(manifest).next()).value!;
        expect(page.text).toBe("");
        expect(page.isBlankCandidate).toBe(true);
      });
    }
  });
  it("纯图线条、扫描文字及恒定有色背景均不是空白，不能仅凭无OCR文字判定", async () => {
    const line = Buffer.from(
      '<svg width="1000" height="1000"><rect width="1000" height="1000" fill="white"/><path d="M10 500 H990" stroke="black" stroke-width="1"/></svg>'
    );
    const scannedText = Buffer.from(
      '<svg width="640" height="400"><rect width="640" height="400" fill="white"/><text x="20" y="70" font-size="32" fill="black">SCAN TEXT 123</text><text x="20" y="140" font-size="28" fill="black">Page conditions and units</text></svg>'
    );
    const images = [
      await sharp(line).png().toBuffer(),
      await sharp(scannedText).png().toBuffer(),
      await sharp({
        create: { width: 128, height: 96, channels: 3, background: "red" },
      })
        .png()
        .toBuffer(),
    ];
    for (const buffer of images)
      await read({ buffer, mimeType: "image/png" }, async manifest => {
        manifest.pages[0].isBlankCandidate = true;
        const page = (await iterate(manifest).next()).value!;
        expect(page.text).toBe("");
        expect(page.isBlankCandidate).toBe(false);
      });
  });
  it("实际白图仍有已提取正文时不能宣称空白", async () => {
    const buffer = await sharp({
      create: { width: 128, height: 96, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await read({ buffer, mimeType: "image/png" }, async manifest => {
      manifest.pages[0].text = "提取到的原文数字30%";
      expect((await iterate(manifest).next()).value?.isBlankCandidate).toBe(
        false
      );
    });
  });
});
