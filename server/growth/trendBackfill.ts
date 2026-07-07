import type { GrowthPlatform } from "@shared/growth";
import { collectTrendPlatforms } from "./trendCollector";
import { mergeTrendCollectionsWithOptions, readGrowthDebugSummary, readTrendRuntimeMeta, reconcileTrendHistoryState, updateTrendBackfillProgress } from "./trendStore";
import { notifyGrowthCollectionUpdate } from "./trendMailDigest";
import { nowShanghaiIso } from "./time";

type BackfillKind = "live" | "history";

const HISTORY_MAX_ROUNDS = Math.max(1, Number(process.env.GROWTH_BACKFILL_ROUNDS || 20) || 20);
const LIVE_MAX_ROUNDS = Math.max(1, Number(process.env.GROWTH_LIVE_BACKFILL_ROUNDS || 12) || 12);
const PLATEAU_LIMIT = Math.max(2, Number(process.env.GROWTH_BACKFILL_PLATEAU_LIMIT || 3) || 3);
const HISTORY_MIN_INTERVAL_MS = 30 * 1000;
const HISTORY_MAX_INTERVAL_MS = 60 * 1000;
const BACKFILL_ACTIVE_INTERVAL_MS = Math.max(
  1 * 60 * 1000,
  Number(process.env.GROWTH_BACKFILL_ACTIVE_INTERVAL_MS || 5 * 60 * 1000) || 5 * 60 * 1000,
);
const BACKFILL_PENDING_RETRY_MS = Math.max(
  60 * 1000,
  Number(process.env.GROWTH_BACKFILL_PENDING_RETRY_MS || 5 * 60 * 1000) || 5 * 60 * 1000,
);
const BACKFILL_INITIAL_DELAY_MS = Math.max(
  30 * 1000,
  Number(process.env.GROWTH_BACKFILL_INITIAL_DELAY_MS || 60 * 1000) || 60 * 1000,
);
const BACKFILL_FAST_START_ENABLED = !/^(0|false|no)$/i.test(
  String(process.env.GROWTH_BACKFILL_FAST_START || "1").trim(),
);
const BACKFILL_FAST_START_MAX_ROUNDS = Math.max(
  1,
  Number(process.env.GROWTH_BACKFILL_FAST_START_MAX_ROUNDS || 2) || 2,
);
const BACKFILL_WINDOW_START_HOUR = Math.max(0, Math.min(23, Number(process.env.GROWTH_BACKFILL_WINDOW_START_HOUR || 1) || 1));
const BACKFILL_WINDOW_END_HOUR = Math.max(0, Math.min(23, Number(process.env.GROWTH_BACKFILL_WINDOW_END_HOUR || 6) || 6));
const HISTORY_BASE_INTERVAL_MS = Math.max(
  1 * 60 * 1000,
  Number(process.env.GROWTH_HISTORY_BACKFILL_INTERVAL_MS || 5 * 60 * 1000) || 5 * 60 * 1000,
);
const HISTORY_STAGE_ONE_THRESHOLD = Math.max(
  150_000,
  Number(process.env.GROWTH_HISTORY_BACKFILL_STAGE_ONE_THRESHOLD || 150_000) || 150_000,
);
const HISTORY_STAGE_TWO_THRESHOLD = Math.max(
  HISTORY_STAGE_ONE_THRESHOLD,
  Number(process.env.GROWTH_HISTORY_BACKFILL_STAGE_TWO_THRESHOLD || 300_000) || 300_000,
);
const HISTORY_STAGE_THREE_THRESHOLD = Math.max(
  HISTORY_STAGE_TWO_THRESHOLD,
  Number(process.env.GROWTH_HISTORY_BACKFILL_STAGE_THREE_THRESHOLD || 500_000) || 500_000,
);
const HISTORY_STEP_TARGET = Math.max(2, Number(process.env.GROWTH_BACKFILL_STEP_TARGET || 5) || 5);
const HISTORY_STEP_FALLBACK = Math.max(1, Number(process.env.GROWTH_BACKFILL_STEP_FALLBACK || 3) || 3);
const LIVE_STEP_TARGET = Math.max(3, Number(process.env.GROWTH_LIVE_BACKFILL_STEP_TARGET || 8) || 8);
const LIVE_STEP_FALLBACK = Math.max(2, Number(process.env.GROWTH_LIVE_BACKFILL_STEP_FALLBACK || 5) || 5);
const LIVE_WINDOW_DAYS = Math.max(7, Number(process.env.GROWTH_LIVE_BACKFILL_WINDOW_DAYS || 30) || 30);
const HISTORY_WINDOW_DAYS = Math.max(30, Number(process.env.GROWTH_HISTORY_BACKFILL_WINDOW_DAYS || 90) || 90);
const HISTORY_LEDGER_BATCH_ROUNDS = Math.max(2, Number(process.env.GROWTH_HISTORY_LEDGER_BATCH_ROUNDS || 6) || 6);
const LIVE_GAP_STALE_MINUTES = Math.max(30, Number(process.env.GROWTH_LIVE_BACKFILL_STALE_MINUTES || 30) || 30);
const LIVE_GAP_BUCKET_MINUTES = Math.max(
  15,
  Number(process.env.GROWTH_LIVE_BACKFILL_BUCKET_MINUTES || 30) || 30,
);
const LIVE_GAP_BUCKETS = Math.max(
  2,
  Number(process.env.GROWTH_LIVE_BACKFILL_GAP_BUCKETS || 2) || 2,
);
const LIVE_FINE_GAP_BUCKET_MINUTES = Math.max(
  5,
  Number(process.env.GROWTH_LIVE_BACKFILL_FINE_BUCKET_MINUTES || Math.max(5, Math.floor(LIVE_GAP_BUCKET_MINUTES / 2))) || Math.max(5, Math.floor(LIVE_GAP_BUCKET_MINUTES / 2)),
);
const LIVE_FINE_PENDING_LIMIT = Math.max(
  2,
  Number(process.env.GROWTH_LIVE_BACKFILL_FINE_PENDING_LIMIT || 4) || 4,
);
const PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "kuaishou", "bilibili", "toutiao"];
const BACKFILL_EXCLUDE_PLATFORMS = new Set<GrowthPlatform>(
  String(process.env.GROWTH_BACKFILL_EXCLUDE_PLATFORMS || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item): item is GrowthPlatform => PLATFORMS.includes(item as GrowthPlatform)),
);

