import type { GrowthPlatform } from "@shared/growth";
import { collectTrendPlatforms } from "./trendCollector";
import { getGrowthTrendStats, mergeTrendCollections, updateTrendBackfillProgress } from "./trendStore";

const TARGET = Math.max(10_000, Number(process.env.GROWTH_PLATFORM_MIN_ITEMS || 10_000) || 10_000);
const MAX_ROUNDS = Math.max(1, Number(process.env.GROWTH_BACKFILL_ROUNDS || 20) || 20);
const PLATEAU_LIMIT = Math.max(2, Number(process.env.GROWTH_BACKFILL_PLATEAU_LIMIT || 3) || 3);
const HISTORY_MIN_INTERVAL_MS = 60 * 1000;
const HISTORY_MAX_INTERVAL_MS = 60 * 1000;
const HISTORY_STEP_TARGET = Math.max(4, Number(process.env.GROWTH_BACKFILL_STEP_TARGET || 6) || 6);
const HISTORY_STEP_FALLBACK = Math.max(4, Number(process.env.GROWTH_BACKFILL_STEP_FALLBACK || 6) || 6);
const PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "kuaishou", "bilibili", "toutiao"];

let backfillStarted = false;
let backfillTimer: ReturnType<typeof setTimeout> | null = null;
let backfillInFlight = false;
const plateau = new Map<GrowthPlatform, number>();
const previous = new Map<GrowthPlatform, number>();
let startedAt = "";

function nextHistoryDelayMs() {
  const span = Math.max(0, HISTORY_MAX_INTERVAL_MS - HISTORY_MIN_INTERVAL_MS);
  return HISTORY_MIN_INTERVAL_MS + Math.floor(Math.random() * (span + 1));
}

function scheduleNextBackfillStep() {
  if (!backfillStarted) return;
  if (backfillTimer) clearTimeout(backfillTimer);
  backfillTimer = setTimeout(() => {
    runGrowthTrendBackfillStep()
      .catch((error) => {
        console.warn("[growth.backfill] periodic tick failed:", error);
      })
      .finally(() => {
        scheduleNextBackfillStep();
      });
  }, nextHistoryDelayMs());
}

function getPendingPlatforms(stats: Awaited<ReturnType<typeof getGrowthTrendStats>>) {
  return PLATFORMS.filter((platform) => {
    const row = stats.platforms.find((item) => item.platform === platform);
    const historicalTotal = row?.archivedItems || 0;
    return historicalTotal < TARGET && (plateau.get(platform) || 0) < PLATEAU_LIMIT;
  });
}

