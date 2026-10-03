import { describe, it, expect } from "vitest";
import {
  novelTestInputSchema,
  validateNovelStageOutput,
} from "./novelWorkspace";
const input = novelTestInputSchema.parse({
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "advice",
  topic: "神话",
  direction: "普通人承担代价",
  templates: [],
  episodeCount: 3,
});
describe("小说工作室合同", () => {
  it("原创无需底本，单模板和组合均接受", () => {
    expect(input.source).toBeUndefined();
    for (const count of [1, 3, 5])
      expect(
        novelTestInputSchema.parse({
          ...input,
          stage: "outline",
          templates: Array.from({ length: count }, (_, i) => ({
            publicId: `mt_000${i}`,
            role: "对白",
          })),
        }).templates
      ).toHaveLength(count);
  });
  it("拒绝空模板生成、重复模板、越序章节与未确认小说", () => {
    expect(() =>
      novelTestInputSchema.parse({ ...input, stage: "outline" })
    ).toThrow();
    expect(() =>
      novelTestInputSchema.parse({
        ...input,
        templates: [
          { publicId: "mt_0001", role: "节奏" },
          { publicId: "mt_0001", role: "对白" },
        ],
      })
    ).toThrow();
    expect(() =>
      novelTestInputSchema.parse({
        ...input,
        stage: "script",
        templates: [{ publicId: "mt_0001", role: "节奏" }],
      })
    ).toThrow();
  });
  it("顾问不能编造、重复、推荐已选ID；库不足时接受真实数量", () => {
    const rec = (publicId: string) => ({
      publicId,
      reason: "适合",
      tradeoff: "取舍",
    });
    expect(
      validateNovelStageOutput(
        input,
        { assessment: "建议", recommendations: [rec("a"), rec("b")] },
        ["a", "b"]
      )
    ).toBeTruthy();
    for (const ids of [["a"], ["a", "a", "b"], ["a", "b", "fake"]])
      expect(() =>
        validateNovelStageOutput(
          input,
          { assessment: "建议", recommendations: ids.map(rec) },
          ["a", "b", "c"]
        )
      ).toThrow();
    expect(() =>
      validateNovelStageOutput(
        { ...input, selectedTemplateIds: ["a"] },
        { assessment: "建议", recommendations: [rec("a")] },
        ["a", "b"]
      )
    ).toThrow();
  });
  it("分集不能用两集冒充三集，也不能重复集号", () => {
    const ep = {
      index: 1,
      title: "起",
      events: "事",
      hook: "疑",
      payoff: "偿",
    };
    expect(() =>
      validateNovelStageOutput(
        { ...input, stage: "outline" },
        {
          premise: "冲突",
          characters: "人物",
          episodes: [ep, { ...ep, index: 2 }],
        },
        []
      )
    ).toThrow();
  });
});
