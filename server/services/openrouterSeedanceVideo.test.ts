import { describe, expect, it } from "vitest";
import { buildOpenRouterSeedanceSubmitBody } from "./openrouterSeedanceVideo";

describe("buildOpenRouterSeedanceSubmitBody", () => {
  it("builds text-to-video body for 2.0", () => {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.0",
      prompt: "A quiet alley at dusk",
      duration: 10,
      quality: "720p",
      aspectRatio: "9:16",
    });
    expect(body.model).toBe("bytedance/seedance-2.0");
    expect(body.prompt).toBe("A quiet alley at dusk");
    expect(body.duration).toBe(10);
    expect(body.resolution).toBe("720p");
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.frame_images).toBeUndefined();
  });

  it("uses frame_images for single image I2V", () => {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.0-fast",
      prompt: "slow push in",
      imageUrl: "https://cdn.example/a.jpg",
    });
    expect(body.model).toBe("bytedance/seedance-2.0-fast");
    expect(body.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://cdn.example/a.jpg" },
        frame_type: "first_frame",
      },
    ]);
  });

  it("uses input_references for multi-image", () => {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.0",
      prompt: "style match",
      imageUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"],
    });
    expect(Array.isArray(body.input_references)).toBe(true);
    expect((body.input_references as unknown[]).length).toBe(2);
  });

  it("puts audio_url into input_references alongside still", () => {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.0-fast",
      prompt: "@角色1 说你好",
      imageUrl: "https://cdn.example/still.jpg",
      audioUrls: ["https://cdn.example/voice.mp3"],
      generateAudio: true,
      duration: 8,
    });
    expect(body.generate_audio).toBe(true);
    expect(body.frame_images).toBeUndefined();
    const refs = body.input_references as Array<Record<string, unknown>>;
    expect(refs.some((r) => r.type === "image_url")).toBe(true);
    expect(refs.some((r) => r.type === "audio_url")).toBe(true);
  });

  it("keeps all 9 reference images that the official API allows", () => {
    const imageUrls = Array.from({ length: 9 }, (_, i) => `https://cdn.example/${i + 1}.jpg`);
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.0",
      prompt: "@角色1=@Image3；@Image9=本段静帧",
      imageUrls,
    });
    const refs = body.input_references as Array<Record<string, unknown>>;
    // 曾经写死 slice(0,4)，把本段静帧和场景/道具静默丢掉，@ImageN 却照旧指向它们
    expect(refs.filter((r) => r.type === "image_url")).toHaveLength(9);
    expect(refs.at(-1)).toMatchObject({
      image_url: { url: "https://cdn.example/9.jpg" },
    });
  });

  it("clamps above the official 9-image ceiling", () => {
    const imageUrls = Array.from({ length: 12 }, (_, i) => `https://cdn.example/${i + 1}.jpg`);
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.0",
      prompt: "too many",
      imageUrls,
    });
    const refs = body.input_references as Array<Record<string, unknown>>;
    expect(refs.filter((r) => r.type === "image_url")).toHaveLength(9);
  });
});
