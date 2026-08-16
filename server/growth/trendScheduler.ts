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
  bootstrapTrendHistoryFromColdStore,
  ensureGrowthStoreSplitGzipLayout,
  readTrendSchedulerState,
  mergeTrendCollections,
  readGrowthRuntimeControl,
  reconcileTrendHistoryState,
  resetTrendRuntimeForDeploy,
  updateTrendSchedulerState,
} from "./trendStore";
import { notifyGrowthCollectionUpdate } from "./trendMailDigest";
import { nowShanghaiIso } from "./time";
import { backfillRecentTrendCoverUrls } from "./trendCoverSelection";
import {
  buildTimeoutCooldownMs,
  formatTimeoutCooldownLabel,
  isSchedulerTimeoutOrAbortError,
  withAbortableTimeout,
} from "./collectorAbort.js";
import { runInGrowthPlatformCollectionLane } from "./platformCollectionLane";
import { maybeCheckDouyinCredentialHealth } from "./douyinCredentialHealth";
import {
  hasActiveGrowthInteractiveWorkload,
  isGrowthInteractivePriorityAbortError,
} from "./growthWorkloadPriority";

/** Fly 只调度仍在运营的三个远端平台；视频号由本机采集，快手/头条已退休。 */
const PRIORITY_PLATFORMS: GrowthPlatform[] = ["douyin", "bilibili", "xiaohongshu"];
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
const BURST_INTERVAL_MINUTES = 15;
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
const BACKFILL_FAST_START_ENABLED = !/^(0|false|no)$/i.test(
  String(process.env.GROWTH_BACKFILL_FAST_START || "1").trim(),
);
const PLATFORM_RUN_TIMEOUT_MS = Math.max(
  30 * 1000,
  Number(process.env.GROWTH_PLATFORM_RUN_TIMEOUT_MS || 90 * 1000) || 90 * 1000,
);
const DOUYIN_MIN_RUN_TIMEOUT_MS = 180 * 1000;
const COVER_BACKFILL_RUN_TIMEOUT_MS = Math.max(
  30 * 1000,
  Number(process.env.GROWTH_COVER_BACKFILL_RUN_TIMEOUT_MS || 90 * 1000) || 90 * 1000,
);
const STALE_SCHEDULER_FORCE_RUN_MS = Math.max(
  5 * 60 * 1000,
  Number(process.env.GROWTH_SCHEDULER_STALE_FORCE_RUN_MS || 20 * 60 * 1000) || 20 * 60 * 1000,
);
const SCHEDULER_BOOT_GRACE_MS = Math.max(
  15 * 1000,
  Number(process.env.GROWTH_SCHEDULER_BOOT_GRACE_MS || 2 * 60 * 1000) || 2 * 60 * 1000,
);
const INITIAL_PLATFORM_SPACING_MS = Math.max(
  15 * 1000,
  Number(process.env.GROWTH_SCHEDULER_INITIAL_PLATFORM_SPACING_MS || 90 * 1000) || 90 * 1000,
);
let schedulerStarted = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;
let runtimeModeOverride: "auto" | "live" | "backfill" = "auto";
let runtimeBurstOverride: "auto" | "manual" | "off" = "auto";
let runtimeBurstPlatformsOverride = new Set<GrowthPlatform>();
let livePlatformCursor = 0;

async function refreshRuntimeModeOverride() {
  const control = await readGrowthRuntimeControl();
  runtimeModeOverride = control?.mode || "auto";
  runtimeBurstOverride = control?.burst || "auto";
  runtimeBurstPlatformsOverride = new Set(control?.burstPlatforms || []);
  return runtimeModeOverride;
}
function isStorageFullError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /\bENOSPC\b|no space left on device|Invalid string length|growth_store_json_too_large/i.test(message);
}

function withJitter(baseMs: number) {
  return baseMs + Math.floor(Math.random() * JITTER_MAX_MS);
}

function nextRunIso(baseMs: number) {
  return nowShanghaiIso(Date.now() + withJitter(baseMs));
}

function nextBootRunIso(order: number) {
  return nowShanghaiIso(Date.now() + SCHEDULER_BOOT_GRACE_MS + (order * INITIAL_PLATFORM_SPACING_MS));
}

