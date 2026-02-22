import { describe, it, expect, vi, beforeEach } from "vitest";

// Top-level mock with factory that returns a module-scoped mock fn
const mockSubscribe = vi.fn();
const mockConfig = vi.fn();
const mockQueueStatus = vi.fn();

vi.mock("@fal-ai/client", () => ({
  fal: {
    config: mockConfig,
    subscribe: mockSubscribe,
    queue: { status: mockQueueStatus },
  },
}));

describe("Hunyuan3D Service", () => {
  beforeEach(() => {
    vi.resetModules();
    mockSubscribe.mockReset();
    mockConfig.mockReset();
    mockQueueStatus.mockReset();
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

  it("generate3DModel calls fal.subscribe with correct model ID for rapid mode", async () => {
    process.env.FAL_API_KEY = "test-key-123";
    mockSubscribe.mockResolvedValue({
      data: {
        model_mesh: { url: "https://example.com/model.glb" },
        obj: { url: "https://example.com/model.obj" },
        texture: { url: "https://example.com/texture.png" },
        thumbnail: { url: "https://example.com/thumb.png" },
      },
      requestId: "test-req-123",
    });

    const mod = await import("./hunyuan3d");
    const result = await mod.generate3DModel({
      image_url: "https://example.com/test.jpg",
      tier: "rapid",
    });

    expect(mockSubscribe).toHaveBeenCalledWith(
      "fal-ai/hunyuan-3d/v3.1/rapid/image-to-3d",
      expect.objectContaining({
        input: expect.objectContaining({
          input_image_url: expect.any(String),
        }),
      })
    );
    expect(result.status).toBe("completed");
    expect(result.output?.model_url).toBe("https://example.com/model.glb");
    expect(result.output?.obj_url).toBe("https://example.com/model.obj");
    expect(result.output?.texture_url).toBe("https://example.com/texture.png");
    expect(result.output?.preview_url).toBe("https://example.com/thumb.png");
  });

  it("generate3DModel uses pro model ID for pro mode with PBR", async () => {
    process.env.FAL_API_KEY = "test-key-456";
    mockSubscribe.mockResolvedValue({
      data: {
        model_mesh: { url: "https://example.com/pro.glb" },
      },
      requestId: "test-req-456",
    });

    const mod = await import("./hunyuan3d");
    await mod.generate3DModel({
      image_url: "https://example.com/test.jpg",
      tier: "pro",
      enable_pbr: true,
    });

    expect(mockSubscribe).toHaveBeenCalledWith(
      "fal-ai/hunyuan-3d/v3.1/pro/image-to-3d",
      expect.objectContaining({
        input: expect.objectContaining({
          input_image_url: expect.any(String),
          enable_pbr: true,
        }),
      })
    );
  });

  it("estimate3DCost returns correct credits for rapid", async () => {
    const mod = await import("./hunyuan3d");
    const est = mod.estimate3DCost("rapid", false, false, false);
    expect(est.credits).toBe(5);
    expect(est.tier).toBe("rapid");
  });

  it("estimate3DCost returns correct credits for rapid + PBR", async () => {
    const mod = await import("./hunyuan3d");
    const est = mod.estimate3DCost("rapid", true, false, false);
    expect(est.credits).toBe(8);
  });

  it("estimate3DCost returns correct credits for pro", async () => {
    const mod = await import("./hunyuan3d");
    const est = mod.estimate3DCost("pro", false, false, false);
    expect(est.credits).toBe(9);
  });

  it("estimate3DCost returns correct credits for pro full options", async () => {
    const mod = await import("./hunyuan3d");
    const est = mod.estimate3DCost("pro", true, true, true);
    expect(est.credits).toBe(18);
  });

  it("CREDIT_COSTS has idol3DRapid and idol3DPro entries", async () => {
    const { CREDIT_COSTS } = await import("../shared/plans");
    expect(CREDIT_COSTS.idol3DRapid).toBe(5);
    expect(CREDIT_COSTS.idol3DPro).toBe(9);
  });

  it("CREDIT_COSTS has rapid3D and pro3D entries", async () => {
    const { CREDIT_COSTS } = await import("../shared/plans");
    expect(CREDIT_COSTS.rapid3D).toBe(5);
    expect(CREDIT_COSTS.pro3D).toBe(9);
    expect(CREDIT_COSTS.rapid3D_pbr).toBe(8);
    expect(CREDIT_COSTS.pro3D_full).toBe(18);
  });
});
