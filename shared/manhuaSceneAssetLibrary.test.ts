import { describe, expect, it } from "vitest";
import {
  MANHUA_SCENE_ASSET_LIBRARY,
  composeManhuaSceneCatalogForGenre,
  composeManhuaScenePromptBlock,
  getManhuaSceneTemplate,
  listManhuaScenes,
  recommendManhuaSceneFromTopic,
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

  it("recommends concrete scene from topic keywords (⑤D)", () => {
    expect(recommendManhuaSceneFromTopic("外门弟子雨夜闯秘境").sceneId).toBe("scene_04");
    // 身份词「仙门/外门」不得压过情节落点「闯秘境」
    expect(recommendManhuaSceneFromTopic("仙门外门弟子闯秘境").sceneId).toBe("scene_04");
    expect(recommendManhuaSceneFromTopic("霸总办公室夜景对峙").sceneId).toBe("scene_12");
    expect(recommendManhuaSceneFromTopic("校园教室青春告白").sceneId).toBe("scene_14");
    expect(recommendManhuaSceneFromTopic("黑客入侵信息战").sceneId).toBe("scene_20");
    // 有剧种时不跨池：都市题材里的「霓虹」仍落酒吧，不落到仙侠
    expect(recommendManhuaSceneFromTopic("霓虹酒吧邂逅", { genre: "urban" }).sceneId).toBe(
      "scene_13",
    );
    expect(recommendManhuaSceneFromTopic("修仙日常", { genre: "xianxia" }).sceneId).toBe(
      "scene_01",
    );
  });

  it("recommends 秘境洞府 from 闯关试炼", () => {
    expect(recommendManhuaSceneFromTopic("外门弟子闯关试炼").sceneId).toBe("scene_04");
  });

  it("recommends 酒吧夜店 from 地下拳场/赛车", () => {
    expect(recommendManhuaSceneFromTopic("地下拳场黑拳对决").sceneId).toBe("scene_13");
    expect(recommendManhuaSceneFromTopic("地下赛车夜飙").sceneId).toBe("scene_13");
  });

  it("recommends 练剑广场 from 宗门大比", () => {
    expect(recommendManhuaSceneFromTopic("宗门大比弟子考核").sceneId).toBe("scene_03");
  });

  it("recommends 魔宫 from 炼狱魔域", () => {
    expect(recommendManhuaSceneFromTopic("炼狱魔域黑曜宫殿").sceneId).toBe("scene_05");
  });

  it("recommends 长安街市 from 夜市花灯", () => {
    expect(recommendManhuaSceneFromTopic("夜市花灯烟火气").sceneId).toBe("scene_07");
  });

  it("recommends 府邸 from 内宅闺阁", () => {
    expect(recommendManhuaSceneFromTopic("内宅闺阁宅斗").sceneId).toBe("scene_08");
  });

  it("recommends 战场 from 攻城", () => {
    expect(recommendManhuaSceneFromTopic("攻城大战战旗").sceneId).toBe("scene_09");
  });

  it("recommends 边塞 from 狼烟", () => {
    expect(recommendManhuaSceneFromTopic("戍边狼烟关隘").sceneId).toBe("scene_10");
  });

  it("recommends 豪宅 from 顶层公寓", () => {
    expect(recommendManhuaSceneFromTopic("顶层公寓天台酒会").sceneId).toBe("scene_11");
  });

  it("recommends 星舰 from 轨道站", () => {
    expect(recommendManhuaSceneFromTopic("轨道站登陆舱").sceneId).toBe("scene_16");
  });

  it("recommends 未来城市 from 悬浮车", () => {
    expect(recommendManhuaSceneFromTopic("赛博悬浮车天际线").sceneId).toBe("scene_15");
  });

  it("recommends 避难所 from 辐射区", () => {
    expect(recommendManhuaSceneFromTopic("辐射区废墟城").sceneId).toBe("scene_17");
  });

  it("recommends 实验室 from 克隆舱", () => {
    expect(recommendManhuaSceneFromTopic("克隆舱禁区实验").sceneId).toBe("scene_18");
  });


  it("recommends 密室 from 证物袋", () => {
    expect(recommendManhuaSceneFromTopic("证物袋案发现场").sceneId).toBe("scene_19");
  });

  it("recommends 黑客 from 暗网", () => {
    expect(recommendManhuaSceneFromTopic("暗网入侵终端").sceneId).toBe("scene_20");
  });


  it("recommends 皇宫 from 御书房", () => {
    expect(recommendManhuaSceneFromTopic("御书房金銮殿").sceneId).toBe("scene_06");
  });

  it("recommends 宗门 from 外门", () => {
    expect(recommendManhuaSceneFromTopic("外门内门考核").sceneId).toBe("scene_01");
  });

  it("recommends 云海 from 仙鹤", () => {
    expect(recommendManhuaSceneFromTopic("仙鹤悬崖仙亭").sceneId).toBe("scene_02");
  });

  it("recommends 校园 from 天台告白", () => {
    expect(recommendManhuaSceneFromTopic("天台告白操场").sceneId).toBe("scene_14");
  });

});
