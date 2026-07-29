import { describe, expect, it } from "vitest";
import {
  buildManhuaSceneFourViewGridPrompt,
  composeManhuaHeroCharacterSheetPrompt,
  composeManhuaHeroFaceCloseupPrompt,
  composeManhuaHeroFaceFromBodyPrompt,
  composeManhuaHeroFullBodyLookPrompt,
  countEpisodesMentioningLocation,
  extractWardrobePaletteTokensZh,
  inferManhuaCharacterGenderZh,
  isManhuaHeroCharacterAnchor,
  locationNeedsFourViewGrid,
  pickPropsForCharacterSheet,
  resolveManhuaLeadCharacterIds,
  resolveManhuaScenePlatePrompt,
} from "./manhuaMultiViewAssetSheets";

describe("manhuaMultiViewAssetSheets", () => {
  const eps = [
    { index: 1, title: "雪地贬谪", body: "沈策被押至风牙关，再入边军粮仓。" },
    { index: 2, title: "玉佩合圆", body: "两人逃入冰河芦岸，再潜回边军粮仓取账。" },
    { index: 3, title: "共赴死局", body: "烽火岭上箭雨落下。" },
  ];

  it("counts location mentions across episodes (B1)", () => {
    expect(
      countEpisodesMentioningLocation({ nameZh: "边军粮仓" }, eps),
    ).toBe(2);
    expect(countEpisodesMentioningLocation({ nameZh: "烽火岭" }, eps)).toBe(1);
    expect(locationNeedsFourViewGrid({ nameZh: "边军粮仓" }, eps)).toBe(true);
    expect(locationNeedsFourViewGrid({ nameZh: "烽火岭" }, eps)).toBe(false);
  });

  it("classifies hero vs crowd (C2)", () => {
    expect(
      isManhuaHeroCharacterAnchor({
        nameZh: "沈策",
        lookZh: "二十四岁，浓眉窄眼，右眉尾短疤；旧玄甲外罩深灰披风",
        motiveZh: "洗清父亲通敌罪名",
      }),
    ).toBe(true);
    expect(
      isManhuaHeroCharacterAnchor({
        nameZh: "流民",
        lookZh: "破衣褴褛的边民一群",
        motiveZh: "求生",
      }),
    ).toBe(false);
    expect(
      isManhuaHeroCharacterAnchor({
        nameZh: "韩朔",
        lookZh: "短",
        motiveZh: "守关",
      }),
    ).toBe(false);
  });

  it("resolveManhuaLeadCharacterIds：按跨集提及取男女主，配角不入主角", () => {
    const chars = [
      { id: "c_shen", nameZh: "沈沧澜" },
      { id: "c_lu", nameZh: "陆清和" },
      { id: "c_qi", nameZh: "沈岐山" },
      { id: "c_crowd", nameZh: "玄甲卫" },
    ];
    const episodes = [
      { index: 1, body: "沈沧澜与陆清和重逢，沈沧澜护住陆清和。沈岐山远看。" },
      { index: 2, body: "沈沧澜、陆清和取账，沈岐山迟疑。玄甲卫一句带过。" },
    ];
    const leads = resolveManhuaLeadCharacterIds(chars, episodes);
    expect(leads.has("c_shen")).toBe(true);
    expect(leads.has("c_lu")).toBe(true);
    expect(leads.has("c_qi")).toBe(false);
    expect(leads.size).toBe(2);
  });

  it("resolveManhuaLeadCharacterIds：显式男女主优先；无正文退化为人物表前二", () => {
    const chars = [
      { id: "c_shen", nameZh: "沈沧澜" },
      { id: "c_qi", nameZh: "沈岐山" },
    ];
    // 显式指定沈岐山为主角
    expect(
      Array.from(resolveManhuaLeadCharacterIds(chars, [], { explicitLeadIds: ["c_qi"] })),
    ).toEqual(["c_qi"]);
    // 无正文、无显式 → 人物表前二
    expect(resolveManhuaLeadCharacterIds(chars, null).size).toBe(2);
  });

  it("builds 2x2 four-view scene prompt (A1)", () => {
    const p = buildManhuaSceneFourViewGridPrompt({
      sceneNameZh: "边军粮仓",
      scenePromptZh: "木梁低压、粮袋与空仓反差；仓秤、三重铜锁",
      topic: "朝堂江湖",
      artStyleLabelZh: "仿真人",
      episodeHitCount: 2,
    });
    expect(p).toContain("2×2");
    expect(p).toContain("左上");
    expect(p).toContain("正俯");
    expect(p).toContain("禁字硬锁");
    expect(p).not.toContain("元点Agent");
  });

  it("builds hero sheet with three-view + palette + props (D1)", () => {
    const p = composeManhuaHeroCharacterSheetPrompt({
      nameZh: "陆清禾",
      aliasZh: "禾青",
      lookZh: "二十二岁，杏眼，青铜叶簪；青白交领袄、暗红窄袖、腰挂药囊",
      motiveZh: "查清边粮失踪真相",
      props: [{ nameZh: "双鱼玉佩", lookZh: "半佩合圆，温润玉色", motiveZh: "父辈信物" }],
      artStyleLabelZh: "仿真人",
    });
    expect(p).toContain("三视图");
    expect(p).toContain("配色条");
    expect(p).toContain("双鱼玉佩");
    expect(p).toContain("禁字硬锁");
    const palette = extractWardrobePaletteTokensZh(
      "青白交领袄、暗红窄袖、深灰披风",
    );
    expect(palette.length).toBeGreaterThan(0);
  });

  it("resolveManhuaScenePlatePrompt switches on episode hits", () => {
    const single = resolveManhuaScenePlatePrompt({
      sceneNameZh: "烽火岭",
      scenePromptZh: "狼烟柴堆",
      location: { nameZh: "烽火岭" },
      episodes: eps,
      buildSingle: () => "SINGLE_PLATE",
    });
    expect(single.layout).toBe("single");
    expect(single.prompt).toBe("SINGLE_PLATE");

    const grid = resolveManhuaScenePlatePrompt({
      sceneNameZh: "边军粮仓",
      scenePromptZh: "空仓铜锁",
      location: { nameZh: "边军粮仓" },
      episodes: eps,
      buildSingle: () => "SINGLE_PLATE",
    });
    expect(grid.layout).toBe("grid2x2");
    expect(grid.episodeHitCount).toBe(2);
    expect(grid.prompt).toContain("2×2");
  });

  it("picks related props for character", () => {
    const props = pickPropsForCharacterSheet(
      { nameZh: "沈策", lookZh: "左腕缠磨损皮护腕，腰佩半枚双鱼玉佩" },
      [
        {
          id: "wa_prop_a",
          role: "prop",
          nameZh: "双鱼玉佩",
          lookZh: "温玉",
          promptZh: "x",
        },
        {
          id: "wa_prop_b",
          role: "prop",
          nameZh: "仓秤",
          lookZh: "铁秤",
          promptZh: "x",
        },
      ],
    );
    expect(props.map((p) => p.nameZh)).toContain("双鱼玉佩");
  });
});

