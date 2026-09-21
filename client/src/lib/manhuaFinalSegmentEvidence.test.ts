import { expect, it } from "vitest";
import { defaultCanvasBlock, type CanvasBlock } from "./canvasTypes";
import { queuedManhuaClipBlocks, resolveShotsForEpisodeKeyarts } from "./canvasDramaStudio";
import { groupShotsIntoSegments } from "@shared/manhuaScriptWorkbench";
import { buildManhuaAutoSegmentBinding } from "@shared/manhuaAutoSegment";
import { emptyManhuaClipQualityChecks } from "@shared/manhuaClipQuality";
import { createCanvasAudioCue, canvasAudioCueInputKey, emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";
import { buildManhuaFinalReviewChecklist } from "@shared/manhuaFinalReviewChecklist";
import { summarizeManhuaDeliverySegments } from "./manhuaDeliverySegmentSummary";
import { summarizeManhuaFinalSegmentEvidence } from "./manhuaFinalSegmentEvidence";

const model = "seedance-2.0";
const story: CanvasBlock = { ...defaultCanvasBlock("text", 0, 0), id: "beats-e01-plan", episodeIndex: 1,
  outputText: "| 镜号 | 秒位 | 景别运镜 | 画面 | 对白 |\n| --- | --- | --- | --- | --- |\n" + Array.from({ length: 6 }, (_, i) => `| ${i+1} | ${i*4}-${(i+1)*4} | 中景固定 | 人物走入庭院 | 无 |`).join("\n") };
const plan = groupShotsIntoSegments(resolveShotsForEpisodeKeyarts([story], 1), { videoModel: model });
const clip = (index: number): CanvasBlock => ({ ...defaultCanvasBlock("video", 0, 0), id: `clip-e01-g0${index}`, episodeIndex: 1, videoModel: model, status: "done", outputUrl: `https://offline.invalid/${index}.mp4`,
  manhuaAutoSegment: buildManhuaAutoSegmentBinding(1, plan[index-1]!, model),
  manhuaClipQuality: { status: "passed", checks: emptyManhuaClipQualityChecks(), failedKeys: [], summary: "离线回执", raw: "", attempts: 1, reviewedAt: "2026-09-21" } });
const summarize = (blocks: CanvasBlock[]) => summarizeManhuaFinalSegmentEvidence(plan, queuedManhuaClipBlocks([story, ...blocks], 1, model), 1);

it("同段重复的当前修订节点不能填满其他计划段，终审与交付缺口一致", () => {
  expect(plan).toHaveLength(2);
  const blocks = [clip(1), { ...clip(1), id: "clip-e01-g01-copy" }];
  const before = JSON.stringify(blocks);
  const evidence = summarize(blocks);
  expect(evidence).toEqual({ readyClips: 1, qualityPassedClips: 1, qualityFailedClips: 0, segmentsWithAudio: 0 });
  expect(summarizeManhuaDeliverySegments([story, ...blocks], 1, model)).toEqual({ planned: 2, missing: 1, undecided: 0 });
  const review = buildManhuaFinalReviewChecklist({ plannedSegments: 2, ...evidence, keyartTotal: 0, keyartPixelLocked: 0, subtitleRequired: false, subtitleReady: false, finalCutStale: false, hasFinalVideo: false });
  expect(review.items.find(item => item.id === "content")).toMatchObject({ state: "fail", detailZh: "1/2 段成片，缺 1 段" });
  expect(review.items.find(item => item.id === "picture")?.state).toBe("unknown");
  expect(JSON.stringify(blocks)).toBe(before);
});

it("每段已有通过候选时不任取失败候选，旧修订和归档仍不能补数", () => {
  const failed = { ...clip(1), id: "clip-e01-g01-failed", manhuaClipQuality: { ...clip(1).manhuaClipQuality!, status: "failed" as const } };
  expect(summarize([failed, clip(1), clip(2)])).toMatchObject({ readyClips: 2, qualityPassedClips: 2, qualityFailedClips: 0 });
  expect(summarize([failed, { ...failed, id: "clip-e01-g01-another" }])).toMatchObject({ readyClips: 0, qualityPassedClips: 0, qualityFailedClips: 1 });
  expect(summarize([clip(1), { ...clip(2), manhuaAutoSegment: undefined }, { ...clip(2), archivedFromPreviousScript: true }])).toMatchObject({ readyClips: 1, qualityPassedClips: 1 });
});

it("对白与配乐不得跨候选拼凑，同段重复的完整音轨也只算一段", () => {
  const adopted = (kind: "dialogue" | "bgm") => {
    const cue = { ...createCanvasAudioCue(kind, kind), approved: true, textZh: "站我身后", selectedTakeId: "take" };
    return { ...cue, takes: [{ id: "take", gcsUri: "gs://offline/audio.wav", previewUrl: "", durationSec: 1, createdAt: "2026-09-21", inputKey: canvasAudioCueInputKey(cue) }] };
  };
  const withAudio = (id: string, kinds: ("dialogue" | "bgm")[]): CanvasBlock => ({ ...clip(1), id, audioStudio: { ...emptyCanvasAudioStudio(), cues: kinds.map(adopted) } });
  expect(summarize([withAudio("clip-e01-g01-dialogue", ["dialogue"]), withAudio("clip-e01-g01-bgm", ["bgm"])]).segmentsWithAudio).toBe(0);
  expect(summarize([withAudio("clip-e01-g01-a", ["dialogue", "bgm"]), withAudio("clip-e01-g01-b", ["dialogue", "bgm"])]).segmentsWithAudio).toBe(1);
});
