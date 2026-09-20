import { emptyManhuaClipQualityChecks, type ManhuaClipQualityReport } from "@shared/manhuaClipQuality";
import { expect, it } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { summarizeManhuaDeliverySegments } from "./manhuaDeliverySegmentSummary";
import { resolveShotsForEpisodeKeyarts } from "./canvasDramaStudio";
import { groupShotsIntoSegments } from "@shared/manhuaScriptWorkbench";
import { buildManhuaAutoSegmentBinding } from "@shared/manhuaAutoSegment";

const report = (status: ManhuaClipQualityReport["status"]): ManhuaClipQualityReport => ({ status, checks: emptyManhuaClipQualityChecks(), failedKeys: [], summary: "测试回执", raw: "", attempts: 1, reviewedAt: "2026-09-21T00:00:00+08:00" });
const model = "seedance-2.0";
const story: CanvasBlock = { ...defaultCanvasBlock("text", 0, 0), id: "beats-e01-plan", episodeIndex: 1,
  outputText: "| 镜号 | 秒位 | 景别运镜 | 画面 | 对白 |\n| --- | --- | --- | --- | --- |\n" + Array.from({ length: 21 }, (_, i) => `| ${i + 1} | ${i * 4}-${(i + 1) * 4} | 中景固定 | 人物走入庭院 | 无 |`).join("\n") };
const plan = groupShotsIntoSegments(resolveShotsForEpisodeKeyarts([story], 1), { videoModel: model });
const clip = (index: number): CanvasBlock => ({ ...defaultCanvasBlock("video", 0, 0), id: `clip-e01-g0${index}`, episodeIndex: 1, videoModel: model,
  manhuaAutoSegment: buildManhuaAutoSegmentBinding(1, plan[index - 1]!, model) });

it("按完整七段计划统计，尚未建立的五段不能漏报", () => {
  expect(plan).toHaveLength(7);
  expect(summarizeManhuaDeliverySegments([story], 1, model)).toEqual({ planned: 7, missing: 7, undecided: 0 });
  expect(summarizeManhuaDeliverySegments([story, clip(1), clip(2)], 1, model)).toEqual({ planned: 7, missing: 7, undecided: 0 });
});
it("当前修订产物按段去重，旧修订和归档产物不能填补新计划", () => {
  const ready = { ...clip(1), outputUrl: "https://test.invalid/one.mp4", manhuaClipQuality: report("passed") };
  const pending = { ...clip(2), outputUrl: "https://test.invalid/two.mp4", manhuaClipQuality: report("unverified") };
  const old = { ...clip(3), outputUrl: "https://test.invalid/old.mp4", manhuaAutoSegment: undefined };
  expect(summarizeManhuaDeliverySegments([story, ready, { ...ready, id: ready.id + "-copy" }, pending, old, { ...clip(4), archivedFromPreviousScript: true }], 1, model)).toEqual({ planned: 7, missing: 5, undecided: 1 });
});
it("无真实分镜的旧项目只统计已有节点，不用默认骨架补造段数", () => {
  expect(summarizeManhuaDeliverySegments([], 1, model)).toEqual({ planned: 0, missing: 0, undecided: 0 });
});
