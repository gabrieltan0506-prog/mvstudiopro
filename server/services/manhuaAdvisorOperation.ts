/**
 * 漫剧创作顾问同步操作：复用 jobs 表提供请求认领、结果回放与退款对账状态。
 * jobs 只保存请求指纹，不保存原始剧本/上下文；完整项目资料仍只进入本次模型调用。
 */
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { jobs, type InsertJob } from "../../drizzle/schema";
import type { ManhuaCreativeAdvisorContext } from "../../shared/manhuaCreativeAdvisor.js";
import { getDb } from "../db";
import { getJobByIdStrict } from "../jobs/repository.js";
import type { PlatformSkillQaAskResult } from "./platformSkillQa.js";

export const MANHUA_ADVISOR_JOB_ACTION = "manhua_advisor_qa";
export const MANHUA_ADVISOR_DONE_ACTION = "manhua_advisor_qa_done";
export const MANHUA_ADVISOR_FAILED_ACTION = "manhua_advisor_qa_failed";
export const MANHUA_ADVISOR_REFUND_PENDING_ACTION = "manhua_advisor_qa_refund_pending";
export const MANHUA_ADVISOR_REFUND_RECONCILED_ACTION =
  "manhua_advisor_qa_refund_reconciled";
export const MANHUA_ADVISOR_STALE_MS = 10 * 60 * 1_000;
export const MANHUA_ADVISOR_TASK_TYPE = "manhuaAdvisor";

export type ManhuaAdvisorQaResponse = PlatformSkillQaAskResult & {
  success: true;
  /** jobs 成功终态回放；前端不得把它提示成一次新扣费。 */
  replayed?: true;
};

type StoredManhuaAdvisorOutput = {
  action: typeof MANHUA_ADVISOR_DONE_ACTION;
  requestFingerprint: string;
  result: ManhuaAdvisorQaResponse;
};

export type ReserveManhuaAdvisorResult =
  | { kind: "awaiting_confirmation"; jobId: string; requestFingerprint: string }
  | { kind: "execute"; jobId: string; requestFingerprint: string }
  | { kind: "replay"; jobId: string; result: ManhuaAdvisorQaResponse }
  | { kind: "running"; jobId: string }
  | { kind: "refund_pending"; jobId: string; message: string }
  | { kind: "failed"; jobId: string; message: string }
  | { kind: "mismatch"; jobId: string };

export type ManhuaAdvisorFailureClaim = "failed" | "succeeded" | "missing";

export function manhuaAdvisorOperationId(userId: number, requestId: string): string {
  const digest = createHash("sha256")
    .update(`${userId}:${requestId}`)
    .digest("hex")
    .slice(0, 40);
  return `manhua_advisor_${digest}`;
}

export function manhuaAdvisorRequestFingerprint(input: {
  question: string;
  rawQuestion: string;
  qaModel: string;
  manhuaContext: ManhuaCreativeAdvisorContext;
}): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.qaModel,
        input.question,
        input.rawQuestion,
        input.manhuaContext,
      ]),
    )
    .digest("hex");
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function outputAction(output: unknown): string {
  return String(objectValue(output)?.action || "");
}

