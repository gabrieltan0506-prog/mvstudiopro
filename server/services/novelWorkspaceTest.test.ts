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
    "只写第 2 章",
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
