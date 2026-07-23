import { describe, expect, it } from "vitest";
import {
  collectManhuaIdentityImageUrls,
  evaluateManhuaAssetImageGate,
  planManhuaAssetImageSpawns,
} from "./manhuaAssetImageGate";

describe("manhuaAssetImageGate", () => {
  it("B: library preview alone is not ready — needs charsheet/sceneplate or custom upload", () => {
    const empty = evaluateManhuaAssetImageGate({});
    expect(empty.ready).toBe(false);

    const castOnly = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07", "char_m_02"],
    });
    expect(castOnly.castLocked).toBe(true);
    expect(castOnly.castImagesReady).toBe(false);
    expect(castOnly.ready).toBe(false);

    const bothNoSheets = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07", "char_m_02"],
      sceneId: "scene_04",
    });
    expect(bothNoSheets.castLocked).toBe(true);
    expect(bothNoSheets.sceneLocked).toBe(true);
    expect(bothNoSheets.ready).toBe(false);
    expect(bothNoSheets.hintZh).toMatch(/资产设定|设定图/);
  });

  it("ready when charsheet + sceneplate media exist", () => {
    const gate = evaluateManhuaAssetImageGate({
      characterIds: ["char_f_07"],
      sceneId: "scene_04",
      assetBlocks: [
        { id: "charsheet-char_f_07", outputUrl: "https://cdn.example/sheet.jpg" },
        { id: "sceneplate-scene_04", outputUrl: "https://cdn.example/scene.jpg" },
      ],
    });
    expect(gate.ready).toBe(true);
    expect(gate.viaCustomUpload).toBe(false);
  });

  it("ready when canvas sheets exist even if node ids differ from table ids", () => {
    const gate = evaluateManhuaAssetImageGate({
      assetCanon: {
        characters: [
          { id: "wa_hero", nameZh: "阿凛", lookZh: "短发", promptZh: "少年" },
          { id: "wa_villain", nameZh: "权相", lookZh: "官服", promptZh: "权臣" },
        ],
        locations: [{ id: "wa_hall", nameZh: "议事厅", promptZh: "厅堂" }],
        props: [],
        episodeMainSceneId: { 1: "wa_hall" },
      } as any,
      episodeIndex: 1,
      assetBlocks: [
        // id 不含 wa_*，但画布上已有两张定妆 + 一张空镜
        { id: "charsheet-ep1-a", outputUrl: "https://cdn.example/a.jpg" },
        { id: "charsheet-ep1-b", outputUrl: "https://cdn.example/b.jpg" },
        { id: "sceneplate-ep1-main", outputUrl: "https://cdn.example/s.jpg" },
      ],
    });
    expect(gate.castLocked).toBe(true);
    expect(gate.sceneLocked).toBe(true);
    expect(gate.castImagesReady).toBe(true);
    expect(gate.sceneImageReady).toBe(true);
    expect(gate.ready).toBe(true);
  });

  it("plans charsheet/sceneplate when missing", () => {
    const plans = planManhuaAssetImageSpawns({
      characterIds: ["char_f_07"],
      sceneId: "scene_12",
      topic: "办公室谈判",
    });
    expect(plans.some((p) => p.kind === "charsheet")).toBe(true);
    expect(plans.some((p) => p.kind === "sceneplate")).toBe(true);
  });

  it("plans ancient archetype sheets with Chinese labels not raw arch_ ids", () => {
    const plans = planManhuaAssetImageSpawns({
      ancientArchetypeIds: ["arch_phoenix_empress", "arch_rain_jianghu_dao"],
      sceneId: "scene_06",
      topic: "朝堂与江湖",
    });
    const phoenix = plans.find((p) => p.id.includes("arch_phoenix_empress"));
    const dao = plans.find((p) => p.id.includes("arch_rain_jianghu_dao"));
    expect(phoenix?.kind).toBe("charsheet");
    expect(phoenix?.labelZh).toBe("凤曌女帝");
    expect(phoenix?.prompt).toContain("禁字硬锁");
    expect(dao?.labelZh).toBe("雨夜江湖刀客");
    expect(plans.some((p) => p.labelZh?.startsWith("arch_"))).toBe(false);
    expect(plans.some((p) => p.kind === "sceneplate" && p.labelZh === "皇宫大殿")).toBe(true);
  });

  it("diverts writer character named like scene library into sceneplate", () => {
    const plans = planManhuaAssetImageSpawns({
      assetCanon: {
        characters: [
          {
            id: "wa_mis_hall",
            nameZh: "皇宫大殿",
            lookZh: "金柱龙椅",
            promptZh: "皇宫大殿空镜",
          },
        ],
        locations: [],
        props: [],
        episodeMainSceneId: {},
      } as any,
      episodeIndex: 1,
      topic: "朝堂权谋",
    });
    expect(plans.some((p) => p.kind === "charsheet" && p.labelZh === "皇宫大殿")).toBe(false);
    expect(
      plans.some(
        (p) => p.kind === "sceneplate" && p.id.includes("wa_mis_hall") && p.labelZh === "皇宫大殿",
      ),
    ).toBe(true);
  });

  it("custom tagged character+scene unlocks gate without library ids", () => {
    const gate = evaluateManhuaAssetImageGate({
      customRefs: [
        { id: "c1", url: "https://cdn.example/c.jpg", role: "character" },
        { id: "s1", url: "https://cdn.example/s.jpg", role: "scene" },
      ],
    });
    expect(gate.viaCustomUpload).toBe(true);
    expect(gate.ready).toBe(true);
    expect(
      planManhuaAssetImageSpawns({
        customRefs: [
          { id: "c1", url: "https://cdn.example/c.jpg", role: "character" },
          { id: "s1", url: "https://cdn.example/s.jpg", role: "scene" },
        ],
      }),
    ).toEqual([]);
  });

  it("forceEpisodeSheets still plans when custom pad already unlocked gate", () => {
    const plans = planManhuaAssetImageSpawns(
      {
        characterIds: ["char_f_07"],
        sceneId: "scene_04",
        customRefs: [
          { id: "c1", url: "https://cdn.example/c.jpg", role: "character" },
          { id: "s1", url: "https://cdn.example/s.jpg", role: "scene" },
        ],
      },
      { forceEpisodeSheets: true },
    );
    expect(plans.some((p) => p.kind === "charsheet" && p.id.includes("char_f_07"))).toBe(true);
    expect(plans.some((p) => p.kind === "sceneplate" && p.id.includes("scene_04"))).toBe(true);
  });

  it("collects identity urls from custom cast + charsheets", () => {
    const urls = collectManhuaIdentityImageUrls({
      characterIds: ["char_f_07"],
      customRefs: [{ id: "c1", url: "https://cdn.example/c.jpg", role: "character" }],
      assetBlocks: [{ id: "charsheet-char_f_07", outputUrl: "https://cdn.example/sheet.jpg" }],
    });
    expect(urls).toContain("https://cdn.example/c.jpg");
    expect(urls).toContain("https://cdn.example/sheet.jpg");
  });

  it("viaWriterCanon: plans charsheet/sceneplate from table anchors", () => {
    const assetCanon = {
      characters: [
        {
          id: "wa_char_shen",
          role: "character" as const,
          nameZh: "沈砚舟",
          lookZh: "玄色鹤氅",
          promptZh: "原创角色设定卡·沈砚舟。外形：玄色鹤氅。",
        },
      ],
      props: [],
      locations: [
        {
          id: "wa_scene_miao",
          role: "scene" as const,
          nameZh: "山神破庙",
          lookZh: "断梁神像",
          motiveZh: "阴冷破败",
          promptZh: "原创场景空镜·山神破庙。氛围：阴冷破败。",
        },
      ],
      episodeMainSceneId: { 1: "wa_scene_miao" },
    };
    const gate = evaluateManhuaAssetImageGate({
      assetCanon,
      episodeIndex: 1,
    });
    expect(gate.viaWriterCanon).toBe(true);
    expect(gate.castLocked).toBe(true);
    expect(gate.sceneLocked).toBe(true);
    expect(gate.ready).toBe(false);

    const plans = planManhuaAssetImageSpawns({ assetCanon, episodeIndex: 1, topic: "鹤归" });
    expect(plans.some((p) => p.id.includes("wa_char_shen"))).toBe(true);
    expect(plans.some((p) => p.id.includes("wa_scene_miao"))).toBe(true);
    // 外形字段过薄 → 仍走旧半身定妆
    expect(plans.find((p) => p.id.includes("wa_char_shen"))?.layout).toBe("single");

    const ready = evaluateManhuaAssetImageGate({
      assetCanon,
      episodeIndex: 1,
      assetBlocks: [
        { id: "charsheet-wa_char_shen", outputUrl: "https://cdn.example/c.jpg" },
        { id: "sceneplate-wa_scene_miao", outputUrl: "https://cdn.example/s.jpg" },
      ],
    });
    expect(ready.ready).toBe(true);
    expect(ready.viaWriterCanon).toBe(true);
  });

  it("hero sheet + four-view scene when fields/episodes qualify", () => {
    const assetCanon = {
      characters: [
        {
          id: "wa_char_shence",
          role: "character" as const,
          nameZh: "沈策",
          lookZh: "二十四岁，浓眉窄眼，右眉尾短疤；旧玄甲外罩深灰披风，左腕缠皮护腕",
          motiveZh: "洗清父亲通敌罪名",
          promptZh: "原创角色定妆肖像：沈策",
        },
        {
          id: "wa_char_liumin",
          role: "character" as const,
          nameZh: "流民",
          lookZh: "破衣褴褛的边民一群挤在关前",
          motiveZh: "求生",
          promptZh: "群像",
        },
      ],
      props: [
        {
          id: "wa_prop_yupei",
          role: "prop" as const,
          nameZh: "双鱼玉佩",
          lookZh: "半佩温玉",
          motiveZh: "父辈信物",
          promptZh: "玉佩",
        },
      ],
      locations: [
        {
          id: "wa_scene_liangcang",
          role: "scene" as const,
          nameZh: "边军粮仓",
          lookZh: "木梁低压、三重铜锁",
          motiveZh: "空仓反差",
          promptZh: "原创场景空镜·边军粮仓",
        },
        {
          id: "wa_scene_fenghuo",
          role: "scene" as const,
          nameZh: "烽火岭",
          lookZh: "狼烟柴堆",
          motiveZh: "风大",
          promptZh: "原创场景空镜·烽火岭",
        },
      ],
      episodeMainSceneId: { 1: "wa_scene_liangcang", 2: "wa_scene_liangcang" },
    };
    const episodes = [
      { index: 1, body: "沈策入边军粮仓验毒。" },
      { index: 2, body: "两人潜回边军粮仓取账，再上烽火岭。" },
    ];
    const plans = planManhuaAssetImageSpawns(
      { assetCanon, episodeIndex: 1, topic: "雪关", episodes },
      { forceEpisodeSheets: true },
    );
    const hero = plans.find((p) => p.id.includes("wa_char_shence"));
    const crowd = plans.find((p) => p.id.includes("wa_char_liumin"));
    const granary = plans.find((p) => p.id.includes("wa_scene_liangcang"));
    const ridge = plans.find((p) => p.id.includes("wa_scene_fenghuo"));
    expect(hero?.layout).toBe("heroSheet");
    expect(hero?.prompt).toContain("三视图");
    expect(hero?.prompt).toContain("双鱼玉佩");
    expect(crowd?.layout).toBe("single");
    expect(crowd?.prompt).not.toContain("三视图");
    expect(granary?.layout).toBe("grid2x2");
    expect(granary?.prompt).toContain("2×2");
    // 烽火岭仅 1 集 → 不额外补四视角卡（主场景已是粮仓）
    expect(ridge).toBeUndefined();
  });
});
