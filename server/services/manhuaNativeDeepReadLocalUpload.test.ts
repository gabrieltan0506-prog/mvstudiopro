import { loadNativeStructuringOnlyEpisode } from "./manhuaNativeStructuringOnly.js";
import { prepareEpisodeVideos, type NativeDeepReadMediaPreparationDeps } from "./manhuaNativeDeepReadRunner.js";
import { describe, expect, it, vi } from "vitest";
import { buildManhuaLocalVideoSourceRef } from "../../shared/manhuaLocalVideoUpload.js";
import { parseNativeDeepReadJobConfirmation } from "../../shared/manhuaNativeDeepReadJob.js";
import { buildNativeDeepReadPlanPreview, type NativeDeepReadPlanDeps } from "./manhuaNativeDeepReadPlan.js";
import { buildNativeDeepReadEpisodeExecution } from "./manhuaTemplateLearnService.js";
import { resolveNativeDeepReadCacheSourceDigest, validateNativeDeepReadBatchPlan } from "./manhuaNativeDeepReadExecution.js";

const identity = { userId: "1", uploadId: "12345678-1234-4123-8123-123456789abc", sha256: "a".repeat(64) };
const source = { ...identity, sourceRef: buildManhuaLocalVideoSourceRef(identity), durationSec: 7, fileName: "本地测试.mp4" };
const confirmation = { url: source.sourceRef, localVideoUploadId: identity.uploadId, batchSize: 1,
  nativeDeepReadConfirmed: true, nativeStandaloneSource: true, nativeMaxCalls: 20, nativePlanLimit: 1,
  nativeSegmentSeconds: 3, nativeVideoFps: 2 };
const forbidden = vi.fn(async () => { throw new Error("本地来源不应发出远端请求"); });
function planDeps(overrides: Partial<NativeDeepReadPlanDeps> = {}): NativeDeepReadPlanDeps {
  return { fetchAwemeDetail: forbidden, listMixEpisodes: forbidden, refreshPlaybackUrls: forbidden,
    probeDurationSec: forbidden, resolveExternalSeries: forbidden, refreshSourcePlayback: forbidden,
    listIngestedEpisodeRecords: async () => [], listClaimStates: async () => new Map(),
    resolveSeriesKey: vi.fn(async () => "local_test"), isExecutionEnabled: () => true, ...overrides };
}
const build = (deps = planDeps()) => buildNativeDeepReadPlanPreview({ url: source.sourceRef,
  localVideoUpload: source, limit: 1, segmentSeconds: 3, videoFps: 2, treatAsStandalone: true }, deps);

