import { and, asc, eq, notInArray, sql } from "drizzle-orm";
import { jobs, type Job, type InsertJob } from "../../drizzle/schema";
import { getDb } from "../db";
import { omitChineseStagingFromJobOutput } from "../services/platformImageChineseStaging.js";
import { deleteDrProSecondaryStagingByJobId } from "../services/drProSecondaryStaging.js";

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

/** platform 任務 input 頂層 action（與 processPlatformJob 一致） */
function getPlatformJobAction(input: unknown): string | null {
  const v = parseMaybeJson(input);
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const a = (v as { action?: unknown }).action;
  return typeof a === "string" ? a : null;
}

/** video 任務 input 頂層 action（growth 素材分析等） */
function getVideoJobAction(input: unknown): string | null {
  const v = parseMaybeJson(input);
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const a = (v as { action?: unknown }).action;
  return typeof a === "string" ? a : null;
}

function isGrowthCampAnalyzeJob(job: Job): boolean {
  const action = getVideoJobAction(job.input);
  if (action !== "growth_analyze_video" && action !== "growth_analyze_images") return false;
  return job.type === "video" || job.type === "image";
}

/** 供 API 轮询唤醒 growth 专用 worker */
export function isGrowthCampAnalyzeJobRecord(job: Pick<Job, "type" | "input">): boolean {
  return isGrowthCampAnalyzeJob(job as Job);
}

/** 成长营素材分析专用拾取：与平台 Stage2 / 选题生图等长任务分池，避免 queued 长时间无人认领。 */
export async function claimNextGrowthCampAnalyzeJob(): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;

  let rows: Job[] = [];
  try {
    rows = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.status, "queued"),
          sql`(${jobs.input}::jsonb->>'action') in ('growth_analyze_video', 'growth_analyze_images')`,
        ),
      )
      .orderBy(asc(jobs.createdAt))
      .limit(1);
  } catch (error) {
    console.error("[JobsRepo] claimNextGrowthCampAnalyzeJob select failed:", error);
    return null;
  }

  const next = rows[0];
  if (!next || !isGrowthCampAnalyzeJob(next)) return null;

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
    console.error("[JobsRepo] claimNextGrowthCampAnalyzeJob update failed:", error);
    return null;
  }
}

/** 每次拾取時掃描前方若干個 queued，避免 Stage2 文案永遠卡在長時間 platform_topic_image 之後 */
const QUEUE_SCAN_FOR_BUILD_CONTENT = 40;

function normalizeJob(job: Job): NormalizedJob {
  return {
    ...job,
    input: parseMaybeJson(job.input),
    output: parseMaybeJson(job.output),
  };
}

/**
 * 寬幅合成專用：**已 running** 的進度占位 job（不進 worker 佇列），供 GET /api/jobs 輪詢 `output.imageGenFlowLog`。
 */
