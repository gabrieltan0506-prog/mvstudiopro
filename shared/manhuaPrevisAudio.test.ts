import { expect, it } from "vitest";
import { createCanvasAudioCue, canvasAudioCueInputKey, emptyCanvasAudioStudio } from "./canvasAudioStudio";
import { createManhuaPrevisStudio } from "./manhuaPrevis";
import { buildManhuaPrevisAudio } from "./manhuaPrevisAudio";
function cue(kind: "dialogue" | "bgm", start: number, end: number, duration: number) {
  const value = { ...createCanvasAudioCue(kind, kind), startSec: start, endSec: end, approved: true, selectedTakeId: kind, shotZh: "第1镜", speakerZh: "阿菁", textZh: "娘，抓紧我", voice: "test-voice" };
  value.takes = [{ id: kind, gcsUri: `gs://test/${kind}.wav`, previewUrl: "", createdAt: "test", durationSec: duration, inputKey: canvasAudioCueInputKey(value) }];
  return value;
}
it("后半段音轨归零，BGM按本段真实对白避让而不丢源偏移", () => {
  const dialogue = cue("dialogue", 17, 21, 4), bgm = cue("bgm", 0, 29, 29);
  bgm.mix = { duckUnderDialogue: true, duckVolume: .2, silenceWindows: [] };
  const audio = buildManhuaPrevisAudio({ ...emptyCanvasAudioStudio(), cues: [dialogue, bgm] }, createManhuaPrevisStudio(12).spec, 17);
  expect(audio.clips[0]).toMatchObject({ startSec: 0, sourceStartSec: 0, sourceEndSec: 4 });
  expect(audio.clips.slice(1)).toEqual([
    expect.objectContaining({ startSec: 0, sourceStartSec: 17, sourceEndSec: 21, volume: .05 }),
    expect.objectContaining({ startSec: 4, sourceStartSec: 21, sourceEndSec: 29, volume: .25 }),
  ]);
});
it("跨边界对白、未采用与过期声线均阻止提交", () => {
  const dialogue = cue("dialogue", 16, 20, 4), studio = { ...emptyCanvasAudioStudio(), cues: [dialogue] }, spec = createManhuaPrevisStudio(17).spec;
  expect(() => buildManhuaPrevisAudio(studio, spec)).toThrow("不能截断对白");
  dialogue.startSec = 0; dialogue.endSec = 4; dialogue.approved = false;
  expect(() => buildManhuaPrevisAudio(studio, spec)).toThrow("尚未采用");
  dialogue.approved = true; dialogue.voice = "changed";
  expect(() => buildManhuaPrevisAudio(studio, spec)).toThrow("不一致");
});
it("BGM循环只延长音乐；不开循环仍保留已选长度", () => {
  const bgm = cue("bgm", 0, 23, 7), studio = { ...emptyCanvasAudioStudio(), cues: [bgm] }, spec = createManhuaPrevisStudio(23).spec;
  expect(buildManhuaPrevisAudio(studio, spec).clips).toHaveLength(1);
  const audio = buildManhuaPrevisAudio(studio, spec, 0, true), last = audio.clips.at(-1)!;
  expect(audio.clips).toHaveLength(4);
  expect(last.startSec + last.sourceEndSec - last.sourceStartSec).toBeCloseTo(23);
  expect(audio.clips[1].fadeInSec).toBe(.2);
});
it("没有音轨、非正常速度及对白重叠不静默降级成无声视频", () => {
  const spec = createManhuaPrevisStudio(17).spec;
  expect(() => buildManhuaPrevisAudio(undefined, spec)).toThrow("尚未配置");
  const a = cue("dialogue", 0, 5, 5), b = { ...cue("dialogue", 4, 7, 3), id: "second" };
  const studio = { ...emptyCanvasAudioStudio(), cues: [a, b] };
  expect(() => buildManhuaPrevisAudio(studio, spec)).toThrow("重叠");
});

it("已渲染音轨、起始秒与画质经云草稿恢复不丢失", async () => {
  const { sanitizeManhuaCloudDraftBlock } = await import("./manhuaCloudDraft");
  const studio = createManhuaPrevisStudio(17);
  studio.audioEnabled = true; studio.audioStartSec = 0; studio.loopBgm = true;
  const audio = buildManhuaPrevisAudio({ ...emptyCanvasAudioStudio(), cues: [cue("dialogue", 0, 5, 5)] }, studio.spec);
  studio.history.push({ jobId: "test", requestId: "11111111-1111-4111-8111-111111111111", gcsUri: "gs://test/video.mp4", url: "/api/manhua-previs-media/test/preview", durationSec: 17, createdAt: "2026-09-29", spec: studio.spec, audio, quality: "draft" });
  const result = sanitizeManhuaCloudDraftBlock({ id: "clip-e01-g01", kind: "video", previsStudio: studio } as never);
  expect(result?.previsStudio).toEqual(studio);
});

it("场景动画保留采用BGM的留白与淡变且不依赖未生成对白", async()=>{
 const {buildManhuaStageBgmAudio}=await import('./manhuaPrevisAudio');
 const bgm=cue('bgm',0,12,12),dialogue=cue('dialogue',0,3,3);dialogue.takes=[];
 bgm.mix={duckUnderDialogue:false,duckVolume:.2,silenceWindows:[{startSec:4,endSec:6}]};
 const studio={...emptyCanvasAudioStudio(),cues:[dialogue,bgm]};
 const result=buildManhuaStageBgmAudio(studio,12)!;
 expect(result.dialogueCount).toBe(0);expect(result.bgmCount).toBe(1);
 expect(result.clips.every(c=>c.audioUri==='gs://test/bgm.wav')).toBe(true);
 expect(result.clips.some(c=>c.sourceStartSec===6)).toBe(true);
 expect(buildManhuaStageBgmAudio({...studio,cues:[]},12)).toBeUndefined();
 expect(buildManhuaStageBgmAudio(undefined,12)).toBeUndefined();
 bgm.approved=false;expect(()=>buildManhuaStageBgmAudio(studio,12)).toThrow('尚未采用');
});
