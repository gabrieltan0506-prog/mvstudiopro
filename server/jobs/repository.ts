import { and, asc, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import { jobs, type Job, type InsertJob } from "../../drizzle/schema";
import { getDb } from "../db";
import { omitChineseStagingFromJobOutput } from "../services/platformImageChineseStaging.js";
import { deleteDrProSecondaryStagingByJobId } from "../services/drProSecondaryStaging.js";

export type JobType = "video" | "image" | "audio" | "platform" | "pdf_export" | "post_prod";
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

function isManhuaTemplateLearnJob(job: Pick<Job, "type" | "input">): boolean {
  return job.type === "video" && getVideoJobAction(job.input) === "manhua_template_learn";
}

/** 供 API 轮询唤醒漫剧学习专用 worker。 */
export function isManhuaTemplateLearnJobRecord(job: Pick<Job, "type" | "input">): boolean {
  return isManhuaTemplateLearnJob(job);
}

/** 供 API 轮询唤醒 growth 专用 worker */
export function isGrowthCampAnalyzeJobRecord(job: Pick<Job, "type" | "input">): boolean {
  return isGrowthCampAnalyzeJob(job as Job);
}

/**
 * 抢占一条 queued 任务：靠 `WHERE status='queued'` 做乐观锁，并以 RETURNING 判定是否真的抢到。
 *
 * 原写法不看更新影响了几行：两个 worker 同时选中同一条，第二个的 UPDATE 其实一行没改，
 * 却照样 getJobById 拿到任务往下跑——同一个视频任务被执行两遍，钱烧两次。
 */
async function claimQueuedJobById(
  db: NonNullable<Awaited<ReturnType<typeof getDb>>>,
  job: Pick<Job, "id" | "attempts">,
  label: string,
): Promise<NormalizedJob | null> {
  try {
    const claimed = await db
      .update(jobs)
      .set({
        status: "running",
        attempts: (job.attempts ?? 0) + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "queued")))
      .returning({ id: jobs.id });

    // 一行没改 = 已被别的 worker 抢走，让调用方这轮空手而归，下一轮再取
    if (claimed.length === 0) return null;

    return await getJobById(job.id);
  } catch (error) {
    console.error(`[JobsRepo] ${label} update failed:`, error);
    return null;
  }
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

  return claimQueuedJobById(db, next, "claimNextGrowthCampAnalyzeJob");
}

/** 漫剧学习专用持久队列；由独立双并发 worker 领取，关页后仍继续。 */
export async function claimNextManhuaTemplateLearnJob(): Promise<NormalizedJob | null> {
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
          eq(jobs.type, "video"),
          sql`(${jobs.input}::jsonb->>'action') = 'manhua_template_learn'`,
          sql`coalesce(${jobs.input}::jsonb->>'hiddenAt', '') = ''`,
          // attempts 在领取时 +1；已跑满两次的旧 queued 行不能再被部署/轮询复活。
          sql`coalesce(${jobs.attempts}, 0) < 2`,
        ),
      )
      .orderBy(asc(jobs.createdAt))
      .limit(1);
  } catch (error) {
    console.error("[JobsRepo] claimNextManhuaTemplateLearnJob select failed:", error);
    return null;
  }

  const next = rows[0];
  if (!next || !isManhuaTemplateLearnJob(next)) return null;
  return claimQueuedJobById(db, next, "claimNextManhuaTemplateLearnJob");
}

/**
 * 服务启动时恢复被部署/崩溃打断的漫剧学习任务。
 *
 * 分集检查点已逐集落到 GCS，重新排队后会跳过已完成集并继续总分析；
 * 带取消标记的任务保持终止语义，不能因重启又开始烧模型。
 */