function readPlatformMinutesEnv(platform: GrowthPlatform, suffix: string, fallbackMinutes: number) {
  const value = Number(process.env[`${platform.toUpperCase()}_${suffix}`] || fallbackMinutes);
  return Number.isFinite(value) ? Math.max(1, value) : fallbackMinutes;
}

function getPlatformBurstIntervalMinutes(_platform: GrowthPlatform) {
  // burst 是正式 15 分钟节奏；不再允许遗留平台级 secret 把某个平台改回旧频率。
  return BURST_INTERVAL_MINUTES;
}

export function resolvePlatformRunTimeoutMs(
  platform: GrowthPlatform,
  values: { preferred?: unknown; legacy?: unknown; fallback?: unknown },
) {
  const candidates = [values.preferred, values.legacy, values.fallback]
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 30 * 1000);
  const configured = candidates[0] || PLATFORM_RUN_TIMEOUT_MS;
  // 线上遗留 secret 曾把抖音覆盖回 60 秒；24 页 feed 加正式增强路由无法在该预算内完成，
  // 结果整轮连续超时且零提交。抖音的 180 秒下限与 fly.toml 的正式配置保持一致。
  return platform === "douyin"
    ? Math.max(DOUYIN_MIN_RUN_TIMEOUT_MS, configured)
    : configured;
}

function getPlatformRunTimeoutMs(platform: GrowthPlatform) {
  return resolvePlatformRunTimeoutMs(platform, {
    preferred: process.env[`GROWTH_${platform.toUpperCase()}_PLATFORM_RUN_TIMEOUT_MS`],
    legacy: process.env[`${platform.toUpperCase()}_PLATFORM_RUN_TIMEOUT_MS`],
    fallback: PLATFORM_RUN_TIMEOUT_MS,
  });
}

function getPlatformBurstIntervalMs(platform: GrowthPlatform) {
  return getPlatformBurstIntervalMinutes(platform) * 60 * 1000;
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
  if (runtimeModeOverride === "live") return true;
  if (runtimeModeOverride === "backfill") return false;
  return isHourInWindow(getSchedulerHour(now), LIVE_WINDOW_START_HOUR, LIVE_WINDOW_END_HOUR);
}

