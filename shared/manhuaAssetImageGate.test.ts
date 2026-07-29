import { describe, expect, it } from "vitest";
import {
  collectManhuaIdentityImageUrls,
  evaluateManhuaAssetImageGate,
  MANHUA_PROP_SHEET_MAX,
  manhuaHeroFaceSheetId,
  planManhuaAssetImageSpawns,
  seedIdFromManhuaSheetBlockId,
  shouldSpawnManhuaPropPlate,
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
    const heroPlans = plans.filter((p) => p.id.includes("wa_char_shence"));
    const crowd = plans.find((p) => p.id.includes("wa_char_liumin"));
    const granary = plans.find((p) => p.id.includes("wa_scene_liangcang"));
    const ridge = plans.find((p) => p.id.includes("wa_scene_fenghuo"));

    /**
     * 主角拆两张：官方把「人脸与全身/服装拼在一张」列为 ID 漂移头号根因，
     * 三视图更会让模型把同一人的多个角度认成多个主体。
     */
    const face = heroPlans.find((p) => p.layout === "heroFace");
    const look = heroPlans.find((p) => p.layout === "heroLook");
    expect(heroPlans).toHaveLength(2);
    // A：全身照先出，脸特写再从这张全身图裁切放大（两张独立生成会漂性别/漂脸）
    expect(heroPlans[0]?.layout).toBe("heroLook");
    expect(heroPlans[1]?.layout).toBe("heroFace");
    expect(face?.deriveFromSheetId).toBe(look?.id);
    expect(face?.id).toBe(manhuaHeroFaceSheetId("wa_char_shence"));
    expect(seedIdFromManhuaSheetBlockId(face!.id)).toBe("wa_char_shence");
    for (const p of heroPlans) {
      // 旧板要求「右上：全身三视图并排」；现在必须是明令禁止，不是要求
      expect(p.prompt).not.toMatch(/三视图并排/);
      expect(p.prompt).toContain("禁止三视图");
    }
    expect(face?.prompt).toContain("必须与参考图是同一个人");
    expect(face?.prompt).toContain("禁止重新设计脸");
    expect(look?.prompt).toContain("全身入画");
    // 道具信息改由文本交代，不再另开细节特写格
    expect(look?.prompt).toContain("双鱼玉佩");
    expect(crowd?.layout).toBe("single");
    expect(crowd?.prompt).not.toContain("三视图");
    expect(granary?.layout).toBe("grid2x2");
    expect(granary?.prompt).toContain("2×2");
    // 烽火岭仅 1 集 → 出单张空镜；从前这里直接跳过，左栏占位点了没反应
    expect(ridge?.layout).toBe("single");
    expect(ridge?.prompt).not.toContain("2×2");
  });

  it("单集出现的场景也进出图计划：点『一键出场景空镜 N 张』不能是死按钮", () => {
    const loc = (id: string, nameZh: string) => ({
      id,
      role: "scene" as const,
      nameZh,
      lookZh: "夜雾压水面",
      motiveZh: "藏身",
      promptZh: `原创场景空镜·${nameZh}`,
    });
    const assetCanon = {
      characters: [
        {
          id: "wa_char_shen",
          role: "character" as const,
          nameZh: "沈砚舟",
          lookZh: "玄色鹤氅",
          promptZh: "原创角色设定卡·沈砚舟",
        },
      ],
      props: [],
      locations: [loc("wa_scene_kezhan", "苍云客栈"), loc("wa_scene_qiao", "断月桥")],
      episodeMainSceneId: { 1: "wa_scene_kezhan" },
    };
    const plans = planManhuaAssetImageSpawns(
      {
        assetCanon,
        episodeIndex: 1,
        topic: "雪关",
        episodes: [{ index: 1, body: "两人在苍云客栈会面，夜里走断月桥。" }],
        assetBlocks: [{ id: "sceneplate-wa_scene_kezhan", outputUrl: "https://cdn.example/k.jpg" }],
      },
      { forceEpisodeSheets: true },
    );
    const bridge = plans.find((p) => p.id.includes("wa_scene_qiao"));
    expect(bridge?.kind).toBe("sceneplate");
    // 已出图的客栈不重复烧
    expect(plans.some((p) => p.id.includes("wa_scene_kezhan"))).toBe(false);
  });

  it("C 主配分级：主角(男女主级)出脸+全身两张，配角出单张全身", () => {
    const rich = (age: string, motive: string) => ({
      look: `${age}岁，眉眼利落、发束整齐；玄黑窄袖劲装外罩披风`,
      motive,
    });
    const a = rich("26", "查清父亲旧案，与恋人活着离开棋局");
    const b = rich("24", "洗清家族污名，不让爱情成为筹码");
    const c = rich("52", "保住家族与二十年前最后的证据");
    const assetCanon = {
      characters: [
        {
          id: "wa_char_shen",
          role: "character" as const,
          nameZh: "沈沧澜",
          lookZh: a.look,
          motiveZh: a.motive,
          promptZh: "原创角色定妆肖像：沈沧澜",
        },
        {
          id: "wa_char_lu",
          role: "character" as const,
          nameZh: "陆清和",
          lookZh: b.look,
          motiveZh: b.motive,
          promptZh: "原创角色定妆肖像：陆清和",
        },
        {
          id: "wa_char_qi",
          role: "character" as const,
          nameZh: "沈岐山",
          lookZh: c.look,
          motiveZh: c.motive,
          promptZh: "原创角色定妆肖像：沈岐山",
        },
      ],
      props: [],
      locations: [
        {
          id: "wa_scene_qiao",
          role: "scene" as const,
          nameZh: "断月桥",
          lookZh: "雨夜断桥",
          promptZh: "原创场景空镜·断月桥",
        },
      ],
      episodeMainSceneId: { 1: "wa_scene_qiao" },
    };
    // 男女主提及远多于父辈配角
    const episodes = [
      {
        index: 1,
        body: "沈沧澜与陆清和在断月桥重逢，沈沧澜护住陆清和，陆清和出剑。沈岐山远远看着。",
      },
      { index: 2, body: "沈沧澜、陆清和潜入取账，沈岐山迟疑。" },
    ];
    const plans = planManhuaAssetImageSpawns(
      { assetCanon, episodeIndex: 1, topic: "山河", episodes },
      { forceEpisodeSheets: true },
    );
    const shen = plans.filter((p) => p.id.includes("wa_char_shen"));
    const lu = plans.filter((p) => p.id.includes("wa_char_lu"));
    const qi = plans.filter((p) => p.id.includes("wa_char_qi"));
    // 男女主：脸 + 全身两张
    expect(shen.map((p) => p.layout).sort()).toEqual(["heroFace", "heroLook"]);
    expect(lu.map((p) => p.layout).sort()).toEqual(["heroFace", "heroLook"]);
    // 配角(沈岐山)：只出单张全身，无脸特写
    expect(qi).toHaveLength(1);
    expect(qi[0]?.layout).toBe("heroLook");
    expect(plans.some((p) => p.id === manhuaHeroFaceSheetId("wa_char_qi"))).toBe(false);
  });

  it("C：显式指定男女主(leadCharacterIds)时以其为主角，覆盖提及次数", () => {
    const assetCanon = {
      characters: [
        {
          id: "wa_char_shen",
          role: "character" as const,
          nameZh: "沈沧澜",
          lookZh: "26岁，眉眼利落、发束整齐；玄黑窄袖劲装外罩披风",
          motiveZh: "查清父亲旧案",
          promptZh: "原创角色定妆肖像：沈沧澜",
        },
        {
          id: "wa_char_qi",
          role: "character" as const,
          nameZh: "沈岐山",
          lookZh: "52岁，鬓角霜白、左眉短疤；深青官袍内藏软甲",
          motiveZh: "保住家族最后的证据",
          promptZh: "原创角色定妆肖像：沈岐山",
        },
      ],
      props: [],
      locations: [
        { id: "wa_scene_qiao", role: "scene" as const, nameZh: "断月桥", lookZh: "雨夜断桥", promptZh: "断月桥" },
      ],
      episodeMainSceneId: { 1: "wa_scene_qiao" },
    };
    const episodes = [{ index: 1, body: "沈沧澜反复出现在断月桥，沈沧澜又出现，沈岐山只一笔。" }];
    // 显式把沈岐山设为主角
    const plans = planManhuaAssetImageSpawns(
      { assetCanon, episodeIndex: 1, episodes, leadCharacterIds: ["wa_char_qi"] },
      { forceEpisodeSheets: true },
    );
    const shen = plans.filter((p) => p.id.includes("wa_char_shen"));
    const qi = plans.filter((p) => p.id.includes("wa_char_qi"));
    expect(qi.map((p) => p.layout).sort()).toEqual(["heroFace", "heroLook"]);
    expect(shen).toHaveLength(1);
    expect(shen[0]?.layout).toBe("heroLook");
  });
});

