import { beforeEach, describe, expect, it, vi } from "vitest";

let dbAvailable = true;
let insertReturning: Array<{ id: string }> = [];
let selectRows: Array<{ id: string; userId: string }> = [];
const insertValues = vi.fn();
const state = {
  status: "queued" as "queued" | "running" | "succeeded" | "failed",
  input: {} as Record<string, unknown>,
  output: null as unknown,
  error: null as string | null,
};

vi.mock("../db", () => ({
  getDb: async () => {
    if (!dbAvailable) return null;
    return {
      insert: () => ({
        values: (value: Record<string, unknown>) => {
          insertValues(value);
          return {
            onConflictDoNothing: () => ({ returning: async () => insertReturning }),
          };
        },
      }),
      update: () => ({
        set: (value: { status?: string; output?: unknown; error?: string | null }) => ({
          where: () => ({
            returning: async () => {
              if (value.status === "running") {
                if (state.status !== "queued") return [];
                state.status = "running";
              } else if (value.status === "succeeded") {
                if (state.status !== "running") return [];
                state.status = "succeeded";
              } else if (value.status === "failed") {
                if (state.status !== "running") return [];
                state.status = "failed";
              } else {
                const action =
                  state.output && typeof state.output === "object"
                    ? String((state.output as { action?: unknown }).action || "")
                    : "";
                if (
                  state.status !== "failed" ||
                  action !== "manhua_advisor_qa_refund_pending"
                ) {
                  return [];
                }
              }
              if ("output" in value) state.output = value.output;
              if ("error" in value) state.error = value.error ?? null;
              return [{ id: "changed" }];
            },
          }),
        }),
      }),
      select: () => ({ from: () => ({ where: async () => selectRows }) }),
    };
  },
}));

const getJobByIdStrict = vi.fn(async (_jobId: string) => ({
  id: "job",
  status: state.status,
  input: state.input,
  output: state.output,
  error: state.error,
}));
vi.mock("../jobs/repository.js", () => ({
  getJobByIdStrict: (jobId: string) => getJobByIdStrict(jobId),
}));

import {
  MANHUA_ADVISOR_DONE_ACTION,
  MANHUA_ADVISOR_REFUND_PENDING_ACTION,
  claimManhuaAdvisorRefundPending,
  listManhuaAdvisorRefundPendingJobs,
  listStaleManhuaAdvisorRunningJobs,
  manhuaAdvisorOperationId,
  manhuaAdvisorRequestFingerprint,
  markManhuaAdvisorRefundReconciled,
  markManhuaAdvisorSucceededWithRetry,
  reserveManhuaAdvisorOperation,
  withManhuaAdvisorHeartbeat,
} from "./manhuaAdvisorOperation";
import type { ManhuaCreativeAdvisorContext } from "../../shared/manhuaCreativeAdvisor";

const REQUEST_ID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const CONTEXT: ManhuaCreativeAdvisorContext = {
  seriesTitle: "墨菁传",
  episodeIndex: 1,
  episodeTitle: "黑奇入局",
  stage: "storyboard",
  videoModel: "seedance-2.5",
  writerConfirmed: true,
  episodeBody: "玄璃推门。",
  assetSummary: "黑奇已绑定。",
  shotSummary: "当前镜头为近景。",
  blockers: [],
};
const BASE = {
  userId: 7,
  requestId: REQUEST_ID,
  question: "【用户问题】这一镜怎么改？",
  rawQuestion: "这一镜怎么改？",
  qaModel: "gpt-5.6-terra",
  manhuaContext: CONTEXT,
};
const FP = manhuaAdvisorRequestFingerprint(BASE);
const RESULT = {
  success: true as const,
  answer: "缩短人物距离。",
  remainingFreeToday: 2,
  usedToday: 1,
  dailyLimit: 3,
  qaMode: "terra" as const,
  creditsCharged: 0,
  paidThisTurn: false,
  paidUnitCredits: 8,
  imageOffer: null,
};

beforeEach(() => {
  dbAvailable = true;
  insertReturning = [];
  selectRows = [];
  state.status = "queued";
  state.input = { requestFingerprint: FP };
  state.output = null;
  state.error = null;
  insertValues.mockClear();
  getJobByIdStrict.mockClear();
});

