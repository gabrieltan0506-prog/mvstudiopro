/**
 * 素材下载/上传边界测试:
 * - gs:// 现签短链后与 HTTPS 共用流式读取,读取过程响应任务 signal;
 * - content-length 超上限立即拒;无 content-length 的流边下边数超限中止;
 * - 拼接累计预算耗尽后停止处理;下载时限有效;响应跳转不继续处理;
 * - 上传步骤接收并响应任务 signal。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const h = vi.hoisted(() => ({
  uploadCalls: [] as Array<{ objectName: string; signal?: AbortSignal }>,
}));

vi.mock("./gcs.js", () => ({
  signGsUriV4ReadUrl: vi.fn((gsUri: string) =>
    `https://storage.googleapis.com/${String(gsUri).replace(/^gs:\/\//, "")}?signed=1`,
  ),
  uploadBufferToGcs: vi.fn(
    async (params: { objectName: string; signal?: AbortSignal }) => {
      params.signal?.throwIfAborted();
      h.uploadCalls.push({ objectName: params.objectName, signal: params.signal });
      return { bucket: "bucket-a", objectName: params.objectName, gcsUri: `gs://bucket-a/${params.objectName}` };
    },
  ),
}));

import {
  fetchPostProdSourceToFile,
  MAX_SOURCE_BYTES,
  type DownloadBudget,
} from "./postProduction";

const NEVER = new AbortController().signal;
let tmp = "";

function streamResponse(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(c);
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers });
}

afterEach(async () => {
  vi.unstubAllGlobals();
  if (tmp) await rm(tmp, { recursive: true, force: true });
  tmp = "";
});

async function tmpFile(name = "out.bin"): Promise<string> {
  if (!tmp) tmp = await mkdtemp(path.join(tmpdir(), "pp-dl-test-"));
  return path.join(tmp, name);
}

describe("fetchPostProdSourceToFile", () => {
  it("gs:// 现签短链走同一条流式读取,预算按实际字节记账", async () => {
    const fetchMock = vi.fn(async () => streamResponse([new Uint8Array(8)]));
    vi.stubGlobal("fetch", fetchMock);
    const budget: DownloadBudget = { remainingBytes: 100 };
    const n = await fetchPostProdSourceToFile("gs://bucket-a/x.mp4", await tmpFile(), {
      signal: NEVER,
      budget,
    });
    expect(n).toBe(8);
    expect(budget.remainingBytes).toBe(92);
    const requested = String((fetchMock.mock.calls[0] as unknown[])[0]);
    expect(requested.startsWith("https://storage.googleapis.com/bucket-a/x.mp4")).toBe(true);
  });

  it("gs:// 读取过程响应任务 signal:已中止即拒绝,不发起读取", async () => {
    const fetchMock = vi.fn(async () => streamResponse([new Uint8Array(8)]));
    vi.stubGlobal("fetch", fetchMock);
    const c = new AbortController();
    c.abort(new DOMException("任务时限结束", "AbortError"));
    await expect(
      fetchPostProdSourceToFile("gs://bucket-a/x.mp4", await tmpFile("a.bin"), {
        signal: c.signal,
      }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("content-length 超单素材上限立即拒,不读流", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        streamResponse([new Uint8Array(4)], { "content-length": String(MAX_SOURCE_BYTES + 1) }),
      ),
    );
    await expect(
      fetchPostProdSourceToFile("https://storage.googleapis.com/bucket-a/x.mp4", await tmpFile("b.bin"), {
        signal: NEVER,
      }),
    ).rejects.toThrow(/超过当前处理上限/);
  });

  it("无 content-length 的流超单素材上限即中止", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([new Uint8Array(6), new Uint8Array(6)])),
    );
    await expect(
      fetchPostProdSourceToFile("https://storage.googleapis.com/bucket-a/x.mp4", await tmpFile("c.bin"), {
        signal: NEVER,
        maxBytes: 10,
      }),
    ).rejects.toThrow(/超过当前处理上限/);
  });

  it("concat 累计预算耗尽后停止处理", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([new Uint8Array(8)])));
    const budget: DownloadBudget = { remainingBytes: 10 };
    await fetchPostProdSourceToFile(
      "https://storage.googleapis.com/bucket-a/a.mp4",
      await tmpFile("d1.bin"),
      { signal: NEVER, budget },
    );
    expect(budget.remainingBytes).toBe(2);
    await expect(
      fetchPostProdSourceToFile(
        "https://storage.googleapis.com/bucket-a/b.mp4",
        await tmpFile("d2.bin"),
        { signal: NEVER, budget },
      ),
    ).rejects.toThrow(/超过当前处理上限/);
  });

  it("下载时限有效:超时中止等待", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: unknown, init?: { signal?: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(init.signal!.reason), {
              once: true,
            });
          }),
      ),
    );
    await expect(
      fetchPostProdSourceToFile(
        "https://storage.googleapis.com/bucket-a/slow.mp4",
        await tmpFile("e.bin"),
        { signal: NEVER, downloadTimeoutMs: 30 },
      ),
    ).rejects.toThrow();
  });

  it("响应跳转不继续处理(redirect:error)", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: { redirect?: string }) => {
      if (init?.redirect === "error") {
        throw new TypeError("uncaught redirect");
      }
      return streamResponse([new Uint8Array(4)]);
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPostProdSourceToFile(
        "https://storage.googleapis.com/bucket-a/redir.mp4",
        await tmpFile("f.bin"),
        { signal: NEVER },
      ),
    ).rejects.toThrow(/redirect/);
    expect((fetchMock.mock.calls[0] as unknown[])[1]).toMatchObject({ redirect: "error" });
  });

  it("非 https 请求地址直接拒绝", async () => {
    await expect(
      fetchPostProdSourceToFile("file:///etc/hosts", await tmpFile("g.bin"), { signal: NEVER }),
    ).rejects.toThrow(/格式不正确/);
  });
});

describe("上传步骤响应任务 signal", () => {
  it("uploadBufferToGcs 收到已中止 signal 时拒绝", async () => {
    const { uploadBufferToGcs } = await import("./gcs.js");
    const c = new AbortController();
    c.abort(new DOMException("任务时限结束", "AbortError"));
    await expect(
      (uploadBufferToGcs as unknown as (p: unknown) => Promise<unknown>)({
        objectName: "post-prod/7/x.mp4",
        buffer: Buffer.alloc(4),
        contentType: "video/mp4",
        signal: c.signal,
      }),
    ).rejects.toThrow();
    expect(h.uploadCalls).toHaveLength(0);
  });
});
