import { and, asc, eq } from "drizzle-orm";
import { jobs, type Job, type InsertJob } from "../../drizzle/schema";
import { getDb } from "../db";

export type JobType = "video" | "image" | "audio" | "platform";
export type JobStatus = "queued" | "running" | "succeeded" | "failed";

type NormalizedJob = Job & {
  input: unknown;
  output: unknown;
};

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeJob(job: Job): NormalizedJob {
  return {
    ...job,
    input: parseMaybeJson(job.input),
    output: parseMaybeJson(job.output),
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
  if (!db) throw new Error("Database unavailable — cannot create job");

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

export async function getJobById(id: string): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;

  try {
    const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
    if (rows.length > 0) return normalizeJob(rows[0]);
  } catch (error) {
    console.error("[JobsRepo] getJobById failed:", error);
  }
  return null;
}

// hotfix(egress): jobs 队列每 1s 轮询一次 claimNextQueuedJob。
// 原实现 `db.select().from(jobs)` 会把 input / output JSONB（常常几十到几百 KB
// 的 platform 任务载荷）连同全表一起读回 Fly，哪怕 99% 情况下队列是空的。
// 这里只选 UPDATE 需要的最小列（id, attempts），真实 job 详情由下面的
// getJobById(next.id) 单独读取——只在确实有可领取的任务时才付一次读 cost。
// 
// 不加 FOR UPDATE SKIP LOCKED：目前 Fly 只跑单 worker（见 runner.ts 的
// workerStarted / processing 互斥），事务语义改动的风险收益不划算，留给后续
// 多 worker 化时再单独评估。UPDATE 的 WHERE "status" = 'queued' 已经足够
// 防止同一行被重复 claim。
export async function claimNextQueuedJob(): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;

  let candidates: Array<Pick<Job, "id" | "attempts">> = [];
  try {
    candidates = await db
      .select({ id: jobs.id, attempts: jobs.attempts })
      .from(jobs)
      .where(eq(jobs.status, "queued"))
      .orderBy(asc(jobs.createdAt))
      .limit(1);
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJob select failed:", error);
    return null;
  }

  if (candidates.length === 0) return null;

  const next = candidates[0];
  try {
    await db
      .update(jobs)
      .set({
        status: "running",
        attempts: (next.attempts ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, next.id), eq(jobs.status, "queued")));

    return await getJobById(next.id);
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJob update failed:", error);
    return null;
  }
}

export async function markJobSucceeded(id: string, output: unknown, provider?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const setValues: Record<string, unknown> = {
    status: "succeeded",
    output: output as any,
    error: null,
    updatedAt: new Date(),
  };
  if (provider) setValues.provider = provider;

  try {
    await db.update(jobs).set(setValues as any).where(eq(jobs.id, id));
  } catch (error) {
    console.error("[JobsRepo] markJobSucceeded failed:", error);
  }
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(jobs)
      .set({ status: "failed", error, updatedAt: new Date() })
      .where(eq(jobs.id, id));
  } catch (dbError) {
    console.error("[JobsRepo] markJobFailed failed:", dbError);
  }
}

export async function requeueJob(id: string, error: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    await db
      .update(jobs)
      .set({ status: "queued", error, updatedAt: new Date() })
      .where(eq(jobs.id, id));
  } catch (dbError) {
    console.error("[JobsRepo] requeueJob failed:", dbError);
  }
}
