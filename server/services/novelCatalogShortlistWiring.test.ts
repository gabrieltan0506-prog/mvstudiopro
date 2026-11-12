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
    { items: Array.from({ length: 60 }, (_, i) => ({ publicCode: String(i).padStart(4, "0"), status: "approved", reusableZh: "人物抉择推动关系转折", summaryZh: `能力简介${i}`, genPromptHintZh: "", classification: {} })) },
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
    if (prompt.includes("模板初选助手")) {
      if (memory.retrieval === "throw") throw new Error("down");
      const ids = JSON.parse(prompt.split("\n\n").find((p: string) => p.includes('"catalogShard"'))!).catalogShard.map((e: any) => e.publicId);
      return { text: JSON.stringify({ picks: [{ publicId: ids[0], why: "w" }] }), model: "mock" };
    }
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
  templates: [{ publicId: "mt_0000", role: "主导" }],
  selectedTemplateIds: ["mt_0000"],
};
const catalogIds = (prompt: string) => JSON.parse(prompt.split("\n\n").find(p => p.includes('"availableCatalog"'))!).availableCatalog.map((c: any) => c.publicId);
beforeEach(() => {
  memory.row = null;
  memory.prompts = [];
  memory.objects = new Map();
  memory.retrieval = "ok";
});

it("顾问阶段：59 条目录分 3 片并发初选，终选提示词只含入围名单；evidence 记 catalogShortlist，raw/parsed 证据各 3 份", async () => {
  await runNovelWorkspaceTest(1, novelTestInputSchema.parse({ ...base, stage: "advice", advisorMessage: "怎么改" }));
  const shortlistPrompts = memory.prompts.filter(p => p.includes("模板初选助手"));
  expect(shortlistPrompts).toHaveLength(3);
  const main = memory.prompts.find(p => !p.includes("模板初选助手"))!;
  expect(catalogIds(main)).toEqual(["mt_0001", "mt_0026", "mt_0051"]);
  expect(main).toContain("目录是初选后的入围名单");
  expect(memory.row.status).toBe("succeeded");
  expect(memory.row.output.catalogShortlist).toEqual({ shards: 3, picked: ["mt_0001", "mt_0026", "mt_0051"], fallbackShards: [] });
  const names = Array.from(memory.objects.keys()).filter(n => n.startsWith("novel-catalog-shortlist/user-1/"));
  expect(names.filter(n => n.includes("-raw-"))).toHaveLength(3);
  expect(names.filter(n => n.includes("-parsed-"))).toHaveLength(3);
});

it("初选全部失败 → 回退全库目录，照常完成", async () => {
  memory.retrieval = "throw";
  await runNovelWorkspaceTest(1, novelTestInputSchema.parse({ ...base, stage: "advice", advisorMessage: "怎么改" }));
  const main = memory.prompts.find(p => !p.includes("模板初选助手"))!;
  expect(catalogIds(main)).toHaveLength(59);
  expect(main).not.toContain("目录是初选后的入围名单");
  expect(memory.row.status).toBe("succeeded");
  expect(memory.row.output.catalogShortlist.allFailed).toBe(true);
  expect(memory.row.output.catalogShortlist.fallbackShards).toHaveLength(3);
});
