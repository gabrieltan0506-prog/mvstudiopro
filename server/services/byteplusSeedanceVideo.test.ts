import { describe, expect, it } from "vitest";
import {
  BYTEPLUS_SEEDANCE_25_MODEL_ID,
  clampByteplusSeedance25Duration,
} from "../../shared/byteplusSeedanceModels.js";
import {
  buildByteplusSeedance25SubmitBody,
  extractByteplusVideoUrl,
  isByteplusFallbackableError,
} from "./byteplusSeedanceVideo.js";

describe("buildByteplusSeedance25SubmitBody", () => {
  it("文生：仅 text content + duration/ratio", () => {
    const out = buildByteplusSeedance25SubmitBody({
      mode: "text_to_video",
      prompt: "雨夜霓虹",
      duration: 8,
      aspectRatio: "9:16",
    });
    expect(out.model).toBe(BYTEPLUS_SEEDANCE_25_MODEL_ID);
    expect(out.body.model).toBe(BYTEPLUS_SEEDANCE_25_MODEL_ID);
    expect(out.body.duration).toBe(8);
    expect(out.body.ratio).toBe("9:16");
    expect(out.body.watermark).toBe(false);
    expect(out.body.content).toEqual([{ type: "text", text: "雨夜霓虹" }]);
  });

  it("图生：首帧/末帧 role", () => {
    const out = buildByteplusSeedance25SubmitBody({
      mode: "image_to_video",
      prompt: "人物回头",
      imageUrls: ["https://a/first.jpg", "https://a/last.jpg"],
      duration: 15,
    });
    expect(out.body.content).toEqual([
      { type: "text", text: "人物回头" },
      {
        type: "image_url",
        image_url: { url: "https://a/first.jpg" },
        role: "first_frame",
      },
      {
        type: "image_url",
        image_url: { url: "https://a/last.jpg" },
        role: "last_frame",
      },
    ]);
  });

  it("多模态参考：reference_* roles，对齐官方 R2V 示例", () => {
    const out = buildByteplusSeedance25SubmitBody({
      mode: "reference_to_video",
      prompt: "POV fruit tea",
      imageUrls: ["https://a/1.jpg", "https://a/2.jpg"],
      videoUrls: ["https://a/v.mp4"],
      audioUrls: ["https://a/a.mp3"],
      duration: 11,
      generateAudio: true,
    });
    expect(out.body.duration).toBe(11);
    expect(out.body.generate_audio).toBe(true);
    const roles = (out.body.content as Array<{ role?: string }>)
      .map((c) => c.role)
      .filter(Boolean);
    expect(roles).toEqual([
      "reference_image",
      "reference_image",
      "reference_video",
      "reference_audio",
    ]);
  });

  it("时长钳到 4–30", () => {
    expect(clampByteplusSeedance25Duration(40)).toBe(30);
    expect(clampByteplusSeedance25Duration(1)).toBe(4);
    expect(
      buildByteplusSeedance25SubmitBody({
        mode: "text_to_video",
        prompt: "x",
        duration: 99,
      }).duration,
    ).toBe(30);
  });
});

describe("extractByteplusVideoUrl / fallbackable", () => {
  it("从 content.video_url 取成片", () => {
    expect(
      extractByteplusVideoUrl({
        content: { video_url: "https://cdn.example/a.mp4" },
      }),
    ).toBe("https://cdn.example/a.mp4");
  });

  it("参数错误不回落；配额类可回落", () => {
    expect(isByteplusFallbackableError(new Error("图生视频需要至少 1 张图片"))).toBe(false);
    expect(isByteplusFallbackableError(new Error("QuotaExceeded"))).toBe(true);
    expect(isByteplusFallbackableError(new Error("ModelNotOpen"))).toBe(true);
  });
});