const ENABLE_LIVE_BACKFILL_BOOTSTRAP = /^(1|true|yes)$/i.test(
  String(process.env.GROWTH_ENABLE_LIVE_BACKFILL_BOOTSTRAP || "0").trim(),
);
const BACKFILL_PLATFORM_TIMEOUT_MS = Math.max(
  30 * 1000,
  Number(process.env.GROWTH_BACKFILL_PLATFORM_TIMEOUT_MS || 60 * 1000) || 60 * 1000,
);
const BACKFILL_PLATFORM_CONCURRENCY = Math.max(
  1,
  Math.min(4, Number(process.env.GROWTH_BACKFILL_PLATFORM_CONCURRENCY || 2) || 2),
);

type WorkerState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  plateau: Map<GrowthPlatform, number>;
  previous: Map<GrowthPlatform, number>;
  startedAt: string;
  fastStartRoundsDone: number;
  lastHadPendingPlatforms: boolean;
  bootstrapStepsDone: number;
};

const workerState: Record<BackfillKind, WorkerState> = {
  live: {
    started: false,
    timer: null,
    inFlight: false,
    plateau: new Map<GrowthPlatform, number>(),
    previous: new Map<GrowthPlatform, number>(),
    startedAt: "",
    fastStartRoundsDone: 0,
    lastHadPendingPlatforms: false,
    bootstrapStepsDone: 0,
  },
  history: {
    started: false,
    timer: null,
    inFlight: false,
    plateau: new Map<GrowthPlatform, number>(),
    previous: new Map<GrowthPlatform, number>(),
    startedAt: "",
    fastStartRoundsDone: 0,
    lastHadPendingPlatforms: false,
    bootstrapStepsDone: 0,
  },
};

function isStorageFullError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return /\bENOSPC\b|no space left on device/i.test(message);
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

function canRunBackfillNow(kind: BackfillKind) {
  if (isBackfillWindow()) return true;
  if (!BACKFILL_FAST_START_ENABLED) return false;
  return workerState[kind].fastStartRoundsDone < BACKFILL_FAST_START_MAX_ROUNDS;
}

