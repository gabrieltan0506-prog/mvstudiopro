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
    {
      items: [
        {
          publicCode: "0001",
          status: "approved",
          reusableZh: "人物抉择推动关系转折",
          genPromptHintZh: "",
          classification: {},
        },
      ],
    },
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
  readSavedNovelRaw,
  recoverSavedNovelChapter,
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
  expect(a.model).toBe("mock");
  expect(
    (await readNovelWorkspaceReceipt(1, input.requestId)).result?.model
  ).toBe("mock");
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

it("进度来自持久化实际阶段，回执只公开状态和结果", async () => {
  await runNovelWorkspaceTest(1, input);
  const phases = memory.writes.map(w => w.output?.phase).filter(Boolean);
  expect(phases).toContain("waiting");
  expect(phases).toContain("receiving");
  expect(phases).toContain("validating");
  memory.row.status = "running";
  const receipt = await readNovelWorkspaceReceipt(1, input.requestId);
  expect(receipt.phase).toBe("validating");
  expect(receipt.updatedAt).toBeTruthy();
  expect(receipt).not.toHaveProperty("rawResponses");
  expect(receipt).not.toHaveProperty("result");
});

it("已付费第二集末尾逗号可显式恢复，原始证据保留且模型调用为0", async () => {
  const raw = JSON.stringify({
    title: "第二集",
    text: "原始完整正文".repeat(120),
    notes: "保留衔接",
  }).replace(/}$/, ",\n}");
  memory.row = {
    userId: "1",
    status: "failed",
    error: "原解析错误",
    input: {
      request: {
        ...input,
        stage: "chapter",
        chapterIndex: 2,
        outline: "已确认",
        novel: "第一集",
      },
    },
    output: { raw: { text: raw, model: "glm" }, rawResponses: ["原供应商SSE"] },
  };
  const recovered = await recoverSavedNovelChapter(1, input.requestId);
  expect(JSON.parse(recovered.text).text).toBe("原始完整正文".repeat(120));
  expect(memory.calls).toBe(0);
  expect(memory.row.output.raw.text).toBe(raw);
  expect(memory.row.output.rawResponses).toEqual(["原供应商SSE"]);
  expect(memory.row.output.recovery.originalError).toBe("原解析错误");
  expect(await recoverSavedNovelChapter(1, input.requestId)).toEqual(recovered);
  expect(memory.writes).toHaveLength(1);
  await expect(recoverSavedNovelChapter(2, input.requestId)).rejects.toThrow(
    "不存在"
  );
});
it("截断原稿不能伪修复，失败任务不改成成功", async () => {
  memory.row = {
    userId: "1",
    status: "failed",
    input: { request: { ...input, stage: "chapter" } },
    output: { raw: { text: '{"text":"没写完' } },
  };
  await expect(recoverSavedNovelChapter(1, input.requestId)).rejects.toThrow();
  expect(memory.row.status).toBe("failed");
  expect(memory.writes).toHaveLength(0);
  expect(memory.calls).toBe(0);
});

it("无法修复的付费原文可自行查看下载，隔离账户且不改状态不调用模型", async () => {
  const text = '{"title":"第八集","text":"保留已收到的内容';
  memory.row = {
    userId: "1",
    status: "failed",
    input: { request: { ...input, stage: "chapter" } },
    output: { raw: { text, model: "glm" } },
  };
  const raw = await readSavedNovelRaw(1, input.requestId);
  expect(raw.text).toBe(text);
  expect(raw.sha256).toMatch(/^[a-f0-9]{64}$/);
  await expect(readSavedNovelRaw(2, input.requestId)).rejects.toThrow("不存在");
  expect(memory.writes).toHaveLength(0);
  expect(memory.calls).toBe(0);
  expect(memory.row.status).toBe("failed");
});