function requestFingerprintFromInput(input: unknown): string {
  return String(objectValue(input)?.requestFingerprint || "");
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function parseStoredResponse(
  output: unknown,
  expectedFingerprint?: string,
): ManhuaAdvisorQaResponse | null {
  const stored = objectValue(output);
  if (stored?.action !== MANHUA_ADVISOR_DONE_ACTION) return null;
  if (
    expectedFingerprint &&
    String(stored.requestFingerprint || "") !== expectedFingerprint
  ) {
    return null;
  }
  const result = objectValue(stored.result);
  if (!result || result.success !== true || typeof result.answer !== "string" || !result.answer) {
    return null;
  }
  if (result.qaMode !== "sol" && result.qaMode !== "terra") return null;
  if (typeof result.paidThisTurn !== "boolean" || result.imageOffer !== null) return null;
  const remainingFreeToday = finiteNumber(result.remainingFreeToday);
  const usedToday = finiteNumber(result.usedToday);
  const dailyLimit = finiteNumber(result.dailyLimit);
  const creditsCharged = finiteNumber(result.creditsCharged);
  const paidUnitCredits = finiteNumber(result.paidUnitCredits);
  if (
    remainingFreeToday === null ||
    usedToday === null ||
    dailyLimit === null ||
    creditsCharged === null ||
    paidUnitCredits === null
  ) {
    return null;
  }
  return {
    success: true,
    answer: result.answer,
    remainingFreeToday,
    usedToday,
    dailyLimit,
    qaMode: result.qaMode,
    creditsCharged,
    paidThisTurn: result.paidThisTurn,
    paidUnitCredits,
    imageOffer: null,
  };
}

async function classifyExistingOperation(
  jobId: string,
  requestFingerprint: string,
): Promise<ReserveManhuaAdvisorResult> {
  const existing = await getJobByIdStrict(jobId);
  if (!existing) throw new Error(`manhua advisor operation vanished: ${jobId}`);
  if (requestFingerprintFromInput(existing.input) !== requestFingerprint) {
    return { kind: "mismatch", jobId };
  }
  if (existing.status === "succeeded") {
    const result = parseStoredResponse(existing.output, requestFingerprint);
    if (!result) throw new Error(`manhua advisor succeeded output invalid: ${jobId}`);
    return { kind: "replay", jobId, result: { ...result, replayed: true } };
  }
  if (existing.status === "failed") {
    if (outputAction(existing.output) === MANHUA_ADVISOR_REFUND_PENDING_ACTION) {
      return {
        kind: "refund_pending",
        jobId,
        message: String(existing.error || "积分对账尚未完成"),
      };
    }
    return {
      kind: "failed",
      jobId,
      message: String(existing.error || "该次顾问问答未完成"),
    };
  }
  if (existing.status === "queued") {
    return { kind: "awaiting_confirmation", jobId, requestFingerprint };
  }
  return { kind: "running", jobId };
}

/**
 * 首次调用以 queued 占位；付费确认通过后再用 CAS 晋升 running。
 * 因此 confirmPaid=false 不会留下阻止随后确认的 failed 终态。
 */
export async function reserveManhuaAdvisorOperation(input: {
  userId: number;
  requestId: string;
  question: string;
  rawQuestion: string;
  qaModel: string;
  manhuaContext: ManhuaCreativeAdvisorContext;
  allowExecute: boolean;
}): Promise<ReserveManhuaAdvisorResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot reserve manhua advisor operation");
  const jobId = manhuaAdvisorOperationId(input.userId, input.requestId);
  const requestFingerprint = manhuaAdvisorRequestFingerprint(input);
  const values: InsertJob = {
    id: jobId,
    userId: String(input.userId),
    type: "platform",
    provider: "openai",
    status: "queued",
    input: {
      action: MANHUA_ADVISOR_JOB_ACTION,
      requestId: input.requestId,
      requestFingerprint,
      qaModel: input.qaModel,
    } as InsertJob["input"],
    output: null,
    attempts: 0,
  };
  const inserted = await db
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: jobs.id })
    .returning({ id: jobs.id });

  if (inserted.length === 0) {
    const existing = await classifyExistingOperation(jobId, requestFingerprint);
    if (existing.kind !== "awaiting_confirmation" || !input.allowExecute) return existing;
  } else if (!input.allowExecute) {
    return { kind: "awaiting_confirmation", jobId, requestFingerprint };
  }

  const promoted = await db
    .update(jobs)
    .set({ status: "running", attempts: 1, updatedAt: new Date() })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "queued"),
        sql`${jobs.input}->>'action' = ${MANHUA_ADVISOR_JOB_ACTION}`,
      ),
    )
    .returning({ id: jobs.id });
  if (promoted.length > 0) return { kind: "execute", jobId, requestFingerprint };
  return classifyExistingOperation(jobId, requestFingerprint);
}

export async function markManhuaAdvisorSucceededWithRetry(
  jobId: string,
  requestFingerprint: string,
  result: ManhuaAdvisorQaResponse,
  options?: { attempts?: number; delayMs?: number },
): Promise<boolean> {
  const attempts = Math.max(1, Math.min(6, Math.floor(options?.attempts ?? 4)));
  const delayMs = Math.max(0, Math.min(5_000, Math.floor(options?.delayMs ?? 250)));
  const output: StoredManhuaAdvisorOutput = {
    action: MANHUA_ADVISOR_DONE_ACTION,
    requestFingerprint,
    result: { ...result, replayed: undefined },
  };
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const db = await getDb();
    if (db) {
      try {
        const changed = await db
          .update(jobs)
          .set({ status: "succeeded", output, error: null, updatedAt: new Date() })
          .where(
            and(
              eq(jobs.id, jobId),
              eq(jobs.status, "running"),
              sql`${jobs.input}->>'action' = ${MANHUA_ADVISOR_JOB_ACTION}`,
            ),
          )
          .returning({ id: jobs.id });
        if (changed.length > 0) return true;
        const existing = await getJobByIdStrict(jobId);
        if (existing?.status === "succeeded") {
          return (
            requestFingerprintFromInput(existing.input) === requestFingerprint &&
            parseStoredResponse(existing.output, requestFingerprint) !== null
          );
        }
        if (existing?.status === "failed") return false;
      } catch {
        // 只重试结果持久化，绝不重调模型。
      }
    }
    if (attempt < attempts && delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  return false;
}

export async function claimManhuaAdvisorFailed(
  jobId: string,
  message: string,
): Promise<ManhuaAdvisorFailureClaim> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot close manhua advisor operation");
  const changed = await db
    .update(jobs)
    .set({
      status: "failed",
      error: String(message || "顾问问答未完成").slice(0, 2_000),
      output: { action: MANHUA_ADVISOR_FAILED_ACTION } as InsertJob["output"],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        sql`${jobs.input}->>'action' = ${MANHUA_ADVISOR_JOB_ACTION}`,
      ),
    )
    .returning({ id: jobs.id });
  if (changed.length > 0) return "failed";
  const existing = await getJobByIdStrict(jobId);
  if (!existing) return "missing";
  if (existing.status === "succeeded") return "succeeded";
  if (existing.status === "failed") return "failed";
  return "missing";
}

