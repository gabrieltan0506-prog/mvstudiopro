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
  it("advice（含推荐/故事线）：目录条目带简介时只送 编号＋简介＋标签，不送手法全文；条数不变", () => {
    const withBriefs = (catalog as Array<Record<string, unknown>>).map((c, i) => ({ ...c, craft: "手法全文".repeat(200), methods: "可复用手法".repeat(200), intro: `简介${i}`, tags: ["古风", "权谋"] }));
    for (const [k, v] of Object.entries(variants)) {
      const prompt = buildNovelTestPrompt(v, "模板摘要", withBriefs);
      const line = prompt.split("\n\n").find(p => p.includes('"availableCatalog"'))!;
      const sent = JSON.parse(line).availableCatalog as Array<Record<string, unknown>>;
      expect(sent, k).toHaveLength(200);
      expect(Object.keys(sent[0]!).sort()).toEqual(["intro", "publicId", "tags"]);
      expect(prompt).not.toContain("手法全文手法全文");
      expect(prompt).toContain("能力简介与特征标签");
      expect(prompt.length).toBeLessThan(JSON.stringify(withBriefs).length * 0.1);
    }
  });

  it("advice：目录条目没有简介（旧调用方）时原样送，不丢信息", () => {
    const prompt = buildNovelTestPrompt(variants.advice!, "模板摘要", catalog);
    expect(catalogIn(prompt)).toHaveLength(200);
  });

  it("非 advice 阶段提示词要求从多张手法卡挑选组合", () => {
    const prompt = buildNovelTestPrompt({ ...base, stage: "script" }, "模板摘要", catalog);
    expect(prompt).toContain("从多张手法卡里挑适合当前场面的几条手法做排列组合");
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