function isBackfillWindow(now = new Date()) {
  if (runtimeModeOverride === "backfill") return true;
  if (runtimeModeOverride === "live") return false;
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

function getForceBurstLabel(platform: GrowthPlatform) {
  if (runtimeBurstOverride === "manual" && runtimeBurstPlatformsOverride.has(platform)) {
    return `手动 burst / ${getPlatformBurstIntervalMinutes(platform)} 分钟一次`;
  }
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
  if (runtimeBurstOverride === "off") return false;
  if (runtimeBurstOverride === "manual") return runtimeBurstPlatformsOverride.has(platform);
  return isLiveWindow()
    && !isBackfillWindow()
    && FORCE_BURST_UNTIL_MS > Date.now()
    && FORCE_BURST_PLATFORMS.has(platform);
}

export function shouldClearBurstStatesBecauseDisabled(mode: "auto" | "manual" | "off") {
  return mode === "off";
}

export function resolveLastNewDataAt(input: {
  addedCount: number;
  collectedAt: string;
  lastNewDataAt?: string;
  lastAddedCount?: number;
  lastSuccessAt?: string;
}) {
  if (input.addedCount > 0) return input.collectedAt;
  return input.lastNewDataAt
    || ((input.lastAddedCount || 0) > 0 ? input.lastSuccessAt : undefined);
}

export function resolveNewDataMonitoringStartedAt(input: {
  monitoringStartedAt?: string;
  lastSuccessAt?: string;
  lastRunAt?: string;
  startedAt: string;
}) {
  return input.monitoringStartedAt
    || input.lastSuccessAt
    || input.lastRunAt
    || input.startedAt;
}

async function clearStaleBurstStates(reason: "disabled" | "backfill-window") {
  const scheduler = await readTrendSchedulerState();
  for (const platform of PRIORITY_PLATFORMS) {
    const state = scheduler[platform];
    if (!state?.burstMode) continue;
    await updateTrendSchedulerState(platform, {
      burstMode: false,
      burstTriggeredAt: undefined,
      burstStableRuns: 0,
      burstLowYieldRuns: 0,
      nextRunAt: nextScheduledRunIso(),
      lastFrequencyLabel: reason === "backfill-window"
        ? "夜间 backfill 窗口 / live burst 已关闭"
        : getSchedulerFrequencyLabel(),
      lastError: state.lastError,
    });
  }
}

function isClearlyHigherThanPrevious(platform: GrowthPlatform, currentCount: number, previousCount: number) {
  if (previousCount <= 0) return currentCount >= getPlatformBurstTriggerMinCount(platform);
  return currentCount >= previousCount + Math.max(3, Math.ceil(previousCount * getPlatformBurstTriggerGrowthRatio(platform)));
}

export function resolveNextRunPlan(params: {
  platform: GrowthPlatform;
  currentCount: number;
  previousCount: number;
  burstMode: boolean;
  burstStableRuns: number;
  burstLowYieldRuns: number;
  burstControl?: "auto" | "manual" | "off";
}) {
  if (isForceBurstActive(params.platform)) {
    return {
      burstMode: true,
      nextRunAt: nextRunIso(getPlatformBurstIntervalMs(params.platform)),
      frequencyLabel: getForceBurstLabel(params.platform),
      burstStableRuns: 0,
      burstLowYieldRuns: 0,
      burstEvent: params.burstMode ? ("stay" as const) : ("enter" as const),
    };
  }

  // “全部关闭”与未勾选的手动平台都必须禁止自动重新进入 burst；此前高增量
  // 仍会穿透 UI 控制重新开启。manual 被勾选的平台已在上方 force 分支处理。
  if (params.burstControl === "off" || params.burstControl === "manual") {
    return {
      burstMode: false,
      nextRunAt: nextScheduledRunIso(),
      frequencyLabel: getSchedulerFrequencyLabel(),
      burstStableRuns: 0,
      burstLowYieldRuns: 0,
      burstEvent: params.burstMode ? ("exit" as const) : ("none" as const),
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
    return {
      burstMode: true,
      // burst 的正式节奏固定为 15 分钟；低产出只保留诊断计数，不再偷偷切成 2 分钟。
      nextRunAt: nextRunIso(getPlatformBurstIntervalMs(params.platform)),
      frequencyLabel: getBurstFrequencyLabel(params.platform),
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

export function resolvePreviousRunCollectedCount(state?: {
  lastAfterWindowFilterCount?: number;
  lastAfterDedupCount?: number;
  lastCollectedCount?: number;
}) {
  return state?.lastAfterWindowFilterCount
    ?? state?.lastAfterDedupCount
    ?? state?.lastCollectedCount
    ?? 0;
}

function buildRetryDelayMs(failureCount: number) {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * Math.max(1, 2 ** Math.max(0, failureCount - 1)));
}

export function resolveTimeoutCooldownGate(state?: {
  timeoutCooldownUntil?: string;
  nextRunAt?: string;
  lastError?: string;
  lastFailureAt?: string;
  lastRunAt?: string;
  timeoutStreak?: number;
}, nowMs = Date.now()): {
  active: boolean;
  shouldNormalize: boolean;
  normalizedUntilMs?: number;
} {
  const hasPersistedTimeout = Boolean(
    state?.timeoutCooldownUntil
      && (state.timeoutStreak || 0) > 0,
  );
  if (!state || (!hasPersistedTimeout && !isSchedulerTimeoutOrAbortError(state.lastError))) {
    return { active: false, shouldNormalize: false };
  }
  const persistedUntilMs = state.timeoutCooldownUntil
    ? new Date(state.timeoutCooldownUntil).getTime()
    : state.nextRunAt
      ? new Date(state.nextRunAt).getTime()
      : 0;
  if (!Number.isFinite(persistedUntilMs) || persistedUntilMs <= nowMs) {
    return { active: false, shouldNormalize: false };
  }
  const failedAtMs = state.lastFailureAt
    ? new Date(state.lastFailureAt).getTime()
    : state.lastRunAt
      ? new Date(state.lastRunAt).getTime()
      : NaN;
  const policyUntilMs = Number.isFinite(failedAtMs)
    ? failedAtMs + buildTimeoutCooldownMs(state.timeoutStreak || 1)
    : nowMs + buildTimeoutCooldownMs(state.timeoutStreak || 1);
  const normalizedUntilMs = Math.min(persistedUntilMs, policyUntilMs);
  return {
    active: normalizedUntilMs > nowMs,
    shouldNormalize: normalizedUntilMs !== persistedUntilMs || !state.timeoutCooldownUntil,
    normalizedUntilMs,
  };
}

function isInTimeoutCooldown(state?: Parameters<typeof resolveTimeoutCooldownGate>[0]): boolean {
  return resolveTimeoutCooldownGate(state).active;
}

/**
 * 核心 collection 已 merge 后，封面回补只属于非核心增强。即使为前台任务主动
 * abort，也必须保留本轮真实新增并继续写 lastSuccess/lastAdded，避免 24h 假告警。
 */
export async function runPostMergeCoverEnhancement<T>(
  work: () => Promise<T>,
): Promise<
  | { ok: true; value: T }
  | { ok: false; error: unknown; priorityAborted: boolean }
> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return {
      ok: false,
      error,
      priorityAborted: isGrowthInteractivePriorityAbortError(error),
    };
  }
}

async function runPlatformTask(platform: GrowthPlatform) {
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
    // 首次尝试即固定监测起点；后续连续失败不得用新的 lastRunAt 把 24 小时告警往后推。
    newDataMonitoringStartedAt: resolveNewDataMonitoringStartedAt({
      monitoringStartedAt: currentState?.newDataMonitoringStartedAt,
      lastSuccessAt: currentState?.lastSuccessAt,
      lastRunAt: currentState?.lastRunAt,
      startedAt,
    }),
    lastError: undefined,
  });

  try {
    const collection = await withAbortableTimeout(
      (signal) => collectPlatformTrends(platform, { signal }),
      getPlatformRunTimeoutMs(platform),
      `[growth.scheduler] ${platform}`,
      { abortWhen: hasActiveGrowthInteractiveWorkload },
    );
    let mergedStore = await mergeTrendCollections({ [platform]: collection });
    // 封面回填会再执行一次 merge；第二次通常 addedCount=0，不能覆盖真实抓取轮的新增量。
    const collectionMergeStat = mergedStore.mergeStats?.[platform];
    const mergedBeforeBackfill = mergedStore.collections[platform];
    if (mergedBeforeBackfill) {
      const coverOutcome = await runPostMergeCoverEnhancement(() => withAbortableTimeout(
          (signal) => backfillRecentTrendCoverUrls(
            platform,
            mergedBeforeBackfill,
            Date.now(),
            { signal },
          ),
          COVER_BACKFILL_RUN_TIMEOUT_MS,
          `[growth.scheduler.cover-backfill] ${platform}`,
          { abortWhen: hasActiveGrowthInteractiveWorkload },
        ));
      if (coverOutcome.ok) {
        if (coverOutcome.value.resolved > 0) {
          mergedStore = await mergeTrendCollections({ [platform]: coverOutcome.value.collection });
        }
      } else if (coverOutcome.priorityAborted) {
        console.info(`[growth.scheduler] ${platform} 核心数据已提交；封面回补为前台任务让路。`);
      } else {
        // 封面是非核心增强：独立超时/网络失败时保留已提交的真实趋势数据，
        // 但该阶段自身仍会 abort，不能留下孤儿公网请求。
        console.warn(`[growth.scheduler] cover backfill skipped for ${platform}:`, coverOutcome.error);
      }
    }
    const currentCount = collection.stats?.itemCount || collection.items.length;
    // burst 比较必须保持“本轮采集量 vs 上轮采集量”同口径。旧逻辑把上轮字段写成
    // 整个仓库总量，几十万库存与几百条本轮结果比较，导致自动 burst 永远无法触发。
    const previousCount = resolvePreviousRunCollectedCount(currentState);
    const plan = resolveNextRunPlan({
      platform,
      currentCount,
      previousCount,
      burstMode: Boolean(currentState?.burstMode),
      burstStableRuns: currentState?.burstStableRuns || 0,
      burstLowYieldRuns: currentState?.burstLowYieldRuns || 0,
      burstControl: runtimeBurstOverride,
    });
    const addedCount = collectionMergeStat?.addedCount || 0;
    await updateTrendSchedulerState(platform, {
      lastSuccessAt: collection.collectedAt,
      nextRunAt: plan.nextRunAt,
      failureCount: 0,
      timeoutStreak: 0,
      timeoutCooldownUntil: undefined,
      totalRuns: (currentState?.totalRuns || 0) + 1,
      successCount: (currentState?.successCount || 0) + 1,
      lastDurationMs: Date.now() - startedAtMs,
      lastCollectedCount: currentCount,
      lastAddedCount: addedCount,
      lastNewDataAt: resolveLastNewDataAt({
        addedCount,
        collectedAt: collection.collectedAt,
        lastNewDataAt: currentState?.lastNewDataAt,
        lastAddedCount: currentState?.lastAddedCount,
        lastSuccessAt: currentState?.lastSuccessAt,
      }),
      newDataMonitoringStartedAt: resolveNewDataMonitoringStartedAt({
        monitoringStartedAt: currentState?.newDataMonitoringStartedAt,
        lastSuccessAt: currentState?.lastSuccessAt,
        lastRunAt: currentState?.lastRunAt,
        startedAt,
      }),
      lastMergedCount: collectionMergeStat?.mergedCount || 0,
      lastRawFetchedCount: collection.stats?.rawFetchedCount,
      lastAfterDedupCount: collection.stats?.afterDedupCount ?? collection.items.length,
      lastAfterWindowFilterCount: collection.stats?.afterWindowFilterCount,
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
      await notifyGrowthCollectionUpdate({
        platform,
        itemCount: currentCount,
        addedCount,
        mergedCount: collectionMergeStat?.mergedCount || 0,
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
    if (isGrowthInteractivePriorityAbortError(error)) {
      const current = (await readTrendSchedulerState())[platform];
      await updateTrendSchedulerState(platform, {
        nextRunAt: nowShanghaiIso(Date.now() + 5 * 60_000),
        timeoutStreak: 0,
        timeoutCooldownUntil: undefined,
        burstMode: false,
        burstTriggeredAt: undefined,
        lastError: undefined,
        failureCount: current?.failureCount || 0,
        lastFrequencyLabel: "前台平台任务优先，后台采集已暂停",
      });
      console.info(`[growth.scheduler] ${platform} 已为前台平台任务让路。`);
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const current = (await readTrendSchedulerState())[platform];
    const failureCount = (current?.failureCount || 0) + 1;
    const timedOut = isSchedulerTimeoutOrAbortError(error);
    const timeoutStreak = timedOut ? (current?.timeoutStreak || 0) + 1 : 0;
    const forcedBurst = isForceBurstActive(platform) && !timedOut;
    const storageFull = isStorageFullError(error);
    // 超时/中止：退出 burst，进入冷却，本轮不再立刻重抓
    const cooldownMs = timedOut
      ? buildTimeoutCooldownMs(timeoutStreak)
      : forcedBurst
        ? getPlatformBurstIntervalMs(platform)
        : buildRetryDelayMs(failureCount);
    const cooldownUntil = timedOut
      ? nowShanghaiIso(Date.now() + cooldownMs)
      : undefined;
    await updateTrendSchedulerState(platform, {
      failureCount,
      timeoutStreak,
      timeoutCooldownUntil: cooldownUntil,
      totalRuns: (current?.totalRuns || 0) + 1,
      totalFailures: (current?.totalFailures || 0) + 1,
      lastFailureAt: nowShanghaiIso(),
      lastDurationMs: Date.now() - startedAtMs,
      lastError: message,
      burstMode: forcedBurst,
      burstStableRuns: forcedBurst ? (current?.burstStableRuns || 0) : 0,
      burstLowYieldRuns: forcedBurst ? (current?.burstLowYieldRuns || 0) : 0,
      burstTriggeredAt: forcedBurst ? (current?.burstTriggeredAt || startedAt) : undefined,
      burstExitCount:
        (current?.burstExitCount || 0) +
        (current?.burstMode && !forcedBurst ? 1 : 0),
      nextRunAt: nextRunIso(cooldownMs),
      lastFrequencyLabel: timedOut
        ? formatTimeoutCooldownLabel(cooldownMs)
        : forcedBurst
          ? getForceBurstLabel(platform)
          : current?.lastFrequencyLabel,
    });
    if (timedOut) {
      console.warn(
        `[growth.scheduler] ${platform} aborted/timeout → exit burst, cooldown ${Math.round(cooldownMs / 60_000)}min (streak=${timeoutStreak})` +
          (storageFull ? " [storage_full]" : ""),
        message,
      );
    } else {
      console.warn(`[growth.scheduler] ${platform} failed:`, message);
    }
  }
}

async function runPlatform(platform: GrowthPlatform) {
  const state = (await readTrendSchedulerState())[platform];
  const source = state?.burstMode || isForceBurstActive(platform)
    ? "burst"
    : runtimeModeOverride === "live"
      ? "live"
      : "scheduler";
  return runInGrowthPlatformCollectionLane(platform, source, () => runPlatformTask(platform));
}

async function runDuePlatforms() {
  if (runInFlight) return;
  if (!isLiveWindow()) return;
  if (await hasActiveGrowthInteractiveWorkload()) return;
  runInFlight = true;
  try {
    let scheduler = await readTrendSchedulerState();
    // PR #1250 前的状态可能把超时 nextRunAt 写到四小时以后。仅改新失败的常量不会
    // 迁移这批磁盘状态；每轮先按“失败时间 + 10 分钟”钳位，已过期的立即恢复可执行。
    let normalizedLegacyCooldown = false;
    for (const platform of PRIORITY_PLATFORMS) {
      const state = scheduler[platform];
      const gate = resolveTimeoutCooldownGate(state);
      if (!gate.shouldNormalize) continue;
      await updateTrendSchedulerState(platform, {
        nextRunAt: gate.active && gate.normalizedUntilMs
          ? nowShanghaiIso(gate.normalizedUntilMs)
          : nowShanghaiIso(),
        timeoutCooldownUntil: gate.active && gate.normalizedUntilMs
          ? nowShanghaiIso(gate.normalizedUntilMs)
          : undefined,
        timeoutStreak: gate.active ? state?.timeoutStreak : 0,
        lastFrequencyLabel: gate.active && gate.normalizedUntilMs
          ? formatTimeoutCooldownLabel(Math.max(0, gate.normalizedUntilMs - Date.now()))
          : getSchedulerFrequencyLabel(),
      });
      normalizedLegacyCooldown = true;
    }
    if (normalizedLegacyCooldown) {
      scheduler = await readTrendSchedulerState();
    }
    if (runtimeModeOverride === "live") {
      let touched = false;
      for (const platform of PRIORITY_PLATFORMS) {
        const state = scheduler[platform];
        // 超时冷却期内禁止 live 模式清零强制重跑
        if (isInTimeoutCooldown(state)) continue;
        const nextRunAtMs = state?.nextRunAt ? new Date(state.nextRunAt).getTime() : 0;
        const overdueMs = nextRunAtMs > 0 ? Date.now() - nextRunAtMs : 0;
        if (overdueMs < 5 * 60 * 1000) continue;
        await updateTrendSchedulerState(platform, {
          nextRunAt: nowShanghaiIso(),
          failureCount: 0,
          timeoutStreak: 0,
          timeoutCooldownUntil: undefined,
          lastError: undefined,
          burstMode: false,
          burstTriggeredAt: undefined,
          lastFrequencyLabel: getSchedulerFrequencyLabel(),
        });
        touched = true;
      }
      if (touched) {
        scheduler = await readTrendSchedulerState();
      }
    }
    const queue = PRIORITY_PLATFORMS.filter((platform) => {
      const state = scheduler[platform];
      // 冷却中：硬退出，本轮不进队列
      if (isInTimeoutCooldown(state)) return false;
      const nextRunAt = state?.nextRunAt;
      const lastRunAt = state?.lastRunAt;
      const staleSinceLastRun = lastRunAt
        ? Date.now() - new Date(lastRunAt).getTime() >= STALE_SCHEDULER_FORCE_RUN_MS
        : false;
      // 超时冷却优先于 force-burst 强制重跑
      if (isForceBurstActive(platform) && staleSinceLastRun && !isInTimeoutCooldown(state)) {
        return true;
      }
      if (!nextRunAt) return true;
      return new Date(nextRunAt).getTime() <= Date.now();
    });

    const liveQueue = (() => {
      if (runtimeModeOverride !== "live") return queue;
      if (!queue.length) return [];
      const dueSet = new Set(queue);
      for (let offset = 0; offset < PRIORITY_PLATFORMS.length; offset += 1) {
        const index = (livePlatformCursor + offset) % PRIORITY_PLATFORMS.length;
        const candidate = PRIORITY_PLATFORMS[index];
        if (!dueSet.has(candidate)) continue;
        livePlatformCursor = (index + 1) % PRIORITY_PLATFORMS.length;
        return [candidate];
      }
      return [];
    })();
    for (const platform of liveQueue) {
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

function shouldRunBackfillWorkersNow() {
  if (runtimeModeOverride === "live") return false;
  if (runtimeModeOverride === "backfill") return true;
  return isBackfillWindow() || BACKFILL_FAST_START_ENABLED;
}

export async function bootstrapGrowthTrendScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;
  await refreshRuntimeModeOverride().catch(() => "auto");

  const deployId = String(process.env.FLY_MACHINE_VERSION || process.env.FLY_IMAGE_REF || "").trim();
  await resetTrendRuntimeForDeploy(deployId).catch((error) => {
    console.warn("[growth.scheduler] deploy runtime reset failed:", error);
  });

  if (!/^(1|true|yes)$/i.test(String(process.env.GROWTH_DISABLE_HISTORY_LEDGER_UPDATES || "").trim())) {
    await reconcileTrendHistoryState().catch((error) => {
      console.warn("[growth.history] reconcile on bootstrap failed:", error);
    });
    await bootstrapTrendHistoryFromColdStore().catch((error) => {
      console.warn("[growth.history] cold-store bootstrap failed:", error);
    }).then((result) => {
      if (result?.note && !result.skipped) {
        console.info(`[growth.history] ${result.note}`);
      }
    });
  }

  await ensureGrowthStoreSplitGzipLayout().catch((error) => {
    console.warn("[growth.store] split+gzip bootstrap migration failed:", error);
  });

  // 凭证探针独立于平台采集和 backfill；读取持久化时间戳，24 小时内不会重复请求。
  // fire-and-forget 避免登录态探针阻塞调度器启动。
  void maybeCheckDouyinCredentialHealth().catch((error) => {
    console.warn("[growth.douyin.credentials] bootstrap probe failed:", error);
  });

  const scheduler = await readTrendSchedulerState();
  // auto 代表按采集增量自动进入 burst，不等于 disabled。旧逻辑只检查是否存在
  // force-burst 配置，过期后会在每次启动时误清自然 burst 状态。
  if (shouldClearBurstStatesBecauseDisabled(runtimeBurstOverride)) {
    await clearStaleBurstStates("disabled");
  }
  if (isBackfillWindow()) {
    await clearStaleBurstStates("backfill-window");
  }
  for (let index = 0; index < PRIORITY_PLATFORMS.length; index += 1) {
    const platform = PRIORITY_PLATFORMS[index];
    if (!scheduler[platform]?.nextRunAt) {
      await updateTrendSchedulerState(platform, {
        platform,
        failureCount: scheduler[platform]?.failureCount || 0,
        nextRunAt: nextBootRunIso(index),
        lastFrequencyLabel: `启动缓冲中，${Math.round((SCHEDULER_BOOT_GRACE_MS + (index * INITIAL_PLATFORM_SPACING_MS)) / 1000)} 秒后错峰启动`,
      });
    }
  }

  if (await shouldBootstrapBackfill()) {
    if (shouldRunBackfillWorkersNow()) {
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
  setTimeout(() => {
    runDuePlatforms().catch((error) => {
      console.warn("[growth.scheduler] initial bootstrap failed:", error);
    });
  }, SCHEDULER_BOOT_GRACE_MS);

  tickTimer = setInterval(() => {
    void (async () => {
      await refreshRuntimeModeOverride().catch((error) => {
        console.warn("[growth.scheduler] runtime mode refresh failed:", error);
      });
      if (shouldRunBackfillWorkersNow()) {
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
      void maybeCheckDouyinCredentialHealth().catch((error) => {
        console.warn("[growth.douyin.credentials] periodic probe failed:", error);
      });
    })();
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
