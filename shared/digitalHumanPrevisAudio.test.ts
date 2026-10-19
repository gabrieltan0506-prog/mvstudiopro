import { expect, it } from "vitest";
import { newDigitalHumanDraft, digitalHumanDraftSchema } from "./digitalHumanStudio";
import { createManhuaPrevisStudio, manhuaPrevisRequestSchema } from "./manhuaPrevis";
import { buildDigitalHumanPrevisAudio } from "./digitalHumanPrevisAudio";
import { previsPlaybackFrames, previsPlaybackDuration } from "./manhuaPrevisPlayback";
const id = "00000000-0000-4000-8000-000000000001";
function fixture(durationSec: number) {
  const draft = newDigitalHumanDraft("test-user", id);
  draft.script = "测试完整旁白";
  draft.audios.push({ origin: "recording", status: "succeeded", source: "gs://test-only/audio.wav", durationSec, creditsCost: 0,
    request: { billingRequestId: id, input: draft.script, voice: "recorded-narration", speakerZh: "本人", speakerId: "test-speaker", voiceStateZh: "实际录音" } });
  draft.approvedAudioRequestId = id;
  return draft;
}
it.each([28.8, 20.4, 29.7])("%s秒完整旁白贯通请求与云稿，原速且不截句", duration => {
  const draft = fixture(duration), studio = createManhuaPrevisStudio(duration);
  const audio = buildDigitalHumanPrevisAudio(draft, studio.spec);
  const request = manhuaPrevisRequestSchema.parse({ requestId: id, scopeId: studio.scopeId, clipId: "test-clip", spec: studio.spec, audio });
  studio.audioEnabled = true; studio.pending = request; draft.previsStudio = studio;
  const restored = digitalHumanDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
  expect(restored.previsStudio!.pending!.audio).toEqual(audio);
  expect(restored.previsStudio!.spec.durationSec).toBe(duration);
  expect(audio.clips).toEqual([{ audioUri: "gs://test-only/audio.wav", sourceStartSec: 0, sourceEndSec: duration, startSec: 0, volume: 1, fadeInSec: 0, fadeOutSec: 0 }]);
  expect(previsPlaybackFrames(request.spec)).toBe(Math.round(duration * 24));
  expect(Math.abs(previsPlaybackDuration(request.spec) - duration)).toBeLessThanOrEqual(1 / 48);
});
it("未采用、换稿、换音频、短预演与变速不能静默使用旧音轨", () => {
  const draft = fixture(20.4), spec = createManhuaPrevisStudio(20.4).spec;
  draft.approvedAudioRequestId = undefined; expect(() => buildDigitalHumanPrevisAudio(draft, spec)).toThrow("采用");
  draft.approvedAudioRequestId = id; draft.script += "改稿"; expect(() => buildDigitalHumanPrevisAudio(draft, spec)).toThrow("采用");
  draft.script = "测试完整旁白";
  expect(() => buildDigitalHumanPrevisAudio(draft, { durationSec: 20 })).toThrow("截断");
  expect(() => buildDigitalHumanPrevisAudio(draft, { ...spec, timeMap: { sourceDurationSec: 20.4, spans: [{ sourceStartSec: 0, sourceEndSec: 20.4, rate: 2 }] } })).toThrow("原速");
  const before = buildDigitalHumanPrevisAudio(draft, spec);
  draft.audios[0].source = "gs://test-only/replacement.wav";
  expect(buildDigitalHumanPrevisAudio(draft, spec).sourceKey).not.toBe(before.sourceKey);
});
