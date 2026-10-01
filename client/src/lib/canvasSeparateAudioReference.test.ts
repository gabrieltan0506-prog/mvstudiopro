import { describe, expect, it } from "vitest";
import { assertCanvasSeparateAudioCapacity, createCanvasAudioCue, canvasAudioCueInputKey, canvasSeparateReferenceKey, compileCanvasAudioBindings, emptyCanvasAudioStudio } from "@shared/canvasAudioStudio";
import { sanitizeManhuaCloudDraftBlock } from "@shared/manhuaCloudDraft";
import { buildSeparateAudioClips } from "./canvasSeparateAudioReference";

function audio(kind: "dialogue" | "bgm", id: string) {
  const cue = { ...createCanvasAudioCue(kind, id), speakerZh: "娘", voice: "original-voice", textZh: "阿菁，慢一点。", shotZh: "背母前行", startSec: 0, endSec: 5, approved: true, selectedTakeId: `${id}-take`, volume: kind === "bgm" ? 0.5 : 1 };
  const take = { id: `${id}-take`, gcsUri: `gs://test-bucket/post-prod/1/${id}.wav`, previewUrl: "", durationSec: 5, createdAt: "test", inputKey: canvasAudioCueInputKey(cue) };
  const result = { ...cue, takes: [take], ...(kind === "bgm" ? { source: { gcsUri: "gs://test-bucket/post-prod/1/full-music.wav", previewUrl: "", durationSec: 29.3335, labelZh: "整曲" }, sourceStartSec: 0, sourceEndSec: 5 } : {}) };
  result.takes[0]!.inputKey = canvasAudioCueInputKey(result);
  return result;
}
describe("对白与整曲BGM独立参考", () => {
  it("后期BGM模式只投对白，不改变原音乐采用、参数和持久化", () => {
    const d = audio("dialogue", "dialogue"), b = audio("bgm", "music");
    const studio = { ...emptyCanvasAudioStudio(), referenceMode: "dialogue" as const, cues: [d, b] };
    const before = JSON.stringify(studio);
    const result = compileCanvasAudioBindings({ studio, existingAudioUrls: [], durationSec: 5, maxAudioReferenceDurationSec: 30 });
    expect(result.audioUrls).toEqual([d.takes[0]!.gcsUri]);
    expect(result.promptAppendix).toContain("不要添加背景音乐");
    expect(result.promptAppendix).not.toContain("@audio2");
    expect(JSON.stringify(studio)).toBe(before);
    const restored = sanitizeManhuaCloudDraftBlock({ id: "clip-e01-g01", kind: "video", x: 0, y: 0, width: 420, height: 360, prompt: "原稿", audioStudio: studio })!;
    expect(restored.audioStudio!.referenceMode).toBe("dialogue");
    expect(restored.audioStudio!.cues[1]).toEqual(b);
  });
  it("累计超30秒在免费处理和正式提交之前拒绝，不擅自裁短或混合", () => {
    const d = audio("dialogue", "dialogue"), b = audio("bgm", "music");
    expect(() => assertCanvasSeparateAudioCapacity([d, b])).toThrow(/累计34.334秒/);
    expect(() => compileCanvasAudioBindings({ studio: { ...emptyCanvasAudioStudio(), referenceMode: "separate", cues: [d, b] }, existingAudioUrls: [], durationSec: 5, maxAudioReferenceDurationSec: 30 })).toThrow(/累计.*上限/);
  });
  it("独立任务仅使用BGM整曲，执行自己的音量/淡入淡出，不取段级裁切候选", () => {
    const d = audio("dialogue", "dialogue"), b = { ...audio("bgm", "music"), fadeInSec: 0.6, fadeOutSec: 1.1 };
    const before = JSON.stringify([d, b]);
    const params = buildSeparateAudioClips(b, [d, b], 5);
    expect(params.durationSec).toBe(29.3335);
    expect(params.clips).toEqual([{ audioUri: b.source!.gcsUri, sourceStartSec: 0, sourceEndSec: 29.3335, startSec: 0, volume: 0.5, fadeInSec: 0.6, fadeOutSec: 1.1 }]);
    expect(JSON.stringify([d, b])).toBe(before);
  });
  it("处理未完成或参数改变不得静默送原音频；处理完成后角色对白与BGM分别绑定", () => {
    const d = audio("dialogue", "dialogue"), b = audio("bgm", "music");
    const studio = { ...emptyCanvasAudioStudio(), referenceMode: "separate" as const, cues: [d, b] };
    expect(() => compileCanvasAudioBindings({ studio, existingAudioUrls: [], durationSec: 5 })).toThrow(/独立音轨/);
    const prepared = { ...b, separateReference: { sourceKey: canvasSeparateReferenceKey(b, studio.cues), take: { ...b.takes[0]!, durationSec: 29.3335, gcsUri: "gs://test-bucket/post-prod/1/music-gain.wav" } } };
    const restored = sanitizeManhuaCloudDraftBlock({ id: "clip-e01-g01", kind: "video", x: 0, y: 0, width: 420, height: 360, prompt: "原稿", audioStudio: { ...studio, referenceMode: "separate", cues: [d, prepared] } })!;
    expect(restored.audioStudio!.cues[1]!.separateReference).toEqual(prepared.separateReference);
    expect(restored.audioStudio!.referenceMode).toBe("separate");
    const result = compileCanvasAudioBindings({ studio: { ...studio, cues: [d, prepared] }, existingAudioUrls: [], durationSec: 5 });
    expect(result.audioUrls).toEqual([d.takes[0]!.gcsUri, prepared.separateReference.take.gcsUri]);
    expect(result.promptAppendix).toContain("@audio1仅对应娘");
    expect(result.promptAppendix).toContain("@audio2这条独立音乐参考");
    expect(() => compileCanvasAudioBindings({ studio: { ...studio, cues: [d, { ...prepared, volume: 0.25 }] }, existingAudioUrls: [], durationSec: 5 })).toThrow(/独立音轨/);
  });
  it("BGM留白/避让仍只处理BGM素材，原对白和采用记录不变", () => {
    const d = { ...audio("dialogue", "dialogue"), startSec: 1, endSec: 6 }, b = { ...audio("bgm", "music"), endSec: 10, mix: { duckUnderDialogue: true, duckVolume: 0.25, silenceWindows: [{ startSec: 7, endSec: 8 }] } };
    const params = buildSeparateAudioClips(b, [d, b], 10);
    expect(params.clips.every(c => c.audioUri === b.source!.gcsUri)).toBe(true);
    expect(params.clips.some(c => c.volume === 0.125)).toBe(true);
    expect(params.clips.some(c => c.startSec === 8)).toBe(true);
    expect(params.durationSec).toBe(29.3335);
    expect(d.selectedTakeId).toBe("dialogue-take");
  });
});
