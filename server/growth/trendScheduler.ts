import fs from "node:fs/promises";
import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import { collectPlatformTrends } from "./trendCollector";
import {
  bootstrapGrowthTrendBackfillWorker,
  bootstrapGrowthTrendLiveBackfillWorker,
  stopGrowthTrendBackfillWorker,
  stopGrowthTrendLiveBackfillWorker,
} from "./trendBackfill";
import {
  readTrendSchedulerState,
  mergeTrendCollections,
  reconcileTrendHistoryState,
  updateTrendSchedulerState,
} from "./trendStore";
import { notifyGrowthCollectionUpdate } from "./trendMailDigest";
import { nowShanghaiIso } from "./time";

const PRIORITY_PLATFORMS: GrowthPlatform[] = ["douyin", "kuaishou", "bilibili", "xiaohongshu", "toutiao"];
const RETRY_BASE_MS = 5 * 60 * 1000;
const RETRY_MAX_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.GROWTH_SCHEDULER_RETRY_MAX_MS || 30 * 60 * 1000) || 30 * 60 * 1000,
);
const CHECK_INTERVAL_MS = 60 * 1000;
const JITTER_MAX_MS = Math.max(
  0,
  Number(process.env.GROWTH_SCHEDULER_JITTER_MAX_MS || 0) || 0,
);
const SCHEDULER_INTERVAL_MINUTES = Math.max(5, Number(process.env.GROWTH_SCHEDULER_INTERVAL_MINUTES || 30) || 30);
const BURST_INTERVAL_MINUTES = Math.max(5, Number(process.env.GROWTH_BURST_INTERVAL_MINUTES || 10) || 10);
const LOW_YIELD_INTERVAL_MINUTES = Math.max(1, Number(process.env.GROWTH_BURST_LOW_YIELD_INTERVAL_MINUTES || 2) || 2);
const LOW_YIELD_LIMIT = Math.max(1, Number(process.env.GROWTH_BURST_LOW_YIELD_LIMIT || 5) || 5);
const BURST_TRIGGER_MIN_COUNT = Math.max(6, Number(process.env.GROWTH_BURST_TRIGGER_MIN_COUNT || 10) || 10);
const BURST_TRIGGER_GROWTH_RATIO = Math.max(0.1, Number(process.env.GROWTH_BURST_TRIGGER_GROWTH_RATIO || 0.2) || 0.2);
const BURST_EXIT_DROP_RATIO = Math.max(0.05, Number(process.env.GROWTH_BURST_EXIT_DROP_RATIO || 0.3) || 0.3);
const BURST_MIN_STABLE_RUNS = Math.max(1, Number(process.env.GROWTH_BURST_MIN_STABLE_RUNS || 2) || 2);
const SCHEDULER_TIMEZONE = "Asia/Shanghai";
const LIVE_WINDOW_START_HOUR = Math.max(0, Math.min(23, Number(process.env.GROWTH_LIVE_WINDOW_START_HOUR || 7) || 7));
const LIVE_WINDOW_END_HOUR = Math.max(0, Math.min(23, Number(process.env.GROWTH_LIVE_WINDOW_END_HOUR || 1) || 1));
const BACKFILL_WINDOW_START_HOUR = Math.max(0, Math.min(23, Number(process.env.GROWTH_BACKFILL_WINDOW_START_HOUR || 1) || 1));
const BACKFILL_WINDOW_END_HOUR = Math.max(0, Math.min(23, Number(process.env.GROWTH_BACKFILL_WINDOW_END_HOUR || 6) || 6));
const FORCE_BURST_PLATFORMS = new Set(
  String(process.env.GROWTH_FORCE_BURST_PLATFORMS || "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean),
);
const FORCE_BURST_UNTIL_MS = (() => {
  const raw = String(process.env.GROWTH_FORCE_BURST_UNTIL || "").trim();
  if (!raw) return 0;
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
})();
const ENABLE_BACKFILL_BOOTSTRAP = /^(1|true|yes)$/i.test(
  String(process.env.GROWTH_ENABLE_BACKFILL_BOOTSTRAP || "").trim(),
);
const DISABLE_BACKFILL_ON_LARGE_STORE = !/^(0|false|no)$/i.test(
  String(process.env.GROWTH_DISABLE_BACKFILL_ON_LARGE_STORE || "1").trim(),
);
const BACKFILL_STORE_SIZE_LIMIT_MB = Math.max(
  64,
  Number(process.env.GROWTH_BACKFILL_STORE_SIZE_LIMIT_MB || 128) || 128,
);
const PLATFORM_RUN_TIMEOUT_MS = Math.max(
  30 * 1000,
  Number(process.env.GROWTH_PLATFORM_RUN_TIMEOUT_MS || 90 * 1000) || 90 * 1000,
);
const STALE_SCHEDULER_FORCE_RUN_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.GROWTH_SCHEDULER_STALE_FORCE_RUN_MS || 20 * 60 * 1000) || 20 * 60 * 1000,
);
let schedulerStarted = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;
function isStorageFullError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /\bENOSPC\b|no space left on device/i.test(message);
}

