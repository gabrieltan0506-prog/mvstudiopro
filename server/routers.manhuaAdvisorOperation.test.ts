/**
 * 漫剧创作顾问路由回归：同一次提问以 requestId 贯穿确认、扣分、模型执行、
 * 结果持久化与退款对账；测试全程使用桩，不触发真实模型或积分账本。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 60_000 });

const askPlatformSkillQa = vi.fn();
const countPlatformSkillQaToday = vi.fn();
vi.mock("./services/platformSkillQa.js", () => ({
  askPlatformSkillQa: (...args: unknown[]) => askPlatformSkillQa(...args),
  countPlatformSkillQaToday: (...args: unknown[]) => countPlatformSkillQaToday(...args),
  resolveSkillQaBillingMode: () => "terra" as const,
}));

const reserveManhuaAdvisorOperation = vi.fn();
const claimManhuaAdvisorFailed = vi.fn();
const claimManhuaAdvisorRefundPending = vi.fn();
const markManhuaAdvisorRefundReconciled = vi.fn();
const markManhuaAdvisorSucceededWithRetry = vi.fn();
const withManhuaAdvisorHeartbeat = vi.fn(
  async (_jobId: string, work: () => Promise<unknown>) => work(),
);
vi.mock("./services/manhuaAdvisorOperation.js", () => ({
  MANHUA_ADVISOR_TASK_TYPE: "manhuaAdvisor",
  reserveManhuaAdvisorOperation: (...args: unknown[]) =>
    reserveManhuaAdvisorOperation(...args),
  claimManhuaAdvisorFailed: (...args: unknown[]) => claimManhuaAdvisorFailed(...args),
  claimManhuaAdvisorRefundPending: (...args: unknown[]) =>
    claimManhuaAdvisorRefundPending(...args),
  markManhuaAdvisorRefundReconciled: (...args: unknown[]) =>
    markManhuaAdvisorRefundReconciled(...args),
  markManhuaAdvisorSucceededWithRetry: (...args: unknown[]) =>
    markManhuaAdvisorSucceededWithRetry(...args),
  withManhuaAdvisorHeartbeat: (...args: unknown[]) =>
    (withManhuaAdvisorHeartbeat as unknown as (...values: unknown[]) => Promise<unknown>)(
      ...args,
    ),
}));

const getCredits = vi.fn();
const deductCreditsAmount = vi.fn();
const refundChargeByKey = vi.fn();
const refundCreditsForDeductAmount = vi.fn();
vi.mock("./credits", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCredits: (...args: unknown[]) => getCredits(...args),
  deductCreditsAmount: (...args: unknown[]) => deductCreditsAmount(...args),
  refundChargeByKey: (...args: unknown[]) => refundChargeByKey(...args),
  refundCreditsForDeductAmount: (...args: unknown[]) =>
    refundCreditsForDeductAmount(...args),
}));

vi.mock("./config/platformSwitches.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  resolvePlatformSkillQaPaidCredits: () => 8,
}));

const registerActiveJob = vi.fn();
const unregisterActiveJob = vi.fn();
const refundCreditsOnFailure = vi.fn();
const markSettlementPending = vi.fn();
vi.mock("./services/paidJobLedger.js", () => ({
  canonicalRefundKey: (taskType: string, jobId: string) =>
    `refund:[refundKey:${taskType}/${jobId}]`,
  refundMarkerFor: (taskType: string, jobId: string) =>
    `[refundKey:${taskType}/${jobId}]`,
  registerActiveJob: (...args: unknown[]) => registerActiveJob(...args),
  unregisterActiveJob: (...args: unknown[]) => unregisterActiveJob(...args),
  refundCreditsOnFailure: (...args: unknown[]) => refundCreditsOnFailure(...args),
  markSettlementPending: (...args: unknown[]) => markSettlementPending(...args),
}));

import { appRouter } from "./routers";

const REQUEST_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const JOB_ID = "manhua_advisor_job";
const FINGERPRINT = "request-fingerprint";
const CONTEXT = {
  seriesTitle: "墨菁传",
  episodeIndex: 1,
  episodeTitle: "黑奇入局",
  stage: "storyboard" as const,
  videoModel: "seedance-2.5",
  writerConfirmed: true,
  episodeBody: "玄璃推门，黑奇回头。",
  assetSummary: "黑奇角色图已绑定。",
  shotSummary: "当前选中近景镜头。",
  blockers: [],
};
const RESULT = {
  answer: "先把反应镜提前一拍。",
  remainingFreeToday: 0,
  usedToday: 4,
  dailyLimit: 3,
  qaMode: "terra" as const,
  creditsCharged: 8,
  paidThisTurn: true,
  paidUnitCredits: 8,
  imageOffer: null,
};
const INPUT = {
  question: "【当前问题】这一镜怎么改？\n【上下文】本集已确认。",
  rawQuestion: "这一镜怎么改？",
  qaModel: "gpt-5.6-terra" as const,
  requestId: REQUEST_ID,
  manhuaContext: CONTEXT,
};

const caller = () =>
  appRouter.createCaller({ user: { id: 7, role: "user" } } as never);

beforeEach(() => {
  vi.clearAllMocks();
  countPlatformSkillQaToday.mockResolvedValue(99);
  getCredits.mockResolvedValue({ totalAvailable: 100 });
  deductCreditsAmount.mockResolvedValue({
    success: true,
    cost: 8,
    remainingBalance: 92,
    source: "team",
    teamId: 12,
    teamMemberId: 34,
  });
  askPlatformSkillQa.mockResolvedValue(RESULT);
  claimManhuaAdvisorFailed.mockResolvedValue("failed");
  claimManhuaAdvisorRefundPending.mockResolvedValue("failed");
  markManhuaAdvisorRefundReconciled.mockResolvedValue(true);
  markManhuaAdvisorSucceededWithRetry.mockResolvedValue(true);
  registerActiveJob.mockResolvedValue(undefined);
  unregisterActiveJob.mockResolvedValue({ ok: true });
  refundCreditsOnFailure.mockResolvedValue({
    refunded: true,
    creditsRefunded: 8,
    status: "refunded",
  });
  refundChargeByKey.mockResolvedValue({ refunded: 8 });
  refundCreditsForDeductAmount.mockResolvedValue(undefined);
  markSettlementPending.mockResolvedValue(true);
  withManhuaAdvisorHeartbeat.mockImplementation(
    async (_jobId: string, work: () => Promise<unknown>) => work(),
  );
});

describe("askPlatformSkillQa · 漫剧顾问操作账本", () => {
  it("context 缺 requestId 在路由校验阶段拒绝，不建任务、不扣分", async () => {
    const { requestId: _requestId, ...missingId } = INPUT;
    await expect(caller().mvAnalysis.askPlatformSkillQa(missingId)).rejects.toMatchObject({
      code: "BAD_REQUEST",
    });
    expect(reserveManhuaAdvisorOperation).not.toHaveBeenCalled();
    expect(deductCreditsAmount).not.toHaveBeenCalled();
    expect(askPlatformSkillQa).not.toHaveBeenCalled();
  });

  it("成功终态在额度与余额检查前回放，不重复扣分或调用模型", async () => {
    reserveManhuaAdvisorOperation.mockResolvedValueOnce({
      kind: "replay",
      jobId: JOB_ID,
      result: { success: true, ...RESULT, replayed: true },
    });
    const result = await caller().mvAnalysis.askPlatformSkillQa(INPUT);
    expect(result).toMatchObject({ success: true, answer: RESULT.answer, replayed: true });
    expect(countPlatformSkillQaToday).not.toHaveBeenCalled();
    expect(getCredits).not.toHaveBeenCalled();
    expect(deductCreditsAmount).not.toHaveBeenCalled();
    expect(askPlatformSkillQa).not.toHaveBeenCalled();
  });

  it("付费未确认只保留 queued；随后同 requestId 确认可取得执行权", async () => {
    reserveManhuaAdvisorOperation.mockResolvedValueOnce({
      kind: "awaiting_confirmation",
      jobId: JOB_ID,
      requestFingerprint: FINGERPRINT,
    });
    const paymentError = await caller()
      .mvAnalysis.askPlatformSkillQa(INPUT)
      .catch((error: unknown) => error);
    expect(paymentError).toMatchObject({ code: "PAYMENT_REQUIRED" });
    expect((paymentError as Error).message).toContain("今日标准顾问免费");
    expect((paymentError as Error).message).toContain("8 积分/次");
    expect((paymentError as Error).message).not.toMatch(/Sol|Terra|成本\+60%/);
    expect(reserveManhuaAdvisorOperation).toHaveBeenCalledTimes(1);
    expect(reserveManhuaAdvisorOperation).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID, allowExecute: false }),
    );
    expect(claimManhuaAdvisorFailed).not.toHaveBeenCalled();
    expect(deductCreditsAmount).not.toHaveBeenCalled();

    reserveManhuaAdvisorOperation
      .mockResolvedValueOnce({
        kind: "awaiting_confirmation",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "execute",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      });
    const confirmed = await caller().mvAnalysis.askPlatformSkillQa({
      ...INPUT,
      confirmPaid: true,
    });
    expect(confirmed).toMatchObject({ success: true, answer: RESULT.answer });
    expect(reserveManhuaAdvisorOperation).toHaveBeenLastCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID, allowExecute: true }),
    );
    expect(deductCreditsAmount).toHaveBeenCalledTimes(1);
    expect(askPlatformSkillQa).toHaveBeenCalledTimes(1);
  });

  it("确认付费只执行一次：完整扣分回执入 hold，结果先持久化再结算", async () => {
    const order: string[] = [];
    reserveManhuaAdvisorOperation
      .mockResolvedValueOnce({
        kind: "awaiting_confirmation",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "execute",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      });
    askPlatformSkillQa.mockImplementationOnce(async () => {
      order.push("model");
      return RESULT;
    });
    markManhuaAdvisorSucceededWithRetry.mockImplementationOnce(async () => {
      order.push("persist-result");
      return true;
    });
    unregisterActiveJob.mockImplementationOnce(async () => {
      order.push("settle-hold");
      return { ok: true };
    });

    const result = await caller().mvAnalysis.askPlatformSkillQa({
      ...INPUT,
      confirmPaid: true,
    });
    expect(result).toMatchObject({ success: true, answer: RESULT.answer });
    expect(deductCreditsAmount).toHaveBeenCalledWith(
      7,
      8,
      "platformSkillQaTerra",
      expect.stringContaining("创作顾问问答"),
      { chargeKey: `manhuaAdvisor/${JOB_ID}` },
    );
    expect(registerActiveJob).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: JOB_ID,
        taskType: "manhuaAdvisor",
        creditsBilled: 8,
        deduct: expect.objectContaining({
          source: "team",
          teamId: 12,
          teamMemberId: 34,
        }),
      }),
    );
    expect(askPlatformSkillQa).toHaveBeenCalledTimes(1);
    expect(askPlatformSkillQa).toHaveBeenCalledWith(
      expect.objectContaining({
        rawQuestion: INPUT.rawQuestion,
        manhuaContext: CONTEXT,
        paidCreditsAlreadyCharged: 8,
      }),
    );
    expect(markManhuaAdvisorSucceededWithRetry).toHaveBeenCalledWith(
      JOB_ID,
      FINGERPRINT,
      expect.objectContaining({ success: true, answer: RESULT.answer }),
    );
    expect(order).toEqual(["model", "persist-result", "settle-hold"]);
  });

  it.each([
    ["running", "ADVISOR_OPERATION_RUNNING"],
    ["mismatch", "ADVISOR_OPERATION_MISMATCH"],
  ] as const)("%s 操作显式拒绝且不计费、不执行", async (kind, prefix) => {
    reserveManhuaAdvisorOperation.mockResolvedValueOnce({ kind, jobId: JOB_ID });
    await expect(caller().mvAnalysis.askPlatformSkillQa(INPUT)).rejects.toThrow(prefix);
    expect(countPlatformSkillQaToday).not.toHaveBeenCalled();
    expect(deductCreditsAmount).not.toHaveBeenCalled();
    expect(askPlatformSkillQa).not.toHaveBeenCalled();
  });

  it("历史失败回放不向前台暴露任务账本中的原始错误", async () => {
    reserveManhuaAdvisorOperation.mockResolvedValueOnce({
      kind: "failed",
      jobId: JOB_ID,
      message: "postgres connection refused at internal-host:5432",
    });
    const error = await caller()
      .mvAnalysis.askPlatformSkillQa(INPUT)
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(
      "ADVISOR_OPERATION_FAILED：本次问答未完成，请重新提问",
    );
    expect((error as Error).message).not.toContain("postgres");
    expect(countPlatformSkillQaToday).not.toHaveBeenCalled();
  });

  it("模型失败且退分暂时失败时保留 REFUND_PENDING，不谎称已退款", async () => {
    reserveManhuaAdvisorOperation
      .mockResolvedValueOnce({
        kind: "awaiting_confirmation",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "execute",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      });
    askPlatformSkillQa.mockRejectedValueOnce(new Error("上游暂时不可用"));
    refundCreditsOnFailure.mockRejectedValueOnce(new Error("退款账本暂时不可用"));
    const error = await caller()
      .mvAnalysis.askPlatformSkillQa({ ...INPUT, confirmPaid: true })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toContain("ADVISOR_OPERATION_REFUND_PENDING");
    expect((error as Error).message).not.toContain("上游暂时不可用");
    expect(claimManhuaAdvisorRefundPending).toHaveBeenCalledWith(
      JOB_ID,
      "顾问回答未完成，积分对账处理中",
    );
    expect(refundCreditsOnFailure).toHaveBeenCalledWith(
      JOB_ID,
      "manhuaAdvisor",
      "task_failed",
      "顾问回答未完成",
    );
    expect(markManhuaAdvisorRefundReconciled).not.toHaveBeenCalled();
    expect(askPlatformSkillQa).toHaveBeenCalledTimes(1);
  });

  it("扣分提交结果不确定时按固定 chargeKey 对账，成功后才关闭操作", async () => {
    reserveManhuaAdvisorOperation
      .mockResolvedValueOnce({
        kind: "awaiting_confirmation",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "execute",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      });
    deductCreditsAmount.mockRejectedValueOnce(new Error("扣分回执丢失"));
    refundChargeByKey.mockResolvedValueOnce({ refunded: 8 });
    const error = await caller()
      .mvAnalysis.askPlatformSkillQa({ ...INPUT, confirmPaid: true })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(
      "ADVISOR_OPERATION_FAILED：本次扣点未完成，请重新提问",
    );
    expect((error as Error).message).not.toContain("扣分回执丢失");
    expect(refundChargeByKey).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 7,
        chargeKey: `manhuaAdvisor/${JOB_ID}`,
        refundKey: `refund:[refundKey:manhuaAdvisor/${JOB_ID}]`,
      }),
    );
    expect(markManhuaAdvisorRefundReconciled).toHaveBeenCalledWith(JOB_ID, 8);
    expect(registerActiveJob).not.toHaveBeenCalled();
    expect(askPlatformSkillQa).not.toHaveBeenCalled();
  });

  it("任务登记失败只保存固定业务错误，原始异常不进入前台或退款原因", async () => {
    reserveManhuaAdvisorOperation
      .mockResolvedValueOnce({
        kind: "awaiting_confirmation",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "execute",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      });
    registerActiveJob.mockRejectedValueOnce(
      new Error("duplicate key value violates jobs_pkey"),
    );
    const error = await caller()
      .mvAnalysis.askPlatformSkillQa({ ...INPUT, confirmPaid: true })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(
      "ADVISOR_OPERATION_FAILED：本次问答未能开始，积分已原路退回，请重新提问",
    );
    expect((error as Error).message).not.toContain("duplicate key");
    expect(claimManhuaAdvisorRefundPending).toHaveBeenCalledWith(
      JOB_ID,
      "任务登记失败，积分对账处理中",
    );
    expect(refundCreditsForDeductAmount).toHaveBeenCalledTimes(1);
    expect(askPlatformSkillQa).not.toHaveBeenCalled();
  });

  it("上游已返回但结果持久化失败时不交付答案，完成原路退分", async () => {
    reserveManhuaAdvisorOperation
      .mockResolvedValueOnce({
        kind: "awaiting_confirmation",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "execute",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      });
    markManhuaAdvisorSucceededWithRetry.mockResolvedValueOnce(false);
    const error = await caller()
      .mvAnalysis.askPlatformSkillQa({ ...INPUT, confirmPaid: true })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(
      "ADVISOR_OPERATION_FAILED：本次问答未完成；积分已原路退回，请重新提问",
    );
    expect((error as Error).message).not.toContain("advisor_result_persist_failed");
    expect(askPlatformSkillQa).toHaveBeenCalledTimes(1);
    expect(claimManhuaAdvisorRefundPending).toHaveBeenCalledWith(
      JOB_ID,
      "顾问回答未完成，积分对账处理中",
    );
    expect(refundCreditsOnFailure).toHaveBeenCalledTimes(1);
    expect(unregisterActiveJob).not.toHaveBeenCalled();
  });

  it("失败收口与迟到成功竞争时以 succeeded 为准，回放结果且不退款", async () => {
    reserveManhuaAdvisorOperation
      .mockResolvedValueOnce({
        kind: "awaiting_confirmation",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "execute",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "replay",
        jobId: JOB_ID,
        result: { success: true, ...RESULT, replayed: true },
      });
    askPlatformSkillQa.mockRejectedValueOnce(new Error("当前 worker 连接已断"));
    claimManhuaAdvisorRefundPending.mockResolvedValueOnce("succeeded");
    const result = await caller().mvAnalysis.askPlatformSkillQa({
      ...INPUT,
      confirmPaid: true,
    });
    expect(result).toMatchObject({ success: true, replayed: true, answer: RESULT.answer });
    expect(refundCreditsOnFailure).not.toHaveBeenCalled();
    expect(refundChargeByKey).not.toHaveBeenCalled();
    expect(markManhuaAdvisorRefundReconciled).not.toHaveBeenCalled();
  });

  it("模型失败后只经原 hold 退款并收口 failed，保留原扣分来源快照", async () => {
    reserveManhuaAdvisorOperation
      .mockResolvedValueOnce({
        kind: "awaiting_confirmation",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      })
      .mockResolvedValueOnce({
        kind: "execute",
        jobId: JOB_ID,
        requestFingerprint: FINGERPRINT,
      });
    askPlatformSkillQa.mockRejectedValueOnce(new Error("模型未返回合法 JSON"));
    const error = await caller()
      .mvAnalysis.askPlatformSkillQa({ ...INPUT, confirmPaid: true })
      .catch((caught: unknown) => caught);
    expect((error as Error).message).toBe(
      "ADVISOR_OPERATION_FAILED：本次问答未完成；积分已原路退回，请重新提问",
    );
    expect((error as Error).message).not.toContain("模型未返回合法 JSON");
    expect(refundCreditsOnFailure).toHaveBeenCalledWith(
      JOB_ID,
      "manhuaAdvisor",
      "task_failed",
      "顾问回答未完成",
    );
    expect(refundChargeByKey).not.toHaveBeenCalled();
    expect(markManhuaAdvisorRefundReconciled).toHaveBeenCalledWith(JOB_ID, 8);
  });
});
