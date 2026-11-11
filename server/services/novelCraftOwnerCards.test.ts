import { describe, expect, it } from "vitest";
import {
  NOVEL_CRAFT_BASE_CARDS,
  NOVEL_CRAFT_CARDS,
  NOVEL_CRAFT_FIRST_THREE_ID,
  NOVEL_CRAFT_OWNER_CARDS,
  NOVEL_CRAFT_PREFERRED_RULE,
  getNovelCraftCards,
  novelCraftIndex,
} from "../../shared/novelCraftCards";
import { NOVEL_CRAFT_OWNER_SOURCE } from "../../shared/novelCraftCardsOwner";
import {
  buildNovelCraftRetrievalPrompt,
  buildNovelCraftTaskBrief,
  buildNovelCraftUnifiedIndex,
  defaultNovelCraftSelection,
  novelCraftCardsForStage,
  renderNovelCraftInjection,
  type NovelCraftRetrievalInput,
} from "./novelCraftRetrieval";
import type { NovelTemplateDigestEntry } from "./novelTemplateDigest";

/** 原有 18 条通用条目的 id 与顺序。 */
const BASE_IDS = [
  "craft_first_three",
  "craft_opening",
  "craft_conflict_goal",
  "craft_pacing",
  "craft_logic",
  "craft_reversal",
  "craft_payoff_climax",
  "craft_foreshadow",
  "craft_chapter_hook",
  "craft_dialogue",
  "craft_deslop",
  "craft_scene_engine",
  "craft_info_release",
  "craft_character_motive",
  "craft_voice_subtext",
  "craft_momentum_check",
  "craft_payoff_check",
  "craft_anti_patterns",
];
/** 本站规范优先的默认回退（不含前三章分工）。 */
const DEFAULT_BY_STAGE = {
  outline: ["craft_owner_goal_chain", "craft_owner_single_mainline", "craft_conflict_goal", "craft_pacing"],
  chapter: ["craft_owner_goal_chain", "craft_owner_detail_writing", "craft_conflict_goal", "craft_pacing"],
  script: ["craft_owner_goal_chain", "craft_owner_detail_writing", "craft_conflict_goal", "craft_pacing"],
} as const;

const methodCard = (publicId: string, n: number): NovelTemplateDigestEntry => ({
  publicId,
  role: "主导节奏",
  text: "",
  card: {
    publicId,
    methods: Array.from({ length: n }, (_, i) => ({
      name: `${publicId}手法${i + 1}名称较长一些`,
      how: `HOW-${publicId}-${i + 1}：先写结果再倒推原因，动作带出信息，`.repeat(3),
      when: `WHEN-${publicId}-${i + 1}：主角被逼到墙角、需要反手破局的场面`,
    })),
    dialogue: "",
    pacing: "",
    avoid: [],
  },
});
const longOutline = Array.from({ length: 30 }, (_, i) => `第${i + 1}集：标题${i + 1}\n剧情：${"事件推进".repeat(40)}`).join("\n\n");
const base: NovelCraftRetrievalInput = {
  stage: "chapter",
  topic: "重生复仇".repeat(20),
  direction: "女主冷静布局".repeat(80),
  source: { label: "底本", text: "底本".repeat(2000) },
  outline: longOutline,
  chapterIndex: 2,
  episodeStart: 1,
  episodeCount: 30,
  requestId: "req-owner-1",
};
const fourCards = ["mt_a", "mt_b", "mt_c", "mt_d"].map(id => methodCard(id, 8));