function getBackfillDelayMs(kind: BackfillKind, options?: { pendingPlatforms?: boolean; bootstrapStep?: boolean }) {
  if (options?.bootstrapStep) return BACKFILL_INITIAL_DELAY_MS;
  if (options?.pendingPlatforms) return BACKFILL_PENDING_RETRY_MS;
  if (kind === "history") return BACKFILL_ACTIVE_INTERVAL_MS;
  return BACKFILL_ACTIVE_INTERVAL_MS;
}

function nextHistoryDelayMs() {
  return BACKFILL_ACTIVE_INTERVAL_MS;
}

function formatMinutes(minutes: number) {
  if (minutes % 60 === 0) return `${minutes / 60} 小时`;
  return `${minutes} 分钟`;
}

function getShanghaiHour(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
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

function isBackfillWindow(now = new Date()) {
  return isHourInWindow(getShanghaiHour(now), BACKFILL_WINDOW_START_HOUR, BACKFILL_WINDOW_END_HOUR);
}

function getHistoricalCadenceMs(_totalArchivedItems: number) {
  return BACKFILL_ACTIVE_INTERVAL_MS;
}

async function runBackfillPlatformTasks(
  pending: GrowthPlatform[],
  kind: BackfillKind,
  label: string,
  nextRound: number,
  stepTarget: number,
  stepFallback: number,
  windowDays: number,
  statsBefore: BackfillRuntimeSnapshot,
) {
  const mergedStats: Record<string, { addedCount?: number; mergedCount?: number }> = {};
  const collectedErrors: Record<string, string | undefined> = {};

  process.env.GROWTH_BACKFILL_ACTIVE = "1";
  process.env.GROWTH_BACKFILL_MODE = kind;
  process.env.GROWTH_BACKFILL_STEP_TARGET = String(stepTarget);
  process.env.GROWTH_BACKFILL_STEP_FALLBACK = String(stepFallback);
  process.env.GROWTH_BACKFILL_COOKIE_OFFSET = String(Math.max(0, nextRound - 1));

  const tasks = pending.map((platform) => async () => {
    try {
      const collected = await withTimeout(
        collectTrendPlatforms([platform]),
        BACKFILL_PLATFORM_TIMEOUT_MS,
        `[${label}] ${platform}`,
      );
      if (collected.errors[platform]) {
        collectedErrors[platform] = collected.errors[platform];
      }
      const merged = await mergeTrendCollectionsWithOptions(collected.collections, {
        deferHistoryLedger: kind === "history",
      });
      if (merged.mergeStats?.[platform]) {
        mergedStats[platform] = merged.mergeStats[platform];
      }
      const collection = collected.collections[platform];
      if (collection?.source === "live" && collection.items.length) {
        await notifyGrowthCollectionUpdate({
          platform,
          itemCount: collection.items.length,
          addedCount: merged.mergeStats?.[platform]?.addedCount || 0,
          mergedCount: merged.mergeStats?.[platform]?.mergedCount || 0,
          collectedAt: collection.collectedAt,
          nextRunAt: nowShanghaiIso(Date.now() + nextHistoryDelayMs()),
          frequencyLabel: kind === "live"
            ? `近 ${windowDays} 天 live 回填 / ${LIVE_GAP_BUCKET_MINUTES} 分钟 bucket / 目标步长 ${stepTarget}`
            : `历史回填 / ${statsBefore.selectedWindowDays} 天窗口 / 目标步长 ${stepTarget}`,
          burstMode: false,
          live: true,
          collection,
        }).catch((error) => {
          console.warn(`[${label}] email notify skipped for ${platform}:`, error);
        });
      }
    } catch (error) {
      collectedErrors[platform] = error instanceof Error ? error.message : String(error);
      console.warn(`[${label}] ${platform} failed:`, error);
    }
  });

  for (let index = 0; index < tasks.length; index += BACKFILL_PLATFORM_CONCURRENCY) {
    const batch = tasks.slice(index, index + BACKFILL_PLATFORM_CONCURRENCY);
    await Promise.allSettled(batch.map((task) => task()));
  }

  return { mergedStats, collectedErrors };
}

function getWorkerLabel(kind: BackfillKind) {
  return kind === "live" ? "growth.backfill.live" : "growth.backfill";
}

function getWorkerStepTarget(kind: BackfillKind) {
  return kind === "live" ? LIVE_STEP_TARGET : HISTORY_STEP_TARGET;
}

function getWorkerStepFallback(kind: BackfillKind) {
  return kind === "live" ? LIVE_STEP_FALLBACK : HISTORY_STEP_FALLBACK;
}

function getWorkerMaxRounds(kind: BackfillKind) {
  return kind === "live" ? LIVE_MAX_ROUNDS : HISTORY_MAX_ROUNDS;
}

function getWorkerSelectedWindowDays(kind: BackfillKind) {
  return kind === "live"
    ? LIVE_WINDOW_DAYS
    : HISTORY_WINDOW_DAYS;
}

function isSchedulerStale(lastSuccessAt?: string) {
  const time = new Date(lastSuccessAt || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return true;
  return Date.now() - time >= LIVE_GAP_STALE_MINUTES * 60 * 1000;
}

function isSchedulerGapDetected(lastSuccessAt?: string) {
  const time = new Date(lastSuccessAt || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return true;
  const ageMinutes = (Date.now() - time) / (60 * 1000);
  return ageMinutes >= LIVE_GAP_BUCKET_MINUTES * LIVE_GAP_BUCKETS;
}

function getLastSuccessAgeMinutes(lastSuccessAt?: string) {
  const time = new Date(lastSuccessAt || 0).getTime();
  if (!Number.isFinite(time) || time <= 0) return Number.POSITIVE_INFINITY;
  return (Date.now() - time) / (60 * 1000);
}

async function scheduleNextBackfillStep(kind: BackfillKind) {
  const state = workerState[kind];
  if (!state.started) return;
  if (state.timer) clearTimeout(state.timer);
  let delayMs = getBackfillDelayMs(kind, {
    pendingPlatforms: state.lastHadPendingPlatforms,
    bootstrapStep: state.bootstrapStepsDone <= 1,
  });
  if (kind === "history") {
    try {
      const stats = await readBackfillSnapshotFor("history");
      const totalArchivedItems = stats.platforms.reduce((sum, item) => sum + (item.archivedTotal || 0), 0);
      delayMs = getHistoricalCadenceMs(totalArchivedItems);
      if (state.lastHadPendingPlatforms) {
        delayMs = Math.min(delayMs, BACKFILL_PENDING_RETRY_MS);
      }
      if (state.bootstrapStepsDone <= 1) {
        delayMs = Math.min(delayMs, BACKFILL_INITIAL_DELAY_MS);
      }
    } catch {
      delayMs = HISTORY_BASE_INTERVAL_MS;
    }
  }
  if (!isBackfillWindow() && !canRunBackfillNow(kind)) {
    delayMs = Math.max(delayMs, BACKFILL_PENDING_RETRY_MS);
  }
  await updateTrendBackfillProgress({
    mode: kind,
    active: true,
    startedAt: state.startedAt || nowShanghaiIso(),
    nextRunAt: nowShanghaiIso(Date.now() + delayMs),
    finishedAt: undefined,
    status: "running",
  }).catch(() => undefined);
  state.timer = setTimeout(() => {
    runBackfillStep(kind)
      .catch((error) => {
        console.warn(`[${getWorkerLabel(kind)}] periodic tick failed:`, error);
      })
      .finally(() => {
        void scheduleNextBackfillStep(kind);
      });
  }, delayMs);
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

type BackfillRuntimeSnapshot = Omit<BackfillSnapshot, "platforms"> & {
  platforms: Array<BackfillPlatformSnapshot & { lastSuccessAt?: string }>;
};

async function readBackfillSnapshotFor(kind: BackfillKind): Promise<BackfillRuntimeSnapshot> {
  const [summary, runtimeMeta] = await Promise.all([
    readGrowthDebugSummary(),
    readTrendRuntimeMeta(),
  ]);
  const progress = kind === "live"
    ? runtimeMeta.backfillLive
    : runtimeMeta.backfillHistory;
  const scheduler = runtimeMeta.scheduler || {};
  return {
    currentRound: progress?.currentRound || 0,
    selectedWindowDays: progress?.selectedWindowDays || getWorkerSelectedWindowDays(kind),
    platforms: PLATFORMS.map((platform) => ({
      platform,
      currentTotal: summary?.platforms?.[platform]?.currentTotal || 0,
      archivedTotal: summary?.platforms?.[platform]?.archivedTotal || 0,
      lastSuccessAt: scheduler[platform]?.lastSuccessAt,
    })),
  };
}

function getPendingPlatforms(kind: BackfillKind, stats: BackfillRuntimeSnapshot) {
  const ranked = PLATFORMS.filter((platform) => {
    if (BACKFILL_EXCLUDE_PLATFORMS.has(platform)) return false;
    if (kind === "live") {
      const row = stats.platforms.find((item) => item.platform === platform);
      return isSchedulerStale(row?.lastSuccessAt) || isSchedulerGapDetected(row?.lastSuccessAt);
    }
    return (workerState.history.plateau.get(platform) || 0) < PLATEAU_LIMIT;
  }).sort((left, right) => {
    const leftRow = stats.platforms.find((item) => item.platform === left);
    const rightRow = stats.platforms.find((item) => item.platform === right);
    const leftWeight = (leftRow?.currentTotal || 0) + (leftRow?.archivedTotal || 0);
    const rightWeight = (rightRow?.currentTotal || 0) + (rightRow?.archivedTotal || 0);
    return rightWeight - leftWeight;
  });

  if (kind !== "live" || ranked.length) return ranked;

  return PLATFORMS
    .filter((platform) => !BACKFILL_EXCLUDE_PLATFORMS.has(platform))
    .map((platform) => {
      const row = stats.platforms.find((item) => item.platform === platform);
      return {
        platform,
        ageMinutes: getLastSuccessAgeMinutes(row?.lastSuccessAt),
        totalWeight: (row?.currentTotal || 0) + (row?.archivedTotal || 0),
      };
    })
    .filter((item) => item.ageMinutes >= LIVE_FINE_GAP_BUCKET_MINUTES)
    .sort((left, right) => {
      if (right.ageMinutes !== left.ageMinutes) return right.ageMinutes - left.ageMinutes;
      return right.totalWeight - left.totalWeight;
    })
    .slice(0, LIVE_FINE_PENDING_LIMIT)
    .map((item) => item.platform);
}

async function runBackfillStep(kind: BackfillKind) {
  const state = workerState[kind];
  if (state.inFlight) return;
  if (!canRunBackfillNow(kind)) return;
  state.inFlight = true;
  const roundStartedAt = nowShanghaiIso();
  try {
    const statsBefore = await readBackfillSnapshotFor(kind);
    const pending = getPendingPlatforms(kind, statsBefore);
    state.lastHadPendingPlatforms = pending.length > 0;
    if (!isBackfillWindow() && BACKFILL_FAST_START_ENABLED) {
      state.fastStartRoundsDone += 1;
    }
    state.bootstrapStepsDone += 1;
    const label = getWorkerLabel(kind);
    const stepTarget = getWorkerStepTarget(kind);
    const stepFallback = getWorkerStepFallback(kind);
    const maxRounds = getWorkerMaxRounds(kind);
    const windowDays = getWorkerSelectedWindowDays(kind);
    if (!pending.length) {
      await updateTrendBackfillProgress({
        mode: kind,
        active: true,
        status: "running",
        startedAt: state.startedAt || roundStartedAt,
        nextRunAt: nowShanghaiIso(Date.now() + getBackfillDelayMs(kind, { pendingPlatforms: true })),
        selectedWindowDays: statsBefore.selectedWindowDays,
        note: kind === "live"
          ? `近 ${windowDays} 天回填运行中：当前未发现硬缺口，worker 保持运行，${formatMinutes(Math.round(BACKFILL_PENDING_RETRY_MS / (60 * 1000)))} 内重试细桶扫描，并继续复用跨平台关键词/话题种子。`
          : `历史回填运行中：所有平台暂时进入低产出平台期，worker 保持运行，${formatMinutes(Math.round(BACKFILL_PENDING_RETRY_MS / (60 * 1000)))} 内重试下一轮。`,
        platforms: PLATFORMS.map((platform) => {
          const row = statsBefore.platforms.find((item) => item.platform === platform);
          return {
            platform,
            target: 0,
            currentTotal: row?.currentTotal || 0,
            archivedTotal: row?.archivedTotal || 0,
            plateauCount: state.plateau.get(platform) || 0,
            status: "pending",
          };
        }),
      });
      return;
    }

    const nextRound = Math.min(maxRounds, (statsBefore.currentRound || 0) + 1);
    if (!state.startedAt) state.startedAt = roundStartedAt;
    await updateTrendBackfillProgress({
      mode: kind,
      active: true,
      startedAt: state.startedAt,
      finishedAt: undefined,
      currentRound: nextRound,
      maxRounds,
      targetPerPlatform: 0,
      selectedWindowDays: statsBefore.selectedWindowDays,
      status: "running",
      note: kind === "live"
        ? `近期回填运行中：窗口 ${windowDays} 天，夜间模式，按 ${LIVE_GAP_BUCKET_MINUTES} 分钟 bucket 扫描缺口，连续 ${LIVE_GAP_BUCKETS} 个 bucket 缺失即补齐，目标步长 ${stepTarget}。`
        : `历史回填运行中：窗口 ${statsBefore.selectedWindowDays} 天，夜间模式默认每 ${formatMinutes(Math.round(BACKFILL_ACTIVE_INTERVAL_MS / (60 * 1000)))} 一次，并启用回填 burst。`,
      platforms: PLATFORMS.map((platform) => {
        const row = statsBefore.platforms.find((item) => item.platform === platform);
        return {
          platform,
          target: 0,
          currentTotal: row?.currentTotal || 0,
          archivedTotal: row?.archivedTotal || 0,
          startedAt: pending.includes(platform) ? roundStartedAt : undefined,
          plateauCount: state.plateau.get(platform) || 0,
          status: pending.includes(platform) ? "running" : "plateau",
        };
      }),
    });

    const { mergedStats, collectedErrors } = await runBackfillPlatformTasks(
      pending,
      kind,
      label,
      nextRound,
      stepTarget,
      stepFallback,
      windowDays,
      statsBefore,
    );
    if (kind === "history" && nextRound % HISTORY_LEDGER_BATCH_ROUNDS === 0) {
      await reconcileTrendHistoryState({ force: true }).catch((error) => {
        console.warn(`[${label}] delayed history reconcile skipped:`, error);
      });
    }
    const statsAfter = await readBackfillSnapshotFor(kind);

    for (const platform of pending) {
      const total = statsAfter.platforms.find((item) => item.platform === platform)?.archivedTotal || 0;
      const prev = state.previous.get(platform) || 0;
      const added = mergedStats?.[platform]?.addedCount || 0;
      state.previous.set(platform, total);
      if (collectedErrors[platform]) continue;
      const madeProgress = added > 0 || total > prev;
      state.plateau.set(platform, madeProgress ? 0 : (state.plateau.get(platform) || 0) + 1);
    }

    await updateTrendBackfillProgress({
      mode: kind,
      active: true,
      finishedAt: undefined,
      currentRound: nextRound,
      maxRounds,
      targetPerPlatform: 0,
      selectedWindowDays: statsAfter.selectedWindowDays,
      status: "running",
      note: kind === "live"
        ? `近期回填运行中：窗口 ${windowDays} 天，夜间模式，优先按 ${LIVE_GAP_BUCKET_MINUTES} 分钟 bucket 扫描硬缺口；无硬缺口时退到 ${LIVE_FINE_GAP_BUCKET_MINUTES} 分钟细桶继续补齐，并复用跨平台关键词/话题种子。`
        : `历史回填运行中：窗口 ${statsAfter.selectedWindowDays} 天；并发 ${BACKFILL_PLATFORM_CONCURRENCY} 平台/step，按 merge addedCount 判断产出，history-ledger 每 ${HISTORY_LEDGER_BATCH_ROUNDS} 轮批量刷新。`,
      platforms: PLATFORMS.map((platform) => {
        const row = statsAfter.platforms.find((item) => item.platform === platform);
        const stalled = pending.includes(platform) && (state.plateau.get(platform) || 0) >= PLATEAU_LIMIT;
        return {
          platform,
          target: 0,
          currentTotal: row?.currentTotal || 0,
          archivedTotal: row?.archivedTotal || 0,
          startedAt: pending.includes(platform) ? roundStartedAt : undefined,
          addedCount: mergedStats?.[platform]?.addedCount || 0,
          mergedCount: mergedStats?.[platform]?.mergedCount || 0,
          plateauCount: state.plateau.get(platform) || 0,
          status: stalled ? "plateau" : "running",
          error: collectedErrors[platform],
        };
      }),
    });
  } catch (error) {
    const stats = await readBackfillSnapshotFor(kind).catch(() => null);
    const storageFull = isStorageFullError(error);
    await updateTrendBackfillProgress({
      mode: kind,
      active: true,
      nextRunAt: undefined,
      finishedAt: storageFull ? undefined : nowShanghaiIso(),
      status: storageFull ? "running" : "failed",
      note: storageFull
        ? `${kind === "live" ? "近期 live 回填" : "历史回填"}运行中：磁盘空间不足，保留最后一次成功结果，等待 archive 外移后继续。`
        : (error instanceof Error ? error.message : String(error)),
      platforms: stats
        ? PLATFORMS.map((platform) => {
            const row = stats.platforms.find((item) => item.platform === platform);
            return {
              platform,
              target: 0,
              currentTotal: row?.currentTotal || 0,
              archivedTotal: row?.archivedTotal || 0,
              plateauCount: state.plateau.get(platform) || 0,
              status: (state.plateau.get(platform) || 0) >= PLATEAU_LIMIT ? "plateau" : "running",
              error: storageFull ? undefined : undefined,
            };
          })
        : undefined,
    });
    console.warn(`[${getWorkerLabel(kind)}] step failed:`, error);
  } finally {
    state.inFlight = false;
  }
}

export async function runGrowthTrendBackfillStep() {
  await runBackfillStep("history");
}

export async function runGrowthTrendLiveBackfillStep() {
  await runBackfillStep("live");
}

async function bootstrapWorker(kind: BackfillKind) {
  const state = workerState[kind];
  if (state.started) return;
  state.started = true;
  state.startedAt = nowShanghaiIso();
  state.fastStartRoundsDone = 0;
  state.bootstrapStepsDone = 0;
  await updateTrendBackfillProgress({
    mode: kind,
    active: true,
    status: "running",
    startedAt: state.startedAt,
    nextRunAt: nowShanghaiIso(Date.now() + BACKFILL_INITIAL_DELAY_MS),
    note: kind === "live"
      ? `近期 live 回填启动：部署后 ${formatMinutes(Math.round(BACKFILL_INITIAL_DELAY_MS / (60 * 1000)))} 内首跑，pending 平台最长 ${formatMinutes(Math.round(BACKFILL_PENDING_RETRY_MS / (60 * 1000)))} 重试。`
      : `历史回填启动：部署后 ${formatMinutes(Math.round(BACKFILL_INITIAL_DELAY_MS / (60 * 1000)))} 内首跑，pending 平台最长 ${formatMinutes(Math.round(BACKFILL_PENDING_RETRY_MS / (60 * 1000)))} 重试；优先合并 GitHub 冷备 history-ledger。`,
    platforms: PLATFORMS.map((platform) => ({
      platform,
      target: 0,
      currentTotal: 0,
      archivedTotal: 0,
      status: BACKFILL_EXCLUDE_PLATFORMS.has(platform) ? "plateau" : "pending",
    })),
  }).catch(() => undefined);
  await runBackfillStep(kind);
  await scheduleNextBackfillStep(kind);
}

function stopWorker(kind: BackfillKind) {
  const state = workerState[kind];
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.started = false;
  state.startedAt = "";
  state.fastStartRoundsDone = 0;
  state.lastHadPendingPlatforms = false;
  state.bootstrapStepsDone = 0;
  void updateTrendBackfillProgress({
    mode: kind,
    active: false,
    currentRound: 0,
    maxRounds: 0,
    targetPerPlatform: 0,
    platforms: [],
    nextRunAt: undefined,
    finishedAt: nowShanghaiIso(),
    status: "idle",
    note: undefined,
  }).catch(() => undefined);
}

export async function bootstrapGrowthTrendBackfillWorker() {
  await bootstrapWorker("history");
}

export async function bootstrapGrowthTrendLiveBackfillWorker() {
  if (!ENABLE_LIVE_BACKFILL_BOOTSTRAP) return;
  await bootstrapWorker("live");
}

export function stopGrowthTrendBackfillWorker() {
  stopWorker("history");
}

export function stopGrowthTrendLiveBackfillWorker() {
  stopWorker("live");
}
