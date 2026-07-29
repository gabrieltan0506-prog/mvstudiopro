import { describe, expect, it } from "vitest";
import { buildManhuaProjectBible } from "./manhuaProjectBible";
import {
  buildManhuaWriterSession,
  healManhuaWriterSessionCanonDrift,
  parseManhuaWriterSession,
  serializeManhuaWriterSession,
  MANHUA_WRITER_SESSION_FORMAT,
  loadManhuaWriterSessionFromStorage,
  saveManhuaWriterSessionToStorage,
} from "./manhuaWriterSession";

describe("manhuaWriterSession", () => {
  const pack = {
    seriesTitle: "刀光夜雨",
    logline: "江湖刀光",
    charactersMd: "女侠青衣短打",
    propsMd: "绣春刀",
    locationsMd: "夜雨客栈",
    episodes: [
      { index: 1, title: "雨夜", body: "交锋", endHook: "钩1" },
      { index: 2, title: "追刀", body: "追杀", endHook: "钩2" },
      { index: 3, title: "决战", body: "对决", endHook: "钩3" },
    ],
    rawMarkdown: "## 系列标题\n刀光夜雨",
    episodeCount: 3,
  };

  it("round-trips writer pack + bible", () => {
    const bible = buildManhuaProjectBible({
      topic: "江湖刀光打斗交锋的短剧",
      pack,
      cast: {
        lane: "ancient",
        characterIds: [],
        ancientArchetypeIds: ["arch_rain_jianghu_dao"],
        artStyleId: "cg_manhua",
        propIds: ["demo_prop_ancient_jade"],
        wardrobePropContinuityIds: [],
      },
      focusEpisode: 2,
    });
    const session = buildManhuaWriterSession({
      topic: "江湖刀光打斗交锋的短剧",
      brief: "每集刀光",
      episodeCount: 3,
      focusEpisode: 2,
      writerPack: pack,
      writerConfirmed: true,
      directorUnlocked: true,
      projectBible: bible,
      manhuaUiMode: "workbench",
    });
    const again = parseManhuaWriterSession(serializeManhuaWriterSession(session));
    expect(again?.format).toBe(MANHUA_WRITER_SESSION_FORMAT);
    expect(again?.writerPack?.seriesTitle).toBe("刀光夜雨");
    expect(again?.writerPack?.episodes).toHaveLength(3);
    expect(again?.writerConfirmed).toBe(true);
    expect(again?.projectBible?.cast.ancientArchetypeIds).toEqual(["arch_rain_jianghu_dao"]);
    expect(again?.focusEpisode).toBe(2);
    expect(again?.assetsSkipped).toBe(false);
    expect(again?.workflowPhase).toBe("storyboard");
    expect(again?.customAssetRefs).toEqual([]);
    expect(again?.viralTemplateId).toBe("");
  });

  it("persists viralTemplateId", () => {
    const session = buildManhuaWriterSession({
      topic: "边关",
      viralTemplateId: "tpl_border_farm_revenge",
    });
    const again = parseManhuaWriterSession(serializeManhuaWriterSession(session));
    expect(again?.viralTemplateId).toBe("tpl_border_farm_revenge");
  });

  it("round-trips customAssetRefs https urls", () => {
    const session = buildManhuaWriterSession({
      topic: "自传融图",
      customAssetRefs: [
        {
          id: "cust_a",
          url: "https://cdn.example/a.jpg",
          role: "character",
          source: "upload",
        },
        {
          id: "cust_b",
          url: "https://cdn.example/b.jpg",
          role: "scene",
          source: "generated",
          seedLibraryId: "scene_04",
        },
        { id: "bad", url: "blob:local", role: "prop" },
      ],
    });
    expect(session.customAssetRefs).toHaveLength(2);
    expect(session.customAssetRefs[0]?.role).toBe("character");
    expect(session.customAssetRefs[1]?.seedLibraryId).toBe("scene_04");
  });

  it("loads/saves via storage mock", () => {
    const map = new Map<string, string>();
    const storage = {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => {
        map.set(k, v);
      },
    };
    saveManhuaWriterSessionToStorage(
      {
        topic: "校园甜宠",
        writerPack: { ...pack, seriesTitle: "校门口" },
        writerConfirmed: true,
        assetsSkipped: true,
        workflowPhase: "assets",
      },
      storage,
    );
    const loaded = loadManhuaWriterSessionFromStorage(storage);
    expect(loaded?.topic).toBe("校园甜宠");
    expect(loaded?.writerPack?.seriesTitle).toBe("校门口");
    expect(loaded?.writerConfirmed).toBe(true);
    expect(loaded?.assetsSkipped).toBe(true);
    expect(loaded?.workflowPhase).toBe("assets");
  });

  it("rejects unknown format", () => {
    expect(parseManhuaWriterSession({ format: "nope" })).toBeNull();
  });
});

