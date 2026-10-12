import { expect, it } from "vitest";
import {
  codeMotionAudioSchema,
  codeMotionAudioClipSchema,
  validateCodeMotionAudio,
} from "./codeMotionAudio";

const source = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "原声.wav",
  gcsUri: "gs://test/audio.wav",
  duration: 10,
  mimeType: "audio/wav" as const,
  sha256: "a".repeat(64),
  bytes: 3000,
};
const clip = {
  sourceId: source.id,
  role: "narration" as const,
  at: 2,
  trimStart: 1,
  duration: 3,
  volume: 1,
  fadeIn: 0.1,
  fadeOut: 0.2,
};
it("音源及片段保留真实身份和四类用途", () => {
  for (const role of ["dialogue", "narration", "bgm", "sfx"] as const)
    expect(
      codeMotionAudioSchema.parse({
        sources: [source],
        audioTimeline: [{ ...clip, role }],
      }).audioTimeline[0].role
    ).toBe(role);
  expect(
    codeMotionAudioSchema.safeParse({
      sources: [{ ...source, sha256: undefined }],
      audioTimeline: [clip],
    }).success
  ).toBe(false);
});
it("拒绝不存在的来源、越界、未使用及重复音源", () => {
  expect(
    codeMotionAudioSchema.safeParse({
      sources: [source],
      audioTimeline: [
        { ...clip, sourceId: "22222222-2222-4222-8222-222222222222" },
      ],
    }).success
  ).toBe(false);
  expect(
    codeMotionAudioSchema.safeParse({
      sources: [source],
      audioTimeline: [{ ...clip, trimStart: 9 }],
    }).success
  ).toBe(false);
  expect(
    codeMotionAudioSchema.safeParse({
      sources: [source, source],
      audioTimeline: [clip],
    }).success
  ).toBe(false);
  const audio = codeMotionAudioSchema.parse({
    sources: [source],
    audioTimeline: [clip],
  });
  expect(validateCodeMotionAudio(audio, 4)).toContain(
    "第 1 条音轨超出视频时长"
  );
});
it("拒绝坏数值、过长淡入淡出和没有声音的音量", () => {
  expect(
    codeMotionAudioClipSchema.safeParse({ ...clip, at: Number.NaN }).success
  ).toBe(false);
  expect(
    codeMotionAudioClipSchema.safeParse({ ...clip, fadeIn: 2, fadeOut: 2 })
      .success
  ).toBe(false);
  expect(
    codeMotionAudioSchema.safeParse({
      sources: [source],
      audioTimeline: [{ ...clip, volume: 0 }],
    }).success
  ).toBe(false);
  expect(
    codeMotionAudioSchema.safeParse({
      sources: [{ ...source, bytes: 30 * 1024 * 1024 + 1 }],
      audioTimeline: [clip],
    }).success
  ).toBe(false);
});
