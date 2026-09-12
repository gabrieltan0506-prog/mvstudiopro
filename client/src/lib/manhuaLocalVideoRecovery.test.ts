import { afterEach, describe, expect, it, vi } from "vitest";
import {
  manhuaLearnResultFromStart,
  mergeManhuaLearnServerJobsIntoBasket,
  readManhuaLearnActiveJob,
  readManhuaLearnBasket,
  writeManhuaLearnActiveJob,
  writeManhuaLearnBasket,
  type ManhuaLearnActiveJobRecord,
} from "./manhuaLearnResultUi";
import { buildManhuaRestructureParams } from "./manhuaRestructure";
import type { ManhuaLearnServerJob } from "./jobs";

const uploadId = "12345678-1234-4123-8123-123456789abc";
const sourceRef = `manhua-upload://u7/${uploadId}/${"a".repeat(64)}`;
const continuation: ManhuaLearnActiveJobRecord["continuation"] = {
  row: { url: sourceRef, localVideoUploadId: uploadId, platform: "upload", fileName: "原片.mp4" },
  rank: 0, seriesKey: "native_local", nativeSegmentSeconds: 17, nativeVideoFps: 3, savedAt: 1,
};
const job: ManhuaLearnServerJob = {
  jobId: "native-local-job", status: "running", createdAt: "2026-09-12T00:00:00Z", updatedAt: "2026-09-12T00:00:01Z",
  input: { action: "manhua_template_learn", params: { url: sourceRef, localVideoUploadId: uploadId,
    fileName: "原片.mp4", platform: "upload", title: "测试原片", seriesKey: "native_local",
    nativeDeepReadConfirmed: true, nativeSegmentSeconds: 17, nativeVideoFps: 3, nativeStandaloneSource: true,
    nativeStructuringModel: "glm-5.3", nativePlanLimit: 1, batchSize: 1 } },
  output: {},
};

function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } });
}
afterEach(() => vi.unstubAllGlobals());

describe("本地上传学习恢复", () => {
  it("同一job刷新恢复保留上传ID、原来源和分片/fps，不重新入队", () => {
    storage();
    writeManhuaLearnActiveJob("7", { jobId: job.jobId, busyKey: sourceRef, continuation, savedAt: 1 });
    const restored = readManhuaLearnActiveJob("7");
    expect(restored?.jobId).toBe(job.jobId);
    expect(restored?.continuation.row).toMatchObject(continuation.row);
    expect(restored?.continuation).toMatchObject({ nativeSegmentSeconds: 17, nativeVideoFps: 3 });
    expect(readManhuaLearnActiveJob("8")).toBeNull();
    writeManhuaLearnActiveJob("8", { jobId: job.jobId, busyKey: sourceRef, continuation, savedAt: 1 });
    expect(readManhuaLearnActiveJob("8")).toBeNull();
  });

  it("服务端任务重建row后经本地篮子序列化仍保留来源契约", () => {
    storage();
    const merged = mergeManhuaLearnServerJobsIntoBasket([], [job]);
    expect(merged).toHaveLength(1);
    expect(merged[0].continuation.row).toMatchObject(continuation.row);
    const result = { ...manhuaLearnResultFromStart({ channel: "cloud", url: sourceRef, title: "测试", pipelineMode: "native_deep_read" }), pendingCount: 1 };
    writeManhuaLearnBasket("7", [{ ...merged[0], result }]);
    const restored = readManhuaLearnBasket("7");
    expect(restored).toHaveLength(1);
    expect(restored[0].continuation.row.localVideoUploadId).toBe(uploadId);
    expect(restored[0].continuation.row.url).toBe(sourceRef);
    writeManhuaLearnBasket("8", [{ ...merged[0], result }]);
    expect(readManhuaLearnBasket("8")).toEqual([]);
  });

  it("仅重整形保留原来源及参数，不触发原片查询或上传", () => {
    const params = buildManhuaRestructureParams(job, 1, "qwen3.8-max");
    expect(params).toMatchObject({ url: sourceRef, localVideoUploadId: uploadId,
      nativeStructuringOnly: true, nativeStructuringPreviousJobId: job.jobId,
      nativeSegmentSeconds: 17, nativeVideoFps: 3, nativeStandaloneSource: true });
  });
});
