import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 退分两阶段 + 对账补偿的崩溃窗口回归：
 *  - 旧实现「先标 refunded 再打款」，两步间崩溃 = 永久漏退（paidJobLedger.ts:433 旧行为）
 *  - 新实现停在 refund_pending 的 hold 由对账分支按 [refundKey:…] 查真账：
 *    查到只补状态（不双退），查不到补打款（不漏退），至多一次
 *  - resumable hold 不吃 forceAll / 心跳线（部署时退分+重启恢复交付=用户白拿），只兜 24h 硬底
 */

// 用例体内 await import 大模块，导入成本计入用例预算，全量并发下 5s 默认线会被踩爆
vi.setConfig({ testTimeout: 60_000 });

const refundCredits = vi.fn(async () => {});
const refundCreditsForDeductAmount = vi.fn(async () => {});
vi.mock("../credits", () => ({
  refundCredits: (...args: unknown[]) => refundCredits(...args),
  refundCreditsForDeductAmount: (...args: unknown[]) => refundCreditsForDeductAmount(...args),
}));

/** hasRefundMarker 的真账查询桩：markerRows 非空 = 账里已有这笔退分 */
let markerRows: Array<{ id: number }> = [];
let dbAvailable = true;
vi.mock("../db", () => ({
  getDb: async () => {
    if (!dbAvailable) return null;
    const limitChain = { limit: async () => markerRows };
    const whereChain = { where: () => limitChain };
    return { select: () => ({ from: () => whereChain }) };
  },
}));

