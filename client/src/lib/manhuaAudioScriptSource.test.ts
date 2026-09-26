import { expect, it } from "vitest";
import { createCanvasAudioCue } from "@shared/canvasAudioStudio";
import { manhuaClipSavedDialogueIssue, manhuaScriptCueSourceIssue } from "./manhuaAudioScriptSource";
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
