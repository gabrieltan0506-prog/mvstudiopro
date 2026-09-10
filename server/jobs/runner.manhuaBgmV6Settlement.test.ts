import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  job: null as any,
  claim: vi.fn(), patch: vi.fn(), failed: vi.fn(), requeue: vi.fn(),
  deduct: vi.fn(), refund: vi.fn(), fetch: vi.fn(),
}));
vi.mock("./repository", async load => ({
  ...await load<Record<string, unknown>>(),
  claimNextQueuedJob: state.claim,
  getJobByIdStrict: vi.fn(async () => state.job),
  patchJobRunningProgressStrict: state.patch,
  markJobFailed: state.failed,
  requeueJob: state.requeue,
}));
vi.mock("../credits", async load => ({
  ...await load<Record<string, unknown>>(),
  getCredits: vi.fn(async () => ({ totalAvailable: 100 })),
  deductCreditsAmount: state.deduct,
  refundCreditsForDeductAmount: state.refund,
}));
vi.mock("../growth/growthWorkloadPriority", async load => ({
  ...await load<Record<string, unknown>>(),
  beginGrowthInteractiveWorkload: vi.fn(async () => async () => {}),
}));

import { processJobsOnce } from "./runner";
import { buildManhuaBgmJobInput } from "./manhuaBgmJobInput";
import { buildManhuaBgmBrief } from "../../shared/manhuaBgmBrief";

describe("配乐 v6（TTAPI）真实 worker 控制流：未知建单不退不重发", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("TTAPI_KEY", "test-key");
    vi.stubGlobal("fetch", state.fetch);
    state.job = {
      id: "bgm-test", userId: "7", type: "audio", status: "running", attempts: 1,
      output: null,
      input: buildManhuaBgmJobInput({
        billingRequestId: "11111111-2222-4333-8444-555555555555",
        brief: buildManhuaBgmBrief({ model: "suno-v6", laneZh: "测试", durationSec: 30, moods: ["蓄力"] }),
      }),
    };
    state.claim.mockResolvedValueOnce(state.job).mockResolvedValue(null);
    state.patch.mockImplementation(async (_id, patch) => { state.job.output = { ...state.job.output, ...patch }; });
    state.deduct.mockResolvedValue({ success: true, cost: 20, source: "personal", remainingBalance: 80 });
    state.refund.mockResolvedValue(undefined);
    state.failed.mockResolvedValue(true);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  it.each(["network", "502", "invalid_json", "no_job_id"])("%s 结果不明：只POST一次，保留对账且不退款", async kind => {
    state.fetch.mockImplementation(async () => {
      expect(state.job.output.bgmStage).toBe("submitting");
      if (kind === "network") throw new Error("test-secret-do-not-leak");
      if (kind === "502") return new Response("test-secret-do-not-leak", { status: 502 });
      if (kind === "invalid_json") return new Response("test-secret-do-not-leak", { status: 200 });
      return new Response(JSON.stringify({ status: "SUCCESS", data: {} }), { status: 200 });
    });
    await processJobsOnce();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.fetch.mock.calls[0][1].method).toBe("POST");
    expect(state.refund).not.toHaveBeenCalled();
    expect(state.requeue).not.toHaveBeenCalled();
    expect(state.job.output.bgmStage).toBe("reconcile_manual");
    expect(JSON.stringify(state.failed.mock.calls)).not.toContain("test-secret");
    // 即使该旧任务被再次交给 worker，已有对账检查点也不能重新购买。
    state.claim.mockResolvedValueOnce(state.job).mockResolvedValue(null);
    await processJobsOnce();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.deduct).toHaveBeenCalledTimes(1);
    expect(state.refund).not.toHaveBeenCalled();
  });

  it("明确403拒绝仅按实际扣费来源退款，响应正文不入失败信息", async () => {
    state.fetch.mockResolvedValue(new Response("test-secret-do-not-leak", { status: 403 }));
    await processJobsOnce();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.refund).toHaveBeenCalledTimes(1);
    expect(state.refund.mock.calls[0]).toEqual([
      7, "配乐建单失败退回", { success: true, cost: 20, source: "personal", remainingBalance: 80 },
      "manhuaBgm", { refundKey: "manhua-bgm-refund:bgm-test" },
    ]);
    expect(state.requeue).not.toHaveBeenCalled();
    expect(JSON.stringify(state.failed.mock.calls)).not.toContain("test-secret");
  });

  it("对账检查点写入失败仍不退款，已有提交意图阻止第二次POST", async () => {
    state.patch.mockImplementation(async (_id, patch) => {
      if (patch.bgmStage === "reconcile_manual") throw new Error("测试数据库写入失败");
      state.job.output = { ...state.job.output, ...patch };
    });
    state.fetch.mockRejectedValue(new Error("test-secret-do-not-leak"));
    await processJobsOnce();
    expect(state.job.output.bgmStage).toBe("submitting");
    expect(state.refund).not.toHaveBeenCalled();
    state.claim.mockResolvedValueOnce(state.job).mockResolvedValue(null);
    await processJobsOnce();
    expect(state.fetch).toHaveBeenCalledTimes(1);
    expect(state.deduct).toHaveBeenCalledTimes(1);
    expect(state.requeue).not.toHaveBeenCalled();
  });
});

/**
 * 退款一致性（真实重排 / 团队身份 / 幂等补退 / 重试用尽）已移到
 * `manhuaBgmRefundRecovery.test.ts`：那里用「只领 queued」的内存调度器，
 * 不再手动塞 claim 冒充恢复；库层的严格重排与启动恢复见 `manhuaBgmRefundStartup.test.ts`。
 */
