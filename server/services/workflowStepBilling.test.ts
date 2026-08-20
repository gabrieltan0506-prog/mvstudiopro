import { describe, expect, it, vi } from "vitest";
import {
  runPaidWorkflowStep,
  workflowStepChargeKey,
  type WorkflowStepBillingDeps,
} from "./workflowStepBilling";
import type { deductCreditsAmount } from "../credits";

type Deducted = Awaited<ReturnType<typeof deductCreditsAmount>>;

/** 模拟 chargeKey 全局唯一索引:同键第二腿不再扣,返回首腿快照(与 deductCreditsAmount 真实语义一致) */
function memDeps(opts?: { source?: "personal" | "team" }) {
  const charges = new Map<string, Deducted>();
  let chargedTimes = 0;
  const refunds: Array<{ refundKey?: string; deduct: Deducted }> = [];
  const refundKeys = new Set<string>();
  const deps: WorkflowStepBillingDeps = {
    deduct: vi.fn(async (_userId, cost, _action, _desc, o) => {
      const key = String(o?.chargeKey || "");
      const prior = charges.get(key);
      if (prior) return prior;
      chargedTimes += 1;
      const snap = {
        success: true,
        cost,
        remainingBalance: 100,
        source: opts?.source || "personal",
        ...(opts?.source === "team" ? { teamId: 3, teamMemberId: 9 } : {}),
      } as Deducted;
      charges.set(key, snap);
      return snap;
    }) as WorkflowStepBillingDeps["deduct"],
    refund: vi.fn(async (_userId, _reason, deduct, _action, o) => {
      const key = String(o?.refundKey || "");
      if (refundKeys.has(key)) return; // refundKey 唯一索引:重复退款空转
      refundKeys.add(key);
      refunds.push({ refundKey: key, deduct });
    }) as WorkflowStepBillingDeps["refund"],
  };
  return { deps, refunds, chargedTimes: () => chargedTimes };
}

describe("workflowStepBilling · 服务端计费执行契约(七审 P0-1)", () => {
  it("成功执行:扣一次、绝不触发退款——用户拿到成片后没有任何退款路径", async () => {
    const m = memDeps();
    const out = await runPaidWorkflowStep({
      userId: 7,
      executionId: "job-1",
      step: "scene_image",
      totalCost: 35,
      description: "t",
      run: async () => "ok",
      deps: m.deps,
    });
    expect(out).toBe("ok");
    expect(m.chargedTimes()).toBe(1);
    expect(m.refunds.length).toBe(0);
  });

  it("真实失败:退一次且带 refundKey;同一执行重复失败只退一次", async () => {
    const m = memDeps();
    const attempt = () =>
      runPaidWorkflowStep({
        userId: 7,
        executionId: "job-2",
        step: "scene_video",
        totalCost: 88,
        description: "t",
        run: async () => {
          throw new Error("上游失败");
        },
        deps: m.deps,
      });
    await expect(attempt()).rejects.toThrow(/上游失败/);
    await expect(attempt()).rejects.toThrow(/上游失败/);
    expect(m.chargedTimes()).toBe(1); // 同 executionId 只扣一次
    expect(m.refunds.length).toBe(1); // refundKey 唯一,只退一次
    const expectedKey = `refund:${workflowStepChargeKey({ userId: 7, step: "scene_video", executionId: "job-2" })}`;
    expect(m.refunds[0].refundKey).toBe(expectedKey);
  });

  it("同 executionId 并发:chargeKey 唯一索引保证只扣一次", async () => {
    const m = memDeps();
    await Promise.all(
      [1, 2, 3].map(() =>
        runPaidWorkflowStep({
          userId: 7,
          executionId: "job-3",
          step: "music",
          totalCost: 10,
          description: "t",
          run: async () => "ok",
          deps: m.deps,
        }),
      ),
    );
    expect(m.chargedTimes()).toBe(1);
  });

  it("团队扣款失败:退款拿到原团队来源快照,原路退回团队额度", async () => {
    const m = memDeps({ source: "team" });
    await expect(
      runPaidWorkflowStep({
        userId: 7,
        executionId: "job-4",
        step: "final_render",
        totalCost: 20,
        description: "t",
        run: async () => {
          throw new Error("boom");
        },
        deps: m.deps,
      }),
    ).rejects.toThrow(/boom/);
    expect(m.refunds[0].deduct).toMatchObject({ source: "team", teamId: 3, teamMemberId: 9 });
  });

  it("executionId/userId 不合法:直接拒绝,不扣费", async () => {
    const m = memDeps();
    await expect(
      runPaidWorkflowStep({
        userId: 0,
        executionId: "x",
        step: "scene_image",
        totalCost: 1,
        description: "t",
        run: async () => "ok",
        deps: m.deps,
      }),
    ).rejects.toThrow(/invalid_user/);
    await expect(
      runPaidWorkflowStep({
        userId: 7,
        executionId: "",
        step: "scene_image",
        totalCost: 1,
        description: "t",
        run: async () => "ok",
        deps: m.deps,
      }),
    ).rejects.toThrow(/missing_execution_id/);
    expect(m.chargedTimes()).toBe(0);
  });
});
