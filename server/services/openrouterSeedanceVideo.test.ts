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
});
