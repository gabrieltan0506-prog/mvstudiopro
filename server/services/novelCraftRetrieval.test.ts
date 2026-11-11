import { describe, expect, it, vi } from "vitest";
import {
  NOVEL_CRAFT_BASE_CARDS,
  NOVEL_CRAFT_CARDS,
  NOVEL_CRAFT_FIRST_THREE_ID,
  getNovelCraftCards,
  novelCraftIndex,
} from "../../shared/novelCraftCards";
import {
  defaultNovelCraftSelection,
  NOVEL_CRAFT_MAX_CRAFT,
  NOVEL_CRAFT_MAX_METHODS,
  NOVEL_CRAFT_TASK_MAX_CHARS,
  buildNovelCraftRetrievalPrompt,
  buildNovelCraftTaskBrief,
  buildNovelCraftUnifiedIndex,
  novelCraftCardsForStage,
  renderNovelCraftInjection,
  retrieveNovelCraft,
  shouldRetrieveNovelCraft,
  type NovelCraftRetrievalInput,
} from "./novelCraftRetrieval";
import type { NovelTemplateDigestEntry, NovelTemplateDigestStore } from "./novelTemplateDigest";

function memoryStore() {
  const objects = new Map<string, string>();
  const store: NovelTemplateDigestStore = {
    read: async name => objects.get(name) ?? null,
    writeIfAbsent: async (name, body) => {
      if (!objects.has(name)) objects.set(name, body);
    },
  };
  return { objects, store };
}

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
    dialogue: `DIALOGUE-${publicId}`,
    pacing: `PACING-${publicId}`,
    avoid: [`AVOID-${publicId}`],
  },
});
const rawEntry: NovelTemplateDigestEntry = { publicId: "mt_raw", role: "反转", card: null, text: "RAWTEXT-整块原文" };

const longOutline = Array.from({ length: 30 }, (_, i) => `第${i + 1}集：标题${i + 1}\n剧情：${"事件推进".repeat(40)}\n本集兑现：兑现\n片尾钩子：钩子`).join("\n\n");
const base: NovelCraftRetrievalInput = {
  stage: "chapter",
  topic: "重生复仇".repeat(20),
  direction: "女主冷静布局".repeat(80),
  source: { label: "底本", text: "底本".repeat(2000) },
  outline: `核心冲突\n冲突\n\n人物关系\n关系\n\n${longOutline}`,
  chapterIndex: 2,
  episodeStart: 1,
  episodeCount: 30,
  requestId: "req-craft-1",
};
const fourCards = ["mt_a", "mt_b", "mt_c", "mt_d"].map(id => methodCard(id, 8));
const ok = (v: unknown) => async () => ({ text: JSON.stringify(v), model: "fake" });

