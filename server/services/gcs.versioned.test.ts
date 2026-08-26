/**
 * GCS 版本化读取与条件删除。
 *
 * 背景：下架流程是「读旧版 → 写归档 → 删原件」。期间若有人批准了新版本，
 * 无条件 DELETE 会把刚写入的新版本一起删掉。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/vertex.js", () => ({
  getVertexAccessToken: async () => "test-token",
  getGcsUserProject: () => "",
}));

const calls: Array<{ url: string; method: string }> = [];
function stubFetch(handler: (url: string, init: RequestInit) => { status: number; body?: unknown }) {
  calls.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown, init: RequestInit = {}) => {
      const url = String(input);
      calls.push({ url, method: String(init.method || "GET") });
      const r = handler(url, init);
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body ?? {},
        text: async () => JSON.stringify(r.body ?? {}),
        arrayBuffer: async () => new TextEncoder().encode(JSON.stringify(r.body ?? {})).buffer,
      };
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("downloadGcsObjectVersioned / deleteGcsObject 条件删除", () => {
  it("uploadBufferToGcs 条件覆写必须把 ifGenerationMatch 发出去", async () => {
    stubFetch(() => ({ status: 200, body: { name: "x" } }));
    const { uploadBufferToGcs } = await import("./gcs");
    await uploadBufferToGcs({
      objectName: "claims/ep001.json",
      buffer: Buffer.from("{}"),
      contentType: "application/json",
      ifGenerationMatch: "88",
    });
    expect(calls[0]!.method).toBe("POST");
    expect(calls[0]!.url).toContain("ifGenerationMatch=88");
  });

  it("metadata 拿到 generation=77 后，媒体请求必须带 alt=media 与 generation=77", async () => {
    stubFetch((url) =>
      url.includes("alt=media")
        ? { status: 200, body: { ok: true } }
        : { status: 200, body: { generation: "77" } },
    );
    const { downloadGcsObjectVersioned } = await import("./gcs");
    const out = await downloadGcsObjectVersioned({ gcsUri: "gs://b/o/x.json" });
    expect(out.generation).toBe("77");
    const media = calls.find((c) => c.url.includes("alt=media"))!;
    expect(media.url).toContain("generation=77");
  });

  it("deleteGcsObject 必须把 ifGenerationMatch 发出去", async () => {
    stubFetch(() => ({ status: 204 }));
    const { deleteGcsObject } = await import("./gcs");
    await deleteGcsObject({ objectName: "o/x.json", ifGenerationMatch: "77" });
    expect(calls[0]!.method).toBe("DELETE");
    expect(calls[0]!.url).toContain("ifGenerationMatch=77");
  });

  it("DELETE 412 转成 gcs_delete_generation_conflict（不能当成功）", async () => {
    stubFetch(() => ({ status: 412 }));
    const { deleteGcsObject } = await import("./gcs");
    await expect(
      deleteGcsObject({ objectName: "o/x.json", ifGenerationMatch: "77" }),
    ).rejects.toThrow("gcs_delete_generation_conflict");
  });

  it("metadata 503 保留原始分类，不许改写成不存在", async () => {
    stubFetch(() => ({ status: 503 }));
    const { downloadGcsObjectVersioned } = await import("./gcs");
    await expect(downloadGcsObjectVersioned({ gcsUri: "gs://b/o/x.json" })).rejects.toThrow(
      "gcs_stat_failed:503",
    );
  });

  // ⚠️ 这是**顺序模拟**（先 200 后 412），不是真并发 —— 真并发要多进程打同一个桶，
  // 本地跑不了。这里锁的是两点：条件写参数发对了、412 被当成「已存在」而不是失败。
  // 真正的互斥由 GCS 服务端的 ifGenerationMatch=0 语义保证。
  it("条件写入：对象已存在时返回 created=false 而不抛错，且参数带 ifGenerationMatch=0", async () => {
    let first = true;
    stubFetch(() => {
      if (first) {
        first = false;
        return { status: 200, body: { name: "x" } };
      }
      return { status: 412 };
    });
    const { uploadBufferToGcsIfAbsent } = await import("./gcs");
    const a = await uploadBufferToGcsIfAbsent({
      objectName: "archive/t/77.json",
      buffer: Buffer.from("a"),
      contentType: "application/json",
    });
    const b = await uploadBufferToGcsIfAbsent({
      objectName: "archive/t/77.json",
      buffer: Buffer.from("b"),
      contentType: "application/json",
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(calls[0]!.url).toContain("ifGenerationMatch=0");
  });
});
