import { and, asc, eq, notInArray } from "drizzle-orm";
import { jobs, type Job, type InsertJob } from "../../drizzle/schema";
import { getDb } from "../db";

export type JobType = "video" | "image" | "audio" | "platform" | "pdf_export";
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

export async function claimNextQueuedJobExcluding(excludeTypes: string[]): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;

  let rows: Job[] = [];
  try {
    const condition =
      excludeTypes.length > 0
        ? and(eq(jobs.status, "queued"), notInArray(jobs.type, excludeTypes))
        : eq(jobs.status, "queued");
    rows = await db.select().from(jobs).where(condition).orderBy(asc(jobs.createdAt)).limit(1);
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJobExcluding select failed:", error);
    return null;
  }

  if (rows.length === 0) return null;

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

    return await getJobById(next.id);
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJobExcluding update failed:", error);
    return null;
  }
}

/** 专用 pdf_export 队列，避免长时间 page.pdf 阻塞 image/video/audio/platform。 */
export async function claimNextPdfExportJob(): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;

  let rows: Job[] = [];
  try {
    rows = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), eq(jobs.type, "pdf_export")))
      .orderBy(asc(jobs.createdAt))
      .limit(1);
  } catch (error) {
    console.error("[JobsRepo] claimNextPdfExportJob select failed:", error);
    return null;
  }

  if (rows.length === 0) return null;

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

    return await getJobById(next.id);
  } catch (error) {
    console.error("[JobsRepo] claimNextPdfExportJob update failed:", error);
    return null;
  }
}

export async function claimNextQueuedJob(): Promise<NormalizedJob | null> {
  return claimNextQueuedJobExcluding(["pdf_export"]);
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

const PDF_EXPORT_DEBUG_MAX_STEPS = 48;

/** 異步 PDF worker 細粒度步驟，供 God View DEBUG / 報錯定位（寫入 job.input._pdfDebug）。 */
export async function recordPdfExportStep(
  jobId: string | undefined,
  step: string,
  detail?: string,
): Promise<void> {
  if (!jobId) return;
  const db = await getDb();
  if (!db) return;

  try {
    const job = await getJobById(jobId);
    if (!job) return;

    const rawInput = job.input;
    const base =
      rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
        ? ({ ...(rawInput as Record<string, unknown>) })
        : {};
    const prev = (base._pdfDebug as {
      steps?: Array<{ step: string; detail?: string; at: string }>;
    }) || {};
    const at = new Date().toISOString();
    const steps = [...(prev.steps || []), { step, detail, at }].slice(-PDF_EXPORT_DEBUG_MAX_STEPS);
    base._pdfDebug = {
      currentStep: step,
      currentDetail: detail ?? null,
      updatedAt: at,
      steps,
    };

    await db.update(jobs).set({ input: base as any, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  } catch (error) {
    console.warn("[JobsRepo] recordPdfExportStep failed:", error);
  }
}
