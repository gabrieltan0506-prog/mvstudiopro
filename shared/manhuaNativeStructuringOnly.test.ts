import { describe, expect, it } from "vitest";
import { parseNativeDeepReadJobConfirmation } from "./manhuaNativeDeepReadJob.js";
import { assertNativeStructuringPreviousJob } from "./manhuaNativeStructuringOnly.js";
const base = { url: "https://www.douyin.com/video/12345", batchSize: 1, nativeDeepReadConfirmed: true,
  nativeMaxCalls: 200, nativePlanLimit: 1, nativeSegmentSeconds: 300, nativeVideoFps: 12, nativeStructuringModel: "qwen3.8-max" };
const params = { ...base, nativeStructuringOnly: true, nativeStructuringEpisodeIndex: 3, nativeStructuringPreviousJobId: "old-job", nativeStructuringModel: "glm-5.3" };
const previousJob = { userId: "7", status: "failed", input: { action: "manhua_template_learn", params: base }, output: { nativeModelReceipts: [{ episodeIndexes: [3] }] } };
describe("仅重新整形确认", () => {
  it("同源停止任务可双向换模型", () => {
    expect(() => assertNativeStructuringPreviousJob({ confirmation: parseNativeDeepReadJobConfirmation(params), userId: "7", previousJob })).not.toThrow();
    expect(() => assertNativeStructuringPreviousJob({ confirmation: parseNativeDeepReadJobConfirmation({ ...params, nativeStructuringModel: "qwen3.8-max" }), userId: "7",
      previousJob: { ...previousJob, input: { ...previousJob.input, params: { ...base, nativeStructuringModel: "glm-5.3" } } } })).not.toThrow();
  });
  it.each(["queued", "running"])("旧任务%s不允许并发切换", status => {
    expect(() => assertNativeStructuringPreviousJob({ confirmation: parseNativeDeepReadJobConfirmation(params), userId: "7", previousJob: { ...previousJob, status } })).toThrow("等待");
  });
  it("异源、异用户、没有目标集回执均拒绝", () => {
    const confirmation = parseNativeDeepReadJobConfirmation(params);
    expect(() => assertNativeStructuringPreviousJob({ confirmation, userId: "8", previousJob })).toThrow();
    expect(() => assertNativeStructuringPreviousJob({ confirmation: { ...confirmation, url: "https://www.douyin.com/video/99999" }, userId: "7", previousJob })).toThrow();
    expect(() => assertNativeStructuringPreviousJob({ confirmation: { ...confirmation, structuringEpisodeIndex: 4 }, userId: "7", previousJob })).toThrow("没有该集");
  });
  it("参数不可混入普通学习或批量计划", () => {
    expect(() => parseNativeDeepReadJobConfirmation({ ...params, nativeStructuringOnly: false })).toThrow();
    expect(() => parseNativeDeepReadJobConfirmation({ ...params, nativePlanLimit: 2, batchSize: 2 })).toThrow();
    expect(() => parseNativeDeepReadJobConfirmation({ ...params, nativeStructuringModel: undefined })).toThrow();
  });
});
