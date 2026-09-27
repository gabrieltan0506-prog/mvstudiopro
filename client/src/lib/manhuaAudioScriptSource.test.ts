import { expect, it } from "vitest";
import { canvasAudioCueInputKey } from "@shared/canvasAudioStudio";
import { createManhuaAudioFromShots } from "@shared/manhuaAudioFromShots";
import { manhuaClipSavedDialogueIssue, syncEditedShotDialoguesToAudio } from "./manhuaAudioScriptSource";

const shots = [{ index: 1, durationSec: 5, cameraZh: "近景", actionZh: "背娘疾走", dialogueZh: "娘：「阿菁，慢点。」" }];

it("分镜台词改动自动替换音轨旧句，保留旧候选但取消采用、保留同角色音色", () => {
  const studio = createManhuaAudioFromShots(shots, 5);
  const old = { ...studio.cues[0]!, voice: "locked-voice" };
  const take = { id: "old", gcsUri: "gs://test-bucket/old.wav", previewUrl: "", durationSec: 1, createdAt: "2026-09-27", inputKey: canvasAudioCueInputKey(old) };
  const saved = { ...studio, cues: [{ ...old, takes: [take], selectedTakeId: take.id, approved: true }] };
  const changed = syncEditedShotDialoguesToAudio(saved, shots, 5, { 1: "娘：「阿菁，走慢一點啊。」" });
  expect(changed.cues[0]).toMatchObject({ textZh: "阿菁，走慢一點啊。", voice: "locked-voice", selectedTakeId: undefined, approved: false, takes: [take] });
  expect(changed.musicJobIds).toEqual(saved.musicJobIds);
  expect(manhuaClipSavedDialogueIssue(changed, shots, 5)).toBeUndefined();
  const adopted = { ...changed, cues: [{ ...changed.cues[0]!, selectedTakeId: take.id }] };
  expect(manhuaClipSavedDialogueIssue(adopted, shots, 5)).toContain("重新生成");
});

it("清空台词时旧对白失效；音轨内直接改写不受旧分镜原稿阻止", () => {
  const studio = createManhuaAudioFromShots(shots, 5);
  const cleared = syncEditedShotDialoguesToAudio(studio, shots, 5, { 1: "<无对白>" });
  expect(cleared.cues[0]).toMatchObject({ textZh: "", enabled: false, approved: false });
  const edited = { ...studio, cues: [{ ...studio.cues[0]!, textZh: "[cough]阿菁，走慢一點啊。" }] };
  expect(manhuaClipSavedDialogueIssue(edited, shots, 5)).toBeUndefined();
});
