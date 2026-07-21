import { describe, expect, it } from "vitest";
import {
  PLATFORM_IMAGE_GEN_GROUP_ORDER,
  PLATFORM_IMAGE_GEN_TEMPLATES,
  buildPlatformImageGenPrompt,
  listPlatformImageGenByGroup,
  mapPlatformImageGenAspectForApi,
} from "./platformImageGenTemplates";

describe("platformImageGenTemplates", () => {
  it("keeps fixed group order and non-empty capabilityZh", () => {
    expect(PLATFORM_IMAGE_GEN_GROUP_ORDER.map((g) => g.id)).toEqual([
      "poster",
      "product",
      "brand",
      "ui",
      "chart",
      "photo",
      "illustration",
      "character",
      "food",
      "space",
    ]);
    expect(PLATFORM_IMAGE_GEN_TEMPLATES.length).toBeGreaterThanOrEqual(18);
    for (const t of PLATFORM_IMAGE_GEN_TEMPLATES) {
      expect(t.capabilityZh.trim().length).toBeGreaterThan(6);
      expect(t.promptZh.trim().length).toBeGreaterThan(20);
      expect(t.labelZh.trim().length).toBeGreaterThan(0);
    }
  });

  it("lists every group that has templates in order", () => {
    const groups = listPlatformImageGenByGroup();
    expect(groups.map((g) => g.group.id)).toEqual(
      PLATFORM_IMAGE_GEN_GROUP_ORDER.map((g) => g.id),
    );
    expect(groups.every((g) => g.items.length >= 1)).toBe(true);
  });

  it("builds inject block with capability and aspect", () => {
    const first = PLATFORM_IMAGE_GEN_TEMPLATES[0]!;
    const block = buildPlatformImageGenPrompt(first.id, { subjectHint: "东京" });
    expect(block).toContain("【文生图模板·");
    expect(block).toContain("能做什么：");
    expect(block).toContain(first.capabilityZh);
    expect(block).toContain("画幅建议：");
    expect(block).toContain("【用户补充】东京");
  });

  it("maps aspect hints to API 9:16 / 16:9", () => {
    expect(mapPlatformImageGenAspectForApi("9:16")).toBe("9:16");
    expect(mapPlatformImageGenAspectForApi("3:4")).toBe("9:16");
    expect(mapPlatformImageGenAspectForApi("1:1")).toBe("9:16");
    expect(mapPlatformImageGenAspectForApi("16:9")).toBe("16:9");
    expect(mapPlatformImageGenAspectForApi("2:1")).toBe("16:9");
  });

  it("does not leak competitor site names in user-facing template copy", () => {
    const blob = PLATFORM_IMAGE_GEN_TEMPLATES.map(
      (t) => `${t.labelZh} ${t.blurbZh} ${t.capabilityZh} ${t.promptZh}`,
    ).join("\n");
    expect(blob).not.toMatch(/canghe|prompthero|mkimage|promptalot|gpt-image2\.canghe/i);
  });
});
