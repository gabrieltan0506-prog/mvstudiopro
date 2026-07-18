import { describe, expect, it } from "vitest";
import {
  groupPlatformSkillsByCategory,
  isCanvasOnlySkillId,
  resolvePlatformSkillCategory,
} from "../../shared/platformSkillCategories.js";

describe("platformSkillCategories", () => {
  it("classifies core / graphic / templates / deck / video / lane / custom", () => {
    expect(resolvePlatformSkillCategory({ id: "hook-solution-cta" })).toBe("core");
    expect(resolvePlatformSkillCategory({ id: "xhs-collectible-note" })).toBe("graphic");
    expect(resolvePlatformSkillCategory({ id: "encyclopedic-infographic" })).toBe("templates");
    expect(resolvePlatformSkillCategory({ id: "website-html-ppt" })).toBe("deck");
    expect(resolvePlatformSkillCategory({ id: "director-craft" })).toBe("video");
    expect(resolvePlatformSkillCategory({ id: "forensic-life-lens" })).toBe("lane");
    expect(resolvePlatformSkillCategory({ id: "my-skill", source: "user" })).toBe("custom");
  });

  it("hides canvas-only skills from platform groups", () => {
    expect(isCanvasOnlySkillId("manhua-drama-studio")).toBe(true);
    expect(isCanvasOnlySkillId("screenwriter-genre-templates")).toBe(true);
    expect(isCanvasOnlySkillId("manhua-scene-asset-library")).toBe(true);
    const groups = groupPlatformSkillsByCategory([
      { id: "hook-solution-cta", source: "builtin" },
      { id: "manhua-drama-studio", source: "builtin" },
      { id: "seedance-i2v-motion", source: "builtin" },
      { id: "manhua-scene-asset-library", source: "builtin" },
    ]);
    const ids = groups.flatMap((g) => g.skills.map((s) => s.id));
    expect(ids).toContain("hook-solution-cta");
    expect(ids).not.toContain("manhua-drama-studio");
    expect(ids).not.toContain("seedance-i2v-motion");
    expect(ids).not.toContain("manhua-scene-asset-library");
  });
});
