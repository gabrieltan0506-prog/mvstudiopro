import { expect, it } from "vitest";
import { createCanvasAudioCue, canvasAudioCueInputKey, canvasAudioStudioSchema, emptyCanvasAudioStudio, validateCanvasAudioCue } from "./canvasAudioStudio";
import { canvasBgmRangeIssue, fitCanvasBgmSegment, splitCanvasBgmSegment } from "./canvasBgmSegments";
import { buildManhuaPrevisAudio } from "./manhuaPrevisAudio";
import { createManhuaPrevisStudio } from "./manhuaPrevis";

function original() {
  const cue = { ...createCanvasAudioCue("bgm", "bgm-original"), labelZh: "重逢 · 柔情", shotZh: "人物对视，随后发现追兵", endSec: 25,
    source: { gcsUri: "gs://test/original.wav", previewUrl: "/test/original", durationSec: 25, labelZh: "已选原曲" }, sourceEndSec: 25, approved: true, selectedTakeId: "old" };
  cue.takes = [{ id: "old", gcsUri: "gs://test/old.wav", previewUrl: "", durationSec: 25, createdAt: "test", inputKey: canvasAudioCueInputKey(cue) }];
  return cue;
}
it("25秒原曲可只选5至20秒，将15秒配乐放到剧情第3秒；不改变原曲和旧候选", () => {
  const before = original(), cue = { ...before, startSec: 3, sourceStartSec: 5, sourceEndSec: 20 };
  expect(fitCanvasBgmSegment(cue, 30)).toBe(18);
  expect(before.sourceEndSec).toBe(25); expect(cue.source?.durationSec).toBe(25); expect(cue.takes).toEqual(before.takes);
  expect(() => fitCanvasBgmSegment({ ...cue, startSec: 20 }, 30)).toThrow("放不进");
  expect(canvasBgmRangeIssue({ ...cue, sourceEndSec: 26 })).toContain("原曲实际时长");
});
it("按剧情秒位拆段保持源偏移与留白，取消旧采用但保留候选，保存恢复不丢失", () => {
  const before = original(); before.mix = { duckUnderDialogue: false, duckVolume: .2, silenceWindows: [{ startSec: 8, endSec: 12 }] };
  const [left, right] = splitCanvasBgmSegment({ ...before, startSec: 3, endSec: 18, sourceStartSec: 5, sourceEndSec: 20 }, 9, "bgm-right");
  expect(left).toMatchObject({ startSec: 3, endSec: 9, sourceStartSec: 5, sourceEndSec: 11, approved: false, takes: before.takes });
  expect(right).toMatchObject({ startSec: 9, endSec: 18, sourceStartSec: 11, sourceEndSec: 20, approved: false, takes: [] });
  expect(left.mix?.silenceWindows).toEqual([{ startSec: 8, endSec: 9 }]); expect(right.mix?.silenceWindows).toEqual([{ startSec: 9, endSec: 12 }]);
  expect(left.selectedTakeId).toBeUndefined(); expect(right.selectedTakeId).toBeUndefined(); expect(before.approved).toBe(true);
  expect(canvasAudioStudioSchema.parse(JSON.parse(JSON.stringify({ ...emptyCanvasAudioStudio(), cues: [left, right] }))).cues).toEqual([left, right]);
});
it("留白区、边界和错误秒位不能拆出空音频", () => {
  const cue = { ...original(), sourceEndSec: 15, endSec: 25 };
  for (const at of [0, 15, 20, NaN]) expect(() => splitCanvasBgmSegment(cue, at, "right")).toThrow("实际播放范围");
});
it("不同主题的两段采用后白模分别读取两条真实来源，保留无对白叙事", () => {
  const [a, b] = splitCanvasBgmSegment(original(), 10, "bgm-b");
  b.labelZh = "发现追兵 · 紧张"; b.source = { ...b.source!, gcsUri: "gs://test/tense.wav" }; b.sourceStartSec = 2; b.sourceEndSec = 17;
  for (const row of [a, b]) { row.approved = true; row.selectedTakeId = row.id; row.takes = [{ id: row.id, gcsUri: `gs://test/${row.id}-trim.wav`, previewUrl: "", durationSec: row.sourceEndSec - row.sourceStartSec, createdAt: "test", inputKey: canvasAudioCueInputKey(row) }]; expect(validateCanvasAudioCue(row, 25)).toEqual([]); }
  const plan = buildManhuaPrevisAudio({ ...emptyCanvasAudioStudio(), cues: [a, b] }, createManhuaPrevisStudio(25).spec);
  expect(plan.dialogueCount).toBe(0); expect(plan.bgmCount).toBe(2);
  expect(plan.clips.map(c => [c.audioUri, c.startSec, c.sourceEndSec])).toEqual([["gs://test/bgm-original-trim.wav", 0, 10], ["gs://test/bgm-b-trim.wav", 10, 15]]);
});
