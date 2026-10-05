import { isDeepStrictEqual } from "node:util";
import { and, asc, eq, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { getJobByIdStrict } from "./repository";
import type { HeavyMediaProgress, HeavyMediaStore } from "./heavyMediaQueue";

async function database() {
  const db = await getDb();
  if (!db) throw new Error("媒体任务数据库不可用");
  return db;
}
export const heavyMediaStore: HeavyMediaStore = {
  async enqueue(id, userId, input) {
    const db = await database();
    await db
      .insert(jobs)
      .values({
        id,
        userId,
        type: "media_work",
        provider: "heavy-media",
        status: "queued",
        input,
        attempts: 0,
      })
      .onConflictDoNothing({ target: jobs.id });
    const row = await getJobByIdStrict(id);
    const immutableInput = (value: unknown) => {
      const {
        heavyReply: _reply,
        cancelRequested: _cancel,
        ...rest
      } = (value ?? {}) as Record<string, unknown>;
      return rest;
    };
    if (
      !row ||
      row.userId !== userId ||
      !isDeepStrictEqual(
        immutableInput(row.input),
        JSON.parse(JSON.stringify(input))
      )
    ) {
      throw new Error("媒体任务身份或内容不一致，未重建任务");
    }
  },
  get: getJobByIdStrict,
  async reply(id, userId, value) {
    const db = await database();
    const rows = await db
      .update(jobs)
      .set({
        input: sql`jsonb_set(${jobs.input}::jsonb, '{heavyReply}', coalesce(${jobs.input}::jsonb->'heavyReply', '{}'::jsonb) || ${JSON.stringify(value)}::jsonb)`,
      })
      .where(
        and(
          eq(jobs.id, id),
          eq(jobs.userId, userId),
          eq(jobs.status, "running")
        )
      )
      .returning({ id: jobs.id });
    if (rows.length !== 1) throw new Error("媒体回调任务归属或状态已变化");
  },
  async cancel(id, userId) {
    const db = await database();
    await db
      .update(jobs)
      .set({
        input: sql`coalesce(${jobs.input}::jsonb, '{}'::jsonb) || '{"cancelRequested":true}'::jsonb`,
        status: sql`case when ${jobs.status} = 'queued' then 'failed' else ${jobs.status} end`,
        error: "已请求停止媒体处理",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.id, id),
          eq(jobs.userId, userId),
          sql`${jobs.status} in ('queued','running')`
        )
      );
  },
};
export async function claimHeavyMediaJob(owner: string) {
  const db = await database();
  const [next] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "media_work"),
        eq(jobs.status, "queued"),
        eq(jobs.attempts, 0)
      )
    )
    .orderBy(asc(jobs.createdAt))
    .limit(1);
  if (!next) return null;
  const rows = await db
    .update(jobs)
    .set({
      status: "running",
      attempts: 1,
      updatedAt: new Date(),
      output: { owner },
    })
    .where(
      and(eq(jobs.id, next.id), eq(jobs.status, "queued"), eq(jobs.attempts, 0))
    )
    .returning({ id: jobs.id });
  return rows.length ? getJobByIdStrict(next.id) : null;
}
export async function writeHeavyMediaProgress(
  id: string,
  owner: string,
  progress?: HeavyMediaProgress
) {
  const db = await database();
  const patch = progress ? { progress } : {};
  const rows = await db
    .update(jobs)
    .set({
      updatedAt: new Date(),
      output: sql`coalesce(${jobs.output}::jsonb, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb`,
    })
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.status, "running"),
        sql`${jobs.output}::jsonb->>'owner' = ${owner}`
      )
    )
    .returning({ input: jobs.input });
  if (!rows.length) throw new Error("媒体任务不再由本执行者持有");
  return rows[0].input as { cancelRequested?: boolean; parentJobId?: string };
}
export async function finishHeavyMediaJob(
  id: string,
  owner: string,
  result: unknown,
  error?: string
) {
  const db = await database();
  const rows = await db
    .update(jobs)
    .set({
      status: error
        ? "failed"
        : sql`case when coalesce(${jobs.input}::jsonb->>'cancelRequested', 'false') = 'true' then 'failed' else 'succeeded' end`,
      error:
        error ??
        sql`case when coalesce(${jobs.input}::jsonb->>'cancelRequested', 'false') = 'true' then '媒体已停止，原回执保留' else null end`,
      output: sql`coalesce(${jobs.output}::jsonb, '{}'::jsonb) || ${JSON.stringify({ result })}::jsonb`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(jobs.id, id),
        eq(jobs.status, "running"),
        sql`${jobs.output}::jsonb->>'owner' = ${owner}`
      )
    )
    .returning({ id: jobs.id });
  if (!rows.length) throw new Error("媒体结果状态已变化，保留原回执等待核对");
}
/** Fail closed: missing DB and query errors must never be interpreted as an empty queue. */
export async function countHeavyWorkerJobs(
  includeRunning = true
): Promise<number> {
  const db = await database();
  const [row] = await db
    .select({ count: sql<number>`count(*)::integer` })
    .from(jobs)
    .where(
      and(
        sql`${jobs.type} in ('media_work','post_prod')`,
        includeRunning
          ? sql`${jobs.status} in ('queued','running')`
          : eq(jobs.status, "queued")
      )
    );
  return row.count;
}

/** Cross-machine recovery only settles preserved results or records interruption; never executes media again. */
export async function recoverStaleHeavyMediaJobs(): Promise<void> {
  const db = await database();
  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.status, "running"),
        sql`${jobs.type} in ('media_work','post_prod')`,
        sql`${jobs.updatedAt} < NOW() - INTERVAL '10 minutes'`
      )
    );
  const { readHeavyMediaResult } = await import(
    "../services/heavyMediaEvidence"
  );
  for (const job of rows) {
    // Preserve the already-confirmed longer silence window for rig bind jobs.
    if (job.type === "post_prod") {
      const { resolvePostProdJobTimeoutMs } = await import("./postProdJob");
      if (
        Date.now() - job.updatedAt.getTime() <
        resolvePostProdJobTimeoutMs(job.input)
      )
        continue;
    }
    // 404 means absent; auth/network/corrupt receipts stop recovery, never become "no result".
    const result = await readHeavyMediaResult(job.id, job.userId);
    const post = result as { output?: unknown; provider?: string } | null;
    const success =
      result !== null &&
      !(job.input as { cancelRequested?: boolean })?.cancelRequested;
    await db
      .update(jobs)
      .set({
        status: success ? "succeeded" : "failed",
        updatedAt: new Date(),
        error: success
          ? null
          : "媒体执行者已失联，原输入与回执保留；未自动重做，请核对原任务",
        ...(success
          ? {
              output:
                job.type === "post_prod"
                  ? post!.output
                  : sql`coalesce(${jobs.output}::jsonb, '{}'::jsonb) || ${JSON.stringify({ result })}::jsonb`,
              ...(job.type === "post_prod" && post?.provider
                ? { provider: post.provider }
                : {}),
            }
          : {}),
      })
      .where(
        and(
          eq(jobs.id, job.id),
          eq(jobs.status, "running"),
          eq(jobs.updatedAt, job.updatedAt)
        )
      );
  }
}
