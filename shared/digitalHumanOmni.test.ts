import { describe, expect, it } from "vitest";
import {
  digitalHumanDraftSchema,
  digitalHumanVideoIsCurrent,
  newDigitalHumanDraft,
  prepareDigitalHumanOmniVideo,
} from "./digitalHumanStudio";
import { digitalHumanFinalParamsSchema } from "./digitalHumanProduction";

const audioId = "10000000-0000-4000-8000-000000000001";
const videoId = "10000000-0000-4000-8000-000000000002";
function draft() {
  return digitalHumanDraftSchema.parse({
    ...newDigitalHumanDraft("7", "10000000-0000-4000-8000-000000000003"),
    portrait: {
      source: "gs://test-bucket/uploads/u7/portrait.png",
      name: "人物照片",
    },
    script: "介绍这件产品。",
    voiceId: "test-voice",
    approvedAudioRequestId: audioId,
    audios: [
      {
        request: {
          billingRequestId: audioId,
          input: "介绍这件产品。",
          voice: "test-voice",
          speakerZh: "讲述者",
          speakerId: "main",
          voiceStateZh: "自然",
        },
        status: "succeeded",
        source: "gs://test-bucket/post-prod/7/audio.wav",
        durationSec: 45,
      },
    ],
  });
}
describe("数字人口播与既有导演路线隔离", () => {
  it("首次上传人物照片即可准备输入，不要求另一张场景图", () => {
    const d = draft(),
      row = prepareDigitalHumanOmniVideo(d, videoId);
    expect(row.engine).toBe("omnihuman2-wavespeed");
    expect(row.performanceImage).toEqual(d.portrait);
    expect(row.audioSource).toBe(d.audios[0].source);
    expect(row.durationSec).toBe(45);
    expect(row.prompt).toContain("介绍这件产品。");
    expect(row.prompt).not.toContain("@图片2");
    expect(row.extraPortraits).toEqual([]);
    expect(row.previs).toBeUndefined();
    expect(digitalHumanVideoIsCurrent(d, row)).toBe(true);
  });
  it("换图、文案或声音后旧片不能冒充当前片，修改未发送的场景不改变实际输入", () => {
    const d = draft(),
      row = prepareDigitalHumanOmniVideo(d, videoId);
    expect(
      digitalHumanVideoIsCurrent(
        {
          ...d,
          portrait: { ...d.portrait!, source: "gs://test-bucket/other.png" },
        },
        row
      )
    ).toBe(false);
    expect(digitalHumanVideoIsCurrent({ ...d, script: "修改正文" }, row)).toBe(
      false
    );
    expect(digitalHumanVideoIsCurrent({ ...d, voiceId: "other" }, row)).toBe(
      false
    );
    expect(
      digitalHumanVideoIsCurrent(
        {
          ...d,
          scene: { source: "gs://test-bucket/scene.png", name: "未发送的场景" },
        },
        row
      )
    ).toBe(true);
  });
  it("未试听确认、超长与未核对原任务均不能新建视频", () => {
    const d = draft();
    expect(() =>
      prepareDigitalHumanOmniVideo(
        { ...d, approvedAudioRequestId: undefined },
        videoId
      )
    ).toThrow();
    expect(() =>
      prepareDigitalHumanOmniVideo(
        { ...d, audios: [{ ...d.audios[0], durationSec: 301 }] },
        videoId
      )
    ).toThrow();
    expect(() =>
      prepareDigitalHumanOmniVideo(
        { ...d, videos: [prepareDigitalHumanOmniVideo(d, videoId)] },
        videoId
      )
    ).toThrow();
  });
  it("长口播随云稿保存恢复，旧路线的30秒上限不被放宽", () => {
    const d = draft(),
      row = prepareDigitalHumanOmniVideo(d, videoId);
    expect(
      digitalHumanDraftSchema.parse({ ...d, videos: [row] }).videos[0]
        .durationSec
    ).toBe(45);
    expect(
      digitalHumanDraftSchema.safeParse({
        ...d,
        videos: [{ ...row, engine: undefined, performanceImage: undefined }],
      }).success
    ).toBe(false);
  });
  it("最终混音消费长口播，旧分段保持原约束", () => {
    const input = {
      audioUri: "gs://test-bucket/audio.wav",
      audioRequestId: audioId,
      clips: [
        {
          videoUri: "gs://test-bucket/video.mp4",
          startSec: 0,
          endSec: 45,
          sourceEngine: "omnihuman2-wavespeed",
        },
      ],
      voice: { pan: 0, room: "dry", volume: 1 },
      tracks: [],
      aspectRatio: "9:16",
    };
    expect(digitalHumanFinalParamsSchema.safeParse(input).success).toBe(true);
    expect(
      digitalHumanFinalParamsSchema.safeParse({
        ...input,
        clips: [{ ...input.clips[0], sourceEngine: undefined }],
      }).success
    ).toBe(false);
  });
});