describe("站长资料技法条目", () => {
  it("字段合法：id 唯一带前缀、intro ≤60、body ≤900、stages 非空、无模型/仓库/通道名", () => {
    expect(NOVEL_CRAFT_OWNER_CARDS.length).toBeGreaterThanOrEqual(10);
    expect(NOVEL_CRAFT_OWNER_CARDS.length).toBeLessThanOrEqual(24);
    const ids = NOVEL_CRAFT_CARDS.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of NOVEL_CRAFT_OWNER_CARDS) {
      expect(c.id).toMatch(/^craft_owner_[a-z_]+$/);
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.intro.length).toBeLessThanOrEqual(60);
      expect(c.body.length).toBeGreaterThan(100);
      expect(c.body.length).toBeLessThanOrEqual(900);
      expect(c.stages.length).toBeGreaterThan(0);
      expect(c.tags.length).toBeGreaterThan(0);
      expect(c.source).toBe("owner");
      expect(typeof c.priority).toBe("number");
      expect(c.body + c.intro + c.title + c.tags.join("")).not.toMatch(
        /github|claude|gemini|gpt|deepseek|glm|openai|anthropic|vertex|seedance|carbon|mvstudio|fly\.io|\.md|skills\//i
      );
      expect(c.body).not.toContain("待核");
    }
  });
  it("来源与优先级：本站条目 source=owner 且 priority 唯一，通用条目 source=general", () => {
    expect(NOVEL_CRAFT_OWNER_SOURCE).toEqual({ date: "2026-11-11" });
    for (const c of NOVEL_CRAFT_BASE_CARDS) expect(c.source).toBe("general");
    const ps = NOVEL_CRAFT_OWNER_CARDS.map(c => c.priority);
    expect(new Set(ps).size).toBe(ps.length);
    for (const c of NOVEL_CRAFT_CARDS) expect(Object.keys(c)).not.toContain("provisional");
  });
  it("索引行给本站条目加【优先】，提示词带优先规则且不出现内部来源字样", () => {
    const input = { ...base, stage: "outline" as const };
    const idx = buildNovelCraftUnifiedIndex(input, fourCards);
    const prompt = buildNovelCraftRetrievalPrompt(buildNovelCraftTaskBrief(input), idx);
    expect(prompt).toContain(NOVEL_CRAFT_PREFERRED_RULE);
    expect(prompt).toContain("craft_owner_goal_chain｜【优先】主线目标三层与五环检查｜");
    expect(prompt).toContain("craft_logic｜逻辑与因果｜");
    expect(prompt).not.toMatch(/站长|skill|开源/i);
    expect(JSON.stringify(novelCraftIndex())).not.toContain("【优先】");
  });
  it("注入时本站条目排在通用条目前面，并在开头带优先规则", () => {
    const text = renderNovelCraftInjection({ craft: ["craft_logic", "craft_owner_detail_writing", "craft_pacing"], methods: [] }, []);
    expect(text.indexOf(NOVEL_CRAFT_PREFERRED_RULE)).toBeGreaterThan(-1);
    expect(text.indexOf(NOVEL_CRAFT_PREFERRED_RULE)).toBeLessThan(text.indexOf("【技法条目】"));
    const owner = text.indexOf("《【优先】写长与名场面");
    expect(owner).toBeGreaterThan(-1);
    expect(owner).toBeLessThan(text.indexOf("《逻辑与因果》"));
    expect(text.indexOf("《逻辑与因果》")).toBeLessThan(text.indexOf("《节奏与紧凑度》"));
    const plain = renderNovelCraftInjection({ craft: ["craft_logic"], methods: [] }, []);
    expect(plain).not.toContain(NOVEL_CRAFT_PREFERRED_RULE);
  });
  it("原有 18 条 id 与顺序不变，新条目接在后面", () => {
    expect(NOVEL_CRAFT_BASE_CARDS.map(c => c.id)).toEqual(BASE_IDS);
    expect(NOVEL_CRAFT_CARDS.slice(0, BASE_IDS.length).map(c => c.id)).toEqual(BASE_IDS);
    expect(NOVEL_CRAFT_CARDS.slice(BASE_IDS.length)).toEqual(NOVEL_CRAFT_OWNER_CARDS);
  });
  it("novelCraftIndex 含新条目且只有 id/title/intro/tags；getNovelCraftCards 能取到", () => {
    const idx = novelCraftIndex();
    for (const c of NOVEL_CRAFT_OWNER_CARDS) {
      const e = idx.find(x => x.id === c.id)!;
      expect(e).toBeTruthy();
      expect(Object.keys(e).sort()).toEqual(["id", "intro", "tags", "title"]);
      expect(JSON.stringify(idx)).not.toContain(c.body.slice(0, 30));
    }
    expect(getNovelCraftCards(["craft_owner_imitation"])[0]?.title).toBe("仿写对标书：留卖点不抄过程");
  });
  it("按阶段过滤：大纲类只进 outline，正文类进 chapter/script；开篇条只在第1–3集", () => {
    const outline = novelCraftCardsForStage({ ...base, stage: "outline" }).map(c => c.id);
    const chapter = novelCraftCardsForStage({ ...base, chapterIndex: 2 }).map(c => c.id);
    const chapterLate = novelCraftCardsForStage({ ...base, chapterIndex: 7 }).map(c => c.id);
    expect(outline).toContain("craft_owner_outline_blueprint");
    expect(chapter).not.toContain("craft_owner_outline_blueprint");
    expect(chapter).not.toContain("craft_owner_imitation");
    expect(chapter).toContain("craft_owner_detail_writing");
    expect(chapter).toContain("craft_owner_opening_conflict");
    expect(chapterLate).not.toContain("craft_owner_opening_conflict");
    for (const stage of ["outline", "chapter", "script"] as const) {
      const got = novelCraftCardsForStage({ ...base, stage, chapterIndex: 1 });
      expect(got.every(c => c.stages.includes(stage))).toBe(true);
    }
  });
  it("检索提示词（4 张手法卡各 8 条 + 该阶段全部技法条目）仍 < 6000 字", () => {
    for (const stage of ["outline", "chapter", "script"] as const) {
      const input = { ...base, stage, chapterIndex: 1 };
      const idx = buildNovelCraftUnifiedIndex(input, fourCards);
      const prompt = buildNovelCraftRetrievalPrompt(buildNovelCraftTaskBrief(input), idx);
      expect(prompt.length).toBeLessThan(6000);
      for (const c of NOVEL_CRAFT_OWNER_CARDS) expect(prompt).not.toContain(c.body.slice(0, 30));
    }
  });
  it("默认回退集合：本站规范优先 2 条 + 通用补足到 4 条，前三集另加前三章分工", () => {
    for (const stage of ["outline", "chapter", "script"] as const) {
      const early = { ...base, stage, chapterIndex: 1, episodeStart: 1 };
      const late = { ...base, stage, chapterIndex: 8, episodeStart: 8, episodeCount: 3 };
      const e = defaultNovelCraftSelection(early, buildNovelCraftUnifiedIndex(early, fourCards));
      const l = defaultNovelCraftSelection(late, buildNovelCraftUnifiedIndex(late, fourCards));
      expect(e.craft).toEqual([NOVEL_CRAFT_FIRST_THREE_ID, ...DEFAULT_BY_STAGE[stage]]);
      expect(l.craft).toEqual([...DEFAULT_BY_STAGE[stage]]);
      expect(e.methods).toHaveLength(32);
    }
  });
});
