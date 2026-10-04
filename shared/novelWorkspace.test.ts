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

it("新剧本必须覆盖选定模板并引用真实场次，旧稿仍可读取", async () => {
  const { novelScriptSchema } = await import("./novelWorkspace");
  const request = {
    ...input,
    stage: "script" as const,
    episodeCount: 2 as const,
    templates: [{ publicId: "mt_0001", role: "关系转折" }],
  };
  const script = {
    title: "守城",
    episodes: [1, 2].map(index => ({
      index,
      title: "守城",
      opening: "敌人进城",
      payoff: "救下同伴",
      hook: "代价",
      scenes: [
        {
          key: `E${index}-S1`,
          场景: "城门",
          人物: "守门人",
          妆容: "布衣",
          灯光: "火光",
          氛围: "紧张",
          对白: "我留下，你先走。",
        },
      ],
    })),
  };
  expect(novelScriptSchema.parse(script).applications).toBeUndefined();
  expect(() => validateNovelStageOutput(request, script, [])).toThrow(
    "运用说明"
  );
  const application = {
    publicId: "mt_0001",
    method: "选择带来代价",
    adaptation: "同伴获救使守门人必须独自承担后果",
    sceneKeys: ["E1-S1"],
  };
  expect(
    validateNovelStageOutput(
      request,
      { ...script, applications: [application] },
      []
    )
  ).toMatchObject({ applications: [application] });
  expect(() =>
    validateNovelStageOutput(
      request,
      { ...script, applications: [{ ...application, sceneKeys: ["E9-S9"] }] },
      []
    )
  ).toThrow("运用说明");
  expect(() =>
    validateNovelStageOutput(
      request,
      { ...script, applications: [{ ...application, publicId: "mt_fake" }] },
      []
    )
  ).toThrow("运用说明");
});

it("继续讨论可以不换模板，但仍禁止编造推荐", () => {
  const followup = { ...input, advisorMessage: "我想先讨论人物动机" };
  expect(
    validateNovelStageOutput(
      followup,
      { assessment: "先明确他付出的代价", recommendations: [] },
      ["a", "b", "c"]
    )
  ).toBeTruthy();
  expect(() =>
    validateNovelStageOutput(
      followup,
      {
        assessment: "建议",
        recommendations: [
          { publicId: "fake", reason: "理由", tradeoff: "取舍" },
        ],
      },
      ["a"]
    )
  ).toThrow();
});

it("创作配比接受50/25/20/5和零权重，拒绝超额、缺项、非整数；旧稿兼容", () => {
  const templates = [50, 25, 20, 5, 0].map((weight, i) => ({
    publicId: `mt_${i}`,
    role: "分工",
    weight,
  }));
  expect(
    novelTestInputSchema
      .parse({ ...input, templates })
      .templates.map(t => t.weight)
  ).toEqual([50, 25, 20, 5, 0]);
  for (const weights of [
    [50, 25, 20, 6],
    [100, undefined],
    [99.5, 0.5],
    [-1, 101],
  ]) {
    expect(() =>
      novelTestInputSchema.parse({
        ...input,
        templates: weights.map((weight, i) => ({
          publicId: `mt_${i}`,
          role: "分工",
          weight,
        })),
      })
    ).toThrow();
  }
  expect(novelTestInputSchema.parse(input).modelPreference).toBeUndefined();
  expect(() =>
    novelTestInputSchema.parse({ ...input, modelPreference: "unknown" })
  ).toThrow();
});
