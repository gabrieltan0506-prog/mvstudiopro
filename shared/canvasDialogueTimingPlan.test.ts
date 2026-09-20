import { expect, it } from "vitest";
import { planCanvasDialogueTiming } from "./canvasDialogueTimingPlan";
import { canvasAudioCueInputKey, createCanvasAudioCue } from "./canvasAudioStudio";

function fixture() {
  const cues = [0, 4, 7].map((startSec, index) => ({ ...createCanvasAudioCue("dialogue", `line-${index}`), startSec, endSec: [4, 7, 12][index]!, speakerZh: ["娘", "阿菁", "曹三"][index]!, textZh: "原台词", voice: "test-voice" }));
  const take = { id: "original", gcsUri: "gs://test-bucket/original.wav", previewUrl: "", durationSec: 4.944, createdAt: "2026-09-20", inputKey: canvasAudioCueInputKey(cues[0]!) };
  return { cues, take };
}
it("4.944秒原声推动两句后续对白，保留窗口和输入，片长不足明确拦截", () => {
  const { cues, take } = fixture();
  const before = JSON.stringify(cues);
  const plan = planCanvasDialogueTiming(cues, "line-0", take, 12);
  expect(plan.changes.map(row => [row.startSec, row.endSec])).toEqual([[0, 4.944], [4.944, 7.944], [7.944, 12.944]]);
  expect(plan.issue).toContain("12.944");
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
