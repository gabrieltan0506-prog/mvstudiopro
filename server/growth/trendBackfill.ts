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
const HISTORY_BASE_INTERVAL_MS = Math.max(
  30 * 60 * 1000,
  Number(process.env.GROWTH_HISTORY_BACKFILL_INTERVAL_MS || 30 * 60 * 1000) || 30 * 60 * 1000,
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
const HISTORY_STEP_TARGET = Math.max(3, Number(process.env.GROWTH_BACKFILL_STEP_TARGET || 5) || 5);
const HISTORY_STEP_FALLBACK = Math.max(2, Number(process.env.GROWTH_BACKFILL_STEP_FALLBACK || 3) || 3);
const LIVE_STEP_TARGET = Math.max(5, Number(process.env.GROWTH_LIVE_BACKFILL_STEP_TARGET || 8) || 8);
const LIVE_STEP_FALLBACK = Math.max(5, Number(process.env.GROWTH_LIVE_BACKFILL_STEP_FALLBACK || 5) || 5);
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
const PLATFORMS: GrowthPlatform[] = ["douyin", "xiaohongshu", "kuaishou", "bilibili", "toutiao"];

const ENABLE_LIVE_BACKFILL_BOOTSTRAP = /^(1|true|yes)$/i.test(
  String(process.env.GROWTH_ENABLE_LIVE_BACKFILL_BOOTSTRAP || "0").trim(),
);
const BACKFILL_PLATFORM_TIMEOUT_MS = Math.max(
  30 * 1000,
  Number(process.env.GROWTH_BACKFILL_PLATFORM_TIMEOUT_MS || 2 * 60 * 1000) || 2 * 60 * 1000,
);

type WorkerState = {
  started: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: boolean;
  plateau: Map<GrowthPlatform, number>;
  previous: Map<GrowthPlatform, number>;
  startedAt: string;
};

const workerState: Record<BackfillKind, WorkerState> = {
  live: {
    started: false,
    timer: null,
    inFlight: false,
    plateau: new Map<GrowthPlatform, number>(),
    previous: new Map<GrowthPlatform, number>(),
    startedAt: "",
  },
  history: {
    started: false,
    timer: null,
    inFlight: false,
    plateau: new Map<GrowthPlatform, number>(),
    previous: new Map<GrowthPlatform, number>(),
    startedAt: "",
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

function nextHistoryDelayMs() {
  const span = Math.max(0, HISTORY_MAX_INTERVAL_MS - HISTORY_MIN_INTERVAL_MS);
  return HISTORY_MIN_INTERVAL_MS + Math.floor(Math.random() * (span + 1));
}

function getHistoricalCadenceMs(totalArchivedItems: number) {
  if (totalArchivedItems >= HISTORY_STAGE_THREE_THRESHOLD) return 4 * 60 * 60 * 1000;
  if (totalArchivedItems >= HISTORY_STAGE_TWO_THRESHOLD) return 2 * 60 * 60 * 1000;
  if (totalArchivedItems >= HISTORY_STAGE_ONE_THRESHOLD) return 60 * 60 * 1000;
  return HISTORY_BASE_INTERVAL_MS;
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

async function scheduleNextBackfillStep(kind: BackfillKind) {
  const state = workerState[kind];
  if (!state.started) return;
  if (state.timer) clearTimeout(state.timer);
  let delayMs = nextHistoryDelayMs();
  if (kind === "history") {
    try {
      const stats = await readBackfillSnapshotFor("history");
      const totalArchivedItems = stats.platforms.reduce((sum, item) => sum + (item.archivedTotal || 0), 0);
      delayMs = getHistoricalCadenceMs(totalArchivedItems);
    } catch {
      delayMs = HISTORY_BASE_INTERVAL_MS;
    }
  }
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
  return PLATFORMS.filter((platform) => {
    if (kind === "live") {
      const row = stats.platforms.find((item) => item.platform === platform);
      return isSchedulerStale(row?.lastSuccessAt) || isSchedulerGapDetected(row?.lastSuccessAt);
    }
    return (workerState.history.plateau.get(platform) || 0) < PLATEAU_LIMIT;
  });
}

async function runBackfillStep(kind: BackfillKind) {
  const state = workerState[kind];
  if (state.inFlight) return;
  state.inFlight = true;
  try {
    const statsBefore = await readBackfillSnapshotFor(kind);
    const pending = getPendingPlatforms(kind, statsBefore);
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
        selectedWindowDays: statsBefore.selectedWindowDays,
        note: kind === "live"
          ? `近 ${windowDays} 天回填运行中：当前未发现需要补齐的 live 断点，worker 保持运行。`
          : "历史回填运行中：所有平台暂时进入低产出平台期，worker 保持运行，等待下一轮继续抓取。",
        platforms: PLATFORMS.map((platform) => {
          const row = statsBefore.platforms.find((item) => item.platform === platform);
          return {
            platform,
            target: 0,
            currentTotal: row?.currentTotal || 0,
            archivedTotal: row?.archivedTotal || 0,
            plateauCount: state.plateau.get(platform) || 0,
            status: "plateau",
          };
        }),
      });
      return;
    }

    const nextRound = Math.min(maxRounds, (statsBefore.currentRound || 0) + 1);
    if (!state.startedAt) state.startedAt = nowShanghaiIso();
    await updateTrendBackfillProgress({
      mode: kind,
      active: true,
      startedAt: state.startedAt,
      currentRound: nextRound,
      maxRounds,
      targetPerPlatform: 0,
      selectedWindowDays: statsBefore.selectedWindowDays,
      status: "running",
      note: kind === "live"
        ? `近 ${windowDays} 天 live 回填运行中：按 ${LIVE_GAP_BUCKET_MINUTES} 分钟 bucket 扫描缺口，连续 ${LIVE_GAP_BUCKETS} 个 bucket 缺失即补齐，目标步长 ${stepTarget}。`
        : `历史回填运行中：窗口 ${statsBefore.selectedWindowDays} 天，默认每 30 分钟一次；累计量超 ${HISTORY_STAGE_ONE_THRESHOLD} / ${HISTORY_STAGE_TWO_THRESHOLD} / ${HISTORY_STAGE_THREE_THRESHOLD} 后分别降到 1 / 2 / 4 小时一次。`,
      platforms: PLATFORMS.map((platform) => {
        const row = statsBefore.platforms.find((item) => item.platform === platform);
        return {
          platform,
          target: 0,
          currentTotal: row?.currentTotal || 0,
          archivedTotal: row?.archivedTotal || 0,
          plateauCount: state.plateau.get(platform) || 0,
          status: pending.includes(platform) ? "running" : "plateau",
        };
      }),
    });

    process.env.GROWTH_BACKFILL_ACTIVE = kind;
    process.env.GROWTH_BACKFILL_STEP_TARGET = String(stepTarget);
    process.env.GROWTH_BACKFILL_STEP_FALLBACK = String(stepFallback);
    process.env.GROWTH_BACKFILL_COOKIE_OFFSET = String(Math.max(0, nextRound - 1));
    const mergedCollections: Partial<Record<GrowthPlatform, Awaited<ReturnType<typeof collectTrendPlatforms>>["collections"][GrowthPlatform]>> = {};
    const mergedStats: Record<string, any> = {};
    const collectedErrors: Record<string, string | undefined> = {};
    for (const platform of pending) {
      const collected = await withTimeout(
        collectTrendPlatforms([platform]),
        BACKFILL_PLATFORM_TIMEOUT_MS,
        `[${label}] ${platform}`,
      );
      if (collected.collections[platform]) {
        mergedCollections[platform] = collected.collections[platform];
      }
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
    }
    if (kind === "history" && nextRound % HISTORY_LEDGER_BATCH_ROUNDS === 0) {
      await reconcileTrendHistoryState({ force: true }).catch((error) => {
        console.warn(`[${label}] delayed history reconcile skipped:`, error);
      });
    }
    const statsAfter = await readBackfillSnapshotFor(kind);

    for (const platform of pending) {
      const total = statsAfter.platforms.find((item) => item.platform === platform)?.archivedTotal || 0;
      const prev = state.previous.get(platform) || 0;
      state.previous.set(platform, total);
      state.plateau.set(platform, total <= prev ? (state.plateau.get(platform) || 0) + 1 : 0);
    }

    await updateTrendBackfillProgress({
      mode: kind,
      active: true,
      currentRound: nextRound,
      maxRounds,
      targetPerPlatform: 0,
      selectedWindowDays: statsAfter.selectedWindowDays,
      status: "running",
      note: kind === "live"
        ? `近 ${windowDays} 天 live 回填运行中：按 ${LIVE_GAP_BUCKET_MINUTES} 分钟 bucket 扫描缺口，连续 ${LIVE_GAP_BUCKETS} 个 bucket 缺失即补齐。`
        : `历史回填运行中：窗口 ${statsAfter.selectedWindowDays} 天；单平台逐一回填，小步长抓取，history-ledger 延迟到每 ${HISTORY_LEDGER_BATCH_ROUNDS} 轮再批量刷新。`,
      platforms: PLATFORMS.map((platform) => {
        const row = statsAfter.platforms.find((item) => item.platform === platform);
        const stalled = pending.includes(platform) && (state.plateau.get(platform) || 0) >= PLATEAU_LIMIT;
        return {
          platform,
          target: 0,
          currentTotal: row?.currentTotal || 0,
          archivedTotal: row?.archivedTotal || 0,
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
