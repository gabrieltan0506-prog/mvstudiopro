import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ download: vi.fn() }));
vi.mock("./gcs.js", async importOriginal => ({ ...await importOriginal<typeof import("./gcs.js")>(), downloadGcsObject: mocks.download }));
import { NATIVE_DEEP_READ_STRUCTURING_CACHE_CONTRACT_SHA256, readNativeDeepReadStructuredBatchCache } from "./manhuaNativeDeepReadRunner";

const legacy = "3642723bbe094d97333bb0e890223f1ed7b9cfe464823094de6c05604d0c9eac";
const rawSegments = [{ shots: [{ startSec: 0, endSec: 3, hintZh: "人物站在门边" }] }];
const input = { seriesKey: "test-coverage", sourceDigest: "a".repeat(64), episodeIndex: 1, segmentIndexes: [0], rawSegments };
const entry = (contract: string) => ({ schemaVersion: 1, frozenContractSha256: contract, ...input,
  inputDigest: createHash("sha256").update(JSON.stringify(rawSegments)).digest("hex"), raw: rawSegments[0], gateway: "openrouter" });

describe("撤销整形措辞强迫后的旧付费缓存", () => {
  it("新对象未命中后读取原路径，不重标旧回执为新参数", async () => {
    mocks.download.mockReset().mockRejectedValueOnce(new Error("gcs_download_failed:404"))
      .mockResolvedValueOnce({ buffer: Buffer.from(JSON.stringify(entry(legacy))) });
    const result = await readNativeDeepReadStructuredBatchCache(input);
    expect(result?.raw).toEqual(rawSegments[0]);
    expect(result?.frozenContractSha256).toBe(legacy);
    expect(mocks.download).toHaveBeenCalledTimes(2);
    expect(mocks.download.mock.calls[0]![0].gcsUri).toContain(NATIVE_DEEP_READ_STRUCTURING_CACHE_CONTRACT_SHA256);
    expect(mocks.download.mock.calls[1]![0].gcsUri).toContain(legacy);
  });
  it("新对象命中后不读旧路径", async () => {
    mocks.download.mockReset().mockResolvedValueOnce({ buffer: Buffer.from(JSON.stringify(entry(NATIVE_DEEP_READ_STRUCTURING_CACHE_CONTRACT_SHA256))) });
    expect((await readNativeDeepReadStructuredBatchCache(input))?.raw).toEqual(rawSegments[0]);
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
  it("权限错误或身份不符关闭式停止，不以历史回退掩盖", async () => {
    mocks.download.mockReset().mockRejectedValueOnce(new Error("gcs_download_failed:403"));
    await expect(readNativeDeepReadStructuredBatchCache(input)).rejects.toThrow("403");
    expect(mocks.download).toHaveBeenCalledTimes(1);
    mocks.download.mockReset().mockResolvedValueOnce({ buffer: Buffer.from(JSON.stringify(entry(legacy))) });
    await expect(readNativeDeepReadStructuredBatchCache(input)).rejects.toThrow("缓存身份或契约不一致");
    expect(mocks.download).toHaveBeenCalledTimes(1);
  });
});
