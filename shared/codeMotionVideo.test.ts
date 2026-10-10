import { expect, it } from "vitest";
import {
  codeMotionVideoSchema,
  validateCodeMotionVideo,
  codeMotionVideoClipAt,
} from "./codeMotionVideo";
const raw = () => ({
  version: 1,
  assets: [
    {
      id: "clip",
      videoUri: "gs://fixture/clip.mp4",
      sha256: "a".repeat(64),
      durationSec: 4,
    },
  ],
  clips: [
    { assetId: "clip", at: 1, duration: 4, sourceStartSec: 0, fit: "cover" },
  ],
});
it("video timing uses an exclusive end, with exact frame and source bounds", () => {
  const video = codeMotionVideoSchema.parse(raw());
  expect(validateCodeMotionVideo(video, 6, 24)).toEqual([]);
  expect(codeMotionVideoClipAt(video, 1)?.assetId).toBe("clip");
  expect(codeMotionVideoClipAt(video, 5)).toBeUndefined();
  expect(
    validateCodeMotionVideo(
      { ...video, clips: [{ ...video.clips[0], sourceStartSec: 0.1 }] },
      6,
      24
    )
  ).toContain("视频片段超出已保存素材");
  expect(
    validateCodeMotionVideo(
      { ...video, clips: [...video.clips, { ...video.clips[0], at: 2 }] },
      6,
      24
    )
  ).toContain("视频片段重叠或超出成片");
  expect(
    validateCodeMotionVideo(
      { ...video, clips: [{ ...video.clips[0], at: 1.001 }] },
      6,
      24
    )
  ).toContain("视频片段必须对齐画面帧");
});
it("requires real stored source identity and bounded 4–5 second generated clips", () => {
  expect(
    codeMotionVideoSchema.safeParse({
      ...raw(),
      assets: [{ ...raw().assets[0], sha256: "", durationSec: 20 }],
    }).success
  ).toBe(false);
});