function withJitter(baseMs: number) {
  return baseMs + Math.floor(Math.random() * JITTER_MAX_MS);
}

function nextRunIso(baseMs: number) {
  return nowShanghaiIso(Date.now() + withJitter(baseMs));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function readPlatformMinutesEnv(platform: GrowthPlatform, suffix: string, fallbackMinutes: number) {
  const value = Number(process.env[`${platform.toUpperCase()}_${suffix}`] || fallbackMinutes);
  return Number.isFinite(value) ? Math.max(1, value) : fallbackMinutes;
}

function getPlatformBurstIntervalMinutes(platform: GrowthPlatform) {
  return readPlatformMinutesEnv(platform, "BURST_INTERVAL_MINUTES", BURST_INTERVAL_MINUTES);
}

function getPlatformBurstIntervalMs(platform: GrowthPlatform) {
  return getPlatformBurstIntervalMinutes(platform) * 60 * 1000;
}

function getPlatformLowYieldIntervalMinutes(platform: GrowthPlatform) {
  return readPlatformMinutesEnv(platform, "BURST_LOW_YIELD_INTERVAL_MINUTES", LOW_YIELD_INTERVAL_MINUTES);
}

function getPlatformLowYieldIntervalMs(platform: GrowthPlatform) {
  return getPlatformLowYieldIntervalMinutes(platform) * 60 * 1000;
}

function getPlatformBurstTriggerMinCount(platform: GrowthPlatform) {
  return Math.max(1, readPlatformMinutesEnv(platform, "BURST_TRIGGER_MIN_COUNT", BURST_TRIGGER_MIN_COUNT));
}

function getPlatformBurstTriggerGrowthRatio(platform: GrowthPlatform) {
  const value = Number(process.env[`${platform.toUpperCase()}_BURST_TRIGGER_GROWTH_RATIO`] || BURST_TRIGGER_GROWTH_RATIO);
  return Number.isFinite(value) ? Math.max(0.05, value) : BURST_TRIGGER_GROWTH_RATIO;
}

function getPlatformBurstExitDropRatio(platform: GrowthPlatform) {
  const value = Number(process.env[`${platform.toUpperCase()}_BURST_EXIT_DROP_RATIO`] || BURST_EXIT_DROP_RATIO);
  return Number.isFinite(value) ? Math.max(0.05, value) : BURST_EXIT_DROP_RATIO;
}

function getSchedulerHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULER_TIMEZONE,
    hour: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const hourPart = parts.find((part) => part.type === "hour")?.value;
  return Number(hourPart || 0);
}

function isHourInWindow(hour: number, startHour: number, endHour: number) {
  if (startHour === endHour) return true;
  if (startHour < endHour) return hour >= startHour && hour < endHour;
  return hour >= startHour || hour < endHour;
}