describe("服务端本地上传身份 → 计划 → 执行", () => {
  it("确认契约保留上传ID，伪造地址与混合来源关闭式拒绝", () => {
    expect(parseNativeDeepReadJobConfirmation(confirmation).localVideoUploadId).toBe(identity.uploadId);
    for (const change of [{ localVideoUploadId: "" }, { localVideoUploadId: null }, { localVideoUploadId: 7 },
      { nativeStandaloneSource: false }, { localVideoUploadId: "other" }, { localVideoUploadId: undefined },
      { url: "file:///etc/passwd" }, { url: "https://www.douyin.com/video/12345" },
      { gcsUri: "gs://other/source.mp4" }, { nativePlanLimit: 2, batchSize: 2 }]) {
      expect(() => parseNativeDeepReadJobConfirmation({ ...confirmation, ...change })).toThrow();
    }
  });

  it("按7秒/每片3秒生成3片，完整保留同一来源与采样率，不调用远端解析", async () => {
    forbidden.mockClear();
    const deps = planDeps();
    const plan = await build(deps);
    expect(plan.episodes).toHaveLength(1);
    expect(plan.episodes[0]).toMatchObject({ sourceUrl: source.sourceRef, localVideoUpload: identity,
      durationSec: 7, videoFps: 2, segments: [{ startSec: 0, endSec: 3 }, { startSec: 3, endSec: 6 }, { startSec: 6, endSec: 7 }] });
    expect(plan.totalVisualCalls).toBe(3);
    expect(deps.resolveSeriesKey).toHaveBeenCalledWith(expect.objectContaining({ sourceIdentity: source.sourceRef, title: undefined, mixId: "" }));
    const mediaDeps = { probeDuration: forbidden, mediaSource: vi.fn(() => { throw new Error("禁止远端解析"); }) };
    const execution = await buildNativeDeepReadEpisodeExecution({ seriesKey: plan.seriesKey,
      ep: { index: 1, url: source.sourceRef, title: source.fileName }, localVideoUpload: source,
      confirmedPlanEpisode: plan.episodes[0], segmentSeconds: 3, videoFps: 2, provenanceSourceRef: source.sourceRef }, mediaDeps);
    expect(execution.localVideoUpload).toEqual(identity);
    expect(execution.segments).toEqual(plan.episodes[0]!.segments);
    expect(validateNativeDeepReadBatchPlan([execution], { seriesKey: plan.seriesKey, segmentSeconds: 3 }).totalSegments).toBe(3);
    expect(forbidden).not.toHaveBeenCalled();
    expect(mediaDeps.mediaSource).not.toHaveBeenCalled();
    expect(JSON.stringify(plan)).not.toContain("localPath");
    expect(JSON.stringify(execution)).not.toContain("localPath");
    expect(() => validateNativeDeepReadBatchPlan([{ ...execution, localVideoUpload: undefined }])).toThrow();
    expect(() => validateNativeDeepReadBatchPlan([{ ...execution, sourceUrl: "file:///etc/passwd" }])).toThrow();
  });

  it("归属未解析不能生成计划；来源摘要变更不能命中旧缓存", async () => {
    await expect(buildNativeDeepReadPlanPreview({ url: source.sourceRef, limit: 1 }, planDeps())).rejects.toThrow("核验归属");
    const statSourceVersion = forbidden;
    const original = await resolveNativeDeepReadCacheSourceDigest({ sourceRef: source.sourceRef, statSourceVersion });
    const repeated = await resolveNativeDeepReadCacheSourceDigest({ sourceRef: source.sourceRef, statSourceVersion });
    const changed = await resolveNativeDeepReadCacheSourceDigest({ sourceRef: buildManhuaLocalVideoSourceRef({ ...identity, sha256: "b".repeat(64) }), statSourceVersion });
    expect(original).toBe(repeated);
    expect(original).not.toBe(changed);
  });

  it("同源部分卡恢复原分片身份，成功卡不再计划付费", async () => {
    const segments = [{ startSec: 0, endSec: 3 }, { startSec: 3, endSec: 6 }, { startSec: 6, endSec: 7 }];
    const partial = await build(planDeps({ listIngestedEpisodeRecords: async () => [{ episodeIndex: 1,
      sourceUrl: source.sourceRef, complete: false, attemptedSegments: 3, completedSegmentIndexes: [0],
      segmentSpans: segments, durationSec: 7, videoFps: 2 }] }));
    expect(partial.episodes[0]).toMatchObject({ episodeIndex: 1, resumeStoredSegmentPlan: true, segments, localVideoUpload: identity });
    const completed = await build(planDeps({ listIngestedEpisodeRecords: async () => [{ episodeIndex: 1,
      sourceUrl: source.sourceRef, complete: true }] }));
    expect(completed.episodes).toEqual([]);
    expect(completed.totalModelCalls).toBe(0);
    expect(completed.alreadyIngestedEpisodeIndexes).toEqual([1]);
  });
});


describe("本地原片错误与纯JSON恢复", () => {
  it("仅重新整形从持久计划恢复三元组，不读取原片或解析媒体", async () => {
    const plan = await build();
    const download = vi.fn(async () => { throw new Error("gcs_download_failed:404"); });
    const episode = await loadNativeStructuringOnlyEpisode({ seriesKey: plan.seriesKey, episodeIndex: 1,
      segmentSeconds: 3, videoFps: 2, sourceUrl: source.sourceRef, storedPlan: plan }, { download, getBucket: () => "test-only" });
    expect(episode.localVideoUpload).toEqual(identity);
    expect(episode.sourceUrl).toBe(source.sourceRef);
    expect(validateNativeDeepReadBatchPlan([episode], { seriesKey: plan.seriesKey, segmentSeconds: 3 }).totalSegments).toBe(3);
    expect(download).toHaveBeenCalledTimes(2);
    await expect(episode.resolveNodes()).rejects.toThrow("禁止读取源视频");
  });

  it("本地切片错误不携带原片绝对路径，持久原片不被unlink", async () => {
    const localPath = "/data/private-upload/source.mp4";
    const d: NativeDeepReadMediaPreparationDeps = { resolveLocalUpload: async () => ({ ...source, localPath, bytes: 1000 }),
      statfsTmp: async () => ({ freeBytes: 2 * 1024 ** 3 }),
      runMedia: vi.fn(async () => { throw new Error(`ffmpeg输入损坏：${localPath}`); }),
      statLocal: forbidden, readLocal: forbidden, unlinkLocal: vi.fn(async () => {}), upload: forbidden, remove: forbidden };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(prepareEpisodeVideos({ episodeIndex: 1, sourceDurationSec: 7, localVideoUpload: identity,
        segments: [{ startSec: 0, endSec: 7 }], resolveNodes: forbidden }, undefined, d)).rejects.toThrow("ffmpeg输入损坏：[本地原片]");
      expect(d.unlinkLocal).not.toHaveBeenCalledWith(localPath);
      expect(d.upload).not.toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });
});
