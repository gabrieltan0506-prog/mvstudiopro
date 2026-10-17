import { expect, it } from "vitest";
import { currentDigitalHumanAudio, newDigitalHumanDraft, loadDigitalHumanDraft, digitalHumanDraftSchema } from "./digitalHumanStudio";
import { encodeDigitalHumanWav } from "../client/src/lib/digitalHumanWav";
it("完整旁白超过30秒保持单声道且不截断，声线样本仍限制30秒", () => {
 const samples = new Float32Array(16000 * 65).fill(.1);
 const data = new DataView(encodeDigitalHumanWav([samples], 16000, 300));
 expect(data.getUint16(22, true)).toBe(1); expect(data.getUint32(40, true)).toBe(samples.length * 2);
 expect(() => encodeDigitalHumanWav([samples], 16000)).toThrow("30秒");
});
it("录音来源持久恢复无需voiceId，改稿不误用旧原声，保留历史", () => {
 const d = newDigitalHumanDraft("7", "00000000-0000-4000-8000-000000000001"); d.script="这是本人完整旁白。";
 d.audios.push({origin:"recording",status:"succeeded",source:"gs://test/uploads/u7/a.wav",durationSec:65,creditsCost:0,request:{billingRequestId:"00000000-0000-4000-8000-000000000002",input:d.script,voice:"recorded-narration",speakerZh:"本人",speakerId:"speaker",voiceStateZh:"实际录音"}});
 const restored=loadDigitalHumanDraft(JSON.stringify(digitalHumanDraftSchema.parse(d)),"7")!;
 expect(currentDigitalHumanAudio(restored)?.origin).toBe("recording");
 restored.voiceId="changed-tts-voice"; expect(currentDigitalHumanAudio(restored)?.durationSec).toBe(65);
 restored.script="新的文案"; expect(currentDigitalHumanAudio(restored)).toBeUndefined(); expect(restored.audios).toHaveLength(1);
});