function isLiveWindow(now = new Date()) {
  return isHourInWindow(getSchedulerHour(now), LIVE_WINDOW_START_HOUR, LIVE_WINDOW_END_HOUR);
}

function isBackfillWindow(now = new Date()) {
  return isHourInWindow(getSchedulerHour(now), BACKFILL_WINDOW_START_HOUR, BACKFILL_WINDOW_END_HOUR);
}

function getShanghaiDateParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHEDULER_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    weekday: get("weekday"),
    isoDate: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function isWeekendOrHoliday(now = new Date()) {
  const { weekday, isoDate } = getShanghaiDateParts(now);
  if (weekday === "Sat" || weekday === "Sun") return true;
  const configured = String(process.env.GROWTH_HOLIDAY_DATES || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.includes(isoDate);
}

function getSchedulerIntervalMinutes(_now = new Date()) {
  return SCHEDULER_INTERVAL_MINUTES;
}

function nextScheduledRunIso(now = new Date()) {
  return nextRunIso(getSchedulerIntervalMinutes(now) * 60 * 1000);
}

function getSchedulerFrequencyLabel(now = new Date()) {
  const interval = getSchedulerIntervalMinutes(now);
  if (interval < 60) return `每 ${interval} 分钟一次`;
  return `每 ${interval / 60} 小时一次`;
}

function getBurstFrequencyLabel(platform: GrowthPlatform) {
  return `${getPlatformBurstIntervalMinutes(platform)} 分钟一次`;
}

function getLowYieldFrequencyLabel(platform: GrowthPlatform) {
  return `低产出回退 / 每 ${getPlatformLowYieldIntervalMinutes(platform)} 分钟一次`;
}

function getForceBurstLabel(platform: GrowthPlatform) {
  const until = FORCE_BURST_UNTIL_MS
    ? new Intl.DateTimeFormat("zh-CN", {
        timeZone: SCHEDULER_TIMEZONE,
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(FORCE_BURST_UNTIL_MS))
    : "手动关闭";
  return `强制 burst（至 ${until}）/${getPlatformBurstIntervalMinutes(platform)} 分钟一次`;
}

function isForceBurstActive(platform: GrowthPlatform) {
  return FORCE_BURST_UNTIL_MS > Date.now() && FORCE_BURST_PLATFORMS.has(platform);
}

function isClearlyHigherThanPrevious(platform: GrowthPlatform, currentCount: number, previousCount: number) {
  if (previousCount <= 0) return currentCount >= getPlatformBurstTriggerMinCount(platform);
  return currentCount >= previousCount + Math.max(3, Math.ceil(previousCount * getPlatformBurstTriggerGrowthRatio(platform)));
}

function resolveNextRunPlan(params: {
  platform: GrowthPlatform;
  currentCount: number;
  previousCount: number;
  burstMode: boolean;
  burstStableRuns: number;
  burstLowYieldRuns: number;
}) {
  if (isForceBurstActive(params.platform)) {
    const lowYieldRuns = isClearlyHigherThanPrevious(params.platform, params.currentCount, params.previousCount)
      ? 0
      : params.burstLowYieldRuns + 1;
    const lowYieldMode = lowYieldRuns >= LOW_YIELD_LIMIT;
    return {
      burstMode: true,
      nextRunAt: nextRunIso(lowYieldMode ? getPlatformLowYieldIntervalMs(params.platform) : getPlatformBurstIntervalMs(params.platform)),
      frequencyLabel: lowYieldMode ? getLowYieldFrequencyLabel(params.platform) : getForceBurstLabel(params.platform),
      burstStableRuns: params.burstStableRuns,
      burstLowYieldRuns: lowYieldRuns,
      burstEvent: params.burstMode ? ("stay" as const) : ("enter" as const),
    };
  }

  if (params.burstMode) {
    const exitThreshold = Math.max(0, Math.floor(params.previousCount * (1 - getPlatformBurstExitDropRatio(params.platform))));
    if (params.currentCount < exitThreshold && params.burstStableRuns >= BURST_MIN_STABLE_RUNS) {
      return {
        burstMode: false,
        nextRunAt: nextScheduledRunIso(),
        frequencyLabel: getSchedulerFrequencyLabel(),
        burstStableRuns: 0,
        burstLowYieldRuns: 0,
        burstEvent: "exit" as const,
      };
    }
    const lowYieldRuns = isClearlyHigherThanPrevious(params.platform, params.currentCount, params.previousCount)
      ? 0
      : params.burstLowYieldRuns + 1;
    const lowYieldMode = lowYieldRuns >= LOW_YIELD_LIMIT;
    return {
      burstMode: true,
      nextRunAt: nextRunIso(lowYieldMode ? getPlatformLowYieldIntervalMs(params.platform) : getPlatformBurstIntervalMs(params.platform)),
      frequencyLabel: lowYieldMode ? getLowYieldFrequencyLabel(params.platform) : getBurstFrequencyLabel(params.platform),
      burstStableRuns: params.currentCount >= params.previousCount ? params.burstStableRuns + 1 : 0,
      burstLowYieldRuns: lowYieldRuns,
      burstEvent: "stay" as const,
    };
  }

  if (isClearlyHigherThanPrevious(params.platform, params.currentCount, params.previousCount)) {
    return {
      burstMode: true,
      nextRunAt: nextRunIso(getPlatformBurstIntervalMs(params.platform)),
      frequencyLabel: getBurstFrequencyLabel(params.platform),
      burstStableRuns: 0,
      burstLowYieldRuns: 0,
      burstEvent: "enter" as const,
    };
  }

  return {
    burstMode: false,
    nextRunAt: nextScheduledRunIso(),
    frequencyLabel: getSchedulerFrequencyLabel(),
    burstStableRuns: 0,
    burstLowYieldRuns: 0,
    burstEvent: "none" as const,
  };
}

function buildRetryDelayMs(failureCount: number) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.max(1, 2 ** Math.max(0, failureCount - 1)));
}