describe("healManhuaWriterSessionCanonDrift · 云草稿旧 bible 回灌自愈", () => {
  const OLD_CHARS =
    "- 裴砚舟/陆舟｜二十七岁，眉骨浅疤，深灰劲装｜洗父冤｜裴镇岳之子｜越痛越克制\n" +
    "- 苏照雪/照雪｜二十四岁，月白劲装｜寻真相｜裴砚舟恋人｜主动出剑";
  const NEW_CHARS =
    "- 沈沧澜／兰七｜二十六岁，玄黑劲装外罩暗蓝披风｜查父案｜与陆清和恋人｜越痛越克制\n" +
    "- 陆清和／禾九｜二十四岁，月白劲装配绛红护腕｜洗陆家冤｜沈沧澜恋人｜主动出剑";

  const oldPack = {
    seriesTitle: "雪关同心局",
    logline: "旧稿",
    charactersMd: OLD_CHARS,
    propsMd: "双鱼玉佩",
    locationsMd: "边军粮仓",
    episodes: [{ index: 1, title: "旧1", body: "裴砚舟入粮仓", endHook: "钩" }],
    rawMarkdown: "",
    episodeCount: 1,
  };
  const oldBible = buildManhuaProjectBible({
    topic: "朝堂江湖权谋",
    pack: oldPack,
    cast: {
      lane: "ancient",
      characterIds: [],
      ancientArchetypeIds: [],
      artStyleId: "cg_manhua",
      propIds: [],
      wardrobePropContinuityIds: [],
    },
    focusEpisode: 1,
  });

  const newPack = {
    seriesTitle: "山河不许共白头",
    logline: "新稿",
    charactersMd: NEW_CHARS,
    propsMd: "双鱼玉佩",
    locationsMd: "断月桥",
    episodes: [{ index: 1, title: "桥上爱侣", body: "沈沧澜与陆清和重逢", endHook: "钩" }],
    rawMarkdown: "",
    episodeCount: 1,
  };

  it("换角漂移：弃用旧 bible + 退回未确认，剧本保留", () => {
    const session = buildManhuaWriterSession({
      topic: "朝堂江湖权谋",
      writerPack: newPack,
      writerConfirmed: true,
      directorUnlocked: true,
      workflowPhase: "assets",
      projectBible: oldBible,
    });
    const { session: healed, healed: didHeal } = healManhuaWriterSessionCanonDrift(session);
    expect(didHeal).toBe(true);
    expect(healed?.projectBible).toBeNull();
    expect(healed?.writerConfirmed).toBe(false);
    expect(healed?.directorUnlocked).toBe(false);
    expect(healed?.workflowPhase).toBe("outline");
    // 剧本本体绝不丢
    expect(healed?.writerPack?.seriesTitle).toBe("山河不许共白头");
    expect(healed?.writerPack?.charactersMd).toContain("沈沧澜");
  });

  it("bible 与现稿一致：不动、healed=false", () => {
    const goodBible = buildManhuaProjectBible({
      topic: "朝堂江湖权谋",
      pack: newPack,
      cast: {
        lane: "ancient",
        characterIds: [],
        ancientArchetypeIds: [],
        artStyleId: "cg_manhua",
        propIds: [],
        wardrobePropContinuityIds: [],
      },
      focusEpisode: 1,
    });
    const session = buildManhuaWriterSession({
      topic: "朝堂江湖权谋",
      writerPack: newPack,
      writerConfirmed: true,
      directorUnlocked: true,
      workflowPhase: "assets",
      projectBible: goodBible,
    });
    const { session: healed, healed: didHeal } = healManhuaWriterSessionCanonDrift(session);
    expect(didHeal).toBe(false);
    expect(healed?.projectBible).not.toBeNull();
    expect(healed?.writerConfirmed).toBe(true);
  });

  it("null session → 原样返回", () => {
    expect(healManhuaWriterSessionCanonDrift(null)).toEqual({ session: null, healed: false });
  });
});
