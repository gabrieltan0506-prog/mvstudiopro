import { it, expect, vi, beforeEach } from "vitest";
import { REVISE_ORIGINAL, REVISE_REVIEW, REVISE_REVISED } from "../../shared/novelRevise.fixture";
const memory = vi.hoisted(() => ({
  row: null as any,
  calls: [] as any[],
  replies: {} as Record<string, string>,
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
    select: () => ({
      from: () => ({ where: async () => (memory.row ? [memory.row] : []) }),
    }),
    update: () => ({
      set: (data: any) => ({
        where: async () => {
          Object.assign(memory.row, structuredClone(data));
        },
      }),
    }),
  }),
}));
// 审稿改稿不得读取模板库。
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: async () => {
    throw new Error("审稿改稿不应读取模板库");
  },
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({
  callNovelStage: async (_p: string, _j: boolean, requestId: string, trace: any) => {
    const step = requestId.endsWith(":review") ? "review" : "revise";
    memory.calls.push({ step, modelPreference: trace.modelPreference });
    await trace.onRaw(`SSE-${step}`);
    return { text: memory.replies[step], model: "mock" };
  },
}));
import {
  runNovelWorkspaceTest,
  readNovelWorkspaceReceipt,
} from "./novelWorkspaceTest";
import { novelTestInputSchema } from "../../shared/novelWorkspace";
const input = novelTestInputSchema.parse({
  requestId: "33333333-3333-4333-8333-333333333333",
  roundId: "22222222-2222-4222-8222-222222222222",
  stage: "revise",
  topic: "权谋",
  direction: "替父翻案",
  templates: [],
  episodeCount: 1,
  chapterIndex: 3,
  outline: "大纲",
  reviseDraft: REVISE_ORIGINAL,
  modelPreference: "glm",
});
beforeEach(() => {
  memory.row = null;
  memory.calls = [];
  memory.replies = {
    review: JSON.stringify(REVISE_REVIEW),
    revise: JSON.stringify(REVISE_REVISED),
  };
});
it("成功：结果带 original/review/revised；review 与 revise 的原始与解析证据各存一份；重放不重复调用", async () => {
  const a = await runNovelWorkspaceTest(1, input);
  const b = await runNovelWorkspaceTest(1, input);
  expect(b).toEqual(a);
  expect(memory.calls).toEqual([
    { step: "review", modelPreference: "glm" },
    { step: "revise", modelPreference: "glm" },
  ]);
  const value = JSON.parse(a.text);
  expect(value.original).toBe(REVISE_ORIGINAL);
  expect(value.review.verdict).toBe(REVISE_REVIEW.verdict);
  expect(value.revised.title).toBe("账册");
  expect(a.stage).toBe("revise");
  const out = memory.row.output;
  expect(memory.row.status).toBe("succeeded");
  expect(out.reviewRaw.text).toBe(memory.replies.review);
  expect(out.reviseRaw.text).toBe(memory.replies.revise);
  expect(out.reviewParsed).toEqual(REVISE_REVIEW);
  expect(out.reviseParsed).toEqual(REVISE_REVISED);
  expect(out.reviewRawResponses).toEqual(["SSE-review"]);
  expect(out.reviseRawResponses).toEqual(["SSE-revise"]);
  expect(out.reviewRawSha256).not.toBe(out.reviseRawSha256);
  expect((await readNovelWorkspaceReceipt(1, input.requestId)).result).toEqual(a);
});
it("审稿失败：不改稿，阶段失败给业务提示，原始返回保留", async () => {
  memory.replies.review = "{坏的";
  await expect(runNovelWorkspaceTest(1, input)).rejects.toThrow(/审稿未完成/);
  expect(memory.calls.map(c => c.step)).toEqual(["review", "review"]); // 写坏带拒因重写一次
  expect(memory.row.status).toBe("failed");
  expect(memory.row.output.reviewRaw.text).toBe("{坏的");
  const receipt = await readNovelWorkspaceReceipt(1, input.requestId);
  expect(receipt.revise?.failedStep).toBe("review");
  expect(receipt.revise?.review).toBeUndefined();
  // 失败后重放也不再调用
  await expect(runNovelWorkspaceTest(1, input)).rejects.toThrow();
  expect(memory.calls).toHaveLength(2);
});
it("改稿失败：阶段失败但审稿结果保留并经回执返回，两份证据都在", async () => {
  memory.replies.revise = JSON.stringify({ ...REVISE_REVISED, text: "短".repeat(800) });
  await expect(runNovelWorkspaceTest(1, input)).rejects.toThrow(/审稿意见已保留/);
  expect(memory.calls.map(c => c.step)).toEqual(["review", "revise", "revise"]) // 改稿写坏同样重写一次;
  const out = memory.row.output;
  expect(out.reviewParsed).toEqual(REVISE_REVIEW);
  expect(out.reviseRaw.text).toBe(memory.replies.revise);
  expect(out.reviseParsed.text).toHaveLength(800);
  const receipt = await readNovelWorkspaceReceipt(1, input.requestId);
  expect(receipt.status).toBe("failed");
  expect(receipt.revise?.failedStep).toBe("revise");
  expect(receipt.revise?.review).toEqual(REVISE_REVIEW);
  expect(receipt.revise?.original).toBe(REVISE_ORIGINAL);
});
it("审稿线路与改稿线路分别生效（各自传给对应那次调用）", async () => {
  const split = novelTestInputSchema.parse({
    ...input,
    requestId: "44444444-4444-4444-8444-444444444444",
    reviewModelPreference: "deepseek",
    rewriteModelPreference: "glm",
  });
  await runNovelWorkspaceTest(1, split);
  expect(memory.calls).toEqual([
    { step: "review", modelPreference: "deepseek" },
    { step: "revise", modelPreference: "glm" },
  ]);
});
