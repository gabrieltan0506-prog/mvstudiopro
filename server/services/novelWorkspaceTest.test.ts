import { it, expect, vi } from "vitest";
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: vi.fn(),
  resolveViralTemplateForExpand: vi.fn(),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({ callNovelStage: vi.fn() }));
import { executeNovelTest, buildNovelTestPrompt } from "./novelWorkspaceTest";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
import { assertNovelTestRole } from "../routers/novelWorkspace";
const input = novelTestInputSchema.parse({
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "advice",
  topic: "女娲",
  direction: "代价与抉择",
  templates: [],
  episodeCount: 3,
});
it("管理者测试禁止普通账号", () => {
  expect(() => assertNovelTestRole("user")).toThrow();
  expect(() => assertNovelTestRole("admin")).not.toThrow();
  expect(() => assertNovelTestRole("supervisor")).not.toThrow();
});
it("解析失败也先保存完整响应，保存失败不继续", async () => {
  const save = vi.fn(async () => {}),
    call = vi.fn(async () => ({ text: "invalid", model: "test" }));
  await expect(executeNovelTest(input, "", [], call, save)).rejects.toThrow();
  expect(save).toHaveBeenCalledWith({ text: "invalid", model: "test" });
  const failed = vi.fn(async () => {
    throw new Error("disk");
  });
  await expect(executeNovelTest(input, "", [], call, failed)).rejects.toThrow(
    "disk"
  );
});
it("顾问读取真实目录，禁止推荐造假", async () => {
  const response = {
    assessment: "人物代价",
    recommendations: [
      { publicId: "mt_fake", reason: "理由", tradeoff: "取舍" },
    ],
  };
  await expect(
    executeNovelTest(
      input,
      "",
      [{ publicId: "mt_real" }],
      async () => ({ text: JSON.stringify(response), model: "test" }),
      async () => {}
    )
  ).rejects.toThrow();
});
it("阶段提示保留用户方向、确认前文、组合分工，不一次写完", () => {
  const prompt = buildNovelTestPrompt(
    {
      ...input,
      stage: "chapter",
      chapterIndex: 2,
      outline: "已确认大纲",
      novel: "已经写好第一章",
      templates: [
        { publicId: "mt_a", role: "对白" },
        { publicId: "mt_b", role: "节奏" },
      ],
    },
    "完整模板",
    []
  );
  for (const value of [
    "只写第 2 集小说稿",
    "已确认大纲",
    "已经写好第一章",
    "完整模板",
    "对白",
    "节奏",
    "不能仅靠硬断",
  ])
    expect(prompt).toContain(value);
});

it("用户回复与完整历史进入顾问和提案，不把建议当成已采用", () => {
  const discussion = {
    advisorMessage: "保留未来武器",
    advisorHistory: [{ user: "如何选？", assistant: "建议先确定主角代价" }],
  };
  for (const stage of ["advice", "outline"] as const) {
    const prompt = buildNovelTestPrompt(
      { ...input, ...discussion, stage },
      "",
      []
    );
    for (const text of [
      "保留未来武器",
      "如何选？",
      "建议先确定主角代价",
      "顾问建议不等于用户已采用",
    ])
      expect(prompt).toContain(text);
  }
  expect(novelTestInputSchema.parse(input).advisorHistory).toBeUndefined();
  expect(() =>
    novelTestInputSchema.parse({
      ...input,
      advisorHistory: Array(21).fill(discussion.advisorHistory[0]),
    })
  ).toThrow();
});

it("所有创作阶段收到实际配比，不只展示在页面", () => {
  for (const stage of ["advice", "outline", "chapter", "script"] as const) {
    const templates = [
      { publicId: "mt_bf6e", role: "权谋线索", weight: 50 },
      { publicId: "mt_4737", role: "对话交锋", weight: 25 },
      { publicId: "mt_1b5b", role: "关系互动", weight: 20 },
      { publicId: "mt_46f5", role: "武器亮相", weight: 5 },
    ];
    const prompt = buildNovelTestPrompt(
      { ...input, stage, templates },
      "完整手法",
      []
    );
    expect(prompt).toContain(JSON.stringify(templates));
    expect(prompt).toContain("不按字数或场次数机械切分");
  }
});

it("新方向重荐以当前稿为上下文，从既有审核库提供有依据的替代方案", () => {
  const prompt = buildNovelTestPrompt(
    {
      ...input,
      advisorIntent: "recommend_templates",
      advisorMessage: "减少朝堂，增加江湖追查",
      outline: "原来的政变大纲",
      novel: "已经写好的小吏故事",
    },
    "已审核手法",
    []
  );
  for (const value of [
    "减少朝堂，增加江湖追查",
    "原来的政变大纲",
    "已经写好的小吏故事",
    "并非新训练",
    "相对原组合改善什么",
    "不直接重写正文",
  ])
    expect(prompt).toContain(value);
});

it("首次模板组合直接生成三版故事，带上原稿与明确配比", () => {
  const prompt = buildNovelTestPrompt(
    {
      ...input,
      advisorIntent: "story_variants",
      templates: [{ publicId: "mt_a", role: "权谋", weight: 100 }],
      outline: "原情节",
      novel: "已写正文",
    },
    "模板方法",
    []
  );
  for (const expected of [
    "恰好三个故事线方案",
    "首次无advisorMessage",
    "原情节",
    "已写正文",
    "currentNovelDraft",
    '"weight":100',
    '"variants"',
    "不生成小说",
  ])
    expect(prompt).toContain(expected);
});

it("完整章节尾逗号自动修复，先保存原文再校验且仅调用一次", async () => {
  const body = "已收到的完整小说正文".repeat(100);
  const response = {
    text: JSON.stringify({ title: "第八集", text: body, notes: "" }).replace(
      /}$/,
      ",}"
    ),
    model: "mock",
  };
  const events: string[] = [];
  const call = vi.fn(async () => response);
  const result = await executeNovelTest(
    {
      ...input,
      stage: "chapter",
      chapterIndex: 8,
      episodeStart: 4,
      episodeCount: 10,
      outline: "已确认提案",
      novel: "第七集",
    },
    "",
    [],
    call,
    async r => {
      expect(r).toEqual(response);
      events.push("raw");
    },
    async (_, normalized, repaired) => {
      expect(repaired).toBe(true);
      expect(JSON.parse(normalized).text).toBe(body);
      events.push("parsed");
    }
  );
  expect((result as any).text).toBe(body);
  expect(events).toEqual(["raw", "parsed"]);
  expect(call).toHaveBeenCalledTimes(1);
});