export async function claimManhuaAdvisorRefundPending(
  jobId: string,
  message: string,
): Promise<ManhuaAdvisorFailureClaim> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot mark advisor refund pending");
  const changed = await db
    .update(jobs)
    .set({
      status: "failed",
      error: String(message || "顾问问答未完成，积分对账处理中").slice(0, 2_000),
      output: { action: MANHUA_ADVISOR_REFUND_PENDING_ACTION } as InsertJob["output"],
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        sql`${jobs.input}->>'action' = ${MANHUA_ADVISOR_JOB_ACTION}`,
      ),
    )
    .returning({ id: jobs.id });
  if (changed.length > 0) return "failed";
  const existing = await getJobByIdStrict(jobId);
  if (!existing) return "missing";
  if (existing.status === "succeeded") return "succeeded";
  if (
    existing.status === "failed" &&
    outputAction(existing.output) === MANHUA_ADVISOR_REFUND_PENDING_ACTION
  ) {
    return "failed";
  }
  return "missing";
}

export async function markManhuaAdvisorRefundReconciled(
  jobId: string,
  creditsRefunded: number,
): Promise<boolean> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot finish advisor refund reconciliation");
  const changed = await db
    .update(jobs)
    .set({
      output: {
        action: MANHUA_ADVISOR_REFUND_RECONCILED_ACTION,
        creditsRefunded,
      } as InsertJob["output"],
      error: "创作顾问问答未完成，积分对账已完成",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "failed"),
        sql`${jobs.output}->>'action' = ${MANHUA_ADVISOR_REFUND_PENDING_ACTION}`,
      ),
    )
    .returning({ id: jobs.id });
  if (changed.length > 0) return true;
  const existing = await getJobByIdStrict(jobId);
  return (
    existing?.status === "failed" &&
    outputAction(existing.output) === MANHUA_ADVISOR_REFUND_RECONCILED_ACTION
  );
}

export async function listStaleManhuaAdvisorRunningJobs(options?: {
  staleMs?: number;
  now?: number;
}): Promise<Array<{ id: string; userId: string }>> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot scan advisor jobs");
  const staleMs = Math.max(60_000, Math.floor(options?.staleMs ?? MANHUA_ADVISOR_STALE_MS));
  const cutoff = new Date((options?.now ?? Date.now()) - staleMs);
  const rows = await db
    .select({ id: jobs.id, userId: jobs.userId })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "platform"),
        eq(jobs.status, "running"),
        sql`${jobs.input}->>'action' = ${MANHUA_ADVISOR_JOB_ACTION}`,
        lt(jobs.updatedAt, cutoff),
      ),
    );
  return rows.map((row) => ({ id: String(row.id), userId: String(row.userId) }));
}

export async function listManhuaAdvisorRefundPendingJobs(): Promise<
  Array<{ id: string; userId: string }>
> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot scan advisor refund pending jobs");
  const rows = await db
    .select({ id: jobs.id, userId: jobs.userId })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "platform"),
        eq(jobs.status, "failed"),
        sql`${jobs.input}->>'action' = ${MANHUA_ADVISOR_JOB_ACTION}`,
        sql`${jobs.output}->>'action' = ${MANHUA_ADVISOR_REFUND_PENDING_ACTION}`,
      ),
    );
  return rows.map((row) => ({ id: String(row.id), userId: String(row.userId) }));
}

export async function withManhuaAdvisorHeartbeat<T>(
  jobId: string,
  work: () => Promise<T>,
  options?: { intervalMs?: number; heartbeat?: (jobId: string) => Promise<void> },
): Promise<T> {
  const intervalMs = Math.max(5_000, Math.floor(options?.intervalMs ?? 60_000));
  const heartbeat =
    options?.heartbeat ??
    (async (id: string) => {
      const { heartbeatActiveJob } = await import("./paidJobLedger.js");
      await heartbeatActiveJob(id, MANHUA_ADVISOR_TASK_TYPE);
    });
  const timer = setInterval(() => void heartbeat(jobId).catch(() => {}), intervalMs);
  (timer as { unref?: () => void }).unref?.();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}
