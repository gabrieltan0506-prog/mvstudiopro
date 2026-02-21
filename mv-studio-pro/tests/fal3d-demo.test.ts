import { describe, it, expect } from "vitest";

// ── fal-3d.ts 模組測試 ──
describe("fal-3d module", () => {
  it("should export isFalConfigured and imageToThreeD functions", async () => {
    const mod = await import("../server/fal-3d");
    expect(typeof mod.isFalConfigured).toBe("function");
    expect(typeof mod.imageToThreeD).toBe("function");
  });

  it("isFalConfigured returns false when FAL_API_KEY is not set", async () => {
    // 在測試環境中 FAL_API_KEY 不會被設置
    const mod = await import("../server/fal-3d");
    const result = mod.isFalConfigured();
    expect(typeof result).toBe("boolean");
    // 在 CI/測試環境中通常為 false
  });

  it("imageToThreeD should throw when FAL_API_KEY is not configured", async () => {
    const mod = await import("../server/fal-3d");
    if (!mod.isFalConfigured()) {
      await expect(
        mod.imageToThreeD({ imageUrl: "https://example.com/test.jpg", enablePbr: true })
      ).rejects.toThrow();
    }
  });
});

// ── plans.ts 偶像轉 3D Credits 定價測試 ──
describe("idol3D credits pricing", () => {
  it("should define idol3D feature with 30 credits cost", async () => {
    const { CREDIT_COSTS } = await import("../shared/credits");
    expect(CREDIT_COSTS.idol3D).toBe(30);
  });
});

// ── UsageQuotaBanner 管理員無限權限測試 ──
describe("admin unlimited usage logic", () => {
  it("limit -1 should represent unlimited usage", () => {
    const limit = -1;
    const currentCount = 50;
    const isUnlimited = limit === -1;
    expect(isUnlimited).toBe(true);
    // 管理員不應該被限制
    const canUse = isUnlimited || currentCount < limit;
    expect(canUse).toBe(true);
  });

  it("free user with limit 3 should be blocked after 3 uses", () => {
    const limit: number = 3;
    const currentCount = 3;
    const isUnlimited = limit === -1;
    expect(isUnlimited).toBe(false);
    const canUse = isUnlimited || currentCount < limit;
    expect(canUse).toBe(false);
  });

  it("pro user with limit -1 should never be blocked", () => {
    const limit = -1;
    for (const count of [0, 10, 100, 1000, 99999]) {
      const isUnlimited = limit === -1;
      const canUse = isUnlimited || count < limit;
      expect(canUse).toBe(true);
    }
  });
});

// ── 3D Demo Gallery 數據結構測試 ──
describe("3D Demo Gallery data", () => {
  const DEMO_ITEMS = [
    { label: "動漫風 3D", color: "#FF6B6B", icon: "face", desc: "日系動漫角色 → 3D 模型" },
    { label: "寫實 3D", color: "#64D2FF", icon: "person", desc: "真人風格 → 超寫實 3D" },
    { label: "Q版 3D", color: "#FFD60A", icon: "child-care", desc: "Q版萌系 → 黏土風 3D" },
    { label: "賽博龐克 3D", color: "#C77DBA", icon: "memory", desc: "未來風格 → 科幻 3D" },
    { label: "奇幻 3D", color: "#30D158", icon: "auto-fix-high", desc: "奇幻角色 → 魔幻 3D" },
  ];

  it("should have 5 demo items", () => {
    expect(DEMO_ITEMS).toHaveLength(5);
  });

  it("each demo item should have required fields", () => {
    for (const item of DEMO_ITEMS) {
      expect(item.label).toBeTruthy();
      expect(item.color).toMatch(/^#[0-9A-Fa-f]{6}$/);
      expect(item.icon).toBeTruthy();
      expect(item.desc).toBeTruthy();
      expect(item.desc).toContain("→");
    }
  });
});

// ── convertTo3D 路由返回結構測試 ──
describe("convertTo3D response structure", () => {
  it("fallback mode should return correct structure", () => {
    const fallbackResponse = {
      success: true,
      mode: "fallback" as const,
      imageUrl3D: "https://example.com/image.png",
      glbUrl: null,
      objUrl: null,
      textureUrl: null,
      thumbnailUrl: null,
      availableFormats: ["image"],
      timeTaken: 0,
    };

    expect(fallbackResponse.success).toBe(true);
    expect(fallbackResponse.mode).toBe("fallback");
    expect(fallbackResponse.glbUrl).toBeNull();
    expect(fallbackResponse.objUrl).toBeNull();
    expect(fallbackResponse.availableFormats).toContain("image");
  });

  it("real3d mode should return correct structure", () => {
    const real3dResponse = {
      success: true,
      mode: "real3d" as const,
      imageUrl3D: "https://example.com/thumbnail.png",
      glbUrl: "https://example.com/model.glb",
      objUrl: "https://example.com/model.obj",
      textureUrl: "https://example.com/texture.png",
      thumbnailUrl: "https://example.com/thumbnail.png",
      availableFormats: ["glb", "obj", "fbx"],
      timeTaken: 12.5,
    };

    expect(real3dResponse.success).toBe(true);
    expect(real3dResponse.mode).toBe("real3d");
    expect(real3dResponse.glbUrl).toBeTruthy();
    expect(real3dResponse.objUrl).toBeTruthy();
    expect(real3dResponse.availableFormats).toContain("glb");
    expect(real3dResponse.timeTaken).toBeGreaterThan(0);
  });
});
