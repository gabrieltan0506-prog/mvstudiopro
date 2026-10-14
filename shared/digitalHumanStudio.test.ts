import { describe, expect, it } from "vitest";
import {
  currentDigitalHumanAudio,
  digitalHumanVideoFailureStatus,
  digitalHumanSpatialFingerprint,
  loadDigitalHumanDraft,
  newDigitalHumanDraft,
  prepareDigitalHumanVideo,
} from "./digitalHumanStudio";
const draftId = "a51d8a78-1c90-4f1d-9c1e-324e7a3f4659",
  audioId = "a51d8a78-1c90-4f1d-9c1e-324e7a3f4660",
  videoId = "a51d8a78-1c90-4f1d-9c1e-324e7a3f4661";
function ready() {
  const d = newDigitalHumanDraft("7", draftId);
  d.portrait = { source: "gs://test-bucket/person.png", name: "本人" };
  d.scene = { source: "gs://test-bucket/room.png", name: "书房" };
  d.script = "你好，这是我的数字人声音测试。";
  d.voiceId = "mvsref-test";
  d.approvedAudioRequestId = audioId;
  d.audios = [
    {
      request: {
        billingRequestId: audioId,
        input: d.script,
        voice: d.voiceId,
        speakerZh: "讲述者",
        speakerId: "speaker-test",
        voiceStateZh: "",
      },
      status: "succeeded",
      source: "gs://test-bucket/voice.wav",
      durationSec: 12.4,
    },
  ];
  return d;
}
describe("数字人真实输入合同", () => {
  it("保留完整文案、同一声线音频与两张独立参考", () => {
    const r = prepareDigitalHumanVideo(ready(), videoId);
    expect(r.durationSec).toBe(13);
    expect(r.audioSource).toContain("voice.wav");
    expect(r.prompt).toContain("@图片1");
    expect(r.prompt).toContain("@图片2");
    expect(r.prompt).toContain("你好，这是我的数字人声音测试。");
  });
  it("未确认试听的配音不能用于视频", () => {
    const d = ready();
    d.approvedAudioRequestId = undefined;
    expect(() => prepareDigitalHumanVideo(d, videoId)).toThrow("试听并确认");
  });
  it("文案或声线改变后旧配音不能继续生成", () => {
    const d = ready();
    d.script += "新文案";
    expect(currentDigitalHumanAudio(d)).toBeUndefined();
    expect(() => prepareDigitalHumanVideo(d, videoId)).toThrow("当前文案");
    d.script = d.audios[0].request.input;
    d.voiceId = "another";
    expect(() => prepareDigitalHumanVideo(d, videoId)).toThrow("当前文案");
  });
  it("超过30秒拒绝，不截音频；未知视频阻止重提", () => {
    const d = ready();
    d.audios[0].durationSec = 30.01;
    expect(() => prepareDigitalHumanVideo(d, videoId)).toThrow("超过30秒");
    d.audios[0].durationSec = 30;
    const r = prepareDigitalHumanVideo(d, videoId);
    expect(r.durationSec).toBe(30);
    d.videos = [{ ...r, status: "unknown" }];
    expect(() => prepareDigitalHumanVideo(d, videoId)).toThrow("不能重复生成");
  });
  it("账号隔离与原片/4K记录能往返保存", () => {
    const d = ready();
    d.videos = [
      {
        ...prepareDigitalHumanVideo(d, videoId),
        status: "succeeded",
        source: "https://example.test/original.mp4",
        upscale: {
          status: "running",
          taskId: "test-task",
          inputSource: "https://example.test/original.mp4",
          durationSec: 13,
          sourceResolution: "720p",
        },
      },
    ];
    expect(loadDigitalHumanDraft(JSON.stringify(d), "7")).toEqual(d);
    expect(() => loadDigitalHumanDraft(JSON.stringify(d), "8")).toThrow(
      "账号不匹配"
    );
  });
  it("多人身份参考保持次序，空间变化让旧视角失效", () => {
    const d = ready();
    d.actors = [
      {
        id: "actor2",
        labelZh: "听众",
        portrait: { source: "gs://test-bucket/listener.png", name: "听众" },
        x: 1,
        y: 0,
        yaw: 0,
      },
    ];
    d.stageFrame = {
      media: { source: "gs://test-bucket/frame.png", name: "视角图" },
      sourceFingerprint: digitalHumanSpatialFingerprint(d),
    };
    const r = prepareDigitalHumanVideo(d, videoId);
    expect(r.prompt).toContain("@图片3绑定听众");
    expect(r.extraPortraits).toHaveLength(1);
    d.actors[0].x = 2;
    expect(() => prepareDigitalHumanVideo(d, videoId)).toThrow("重新导出");
  });
  it("未审预演不能进入视频模型", () => {
    const d = ready();
    d.previs = {
      reference: {
        url: "https://example.test/previs.mp4",
        updatedAt: "2026-10-14",
        durationSec: 13,
      },
      sourceFingerprint: digitalHumanSpatialFingerprint(d),
      reviewed: false,
    };
    expect(() => prepareDigitalHumanVideo(d, videoId)).toThrow("尚未审片");
  });
});

it("仅发送前明确失败可重试，已发但结果缺失不能重新购买", () => {
  expect(digitalHumanVideoFailureStatus({ intentStatus: "settled" })).toBe(
    "failed"
  );
  expect(
    digitalHumanVideoFailureStatus({
      intentStatus: "settled",
      submissionStarted: true,
    })
  ).toBe("unknown");
  expect(
    digitalHumanVideoFailureStatus({
      intentStatus: "settled",
      taskId: "original",
    })
  ).toBe("unknown");
  expect(digitalHumanVideoFailureStatus()).toBe("unknown");
});
