import { describe, expect, it, vi } from "vitest";
import { runPaidManhuaAssemble, MANHUA_ASSEMBLE_LEDGER_TYPE, type ManhuaAssembleBillingDeps } from "./manhuaAssembleBilling.js";
import { CREDIT_COSTS } from "../plans.js";
import { CREDIT_COSTS as SHARED_COSTS } from "../../shared/plans.js";

function fixtures(source: "personal" | "team" | "admin" = "personal") {
  const deducted = { success: true, cost: source === "admin" ? 0 : CREDIT_COSTS.workflowFinalRender,
    remainingBalance: 100, source, ...(source === "team" ? { teamId: 3, teamMemberId: 9 } : {}) };
  const deps = {
    deduct: vi.fn(async () => deducted), refundDirect: vi.fn(async () => {}),
    readHold: vi.fn(async () => null), register: vi.fn(async () => {}), refund: vi.fn(async () => ({})),
  };
  const run = vi.fn(async () => ({ finalVideoUrl: "https://example.test/final.mp4" }));
  const execute = () => runPaidManhuaAssemble({ userId: 7, jobId: "job-7", run, deps: deps as unknown as ManhuaAssembleBillingDeps });
  return { deps, deducted, run, execute };
}

describe("合成任务同价计费与真实失败退款边界", () => {
  it.each(["personal", "team", "admin"] as const)("%s 同价扣款、原来源登记、成功不提前结算或退款", async source => {
    const f = fixtures(source); await expect(f.execute()).resolves.toEqual({ finalVideoUrl: "https://example.test/final.mp4" });
    expect(CREDIT_COSTS.workflowFinalRender).toBe(SHARED_COSTS.workflowFinalRender);
    expect(f.deps.deduct).toHaveBeenCalledWith(7, 5, "workflowFinalRender", "漫剧成片坞·最终合成", { chargeKey: "workflowStep/7/final_render/job-7" });
    expect(f.deps.register).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, jobId: "job-7", creditsBilled: f.deducted.cost, deduct: f.deducted, taskType: MANHUA_ASSEMBLE_LEDGER_TYPE }));
    expect(f.deps.register.mock.invocationCallOrder[0]).toBeLessThan(f.run.mock.invocationCallOrder[0]);
    expect(f.deps.refund).not.toHaveBeenCalled(); expect(f.deps.refundDirect).not.toHaveBeenCalled();
  });
  it("余额不足不登记、不渲染、不凭空退款", async () => {
    const f = fixtures(); f.deps.deduct.mockRejectedValue(new Error("积分不足"));
    await expect(f.execute()).rejects.toThrow("积分不足");
    expect(f.run).not.toHaveBeenCalled(); expect(f.deps.register).not.toHaveBeenCalled(); expect(f.deps.refund).not.toHaveBeenCalled();
  });
  it("账本登记失败在渲染前按实际团队扣款原路退回", async () => {
    const f = fixtures("team"); f.deps.register.mockRejectedValue(new Error("无法落盘"));
    await expect(f.execute()).rejects.toThrow("无法落盘"); expect(f.run).not.toHaveBeenCalled();
    expect(f.deps.refundDirect).toHaveBeenCalledWith(7, expect.any(String), f.deducted, "workflowFinalRenderRefund", { refundKey: "refund:workflowStep/7/final_render/job-7" });
  });
  it("渲染失败进入持久账本退款，退款失败不冒充成功", async () => {
    const f = fixtures(); f.run.mockRejectedValue(new Error("渲染失败"));
    await expect(f.execute()).rejects.toThrow("渲染失败");
    expect(f.deps.refund).toHaveBeenCalledWith("job-7", MANHUA_ASSEMBLE_LEDGER_TYPE, "task_failed", "合成失败·退回积分");
    f.deps.refund.mockRejectedValue(new Error("退款待恢复")); await expect(f.execute()).rejects.toThrow("退款待恢复");
  });
  it.each(["active", "settled", "refunded", "refund_pending"])("已有%s任务拒绝重排再渲染", async status => {
    const f = fixtures(); f.deps.readHold.mockResolvedValue({ status } as never);
    await expect(f.execute()).rejects.toThrow("已有执行记录");
    expect(f.deps.deduct).not.toHaveBeenCalled(); expect(f.run).not.toHaveBeenCalled();
  });
});
