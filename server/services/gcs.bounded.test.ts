import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/vertex.js", () => ({
  getVertexAccessToken: async () => "test-token",
}));

function chunkedResponse(
  chunks: Buffer[],
  headers: HeadersInit = {}
): { response: Response; cancelled: ReturnType<typeof vi.fn> } {
  const cancelled = vi.fn();
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const chunk = chunks[index++];
      if (!chunk) {
        controller.close();
        return;
      }
      controller.enqueue(chunk);
    },
    cancel(reason) {
      cancelled(reason);
    },
  });
  return { response: new Response(body, { status: 200, headers }), cancelled };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("inspectGcsObjectBounded", () => {
  it("用真实 ReadableStream 逐块统计，只保留文件头与摘要", async () => {
    const chunks = [
      Buffer.from("glTF"),
      Buffer.from([2, 0, 0, 0]),
      Buffer.from([16, 0, 0, 0, 1, 2, 3, 4]),
    ];
    const complete = Buffer.concat(chunks);
    const { response } = chunkedResponse(chunks);
    const arrayBuffer = vi.spyOn(response, "arrayBuffer");
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const { inspectGcsObjectBounded } = await import("./gcs.js");

    const result = await inspectGcsObjectBounded({
      gcsUri: "gs://test-bucket/uploads/u7/model.glb",
      maxBytes: 32,
      headerBytes: 12,
      timeoutMs: 1_000,
    });

    expect(result).toEqual({
      bucket: "test-bucket",
      objectName: "uploads/u7/model.glb",
      byteLength: complete.byteLength,
      header: complete.subarray(0, 12),
      sha256: createHash("sha256").update(complete).digest("hex"),
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({ method: "GET", redirect: "error" })
    );
  });

  it("Content-Length 已知超限时在读取流之前拒绝并取消响应体", async () => {
    const { response, cancelled } = chunkedResponse([Buffer.alloc(64)], {
      "content-length": "64",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { inspectGcsObjectBounded } = await import("./gcs.js");

    await expect(
      inspectGcsObjectBounded({
        gcsUri: "gs://test-bucket/uploads/u7/declared-large.glb",
        maxBytes: 12,
      })
    ).rejects.toThrow("gcs_download_too_large");
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("Content-Length 缺失时按累计流量超限关闭式拒绝", async () => {
    const { response, cancelled } = chunkedResponse([
      Buffer.alloc(8, 1),
      Buffer.alloc(8, 2),
      Buffer.alloc(8, 3),
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { inspectGcsObjectBounded } = await import("./gcs.js");

    await expect(
      inspectGcsObjectBounded({
        gcsUri: "gs://test-bucket/uploads/u7/streamed-large.glb",
        maxBytes: 12,
      })
    ).rejects.toThrow("gcs_download_too_large");
    expect(cancelled).toHaveBeenCalledTimes(1);
  });

  it("下载建立阶段超过截止时间会中止，不会无限占用并发槽", async () => {
    const fetchMock = vi.fn(
      (_input: unknown, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason),
            { once: true }
          );
        })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { inspectGcsObjectBounded } = await import("./gcs.js");

    await expect(
      inspectGcsObjectBounded({
        gcsUri: "gs://test-bucket/uploads/u7/stalled.glb",
        maxBytes: 32,
        timeoutMs: 10,
      })
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
