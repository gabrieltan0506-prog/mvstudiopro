import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ receipt: null as any, reads: vi.fn(), saves: vi.fn(), stage: vi.fn(), materialize: vi.fn() }));
vi.mock("./heavyMediaEvidence", () => ({ readHeavyMediaResult: (...args: any[]) => { state.reads(...args); return Promise.resolve(state.receipt); }, saveHeavyMediaResult: (...args: any[]) => { state.saves(...args); state.receipt = args[2]; return Promise.resolve({}); } }));
vi.mock("./heavyLearnMedia", () => ({ stageHeavyMediaFile: (...args: any[]) => state.stage(...args), materializeHeavyMediaSource: (...args: any[]) => state.materialize(...args) }));
vi.mock("./gcs", () => ({ getGcsBucketName: () => "test-bucket" }));
import { manhuaLocalVideoUploadService, resolveOwnedManhuaLocalVideoUpload, withPortableManhuaLocalVideoSource } from "./manhuaLocalVideoUploadService";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { buildManhuaLocalVideoSourceRef } from "../../shared/manhuaLocalVideoUpload";
const uploadId = "11111111-1111-4111-8111-111111111111";
const sha256 = "a".repeat(64);
const source = { userId: "7", uploadId, sha256, fileName: "test.mp4", bytes: 3, durationSec: 12, sourceRef: buildManhuaLocalVideoSourceRef({ userId: "7", uploadId, sha256 }) };
const gcsUri = `gs://test-bucket/heavy-media-sources/u7/${sha256}.mp4`;
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); vi.clearAllMocks(); state.receipt = null; });
describe("父学习跨机上传来源", () => {
  it("网站核验后只发布稳定身份，不发布磁盘路径；已有回执不重复备份", async () => {
    vi.stubEnv("MANHUA_HEAVY_WORKER_SPLIT", "1"); vi.stubEnv("JOB_WORKER_ROLE", "app");
    vi.spyOn(manhuaLocalVideoUploadService, "resolveOwned").mockResolvedValue({ ...source, localPath: "/test-only/source" });
    state.stage.mockResolvedValue(gcsUri);
    await resolveOwnedManhuaLocalVideoUpload({ userId: "7", uploadId });
    expect(state.receipt).toEqual({ ...source, gcsUri });
    expect(state.receipt.localPath).toBeUndefined();
    await resolveOwnedManhuaLocalVideoUpload({ userId: "7", uploadId });
    expect(state.stage).toHaveBeenCalledTimes(1);
  });
  it("工作机一条任务只物化一次，计划和备料共用同源；退出后不能复用上下文", async () => {
    vi.stubEnv("MANHUA_HEAVY_WORKER_SPLIT", "1"); vi.stubEnv("JOB_WORKER_ROLE", "rig");
    state.receipt = { ...source, gcsUri };
    const dir = await mkdtemp(`${tmpdir()}/portable-source-test-`); const localPath = `${dir}/bytes`; await writeFile(localPath, "abc");
    state.materialize.mockImplementation(async (_uri, work) => work(localPath));
    try {
      await withPortableManhuaLocalVideoSource("7", { params: { localVideoUploadId: uploadId, url: source.sourceRef } }, async () => {
        expect((await resolveOwnedManhuaLocalVideoUpload({ userId: "7", uploadId })).localPath).toBe(localPath);
        expect((await resolveOwnedManhuaLocalVideoUpload({ userId: "7", uploadId })).sha256).toBe(sha256);
        await expect(resolveOwnedManhuaLocalVideoUpload({ userId: "8", uploadId })).rejects.toThrow("已核验");
      });
      expect(state.materialize).toHaveBeenCalledTimes(1);
      await expect(resolveOwnedManhuaLocalVideoUpload({ userId: "7", uploadId })).rejects.toThrow("已核验");
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  it("错归属/错SHA地址拒绝物化，JSON重整形不需要原片", async () => {
    state.receipt = { ...source, gcsUri: gcsUri.replace("u7/", "u8/") };
    await expect(withPortableManhuaLocalVideoSource("7", { params: { localVideoUploadId: uploadId, url: source.sourceRef } }, async () => null)).rejects.toThrow("指纹不一致");
    expect(state.materialize).not.toHaveBeenCalled();
    expect(await withPortableManhuaLocalVideoSource("7", { params: { localVideoUploadId: uploadId, nativeStructuringOnly: true } }, async () => "stored-json")).toBe("stored-json");
  });
});
