import type { GrowthPlatform } from "@shared/growth";
import { collectTrendPlatforms } from "./trendCollector";
import { mergeTrendCollections, readGrowthDebugSummary, readTrendRuntimeMeta, updateTrendBackfillProgress } from "./trendStore";
import { notifyGrowthCollectionUpdate } from "./trendMailDigest";
import { nowShanghaiIso } from "./time";

const MAX_ROUNDS = Math.max(1, Number(process.env.GROWTH_BACKFILL_ROUNDS || 20) || 20);
const PLATEAU_LIMIT = Math.max(2, Number(process.env.GROWTH_BACKFILL_PLATEAU_LIMIT || 3) || 3);
const HISTORY_MIN_INTERVAL_MS = 30 * 1000;
const HISTORY_MAX_INTERVAL_MS = 60 * 1000;
const HISTORY_STEP_TARGET = Math.max(5, Number(process.env.GROWTH_BACKFILL_STEP_TARGET || 10) || 10);
const HISTORY_STEP_FALLBACK = Math.max(5, Number(process.env.GROWTH_BACKFILL_STEP_FALLBACK || 5) || 5);
const PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "kuaishou", "bilibili", "toutiao"];

let backfillStarted = false;
let backfillTimer: ReturnType<typeof setTimeout> | null = null;
let backfillInFlight = false;
const plateau = new Map<GrowthPlatform, number>();
const previous = new Map<GrowthPlatform, number>();
let startedAt = "";

function isStorageFullError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /\bENOSPC\b|no space left on device/i.test(message);
}

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

type BackfillPlatformSnapshot = {
  platform: GrowthPlatform;
  currentTotal: number;
  archivedTotal: number;
};

type BackfillSnapshot = {
  currentRound: number;
  selectedWindowDays: number;
  platforms: BackfillPlatformSnapshot[];
};

async function readBackfillSnapshot(): Promise<BackfillSnapshot> {
  const [summary, runtimeMeta] = await Promise.all([
    readGrowthDebugSummary(),
    readTrendRuntimeMeta(),
  ]);
  return {
    currentRound: runtimeMeta.backfill?.currentRound || 0,
    selectedWindowDays: runtimeMeta.backfill?.selectedWindowDays || Number(process.env.GROWTH_TARGET_WINDOW_DAYS || 365) || 365,
    platforms: PLATFORMS.map((platform) => ({
      platform,
      currentTotal: summary?.platforms?.[platform]?.currentTotal || 0,
      archivedTotal: summary?.platforms?.[platform]?.archivedTotal || 0,
    })),
  };
}

function getPendingPlatforms(_stats: BackfillSnapshot) {
  return PLATFORMS.filter((platform) => {
    return (plateau.get(platform) || 0) < PLATEAU_LIMIT;
  });
}

