import { describe, expect, it } from "vitest";
import { novelWorkspaceStateSchema } from "@shared/novelWorkspaceState";
import { REVISE_ORIGINAL, REVISE_REVIEW } from "@shared/novelRevise.fixture";
import {
  emptyNovelWorkspace,
  novelReviewCompareResults,
  parseNovelReviewCompareLane,
  parseNovelRevisionEntry,
  readNovelWorkspace,
  retryNovelReviewCompareLane,
  settleNovelReviewCompareLane,
  startNovelReviewCompare,
  type NovelReviewCompareEntry,
} from "./novelWorkspace";

const memoryStorage = (value: string) => ({ getItem: () => value });
const entry = (index = 2): NovelReviewCompareEntry => ({
  index,
  compareId: "c-1",
  createdAt: "2026-11-12T00:00:00.000Z",
  original: REVISE_ORIGINAL,
  lanes: [
    { lane: "glm", requestId: "r-1", status: "pending", submittedAt: "2026-11-12T00:00:00.000Z" },
    { lane: "deepseek", requestId: "r-2", status: "pending", submittedAt: "2026-11-12T00:00:00.000Z" },
  ],
});
const outcome = (verdict = REVISE_REVIEW.verdict) =>
  JSON.stringify({ chapterIndex: 3, original: REVISE_ORIGINAL, review: { ...REVISE_REVIEW, verdict }, models: { review: "z-ai/glm" } });

describe("多线路审稿对比：草稿状态", () => {
  it("旧草稿（没有 reviewCompares）照常读取", () => {
    const old = { ...emptyNovelWorkspace() } as Record<string, unknown>;
    delete old.reviewCompares;
    const { value } = readNovelWorkspace(memoryStorage(JSON.stringify(old)), "1");
    expect(value.reviewCompares).toBeUndefined();
  });
  it("新字段可保存可读回；坏的 outcome 不让整份草稿失败", () => {
    const draft = { ...emptyNovelWorkspace(), ...startNovelReviewCompare(emptyNovelWorkspace(), entry()) };
    const settled = { ...draft, ...settleNovelReviewCompareLane(draft, "r-1", { status: "succeeded", outcome: "{坏" }) };
    const back = novelWorkspaceStateSchema.parse(JSON.parse(JSON.stringify(settled)));
    expect(back.reviewCompares?.[0].lanes[0].status).toBe("succeeded");
    expect(parseNovelReviewCompareLane(back.reviewCompares![0].lanes[0])).toBeNull();
  });
  it("每集只保留最近一次对比；结果按 requestId 对号，晚到 / 重复的不覆盖", () => {
    let draft = { ...emptyNovelWorkspace(), ...startNovelReviewCompare(emptyNovelWorkspace(), entry(2)) };
    draft = { ...draft, ...startNovelReviewCompare(draft, entry(4)) };
    draft = { ...draft, ...startNovelReviewCompare(draft, { ...entry(2), compareId: "c-2" }) };
    expect(draft.reviewCompares!.map(c => [c.index, c.compareId])).toEqual([[4, "c-1"], [2, "c-2"]]);
    draft = { ...draft, ...settleNovelReviewCompareLane(draft, "r-1", { status: "succeeded", outcome: outcome("甲") }) };
    expect(settleNovelReviewCompareLane(draft, "r-1", { status: "failed", failure: "x" })).toEqual({});
    expect(settleNovelReviewCompareLane(draft, "not-there", { status: "failed", failure: "x" })).toEqual({});
    draft = { ...draft, ...settleNovelReviewCompareLane(draft, "r-2", { status: "failed", failure: "未完成" }) };
    const c = draft.reviewCompares!.find(x => x.compareId === "c-2")!;
    expect(c.lanes.map(l => l.status)).toEqual(["succeeded", "failed"]);
    expect(novelReviewCompareResults(c).map(r => [r.lane, r.requestId, r.review.verdict])).toEqual([["glm", "r-1", "甲"]]);
  });
  it("重试失败线路：换新 requestId、回到 pending，其他线路不动", () => {
    let draft = { ...emptyNovelWorkspace(), ...startNovelReviewCompare(emptyNovelWorkspace(), entry()) };
    draft = { ...draft, ...settleNovelReviewCompareLane(draft, "r-1", { status: "succeeded", outcome: outcome() }) };
    draft = { ...draft, ...settleNovelReviewCompareLane(draft, "r-2", { status: "failed", failure: "未完成" }) };
    draft = { ...draft, ...retryNovelReviewCompareLane(draft, "c-1", "deepseek", "r-3", "2026-11-12T01:00:00.000Z") };
    expect(draft.reviewCompares![0].lanes).toEqual([
      expect.objectContaining({ lane: "glm", requestId: "r-1", status: "succeeded" }),
      { lane: "deepseek", requestId: "r-3", status: "pending", submittedAt: "2026-11-12T01:00:00.000Z" },
    ]);
    // 成功的线路不能被「重试」
    expect(retryNovelReviewCompareLane(draft, "c-1", "glm", "r-4", "t").reviewCompares![0].lanes[0].requestId).toBe("r-1");
  });
  it("综合意见改稿的记录可读出来源；旧记录没有来源", () => {
    const rec = (extra: object) => ({
      index: 2, requestId: "x", savedAt: "t",
      outcome: JSON.stringify({ chapterIndex: 3, original: REVISE_ORIGINAL, review: REVISE_REVIEW, ...extra }),
    });
    expect(parseNovelRevisionEntry(rec({}))?.reviewOrigin).toBeUndefined();
    const origin = { kind: "combined", sources: [{ requestId: "11111111-1111-4111-8111-111111111111", lane: "glm" }] };
    expect(parseNovelRevisionEntry(rec({ reviewOrigin: origin }))?.reviewOrigin).toEqual(origin);
  });
});
