import { describe, expect, it } from "vitest";
import {
  buildManhuaWriterAssetCanon,
  evaluateWriterPackAssetAndDensity,
  formatWriterAssetCanonIdentityLock,
  parseWriterTableLine,
  pickEpisodeMainSceneId,
  resolveEpisodeMainScene,
} from "./manhuaWriterAssetCanon";
import { buildManhuaEpisodeSegmentPlanFixtureMarkdown } from "./manhuaEpisodeSegmentPlan";

const CHARACTERS_MD = `
- 沈砚舟/沈少主｜二十出头·玄色鹤氅玉冠｜寻鹤归宗｜与云疏冷相峙｜不夺旁人之命
- 云疏冷｜银白长发·青衫执剑｜守山神旧约｜与沈砚舟亦敌亦友｜不卖宗门秘辛
`.trim();

const PROPS_MD = `
- 双鹤玉扣｜信物｜白玉双鹤对扣·暗纹温润
`.trim();

const LOCATIONS_MD = `
- 山神破庙｜阴冷破败｜断梁神像·雨痕青苔
- 鹤影湖｜雾气弥漫｜石桥残荷·倒影如墨
`.trim();

const denseBody = (sceneA: string, sceneB: string) =>
  [
    `${sceneA}内，沈砚舟立于断梁下，青苔湿冷。`,
    `${sceneA}香火早断，神像半脸崩裂。`,
    `${sceneA}外雨声如鼓，门板吱呀。`,
    "「鹤归之日，宗门必开。」他压低嗓音。",
    "云疏冷执剑立于神像侧：「少主莫要再提旧约。」",
    "「旧约未完，鹤影不散。」沈砚舟抬手亮出双鹤玉扣。",
    "「你敢拿信物赌命？」云疏冷剑尖微抬。",
    "「我赌的是山神尚在。」他退半步，雨声灌入破庙。",
    "「破庙里听不见鹤鸣。」云疏冷冷声道。",
    "「那就去找鹤影。」沈砚舟收起玉扣。",
    `两人出庙，沿石径下行至${sceneB}。`,
    "「湖面起雾了。」云疏冷望向倒影。",
    "「若鹤不归呢？」她问。",
    "「那就改写宗门。」他回望破庙方向，又补一句：「今夜先回庙中。」",
    "「走。」云疏冷收剑，雾气吞没石桥。",
    "远处雷声掠过山脊，沈砚舟把鹤氅领口拢紧，心知今夜未必能安睡。",
    "云疏冷却仍盯着湖心倒影，仿佛有鹤影一闪即逝。",
  ].join("");

describe("manhuaWriterAssetCanon", () => {
  it("parses ｜ table lines with alias", () => {
    const row = parseWriterTableLine("- 沈砚舟/沈少主｜外形｜动机｜关系｜底线");
    expect(row?.nameZh).toBe("沈砚舟");
    expect(row?.aliasZh).toBe("沈少主");
    expect(row?.fields).toHaveLength(4);
  });

  it("builds series pool + picks episode main scene by body hits", () => {
    const canon = buildManhuaWriterAssetCanon({
      charactersMd: CHARACTERS_MD,
      propsMd: PROPS_MD,
      locationsMd: LOCATIONS_MD,
      episodes: [
        { index: 1, body: denseBody("山神破庙", "鹤影湖") },
        { index: 2, body: "鹤影湖起雾。鹤影湖倒影如墨。鹤影湖石桥湿滑。" },
      ],
    });
    expect(canon.characters).toHaveLength(2);
    expect(canon.props[0]?.nameZh).toBe("双鹤玉扣");
    expect(canon.locations.map((l) => l.nameZh)).toEqual(["山神破庙", "鹤影湖"]);
    const main1 = resolveEpisodeMainScene(canon, 1);
    const main2 = resolveEpisodeMainScene(canon, 2);
    expect(main1?.nameZh).toBe("山神破庙");
    expect(main2?.nameZh).toBe("鹤影湖");
    expect(pickEpisodeMainSceneId(canon.locations, "无关正文")).toBe(canon.locations[0]!.id);
  });

  it("density gate rejects thin episode and accepts dense pack", () => {
    const thin = evaluateWriterPackAssetAndDensity({
      charactersMd: CHARACTERS_MD,
      propsMd: PROPS_MD,
      locationsMd: LOCATIONS_MD,
      episodes: [{ index: 1, body: "一幕。", endHook: "钩子" }],
      targetSec: 180,
    });
    expect(thin.ok).toBe(false);
    expect(thin.errors.some((e) => /正文过短|对白/.test(e))).toBe(true);

    const ok = evaluateWriterPackAssetAndDensity({
      charactersMd: CHARACTERS_MD,
      propsMd: PROPS_MD,
      locationsMd: LOCATIONS_MD,
      episodes: [
        {
          index: 1,
          body: `${denseBody("山神破庙", "鹤影湖")}\n\n${buildManhuaEpisodeSegmentPlanFixtureMarkdown()}`,
          endHook: "神像眼缝渗出金光。",
        },
      ],
      targetSec: 180,
    });
    expect(ok.ok).toBe(true);
    expect(ok.canon.characters.length).toBeGreaterThanOrEqual(2);
    const lock = formatWriterAssetCanonIdentityLock(ok.canon, { episodeIndex: 1 });
    expect(lock).toMatch(/沈砚舟/);
    expect(lock).toMatch(/双鹤玉扣/);
    expect(lock).toMatch(/本集主场景：山神破庙/);
  });
});
