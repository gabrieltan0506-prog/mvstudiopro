import { describe, expect, it } from "vitest";
import {
  MANHUA_SCENE_ASSET_LIBRARY,
  composeManhuaSceneCatalogForGenre,
  composeManhuaScenePromptBlock,
  getManhuaSceneTemplate,
  listManhuaScenes,
  recommendPrimaryManhuaSceneId,
  resolveManhuaScenes,
} from "./manhuaSceneAssetLibrary";

describe("manhuaSceneAssetLibrary", () => {
  it("has 20 scene templates with prompt and elements", () => {
    expect(MANHUA_SCENE_ASSET_LIBRARY).toHaveLength(20);
    for (const s of MANHUA_SCENE_ASSET_LIBRARY) {
      expect(s.promptZh.length).toBeGreaterThan(20);
      expect(s.coreElements.length).toBeGreaterThanOrEqual(3);
      expect(s.analysis.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("filters by genre and resolves defaults", () => {
    expect(listManhuaScenes({ genre: "campus" }).map((s) => s.id)).toEqual(["scene_14"]);
    expect(getManhuaSceneTemplate("scene_01")?.nameZh).toContain("宗门");
    const pack = resolveManhuaScenes({ genre: "xianxia" });
    expect(pack.length).toBeGreaterThanOrEqual(4);
    const block = composeManhuaSceneCatalogForGenre("urban");
    expect(block).toContain("现代豪宅");
    expect(block).toContain("【漫剧场景资产库");
    expect(composeManhuaScenePromptBlock([])).toBe("");
  });

  it("recommends a single primary scene per genre", () => {
    expect(recommendPrimaryManhuaSceneId("xianxia")).toBe("scene_01");
    expect(recommendPrimaryManhuaSceneId("campus")).toBe("scene_14");
    expect(resolveManhuaScenes({ genre: "xianxia", primaryOnly: true })).toHaveLength(1);
    expect(resolveManhuaScenes({ genre: "xianxia", primaryOnly: true })[0]?.id).toBe("scene_01");
  });
});
