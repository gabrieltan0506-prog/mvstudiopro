import { describe, expect, it } from "vitest";
import {
  clampSeedanceOpenRouterDuration,
  isOpenRouterSeedanceVersion,
  normalizeSeedanceOpenRouterQuality,
  parseSeedanceProductVersion,
  resolveSeedanceOpenRouterModelId,
  seedanceVariantFromCanvasVideoModel,
} from "./seedanceOpenRouterModels";

describe("seedanceOpenRouterModels", () => {
  it("parses product versions including fast", () => {
    expect(parseSeedanceProductVersion("2.0-fast")).toBe("2.0-fast");
    expect(parseSeedanceProductVersion("fast")).toBe("2.0-fast");
    expect(parseSeedanceProductVersion("2.0")).toBe("2.0");
    expect(parseSeedanceProductVersion("mini")).toBe("2.0-mini");
    expect(isOpenRouterSeedanceVersion("2.0")).toBe(true);
    expect(isOpenRouterSeedanceVersion("2.0-fast")).toBe(true);
    expect(isOpenRouterSeedanceVersion("2.0-mini")).toBe(false);
  });

  it("resolves OpenRouter model ids", () => {
    expect(resolveSeedanceOpenRouterModelId("2.0")).toBe("bytedance/seedance-2.0");
    expect(resolveSeedanceOpenRouterModelId("2.0-fast")).toBe("bytedance/seedance-2.0-fast");
  });

  it("clamps duration and quality", () => {
    expect(clampSeedanceOpenRouterDuration(undefined)).toBe(15);
    expect(clampSeedanceOpenRouterDuration(3)).toBe(4);
    expect(clampSeedanceOpenRouterDuration(99)).toBe(15);
    expect(normalizeSeedanceOpenRouterQuality("2.0-fast", "1080p")).toBe("720p");
    expect(normalizeSeedanceOpenRouterQuality("2.0", "1080p")).toBe("1080p");
  });

  it("maps canvas videoModel", () => {
    expect(seedanceVariantFromCanvasVideoModel("seedance-2.0")).toBe("2.0");
    expect(seedanceVariantFromCanvasVideoModel("seedance-2.0-fast")).toBe("2.0-fast");
    expect(seedanceVariantFromCanvasVideoModel("gemini-omni-flash")).toBeNull();
  });
});
