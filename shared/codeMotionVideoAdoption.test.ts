import { expect, it } from "vitest";
import { adoptCodeMotionVideoIntoProject } from "./codeMotionVideoAdoption";
import type { CodeMotionProject } from "./codeMotion";
import type { CodeMotionAudioSource } from "./codeMotionAudio";
const audio = (id: string) =>
  ({
    id,
    name: id,
    duration: 5,
    gcsUri: `gs://test/${id}.wav`,
    mimeType: "audio/wav",
    sha256: "a".repeat(64),
    bytes: 100,
  }) as CodeMotionAudioSource;
const old = audio("11111111-1111-4111-8111-111111111111"),
  bgm = audio("22222222-2222-4222-8222-222222222222"),
  next = audio("33333333-3333-4333-8333-333333333333");
const asset = {
  id: "old",
  sha256: "a".repeat(64),
  videoUri: "gs://test/old.mp4",
  durationSec: 5,
  originalAudioSourceId: old.id,
};
const clip = {
  assetId: "old",
  at: 0,
  duration: 5,
  sourceStartSec: 0,
  fit: "cover" as const,
};
const track = (sourceId: string) => ({
  sourceId,
  at: 0,
  trimStart: 0,
  duration: 5,
  volume: 1,
  fadeIn: 0,
  fadeOut: 0,
  role: "sfx" as const,
});
const project = {
  brief: { audios: [old, bgm] },
  plan: {
    scenes: [{ duration: 5 }],
    audioTimeline: [track(old.id), { ...track(bgm.id), role: "bgm" }],
    codeVideo: { version: 1, assets: [asset], clips: [clip] },
  },
} as CodeMotionProject;
it("替换并反复采用不会叠加旧片原声，已有BGM仍保留", () => {
  const value = {
    asset: { ...asset, id: "new", originalAudioSourceId: next.id },
    clip: { ...clip, assetId: "new" },
    audioSource: next,
  };
  const result = adoptCodeMotionVideoIntoProject(project, value);
  expect(result.brief.audios!.map(a => a.id)).toEqual([bgm.id, next.id]);
  expect(result.plan!.audioTimeline!.map(a => a.sourceId)).toEqual([
    bgm.id,
    next.id,
  ]);
  expect(adoptCodeMotionVideoIntoProject(result, value)).toEqual(result);
  expect(project.brief.audios).toEqual([old, bgm]);
});
it("换回无声片只移除被替换片原声，缺少音源回执拒绝采用", () => {
  const { originalAudioSourceId, ...silent } = asset;
  expect(
    adoptCodeMotionVideoIntoProject(project, { asset: silent, clip }).brief
      .audios
  ).toEqual([bgm]);
  expect(() =>
    adoptCodeMotionVideoIntoProject(project, { asset, clip })
  ).toThrow("缺少对应");
});
