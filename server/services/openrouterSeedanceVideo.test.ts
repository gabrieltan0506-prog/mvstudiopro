import { describe, expect, it } from "vitest";
import { buildOpenRouterSeedanceSubmitBody } from "./openrouterSeedanceVideo";

const urls = (n: number, p: string) =>
  Array.from({ length: n }, (_, i) => `https://cdn.example.com/${p}-${i + 1}.png`);

describe("buildOpenRouterSeedanceSubmitBody · 2.5 回落口径", () => {
  it("2.5：型号/时长 30/720p 上限；参考图收满 30 不砍", () => {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.5",
      prompt: "全程沿用 @image1 定妆。",
      imageUrls: urls(32, "ref"),
      duration: 30,
      quality: "720p",
    }) as Record<string, unknown>;
    expect(body.model).toBe("bytedance/seedance-2.5");
    expect(body.duration).toBe(30);
    expect(body.resolution).toBe("720p");
    const refs = body.input_references as Array<Record<string, unknown>>;
    expect(refs).toHaveLength(30);
  });

  it("2.5：时长钳 4–30、画质 1080p 压回 720p", () => {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.5",
      prompt: "x",
      duration: 99,
      quality: "1080p",
    }) as Record<string, unknown>;
    expect(body.duration).toBe(30);
    expect(body.resolution).toBe("720p");
  });

  it("2.0 口径不受影响：图仍 9、时长仍 4–15", () => {
    const body = buildOpenRouterSeedanceSubmitBody({
      variant: "2.0",
      prompt: "x",
      imageUrls: urls(12, "a"),
      duration: 30,
    }) as Record<string, unknown>;
    expect(body.model).toBe("bytedance/seedance-2.0");
    expect(body.duration).toBe(15);
    expect((body.input_references as unknown[]).length).toBe(9);
  });
});
