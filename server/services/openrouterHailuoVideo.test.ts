import { describe, expect, it } from "vitest";
import { buildOpenRouterHailuoSubmitBody } from "./openrouterHailuoVideo";

describe("buildOpenRouterHailuoSubmitBody", () => {
  it("builds text-to-video body with 2K", () => {
    const body = buildOpenRouterHailuoSubmitBody({
      prompt: "A quiet alley at dusk",
      duration: 10,
      aspectRatio: "9:16",
    });
    expect(body.model).toBe("minimax/hailuo-3");
    expect(body.prompt).toBe("A quiet alley at dusk");
    // H3 时长固定 15 秒（用户 2026-08-05 明文），传进来的时长一律忽略
    expect(body.duration).toBe(15);
    expect(body.resolution).toBe("2K");
    expect(body.aspect_ratio).toBe("9:16");
    expect(body.generate_audio).toBe(true);
    expect(body.frame_images).toBeUndefined();
  });

  it("短时长同样被拉到固定的 15 秒", () => {
    const body = buildOpenRouterHailuoSubmitBody({
      prompt: "short",
      duration: 3,
    });
    expect(body.duration).toBe(15);
  });

  it("uses first_frame for single image", () => {
    const body = buildOpenRouterHailuoSubmitBody({
      prompt: "slow push in",
      imageUrl: "https://cdn.example/a.jpg",
    });
    expect(body.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://cdn.example/a.jpg" },
        frame_type: "first_frame",
      },
    ]);
    expect(body.input_references).toBeUndefined();
  });

  it("uses first_frame + input_references for multi-image", () => {
    const body = buildOpenRouterHailuoSubmitBody({
      prompt: "style match",
      imageUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg", "https://cdn.example/c.jpg"],
    });
    expect(body.frame_images).toEqual([
      {
        type: "image_url",
        image_url: { url: "https://cdn.example/a.jpg" },
        frame_type: "first_frame",
      },
    ]);
    const refs = body.input_references as Array<Record<string, unknown>>;
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ image_url: { url: "https://cdn.example/b.jpg" } });
  });
});
