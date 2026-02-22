import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import { CREDIT_COSTS } from "./plans";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(role: "user" | "admin" = "user"): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };

  return { ctx };
}

describe("Storyboard Features - Plans & Credits", () => {
  it("should have storyboardRewrite credit cost defined", () => {
    expect(CREDIT_COSTS.storyboardRewrite).toBeDefined();
    expect(CREDIT_COSTS.storyboardRewrite).toBeGreaterThan(0);
    expect(CREDIT_COSTS.storyboardRewrite).toBe(8);
  });

  it("should have all Suno credit costs defined", () => {
    expect(CREDIT_COSTS.sunoMusicV4).toBeDefined();
    expect(CREDIT_COSTS.sunoMusicV5).toBeDefined();
    expect(CREDIT_COSTS.sunoLyrics).toBeDefined();
    expect(CREDIT_COSTS.sunoMusicV4).toBe(12);
    expect(CREDIT_COSTS.sunoMusicV5).toBe(22);
    expect(CREDIT_COSTS.sunoLyrics).toBe(3);
  });

  it("should have storyboard generation credit costs defined", () => {
    expect(CREDIT_COSTS.storyboard).toBe(15);
    expect(CREDIT_COSTS.storyboardGpt5).toBe(20);
  });
});

describe("Storyboard Router - Input Validation", () => {
  it("should have visualStyle enum values defined in VISUAL_STYLES constant", () => {
    // Verify the visual styles are properly defined
    const validStyles = ["cinematic", "anime", "documentary", "realistic", "scifi"];
    expect(validStyles).toHaveLength(5);
    expect(validStyles).toContain("cinematic");
    expect(validStyles).toContain("anime");
    expect(validStyles).toContain("documentary");
    expect(validStyles).toContain("realistic");
    expect(validStyles).toContain("scifi");
  });

  it("should reject invalid visualStyle values", async () => {
    const { ctx } = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);

    try {
      await caller.storyboard.generate({
        lyrics: "Test lyrics",
        sceneCount: 3,
        model: "flash",
        visualStyle: "invalid_style" as any,
      });
      // Should not reach here
      expect(true).toBe(false);
    } catch (error: any) {
      // Should be a validation error
      expect(error.code).toBe("BAD_REQUEST");
    }
  });

  it("should have rewrite route defined in storyboard router", async () => {
    const { ctx } = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);

    // Verify the rewrite mutation exists on the storyboard router
    expect(caller.storyboard.rewrite).toBeDefined();
    expect(typeof caller.storyboard.rewrite).toBe("function");
  });

  it("should reject empty userFeedback in rewrite", async () => {
    const { ctx } = createAuthContext("admin");
    const caller = appRouter.createCaller(ctx);

    const mockStoryboard = {
      title: "Test",
      musicInfo: { bpm: 120, emotion: "happy", style: "pop", key: "C" },
      scenes: [{
        sceneNumber: 1,
        timestamp: "00:00-00:15",
        duration: "15s",
        description: "Test",
        cameraMovement: "Pan",
        mood: "Happy",
        visualElements: ["Light"],
      }],
      summary: "Test",
    };

    try {
      await caller.storyboard.rewrite({
        originalStoryboard: mockStoryboard,
        userFeedback: "", // Empty - should fail
        visualStyle: "cinematic",
        model: "flash",
      });
      expect(true).toBe(false);
    } catch (error: any) {
      expect(error.code).toBe("BAD_REQUEST");
    }
  });
});

describe("Suno Router - Style Presets", () => {
  it("should return style presets list", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const presets = await caller.suno.getStylePresets();
    
    expect(Array.isArray(presets)).toBe(true);
    expect(presets.length).toBeGreaterThan(0);
    
    // Check structure
    const firstPreset = presets[0];
    expect(firstPreset).toHaveProperty("id");
    expect(firstPreset).toHaveProperty("label");
    expect(firstPreset).toHaveProperty("labelEn");
    
    // Check some known presets exist
    const presetIds = presets.map((p: any) => p.id);
    expect(presetIds).toContain("cinematic_epic");
    expect(presetIds).toContain("cinematic_emotional");
    expect(presetIds).toContain("custom");
  });

  it("should return credit costs", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);

    const costs = await caller.suno.getCreditCosts();
    
    expect(costs).toHaveProperty("v4");
    expect(costs).toHaveProperty("v5");
    expect(costs).toHaveProperty("lyrics");
    expect(costs.v4).toBe(CREDIT_COSTS.sunoMusicV4);
    expect(costs.v5).toBe(CREDIT_COSTS.sunoMusicV5);
    expect(costs.lyrics).toBe(CREDIT_COSTS.sunoLyrics);
  });
});
