import { describe, expect, it } from "vitest";
import { MANHUA_SCENE_ASSET_LIBRARY } from "./manhuaSceneAssetLibrary";
import { isManhuaDemoAssetPublicReady } from "./manhuaDemoPublicReady";
import {
  MANHUA_CONTENT_LANE_WEIGHT,
  MANHUA_SCENE_PROP_DEMO_CATALOG,
  composeManhuaPropDemoPromptBlock,
  composeManhuaSceneDemoAnchorBlock,
  composeManhuaSelectedPropAnchorBlock,
  getManhuaDemoAssetPublicUrl,
  listManhuaDemoAssets,
  listManhuaDemoAssetsForSceneTemplate,
  listManhuaSceneTemplateIdsWithDemo,
  pickDailyManhuaDemoBatch,
  contentLanesForSceneGenre,
  recommendManhuaContentLanesFromTopic,
} from "./manhuaScenePropDemoCatalog";

describe("manhuaScenePropDemoCatalog", () => {
  it("excludes comedy_skip from generatable list", () => {
    expect(MANHUA_CONTENT_LANE_WEIGHT.comedy_skip).toBe("skip");
    expect(listManhuaDemoAssets().every((a) => a.lane !== "comedy_skip")).toBe(true);
  });

  it("marks intrigue and business as high (overseas)", () => {
    expect(MANHUA_CONTENT_LANE_WEIGHT.intrigue).toBe("high");
    expect(MANHUA_CONTENT_LANE_WEIGHT.business).toBe("high");
    const overseas = MANHUA_SCENE_PROP_DEMO_CATALOG.filter(
      (a) => a.lane === "intrigue" || a.lane === "business",
    );
    expect(overseas.length).toBeGreaterThanOrEqual(6);
    expect(overseas.every((a) => a.weight === "high")).toBe(true);
  });

  it("pickDaily round-robins high lanes then medium and respects done set", () => {
    const batch = pickDailyManhuaDemoBatch(new Set(), {
      highScenes: 3,
      highProps: 3,
      mediumScenes: 1,
      mediumProps: 1,
    });
    expect(batch).toHaveLength(8);
    expect(batch.filter((a) => a.weight === "high").length).toBe(6);
    expect(batch.filter((a) => a.weight === "medium").length).toBe(2);
    const highLanes = new Set(batch.filter((a) => a.weight === "high").map((a) => a.lane));
    expect(highLanes.size).toBeGreaterThanOrEqual(3);

    const done = new Set(batch.map((a) => a.id));
    const next = pickDailyManhuaDemoBatch(done, {
      highScenes: 2,
      highProps: 2,
      mediumScenes: 0,
      mediumProps: 0,
    });
    expect(next.every((a) => !done.has(a.id))).toBe(true);
  });

  it("binds every scene_01…20 template to at least one demo catalog entry", () => {
    const bound = new Set(listManhuaSceneTemplateIdsWithDemo());
    expect(bound.size).toBe(MANHUA_SCENE_ASSET_LIBRARY.length);
    for (const s of MANHUA_SCENE_ASSET_LIBRARY) {
      expect(bound.has(s.id)).toBe(true);
      expect(listManhuaDemoAssetsForSceneTemplate(s.id).length).toBeGreaterThan(0);
    }
  });

  it("only exposes public urls for demos that are on disk (no pending placeholders)", () => {
    expect(getManhuaDemoAssetPublicUrl("demo_scene_xianxia_sect")).toBe(
      "/manhua-scenes/demo_scene_xianxia_sect.jpg",
    );
    expect(isManhuaDemoAssetPublicReady("demo_scene_xianxia_sect")).toBe(true);
    // 目录有条目但未落盘 → URL 必须为空（UI 不得展示待生成）
    expect(getManhuaDemoAssetPublicUrl("demo_scene_intrigue_court")).toBe("");
    expect(getManhuaDemoAssetPublicUrl("demo_prop_business_fountain_pen")).toBe("");
  });

  it("exposes prompt anchors for scene/prop demos", () => {
    const sceneAnchor = composeManhuaSceneDemoAnchorBlock("scene_06");
    expect(sceneAnchor).toContain("【场景示范图锚点】");
    expect(sceneAnchor).toContain("皇宫");
    const propBlock = composeManhuaPropDemoPromptBlock({ lanes: ["business", "intrigue"], limit: 3 });
    expect(propBlock).toContain("【道具示范库】");
    const pinned = composeManhuaSelectedPropAnchorBlock(["demo_prop_business_fountain_pen"]);
    expect(pinned).toContain("【点选道具锚点】");
    expect(pinned).toContain("签约钢笔");
    expect(
      composeManhuaPropDemoPromptBlock({
        propIds: ["demo_prop_business_fountain_pen"],
        lanes: ["romance"],
        limit: 2,
      }),
    ).toContain("已点选");
    expect(recommendManhuaContentLanesFromTopic("宫廷权谋商战并购")).toEqual(
      expect.arrayContaining(["intrigue", "business"]),
    );
    expect(contentLanesForSceneGenre("urban")).toEqual(
      expect.arrayContaining(["business", "romance"]),
    );
    expect(contentLanesForSceneGenre("ancient")).toEqual(
      expect.arrayContaining(["intrigue", "ancient"]),
    );
  });
});
