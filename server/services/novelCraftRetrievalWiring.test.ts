import { it, expect, vi, beforeEach } from "vitest";
const memory = vi.hoisted(() => ({
  row: null as any,
  prompts: [] as string[],
  objects: new Map<string, string>(),
  retrieval: "ok" as "ok" | "throw",
}));
// 1112 计费：余额充足、扣费成功（不连库）。
vi.mock("../credits", () => ({ getCredits: async () => ({ totalAvailable: 1e9 }), deductCreditsAmount: async () => ({ success: true, cost: 0 }) }));
vi.mock("../db", () => ({
  getDb: async () => ({
    insert: () => ({
      values: (data: any) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (memory.row) return [];
            memory.row = { ...data, output: null };
            return [{ id: data.id }];
          },
        }),
      }),
    }),
    select: () => ({ from: () => ({ where: async () => (memory.row ? [memory.row] : []) }) }),
    update: () => ({ set: (data: any) => ({ where: async () => { Object.assign(memory.row, data); } }) }),
  }),
}));
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: async () => [
    { items: [{ publicCode: "0001", status: "approved", reusableZh: "人物抉择推动关系转折", genPromptHintZh: "", classification: {} }] },
  ],
  resolveViralTemplateForExpand: async () => ({ card: {} }),
}));
vi.mock("./manhuaTemplatePublicId", () => ({ resolveStableManhuaTemplatePublicCode: (c: any) => c.publicCode }));
vi.mock("../../shared/manhuaViralTemplateBank", () => ({
  formatManhuaViralTemplateWriterSkillFromCard: () => "完整模板原文",
  flattenManhuaTemplateClassification: () => [],
  toPublicManhuaViralTemplateCard: (c: any) => ({ publicId: "mt_" + c.publicCode, nameZh: "匿名模板", featureZh: "节奏", introZh: "冲突" }),
}));
vi.mock("./novelTemplateDigest", async original => ({
  ...(await original<typeof import("./novelTemplateDigest")>()),
  digestNovelTemplates: async () => ({
    templates: "DIGEST-FULL-TEXT",
    stats: { cached: ["mt_0001"], fresh: [], fallback: [] },
    entries: [
      {
        publicId: "mt_0001",
        role: "主导",
        text: "",
        card: {
          publicId: "mt_0001",
          methods: [
            { name: "倒叙切入", how: "HOW-ONE", when: "开场" },
            { name: "当众对质", how: "HOW-TWO", when: "高潮" },
          ],
          dialogue: "",
          pacing: "",
          avoid: [],
        },
      },
    ],
  }),
  createGcsNovelTemplateDigestStore: async () => ({
    read: async (n: string) => memory.objects.get(n) ?? null,
    writeIfAbsent: async (n: string, b: string) => { if (!memory.objects.has(n)) memory.objects.set(n, b); },
  }),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({
  callNovelStage: async (prompt: string, _j: any, _r: any, trace: any) => {
    memory.prompts.push(prompt);
    if (prompt.includes("资料检索助手")) {
      if (memory.retrieval === "throw") throw new Error("down");
      return { text: JSON.stringify({ craft: ["craft_logic"], methods: ["mt_0001#2"], why: "w" }), model: "mock" };
    }
    await trace?.onRaw?.("raw");
    if (prompt.includes("只生成 1 集的可编辑提案"))
      return {
        text: JSON.stringify({
          premise: "核心矛盾与世界规则",
          characters: "角色欲望与关系",
          episodes: [{ index: 1, title: "落难", events: "主角被迫顶罪，因此连夜找证据", hook: "门外有人通传", payoff: "找到第一份证据" }],
        }),
        model: "mock",
      };
    return { text: JSON.stringify({ assessment: "先确认人物动机", recommendations: [] }), model: "mock" };
  },
}));
import { runNovelWorkspaceTest } from "./novelWorkspaceTest";
import { novelTestInputSchema } from "../../shared/novelWorkspace";

const base = {
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  topic: "补天",
  direction: "普通人视角",
  episodeCount: 1,
  templates: [{ publicId: "mt_0001", role: "主导" }],
};
beforeEach(() => {
  memory.row = null;
  memory.prompts = [];
  memory.objects = new Map();
  memory.retrieval = "ok";
});

it("顾问阶段不触发检索，仍用手法卡全文", async () => {
  await runNovelWorkspaceTest(1, novelTestInputSchema.parse({ ...base, stage: "advice", advisorMessage: "怎么改" }));
  expect(memory.prompts.some(p => p.includes("资料检索助手"))).toBe(false);
  expect(memory.prompts).toHaveLength(1);
  expect(memory.prompts[0]).toContain("DIGEST-FULL-TEXT");
  expect(memory.row.output.craftRetrieval).toBeUndefined();
});

it("大纲阶段：先检索一次，写作提示词只注入选中条目，替换手法卡全文；evidence 记 craftRetrieval", async () => {
  await runNovelWorkspaceTest(1, novelTestInputSchema.parse({ ...base, stage: "outline" }));
  expect(memory.prompts).toHaveLength(2);
  expect(memory.prompts[0]).toContain("资料检索助手");
  expect(memory.prompts[0]).not.toContain("HOW-ONE");
  const main = memory.prompts[1];
  expect(main).not.toContain("DIGEST-FULL-TEXT");
  expect(main).toContain("HOW-TWO");
  expect(main).not.toContain("HOW-ONE");
  expect(main).toContain("《逻辑与因果》");
  expect(main).toContain("排列组合");
  expect(memory.row.status).toBe("succeeded");
  expect(memory.row.output.craftRetrieval).toEqual({ craft: ["craft_logic"], methods: ["mt_0001#2"], fallback: false });
  expect(Array.from(memory.objects.keys()).filter(n => n.startsWith("novel-craft-retrieval/user-1/"))).toHaveLength(2);
});

it("检索抛错不挡写作：回退默认集合继续写，fallback=true", async () => {
  memory.retrieval = "throw";
  await runNovelWorkspaceTest(1, novelTestInputSchema.parse({ ...base, stage: "outline" }));
  expect(memory.row.status).toBe("succeeded");
  expect(memory.row.output.craftRetrieval.fallback).toBe(true);
  expect(memory.row.output.craftRetrieval.methods).toEqual(["mt_0001#1", "mt_0001#2"]);
  expect(memory.prompts[1]).toContain("HOW-ONE");
});

it("顾问阶段：判定为短篇且题材命中时，提示词末尾附 1 张短篇结构公式，evidence 记 craftShort", async () => {
  await runNovelWorkspaceTest(
    1,
    novelTestInputSchema.parse({ ...base, stage: "advice", topic: "追夫火葬场", targetEpisodeCount: 10, advisorMessage: "怎么改" })
  );
  expect(memory.prompts).toHaveLength(1);
  expect(memory.prompts[0]).toContain("DIGEST-FULL-TEXT");
  expect(memory.prompts[0]).toContain("【短篇结构公式】");
  expect(memory.prompts[0]).toContain("《短篇公式·追夫火葬场不原谅》");
  expect(memory.row.output.craftShort).toEqual(["craft_short_chase_husband_no_forgive"]);
});

it("顾问阶段：长篇（总集数 >12 且无短篇字样）不附短篇公式", async () => {
  await runNovelWorkspaceTest(
    1,
    novelTestInputSchema.parse({ ...base, stage: "advice", topic: "追夫火葬场", targetEpisodeCount: 60, advisorMessage: "怎么改" })
  );
  expect(memory.prompts[0]).not.toContain("【短篇结构公式】");
  expect(memory.row.output.craftShort).toBeUndefined();
});
