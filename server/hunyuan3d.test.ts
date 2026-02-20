import { describe, it, expect, vi, beforeEach } from "vitest";

// Top-level mock with factory that returns a module-scoped mock fn
const mockSubscribe = vi.fn();
const mockConfig = vi.fn();

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: mockConfig,
    subscribe: mockSubscribe,
  },
}));

describe("Hunyuan3D Service", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSubscribe.mockReset();
    mockConfig.mockReset();
  });

  it("should export isHunyuan3DAvailable function", async () => {
    process.env.FAL_API_KEY = "test-key";
    const mod = await import("./hunyuan3d");
    expect(typeof mod.isHunyuan3DAvailable).toBe("function");
    expect(mod.isHunyuan3DAvailable()).toBe(true);
  });

  it("should export generate3DModel function", async () => {
    const mod = await import("./hunyuan3d");
    expect(typeof mod.generate3DModel).toBe("function");
  });

  it("isHunyuan3DAvailable returns false when no key", async () => {
    const origKey = process.env.FAL_API_KEY;
    delete process.env.FAL_API_KEY;
    const mod = await import("./hunyuan3d");
    expect(mod.isHunyuan3DAvailable()).toBe(false);
    if (origKey) process.env.FAL_API_KEY = origKey;
  });

  it("generate3DModel throws when no API key", async () => {
    const origKey = process.env.FAL_API_KEY;
    delete process.env.FAL_API_KEY;
    const mod = await import("./hunyuan3d");
    await expect(mod.generate3DModel({
      inputImageUrl: "https://example.com/test.jpg",
      mode: "rapid",
    })).rejects.toThrow("FAL_API_KEY");
    if (origKey) process.env.FAL_API_KEY = origKey;
  });

  it("generate3DModel calls fal.subscribe with correct model ID for rapid mode", async () => {
    process.env.FAL_API_KEY = "test-key-123";
    mockSubscribe.mockResolvedValue({
      data: {
        thumbnail: { url: "https://example.com/thumb.png" },
        model_urls: {
          glb: { url: "https://example.com/model.glb" },
          obj: { url: "https://example.com/model.obj" },
          fbx: { url: "https://example.com/model.fbx" },
          usdz: { url: "https://example.com/model.usdz" },
          texture: { url: "https://example.com/texture.png" },
        },
      },
      requestId: "test-req-123",
    });

    const mod = await import("./hunyuan3d");
    const result = await mod.generate3DModel({
      inputImageUrl: "https://example.com/test.jpg",
      mode: "rapid",
    });

    expect(mockSubscribe).toHaveBeenCalledWith(
      "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d",
      expect.objectContaining({
        input: { input_image_url: "https://example.com/test.jpg" },
      })
    );
    expect(result.modelGlbUrl).toBe("https://example.com/model.glb");
    expect(result.modelObjUrl).toBe("https://example.com/model.obj");
    expect(result.modelFbxUrl).toBe("https://example.com/model.fbx");
    expect(result.modelUsdzUrl).toBe("https://example.com/model.usdz");
    expect(result.thumbnailUrl).toBe("https://example.com/thumb.png");
    expect(result.textureUrl).toBe("https://example.com/texture.png");
  });

  it("generate3DModel uses pro model ID for pro mode", async () => {
    process.env.FAL_API_KEY = "test-key-456";
    mockSubscribe.mockResolvedValue({
      data: {
        model_urls: { glb: { url: "https://example.com/pro.glb" } },
      },
      requestId: "test-req-456",
    });

    const mod = await import("./hunyuan3d");
    await mod.generate3DModel({
      inputImageUrl: "https://example.com/test.jpg",
      mode: "pro",
      enablePbr: true,
    });

    expect(mockSubscribe).toHaveBeenCalledWith(
      "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
      expect.objectContaining({
        input: {
          input_image_url: "https://example.com/test.jpg",
          enable_pbr: true,
        },
      })
    );
  });

  it("CREDIT_COSTS has idol3DRapid and idol3DPro entries", async () => {
    const { CREDIT_COSTS } = await import("../shared/plans");
    expect(CREDIT_COSTS.idol3DRapid).toBe(8);
    expect(CREDIT_COSTS.idol3DPro).toBe(15);
  });
});
