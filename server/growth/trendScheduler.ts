import path from "node:path";
import type { GrowthPlatform } from "@shared/growth";
import { collectPlatformTrends } from "./trendCollector";
import {
  exportTrendCollectionsCsv,
  isTrendCollectionStale,
  mergeTrendCollections,
  readTrendSchedulerState,
  readTrendStore,
  updateTrendSchedulerState,
} from "./trendStore";
import { sendMailWithAttachments } from "../services/smtp-mailer";

const PRIORITY_PLATFORMS: GrowthPlatform[] = ["douyin", "kuaishou", "bilibili", "xiaohongshu"];
const RETRY_BASE_MS = 5 * 60 * 1000;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;
const JITTER_MAX_MS = 20 * 60 * 1000;
const BURST_INTERVAL_MS = 30 * 60 * 1000;
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

function getSchedulerIntervalMinutes(now = new Date()) {
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
  return `${interval / 60} 小时一次`;
}

function isClearlyHigherThanPrevious(currentCount: number, previousCount: number) {
  if (previousCount <= 0) return currentCount >= 12;
  return currentCount >= previousCount + Math.max(5, Math.ceil(previousCount * 0.3));
}

function resolveNextRunPlan(params: {
  currentCount: number;
  previousCount: number;
  burstMode: boolean;
}) {
  if (params.burstMode) {
    if (params.currentCount < params.previousCount) {
      return {
        burstMode: false,
        nextRunAt: nextScheduledRunIso(),
        frequencyLabel: getSchedulerFrequencyLabel(),
      };
    }
    return {
      burstMode: true,
      nextRunAt: nextRunIso(BURST_INTERVAL_MS),
      frequencyLabel: "0.5 小时一次",
    };
  }

  if (isClearlyHigherThanPrevious(params.currentCount, params.previousCount)) {
    return {
      burstMode: true,
      nextRunAt: nextRunIso(BURST_INTERVAL_MS),
      frequencyLabel: "0.5 小时一次",
    };
  }

  return {
    burstMode: false,
    nextRunAt: nextScheduledRunIso(),
    frequencyLabel: getSchedulerFrequencyLabel(),
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
  live: boolean;
}) {
  const recipient = String(process.env.GROWTH_TREND_REPORT_EMAIL || "").trim();
  if (!recipient) return;

  const exported = await exportTrendCollectionsCsv();
  const platformFile = exported.files.find((file) => file.platform === params.platform);

  await sendMailWithAttachments({
    to: recipient,
    subject: `Creator Growth Camp 抓取更新 - ${params.platform}`,
    requireResend: true,
    text:
      `平台：${params.platform}\n` +
      `抓取时间：${params.collectedAt}\n` +
      `本次新增数量：${params.addedCount}\n` +
      `本次合并数量：${params.mergedCount}\n` +
      `当前总样本数：${params.itemCount}\n` +
      `下次计划抓取：${params.nextRunAt}\n` +
      `当前调度频率：${params.frequencyLabel}\n` +
      `是否真实 live：${params.live ? "是" : "否"}\n` +
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
      `<p><strong>平台：</strong>${params.platform}</p>` +
      `<p><strong>抓取时间：</strong>${params.collectedAt}</p>` +
      `<p><strong>本次新增：</strong>${params.addedCount}</p>` +
      `<p><strong>本次合并：</strong>${params.mergedCount}</p>` +
      `<p><strong>当前总样本数：</strong>${params.itemCount}</p>` +
      `<p><strong>下次计划抓取：</strong>${params.nextRunAt}</p>` +
      `<p><strong>当前调度频率：</strong>${params.frequencyLabel}</p>` +
      `<p><strong>是否真实 live：</strong>${params.live ? "是" : "否"}</p>` +
      `<p><strong>总导出行数：</strong>${exported.rows}</p>` +
      (platformFile ? `<p><strong>本次重点附件：</strong>${path.basename(platformFile.filePath)}</p>` : ""),
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
      burstTriggeredAt: plan.burstMode
        ? (currentState?.burstMode ? currentState?.burstTriggeredAt : collection.collectedAt)
        : undefined,
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

  await runDuePlatforms().catch((error) => {
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
  schedulerStarted = false;
}
