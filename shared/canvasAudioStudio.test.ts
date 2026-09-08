import { describe, expect, it } from "vitest";
import { canvasAudioCueInputKey, canvasAudioStudioSchema, compileCanvasAudioBindings, createCanvasAudioCue, emptyCanvasAudioStudio } from "./canvasAudioStudio";
import { sanitizeManhuaCloudDraftBlock } from "./manhuaCloudDraft";

function readyCue(id = "line-1") {
  const cue = { ...createCanvasAudioCue("dialogue", id), speakerZh: "墨屠", voiceStateZh: "变身后", shotZh: "落地抬头", textZh: "跟紧我。", voice: "Dylan", approved: true };
  cue.takes.push({ id: "take-1", gcsUri: `gs://test-bucket/post-prod/1/${id}.wav`, previewUrl: "https://test.invalid/a.wav", durationSec: 2, createdAt: "2026-09-08", inputKey: canvasAudioCueInputKey(cue) });
  return { ...cue, selectedTakeId: "take-1" };
}
describe("逐句音轨的持久化与消费闭环", () => {
  it("空工作室不改变旧参考音频与提示词", () => {
    expect(compileCanvasAudioBindings({ studio: emptyCanvasAudioStudio(), existingAudioUrls: ["old"], durationSec: 10 })).toEqual({ audioUrls: ["old"], promptAppendix: "" });
  });
  it("长期身份经过云草稿清洗仍由相同候选生成角色、镜头与秒位绑定", () => {
    const studio = { ...emptyCanvasAudioStudio(), cues: [readyCue()] };
    const block = sanitizeManhuaCloudDraftBlock({ id: "clip-e01-g01", kind: "video", x: 0, y: 0, width: 420, height: 360, prompt: "动作", audioStudio: studio });
    expect(block?.audioStudio).toEqual(studio);
    const result = compileCanvasAudioBindings({ studio: block!.audioStudio, existingAudioUrls: ["gs://test-bucket/base.wav"], durationSec: 10 });
    expect(result.audioUrls[1]).toBe(studio.cues[0]!.takes[0]!.gcsUri);
    expect(result.promptAppendix).toContain("@audio2仅对应墨屠（变身后）的对白{跟紧我。}");
    expect(result.promptAppendix).toContain("1.500–5.000秒，落地抬头");
  });
  it("改声音状态后旧音频保留但不能继续自动采用", () => {
    const cue = readyCue(); cue.voiceStateZh = "变身前";
    expect(() => compileCanvasAudioBindings({ studio: { ...emptyCanvasAudioStudio(), cues: [cue] }, existingAudioUrls: [], durationSec: 10 })).toThrow("不一致");
    expect(cue.takes).toHaveLength(1);
  });
  it("情绪组合云往返不丢失，换情绪不能把旧音轨当新效果送去出片", () => {
    const cue = readyCue();
    cue.emotion = "[serious][empathetic]";
    cue.takes[0]!.inputKey = canvasAudioCueInputKey(cue);
    const block = sanitizeManhuaCloudDraftBlock({ id: "clip-emotion", kind: "video", x: 0, y: 0, width: 420, height: 360, prompt: "护翼", audioStudio: { ...emptyCanvasAudioStudio(), cues: [cue] } });
    expect(block!.audioStudio!.cues[0]!.emotion).toBe("[serious][empathetic]");
    expect(compileCanvasAudioBindings({ studio: block!.audioStudio, existingAudioUrls: [], durationSec: 10 }).audioUrls).toEqual([cue.takes[0]!.gcsUri]);
    block!.audioStudio!.cues[0]!.emotion = "[angry]";
    expect(() => compileCanvasAudioBindings({ studio: block!.audioStudio, existingAudioUrls: [], durationSec: 10 })).toThrow("不一致");
    expect(block!.audioStudio!.cues[0]!.takes).toHaveLength(1);
  });
  it("显式本次不用才排除草稿，资产不丢失", () => {
    const cue = { ...readyCue(), enabled: false, approved: false };
    expect(compileCanvasAudioBindings({ studio: { ...emptyCanvasAudioStudio(), cues: [cue] }, existingAudioUrls: [], durationSec: 10 })).toEqual({ audioUrls: [], promptAppendix: "" });
    expect(cue.takes).toHaveLength(1);
  });
  it("改秒位无需重新购买，但短段越界和对白重叠明确拒绝", () => {
    const cue = readyCue(); const original = canvasAudioCueInputKey(cue); cue.startSec = 2;
    expect(canvasAudioCueInputKey(cue)).toBe(original);
    expect(() => compileCanvasAudioBindings({ studio: { ...emptyCanvasAudioStudio(), cues: [cue] }, existingAudioUrls: [], durationSec: 3 })).toThrow("超出视频时长");
    expect(() => compileCanvasAudioBindings({ studio: { ...emptyCanvasAudioStudio(), cues: [cue, readyCue("line-2")] }, existingAudioUrls: [], durationSec: 10 })).toThrow("重叠");
  });
  it("拒绝超容量与重复身份，禁止静默截断", () => {
    expect(canvasAudioStudioSchema.safeParse({ ...emptyCanvasAudioStudio(), cues: [readyCue(), readyCue()] }).success).toBe(false);
    expect(() => compileCanvasAudioBindings({ studio: { ...emptyCanvasAudioStudio(), cues: [readyCue()] }, existingAudioUrls: Array.from({ length: 10 }, (_, i) => `gs://test-bucket/${i}.wav`), durationSec: 10 })).toThrow("超过 10 条");
  });
});
