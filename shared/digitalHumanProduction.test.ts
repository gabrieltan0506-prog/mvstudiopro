import { describe, expect, it } from "vitest";
import { digitalHumanFinalParamsSchema, digitalHumanSplitManifestSchema, planDigitalHumanAudioSegments } from "./digitalHumanProduction";
import { currentDigitalHumanAudio, digitalHumanVideoIsCurrent, newDigitalHumanDraft, prepareDigitalHumanVideo } from "./digitalHumanStudio";
const id = "00000000-0000-4000-8000-000000000001", planId = "00000000-0000-4000-8000-000000000002";
describe("完整数字人音频分段", () => {
  it("回溯切点以保留至少四秒尾段，首尾连续覆盖", () => {
    const segments = planDigitalHumanAudioSegments(62, [{ start: 27, end: 29 }, { start: 55, end: 57 }]);
    expect(segments[0].startSec).toBe(0); expect(segments.at(-1)!.endSec).toBe(62);
    segments.forEach((s, i) => { expect(s.endSec - s.startSec).toBeGreaterThanOrEqual(4); expect(s.endSec - s.startSec).toBeLessThanOrEqual(30); if (i) expect(s.startSec).toBe(segments[i - 1].endSec); });
  });
  it("无安全停顿明确拒绝，不按字数估计切词", () => {
    expect(() => planDigitalHumanAudioSegments(31, [])).toThrow("安全停顿");
    expect(planDigitalHumanAudioSegments(3, [])).toEqual([{ startSec: 0, endSec: 3 }]);
    expect(() => planDigitalHumanAudioSegments(1801, [])).toThrow("30分钟");
  });
  it("清单缺尾、间隙与超长段不能进消费端", () => {
    const manifest = { version: 1, audioUri: "gs://test/voice.wav", audioRequestId: id, script: "完整稿", durationSec: 62, segments: [{ index: 0, startSec: 0, endSec: 30, audioUri: "gs://test/part.wav" }] };
    expect(digitalHumanSplitManifestSchema.safeParse(manifest).success).toBe(false);
    expect(digitalHumanSplitManifestSchema.safeParse({ ...manifest, durationSec: 30 }).success).toBe(true);
  });
  it("完整人声与镜头必须从零连续覆盖，音轨不能越界", () => {
    const p = { audioUri: "gs://test/voice.wav", audioRequestId: id, clips: [{ videoUri: "gs://test/v.mp4", startSec: 0, endSec: 10 }], voice: { pan: 0, room: "dry", volume: 1 }, tracks: [], aspectRatio: "9:16" };
    expect(digitalHumanFinalParamsSchema.safeParse(p).success).toBe(true);
    expect(digitalHumanFinalParamsSchema.safeParse({ ...p, clips: [{ ...p.clips[0], startSec: 1 }] }).success).toBe(false);
    expect(digitalHumanFinalParamsSchema.safeParse({ ...p, tracks: [{ source: "gs://test/b.wav", name: "BGM", startSec: 9, sourceStartSec: 0, durationSec: 2, volume: 0.2, fadeInSec: 0, fadeOutSec: 0, duck: true }] }).success).toBe(false);
  });
  it("视频消费真实分段原声，完整稿为上下文，编辑后旧段失效", () => {
    const d = newDigitalHumanDraft("7", id);
    d.portrait = { source: "gs://test/p.png", name: "人物" }; d.scene = { source: "gs://test/s.png", name: "场景" };
    d.script = "这是完整的长口播稿件。"; d.voiceId = "my-voice"; d.approvedAudioRequestId = id;
    d.audios.push({ request: { billingRequestId: id, input: d.script, voice: d.voiceId, speakerZh: "讲述者", speakerId: "a", voiceStateZh: "" }, status: "succeeded", source: "gs://test/a.wav", durationSec: 50 });
    const manifest = digitalHumanSplitManifestSchema.parse({ version: 1, audioUri: "gs://test/a.wav", audioRequestId: id, script: d.script, durationSec: 50, segments: [0, 1].map(index => ({ index, startSec: index * 25, endSec: (index + 1) * 25, audioUri: `gs://test/part${index}.wav` })) });
    d.productions.push({ request: { requestId: planId, input: { action: "digital_human_audio_split", params: { audioUri: manifest.audioUri, audioRequestId: id, script: d.script } } }, fingerprint: "test", status: "succeeded", manifest });
    const row = prepareDigitalHumanVideo(d, id, { manifest, planRequestId: planId, index: 0 });
    expect(row.audioSource).toBe("gs://test/part0.wav"); expect(row.prompt).toContain("全文只作语境"); expect(digitalHumanVideoIsCurrent(d, row)).toBe(true);
    expect(() => prepareDigitalHumanVideo(d, id, { manifest, planRequestId: planId, index: 1 })).toThrow("衔接尾帧");
    d.direction = "换机位"; expect(digitalHumanVideoIsCurrent(d, row)).toBe(false); expect(currentDigitalHumanAudio(d)?.source).toBe(manifest.audioUri);
  });
});
