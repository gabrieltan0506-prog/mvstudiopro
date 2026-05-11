import { and, eq, lt, sql } from "drizzle-orm";
import { jobs } from "../../drizzle/schema";
import { getDb } from "../db";

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

/**
 * 單次掃描：**刪除**過舊的 `running` / `queued` 行（釋放 DB；輪詢端會 404）。
 *
 * - **running**：僅當 **`updatedAt` 早於門檻** 時刪（依「最後活動」判殭屍）。長任務可跑超過門檻，
 *   只要 worker 仍透過 `patchJobRunningProgress` / `recordPdfExportStep` 等刷新 `updatedAt` 即不會被清掉。
 * - **queued**：`createdAt` 早於門檻即刪（久未認領）。
 */
export async function reapStaleJobsOnce(): Promise<{ runningCleared: number; queuedCleared: number }> {
  if (process.env.DISABLE_JOBS_STALE_REAPER === "true") {
    return { runningCleared: 0, queuedCleared: 0 };
  }

  const db = await getDb();
  if (!db) return { runningCleared: 0, queuedCleared: 0 };

  const runMin = resolveStaleWallMinutes();
  const qMin = resolveQueuedStaleMinutes();
  const runCutoff = wallCutoffSql(runMin);
  const qCutoff = wallCutoffSql(qMin);

  try {
    const runningRows = await db
      .delete(jobs)
      .where(and(eq(jobs.status, "running"), lt(jobs.updatedAt, runCutoff)))
      .returning({ id: jobs.id });

    const queuedRows = await db
      .delete(jobs)
      .where(and(eq(jobs.status, "queued"), lt(jobs.createdAt, qCutoff)))
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
