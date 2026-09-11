/**
 * 终审故障回归（0911）：
 * - 背压：文件 sink 停滞时页生产必须停下，PDF readable 不得无界积压（此前第 8 页前积压 13 MB）
 * - 停滞 sink 有界超时；取消信号生效
 * - 上传前置失败要 cancel 掉传入的流（fd 不泄漏）；鉴权失败同
 * - sharpLimits 是唯一 sharp 全局配置源，导入 PDF 模块不得覆盖 SHARP_CONCURRENCY
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Readable, Writable } from "node:stream";
import { createReadStream } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { tmpdir } from "node:os";
import nodePath from "node:path";
import sharp from "sharp";
import {
  buildKnowledgeCardPdfFile,
  normalizeKnowledgeCardPage,
} from "./knowledgeCardPdfExport";

const page = async () =>
  sharp({ create: { width: 3840, height: 2160, channels: 3, background: "#ffffff" } }).jpeg().toBuffer();

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("PDF 生产端背压（终审 P2）", () => {
  it("sink 停滞：头先落盘、首页写完后停滞，页生产被挡住、缓冲有界、超时报错并清目录（终审第三条：真实测量替换恒真断言）", async () => {
    const jpeg = await page();
    const norm = await normalizeKnowledgeCardPage(jpeg);
    // 放行 PDF 头 + 第一页的体量，之后停滞：既证明"能落盘的都落了"，又证明"落不动时生产停下"
    const stallAfter = norm.length + 16_384;
    let acked = 0;
    let maxBuffered = 0;
    let loads = 0;
    let capturedPath = "";
    const stalled = new Writable({
      highWaterMark: 65_536,
      write(chunk: Buffer, _e, cb) {
        maxBuffered = Math.max(maxBuffered, stalled.writableLength);
        if (acked + chunk.length <= stallAfter) {
          acked += chunk.length;
          cb();
          return;
        }
        /* 预算用完：不再回调，模拟停滞的文件系统 */
      },
    });
    const sampler = setInterval(() => {
      maxBuffered = Math.max(maxBuffered, stalled.writableLength);
    }, 5);
    const loaders = Array.from({ length: 8 }, () => async () => {
      loads += 1;
      return jpeg;
    });
    try {
      await expect(
        buildKnowledgeCardPdfFile(loaders, {
          timeoutMs: 1_200,
          makeOut: (filePath) => {
            capturedPath = filePath;
            return stalled;
          },
        }),
      ).rejects.toThrow(/写入无进展|提前关闭/);
    } finally {
      clearInterval(sampler);
    }
    // 有进展：PDF 头与首页确实经过了 sink（预算大头被消费掉）
    expect(acked).toBeGreaterThan(norm.length / 2);
    // 背压生效：停滞后页生产被挡住，8 个 loader 远消费不完（PDFKit 逐页 flush 有一页相位差，放宽到 4）
    expect(loads).toBeGreaterThanOrEqual(1);
    expect(loads).toBeLessThanOrEqual(4);
    // 缓冲有界：writable 侧最多滞留 hwm + 一个整页大小的 chunk，绝不是此前的多页无界积压
    expect(maxBuffered).toBeGreaterThan(0);
    expect(maxBuffered).toBeLessThanOrEqual(65_536 + norm.length + 16_384);
    // 失败收尾：临时目录已删、sink 已被 destroy
    expect(capturedPath).not.toBe("");
    const { stat } = await import("node:fs/promises");
    await expect(stat(nodePath.dirname(capturedPath))).rejects.toMatchObject({ code: "ENOENT" });
    expect(stalled.destroyed).toBe(true);
  }, 60_000);

  it("正常 sink：全部页写完、文件字节可 stat、目录由调用方清理", async () => {
    const jpeg = await page();
    const r = await buildKnowledgeCardPdfFile([async () => jpeg, async () => jpeg, async () => jpeg]);
    try {
      expect(r.bytes).toBeGreaterThan(1000);
    } finally {
      await rm(r.dir, { recursive: true, force: true });
    }
  }, 60_000);

  it("取消信号：中途 abort 按取消收口，不留未处理拒绝", async () => {
    const ac = new AbortController();
    const jpeg = await page();
    const loaders = [
      async () => jpeg,
      async () => {
        ac.abort(new Error("用户取消导出"));
        return jpeg;
      },
      async () => jpeg,
    ];
    await expect(buildKnowledgeCardPdfFile(loaders, { signal: ac.signal })).rejects.toThrow(/用户取消导出/);
  }, 60_000);

  it("一页取图失败：拒绝原始业务错误、清目录、无 unhandledRejection（终审 P1）", async () => {
    const rejections: unknown[] = [];
    const onR = (e: unknown) => rejections.push(e);
    process.on("unhandledRejection", onR);
    try {
      const jpeg = await page();
      await expect(
        buildKnowledgeCardPdfFile([
          async () => jpeg,
          async () => {
            throw new Error("读取成品图失败（403）");
          },
        ]),
      ).rejects.toThrow(/读取成品图失败（403）/);
      // 给潜在的漏网拒绝一个微任务窗口
      await new Promise((r) => setTimeout(r, 50));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onR);
    }
  }, 60_000);
});

