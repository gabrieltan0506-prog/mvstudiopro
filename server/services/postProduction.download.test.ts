/**
 * 素材下载限额测试:
 * - content-length 超单素材上限立即拒;
 * - 无 content-length 的流边下边数,超限中止读取;
 * - 拼接累计预算耗尽后,后续素材不再读取;
 * - 任务 signal 已中止时不发起处理。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

vi.mock("./gcs.js", () => ({
  downloadGcsObject: vi.fn(async () => ({ buffer: Buffer.alloc(8) })),
  signGsUriV4ReadUrl: vi.fn(() => "https://signed"),
  uploadBufferToGcs: vi.fn(async () => ({ gcsUri: "gs://sys/out" })),
}));

import {
  fetchPostProdSourceToFile,
  MAX_SOURCE_BYTES,
  type DownloadBudget,
} from "./postProduction";

const NEVER = new AbortController().signal;
let tmp: string;

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
});

async function tmpFile(): Promise<string> {
  tmp = await mkdtemp(path.join(tmpdir(), "pp-dl-test-"));
  return path.join(tmp, "out.bin");
}

describe("fetchPostProdSourceToFile 限额", () => {
  it("content-length 超上限立即拒,不读流", async () => {
    const fetchMock = vi.fn(async () =>
      streamResponse([new Uint8Array(4)], {
        "content-length": String(MAX_SOURCE_BYTES + 1),
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      fetchPostProdSourceToFile("https://storage.googleapis.com/b/x.mp4", await tmpFile(), {
        signal: NEVER,
      }),
    ).rejects.toThrow(/体积超过上限/);
  });

  it("无 content-length 的流超限即中止", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => streamResponse([new Uint8Array(6), new Uint8Array(6)])),
    );
    await expect(
      fetchPostProdSourceToFile("https://storage.googleapis.com/b/x.mp4", await tmpFile(), {
        signal: NEVER,
        maxBytes: 10,
      }),
    ).rejects.toThrow(/体积超过上限/);
  });

  it("拼接累计预算耗尽后停止处理", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => streamResponse([new Uint8Array(8)])));
    const budget: DownloadBudget = { remainingBytes: 10 };
    const f1 = await tmpFile();
    await fetchPostProdSourceToFile("https://storage.googleapis.com/b/a.mp4", f1, {
      signal: NEVER,
      budget,
    });
    expect(budget.remainingBytes).toBe(2);
    await expect(
      fetchPostProdSourceToFile(
        "https://storage.googleapis.com/b/b.mp4",
        path.join(tmp, "second.bin"),
        { signal: NEVER, budget },
      ),
    ).rejects.toThrow(/体积超过上限/);
  });

  it("gs:// 下载后也按预算记账", async () => {
    const budget: DownloadBudget = { remainingBytes: 100 };
    await fetchPostProdSourceToFile("gs://sys/x.mp4", await tmpFile(), {
      signal: NEVER,
      budget,
    });
    expect(budget.remainingBytes).toBe(92);
  });

  it("signal 已中止时直接拒绝", async () => {
    const c = new AbortController();
    c.abort(new Error("task limit"));
    await expect(
      fetchPostProdSourceToFile("gs://sys/x.mp4", await tmpFile(), { signal: c.signal }),
    ).rejects.toThrow();
  });
});