describe("paidJobLedger refund_pending 对账", () => {
  let tempDir = "";
  const ORIGINAL_LEDGER_DIR = process.env.PAID_JOB_LEDGER_DIR;

  beforeEach(async () => {
    vi.resetModules();
    refundCredits.mockClear();
    refundCreditsForDeductAmount.mockClear();
    markerRows = [];
    dbAvailable = true;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "paid-ledger-test-"));
    process.env.PAID_JOB_LEDGER_DIR = tempDir;
  });

  afterEach(async () => {
    if (ORIGINAL_LEDGER_DIR) process.env.PAID_JOB_LEDGER_DIR = ORIGINAL_LEDGER_DIR;
    else delete process.env.PAID_JOB_LEDGER_DIR;
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function ledger() {
    return import("./paidJobLedger");
  }

  async function readHold(taskType: string, jobId: string) {
    const raw = await fs.readFile(path.join(tempDir, taskType, `${jobId}.json`), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  async function writeHold(taskType: string, jobId: string, hold: Record<string, unknown>) {
    const dir = path.join(tempDir, taskType);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, `${jobId}.json`), JSON.stringify(hold));
  }

  function baseHold(overrides: Record<string, unknown> = {}) {
    const now = new Date().toISOString();
    return {
      jobId: "job-1",
      taskType: "canvasVideo",
      userId: 7,
      creditsBilled: 388,
      action: "高清放大·2K（30s）",
      status: "active",
      chargedAt: now,
      lastHeartbeatAt: now,
      ...overrides,
    };
  }

  it("正常路径两阶段：active → refunded，打款恰一次且 reason 带 refundKey", async () => {
    const mod = await ledger();
    await mod.registerActiveJob({
      jobId: "job-1",
      taskType: "canvasVideo",
      userId: 7,
      creditsBilled: 388,
      action: "高清放大·2K（30s）",
    });
    const result = await mod.refundCreditsOnFailure("job-1", "canvasVideo", "task_failed", "上游失败");
    expect(result.refunded).toBe(true);
    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect(String(refundCredits.mock.calls[0][2])).toContain("[refundKey:canvasVideo/job-1]");
    const hold = await readHold("canvasVideo", "job-1");
    expect(hold.status).toBe("refunded");
    expect(hold.creditsRefunded).toBe(388);
    // 重复调用幂等 no-op
    const again = await mod.refundCreditsOnFailure("job-1", "canvasVideo", "task_failed");
    expect(again.refunded).toBe(false);
    expect(refundCredits).toHaveBeenCalledTimes(1);
  });

  it("崩溃窗口：hold 停在 refund_pending、账里已有 marker → 只补状态，不再打款", async () => {
    await writeHold("canvasVideo", "job-1", baseHold({ status: "refund_pending", refundReason: "task_failed" }));
    markerRows = [{ id: 1 }];
    const mod = await ledger();
    const result = await mod.refundCreditsOnFailure("job-1", "canvasVideo", "task_failed");
    expect(result.refunded).toBe(true);
    expect(refundCredits).toHaveBeenCalledTimes(0);
    const hold = await readHold("canvasVideo", "job-1");
    expect(hold.status).toBe("refunded");
  });

  it("崩溃窗口：refund_pending、账里没有 marker → 补打款恰一次", async () => {
    await writeHold("canvasVideo", "job-1", baseHold({ status: "refund_pending", refundReason: "task_timeout" }));
    markerRows = [];
    const mod = await ledger();
    const result = await mod.refundCreditsOnFailure("job-1", "canvasVideo", "task_timeout");
    expect(result.refunded).toBe(true);
    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect((await readHold("canvasVideo", "job-1")).status).toBe("refunded");
  });

  it("DB 不可用时保持 refund_pending，不盲退也不误标", async () => {
    await writeHold("canvasVideo", "job-1", baseHold({ status: "refund_pending" }));
    dbAvailable = false;
    const mod = await ledger();
    const result = await mod.refundCreditsOnFailure("job-1", "canvasVideo", "task_failed");
    expect(result.refunded).toBe(false);
    expect(result.status).toBe("refund_pending");
    expect(refundCredits).toHaveBeenCalledTimes(0);
    expect((await readHold("canvasVideo", "job-1")).status).toBe("refund_pending");
  });

  it("reaper 每轮清扫 refund_pending（对账入口不依赖再次失败回调）", async () => {
    await writeHold("canvasVideo", "job-1", baseHold({ status: "refund_pending", refundReason: "task_failed" }));
    markerRows = [];
    const mod = await ledger();
    const result = await mod.reapStuckPaidJobs({ staleMs: 5 * 60 * 1000 });
    expect(result.refunded).toBe(1);
    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect((await readHold("canvasVideo", "job-1")).status).toBe("refunded");
  });

  it("团队扣款的退分走同源退回（refundCreditsForDeductAmount），不误退个人余额", async () => {
    await writeHold(
      "canvasVideo",
      "job-1",
      baseHold({ deduct: { source: "team", teamId: 3, teamMemberId: 11 } }),
    );
    const mod = await ledger();
    await mod.refundCreditsOnFailure("job-1", "canvasVideo", "task_failed");
    expect(refundCreditsForDeductAmount).toHaveBeenCalledTimes(1);
    expect(refundCredits).toHaveBeenCalledTimes(0);
  });

  it("resumable hold：forceAll 与心跳线都不退，只兜 24h 硬底", async () => {
    const staleBeat = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 心跳停了 1 小时
    await writeHold(
      "canvasVideo",
      "job-live",
      baseHold({ jobId: "job-live", resumable: true, lastHeartbeatAt: staleBeat }),
    );
    const mod = await ledger();

    // 心跳线（默认 5 分钟）不碰 resumable
    await mod.reapStuckPaidJobs();
    expect(refundCredits).toHaveBeenCalledTimes(0);
    expect((await readHold("canvasVideo", "job-live")).status).toBe("active");

    // SIGTERM forceAll 也不碰（部署重启后任务会 resume 继续交付）
    await mod.reapStuckPaidJobs({ forceAll: true, reason: "deploy_killed" });
    expect(refundCredits).toHaveBeenCalledTimes(0);
    expect((await readHold("canvasVideo", "job-live")).status).toBe("active");

    // 超过 24h 硬底才退
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    await writeHold(
      "canvasVideo",
      "job-old",
      baseHold({ jobId: "job-old", resumable: true, chargedAt: old, lastHeartbeatAt: old }),
    );
    const result = await mod.reapStuckPaidJobs();
    expect(result.refunded).toBe(1);
    expect(refundCredits).toHaveBeenCalledTimes(1);
    expect((await readHold("canvasVideo", "job-old")).status).toBe("refunded");
    // 24h 内那条仍然安然无恙
    expect((await readHold("canvasVideo", "job-live")).status).toBe("active");
  });

  it("非 resumable hold 保持原行为：forceAll 全退（部署兜底语义不回归）", async () => {
    await writeHold("canvasVideo", "job-plain", baseHold({ jobId: "job-plain" }));
    const mod = await ledger();
    const result = await mod.reapStuckPaidJobs({ forceAll: true, reason: "deploy_killed" });
    expect(result.refunded).toBe(1);
    expect((await readHold("canvasVideo", "job-plain")).status).toBe("refunded");
  });
});