export async function runGrowthTrendBackfillStep() {
  if (backfillInFlight) return;
  backfillInFlight = true;
  try {
    const statsBefore = await getGrowthTrendStats();
    const pending = getPendingPlatforms(statsBefore);
    if (!pending.length) {
      await updateTrendBackfillProgress({
        active: false,
        finishedAt: new Date().toISOString(),
        status: "completed",
        selectedWindowDays: statsBefore.coverage.selectedWindowDays,
        note: "历史回填已达到目标量，worker 停止。",
        platforms: PLATFORMS.map((platform) => {
          const row = statsBefore.platforms.find((item) => item.platform === platform);
          return {
            platform,
            target: TARGET,
            currentTotal: row?.currentTotal || 0,
            archivedTotal: row?.archivedItems || 0,
            status: (row?.archivedItems || 0) >= TARGET ? "done" : "pending",
          };
        }),
      });
      return;
    }

    const nextRound = Math.min(MAX_ROUNDS, (statsBefore.totals.archiveRuns || 0) + 1);
    if (!startedAt) startedAt = new Date().toISOString();
    await updateTrendBackfillProgress({
      active: true,
      startedAt,
      currentRound: nextRound,
      maxRounds: MAX_ROUNDS,
      targetPerPlatform: TARGET,
      selectedWindowDays: statsBefore.coverage.selectedWindowDays,
      status: "running",
      note: `历史回填运行中：固定每 1 分钟抓取一次，目标步长 ${HISTORY_STEP_TARGET}，并按轮次轮换 cookie。当前窗口 ${statsBefore.coverage.selectedWindowDays} 天。`,
      platforms: PLATFORMS.map((platform) => {
        const row = statsBefore.platforms.find((item) => item.platform === platform);
        return {
          platform,
          target: TARGET,
          currentTotal: row?.currentTotal || 0,
          archivedTotal: row?.archivedItems || 0,
          plateauCount: plateau.get(platform) || 0,
          status: pending.includes(platform) ? "running" : (row?.archivedItems || 0) >= TARGET ? "done" : "pending",
        };
      }),
    });

    // Keep all pending platforms active; the step target is communicated as the desired
    // per-minute pull floor for source expansion, while the collectors themselves may
    // return larger batches when the upstream endpoints allow it.
    process.env.GROWTH_BACKFILL_ACTIVE = "1";
    process.env.GROWTH_BACKFILL_STEP_TARGET = String(HISTORY_STEP_TARGET);
    process.env.GROWTH_BACKFILL_STEP_FALLBACK = String(HISTORY_STEP_FALLBACK);
    process.env.GROWTH_BACKFILL_COOKIE_OFFSET = String(Math.max(0, nextRound - 1));
    const collected = await collectTrendPlatforms(pending);
    const merged = await mergeTrendCollections(collected.collections);
    const statsAfter = await getGrowthTrendStats();

    for (const platform of pending) {
      const total = statsAfter.platforms.find((item) => item.platform === platform)?.archivedItems || 0;
      const prev = previous.get(platform) || 0;
      previous.set(platform, total);
      plateau.set(platform, total <= prev ? (plateau.get(platform) || 0) + 1 : 0);
    }

    await updateTrendBackfillProgress({
      active: true,
      currentRound: nextRound,
      maxRounds: MAX_ROUNDS,
      targetPerPlatform: TARGET,
      selectedWindowDays: statsAfter.coverage.selectedWindowDays,
      status: "running",
      note: `历史回填运行中：固定每 1 分钟抓取一次，目标步长 ${HISTORY_STEP_TARGET}，并按轮次轮换 cookie。最新覆盖窗口 ${statsAfter.coverage.selectedWindowDays} 天。`,
      platforms: PLATFORMS.map((platform) => {
        const row = statsAfter.platforms.find((item) => item.platform === platform);
        const stalled = pending.includes(platform) && (plateau.get(platform) || 0) >= PLATEAU_LIMIT;
        return {
          platform,
          target: TARGET,
          currentTotal: row?.currentTotal || 0,
          archivedTotal: row?.archivedItems || 0,
          addedCount: merged.mergeStats?.[platform]?.addedCount || 0,
          mergedCount: merged.mergeStats?.[platform]?.mergedCount || 0,
          plateauCount: plateau.get(platform) || 0,
          status: stalled ? "plateau" : (row?.archivedItems || 0) >= TARGET ? "done" : "running",
          error: collected.errors[platform],
        };
      }),
    });
  } catch (error) {
    await updateTrendBackfillProgress({
      active: false,
      finishedAt: new Date().toISOString(),
      status: "failed",
      note: error instanceof Error ? error.message : String(error),
    });
    console.warn("[growth.backfill] step failed:", error);
  } finally {
    backfillInFlight = false;
  }
}

export async function bootstrapGrowthTrendBackfillWorker() {
  if (backfillStarted) return;
  backfillStarted = true;
  await runGrowthTrendBackfillStep();
  scheduleNextBackfillStep();
}

export function stopGrowthTrendBackfillWorker() {
  if (backfillTimer) {
    clearTimeout(backfillTimer);
    backfillTimer = null;
  }
  backfillStarted = false;
}
