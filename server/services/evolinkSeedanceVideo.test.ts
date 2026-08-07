import { describe, expect, it } from "vitest";
import { buildEvolinkSeedanceRequest } from "./evolinkSeedanceVideo";

describe("buildEvolinkSeedanceRequest · Seedance 2.5 五模式", () => {
  it("文生视频不夹带素材，并保留固定画幅与联网增强", () => {
    const out = buildEvolinkSeedanceRequest({
      version: "2.5",
      mode: "text_to_video",
      prompt: "雨夜霓虹街道，镜头缓慢前移",
      duration: 8,
      quality: "720p",
      aspectRatio: "9:16",
      webSearch: true,
    });
    expect(out.model).toBe("seedance-2.5-text-to-video");
    expect(out.body).toMatchObject({
      duration: 8,
      quality: "720p",
      aspect_ratio: "9:16",
      generate_audio: true,
      content_filter: true,
      model_params: { web_search: true },
    });
    expect(out.body.image_urls).toBeUndefined();
    expect(out.body.video_urls).toBeUndefined();
  });

  it("图生视频只发送前两张图，并强制 adaptive", () => {
    const out = buildEvolinkSeedanceRequest({
      version: "2.5",
      mode: "image_to_video",
      prompt: "人物自然回头，衣角随风摆动",
      imageUrls: ["https://a/first.jpg", "https://a/last.jpg", "https://a/extra.jpg"],
      duration: 15,
      aspectRatio: "16:9",
    });
    expect(out.model).toBe("seedance-2.5-image-to-video");
    expect(out.body.image_urls).toEqual(["https://a/first.jpg", "https://a/last.jpg"]);
    expect(out.body.aspect_ratio).toBe("adaptive");
  });

  it("多模态参考按 30/10/10 上限截取三类素材", () => {
    const imageUrls = Array.from({ length: 32 }, (_, i) => `https://a/image-${i}.jpg`);
    const videoUrls = Array.from({ length: 12 }, (_, i) => `https://a/video-${i}.mp4`);
    const audioUrls = Array.from({ length: 12 }, (_, i) => `https://a/audio-${i}.mp3`);
    const out = buildEvolinkSeedanceRequest({
      version: "2.5",
      mode: "reference_to_video",
      prompt: "保持人物、场景和声线一致",
      imageUrls,
      videoUrls,
      audioUrls,
    });
    expect(out.model).toBe("seedance-2.5-reference-to-video");
    expect(out.body.image_urls).toHaveLength(30);
    expect(out.body.video_urls).toHaveLength(10);
    expect(out.body.audio_urls).toHaveLength(10);
  });

  it("视频编辑固定 duration=-1，并要求原视频", () => {
    const out = buildEvolinkSeedanceRequest({
      version: "2.5",
      mode: "video_edit",
      prompt: "编辑 @video1：把白天改成黄昏",
      videoUrls: ["https://a/source.mp4"],
      duration: 20,
      aspectRatio: "16:9",
    });
    expect(out.model).toBe("seedance-2.5-video-edit");
    expect(out.body.duration).toBe(-1);
    expect(out.body.aspect_ratio).toBe("adaptive");
    expect(out.body.video_urls).toEqual(["https://a/source.mp4"]);
    expect(() =>
      buildEvolinkSeedanceRequest({
        version: "2.5",
        mode: "video_edit",
        prompt: "移除画面中的路人",
      }),
    ).toThrow("视频编辑需要至少 1 条原视频");
  });

  it("视频延长保留 4–30 秒时长，并要求原视频", () => {
    const out = buildEvolinkSeedanceRequest({
      version: "2.5",
      mode: "video_extend",
      prompt: "向后延长 @video1：人物继续向灯光走去",
      videoUrls: ["https://a/source.mp4"],
      duration: 30,
    });
    expect(out.model).toBe("seedance-2.5-video-extend");
    expect(out.body.duration).toBe(30);
    expect(out.body.aspect_ratio).toBe("adaptive");
    expect(() =>
      buildEvolinkSeedanceRequest({
        version: "2.5",
        mode: "video_extend",
        prompt: "继续向前走",
      }),
    ).toThrow("视频延长需要至少 1 条原视频");
  });
});
