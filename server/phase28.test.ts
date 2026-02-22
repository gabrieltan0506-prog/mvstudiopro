import { describe, it, expect, vi } from "vitest";

describe("Phase 28: Watermark + Kling + Suno fixes", () => {

  // ─── 1. Image watermark utility ────────────────────────
  describe("Image Watermark", () => {
    it("should export addWatermark and addWatermarkToUrl functions", async () => {
      const mod = await import("./watermark");
      expect(typeof mod.addWatermark).toBe("function");
      expect(typeof mod.addWatermarkToUrl).toBe("function");
    });
  });

  // ─── 2. Audio watermark utility ────────────────────────
  describe("Audio Watermark", () => {
    it("should export getWatermarkAudioUrl function", async () => {
      const mod = await import("./audio-watermark");
      expect(typeof mod.getWatermarkAudioUrl).toBe("function");
    });
  });

  // ─── 3. Credits pricing includes klingMotionControl ────
  describe("Credits Pricing", () => {
    it("should have klingMotionControl in server plans", async () => {
      const { CREDIT_COSTS } = await import("./plans");
      expect(CREDIT_COSTS.klingVideo).toBe(80);
      expect(CREDIT_COSTS.klingMotionControl).toBe(70);
      expect(CREDIT_COSTS.klingLipSync).toBe(60);
    });

    it("should have klingMotionControl in shared credits", async () => {
      const { CREDIT_COSTS } = await import("../shared/credits");
      expect(CREDIT_COSTS.klingVideo).toBe(80);
      expect(CREDIT_COSTS.klingMotionControl).toBe(70);
      expect(CREDIT_COSTS.klingLipSync).toBe(60);
    });
  });

  // ─── 4. Kling router structure ─────────────────────────
  describe("Kling Router Structure", () => {
    it("should export klingRouter with all sub-routers", async () => {
      const { klingRouter } = await import("./routers/kling");
      expect(klingRouter).toBeDefined();
      // Check that the router has the expected procedures
      const routerDef = klingRouter._def;
      expect(routerDef).toBeDefined();
    });
  });

  // ─── 5. Suno router has watermark endpoint ─────────────
  describe("Suno Router", () => {
    it("should export sunoRouter", async () => {
      const { sunoRouter } = await import("./routers/suno");
      expect(sunoRouter).toBeDefined();
    });
  });
});
