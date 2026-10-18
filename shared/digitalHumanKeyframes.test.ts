import { describe, expect, it } from "vitest";
import { digitalHumanKeyframeRevision, selectDigitalHumanKeyframes, type DigitalHumanKeyframe } from "./digitalHumanKeyframes";
import { loadDigitalHumanDraft, newDigitalHumanDraft, prepareDigitalHumanVideo, digitalHumanVideoIsCurrent } from "./digitalHumanStudio";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
function ready() {
  const d = newDigitalHumanDraft("7", id(1));
  d.script = "点选前方资料。"; d.voiceId = "test";
  d.portrait = { source: "gs://test-only/person.png", name: "本人原始人像" };
  d.scene = { source: "gs://test-only/room.png", name: "书房" };
  d.audios = [{ request: { billingRequestId: id(2), input: d.script, voice: d.voiceId, speakerZh: "本人", speakerId: "test", voiceStateZh: "" }, source: "gs://test-only/a.wav", durationSec: 12, status: "succeeded" }];
  d.approvedAudioRequestId = id(2);
  const frame: DigitalHumanKeyframe = { id: id(3), label: "点选C板", media: { source: "gs://test-only/k.png", name: "C.png" }, useZh: "正面平行面板，前方点选，视线看触点", startSec: 4, endSec: 8, adopted: false };
  d.keyframes = [frame];
  return d;
}
function adopted() {
  const d = ready(); d.keyframes![0].adopted = true;
  d.keyframes![0].reviewedRevision = digitalHumanKeyframeRevision(d, d.keyframes![0]);
  return d;
}
describe("关键分镜的采用、恢复与最终消费者", () => {
  it("候选不进入出站；采用后同一素材经过草稿和视频回执恢复", () => {
    const candidate = ready();
    expect(prepareDigitalHumanVideo(candidate, id(4)).keyframes).toBeUndefined();
    const d = adopted(), row = prepareDigitalHumanVideo(d, id(4));
    expect(row.keyframes?.[0].media.source).toBe("gs://test-only/k.png");
    expect(row.prompt).toContain("服装以本段已确认关键分镜为准");
    d.videos = [{ ...row, status: "succeeded", source: "https://test.invalid/video.mp4" }];
    const restored = loadDigitalHumanDraft(JSON.stringify(d), "7");
    if (!restored) throw new Error("草稿恢复失败");
    expect(restored.keyframes).toEqual(d.keyframes);
    expect(restored.videos[0].keyframes).toEqual(d.keyframes);
  });
  it("跨片段图按交集保留同一ID，恰在边界结束不重复进下段", () => {
    const d = adopted();
    expect(selectDigitalHumanKeyframes(d, 0, 6, 12)[0].id).toBe(id(3));
    expect(selectDigitalHumanKeyframes(d, 6, 12, 12)[0].id).toBe(id(3));
    expect(selectDigitalHumanKeyframes(d, 8, 12, 12)).toEqual([]);
  });
  it.each(["person", "audio", "timing", "purpose", "staging", "sceneDescription"])("%s改变后拒绝沿用审图结果且旧图保留", change => {
    const d = adopted();
    if (change === "person") d.portrait!.source = "gs://test-only/new-person.png";
    if (change === "audio") d.audios[0].durationSec = 11;
    if (change === "timing") d.keyframes![0].startSec = 3;
    if (change === "purpose") d.keyframes![0].useZh = "新的动作要求";
    if (change === "staging") d.mainStage = { x: 1, y: 2, yaw: 20 };
    if (change === "sceneDescription") d.sceneDescription = "面板全部在人物前方";
    expect(() => prepareDigitalHumanVideo(d, id(4))).toThrow("输入已改变");
    expect(d.keyframes![0].media.source).toBe("gs://test-only/k.png");
  });
  it("错误时段、空用途和重复ID在采用或恢复处拒绝", () => {
    const d = adopted(); d.keyframes![0].endSec = 13;
    expect(() => prepareDigitalHumanVideo(d, id(4))).toThrow("有效起止时间");
    d.keyframes![0].endSec = 8; d.keyframes![0].useZh = " ";
    expect(() => prepareDigitalHumanVideo(d, id(4))).toThrow("要锁定的画面");
    d.keyframes!.push({ ...d.keyframes![0] });
    expect(() => loadDigitalHumanDraft(JSON.stringify(d), "7")).toThrow("关键分镜编号重复");
  });
  it("小容量模型拒绝整批超限，不能偷偷截掉已采用图片", () => {
    const d = adopted(); d.filmModel = "seedance-2.0-mini";
    d.keyframes = Array.from({ length: 8 }, (_, n) => ({ ...d.keyframes![0], id: id(10 + n) }));
    for (const frame of d.keyframes) frame.reviewedRevision = digitalHumanKeyframeRevision(d, frame);
    expect(() => prepareDigitalHumanVideo(d, id(4))).toThrow("9张上限");
  });
  it("上传未采用候选不使旧视频失效；采用参考变化会使旧视频过期", () => {
    const d = ready(), row = prepareDigitalHumanVideo(d, id(4));
    d.keyframes!.push({ ...d.keyframes![0], id: id(5) });
    expect(digitalHumanVideoIsCurrent(d, row)).toBe(true);
    d.keyframes![0].adopted = true;
    d.keyframes![0].reviewedRevision = digitalHumanKeyframeRevision(d, d.keyframes![0]);
    expect(digitalHumanVideoIsCurrent(d, row)).toBe(false);
  });
});
