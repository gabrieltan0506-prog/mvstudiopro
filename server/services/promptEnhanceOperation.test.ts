/**
 * 增强操作层回归:占位原子性(ON CONFLICT 单执行权)/指纹冲突拒绝/成功重放/
 * running-failed 终态分流/db 不可用抛错(不得折成"无旧任务")。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";

let dbAvailable = true;
let insertReturning: Array<{ id: string }> = [];
let selectRows: Array<{ id: string; userId: string }> = [];
const insertValues = vi.fn();
vi.mock("../db", () => ({
  getDb: async () => {
    if (!dbAvailable) return null;
    return {
      insert: () => ({
        values: (v: unknown) => {
          insertValues(v);
          return {
            onConflictDoNothing: () => ({ returning: async () => insertReturning }),
          };
        },
      }),
      select: () => ({ from: () => ({ where: async () => selectRows }) }),
    };
  },
}));

const getJobByIdStrict = vi.fn();
const markJobFailed = vi.fn(async () => {});
const markJobSucceededWithRetry = vi.fn(async () => true);
vi.mock("../jobs/repository.js", () => ({
  getJobByIdStrict: (...a: unknown[]) => getJobByIdStrict(...a),
  markJobFailed: (...a: unknown[]) => (markJobFailed as (...x: unknown[]) => Promise<void>)(...a),
  markJobSucceededWithRetry: (...a: unknown[]) =>
    (markJobSucceededWithRetry as (...x: unknown[]) => Promise<boolean>)(...a),
}));

import {
  listStalePromptEnhanceRunningJobs,
  markPromptEnhanceSucceededWithRetry,
  promptEnhanceOperationId,
  promptEnhanceRequestFingerprint,
  reservePromptEnhanceOperation,
} from "./promptEnhanceOperation";

const BASE = {
  userId: 7,
  billingRequestId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff",
  engine: "seedance-2.5" as const,
  prompt: "雨夜巷战",
};
const FP = promptEnhanceRequestFingerprint("seedance-2.5", "雨夜巷战");
const JOB_ID = promptEnhanceOperationId(7, BASE.billingRequestId);

const doneOutput = {
  action: "prompt_enhance_done",
  requestFingerprint: FP,
  enhancedPrompt: "增强后的提示词",
  issues: [],
  gateway: "bailian",
  engine: "seedance-2.5",
  creditsBilled: 3,
};

beforeEach(() => {
  dbAvailable = true;
  insertReturning = [{ id: JOB_ID }];
  selectRows = [];
  insertValues.mockClear();
  getJobByIdStrict.mockReset();
  markJobFailed.mockClear();
  markJobSucceededWithRetry.mockClear();
});

describe("promptEnhanceOperationId / requestFingerprint", () => {
  it("operationId 稳定且不可反查;不同 prompt/engine 指纹不同", () => {
    expect(JOB_ID).toMatch(/^prompt_enhance_[0-9a-f]{40}$/);
    expect(promptEnhanceOperationId(7, BASE.billingRequestId)).toBe(JOB_ID);
    expect(promptEnhanceRequestFingerprint("seedance-2.5", "别的")).not.toBe(FP);
    expect(promptEnhanceRequestFingerprint("minimax-hailuo-3", "雨夜巷战")).not.toBe(FP);
  });
});

describe("reservePromptEnhanceOperation", () => {
  it("插入成功=取得唯一执行权,占位记录含指纹与 running 状态", async () => {
    const r = await reservePromptEnhanceOperation(BASE);
    expect(r).toEqual({ kind: "execute", jobId: JOB_ID, requestFingerprint: FP });
    expect(insertValues.mock.calls[0][0]).toMatchObject({
      id: JOB_ID,
      userId: "7",
      type: "platform",
      provider: "glm",
      status: "running",
      input: { action: "prompt_enhance", requestFingerprint: FP, prompt: "雨夜巷战" },
      output: null,
      attempts: 1,
    });
    expect(getJobByIdStrict).not.toHaveBeenCalled();
  });

  it("并发同 requestId:ON CONFLICT 只放行一方 execute,另一方读回 running", async () => {
    // DB 主键唯一约束保证并发下只有一条 INSERT 带 RETURNING 行:
    // 赢家返回行 → execute;输家空返回 → 冲突路径读回 running
    getJobByIdStrict.mockResolvedValue({
      id: JOB_ID, status: "running", input: { requestFingerprint: FP }, output: null,
    });
    insertReturning = [{ id: JOB_ID }];
    const winner = await reservePromptEnhanceOperation(BASE);
    insertReturning = [];
    const loser = await reservePromptEnhanceOperation(BASE);
    expect(winner.kind).toBe("execute");
    expect(loser).toEqual({ kind: "running", jobId: JOB_ID });
    expect(insertValues).toHaveBeenCalledTimes(2); // 双方都尝试插入,执行权由 DB 判
  });

  it("同 requestId 不同 prompt → mismatch(路由回 BAD_REQUEST),不触发模型/扣分路径", async () => {
    insertReturning = [];
    getJobByIdStrict.mockResolvedValue({
      id: JOB_ID, status: "succeeded", input: { requestFingerprint: FP }, output: doneOutput,
    });
    const r = await reservePromptEnhanceOperation({ ...BASE, prompt: "换了内容" });
    expect(r).toEqual({ kind: "mismatch", jobId: JOB_ID });
  });

  it("同 requestId 不同 engine → mismatch", async () => {
    insertReturning = [];
    getJobByIdStrict.mockResolvedValue({
      id: JOB_ID, status: "running", input: { requestFingerprint: FP }, output: null,
    });
    const r = await reservePromptEnhanceOperation({ ...BASE, engine: "minimax-hailuo-3" });
    expect(r).toEqual({ kind: "mismatch", jobId: JOB_ID });
  });

  it("已成功且指纹相同 → replay 直接返回 jobs.output", async () => {
    insertReturning = [];
    getJobByIdStrict.mockResolvedValue({
      id: JOB_ID, status: "succeeded", input: { requestFingerprint: FP }, output: doneOutput,
    });
    const r = await reservePromptEnhanceOperation(BASE);
    expect(r.kind).toBe("replay");
    if (r.kind === "replay") {
      expect(r.result.enhancedPrompt).toBe("增强后的提示词");
      expect(r.result.creditsBilled).toBe(3);
    }
  });

  it("已成功但 output 非法 → 抛错,不返回伪结果", async () => {
    insertReturning = [];
    getJobByIdStrict.mockResolvedValue({
      id: JOB_ID, status: "succeeded", input: { requestFingerprint: FP }, output: { junk: 1 },
    });
    await expect(reservePromptEnhanceOperation(BASE)).rejects.toThrow(/invalid output/);
  });

  it("failed 终态 → 返回明确失败与错误信息", async () => {
    insertReturning = [];
    getJobByIdStrict.mockResolvedValue({
      id: JOB_ID, status: "failed", error: "上游超时", input: { requestFingerprint: FP }, output: null,
    });
    const r = await reservePromptEnhanceOperation(BASE);
    expect(r).toEqual({ kind: "failed", jobId: JOB_ID, message: "上游超时" });
  });

  it("db 不可用必须抛错,不得解释为没有旧任务", async () => {
    dbAvailable = false;
    await expect(reservePromptEnhanceOperation(BASE)).rejects.toThrow(/Database unavailable/);
  });

  it("冲突后 strict 查询失败也抛错(不折空)", async () => {
    insertReturning = [];
    getJobByIdStrict.mockRejectedValue(new Error("Database unavailable — cannot query job"));
    await expect(reservePromptEnhanceOperation(BASE)).rejects.toThrow(/Database unavailable/);
  });
});

describe("终态写入与孤儿扫描", () => {
  it("成功落库走通用终态重试:同参转发,不重调模型", async () => {
    const ok = await markPromptEnhanceSucceededWithRetry(JOB_ID, doneOutput as never);
    expect(ok).toBe(true);
    expect(markJobSucceededWithRetry).toHaveBeenCalledWith(JOB_ID, doneOutput);
  });

  it("孤儿扫描:db 不可用抛错;可用时按行映射返回", async () => {
    dbAvailable = false;
    await expect(listStalePromptEnhanceRunningJobs()).rejects.toThrow(/Database unavailable/);
    dbAvailable = true;
    selectRows = [{ id: JOB_ID, userId: "7" }];
    expect(await listStalePromptEnhanceRunningJobs()).toEqual([{ id: JOB_ID, userId: "7" }]);
  });
});
