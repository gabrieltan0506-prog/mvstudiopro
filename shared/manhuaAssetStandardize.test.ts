import { describe, expect, it } from "vitest";
import {
  manhuaAssetStandardizeCredits,
  normalizeManhuaAssetStandardizeQuality,
} from "./manhuaAssetStandardize";

describe("manhuaAssetStandardize pricing", () => {
  it("medium 3 积分、high 5 积分，未知值安全回 medium", () => {
    expect(manhuaAssetStandardizeCredits("medium")).toBe(3);
    expect(manhuaAssetStandardizeCredits("high")).toBe(5);
    expect(normalizeManhuaAssetStandardizeQuality("bad")).toBe("medium");
  });
});
