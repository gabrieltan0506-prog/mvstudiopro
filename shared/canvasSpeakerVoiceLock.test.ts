import { describe, expect, it } from "vitest";
import { collectSpeakerVoiceLocks } from "./canvasSpeakerVoiceLock";
import { canvasAudioStudioSchema, createCanvasAudioCue, emptyCanvasAudioStudio } from "./canvasAudioStudio";

const cue = (id: string, speakerZh: string, voice: string, approved = true) => ({ ...createCanvasAudioCue("dialogue", id), speakerZh, voice, approved,
  selectedTakeId: "take", takes: [{ id: "take", gcsUri: "gs://test/audio.wav", previewUrl: "", durationSec: 2, createdAt: "now", inputKey: "source" }] });
describe("角色TTS音色锁", () => {
  it("从已采用的真实候选建立锁，跨段跨集复用", () => {
    const locks = collectSpeakerVoiceLocks([{ episodeIndex: 1, audioStudio: { cues: [cue("a", "阿菁", "voice-a"), cue("b", "娘", "voice-b", false)] } },
      { episodeIndex: 2, audioStudio: { cues: [cue("c", "阿菁", "voice-a")] } }]);
    expect(locks.get("阿菁")).toMatchObject({ voice: "voice-a", conflict: false });
    expect(locks.has("娘")).toBe(false);
  });
  it("旧数据同角色采用多个音色时显式冲突", () => {
    const locks = collectSpeakerVoiceLocks([{ episodeIndex: 1, audioStudio: { cues: [cue("a", "阿菁", "voice-a")] } },
      { episodeIndex: 2, audioStudio: { cues: [cue("b", "阿菁", "voice-b")] } }]);
    expect(locks.get("阿菁")?.conflict).toBe(true);
  });
  it("首次采用后改台词使候选失效，角色声线仍锁定", () => {
    const approved = cue("a", "阿菁", "voice-a");
    const edited = { ...approved, textZh: "新台词", approved: false, voiceLock: { speakerZh: "阿菁", voice: "voice-a" } };
    const saved = canvasAudioStudioSchema.parse(JSON.parse(JSON.stringify({ ...emptyCanvasAudioStudio(), cues: [edited] })));
    const locks = collectSpeakerVoiceLocks([{ episodeIndex: 1, audioStudio: saved }]);
    expect(locks.get("阿菁")?.voice).toBe("voice-a");
    expect(saved.cues[0]?.voiceLock).toEqual({ speakerZh: "阿菁", voice: "voice-a" });
  });
});
