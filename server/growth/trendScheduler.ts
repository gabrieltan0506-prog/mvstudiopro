import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import { collectPlatformTrends } from "./trendCollector";
import { bootstrapGrowthTrendBackfillWorker, stopGrowthTrendBackfillWorker } from "./trendBackfill";
import {
  exportTrendCollectionsCsv,
  isTrendCollectionStale,
  mergeTrendCollections,
  readTrendMailDigestState,
  readTrendSchedulerState,
  readTrendStore,
  updateTrendMailDigestState,
  updateTrendSchedulerState,
} from "./trendStore";
import { sendMailWithAttachments } from "../services/smtp-mailer";

const PRIORITY_PLATFORMS: GrowthPlatform[] = ["douyin", "kuaishou", "bilibili", "xiaohongshu", "toutiao"];
const RETRY_BASE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 60 * 1000;
const JITTER_MAX_MS = 20 * 60 * 1000;
const BURST_INTERVAL_MS = 20 * 60 * 1000;
const BURST_TRIGGER_MIN_COUNT = Math.max(8, Number(process.env.GROWTH_BURST_TRIGGER_MIN_COUNT || 16) || 16);
const BURST_TRIGGER_GROWTH_RATIO = Math.max(0.15, Number(process.env.GROWTH_BURST_TRIGGER_GROWTH_RATIO || 0.35) || 0.35);
const BURST_EXIT_DROP_RATIO = Math.max(0.05, Number(process.env.GROWTH_BURST_EXIT_DROP_RATIO || 0.18) || 0.18);
const BURST_MIN_STABLE_RUNS = Math.max(1, Number(process.env.GROWTH_BURST_MIN_STABLE_RUNS || 2) || 2);
const MAIL_DIGEST_INTERVAL_MS = 30 * 60 * 1000;
const SCHEDULER_TIMEZONE = "Asia/Shanghai";
let schedulerStarted = false;
let tickTimer: ReturnType<typeof setInterval> | null = null;
let runInFlight = false;

function withJitter(baseMs: number) {
  return baseMs + Math.floor(Math.random() * JITTER_MAX_MS);
}