export async function insertRunningCompositeSheetProgressJob(data: {
  id: string;
  userId: string;
  sceneId: string;
  kind: string;
  titleSlice: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot create job");

  await db.insert(jobs).values({
    id: data.id,
    userId: data.userId,
    type: "platform",
    provider: "vertex",
    status: "running",
    input: {
      action: "platform_composite_sheet_progress",
      params: { sceneId: data.sceneId, kind: data.kind },
    } as InsertJob["input"],
    output: {
      imageGenFlowLog: [] as string[],
      compositeSheetProgress: true,
      sceneId: data.sceneId,
      kind: data.kind,
      titleSlice: data.titleSlice,
    } as InsertJob["output"],
    attempts: 1,
  } as InsertJob);
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
  const db = await getDb();
  if (!db) return null;

  const excludeTypes = ["pdf_export"];
  let rows: Job[] = [];
  try {
    const condition =
      excludeTypes.length > 0
        ? and(eq(jobs.status, "queued"), notInArray(jobs.type, excludeTypes))
        : eq(jobs.status, "queued");
    rows = await db
      .select()
      .from(jobs)
      .where(condition)
      .orderBy(asc(jobs.createdAt))
      .limit(QUEUE_SCAN_FOR_BUILD_CONTENT);
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJob select failed:", error);
    return null;
  }

  if (rows.length === 0) return null;

  const nonGrowthRows = rows.filter((j) => !isGrowthCampAnalyzeJob(j));
  const preferred =
    nonGrowthRows.find(
      (j) => j.type === "platform" && getPlatformJobAction(j.input) === "platform_build_content",
    ) ?? nonGrowthRows[0];

  if (!preferred) return null;

  try {
    await db
      .update(jobs)
      .set({
        status: "running",
        attempts: (preferred.attempts ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, preferred.id), eq(jobs.status, "queued")));

    return await getJobById(preferred.id);
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJob update failed:", error);
    return null;
  }
}

/** 僅在「可能寫入過 DR 副選題暫存」的 platform job 終態時刪除 Neon 行；套裝須整 job（封面+2×4）跑完後才 markJobSucceeded，故不會在僅封面完成時刪。 */
async function maybeDeleteDrProSecondaryStagingForTerminalPlatformJob(jobId: string): Promise<void> {
  const job = await getJobById(jobId);
  if (!job || job.type !== "platform") return;
  const action = getPlatformJobAction(job.input);
  if (action !== "platform_topic_image" && action !== "platform_topic_cover_composite_bundle") return;
  await deleteDrProSecondaryStagingByJobId(jobId);
}

export async function markJobSucceeded(id: string, output: unknown, provider?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  const cleaned =
    output != null && typeof output === "object" && !Array.isArray(output)
      ? omitChineseStagingFromJobOutput(output as Record<string, unknown>)
      : output;

  const setValues: Record<string, unknown> = {
    status: "succeeded",
    output: cleaned as any,
    error: null,
    updatedAt: new Date(),
  };
  if (provider) setValues.provider = provider;

  try {
    await db.update(jobs).set(setValues as any).where(eq(jobs.id, id));
  } catch (error) {
    console.error("[JobsRepo] markJobSucceeded failed:", error);
  }
  await maybeDeleteDrProSecondaryStagingForTerminalPlatformJob(id);
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  const db = await getDb();
  if (!db) return;

  try {
    const job = await getJobById(id);
    let nextOut = job?.output;
    if (nextOut != null && typeof nextOut === "object" && !Array.isArray(nextOut)) {
      nextOut = omitChineseStagingFromJobOutput(nextOut as Record<string, unknown>) as Job["output"];
    }
    await db
      .update(jobs)
      .set({ status: "failed", error, output: nextOut as any, updatedAt: new Date() })
      .where(eq(jobs.id, id));
  } catch (dbError) {
    console.error("[JobsRepo] markJobFailed failed:", dbError);
  }
  await maybeDeleteDrProSecondaryStagingForTerminalPlatformJob(id);
}

/** platform_topic_image 等長任務：running 時把部分 output 寫入 DB，供 GET /api/jobs 輪詢看到即時步驟 */
const PLATFORM_JOB_PROGRESS_LOG_MAX = 240;

export async function patchJobRunningProgress(jobId: string, patch: Record<string, unknown>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  try {
    const job = await getJobById(jobId);
    if (!job || job.status !== "running") return;
    const prevOut =
      job.output && typeof job.output === "object" && !Array.isArray(job.output)
        ? { ...(job.output as Record<string, unknown>) }
        : {};
    const next = { ...prevOut, ...patch };
    if (Array.isArray(next.imageGenFlowLog)) {
      next.imageGenFlowLog = (next.imageGenFlowLog as string[]).slice(-PLATFORM_JOB_PROGRESS_LOG_MAX);
    }
    await db.update(jobs).set({ output: next as any, updatedAt: new Date() }).where(eq(jobs.id, jobId));
  } catch (error) {
    console.warn("[JobsRepo] patchJobRunningProgress failed:", error);
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