/**
 * 道具从前只并进角色定妆卡的特写格，于是它没有自己的 URL：段内绑图要么拿到
 * 那张角色卡（等于和脸共用一张，把锁脸权重摊薄），要么是 logical:// 占位被过滤，
 * 「道具锁定」一直只是文字点名。这一组盯的是「真出了单件图」。
 */
describe("关键道具单件图", () => {
  const canonWithProps = {
    characters: [
      {
        id: "wa_char_shen",
        role: "character" as const,
        nameZh: "沈砚舟",
        lookZh: "玄色鹤氅",
        promptZh: "原创角色设定卡·沈砚舟",
      },
    ],
    props: [
      {
        id: "wa_prop_yupei",
        role: "prop" as const,
        nameZh: "双鱼玉佩",
        lookZh: "半佩温玉，鱼尾断口带血沁",
        motiveZh: "父辈信物",
        promptZh: "玉佩",
      },
      // 只有名字没有外形句：画出来就是通用素材，锁了反而误导
      { id: "wa_prop_xin", role: "prop" as const, nameZh: "信", lookZh: "", promptZh: "" },
    ],
    locations: [
      {
        id: "wa_scene_miao",
        role: "scene" as const,
        nameZh: "山神破庙",
        lookZh: "断梁神像",
        promptZh: "原创场景空镜·山神破庙",
      },
    ],
    episodeMainSceneId: { 1: "wa_scene_miao" },
  } as any;

  it("补齐设定图时给有外形句的道具出单件图", () => {
    const plans = planManhuaAssetImageSpawns(
      { assetCanon: canonWithProps, episodeIndex: 1, topic: "鹤归" },
      { forceEpisodeSheets: true },
    );
    const jade = plans.find((p) => p.kind === "propsheet");
    expect(jade?.id).toBe("propsheet-wa_prop_yupei");
    expect(jade?.labelZh).toBe("双鱼玉佩");
    expect(seedIdFromManhuaSheetBlockId(jade!.id)).toBe("wa_prop_yupei");
    // 单件、单角度：多角度拼图是 ID 漂移头号根因，道具不能走回那条路
    expect(jade?.prompt).toContain("只有这一件器物");
    expect(jade?.prompt).toMatch(/不做多角度并排|分格拼图/);
    // 画面里不许有人；归属人名连提示词都不进（人名是烧标题的素材）
    expect(jade?.prompt).toContain("没有人、没有手");
    expect(jade?.prompt).not.toContain("沈砚舟");
  });

  it("没外形句的道具不出图（占位格会变成点了没反应的死卡）", () => {
    const plans = planManhuaAssetImageSpawns(
      { assetCanon: canonWithProps, episodeIndex: 1 },
      { forceEpisodeSheets: true },
    );
    expect(plans.some((p) => p.id.includes("wa_prop_xin"))).toBe(false);
    expect(shouldSpawnManhuaPropPlate(canonWithProps.props[1])).toBe(false);
    expect(shouldSpawnManhuaPropPlate(canonWithProps.props[0])).toBe(true);
  });

  it("道具垫在定妆与场景之后：重要素材前置", () => {
    const plans = planManhuaAssetImageSpawns(
      { assetCanon: canonWithProps, episodeIndex: 1 },
      { forceEpisodeSheets: true },
    );
    const kinds = plans.map((p) => p.kind);
    expect(kinds.indexOf("propsheet")).toBe(kinds.length - 1);
    expect(kinds.indexOf("charsheet")).toBeLessThan(kinds.indexOf("propsheet"));
  });

  it("道具不进 ready 门禁：缺一件信物不该卡住整条出片线", () => {
    const input = {
      assetCanon: canonWithProps,
      episodeIndex: 1,
      assetBlocks: [
        { id: "charsheet-wa_char_shen", outputUrl: "https://cdn.example/c.jpg" },
        { id: "sceneplate-wa_scene_miao", outputUrl: "https://cdn.example/s.jpg" },
      ],
    };
    // 定妆与场景齐了就算齐，玉佩还没画不影响
    expect(evaluateManhuaAssetImageGate(input).ready).toBe(true);
    expect(planManhuaAssetImageSpawns(input)).toEqual([]);
    // 主动点「补齐设定图」时才补那一件
    expect(
      planManhuaAssetImageSpawns(input, { forceEpisodeSheets: true }).map((p) => p.kind),
    ).toEqual(["propsheet"]);
  });

  it("已出过图 / 用户自己传过同名道具时不重复烧", () => {
    const withBlock = planManhuaAssetImageSpawns(
      {
        assetCanon: canonWithProps,
        episodeIndex: 1,
        assetBlocks: [
          { id: "propsheet-wa_prop_yupei", outputUrl: "https://cdn.example/jade.jpg" },
        ],
      },
      { forceEpisodeSheets: true },
    );
    expect(withBlock.some((p) => p.kind === "propsheet")).toBe(false);

    const withUpload = planManhuaAssetImageSpawns(
      {
        assetCanon: canonWithProps,
        episodeIndex: 1,
        customRefs: [
          {
            id: "cust_jade",
            url: "https://cdn.example/mine.jpg",
            role: "prop",
            labelZh: "双鱼玉佩",
          },
        ],
      },
      { forceEpisodeSheets: true },
    );
    expect(withUpload.some((p) => p.kind === "propsheet")).toBe(false);
  });

  it("regenerateAnchorIds：已有图的道具也按新提示词重出（修烧字用）", () => {
    const args = {
      assetCanon: canonWithProps,
      episodeIndex: 1,
      assetBlocks: [{ id: "propsheet-wa_prop_yupei", outputUrl: "https://cdn.example/jade.jpg" }],
    };
    // 不点名重出 → 已有图就跳过
    expect(
      planManhuaAssetImageSpawns(args, { forceEpisodeSheets: true }).some(
        (p) => p.id === "propsheet-wa_prop_yupei",
      ),
    ).toBe(false);
    // 点名重出 → 重新编译提示词进计划
    const regen = planManhuaAssetImageSpawns(args, {
      forceEpisodeSheets: true,
      regenerateAnchorIds: ["wa_prop_yupei"],
    });
    const jade = regen.find((p) => p.id === "propsheet-wa_prop_yupei");
    expect(jade).toBeTruthy();
    // 重出的意义在于带上改好的软边界写法（静物摄影 + 素净表面），不再靠堆禁令
    expect(jade?.prompt).toContain("博物馆藏品级静物摄影");
    expect(jade?.prompt).toContain("素净的旧料本色");
  });

  it("regenerateNoteZh：用户写的改进描述只压到本轮重出那几张", () => {
    const canon = {
      ...canonWithProps,
      props: [
        canonWithProps.props[0],
        {
          id: "wa_prop_zhang",
          role: "prop" as const,
          nameZh: "旧账册",
          lookZh: "麻纸封皮，边角卷曲",
          promptZh: "账册",
        },
      ],
    };
    const plans = planManhuaAssetImageSpawns(
      {
        assetCanon: canon,
        episodeIndex: 1,
        assetBlocks: [
          { id: "propsheet-wa_prop_zhang", outputUrl: "https://cdn.example/zhang.jpg" },
        ],
      },
      {
        forceEpisodeSheets: true,
        regenerateAnchorIds: ["wa_prop_zhang"],
        regenerateNoteZh: "封面上的字全部去掉，只留墨痕",
      },
    );
    const regen = plans.find((p) => p.id === "propsheet-wa_prop_zhang");
    expect(regen?.prompt).toContain("封面上的字全部去掉，只留墨痕");
    // 同批里没被点名重出的（本来就缺图）不该被别人的修订描述污染
    const other = plans.find((p) => p.id === "propsheet-wa_prop_yupei");
    expect(other?.prompt).toBeTruthy();
    expect(other?.prompt).not.toContain("封面上的字全部去掉");
  });

  it("regenerateNoteZh：用户写的改进描述只压到本轮重出那几张", () => {
    const canon = {
      ...canonWithProps,
      props: [
        canonWithProps.props[0],
        {
          id: "wa_prop_zhang",
          role: "prop" as const,
          nameZh: "旧账册",
          lookZh: "麻纸封皮，边角卷曲",
          promptZh: "账册",
        },
      ],
    };
    const plans = planManhuaAssetImageSpawns(
      {
        assetCanon: canon,
        episodeIndex: 1,
        assetBlocks: [
          { id: "propsheet-wa_prop_zhang", outputUrl: "https://cdn.example/zhang.jpg" },
        ],
      },
      {
        forceEpisodeSheets: true,
        regenerateAnchorIds: ["wa_prop_zhang"],
        regenerateNoteZh: "封面上的字全部去掉，只留墨痕",
      },
    );
    const regen = plans.find((p) => p.id === "propsheet-wa_prop_zhang");
    expect(regen?.prompt).toContain("封面上的字全部去掉，只留墨痕");
    // 同批里没被点名重出的（本来就缺图）不该被别人的修订描述污染
    const other = plans.find((p) => p.id === "propsheet-wa_prop_yupei");
    expect(other?.prompt).toBeTruthy();
    expect(other?.prompt).not.toContain("封面上的字全部去掉");
  });

  it("regenerateAnchorIds：用户自传过同名道具也不再挡重出", () => {
    const regen = planManhuaAssetImageSpawns(
      {
        assetCanon: canonWithProps,
        episodeIndex: 1,
        customRefs: [
          {
            id: "cust_jade",
            url: "https://cdn.example/mine.jpg",
            role: "prop",
            labelZh: "双鱼玉佩",
          },
        ],
      },
      { forceEpisodeSheets: true, regenerateAnchorIds: ["wa_prop_yupei"] },
    );
    expect(regen.some((p) => p.id === "propsheet-wa_prop_yupei")).toBe(true);
  });

  it("道具再多也只出前若干张，别把额度铺满", () => {
    const many = Array.from({ length: MANHUA_PROP_SHEET_MAX + 4 }, (_, i) => ({
      id: `wa_prop_${i}`,
      role: "prop" as const,
      nameZh: `信物${i}`,
      lookZh: "描金缠枝纹，边角磨损",
      promptZh: "信物",
    }));
    const plans = planManhuaAssetImageSpawns(
      { assetCanon: { ...canonWithProps, props: many }, episodeIndex: 1 },
      { forceEpisodeSheets: true },
    );
    expect(plans.filter((p) => p.kind === "propsheet")).toHaveLength(MANHUA_PROP_SHEET_MAX);
  });
});
