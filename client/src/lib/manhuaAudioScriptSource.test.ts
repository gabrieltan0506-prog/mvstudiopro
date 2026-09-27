import { expect, it } from "vitest";
import { canvasAudioStudioSchema, createCanvasAudioCue } from "@shared/canvasAudioStudio";
import { manhuaClipSavedDialogueIssue, manhuaScriptCueSourceIssue, manhuaScriptCueVerification } from "./manhuaAudioScriptSource";
import { createManhuaAudioFromShots } from "@shared/manhuaAudioFromShots";
import { canvasAudioCueInputKey } from "@shared/canvasAudioStudio";

it("原镜对白须与当前来源相同，来源缺失时不建立付费单；手写对白仍可用", () => {
  const original = {
    ...createCanvasAudioCue("dialogue", "script-shot-15-line-1"),
    speakerZh: "娘",
    textZh: "阿菁……那马……",
    startSec: 0,
    endSec: 5,
  };
  const current = { ...original, textZh: "阿菁，那馬是怎麼回事呀？" };
  expect(manhuaScriptCueSourceIssue(original, [current], true)).toContain("未提交付费配音");
  expect(manhuaScriptCueSourceIssue(current, [current], true)).toBeUndefined();
  expect(manhuaScriptCueSourceIssue({ ...current, startSec: 0.5, endSec: 6 }, [current], true)).toBeUndefined();
  expect(manhuaScriptCueSourceIssue(current, undefined, false)).toContain("原稿尚未读取到");
  expect(manhuaScriptCueSourceIssue({ ...original, id: "manual-dialogue" }, undefined, false)).toBeUndefined();
});

it("台词修改保留旧TTS产物但禁止其出片；新句必须重新生成音频", () => {
  const oldShots = [{ index: 16, durationSec: 5, cameraZh: "近景", actionZh: "娘望向墨屠", dialogueZh: "娘：「阿菁……那马……」" }];
  const newShots = [{ ...oldShots[0]!, dialogueZh: "娘：「阿菁，那馬是怎麼回事呀？」" }];
  const studio = createManhuaAudioFromShots(oldShots, 5);
  const oldCue = studio.cues[0]!;
  const oldTake = { id: "old-take", gcsUri: "gs://test-bucket/old.wav", previewUrl: "https://test.invalid/old.wav", durationSec: 1, createdAt: "2026-09-26", inputKey: canvasAudioCueInputKey(oldCue) };
  const saved = { ...studio, cues: [{ ...oldCue, takes: [oldTake], selectedTakeId: oldTake.id, approved: true }] };
  expect(manhuaClipSavedDialogueIssue(saved, oldShots, 5)).toBeUndefined();
  expect(manhuaClipSavedDialogueIssue(saved, newShots, 5)).toContain("重新生成");
  expect(manhuaClipSavedDialogueIssue(studio, newShots, 5)).toBeUndefined();
  const corrected = { ...saved, cues: [{ ...saved.cues[0]!, textZh: "阿菁，那馬是怎麼回事呀？" }] };
  expect(canvasAudioCueInputKey(corrected.cues[0]!)).not.toBe(oldTake.inputKey);
  expect(manhuaClipSavedDialogueIssue(corrected, newShots, 5)).toContain("重新生成");
  const newTake = { ...oldTake, id: "new-take", inputKey: canvasAudioCueInputKey(corrected.cues[0]!) };
  const withNewTake = { ...corrected, cues: [{ ...corrected.cues[0]!, takes: [oldTake, newTake], selectedTakeId: newTake.id }] };
  expect(manhuaClipSavedDialogueIssue(withNewTake, newShots, 5)).toBeUndefined();
});

it("逐句确认的改写可生成TTS并出片；原稿或改写再变更时凭据失效", () => {
  const shots = [{ index: 1, durationSec: 5, cameraZh: "近景", actionZh: "背娘疾走", dialogueZh: "娘：「阿菁，慢点。」" }];
  const studio = createManhuaAudioFromShots(shots, 5);
  const expected = studio.cues[0]!;
  const edited = { ...expected, textZh: "[cough][gasp]阿菁，走慢一點啊，要不我氣喘不上來。" };
  expect(manhuaScriptCueSourceIssue(edited, [expected], true)).toContain("未提交付费配音");
  const verified = { ...edited, sourceVerification: manhuaScriptCueVerification(edited, expected) };
  expect(manhuaScriptCueSourceIssue(verified, [expected], true)).toBeUndefined();
  expect(canvasAudioStudioSchema.parse({ ...studio, cues: [verified] }).cues[0]!.sourceVerification).toBe(verified.sourceVerification);
  const take = { id: "new-take", gcsUri: "gs://test-bucket/new.wav", previewUrl: "https://test.invalid/new.wav", durationSec: 4, createdAt: "2026-09-27", inputKey: canvasAudioCueInputKey(verified) };
  const adopted = { ...studio, cues: [{ ...verified, takes: [take], selectedTakeId: take.id, approved: true }] };
  expect(manhuaClipSavedDialogueIssue(adopted, shots, 5)).toBeUndefined();
  expect(manhuaClipSavedDialogueIssue({ ...adopted, cues: [{ ...adopted.cues[0]!, textZh: "再慢一些" }] }, shots, 5)).toContain("重新生成");
  expect(manhuaClipSavedDialogueIssue(adopted, [{ ...shots[0]!, dialogueZh: "娘：「已经到了。」" }], 5)).toContain("重新生成");
});
