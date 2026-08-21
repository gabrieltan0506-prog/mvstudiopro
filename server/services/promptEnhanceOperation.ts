/**
 * 提示词语义增强·持久化操作层:请求幂等 + 结果恢复 + 终态对账的唯一入口。
 * 占位用 jobs 表主键 INSERT … ON CONFLICT DO NOTHING RETURNING(禁止先查再插:
 * 并发请求会同时取得执行权);同 billingRequestId 重放从 jobs.output 恢复,
 * 不重调模型不重复扣分。数据库不可用一律抛错,不得解释为"没有旧任务"。
 */
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { jobs, type InsertJob } from "../../drizzle/schema";
import { getDb } from "../db";
import { getJobByIdStrict } from "../jobs/repository.js";
import type { CompilerEngineId } from "../../shared/manhuaShotIR.js";
import type { FormatIssue } from "../../shared/promptFormatLayer.js";

export const PROMPT_ENHANCE_JOB_ACTION = "prompt_enhance";
export const PROMPT_ENHANCE_DONE_ACTION = "prompt_enhance_done";
/** jobs=running 且 hold 缺失的孤儿判定线:超过该时限视为处理失败,进对账退分 */
export const PROMPT_ENHANCE_STALE_MS = 10 * 60 * 1000;

export type PromptEnhanceResponse = {
  action: typeof PROMPT_ENHANCE_DONE_ACTION;
  requestFingerprint: string;
  enhancedPrompt: string;
  issues: FormatIssue[];
  gateway: string;
  engine: CompilerEngineId;
  creditsBilled: number;
};

export function promptEnhanceOperationId(userId: number, billingRequestId: string): string {
  const digest = createHash("sha256")
    .update(`${userId}:${billingRequestId}`)
    .digest("hex")
    .slice(0, 40);
  return `prompt_enhance_${digest}`;
}

export function promptEnhanceRequestFingerprint(engine: string, prompt: string): string {
  return createHash("sha256").update(`${engine}\0${prompt}`).digest("hex");
}

export type ReservePromptEnhanceResult =
  | { kind: "execute"; jobId: string; requestFingerprint: string }
  | { kind: "replay"; jobId: string; result: PromptEnhanceResponse }
  | { kind: "running"; jobId: string }
  | { kind: "failed"; jobId: string; message: string }
  /** 同一 billingRequestId 绑定了不同 engine/prompt:调用方回 BAD_REQUEST */
  | { kind: "mismatch"; jobId: string };

function extractRequestFingerprint(input: unknown): string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "";
  return String((input as { requestFingerprint?: unknown }).requestFingerprint || "");
}

function parseStoredResponse(output: unknown): PromptEnhanceResponse | null {
  if (!output || typeof output !== "object" || Array.isArray(output)) return null;
  const o = output as Partial<PromptEnhanceResponse>;
  if (o.action !== PROMPT_ENHANCE_DONE_ACTION) return null;
  if (typeof o.enhancedPrompt !== "string" || !o.enhancedPrompt) return null;
  return {
    action: PROMPT_ENHANCE_DONE_ACTION,
    requestFingerprint: String(o.requestFingerprint || ""),
    enhancedPrompt: o.enhancedPrompt,
    issues: Array.isArray(o.issues) ? (o.issues as FormatIssue[]) : [],
    gateway: String(o.gateway || ""),
    engine: o.engine as CompilerEngineId,
    creditsBilled: Number(o.creditsBilled) || 0,
  };
}

/**
 * 占位:插入成功=取得唯一执行权;主键冲突时按旧记录状态与指纹分流。
 * 任何查询/插入失败直接抛错。
 */
export async function reservePromptEnhanceOperation(input: {
  userId: number;
  billingRequestId: string;
  engine: CompilerEngineId;
  prompt: string;
}): Promise<ReservePromptEnhanceResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot reserve prompt enhance operation");

  const jobId = promptEnhanceOperationId(input.userId, input.billingRequestId);
  const requestFingerprint = promptEnhanceRequestFingerprint(input.engine, input.prompt);

  const values: InsertJob = {
    id: jobId,
    userId: String(input.userId),
    type: "platform",
    provider: "glm",
    status: "running",
    input: {
      action: PROMPT_ENHANCE_JOB_ACTION,
      billingRequestId: input.billingRequestId,
      requestFingerprint,
      engine: input.engine,
      prompt: input.prompt,
    } as InsertJob["input"],
    output: null,
    attempts: 1,
  };
  const inserted = await db
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({ target: jobs.id })
    .returning({ id: jobs.id });
  if (inserted.length > 0) {
    return { kind: "execute", jobId, requestFingerprint };
  }

  // 主键已存在:strict 读回(db 故障抛错,绝不折成"无记录")
  const existing = await getJobByIdStrict(jobId);
  if (!existing) {
    throw new Error(`prompt enhance operation vanished after conflict: ${jobId}`);
  }
  if (extractRequestFingerprint(existing.input) !== requestFingerprint) {
    return { kind: "mismatch", jobId };
  }
  if (existing.status === "succeeded") {
    const stored = parseStoredResponse(existing.output);
    if (!stored) {
      throw new Error(`prompt enhance succeeded record has invalid output: ${jobId}`);
    }
    return { kind: "replay", jobId, result: stored };
  }
  if (existing.status === "failed") {
    return {
      kind: "failed",
      jobId,
      message: String(existing.error || "该增强任务未完成,请重新发起"),
    };
  }
  // running(以及理论上不该出现的 queued)一律按处理中对待
  return { kind: "running", jobId };
}