export async function recoverInterruptedManhuaTemplateLearnJobsOnStartup(): Promise<{
  requeued: number;
  cancelled: number;
  completed: number;
  exhausted: number;
}> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot recover manhua learn jobs");

  const recovered = await db
    .update(jobs)
    .set({
      status: sql<JobStatus>`case
        when coalesce(${jobs.output}::jsonb->>'analysisStage', '') = 'manhua_learn_done'
          then 'succeeded'
        when coalesce(${jobs.input}::jsonb->>'cancelRequestedAt', '') <> '' then 'failed'
        when coalesce(${jobs.attempts}, 0) >= 2 then 'failed'
        else 'queued'
      end`,
      error: sql<string | null>`case
        when coalesce(${jobs.output}::jsonb->>'analysisStage', '') = 'manhua_learn_done'
          then null
        when coalesce(${jobs.input}::jsonb->>'cancelRequestedAt', '') <> ''
          then '用户已停止学习；已落盘内容保留'
        when coalesce(${jobs.attempts}, 0) >= 2
          then '任务在服务重启前已达重试上限；已落盘内容保留，可手动续学'
        else '服务重启，已自动恢复排队'
      end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        sql`(${jobs.status} = 'running' or (${jobs.status} = 'queued' and coalesce(${jobs.attempts}, 0) >= 2))`,
        eq(jobs.type, "video"),
        sql`(${jobs.input}::jsonb->>'action') = 'manhua_template_learn'`,
      ),
    )
    .returning({
      id: jobs.id,
      status: jobs.status,
      error: jobs.error,
      output: jobs.output,
    });

  return recovered.reduce(
    (acc, row) => {
      if (row.status === "queued") acc.requeued += 1;
      if (row.status === "succeeded") acc.completed += 1;
      if (row.status === "failed" && String(row.error || "").includes("重试上限")) acc.exhausted += 1;
      if (row.status === "failed" && !String(row.error || "").includes("重试上限")) acc.cancelled += 1;
      return acc;
    },
    { requeued: 0, cancelled: 0, completed: 0, exhausted: 0 },
  );
}

/** 当前用户最近的学习任务：页面刷新/关闭后可从服务端恢复全部运行、排队及刚结束任务。 */
export async function listManhuaTemplateLearnJobsForUser(
  userId: string,
  limit = 30,
): Promise<NormalizedJob[]> {
  const db = await getDb();
  if (!db) return [];
  try {
    const rows = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, String(userId)),
          eq(jobs.type, "video"),
          sql`(${jobs.input}::jsonb->>'action') = 'manhua_template_learn'`,
          sql`coalesce(${jobs.input}::jsonb->>'hiddenAt', '') = ''`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(Math.max(1, Math.min(50, Math.floor(limit) || 30)));
    return rows.map((row) => {
      const normalized = normalizeJob(row);
      const output = normalized.output;
      // 终态 payload 会在 status 更新前先落库。若两次写入之间进程退出或 Neon
      // 短抖动，消费者仍必须把完整 done payload 识别为成功，不能复活成“学习中”。
      if (
        normalized.status === "running"
        && output != null
        && typeof output === "object"
        && !Array.isArray(output)
        && String((output as Record<string, unknown>).analysisStage || "") === "manhua_learn_done"
      ) {
        return { ...normalized, status: "succeeded" as const, error: null };
      }
      return normalized;
    });
  } catch (error) {
    console.error("[JobsRepo] listManhuaTemplateLearnJobsForUser failed:", error);
    return [];
  }
}

/** 同一用户同一来源只允许存在一条 queued/running 学习任务，防双击/多标签页重复烧模型。 */
export async function findActiveManhuaTemplateLearnJobForSource(
  userId: string,
  sourceKey: string,
): Promise<NormalizedJob | null> {
  const db = await getDb();
  const key = String(sourceKey || "").trim();
  if (!db || !key) return null;
  try {
    const rows = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.userId, String(userId)),
          eq(jobs.type, "video"),
          inArray(jobs.status, ["queued", "running"]),
          sql`(${jobs.input}::jsonb->>'action') = 'manhua_template_learn'`,
          sql`coalesce(${jobs.input}::jsonb->>'hiddenAt', '') = ''`,
          sql`coalesce(
            nullif(${jobs.input}::jsonb->'params'->>'dedupeKey', ''),
            nullif(${jobs.input}::jsonb->'params'->>'gcsUri', ''),
            nullif(${jobs.input}::jsonb->'params'->>'url', '')
          ) = ${key}`,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(1);
    return rows[0] ? normalizeJob(rows[0]) : null;
  } catch (error) {
    console.error("[JobsRepo] findActiveManhuaTemplateLearnJobForSource failed:", error);
    throw error;
  }
}

/**
 * 从剧集学习列表隐藏同一部剧的全部任务；运行中的任务同时落取消标记。
 * 只改 jobs 列表源，不删除 GCS 分集检查点、静帧、提案或已批准模板。
 */
export async function hideManhuaTemplateLearnSeriesForUser(input: {
  jobId: string;
  userId: string;
}): Promise<{ hiddenJobIds: string[]; runningJobIds: string[] } | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot hide manhua learn series");
  const current = await getJobById(input.jobId);
  if (!current || !isManhuaTemplateLearnJob(current)) return null;
  if (String(current.userId) !== String(input.userId)) return null;

  const readIdentity = (job: Pick<Job, "id" | "input" | "output">) => {
    const rawInput = parseMaybeJson(job.input);
    const rawOutput = parseMaybeJson(job.output);
    const params = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
      && (rawInput as Record<string, unknown>).params
      && typeof (rawInput as Record<string, unknown>).params === "object"
      && !Array.isArray((rawInput as Record<string, unknown>).params)
      ? (rawInput as Record<string, unknown>).params as Record<string, unknown>
      : {};
    const output = rawOutput && typeof rawOutput === "object" && !Array.isArray(rawOutput)
      ? rawOutput as Record<string, unknown>
      : {};
    return {
      seriesKey: String(output.seriesKey || params.seriesKey || "").trim(),
      sourceKey: String(params.dedupeKey || params.gcsUri || params.url || "").trim(),
    };
  };

  const target = readIdentity(current);
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.userId, String(input.userId)),
        eq(jobs.type, "video"),
        sql`(${jobs.input}::jsonb->>'action') = 'manhua_template_learn'`,
        sql`coalesce(${jobs.input}::jsonb->>'hiddenAt', '') = ''`,
      ),
    );
  const matched = rows.filter((job) => {
    if (job.id === current.id) return true;
    const identity = readIdentity(job);
    return Boolean(
      (target.seriesKey && identity.seriesKey === target.seriesKey)
      || (target.sourceKey && identity.sourceKey === target.sourceKey),
    );
  });
  const hiddenJobIds = matched.map((job) => job.id);
  const runningJobIds = matched.filter((job) => job.status === "running").map((job) => job.id);
  if (!hiddenJobIds.length) return { hiddenJobIds: [], runningJobIds: [] };

  const hiddenAt = new Date().toISOString();
  // 每条 input 都需保留原 params；逐行构造后串行写，数量仅限当前用户同剧的历史任务。
  for (const job of matched) {
    const raw = parseMaybeJson(job.input);
    const base = raw && typeof raw === "object" && !Array.isArray(raw)
      ? raw as Record<string, unknown>
      : { action: "manhua_template_learn" };
    const active = job.status === "queued" || job.status === "running";
    await db.update(jobs).set({
      input: {
        ...base,
        hiddenAt,
        ...(active ? { cancelRequestedAt: hiddenAt } : {}),
      } as InsertJob["input"],
      status: job.status === "queued" ? "failed" : job.status,
      error: job.status === "queued" ? "用户已从列表删除（未开始执行）" : job.error,
      updatedAt: new Date(),
    }).where(and(eq(jobs.id, job.id), eq(jobs.userId, String(input.userId))));
  }
  return { hiddenJobIds, runningJobIds };
}

/** 持久化取消请求；queued 直接终止，running 由 worker 在下一检查点停止。 */
export async function requestManhuaTemplateLearnJobCancel(input: {
  jobId: string;
  userId: string;
}): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot cancel job");
  const current = await getJobById(input.jobId);
  if (!current || !isManhuaTemplateLearnJob(current)) return null;
  if (String(current.userId) !== String(input.userId)) return null;
  if (current.status === "succeeded" || current.status === "failed") return current;

  const rawInput = parseMaybeJson(current.input);
  const requestedAt = new Date().toISOString();
  const nextInput = rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)
    ? { ...(rawInput as Record<string, unknown>), cancelRequestedAt: requestedAt }
    : { action: "manhua_template_learn", cancelRequestedAt: requestedAt };
  const nextStatus = current.status === "queued" ? "failed" : "running";
  await db
    .update(jobs)
    .set({
      input: nextInput as InsertJob["input"],
      status: nextStatus,
      error: current.status === "queued" ? "用户已停止学习（未开始执行）" : current.error,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, input.jobId),
        eq(jobs.userId, String(input.userId)),
        inArray(jobs.status, ["queued", "running"]),
      ),
    );
  return getJobById(input.jobId);
}

export async function isManhuaTemplateLearnJobCancelRequested(jobId: string): Promise<boolean> {
  const job = await getJobById(jobId);
  if (!job) return true;
  const raw = parseMaybeJson(job.input);
  return Boolean(
    job.status === "failed"
    || (raw && typeof raw === "object" && !Array.isArray(raw)
      && (raw as Record<string, unknown>).cancelRequestedAt),
  );
}

/** 请求跳过当前集；只允许 running，worker 消费一次后写 skipConsumedAt。 */
export async function requestManhuaTemplateLearnEpisodeSkip(input: {
  jobId: string;
  userId: string;
}): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot skip episode");
  const current = await getJobById(input.jobId);
  if (!current || !isManhuaTemplateLearnJob(current)) return null;
  if (String(current.userId) !== String(input.userId) || current.status !== "running") return null;
  const raw = parseMaybeJson(current.input);
  const nextInput = raw && typeof raw === "object" && !Array.isArray(raw)
    ? { ...(raw as Record<string, unknown>), skipEpisodeRequestedAt: new Date().toISOString() }
    : { action: "manhua_template_learn", skipEpisodeRequestedAt: new Date().toISOString() };
  await db.update(jobs).set({ input: nextInput as InsertJob["input"], updatedAt: new Date() })
    .where(and(eq(jobs.id, input.jobId), eq(jobs.userId, String(input.userId)), eq(jobs.status, "running")));
  return getJobById(input.jobId);
}

/** 单 worker 消费跳集请求；时间戳相等表示已消费。 */
export async function consumeManhuaTemplateLearnEpisodeSkip(jobId: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const current = await getJobById(jobId);
  if (!current || current.status !== "running") return false;
  const raw = parseMaybeJson(current.input);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const base = raw as Record<string, unknown>;
  const requestedAt = String(base.skipEpisodeRequestedAt || "").trim();
  const consumedAt = String(base.skipEpisodeConsumedAt || "").trim();
  if (!requestedAt || requestedAt === consumedAt) return false;
  await db.update(jobs).set({
    input: { ...base, skipEpisodeConsumedAt: requestedAt } as InsertJob["input"],
    updatedAt: new Date(),
  }).where(and(eq(jobs.id, jobId), eq(jobs.status, "running")));
  return true;
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

/**
 * 所有权登记簿存量引导专用(五审 P0-4):按 (createdAt,id) 游标分页列出
 * 已成功的 image 任务——服务端持久化的任务记录是唯一可信归属证据来源,
 * action 过滤(canvas_gpt_image2)由调用方在 input 上判定。
 */
export async function listSucceededImageJobsPage(opts: {
  afterCreatedAtMs?: number;
  afterId?: string;
  limit?: number;
}): Promise<NormalizedJob[]> {
  const db = await getDb();
  if (!db) {
    // 六审第11条:DB 不可用时返回空页会被回填当成"扫完了"假成功,必须炸出来
    throw new Error("canvas_media_owner_backfill_database_unavailable");
  }
  const limit = Math.max(1, Math.min(500, Math.floor(Number(opts.limit) || 200)));
  try {
    const afterMs = Number(opts.afterCreatedAtMs);
    const afterId = String(opts.afterId || "");
    const rows = await db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.type, "image"),
          eq(jobs.status, "succeeded"),
          ...(Number.isFinite(afterMs) && afterMs > 0
            ? [
                sql`("createdAt" > ${new Date(afterMs)} OR ("createdAt" = ${new Date(afterMs)} AND "id" > ${afterId}))`,
              ]
            : []),
        ),
      )
      .orderBy(asc(jobs.createdAt), asc(jobs.id))
      .limit(limit);
    return rows.map(normalizeJob);
  } catch (error) {
    console.error("[JobsRepo] listSucceededImageJobsPage failed:", error);
    throw error;
  }
}

/** 严格版:数据库/查询故障抛错,不把"查不到过程"折成"确实无记录"(404 语义只留给真无记录) */
export async function getJobByIdStrict(id: string): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot query job");

  const rows = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return rows.length > 0 ? normalizeJob(rows[0]) : null;
}

export async function getJobById(id: string): Promise<NormalizedJob | null> {
  try {
    return await getJobByIdStrict(id);
  } catch (error) {
    console.error("[JobsRepo] getJobById failed:", error);
    return null;
  }
}

export async function claimNextQueuedJobExcluding(excludeTypes: string[]): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;

  let rows: Job[] = [];
  try {
    const actionCondition = sql`coalesce(${jobs.input}::jsonb->>'action', '') not in (
      'growth_analyze_video', 'growth_analyze_images', 'manhua_template_learn'
    )`;
    const condition =
      excludeTypes.length > 0
        ? and(eq(jobs.status, "queued"), notInArray(jobs.type, excludeTypes), actionCondition)
        : and(eq(jobs.status, "queued"), actionCondition);
    rows = await db.select().from(jobs).where(condition).orderBy(asc(jobs.createdAt)).limit(1);
  } catch (error) {
    console.error("[JobsRepo] claimNextQueuedJobExcluding select failed:", error);
    return null;
  }

  if (rows.length === 0) return null;

  const next = rows[0];
  return claimQueuedJobById(db, next, "claimNextQueuedJobExcluding");
}

/** 本人后期任务列表(服务端 jobs 为任务记录主来源;前端 localStorage 仅作显示缓存) */
export async function listPostProdJobsForUser(
  userId: string,
  limit = 30,
): Promise<NormalizedJob[]> {
  const db = await getDb();
  // 数据库不可用抛错:不能把"查不了"折成"空列表",否则前端会误删进行中的任务
  if (!db) throw new Error("Database unavailable — cannot list post-prod jobs");

  try {
    const rows = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.userId, userId), eq(jobs.type, "post_prod")))
      .orderBy(
        // 进行中的排前:limit 截断时不许把 queued/running 挤出列表
        sql`case when ${jobs.status} in ('queued', 'running') then 0 else 1 end`,
        desc(jobs.createdAt),
      )
      .limit(Math.max(1, Math.min(100, Math.floor(limit))));

    return rows.map(normalizeJob);
  } catch (error) {
    console.error("[JobsRepo] listPostProdJobsForUser failed:", error);
    throw error;
  }
}

/** 独立通道任务类型:主队列不领取,各自专用领取函数串行消化 */
export const MAIN_QUEUE_EXCLUDED_TYPES = ["pdf_export", "post_prod"] as const;

/** 专用 post_prod 队列:后期 ffmpeg 耗时长,单并发消化,不挤占普通媒体任务 */
export async function claimNextPostProdJob(): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;

  let rows: Job[] = [];
  try {
    rows = await db
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "queued"), eq(jobs.type, "post_prod")))
      .orderBy(asc(jobs.createdAt))
      .limit(1);
  } catch (error) {
    console.error("[JobsRepo] claimNextPostProdJob select failed:", error);
    return null;
  }

  if (rows.length === 0) return null;

  const next = rows[0];
  return claimQueuedJobById(db, next, "claimNextPostProdJob");
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
  return claimQueuedJobById(db, next, "claimNextPdfExportJob");
}

export async function claimNextQueuedJob(): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;

  const excludeTypes = [...MAIN_QUEUE_EXCLUDED_TYPES];
  let rows: Job[] = [];
  try {
    const actionCondition = sql`coalesce(${jobs.input}::jsonb->>'action', '') not in (
      'growth_analyze_video', 'growth_analyze_images', 'manhua_template_learn'
    )`;
    const condition =
      excludeTypes.length > 0
        ? and(eq(jobs.status, "queued"), notInArray(jobs.type, excludeTypes), actionCondition)
        : and(eq(jobs.status, "queued"), actionCondition);
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

  const nonGrowthRows = rows.filter(
    (j) => !isGrowthCampAnalyzeJob(j) && !isManhuaTemplateLearnJob(j),
  );
  const preferred =
    nonGrowthRows.find(
      (j) => j.type === "platform" && getPlatformJobAction(j.input) === "platform_build_content",
    ) ?? nonGrowthRows[0];

  if (!preferred) return null;

  return claimQueuedJobById(db, preferred, "claimNextQueuedJob");
}

/** 僅在「可能寫入過 DR 副選題暫存」的 platform job 終態時刪除 Neon 行；套裝須整 job（封面+2×4）跑完後才 markJobSucceeded，故不會在僅封面完成時刪。 */
async function maybeDeleteDrProSecondaryStagingForTerminalPlatformJob(jobId: string): Promise<void> {
  const job = await getJobById(jobId);
  if (!job || job.type !== "platform") return;
  const action = getPlatformJobAction(job.input);
  if (action !== "platform_topic_image" && action !== "platform_topic_cover_composite_bundle") return;
  await deleteDrProSecondaryStagingByJobId(jobId);
}

export async function markJobSucceeded(id: string, output: unknown, provider?: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;

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
    return false;
  }
  await maybeDeleteDrProSecondaryStagingForTerminalPlatformJob(id);
  return true;
}

/**
 * 通用终态写入重试:媒体/模型工作已完成后,只重试"同一份终态结果"的数据库写入;
 * 绝不重新执行媒体处理链,避免因数据库短抖动重复下载、转码或调用模型。
 */
export async function markJobSucceededWithRetry(
  id: string,
  output: unknown,
  provider?: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<boolean> {
  const attempts = Math.max(1, Math.min(6, Math.floor(options?.attempts ?? 4)));
  const delayMs = Math.max(0, Math.min(5_000, Math.floor(options?.delayMs ?? 250)));
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (await markJobSucceeded(id, output, provider)) return true;
    if (attempt < attempts && delayMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
  console.error(`[JobsRepo] terminal persistence exhausted: jobId=${id}`);
  return false;
}

/** 历史导出名保留:漫剧学习链的调用方不变,内部走通用重试 */
export async function markManhuaLearnJobSucceededWithRetry(
  id: string,
  output: unknown,
  provider?: string,
  options?: { attempts?: number; delayMs?: number },
): Promise<boolean> {
  return markJobSucceededWithRetry(id, output, provider, options);
}

/** 最近一份平台动作任务（含运行中/成功/失败）；供持久任务在刷新后恢复。 */
export async function getLatestPlatformJobForUserAction(
  userId: string,
  action: string,
): Promise<NormalizedJob | null> {
  const db = await getDb();
  if (!db) return null;
  const [row] = await db
    .select()
    .from(jobs)
    .where(and(
      eq(jobs.userId, userId),
      eq(jobs.type, "platform"),
      sql`coalesce(${jobs.input}::jsonb->>'action', '') = ${action}`,
    ))
    .orderBy(desc(jobs.updatedAt))
    .limit(1);
  if (!row) return null;
  return {
    ...row,
    input: parseMaybeJson(row.input),
    output: parseMaybeJson(row.output),
  };
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

/**
 * 严格版进度写入：**写不进去就抛**。
 *
 * 宽松版把 DB 异常吞成 console.warn，调用方照样往下走 ——
 * 对配乐这种付费异步任务是致命的：upstreamTaskId 没落库却继续轮询，
 * 一旦重启就查不到那张单，只能重新建单再付一次。
 * 凡是「后面靠这条记录才不会重复付费」的写入，都必须走这个版本。
 */
export async function patchJobRunningProgressStrict(
  jobId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot persist job progress");

  const current = await getJobByIdStrict(jobId);
  if (!current) throw new Error(`Job ${jobId} not found`);
  if (current.status !== "running") throw new Error(`Job ${jobId} is not running`);

  const previous =
    current.output && typeof current.output === "object" && !Array.isArray(current.output)
      ? { ...(current.output as Record<string, unknown>) }
      : {};

  const rows = await db
    .update(jobs)
    .set({ output: { ...previous, ...patch } as any, updatedAt: new Date() })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "running")))
    .returning({ id: jobs.id });

  if (rows.length !== 1) throw new Error(`Job ${jobId} progress was not persisted`);
}

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
