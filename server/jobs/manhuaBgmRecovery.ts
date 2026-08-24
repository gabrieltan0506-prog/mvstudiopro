/**
 * 配乐任务的重启恢复。
 *
 * 进程崩溃/部署重启时，running 的配乐任务会永远挂在那 —— 而它背后是一张
 * 已经付过费的上游单。判据只有一条：**上游任务号存住了没**。
 *
 *   存住了 → 重排成 queued，worker 会走「只恢复轮询」那条路，不重新建单
 *   没存住 → 说不清上游到底建没建，标为待核对交人工，**绝不自动重提**
 *
 * 这条和 staleJobsReaper 的分工：reaper 只改判状态、保留记录（可查不 404），
 * 这里负责让能安全续跑的那批真的续跑起来。
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "../db.js";
import { jobs } from "../../drizzle/schema";

export type ManhuaBgmRecoveryResult = {
  /** 有上游任务号，重排继续轮询 */
  requeued: number;
  /** 号没存住，交人工核对 */
  reconciliationRequired: number;
};

export async function recoverInterruptedManhuaBgmJobsOnStartup(): Promise<ManhuaBgmRecoveryResult> {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable — cannot recover BGM jobs");

  const rows = await db
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.type, "audio"),
        eq(jobs.status, "running"),
        sql`(${jobs.input}::jsonb->>'action') = 'manhua_bgm_v55'`,
      ),
    );

  let requeued = 0;
  let reconciliationRequired = 0;

  for (const row of rows) {
    const output =
      row.output && typeof row.output === "object" && !Array.isArray(row.output)
        ? (row.output as Record<string, unknown>)
        : {};
    const upstreamTaskId = String(output.upstreamTaskId || "").trim();

    if (upstreamTaskId) {
      await db
        .update(jobs)
        .set({
          status: "queued",
          error: "服务重新启动，继续查询原配乐任务",
          updatedAt: new Date(),
        })
        .where(and(eq(jobs.id, row.id), eq(jobs.status, "running")));
      requeued += 1;
      continue;
    }

    await db
      .update(jobs)
      .set({
        status: "failed",
        error: "上游任务状态待核对，未自动重新提交",
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, row.id), eq(jobs.status, "running")));
    reconciliationRequired += 1;
  }

  return { requeued, reconciliationRequired };
}
