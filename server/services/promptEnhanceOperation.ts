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
import {
  getJobByIdStrict,
  markJobFailed,
  markJobSucceededWithRetry,
} from "../jobs/repository.js";
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

/** 成功结果落库:只重试数据库写入,绝不重调模型(复用通用终态重试) */
export async function markPromptEnhanceSucceededWithRetry(
  jobId: string,
  result: PromptEnhanceResponse,
): Promise<boolean> {
  return markJobSucceededWithRetry(jobId, result);
}

export async function markPromptEnhanceFailed(jobId: string, message: string): Promise<void> {
  await markJobFailed(jobId, message);
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