describe("技法条目库", () => {
  it("条数、简介与正文长度、id 稳定唯一，正文不含仓库名与模型名", () => {
    // 原有通用条目 15–19 条；站长资料条目另在 novelCraftOwnerCards.test.ts 校验。
    expect(NOVEL_CRAFT_BASE_CARDS.length).toBeGreaterThanOrEqual(15);
    expect(NOVEL_CRAFT_BASE_CARDS.length).toBeLessThanOrEqual(19);
    expect(new Set(NOVEL_CRAFT_CARDS.map(c => c.id)).size).toBe(NOVEL_CRAFT_CARDS.length);
    for (const c of NOVEL_CRAFT_CARDS) {
      expect(c.id).toMatch(/^craft_[a-z0-9_]+$/);
      expect(c.intro.length).toBeLessThanOrEqual(60);
      expect(c.body.length).toBeLessThanOrEqual(900);
      expect(c.stages.length).toBeGreaterThan(0);
      expect(c.body + c.intro + c.title).not.toMatch(/github|claude|gemini|gpt|deepseek|glm|MIT|\.md|skills\//i);
    }
    const first = NOVEL_CRAFT_CARDS.find(c => c.id === NOVEL_CRAFT_FIRST_THREE_ID)!;
    expect(first.firstEpisodesOnly).toBe(true);
    // 口径已按本站开篇规范统一（身份＋困境＋目标，300—500字）。
    expect(first.body).toContain("300—500字内给齐主角身份、困境与目标");
  });
  it("索引只有 id/title/intro/tags，不含正文", () => {
    const idx = novelCraftIndex();
    expect(Object.keys(idx[0]).sort()).toEqual(["id", "intro", "tags", "title"]);
    const s = JSON.stringify(idx);
    for (const c of NOVEL_CRAFT_CARDS) expect(s).not.toContain(c.body.slice(0, 30));
    expect(getNovelCraftCards(["craft_logic", "nope", "craft_logic"]).map(c => c.id)).toEqual(["craft_logic"]);
  });
});

describe("统一索引与检索提示词", () => {
  it("method 条目按 publicId#序号，回退原文的模板为 #raw；索引不含手法正文", () => {
    const idx = buildNovelCraftUnifiedIndex(base, [methodCard("mt_a", 2), rawEntry]);
    const methods = idx.filter(e => e.kind === "method").map(e => e.id);
    expect(methods).toEqual(["mt_a#1", "mt_a#2", "mt_raw#raw"]);
    const s = JSON.stringify(idx);
    expect(s).not.toContain("HOW-");
    expect(s).not.toContain("DIALOGUE-");
    expect(s).not.toContain("RAWTEXT");
  });
  it("「前三章分工」只在区间覆盖第1–3集时进索引", () => {
    expect(novelCraftCardsForStage({ ...base, chapterIndex: 3 }).some(c => c.id === NOVEL_CRAFT_FIRST_THREE_ID)).toBe(true);
    expect(novelCraftCardsForStage({ ...base, chapterIndex: 4 }).some(c => c.id === NOVEL_CRAFT_FIRST_THREE_ID)).toBe(false);
    expect(novelCraftCardsForStage({ ...base, stage: "script", episodeStart: 5, episodeCount: 3 }).some(c => c.id === NOVEL_CRAFT_FIRST_THREE_ID)).toBe(false);
  });
  it("任务简介 ≤1500 字，正文阶段取本集大纲条目", () => {
    const brief = buildNovelCraftTaskBrief(base);
    expect(brief.length).toBeLessThanOrEqual(NOVEL_CRAFT_TASK_MAX_CHARS);
    expect(brief).toContain("第2集：标题2");
    expect(brief).not.toContain("第3集：标题3");
    expect(buildNovelCraftTaskBrief({ ...base, stage: "outline", outline: "" }).length).toBeLessThanOrEqual(NOVEL_CRAFT_TASK_MAX_CHARS);
  });
  it("4 张手法卡各 8 条 + 全部技法条目时，检索提示词 < 6000 字，且不含任何正文", () => {
    for (const stage of ["outline", "chapter", "script"] as const) {
      const input = { ...base, stage, chapterIndex: 1 };
      const idx = buildNovelCraftUnifiedIndex(input, fourCards);
      expect(idx.filter(e => e.kind === "method")).toHaveLength(32);
      const prompt = buildNovelCraftRetrievalPrompt(buildNovelCraftTaskBrief(input), idx);
      expect(prompt.length).toBeLessThan(6000);
      expect(prompt).not.toContain("HOW-");
      for (const c of NOVEL_CRAFT_CARDS) expect(prompt).not.toContain(c.body.slice(0, 30));
    }
  });
});

describe("retrieveNovelCraft 校验与回退", () => {
  it("非法 id 丢弃、去重、超量截断；类别对不上的 id 也丢弃", async () => {
    const { store } = memoryStore();
    const craftIds = novelCraftCardsForStage(base).map(c => c.id);
    const r = await retrieveNovelCraft({
      userId: 7,
      input: base,
      entries: fourCards,
      store,
      call: ok({
        craft: ["craft_bogus", craftIds[0], craftIds[0], "mt_a#1", ...craftIds.slice(1, 10)],
        methods: ["mt_a#99", "craft_logic", ...fourCards.flatMap(c => c.card!.methods.map((_, i) => `${c.publicId}#${i + 1}`))],
        why: "按本集冲突取",
      }),
    });
    expect(r.fallback).toBe(false);
    expect(r.craft).toHaveLength(NOVEL_CRAFT_MAX_CRAFT);
    expect(r.craft[0]).toBe(craftIds[0]);
    expect(r.craft).not.toContain("craft_bogus");
    expect(r.craft).not.toContain("mt_a#1");
    expect(r.methods).toHaveLength(NOVEL_CRAFT_MAX_METHODS);
    expect(r.methods.every(id => /^mt_[a-d]#[1-8]$/.test(id))).toBe(true);
    expect(r.why).toBe("按本集冲突取");
  });
  const fallbackCases: Array<[string, any]> = [
    ["抛错", async () => { throw new Error("boom"); }],
    ["非 JSON", async () => ({ text: "不是JSON", model: "fake" })],
    ["一个都没选", ok({ craft: ["nope"], methods: [], why: "" })],
  ];
  for (const [name, call] of fallbackCases) {
    it(`${name} → 回退默认集合（前4条 + 第1–3集加前三章分工；手法全取）`, async () => {
      const { store } = memoryStore();
      const r = await retrieveNovelCraft({ userId: 7, input: base, entries: [methodCard("mt_a", 3), rawEntry], store, call });
      expect(r.fallback).toBe(true);
      expect(r.craft[0]).toBe(NOVEL_CRAFT_FIRST_THREE_ID);
      expect(r.craft).toHaveLength(5);
      expect(r.methods).toEqual(["mt_a#1", "mt_a#2", "mt_a#3", "mt_raw#raw"]);
      expect(r.text).toContain("RAWTEXT-整块原文");
      expect(r.text).toContain("HOW-mt_a-3");
    });
  }
  it("第4集以后回退不加「前三章分工」", async () => {
    const { store } = memoryStore();
    const r = await retrieveNovelCraft({ userId: 7, input: { ...base, chapterIndex: 5 }, entries: [], store, call: async () => { throw new Error("x"); } });
    expect(r.craft).toHaveLength(4);
    expect(r.craft).not.toContain(NOVEL_CRAFT_FIRST_THREE_ID);
  });
  it("原始与解析证据各存一份（按账号与请求分目录，只增不覆盖），非 JSON 也各存一份", async () => {
    const { objects, store } = memoryStore();
    await retrieveNovelCraft({ userId: 7, input: base, entries: fourCards, store, call: ok({ craft: ["craft_logic"], methods: ["mt_b#2"], why: "w" }) });
    let names = Array.from(objects.keys());
    expect(names.filter(n => /\/raw-/.test(n))).toHaveLength(1);
    expect(names.filter(n => /\/parsed-/.test(n))).toHaveLength(1);
    expect(names.every(n => n.startsWith("novel-craft-retrieval/user-7/"))).toBe(true);
    const raw = JSON.parse(objects.get(names.find(n => n.includes("/raw-"))!)!);
    expect(JSON.parse(raw.response.text)).toEqual({ craft: ["craft_logic"], methods: ["mt_b#2"], why: "w" });
    const parsed = JSON.parse(objects.get(names.find(n => n.includes("/parsed-"))!)!);
    expect(parsed.parsed.methods).toEqual(["mt_b#2"]);
    expect(parsed.selection.craft).toEqual(["craft_logic"]);
    // 同一请求再来一次（如非 JSON）：新增对象，不覆盖旧的。
    await retrieveNovelCraft({ userId: 7, input: base, entries: fourCards, store, call: async () => ({ text: "坏的", model: "fake" }) });
    names = Array.from(objects.keys());
    expect(names.filter(n => /\/raw-/.test(n))).toHaveLength(2);
    expect(names.filter(n => /\/parsed-/.test(n))).toHaveLength(2);
    expect(objects.get(names.filter(n => n.includes("/parsed-"))[1]!)).toContain("not_json");
  });
  it("原始证据写不进去就不消费返回，回退默认集合", async () => {
    const store: NovelTemplateDigestStore = { read: async () => null, writeIfAbsent: async () => { throw new Error("gcs down"); } };
    const r = await retrieveNovelCraft({ userId: 7, input: base, entries: fourCards, store, call: ok({ craft: ["craft_logic"], methods: [], why: "" }) });
    expect(r.fallback).toBe(true);
    expect(r.methods).toHaveLength(32);
  });
});

describe("注入文本", () => {
  it("只含被选中的条目；所属模板的对白/节奏/避免只带一次；未选中模板不出现", () => {
    const text = renderNovelCraftInjection(
      { craft: ["craft_chapter_hook"], methods: ["mt_a#2", "mt_a#5", "mt_c#1"] },
      [...fourCards, rawEntry]
    );
    expect(text).toContain(getNovelCraftCards(["craft_chapter_hook"])[0].body);
    expect(text).not.toContain(getNovelCraftCards(["craft_logic"])[0].body);
    expect(text).toContain("HOW-mt_a-2");
    expect(text).toContain("HOW-mt_a-5");
    expect(text).not.toContain("HOW-mt_a-1：");
    expect(text).toContain("HOW-mt_c-1");
    expect(text).not.toContain("mt_b");
    expect(text).not.toContain("mt_d");
    expect(text).not.toContain("RAWTEXT");
    expect(text.split("DIALOGUE-mt_a")).toHaveLength(2);
    expect(text.split("PACING-mt_c")).toHaveLength(2);
  });
  it("回退时注入长度估算（4卡×8手法，chapter 默认集合）在合理范围", () => {
    const idx = buildNovelCraftUnifiedIndex(base, fourCards);
    const text = renderNovelCraftInjection(defaultNovelCraftSelection(base, idx), fourCards);
    expect(text.length).toBeLessThan(15000);
  });
  it("顾问阶段不走检索", () => {
    expect(shouldRetrieveNovelCraft("advice")).toBe(false);
    expect(shouldRetrieveNovelCraft("outline")).toBe(true);
    expect(shouldRetrieveNovelCraft("chapter")).toBe(true);
    expect(shouldRetrieveNovelCraft("script")).toBe(true);
  });
});

describe("digestNovelTemplates 结构化字段", () => {
  it("entries 与模板同序；回退原文的模板 card 为 null 且保留原文", async () => {
    const { digestNovelTemplates } = await import("./novelTemplateDigest");
    const { store } = memoryStore();
    const call = vi.fn(async (prompt: string) =>
      prompt.includes('"publicId":"mt_a"')
        ? { text: JSON.stringify({ publicId: "mt_a", methods: [{ name: "倒叙", how: "先果后因", when: "开场" }], dialogue: "", pacing: "", avoid: [] }), model: "fake" }
        : { text: "坏", model: "fake" }
    );
    const out = await digestNovelTemplates({
      userId: 1,
      input: { topic: "t", direction: "d", requestId: "r", templates: [{ publicId: "mt_a", role: "x" }, { publicId: "mt_b", role: "y" }] as any },
      sources: [
        { publicId: "mt_a", role: "x", cardSha256: "a", text: "原文A" },
        { publicId: "mt_b", role: "y", cardSha256: "b", text: "原文B" },
      ],
      call,
      store,
    });
    expect(out.entries.map(e => e.publicId)).toEqual(["mt_a", "mt_b"]);
    expect(out.entries[0].card?.methods[0].name).toBe("倒叙");
    expect(out.entries[1]).toEqual({ publicId: "mt_b", role: "y", card: null, text: "原文B" });
    const idx = buildNovelCraftUnifiedIndex(base, out.entries);
    expect(idx.filter(e => e.kind === "method").map(e => e.id)).toEqual(["mt_a#1", "mt_b#raw"]);
  });
});