describe("按剧本硬锁性别（修「全身是女·脸特写是男」）", () => {
  /** 用户 2026-07-29 现场翻车的真实人物表两行 */
  const luQingHe = {
    nameZh: "陆清和",
    aliasZh: "禾九",
    lookZh: "二十四岁，长发编入一根赤绳，杏眼冷亮；月白交领劲装配绛红护腕",
    motiveZh: "找到账册替陆家洗清通敌污名，不让爱情成为家族筹码",
    noteZh: "陆镇渊之女、沈沧澜恋人，被父亲当作陆家继承人培养",
  };
  const shenCangLan = {
    nameZh: "沈沧澜",
    aliasZh: "兰七",
    lookZh: "二十六岁，高束黑发，眉骨利落，右手虎口旧伤；玄黑窄袖劲装外罩暗蓝披风",
    motiveZh: "查清父亲为何依附摄政王，与陆清和活着离开权力棋局",
    noteZh: "沈岐山之子、陆清和恋人，与陆镇渊两家有旧仇",
  };

  it("「X之女」判女：不被「被父亲当作继承人」这类他人称谓带偏", () => {
    expect(inferManhuaCharacterGenderZh(luQingHe)).toBe("女");
  });

  it("「X之子」判男", () => {
    expect(inferManhuaCharacterGenderZh(shenCangLan)).toBe("男");
  });

  it("判不出性别时返回 null，绝不瞎猜", () => {
    expect(
      inferManhuaCharacterGenderZh({
        nameZh: "玄甲卫",
        lookZh: "玄色重甲，覆面",
        motiveZh: "奉命围捕",
        noteZh: "摄政王亲兵",
      }),
    ).toBeNull();
  });

  it("性别句写进全身图与脸特写两张提示词", () => {
    const g = inferManhuaCharacterGenderZh(luQingHe);
    const body = composeManhuaHeroFullBodyLookPrompt({ ...luQingHe, genderZh: g });
    const face = composeManhuaHeroFaceCloseupPrompt({ ...luQingHe, genderZh: g });
    expect(body).toContain("性别硬锁：本角色是女性");
    expect(face).toContain("性别硬锁：本角色是女性");
    expect(face).toContain("禁止画成男性");
  });

  it("性别缺省时不写性别句（不硬塞）", () => {
    expect(composeManhuaHeroFullBodyLookPrompt(luQingHe)).not.toContain("性别硬锁");
  });
});

describe("A 方案：脸特写从全身图裁切（不再各画各的）", () => {
  const input = {
    nameZh: "陆清和",
    aliasZh: "禾九",
    lookZh: "二十四岁，长发编入一根赤绳，杏眼冷亮；月白交领劲装配绛红护腕",
    genderZh: "女" as const,
  };

  it("要求照搬参考图同一张脸、禁止重新设计", () => {
    const p = composeManhuaHeroFaceFromBodyPrompt(input);
    expect(p).toContain("以参考图中的人物为唯一依据");
    expect(p).toContain("必须与参考图是同一个人");
    expect(p).toContain("禁止重新设计脸");
    expect(p).toContain("性别硬锁：本角色是女性");
  });

  it("外形句只作比对、不得据此改脸", () => {
    expect(composeManhuaHeroFaceFromBodyPrompt(input)).toContain("不得据此改脸");
  });
});
