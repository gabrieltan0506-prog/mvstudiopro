/**
 * R1 审查 1464-05：刷新恢复 effect 与本会话在途提交打架。
 * 包装层刚把意图标成 submitted、POST 还没到服务端，effect 去问 canvasIntentStatus 拿 404，
 * 修前把它判成 settled——在途提交的恢复线索被抹掉。
 */
import { describe, expect, it } from "vitest";
import {
  resolveCanvasIntentStatusReply,
  selectCanvasIntentRecoveryCandidates,
} from "./canvasIntentRecovery";

describe("恢复候选：只恢复持久化读回来的意图", () => {
  const blocks = [
    { id: "clip-e01-01", videoIntentId: "gi_a", videoIntentStatus: "submitted" as const },
    { id: "clip-e01-02", videoIntentId: "gi_b", videoIntentStatus: "unverified" as const },
    { id: "clip-e01-03", videoIntentId: "gi_c", videoIntentStatus: "acknowledged" as const },
    { id: "clip-e01-04", videoIntentId: "gi_d", videoIntentStatus: "settled" as const },
    { id: "clip-e01-05", videoIntentId: "gi_e", videoIntentStatus: "pending_submit" as const },
    { id: "clip-e01-06", videoIntentId: "gi_f", videoIntentStatus: "submitted" as const, videoTaskId: "cv_x" },
    { id: "clip-e01-07" },
  ];

  it("submitted / unverified / acknowledged 且无任务号 → 候选；settled / pending_submit / 已有任务号 → 不候选", () => {
    const out = selectCanvasIntentRecoveryCandidates(blocks, {
      sessionIntentIds: new Set(),
      queriedIntentIds: new Set(),
    });
    expect(out).toEqual([
      { blockId: "clip-e01-01", intentId: "gi_a" },
      { blockId: "clip-e01-02", intentId: "gi_b" },
      { blockId: "clip-e01-03", intentId: "gi_c" },
    ]);
  });

  it("**本会话自己在驱动的意图不恢复**（POST 在路上时问状态只会 404，不能据此判 settled）", () => {
    const out = selectCanvasIntentRecoveryCandidates(blocks, {
      sessionIntentIds: new Set(["gi_a"]),
      queriedIntentIds: new Set(),
    });
    expect(out.map((c) => c.intentId)).toEqual(["gi_b", "gi_c"]);
  });

  it("每个意图每次挂载只问一次：问过的不再进候选", () => {
    const out = selectCanvasIntentRecoveryCandidates(blocks, {
      sessionIntentIds: new Set(),
      queriedIntentIds: new Set(["gi_a", "gi_c"]),
    });
    expect(out.map((c) => c.intentId)).toEqual(["gi_b"]);
  });
});

describe("状态回包裁决", () => {
  it("404 intent_not_found → settle（作废不重发）", () => {
    expect(resolveCanvasIntentStatusReply(404, false, { ok: false, code: "intent_not_found" })).toEqual({
      kind: "settle",
    });
  });
  it("503 / 占位中 pending:true / 无 taskId / 非法回包 → keep（保持核实中）", () => {
    expect(resolveCanvasIntentStatusReply(503, false, { ok: false, code: "intent_unreadable" }).kind).toBe("keep");
    expect(resolveCanvasIntentStatusReply(200, true, { ok: true, pending: true }).kind).toBe("keep");
    expect(resolveCanvasIntentStatusReply(200, true, { ok: true, pending: false }).kind).toBe("keep");
    expect(resolveCanvasIntentStatusReply(200, true, {}).kind).toBe("keep");
    // 404 但不是 intent_not_found（比如路由不存在）也不能作废
    expect(resolveCanvasIntentStatusReply(404, false, { ok: false }).kind).toBe("keep");
  });
  it("已建单 → attach：接上 taskId，状态映射到任务轮询认得的四态", () => {
    expect(
      resolveCanvasIntentStatusReply(200, true, {
        ok: true,
        pending: false,
        taskId: "cv_abc",
        status: "queued",
        engine: "wan30-auto",
      }),
    ).toEqual({
      kind: "attach",
      patch: {
        videoTaskId: "cv_abc",
        videoTaskEngine: "wan30-auto",
        videoTaskStatus: "queued",
        videoIntentStatus: "acknowledged",
      },
    });
    const odd = resolveCanvasIntentStatusReply(200, true, { ok: true, pending: false, taskId: "cv_1", status: "timed_out_pending_reconcile" });
    expect(odd.kind === "attach" && odd.patch.videoTaskStatus).toBe("running");
  });
});
