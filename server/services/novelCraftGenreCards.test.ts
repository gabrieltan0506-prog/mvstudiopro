import { describe, it, expect } from "vitest";
import {
  NOVEL_CRAFT_CARDS,
  NOVEL_CRAFT_GENRE_CARDS,
  NOVEL_CRAFT_GENRE_RULE,
  NOVEL_CRAFT_OWNER_CARDS,
  NOVEL_CRAFT_PREFERRED_RULE,
  getNovelCraftCards,
} from "../../shared/novelCraftCards";
import {
  NOVEL_CRAFT_GENRE_CARD_INPUTS,
  NOVEL_SHORT_GENRE_FORMULAS,
  matchNovelCraftGenreCards,
} from "../../shared/novelCraftCardsGenre";
import {
  buildNovelCraftUnifiedIndex,
  defaultNovelCraftSelection,
  novelCraftGenreIdsForInput,
  renderNovelCraftInjection,
  retrieveNovelCraft,
  type NovelCraftRetrievalInput,
} from "./novelCraftRetrieval";
import type { NovelTemplateDigestStore } from "./novelTemplateDigest";

const memStore = (): NovelTemplateDigestStore => {
  const m = new Map<string, string>();
  return {
    read: async (k: string) => m.get(k) ?? null,
    writeIfAbsent: async (k: string, v: string) => {
      if (!m.has(k)) m.set(k, v);
    },
  } as unknown as NovelTemplateDigestStore;
};

const base: NovelCraftRetrievalInput = {
  stage: "chapter",
  topic: "",
  direction: "",
  outline: "第1集：开端\n剧情：x",
  chapterIndex: 1,
  episodeStart: 1,
  episodeCount: 1,
  requestId: "req-genre-1",
};

const match = (topic: string, direction = "") => matchNovelCraftGenreCards({ topic, direction });

