import { and, eq, lt, ne, or, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";
import { readActiveJob, refundCreditsOnFailure } from "../services/paidJobLedger.js";
import { MANHUA_ASSEMBLE_LEDGER_TYPE } from "../services/manhuaAssembleBilling.js";

/**
 * Neon **`jobs` 表**只承載異步隊列：`video` / `image` / `audio` / `platform` / `pdf_export`（`server/jobs/repository` · `JobType`）。
 *
 * **戰略深研（GodView）**狀態在 Fly 磁碟 JSON + `paidJobLedger` 心跳檔，**不使用本表**，故本模組**從不會**刪到深研。
 * 深研常態超過 20 分鐘屬預期；超時與進程恢復由 `deepResearchService`（約 30min watchdog、~30s 心跳等）單獨處理。
 */

/**
 * 優先讀 `JOBS_STALE_MINUTES`，否則 `JOBS_STALE_RUNNING_MINUTES`（預設 **20** 分鐘）。
 * 下限 5、上限 10080（7 天），可用環境變數加大 PDF 等長任務的容忍度。
 */
function resolveStaleWallMinutes(): number {
  const unified = Number(process.env.JOBS_STALE_MINUTES);
  if (Number.isFinite(unified)) {
    return Math.max(5, Math.min(10_080, Math.floor(unified)));
  }
  const legacy = Number(process.env.JOBS_STALE_RUNNING_MINUTES);
  if (Number.isFinite(legacy)) {
    return Math.max(5, Math.min(10_080, Math.floor(legacy)));
  }
  return 20;
}

/** `queued` 可單獨用小時（歷史）；未設時與 {@link resolveStaleWallMinutes} 相同。 */
function resolveQueuedStaleMinutes(): number {
  const rawH = Number(process.env.JOBS_STALE_QUEUED_HOURS);
  if (Number.isFinite(rawH)) {
    const hours = Math.max(1 / 60, Math.min(168, rawH));
    return Math.max(5, Math.min(10_080, Math.floor(hours * 60)));
  }
  return resolveStaleWallMinutes();
}

function wallCutoffSql(minutes: number) {
  return sql.raw(`NOW() - INTERVAL '${minutes} minutes'`);
}

export type ReapStaleJobsOnceOptions = {
  /** 管理員面板手動觸發時置為 true，略過 `DISABLE_JOBS_STALE_REAPER`（定時器與 worker 前置掃描仍遵該開關）。 */
  bypassDisable?: boolean;
};

/**
 * 單次掃描：**刪除**過舊的非漫劇學習 `running` / `queued` 行（釋放 DB；輪詢端會 404）。
 *
 * - **running**：僅當 **`updatedAt` 早於門檻** 時刪（依「最後活動」判殭屍）。長任務可跑超過門檻，
 *   只要 worker 仍透過 `patchJobRunningProgress` / `recordPdfExportStep` 等刷新 `updatedAt` 即不會被清掉。
 * - **queued**：`createdAt` 早於門檻即刪（久未認領）。
 */
export async function reapStaleJobsOnce(
  options?: ReapStaleJobsOnceOptions,
): Promise<{ runningCleared: number; queuedCleared: number }> {
  if (!options?.bypassDisable && process.env.DISABLE_JOBS_STALE_REAPER === "true") {
    return { runningCleared: 0, queuedCleared: 0 };
  }

  const db = await getDb();
  if (!db) return { runningCleared: 0, queuedCleared: 0 };

  const runMin = resolveStaleWallMinutes();
  const qMin = resolveQueuedStaleMinutes();
  const runCutoff = wallCutoffSql(runMin);
  const qCutoff = wallCutoffSql(qMin);

  try {
    // post_prod 任务记录保留:停止更新的行改判 failed 而不是删除,
    // getPostProdJob 仍能返回任务状态,不会直接变成 404。
    await db
      .update(jobs)
      .set({
        status: "failed",
        error: "后期任务已停止,请重新提交",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(jobs.type, "post_prod"),
          or(
            and(eq(jobs.status, "running"), lt(jobs.updatedAt, runCutoff)),
            and(eq(jobs.status, "queued"), lt(jobs.createdAt, qCutoff)),
          ),
        ),
      );

    // 合成任务保留输入、成片和字幕回执。只终止确已失活的记录，不删除、不重排。
    const staleAssembles = await db.select({ id: jobs.id, userId: jobs.userId, status: jobs.status, updatedAt: jobs.updatedAt })
      .from(jobs).where(and(
        eq(jobs.type, "video"), sql`${jobs.input}::jsonb->>'action' = 'manhua_assemble_final'`,
        or(and(eq(jobs.status, "running"), lt(jobs.updatedAt, runCutoff)),
          and(eq(jobs.status, "queued"), lt(jobs.createdAt, qCutoff))),
      ));
    for (const stale of staleAssembles) {
      const hold = await readActiveJob(stale.id, MANHUA_ASSEMBLE_LEDGER_TYPE);
      // SQL updatedAt 不代表 FFmpeg 活性，worker 的真实账本心跳优先。
      if (hold?.status === "active" && Date.now() - Date.parse(hold.lastHeartbeatAt) < 90_000) continue;
      const changed = await db.update(jobs).set({
        status: "failed", error: "合成任务已停止，原输入与回执已保留，请先核对原任务", updatedAt: new Date(),
      }).where(and(eq(jobs.id, stale.id), eq(jobs.status, stale.status), eq(jobs.updatedAt, stale.updatedAt)))
        .returning({ id: jobs.id });
      if (changed.length > 0 && hold && String(hold.userId) === String(stale.userId)) {
        // 使用既有幂等退款；失败留给持久账本补偿，不再执行媒体处理。
        await refundCreditsOnFailure(stale.id, MANHUA_ASSEMBLE_LEDGER_TYPE, "process_crashed", "合成任务失活·退回积分");
      }
    }

    // 漫剧学习与配乐都有持久检查点/上游 taskId 恢复。创作顾问 running 行还承担
    // 成功结果与退款 CAS 证据，必须交给 paidJobLedger 的专用回收器，不能先删。
    const nonRecoverableRunningJob = sql`coalesce(${jobs.input}::jsonb->>'action', '') not in (
      'manhua_template_learn', 'manhua_bgm_v55', 'manhua_advisor_qa', 'manhua_assemble_final'
    )`;
    // 尚未付费确认的顾问 queued 占位没有扣分；过期后仍按通用规则清理，避免永久堆积。
    const nonRecoverableQueuedJob = sql`coalesce(${jobs.input}::jsonb->>'action', '') not in (
      'manhua_template_learn', 'manhua_bgm_v55', 'manhua_assemble_final'
    )`;
    const runningRows = await db
      .delete(jobs)
      .where(
        and(
          eq(jobs.status, "running"),
          nonRecoverableRunningJob,
          ne(jobs.type, "post_prod"),
          lt(jobs.updatedAt, runCutoff),
        ),
      )
      .returning({ id: jobs.id });

    const queuedRows = await db
      .delete(jobs)
      .where(
        and(
          eq(jobs.status, "queued"),
          nonRecoverableQueuedJob,
          ne(jobs.type, "post_prod"),
          lt(jobs.createdAt, qCutoff),
        ),
      )
      .returning({ id: jobs.id });

    return { runningCleared: runningRows.length, queuedCleared: queuedRows.length };
  } catch (e) {
    console.warn("[jobs.reaper] reapStaleJobsOnce failed:", e instanceof Error ? e.message : e);
    return { runningCleared: 0, queuedCleared: 0 };
  }
}

/** 與預設 20min 門檻同量級，避免殭屍行長時間留庫 */
const REAPER_INTERVAL_MS = 20 * 60 * 1000;

let staleReaperTimer: ReturnType<typeof setInterval> | null = null;

export function startStaleJobsReaper(): void {
  if (process.env.NODE_ENV === "test" || process.env.DISABLE_JOBS_STALE_REAPER === "true") {
    return;
  }
  if (staleReaperTimer != null) return;

  const tick = () => {
    void reapStaleJobsOnce().then((r) => {
      if (r.runningCleared > 0 || r.queuedCleared > 0) {
        console.warn(
          `[jobs.reaper] 已删除：running=${r.runningCleared} queued=${r.queuedCleared}（stale 行自 DB 移除）`,
        );
      }
    });
  };

  tick();
  staleReaperTimer = setInterval(tick, REAPER_INTERVAL_MS);

  if (typeof staleReaperTimer.unref === "function") {
    staleReaperTimer.unref();
  }
}

export function stopStaleJobsReaper(): void {
  if (staleReaperTimer != null) {
    clearInterval(staleReaperTimer);
    staleReaperTimer = null;
  }
}