export async function runGrowthTrendBackfillStep() {
  if (backfillInFlight) return;
  backfillInFlight = true;
  try {
    const statsBefore = await readBackfillSnapshot();
    const pending = getPendingPlatforms(statsBefore);
    if (!pending.length) {
      await updateTrendBackfillProgress({
        active: true,
        status: "running",
        selectedWindowDays: statsBefore.selectedWindowDays,
        note: "历史回填运行中：所有平台暂时进入低产出平台期，worker 保持运行，等待下一轮继续抓取。",
        platforms: PLATFORMS.map((platform) => {
          const row = statsBefore.platforms.find((item) => item.platform === platform);
          return {
            platform,
            target: 0,
            currentTotal: row?.currentTotal || 0,
            archivedTotal: row?.archivedTotal || 0,
            plateauCount: plateau.get(platform) || 0,
            status: "plateau",
          };
        }),
      });
      return;
    }

    const nextRound = Math.min(MAX_ROUNDS, (statsBefore.currentRound || 0) + 1);
    if (!startedAt) startedAt = nowShanghaiIso();
    await updateTrendBackfillProgress({
      active: true,
      startedAt,
      currentRound: nextRound,
      maxRounds: MAX_ROUNDS,
      targetPerPlatform: 0,
      selectedWindowDays: statsBefore.selectedWindowDays,
      status: "running",
      note: `历史回填运行中：按 30-60 秒真人节奏抖动抓取，目标步长 ${HISTORY_STEP_TARGET}，受限时回落到 ${HISTORY_STEP_FALLBACK}。不设平台总量上限，当前窗口 ${statsBefore.selectedWindowDays} 天。`,
      platforms: PLATFORMS.map((platform) => {
        const row = statsBefore.platforms.find((item) => item.platform === platform);
        return {
          platform,
          target: 0,
          currentTotal: row?.currentTotal || 0,
          archivedTotal: row?.archivedTotal || 0,
          plateauCount: plateau.get(platform) || 0,
          status: pending.includes(platform) ? "running" : "plateau",
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
    const statsAfter = await readBackfillSnapshot();

    for (const platform of pending) {
      const collection = collected.collections[platform];
      const mergedCollection = merged.collections[platform];
      if (collection?.source !== "live" || !mergedCollection?.items.length) continue;
      await notifyGrowthCollectionUpdate({
        platform,
        itemCount: mergedCollection.items.length,
        addedCount: merged.mergeStats?.[platform]?.addedCount || 0,
        mergedCount: merged.mergeStats?.[platform]?.mergedCount || 0,
        collectedAt: collection.collectedAt,
        nextRunAt: nowShanghaiIso(Date.now() + nextHistoryDelayMs()),
        frequencyLabel: `历史回填 / 30-60 秒真人节奏 / 目标步长 ${HISTORY_STEP_TARGET}`,
        burstMode: false,
        live: true,
        collection,
      }).catch((error) => {
        console.warn(`[growth.backfill] email notify skipped for ${platform}:`, error);
      });
    }

    for (const platform of pending) {
      const total = statsAfter.platforms.find((item) => item.platform === platform)?.archivedTotal || 0;
      const prev = previous.get(platform) || 0;
      previous.set(platform, total);
      plateau.set(platform, total <= prev ? (plateau.get(platform) || 0) + 1 : 0);
    }

    await updateTrendBackfillProgress({
      active: true,
      currentRound: nextRound,
      maxRounds: MAX_ROUNDS,
      targetPerPlatform: 0,
      selectedWindowDays: statsAfter.selectedWindowDays,
      status: "running",
      note: `历史回填运行中：按 30-60 秒真人节奏抖动抓取，目标步长 ${HISTORY_STEP_TARGET}，受限时回落到 ${HISTORY_STEP_FALLBACK}。不设平台总量上限，最新覆盖窗口 ${statsAfter.selectedWindowDays} 天。`,
      platforms: PLATFORMS.map((platform) => {
        const row = statsAfter.platforms.find((item) => item.platform === platform);
        const stalled = pending.includes(platform) && (plateau.get(platform) || 0) >= PLATEAU_LIMIT;
        return {
          platform,
          target: 0,
          currentTotal: row?.currentTotal || 0,
          archivedTotal: row?.archivedTotal || 0,
          addedCount: merged.mergeStats?.[platform]?.addedCount || 0,
          mergedCount: merged.mergeStats?.[platform]?.mergedCount || 0,
          plateauCount: plateau.get(platform) || 0,
          status: stalled ? "plateau" : "running",
          error: collected.errors[platform],
        };
      }),
    });
  } catch (error) {
    const stats = await readBackfillSnapshot().catch(() => null);
    const storageFull = isStorageFullError(error);
    await updateTrendBackfillProgress({
      active: true,
      finishedAt: storageFull ? undefined : nowShanghaiIso(),
      status: storageFull ? "running" : "failed",
      note: storageFull
        ? "历史回填运行中：磁盘空间不足，保留最后一次成功结果，等待 archive 外移后继续。"
        : (error instanceof Error ? error.message : String(error)),
      platforms: stats
        ? PLATFORMS.map((platform) => {
            const row = stats.platforms.find((item) => item.platform === platform);
            return {
              platform,
              target: 0,
              currentTotal: row?.currentTotal || 0,
              archivedTotal: row?.archivedTotal || 0,
              plateauCount: plateau.get(platform) || 0,
              status: (plateau.get(platform) || 0) >= PLATEAU_LIMIT ? "plateau" : "running",
              error: storageFull ? undefined : undefined,
            };
          })
        : undefined,
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
