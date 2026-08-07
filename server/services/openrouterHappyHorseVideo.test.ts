import { describe, expect, it } from "vitest";
import {
  OPENROUTER_HAPPYHORSE_1_1_MODEL,
  buildOpenRouterHappyHorseSubmitBody,
} from "./openrouterHappyHorseVideo";

describe("buildOpenRouterHappyHorseSubmitBody", () => {
  it("默认使用 HappyHorse 1.1、720p 和单图首帧", () => {
    const body = buildOpenRouterHappyHorseSubmitBody({
      prompt: "人物轻轻微笑",
      imageUrl: "https://storage.googleapis.com/example/old-photo.jpg",
      duration: 5,
      aspectRatio: "9:16",
    });
    expect(body).toMatchObject({
      model: OPENROUTER_HAPPYHORSE_1_1_MODEL,
      prompt: "人物轻轻微笑",
      duration: 5,
      resolution: "720p",
      aspect_ratio: "9:16",
      frame_images: [
        {
          type: "image_url",
          image_url: {
            url: "https://storage.googleapis.com/example/old-photo.jpg",
          },
          frame_type: "first_frame",
        },
      ],
    });
    expect(body.generate_audio).toBeUndefined();
  });

  it("允许 1080p，并回退不支持的画幅比例", () => {
    const body = buildOpenRouterHappyHorseSubmitBody({
      prompt: "自然转头",
      imageUrl: "https://storage.googleapis.com/example/old-photo.jpg",
      duration: 15,
      resolution: "1080p",
      aspectRatio: "adaptive",
    });
    expect(body.resolution).toBe("1080p");
    expect(body.duration).toBe(15);
    expect(body.aspect_ratio).toBe("16:9");
  });

  it("拒绝未开放的时长和清晰度", () => {
    expect(() =>
      buildOpenRouterHappyHorseSubmitBody({
        prompt: "自然挥手",
        imageUrl: "https://storage.googleapis.com/example/old-photo.jpg",
        duration: 7,
      })
    ).toThrow("只支持 5、10 或 15 秒");
    expect(() =>
      buildOpenRouterHappyHorseSubmitBody({
        prompt: "自然挥手",
        imageUrl: "https://storage.googleapis.com/example/old-photo.jpg",
        resolution: "4K",
      })
    ).toThrow("只支持 720p 或 1080p");
  });
});
