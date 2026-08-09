import { describe, expect, it } from "vitest";
import {
  clampSeedanceDuration,
  inferSeedanceMode,
  isSeedance25PubliclyEnabled,
  normalizeSeedance25EvolinkMode,
  resolveSeedanceModelId,
} from "../../shared/seedanceEvolinkModels";
import { SEEDANCE_25_LAUNCH_AT_MS } from "../../shared/seedance25Access";
import { isSeedance25Enabled } from "./evolinkSeedanceVideo";

describe("seedance evolink models", () => {
  it("resolves 2.0 three modes and Seedance 2.5 five modes", () => {
    expect(resolveSeedanceModelId("2.0", "text_to_video")).toBe("seedance-2.0-text-to-video");
    expect(resolveSeedanceModelId("2.0", "image_to_video")).toBe("seedance-2.0-image-to-video");
    expect(resolveSeedanceModelId("2.0", "reference_to_video")).toBe("seedance-2.0-reference-to-video");
    expect(resolveSeedanceModelId("2.0-mini", "text_to_video")).toBe("seedance-2.0-mini-text-to-video");
    expect(resolveSeedanceModelId("2.0-mini", "image_to_video")).toBe("seedance-2.0-mini-image-to-video");
    expect(resolveSeedanceModelId("2.0-mini", "reference_to_video")).toBe(
      "seedance-2.0-mini-reference-to-video",
    );
    expect(resolveSeedanceModelId("2.5", "text_to_video")).toBe("seedance-2.5-text-to-video");
    expect(resolveSeedanceModelId("2.5", "image_to_video")).toBe("seedance-2.5-image-to-video");
    expect(resolveSeedanceModelId("2.5", "reference_to_video")).toBe("seedance-2.5-reference-to-video");
    expect(resolveSeedanceModelId("2.5", "video_edit")).toBe("seedance-2.5-video-edit");
    expect(resolveSeedanceModelId("2.5", "video_extend")).toBe("seedance-2.5-video-extend");
  });

  it("clamps duration per version (mini 已产品化，默认跟 2.0 一样 15 秒)", () => {
    expect(clampSeedanceDuration("2.0", undefined)).toBe(15);
    expect(clampSeedanceDuration("2.0", 99)).toBe(15);
    // mini 是 39 积分/段的售卖档，漏传时长时不能只出 5 秒探针片
    expect(clampSeedanceDuration("2.0-mini", undefined)).toBe(15);
    expect(clampSeedanceDuration("2.0-mini", 5)).toBe(5);
    expect(clampSeedanceDuration("2.0-mini", 99)).toBe(15);
    expect(clampSeedanceDuration("2.5", 99)).toBe(30);
    expect(clampSeedanceDuration("2.5", 8)).toBe(8);
  });

  it("infers mode from media", () => {
    expect(inferSeedanceMode({})).toBe("text_to_video");
    expect(inferSeedanceMode({ imageUrls: ["https://a"] })).toBe("image_to_video");
    expect(inferSeedanceMode({ imageUrls: ["https://a", "https://b"] })).toBe("reference_to_video");
    expect(inferSeedanceMode({ videoUrls: ["https://v"] })).toBe("reference_to_video");
  });

  it("normalizes five direct modes and legacy canvas aliases", () => {
    expect(normalizeSeedance25EvolinkMode("text_to_video")).toBe("text_to_video");
    expect(normalizeSeedance25EvolinkMode("video_edit")).toBe("video_edit");
    expect(normalizeSeedance25EvolinkMode("extend")).toBe("video_extend");
    expect(normalizeSeedance25EvolinkMode("reshoot")).toBe("video_edit");
    expect(normalizeSeedance25EvolinkMode("upscale")).toBe("video_edit");
    expect(normalizeSeedance25EvolinkMode("erase_subtitle")).toBe("video_edit");
    expect(normalizeSeedance25EvolinkMode("generate", { imageUrls: ["https://a"] })).toBe(
      "image_to_video",
    );
  });

  // 用户 2026-08-05 明文：对外宣称上线日，到点自动开放（日期真源见 shared/seedance25Access.ts）
  it("opens Seedance 2.5 automatically at the configured launch moment", () => {
    expect(isSeedance25PubliclyEnabled(SEEDANCE_25_LAUNCH_AT_MS - 60_000)).toBe(false);
    expect(isSeedance25PubliclyEnabled(SEEDANCE_25_LAUNCH_AT_MS)).toBe(true);
  });

  it("before launch only opens with the internal env flag", () => {
    const prev = process.env.SEEDANCE_25_ENABLED;
    delete process.env.SEEDANCE_25_ENABLED;
    // 上线后 isSeedance25Enabled() 恒为 true，此断言只在上线前有意义
    if (!isSeedance25PubliclyEnabled()) {
      expect(isSeedance25Enabled()).toBe(false);
      process.env.SEEDANCE_25_ENABLED = "1";
      expect(isSeedance25Enabled()).toBe(true);
    }
    if (prev === undefined) delete process.env.SEEDANCE_25_ENABLED;
    else process.env.SEEDANCE_25_ENABLED = prev;
  });
});
