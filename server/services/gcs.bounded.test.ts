import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

const getVertexAccessTokenMock = vi.hoisted(() =>
  vi.fn(async () => "test-token")
);

vi.mock("../utils/vertex.js", () => ({
  getVertexAccessToken: getVertexAccessTokenMock,
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
  getVertexAccessTokenMock.mockReset();
  getVertexAccessTokenMock.mockResolvedValue("test-token");
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

  it("指定 generation 时读取 URL 同时锁定版本，并逐块交给格式验证器", async () => {
    const { response } = chunkedResponse([Buffer.from("fixed-generation")]);
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    const onChunk = vi.fn();
    const { inspectGcsObjectBounded } = await import("./gcs.js");

    const result = await inspectGcsObjectBounded({
      gcsUri: "gs://test-bucket/uploads/u7/model.glb",
      generation: "42",
      maxBytes: 64,
      onChunk,
    });

    const requested = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requested.searchParams.get("generation")).toBe("42");
    expect(requested.searchParams.get("ifGenerationMatch")).toBe("42");
    expect(result.generation).toBe("42");
    expect(onChunk).toHaveBeenCalledTimes(1);
  });

  it("格式验证器提前拒绝时取消剩余下载流", async () => {
    const { response, cancelled } = chunkedResponse([
      Buffer.from("bad!"),
      Buffer.alloc(64),
    ]);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
    const { inspectGcsObjectBounded } = await import("./gcs.js");

    await expect(
      inspectGcsObjectBounded({
        gcsUri: "gs://test-bucket/uploads/u7/invalid.glb",
        maxBytes: 128,
        onChunk: () => {
          throw new Error("invalid_glb_magic");
        },
      }),
    ).rejects.toThrow("invalid_glb_magic");
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
});

describe("rewriteGcsObjectGenerationIfAbsent", () => {
  it("同时锁定源 generation 和目标不存在，成功后返回不可变地址", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ done: true, resource: { generation: "99" } }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { rewriteGcsObjectGenerationIfAbsent } = await import("./gcs.js");

    await expect(
      rewriteGcsObjectGenerationIfAbsent({
        sourceGcsUri: "gs://test-bucket/uploads/u7/model.glb",
        sourceGeneration: "42",
        destinationObjectName: "manhua-3d/u7/imports/asset/hash/model.glb",
      }),
    ).resolves.toEqual({
      created: true,
      gcsUri: "gs://test-bucket/manhua-3d/u7/imports/asset/hash/model.glb",
      generation: "99",
    });
    const requested = fetchMock.mock.calls[0]?.[0] as URL;
    expect(requested.searchParams.get("sourceGeneration")).toBe("42");
    expect(requested.searchParams.get("ifSourceGenerationMatch")).toBe("42");
    expect(requested.searchParams.get("ifGenerationMatch")).toBe("0");
  });

  it("目标已由同内容请求建立时复用；源竞态且目标不存在时拒绝", async () => {
    const destinationMetadata = new Response(
      JSON.stringify({ generation: "99" }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(destinationMetadata)
      .mockResolvedValueOnce(new Response(null, { status: 412 }))
      .mockResolvedValueOnce(new Response(null, { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    const { rewriteGcsObjectGenerationIfAbsent } = await import("./gcs.js");
    const input = {
      sourceGcsUri: "gs://test-bucket/uploads/u7/model.glb",
      sourceGeneration: "42",
      destinationObjectName: "manhua-3d/u7/imports/asset/hash/model.glb",
    };

    await expect(rewriteGcsObjectGenerationIfAbsent(input)).resolves.toMatchObject({
      created: false,
      generation: "99",
    });
    await expect(rewriteGcsObjectGenerationIfAbsent(input)).rejects.toThrow(
      "gcs_rewrite_precondition_failed",
    );
  });
});

describe("GCS 共用截止时间", () => {
  it("metadata 取 token 阶段也受调用方 signal 约束，超时后不再发 fetch", async () => {
    getVertexAccessTokenMock.mockImplementationOnce(
      () => new Promise<string>(() => undefined)
    );
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { statGcsObjectVersion } = await import("./gcs.js");
    const controller = new AbortController();
    const pending = statGcsObjectVersion({
      gcsUri: "gs://test-bucket/uploads/u7/model.glb",
      signal: controller.signal,
    });

    controller.abort(new DOMException("deadline", "TimeoutError"));

    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