describe("manhuaAdvisorOperation", () => {
  it("operationId 对 user/request 稳定，指纹覆盖问题、模型与项目上下文", () => {
    expect(manhuaAdvisorOperationId(7, REQUEST_ID)).toMatch(/^manhua_advisor_[0-9a-f]{40}$/);
    expect(manhuaAdvisorOperationId(7, REQUEST_ID)).not.toBe(
      manhuaAdvisorOperationId(8, REQUEST_ID),
    );
    expect(manhuaAdvisorRequestFingerprint({ ...BASE, rawQuestion: "换一个问题" })).not.toBe(FP);
    expect(
      manhuaAdvisorRequestFingerprint({
        ...BASE,
        manhuaContext: { ...CONTEXT, episodeBody: "正文已修改。" },
      }),
    ).not.toBe(FP);
  });

  it("未确认请求只写 queued 占位，不保存正文且不取得执行权", async () => {
    insertReturning = [{ id: "inserted" }];
    const result = await reserveManhuaAdvisorOperation({ ...BASE, allowExecute: false });
    expect(result.kind).toBe("awaiting_confirmation");
    expect(insertValues).toHaveBeenCalledTimes(1);
    const inserted = insertValues.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(inserted.status).toBe("queued");
    expect(JSON.stringify(inserted)).not.toContain(CONTEXT.episodeBody);
    expect(JSON.stringify(inserted)).not.toContain(BASE.rawQuestion);
  });

  it("确认后只有 queued→running CAS 胜者取得执行权", async () => {
    const result = await reserveManhuaAdvisorOperation({ ...BASE, allowExecute: true });
    expect(result).toEqual({
      kind: "execute",
      jobId: manhuaAdvisorOperationId(7, REQUEST_ID),
      requestFingerprint: FP,
    });
    expect(state.status).toBe("running");
  });

  it("相同 requestId 绑定不同内容时 mismatch，不进入执行", async () => {
    const result = await reserveManhuaAdvisorOperation({
      ...BASE,
      rawQuestion: "不同内容",
      allowExecute: true,
    });
    expect(result.kind).toBe("mismatch");
    expect(state.status).toBe("queued");
  });

  it("成功终态回放完整结果并标 replayed，不再取得执行权", async () => {
    state.status = "succeeded";
    state.output = {
      action: MANHUA_ADVISOR_DONE_ACTION,
      requestFingerprint: FP,
      result: RESULT,
    };
    const result = await reserveManhuaAdvisorOperation({ ...BASE, allowExecute: false });
    expect(result).toMatchObject({ kind: "replay", result: { ...RESULT, replayed: true } });
  });

  it("退款待对账终态不会冒充失败已退款", async () => {
    state.status = "failed";
    state.error = "上游失败";
    state.output = { action: MANHUA_ADVISOR_REFUND_PENDING_ACTION };
    const result = await reserveManhuaAdvisorOperation({ ...BASE, allowExecute: false });
    expect(result).toEqual({
      kind: "refund_pending",
      jobId: manhuaAdvisorOperationId(7, REQUEST_ID),
      message: "上游失败",
    });
  });

  it("结果先以 running→succeeded CAS 持久化；已失败时不得覆盖", async () => {
    state.status = "running";
    await expect(
      markManhuaAdvisorSucceededWithRetry("job", FP, RESULT, { attempts: 1 }),
    ).resolves.toBe(true);
    expect(state.status).toBe("succeeded");
    expect(state.output).toMatchObject({
      action: MANHUA_ADVISOR_DONE_ACTION,
      requestFingerprint: FP,
      result: RESULT,
    });

    state.status = "failed";
    await expect(
      markManhuaAdvisorSucceededWithRetry("job", FP, RESULT, { attempts: 1 }),
    ).resolves.toBe(false);
    expect(state.status).toBe("failed");
  });

  it("失败先落 refund_pending，再以 CAS 标记对账完成", async () => {
    state.status = "running";
    await expect(claimManhuaAdvisorRefundPending("job", "模型失败")).resolves.toBe("failed");
    expect(state.status).toBe("failed");
    expect(state.output).toEqual({ action: MANHUA_ADVISOR_REFUND_PENDING_ACTION });
    await expect(markManhuaAdvisorRefundReconciled("job", 8)).resolves.toBe(true);
    expect(state.output).toEqual({
      action: "manhua_advisor_qa_refund_reconciled",
      creditsRefunded: 8,
    });
  });

  it("stale/refund_pending 扫描只返回 jobs 表候选；DB 不可用显式失败", async () => {
    selectRows = [{ id: "job-1", userId: "7" }];
    await expect(listStaleManhuaAdvisorRunningJobs()).resolves.toEqual(selectRows);
    await expect(listManhuaAdvisorRefundPendingJobs()).resolves.toEqual(selectRows);
    dbAvailable = false;
    await expect(listStaleManhuaAdvisorRunningJobs()).rejects.toThrow("Database unavailable");
  });

  it("心跳包装只执行一次 work，并在结束后停止定时器", async () => {
    vi.useFakeTimers();
    const heartbeat = vi.fn(async () => {});
    const work = vi.fn(async () => "done");
    await expect(
      withManhuaAdvisorHeartbeat("job", work, { intervalMs: 5_000, heartbeat }),
    ).resolves.toBe("done");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(work).toHaveBeenCalledTimes(1);
    expect(heartbeat).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