describe("uploadStreamToGcs 前置失败不泄漏 fd（终审 P2）", () => {
  it("预先已取消：传入的文件流被 cancel，fd 关闭", async () => {
    const dir = await mkdtemp(nodePath.join(tmpdir(), "kc-up-"));
    const fp = nodePath.join(dir, "a.pdf");
    await writeFile(fp, Buffer.alloc(4096, 1));
    const source = createReadStream(fp);
    const closed = finished(source, { cleanup: true }).catch(() => {});
    const { uploadStreamToGcs } = await import("./gcs");
    const ac = new AbortController();
    ac.abort(new Error("预取消"));
    await expect(
      uploadStreamToGcs({
        objectName: "x/a.pdf",
        stream: Readable.toWeb(source) as ReadableStream<Uint8Array>,
        contentLength: 4096,
        contentType: "application/pdf",
        bucket: "test-bucket",
        signal: ac.signal,
      }),
    ).rejects.toThrow(/预取消/);
    await closed;
    expect(source.destroyed).toBe(true);
    await rm(dir, { recursive: true, force: true });
  }, 30_000);

  it("鉴权失败：同样 cancel 流；上传拒绝不返回成功地址", async () => {
    vi.resetModules();
    vi.doMock("../utils/vertex", () => ({ getVertexAccessToken: async () => { throw new Error("token 获取失败"); } }));
    const { uploadStreamToGcs } = await import("./gcs");
    let cancelled = false;
    const web = new ReadableStream<Uint8Array>({
      cancel() {
        cancelled = true;
      },
    });
    await expect(
      uploadStreamToGcs({
        objectName: "x/b.pdf",
        stream: web,
        contentLength: 16,
        contentType: "application/pdf",
        bucket: "test-bucket",
      }),
    ).rejects.toThrow(/token 获取失败/);
    expect(cancelled).toBe(true);
    vi.doUnmock("../utils/vertex");
    vi.resetModules();
  }, 30_000);

  it("鉴权挂起 + 取消：及时拒绝、cancel 文件流、不发 GCS POST、调用方可关 fd 删目录（终审 P2）", async () => {
    vi.resetModules();
    let lateReject: ((e: unknown) => void) | undefined;
    const pendingAuth = new Promise<string>((_, rej) => {
      lateReject = rej;
    });
    vi.doMock("../utils/vertex", () => ({ getVertexAccessToken: () => pendingAuth }));
    const fetchSpy = vi.fn(async () => {
      throw new Error("鉴权未过不应发起 GCS POST");
    });
    vi.stubGlobal("fetch", fetchSpy);
    const rejections: unknown[] = [];
    const onR = (e: unknown) => rejections.push(e);
    process.on("unhandledRejection", onR);
    const dir = await mkdtemp(nodePath.join(tmpdir(), "kc-up-auth-"));
    try {
      const fp = nodePath.join(dir, "c.pdf");
      await writeFile(fp, Buffer.alloc(4096, 2));
      const source = createReadStream(fp);
      const closed = finished(source, { cleanup: true }).catch(() => {});
      const { uploadStreamToGcs } = await import("./gcs");
      const ac = new AbortController();
      const uploading = uploadStreamToGcs({
        objectName: "x/c.pdf",
        stream: Readable.toWeb(source) as ReadableStream<Uint8Array>,
        contentLength: 4096,
        contentType: "application/pdf",
        bucket: "test-bucket",
        signal: ac.signal,
      });
      // 鉴权永远悬着；50ms 后取消——此前实现会一直 await 下去，超时形同虚设
      setTimeout(() => ac.abort(new Error("上传超时（含鉴权等待）")), 50);
      const started = performance.now();
      await expect(uploading).rejects.toThrow(/上传超时（含鉴权等待）/);
      expect(performance.now() - started).toBeLessThan(5_000);
      // 前置失败：流被 cancel，fd 不吊着
      await closed;
      expect(source.destroyed).toBe(true);
      // 没碰网络
      expect(fetchSpy).not.toHaveBeenCalled();
      // 调用方 finally 语义可走通：关流、删目录
      source.destroy();
      await rm(dir, { recursive: true, force: true });
      const { stat } = await import("node:fs/promises");
      await expect(stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
      // 迟到的鉴权失败不产生 unhandledRejection（awaitWithAbortSignal 已挂了处理器）
      lateReject?.(new Error("late auth failure"));
      await new Promise((r) => setTimeout(r, 50));
      expect(rejections).toEqual([]);
    } finally {
      process.off("unhandledRejection", onR);
      vi.doUnmock("../utils/vertex");
      vi.resetModules();
      await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  }, 30_000);
});

describe("sharpLimits 是唯一全局配置源（终审 P2）", () => {
  it("SHARP_CONCURRENCY 生效后，导入 PDF 模块不会把它打回 1", async () => {
    vi.stubEnv("SHARP_CONCURRENCY", "3");
    vi.resetModules();
    await import("../_core/sharpLimits");
    expect(sharp.concurrency()).toBe(3);
    await import("./knowledgeCardPdfExport");
    expect(sharp.concurrency()).toBe(3);
    // 重复导入同样不覆盖
    vi.resetModules();
    await import("./knowledgeCardPdfExport");
    expect(sharp.concurrency()).toBe(3);
  });
});
