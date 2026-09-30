import { expect, it } from "vitest";
import { defaultCanvasBlock } from "./canvasTypes";
import { buildManhuaAdvisorGenerationMonitor, advisorGenerationContextZh } from "./manhuaAdvisorGenerationMonitor";

it("监看本集任务失败和待核实，排除异集与归档，不把完成回执当回填", () => {
  const blocks = [
    { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01", episodeIndex: 1, videoTaskId: "same-task", videoTaskStatus: "timed_out_pending_reconcile" as const },
    { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g02", episodeIndex: 1, videoTaskStatus: "succeeded" as const },
    { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g03", episodeIndex: 1, videoTaskStatus: "failed" as const, error: "输入超限" },
    { ...defaultCanvasBlock("video", 0, 0), id: "clip-e02-g01", episodeIndex: 2, videoTaskStatus: "failed" as const, error: "异集错误" },
    { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-old", episodeIndex: 1, archivedFromPreviousScript: true, videoTaskStatus: "failed" as const, error: "归档错误" },
  ];
  const input = { blocks, refs: [], issues: [], episodeIndex: 1, hasScript: true };
  const before = JSON.stringify(input);
  const steps = buildManhuaAdvisorGenerationMonitor(input);
  const text = advisorGenerationContextZh(steps);
  expect(text).toContain("same-task"); expect(text).toContain("不要重复提交");
  expect(text).toContain("草稿没有可读取的产物"); expect(text).toContain("输入超限");
  expect(text).not.toMatch(/异集错误|归档错误/);
  expect(steps.find(s => s.id === "video")?.state).toBe("blocked");
  expect(JSON.stringify(input)).toBe(before);
  expect(buildManhuaAdvisorGenerationMonitor(JSON.parse(before))).toEqual(steps);
});

it("节点回填后同任务从待核实变已有产物，保留音轨失败并过滤错误中的媒体与凭证", () => {
  const block = { ...defaultCanvasBlock("video", 0, 0), id: "clip-e01-g01", episodeIndex: 1, videoTaskId: "same-task", videoTaskStatus: "succeeded" as const, outputUrl: "https://example.com/output.mp4", audioStudio: { schemaVersion: 1 as const, cues: [], musicJobIds: [], pendingOperations: [{ id: "audio-one", kind: "dialogue" as const, inputKey: "test", errorZh: "连接失败 https://example.com/private?token=test bearer test-key" }] } };
  const steps = buildManhuaAdvisorGenerationMonitor({ blocks: [block], refs: [], issues: [], episodeIndex: 1, hasScript: true });
  expect(steps.find(s => s.id === "video")?.state).toBe("output");
  expect(steps.find(s => s.id === "audio")?.state).toBe("blocked");
  expect(advisorGenerationContextZh(steps)).not.toMatch(/https:|test-key/);
});

it("生成同时发生阻断仍显示两种状态，静帧建议不默认重出全部旧图", () => {
  const steps = buildManhuaAdvisorGenerationMonitor({ blocks: [{ ...defaultCanvasBlock("image", 0, 0), id: "keyart-e01-001", episodeIndex: 1, status: "running" }], refs: [], episodeIndex: 1, hasScript: true, issues: [{ id: "keyframe", phase: "storyboard", blocking: true, text: "版本需核对" }] });
  const keyart = steps.find(s => s.id === "keyart")!;
  expect(keyart.state).toBe("blocked"); expect(keyart.summary).toContain("1 项处理中");
  expect(keyart.problems[0]?.resolution).toContain("仅改对白或时长");
});
