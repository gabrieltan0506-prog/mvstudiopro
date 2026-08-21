import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startPaidJobLedgerReaper, type ReapResult } from "./paidJobLedger";

// ── promptEnhance 终态对账用桩(仅下方新 describe 使用;上方注入式测试不触发) ──
const refundCredits = vi.fn(async (..._a: unknown[]) => {});
const refundCreditsForDeductAmount = vi.fn(async (..._a: unknown[]) => {});
const refundChargeByKey = vi.fn(async (..._a: unknown[]) => ({ refunded: 3 }));
vi.mock("../credits", () => ({
  refundCredits: (...a: unknown[]) => refundCredits(...a),
  refundCreditsForDeductAmount: (...a: unknown[]) => refundCreditsForDeductAmount(...a),
  refundChargeByKey: (...a: unknown[]) => refundChargeByKey(...a),
}));

let markerRows: Array<{ id: number }> = [];
vi.mock("../db", () => ({
  getDb: async () => {
    const limitChain = { limit: async () => markerRows };
    const whereChain = { where: () => limitChain };
    return { select: () => ({ from: () => whereChain }) };
  },
}));

const getJobByIdStrict = vi.fn();
const markJobFailed = vi.fn(async (..._a: unknown[]) => {});
vi.mock("../jobs/repository.js", () => ({
  getJobByIdStrict: (...a: unknown[]) => getJobByIdStrict(...a),
  markJobFailed: (...a: unknown[]) => markJobFailed(...a),
}));

const listStalePromptEnhanceRunningJobs = vi.fn(
  async (..._a: unknown[]) => [] as Array<{ id: string; userId: string }>,
);
vi.mock("./promptEnhanceOperation.js", () => ({
  listStalePromptEnhanceRunningJobs: (...a: unknown[]) => listStalePromptEnhanceRunningJobs(...a),
}));

const EMPTY: ReapResult = { scanned: 0, refunded: 0, errors: 0, cancelled: 0 };

describe("paidJobLedger 常驻 reaper", () => {
  afterEach(() => vi.useRealTimers());

  it("启动立即扫一次，之后按周期补扫", async () => {
    vi.useFakeTimers();
    const reap = vi.fn(async () => EMPTY);
    const runner = startPaidJobLedgerReaper({ intervalMs: 60_000, reap });
    await Promise.resolve();
    expect(reap).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reap).toHaveBeenCalledTimes(2);
    runner.stop();
  });

  it("上一轮未结束时跳过重叠 tick，避免双重补退", async () => {
    vi.useFakeTimers();
    let release!: (value: ReapResult) => void;
    const pending = new Promise<ReapResult>((resolve) => { release = resolve; });
    const reap = vi.fn(() => pending);
    const runner = startPaidJobLedgerReaper({ runImmediately: false, reap });
    const first = runner.tick();
    expect(await runner.tick()).toBeNull();
    expect(reap).toHaveBeenCalledTimes(1);
    release(EMPTY);
    await expect(first).resolves.toEqual(EMPTY);
    runner.stop();
  });
});


