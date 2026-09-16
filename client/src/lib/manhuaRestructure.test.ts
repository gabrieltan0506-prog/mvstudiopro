import { describe, expect, it } from "vitest";
import type { ManhuaLearnServerJob } from "./jobs";
import { buildManhuaRestructureParams } from "./manhuaRestructure";
const original = { url: "https://example.com/show", nativeDeepReadConfirmed: true, nativeReadModel: "gemini-3.8-flash", nativeSegmentSeconds: 317, nativeVideoFps: 12, nativeStandaloneSource: true, nativeStructuringModel: "glm-5.3", nativePlanHash: "old-hash", nativePlanSeriesKey: "old-series", nativePlanLimit: 9, batchSize: 9, refreshPreviewFrames: true, retrySkippedEpisodes: true };
const job = (params: Record<string, unknown> = original): ManhuaLearnServerJob => ({ jobId: "old-job", status: "failed", input: { action: "manhua_template_learn", params } });
describe("只重新整形参数", () => {
  it("保留原视频身份和读片配置，仅指定单集读已有JSON且移除旧计划", () => {
    const before = JSON.stringify(original);
    const result = buildManhuaRestructureParams(job(), 7, "glm-5.3");
    expect(result).toMatchObject({ url: original.url, nativeReadModel: original.nativeReadModel, nativeSegmentSeconds: 317, nativeVideoFps: 12, nativeStandaloneSource: true, nativeStructuringOnly: true, nativeStructuringEpisodeIndex: 7, nativeStructuringPreviousJobId: "old-job", nativeStructuringModel: "glm-5.3", nativePlanLimit: 1, batchSize: 1, refreshPreviewFrames: false, retrySkippedEpisodes: false });
    expect(result).not.toHaveProperty("nativePlanHash"); expect(result).not.toHaveProperty("nativePlanSeriesKey");
    expect(JSON.stringify(original)).toBe(before);
  });
  it("Qwen 已下架，明确拒绝旧值", () => {
    expect(() => buildManhuaRestructureParams(job(), 1, "qwen3.8-max" as never)).toThrow("只允许 GLM-5.3");
  });
  it.each([0, -1, 1.2, 10000, Number.NaN])("拒绝非法集号%s", (episode) => {
    expect(() => buildManhuaRestructureParams(job(), episode, "glm-5.3")).toThrow("有效集号");
  });
  it("缺省模型按 GLM 处理，允许只重新整形", () => {
    expect(buildManhuaRestructureParams(job({ ...original, nativeStructuringModel: undefined }), 1, "glm-5.3").nativeStructuringModel).toBe("glm-5.3");
  });
  it("拒绝缺少原生来源，不能退化为普通读视频任务", () => {
    expect(() => buildManhuaRestructureParams(job({ ...original, nativeDeepReadConfirmed: false }), 1, "glm-5.3")).toThrow("原生学习参数");
    expect(() => buildManhuaRestructureParams(job({ ...original, url: undefined }), 1, "glm-5.3")).toThrow("原生学习参数");
  });
});
