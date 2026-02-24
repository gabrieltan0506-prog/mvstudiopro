import { and, asc, eq } from "drizzle-orm";
import { jobs, type Job, type InsertJob } from "../../drizzle/schema";
import { getDb } from "../db";

export type JobType = "video" | "image" | "audio";
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
    type: data.type,
    provider: data.provider,
    status: "queued",
    input: data.input as any,
    attempts: 0,
  };
  await db.insert(jobs).values(values);
  return data.id;
}

export async function getJobById(id: string): Promise<InMemoryJob | null> {
  const db = await getDb();
  if (!db) {
    const job = inMemoryJobs.get(id);
    return job ? cloneInMemoryJob(job) : null;
  }

  const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (rows.length === 0) return null;
  return normalizeJob(rows[0]);
}

export async function claimNextQueuedJob(): Promise<InMemoryJob | null> {
  const db = await getDb();
  if (!db) {
    const next = [...inMemoryJobs.values()]
      .filter((job) => job.status === "queued")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];

    if (!next) return null;

    next.status = "running";
    next.attempts = (next.attempts ?? 0) + 1;
    next.updatedAt = new Date();
    inMemoryJobs.set(next.id, next);
    return cloneInMemoryJob(next);
  }

  const rows = await db
    .select()
    .from(jobs)
    .where(eq(jobs.status, "queued"))
    .orderBy(asc(jobs.createdAt))
    .limit(1);

  if (rows.length === 0) return null;

  const next = rows[0];
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

  await db.update(jobs).set(setValues as any).where(eq(jobs.id, id));
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

  await db
    .update(jobs)
    .set({
      status: "failed",
      error,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));
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

  await db
    .update(jobs)
    .set({
      status: "queued",
      error,
      updatedAt: new Date(),
    })
    .where(eq(jobs.id, id));
}
