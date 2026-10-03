import { it, expect, vi, beforeEach } from "vitest";
const memory = vi.hoisted(() => ({
  row: null as any,
  calls: 0,
  writes: [] as any[],
}));
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
    select: () => ({
      from: () => ({ where: async () => (memory.row ? [memory.row] : []) }),
    }),
    update: () => ({
      set: (data: any) => ({
        where: async () => {
          memory.writes.push(structuredClone(data));
          Object.assign(memory.row, data);
        },
      }),
    }),
  }),
}));
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: async () => [
    { items: [{ publicCode: "0001" }] },
  ],
  resolveViralTemplateForExpand: async () => ({ card: {} }),
}));
vi.mock("./manhuaTemplatePublicId", () => ({
  resolveStableManhuaTemplatePublicCode: (c: any) => c.publicCode,
}));
vi.mock("../../shared/manhuaViralTemplateBank", () => ({
  formatManhuaViralTemplateWriterSkillFromCard: () => "完整模板",
  toPublicManhuaViralTemplateCard: (c: any) => ({
    publicId: "mt_" + c.publicCode,
    nameZh: "匿名模板",
    featureZh: "节奏",
    introZh: "冲突",
  }),
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({
  callNovelStage: async (_p: any, _j: any, _r: any, trace: any) => {
    memory.calls++;
    await trace.onBytes(100);
    await trace.onRaw("原始SSE汇总JSON");
    return {
      text: JSON.stringify({
        assessment: "先确认人物动机",
        recommendations: [
          { publicId: "mt_0001", reason: "适合冲突", tradeoff: "节奏更快" },
        ],
      }),
      model: "mock",
    };
  },
}));
import {
  runNovelWorkspaceTest,
  readNovelWorkspaceReceipt,
} from "./novelWorkspaceTest";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
const input = novelTestInputSchema.parse({
  requestId: "11111111-1111-4111-8111-111111111111",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "advice",
  topic: "补天",
  direction: "普通人视角",
  templates: [],
  episodeCount: 3,
});
beforeEach(() => {
  memory.row = null;
  memory.calls = 0;
  memory.writes = [];
});
it("同操作重放读取已存结果而非重新调用，完整原始与解析证据同时存在", async () => {
  const a = await runNovelWorkspaceTest(1, input),
    b = await runNovelWorkspaceTest(1, input);
  expect(a).toEqual(b);
  expect(memory.calls).toBe(1);
  expect(memory.row.output.rawResponses).toEqual(["原始SSE汇总JSON"]);
  expect(memory.row.output.raw.text).toContain("recommendations");
  expect(memory.row.output.result).toEqual(a);
  expect(memory.writes.findIndex(w => w.output?.raw)).toBeLessThan(
    memory.writes.findIndex(w => w.status === "succeeded")
  );
});
it("相同编号不同输入、运行中、失败均不重复发起模型；不泄漏其他用户记录", async () => {
  await runNovelWorkspaceTest(1, input);
  await expect(
    runNovelWorkspaceTest(1, { ...input, direction: "另一方向" })
  ).rejects.toThrow("另一份");
  memory.row.status = "running";
  await expect(runNovelWorkspaceTest(1, input)).rejects.toThrow("待核对");
  memory.row.status = "failed";
  await expect(runNovelWorkspaceTest(1, input)).rejects.toThrow("失败");
  expect(memory.calls).toBe(1);
  expect(await readNovelWorkspaceReceipt(2, input.requestId)).toEqual({
    status: "not_found",
  });
});
