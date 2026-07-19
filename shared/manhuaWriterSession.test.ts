import { describe, expect, it } from "vitest";
import { buildManhuaProjectBible } from "./manhuaProjectBible";
import {
  buildManhuaWriterSession,
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
      },
      storage,
    );
    const loaded = loadManhuaWriterSessionFromStorage(storage);
    expect(loaded?.topic).toBe("校园甜宠");
    expect(loaded?.writerPack?.seriesTitle).toBe("校门口");
    expect(loaded?.writerConfirmed).toBe(true);
  });

  it("rejects unknown format", () => {
    expect(parseManhuaWriterSession({ format: "nope" })).toBeNull();
  });
});