async function runPlatform(platform: GrowthPlatform) {
  const startedAt = nowShanghaiIso();
  const startedAtMs = Date.now();
  const currentState = (await readTrendSchedulerState())[platform];
  const provisionalBurst = Boolean(currentState?.burstMode) || isForceBurstActive(platform);
  await updateTrendSchedulerState(platform, {
    lastRunAt: startedAt,
    nextRunAt: provisionalBurst ? nextRunIso(getPlatformBurstIntervalMs(platform)) : nextScheduledRunIso(),
    burstMode: provisionalBurst,
    burstTriggeredAt: provisionalBurst ? (currentState?.burstTriggeredAt || startedAt) : undefined,
    lastFrequencyLabel: provisionalBurst
      ? (isForceBurstActive(platform) ? getForceBurstLabel(platform) : getBurstFrequencyLabel(platform))
      : getSchedulerFrequencyLabel(),
    lastError: undefined,
  });

  try {
    const collection = await withTimeout(
      collectPlatformTrends(platform),
      PLATFORM_RUN_TIMEOUT_MS,
      `[growth.scheduler] ${platform}`,
    );
    const mergedStore = await mergeTrendCollections({ [platform]: collection });
    const mergedCollection = mergedStore.collections[platform];
    const currentCount = collection.stats?.itemCount || collection.items.length;
    const previousCount = currentState?.lastCollectedCount || 0;
    const plan = resolveNextRunPlan({
      platform,
      currentCount,
      previousCount,
      burstMode: Boolean(currentState?.burstMode),
      burstStableRuns: currentState?.burstStableRuns || 0,
      burstLowYieldRuns: currentState?.burstLowYieldRuns || 0,
    });
    await updateTrendSchedulerState(platform, {
      lastSuccessAt: collection.collectedAt,
      nextRunAt: plan.nextRunAt,
      failureCount: 0,
      totalRuns: (currentState?.totalRuns || 0) + 1,
      successCount: (currentState?.successCount || 0) + 1,
      lastDurationMs: Date.now() - startedAtMs,
      lastCollectedCount: currentCount,
      lastAddedCount: mergedStore.mergeStats?.[platform]?.addedCount || 0,
      lastMergedCount: mergedStore.mergeStats?.[platform]?.mergedCount || 0,
      burstMode: plan.burstMode,
      burstEnterCount: (currentState?.burstEnterCount || 0) + (plan.burstEvent === "enter" ? 1 : 0),
      burstExitCount: (currentState?.burstExitCount || 0) + (plan.burstEvent === "exit" ? 1 : 0),
      burstStableRuns: plan.burstStableRuns,
      burstLowYieldRuns: plan.burstLowYieldRuns,
      burstTriggeredAt: plan.burstMode
        ? (currentState?.burstMode ? currentState?.burstTriggeredAt : collection.collectedAt)
        : undefined,
      lastFrequencyLabel: plan.frequencyLabel,
      lastError: undefined,
    });
    if (collection.source === "live" && currentCount > 0) {
      const mergeStat = mergedStore.mergeStats?.[platform];
      await notifyGrowthCollectionUpdate({
        platform,
        itemCount: currentCount,
        addedCount: mergeStat?.addedCount || 0,
        mergedCount: mergeStat?.mergedCount || 0,
        collectedAt: collection.collectedAt,
        nextRunAt: plan.nextRunAt,
        frequencyLabel: plan.frequencyLabel,
        burstMode: plan.burstMode,
        live: collection.source === "live",
        collection,
      }).catch((error) => {
        console.warn(`[growth.scheduler] email notify skipped for ${platform}:`, error);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = (await readTrendSchedulerState())[platform];
    const failureCount = (current?.failureCount || 0) + 1;
    const forcedBurst = isForceBurstActive(platform);
    const storageFull = isStorageFullError(error);
    await updateTrendSchedulerState(platform, {
      failureCount,
      totalRuns: (current?.totalRuns || 0) + 1,
      totalFailures: (current?.totalFailures || 0) + 1,
      lastDurationMs: Date.now() - startedAtMs,
      lastError: message,
      burstMode: forcedBurst,
      burstStableRuns: forcedBurst ? (current?.burstStableRuns || 0) : 0,
      burstLowYieldRuns: forcedBurst ? (current?.burstLowYieldRuns || 0) : 0,
      burstTriggeredAt: forcedBurst ? (current?.burstTriggeredAt || startedAt) : undefined,
      nextRunAt: forcedBurst
        ? nextRunIso(storageFull ? getPlatformBurstIntervalMs(platform) : getPlatformLowYieldIntervalMs(platform))
        : nextRunIso(buildRetryDelayMs(failureCount)),
      lastFrequencyLabel: forcedBurst
        ? (storageFull ? getBurstFrequencyLabel(platform) : getLowYieldFrequencyLabel(platform))
        : current?.lastFrequencyLabel,
    });
    console.warn(`[growth.scheduler] ${platform} failed:`, message);
  }
}

async function runDuePlatforms() {
  if (runInFlight) return;
  if (!isLiveWindow()) return;
  runInFlight = true;
  try {
    const scheduler = await readTrendSchedulerState();
    const queue = PRIORITY_PLATFORMS.filter((platform) => {
      const state = scheduler[platform];
      const nextRunAt = state?.nextRunAt;
      const lastRunAt = state?.lastRunAt;
      const staleSinceLastRun = lastRunAt
        ? Date.now() - new Date(lastRunAt).getTime() >= STALE_SCHEDULER_FORCE_RUN_MS
        : false;
      if (isForceBurstActive(platform) && staleSinceLastRun) return true;
      if (!nextRunAt) return true;
      return new Date(nextRunAt).getTime() <= Date.now();
    }).sort((left, right) => {
      const leftNext = scheduler[left]?.nextRunAt ? new Date(scheduler[left]!.nextRunAt!).getTime() : 0;
      const rightNext = scheduler[right]?.nextRunAt ? new Date(scheduler[right]!.nextRunAt!).getTime() : 0;
      return leftNext - rightNext;
    });

    for (const platform of queue) {
      await runPlatform(platform);
    }
  } finally {
    runInFlight = false;
  }
}

async function shouldBootstrapBackfill() {
  if (!ENABLE_BACKFILL_BOOTSTRAP) return false;
  if (!DISABLE_BACKFILL_ON_LARGE_STORE) return true;
  try {
    const storeDir = path.resolve(
      process.env.GROWTH_STORE_DIR || path.join(path.resolve(process.cwd(), ".cache"), "growth"),
    );
    const currentPath = path.join(storeDir, "current.json");
    const stat = await fs.stat(currentPath);
    const sizeMb = stat.size / 1024 / 1024;
    if (sizeMb > BACKFILL_STORE_SIZE_LIMIT_MB) {
      console.warn(
        `[growth.backfill] bootstrap skipped: current.json is ${sizeMb.toFixed(1)}MB, above safety limit ${BACKFILL_STORE_SIZE_LIMIT_MB}MB.`,
      );
      return false;
    }
  } catch {
    return true;
  }
  return true;
}

export async function bootstrapGrowthTrendScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (!/^(1|true|yes)$/i.test(String(process.env.GROWTH_DISABLE_HISTORY_LEDGER_UPDATES || "").trim())) {
    await reconcileTrendHistoryState().catch((error) => {
      console.warn("[growth.history] reconcile on bootstrap failed:", error);
    });
  }

  const scheduler = await readTrendSchedulerState();
  for (const platform of PRIORITY_PLATFORMS) {
    if (!scheduler[platform]?.nextRunAt) {
      await updateTrendSchedulerState(platform, {
        platform,
        failureCount: scheduler[platform]?.failureCount || 0,
        nextRunAt: nowShanghaiIso(),
      });
    }
  }

  if (await shouldBootstrapBackfill()) {
    if (isBackfillWindow()) {
      bootstrapGrowthTrendBackfillWorker().catch((error) => {
        console.warn("[growth.backfill] bootstrap failed:", error);
      });
      bootstrapGrowthTrendLiveBackfillWorker().catch((error) => {
        console.warn("[growth.backfill.live] bootstrap failed:", error);
      });
    } else {
      stopGrowthTrendBackfillWorker();
      stopGrowthTrendLiveBackfillWorker();
    }
  } else {
    console.info("[growth.backfill] bootstrap skipped; set GROWTH_ENABLE_BACKFILL_BOOTSTRAP=1 to enable automatic historical backfill on boot.");
  }
  runDuePlatforms().catch((error) => {
    console.warn("[growth.scheduler] initial bootstrap failed:", error);
  });

  tickTimer = setInterval(() => {
    if (isBackfillWindow()) {
      bootstrapGrowthTrendBackfillWorker().catch((error) => {
        console.warn("[growth.backfill] periodic bootstrap failed:", error);
      });
      bootstrapGrowthTrendLiveBackfillWorker().catch((error) => {
        console.warn("[growth.backfill.live] periodic bootstrap failed:", error);
      });
    } else {
      stopGrowthTrendBackfillWorker();
      stopGrowthTrendLiveBackfillWorker();
    }
    runDuePlatforms().catch((error) => {
      console.warn("[growth.scheduler] periodic tick failed:", error);
    });
  }, CHECK_INTERVAL_MS);
}

export function stopGrowthTrendScheduler() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
  stopGrowthTrendBackfillWorker();
  stopGrowthTrendLiveBackfillWorker();
  schedulerStarted = false;
}