export type PromptEnhanceFailureClaim = "failed" | "succeeded" | "missing";

/**
 * 原子认领 failed 终态:只有 running 能转 failed(CAS),与成功写入竞争时
 * 先落库的一方赢。返回 "succeeded" 表示成功结果已在案——调用方绝不能退分。
 */
export async function claimPromptEnhanceFailed(
  jobId: string,
  message: string,
): Promise<PromptEnhanceFailureClaim> {
  const db = await getDb();
  if (!db) {
    throw new Error("Database unavailable — cannot close prompt enhance operation");
  }

  const changed = await db
    .update(jobs)
    .set({
      status: "failed",
      error: String(message || "增强未完成").slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.status, "running"),
        sql`${jobs.input}->>'action' = ${PROMPT_ENHANCE_JOB_ACTION}`,
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

/**
 * 成功结果落库(CAS):只有 running 能转 succeeded;竞争输给 failed 时返回 false
 * (调用方按失败退分)。只重试数据库写入,绝不重调模型。
 */
export async function markPromptEnhanceSucceededWithRetry(
  jobId: string,
  result: PromptEnhanceResponse,
  options?: { attempts?: number; delayMs?: number },
): Promise<boolean> {
  const attempts = Math.max(1, Math.min(6, Math.floor(options?.attempts ?? 4)));
  const delayMs = Math.max(0, Math.min(5_000, Math.floor(options?.delayMs ?? 250)));

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const db = await getDb();
    if (!db) {
      if (attempt === attempts) return false;
    } else {
      try {
        const changed = await db
          .update(jobs)
          .set({
            status: "succeeded",
            output: result as InsertJob["output"],
            error: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(jobs.id, jobId),
              eq(jobs.status, "running"),
              sql`${jobs.input}->>'action' = ${PROMPT_ENHANCE_JOB_ACTION}`,
            ),
          )
          .returning({ id: jobs.id });

        if (changed.length > 0) return true;

        const existing = await getJobByIdStrict(jobId);
        if (existing?.status === "succeeded") {
          // 已被同一请求的先前写入落成成功:指纹相同才视为同一份结果
          const stored = parseStoredResponse(existing.output);
          return Boolean(stored && stored.requestFingerprint === result.requestFingerprint);
        }
        if (existing?.status === "failed") {
          return false; // failed 已先落库(reaper 已退分):成功结果不得覆盖
        }
      } catch {
        // 只重试数据库终态写入,不重新调用模型
      }
    }

    if (attempt < attempts && delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  return false;
}

/**
 * 增强调用期间的心跳包装:注册 hold 后每 60s 刷一次,防止长网关链
 * (最长约 5×240s)期间被 5 分钟心跳线误判停更退分。
 */
export async function withPromptEnhanceHeartbeat<T>(
  jobId: string,
  work: () => Promise<T>,
  options?: {
    intervalMs?: number;
    heartbeat?: (jobId: string) => Promise<void>;
  },
): Promise<T> {
  const intervalMs = Math.max(5_000, Math.floor(options?.intervalMs ?? 60_000));
  const beat =
    options?.heartbeat ??
    (async (id: string) => {
      const { heartbeatActiveJob } = await import("./paidJobLedger.js");
      await heartbeatActiveJob(id, "promptEnhance");
    });
  const timer = setInterval(() => {
    void beat(jobId).catch(() => {});
  }, intervalMs);
  (timer as { unref?: () => void }).unref?.();
  try {
    return await work();
  } finally {
    clearInterval(timer);
  }
}

/**
 * 孤儿扫描源:jobs=running、action=prompt_enhance 且超时限的记录。
 * 条件收紧到本动作,绝不扫其他 platform 任务;db 不可用抛错。
 */
export async function listStalePromptEnhanceRunningJobs(opts?: {
  staleMs?: number;
  now?: number;
}): Promise<Array<{ id: string; userId: string }>> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot scan prompt enhance jobs");
  const staleMs = Math.max(60_000, Math.floor(opts?.staleMs ?? PROMPT_ENHANCE_STALE_MS));
  const cutoff = new Date((opts?.now ?? Date.now()) - staleMs);
  const rows = await db
    .select({ id: jobs.id, userId: jobs.userId })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "platform"),
        eq(jobs.status, "running"),
        sql`${jobs.input}->>'action' = ${PROMPT_ENHANCE_JOB_ACTION}`,
        lt(jobs.updatedAt, cutoff),
      ),
    );
  return rows.map((row) => ({ id: String(row.id), userId: String(row.userId) }));
}
