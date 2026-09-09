import { describe, expect, it } from "vitest";
import {
  buildManhuaWriterAssetCanon,
  collectWriterCharacterNames,
  countDialogueLines,
  detectManhuaCanonWriterDrift,
  evaluateWriterPackAssetAndDensity,
  evaluateWriterAssetTableThresholds,
  formatWriterAssetCanonFactoryAddon,
  deriveWriterAssetTablesFromScript,
  formatWriterAssetCanonIdentityLock,
  isMarkdownTableSeparatorLine,
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
    // 三分钟集的对白闸门要求 ≥30 句；原 fixture 只有 26 句，撑不起「dense pack」这个名字
    "「鹤影就在湖心。」沈砚舟指向雾中。",
    "「那不过是残荷倒影。」云疏冷不信。",
    "「你听。」他侧耳。",
    "「只有雨声。」她答。",
    "「雨里有鹤鸣。」沈砚舟压低嗓音。",
    "「少主又在说梦话。」云疏冷收剑转身。",
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

  /**
   * 外部剧本包爱用 Markdown 表格写人物卡。表头与分隔线若当成资产，
   * 会造出名叫「角色」「---」的假角色，并一路写进脸锁提示词去污染出图。
   */
  it("drops Markdown table header and separator rows", () => {
    expect(parseWriterTableLine("|---|---|")).toBeNull();
    expect(parseWriterTableLine("| :--- | ---: |")).toBeNull();

    const tableMd = `| 角色 | 说明 |
|---|---|
| 谢无咎 | 现代24岁古籍修复师 |
| 谢明彰 | 雁门守将，谢无咎之父 |`;
    const canon = buildManhuaWriterAssetCanon({
      charactersMd: tableMd,
      episodes: [{ index: 1, body: "谢无咎在灯下修书。" }],
    });
    expect(canon.characters.map((c) => c.nameZh)).toEqual(["谢无咎", "谢明彰"]);
    expect(collectWriterCharacterNames(tableMd)).toEqual(["谢无咎", "谢明彰"]);
    expect(formatWriterAssetCanonIdentityLock(canon)).not.toContain("---");
  });

  it("keeps a bullet list intact when there is no separator row", () => {
    expect(collectWriterCharacterNames(CHARACTERS_MD)).toContain("沈砚舟");
  });

  /** 孤立的 `---` 是分割横线，不能把它上面那名角色当表头吞掉 */
  it("treats a bare --- as a rule, not a table separator", () => {
    expect(isMarkdownTableSeparatorLine("---")).toBe(false);
    expect(isMarkdownTableSeparatorLine("|---|---|")).toBe(true);
    expect(parseWriterTableLine("---")).toBeNull();

    const ruledMd = `- 沈砚舟｜玄色鹤氅｜寻鹤归宗
---
- 云疏冷｜青衫执剑｜守山神旧约`;
    expect(collectWriterCharacterNames(ruledMd)).toEqual(["沈砚舟", "云疏冷"]);
  });

  /** 表头判定收紧后，这些边角都不该丢角色 */
  it("only strips a real table header, never a data row", () => {
    // 列表行用半角竖线分隔字段，后面紧跟一条分隔行
    expect(
      collectWriterCharacterNames(`- 沈砚舟|玄色鹤氅|寻鹤归宗
|---|---|`),
    ).toEqual(["沈砚舟"]);

    // 表格末行之后多出一条分隔行
    expect(
      collectWriterCharacterNames(`| 角色 | 说明 |
|---|---|
| 沈砚舟 | 玄色鹤氅 |
| 云疏冷 | 青衫执剑 |
|---|---|`),
    ).toEqual(["沈砚舟", "云疏冷"]);

    // 表格前有普通说明句
    expect(
      collectWriterCharacterNames(`本系列人物如下：
| 角色 | 说明 |
|---|---|
| 沈砚舟 | 玄色鹤氅 |`),
    ).toEqual(["本系列人物如下：", "沈砚舟"]);

    // 无表头表格：首行就是数据行，紧挨分隔行也不能删
    expect(
      collectWriterCharacterNames(`| 沈砚舟 | 玄色鹤氅 |
|---|---|
| 云疏冷 | 青衫执剑 |`),
    ).toEqual(["沈砚舟", "云疏冷"]);

    // 名字自带破折号不能被当成横线行
    expect(parseWriterTableLine("- 路人-甲｜灰袍｜看热闹")?.nameZh).toBe("路人-甲");
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

  it("counts curly quotes and 可拍表对白 lines as dialogue", () => {
    const curly = [
      "贺沉沙喝道：“交出玉珏，留你全尸！”",
      "沈照雪攥紧半珏：“我连自己是谁都忘了。”",
      "“那声音是裴玄策。”贺沉沙压低声。",
    ].join("\n");
    expect(countDialogueLines(curly)).toBeGreaterThanOrEqual(3);

    const planOnly = [
      "#### 段01",
      "- 对白：交出玉珏，留你全尸！我连自己是谁都忘了。",
      "- 场景：暮雨竹道",
      "#### 段02",
      "- 对白：那声音是裴玄策还是假扮？",
      "- 场景：破庙侧门",
    ].join("\n");
    expect(countDialogueLines(planOnly)).toBeGreaterThanOrEqual(2);
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
    // 先断言 errors 为空：失败时直接看到卡在哪条规则，而不是只有 false !== true
    expect(ok.errors).toEqual([]);
    expect(ok.ok).toBe(true);
    expect(ok.canon.characters.length).toBeGreaterThanOrEqual(2);
    const lock = formatWriterAssetCanonIdentityLock(ok.canon, { episodeIndex: 1 });
    expect(lock).toMatch(/沈砚舟/);
    expect(lock).toMatch(/双鹤玉扣/);
    expect(lock).toMatch(/本集主场景：山神破庙/);
  });
});

describe("detectManhuaCanonWriterDrift · 旧 bible 与现剧本换角检测", () => {
  const bibleCanon = buildManhuaWriterAssetCanon({ charactersMd: CHARACTERS_MD });

  it("同一剧本人物表 → 不漂移（overlap 高）", () => {
    const d = detectManhuaCanonWriterDrift(bibleCanon, CHARACTERS_MD);
    expect(d.drifted).toBe(false);
    expect(d.overlap).toBeGreaterThanOrEqual(0.5);
  });

  it("剧本已换主角（沈沧澜/陆清和）而 bible 仍是旧角 → 漂移", () => {
    const newScript = `
- 沈沧澜／兰七｜玄黑劲装｜查父案｜与陆清和恋人｜越痛越克制
- 陆清和／禾九｜月白劲装｜洗陆家冤｜沈沧澜恋人｜主动出剑
`.trim();
    const d = detectManhuaCanonWriterDrift(bibleCanon, newScript);
    expect(d.drifted).toBe(true);
    expect(d.overlap).toBeLessThan(0.5);
    // 旧 bible 角色应被列为「只在 bible」（提示会烧错角色）
    expect(d.onlyInBible).toContain("沈砚舟");
  });

  it("bible 为空或剧本为空 → 不判漂移", () => {
    expect(detectManhuaCanonWriterDrift(null, CHARACTERS_MD).drifted).toBe(false);
    expect(detectManhuaCanonWriterDrift(bibleCanon, "").drifted).toBe(false);
  });

  it("collectWriterCharacterNames 取名+别名", () => {
    const names = collectWriterCharacterNames(CHARACTERS_MD);
    expect(names).toContain("沈砚舟");
    expect(names).toContain("沈少主");
    expect(names).toContain("云疏冷");
  });
});

describe("资产表门槛按剧本实际实体计（0909）", () => {
  const soloEpisodes = [
    {
      index: 1,
      body: "苏照雪独自守在破庙。\n苏照雪：「今夜不会有人来了。」\n她攥紧了手里的火折子。",
      endHook: "庙门吱呀一声开了。",
    },
  ];

  it("空表：报人物表为空并标 assetTablesEmpty（给一键提取出路）", () => {
    const canon = buildManhuaWriterAssetCanon({ charactersMd: "", propsMd: "", locationsMd: "", episodes: soloEpisodes });
    const r = evaluateWriterAssetTableThresholds({ canon, episodes: soloEpisodes, charactersMd: "", propsMd: "", locationsMd: "" });
    expect(r.assetTablesEmpty).toBe(true);
    expect(r.errors.some((e) => /人物表为空/.test(e))).toBe(true);
    expect(r.errors.some((e) => /场景表|道具表/.test(e))).toBe(false);
  });

  it("独角戏：1 名出场角色、无场景表无道具表 → 放行", () => {
    const charactersMd = "- 苏照雪｜二十岁·素衣束发｜等一个人｜独自守庙";
    const canon = buildManhuaWriterAssetCanon({ charactersMd, propsMd: "", locationsMd: "", episodes: soloEpisodes });
    const r = evaluateWriterAssetTableThresholds({ canon, episodes: soloEpisodes, charactersMd, propsMd: "", locationsMd: "" });
    expect(r.errors).toEqual([]);
    expect(r.assetTablesEmpty).toBe(false);
    expect(r.charactersInScript).toEqual(["苏照雪"]);
  });

  it("人物表角色全不在正文出场 → 拦下并提示改名/重提取", () => {
    const charactersMd = "- 裴玄策｜三十岁·黑衣｜寻仇｜独行";
    const canon = buildManhuaWriterAssetCanon({ charactersMd, propsMd: "", locationsMd: "", episodes: soloEpisodes });
    const r = evaluateWriterAssetTableThresholds({ canon, episodes: soloEpisodes, charactersMd, propsMd: "", locationsMd: "" });
    expect(r.errors.some((e) => /未在剧本正文出场/.test(e))).toBe(true);
  });

  it("场景/道具只在剧本真列了却解析不出时才要求", () => {
    const charactersMd = "- 苏照雪｜二十岁·素衣束发｜等一个人｜独自守庙";
    const propsMd = "- 火折子";
    const canon = buildManhuaWriterAssetCanon({ charactersMd, propsMd, locationsMd: "", episodes: soloEpisodes });
    expect(canon.props.length).toBe(0);
    const r = evaluateWriterAssetTableThresholds({ canon, episodes: soloEpisodes, charactersMd, propsMd, locationsMd: "" });
    expect(r.errors).toEqual(["道具表有条目但一条都解析不出（每行写成「- 道具名｜功能｜外形」）"]);
  });

  it("整包门禁：单主角无道具的戏不再被「≥2 人 / ≥1 道具」卡死", () => {
    const charactersMd = "- 苏照雪｜二十岁·素衣束发｜等一个人｜独自守庙";
    const r = evaluateWriterPackAssetAndDensity({
      charactersMd,
      propsMd: "",
      locationsMd: "",
      episodes: soloEpisodes,
      targetSec: 90,
    });
    expect(r.errors.some((e) => /至少需要 2 名|道具表至少|场景表至少/.test(e))).toBe(false);
    expect(r.assetTablesEmpty).toBe(false);
  });

  it("从剧本一键提取：按说话人/场景行/道具行补表，不动已有行", () => {
    const episodes = [
      {
        index: 1,
        body: [
          "#### 段01",
          "- 场景：山神破庙",
          "- 角色：苏照雪；裴玄策",
          "- 对白：苏照雪：「你来了。」裴玄策：「我来取玉扣。」",
          "- 道具：双鹤玉扣",
          "旁白：「夜雨未停。」",
          "苏照雪：「拿去。」",
        ].join("\n"),
      },
    ];
    const out = deriveWriterAssetTablesFromScript({
      episodes,
      charactersMd: "- 裴玄策｜三十岁·黑衣｜寻仇｜独行",
    });
    expect(out.added.characters).toEqual(["苏照雪"]);
    expect(out.added.characters).not.toContain("旁白");
    expect(out.added.locations).toEqual(["山神破庙"]);
    expect(out.added.props).toEqual(["双鹤玉扣"]);
    expect(out.charactersMd.startsWith("- 裴玄策｜三十岁·黑衣｜寻仇｜独行\n- 苏照雪｜")).toBe(true);
    const canon = buildManhuaWriterAssetCanon({ ...out, episodes });
    expect(canon.characters.map((c) => c.nameZh)).toEqual(["裴玄策", "苏照雪"]);
    expect(canon.locations.map((c) => c.nameZh)).toEqual(["山神破庙"]);
    expect(canon.props.map((c) => c.nameZh)).toEqual(["双鹤玉扣"]);
  });

  it("一键提取的「待补」占位：门禁拦下、出图提示词只留名字", () => {
    const episodes = [{ index: 1, body: "苏照雪：「拿去。」\n裴玄策：「好。」" }];
    const out = deriveWriterAssetTablesFromScript({ episodes, charactersMd: "" });
    const canon = buildManhuaWriterAssetCanon({ ...out, episodes });
    const r = evaluateWriterAssetTableThresholds({ canon, episodes, charactersMd: out.charactersMd, propsMd: "", locationsMd: "" });
    expect(r.errors.join("\n")).toMatch(/待补/);
    const addon = formatWriterAssetCanonFactoryAddon(canon, 1);
    expect(addon).not.toContain("待补");
    expect(addon).toContain("- 苏照雪：");
  });
});
