import { beforeEach, describe, expect, it, vi } from "vitest";
const repo = vi.hoisted(() => ({ getJobByIdStrict: vi.fn() }));
vi.mock("../jobs/repository", () => repo);
import { parseSongOperationSourceReference, resolveSongOperationSource } from "./songOperationSource";

const variant = { index: 1, musicId: "real-variant-b", gcsUri: "gs://test-bucket/post-prod/7/song-b.mp3", durationSec: 35, bytes: 1000 };
const source = { candidateId: "bgm-original:1", musicId: "forged-client-id" };
const job = (output: unknown = { variants: [variant], upstreamTaskId: "ttapi:original" }) => ({
  id: "bgm-original", userId: "7", type: "audio", status: "succeeded", input: { action: "manhua_bgm_v55" }, output,
});
describe("歌曲原始身份按本人任务回执解析", () => {
  beforeEach(() => repo.getJobByIdStrict.mockReset());
  it.each([false, true])("兼容直接及terminalOutput回执 %s，忽略客户端伪造musicId", async nested => {
    const output = { variants: [variant], upstreamTaskId: "ttapi:original" };
    repo.getJobByIdStrict.mockResolvedValue(job(nested ? { terminalOutput: output } : output));
    await expect(resolveSongOperationSource("7", source, { requireMusicId: true })).resolves.toEqual({
      jobId: "bgm-original", variantIndex: 1, musicId: "real-variant-b", gcsUri: variant.gcsUri, durationSec: 35, providerTaskId: "ttapi:original",
    });
    expect(repo.getJobByIdStrict).toHaveBeenCalledWith("bgm-original");
  });
  it("旧音频可作为上传参考，但无musicId不允许需要身份的操作", async () => {
    repo.getJobByIdStrict.mockResolvedValue(job({ variants: [{ index: 1, gcsUri: variant.gcsUri, bytes: 1000 }] }));
    await expect(resolveSongOperationSource(7, source)).resolves.toEqual({ jobId: "bgm-original", variantIndex: 1, gcsUri: variant.gcsUri });
    await expect(resolveSongOperationSource(7, source, { requireMusicId: true })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("其他用户、未完成及非歌曲任务被拒绝", async () => {
    for (const [patch, code] of [[{ userId: "8" }, "FORBIDDEN"], [{ status: "running" }, "PRECONDITION_FAILED"], [{ type: "video" }, "BAD_REQUEST"], [{ input: { action: "other" } }, "BAD_REQUEST"]] as const) {
      repo.getJobByIdStrict.mockResolvedValue({ ...job(), ...patch });
      await expect(resolveSongOperationSource(7, source)).rejects.toMatchObject({ code });
    }
  });
  it("候选、显式任务及版本不一致或非法版本不查询数据库", () => {
    for (const ref of [{ ...source, jobId: "other" }, { ...source, variantIndex: 0 }, { jobId: "bgm-original", variantIndex: -1 }, { candidateId: "uploaded-audio" }])
      expect(() => parseSongOperationSourceReference(ref)).toThrow();
    expect(repo.getJobByIdStrict).not.toHaveBeenCalled();
    expect(parseSongOperationSourceReference({ musicJobId: "bgm-original", variantIndex: 1 })).toEqual({ jobId: "bgm-original", variantIndex: 1 });
  });
  it("不允许用任意音频冒充已拥有的变体", async () => {
    repo.getJobByIdStrict.mockResolvedValue(job());
    await expect(resolveSongOperationSource(7, { ...source, gcsUri: "gs://other/track.mp3" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });
  it("重复、缺失变体与未永久保存音频拒绝继续", async () => {
    for (const variants of [[variant, variant], [], [{ ...variant, bytes: 0 }], [{ ...variant, gcsUri: "https://cdn/temporary.mp3" }]]) {
      repo.getJobByIdStrict.mockResolvedValue(job({ variants }));
      await expect(resolveSongOperationSource(7, source)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    }
  });
});