describe("promptEnhance 任务记录与账本双向对账", () => {
  let tempDir = "";
  const ORIGINAL = process.env.PAID_JOB_LEDGER_DIR;
  const JOB_ID = "prompt_enhance_abc123";

  beforeEach(async () => {
    vi.resetModules();
    refundCredits.mockClear();
    refundCreditsForDeductAmount.mockClear();
    refundChargeByKey.mockClear();
    getJobByIdStrict.mockReset();
    markJobFailed.mockClear();
    listStalePromptEnhanceRunningJobs.mockReset();
    listStalePromptEnhanceRunningJobs.mockResolvedValue([]);
    markerRows = [];
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pe-ledger-test-"));
    process.env.PAID_JOB_LEDGER_DIR = tempDir;
  });

  afterEach(async () => {
    if (ORIGINAL) process.env.PAID_JOB_LEDGER_DIR = ORIGINAL;
    else delete process.env.PAID_JOB_LEDGER_DIR;
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function ledger() {
    return import("./paidJobLedger");
  }

  async function writeHold(status: string, over: Record<string, unknown> = {}) {
    const dir = path.join(tempDir, "promptEnhance");
    await fs.mkdir(dir, { recursive: true });
    const hold = {
      jobId: JOB_ID,
      taskType: "promptEnhance",
      userId: 7,
      creditsBilled: 3,
      action: "提示词语义增强(seedance-2.5)",
      status,
      chargedAt: new Date(Date.now() - 60_000).toISOString(),
      lastHeartbeatAt: new Date(Date.now() - 60_000).toISOString(),
      ...over,
    };
    await fs.writeFile(path.join(dir, `${JOB_ID}.json`), JSON.stringify(hold));
  }

  async function readHold(): Promise<{ status: string } | null> {
    try {
      return JSON.parse(
        await fs.readFile(path.join(tempDir, "promptEnhance", `${JOB_ID}.json`), "utf-8"),
      );
    } catch {
      return null;
    }
  }

  it("jobs=succeeded + hold=active:只补 settled,不退分", async () => {
    await writeHold("active", { lastHeartbeatAt: new Date(Date.now() - 3_600_000).toISOString() });
    getJobByIdStrict.mockResolvedValue({ id: JOB_ID, status: "succeeded" });
    const { reapStuckPaidJobs } = await ledger();
    await reapStuckPaidJobs();
    expect((await readHold())?.status).toBe("settled");
    expect(refundCredits).not.toHaveBeenCalled();
    expect(markJobFailed).not.toHaveBeenCalled();
  });

  it("jobs=succeeded + hold=settlement_pending:补 settled,不退分", async () => {
    await writeHold("settlement_pending");
    getJobByIdStrict.mockResolvedValue({ id: JOB_ID, status: "succeeded" });
    const { reapStuckPaidJobs } = await ledger();
    await reapStuckPaidJobs();
    expect((await readHold())?.status).toBe("settled");
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it("jobs=succeeded + hold=refund_pending:成功证据优先,补 settled 不进退分对账", async () => {
    await writeHold("refund_pending");
    getJobByIdStrict.mockResolvedValue({ id: JOB_ID, status: "succeeded" });
    const { reapStuckPaidJobs } = await ledger();
    await reapStuckPaidJobs();
    expect((await readHold())?.status).toBe("settled");
    expect(refundCredits).not.toHaveBeenCalled();
    expect(markJobFailed).not.toHaveBeenCalled();
  });

  it("成功证据查询失败(DB 不可用):跳过本轮,既不退分也不动 hold", async () => {
    await writeHold("active", { lastHeartbeatAt: new Date(Date.now() - 3_600_000).toISOString() });
    getJobByIdStrict.mockRejectedValue(new Error("Database unavailable"));
    const { reapStuckPaidJobs } = await ledger();
    await reapStuckPaidJobs();
    expect((await readHold())?.status).toBe("active");
    expect(refundCredits).not.toHaveBeenCalled();
  });

  it("jobs=running + hold 心跳过期:退分一次并把 jobs 补 failed(不永久停 running)", async () => {
    await writeHold("active", { lastHeartbeatAt: new Date(Date.now() - 3_600_000).toISOString() });
    getJobByIdStrict.mockResolvedValue({ id: JOB_ID, status: "running" });
    const { reapStuckPaidJobs } = await ledger();
    await reapStuckPaidJobs();
    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect((await readHold())?.status).toBe("refunded");
    expect(markJobFailed).toHaveBeenCalledWith(JOB_ID, "提示词增强未完成，积分已退回");
  });

  it("jobs=running + hold=refund_pending 且退分已在账:只补状态不双退,同步 jobs=failed", async () => {
    await writeHold("refund_pending");
    getJobByIdStrict.mockResolvedValue({ id: JOB_ID, status: "running" });
    markerRows = [{ id: 1 }]; // 真账里已有这笔退分
    const { reapStuckPaidJobs } = await ledger();
    await reapStuckPaidJobs();
    expect((await readHold())?.status).toBe("refunded");
    expect(refundCredits).not.toHaveBeenCalled();
    expect(markJobFailed).toHaveBeenCalledWith(JOB_ID, "提示词增强未完成，积分已退回");
  });

  it("jobs=running + hold 缺失且超时:按 chargeKey 原路退一次,jobs 标 failed", async () => {
    getJobByIdStrict.mockResolvedValue({ id: JOB_ID, status: "running" });
    listStalePromptEnhanceRunningJobs.mockResolvedValue([{ id: JOB_ID, userId: "7" }]);
    const { reapStuckPaidJobs } = await ledger();
    const result = await reapStuckPaidJobs();
    expect(refundChargeByKey).toHaveBeenCalledTimes(1);
    expect(refundChargeByKey.mock.calls[0][0]).toMatchObject({
      userId: 7,
      chargeKey: `promptEnhance/${JOB_ID}`,
      refundKey: `refund:[refundKey:promptEnhance/${JOB_ID}]`,
    });
    expect(markJobFailed).toHaveBeenCalledWith(JOB_ID, "提示词增强未完成，积分已退回");
    expect(result.refunded).toBe(1);
  });

  it("孤儿对账查不到扣分记录:refunded=0,仍把 jobs 标 failed", async () => {
    listStalePromptEnhanceRunningJobs.mockResolvedValue([{ id: JOB_ID, userId: "7" }]);
    refundChargeByKey.mockResolvedValueOnce({ refunded: 0 });
    const { reapStuckPaidJobs } = await ledger();
    const result = await reapStuckPaidJobs();
    expect(markJobFailed).toHaveBeenCalledWith(JOB_ID, "提示词增强未完成，积分已退回");
    expect(result.refunded).toBe(0);
  });

  it("hold 尚在时孤儿扫描不重复处理(交 hold 扫描)", async () => {
    await writeHold("active"); // 心跳新鲜:hold 扫描也不动它
    getJobByIdStrict.mockResolvedValue({ id: JOB_ID, status: "running" });
    listStalePromptEnhanceRunningJobs.mockResolvedValue([{ id: JOB_ID, userId: "7" }]);
    const { reapStuckPaidJobs } = await ledger();
    await reapStuckPaidJobs();
    expect(refundChargeByKey).not.toHaveBeenCalled();
    expect(refundCredits).not.toHaveBeenCalled();
  });
});