function nextRunIso(baseMs: number) {
  return new Date(Date.now() + withJitter(baseMs)).toISOString();
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

function getSchedulerIntervalMinutes(now = new Date()) {
  if (isWeekendOrHoliday(now)) return 20;
  const hour = getSchedulerHour(now);
  if (hour >= 17 && hour < 22) return 120;
  if (hour >= 22 || hour < 6) return 180;
  return 240;
}

function nextScheduledRunIso(now = new Date()) {
  return nextRunIso(getSchedulerIntervalMinutes(now) * 60 * 1000);
}

function getSchedulerFrequencyLabel(now = new Date()) {
  const interval = getSchedulerIntervalMinutes(now);
  if (isWeekendOrHoliday(now)) return "周末 / 节假日每 20 分钟一次";
  return `${interval / 60} 小时一次`;
}

function isClearlyHigherThanPrevious(currentCount: number, previousCount: number) {
  if (previousCount <= 0) return currentCount >= BURST_TRIGGER_MIN_COUNT;
  return currentCount >= previousCount + Math.max(5, Math.ceil(previousCount * BURST_TRIGGER_GROWTH_RATIO));
}

function resolveNextRunPlan(params: {
  currentCount: number;
  previousCount: number;
  burstMode: boolean;
  burstStableRuns: number;
}) {
  if (params.burstMode) {
    const exitThreshold = Math.max(0, Math.floor(params.previousCount * (1 - BURST_EXIT_DROP_RATIO)));
    if (params.currentCount < exitThreshold && params.burstStableRuns >= BURST_MIN_STABLE_RUNS) {
      return {
        burstMode: false,
        nextRunAt: nextScheduledRunIso(),
        frequencyLabel: getSchedulerFrequencyLabel(),
        burstStableRuns: 0,
        burstEvent: "exit" as const,
      };
    }
    return {
      burstMode: true,
      nextRunAt: nextRunIso(BURST_INTERVAL_MS),
      frequencyLabel: "20 分钟一次",
      burstStableRuns: params.currentCount >= params.previousCount ? params.burstStableRuns + 1 : 0,
      burstEvent: "stay" as const,
    };
  }

  if (isClearlyHigherThanPrevious(params.currentCount, params.previousCount)) {
    return {
      burstMode: true,
      nextRunAt: nextRunIso(BURST_INTERVAL_MS),
      frequencyLabel: "20 分钟一次",
      burstStableRuns: 0,
      burstEvent: "enter" as const,
    };
  }

  return {
    burstMode: false,
    nextRunAt: nextScheduledRunIso(),
    frequencyLabel: getSchedulerFrequencyLabel(),
    burstStableRuns: 0,
    burstEvent: "none" as const,
  };
}

function buildRetryDelayMs(failureCount: number) {
  return Math.min(60 * 60 * 1000, RETRY_BASE_MS * Math.max(1, 2 ** Math.max(0, failureCount - 1)));
}

async function notifyCollectionUpdate(params: {
  platform: GrowthPlatform;
  itemCount: number;
  addedCount: number;
  mergedCount: number;
  collectedAt: string;
  nextRunAt: string;
  frequencyLabel: string;
  burstMode: boolean;
  live: boolean;
}) {
  const recipient = String(process.env.GROWTH_TREND_REPORT_EMAIL || "").trim();
  if (!recipient) return;
  const digestState = await readTrendMailDigestState();
  const lastSentAtMs = digestState.lastSentAt ? new Date(digestState.lastSentAt).getTime() : 0;
  if (lastSentAtMs && Date.now() - lastSentAtMs < MAIL_DIGEST_INTERVAL_MS) {
    return;
  }

  const store = await readTrendStore();
  const exported = await exportTrendCollectionsCsv();
  const platformFile = exported.files.find((file) => file.platform === params.platform);
  const schedulerSummary = Object.values(store.scheduler || {})
    .map((item) =>
      `${item.platform}: ${item.lastCollectedCount || 0} 条 / 下次 ${item.nextRunAt || "-"} / ${item.lastFrequencyLabel || "-"}`,
    )
    .join("\n");

  await sendMailWithAttachments({
    to: recipient,
    subject: `Creator Growth Camp 数据汇总 - ${new Date().toISOString().slice(0, 16).replace("T", " ")}`,
    requireResend: true,
    text:
      `[Growth Trend Scheduler 半小时汇总]\n` +
      `最新触发平台：${params.platform}\n` +
      `最新抓取时间：${params.collectedAt}\n` +
      `最新新增数量：${params.addedCount}\n` +
      `最新合并数量：${params.mergedCount}\n` +
      `该平台当前总样本数：${params.itemCount}\n` +
      `当前 live 调度频率：${params.frequencyLabel}\n` +
      `当前 burst mode：${params.burstMode ? "ON" : "OFF"}\n` +
      `是否真实 live：${params.live ? "是" : "否"}\n` +
      `下次计划抓取：${params.nextRunAt}\n` +
      `\n[当前调度概览]\n${schedulerSummary}\n` +
      `总导出行数：${exported.rows}\n` +
      `清单：${exported.manifestPath}`,
    attachments: [
      ...exported.files.map((file) => ({
        filename: path.basename(file.filePath),
        path: file.filePath,
        contentType: "text/csv",
      })),
      {
        filename: path.basename(exported.manifestPath),
        path: exported.manifestPath,
        contentType: "application/json",
      },
    ],
    html:
      `<p><strong>半小时汇总窗口：</strong>30 分钟</p>` +
      `<p><strong>最新触发平台：</strong>${params.platform}</p>` +
      `<p><strong>抓取时间：</strong>${params.collectedAt}</p>` +
      `<p><strong>本次新增：</strong>${params.addedCount}</p>` +
      `<p><strong>本次合并：</strong>${params.mergedCount}</p>` +
      `<p><strong>该平台当前总样本数：</strong>${params.itemCount}</p>` +
      `<p><strong>下次计划抓取：</strong>${params.nextRunAt}</p>` +
      `<p><strong>当前 live 调度频率：</strong>${params.frequencyLabel}</p>` +
      `<p><strong>当前 burst mode：</strong>${params.burstMode ? "ON" : "OFF"}</p>` +
      `<p><strong>是否真实 live：</strong>${params.live ? "是" : "否"}</p>` +
      `<p><strong>总导出行数：</strong>${exported.rows}</p>` +
      (platformFile ? `<p><strong>本次重点附件：</strong>${path.basename(platformFile.filePath)}</p>` : ""),
  });
  await updateTrendMailDigestState({
    lastSentAt: new Date().toISOString(),
    lastManifestPath: exported.manifestPath,
    lastWindowMinutes: 30,
  });
}

async function runPlatform(platform: GrowthPlatform) {
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const currentState = (await readTrendSchedulerState())[platform];
  await updateTrendSchedulerState(platform, {
    lastRunAt: startedAt,
  });

  try {
    const collection = await collectPlatformTrends(platform);
    const mergedStore = await mergeTrendCollections({ [platform]: collection });
    const mergedCollection = mergedStore.collections[platform];
    const currentCount = collection.stats?.itemCount || collection.items.length;
    const previousCount = currentState?.lastCollectedCount || 0;
    const plan = resolveNextRunPlan({
      currentCount,
      previousCount,
      burstMode: Boolean(currentState?.burstMode),
      burstStableRuns: currentState?.burstStableRuns || 0,
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
      burstTriggeredAt: plan.burstMode
        ? (currentState?.burstMode ? currentState?.burstTriggeredAt : collection.collectedAt)
        : undefined,
      lastFrequencyLabel: plan.frequencyLabel,
      lastError: undefined,
    });
    if (collection.source === "live" && (mergedCollection?.items.length || 0) > 0) {
      const mergeStat = mergedStore.mergeStats?.[platform];
      await notifyCollectionUpdate({
        platform,
        itemCount: mergedCollection?.items.length || 0,
        addedCount: mergeStat?.addedCount || 0,
        mergedCount: mergeStat?.mergedCount || 0,
        collectedAt: collection.collectedAt,
        nextRunAt: plan.nextRunAt,
        frequencyLabel: plan.frequencyLabel,
        burstMode: plan.burstMode,
        live: collection.source === "live",
      }).catch((error) => {
        console.warn(`[growth.scheduler] email notify skipped for ${platform}:`, error);
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const current = (await readTrendSchedulerState())[platform];
    const failureCount = (current?.failureCount || 0) + 1;
    await updateTrendSchedulerState(platform, {
      failureCount,
      totalRuns: (current?.totalRuns || 0) + 1,
      totalFailures: (current?.totalFailures || 0) + 1,
      lastDurationMs: Date.now() - startedAtMs,
      lastError: message,
      burstMode: false,
      burstStableRuns: 0,
      burstTriggeredAt: undefined,
      nextRunAt: nextRunIso(buildRetryDelayMs(failureCount)),
    });
    console.warn(`[growth.scheduler] ${platform} failed:`, message);
  }
}

async function runDuePlatforms() {
  if (runInFlight) return;
  runInFlight = true;
  try {
    const store = await readTrendStore();
    const scheduler = await readTrendSchedulerState();
    const queue = PRIORITY_PLATFORMS.filter((platform) => {
      const nextRunAt = scheduler[platform]?.nextRunAt;
      if (!nextRunAt) {
        const lastCollectedAt = store.collections[platform]?.collectedAt;
        return isTrendCollectionStale(lastCollectedAt, getSchedulerIntervalMinutes() / 60);
      }
      return new Date(nextRunAt).getTime() <= Date.now();
    });

    for (const platform of queue) {
      await runPlatform(platform);
    }
  } finally {
    runInFlight = false;
  }
}

export async function bootstrapGrowthTrendScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const scheduler = await readTrendSchedulerState();
  for (const platform of PRIORITY_PLATFORMS) {
    if (!scheduler[platform]?.nextRunAt) {
      await updateTrendSchedulerState(platform, {
        platform,
        failureCount: scheduler[platform]?.failureCount || 0,
        nextRunAt: new Date().toISOString(),
      });
    }
  }

  bootstrapGrowthTrendBackfillWorker().catch((error) => {
    console.warn("[growth.backfill] bootstrap failed:", error);
  });
  runDuePlatforms().catch((error) => {
    console.warn("[growth.scheduler] initial bootstrap failed:", error);
  });

  tickTimer = setInterval(() => {
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
  schedulerStarted = false;
}
