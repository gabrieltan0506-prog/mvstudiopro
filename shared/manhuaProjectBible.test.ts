import { describe, expect, it } from "vitest";
import {
  buildManhuaProjectBible,
  parseManhuaProjectBible,
  serializeManhuaProjectBible,
  summarizeManhuaProjectBible,
} from "./manhuaProjectBible.js";

describe("manhuaProjectBible", () => {
  it("build + parse roundtrip；默认绑定全部集", () => {
    const bible = buildManhuaProjectBible({
      topic: "江湖刀光打斗交锋的短剧",
      pack: {
        seriesTitle: "父辈拔刀成仇",
        logline: "两家儿女破局",
        charactersMd: "沈照野｜交领外袍",
        propsMd: "断岳双刀",
        locationsMd: "废弃盟誓堂",
        episodeCount: 3,
        episodes: [
          { index: 1, title: "刀下认妻", body: "…", endHook: "监国印" },
          { index: 2, title: "死人的毒", body: "…", endHook: "棠棠" },
          { index: 3, title: "旧盟再并肩", body: "…", endHook: "真凶" },
        ],
      },
      cast: {
        lane: "ancient",
        characterIds: [],
        ancientArchetypeIds: ["arch_rain_jianghu_dao"],
        artStyleId: "cg_drama",
        propIds: ["demo_prop_ancient_jade"],
        wardrobePropContinuityIds: ["wpc_02_jianghu_dao"],
        identityLockZh: "跟剧本",
      },
      focusEpisode: 1,
      confirmedAt: "2026-07-19T12:00:00.000Z",
    });
    expect(bible.format).toBe("mv-manhua-project-bible-v1");
    expect(bible.cast.lane).toBe("ancient");
    expect(bible.cast.characterIds).toEqual([]);
    expect(bible.cast.boundEpisodeIndexes).toEqual([1, 2, 3]);
    expect(bible.cast.ancientArchetypeIds).toContain("arch_rain_jianghu_dao");

    const again = parseManhuaProjectBible(JSON.parse(serializeManhuaProjectBible(bible)));
    expect(again?.seriesTitle).toBe("父辈拔刀成仇");
    expect(again?.cast.boundEpisodeIndexes).toEqual([1, 2, 3]);
    expect(summarizeManhuaProjectBible(bible)).toMatch(/古风/);
    expect(summarizeManhuaProjectBible(bible)).toMatch(/绑定集 1,2,3/);
  });

  it("都市轨保留 characterIds", () => {
    const bible = buildManhuaProjectBible({
      topic: "校园甜宠",
      pack: {
        seriesTitle: "甜宠",
        logline: "",
        charactersMd: "",
        propsMd: "",
        locationsMd: "",
        episodeCount: 2,
        episodes: [],
      },
      cast: {
        lane: "urban",
        characterIds: ["char_f_08", "char_m_11"],
        ancientArchetypeIds: [],
        artStyleId: "photoreal",
        propIds: [],
        wardrobePropContinuityIds: ["wpc_03_urban_power"],
      },
    });
    expect(bible.cast.characterIds).toEqual(["char_f_08", "char_m_11"]);
    expect(bible.cast.boundEpisodeIndexes).toEqual([1, 2]);
  });
});
