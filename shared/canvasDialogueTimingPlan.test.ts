import { expect, it } from "vitest";
import { planCanvasDialogueTiming, planCanvasDialoguePrecision } from "./canvasDialogueTimingPlan";
import { canvasAudioCueInputKey, createCanvasAudioCue, compileCanvasAudioBindings, emptyCanvasAudioStudio } from "./canvasAudioStudio";

function fixture() {
  const cues = [0, 4, 7].map((startSec, index) => ({ ...createCanvasAudioCue("dialogue", `line-${index}`), startSec, endSec: [4, 7, 12][index]!, speakerZh: ["娘", "阿菁", "曹三"][index]!, textZh: "原台词", voice: "test-voice" }));
  const take = { id: "original", gcsUri: "gs://test-bucket/original.wav", previewUrl: "", durationSec: 4.944, createdAt: "2026-09-20", inputKey: canvasAudioCueInputKey(cues[0]!) };
  return { cues, take };
}
it.each([
  { start: 4, lengths: [4.944, 5.088, 3.888, 4.296], expected: [[4, 9], [9, 14.1], [14.1, 18], [18, 22.3]], duration: 23 },
  { start: 0, lengths: [6.216, 3.096, 3.888, 3.984, 6.216], expected: [[0, 6.3], [6.3, 9.4], [9.4, 13.3], [13.3, 17.3], [17.3, 23.6]], duration: 24 },
])("完整原声连续安排为一位小数，原声和停用历史不改：$duration 秒", ({ start, lengths, expected, duration }) => {
  let cursor = start;
  const cues = lengths.map((length, i) => {
    const cue = { ...createCanvasAudioCue("dialogue", `adopted-${i}`), startSec: cursor, endSec: cursor + length, selectedTakeId: `take-${i}`, approved: true, speakerZh: `角色${i}`, shotZh: `第${i + 1}镜，原声连续`, textZh: "完整原声", voice: "test-voice" };
    cue.takes = [{ id: `take-${i}`, durationSec: length, inputKey: canvasAudioCueInputKey(cue), gcsUri: `gs://test-bucket/${i}.wav`, previewUrl: "", createdAt: "2026-10-02" }];
    cursor += length;
    return cue;
  });
  cues.push({ ...cues[0]!, id: "history", enabled: false });
  const before = JSON.stringify(cues);
  const plan = planCanvasDialoguePrecision(cues, duration);
  expect(plan.issue).toBe("");
  expect(plan.changes.map(row => [row.startSec, row.endSec])).toEqual(expected);
  plan.changes.forEach((change, i) => expect(change.endSec - change.startSec + 1e-12).toBeGreaterThanOrEqual(lengths[i]!));
  expect(JSON.stringify(cues)).toBe(before);
  const arranged = cues.map(cue => {
    const change = plan.changes.find(row => row.id === cue.id);
    return change ? { ...cue, startSec: change.startSec, endSec: change.endSec } : cue;
  });
  const compiled = compileCanvasAudioBindings({ studio: { ...emptyCanvasAudioStudio(), cues: arranged }, existingAudioUrls: [], durationSec: duration });
  expect(compiled.audioUrls).toHaveLength(lengths.length);
  expected.forEach(([from, to]) => expect(compiled.promptAppendix).toContain(`${from!.toFixed(1)}–${to!.toFixed(1)}秒`));
  expect(planCanvasDialoguePrecision(cues, duration - 1).issue).toContain("请先延长镜头");
});
it("4.944秒原声推动两句后续对白，保留窗口和输入，片长不足明确拦截", () => {
  const { cues, take } = fixture();
  const before = JSON.stringify(cues);
  const plan = planCanvasDialogueTiming(cues, "line-0", take, 12);
  expect(plan.changes.map(row => [row.startSec, row.endSec])).toEqual([[0, 5], [5, 8], [8, 13]]);
  expect(plan.issue).toContain("13.0");
  expect(planCanvasDialogueTiming(cues, "line-0", take, 13).issue).toBe("");
  expect(JSON.stringify(cues)).toBe(before);
  for (const change of plan.changes) expect(canvasAudioCueInputKey({ ...cues.find(row => row.id === change.id)!, ...change })).toBe(canvasAudioCueInputKey(cues.find(row => row.id === change.id)!));
});
it("有空隙则吸收顺延，不推整段、不移动BGM和停用对白", () => {
  const { cues, take } = fixture();
  cues[2]!.startSec = 9;
  cues.push({ ...createCanvasAudioCue("bgm", "music"), startSec: 0, endSec: 12 });
  cues.push({ ...cues[1]!, id: "disabled", enabled: false });
  const plan = planCanvasDialogueTiming(cues, "line-0", take, 12);
  expect(plan.issue).toBe("");
  expect(plan.changes.map(row => row.id)).toEqual(["line-0", "line-1"]);
});
it("旧音色、无效时窗及前句重叠不能顺延应用", () => {
  const { cues, take } = fixture();
  expect(planCanvasDialogueTiming(cues, "line-0", { ...take, inputKey: "old" }, 15).changes).toEqual([]);
  expect(planCanvasDialogueTiming([{ ...cues[0]!, endSec: 0 }], "line-0", take, 15).issue).toContain("无效");
  const nextTake = { ...take, inputKey: canvasAudioCueInputKey(cues[1]!) };
  cues[0]!.endSec = 5;
  expect(planCanvasDialogueTiming(cues, "line-1", nextTake, 15).issue).toContain("前句");
});
