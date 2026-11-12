/** 多线路审稿对比（1112）：只审稿、综合意见改稿、线路互不影响、原单线路流程不变。全部 mock，不调用真实模型。 */
import { it, expect, vi, beforeEach, describe } from "vitest";
import { createHash } from "node:crypto";
import { REVISE_ORIGINAL, REVISE_REVIEW, REVISE_REVISED } from "../../shared/novelRevise.fixture";
const memory = vi.hoisted(() => ({
  rows: new Map<string, any>(),
  calls: [] as { requestId: string; step: string; modelPreference?: string; prompt: string }[],
  replies: {} as Record<string, string | ((requestId: string) => string)>,
  failCall: new Set<string>(),
}));
// 1112 计费：余额充足、扣费成功（不连库）。
vi.mock("../credits", () => ({ getCredits: async () => ({ totalAvailable: 1e9 }), deductCreditsAmount: async () => ({ success: true, cost: 0 }) }));
vi.mock("drizzle-orm", async original => ({
  ...(await original<typeof import("drizzle-orm")>()),
  eq: (_column: unknown, value: unknown) => ({ __id: value }),
}));
vi.mock("../db", () => ({
  getDb: async () => ({
    insert: () => ({
      values: (data: any) => ({
        onConflictDoNothing: () => ({
          returning: async () => {
            if (memory.rows.has(data.id)) return [];
            memory.rows.set(data.id, { ...data, output: null });
            return [{ id: data.id }];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: async (cond: { __id: string }) => (memory.rows.has(cond.__id) ? [memory.rows.get(cond.__id)] : []),
      }),
    }),
    update: () => ({
      set: (data: any) => ({
        where: async (cond: { __id: string }) => {
          Object.assign(memory.rows.get(cond.__id), structuredClone(data));
        },
      }),
    }),
  }),
}));
vi.mock("./manhuaViralTemplateStore", () => ({
  listMergedApprovedManhuaViralTemplatesGrouped: async () => {
    throw new Error("审稿不应读取模板库");
  },
}));
vi.mock("./manhuaNovelAdaptationRun", () => ({
  callNovelStage: async (prompt: string, _j: boolean, tag: string, trace: any) => {
    const [requestId, step] = tag.split(":");
    memory.calls.push({ requestId, step, modelPreference: trace.modelPreference, prompt });
    await new Promise(r => setTimeout(r, 1));
    if (memory.failCall.has(requestId)) throw new Error("通道失败");
    await trace.onRaw(`SSE-${step}`);
    const reply = memory.replies[step];
    return { text: typeof reply === "function" ? reply(requestId) : reply, model: `mock-${trace.modelPreference}` };
  },
}));
import { runNovelWorkspaceTest, readNovelWorkspaceReceipt } from "./novelWorkspaceTest";
import {
  buildNovelReviewPrompt,
  buildNovelRevisePrompt,
  executeNovelRevise,
  NovelReviseError,
} from "./novelChapterRevise";
import { novelTestInputSchema, novelReviewOnlyResultSchema, validateNovelReview } from "../../shared/novelWorkspace";

const ROUND = "22222222-2222-4222-8222-222222222222";
const L1 = "aaaaaaaa-1111-4111-8111-111111111111";
const L2 = "bbbbbbbb-2222-4222-8222-222222222222";
const L3 = "cccccccc-3333-4333-8333-333333333333";
const base = {
  roundId: ROUND,
  stage: "revise" as const,
  topic: "权谋",
  direction: "替父翻案",
  templates: [],
  episodeCount: 1,
  chapterIndex: 3,
  outline: "第3集：账册\n剧情：沈昭查账",
  reviseDraft: REVISE_ORIGINAL,
  creativePremise: "账册会说话",
};
const reviewOnly = (requestId: string, lane: "glm" | "deepseek" | "carbon") =>
  novelTestInputSchema.parse({ ...base, requestId, modelPreference: lane, reviewModelPreference: lane, reviseMode: "review_only" });
const rowOf = (requestId: string) =>
  memory.rows.get(`novel_test_${createHash("sha256").update(`1:${requestId}`).digest("hex").slice(0, 40)}`);
beforeEach(() => {
  memory.rows.clear();
  memory.calls = [];
  memory.failCall.clear();
  memory.replies = { review: JSON.stringify(REVISE_REVIEW), revise: JSON.stringify(REVISE_REVISED) };
});

describe("只审稿（review_only）", () => {
  it("只调用一次审稿、不产出改稿；原始与解析证据齐全；重放不再调用", async () => {
    const input = reviewOnly(L1, "deepseek");
    const a = await runNovelWorkspaceTest(1, input);
    expect(await runNovelWorkspaceTest(1, input)).toEqual(a);
    expect(memory.calls.map(c => [c.step, c.modelPreference])).toEqual([["review", "deepseek"]]);
    const value = novelReviewOnlyResultSchema.parse(JSON.parse(a.text));
    expect(value.revised).toBeUndefined();
    expect(value.review.verdict).toBe(REVISE_REVIEW.verdict);
    expect(value.models).toEqual({ review: "mock-deepseek" });
    expect(a.model).toBe("mock-deepseek");
    const row = rowOf(L1);
    expect(row.status).toBe("succeeded");
    expect(row.output.reviseMode).toBe("review_only");
    expect(row.output.reviewRaw.text).toBe(memory.replies.review);
    expect(row.output.reviewParsed).toEqual(REVISE_REVIEW);
    expect(row.output.reviewRawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.output.reviewNormalizedSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(row.output.reviewRawResponses).toEqual(["SSE-review"]);
    expect(row.output.reviseRaw).toBeUndefined();
    expect((await readNovelWorkspaceReceipt(1, L1)).result).toEqual(a);
  });
  it("审稿提示词与单线路审稿改稿的审稿一步完全相同", async () => {
    await runNovelWorkspaceTest(1, reviewOnly(L1, "glm"));
    expect(memory.calls[0].prompt).toBe(buildNovelReviewPrompt(reviewOnly(L1, "glm")));
    expect(memory.calls[0].prompt).toBe(
      buildNovelReviewPrompt(novelTestInputSchema.parse({ ...base, requestId: L2, modelPreference: "glm" }))
    );
  });
  it("写坏仍带拒因重写一次；仍不过即失败，原始证据两份都在，回执 failedStep=review", async () => {
    memory.replies.review = "{坏的";
    await expect(runNovelWorkspaceTest(1, reviewOnly(L1, "glm"))).rejects.toThrow(/审稿未完成/);
    expect(memory.calls.map(c => c.step)).toEqual(["review", "review"]);
    expect(memory.calls[1].prompt).toContain("【上一次输出未通过校验】");
    const row = rowOf(L1);
    expect(row.status).toBe("failed");
    expect(row.output.reviewRaw.text).toBe("{坏的");
    expect(row.output.reviewRewriteRaw.text).toBe("{坏的");
    expect((await readNovelWorkspaceReceipt(1, L1)).revise?.failedStep).toBe("review");
  });
  it("并发多条线路：一条失败不影响其他，各自 requestId 的证据独立保存", async () => {
    memory.failCall.add(L2);
    memory.replies.review = (requestId: string) =>
      JSON.stringify({ ...REVISE_REVIEW, verdict: `结论-${requestId.slice(0, 4)}` });
    const settled = await Promise.allSettled([
      runNovelWorkspaceTest(1, reviewOnly(L1, "glm")),
      runNovelWorkspaceTest(1, reviewOnly(L2, "deepseek")),
      runNovelWorkspaceTest(1, reviewOnly(L3, "carbon")),
    ]);
    expect(settled.map(s => s.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(rowOf(L1).status).toBe("succeeded");
    expect(rowOf(L2).status).toBe("failed");
    expect(rowOf(L3).status).toBe("succeeded");
    expect(rowOf(L1).output.reviewParsed.verdict).toBe("结论-aaaa");
    expect(rowOf(L3).output.reviewParsed.verdict).toBe("结论-cccc");
    expect(rowOf(L1).output.reviewRawSha256).not.toBe(rowOf(L3).output.reviewRawSha256);
    expect(memory.calls.filter(c => c.step === "revise")).toEqual([]);
    expect((await readNovelWorkspaceReceipt(1, L2)).status).toBe("failed");
  });
});

describe("按所选意见改稿（reviewOverride）", () => {
  const override = {
    ...REVISE_REVIEW,
    verdict: "综合多条线路的意见。线路一：需改；线路二：需改",
    sources: [
      { requestId: L1, lane: "glm" as const },
      { requestId: L3, lane: "carbon" as const },
    ],
  };
  const combined = (requestId: string, o: object = override) =>
    novelTestInputSchema.parse({ ...base, requestId, modelPreference: "deepseek", rewriteModelPreference: "deepseek", reviewOverride: o });
  it("跳过审稿只改稿；证据记明综合意见与来源 requestId；结果带 reviewOrigin", async () => {
    const result = await runNovelWorkspaceTest(1, combined(L2));
    expect(memory.calls.map(c => [c.step, c.modelPreference])).toEqual([["revise", "deepseek"]]);
    const { sources: _, ...asReview } = override;
    expect(memory.calls[0].prompt).toBe(
      buildNovelRevisePrompt(combined(L2), validateNovelReview(REVISE_ORIGINAL, asReview))
    );
    const value = JSON.parse(result.text);
    expect(value.revised.title).toBe("账册");
    expect(value.review.verdict).toBe(override.verdict);
    expect(value.reviewOrigin).toEqual({ kind: "combined", sources: override.sources });
    expect(value.models).toEqual({ revise: "mock-deepseek" });
    const out = rowOf(L2).output;
    expect(out.reviewSource).toBe("combined");
    expect(out.reviewSourceRequestIds).toEqual([L1, L3]);
    expect(out.reviewOverride).toEqual(combined(L2).reviewOverride);
    expect(out.reviewOverrideSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(out.reviewRaw).toBeUndefined();
    expect(out.reviseRaw.text).toBe(memory.replies.revise);
    expect(out.reviseParsed).toEqual(REVISE_REVISED);
  });
  it("非法输入：请求校验拒收；绕过校验直接调用也在调用模型前拒绝", async () => {
    const bad = { ...override, issues: [...override.issues.slice(0, 2), { ...override.issues[2], quote: "原文里没有这句" }] };
    expect(novelTestInputSchema.safeParse({ ...base, requestId: L2, reviewOverride: bad }).success).toBe(false);
    expect(novelTestInputSchema.safeParse({ ...base, requestId: L2, reviewOverride: { ...override, sources: [] } }).success).toBe(false);
    const forged = { ...combined(L2), reviewOverride: bad } as any;
    const saved: string[] = [];
    await expect(
      executeNovelRevise(forged, async () => ({ text: "{}", model: "x" }), {
        saveRaw: async step => void saved.push(step),
        saveParsed: async () => {},
      })
    ).rejects.toSatisfy((e: unknown) => e instanceof NovelReviseError && e.kind === "review");
    expect(saved).toEqual([]);
  });
  it("改稿失败：综合意见作为审稿结果经回执带回", async () => {
    memory.replies.revise = "{坏的";
    await expect(runNovelWorkspaceTest(1, combined(L2))).rejects.toThrow(/审稿意见已保留/);
    expect(memory.calls.map(c => c.step)).toEqual(["revise", "revise"]);
    const receipt = await readNovelWorkspaceReceipt(1, L2);
    expect(receipt.revise?.failedStep).toBe("revise");
    expect((receipt.revise?.review as any).verdict).toBe(override.verdict);
  });
});

describe("回归：原单线路「审稿改稿」不变", () => {
  const single = novelTestInputSchema.parse({ ...base, requestId: L1, modelPreference: "glm" });
  const sha = (s: string) => createHash("sha256").update(s).digest("hex");
  it("提示词与改动前逐字一致（哈希为改动前基线）", () => {
    expect(sha(buildNovelReviewPrompt(single))).toBe("d49e281c22beaabc948c91698915f6178271cee083fff1e54a838132ced58ded");
    expect(sha(buildNovelRevisePrompt(single, validateNovelReview(REVISE_ORIGINAL, REVISE_REVIEW)))).toBe(
      "680e46c267057ed3f628c5468fc56162163176a579f59a7a9ff06064460dcdb9"
    );
  });
  it("调用序列仍是先审稿、再改稿，结果不带 reviewOrigin，证据无新字段", async () => {
    const result = await runNovelWorkspaceTest(1, single);
    expect(memory.calls.map(c => [c.step, c.modelPreference])).toEqual([
      ["review", "glm"],
      ["revise", "glm"],
    ]);
    expect(memory.calls[0].prompt).toBe(buildNovelReviewPrompt(single));
    expect(memory.calls[1].prompt).toBe(buildNovelRevisePrompt(single, validateNovelReview(REVISE_ORIGINAL, REVISE_REVIEW)));
    const value = JSON.parse(result.text);
    expect(Object.keys(value).sort()).toEqual(["chapterIndex", "models", "original", "review", "revised"]);
    const out = rowOf(L1).output;
    expect(out.reviseMode).toBeUndefined();
    expect(out.reviewSource).toBeUndefined();
  });
});
