import { describe, expect, it } from "vitest";
import {
  buildManhuaSceneFourViewGridPrompt,
  composeManhuaHeroCharacterSheetPrompt,
  countEpisodesMentioningLocation,
  extractWardrobePaletteTokensZh,
  isManhuaHeroCharacterAnchor,
  locationNeedsFourViewGrid,
  pickPropsForCharacterSheet,
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
