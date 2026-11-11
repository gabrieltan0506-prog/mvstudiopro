import { createHash } from "node:crypto";
import { describe, it, expect, vi } from "vitest";
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(),
  resolveViralTemplateForExpand: vi.fn(),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: vi.fn() }));
import { buildNovelTestPrompt, executeNovelTest } from "./novelWorkspaceTest";
import { novelTestInputSchema, type NovelTestInput } from "../../shared/novelWorkspace";

/** 造的 200 条目录：每条带足量手法文本，模拟真实目录体量。 */
const catalog = Array.from({ length: 200 }, (_, i) => ({
  publicId: `mt_t${String(i).padStart(3, "0")}`,
  craft: `手法${i}：`.repeat(40),
  methods: `可复用方法${i}`.repeat(30),
}));
const selected = [
  { publicId: "mt_t007", role: "主线节奏", weight: 70 },
  { publicId: "mt_t123", role: "情绪点睛", weight: 30 },
];
const base = novelTestInputSchema.parse({
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "advice",
  topic: "女娲",
  direction: "代价与抉择",
  templates: selected,
  selectedTemplateIds: selected.map(t => t.publicId),
  episodeCount: 3,
  outline: "已确认大纲",
  novel: "已写前文",
});
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const catalogIn = (prompt: string) => {
  const line = prompt.split("\n\n").find(p => p.includes('"availableCatalog"'))!;
  return (JSON.parse(line).availableCatalog as { publicId: string }[]).map(c => c.publicId);
};
const variants: Record<string, NovelTestInput> = {
  advice: base,
  discussion: { ...base, advisorIntent: "discussion", advisorMessage: "节奏太慢" },
  recommend: { ...base, advisorIntent: "recommend_templates", advisorMessage: "换个方向" },
  storyVariants: { ...base, advisorIntent: "story_variants" },
};

describe("小说改编提示词按阶段瘦身目录", () => {
  it("advice（含推荐/故事线）提示词与改动前逐字一致，送整份目录", () => {
    // 哈希由改动前的 buildNovelTestPrompt 生成（同一输入与目录）。
    const golden: Record<string, string> = {
      advice: "d67d22ca8956cf059f5792a77a536d53608cd26908906d28442bde25e23ef63f",
      discussion: "c2eecd9727b86ba66c3e5691e8f9d4f3070a786ee71be453f2f04abc37197057",
      recommend: "d3d8842a7b2e04c90e5dfc33f74d7fce0e87c74e2a78b694f8507cdc4e9a17cf",
      storyVariants: "7f15a912ff02bd94067eff320765874a9146dc9c764627531884e987f957a980",
    };
    for (const [k, v] of Object.entries(variants)) {
      const prompt = buildNovelTestPrompt(v, "模板摘要", catalog);
      expect(sha(prompt), k).toBe(golden[k]);
      expect(catalogIn(prompt)).toHaveLength(200);
    }
  });

  it.each(["outline", "chapter", "script"] as const)(
    "%s 阶段只送用户已选模板条目，不提完整目录",
    stage => {
      const prompt = buildNovelTestPrompt({ ...base, stage, chapterIndex: 2 }, "模板摘要", catalog);
      expect(catalogIn(prompt)).toEqual(["mt_t007", "mt_t123"]);
      expect(prompt).not.toContain("完整可用手法目录");
    }
  );

  it("chapter 阶段 200 条目录时提示词长度显著下降", () => {
    const chapter = { ...base, stage: "chapter" as const, chapterIndex: 2 };
    const slim = buildNovelTestPrompt(chapter, "模板摘要", catalog).length;
    const unfiltered = buildNovelTestPrompt(chapter, "模板摘要", []).length + JSON.stringify(catalog).length;
    expect(slim).toBeLessThan(unfiltered * 0.05);
  });

  it("服务端校验仍用调用方传入的完整 ID 列表", async () => {
    const response = {
      premise: "冲突",
      characters: "人物",
      episodes: [1, 2, 3].map(index => ({ index, title: "标题", events: "事件", hook: "钩子", payoff: "兑现" })),
    };
    const seen: string[] = [];
    await executeNovelTest(
      { ...base, stage: "outline" },
      "",
      catalog,
      async prompt => {
        seen.push(...catalogIn(prompt));
        return { text: JSON.stringify(response), model: "test" };
      },
      async () => {}
    );
    expect(seen).toEqual(["mt_t007", "mt_t123"]);
  });
});
