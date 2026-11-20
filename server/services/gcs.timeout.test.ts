/**
 * 存取时限：替身 fetch 永不返回时，在设定时间内报 network 类瞬态错误；调用方中止仍原样抛中止原因；
 * 大对象按体积放宽。
 */
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../utils/vertex", () => ({ getVertexAccessToken: async () => "test-token" }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const hangingFetch = () => vi.fn((_url: unknown, init: RequestInit = {}) => new Promise<Response>((_, reject) => {
  // 模拟真实 undici：signal 中止时以中止原因拒绝；但部分用例刻意不理会 signal。
  init.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
}));
const deafFetch = () => vi.fn(() => new Promise<Response>(() => undefined));

describe("GCS 单次存取时限", () => {
  it("时限按环境变量与体积计算", async () => {
    const { gcsRequestTimeoutMs } = await import("./gcs");
    expect(gcsRequestTimeoutMs()).toBe(60_000);
    expect(gcsRequestTimeoutMs(57_873_370)).toBe(60_000 + 5 * 30_000);
    vi.stubEnv("GCS_REQUEST_TIMEOUT_MS", "1000");
    vi.stubEnv("GCS_REQUEST_TIMEOUT_PER_10MB_MS", "10");
    expect(gcsRequestTimeoutMs(10 * 1024 * 1024 + 1)).toBe(1010);
  });

  for (const [name, makeFetch] of [["响应 signal 的", hangingFetch], ["不理会 signal 的", deafFetch]] as const) {
    it(`${name}永不返回替身：stat/下载/上传/列举都在时限内报 network 超时`, async () => {
      vi.stubEnv("GCS_REQUEST_TIMEOUT_MS", "40");
      vi.stubGlobal("fetch", makeFetch());
      const gcs = await import("./gcs");
      const started = Date.now();
      await expect(gcs.statGcsObjectVersion({ gcsUri: "gs://b/a.json" })).rejects.toThrow(/^gcs_stat_failed:network:timeout_40ms$/);
      await expect(gcs.downloadGcsObject({ gcsUri: "gs://b/a.json" })).rejects.toThrow(/^gcs_download_failed:network:timeout_40ms$/);
      await expect(gcs.uploadBufferToGcs({ objectName: "a.json", buffer: Buffer.from("{}"), contentType: "application/json" }))
        .rejects.toThrow(/^gcs_upload_failed:network:timeout_\d+ms$/);
      await expect(gcs.listGcsObjectNamesByPrefix({ prefix: "p" })).rejects.toThrow(/^gcs_list_failed:network:gcs_list_failed:network:timeout_40ms/);
      expect(Date.now() - started).toBeLessThan(5_000);
    });
  }

  it("调用方中止时抛调用方原因，不改写成超时", async () => {
    vi.stubEnv("GCS_REQUEST_TIMEOUT_MS", "5000");
    vi.stubGlobal("fetch", hangingFetch());
    const { statGcsObjectVersion } = await import("./gcs");
    const controller = new AbortController();
    const pending = statGcsObjectVersion({ gcsUri: "gs://b/a.json", signal: controller.signal });
    controller.abort(new Error("caller_cancelled"));
    await expect(pending).rejects.toThrow("caller_cancelled");
  });

  it("超时错误被知识版检查点重试识别为瞬态并在恢复后取到结果", async () => {
    vi.stubEnv("GCS_REQUEST_TIMEOUT_MS", "30");
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit = {}) => {
      calls += 1;
      if (calls === 1) return new Promise<Response>((_, reject) => init.signal?.addEventListener("abort", () => reject(init.signal!.reason)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }));
    const { downloadGcsObject } = await import("./gcs");
    const { guardKnowledgeEditionEvidence } = await import("./knowledgeEditionRecovery");
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const evidence = guardKnowledgeEditionEvidence({
        prefix: "p",
        read: async key => JSON.parse((await downloadGcsObject({ gcsUri: `gs://b/${key}` })).buffer.toString()),
        save: async () => undefined,
      });
      const result = evidence.read("a.json");
      await vi.advanceTimersByTimeAsync(30);
      await vi.advanceTimersByTimeAsync(3_000);
      expect(await result).toEqual({ ok: true });
      expect(calls).toBe(2);
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
    }
  });

});
