/**
 * 配乐补退链路回归（终审 P1）：
 * 退款失败后必须真的回到队列 → 被正常 claim 领走 → 幂等补退成功；
 * 团队扣费的身份要原样带回去；重排写库失败必须抛错；补退全程不重扣、不再向上游 POST。
 *
 * 这里用一个「行为像调度器」的内存任务库：claim 只领 queued，重排真的把状态改回 queued，
 * 不再手动塞 claim 冒充恢复。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type JobRow = {
  id: string;
  userId: string;
  type: string;
  status: "queued" | "running" | "succeeded" | "failed";
  attempts: number;
  output: Record<string, unknown> | null;
  input: unknown;
  error?: string | null;
};

const store = vi.hoisted(() => ({
  job: null as unknown as JobRow,
  deduct: vi.fn(),
  refund: vi.fn(),
  fetch: vi.fn(),
  requeueCalls: [] as string[],
  requeueFails: 0,
}));

vi.mock("./repository", async (load) => {
  const actual = await load<Record<string, unknown>>();
  return {
    ...actual,
    // 调度器契约：只领 queued，领到就置 running 并 +1 尝试次数
    claimNextQueuedJob: vi.fn(async () => {
      const j = store.job;
      if (!j || j.status !== "queued") return null;
      j.status = "running";
      j.attempts += 1;
      return { ...j };
    }),
    getJobByIdStrict: vi.fn(async () => (store.job ? { ...store.job } : null)),
    patchJobRunningProgressStrict: vi.fn(async (_id: string, patch: Record<string, unknown>) => {
      store.job.output = { ...(store.job.output || {}), ...patch };
    }),
    markJobFailed: vi.fn(async (_id: string, error: string) => {
      store.job.status = "failed";
      store.job.error = error;
      return true;
    }),
    requeueJob: vi.fn(async () => {
      throw new Error("补退不该走通用 requeueJob");
    }),
    requeueManhuaBgmRefundStrict: vi.fn(async (id: string, error: string) => {
      store.requeueCalls.push(error);
      if (store.requeueFails > 0) {
        store.requeueFails -= 1;
        throw new Error("配乐退款重排未持久化，请人工核对原任务");
      }
      if (store.job.id !== id) throw new Error("id mismatch");
      store.job.status = "queued";
      store.job.error = error;
    }),
  };
});
vi.mock("../credits", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  getCredits: vi.fn(async () => ({ totalAvailable: 100 })),
  deductCreditsAmount: store.deduct,
  refundCreditsForDeductAmount: store.refund,
}));
vi.mock("../growth/growthWorkloadPriority", async (load) => ({
  ...(await load<Record<string, unknown>>()),
  beginGrowthInteractiveWorkload: vi.fn(async () => async () => {}),
}));

import { processJobsOnce } from "./runner";
import { buildManhuaBgmJobInput } from "./manhuaBgmJobInput";
import { buildManhuaBgmBrief } from "../../shared/manhuaBgmBrief";
import { readManhuaBgmPersistedDeduct } from "./manhuaBgmRecovery";

function seedJob(): JobRow {
  return {
    id: "bgm-refund",
    userId: "7",
    type: "audio",
    status: "queued",
    attempts: 0,
    output: null,
    input: buildManhuaBgmJobInput({
      billingRequestId: "33333333-4444-4555-8666-777777777777",
      brief: buildManhuaBgmBrief({ model: "suno-v6", laneZh: "测试", durationSec: 30, moods: ["蓄力"] }),
    }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("TTAPI_KEY", "test-key");
  vi.stubEnv("MANHUA_BGM_REFUND_RETRY_DELAY_MS", "0");
  vi.stubGlobal("fetch", store.fetch);
  store.job = seedJob();
  store.requeueCalls = [];
  store.requeueFails = 0;
  store.deduct.mockResolvedValue({ success: true, cost: 20, source: "personal", remainingBalance: 80 });
  store.refund.mockResolvedValue(undefined);
  // 上游明确拒单：钱该退
  store.fetch.mockResolvedValue(new Response("rejected", { status: 403 }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("配乐补退：失败→真实重排→正常领取→补退成功", () => {
  it("退款失败→真的回到队列→被正常 claim 领走→幂等补退成功，全程不重扣不重发", async () => {
    store.refund.mockRejectedValueOnce(new Error("db down"));
    // 调度器只领 queued：这一轮里第二次处理必然是先被重排回队列才发生的
    await processJobsOnce();
    expect(store.requeueCalls).toHaveLength(1);
    expect(store.requeueCalls[0]).toContain("退回尚未完成");
    expect(store.refund).toHaveBeenCalledTimes(2);
    expect(store.job.output?.bgmStage).toBe("refund_completed");
    expect(store.deduct).toHaveBeenCalledTimes(1);
    expect(store.fetch.mock.calls.filter((c) => (c[1] as { method?: string })?.method === "POST")).toHaveLength(1);
    for (const call of store.refund.mock.calls) {
      expect(call[4]).toMatchObject({ refundKey: "manhua-bgm-refund:bgm-refund" });
    }
  });

  it("团队扣费：teamId / teamMemberId 落盘并原样退回", async () => {
    store.deduct.mockResolvedValue({
      success: true, cost: 20, source: "team", remainingBalance: 500, teamId: 12, teamMemberId: 34,
    });
    store.refund.mockRejectedValueOnce(new Error("db down"));
    await processJobsOnce();
    expect(store.job.output?.bgmDeduct).toMatchObject({ source: "team", teamId: 12, teamMemberId: 34, cost: 20 });
    const last = store.refund.mock.calls.at(-1)!;
    expect(last[2]).toMatchObject({ source: "team", teamId: 12, teamMemberId: 34 });
  });

  it("团队凭据缺 teamId/teamMemberId：不落 refund_pending，直接转人工，不发一笔退不掉的补退", async () => {
    store.deduct.mockResolvedValue({ success: true, cost: 20, source: "team", remainingBalance: 500 });
    await processJobsOnce();
    expect(store.job.output?.bgmStage).not.toBe("refund_pending");
    expect(store.job.status).toBe("failed");
    expect(String(store.job.error)).toContain("凭据不完整");
    expect(store.refund).not.toHaveBeenCalled();
  });

  it("重排写库失败：不静默吞掉，任务落 failed 让人工接手", async () => {
    store.refund.mockRejectedValueOnce(new Error("db down"));
    store.requeueFails = 99;
    await processJobsOnce();
    expect(store.job.status).toBe("failed");
    expect(store.job.output?.bgmStage).toBe("refund_pending");
  });

  it("refund_completed 写库失败：下轮按同一退款键幂等补退，不重复扣费", { timeout: 30_000 }, async () => {
    const { patchJobRunningProgressStrict } = await import("./repository");
    (patchJobRunningProgressStrict as unknown as { mockImplementation: (f: unknown) => void }).mockImplementation(
      async (_id: string, patch: Record<string, unknown>) => {
        if (patch.bgmStage === "refund_completed") throw new Error("db write failed");
        store.job.output = { ...(store.job.output || {}), ...patch };
      },
    );
    await processJobsOnce();
    // 写不进完成态就一直留在待补退，用同一退款键反复补退，绝不重复扣费
    expect(store.job.output?.bgmStage).toBe("refund_pending");
    expect(store.refund.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(store.deduct).toHaveBeenCalledTimes(1);
    for (const call of store.refund.mock.calls) {
      expect(call[4]).toMatchObject({ refundKey: "manhua-bgm-refund:bgm-refund" });
    }
    expect(store.fetch.mock.calls.filter((c) => (c[1] as { method?: string })?.method === "POST")).toHaveLength(1);
  });

  it("重试用尽：不再承诺自动补退，改口人工核对", { timeout: 30_000 }, async () => {
    store.refund.mockRejectedValue(new Error("db down"));
    await processJobsOnce();
    expect(store.job.status).toBe("failed");
    expect(String(store.job.error)).toContain("人工核对");
    expect(String(store.job.error)).not.toContain("将只重试退款");
    expect(store.deduct).toHaveBeenCalledTimes(1);
  });
});

describe("落盘凭据解析（团队身份不全即判废）", () => {
  it("personal 通过；team 缺字段判废；坏值判废", () => {
    expect(readManhuaBgmPersistedDeduct({ success: true, cost: 20, source: "personal", remainingBalance: 80 }))
      .toEqual({ success: true, cost: 20, source: "personal", remainingBalance: 80 });
    expect(readManhuaBgmPersistedDeduct({ success: true, cost: 20, source: "team", remainingBalance: 1, teamId: 3, teamMemberId: 4 }))
      .toEqual({ success: true, cost: 20, source: "team", remainingBalance: 1, teamId: 3, teamMemberId: 4 });
    expect(readManhuaBgmPersistedDeduct({ success: true, cost: 20, source: "team", remainingBalance: 1 })).toBeNull();
    expect(readManhuaBgmPersistedDeduct({ success: true, cost: 20, source: "team", teamId: 0, teamMemberId: 4 })).toBeNull();
    expect(readManhuaBgmPersistedDeduct({ success: true, cost: 20, source: "admin" })).toBeNull();
    expect(readManhuaBgmPersistedDeduct({ success: false, cost: 20, source: "personal" })).toBeNull();
    expect(readManhuaBgmPersistedDeduct({ success: true, cost: 0, source: "personal" })).toBeNull();
    // 余额读不出来不判废，记 -1
    expect(readManhuaBgmPersistedDeduct({ success: true, cost: 20, source: "personal" })).toMatchObject({ remainingBalance: -1 });
  });
});