describe("题材条目数据", () => {
  it("id 唯一、前缀正确；每条有 genres；正文 250–450 字；别名不跨条目重复；不进通用库", () => {
    const ids = NOVEL_CRAFT_GENRE_CARDS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    const allIds = new Set(NOVEL_CRAFT_CARDS.map(c => c.id));
    const aliasOwner = new Map<string, string>();
    for (const c of NOVEL_CRAFT_GENRE_CARDS) {
      expect(c.id).toMatch(/^craft_genre_[a-z0-9_]+$/);
      expect(c.source).toBe("genre");
      expect(allIds.has(c.id)).toBe(false);
      expect(c.genres?.length).toBeGreaterThan(0);
      expect(c.intro.length).toBeLessThanOrEqual(60);
      expect(c.body.length, c.id).toBeGreaterThanOrEqual(250);
      expect(c.body.length, c.id).toBeLessThanOrEqual(450);
      expect(c.body).toContain("自查：");
      expect(c.body + c.intro + c.title).not.toMatch(/github|claude|gemini|gpt|deepseek|glm|MIT|\.md|skills\//i);
      for (const g of c.genres ?? []) {
        expect(aliasOwner.get(g), `${g} 重复`).toBeUndefined();
        aliasOwner.set(g, c.id);
      }
    }
    expect(NOVEL_CRAFT_GENRE_CARD_INPUTS.length).toBe(NOVEL_CRAFT_GENRE_CARDS.length);
    expect(NOVEL_CRAFT_CARDS.some(c => c.id.startsWith("craft_genre_"))).toBe(false);
  });

  it("短篇公式 18 式只落数据：字段齐全、id 唯一", () => {
    expect(NOVEL_SHORT_GENRE_FORMULAS).toHaveLength(18);
    expect(new Set(NOVEL_SHORT_GENRE_FORMULAS.map(f => f.id)).size).toBe(18);
    for (const f of NOVEL_SHORT_GENRE_FORMULAS) {
      expect(f.genre).toBeTruthy();
      expect(f.sections).toBeTruthy();
      expect(f.beats.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("题材匹配（纯字符串）", () => {
  it("常见题材命中合理条目", () => {
    expect(match("都市高武")[0]).toBe("craft_genre_urban_martial");
    expect(match("霸总")[0]).toBe("craft_genre_ceo");
    expect(match("规则怪谈")[0]).toBe("craft_genre_suspense_brainhole");
    expect(match("悬疑")[0]).toBe("craft_genre_suspense_supernatural");
    expect(match("规则怪谈 / 悬疑")).toEqual(["craft_genre_suspense_brainhole", "craft_genre_suspense_supernatural"]);
    expect(match("年代文")).toEqual(["craft_genre_era"]);
    expect(match("修仙")).toEqual(["craft_genre_xianxia"]);
    expect(match("都市修仙")).toEqual(["craft_genre_urban_cultivation"]);
    expect(match("女频悬疑")).toEqual(["craft_genre_female_suspense"]);
    expect(match("宫斗")[0]).toBe("craft_genre_palace");
    expect(match("玄幻言情")[0]).toBe("craft_genre_xuanhuan_romance");
  });
  it("最多 2 条，题材字段权重高于方向", () => {
    expect(match("都市高武 霸总 年代文 修仙").length).toBe(2);
    expect(match("年代文", "女主想离开豪门")[0]).toBe("craft_genre_era");
  });
  it("空文本与无关文本不命中", () => {
    expect(match("")).toEqual([]);
    expect(match("   ", "")).toEqual([]);
    expect(matchNovelCraftGenreCards({})).toEqual([]);
    expect(match("重生复仇", "女主冷静布局")).toEqual([]);
  });
  it("检索输入取题材 / 方向 / 底本标题", () => {
    expect(novelCraftGenreIdsForInput({ ...base, topic: "霸总" })).toEqual(["craft_genre_ceo"]);
    expect(novelCraftGenreIdsForInput({ ...base, direction: "写成规则怪谈" })).toEqual(["craft_genre_suspense_brainhole"]);
    expect(
      novelCraftGenreIdsForInput({ ...base, source: { label: "八零年代小厨娘", text: "x" } } as NovelCraftRetrievalInput)
    ).toEqual(["craft_genre_era"]);
    expect(novelCraftGenreIdsForInput(base)).toEqual([]);
  });
});

describe("检索接线", () => {
  it("各阶段索引字数与改动前完全一致，索引不含题材条目", () => {
    // 改动前基线（2026-11-12 实测，无手法条目时的技法索引行总长）；新增通用 / 站长条目时同步更新。
    const baseline: Record<string, number> = {
      "outline-1": 2380,
      "outline-5": 2160,
      "chapter-1": 1662,
      "chapter-5": 1442,
      "script-1": 1662,
      "script-5": 1442,
    };
    for (const stage of ["outline", "chapter", "script"] as const) {
      for (const ep of [1, 5]) {
        const input = { ...base, stage, topic: "都市高武 霸总", direction: "年代文 规则怪谈", chapterIndex: ep, episodeStart: ep };
        const idx = buildNovelCraftUnifiedIndex(input, []);
        expect(idx.some(e => e.id.startsWith("craft_genre_"))).toBe(false);
        const text = idx.map(e => `${e.id}｜${e.preferred ? "【优先】" : ""}${e.title}｜${e.intro}`).join("\n");
        expect(text.length).toBe(baseline[`${stage}-${ep}`]);
      }
    }
  });

  it("检索成功：模型挑选之后附加题材条目；注入顺序 站长 > 题材 > 通用", async () => {
    const owner = NOVEL_CRAFT_OWNER_CARDS.find(c => c.stages.includes("chapter"))!;
    const r = await retrieveNovelCraft({
      userId: 1,
      input: { ...base, topic: "霸总 年代文" },
      entries: [],
      store: memStore(),
      call: async () => ({ text: JSON.stringify({ craft: ["craft_logic", owner.id], methods: [], why: "w" }), model: "fake" }),
    });
    expect(r.fallback).toBe(false);
    expect(r.craft).toEqual(["craft_logic", owner.id, "craft_genre_era", "craft_genre_ceo"]);
    const iOwner = r.text.indexOf(`《【优先】${owner.title}》`);
    const iGenre = r.text.indexOf("《题材·豪门总裁》");
    const iGeneral = r.text.indexOf("《逻辑");
    expect(iOwner).toBeGreaterThan(0);
    expect(iGenre).toBeGreaterThan(iOwner);
    expect(iGeneral === -1 || iGeneral > iGenre).toBe(true);
    expect(r.text).toContain(NOVEL_CRAFT_PREFERRED_RULE);
    expect(r.text).toContain(NOVEL_CRAFT_GENRE_RULE);
  });

  it("回退时也附加题材条目；无题材时结果与原来一致", async () => {
    const r = await retrieveNovelCraft({
      userId: 1,
      input: { ...base, topic: "修仙" },
      entries: [],
      store: memStore(),
      call: async () => {
        throw new Error("x");
      },
    });
    expect(r.fallback).toBe(true);
    expect(r.craft[r.craft.length - 1]).toBe("craft_genre_xianxia");
    const plain = await retrieveNovelCraft({
      userId: 1,
      input: base,
      entries: [],
      store: memStore(),
      call: async () => {
        throw new Error("x");
      },
    });
    const expected = defaultNovelCraftSelection(base, buildNovelCraftUnifiedIndex(base, []));
    expect(plain.craft).toEqual(expected.craft);
    expect(plain.text).toBe(renderNovelCraftInjection(expected, []));
    expect(plain.text).not.toContain(NOVEL_CRAFT_GENRE_RULE);
  });

  it("站长条目优先级不变：仍带【优先】标记、仍排第一", () => {
    const idx = buildNovelCraftUnifiedIndex(base, []);
    for (const c of NOVEL_CRAFT_OWNER_CARDS.filter(c => c.stages.includes("chapter") && !c.firstEpisodesOnly)) {
      expect(idx.find(e => e.id === c.id)?.preferred).toBe(true);
    }
    const genre = NOVEL_CRAFT_GENRE_CARDS[0];
    const owner = NOVEL_CRAFT_OWNER_CARDS[0];
    const text = renderNovelCraftInjection({ craft: [genre.id, "craft_logic", owner.id], methods: [] }, []);
    expect(text.indexOf(owner.title)).toBeLessThan(text.indexOf(genre.title));
    expect(getNovelCraftCards([genre.id]).map(c => c.source)).toEqual(["genre"]);
  });
});
