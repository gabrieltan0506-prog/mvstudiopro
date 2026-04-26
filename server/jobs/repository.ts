import { and, asc, eq } from "drizzle-orm";
import { jobs, type Job, type InsertJob } from "../../drizzle/schema";
import { getDb } from "../db";

export type JobType = "video" | "image" | "audio" | "platform";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

type InMemoryJob = Job & {
  input: unknown;
  output: unknown;
};

const inMemoryJobs = new Map<string, InMemoryJob>();

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeJob(job: Job): InMemoryJob {
  return {
    ...job,
    input: parseMaybeJson(job.input),
    output: parseMaybeJson(job.output),
  };
}

function cloneInMemoryJob(job: InMemoryJob): InMemoryJob {
  return {
    ...job,
    input: job.input,
    output: job.output,
  };
}

/**
 * 平台 Job（type="platform"）无法插入 MySQL enum('video','image','audio')，
 * 会回退到 inMemoryJobs。当 DB 可用时，各状态写函数也需要同步更新 in-memory。
 */
function syncInMemory(id: string, updates: Partial<InMemoryJob>): void {
  const existing = inMemoryJobs.get(id);
  if (existing) {
    Object.assign(existing, updates, { updatedAt: new Date() });
    inMemoryJobs.set(id, existing);
  }
}

export async function createJob(data: {
  id: string;
  userId: string;
  type: JobType;
  provider: string;
  input: unknown;
}): Promise<string> {
  const db = await getDb();
  if (!db) {
    const now = new Date();
    inMemoryJobs.set(data.id, {
      id: data.id,
      userId: data.userId,
      type: data.type,
      provider: data.provider,
      status: "queued",
      input: data.input,
      output: null,
      error: null,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    } as InMemoryJob);
    return data.id;
  }

  const values: InsertJob = {
    id: data.id,
    userId: data.userId,
    // Cast needed because InsertJob enum only lists video/image/audio in the DB schema.
    // Platform jobs use the in-memory fallback path and never reach the MySQL enum constraint.
    type: data.type as "video" | "image" | "audio",
    provider: data.provider,
    status: "queued",
    input: data.input as any,
    attempts: 0,
  };
  try {
    await db.insert(jobs).values(values);
  } catch (error) {
    console.error("[JobsRepo] createJob db insert failed; falling back to in-memory queue:", error);
    const now = new Date();
    inMemoryJobs.set(data.id, {
      id: data.id,
      userId: data.userId,
      type: data.type,
      provider: data.provider,
      status: "queued",
      input: data.input,
      output: null,
      error: null,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    } as InMemoryJob);
  }
  return data.id;
}

export async function getJobById(id: string): Promise<InMemoryJob | null> {
  const db = await getDb();
  if (!db) {
    const job = inMemoryJobs.get(id);
    return job ? cloneInMemoryJob(job) : null;
  }

  try {
    const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (rows.length > 0) return normalizeJob(rows[0]);
  } catch (error) {
    console.error("[JobsRepo] getJobById db read failed; checking in-memory queue:", error);
  }

  const fallbackJob = inMemoryJobs.get(id);
  return fallbackJob ? cloneInMemoryJob(fallbackJob) : null;
}

export async function claimNextQueuedJob(): Promise<InMemoryJob | null> {
  const db = await getDb();
  if (!db) {
    const next = Array.from(inMemoryJobs.values())
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!next) return null;

    next.status = "running";
    next.attempts = (next.attempts ?? 0) + 1;
    next.updatedAt = new Date();
    inMemoryJobs.set(next.id, next);
    return cloneInMemoryJob(next);
  }

  let rows: Job[] = [];
  try {
    rows = await db
      .select()
      .from(jobs)
      .where(eq(jobs.status, "queued"))
      .orderBy(asc(jobs.createdAt))
      .limit(1);
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJob db read failed; falling back to in-memory queue:", error);
    const nextMem = Array.from(inMemoryJobs.values())
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!nextMem) return null;
    nextMem.status = "running";
    nextMem.attempts = (nextMem.attempts ?? 0) + 1;
    nextMem.updatedAt = new Date();
    inMemoryJobs.set(nextMem.id, nextMem);
    return cloneInMemoryJob(nextMem);
  }

  if (rows.length === 0) {
    // DB 无待处理任务，仍需检查 in-memory 队列（例如 platform job 无法写入 MySQL enum）
    const memJob = Array.from(inMemoryJobs.values())
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
    if (!memJob) return null;
    memJob.status = "running";
    memJob.attempts = (memJob.attempts ?? 0) + 1;
    memJob.updatedAt = new Date();
    inMemoryJobs.set(memJob.id, memJob);
    return cloneInMemoryJob(memJob);
  }

  const next = rows[0];
  try {
    await db
      .update(jobs)
      .set({
        status: "running",
        attempts: (next.attempts ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")));

    const claimed = await getJobById(next.id);
    return claimed;
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJob db update failed; moving job to in-memory queue:", error);
    const normalized = normalizeJob(next);
    normalized.status = "running";
    normalized.attempts = (normalized.attempts ?? 0) + 1;
    normalized.updatedAt = new Date();
    inMemoryJobs.set(normalized.id, normalized);
    return cloneInMemoryJob(normalized);
  }
}

export async function markJobSucceeded(id: string, output: unknown, provider?: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const existing = inMemoryJobs.get(id);
    if (!existing) return;
    existing.status = "succeeded";
    existing.output = output;
    existing.error = null;
    existing.updatedAt = new Date();
    if (provider) existing.provider = provider;
    inMemoryJobs.set(id, existing);
    return;
  }

  const setValues: Record<string, unknown> = {
    status: "succeeded",
    output: output as any,
    error: null,
    updatedAt: new Date(),
  };
  if (provider) {
    setValues.provider = provider;
  }

  try {
    await db.update(jobs).set(setValues as any).where(eq(jobs.id, id));
  } catch (error) {
    console.error("[JobsRepo] markJobSucceeded db update failed; writing in-memory:", error);
  }
  // 同步更新 in-memory（platform job 存在 in-memory 中，DB update 不影响它）
  syncInMemory(id, { status: "succeeded", output, error: null, ...(provider ? { provider } : {}) });
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const existing = inMemoryJobs.get(id);
    if (!existing) return;
    existing.status = "failed";
    existing.error = error;
    existing.updatedAt = new Date();
    inMemoryJobs.set(id, existing);
    return;
  }

  try {
    await db
      .update(jobs)
      .set({
        status: "failed",
        error,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));
  } catch (dbError) {
    console.error("[JobsRepo] markJobFailed db update failed; writing in-memory:", dbError);
  }
  syncInMemory(id, { status: "failed", error });
}

export async function requeueJob(id: string, error: string): Promise<void> {
  const db = await getDb();
  if (!db) {
    const existing = inMemoryJobs.get(id);
    if (!existing) return;
    existing.status = "queued";
    existing.error = error;
    existing.updatedAt = new Date();
    inMemoryJobs.set(id, existing);
    return;
  }

  try {
    await db
      .update(jobs)
      .set({
        status: "queued",
        error,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, id));
  } catch (dbError) {
    console.error("[JobsRepo] requeueJob db update failed; writing in-memory:", dbError);
  }
  syncInMemory(id, { status: "queued", error });
}
